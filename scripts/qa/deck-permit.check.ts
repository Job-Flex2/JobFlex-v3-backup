// The permit set's drawings as data (2026-10-10, lib/deck/permit): which sheets a structure needs, the section's
// footing below the frost line and its dimensions, the details each deck gets, the material list by step — and the
// 3D's parts: every tilted member's ends land on something (the free-standing deck's cross braces once hung in the air).
//   npx --no-install tsx --tsconfig tsconfig.json scripts/qa/deck-permit.check.ts
import { applyDeckPatch } from "../../src/lib/deck/checks";
import { defaultDeckDesign } from "../../src/lib/deck/design";
import { detailDrawings, materialSchedule, permitPages, sectionDrawing } from "../../src/lib/deck/permit";
import { priceStructure } from "../../src/lib/deck/pricing";
import { buildStructure } from "../../src/lib/deck/structure";
import { SCENE_LAYERS, deckScene } from "../../src/lib/deck/scene";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const base = defaultDeckDesign({ state: "WA", frostIn: 18 });
const deck = buildStructure(base);
const covered = buildStructure(applyDeckPatch(base, { structure: "covered-deck", shape: { kind: "rect", widthFt: 22.5, depthFt: 20 } }));
const slabGazebo = buildStructure(applyDeckPatch(base, { structure: "gazebo", floor: "slab" }));
const free = buildStructure(applyDeckPatch(base, { placement: "detached", shape: { kind: "rect", widthFt: 20, depthFt: 14 }, heightIn: 60 }));
const railed = buildStructure(applyDeckPatch(base, { rail: { type: "treated" } }));
const hip = buildStructure(applyDeckPatch(base, { structure: "covered-deck", shape: { kind: "rect", widthFt: 30, depthFt: 10 }, roof: { ...base.roof, kind: "hip" } }));
const deckGazebo = buildStructure(applyDeckPatch(base, { structure: "gazebo", floor: "deck" }));
const freeShed = buildStructure(applyDeckPatch(base, { structure: "covered-deck", placement: "detached", roof: { ...base.roof, kind: "shed", attach: "free" } }));

// ── the sheets
const kinds = (s: ReturnType<typeof buildStructure>) => permitPages(s).map((p) => p.kind).join(",");
check("a deck: floor plan, elevation, section, details, schedules, materials, notes", kinds(deck) === "floor,elevation,section,details,schedules,materials,notes", kinds(deck));
check("a covered deck adds the roof framing plan after the floor plan", kinds(covered) === "floor,roof,elevation,section,details,schedules,materials,notes", kinds(covered));
check("a gazebo on a slab has no floor plan and no section", kinds(slabGazebo) === "roof,elevation,details,schedules,materials,notes", kinds(slabGazebo));
check("the sheets are numbered A1… then S1, S2, S3", permitPages(covered).map((p) => p.no).join(",") === "A1,A2,A3,A4,A5,S1,S2,S3");

// ── the section
const sec = sectionDrawing(deck)!;
const texts = (d: typeof sec) => d.items.filter((i) => i.t === "text" || i.t === "dim").map((i) => (i.t === "text" ? i.s : i.label));
const rects = (d: typeof sec) => d.items.filter((i): i is Extract<(typeof d.items)[number], { t: "rect" }> => i.t === "rect");
check("the section draws the ledger on the house, a joist, the decking, a beam, a post and its footing", rects(sec).length >= 7 && texts(sec).some((x) => /ledger/.test(x)) && texts(sec).some((x) => /beam/.test(x)) && texts(sec).some((x) => /post on a post base/.test(x)));
const footing = rects(sec).filter((r) => r.cls === "concrete").sort((a, b) => a.z - b.z)[0];
check("…the footing pad sits below the frost line", !!footing && footing.z <= -base.frostIn, `pad bottom ${footing?.z} in., frost ${base.frostIn} in.`);
check("…with the deck height, the joist span, the depth and the footing depth dimensioned", texts(sec).some((x) => /deck height/.test(x)) && texts(sec).some((x) => /joist span/.test(x)) && texts(sec).some((x) => /below grade/.test(x)) && texts(sec).some((x) => /deep$/.test(x)), texts(sec).join(" | "));
check("…and the guard when there is a rail", texts(sec).some((x) => /in\. guard/.test(x)) === deck.rails.on);
check("a gazebo on a slab has no section", sectionDrawing(slabGazebo) === null);
const freeSec = sectionDrawing(free)!;
check("a free-standing deck's section has no ledger", !texts(freeSec).some((x) => /ledger/.test(x)) && !freeSec.items.some((i) => i.t === "rect" && i.cls === "hatch"));

