// A PROPERTY, READ (2026-10-18). What the lawn estimator keeps for one address — the lot, the photo it was read from,
// the class of every pixel (as the contractor last left it), the slope — and how the labels travel: run-length
// encoded, base64, so a draft and a proposal can carry the yard. Pure, browser-safe: the browser re-measures after
// every brush stroke.
import type { Grid, LatLng, MercBox } from "./geo";
import { fillRings, toPx } from "./geo";
import type { SlopeBands, YardMeasures } from "./measure";
import { measureYard } from "./measure";
import { DEFAULT_REACH_FT, keepYard } from "./yard";

export type LawnSite = {
  v: 1;
  address: string;
  lat: number;
  lng: number;
  state: string | null;
  /** For the county's own rules (Florida's summer fertilizer bans, Montgomery County's pesticide law). */
  county?: string | null;
  place: string;
  locationFactor: number;
  photo: { itemId: string; date: string; gsdM: number } | null;
  grid: { box: MercBox; w: number; h: number; gsdM: number; lat: number };
  lot: { ring: LatLng[]; source: "parcel" | "assumed"; parcelId: string | null; acreage: number | null; stories: number | null };
  /** Class of every pixel, run-length encoded (see encodeLabels). */
  labels: string;
  /** The classification as read from the photo, before the yard was picked out of it and before any edit — "As read"
   *  and a change of reach redo the yard from it. */
  readLabels: string;
  /** How the yard was picked out: grass within `reachFt` of the lot's buildings is lawn, past it natural (null: no
   *  building on the lot, nothing cut). Absent on estimates read before 2026-10-19 — their labels have no yard pass. */
  yard?: { reachFt: number | null };
  slope: SlopeBands;
  sources: { parcel: boolean; footprints: boolean; footprintSource?: "county" | "usa-structures" | null; canopyMap: boolean; lidar: boolean };
  readAt: string;
};

/** Run-length: pairs of (class, run length − 1 up to 255) as bytes, base64. */
export function encodeLabels(labels: Uint8Array): string {
  const out: number[] = [];
  for (let i = 0; i < labels.length; ) {
    const c = labels[i];
    let n = 1;
    while (i + n < labels.length && labels[i + n] === c && n < 256) n++;
    out.push(c, n - 1);
    i += n;
  }
  const bytes = Uint8Array.from(out);
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function decodeLabels(s: string, n: number): Uint8Array {
  const bytes = typeof Buffer !== "undefined" ? new Uint8Array(Buffer.from(s, "base64")) : Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
  const out = new Uint8Array(n);
  let k = 0;
  for (let i = 0; i + 1 < bytes.length && k < n; i += 2) {
    const c = bytes[i];
    const len = bytes[i + 1] + 1;
    out.fill(c, k, Math.min(n, k + len));
    k += len;
  }
  return out;
}

export const gridOf = (s: Pick<LawnSite, "grid">): Grid => ({ ...s.grid });

/** The lot as a pixel mask, and its ring in pixels. */
export function lotMaskOf(site: Pick<LawnSite, "grid" | "lot">) {
  const g = gridOf(site);
  const ring = site.lot.ring.map((p) => toPx(g, p));
  return { ring, mask: fillRings(g.w, g.h, [ring]) };
}

/** The yard picked out of the photo's reading at a reach — "As read", or the start of a reach change. */
export function yardOf(site: LawnSite, reachFt?: number | null): Uint8Array {
  const g = gridOf(site);
  const { mask } = lotMaskOf(site);
  return keepYard(decodeLabels(site.readLabels, g.w * g.h), mask, g, { reachFt: reachFt ?? site.yard?.reachFt ?? DEFAULT_REACH_FT }).labels;
}

/** An estimate saved before the yard pass (2026-10-19) opens with the yard picked out of its reading, the
 *  contractor's own edits (wherever its labels differ from the reading) laid back on top. Newer ones as they are. */
export function withYard(site: LawnSite, labels: Uint8Array): { site: LawnSite; labels: Uint8Array } {
  if (site.yard) return { site, labels };
  const g = gridOf(site);
  const { mask } = lotMaskOf(site);
  const read = decodeLabels(site.readLabels, g.w * g.h);
  const y = keepYard(read, mask, g);
  for (let i = 0; i < labels.length; i++) if (labels[i] !== read[i]) y.labels[i] = labels[i];
  return { site: { ...site, yard: { reachFt: y.reachFt } }, labels: y.labels };
}

/** The yard's numbers from the site as it stands (labels as edited). */
export function measureSite(site: LawnSite, labels?: Uint8Array): YardMeasures {
  const g = gridOf(site);
  const L = labels ?? decodeLabels(site.labels, g.w * g.h);
  const { ring, mask } = lotMaskOf(site);
  return measureYard({ grid: g, labels: L, lot: mask, lotRing: ring, slope: site.slope, photo: { date: site.photo?.date ?? null, gsdM: site.photo?.gsdM ?? g.gsdM }, parcel: site.sources.parcel, footprints: site.sources.footprints, canopyMap: site.sources.canopyMap });
}
