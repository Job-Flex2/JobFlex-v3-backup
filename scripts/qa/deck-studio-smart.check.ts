// The studio's smarts (2026-10-10): a gazebo's roof follows the deck it stands on and keeps the deck's size when it
// leaves the deck; the roof's pitch is a handle at the peak; a resize settles the member picks to the tables.
//   npx --no-install tsx --tsconfig tsconfig.json scripts/qa/deck-studio-smart.check.ts
import { applyDeckPatch, deckChecks } from "../../src/lib/deck/checks";
import { defaultDeckDesign, defaultStair } from "../../src/lib/deck/design";
import { priceStructure } from "../../src/lib/deck/pricing";
import { deckScene } from "../../src/lib/deck/scene";
import { buildStructure } from "../../src/lib/deck/structure";
import { AUTO_FIX, resizes, roofResizes, settleDesign } from "../../src/lib/deck/settle";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const base = defaultDeckDesign({ state: "WA", frostIn: 18 });

// ── a gazebo's roof follows the deck it stands on
const gazebo = applyDeckPatch(base, { structure: "gazebo", floor: "deck" });
check("a new gazebo over a deck has a roof that follows the deck", gazebo.roof.plan.shape === "follows-deck", gazebo.roof.plan.shape);
const g16 = buildStructure(gazebo);
const g20 = buildStructure(applyDeckPatch(gazebo, { shape: { ...gazebo.shape, widthFt: 20 } }));
check("…so a deck typed 20 ft wide grows the roof with it", !!g16.roof && !!g20.roof && g20.roof.footprintSqFt > g16.roof.footprintSqFt * 1.15, `${g16.roof?.footprintSqFt.toFixed(0)} → ${g20.roof?.footprintSqFt.toFixed(0)} sq ft under the eaves`);
const onSlab = applyDeckPatch(gazebo, { floor: "slab" });
check("off the deck the gazebo is a square of the deck's shorter side", onSlab.roof.plan.shape === "square" && onSlab.roof.plan.widthFt === 12, `${onSlab.roof.plan.shape} ${onSlab.roof.plan.widthFt}`);
const pergolaSlab = applyDeckPatch(applyDeckPatch(base, { structure: "pergola", floor: "deck" }), { floor: "slab" });
check("…and a pergola a rectangle of the deck's size", pergolaSlab.roof.plan.shape === "rect" && pergolaSlab.roof.plan.widthFt === 16 && pergolaSlab.roof.plan.depthFt === 12, `${pergolaSlab.roof.plan.shape} ${pergolaSlab.roof.plan.widthFt}×${pergolaSlab.roof.plan.depthFt}`);
const typedSquare = applyDeckPatch(onSlab, { roof: { ...onSlab.roof, plan: { ...onSlab.roof.plan, widthFt: 20 } } });
check("a square typed 20 ft stays 20 ft", typedSquare.roof.plan.widthFt === 20 && typedSquare.roof.plan.depthFt === 20);

// ── the pitch handle
const covered = applyDeckPatch(base, { structure: "covered-deck" });
const cs = buildStructure(covered);
const cp = { roof: cs.roof };
const scene = deckScene(cs);
const pitch = scene.handles.find((h) => h.kind === "pitch");
check("a covered deck's scene carries a pitch handle at the peak", !!pitch && pitch.axis === "z" && pitch.value === covered.roof.pitch && near(pitch.z, cp.roof!.peakIn / 12, 0.01), JSON.stringify(pitch));
check("…a unit of pitch is the run's twelfth: the rise over the pitch", !!pitch && near(pitch.perUnit, (cp.roof!.peakIn - cp.roof!.headerTopIn) / 12 / covered.roof.pitch, 0.002), `${pitch?.perUnit} vs ${((cp.roof!.peakIn - cp.roof!.headerTopIn) / 12 / covered.roof.pitch).toFixed(4)} (peak ${cp.roof!.peakIn} in., header top ${cp.roof!.headerTopIn} in., pitch ${covered.roof.pitch}:12, kind ${cp.roof!.kind})`);
const pergola = applyDeckPatch(base, { structure: "pergola" });
check("a pergola has no pitch to drag", !deckScene(buildStructure(pergola)).handles.some((h) => h.kind === "pitch"));

