"use server";

// THE HOME DESIGN STUDIO'S SERVER SIDE (owner, 2026-10-17 — admin only for now). The plan is read in the browser
// (lib/design/planRead, from the PDF's own lines); the server keeps the designs and reads what only a model can:
// room names a CAD export drew as lines instead of text.
//   saveDesign / listDesigns / loadDesign / deleteDesign — SyncState rows `designdraft:<orgId>:<id>` (no table of
//     its own, like the deck drafts), at most DRAFT_MAX a shop.
//   readRoomNames — the plan with its rooms numbered → the name (and printed area) inside each.
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkPlanLimit } from "@/lib/limitsEngine";
import { PLAN_LIMIT_MESSAGE } from "@/lib/planLimits";
import { ProposalStatus } from "@/lib/prismaEnums";
import { clearFilingContext, filedClientId, leadProposalText, readFilingContext } from "@/lib/filingContext";
import { stateFromAddress, stateTaxRate } from "@/lib/pricing/salesTax";
import { applyMemberDiscount } from "@/lib/servicePlanBook";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { locationIndex } from "@/lib/estimate/location-index";
import { isLimitedRole, requireOrg } from "@/lib/orgContext";
import { canUseDesignStudio } from "@/lib/design/access";
import { normalizeDesign } from "@/lib/design/normalize";
import type { DesignDoc } from "@/lib/design/model";
import { logServerError } from "@/lib/server-events";
import { enforceRateLimit, HOUR } from "@/lib/rateLimit";
import { friendlyAIError, getOpenAI, getVisionModel, isOpenAIEnabled, isTransientAIError, samplingOptions } from "@/lib/sdk/openai";

const PREFIX = "designdraft:";
const DRAFT_MAX = 40;
const keyOf = (org: string, id: string) => `${PREFIX}${org}:${id}`;

type Gate = { ok: true; organizationId: string; userId: string; role: string } | { ok: false; error: string };

async function gate(): Promise<Gate> {
  try {
    const ctx = await requireOrg();
    if (isLimitedRole(ctx.role)) return { ok: false, error: "The design studio isn't open to this role." };
    if (!(await canUseDesignStudio(ctx.user))) return { ok: false, error: "The design studio is in preview for admins." };
    return { ok: true, organizationId: ctx.organizationId, userId: ctx.user.id, role: String(ctx.role) };
  } catch {
    return { ok: false, error: "Sign in again to use the design studio." };
  }
}

export type DesignRow = { id: string; title: string; updatedAt: string; by: string | null; rooms: number; source: string | null };

type Stored = { v: 1; title: string; updatedAt: string; by: string | null; doc: DesignDoc };

function readRow(cursor: string): Stored | null {
  try {
    const o = JSON.parse(cursor) as Stored;
    return o && o.v === 1 && o.doc ? o : null;
  } catch {
    return null;
  }
}

export async function saveDesign(input: { id?: string | null; doc: unknown }): Promise<{ ok: true; id: string; updatedAt: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const id = input.id && /^[a-f0-9-]{8,40}$/i.test(input.id) ? input.id : randomUUID();
  const doc = normalizeDesign(input.doc);
  const updatedAt = new Date().toISOString();
  const who = await db.user.findUnique({ where: { id: g.userId }, select: { name: true, email: true } }).catch(() => null);
  const body = JSON.stringify({ v: 1, title: doc.title, updatedAt, by: who?.name ?? who?.email ?? null, doc } satisfies Stored);
  if (body.length > 1_500_000) return { ok: false, error: "This design is too large to save — remove some of the plan's drawn fixtures and try again." };
  try {
    const key = keyOf(g.organizationId, id);
    const exists = await db.syncState.findUnique({ where: { key }, select: { key: true } });
    if (!exists) {
      const all = await db.syncState.findMany({ where: { key: { startsWith: `${PREFIX}${g.organizationId}:` } }, select: { key: true, cursor: true } });
      if (all.length >= DRAFT_MAX) {
        const oldest = all.map((r) => ({ key: r.key, at: readRow(r.cursor)?.updatedAt ?? "" })).sort((a, b) => a.at.localeCompare(b.at))[0];
        if (oldest) await db.syncState.delete({ where: { key: oldest.key } }).catch(() => {});
      }
    }
    await db.syncState.upsert({ where: { key }, create: { key, cursor: body }, update: { cursor: body } });
    return { ok: true, id, updatedAt };
  } catch (err) {
    logServerError("design-save", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The design could not be saved. It is still here on this page; try again in a moment." };
  }
}

export async function listDesigns(): Promise<{ ok: true; designs: DesignRow[] } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  try {
    const rows = await db.syncState.findMany({ where: { key: { startsWith: `${PREFIX}${g.organizationId}:` } }, select: { key: true, cursor: true } });
    const designs = rows
      .map((r) => {
        const s = readRow(r.cursor);
        return s
          ? { id: r.key.slice(`${PREFIX}${g.organizationId}:`.length), title: s.title, updatedAt: s.updatedAt, by: s.by, rooms: s.doc.labels?.length ?? 0, source: s.doc.source?.fileName ?? null }
          : null;
      })
      .filter((d): d is DesignRow => !!d)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { ok: true, designs };
  } catch (err) {
    logServerError("design-list", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "Your designs could not be listed right now." };
  }
}

