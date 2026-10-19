// THE CLIENT'S ROOF, AS A PICTURE (2026-09-23) — pure: no database, no fetch.
//
// Owner: "the client should receive a piece of the picture of the roof." A
// proposal converted from a roof measurement links to it (ProposalSitePhoto);
// what the client's page can show:
//   ortho      EagleView's own clear aerial of the house, when the paid answer
//              carried imagery and the credentials are on the server;
//   satellite  Google's static satellite tile at the pin, when that key is on
//              the server.
// ONE PIN ON THE ROOF, NEVER AN OUTLINE (owner, 2026-10-12: "it shows the
// outline in a really bad looking shape — remove it and never send any
// outlines for the roof, just show the pin above the roof"). The measured
// outline is still read here, but only to find a point well inside the roof
// for the pin; no outline is drawn over the picture, drawn as a plan, or
// drawn in the stand-in for the client any more.
// WHEN THE AERIAL WILL NOT COME (2026-10-19): EagleView stops serving an
// order's images after a while (410 "Image is older than the maximum allowed
// age"), and any fetch can fail or time out. The picture then falls through
// roofFrames in order — the ortho, then Google's satellite at the same point
// with the pin projected onto that frame — and only when every source fails
// is it the stand-in, which carries no pin (firstRoofPicture; the fetching
// itself is lib/roofPictureFetch, server only).

export type LatLng = { lat: number; lng: number };

export type RoofFrame =
  | { kind: "ortho"; token: string; bbox: [number, number, number, number] }
  | { kind: "satellite"; lat: number; lng: number; zoom: number; px: number };

/** The Instant record's parts this module reads. */
export interface InstantLike {
  lat?: number | null;
  lng?: number | null;
  structures?: Array<{ outline?: LatLng[] | null }>;
  imagery?: Array<{ token: string; view: string; masked?: boolean; bbox: [number, number, number, number] | null }>;
}

export interface RoofFacts {
  areaSqft: number | null;
  squares: number | null;
  pitch: string | null;
  facetCount: number | null;
  measuredOn: string | null;
}

/** The measured outlines, closed rings of lat/lng, largest first. */
export function roofRings(instant: InstantLike | null): LatLng[][] {
  const rings = (instant?.structures ?? []).map((s) => (s.outline ?? []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))).filter((r) => r.length >= 3);
  const area = (r: LatLng[]) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p.lng * q.lat - q.lng * p.lat; }, 0));
  return rings.sort((a, b) => area(b) - area(a));
}

/** Every picture the client could get, best first, given what the server can reach: the ortho, then the satellite. */
export function roofFrames(instant: InstantLike | null, pin: LatLng | null, able: { ortho: boolean; satellite: boolean }, zoom = 20, px = 640): RoofFrame[] {
  const out: RoofFrame[] = [];
  if (able.ortho) {
    const wide = (instant?.imagery ?? [])
      .filter((im) => im.view === "ortho" && im.bbox && im.masked === false && im.token)
      .sort((a, b) => (b.bbox![2] - b.bbox![0]) * (b.bbox![3] - b.bbox![1]) - (a.bbox![2] - a.bbox![0]) * (a.bbox![3] - a.bbox![1]))[0];
    if (wide) out.push({ kind: "ortho", token: wide.token, bbox: wide.bbox! });
  }
  if (able.satellite) {
    let lat = pin?.lat ?? instant?.lat ?? null;
    let lng = pin?.lng ?? instant?.lng ?? null;
    if ((lat == null || lng == null) && instant) {
      const all = roofRings(instant).flat();
      if (all.length) { lat = all.reduce((s, p) => s + p.lat, 0) / all.length; lng = all.reduce((s, p) => s + p.lng, 0) / all.length; }
    }
    if (lat != null && lng != null) out.push({ kind: "satellite", lat, lng, zoom, px });
  }
  return out;
}

/** Which picture the client gets when every source answers: the first of roofFrames. */
export function roofFrameFor(instant: InstantLike | null, pin: LatLng | null, able: { ortho: boolean; satellite: boolean }, zoom = 20, px = 640): RoofFrame | null {
  return roofFrames(instant, pin, able, zoom, px)[0] ?? null;
}

export type RoofPictureTry<T> =
  | { frame: RoofFrame; picture: T; failed: Array<{ kind: RoofFrame["kind"]; error: string }> }
  | { frame: null; picture: null; failed: Array<{ kind: RoofFrame["kind"]; error: string }> };

/**
 * The first frame whose picture loads, trying them in order; any error (a 410 from EagleView, a 404, a timeout, a
 * refused key) moves on to the next. No frame left: frame null — the stand-in, without a pin.
 */
