// WHAT EVERY FIELD IS, SHOWN IN 3D (owner, 2026-10-12: "highlight all fields to show on 3D what it is — make it smart")
// — pure.
//
// lib/deck/fieldParts fieldLight: every field of the studio, by its label and where it sits, lights the parts it sets and
// tags them with the live numbers; prices and the address light nothing. One deck with all of it on (a covered gable,
// a lower level, two stairs, railing, a border and fascia, fixtures) and every label the studio shows.
//
// Run: npx tsx --tsconfig tsconfig.json scripts/qa/deck-field-parts.check.ts
import { applyDeckPatch } from "../../src/lib/deck/checks";
import { defaultDeckDesign } from "../../src/lib/deck/design";
import { fieldLight, type FieldFocus } from "../../src/lib/deck/fieldParts";
import { SCENE_LAYERS, deckScene } from "../../src/lib/deck/scene";
import { buildStructure } from "../../src/lib/deck/structure";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const base = defaultDeckDesign({ state: "WA", frostIn: 18 });
const stair = (id: string, side: "front" | "left" | "right", atFt: number, widthFt: number) => ({ id, side, atFt, widthFt, level: "upper" as const, wrap: false, wrapSides: 1 as const, landing: "pad" as const, handrail: "auto" as const });
const design = applyDeckPatch(base, {
  structure: "covered-deck",
  heightIn: 40,
  shape: { kind: "rect", widthFt: 20, depthFt: 14 },
  roof: { ...base.roof, kind: "gable" },
  rail: { ...base.rail, type: "aluminum" },
  stairs: [stair("s1", "front", 6, 4), stair("s2", "right", 7, 3)],
  decking: { ...base.decking, border: 1, fascia: "match" },
  electrical: { ...base.electrical, fixtures: [{ id: "f1", kind: "chandelier", qty: 1, supply: "we", at: null }, { id: "f2", kind: "post-cap", qty: 4, supply: "we", at: null }] },
} as never);
const s = buildStructure(design);
const sc = deckScene(s);
const layerCount = (idx: number[], layer: string) => idx.filter((i) => sc.boxes[i][0] === SCENE_LAYERS.indexOf(layer as never)).length;
const lit = (f: FieldFocus) => fieldLight(sc, s, f);

