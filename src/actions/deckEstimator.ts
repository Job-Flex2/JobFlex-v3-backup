"use server";
// THE DECK STUDIO'S SERVER HALF (2026-10-04). The engine is pure and runs in
// the browser (lib/deck); the server keeps two things for it:
//
//   · the shop's own deck prices — a sparse book (lib/deck/rates) kept in
//     SyncState under `deckbook:<orgId>`, like the ad names on the traffic
//     page: no table of its own, so nothing has to be pushed to production
//     by hand before this ships;
//   · the proposal — the deck's priced lines written the way the fence
//     estimator writes its own (actions/fenceEstimator), and the deck itself
//     (design + frozen 3D) kept beside it as an ActivityEvent DECK_PLAN for
//     the client's page;
//   · the photo of the house (M2, 2026-10-10) — put in the private file
//     store; only its URL rides in the design.
//
// Both are for admins while the estimator is marked Coming soon (lib/deck/access),
// the same rule the page applies.
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { NoOrgError, UnauthorizedError, requireEstimatorOrManager } from "@/lib/orgContext";
import { canUseDeckEstimator } from "@/lib/deck/access";
import { checkPlanLimit } from "@/lib/limitsEngine";
import { PLAN_LIMIT_MESSAGE, type LimitKey } from "@/lib/planLimits";
import { ProposalStatus } from "@/lib/prismaEnums";
import { clearFilingContext, filedClientId, leadProposalText, readFilingContext } from "@/lib/filingContext";
import { stateFromAddress, stateTaxRate } from "@/lib/pricing/salesTax";
import { applyMemberDiscount } from "@/lib/servicePlanBook";
import { recordInventoryLink } from "@/lib/inventoryPick";
import { logServerError } from "@/lib/server-events";
import { runVisionJson } from "@/lib/sdk/openaiVision";
import { friendlyAIError, isOpenAIEnabled } from "@/lib/sdk/openai";
import { parseWallRead, WALL_READ_PROMPT, type WallRead } from "@/lib/deck/photoFit";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { sanitizeDeckRateBook, type DeckRateBook } from "@/lib/deck/rates";
import { deckBookKey as bookKey } from "@/lib/deck/rateBookStore";
import { DECK_PLAN_EVENT, DECK_PLAN_VERSION, deckConvertSchema, firstIssue, type DeckConvertInput } from "@/lib/deck/convertSchema";
import { putPrivate } from "@/lib/media/privateStore";
import { mediaHref } from "@/lib/media/signedLink";
import { normalizeDeckDesign, structureWords, type DeckDesign } from "@/lib/deck/design";
import { fitGround } from "@/lib/deck/site";
import { geocode, isMapsEnabled } from "@/lib/maps";
import { in3depCoverage, sample3depElevations } from "@/lib/elevation3dep";

type Gate = { ok: true; organizationId: string; userId: string; role: string } | { ok: false; error: string };

async function gate(): Promise<Gate> {
  try {
    const ctx = await requireEstimatorOrManager();
    if (!(await canUseDeckEstimator(ctx.user))) return { ok: false, error: "The deck estimator is coming soon — it is open to admins for testing only." };
    return { ok: true, organizationId: ctx.organizationId, userId: ctx.user.id, role: ctx.role };
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, error: "Only an estimator, a manager or the owner can do this." };
    if (err instanceof NoOrgError) return { ok: false, error: "Sign in to an organization first." };
    throw err;
  }
}

/** Save the shop's deck prices. Only what differs from the examples is kept; a blank row goes back to the example. */
export async function saveDeckRateBook(raw: unknown): Promise<{ ok: true; book: DeckRateBook } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const book = sanitizeDeckRateBook(raw);
  try {
    if (Object.keys(book).length === 0) await db.syncState.deleteMany({ where: { key: bookKey(g.organizationId) } });
    else await db.syncState.upsert({ where: { key: bookKey(g.organizationId) }, create: { key: bookKey(g.organizationId), cursor: JSON.stringify(book) }, update: { cursor: JSON.stringify(book) } });
    return { ok: true, book };
  } catch (err) {
    logServerError("deck-rates", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "Your prices could not be saved. Try again in a moment." };
  }
}

/* ── The photo of the house (M2, 2026-10-10) ───────────────────────── */

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
/** The studio shrinks a photo to about 1,600 px before sending it; this is the ceiling, not the aim. */
const PHOTO_MAX_BYTES = 6 * 1024 * 1024;

