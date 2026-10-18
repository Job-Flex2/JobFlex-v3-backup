"use server";

// THE HOME DESIGN STUDIO'S SERVER SIDE (owner, 2026-10-17 — admin only for now). The plan is read in the browser
// (lib/design/planRead, from the PDF's own lines); the server keeps the designs and reads what only a model can:
// room names a CAD export drew as lines instead of text.
//   saveDesign / listDesigns / loadDesign / deleteDesign — SyncState rows `designdraft:<orgId>:<id>` (no table of
//     its own, like the deck drafts), at most DRAFT_MAX a shop.
//   readRoomNames — the plan with its rooms numbered → the name (and printed area) inside each.
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
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

type Gate = { ok: true; organizationId: string; userId: string } | { ok: false; error: string };

async function gate(): Promise<Gate> {
  try {
    const ctx = await requireOrg();
    if (isLimitedRole(ctx.role)) return { ok: false, error: "The design studio isn't open to this role." };
    if (!(await canUseDesignStudio(ctx.user))) return { ok: false, error: "The design studio is in preview for admins." };
    return { ok: true, organizationId: ctx.organizationId, userId: ctx.user.id };
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