export async function firstRoofPicture<T>(frames: RoofFrame[], load: (frame: RoofFrame) => Promise<T>): Promise<RoofPictureTry<T>> {
  const failed: Array<{ kind: RoofFrame["kind"]; error: string }> = [];
  for (const frame of frames) {
    try {
      return { frame, picture: await load(frame), failed };
    } catch (err) {
      failed.push({ kind: frame.kind, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { frame: null, picture: null, failed };
}

const TILE = 256;
const D2R = Math.PI / 180;
/** Web Mercator pixel coordinates at a zoom (the tile scheme Google's static map draws in). */
function mercatorPx(p: LatLng, zoom: number): { x: number; y: number } {
  const n = TILE * Math.pow(2, zoom);
  const x = ((p.lng + 180) / 360) * n;
  const s = Math.sin(Math.max(-89.9, Math.min(89.9, p.lat)) * D2R);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return { x, y };
}

/** A point in the picture's own square, 0…1000 across and down. */
export function frameProject(p: LatLng, frame: RoofFrame): { x: number; y: number } {
  if (frame.kind === "ortho") {
    const [minLon, minLat, maxLon, maxLat] = frame.bbox;
    return { x: ((p.lng - minLon) / (maxLon - minLon || 1e-9)) * 1000, y: ((maxLat - p.lat) / (maxLat - minLat || 1e-9)) * 1000 };
  }
  const c = mercatorPx({ lat: frame.lat, lng: frame.lng }, frame.zoom);
  const q = mercatorPx(p, frame.zoom);
  return { x: (0.5 + (q.x - c.x) / frame.px) * 1000, y: (0.5 + (q.y - c.y) / frame.px) * 1000 };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Where the pin goes: a point well inside the largest measured roof — the spot farthest from its edges — so an
 * L-shaped house gets its pin on the roof, not in the yard between its wings. Without an outline, the measurement's
 * own pin.
 */
export function roofPinPoint(instant: InstantLike | null, pin: LatLng | null): LatLng | null {
  const ring = roofRings(instant)[0];
  if (!ring) return pin ?? (instant?.lat != null && instant?.lng != null ? { lat: instant.lat, lng: instant.lng } : null);
  const xs = ring.map((p) => p.lng);
  const ys = ring.map((p) => p.lat);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  // A degree of longitude shrinks toward the poles: distances are measured with it scaled to match latitude's.
  const k = Math.cos(((y0 + y1) / 2) * D2R);
  const inside = (x: number, y: number) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.lat > y !== b.lat > y && x < ((b.lng - a.lng) * (y - a.lat)) / (b.lat - a.lat || 1e-12) + a.lng) hit = !hit;
    }
    return hit;
  };
  const edgeDist = (x: number, y: number) => {
    let best = Infinity;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax = ring[j].lng * k, ay = ring[j].lat, bx = ring[i].lng * k, by = ring[i].lat;
      const px = x * k;
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1e-18)));
      best = Math.min(best, Math.hypot(px - (ax + t * dx), y - (ay + t * dy)));
    }
    return best;
  };
  // The deepest spots inside (within a tenth of the deepest), and of those the one nearest the roof's middle — a long
  // rectangle has a whole line of equally deep spots, and its pin belongs at the centre of it.
  const spots: Array<{ x: number; y: number; d: number }> = [];
  const N = 24;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const x = x0 + ((x1 - x0) * i) / N;
      const y = y0 + ((y1 - y0) * j) / N;
      if (inside(x, y)) spots.push({ x, y, d: edgeDist(x, y) });
    }
  }
  const deepest = Math.max(0, ...spots.map((p) => p.d));
  const mx = xs.reduce((a, v) => a + v, 0) / xs.length;
  const my = ys.reduce((a, v) => a + v, 0) / ys.length;
  const near = (p: { x: number; y: number }) => Math.hypot((p.x - mx) * k, p.y - my);
  const best = spots.filter((p) => p.d >= deepest * 0.9).sort((a, b) => near(a) - near(b))[0];
  const pick: LatLng | null = best ? { lat: best.y, lng: best.x } : null;
  return pick ?? { lat: ys.reduce((a, v) => a + v, 0) / ys.length, lng: xs.reduce((a, v) => a + v, 0) / xs.length };
}

/** The pin in the picture's 0…1000 square (its tip), or null when it falls off the picture. */
export function roofPinOnFrame(point: LatLng | null, frame: RoofFrame): { x: number; y: number } | null {
  if (!point) return null;
  const q = frameProject(point, frame);
  if (!(q.x >= 20 && q.x <= 980 && q.y >= 80 && q.y <= 1000)) return null;
  return { x: r1(q.x), y: r1(q.y) };
}

export function roofFactsLine(f: RoofFacts): string {
  const parts: string[] = [];
  if (f.areaSqft) parts.push(`${Math.round(f.areaSqft).toLocaleString("en-US")} sq ft`);
  if (f.squares) parts.push(`${Math.round(f.squares * 10) / 10} squares`);
  if (f.pitch) parts.push(`${f.pitch} pitch`);
  if (f.facetCount) parts.push(`${f.facetCount} facet${f.facetCount === 1 ? "" : "s"}`);
  if (f.measuredOn) parts.push(`measured ${f.measuredOn}`);
  return parts.join(" · ");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
const font = "Inter, Helvetica, Arial, sans-serif";
const mono = "ui-monospace, 'JetBrains Mono', Menlo, monospace";

/**
 * The picture's stand-in when no aerial can be fetched at request time: a plain square with the facts — no outline,
 * and no pin over it (there is no picture for a pin to point into).
 */
export function roofStandInSvg(factsLine: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000" role="img" aria-label="Your roof">` +
    `<rect width="1000" height="1000" fill="#eceae3"/>` +
    `<g stroke="#d8d5cb" stroke-width="1">${Array.from({ length: 19 }, (_, i) => `<line x1="${(i + 1) * 50}" y1="0" x2="${(i + 1) * 50}" y2="1000"/><line x1="0" y1="${(i + 1) * 50}" x2="1000" y2="${(i + 1) * 50}"/>`).join("")}</g>` +
    `<text x="500" y="440" text-anchor="middle" font-family="${font}" font-size="30" font-weight="800" fill="#0a0a0a">Your roof</text>` +
    `<text x="500" y="480" text-anchor="middle" font-family="${font}" font-size="20" fill="#6b6b6b">The aerial picture could not be loaded just now.</text>` +
    `<text x="24" y="972" font-family="${mono}" font-size="20" fill="#6b6b6b" letter-spacing="2">${esc(factsLine.toUpperCase())}</text>` +
    `</svg>`;
}
