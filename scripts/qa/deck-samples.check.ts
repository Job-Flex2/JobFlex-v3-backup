// THE KIND PICKER'S SAMPLES AND PICTURES (2026-10-11, lib/deck/samples +
// lib/deck/iso): every sample is a design the engine builds as described,
// reads back the same through normalize, passes its own checks without a
// failure, prices, and draws as a small isometric picture with faces in the
// build order. Pure.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json scripts/qa/deck-samples.check.ts
import { DECK_SAMPLES, KINDS, KIND_WORDS, kindSample, sampleById, sampleDesign, samplesFor } from "../../src/lib/deck/samples";
import { isoDrawing, shadeHex } from "../../src/lib/deck/iso";
import { defaultDeckDesign, normalizeDeckDesign, hasDeck, hasRoof, STRUCTURES } from "../../src/lib/deck/design";
import { buildStructure } from "../../src/lib/deck/structure";
import { deckScene, parseDeckScene, SCENE_MAX_BOXES } from "../../src/lib/deck/scene";
import { deckChecks } from "../../src/lib/deck/checks";
import { priceDeck } from "../../src/lib/deck/pricing";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

check("four kinds, each with a card sample and words", KINDS.length === 4 && STRUCTURES.every((k) => samplesFor(k).length >= 3 && kindSample(k).structure === k && !!KIND_WORDS[k].blurb));
check("every sample id is unique", new Set(DECK_SAMPLES.map((s) => s.id)).size === DECK_SAMPLES.length);
check("a sample is found by id", sampleById("deck-classic")?.name === "Backyard deck with stairs" && sampleById("nope") === null);

for (const sample of DECK_SAMPLES) {
  const d = sampleDesign(sample);
  const again = normalizeDeckDesign(JSON.parse(JSON.stringify(d)));
  check(`${sample.id}: keeps its kind, floor and shape through normalize`, again.structure === sample.structure && again.floor === d.floor && JSON.stringify(again.shape) === JSON.stringify(d.shape) && again.roof.kind === d.roof.kind && again.roof.attach === d.roof.attach, `${again.structure}/${again.floor}/${again.roof.kind}/${again.roof.attach}`);
  check(`${sample.id}: the patch's own fields stand`, d.structure === sample.structure && (sample.patch.heightIn === undefined || d.heightIn === sample.patch.heightIn) && (sample.patch.rail?.type === undefined || d.rail.type === sample.patch.rail.type) && (sample.patch.stairs === undefined || d.stairs.length === sample.patch.stairs.length) && (sample.patch.lower?.on === undefined || d.lower.on === sample.patch.lower.on), `h ${d.heightIn} rail ${d.rail.type} stairs ${d.stairs.length} lower ${d.lower.on}`);
  const st = buildStructure(d);
  const scene = deckScene(st);
  check(`${sample.id}: builds and scenes within the caps`, scene.boxes.length > 0 && scene.boxes.length <= SCENE_MAX_BOXES && parseDeckScene(JSON.parse(JSON.stringify(scene))) !== null, `${scene.boxes.length} boxes, ${scene.polys.length} polys`);
  const checks = deckChecks(st);
  const fails = checks.filter((c) => c.level === "fail");
  check(`${sample.id}: no check fails`, fails.length === 0, fails.map((f) => `${f.part}: ${f.text}`).join(" | ").slice(0, 160));
  const pkg = priceDeck(d);
  check(`${sample.id}: prices`, pkg.subtotal > 500 && Number.isFinite(pkg.subtotal), `$${Math.round(pkg.subtotal)}`);
  check(`${sample.id}: has a deck ${hasDeck(d)} / a roof ${hasRoof(d)} as its kind says`, hasRoof(d) === (sample.structure !== "deck") && hasDeck(d) === (d.floor === "deck"));
  const iso = isoDrawing(scene);
  const vb = iso.viewBox.split(" ").map(Number);
  check(`${sample.id}: draws`, iso.faces.length >= 30 && iso.faces.length <= 6000 && vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 5 && vb[3] > 3 && iso.ranks.length >= 3, `${iso.faces.length} faces, ${iso.solids} solids, ${iso.ranks.length} ranks, viewBox ${iso.viewBox}`);
  check(`${sample.id}: the faces come in build order`, iso.faces.every((f, i) => i === 0 || f.rank >= -1) && iso.ranks.every((r, i) => i === 0 || r > iso.ranks[i - 1]));
  const attached = d.placement !== "detached" && !!scene.house;
  check(`${sample.id}: the house is behind it when attached (${attached})`, attached === iso.faces.some((f) => f.layer === "house") || d.placement === "detached");
  check(`${sample.id}: every path is closed and finite`, iso.faces.every((f) => /^M[-\d.,L]+Z$/.test(f.d)));
}

// The picture's maths.
check("shadeHex darkens and clamps", shadeHex("#808080", 0.5) === "#404040" && shadeHex("#ffffff", 2) === "#ffffff" && shadeHex("not", 0.5) === "not");
const stock = defaultDeckDesign();
const stockIso = isoDrawing(deckScene(buildStructure(stock)));
check("the stock deck draws with the ground first", stockIso.faces[0].layer === "ground" && stockIso.faces.length > 50, `${stockIso.faces.length} faces`);
const turned = isoDrawing(deckScene(buildStructure(stock)), { yawDeg: -34 });
check("a different yaw gives a different picture", turned.viewBox !== stockIso.viewBox || turned.faces[5].d !== stockIso.faces[5].d);
const capped = isoDrawing(deckScene(buildStructure(stock)), { maxSolids: 20 });
check("a tight budget drops the thin layers first, never the decking", capped.solids < stockIso.solids && capped.faces.some((f) => f.layer === "decking"), `${capped.solids} of ${stockIso.solids}`);
const noSkip = isoDrawing(deckScene(buildStructure(stock)), { skip: [] });
check("with nothing skipped the hardware is drawn too", noSkip.faces.some((f) => f.layer === "hardware") || noSkip.solids >= stockIso.solids);

console.log(bad ? `${bad} FAILED` : "ALL PASS");
process.exit(bad ? 1 : 0);
