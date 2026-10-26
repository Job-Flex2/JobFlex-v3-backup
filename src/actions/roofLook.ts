"use server";
// THE ROOF VISUALIZER'S SERVER SIDE (2026-10-25, lib/roofLook + roof-estimator-blueprint/roof-look.tsx):
//   findRoofInPhoto   the vision model reads a street photo of the house and answers the roof's outline(s) as
//                     polygons in 0…1 of the picture — the start the contractor's taps refine; no key, no model → an
//                     honest "no", the taps alone do it;
//   saveRoofLook      the painted picture (a PNG the browser made) to Blob under roof-look/, and an ActivityEvent
//                     ROOF_LOOK naming it for the measurement (and the proposal when there is one) — the client's
//                     page lists it as "Your roof in <material · colour>" (lib/proposalPictures).
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { NoOrgError, UnauthorizedError, requireEstimatorOrManager } from "@/lib/orgContext";
import { enforceRateLimit, HOUR, RateLimitError } from "@/lib/rateLimit";
import { isBlobEnabled, uploadBlob } from "@/lib/sdk/blob";
import { isOpenAIEnabled } from "@/lib/sdk/openai";
import { runVisionJson } from "@/lib/sdk/openaiVision";
import { ROOF_LOOK_EVENT } from "@/lib/proposalPictures";
import { lookWords, ROOF_COLORS } from "@/lib/roofLook";
import { ROOF_FAMILIES, type RoofFamily } from "@/lib/roofPackage/catalog";

type Fail = { ok: false; error: string };

async function who(): Promise<{ ok: true; organizationId: string; userId: string } | Fail> {
  try {
    const { organizationId, user } = await requireEstimatorOrManager();
    return { ok: true, organizationId, userId: user.id };
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof NoOrgError) return { ok: false, error: "Sign in to an estimator's account first." };
    throw err;
  }
}

const DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_PHOTO = 6 * 1024 * 1024;   // the browser sends the working-size JPEG, never the phone's full frame
const MAX_PNG = 10 * 1024 * 1024;

/** The roof's outline(s) in a street photo, from the vision model: polygons of [x, y] in 0…1 of the picture. */
export async function findRoofInPhoto(dataUrl: string): Promise<{ ok: true; polygons: Array<Array<[number, number]>>; note: string | null } | Fail> {
  const a = await who();
  if (!a.ok) return a;
  if (typeof dataUrl !== "string" || !DATA_URL.test(dataUrl.slice(0, 64) + dataUrl.slice(64).replace(/[^A-Za-z0-9+/=]/g, "x")) || dataUrl.length > MAX_PHOTO) return { ok: false, error: "Send a JPEG or PNG photo under 6 MB." };
  if (!isOpenAIEnabled()) return { ok: true, polygons: [], note: "No model on this server — tap the roof to pick it out." };
  try {
    await enforceRateLimit(`roof-look:${a.organizationId}`, 60, HOUR, "roof photo reads");
  } catch (err) {
    if (err instanceof RateLimitError) return { ok: false, error: "That is a lot of photos for one hour — try again a little later." };
    throw err;
  }
  const res = await runVisionJson<{ roofs?: unknown; note?: unknown }>({
    systemPrompt:
      "You outline the ROOF of the house in a photograph for a roofing contractor. Answer JSON only: " +
      '{"roofs": [[[x,y],[x,y],...], ...], "note": "..."} — one polygon per visible roof surface group (the main roof, a garage, a porch), ' +
      "each a closed polygon of 4 to 16 [x, y] points in fractions 0..1 of the image width and height, going around the roof's outer edge: " +
      "the eaves (bottom edge of the roofing), the rakes, the ridge. Include only the roofing surface — never walls, siding, gutters, sky, trees, " +
      "chimneys or the ground. If no roof is visible, answer {\"roofs\": [], \"note\": \"why\"}. Be precise: a point off by 2% of the width is a miss.",
    userPrompt: "Outline every roof surface of this house. JSON only.",
    imageUrl: dataUrl,
    detail: "high",
  }).catch(() => null);
  const polys = Array.isArray(res?.roofs) ? (res!.roofs as unknown[]) : [];
  const clean: Array<Array<[number, number]>> = [];
  for (const poly of polys) {
    if (!Array.isArray(poly)) continue;
    const pts: Array<[number, number]> = [];
    for (const pt of poly) {
      const x = Array.isArray(pt) ? Number(pt[0]) : NaN, y = Array.isArray(pt) ? Number(pt[1]) : NaN;
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push([Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))]);
    }
    if (pts.length >= 3 && pts.length <= 40) clean.push(pts);
  }
  return { ok: true, polygons: clean.slice(0, 6), note: typeof res?.note === "string" ? res.note.slice(0, 200) : null };
}

/** The painted roof saved for the measurement (and the proposal when there is one): Blob + ROOF_LOOK. */
export async function saveRoofLook(input: { measurementId: string; proposalId?: string | null; png: string; family: string; colorId: string; source: "aerial" | "photo" }): Promise<{ ok: true; url: string } | Fail> {
  const a = await who();
  if (!a.ok) return a;
  const family = ROOF_FAMILIES.find((f) => f.id === input.family)?.id as RoofFamily | undefined;
  if (!family) return { ok: false, error: "Pick a roof material first." };
  const color = (ROOF_COLORS[family] ?? []).find((c) => c.id === input.colorId);
  if (!color) return { ok: false, error: "Pick a colour first." };
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(typeof input.png === "string" ? input.png : "");
  if (!m || input.png.length > MAX_PNG) return { ok: false, error: "The picture could not be read — try again." };
  const measurement = await db.roofMeasurement.findFirst({ where: { id: String(input.measurementId), organizationId: a.organizationId }, select: { id: true, address: true } });
  if (!measurement) return { ok: false, error: "That measurement isn't yours, or is gone." };
  let proposalId: string | null = null;
  if (input.proposalId) {
    const p = await db.proposal.findFirst({ where: { id: String(input.proposalId), organizationId: a.organizationId }, select: { id: true } });
    proposalId = p?.id ?? null;
  }
  if (!isBlobEnabled()) return { ok: false, error: "File storage isn't set up on this server — download the picture instead." };
  const words = lookWords({ family, colorId: color.id });
  const { url } = await uploadBlob(`roof-look/${randomUUID()}.png`, Buffer.from(m[1], "base64"), { contentType: "image/png" });
  try {
    await db.activityEvent.create({
      data: {
        organizationId: a.organizationId,
        actorId: a.userId,
        proposalId,
        kind: ROOF_LOOK_EVENT,
        summary: `Roof visualized — ${words}${measurement.address ? ` · ${measurement.address}` : ""}`,
        meta: JSON.stringify({ url, measurementId: measurement.id, family, colorId: color.id, words, source: input.source, at: new Date().toISOString() }),
      },
    });
  } catch {
    return { ok: false, error: "The picture was stored but could not be filed — try again." };
  }
  return { ok: true, url };
}
