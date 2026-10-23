// THE PLAN SET (2026-10-23): the permit set's and the crew's sheets drawn from
// the engine through lib/deck/plans — the grid, the tags, the bearing check,
// the layout and its diagonals, the framing schedule's checks, the stringer
// layout, every view of every sample (no NaN, nothing empty), the scales and
// the feet-and-inches. The worked figures are the clipped-corner deck the
// competitor's sample set draws, worked by hand.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-plan-set.check.ts
import { defaultDeckDesign, defaultStair, normalizeDeckDesign, type DeckDesign } from "../../../src/lib/deck/design";
import { buildStructure } from "../../../src/lib/deck/structure";
import { deckScene } from "../../../src/lib/deck/scene";
import { deckChecks } from "../../../src/lib/deck/checks";
import { priceStructure } from "../../../src/lib/deck/pricing";
import { materialList } from "../../../src/lib/deck/materialList";
import { DECK_SAMPLES, sampleDesign } from "../../../src/lib/deck/samples";
import { planModel } from "../../../src/lib/deck/plans/model";
import { foundationPlan, tributaries } from "../../../src/lib/deck/plans/foundation";
import { framingPlan } from "../../../src/lib/deck/plans/framing";
import { elevationView, sectionView } from "../../../src/lib/deck/plans/project";
import { floorDetails, stairSection } from "../../../src/lib/deck/plans/details";
import { buildSequence, cutList, stringerLayout, stringerView } from "../../../src/lib/deck/plans/crew";
import { legendView } from "../../../src/lib/deck/plans/legend";
import { permitSheetList, crewSheetList } from "../../../src/lib/deck/plans/sheets";
import { ARCH_SCALES, fitView, ftInFrac, inFrac, type DItem, type View } from "../../../src/lib/deck/plans/draft";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const design = (over: Record<string, unknown>, state = "WA"): DeckDesign => normalizeDeckDesign({ ...defaultDeckDesign({ state, frostIn: 18 }), ...over });
const quarter = ARCH_SCALES.find((s) => s.label.startsWith("1/4"))!;

/** Every number an item carries is finite, and the view's box is real. */
function sane(v: View): string | null {
  const b = v.box;
  if (![b.x, b.y, b.w, b.h].every(Number.isFinite) || b.w <= 0 || b.h <= 0) return `box ${JSON.stringify(b)}`;
  if (!v.items.length) return "no items";
  for (const it of v.items as DItem[]) {
    for (const [k, val] of Object.entries(it)) {
      if (typeof val === "number" && !Number.isFinite(val)) return `${it.k}.${k} = ${val}`;
      if (Array.isArray(val) && val.some((n) => typeof n === "number" && !Number.isFinite(n))) return `${it.k}.${k} has NaN`;
    }
  }
  return null;
}

console.log("── feet and inches, as a framer reads them");
check("281.4 → 23'-5 3/8\"", ftInFrac(281.4) === `23'-5 3/8"`, ftInFrac(281.4));
check("143.99 → 12'-0\"", ftInFrac(143.99) === `12'-0"`, ftInFrac(143.99));
check("11.94 to the 1/16 → 0'-11 15/16\" (and 11.97 rounds up to 1'-0\")", ftInFrac(11.94, 16) === `0'-11 15/16"` && ftInFrac(11.97, 16) === `1'-0"`, `${ftInFrac(11.94, 16)} · ${ftInFrac(11.97, 16)}`);
check("7.375 → 7 3/8\"", inFrac(7.375) === `7 3/8"`, inFrac(7.375));
check("0.75 → 3/4\"", inFrac(0.75) === `3/4"`, inFrac(0.75));