export async function loadDesign(id: string): Promise<{ ok: true; id: string; doc: DesignDoc; updatedAt: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!/^[a-f0-9-]{8,40}$/i.test(id)) return { ok: false, error: "That design was not found." };
  const row = await db.syncState.findUnique({ where: { key: keyOf(g.organizationId, id) }, select: { cursor: true } }).catch(() => null);
  const s = row ? readRow(row.cursor) : null;
  if (!s) return { ok: false, error: "That design was not found." };
  return { ok: true, id, doc: normalizeDesign(s.doc), updatedAt: s.updatedAt };
}

export async function deleteDesign(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!/^[a-f0-9-]{8,40}$/i.test(id)) return { ok: false, error: "That design was not found." };
  await db.syncState.deleteMany({ where: { key: keyOf(g.organizationId, id) } }).catch(() => {});
  return { ok: true };
}

/* ── Room names a CAD export drew as lines ─────────────────────────────────────────────────────────────────────── */

export type RoomNameRead = { n: number; names: string[]; sqft: number | null };

const NAMES_SYSTEM = `You read architectural floor plans. The image is one floor plan; the contractor's software has drawn a large red number inside each enclosed space it found. For EACH red number, report the room name(s) printed by the architect inside that same space (ignore the red numbers themselves), and the area if the plan prints one under the name (e.g. "(142 SQ.FT.)" → 142).
- A space can hold two names when it is open plan (e.g. "KITCHEN" and "LIVING/DINING") — give both, in reading order.
- Drop prefixes like "(N)" or "(E)". Keep the name as printed but in Title Case ("Bedroom", "Bathroom", "Living/Dining Area", "Clo." → "Closet", "W.I.C." → "Walk-in Closet", "Ptry" → "Pantry", "Lin." → "Linen").
- If a space has no printed name, give an empty list. Never invent a name.
Reply with JSON only: {"rooms":[{"n":1,"names":["Kitchen","Living/Dining Area"],"sqft":142}]}`;

export async function readRoomNames(input: { image: string; count: number }): Promise<{ ok: true; rooms: RoomNameRead[] } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!isOpenAIEnabled()) return { ok: false, error: "Reading room names needs the AI model, which isn't set up here." };
  if (typeof input.image !== "string" || !/^data:image\/(jpeg|png);base64,/.test(input.image) || input.image.length > 6_000_000) return { ok: false, error: "The plan picture could not be sent." };
  const count = Math.max(1, Math.min(80, Math.round(Number(input.count) || 1)));
  try {
    await enforceRateLimit(`design-names:${g.organizationId}`, 40, HOUR, "room-name reads");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Too many reads — try again later." };
  }
  const client = getOpenAI();
  const model = getVisionModel();
  const sampling = await samplingOptions(0);
  const ask = () =>
    client.chat.completions.create(
      {
        model,
        ...sampling,
        messages: [
          { role: "system", content: NAMES_SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: `There are ${count} numbered spaces (1–${count}).` },
              { type: "image_url", image_url: { url: input.image, detail: "high" } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      },
      { maxRetries: 0 },
    );
  try {
    let completion: Awaited<ReturnType<typeof ask>>;
    try {
      completion = await ask();
    } catch (err) {
      if (!isTransientAIError(err)) throw err;
      await new Promise((r) => setTimeout(r, 2_500));
      completion = await ask();
    }
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { rooms?: Array<{ n?: unknown; names?: unknown; sqft?: unknown }> };
    const rooms: RoomNameRead[] = (Array.isArray(parsed.rooms) ? parsed.rooms : [])
      .map((r) => ({
        n: Math.round(Number(r.n)),
        names: (Array.isArray(r.names) ? r.names : [])
          .filter((x): x is string => typeof x === "string")
          .map((x) => x.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 50))
          .filter(Boolean)
          .slice(0, 3),
        sqft: Number.isFinite(Number(r.sqft)) && Number(r.sqft) > 0 && Number(r.sqft) < 20000 ? Math.round(Number(r.sqft)) : null,
      }))
      .filter((r) => r.n >= 1 && r.n <= count);
    return { ok: true, rooms };
  } catch (err) {
    logServerError("design-room-names", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: friendlyAIError(err, "reading the room names") };
  }
}