// ── the details
const titles = (s: ReturnType<typeof buildStructure>) => detailDrawings(s).map((d) => d.title);
check("an attached deck without a rail details the ledger and the post and footing", !deck.rails.on && titles(deck).join(",") === "Ledger attachment,Post, beam and footing", titles(deck).join(","));
check("…with a rail it adds the guard post", railed.rails.on && titles(railed).join(",") === "Ledger attachment,Post, beam and footing,Guard post", titles(railed).join(","));
check("…and the section then draws the guard", texts(sectionDrawing(railed)!).some((x) => /in\. guard/.test(x)));
check("…the ledger detail cites the lateral connectors and the fastener rows", detailDrawings(deck)[0].notes.some((n) => /lateral load connectors/.test(n)) && detailDrawings(deck)[0].notes.some((n) => /two staggered rows/.test(n)));
check("a free-standing deck details its bracing instead of a ledger", titles(free).includes("Lateral bracing, free-standing") && !titles(free).includes("Ledger attachment"), titles(free).join(","));
check("a covered deck adds the rafter-to-header-to-post detail", titles(covered).includes("Rafter to header to post"));
check("a gazebo on a slab has only the roof detail", titles(slabGazebo).join(",") === "Rafter to header to post", titles(slabGazebo).join(","));
check("every detail's drawing has a box with size and at least one note", detailDrawings(covered).every((d) => d.drawing.box.w > 0 && d.drawing.box.h > 0 && d.notes.length >= 1 && d.drawing.items.length >= 4));

// ── the materials
const mats = materialSchedule(priceStructure(covered));
check("the material list groups the yard's lines by step, each with a quantity and a unit", mats.length >= 3 && mats.every((g) => g.label && g.lines.every((l) => l.qty > 0 && l.unit)), mats.map((g) => `${g.label}:${g.lines.length}`).join(" "));

