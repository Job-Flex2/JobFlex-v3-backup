// GET /api/parcel-tiles/{z}/{x}/{y} — proxy for ReportAll's parcel-boundary
// raster tiles, so the client key never reaches the browser. Tiles ride a
// SEPARATE ALLTIME quota (20000) from parcel lookups, and the browser cache is
// the first line of thrift: tiles are immutable for our purposes, so they ship
// with a year-long Cache-Control and a repeat pan costs nothing.
//
// ReportAll serves tiles for zoom 14–21; anything else is answered locally
// with 204 so a stray zoom level cannot spend quota.

import { NextResponse } from "next/server";
import { NoOrgError, UnauthorizedError, requireOrg } from "@/lib/orgContext";
import { rateLimitShared, MINUTE } from "@/lib/rateLimit";
import { notePaidCall } from "@/lib/trialMeter";
import { PLAN_NEEDED_MESSAGE, planOpen } from "@/lib/paidCaps";

export const runtime = "nodejs";

const TILE_BASE = "https://reportallusa.com/dyn/tile.py";
const MIN_ZOOM = 14;
const MAX_ZOOM = 21;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ z: string; x: string; y: string }> },
) {
  // A tile is paid (ReportAll): for a member of a company that holds an open
  // plan (2026-10-12, money audit P0-7) — not any session, not after the
  // plan ended. The refusal is never cached, so a renewed plan sees tiles.
  let organizationId: string;
  let userId: string;
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
    userId = ctx.user.id;
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof NoOrgError) return new NextResponse(null, { status: 401, headers: { "Cache-Control": "no-store" } });
    throw err;
  }
  if (!(await planOpen(organizationId, userId))) {
    return new NextResponse(PLAN_NEEDED_MESSAGE, { status: 402, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
  }
  const gate = await rateLimitShared(`tiles:${userId}`, 600, 10 * MINUTE);
  if (!gate.ok) return new NextResponse(null, { status: 429 });
  const key = process.env.REPORTALL_CLIENT_KEY;
  if (!key) return new NextResponse(null, { status: 503 });

  const { z, x, y } = await ctx.params;
  const zi = parseInt(z, 10);
  const xi = parseInt(x, 10);
  const yi = parseInt(y, 10);
  if (![zi, xi, yi].every(Number.isFinite) || zi < MIN_ZOOM || zi > MAX_ZOOM) {
    return new NextResponse(null, { status: 204 });
  }

  const qs = new URLSearchParams({
    map: "siteroot/Base_Layers.map",
    layer: "Parcels",
    mode: "tile",
    tilemode: "gmap",
    tile: `${xi} ${yi} ${zi}`,
    client: key,
  });

  try {
    const res = await fetch(`${TILE_BASE}?${qs}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return new NextResponse(null, { status: 502 });
    // A tile spends the tile allowance — the trial meter's (lib/trialMeter).
    await notePaidCall("reportall", "tile", { orgId: organizationId });
    const body = await res.arrayBuffer();
    return new NextResponse(body, {
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "image/png",
        // Immutable enough: parcel line-work changes on a cadastral timescale.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
