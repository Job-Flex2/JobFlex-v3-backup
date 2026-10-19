"use server";

// THE LAWN & LANDSCAPE ESTIMATOR'S SERVER SIDE (2026-10-18 — owner: "a landscaper types the client's address and
// sees how much grass to service … estimate it and keep them on a service plan"; admin preview).
//   readLawnProperty — the address → the lot, the USDA aerial photo, every pixel classed, the slope (lib/lawn/read).
//   saveLawnDraft / listLawnDrafts / loadLawnDraft / deleteLawnDraft — SyncState `lawndraft:<org>:<id>`, at most 60.
//   readLawnSettings / saveLawnSettings — the company's lawn rates, SyncState `lawnsettings:<org>`.
//   findLawnClients — the client picker.
//   convertLawnToProposal — the priced yard → a draft proposal (trade "lawn"), the yard riding along as an activity.
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkPlanLimit } from "@/lib/limitsEngine";
import { PLAN_LIMIT_MESSAGE } from "@/lib/planLimits";
import { ProposalStatus } from "@/lib/prismaEnums";
import { clearFilingContext, filedClientId, leadProposalText, readFilingContext } from "@/lib/filingContext";
import { stateTaxRate } from "@/lib/pricing/salesTax";
import { applyMemberDiscount } from "@/lib/servicePlanBook";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { isLimitedRole, requireOrg } from "@/lib/orgContext";
import { logServerError } from "@/lib/server-events";
import { enforceRateLimit, HOUR, RateLimitError } from "@/lib/rateLimit";
import { canUseLawnEstimator } from "@/lib/lawn/access";
import { readProperty, ReadError } from "@/lib/lawn/read";
import type { LawnSite } from "@/lib/lawn/site";
import { cleanLawnSettings, cleanOptions, DEFAULT_LAWN_SETTINGS, type LawnSettings, type ServiceOptions } from "@/lib/lawn/pricing";
import { lawnTaxed } from "@/lib/lawn/tax";

type Gate = { ok: true; organizationId: string; userId: string; role: string } | { ok: false; error: string };

async function gate(): Promise<Gate> {
  try {
    const ctx = await requireOrg();
    if (isLimitedRole(ctx.role)) return { ok: false, error: "The lawn estimator isn't open to this role." };
    if (!(await canUseLawnEstimator(ctx.user))) return { ok: false, error: "The lawn estimator is in preview for admins." };
    return { ok: true, organizationId: ctx.organizationId, userId: ctx.user.id, role: String(ctx.role) };
  } catch {
    return { ok: false, error: "Sign in again to use the lawn estimator." };
  }
}

const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

/** The address (or a point, or the contractor's own lot line) → the property read. */
export async function readLawnProperty(raw: unknown): Promise<{ ok: true; site: LawnSite } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const parsed = z.object({ address: z.string().max(300).optional(), lat: z.number().optional(), lng: z.number().optional(), ring: z.array(latLng).min(3).max(400).optional() }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: "That address couldn't be read." };
  try {
    await enforceRateLimit(`lawn-read:${g.organizationId}`, 80, HOUR, "property reads");
    const site = await readProperty(parsed.data);
    return { ok: true, site };
  } catch (err) {
    if (err instanceof ReadError) return { ok: false, error: err.message };
    if (err instanceof RateLimitError) return { ok: false, error: err.message };
    logServerError("lawn-read", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The aerial photo couldn't be read right now — try again in a minute." };
  }
}

/* ── Drafts ──────────────────────────────────────────────────────────────────────────────────────────────────── */

const PREFIX = "lawndraft:";
const DRAFT_MAX = 60;
const draftKey = (org: string, id: string) => `${PREFIX}${org}:${id}`;

export type LawnDraft = {
  site: LawnSite;
  options: ServiceOptions;
  /** The services ticked for the estimate. */
  picked: string[];
  clientId: string | null;
  title: string;
};
export type LawnDraftRow = { id: string; title: string; address: string; updatedAt: string; by: string | null; lawnSqft: number | null };
type StoredDraft = { v: 1; updatedAt: string; by: string | null; lawnSqft: number | null; draft: LawnDraft };

function readStored(cursor: string): StoredDraft | null {
  try {
    const o = JSON.parse(cursor) as StoredDraft;
    return o && o.v === 1 && o.draft?.site?.v === 1 ? o : null;
  } catch {
    return null;
  }
}

