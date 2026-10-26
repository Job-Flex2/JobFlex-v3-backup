// The satellite photo of a measured roof — Google Static Maps, centred on the
// measurement's point, disk-cached by address + zoom. Server-only. Lifted out
// of actions/roofMeasurement (2026-09-13) so the client's public proposal
// page can show the same photo without a session: the action wraps this for
// the estimator, the site-photo route streams it to the homeowner.
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { instantAddressKey, type InstantRoofData } from "@/lib/eagleview";
import { notePaidCall } from "@/lib/trialMeter";

export const STATICMAP_ZOOM = 20;
export const STATICMAP_PX = 640; // logical size; scale=2 doubles the pixels
const STATICMAP_DIR = join(process.cwd(), ".cache", "staticmap");

export interface PhotoSubject {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  instantJson: string | null;
}

export async function satellitePhotoPng(row: PhotoSubject): Promise<{ ok: true; bytes: Buffer; zoom: number } | { ok: false; error: string }> {
  if (!process.env.GOOGLE_MAPS_API_KEY) return { ok: false, error: "Google Maps is not configured (GOOGLE_MAPS_API_KEY)" };

  let lat = row.lat;
  let lng = row.lng;
  if ((lat == null || lng == null) && row.instantJson) {
    // Older rows sometimes carry no pin — the outlines' centre serves.
    try {
      const instant = JSON.parse(row.instantJson) as InstantRoofData;
      const all = instant.structures.flatMap((st) => st.outline ?? []);
      if (all.length) {
        lat = all.reduce((s, p) => s + p.lat, 0) / all.length;
        lng = all.reduce((s, p) => s + p.lng, 0) / all.length;
      }
    } catch {
      /* photo can still come from the pin */
    }
  }
  if (lat == null || lng == null) return { ok: false, error: "No coordinates on this measurement" };
  const zoom = STATICMAP_ZOOM;

  const keyBase = instantAddressKey({ address: row.address ?? "", city: row.city ?? "", state: row.state ?? "", zip: row.zip ?? "" }).replace(/[^A-Za-z0-9]+/g, "-");
  // Different pins at one street address must not reuse a photo centered on
  // another building (particularly when confirming a Google roof estimate).
  const file = join(STATICMAP_DIR, `${keyBase}-${lat.toFixed(6)}-${lng.toFixed(6)}-z${zoom}.png`);
  try {
    return { ok: true, bytes: await fs.readFile(file), zoom };
  } catch {
    /* miss — fetch below */
  }

  const params = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: String(zoom),
    size: `${STATICMAP_PX}x${STATICMAP_PX}`,
    scale: "2",
    maptype: "satellite",
    key: process.env.GOOGLE_MAPS_API_KEY,
  });
  try {
    // Outside production a stand-in may answer instead of Google (STATICMAP_BASE — the stand draws its own aerial).
    const base = (process.env.NODE_ENV !== "production" && process.env.STATICMAP_BASE?.trim()) || "https://maps.googleapis.com";
    const res = await fetch(`${base.replace(/\/$/, "")}/maps/api/staticmap?${params}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `Static Maps refused (${res.status})${detail ? `: ${detail.slice(0, 120)}` : ""}` };
    }
    await notePaidCall("google-static-maps", "staticmap");
    const bytes = Buffer.from(await res.arrayBuffer());
    try {
      await fs.mkdir(STATICMAP_DIR, { recursive: true });
      await fs.writeFile(file, bytes);
    } catch {
      /* cache is an optimisation; a failed write costs one repeat request */
    }
    return { ok: true, bytes, zoom };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.name === "TimeoutError" ? "Static map timed out" : err instanceof Error ? err.message : "Satellite photo unavailable" };
  }
}
