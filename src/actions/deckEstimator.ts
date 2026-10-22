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
import { NoOrgError, UnauthorizedError, isEstimatorRole, isSalesRole, requireEstimatorOrManager } from "@/lib/orgContext";
import { deckStudioAccess } from "@/lib/deck/access";
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
import { DECK_PLAN_EVENT, DECK_PLAN_VERSION, deckConvertSchema, deckUpdateSchema, firstIssue, type DeckConvertInput } from "@/lib/deck/convertSchema";
import { DECK_LOCK_WORDS, deckProposalLock, deckProposalSeen, readDeckWritten, type DeckProposalLock, type DeckWritten, type LinkedDeckProposal } from "@/lib/deck/proposalEdit";
import { deckUpdatePayload } from "@/lib/deck/proposalUpdate";
import { clientLinkOfDraft, clientOfLink, markClientLinkSeen, tieClientLinkToProposal } from "@/lib/deck/clientLinksServer";
import { findClientForLead } from "@/lib/leadClient";
import { CLIENT_TOKEN_RE, linkTitle } from "@/lib/deck/clientDesign";
import { saveProposal } from "@/actions/proposals";
import { proposalRef } from "@/components/v3/manual-card-lab/manual-blueprint/manual-blueprint-bridge";
import { isPrivateFileUnder, putPrivate } from "@/lib/media/privateStore";
import { mediaHref } from "@/lib/media/signedLink";
import { normalizeDeckDesign, structureWords, type DeckDesign } from "@/lib/deck/design";
import { fitGround } from "@/lib/deck/site";
import { geocode, isMapsEnabled } from "@/lib/maps";
import { appBaseUrl } from "@/lib/appUrl";
import { in3depCoverage, sample3depElevations } from "@/lib/elevation3dep";

type Gate = { ok: true; organizationId: string; userId: string; role: string } | { ok: false; error: string };

/** "design": the studio's preview is enough (lib/deck/access) — reading the house, the site, the drafts already
 *  there; "full" (the default): every save, send and print — the Deck Studio itself. */
async function gate(need: "full" | "design" = "full"): Promise<Gate> {
  try {
    const ctx = await requireEstimatorOrManager();
    const level = await deckStudioAccess(ctx.user, ctx.organizationId);
    if (level === "none") return { ok: false, error: "Deck Studio isn't open yet." };
    if (level === "preview" && need === "full") return { ok: false, error: "Saving, sending and printing are part of Deck Studio — add it to your plan ($49/mo) from the Deck estimator." };
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
  const g = await gate("design");
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
  const g = await gate("design");
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

/** The shop's own photo: a private file whose path BEGINS with its folder
 *  (never "contains" — a query string could carry the folder name past a
 *  substring test, security audit 1.2), or an inline picture. */
function ownDeckPhoto(url: unknown, organizationId: string): boolean {
  if (typeof url !== "string") return false;
  return isPrivateFileUnder(url, `deck-photos/${organizationId}/`) || /^data:image\//i.test(url);
}

/** A fresh read link for a photo the design already holds (the stored URL never goes to the browser as is). */
export async function deckPhotoHref(url: string): Promise<string | null> {
  const g = await gate("design");
  if (!g.ok) return null;
  if (typeof url !== "string" || !isPrivateFileUnder(url, `deck-photos/${g.organizationId}/`)) return null;
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

/** A design the client sent back through their link is THEIR job (2026-10-17 audit: four priced client designs
 *  sat "Unassigned" though the link carried the client's name and phone). The link's own client record when it
 *  was made from one; else the client with that email or phone; else a new client from what the contractor typed
 *  on the link — within the plan's client cap (over the cap it stays unassigned, as before). Never throws. */
async function clientFromDesignLink(organizationId: string, userId: string, token: string | null | undefined, title: string): Promise<string | null> {
  try {
    const c = await clientOfLink(token, organizationId);
    if (!c) return null;
    if (c.clientId) {
      const own = await db.client.findFirst({ where: { id: c.clientId, organizationId, deletedAt: null }, select: { id: true } });
      if (own) return own.id;
    }
    const known = c.clientEmail || c.clientPhone ? await findClientForLead(organizationId, { email: c.clientEmail, phone: c.clientPhone }) : null;
    if (known) return known.id;
    const name = c.clientName.trim();
    if (!name) return null;
    // A link with only a name: the client already on file by that exact name — when there is just the one.
    if (!c.clientEmail && !c.clientPhone) {
      const same = (await db.client.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, name: true }, take: 5000 })).filter((x) => x.name.trim().toLowerCase() === name.toLowerCase());
      if (same.length === 1) return same[0].id;
    }
    const cap = await checkPlanLimit(organizationId, "clients");
    if (!cap.allowed) return null;
    const made = await db.client.create({
      data: { organizationId, name, email: c.clientEmail?.trim() || null, phone: c.clientPhone?.trim() || null, address: c.address?.trim() || null },
      select: { id: true, name: true },
    });
    await logActivity({ organizationId, actorId: userId, kind: TRAIL_KINDS.CLIENT, clientId: made.id, summary: `Added client ${made.name} from their deck design ("${title}")`, meta: { from: "deck-client-design" } });
    return made.id;
  } catch {
    return null;
  }
}