function cleanDraft(raw: unknown): LawnDraft | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const site = o?.site as LawnSite | undefined;
  if (!site || site.v !== 1 || typeof site.labels !== "string" || !site.grid || !Array.isArray(site.lot?.ring)) return null;
  if (site.labels.length > 2_000_000) return null;
  return {
    site,
    options: cleanOptions(o?.options),
    picked: Array.isArray(o?.picked) ? (o!.picked as unknown[]).filter((x): x is string => typeof x === "string" && x.length < 40).slice(0, 30) : [],
    clientId: typeof o?.clientId === "string" && o.clientId.length < 64 ? o.clientId : null,
    title: typeof o?.title === "string" ? o.title.trim().slice(0, 160) : "",
  };
}

export async function saveLawnDraft(input: { id?: string | null; draft: unknown; lawnSqft?: number | null }): Promise<{ ok: true; id: string; updatedAt: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const draft = cleanDraft(input.draft);
  if (!draft) return { ok: false, error: "There's nothing to save yet." };
  const id = input.id && /^[a-f0-9-]{8,40}$/i.test(input.id) ? input.id : randomUUID();
  const updatedAt = new Date().toISOString();
  const who = await db.user.findUnique({ where: { id: g.userId }, select: { name: true, email: true } }).catch(() => null);
  const body = JSON.stringify({ v: 1, updatedAt, by: who?.name ?? who?.email ?? null, lawnSqft: Number.isFinite(input.lawnSqft) ? Math.round(Number(input.lawnSqft)) : null, draft } satisfies StoredDraft);
  try {
    const key = draftKey(g.organizationId, id);
    const exists = await db.syncState.findUnique({ where: { key }, select: { key: true } });
    if (!exists) {
      const all = await db.syncState.findMany({ where: { key: { startsWith: `${PREFIX}${g.organizationId}:` } }, select: { key: true, cursor: true } });
      if (all.length >= DRAFT_MAX) {
        const oldest = all.map((r) => ({ key: r.key, at: readStored(r.cursor)?.updatedAt ?? "" })).sort((a, b) => a.at.localeCompare(b.at))[0];
        if (oldest) await db.syncState.delete({ where: { key: oldest.key } }).catch(() => {});
      }
    }
    await db.syncState.upsert({ where: { key }, create: { key, cursor: body }, update: { cursor: body } });
    return { ok: true, id, updatedAt };
  } catch (err) {
    logServerError("lawn-save", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The estimate could not be saved — it's still on this page; try again in a moment." };
  }
}

export async function listLawnDrafts(): Promise<{ ok: true; drafts: LawnDraftRow[] } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  try {
    const rows = await db.syncState.findMany({ where: { key: { startsWith: `${PREFIX}${g.organizationId}:` } }, select: { key: true, cursor: true } });
    const drafts = rows
      .map((r) => {
        const s = readStored(r.cursor);
        return s ? { id: r.key.slice(`${PREFIX}${g.organizationId}:`.length), title: s.draft.title || s.draft.site.address, address: s.draft.site.address, updatedAt: s.updatedAt, by: s.by, lawnSqft: s.lawnSqft } : null;
      })
      .filter((d): d is LawnDraftRow => !!d)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { ok: true, drafts };
  } catch (err) {
    logServerError("lawn-list", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "Your lawn estimates could not be listed right now." };
  }
}

export async function loadLawnDraft(id: string): Promise<{ ok: true; id: string; draft: LawnDraft; updatedAt: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!/^[a-f0-9-]{8,40}$/i.test(id)) return { ok: false, error: "That estimate was not found." };
  const row = await db.syncState.findUnique({ where: { key: draftKey(g.organizationId, id) }, select: { cursor: true } }).catch(() => null);
  const s = row ? readStored(row.cursor) : null;
  if (!s) return { ok: false, error: "That estimate was not found." };
  return { ok: true, id, draft: s.draft, updatedAt: s.updatedAt };
}

export async function deleteLawnDraft(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!/^[a-f0-9-]{8,40}$/i.test(id)) return { ok: false, error: "That estimate was not found." };
  await db.syncState.deleteMany({ where: { key: draftKey(g.organizationId, id) } }).catch(() => {});
  return { ok: true };
}

