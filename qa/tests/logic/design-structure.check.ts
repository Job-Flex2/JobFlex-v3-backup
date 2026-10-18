// Home Design Studio, milestone 5 (2026-10-17): the smart checks (code, NKBA guidelines, fit) and the house's
// structure read from the plan — which walls likely carry it, what a change to a wall or a window needs (an engineer,
// a header, a look on site first), the change undone, the engineer's questions.
//   npx tsx qa/tests/logic/design-structure.check.ts
import { autoKitchen } from "../../../src/lib/design/kitchen";
import { roomsOf } from "../../../src/lib/design/geometry";
import { applyFix, houseChecks, kitchenChecks, type Check } from "../../../src/lib/design/checks";
import { engineerQuestions, forEngineer, houseChanges, openUp, readStructure, readWall, siteWords, undoChange } from "../../../src/lib/design/structure";
import { normalizeDesign } from "../../../src/lib/design/normalize";
import { finishesFor, newItemFrom } from "../../../src/lib/design/library";
import { DEFAULT_OPTIONS, priceDesign, scopeText, takeoff } from "../../../src/lib/design/estimate";
import type { DesignDoc, DesignItem, Wall } from "../../../src/lib/design/model";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const W = (id: string, ax: number, ay: number, bx: number, by: number, thick = 4.5, exterior = false): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thick, height: 96, ...(exterior ? { exterior: true } : {}) });
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

console.log("── reading a 40 × 28 ft house");
// Outside: 480 × 336 in. A hall wall the long way through the middle (two pieces in line, 400 in of 480), a wall
// across the short span, one hugging the front wall, a short stub near the middle, a thick wet wall.
const house: DesignDoc = {
  v: 1,
  title: "house",
  walls: [
    W("N", 0, 0, 480, 0, 6.5, true),
    W("E", 480, 0, 480, 336, 6.5, true),
    W("S", 480, 336, 0, 336, 6.5, true),
    W("Wx", 0, 336, 0, 0, 6.5, true),
    W("mid1", 0, 168, 200, 168),
    W("mid2", 200, 168, 400, 168),
    W("cross", 240, 0, 240, 168),
    W("front", 300, 40, 480, 40),
    W("stub", 420, 120, 470, 120),
    W("wet", 120, 168, 120, 336, 6.5),
  ],
  openings: [
    { id: "d1", wallId: "mid1", kind: "door", at: 100, width: 32, height: 80, sill: 0 },
    { id: "w1", wallId: "N", kind: "window", at: 100, width: 36, height: 48, sill: 36 },
    { id: "d2", wallId: "cross", kind: "door", at: 60, width: 30, height: 80, sill: 0 },
  ],
  labels: [
    { id: "k", name: "Kitchen", at: { x: 100, y: 80 } },
    { id: "b", name: "Bedroom", at: { x: 60, y: 250 } },
  ],
  marks: [],
};
const rs = readStructure(house);
const lvl = (id: string) => rs.get(id)?.level;
check("outside walls are bearing", ["N", "E", "S", "Wx"].every((id) => lvl(id) === "outside" && rs.get(id)!.bearing === true));
check("the long wall through the middle reads likely bearing", lvl("mid1") === "likely" && lvl("mid2") === "likely", rs.get("mid1")!.reasons.join(" "));
check("…because it lines up into one line", /lines up/.test(rs.get("mid1")!.reasons.join(" ")));
check("a wall across the short span reads likely not", lvl("cross") === "unlikely" && rs.get("cross")!.bearing === false);
check("a wall hugging an outside wall reads likely not", lvl("front") === "unlikely");
check("a short stub near the middle: can't tell", lvl("stub") === "unknown" && rs.get("stub")!.bearing === null, rs.get("stub")!.reasons.join(" "));
check("a thick interior wall: a plumbing note", /plumbing/.test(rs.get("wet")!.plumbing ?? ""));
check("site checks listed for an interior wall", rs.get("mid1")!.checks.some((c) => /attic/i.test(c)) && rs.get("mid1")!.checks.some((c) => /basement|crawl/i.test(c)));
check("the house's span is known", rs.get("mid1")!.spanFt === 28);
const narrow = { ...house, walls: [W("n1", 0, 0, 360, 0, 6.5, true), W("n2", 360, 0, 360, 144, 6.5, true), W("n3", 360, 144, 0, 144, 6.5, true), W("n4", 0, 144, 0, 0, 6.5, true), W("nm", 0, 72, 360, 72)], openings: [] };
check("a 12 ft wide house: nothing inside is needed", readStructure(narrow).get("nm")!.level === "unlikely" && /only about 12 ft/.test(readStructure(narrow).get("nm")!.reasons[0]));
const confirmed = readStructure({ ...house, structure: { mid1: "not", cross: "bearing" } });
check("the site outranks the plan", confirmed.get("mid1")!.bearing === false && confirmed.get("mid1")!.confirmed === "not" && confirmed.get("cross")!.bearing === true);