/* ── A plan set whose words are drawn as lines (2026-10-18) ──────────────────────────────────────────────────────
   Many CAD exports keep no text: every title and room name is strokes, so nothing can be read from the PDF's words.
   The vision model sorts the sheets (which are the floor plans, and of which floor), then reads each floor plan's
   rooms with where their labels sit — the studio finds them in the drawing from there. */

export type SheetTriage = { page: number; kind: string; title: string | null; level: string | null };

const TRIAGE_SYSTEM = `You sort the sheets of a residential construction drawing set. Each image is one sheet, preceded by its page number.
For EACH page say what it is:
- "floor_plan": the architectural floor plan of a level — rooms labelled, walls, doors, windows (the sheet a designer lays rooms out from). NOT a framing plan, foundation plan, roof (framing) plan, electrical/lighting plan, reflected ceiling plan, plumbing or mechanical plan, shear wall or lateral plan, or site plan — those have their own kinds.
- otherwise one of: "framing", "foundation", "roof", "electrical", "elevation", "section", "site", "details", "notes", "schedule", "structural", "other".
Give the drawing's own title as printed (e.g. "MAIN FLOOR PLAN"), and for a floor plan its level: "main", "upper", "third", "basement", "lower", "garage" or "attic" — null when the title names no level (a style or option plan).
Read only what is printed; never guess a title you can't read (use null).
Reply with JSON only: {"sheets":[{"page":7,"kind":"floor_plan","title":"MAIN FLOOR PLAN","level":"main"}]}`;

const KINDS = new Set(["floor_plan", "framing", "foundation", "roof", "electrical", "elevation", "section", "site", "details", "notes", "schedule", "structural", "other"]);
const LEVELS = new Set(["main", "upper", "third", "basement", "lower", "garage", "attic"]);
const clean = (x: unknown, n: number) => (typeof x === "string" ? x.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n) : "");
const dataUrl = (s: unknown, max: number) => typeof s === "string" && /^data:image\/(jpeg|png);base64,/.test(s) && s.length <= max;

async function askVision(system: string, content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "high" | "low" } }>) {
  const client = getOpenAI();
  const model = getVisionModel();
  const sampling = await samplingOptions(0);
  const ask = () => client.chat.completions.create({ model, ...sampling, messages: [{ role: "system", content: system }, { role: "user", content }], response_format: { type: "json_object" } }, { maxRetries: 0 });
  let completion: Awaited<ReturnType<typeof ask>>;
  try {
    completion = await ask();
  } catch (err) {
    if (!isTransientAIError(err)) throw err;
    await new Promise((r) => setTimeout(r, 2_500));
    completion = await ask();
  }
  return JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
}

