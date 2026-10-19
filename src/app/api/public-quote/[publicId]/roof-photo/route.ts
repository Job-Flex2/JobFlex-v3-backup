import { db } from "@/lib/db";
import { rateLimitShared, ipFromRequest, HOUR } from "@/lib/rateLimit";
import type { InstantRoofData } from "@/lib/eagleview";
import { loadRoofPicture } from "@/lib/roofPictureFetch";
import { roofFactsLine, roofStandInSvg, type RoofFrame } from "@/lib/roofPictures";

export const runtime = "nodejs";

// The client's roof from the air (2026-09-23): EagleView's clear ortho when
// the measurement carried imagery, else Google's satellite tile at the pin.
// The page puts one pin on the roof (lib/roofPictures) — never the outline
// (owner, 2026-10-12). ?f= is the frame the page chose and projected its pin
// onto (lib/roofPictureFetch, 2026-10-19: an ortho EagleView no longer serves
// falls to the satellite there); only that frame is served here. If no aerial
// can be fetched, a plain stand-in with the facts is sent — the page then
// draws no pin — so the picture is never broken.
const FRAMES: ReadonlyArray<RoofFrame["kind"]> = ["ortho", "satellite"];

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
  const asked = new URL(req.url).searchParams.get("f");
  if (asked !== "standin") {
    const shot = await loadRoofPicture({ ...row, instant }, FRAMES.find((k) => k === asked));
    if (shot.frame) return new Response(new Uint8Array(shot.bytes), { headers: { "Content-Type": shot.contentType, "Cache-Control": "public, max-age=86400, s-maxage=86400" } });
    if (!shot.frames) return new Response("Not found", { status: 404 });
  }
  const facts = roofFactsLine({ areaSqft: row.areaSqft, squares: row.squares, pitch: row.predominantPitch, facetCount: row.facetCount, measuredOn: row.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) });
  return new Response(roofStandInSvg(facts), { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=600" } });
}