export type DeckPhotoResult = { ok: true; url: string; href: string; w: number; h: number } | { ok: false; error: string };

/**
 * A photo of the back of the house, kept in the PRIVATE file store under
 * the shop's own folder (`deck-photos/<orgId>/…`, lib/media/privateStore).
 * Back come the stored URL — kept in the design, and so with the proposal's
 * DECK_PLAN — and a 15-minute read link for the studio to show it with.
 */
export async function uploadDeckPhoto(form: FormData): Promise<DeckPhotoResult> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No picture was sent." };
  if (!PHOTO_TYPES.has(file.type)) return { ok: false, error: "Use a JPEG, PNG or WebP picture." };
  if (file.size > PHOTO_MAX_BYTES) return { ok: false, error: "That picture is too big — the studio should have shrunk it. Try again." };
  const w = Math.round(Number(form.get("w")));
  const h = Math.round(Number(form.get("h")));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 16 || h < 16 || w > 20000 || h > 20000) return { ok: false, error: "The picture's size could not be read." };
  try {
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const body = Buffer.from(await file.arrayBuffer());
    const stored = await putPrivate(`deck-photos/${g.organizationId}/${randomUUID()}.${ext}`, body, file.type);
    const href = mediaHref(stored.url) ?? stored.url;
    return { ok: true, url: stored.url, href, w, h };
  } catch (err) {
    logServerError("deck-photo", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The picture could not be saved. Try again in a moment." };
  }
}

export type DeckPhotoRead = { ok: true; read: WallRead } | { ok: false; error: string; configured: boolean };

/**
 * THE SMART FIT'S READ (2026-10-10): the vision model looks at the picture
 * once and says where the wall meets the ground, its eave, any jog, the
 * back door, the windows and any black bars (lib/deck/photoFit
 * WALL_READ_PROMPT). The studio does the arithmetic — scale, crop,
 * placement — in the browser from this read, so nothing is stored here but
 * what the design keeps. Owner: "the deck should find by itself where it's
 * supposed to be, that wall on the picture."
 */
export async function readDeckPhoto(form: FormData): Promise<DeckPhotoRead> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error, configured: true };
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No picture was sent.", configured: true };
  if (!PHOTO_TYPES.has(file.type)) return { ok: false, error: "Use a JPEG, PNG or WebP picture.", configured: true };
  if (file.size > PHOTO_MAX_BYTES) return { ok: false, error: "That picture is too big — the studio should have shrunk it. Try again.", configured: true };
  if (!isOpenAIEnabled()) return { ok: false, error: "Reading the picture needs the AI key on the server — drag the outline to the wall instead.", configured: false };
  try {
    const dataUrl = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
    const raw = await runVisionJson<unknown>({ systemPrompt: WALL_READ_PROMPT, userPrompt: "Read this photo of the house and answer with the JSON.", imageUrl: dataUrl, detail: "high" });
    const read = parseWallRead(raw);
    if (!read) return { ok: false, error: "The wall could not be found in that picture — drag the outline to it, or take the picture square on from the yard.", configured: true };
    return { ok: true, read };
  } catch (err) {
    logServerError("deck-photo-read", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: friendlyAIError(err, "deck-photo-read"), configured: true };
  }
}

/** A fresh read link for a photo the design already holds (the stored URL never goes to the browser as is). */
export async function deckPhotoHref(url: string): Promise<string | null> {
  const g = await gate();
  if (!g.ok) return null;
  if (typeof url !== "string" || !url.includes(`deck-photos/${g.organizationId}/`)) return null;
  return mediaHref(url);
}

/** The result of a convert: a failure is RETURNED, never thrown (a thrown message is redacted in production). */
export type DeckConvertResult =
  | { ok: true; id: string }
  | { ok: false; code: "PLAN_LIMIT_REACHED"; error: string; resource?: LimitKey }
  | { ok: false; code: "FORBIDDEN" | "INVALID" | "FAILED"; error: string };

export async function convertDeckEstimateToProposal(raw: unknown): Promise<DeckConvertResult> {
  const g = await gate();
  if (!g.ok) return { ok: false, code: "FORBIDDEN", error: g.error };
  const quota = await checkPlanLimit(g.organizationId, "proposalsCreated");
  if (!quota.allowed) return { ok: false, code: "PLAN_LIMIT_REACHED", error: PLAN_LIMIT_MESSAGE, resource: quota.cappedBy ?? "proposalsCreated" };
  const parsed = deckConvertSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID", error: firstIssue(parsed.error) };
  try {
    return { ok: true, id: await writeProposal(g.organizationId, g.userId, g.role, parsed.data) };
  } catch (err) {
    logServerError("deck-convert", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, code: "FAILED", error: "The proposal could not be saved. Try again in a moment; if it keeps failing, tell support the time it happened." };
  }
}