/* ── The company's lawn rates ────────────────────────────────────────────────────────────────────────────────── */

const settingsKey = (org: string) => `lawnsettings:${org}`;

export async function readLawnSettings(): Promise<{ ok: true; settings: LawnSettings; own: boolean } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const row = await db.syncState.findUnique({ where: { key: settingsKey(g.organizationId) }, select: { cursor: true } }).catch(() => null);
  if (!row) return { ok: true, settings: { ...DEFAULT_LAWN_SETTINGS }, own: false };
  try {
    return { ok: true, settings: cleanLawnSettings(JSON.parse(row.cursor)), own: true };
  } catch {
    return { ok: true, settings: { ...DEFAULT_LAWN_SETTINGS }, own: false };
  }
}

export async function saveLawnSettings(raw: unknown): Promise<{ ok: true; settings: LawnSettings } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const settings = cleanLawnSettings(raw);
  try {
    const cursor = JSON.stringify(settings);
    await db.syncState.upsert({ where: { key: settingsKey(g.organizationId) }, create: { key: settingsKey(g.organizationId), cursor }, update: { cursor } });
    return { ok: true, settings };
  } catch (err) {
    logServerError("lawn-settings", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "Your rates could not be saved — try again in a moment." };
  }
}

/* ── Clients ─────────────────────────────────────────────────────────────────────────────────────────────────── */

export type LawnClient = { id: string; name: string; email: string | null; phone: string | null; address: string | null };

export async function findLawnClients(q: string): Promise<{ ok: true; clients: LawnClient[] } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const t = q.trim().slice(0, 80);
  const select = { id: true, name: true, email: true, phone: true, address: true } as const;
  const where = t
    ? { organizationId: g.organizationId, deletedAt: null, OR: [{ name: { contains: t, mode: "insensitive" as const } }, { email: { contains: t, mode: "insensitive" as const } }, { phone: { contains: t } }, { address: { contains: t, mode: "insensitive" as const } }] }
    : { organizationId: g.organizationId, deletedAt: null };
  try {
    const rows = await db.client.findMany({ where, select, orderBy: { updatedAt: "desc" }, take: 8 });
    return { ok: true, clients: rows };
  } catch {
    // SQLite (the stand) has no case-insensitive mode.
    const rows = await db.client.findMany({ where: { organizationId: g.organizationId, deletedAt: null, ...(t ? { OR: [{ name: { contains: t } }, { email: { contains: t } }, { phone: { contains: t } }, { address: { contains: t } }] } : {}) }, select, orderBy: { updatedAt: "desc" }, take: 8 }).catch(() => []);
    return { ok: true, clients: rows };
  }
}

/* ── The proposal ────────────────────────────────────────────────────────────────────────────────────────────── */

const lineSchema = z.object({
  key: z.string().max(40),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(1500).default(""),
  quantity: z.number().min(0).max(1_000_000),
  unit: z.enum(["visit", "application", "sqft", "cu yd", "ea", "ln ft", "lot", "push"]),
  unitPrice: z.number().min(0).max(10_000_000),
  labor: z.number().min(0).max(1),
  taxClass: z.enum(["service", "install"]),
});
const convertSchema = z.object({
  title: z.string().trim().min(1).max(160),
  clientId: z.string().max(64).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  state: z.string().max(4).nullable().optional(),
  scope: z.string().max(6000).default(""),
  lines: z.array(lineSchema).min(1).max(60),
  draftId: z.string().max(64).nullable().optional(),
  site: z.unknown().optional(),
  measures: z.unknown().optional(),
});

const UNIT_TYPE: Record<z.infer<typeof lineSchema>["unit"], string> = { visit: "UNIT", application: "UNIT", "cu yd": "UNIT", ea: "UNIT", push: "UNIT", sqft: "SQFT", "ln ft": "LINEAR_FT", lot: "LUMP_SUM" };
const UNIT_WORD: Record<z.infer<typeof lineSchema>["unit"], string> = { visit: "per visit", application: "per application", "cu yd": "per cubic yard", ea: "each", push: "per snowfall", sqft: "per sq ft", "ln ft": "per linear ft", lot: "" };
const LAWN_SITE_EVENT = "LAWN_SITE";