// Frame
const joists = lit({ label: "Joists", step: "Frame" });
const tape = lit({ label: "Joist tape on every top", step: "Frame" });
check("the tick \"Joist tape on every top\": the joists", !!tape && tape.boxIdx.length > 0 && tape.boxIdx.every((i) => sc.boxes[i][0] === SCENE_LAYERS.indexOf("joist")), tape?.tag?.text);
const eaves = lit({ label: "Fascia on the eaves (42 ft)", step: "step-roof" });
check("the tick \"Fascia on the eaves\": the eave fascia and sub-fascia, nothing else", !!eaves && eaves.boxIdx.length > 0 && eaves.boxIdx.every((i) => /^(fascia eave|subfascia)$/.test(sc.legend[sc.tags[i]].role)), eaves?.tag?.text);
const nJoists = sc.boxes.filter((b) => b[0] === SCENE_LAYERS.indexOf("joist")).length;
check("\"Joists\": every joist lit, tagged with the size, the spacing and the count", !!joists && layerCount(joists.boxIdx, "joist") === nJoists && joists.boxIdx.length === nJoists && /Joists · 2x\d+ at \d+ in\. on center · \d+ of them/.test(joists.tag?.text ?? ""), joists?.tag?.text);
const beams = lit({ label: "Beam size", step: "Frame" });
check("\"Beam size\": the beams (and their post caps)", !!beams && layerCount(beams.boxIdx, "beam") > 0 && /^Beams · /.test(beams.tag?.text ?? ""), beams?.tag?.text);
const posts = lit({ label: "Posts", step: "Frame" });
check("\"Posts\" in Frame: the deck's posts, not the roof's", !!posts && layerCount(posts.boxIdx, "post") > 0 && layerCount(posts.boxIdx, "roof-post") === 0, posts?.tag?.text);
const footings = lit({ label: "Footings", step: "Frame" });
check("\"Footings\": the footings", !!footings && footings.footings && /footing/.test(footings.tag?.text ?? ""), footings?.tag?.text);
const ledger = lit({ label: "Ledger fastened with", step: "Frame" });
check("\"Ledger fastened with\": the ledger and its fasteners", !!ledger && layerCount(ledger.boxIdx, "ledger") > 0 && layerCount(ledger.boxIdx, "hardware") > 0, ledger?.tag?.text);
// Site
const height = lit({ label: "Deck height", step: "step-site" });
check("\"Deck height\": a bar from the ground to the floor, and the posts", !!height && height.boxes.length === 1 && Math.abs(height.boxes[0][5] - (s.frame!.surfaceIn / 12)) < 0.01 && /3'-4" above the ground/.test(height.tag?.text ?? ""), height?.tag?.text);
const frost = lit({ label: "Frost depth", step: "step-site" });
check("\"Frost depth\": the footings, against the frost line", !!frost && frost.footings && /18-in\. frost line/.test(frost.tag?.text ?? ""), frost?.tag?.text);
// Shape
const along = lit({ label: "Along the house", step: "step-shape" });
check("\"Along the house\" (Shape): a bar along the deck's front, 20 ft", !!along && along.boxes.length === 1 && Math.abs(along.boxes[0][3] - along.boxes[0][0] - 20.28) < 0.05 && along.tag?.text === "20 ft along the house", along?.tag?.text);
const out = lit({ label: "Out from the house", step: "step-shape" });
check("\"Out from the house\": a bar down the side, 14 ft", !!out && out.tag?.text === "14 ft out from the house");
// Surface
const boards = lit({ label: "Deck boards", step: "Surface" });
check("\"Deck boards\": the boards", !!boards && layerCount(boards.boxIdx, "decking") > 0 && /^Deck boards · /.test(boards.tag?.text ?? ""), boards?.tag?.text);
const border = lit({ label: "Picture-frame border", step: "Surface" });
check("\"Picture-frame border\": only the border boards", !!border && border.boxIdx.length > 0 && border.boxIdx.every((i) => sc.legend[sc.tags[i]].role === "border board") && /1 row of boards/.test(border.tag?.text ?? ""), border?.tag?.text);
const fascia = lit({ label: "Fascia", step: "Surface" });
check("\"Fascia\" (Surface): the deck's fascia, not the roof's trim", !!fascia && layerCount(fascia.boxIdx, "fascia") > 0 && layerCount(fascia.boxIdx, "trim") === 0, fascia?.tag?.text);
// Roof
const rafters = lit({ label: "Rafters", step: "step-roof" });
check("\"Rafters\": the rafters (or trusses)", !!rafters && layerCount(rafters.boxIdx, "rafter") > 0 && /^(Rafters|Trusses) · /.test(rafters.tag?.text ?? ""), rafters?.tag?.text);
const roofing = lit({ label: "Roofing", step: "step-roof" });
check("\"Roofing\": the roof's faces", !!roofing && roofing.polyIdx.length > 0 && /^Roofing · /.test(roofing.tag?.text ?? ""), roofing?.tag?.text);
const roofPosts = lit({ label: "Posts", step: "step-roof" });
check("\"Posts\" in the Roof: the roof's posts, not the deck's", !!roofPosts && layerCount(roofPosts.boxIdx, "roof-post") > 0 && layerCount(roofPosts.boxIdx, "post") === 0, roofPosts?.tag?.text);
const pitch = lit({ label: "Pitch", step: "step-roof" });
check("\"Pitch\": the roof, tagged with its pitch", !!pitch && /:12$/.test(pitch.tag?.text ?? ""), pitch?.tag?.text);
// Stairs and railing
const s1 = lit({ label: "Width", step: "step-stairs", stair: "s1" });
const s2 = lit({ label: "Width", step: "step-stairs", stair: "s2" });
const nStairParts = sc.boxes.filter((b) => b[0] === SCENE_LAYERS.indexOf("stair")).length;
check("a stair's \"Width\": that stair's own parts, not the other stair's", !!s1 && !!s2 && s1.boxIdx.length > 0 && s2.boxIdx.length > 0 && s1.boxIdx.every((i) => !s2.boxIdx.includes(i)) && layerCount(s1.boxIdx, "stair") + layerCount(s2.boxIdx, "stair") === nStairParts, `${s1?.tag?.text} | ${s2?.tag?.text}`);
const rail = lit({ label: "Railing", step: "step-stairs" });
check("\"Railing\": the deck's railing, not the stairs' rails", !!rail && rail.boxIdx.length > 0 && rail.boxIdx.every((i) => !/^stair /.test(sc.legend[sc.tags[i]].role)) && /^Railing · /.test(rail.tag?.text ?? ""), rail?.tag?.text);
// Lights
const f1 = lit({ label: "How many", step: "step-electrical", fixture: "f1" });
const f2 = lit({ label: "How many", step: "step-electrical", fixture: "f2" });
check("a fixture's \"How many\": that fixture's own lights", !!f1 && !!f2 && f1.boxIdx.length >= 1 && f2.boxIdx.length >= 1 && f1.boxIdx.every((i) => !f2.boxIdx.includes(i)) && /^Chandelier/.test(f1.tag?.text ?? ""), `${f1?.tag?.text} | ${f2?.tag?.text}`);
// Nothing to show
for (const label of ["Unit", "Qty", "Price", "Your price", "Job address", "Item"]) check(`"${label}": nothing lit`, lit({ label, step: "step-photo" }) === null && lit({ label }) === null);

// Every label the studio shows, in its step: lit, or one of the few with nothing in the 3D.
const STUDIO: Array<[string, string, Partial<FieldFocus>?]> = [
  ["Where it stands", "step-structure"], ["It stands", "step-roof"], ["Storeys", "step-house"], ["Roof", "step-house"], ["Siding", "step-house"], ["Roof colour", "step-house"], ["The wall's shape", "step-house"],
  ["Along the house", "step-shape"], ["Out from the house", "step-shape"], ["The front edge", "step-shape"],
  ["How it meets the house", "step-site"], ["The house wall there", "step-site"], ["Deck height", "step-site"], ["Frost depth", "step-site"], ["Footings stand above grade", "step-site"], ["Design load", "step-site"], ["Soil bears", "step-site"], ["Falls away from the house", "step-site"], ["Falls left to right", "step-site"],
  ["Framing lumber", "Frame"], ["Spans and prices as", "Frame"], ["Joists", "Frame"], ["Joist spacing", "Frame"], ["Beams", "Frame"], ["Beam made of", "Frame"], ["Beam size", "Frame"], ["Posts", "Frame"], ["Joists past the beam", "Frame"], ["Ledger fastened with", "Frame"], ["Ties to the house", "Frame"], ["Footings", "Frame"],
  ["Deck boards", "Surface"], ["Laid like", "Surface"], ["Pattern", "Surface"], ["Picture-frame border", "Surface"], ["Fastened with", "Surface"], ["Fascia", "Surface"], ["Waste", "Surface"], ["Counted as", "Surface"],
  ["Roof shape", "step-roof"], ["Height to the headers", "step-roof"], ["Posts", "step-roof"], ["Headers (beams on the posts)", "step-roof"], ["Overhang past the posts", "step-roof"], ["Pitch", "step-roof"], ["Rafters", "step-roof"], ["Rafter spacing", "step-roof"], ["At the ridge", "step-roof"], ["Roofing", "step-roof"], ["Ceiling", "step-roof"], ["Fascia finish", "step-roof"], ["Gutters", "step-roof"], ["Roof load", "step-roof"],
  ["Railing", "step-stairs"], ["Height", "step-stairs"], ["Infill", "step-stairs"], ["Posts apart", "step-stairs"], ["Your railing", "step-stairs"],
  ["Down the", "step-stairs", { stair: "s1" }], ["Centred at", "step-stairs", { stair: "s1" }], ["Width", "step-stairs", { stair: "s1" }], ["Lands on", "step-stairs", { stair: "s1" }], ["Handrail", "step-stairs", { stair: "s1" }],
  ["What", "step-electrical", { fixture: "f1" }], ["Who buys the fixture", "step-electrical", { fixture: "f1" }], ["How many", "step-electrical", { fixture: "f2" }], ["Panel to the structure", "step-electrical"], ["The feed comes from the", "step-electrical"],
  // the ticks, by their words
  ["A lower level in front, a step down", "step-shape"], ["Dig to the frost line anyway", "step-site"], ["Doubled rim and outside joists", "Frame"], ["Joist tape on every top", "Frame"], ["Knee braces at corner posts over 2 ft", "Frame"], ["Mid-span blocking on spans over 8 ft", "Frame"], ["Under-deck drainage — a dry room below", "Surface"],
  ["Knee braces at the posts", "step-roof"], ["Cupola at the peak", "step-roof"], ["Fascia on the eaves (42 ft)", "step-roof"], ["Rake boards on the gable ends (28 ft)", "step-roof"], ["Vented soffit under the overhang", "step-roof"], ["Gutter guards", "step-roof"],
  ["A flat 2x6 drink cap", "step-stairs"], ["Rail on the lower level too", "step-stairs"], ["Box steps wrapping the deck (three risers at most)", "step-stairs", { stair: "s1" }], ["Stainless connectors — within 300 ft of salt water", "step-stairs"], ["A timer or photocell on the lights", "step-electrical"],
];
const dark = STUDIO.filter(([label, step, more]) => !lit({ label, step, ...(more ?? {}) }));
// The lower level's fields, on a deck that has one: its own parts, tagged.
const two = buildStructure(applyDeckPatch(base, { heightIn: 40, shape: { kind: "rect", widthFt: 20, depthFt: 12 }, lower: { ...base.lower, on: true, widthFt: 12, depthFt: 8, dropIn: 18, align: "centre" } } as never));
const twoSc = deckScene(two);
const low = fieldLight(twoSc, two, { label: "Step down", step: "step-shape", level: "lower" });
const lowAlong = fieldLight(twoSc, two, { label: "Along the house", step: "step-shape", level: "lower" });
check("the lower level's \"Step down\" and \"Along the house\": the lower level's own parts, tagged", !!low && low.boxIdx.length > 0 && low.boxIdx.every((i) => twoSc.legend[twoSc.tags[i]].role.startsWith("lower level")) && low.tag?.text === "The lower level · 1'-6\" down" && !!lowAlong && lowAlong.boxes.length === 1, `${low?.tag?.text} | ${lowAlong?.tag?.text}`);
check(`every field the studio shows lights something on this deck (${STUDIO.length} fields)`, dark.length === 0, dark.map(([l, st]) => `${l} (${st})`).join(", ") || "all lit");

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