/** Which sheets are floor plans, and of which floor — from small pictures of every sheet. */
export async function triagePlanSheets(input: { pages: Array<{ page: number; image: string }> }): Promise<{ ok: true; sheets: SheetTriage[] } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!isOpenAIEnabled()) return { ok: false, error: "Reading the sheets needs the AI model, which isn't set up here." };
  const pages = (Array.isArray(input?.pages) ? input.pages : []).slice(0, 40).filter((p) => Number.isFinite(Number(p?.page)) && dataUrl(p?.image, 700_000));
  if (!pages.length || pages.reduce((n, p) => n + p.image.length, 0) > 7_600_000) return { ok: false, error: "The sheets could not be sent." };
  try {
    await enforceRateLimit(`design-triage:${g.organizationId}`, 20, HOUR, "plan set reads");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Too many reads — try again later." };
  }
  try {
    const parsed = await askVision(TRIAGE_SYSTEM, [
      { type: "text", text: `${pages.length} sheets follow.` },
      ...pages.flatMap((p) => [{ type: "text" as const, text: `Page ${Math.round(p.page)}:` }, { type: "image_url" as const, image_url: { url: p.image, detail: "high" as const } }]),
    ]);
    const asked = new Set(pages.map((p) => Math.round(p.page)));
    const sheets: SheetTriage[] = (Array.isArray(parsed.sheets) ? (parsed.sheets as Array<Record<string, unknown>>) : [])
      .map((s) => ({ page: Math.round(Number(s.page)), kind: KINDS.has(String(s.kind)) ? String(s.kind) : "other", title: clean(s.title, 80) || null, level: LEVELS.has(String(s.level)) ? String(s.level) : null }))
      .filter((s) => asked.has(s.page));
    return { ok: true, sheets };
  } catch (err) {
    logServerError("design-triage", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: friendlyAIError(err, "reading the plan set") };
  }
}

export type PlanRoomRead = { name: string; x: number; y: number; size: string | null; box: [number, number, number, number] | null };

const ROOMS_SYSTEM = `You read one floor plan sheet of a residential drawing set.
List EVERY room or space label printed ON THE FLOOR PLAN DRAWING itself — not in the notes, schedules, legends, area summary, title block or detail callouts:
- "name": as printed, in sentence case, abbreviations spelled out ("MSTR BEDRM" → "Master bedroom", "MBR2" → "Master bedroom 2", "MBA2" → "Master bath 2", "PDR" → "Powder", "WIC" → "Walk-in closet", "BA 3" → "Bath 3", "BEDRM 4" → "Bedroom 4", "3-CAR GARAGE" → "3-car garage", "REAR COV'D PATIO" → "Rear covered patio"); drop "(N)"/"(E)".
- "x", "y": the CENTER of that label as fractions of the whole image (0 = left/top, 1 = right/bottom).
- "box": the room's own extent [x0, y0, x1, y1] as fractions of the image — out to its walls; in an open plan (a kitchen, nook and great room in one space), the part that belongs to that room.
- "size": the room size if printed right under the name (e.g. "13'-6\" x 12'-0\""), else null. A ceiling height ("10'-1 1/2\" CLG.") is not a size.
Also give "box": the floor plan drawing's own extent [x0, y0, x1, y1] as fractions of the image — its walls and dimension strings, without the notes, schedules or title block — and "scale" as printed under the drawing (e.g. "1/4\" = 1'-0\""), or null.
Read only what is printed; never invent a room.
Reply with JSON only: {"rooms":[{"name":"Kitchen","x":0.49,"y":0.35,"box":[0.43,0.30,0.55,0.42],"size":null}],"box":[0.22,0.08,0.84,0.95],"scale":"1/4\" = 1'-0\""}`;

