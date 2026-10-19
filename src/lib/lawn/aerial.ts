// THE AERIAL PHOTO AND THE TREES' HEIGHT, FETCHED (2026-10-18). Server-only.
//
// The photo is the USDA's National Agriculture Imagery Program (NAIP): every state flown at least every three years,
// 30–60 cm a pixel, red, green, blue AND near-infrared — public domain, so it may be measured from (Google's satellite
// tiles may not: their terms forbid tracing or extracting from them). It's read through Microsoft's Planetary Computer:
// a STAC search for the newest flight over the point, then its data API cuts the lot out on our own Web Mercator grid,
// once in true colour and once with near-infrared in place of red. The trees' height is the Meta / World Resources
// Institute 1 m canopy-height map (CC BY 4.0), a cloud-optimized GeoTIFF read a window at a time. Buildings, where the
// county's record has no footprint, come from USA Structures (FEMA and Oak Ridge National Laboratory: every building
// over 450 sq ft in the US, public domain), a hosted feature layer queried by the lot's box.
import "server-only";
import { createRequire } from "node:module";
import { externalFetch } from "@/lib/externalCall";
import type { Grid, LatLng } from "./geo";

const require_ = createRequire(import.meta.url);

const STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const DATA = "https://planetarycomputer.microsoft.com/api/data/v1";
const CANOPY = "https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm";
const STRUCTURES = "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0/query";

export type PhotoItem = { id: string; date: string; gsdM: number };

/** The newest flight over the point — the finer of two flights a year or two apart (a 30 cm flight beats a newer
 *  60 cm one by little time). Null where there is none (outside the US). */
export async function findPhoto(p: LatLng): Promise<PhotoItem | null> {
  const res = await externalFetch(
    "naip",
    "search",
    STAC,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ collections: ["naip"], intersects: { type: "Point", coordinates: [p.lng, p.lat] }, sortby: [{ field: "datetime", direction: "desc" }], limit: 6 }),
    },
    { timeoutMs: 12_000, attempts: 2 },
  );
  const j = (await res.json()) as { features?: Array<{ id: string; properties: { datetime?: string; gsd?: number } }> };
  const items = (j.features ?? []).filter((f) => f.properties.datetime).map((f) => ({ id: f.id, date: f.properties.datetime!, gsdM: Number(f.properties.gsd) || 0.6 }));
  if (!items.length) return null;
  const newest = items[0];
  const t0 = new Date(newest.date).getTime();
  const close = items.filter((x) => t0 - new Date(x.date).getTime() < 2.2 * 365 * 24 * 3600 * 1000);
  return close.sort((a, b) => a.gsdM - b.gsdM || new Date(b.date).getTime() - new Date(a.date).getTime())[0];
}

/** The data API's address for a crop of the photo on our grid: "rgb" true colour, "cir" near-infrared, red, green. */
export function photoCropUrl(itemId: string, g: Pick<Grid, "box" | "w" | "h">, kind: "rgb" | "cir"): string {
  const bidx = kind === "rgb" ? "1,2,3" : "4,1,2";
  const q = new URLSearchParams({ collection: "naip", item: itemId, assets: "image", asset_bidx: `image|${bidx}`, coord_crs: "epsg:3857", dst_crs: "epsg:3857", resampling: "bilinear" });
  return `${DATA}/item/bbox/${g.box.map((v) => v.toFixed(2)).join(",")}/${g.w}x${g.h}.png?${q.toString()}`;
}

type Png = { width: number; height: number; channels: number; data: Uint8Array | Uint8ClampedArray | Uint16Array };

async function fetchPng(url: string): Promise<Png> {
  const res = await externalFetch("naip", "crop", url, {}, { timeoutMs: 25_000, attempts: 2 });
  const buf = new Uint8Array(await res.arrayBuffer());
  const { decode } = require_("fast-png") as { decode: (b: Uint8Array) => Png };
  return decode(buf);
}

