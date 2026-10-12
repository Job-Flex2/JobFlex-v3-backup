// AUTO-FIX AND THE CHECKS' CHOICES (2026-10-11, owner: "offer fixes or auto fix"): no post or roof post past the
// tables any more (the engine places posts for the load), auto-fix clears every failure it can and the warnings the
// code answers, keeps the rest for a person, never leaves more failing than it found, and does nothing twice. Pure.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json scripts/qa/deck-autofix.check.ts
import { applyDeckPatch, deckChecks } from "../../src/lib/deck/checks";
import { defaultDeckDesign, defaultRoofDesign, type DeckDesign } from "../../src/lib/deck/design";
import { autoFixDesign, autoFixable } from "../../src/lib/deck/settle";
import { buildStructure } from "../../src/lib/deck/structure";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const run = (d: DeckDesign) => deckChecks(buildStructure(d));
const fails = (d: DeckDesign) => run(d).filter((c) => c.level === "fail");
const has = (d: DeckDesign, id: string, level?: string) => run(d).some((c) => c.id === id && (!level || c.level === level));

// The engine: posts held to the tables on decks of every size and on covered decks up to the 40 ft a truss spans,
// at 40 and 60 psf. (Wider, a gable's king post honestly carries more than a footing table reads — see below.)
let over = 0, n = 0, heaviest = 0;
for (const structure of ["deck", "covered-deck"] as const) for (const W of structure === "deck" ? [12, 16, 20, 24, 30, 36, 44] : [12, 16, 20, 24, 30, 36]) for (const D of [10, 12, 14, 16, 20, 24]) for (const load of [40, 60] as const) {
  const base = defaultDeckDesign({ state: "MN" });
  const d = applyDeckPatch(base, { structure, shape: { kind: "rect", widthFt: W, depthFt: D }, heightIn: 48, loadPsf: load, roof: structure === "covered-deck" ? { ...defaultRoofDesign("covered-deck"), kind: "hip", attach: "wall" } : base.roof });
  const st = buildStructure(d);
  n++;
  for (const p of st.frame?.posts ?? []) heaviest = Math.max(heaviest, p.tributarySqFt);
  if (deckChecks(st).some((c) => ["post-area", "footing-size", "roof-post-footing", "roof-footings"].includes(c.id) && c.level === "fail")) over++;
}
check("no post, footing or roof post past its table on any of these decks", over === 0 && heaviest <= 160, `${over} of ${n} over; heaviest post ${Math.round(heaviest)} sq ft`);
// Past the truss span: a 44 ft gable's king post brings down more than any footing table — said for an engineer, never hidden.
{
  const wide = applyDeckPatch(defaultDeckDesign({ state: "MN" }), { structure: "covered-deck", shape: { kind: "rect", widthFt: 44, depthFt: 24 }, heightIn: 48, roof: { ...defaultRoofDesign("covered-deck"), kind: "hip", attach: "wall" } });
  const c = run(wide).find((x) => x.id === "roof-post-footing");
  const deckPostsOk = (buildStructure(wide).frame?.posts ?? []).filter((p) => !(p as { roof?: unknown }).roof).every((p) => p.tributarySqFt <= 160);
  check("a 44 ft gable (past a truss's 40 ft): the roof post's overload is said, for an engineer; the deck's own posts stay in the table", c?.level === "fail" && /engineer/i.test(c.text) && deckPostsOk, c?.text.slice(0, 90));
  check("…and auto-fix leaves no more failing than it found", fails(autoFixDesign(wide).design).length <= fails(wide).length);
}

