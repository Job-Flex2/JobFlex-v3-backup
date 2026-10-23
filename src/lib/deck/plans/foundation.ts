// THE FOUNDATION PLAN (2026-10-23) — pure. What the footing inspector walks:
// every footing where the engine put it, to scale, on the grid — the post on
// its pier, the pad below grade dashed — each tagged to the footing schedule,
// the deck it carries shaded and its area written in, the post spacings and
// the distances back to the house as dimension strings, the deck and its
// stairs above shown as phantoms. Model inches, y out from the house (down
// the sheet), x along it.
import { orientedRect, flat, clipPoly, centroid, rectPts, type V2 } from "./geom";
import { Sketch, TINTS, type ArchScale, type View } from "./draft";
import type { PlanModel } from "./model";

const POST_W: Record<string, number> = { "4x4": 3.5, "4x6": 3.5, "6x6": 5.5, "8x8": 7.5 };

export function foundationPlan(m: PlanModel, sc: ArchScale, opts: { north?: number } = {}): View {
  const k = new Sketch(sc.k);
  const p = (v: number) => k.p(v);
  const { f, W, D, outline } = m;
  const yMax = Math.max(D, ...m.stairPads.flatMap((sp) => sp.pts.map((q) => q.y)), ...m.s.stairs.flatMap((st) => st.footprint.map((q) => q.y)));
  const xMin = Math.min(0, ...m.s.stairs.flatMap((st) => st.footprint.map((q) => q.x)));
  const xMax = Math.max(W, ...m.s.stairs.flatMap((st) => st.footprint.map((q) => q.x)));

  // ── The house, its face along y = 0.
  if (m.house) {
    const ext = p(0.35);
    k.rect(xMin - ext, -p(0.22), xMax - xMin + 2 * ext, p(0.22), "heavy", "poche");
    k.text((xMin + xMax) / 2, -p(0.3), "EXISTING HOUSE", "md", { anchor: "middle", bold: true });
  }

  // ── The deck it all carries, shaded by the post that carries it.
  const shaded = tributaries(m);
  shaded.forEach((t, i) => {
    if (t.pts.length < 3) return;
    k.poly(flat(t.pts), null, TINTS[i % TINTS.length]);
  });
  // The deck above: its outline, phantom.
  k.poly(flat(outline), "phantom", "none");
  if (m.attached) k.line(0, 0, W, 0, "hidden");

  // ── The grid.
  const gx0 = xMin - p(0.92);
  const gy1 = yMax + p(0.95);
  for (const r of m.rows) {
    k.line(gx0 + p(0.15), r.at, xMax + p(0.25), r.at, "center");
    k.bubble(gx0, r.at, "grid", r.label);
  }
  for (const c of m.cols) {
    k.line(c.at, -p(m.house ? 0.05 : 0.25), c.at, gy1 - p(0.15), "center");
    k.bubble(c.at, gy1, "grid", c.label);
  }

  // ── The beams above, hidden, each tagged.
  for (const b of f.beams) {
    k.line(b.x0, b.y, b.x1, b.y, "hidden");
  }

  // ── Every footing: the pad below grade (dashed), the pier, the post, its tag.
  for (const pp of m.posts) {
    const q = pp.post;
    const ft = q.footing;
    const pw = POST_W[q.size] ?? 5.5;
    if (ft.type === "poured") {
      k.circle(q.x, q.y, ft.padIn / 2, "hidden", "none");
      k.circle(q.x, q.y, ft.pierIn / 2, "medium", "concrete");
    } else {
      k.rect(q.x - ft.padIn / 2, q.y - ft.padIn / 2, ft.padIn, ft.padIn, "medium", "concrete");
    }
    k.rect(q.x - pw / 2, q.y - pw / 2, pw, pw, "medium", "ink");
    // The tag up and to the right, clear of the pad.
    const r = Math.max(ft.padIn / 2, ft.pierIn / 2) + p(0.06);
    k.bubble(q.x + r * 0.75 + p(0.09), q.y - r * 0.75 - p(0.09), "foot", pp.tag);
  }

  // ── The stairs: their footprint above (phantom), their footings, the pad.
  m.s.stairs.forEach((st, i) => {
    if (st.level !== "upper" || st.footprint.length < 3) return;
    k.poly(flat(st.footprint), "phantom", "none");
    const c = centroid(st.footprint);
    k.text(c.x, c.y - p(0.05), `STAIR ${i + 1} ABOVE`, "sm", { anchor: "middle", tone: "muted" });
  });
  for (const sp of m.stairPads) {
    k.poly(flat(sp.pts), "medium", "concrete");
    const c = centroid(sp.pts);
    k.bubble(c.x, c.y, "foot", sp.tag);
  }
  for (const sf of m.stairFootings) {
    const ft = sf.footing;
    k.circle(sf.x, sf.y, ft.padIn / 2, "hidden", "none");
    k.circle(sf.x, sf.y, ft.pierIn / 2, "medium", "concrete");
    const sw = POST_W[m.footings.find((t) => t.tag === sf.tag)?.post ?? "4x4"] ?? 3.5;
    k.rect(sf.x - sw / 2, sf.y - sw / 2, sw, sw, "medium", "ink");
    k.bubble(sf.x + ft.padIn / 2 + p(0.12), sf.y, "foot", sf.tag);
  }

  // ── The tributary areas, lettered.
  shaded.forEach((t) => {
    if (t.pts.length < 3) return;
    const c = centroid(t.pts);
    // Toward the house from the post, clear of its tag.
    const post = m.posts.find((pp) => pp.grid === t.grid)?.post;
    const y = post ? Math.min(c.y, post.y - p(0.42)) : c.y;
    k.text(c.x, y, `${t.sqFt.toFixed(1)} SF`, "sm", { anchor: "middle", bold: true, tone: "blue", halo: true });
    k.text(c.x, y + p(0.11), t.grid, "xs", { anchor: "middle", tone: "muted", mono: true });
  });

  // ── Dimensions: the post spacing along the front, the overall, and back to the house.
  const front = [...f.beams].sort((a, b) => b.y - a.y)[0];
  if (front) {
    const xs = [front.x0, ...front.postXs, front.x1];
    const yDim = yMax;
    k.chain(xs.map((x) => [x, yDim] as [number, number]), -0.32);
    k.dim(0, yDim, W, yDim, -0.62);
  }
  // Left side: house → each row → the front.
  const ys = [...new Set([0, ...m.rows.map((r) => r.at), D].map((v) => Math.round(v * 8) / 8))].sort((a, b) => a - b);
  const xDim = xMin;
  // (A dimension's offset is to the left of its direction: going down the sheet that is +x — so negative here.)
  k.chain(ys.map((y) => [xDim, y] as [number, number]), -0.32);
  if (ys.length > 2) k.dim(xDim, 0, xDim, D, -0.62);

  // ── The notes a footing inspector reads off the plan.
  const pp0 = m.posts[0];
  if (pp0) {
    const q = pp0.post;
    const ft = q.footing;
    const tx = q.x + p(0.9);
    const ty = q.y + Math.max(p(0.75), (D - q.y) * 0.55);
    k.leader(
      q.x + (POST_W[q.size] ?? 5.5) / 2,
      q.y + (POST_W[q.size] ?? 5.5) / 2,
      tx,
      ty,
      ft.type === "poured"
        ? [`${q.size} POST ON POST BASE, TYP.`, `${ft.pierIn}" PIER ON ${ft.padIn}" × ${ft.padThickIn}" PAD,`, `BOTTOM ${ft.depthIn}" BELOW GRADE`]
        : [`${q.size} POST ON PRECAST PIER BLOCK, TYP.`, `ON COMPACTED GRAVEL`],
      "dot",
      "sm",
    );
  }
  k.north(xMax + p(0.6), -p(0.05), opts.north ?? 0);
  return k.view("foundation", "Foundation plan", sc.label);
}