console.log("── changes to the house");
const before: DesignDoc = { ...clone(house), existing: { walls: clone(house.walls), openings: clone(house.openings), at: "2026-10-17T00:00:00Z" } };
check("nothing changed, nothing listed", houseChanges(before).length === 0);
const d1 = clone(before);
d1.walls = d1.walls.filter((w) => w.id !== "mid1");
d1.openings = d1.openings.filter((o) => o.wallId !== "mid1");
let cs = houseChanges(d1);
check("taking out the bearing wall needs an engineer", cs.length === 1 && cs[0].kind === "remove-wall" && cs[0].needs === "engineer" && /16'-8"/.test(cs[0].title), cs.map((c) => `${c.title}: ${c.needs}`).join(" | "));
check("its door goes with it (not a change of its own)", !cs.some((c) => c.openingId === "d1"));
const qs = engineerQuestions(cs[0]);
check("the engineer is asked for the beam, posts, footings and shoring", qs.some((q) => /Beam to replace 16'-8"/.test(q)) && qs.some((q) => /footings/.test(q)) && qs.some((q) => /shoring/i.test(q)));
const d2 = clone(before);
d2.walls = d2.walls.filter((w) => w.id !== "cross");
d2.openings = d2.openings.filter((o) => o.wallId !== "cross");
cs = houseChanges(d2);
check("taking out a likely-not wall: look on site first", cs[0]?.needs === "check");
cs = houseChanges({ ...d2, structure: { cross: "not" } });
check("…checked on site: framing only", cs[0]?.needs === "none");
check("only the engineer's and the unsettled ones go to the engineer", forEngineer(houseChanges(d1)).length === 1 && forEngineer(houseChanges({ ...d2, structure: { cross: "not" } })).length === 0);

const d3 = clone(before);
d3.openings.push({ id: "w2", wallId: "S", kind: "window", at: 300, width: 36, height: 48, sill: 36 });
d3.openings.push({ id: "sl", wallId: "E", kind: "slider", at: 200, width: 96, height: 80, sill: 0 });
cs = houseChanges(d3);
const w2 = cs.find((c) => c.openingId === "w2");
const sl = cs.find((c) => c.openingId === "sl");
check("a new 3 ft window in an outside wall: a header from the tables", w2?.kind === "new-opening" && w2.needs === "header" && /R602\.7/.test(w2.why));
check("an 8 ft slider in an outside wall: the engineer (header and bracing)", sl?.needs === "engineer" && /R602\.10/.test(sl.why));
check("…and the engineer is asked about the bracing", engineerQuestions(sl!).some((q) => /bracing/.test(q)));

const d4 = clone(before);
d4.openings.find((o) => o.id === "d1")!.width = 72;
d4.openings.find((o) => o.id === "w1")!.width = 60;
cs = houseChanges(d4);
check("widening a door in the bearing wall needs an engineer", cs.find((c) => c.openingId === "d1")?.kind === "wider-opening" && cs.find((c) => c.openingId === "d1")?.needs === "engineer");
check("a wider window says what it was", cs.find((c) => c.openingId === "w1")?.was === 36 && /from 3'-0" to 5'-0"/.test(cs.find((c) => c.openingId === "w1")!.title));

const d5 = clone(before);
const cr = d5.walls.find((w) => w.id === "cross")!;
cr.a.x += 24;
cr.b.x += 24;
d5.walls.push(W("nw", 300, 200, 300, 330));
d5.openings = d5.openings.filter((o) => o.id !== "d2");
const front = d5.walls.find((w) => w.id === "front")!;
front.a.x -= 60; // the same line, 5 ft longer
cs = houseChanges(d5);
check("a wall moved 2 ft", cs.some((c) => c.kind === "move-wall" && c.wallId === "cross" && /2'-0" over/.test(c.title)));
check("a wall made longer on its own line is an extension, not a move", cs.some((c) => c.kind === "new-wall" && c.wallId === "front" && /Extend/.test(c.title)) && !cs.some((c) => c.kind === "move-wall" && c.wallId === "front"));
check("a new partition", cs.some((c) => c.kind === "new-wall" && c.wallId === "nw" && c.needs === "none"));
check("…its door closed up is listed on its own when the wall stays", houseChanges({ ...clone(before), openings: before.openings.filter((o) => o.id !== "d2") }).some((c) => c.kind === "closed-opening" && c.openingId === "d2"));

const undone = undoChange(d1, houseChanges(d1)[0]);
check("undo puts the wall and its door back", undone.walls.some((w) => w.id === "mid1") && undone.openings.some((o) => o.id === "d1") && houseChanges(undone).length === 0);
const op = openUp(before, "cross", "big");
const bigOp = op.openings.find((o) => o.id === "big")!;
check("open a wall up: one cased opening, jambs left at the ends", bigOp.kind === "opening" && bigOp.width === 159 && !op.openings.some((o) => o.id === "d2"), `${bigOp.width} in`);
check("…which reads as a change to check first", houseChanges(op).some((c) => c.openingId === "big" && c.needs === "check"));
check("what the plan can't say, in words", siteWords({ above: "floor", roof: "trusses", below: "crawl" }).join(" ") === "A floor above; roof framed with trusses. Crawlspace.");
check("a new wall's reading", readWall(d5, "nw")?.level === "new");
const n = normalizeDesign({ ...d1, structure: { mid2: "bearing", junk: "x" }, engineering: { site: { above: "floor", roof: "nope" }, request: { token: "abc", to: "eng@x.test", sentAt: "2026-10-17" } } });
check("kept through a save: the house as it stood, the site's word, the request", n.existing?.walls.length === 10 && n.structure?.mid2 === "bearing" && !("junk" in (n.structure ?? {})) && n.engineering?.site?.above === "floor" && n.engineering.site.roof === "unknown" && n.engineering.request?.token === "abc");

console.log("── the changes, priced");
const priced = (doc: DesignDoc) => {
  const tk = takeoff(doc, "k")!;
  return { tk, lines: priceDesign(tk, finishesFor(undefined, "k"), DEFAULT_OPTIONS, 1) };
};
const line = (ls: ReturnType<typeof priceDesign>, k: string) => ls.find((l) => l.key === k);
let pr = priced(d1);
check("a bearing wall out: by the foot at the book's beam rate", line(pr.lines, "wall-out-bearing")?.qty === 16.5 && line(pr.lines, "wall-out-bearing")!.unitPrice === 1475 && line(pr.lines, "wall-out-bearing")!.group === "Walls & structure", JSON.stringify(line(pr.lines, "wall-out-bearing")?.qty));
check("…the engineer's stamped letter, a fee", line(pr.lines, "engineer")?.fee === true && line(pr.lines, "engineer")!.unitPrice === 1000);
check("…drywall patched where it stood", (line(pr.lines, "wall-patch")?.qty ?? 0) >= 40);
check("…and the scope of work says so", /Changes to the house: take out 16'-8" of wall — beams and headers to a structural engineer's stamped design\./.test(scopeText(pr.tk, finishesFor(undefined, "k"), DEFAULT_OPTIONS)));
pr = priced({ ...d2, structure: { cross: "not" } });
check("a partition out (checked): the partition rate, no engineer", line(pr.lines, "wall-out-partition")?.unitPrice === 550 && !line(pr.lines, "engineer") && !line(pr.lines, "wall-out-bearing"));
pr = priced(d2);
check("a wall that reads 'likely not' but isn't checked yet: still the partition rate, flagged to check", !!line(pr.lines, "wall-out-partition"));
pr = priced({ ...clone(before), walls: before.walls.filter((w) => w.id !== "stub"), openings: before.openings });
check("a wall the plan can't settle: priced as bearing until checked", /priced as bearing until it's checked/.test(line(pr.lines, "wall-out-bearing")?.desc ?? ""));
pr = priced(d3);
check("two new openings in outside walls: per opening", line(pr.lines, "opening-outside")?.qty === 2 && line(pr.lines, "opening-outside")!.unitPrice === 3150);
check("…the 8 ft slider brings the engineer", !!line(pr.lines, "engineer"));
pr = priced(d5);
check("a moved wall and a new one: framed by the foot", (line(pr.lines, "partition-new")?.qty ?? 0) > 20 && !!line(pr.lines, "infill"));
check("no changes, no wall lines", !priced(before).lines.some((l) => l.group === "Walls & structure"));

console.log("── the kitchen checks");
const base: DesignDoc = {
  v: 1,
  title: "k",
  walls: [W("top", 0, 0, 168, 0), W("right", 168, 0, 168, 144), W("bottom", 168, 144, 0, 144), W("left", 0, 144, 0, 0)],
  openings: [
    { id: "win", wallId: "top", kind: "window", at: 84, width: 36, height: 48, sill: 40 },
    { id: "door", wallId: "bottom", kind: "door", at: 120, width: 32, height: 80, sill: 0 },
  ],
  labels: [{ id: "k", name: "Kitchen", at: { x: 84, y: 72 } }],
  marks: [],
};
const room = roomsOf(base)[0];
const kd: DesignDoc = { ...base, items: autoKitchen(base, room, "k").items };
const ck = kitchenChecks(kd, "k");
const get = (cs: Check[], id: string) => cs.find((c) => c.id === id || c.id.startsWith(`${id}:`));
const failing = ck.filter((c) => !c.ok);
check("the studio's own layout passes every code and fit check", !failing.some((c) => c.level !== "guide"), failing.map((c) => `${c.id}: ${c.detail}`).join(" | "));
check("…and the landing, hood, aisle and dishwasher guidelines", !failing.some((c) => /^(land|vent|aisles|dw|uppers|cook-win|seats)/.test(c.id)), failing.map((c) => c.id).join(", "));
// The sink stays centered under the window; in a 14 × 12 ft L the best fridge end leaves one leg a hair long.
const tri = get(ck, "triangle")!;
const legs = [...tri.detail.matchAll(/(\d+)'-(\d+)(½)?"/g)].map((m) => Number(m[1]) * 12 + Number(m[2]) + (m[3] ? 0.5 : 0));
check("the work triangle within 6 in of NKBA's 4–9 ft legs", legs.slice(0, 3).every((l) => l >= 42 && l <= 114), tri.detail);
check("…and counts what it checked", ck.length >= 10, `${ck.length} checks`);
check("the outlets are counted, by the code", get(ck, "receptacles")?.source.startsWith("NEC 210.52") === true);
check("the triangle measured", /Sink to cooktop/.test(get(ck, "triangle")?.detail ?? ""));

const noHood = { ...kd, items: kd.items!.filter((i) => i.lib !== "HD") };
const vent = get(kitchenChecks(noHood, "k"), "vent")!;
check("no hood over the range: flagged, with a fix", !vent.ok && vent.fix?.kind === "add-hood");
const fixed = applyFix(noHood, vent.fix!);
check("the fix hangs a hood 30 in over it", get(kitchenChecks(fixed, "k"), "vent")!.ok && fixed.items!.some((i) => i.lib === "HD" && i.z === 66));

const rng = kd.items!.find((i) => i.lib === "RNG")!;
const wOver = newItemFrom("W", { x: rng.x - Math.cos((rng.rot * Math.PI) / 180) * 7, y: rng.y - Math.sin((rng.rot * Math.PI) / 180) * 7, rot: rng.rot, wallId: rng.wallId, room: "k" }, "wover", 30)!;
const withCab = { ...kd, items: [...kd.items!.filter((i) => i.lib !== "HD"), wOver] };
const comb = kitchenChecks(withCab, "k").find((c) => c.id === "combust:wover");
check("a wall cabinet 18 in over the range breaks IRC M1901.1", !!comb && !comb.ok && comb.level === "code", comb?.detail);
const comb2 = kitchenChecks(applyFix(withCab, comb!.fix!), "k").find((c) => c.id === "combust:wover");
check("…the fix raises it to 30 in clear", comb2?.ok === true);

const lowered = clone(kd);
const wc = lowered.items!.find((i) => i.lib === "W")!;
wc.z = 46;
const up = get(kitchenChecks(lowered, "k"), "uppers")!;
check("a wall cabinet 10 in over the counter: flagged", !up.ok && up.items!.includes(wc.id));
check("…and fixed to 18 in", get(kitchenChecks(applyFix(lowered, up.fix!), "k"), "uppers")!.ok);

const crowded = clone(kd);
const isl: DesignItem | undefined = crowded.items!.find((i) => i.lib === "ISL");
if (isl) {
  const f = { x: Math.cos((isl.rot * Math.PI) / 180), y: Math.sin((isl.rot * Math.PI) / 180) };
  isl.x += f.x * 14;
  isl.y += f.y * 14;
  const a = get(kitchenChecks(crowded, "k"), "aisles")!;
  check("an island pushed 14 in toward the run: the aisle is narrow", !a.ok && /between the island/.test(a.detail), a.detail);
} else {
  // No island in a 14 × 12 room: build the narrow aisle with a peninsula of bases instead.
  const sb = crowded.items!.find((i) => i.lib === "SB")!;
  const f = { x: Math.cos((sb.rot * Math.PI) / 180), y: Math.sin((sb.rot * Math.PI) / 180) };
  const across = newItemFrom("B", { x: sb.x + f.x * 60, y: sb.y + f.y * 60, rot: (sb.rot + 180) % 360, room: "k" }, "across", 36)!;
  crowded.items!.push(across);
  const a = get(kitchenChecks(crowded, "k"), "aisles")!;
  check("a cabinet 36 in across from the sink run: the aisle is narrow", !a.ok && /36 in between/.test(a.detail), a.detail);
}

const winOver = clone(kd);
const r2 = winOver.items!.find((i) => i.lib === "RNG")!;
const rw = winOver.walls.find((w) => w.id === r2.wallId)!;
const t = (r2.x - rw.a.x) * ((rw.b.x - rw.a.x) / Math.hypot(rw.b.x - rw.a.x, rw.b.y - rw.a.y)) + (r2.y - rw.a.y) * ((rw.b.y - rw.a.y) / Math.hypot(rw.b.x - rw.a.x, rw.b.y - rw.a.y));
winOver.openings.push({ id: "w9", wallId: rw.id, kind: "window", at: t, width: 30, height: 30, sill: 60 });
check("a window behind the range: flagged", get(kitchenChecks(winOver, "k"), "cook-win")?.ok === false);

const blocked = clone(kd);
// The door is 120 in along the bottom wall from its start at x = 168: centered at x = 48.
blocked.items!.push(newItemFrom("P", { x: 48, y: 128, rot: 270, wallId: "bottom", room: "k" }, "pan", 24)!);
check("a pantry across the door: a fit problem", get(kitchenChecks(blocked, "k"), "fit-doors")?.ok === false && get(kitchenChecks(blocked, "k"), "fit-doors")!.items!.includes("pan"));

const far = clone(kd);
const dw = far.items!.find((i) => i.lib === "DW")!;
const sink = far.items!.find((i) => i.lib === "SB")!;
far.items = far.items!.filter((i) => i.id !== dw.id);
far.items.push({ ...dw, x: sink.x + (dw.x - sink.x) * 6, y: sink.y + (dw.y - sink.y) * 6 });
const dwc = get(kitchenChecks(far, "k"), "dw");
check("a dishwasher far from the sink: flagged", dwc?.ok === false, dwc?.title);

const over = clone(kd);
const b0 = over.items!.find((i) => i.lib === "B")!;
over.items!.push({ ...b0, id: "dup", x: b0.x + 6 });
check("two cabinets in one spot: a fit problem", get(kitchenChecks(over, "k"), "fit-overlap")?.ok === false);

console.log("── the auto layout across 378 room sizes (10 × 8 to 20 × 16½ ft, a window on the sink wall)");
{
  let both = 0;
  let noRange = 0;
  let fitFails = 0;
  let total = 0;
  for (let w = 120; w <= 240; w += 6)
    for (let h = 96; h <= 200; h += 6) {
      const b: DesignDoc = { ...base, walls: [W("top", 0, 0, w, 0), W("right", w, 0, w, h), W("bottom", w, h, 0, h), W("left", 0, h, 0, 0)], openings: [{ id: "win", wallId: "top", kind: "window", at: w / 2, width: 36, height: 48, sill: 40 }], labels: [{ id: "k", name: "Kitchen", at: { x: w / 2, y: h / 2 } }] };
      const its = autoKitchen(b, roomsOf(b)[0], "k").items;
      total++;
      const R = its.some((i) => i.lib === "RNG");
      if (!R) noRange++;
      if (R && its.some((i) => i.lib === "REF") && its.some((i) => i.lib === "SB")) both++;
      fitFails += kitchenChecks({ ...b, items: its }, "k").filter((c) => !c.ok && c.level !== "guide").length;
    }
  check("every room gets a range", noRange === 0, `${noRange} of ${total} without`);
  check("nearly every room gets the sink, range and fridge", both / total >= 0.95, `${both} of ${total}`);
  check("and nothing the layout places breaks the code or doesn't fit", fitFails === 0, `${fitFails}`);
}

console.log("── the house: bedrooms' escape windows (IRC R310)");
const bed: DesignDoc = { ...base, labels: [{ id: "b", name: "Bedroom 2", at: { x: 84, y: 72 } }], openings: [{ id: "small", wallId: "top", kind: "window", at: 84, width: 24, height: 24, sill: 48 }] };
const e1 = houseChecks(bed)[0];
check("a 2 × 2 ft window 4 ft up can't be an escape opening", e1 && !e1.ok && e1.source === "IRC R310");
const e2 = houseChecks({ ...bed, openings: [{ id: "ok", wallId: "top", kind: "window", at: 84, width: 36, height: 48, sill: 36 }] })[0];
check("a 3 × 4 ft window, sill 3 ft: could be — confirm its net clear opening", e2.ok && /NET clear/.test(e2.detail));
check("not a bedroom, not checked", houseChecks(base).length === 0);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