const unitToType = (unit: string | undefined) => (unit === "sqft" ? "SQFT" : unit === "ln ft" ? "LINEAR_FT" : unit === "lot" ? "LUMP_SUM" : "UNIT");
const round2 = (n: number) => Math.round(n * 100) / 100;

async function writeProposal(organizationId: string, userId: string, role: string, data: DeckConvertInput): Promise<string> {
  // A client id from the browser must belong to this org.
  const named = data.clientId ? ((await db.client.findFirst({ where: { id: data.clientId, organizationId }, select: { id: true } }))?.id ?? null) : null;
  // Started from a project, a client or a lead, the picker recorded where this estimate files (lib/filingContext).
  const filing = await readFilingContext(organizationId);
  const clientId = named ?? (await filedClientId(organizationId, role, filing));
  const projectId = filing?.projectId ?? null;
  const text = leadProposalText(filing?.lead ?? null, data.scope ?? "");

  // The studio's prices are SELLING prices (owner, 2026-10-01): the proposal
  // is the ticket to the cent, with no markup on top.
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { defaultTaxRate: true } });
  const lines = data.lines.map((l, i) => {
    const unitPrice = round2(l.materialCost + l.laborCost);
    return { name: l.name, description: l.description, measurementType: unitToType(l.unit), quantity: l.quantity, unitPrice, materialCost: l.materialCost, laborCost: round2(unitPrice - l.materialCost), total: l.quantity * unitPrice, position: i };
  });
  const subtotal = lines.reduce((a, l) => a + l.total, 0);
  const address = data.address?.trim() || null;
  const taxRate = stateTaxRate(stateFromAddress(address)) ?? org?.defaultTaxRate ?? 0;
  const taxTotal = subtotal * taxRate;

  const proposal = await db.proposal.create({
    data: {
      trade: "deck",
      publicId: randomUUID(),
      organizationId,
      ownerId: userId,
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
      total: subtotal + taxTotal,
      materialMarkupPct: 0,
      laborMarkupPct: 0,
      validUntil: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
      lineItems: { create: lines },
      installments: {
        create: [
          { label: "Deposit", amount: 30, isPercent: true, position: 0 },
          { label: "Completion", amount: 70, isPercent: true, position: 1 },
        ],
      },
    },
  });
  await applyMemberDiscount(proposal.id).catch(() => {});
  await recordInventoryLink(organizationId, proposal.id, data.inventoryLinked, userId);
  // The deck rides with the proposal: the design (to open it again) and the frozen 3D (for the client's page).
  if (data.plan) {
    try {
      const plan: { v: number; design: typeof data.plan.design; scene: typeof data.plan.scene; address: string | null } = { v: DECK_PLAN_VERSION, design: data.plan.design, scene: data.plan.scene, address };
      // A photo from another shop's folder never rides along.
      if (plan.design.photo && !plan.design.photo.url.includes(`deck-photos/${organizationId}/`) && !plan.design.photo.url.startsWith("data:")) plan.design = { ...plan.design, photo: null };
      await db.activityEvent.create({ data: { organizationId, actorId: userId, proposalId: proposal.id, kind: DECK_PLAN_EVENT, summary: `Deck designed for the proposal — ${data.plan.scene.facts}`, meta: JSON.stringify(plan) } });
    } catch {
      /* the picture never blocks the proposal */
    }
  }
  await logActivity({ organizationId, actorId: userId, kind: TRAIL_KINDS.ESTIMATE, proposalId: proposal.id, summary: `Priced a deck — ${data.plan?.scene.facts ?? data.title}, $${Math.round(subtotal).toLocaleString("en-US")}`, meta: { trade: "deck", amount: Math.round(subtotal) } });
  if (filing) await clearFilingContext();
  if (projectId) revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/dashboard/proposals");
  return proposal.id;
}


/* ── Drafts: save the work in progress, open it later (M3, 2026-10-10) ───── */
//
// Owner: "when building and want to finish later — save or auto save, open
// later and finish." A draft is the design and the address under a SyncState
// row `deckdraft:<orgId>:<id>` (no table of its own, like the price book):
// the studio auto-saves a few seconds after a change, lists the shop's drafts,
// reopens one by `?draft=<id>`, and can also reopen the deck a saved proposal
// carries (its DECK_PLAN).

