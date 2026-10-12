import { db } from "@/lib/db";
import { rateLimitShared, ipFromRequest, HOUR } from "@/lib/rateLimit";
import { fetchPropertyImage, isEagleViewEnabled, type InstantRoofData } from "@/lib/eagleview";
import { satellitePhotoPng } from "@/lib/staticMapPhoto";
import { roofFactsLine, roofFrameFor, roofStandInSvg } from "@/lib/roofPictures";

export const runtime = "nodejs";

// The client's roof from the air (2026-09-23): EagleView's clear ortho when
// the measurement carried imagery, else Google's satellite tile at the pin.
// The page puts one pin on the roof (lib/roofPictures) — never the outline
// (owner, 2026-10-12). If the aerial cannot be fetched right now, a plain
// stand-in with the facts is sent (the page's pin lands on it the same), so
// the picture is never broken.
export async function GET(req: Request, ctx: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await ctx.params;
  const gate = await rateLimitShared(`roof-photo:${ipFromRequest(req)}`, 120, HOUR);
  if (!gate.ok) return new Response("Too many requests", { status: 429 });
  const proposal = await db.proposal.findUnique({ where: { publicId }, select: { id: true, organization: { select: { deletedAt: true } } } });
  if (!proposal || proposal.organization.deletedAt) return new Response("Not found", { status: 404 });
  let link: { roofMeasurementId: string } | null = null;
  try {
    link = await db.proposalSitePhoto.findUnique({ where: { proposalId: proposal.id }, select: { roofMeasurementId: true } });
  } catch {
    link = null;
  }
  if (!link) return new Response("Not found", { status: 404 });
  const row = await db.roofMeasurement.findUnique({ where: { id: link.roofMeasurementId }, select: { address: true, city: true, state: true, zip: true, lat: true, lng: true, instantJson: true, areaSqft: true, squares: true, predominantPitch: true, facetCount: true, createdAt: true } });
  if (!row) return new Response("Not found", { status: 404 });
  let instant: InstantRoofData | null = null;
  try { instant = row.instantJson ? (JSON.parse(row.instantJson) as InstantRoofData) : null; } catch { instant = null; }
  const frame = roofFrameFor(instant, row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : null, { ortho: isEagleViewEnabled(), satellite: Boolean(process.env.GOOGLE_MAPS_API_KEY) });
  if (!frame) return new Response("Not found", { status: 404 });
  const cache = { "Cache-Control": "public, max-age=86400, s-maxage=86400" };
  try {
    if (frame.kind === "ortho") {
      const img = await fetchPropertyImage(frame.token);
      return new Response(new Uint8Array(img.bytes), { headers: { "Content-Type": img.contentType || "image/png", ...cache } });
    }
    const photo = await satellitePhotoPng(row);
    if (photo.ok) return new Response(new Uint8Array(photo.bytes), { headers: { "Content-Type": "image/png", ...cache } });
  } catch {
    /* the aerial is unavailable right now — the stand-in below */
  }
  const facts = roofFactsLine({ areaSqft: row.areaSqft, squares: row.squares, pitch: row.predominantPitch, facetCount: row.facetCount, measuredOn: row.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) });
  return new Response(roofStandInSvg(facts), { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=600" } });
}