// ── every tilted part's ends land on something (the 3D's "disconnected" parts)
const dist = (p: number[], b: number[]) => {
  const yaw = b.length >= 10 ? b[8] : 0;
  const tilt = b.length >= 10 ? b[9] : 0;
  const ax = [Math.cos(yaw) * Math.cos(tilt), Math.sin(yaw) * Math.cos(tilt), Math.sin(tilt)];
  const ay = [-Math.sin(yaw), Math.cos(yaw), 0];
  const az = [-Math.cos(yaw) * Math.sin(tilt), -Math.sin(yaw) * Math.sin(tilt), Math.cos(tilt)];
  const d = [p[0] - b[1], p[1] - b[2], p[2] - b[3]];
  const dot = (v: number[]) => d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
  return Math.hypot(Math.max(0, Math.abs(dot(ax)) - b[4] / 2), Math.max(0, Math.abs(dot(ay)) - b[5] / 2), Math.max(0, Math.abs(dot(az)) - b[6] / 2));
};
const floating = (s: ReturnType<typeof buildStructure>) => {
  const scene = deckScene(s);
  const shed = s.roof?.kind === "shed";
  let n = 0;
  for (const b of scene.boxes) {
    const role0 = SCENE_LAYERS[b[0]];
    const tilted = (b.length >= 10 && b[9] !== 0) || b[7] !== 0;
    if (!tilted && role0 === "roof-post") {
      // A roof post's top must meet the header it carries — the headers' tops align, their depths differ.
      const top = [b[1], b[2], b[3] + b[6] / 2];
      const near = Math.min(...scene.boxes.filter((o) => o !== b).map((o) => dist(top, o)));
      if (near > 0.1) n++;
      continue;
    }
    if (!tilted) continue;
    let a: number[];
    let c: number[];
    if (b.length >= 10 && (b[8] !== 0 || b[9] !== 0)) {
      const ax = Math.cos(b[8]) * Math.cos(b[9]);
      const ay = Math.sin(b[8]) * Math.cos(b[9]);
      const az = Math.sin(b[9]);
      a = [b[1] - (ax * b[4]) / 2, b[2] - (ay * b[4]) / 2, b[3] - (az * b[4]) / 2];
      c = [b[1] + (ax * b[4]) / 2, b[2] + (ay * b[4]) / 2, b[3] + (az * b[4]) / 2];
    } else {
      const lean = b[7];
      const dx = lean === 1 ? 1 : lean === 2 ? -1 : 0;
      const dy = lean === 3 ? 1 : lean === 4 ? -1 : 0;
      a = [b[1] - (dx * b[4]) / 2, b[2] - (dy * b[5]) / 2, b[3] - b[6] / 2];
      c = [b[1] + (dx * b[4]) / 2, b[2] + (dy * b[5]) / 2, b[3] + b[6] / 2];
    }
    const role = SCENE_LAYERS[b[0]];
    const low = a[2] <= c[2] ? a : c;
    const high = a[2] <= c[2] ? c : a;
    for (const [which, end] of [["low", low], ["high", high]] as Array<[string, number[]]>) {
      if ((role === "rafter" || role === "trim") && (which === "low" || shed)) continue; // the eave overhang hangs free by design (a shed's rafters overhang both ways)
      const near = Math.min(...scene.boxes.filter((o) => o !== b).map((o) => dist(end, o)));
      if (near > 0.1) n++;
    }
  }
  return n;
};
check("a free-standing deck's cross braces end on the outside joist, not in the air", floating(free) === 0, `${floating(free)} floating ends`);
check("a gazebo's knee braces reach its shallower gable-end header (they once stopped 4 in. short)", floating(slabGazebo) === 0 && floating(deckGazebo) === 0, `${floating(slabGazebo)} / ${floating(deckGazebo)} floating ends`);
check("…its posts too: a post under the shallower header alone is cut taller", slabGazebo.roof!.posts.every((p) => slabGazebo.roof!.headers.some((h) => Math.abs(slabGazebo.roof!.headerTopIn - h.spec.depthIn - p.topIn) < 0.01)));
check("the owner's covered deck, a 30 ft hip, a free shed and a pergola have no floating parts or short posts", hip.roof!.kind === "hip" && freeShed.roof!.kind === "shed" && [covered, hip, freeShed, buildStructure(applyDeckPatch(base, { structure: "pergola" }))].every((s) => floating(s) === 0), `covered ${floating(covered)}, hip ${floating(hip)} (${hip.roof!.kind}), shed ${floating(freeShed)} (${freeShed.roof!.kind})`);
const boardGable = buildStructure(applyDeckPatch(base, { structure: "covered-deck" })).roof!; // a 16 ft gable: a ridge board, so rafter ties
const ties = boardGable.members.filter((m) => m.role === "tie");
const postsX = boardGable.posts.map((p) => p.x);
check("a gable's rafter ties rest on the headers and tuck under the rafters, never up through the roof", boardGable.ridge?.kind === "board" && ties.length >= 2 && ties.every((t) => Math.abs(t.cz - t.sz / 2 - boardGable.headerTopIn) < 0.01 && t.sx < Math.max(...postsX) - Math.min(...postsX) - 8 && t.sx > (Math.max(...postsX) - Math.min(...postsX)) / 2), `${boardGable.ridge?.kind} ridge · ` + ties.map((t) => `${t.sx.toFixed(0)} in. long, bottom at ${(t.cz - t.sz / 2).toFixed(2)}`).join(" · "));
check("the cross braces are still there, at 45°, and counted", free.frame!.sticks.filter((st) => st.role === "brace" && st.lean?.axis === "y").length >= 2 && free.frame!.sticks.filter((st) => st.role === "brace" && st.lean?.axis === "y").every((st) => Math.abs(st.sy - st.sz) < 0.01));

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