/** The photo on the grid: true colour (interleaved RGB) and near-infrared, byte for byte. */
export async function readPhoto(item: PhotoItem, g: Grid): Promise<{ rgb: Uint8Array; nir: Uint8Array }> {
  const [a, b] = await Promise.all([fetchPng(photoCropUrl(item.id, g, "rgb")), fetchPng(photoCropUrl(item.id, g, "cir"))]);
  const N = g.w * g.h;
  if (a.width !== g.w || a.height !== g.h || b.width !== g.w || b.height !== g.h) throw new Error("The photo came back the wrong size");
  const rgb = new Uint8Array(N * 3);
  const nir = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    rgb[i * 3] = a.data[i * a.channels];
    rgb[i * 3 + 1] = a.data[i * a.channels + 1];
    rgb[i * 3 + 2] = a.data[i * a.channels + 2];
    nir[i] = b.data[i * b.channels];
  }
  return { rgb, nir };
}

/** The map is tiled by zoom-9 quadkey. */
function quadkey(p: LatLng, z = 9): string {
  const s = Math.sin((p.lat * Math.PI) / 180);
  const x = Math.floor(((p.lng + 180) / 360) * 2 ** z);
  const y = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z);
  let q = "";
  for (let i = z; i > 0; i--) {
    let d = 0;
    const m = 1 << (i - 1);
    if (x & m) d++;
    if (y & m) d += 2;
    q += d;
  }
  return q;
}

type Tiff = { getImage: () => Promise<{ getOrigin: () => number[]; getResolution: () => number[]; readRasters: (o: object) => Promise<ArrayLike<number>[]> }> };
const tiffs = new Map<string, Promise<Tiff>>();

/** Canopy height, metres, on the grid — null where the map has no tile or it can't be read. */
export async function readCanopy(g: Grid, center: LatLng): Promise<Float32Array | null> {
  try {
    const key = quadkey(center);
    let t = tiffs.get(key);
    if (!t) {
      const GeoTIFF = require_("geotiff") as { fromUrl: (u: string) => Promise<Tiff> };
      t = GeoTIFF.fromUrl(`${CANOPY}/${key}.tif`);
      tiffs.set(key, t);
      if (tiffs.size > 24) tiffs.delete(tiffs.keys().next().value!);
    }
    const img = await (await t).getImage();
    const [ox, oy] = img.getOrigin();
    const [rx, ry] = img.getResolution();
    const [x0, y0, x1, y1] = g.box;
    const win = [Math.floor((x0 - ox) / rx), Math.floor((y1 - oy) / ry), Math.ceil((x1 - ox) / rx), Math.ceil((y0 - oy) / ry)];
    const ras = await img.readRasters({ window: win, width: g.w, height: g.h, interleave: false, resampleMethod: "bilinear" });
    return Float32Array.from(ras[0]);
  } catch {
    tiffs.delete(quadkey(center));
    return null;
  }
}

export type Structure = { ring: LatLng[]; use: string | null; sqft: number | null; address: string | null; residential: boolean };

/** Every building in a lat/lng box from USA Structures — [] when the service doesn't answer. */
export async function readStructures(box: { west: number; south: number; east: number; north: number }): Promise<Structure[]> {
  const q = new URLSearchParams({
    geometry: [box.west, box.south, box.east, box.north].map((v) => v.toFixed(6)).join(","),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "OCC_CLS,PRIM_OCC,SQFEET,PROP_ADDR",
    returnGeometry: "true",
    outSR: "4326",
    f: "json",
  });
  try {
    const res = await externalFetch("usa-structures", "query", `${STRUCTURES}?${q.toString()}`, {}, { timeoutMs: 12_000, attempts: 2 });
    const j = (await res.json()) as { features?: Array<{ attributes: { OCC_CLS?: string; PRIM_OCC?: string; SQFEET?: number; PROP_ADDR?: string }; geometry?: { rings?: number[][][] } }> };
    return (j.features ?? [])
      .filter((f) => f.geometry?.rings?.[0]?.length)
      .map((f) => ({
        ring: f.geometry!.rings![0].map(([x, y]) => ({ lat: y, lng: x })),
        use: f.attributes.PRIM_OCC ?? f.attributes.OCC_CLS ?? null,
        sqft: Number.isFinite(f.attributes.SQFEET) ? Number(f.attributes.SQFEET) : null,
        address: f.attributes.PROP_ADDR?.trim() || null,
        residential: /residential/i.test(f.attributes.OCC_CLS ?? ""),
      }));
  } catch {
    return [];
  }
}