const DRAFT_PREFIX = "deckdraft:";
const DRAFT_MAX = 60;
const draftKey = (organizationId: string, id: string) => `${DRAFT_PREFIX}${organizationId}:${id}`;

export interface DeckDraftRow {
  id: string;
  title: string;
  address: string | null;
  updatedAt: string;
  by: string | null;
}
export interface DeckDraft extends DeckDraftRow {
  design: DeckDesign;
}

function readDraft(id: string, cursor: string): DeckDraft | null {
  try {
    const raw = JSON.parse(cursor) as Record<string, unknown>;
    const design = normalizeDeckDesign(raw.design);
    return { id, title: typeof raw.title === "string" ? raw.title.slice(0, 120) : structureWords(design), address: typeof raw.address === "string" ? raw.address.slice(0, 300) : null, updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(), by: typeof raw.by === "string" ? raw.by : null, design };
  } catch {
    return null;
  }
}

export type DraftSaveResult = { ok: true; id: string; updatedAt: string } | { ok: false; error: string };

/** Save (or re-save) a draft. A new draft gets an id; the caller keeps it for the next save. */
export async function saveDeckDraft(input: { id?: string | null; title?: string | null; design: unknown; address?: string | null }): Promise<DraftSaveResult> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  const id = input.id && /^[a-f0-9-]{8,40}$/i.test(input.id) ? input.id : randomUUID();
  const design = normalizeDeckDesign(input.design);
  const updatedAt = new Date().toISOString();
  const title = (input.title?.trim() || structureWords(design)).slice(0, 120);
  const address = input.address?.trim().slice(0, 300) || null;
  const who = await db.user.findUnique({ where: { id: g.userId }, select: { name: true, email: true } }).catch(() => null);
  const body = JSON.stringify({ v: 1, title, address, updatedAt, by: who?.name ?? who?.email ?? null, design });
  try {
    // A shop keeps at most DRAFT_MAX drafts: the oldest goes when a new one arrives.
    const key = draftKey(g.organizationId, id);
    const exists = await db.syncState.findUnique({ where: { key }, select: { key: true } });
    if (!exists) {
      const all = await db.syncState.findMany({ where: { key: { startsWith: `${DRAFT_PREFIX}${g.organizationId}:` } }, select: { key: true, cursor: true } });
      if (all.length >= DRAFT_MAX) {
        const oldest = all.map((r) => ({ key: r.key, at: readDraft(r.key, r.cursor)?.updatedAt ?? "" })).sort((a, b) => a.at.localeCompare(b.at))[0];
        if (oldest) await db.syncState.delete({ where: { key: oldest.key } }).catch(() => {});
      }
    }
    await db.syncState.upsert({ where: { key }, create: { key, cursor: body }, update: { cursor: body } });
    return { ok: true, id, updatedAt };
  } catch (err) {
    logServerError("deck-draft-save", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The draft could not be saved. It is still here on this page; try again in a moment." };
  }
}

/** The shop's drafts, newest first. */
export async function listDeckDrafts(): Promise<{ ok: true; drafts: DeckDraftRow[] } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  try {
    const rows = await db.syncState.findMany({ where: { key: { startsWith: `${DRAFT_PREFIX}${g.organizationId}:` } }, select: { key: true, cursor: true } });
    const drafts = rows
      .map((r) => readDraft(r.key.slice(`${DRAFT_PREFIX}${g.organizationId}:`.length), r.cursor))
      .filter((d): d is DeckDraft => !!d)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ id, title, address, updatedAt, by }) => ({ id, title, address, updatedAt, by }));
    return { ok: true, drafts };
  } catch (err) {
    logServerError("deck-draft-list", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The drafts could not be read." };
  }
}

export async function loadDeckDraft(id: string): Promise<{ ok: true; draft: DeckDraft } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  if (!/^[a-f0-9-]{8,40}$/i.test(id)) return { ok: false, error: "No such draft." };
  const row = await db.syncState.findUnique({ where: { key: draftKey(g.organizationId, id) }, select: { cursor: true } }).catch(() => null);
  const draft = row ? readDraft(id, row.cursor) : null;
  return draft ? { ok: true, draft } : { ok: false, error: "That draft is gone." };
}

export async function deleteDeckDraft(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  if (!/^[a-f0-9-]{8,40}$/i.test(id)) return { ok: false, error: "No such draft." };
  await db.syncState.deleteMany({ where: { key: draftKey(g.organizationId, id) } }).catch(() => {});
  return { ok: true };
}