async function writeProposal(organizationId: string, userId: string, role: string, data: DeckConvertInput): Promise<string> {
  // A client id from the browser must belong to this org.
  const named = data.clientId ? ((await db.client.findFirst({ where: { id: data.clientId, organizationId }, select: { id: true } }))?.id ?? null) : null;
  // Started from a project, a client or a lead, the picker recorded where this estimate files (lib/filingContext).
  const filing = await readFilingContext(organizationId);
  const clientId = named ?? (await filedClientId(organizationId, role, filing)) ?? (await clientFromDesignLink(organizationId, userId, data.clientToken, data.title));
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
      // `written`: what the studio put on the proposal, so an update from the studio knows its own lines (lib/deck/proposalEdit).
      const written: DeckWritten = { title: data.title, scope: text.scopeOfWork, lines: lines.map((l) => l.name.trim()) };
      const plan: { v: number; design: typeof data.plan.design; scene: typeof data.plan.scene; address: string | null; written: DeckWritten } = { v: DECK_PLAN_VERSION, design: data.plan.design, scene: data.plan.scene, address, written };
      // A photo from another shop's folder never rides along.
      if (plan.design.photo && !ownDeckPhoto(plan.design.photo.url, organizationId)) plan.design = { ...plan.design, photo: null };
      await db.activityEvent.create({ data: { organizationId, actorId: userId, proposalId: proposal.id, kind: DECK_PLAN_EVENT, summary: `Deck designed for the proposal — ${data.plan.scene.facts}`, meta: JSON.stringify(plan) } });
    } catch {
      /* the picture never blocks the proposal */
    }
  }
  await logActivity({ organizationId, actorId: userId, kind: TRAIL_KINDS.ESTIMATE, proposalId: proposal.id, summary: `Priced a deck — ${data.plan?.scene.facts ?? data.title}, $${Math.round(subtotal).toLocaleString("en-US")}`, meta: { trade: "deck", amount: Math.round(subtotal) } });
  // A design that came back through a client's link: the link now belongs to this proposal (2026-10-13).
  await tieClientLinkToProposal(data.clientToken, organizationId, proposal.id);
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
  /** Opened from a proposal: the draft keeps updating that one (2026-10-12). */
  proposalId: string | null;
  /** Came back through a client's design link (2026-10-13): the token, and the client's name for the list. */
  clientToken: string | null;
  fromClient: string | null;
}
export interface DeckDraft extends DeckDraftRow {
  design: DeckDesign;
}

function readDraft(id: string, cursor: string): DeckDraft | null {
  try {
    const raw = JSON.parse(cursor) as Record<string, unknown>;
    const design = normalizeDeckDesign(raw.design);
    const proposalId = typeof raw.proposalId === "string" && /^[\w-]{1,64}$/.test(raw.proposalId) ? raw.proposalId : null;
    const clientToken = typeof raw.clientToken === "string" && CLIENT_TOKEN_RE.test(raw.clientToken) ? raw.clientToken : null;
    const by = typeof raw.by === "string" ? raw.by : null;
    // The returned draft is saved "by Jane Smith (client)" (actions/deckClientDesign).
    const fromClient = clientToken && by ? by.replace(/\s*\(client\)\s*$/i, "") || null : null;
    return { id, title: typeof raw.title === "string" ? raw.title.slice(0, 120) : structureWords(design), address: typeof raw.address === "string" ? raw.address.slice(0, 300) : null, updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(), by, proposalId, clientToken, fromClient, design };
  } catch {
    return null;
  }
}

export type DraftSaveResult = { ok: true; id: string; updatedAt: string } | { ok: false; error: string };