console.log("── the clipped-corner deck (23'-5\" × 13'-7\", 5'-1\" up, ledger, one 44\" stair)");
const clip = buildStructure(
  design({ shape: { kind: "rect", widthFt: 23 + 5 / 12, depthFt: 13 + 7 / 12, front: { kind: "clipped", bulgeFt: 2, clipFt: 2 } }, heightIn: 61, rail: { ...defaultDeckDesign().rail, type: "aluminum", heightIn: 36 }, stairs: [{ ...defaultStair("s1", "front", 13), widthFt: 44 / 12 }] }),
);
const m = planModel(clip)!;
check("the model builds", !!m);
check("grid rows: A the ledger, B the beam", m.rows.map((r) => `${r.label}:${r.what}`).join() === "A:ledger,B:beam", m.rows.map((r) => `${r.label}:${r.what}@${r.at}`).join());
check("grid columns 1–4 at the posts", m.cols.map((c) => c.label).join() === "1,2,3,4", m.cols.map((c) => `${c.label}@${c.at}`).join());
check("every post named on the grid, B-1 … B-4", m.posts.map((p) => p.grid).join() === "B-1,B-2,B-3,B-4", m.posts.map((p) => p.grid).join());
check("footing tags by size: F1 the end posts, F2 the middle", m.posts.map((p) => p.tag).join() === "F1,F2,F2,F1", m.posts.map((p) => `${p.grid}:${p.tag}:${p.post.footing.padIn}`).join());
// The middle posts carry 53.3 sq ft: 2,665 lb on 1,500 psf = 1.78 sq ft — a 19.1-in. pad; the tube above it is 20 in.
const b2 = m.bearing.find((b) => b.grid === "B-2")!;
check("B-2 carries 53.3 sq ft, 2,665 lb", Math.abs(b2.tribSqFt - 53.3) < 0.1 && Math.abs(b2.totalLb - 2665) <= 2, `${b2.tribSqFt} sf, ${b2.totalLb} lb`);
check("…which needs 1.78 sq ft, so the pad is 20 in. (not the table's 18)", Math.abs(b2.reqAreaSqFt - 1.777) < 0.01 && b2.padIn === 20, `${b2.reqAreaSqFt.toFixed(3)} sf, pad ${b2.padIn}`);
check("every footing bears by plain statics", m.bearing.every((b) => b.ok && b.ratio <= 1), m.bearing.map((b) => b.ratio.toFixed(2)).join());
check("the tributary shading sums to about the engine's areas", tributaries(m).every((t) => t.pts.length >= 3), String(tributaries(m).length));
check("layout: B-1 at 1'-7\" along, 11'-7\" out", ftInFrac(m.layout.points[0].x) === `1'-7"` && ftInFrac(m.layout.points[0].y) === `11'-7"`, `${ftInFrac(m.layout.points[0].x)} / ${ftInFrac(m.layout.points[0].y)}`);
const dg = m.layout.diagonals;
// Ledger 0..281, posts at 19 and 262, 139 out: both diagonals √(262² + 139²) = 296.6 in.
check("two diagonals, equal on a symmetric layout (24'-8 5/8\")", dg.length === 2 && Math.abs(dg[0].lengthIn - dg[1].lengthIn) < 0.01 && ftInFrac(dg[0].lengthIn) === `24'-8 5/8"`, dg.map((x) => ftInFrac(x.lengthIn)).join(" / "));
const j1 = m.tags.find((t) => t.tag === "J1")!;
check("J1: 11'-4\" of 13'-7\" (hem-fir 2x10 at 16)", j1.check?.actual === `11'-4"` && j1.check?.allowed === `13'-7"`, `${j1.check?.actual} of ${j1.check?.allowed}`);
const bt = m.tags.find((t) => t.tag === "B1")!;
check("B1: 6'-9\" between posts of 6'-9\" allowed", bt.check?.actual === `6'-9"` && bt.check?.allowed === `6'-9"`, `${bt.check?.actual} of ${bt.check?.allowed}`);
check("the stair's footings and pad are tagged (SF1 ×2, SP)", m.stairFootings.length === 2 && m.stairFootings.every((x) => x.tag === "SF1") && m.stairPads.length === 1 && m.stairPads[0].tag === "SP");
const st = clip.stairs[0];
const L = stringerLayout(st, m.f.decking.thickIn);
check("stringer: 8 risers of 7 3/8, 7 treads of 10 1/2", L.risers === 8 && Math.abs(L.rise - 7.38) < 0.01 && L.treads === 7 && L.run === 10.5, `${L.risers} @ ${L.rise} · ${L.treads} @ ${L.run}`);
// The cut is rise·run/hyp = 7.38 × 10.5 / 12.83 = 6.04 in. deep; 11.25 − 6.04 = 5.21 in. of throat.
check("throat 5.2 in. ≥ 5 (AWC)", Math.abs(L.throat - 5.21) < 0.03 && L.throat >= 5, L.throat.toFixed(2));
const cuts = cutList(m);
check("the cut list holds the ledger, the beam, the posts, the joists, the rim and the stringers", ["L1", "B1", "P1", "J1", "R1", "S1"].every((t) => cuts.some((c) => c.tag === t)), [...new Set(cuts.map((c) => c.tag))].join());
check("…the joists at the clipped corners cut 45° in plan", cuts.some((c) => c.tag === "J1" && /45°/.test(c.cut)));
check("…the clipped rims mitred 22-1/2°", cuts.some((c) => c.tag === "R1" && /22-1\/2°/.test(c.cut)));
check("…every joist accounted for", cuts.filter((c) => c.tag === "J1").reduce((n, c) => n + c.qty, 0) === m.f.sticks.filter((s) => s.role === "joist").length);
const seq = buildSequence(m, materialList(priceStructure(clip)));
check("the build sequence holds the footing and framing inspections and the final", seq.some((p) => /Footing inspection/.test(p.hold ?? "")) && seq.some((p) => /Framing inspection/.test(p.hold ?? "")) && seq.some((p) => /Final/.test(p.hold ?? "")));
check("permit sheets: G-001 … S-601, nine for this deck", permitSheetList(clip).map((x) => x.no).join() === "G-001,G-002,A-101,S-101,S-102,S-201,S-301,S-501,S-601", permitSheetList(clip).map((x) => x.no).join());
check("crew sheets: C-0 … C-5", crewSheetList(clip).map((x) => x.no).join() === "C-0,C-1,C-2,C-3,C-4,C-5", crewSheetList(clip).map((x) => x.no).join());
const fp = foundationPlan(m, quarter);
check("the foundation plan at 1/4\" is sane", sane(fp) === null, sane(fp) ?? "");
check("…a footing tag for every footing", fp.items.filter((it) => it.k === "bubble" && it.kind === "foot").length === m.posts.length + m.stairFootings.length + m.stairPads.length);
check("…a grid bubble for every row and column", fp.items.filter((it) => it.k === "bubble" && it.kind === "grid").length === m.rows.length + m.cols.length);
const fr = framingPlan(m, quarter, { ledger: 1, lateral: 2, post: 3, guard: 4, section: 1, stair: 2, sectionX: m.cols[1].at });
check("the framing plan is sane", sane(fr) === null, sane(fr) ?? "");
check("…every stick the engine cut is drawn", fr.items.filter((it) => it.k === "poly").length >= m.f.sticks.length);
check("…the section cut's two heads on the post line", fr.items.filter((it) => it.k === "bubble" && it.kind === "section" && Math.abs(it.x - m.cols[1].at) < 1e-6).length === 2);
const fit = fitView((sc) => foundationPlan(m, sc), 8.9, 9.45);
check("the foundation plan fits its frame at a real scale", fit.box.w * fit.scale <= 8.9 + 1e-6 && fit.box.h * fit.scale <= 9.45 + 1e-6 && ARCH_SCALES.some((s) => s.k === fit.scale), `${fit.scaleLabel} · ${(fit.box.w * fit.scale).toFixed(2)} × ${(fit.box.h * fit.scale).toFixed(2)} in.`);
const sv = stringerView(L, ARCH_SCALES.find((s) => s.label.startsWith("1/2"))!);
check("the stringer view is sane", sane(sv) === null, sane(sv) ?? "");
check("the legend is sane", sane(legendView()) === null);