/** The deck a saved proposal carries (its DECK_PLAN), to open it again in the studio. */
export async function loadDeckFromProposal(proposalId: string): Promise<{ ok: true; design: DeckDesign; address: string | null; title: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  const proposal = await db.proposal.findFirst({ where: { id: proposalId, organizationId: g.organizationId }, select: { id: true, title: true, address: true } }).catch(() => null);
  if (!proposal) return { ok: false, error: "No such proposal." };
  try {
    const ev = await db.activityEvent.findFirst({ where: { proposalId: proposal.id, kind: DECK_PLAN_EVENT }, orderBy: { createdAt: "desc" }, select: { meta: true } });
    const raw = ev?.meta ? (JSON.parse(ev.meta) as Record<string, unknown>) : null;
    if (!raw) return { ok: false, error: "That proposal has no deck design saved with it." };
    const design = normalizeDeckDesign(raw.design);
    // A photo from another shop's folder never comes along.
    if (design.photo && !design.photo.url.includes(`deck-photos/${g.organizationId}/`) && !design.photo.url.startsWith("data:")) design.photo = null;
    return { ok: true, design, address: proposal.address ?? (typeof raw.address === "string" ? raw.address : null), title: proposal.title };
  } catch {
    return { ok: false, error: "The saved deck could not be read." };
  }
}

/* ── The site from the address: where the ground falls (M3, 2026-10-10) ──── */
//
// The address is geocoded (Google), then USGS lidar (lib/elevation3dep) is
// read on a ring of points around the house, and a plane fitted: back come
// the grade and the direction the ground falls. The studio turns that into
// inches of fall across the deck for the contractor to confirm — nobody can
// tell from an address which wall the deck is on. No Google elevation call:
// where the lidar has a gap the answer is "not read", not a guess.

export type DeckSiteResult = { ok: true; lat: number; lng: number; gradePct: number; downhillDeg: number; resM: number } | { ok: false; error: string };

export async function readDeckSite(address: string): Promise<DeckSiteResult> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  const text = (address ?? "").trim().slice(0, 300);
  if (text.length < 8) return { ok: false, error: "Type the job's street address first." };
  if (!isMapsEnabled()) return { ok: false, error: "The map key is not set on this server, so the ground cannot be read. Type the fall by hand." };
  let at: { lat: number; lng: number } | null;
  try {
    at = await geocode(text);
  } catch (err) {
    logServerError("deck-site-geocode", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The address could not be found on the map." };
  }
  if (!at) return { ok: false, error: "The address could not be found on the map." };
  if (!in3depCoverage(at)) return { ok: false, error: "No lidar coverage here — type the ground's fall by hand." };
  // A ring of eight points 30 ft out and four 60 ft out, plus the centre.
  const FT_PER_DEG_LAT = 364000;
  const ftPerDegLng = FT_PER_DEG_LAT * Math.cos((at.lat * Math.PI) / 180);
  const samples: Array<{ eastFt: number; northFt: number }> = [{ eastFt: 0, northFt: 0 }];
  for (let k = 0; k < 8; k++) samples.push({ eastFt: 30 * Math.cos((k * Math.PI) / 4), northFt: 30 * Math.sin((k * Math.PI) / 4) });
  for (let k = 0; k < 4; k++) samples.push({ eastFt: 60 * Math.cos((k * Math.PI) / 2 + Math.PI / 4), northFt: 60 * Math.sin((k * Math.PI) / 2 + Math.PI / 4) });
  const points = samples.map((s) => ({ lat: at!.lat + s.northFt / FT_PER_DEG_LAT, lng: at!.lng + s.eastFt / ftPerDegLng }));
  try {
    const res = await sample3depElevations(points);
    if (!res.ok) return { ok: false, error: res.reason === "gap" ? "The lidar has a gap here — type the ground's fall by hand." : "The elevation service did not answer; try again in a moment." };
    const fit = fitGround(samples.map((s, i) => ({ ...s, heightFt: res.elevFt[i] })));
    if (!fit) return { ok: false, error: "The ground around the house could not be read." };
    return { ok: true, lat: at.lat, lng: at.lng, gradePct: fit.gradePct, downhillDeg: fit.downhillDeg, resM: res.resM };
  } catch (err) {
    logServerError("deck-site-lidar", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The elevation service did not answer; try again in a moment." };
  }
}