/** Save (or re-save) a draft. A new draft gets an id; the caller keeps it for the next save. */
export async function saveDeckDraft(input: { id?: string | null; title?: string | null; design: unknown; address?: string | null; proposalId?: string | null; clientToken?: string | null }): Promise<DraftSaveResult> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  const id = input.id && /^[a-f0-9-]{8,40}$/i.test(input.id) ? input.id : randomUUID();
  const design = normalizeDeckDesign(input.design);
  const updatedAt = new Date().toISOString();
  const title = (input.title?.trim() || structureWords(design)).slice(0, 120);
  const address = input.address?.trim().slice(0, 300) || null;
  const who = await db.user.findUnique({ where: { id: g.userId }, select: { name: true, email: true } }).catch(() => null);
  const proposalId = typeof input.proposalId === "string" && /^[\w-]{1,64}$/.test(input.proposalId) ? input.proposalId : null;
  const clientToken = typeof input.clientToken === "string" && CLIENT_TOKEN_RE.test(input.clientToken) ? input.clientToken : null;
  // A returned design the contractor keeps working on stays the client's in the list ("Jane Smith (client)"), with its link.
  const prior = clientToken ? await db.syncState.findUnique({ where: { key: draftKey(g.organizationId, id) }, select: { cursor: true } }).then((r) => (r ? readDraft(id, r.cursor) : null)).catch(() => null) : null;
  const body = JSON.stringify({ v: 1, title, address, updatedAt, by: prior?.clientToken === clientToken && prior?.by ? prior.by : (who?.name ?? who?.email ?? null), proposalId, clientToken, design });
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
  const g = await gate("design");
  if (!g.ok) return { ok: false, error: g.error };
  try {
    const rows = await db.syncState.findMany({ where: { key: { startsWith: `${DRAFT_PREFIX}${g.organizationId}:` } }, select: { key: true, cursor: true } });
    const drafts = rows
      .map((r) => readDraft(r.key.slice(`${DRAFT_PREFIX}${g.organizationId}:`.length), r.cursor))
      .filter((d): d is DeckDraft => !!d)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ id, title, address, updatedAt, by, proposalId, clientToken, fromClient }) => ({ id, title, address, updatedAt, by, proposalId, clientToken, fromClient }));
    return { ok: true, drafts };
  } catch (err) {
    logServerError("deck-draft-list", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The drafts could not be read." };
  }
}

/** What the client sent with their design, shown over the returned draft (2026-10-13). */
export interface ReturnedClientDesign {
  token: string;
  name: string;
  phone: string | null;
  note: string;
  unsure: string[];
  sentAt: string | null;
  sends: number;
  url: string;
  /** The job as the link named it: the contractor's title for it, and the address. */
  address: string | null;
  title: string;
}

export async function loadDeckDraft(id: string): Promise<{ ok: true; draft: DeckDraft; proposal: LinkedDeckProposal | null; client: ReturnedClientDesign | null } | { ok: false; error: string }> {
  const g = await gate("design");
  if (!g.ok) return { ok: false, error: g.error };
  if (!/^[a-f0-9-]{8,40}$/i.test(id)) return { ok: false, error: "No such draft." };
  const row = await db.syncState.findUnique({ where: { key: draftKey(g.organizationId, id) }, select: { cursor: true } }).catch(() => null);
  const draft = row ? readDraft(id, row.cursor) : null;
  if (!draft) return { ok: false, error: "That draft is gone." };
  // A returned design: opening it is seeing it — it stops blooming — and the client's words come along. A draft
  // that came back before the token was written on it (before 2026-10-13) is found by its own id, and the token
  // written on it now, so the next open is direct.
  let client: ReturnedClientDesign | null = null;
  let token = draft.clientToken;
  if (!token) {
    const old = await clientLinkOfDraft(id, g.organizationId);
    if (old) {
      token = old.token;
      draft.clientToken = token;
      if (row) {
        try {
          const body = JSON.parse(row.cursor) as Record<string, unknown>;
          await db.syncState.update({ where: { key: draftKey(g.organizationId, id) }, data: { cursor: JSON.stringify({ ...body, clientToken: token, proposalId: body.proposalId ?? old.proposalId ?? null }) } });
        } catch {
          /* next time */
        }
      }
    }
  }
  if (token) {
    const link = await markClientLinkSeen(token, g.organizationId);
    if (link) client = { token: link.token, name: link.clientName, phone: link.clientPhone, note: link.note, unsure: link.unsure, sentAt: link.sentAt, sends: link.sends, url: `${(await appBaseUrl()).replace(/\/$/, "")}/deck-design/${link.token}`, address: link.address, title: linkTitle(link) };
  }
  // A draft opened from a proposal goes on updating it, while the proposal is there.
  const proposalId = draft.proposalId ?? (client ? (await db.syncState.findUnique({ where: { key: `deckclient:${client.token}` }, select: { cursor: true } }).then((r) => (r ? (JSON.parse(r.cursor) as { proposalId?: unknown }).proposalId : null)).catch(() => null)) : null);
  return { ok: true, draft, proposal: typeof proposalId === "string" && proposalId ? await linkedProposal(g, proposalId) : null, client };
}