/** One floor plan's rooms, where each label sits, the drawing's extent and its scale — from a sharp picture of it. */
export async function readPlanRooms(input: { page: number; image: string }): Promise<{ ok: true; rooms: PlanRoomRead[]; box: [number, number, number, number] | null; scale: string | null } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!isOpenAIEnabled()) return { ok: false, error: "Reading the rooms needs the AI model, which isn't set up here." };
  if (!dataUrl(input?.image, 6_000_000)) return { ok: false, error: "The plan picture could not be sent." };
  try {
    await enforceRateLimit(`design-names:${g.organizationId}`, 40, HOUR, "room reads");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Too many reads — try again later." };
  }
  try {
    const parsed = await askVision(ROOMS_SYSTEM, [
      { type: "text", text: `Page ${Math.round(Number(input.page) || 0)} of the set.` },
      { type: "image_url", image_url: { url: input.image, detail: "high" } },
    ]);
    const frac = (v: unknown) => Math.max(0, Math.min(1, Number(v)));
    const rooms: PlanRoomRead[] = (Array.isArray(parsed.rooms) ? (parsed.rooms as Array<Record<string, unknown>>) : [])
      .filter((r) => clean(r.name, 60) && Number.isFinite(Number(r.x)) && Number.isFinite(Number(r.y)))
      .slice(0, 80)
      .map((r) => {
        const rb = Array.isArray(r.box) ? (r.box as unknown[]).map(Number) : [];
        const box = rb.length === 4 && rb.every(Number.isFinite) && rb[2] > rb[0] && rb[3] > rb[1] ? ([frac(rb[0]), frac(rb[1]), frac(rb[2]), frac(rb[3])] as [number, number, number, number]) : null;
        return { name: clean(r.name, 60), x: frac(r.x), y: frac(r.y), size: clean(r.size, 30) || null, box };
      });
    const b = Array.isArray(parsed.box) ? (parsed.box as unknown[]).map(Number) : [];
    const box = b.length === 4 && b.every(Number.isFinite) && b[2] > b[0] && b[3] > b[1] ? ([frac(b[0]), frac(b[1]), frac(b[2]), frac(b[3])] as [number, number, number, number]) : null;
    return { ok: true, rooms, box, scale: clean(parsed.scale, 40) || null };
  } catch (err) {
    logServerError("design-plan-rooms", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: friendlyAIError(err, "reading the rooms") };
  }
}

/* ── Milestone 4: the estimate and the proposal ─────────────────────────────────────────────────────────────── */

export type DesignLocation = { factor: number; place: string; level: "city" | "state" | "national" };

/** The job's market, from its address: the price book's city (or state) index. */
export async function designLocation(address: string): Promise<{ ok: true; loc: DesignLocation } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const idx = locationIndex(String(address ?? "").slice(0, 300));
  return { ok: true, loc: { factor: idx.factor, place: idx.place, level: idx.level } };
}

const BOOK_KEY = (org: string) => `designbook:${org}`;

/** The shop's own price per estimate line (line key → unit price). */
export async function readDesignBook(): Promise<{ ok: true; book: Record<string, number> } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const row = await db.syncState.findUnique({ where: { key: BOOK_KEY(g.organizationId) }, select: { cursor: true } }).catch(() => null);
  try {
    const raw = row ? (JSON.parse(row.cursor) as Record<string, unknown>) : {};
    const book: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) if (/^[\w-]{1,40}$/.test(k) && typeof v === "number" && Number.isFinite(v) && v >= 0) book[k] = v;
    return { ok: true, book };
  } catch {
    return { ok: true, book: {} };
  }
}

/** Keep (or forget, with null) the shop's own price for one line. */
export async function saveDesignPrice(key: string, price: number | null): Promise<{ ok: true; book: Record<string, number> } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!/^[\w-]{1,40}$/.test(key)) return { ok: false, error: "That line can't keep a price." };
  if (price != null && !(Number.isFinite(price) && price >= 0 && price <= 1_000_000)) return { ok: false, error: "That price isn't a number we can keep." };
  const cur = await readDesignBook();
  const book = cur.ok ? { ...cur.book } : {};
  if (price == null) delete book[key];
  else book[key] = Math.round(price * 100) / 100;
  try {
    await db.syncState.upsert({ where: { key: BOOK_KEY(g.organizationId) }, create: { key: BOOK_KEY(g.organizationId), cursor: JSON.stringify(book) }, update: { cursor: JSON.stringify(book) } });
    return { ok: true, book };
  } catch (err) {
    logServerError("design-book", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The price could not be kept — try again in a moment." };
  }
}

export type DesignClient = { id: string; name: string; email: string | null; phone: string | null; address: string | null };