export async function convertLawnToProposal(raw: unknown): Promise<{ ok: true; id: string } | { ok: false; error: string; code?: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const quota = await checkPlanLimit(g.organizationId, "proposalsCreated");
  if (!quota.allowed) return { ok: false, code: "PLAN_LIMIT_REACHED", error: PLAN_LIMIT_MESSAGE };
  const parsed = convertSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: `The estimate didn't validate — ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? ""}`.trim() };
  const data = parsed.data;
  try {
    const named = data.clientId ? ((await db.client.findFirst({ where: { id: data.clientId, organizationId: g.organizationId, deletedAt: null }, select: { id: true } }))?.id ?? null) : null;
    const filing = await readFilingContext(g.organizationId);
    const clientId = named ?? (await filedClientId(g.organizationId, g.role, filing));
    const projectId = filing?.projectId ?? null;
    const text = leadProposalText(filing?.lead ?? null, data.scope);
    const round2 = (n: number) => Math.round(n * 100) / 100;
    // The estimator's prices are selling prices: the proposal is the ticket, no markup on top.
    const lines = data.lines.map((l, i) => {
      const unitPrice = round2(l.unitPrice);
      const laborCost = round2(unitPrice * l.labor);
      const word = UNIT_WORD[l.unit];
      return { name: word ? `${l.name} (${word})` : l.name, description: l.description || null, measurementType: UNIT_TYPE[l.unit], quantity: l.quantity, unitPrice, materialCost: round2(unitPrice - laborCost), laborCost, total: round2(l.quantity * unitPrice), position: i };
    });
    const subtotal = round2(lines.reduce((a, l) => a + l.total, 0));
    const address = data.address?.trim() || null;
    // Sales tax only on what the state taxes (lawn care, installation, or neither — lib/lawn/tax).
    const org = await db.organization.findUnique({ where: { id: g.organizationId }, select: { defaultTaxRate: true } });
    const rate = stateTaxRate(data.state ?? null) ?? org?.defaultTaxRate ?? 0;
    const taxable = data.lines.reduce((s, l, i) => s + (lawnTaxed(data.state ?? null, l.taxClass) ? lines[i].total : 0), 0);
    const taxTotal = round2(taxable * rate);
    const taxRate = subtotal > 0 ? Math.round((taxTotal / subtotal) * 1e6) / 1e6 : 0;
    const proposal = await db.proposal.create({
      data: {
        trade: "lawn",
        publicId: randomUUID(),
        organizationId: g.organizationId,
        ownerId: g.userId,
        clientId,
        projectId,
        title: data.title,
        scopeOfWork: text.scopeOfWork,
        description: text.overview,
        address,
        status: ProposalStatus.DRAFT,
        subtotal,
        taxRate,
        taxTotal,
        total: round2(subtotal + taxTotal),
        materialMarkupPct: 0,
        laborMarkupPct: 0,
        validUntil: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
        lineItems: { create: lines },
        installments: { create: [{ label: "Season agreement", amount: 100, isPercent: true, position: 0 }] },
      },
    });
    await applyMemberDiscount(proposal.id).catch(() => {});
    // The yard rides along: the lot, the photo it was read from, the classes as left — to open it again.
    try {
      const meta = JSON.stringify({ v: 1, draftId: data.draftId ?? null, site: data.site ?? null, measures: data.measures ?? null });
      if (meta.length < 900_000) await db.activityEvent.create({ data: { organizationId: g.organizationId, actorId: g.userId, proposalId: proposal.id, kind: LAWN_SITE_EVENT, summary: `Measured in the lawn estimator — ${address ?? data.title}`, meta } });
    } catch {
      /* the yard never blocks the proposal */
    }
    await logActivity({ organizationId: g.organizationId, actorId: g.userId, kind: TRAIL_KINDS.ESTIMATE, proposalId: proposal.id, summary: `Priced a lawn — ${address ?? data.title}, $${Math.round(subtotal).toLocaleString("en-US")}`, meta: { trade: "lawn", amount: Math.round(subtotal) } });
    if (filing) await clearFilingContext();
    if (projectId) revalidatePath(`/dashboard/projects/${projectId}`);
    revalidatePath("/dashboard/proposals");
    return { ok: true, id: proposal.id };
  } catch (err) {
    logServerError("lawn-convert", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The proposal could not be saved. Try again in a moment." };
  }
}