export async function deleteDeckDraft(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  // A preview keeps its saved decks as they are (owner, 2026-10-20): deleting one is Deck Studio's.
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  if (!/^[a-f0-9-]{8,40}$/i.test(id)) return { ok: false, error: "No such draft." };
  await db.syncState.deleteMany({ where: { key: draftKey(g.organizationId, id) } }).catch(() => {});
  return { ok: true };
}

/** The proposal the studio works on, as the studio shows it; null when it is gone or another shop's. */
async function linkedProposal(g: { organizationId: string; userId: string; role: string }, proposalId: string): Promise<LinkedDeckProposal | null> {
  const p = await db.proposal
    .findFirst({ where: { id: proposalId, organizationId: g.organizationId }, select: { id: true, publicId: true, title: true, status: true, ownerId: true, installments: { select: { status: true, paidAmount: true } } } })
    .catch(() => null);
  if (!p) return null;
  // An estimator or a salesperson changes their own proposals only (requireProposalStaff).
  const theirs = (isSalesRole(g.role) || isEstimatorRole(g.role)) && p.ownerId !== g.userId;
  return { id: p.id, ref: proposalRef(p.publicId), title: p.title, status: p.status, lock: deckProposalLock(p.status, p.installments) ?? (theirs ? "theirs" : null), seen: deckProposalSeen(p.status) };
}

/** The deck a saved proposal carries (its DECK_PLAN), to open it again in the studio. */
export async function loadDeckFromProposal(proposalId: string): Promise<{ ok: true; design: DeckDesign; address: string | null; title: string; proposal: LinkedDeckProposal } | { ok: false; error: string }> {
  const g = await gate("design");
  if (!g.ok) return { ok: false, error: g.error };
  const proposal = await db.proposal.findFirst({ where: { id: proposalId, organizationId: g.organizationId }, select: { id: true, title: true, address: true } }).catch(() => null);
  if (!proposal) return { ok: false, error: "No such proposal." };
  const linked = await linkedProposal(g, proposal.id);
  if (!linked) return { ok: false, error: "No such proposal." };
  try {
    const ev = await db.activityEvent.findFirst({ where: { proposalId: proposal.id, kind: DECK_PLAN_EVENT }, orderBy: { createdAt: "desc" }, select: { meta: true } });
    const raw = ev?.meta ? (JSON.parse(ev.meta) as Record<string, unknown>) : null;
    if (!raw) return { ok: false, error: "That proposal has no deck design saved with it." };
    const design = normalizeDeckDesign(raw.design);
    // A photo from another shop's folder never comes along.
    if (design.photo && !ownDeckPhoto(design.photo.url, g.organizationId)) design.photo = null;
    return { ok: true, design, address: proposal.address ?? (typeof raw.address === "string" ? raw.address : null), title: proposal.title, proposal: linked };
  } catch {
    return { ok: false, error: "The saved deck could not be read." };
  }
}

/* ── Editing a saved deck proposal (2026-10-12) ──────────────────────────── */
//
// Owner: "when a decking design proposal is saved, make an option to open and edit the design." The proposal's
// drawing card opens the studio on it; the studio's "Update the proposal" lands here. The update goes through the
// builder's own save (actions/proposals saveProposal) — the row read the way the builder reads it
// (draftFromProposal) and written the way the builder writes it (payloadFromDraft) — so the schedule, the open
// checkouts and invoices, the discount, the markups and the "show to client" switches behave exactly as a save from
// the builder. What changes (the rules: lib/deck/proposalEdit):
//   · the studio's own lines (the names it last wrote) are replaced by the new design's; lines added in the builder
//     stay, after them, with their store links;
//   · the title and the scope follow the design while they are still the studio's; edited by hand, they stay;
//   · a new address in another state brings that state's sales tax, as the convert does;
//   · a signed, paid or finished proposal is refused — the design goes on a new proposal.
// A new DECK_PLAN row carries the design, the 3D and what was written; every reader takes the newest.