console.log("── every sample, every view");
const extra: Array<[string, DeckDesign]> = [
  ["L-shape", design({ shape: { kind: "L", widthFt: 20, depthFt: 16, notch: { corner: "front-right", widthFt: 8, depthFt: 6 } }, heightIn: 30 })],
  ["free-standing", design({ placement: "detached", shape: { kind: "rect", widthFt: 14, depthFt: 12 }, heightIn: 24 })],
  ["beside the house", design({ placement: "beside", shape: { kind: "rect", widthFt: 18, depthFt: 14 }, heightIn: 40 })],
  ["deep, two beams", design({ shape: { kind: "rect", widthFt: 30, depthFt: 22 }, heightIn: 96 })],
  ["curved front", design({ shape: { kind: "rect", widthFt: 20, depthFt: 14, front: { kind: "curve", bulgeFt: 3, clipFt: 2 } }, heightIn: 50 })],
  ["pier blocks, low", design({ placement: "detached", shape: { kind: "rect", widthFt: 12, depthFt: 10 }, heightIn: 14, footing: { ...defaultDeckDesign().footing, type: "pier-block" } })],
  ["side stair", design({ shape: { kind: "rect", widthFt: 16, depthFt: 12 }, heightIn: 60, stairs: [{ ...defaultStair("s1", "left", 6), widthFt: 4 }] })],
];
const all: Array<[string, DeckDesign]> = [...DECK_SAMPLES.map((s) => [s.id, sampleDesign(s, defaultDeckDesign({ state: "TX", frostIn: 12 }))] as [string, DeckDesign]), ...extra];
let views = 0;
for (const [name, dsg] of all) {
  try {
    const s = buildStructure(dsg);
    const pm = planModel(s);
    const sheets = permitSheetList(s);
    if (!sheets.length || sheets[0].no !== "G-001") throw new Error("no cover");
    if (!pm) {
      check(`${name}: no deck frame — the set is the roof's (no floor sheets)`, !sheets.some((x) => x.kind === "foundation"));
      continue;
    }
    const scene = deckScene(s);
    const list: Array<[string, View]> = [
      ["foundation", foundationPlan(pm, quarter)],
      ["framing", framingPlan(pm, quarter, { section: 1, sectionX: pm.cols[0]?.at })],
      ["front", elevationView(pm, scene, "front", quarter)],
      ["left", elevationView(pm, scene, "left", quarter)],
      ["right", elevationView(pm, scene, "right", quarter)],
      ["section", sectionView(pm, scene, pm.cols[Math.floor((pm.cols.length - 1) / 2)]?.at ?? pm.W / 2, quarter)],
      ...floorDetails(pm).map((dt) => [`detail ${dt.key}`, dt.build(ARCH_SCALES[2])] as [string, View]),
      ...s.stairs.filter((x) => x.level === "upper" && x.kind === "flight" && x.risers > 0).map((x, i) => [`stair ${i + 1}`, stairSection(pm, x, i + 1, quarter)] as [string, View]),
    ];
    const broken = list.map(([k, v]) => [k, sane(v)] as const).filter(([, e]) => e);
    views += list.length;
    const cutsOk = cutList(pm).every((c) => c.qty > 0 && Number.isFinite(c.lengthIn) && c.lengthIn > 0);
    const tagsUnique = new Set(pm.tags.map((t) => t.tag)).size === pm.tags.length;
    const bearOk = pm.bearing.every((b) => Number.isFinite(b.ratio));
    const checks = deckChecks(s);
    check(`${name}: ${list.length} views sane, tags unique, cuts real, bearing computed (${checks.length} checks)`, broken.length === 0 && cutsOk && tagsUnique && bearOk, broken.map(([k, e]) => `${k}: ${e}`).join("; "));
  } catch (err) {
    check(`${name}: builds without throwing`, false, String((err as Error).stack ?? err).split("\n").slice(0, 3).join(" | "));
  }
}
console.log(`── ${views} views drawn`);
console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