/**
 * The deck each post carries, as polygons for the plan: across, halfway to the next post (or the beam's end); out,
 * halfway back to the support behind (the ledger, a beam) and forward to the next one or the deck's edge — clipped to
 * the deck's real outline, so a clipped corner shades what it really is. The engine's own area is printed with it.
 */
export function tributaries(m: PlanModel): Array<{ grid: string; pts: V2[]; sqFt: number }> {
  const { f, outline } = m;
  const supports = [...new Set([...(m.attached || m.house ? [0] : []), ...f.beams.map((b) => b.y)])].sort((a, b) => a - b);
  const D = m.D;
  const out: Array<{ grid: string; pts: V2[]; sqFt: number }> = [];
  for (const pp of m.posts) {
    const q = pp.post;
    if (q.roof) continue;
    const beam = f.beams.find((b) => b.id === q.beamId);
    if (!beam) continue;
    const xs = [...beam.postXs].sort((a, b) => a - b);
    const i = xs.findIndex((x) => Math.abs(x - q.x) < 1);
    const left = i <= 0 ? beam.x0 : (xs[i - 1] + xs[i]) / 2;
    const right = i < 0 || i >= xs.length - 1 ? beam.x1 : (xs[i] + xs[i + 1]) / 2;
    const si = supports.findIndex((y) => Math.abs(y - beam.y) < 1);
    const behind = si > 0 ? supports[si - 1] : null;
    const ahead = si >= 0 && si < supports.length - 1 ? supports[si + 1] : null;
    const y0 = behind == null ? beam.y : (behind + beam.y) / 2;
    const y1 = ahead == null ? D + 1 : (beam.y + ahead) / 2;
    const zones = f.zones.map((z) => z.zone);
    // Clip to the deck: its outline, and the rectangles of the zones the beam runs under (an L's other leg is not its load).
    let poly = clipPoly(rectPts(left, y0, right, y1), outline);
    const zr = zones.filter((z) => beam.zoneIds.includes(z.id));
    if (zr.length === 1) poly = clipPoly(poly, rectPts(zr[0].x0, zr[0].y0, zr[0].x1, zr[0].y1));
    out.push({ grid: pp.grid, pts: poly, sqFt: q.tributarySqFt });
  }
  return out;
}

/** A stair's member as a plan outline (used by the framing plan for stringers and treads). */
export function memberOutline(mb: { cx: number; cy: number; sx: number; sy: number; yaw: number }): V2[] {
  return orientedRect(mb.cx, mb.cy, mb.sx, mb.sy, mb.yaw);
}