// ── settling after a resize: the engine adds beams and posts under a small pick on its own (that is the "support
// exchanging"); only a pick a check refuses outright, with a fix, is settled — whichever of these the tables refuse.
const candidates: Array<[string, Parameters<typeof applyDeckPatch>[1]]> = [
  ["diagonal boards with the joists held at 16 in.", { decking: { pattern: "diagonal" }, framing: { spacingIn: 16 } }],
  ["dropped beams on a deck 14 in. high", { heightIn: 14, framing: { beamStyle: "dropped" } }],
  ["joists held at 24 in. under composite boards", { decking: { product: "composite-better" }, framing: { spacingIn: 24 } }],
  ["2-2x6 headers held under a 24 ft roof", { structure: "covered-deck", shape: { kind: "rect", widthFt: 24, depthFt: 12 }, roof: { ...base.roof, header: "2-2x6" } }],
];
let refused: { name: string; design: ReturnType<typeof applyDeckPatch>; fails: string[] } | null = null;
for (const [name, p] of candidates) {
  const d = applyDeckPatch(base, p);
  const fails = deckChecks(buildStructure(d)).filter((c) => c.level === "fail" && c.fix && AUTO_FIX.test(c.id));
  if (fails.length) { refused = { name, design: d, fails: fails.map((c) => c.id) }; break; }
}
check("the engine carries a small hand pick by adding support, so most picks never fail; one of these the tables refuse outright", !!refused, refused ? `${refused.name}: ${refused.fails.join(",")}` : "none refused");
const settled = refused ? settleDesign(refused.design) : null;
const after = settled ? deckChecks(buildStructure(settled.design)).filter((c) => c.level === "fail" && AUTO_FIX.test(c.id)) : [];
check("settling applies the check's own fix and says what it did", !!settled && settled.fixes.length >= 1 && after.length === 0, settled ? settled.fixes.join(" · ") : "");
check("the engine itself re-sizes a 2x6 deck grown to 16 ft deep: a middle beam, no fail", (() => { const d = applyDeckPatch(base, { framing: { joist: "2x6" }, shape: { kind: "rect", widthFt: 16, depthFt: 16 } }); const st = buildStructure(d); return st.frame !== null && st.frame.beams.length >= 2 && !deckChecks(st).some((c) => c.level === "fail"); })());
const happy = settleDesign(base);
check("a design the tables are happy with is left alone", happy.fixes.length === 0 && happy.design === base);
check("a resize is a shape, a height, a level, a placement, a floor or a structure change", resizes({ shape: base.shape }) && resizes({ heightIn: 40 }) && !resizes({ photo: null }) && roofResizes({ pitch: 6 }) && !roofResizes({ roofing: "metal-panel" }));

// ── the stairs' width: a knob on the flight's far side; the stringers, treads and the price re-count from it
const withStair = (ft: number) => applyDeckPatch(base, { stairs: [{ ...defaultStair("s1", "front", 8), widthFt: ft }] });
const s4 = buildStructure(withStair(4));
const s8 = buildStructure(withStair(8));
const wk = deckScene(s4).handles.find((h) => h.kind === "stair-width");
const st4 = s4.stairs[0];
check("a front stair carries a width knob on its far side, half-way down, along the house", !!wk && wk.axis === "x" && wk.value === 4 && !!st4 && Math.abs(wk.x - (st4.footprint[1].x + st4.footprint[2].x) / 2 / 12) < 0.01 && wk.z < s4.frame!.surfaceIn / 12 && wk.z > 0, JSON.stringify(wk));
check("…a wrap of box steps has none", !deckScene(buildStructure(applyDeckPatch(base, { heightIn: 18, stairs: [{ ...defaultStair("s1", "front", 8), wrap: true }] }))).handles.some((h) => h.kind === "stair-width"));
const bom = (s: ReturnType<typeof buildStructure>) => priceStructure(s).bom.filter((l) => l.step === "stairs");
const stringers = (s: ReturnType<typeof buildStructure>) => bom(s).find((l) => /stringer/i.test(l.label) && !/connector/i.test(l.label))?.qty ?? 0;
const treads = (s: ReturnType<typeof buildStructure>) => bom(s).filter((l) => /tread|riser/i.test(l.label)).reduce((a, l) => a + l.qty, 0);
const total = (s: ReturnType<typeof buildStructure>) => priceStructure(s).subtotal;
check("stairs widened 4 → 8 ft: more stringers (16 in. apart), more tread and riser stock, a higher price", s8.stairs[0].stringers.count > st4.stringers.count && stringers(s8) > stringers(s4) && treads(s8) > treads(s4) && total(s8) > total(s4), `${st4.stringers.count} → ${s8.stairs[0].stringers.count} stringers · stringer stock ${stringers(s4)} → ${stringers(s8)} · treads+risers ${treads(s4)} → ${treads(s8)} · $${total(s4)} → $${total(s8)}`);

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