// A deck with a hand-picked failure and a missing guard.
const base = defaultDeckDesign({ state: "TX" });
const broken = applyDeckPatch(base, { shape: { kind: "rect", widthFt: 16, depthFt: 16 }, heightIn: 48, framing: { joist: "2x6", spacingIn: 24 }, rail: { type: "none" } });
check("the broken deck fails its framing (2x6 at 24 in. under these boards) and needs a guard", fails(broken).length > 0 && has(broken, "guard", "warn"), fails(broken).map((c) => c.id).join(","));
check("the guard offers three railings: the fix and two choices", (run(broken).find((c) => c.id === "guard")?.alts ?? []).length === 2);
check("auto-fix counts what it will take on", autoFixable(run(broken)) >= 2, String(autoFixable(run(broken))));
const fixed = autoFixDesign(broken);
check("auto-fix: nothing fails, the guard is in", fails(fixed.design).length === 0 && fixed.design.rail.type !== "none" && !has(fixed.design, "guard", "warn"), `${fails(fixed.design).map((c) => c.id).join(",")} rail ${fixed.design.rail.type}`);
check("…and says what it did", fixed.fixes.length >= 2 && fixed.fixes.some((f) => /railing/.test(f)), fixed.fixes.join(" · "));
const again = autoFixDesign(fixed.design);
check("a second auto-fix does nothing", again.fixes.length === 0 && JSON.stringify(again.design) === JSON.stringify(fixed.design), again.fixes.join(" · "));

// The roof's shape: a hip too narrow for its wall becomes a gable, or a shed by choice.
const narrowHip = applyDeckPatch(base, { structure: "covered-deck", shape: { kind: "rect", widthFt: 14, depthFt: 12 }, roof: { ...defaultRoofDesign("covered-deck"), kind: "hip", attach: "wall" } });
const kindCheck = run(narrowHip).find((c) => c.id === "roof-kind");
check("an attached hip too narrow: the check offers a gable, and a shed", kindCheck?.level === "warn" && /gable/.test(kindCheck.fix?.label ?? "") && (kindCheck.alts ?? []).some((a) => /shed/.test(a.label)), kindCheck?.text.slice(0, 80));
const roofFixed = autoFixDesign(narrowHip);
check("auto-fix makes it the gable it is framed as; the warning goes", roofFixed.design.roof.kind === "gable" && !has(roofFixed.design, "roof-kind"), roofFixed.fixes.join(" · "));

// A low pitch offers metal as the other answer.
const lowPitch = applyDeckPatch(base, { structure: "covered-deck", roof: { ...defaultRoofDesign("covered-deck"), kind: "shed", pitch: 2 } });
const pitchCheck = run(lowPitch).find((c) => c.id === "roof-pitch");
check("a 2:12 shingle roof: 4:12, or standing-seam metal", !!pitchCheck && (pitchCheck.alts ?? []).some((a) => /metal/.test(a.label)), pitchCheck?.text.slice(0, 60));
check("…a pitch warning is a choice: auto-fix leaves it", autoFixDesign(lowPitch).design.roof.pitch === 2);

// Every fix and choice the checks offer is a real change, and none of them makes more fail.
let noop = 0, worse = 0, tried = 0;
const designs: DeckDesign[] = [broken, narrowHip, lowPitch, applyDeckPatch(base, { heightIn: 96, rail: { type: "none" }, footing: { type: "pier-block" } }), applyDeckPatch(base, { framing: { species: "spf" } })];
for (const d of designs) {
  const before = fails(d).length;
  for (const c of run(d)) for (const f of [c.fix, ...(c.alts ?? [])]) {
    if (!f) continue;
    tried++;
    const t = applyDeckPatch(d, f.patch);
    if (JSON.stringify(t) === JSON.stringify(d)) noop++;
    if (fails(t).length > before) worse++;
  }
}
check("every offered fix changes the design, and none makes more fail", tried > 5 && noop === 0 && worse === 0, `${tried} tried, ${noop} did nothing, ${worse} made more fail`);

// Auto-fix never leaves more failing than it found, on a sweep of hand picks.
let regress = 0, swept = 0;
for (const joist of ["2x6", "2x8", "auto"] as const) for (const post of ["4x4", "6x6"] as const) for (const H of [20, 48, 96]) for (const W of [12, 20, 30]) {
  const d = applyDeckPatch(base, { shape: { kind: "rect", widthFt: W, depthFt: 14 }, heightIn: H, framing: { joist, post }, rail: { type: "none" } });
  swept++;
  if (fails(autoFixDesign(d).design).length > fails(d).length) regress++;
}
check("auto-fix never leaves more failing than it found", regress === 0, `${regress} of ${swept}`);

console.log(bad ? `${bad} FAILED` : "ALL PASS");
process.exit(bad ? 1 : 0);