/** The shop's clients by name, email or phone (the first eight). */
export async function findDesignClients(q: string): Promise<{ ok: true; clients: DesignClient[] } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const t = String(q ?? "").trim().slice(0, 80);
  const where = t
    ? { organizationId: g.organizationId, deletedAt: null, OR: [{ name: { contains: t, mode: "insensitive" as const } }, { email: { contains: t, mode: "insensitive" as const } }, { phone: { contains: t } }] }
    : { organizationId: g.organizationId, deletedAt: null };
  try {
    const rows = await db.client.findMany({ where, select: { id: true, name: true, email: true, phone: true, address: true }, orderBy: { updatedAt: "desc" }, take: 8 });
    return { ok: true, clients: rows };
  } catch {
    // SQLite (the stand) has no case-insensitive mode: match by name as typed.
    const rows = await db.client.findMany({ where: { organizationId: g.organizationId, deletedAt: null, ...(t ? { OR: [{ name: { contains: t } }, { email: { contains: t } }, { phone: { contains: t } }] } : {}) }, select: { id: true, name: true, email: true, phone: true, address: true }, orderBy: { updatedAt: "desc" }, take: 8 }).catch(() => []);
    return { ok: true, clients: rows };
  }
}

const lineSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(1500).default(""),
  quantity: z.number().min(0).max(1_000_000),
  unit: z.enum(["ea", "sqft", "ln ft", "lot"]),
  unitPrice: z.number().min(0).max(10_000_000),
  labor: z.number().min(0).max(1),
});
const convertSchema = z.object({
  title: z.string().trim().min(1).max(160),
  clientId: z.string().max(64).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  scope: z.string().max(6000).default(""),
  lines: z.array(lineSchema).min(1).max(200),
  designId: z.string().max(64).nullable().optional(),
  room: z.string().max(120).optional(),
  doc: z.unknown().optional(),
});

const UNIT_TYPE = { ea: "UNIT", sqft: "SQFT", "ln ft": "LINEAR_FT", lot: "LUMP_SUM" } as const;
const DESIGN_PLAN_EVENT = "DESIGN_PLAN";

/** The priced design → a JobFlex proposal (a draft), with the design riding along so it can be opened again. */
export async function convertDesignToProposal(raw: unknown): Promise<{ ok: true; id: string } | { ok: false; error: string; code?: string }> {
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
    // The book's prices are selling prices (overhead and profit in): the proposal is the ticket, no markup on top.
    const lines = data.lines.map((l, i) => {
      const unitPrice = round2(l.unitPrice);
      const laborCost = round2(unitPrice * l.labor);
      return { name: l.name, description: l.description || null, measurementType: UNIT_TYPE[l.unit], quantity: l.quantity, unitPrice, materialCost: round2(unitPrice - laborCost), laborCost, total: round2(l.quantity * unitPrice), position: i };
    });
    const subtotal = round2(lines.reduce((a, l) => a + l.total, 0));
    const address = data.address?.trim() || null;
    const org = await db.organization.findUnique({ where: { id: g.organizationId }, select: { defaultTaxRate: true } });
    const taxRate = stateTaxRate(stateFromAddress(address)) ?? org?.defaultTaxRate ?? 0;
    const taxTotal = round2(subtotal * taxRate);
    const proposal = await db.proposal.create({
      data: {
        trade: "kitchen",
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
    // The design rides with the proposal: walls, openings, rooms, what's placed and the finishes (not the plan's
    // drawn lines) — to open it again, and for the client's page later.
    try {
      const doc = normalizeDesign(data.doc ?? {});
      const plan = { v: 1, designId: data.designId ?? null, room: data.room ?? null, doc: { ...doc, marks: [] } };
      const meta = JSON.stringify(plan);
      if (meta.length < 900_000) await db.activityEvent.create({ data: { organizationId: g.organizationId, actorId: g.userId, proposalId: proposal.id, kind: DESIGN_PLAN_EVENT, summary: `Designed in the Home Design Studio — ${data.room ?? data.title}`, meta } });
    } catch {
      /* the design never blocks the proposal */
    }
    await logActivity({ organizationId: g.organizationId, actorId: g.userId, kind: TRAIL_KINDS.ESTIMATE, proposalId: proposal.id, summary: `Priced a kitchen design — ${data.room ?? data.title}, $${Math.round(subtotal).toLocaleString("en-US")}`, meta: { trade: "kitchen", amount: Math.round(subtotal) } });
    if (filing) await clearFilingContext();
    if (projectId) revalidatePath(`/dashboard/projects/${projectId}`);
    revalidatePath("/dashboard/proposals");
    return { ok: true, id: proposal.id };
  } catch (err) {
    logServerError("design-convert", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The proposal could not be saved. Try again in a moment." };
  }
}
