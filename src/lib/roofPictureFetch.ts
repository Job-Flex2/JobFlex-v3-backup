// THE CLIENT'S ROOF PICTURE, FETCHED (2026-10-19) — server only.
//
// lib/roofPictures decides which frames a measurement could be shown in; this
// fetches them, best first, and says which one actually came. The client's
// page (lib/proposalPictures, for the pin) and the picture's route (for the
// bytes) both ask here, so the pin is always projected onto the frame that is
// served: when EagleView refuses an old order's image (410 "Image is older
// than the maximum allowed age"), 404s or times out, both move to Google's
// satellite at the same point; when that fails too, both give the stand-in,
// which has no pin.
//
// An ortho's answer is kept in memory for a while — the page and its picture
// route ask within a second of each other, and a refused image stays refused
// (a 410 or 404 for half a day; anything else for two minutes).

import { fetchPropertyImage, isEagleViewEnabled, type InstantRoofData } from "@/lib/eagleview";
import { satellitePhotoPng, type PhotoSubject } from "@/lib/staticMapPhoto";
import { firstRoofPicture, roofFrames, type LatLng, type RoofFrame } from "@/lib/roofPictures";

/** How long one ortho fetch may take before the satellite is tried. */
const ORTHO_DEADLINE_MS = 8_000;
const KEEP_OK_MS = 30 * 60_000;
const KEEP_GONE_MS = 12 * 60 * 60_000;
const KEEP_FAILED_MS = 2 * 60_000;
const KEEP_MAX = 24;

type Kept = { at: number; ttl: number; image: { bytes: Uint8Array; contentType: string } | null; error: string | null };
const kept = new Map<string, Kept>();

function keep(token: string, k: Kept) {
  kept.delete(token);
  kept.set(token, k);
  while (kept.size > KEEP_MAX) kept.delete(kept.keys().next().value!);
}

/** One EagleView image by its token — one attempt, a deadline, the answer kept (refusals too). Throws when refused. */
export async function orthoImage(token: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const hit = kept.get(token);
  if (hit && Date.now() - hit.at < hit.ttl) {
    if (hit.image) return hit.image;
    throw new Error(hit.error ?? "EagleView image unavailable");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const img = await Promise.race([
      fetchPropertyImage(token, { attempts: 1 }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("EagleView image timed out")), ORTHO_DEADLINE_MS); }),
    ]);
    const image = { bytes: new Uint8Array(img.bytes), contentType: img.contentType || "image/png" };
    keep(token, { at: Date.now(), ttl: KEEP_OK_MS, image, error: null });
    return image;
  } catch (err) {
    const status = (err as { httpStatus?: number }).httpStatus;
    const error = err instanceof Error ? err.message : String(err);
    keep(token, { at: Date.now(), ttl: status === 410 || status === 404 ? KEEP_GONE_MS : KEEP_FAILED_MS, image: null, error });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface RoofPictureSubject extends PhotoSubject {
  instant: InstantRoofData | null;
}

export type RoofPicture =
  | { frame: RoofFrame; bytes: Uint8Array; contentType: string; frames: number }
  /** frames 0: no aerial source at all (no key, no point) — no roof picture. Otherwise every source failed: the stand-in. */
  | { frame: null; frames: number };

/** The measurement's pin, as the frames and the pin are read from it. */
export function subjectPin(s: { lat: number | null; lng: number | null }): LatLng | null {
  return s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null;
}

/**
 * The roof's picture: the first frame that loads, ortho before satellite. `only` restricts it to the frame the page
 * already chose (its pin was projected onto that one).
 */
export async function loadRoofPicture(s: RoofPictureSubject, only?: RoofFrame["kind"]): Promise<RoofPicture> {
  const all = roofFrames(s.instant, subjectPin(s), { ortho: isEagleViewEnabled(), satellite: Boolean(process.env.GOOGLE_MAPS_API_KEY) });
  const frames = only ? all.filter((f) => f.kind === only) : all;
  const got = await firstRoofPicture(frames, async (f) => {
    if (f.kind === "ortho") return orthoImage(f.token);
    // The satellite at the frame's own centre, so the pin projected onto the frame lands where the photo shows it.
    const photo = await satellitePhotoPng({ ...s, lat: f.lat, lng: f.lng });
    if (!photo.ok) throw new Error(photo.error);
    return { bytes: new Uint8Array(photo.bytes), contentType: "image/png" };
  });
  if (got.failed.length) console.warn("[roofPictureFetch] fell through:", got.failed.map((x) => `${x.kind}: ${x.error.slice(0, 160)}`).join(" | "));
  return got.frame ? { frame: got.frame, ...got.picture, frames: all.length } : { frame: null, frames: all.length };
}
