// The USDA aerial photo's crop for the lawn estimator's map (2026-10-18): the same crop the property was read from,
// fetched from the Planetary Computer and passed through, so the browser shows exactly what was measured. Signed-in
// preview users only — this is not an open image proxy.
import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/orgContext";
import { canUseLawnEstimator } from "@/lib/lawn/access";
import { photoCropUrl } from "@/lib/lawn/aerial";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const ctx = await requireOrg();
    if (!(await canUseLawnEstimator(ctx.user))) return new NextResponse("Not found", { status: 404 });
  } catch {
    return new NextResponse("Sign in", { status: 401 });
  }
  const u = new URL(req.url);
  const item = u.searchParams.get("item") ?? "";
  const box = (u.searchParams.get("box") ?? "").split(",").map(Number);
  const w = Number(u.searchParams.get("w"));
  const h = Number(u.searchParams.get("h"));
  const kind = u.searchParams.get("kind") === "cir" ? "cir" : "rgb";
  if (!/^[a-z]{2}_m_[\w-]{6,80}$/i.test(item) || box.length !== 4 || !box.every(Number.isFinite) || !(w > 0 && w <= 1400 && h > 0 && h <= 1400)) return new NextResponse("Bad request", { status: 400 });
  const res = await fetch(photoCropUrl(item, { box: box as [number, number, number, number], w, h }, kind), { cache: "no-store" }).catch(() => null);
  if (!res || !res.ok) return new NextResponse("The aerial photo didn't load", { status: 502 });
  return new NextResponse(await res.arrayBuffer(), { status: 200, headers: { "content-type": "image/png", "cache-control": "private, max-age=604800" } });
}