export type DeckUpdateResult =
  | { ok: true; id: string; kept: number; titleKept: boolean; scopeKept: boolean }
  | { ok: false; code: "LOCKED"; lock: DeckProposalLock; error: string }
  | { ok: false; code: "MISSING" | "FORBIDDEN" | "INVALID" | "FAILED"; error: string };

export async function updateDeckProposal(raw: unknown): Promise<DeckUpdateResult> {
  const g = await gate();
  if (!g.ok) return { ok: false, code: "FORBIDDEN", error: g.error };
  const parsed = deckUpdateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID", error: firstIssue(parsed.error) };
  const data = parsed.data;
  const missing = { ok: false as const, code: "MISSING" as const, error: "That proposal is gone. Save the design as a new proposal." };
  try {
    const linked = await linkedProposal(g, data.proposalId);
    if (!linked) return missing;
    if (linked.lock) return { ok: false, code: "LOCKED", lock: linked.lock, error: `This proposal is ${DECK_LOCK_WORDS[linked.lock]}, so its price stays as it is. Save the new design as a new proposal.` };
    const [row, org, ev] = await Promise.all([
      db.proposal.findFirst({
        where: { id: linked.id, organizationId: g.organizationId },
        include: { lineItems: { orderBy: { position: "asc" } }, installments: { orderBy: { position: "asc" } }, discounts: true },
      }),
      db.organization.findUnique({ where: { id: g.organizationId }, select: { defaultTaxRate: true, materialMarkupPct: true, laborMarkupPct: true } }),
      db.activityEvent.findFirst({ where: { proposalId: linked.id, kind: DECK_PLAN_EVENT }, orderBy: { createdAt: "desc" }, select: { meta: true } }),
    ]);
    if (!row) return missing;
    let before: Record<string, unknown> | null = null;
    try {
      before = ev?.meta ? (JSON.parse(ev.meta) as Record<string, unknown>) : null;
    } catch {
      before = null;
    }
    const next = deckUpdatePayload(
      row,
      { written: readDeckWritten(before?.written), oldWords: before?.design ? structureWords(normalizeDeckDesign(before.design)) : null },
      data,
      org,
    );
    await saveProposal(next.payload);

    if (data.plan) {
      try {
        const plan = { v: DECK_PLAN_VERSION, design: data.plan.design, scene: data.plan.scene, address: next.payload.address || null, written: next.written };
        if (plan.design.photo && !ownDeckPhoto(plan.design.photo.url, g.organizationId)) plan.design = { ...plan.design, photo: null };
        await db.activityEvent.create({ data: { organizationId: g.organizationId, actorId: g.userId, proposalId: row.id, kind: DECK_PLAN_EVENT, summary: `Deck design changed — ${data.plan.scene.facts}`, meta: JSON.stringify(plan) } });
      } catch {
        /* the picture never blocks the price */
      }
    }
    await logActivity({ organizationId: g.organizationId, actorId: g.userId, kind: TRAIL_KINDS.ESTIMATE, proposalId: row.id, summary: `Re-priced the deck from its design — ${data.plan?.scene.facts ?? data.title}, $${Math.round(next.subtotal).toLocaleString("en-US")}`, meta: { trade: "deck", amount: Math.round(next.subtotal) } });
    // A proposal with no client yet, re-priced from the design a client sent through its link: it is that client's
    // job (2026-10-17 audit — the walk's proposal stayed "Unassigned" after Jane's design priced it).
    if (!row.clientId && data.clientToken) {
      const clientId = await clientFromDesignLink(g.organizationId, g.userId, data.clientToken, row.title);
      if (clientId) await db.proposal.updateMany({ where: { id: row.id, organizationId: g.organizationId, clientId: null }, data: { clientId } });
    }
    await tieClientLinkToProposal(data.clientToken, g.organizationId, row.id);
    return { ok: true, id: row.id, kept: next.kept, titleKept: next.titleKept, scopeKept: next.scopeKept };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    // The builder's own refusals, said the builder's way: a paid stage, or a proposal this member may not change.
    if (/already paid|being paid/.test(message)) return { ok: false, code: "LOCKED", lock: "paid", error: `${message}. Save the new design as a new proposal.` };
    if (message === "Not found") return { ok: false, code: "LOCKED", lock: "theirs", error: `This proposal is ${DECK_LOCK_WORDS.theirs}. Save the design as a new proposal.` };
    logServerError("deck-update", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, code: "FAILED", error: "The proposal could not be updated. Try again in a moment; if it keeps failing, tell support the time it happened." };
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
  const g = await gate("design");
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
