// Home Design Studio, the design priced (milestone 4, 2026-10-17): the room as designed is counted the way an estimator
// counts a kitchen, every count priced from the price book's own steps times the city index, the shop's own price
// winning, the appliances and pendant fixtures left as allowances, and the proposal's scope written from the design.
//   npx tsx qa/tests/logic/design-estimate.check.ts
import { autoKitchen } from "../../../src/lib/design/kitchen";
import { roomsOf } from "../../../src/lib/design/geometry";
import { DEFAULT_FINISHES, finishesFor, lib } from "../../../src/lib/design/library";
import { normalizeDesign } from "../../../src/lib/design/normalize";
import { DEFAULT_OPTIONS, GROUPS, benchmark, benchmarkTone, estimateTotal, lineTotal, priceDesign, scopeText, takeoff } from "../../../src/lib/design/estimate";
import type { DesignDoc, DesignItem, Finishes, Wall } from "../../../src/lib/design/model";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const W = (id: string, ax: number, ay: number, bx: number, by: number, thick = 4.5): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thick, height: 96 });

// A 14 × 12 ft kitchen: a window on the long wall, a door opposite, laid out by the studio.
const base: DesignDoc = {
  v: 1,
  title: "estimate",
  walls: [W("top", 0, 0, 168, 0), W("right", 168, 0, 168, 144), W("bottom", 168, 144, 0, 144), W("left", 0, 144, 0, 0)],
  openings: [
    { id: "win", wallId: "top", kind: "window", at: 84, width: 36, height: 48, sill: 40 },
    { id: "door", wallId: "bottom", kind: "door", at: 120, width: 32, height: 80, sill: 0 },
  ],
  labels: [{ id: "k", name: "Kitchen", at: { x: 84, y: 72 } }],
  marks: [],
};
const room = roomsOf(base)[0];
const laid = autoKitchen(base, room, "k").items;
const doc: DesignDoc = { ...base, items: laid };
const cat = (i: DesignItem) => lib(i.lib)?.cat;
const sumW = (pred: (i: DesignItem) => boolean) => laid.filter(pred).reduce((s, i) => s + i.w, 0) / 12;

console.log("── the counts");
const t = takeoff(doc, "k")!;
check("a takeoff for the room", !!t && t.room === "Kitchen");
check("floor is the room's inside area", t.floorSqft > 150 && t.floorSqft <= 168, `${t.floorSqft} sq ft`);
check("base run = the base cabinets' widths", Math.abs(t.baseLf - sumW((i) => cat(i) === "base")) <= 0.5, `${t.baseLf} ft`);
check("wall run = the wall cabinets' widths", Math.abs(t.wallLf - sumW((i) => cat(i) === "wall")) <= 0.5, `${t.wallLf} ft`);
check("one sink", t.sinks === 1);
check("counter area covers the counter-topped run, with the overhang", t.counterSqft >= (sumW((i) => !!lib(i.lib)?.counter) * 24) / 12 && t.counterSqft <= (sumW((i) => !!lib(i.lib)?.counter) * 27) / 12, `${t.counterSqft} sq ft`);
check("a countertop outlet every 4 ft or so", t.receptacles >= Math.ceil(sumW((i) => !!lib(i.lib)?.counter && !!i.wallId) / 4));
check("the appliances counted, one each", t.appliances.length === laid.filter((i) => cat(i) === "appliance" || i.lib === "OV").length && t.appliances.length >= 2, t.appliances.map((a) => a.code).join(", "));
check("backsplash only where counters meet a wall", t.splashSqft > 0 && t.splashSqft < t.counterSqft * 1.5, `${t.splashSqft} sq ft`);
check("walls to paint less the openings, cabinets and tile", t.wallPaintSqft > 0 && t.wallPaintSqft < (t.perimeterFt * 8), `${t.wallPaintSqft} of ${Math.round(t.perimeterFt * 8)} sq ft gross`);
check("baseboard less the doorway and the cabinets", t.baseboardLf > 0 && t.baseboardLf < t.perimeterFt - 32 / 12, `${t.baseboardLf} of ${t.perimeterFt} ft`);
check("wood floor straight: 8% waste", t.floorWastePct === 8);
check("the cabinet codes a shop writes", t.cabinetCodes.some((c) => /^SB\d/.test(c)) && t.cabinetCodes.some((c) => /^W\d{4}/.test(c)), t.cabinetCodes.join(" "));

console.log("── the prices");
const f = finishesFor(undefined, "k");
const lines = priceDesign(t, f, DEFAULT_OPTIONS, 1);
const byKey = (ls: typeof lines, k: string) => ls.find((l) => l.key === k);
check("every line's group is one of the sheet's", lines.every((l) => (GROUPS as readonly string[]).includes(l.group)));
check("no line twice", new Set(lines.map((l) => l.key)).size === lines.length);
const unpriced = lines.filter((l) => l.basis === "allowance" && !l.key.startsWith("appl-") && l.key !== "pendant-fixtures");
check("every counted line found its price-book step", unpriced.length === 0, unpriced.map((l) => l.key).join(", "));
check("book lines priced above zero", lines.filter((l) => l.basis === "book").every((l) => l.unitPrice > 0));
for (const k of ["protect", "demo-cab", "demo-floor", "dumpster", "rough-plumb", "rough-elec", "cab-base", "cab-wall", "pulls", "counter", "edge", "sink-cut", "splash", "set", "finish-elec", "floor", "underlay", "paint", "trim", "permits"]) check(`line ${k}`, !!byKey(lines, k));
check("the cabinets by the foot", byKey(lines, "cab-base")!.unit === "ln ft" && byKey(lines, "cab-base")!.qty === t.baseLf);
check("the counter by the square foot", byKey(lines, "counter")!.unit === "sqft" && byKey(lines, "counter")!.qty === t.counterSqft);
check("the floor carries its waste", byKey(lines, "floor")!.qty === Math.round(t.floorSqft * 1.08));
check("the permit is a fee", byKey(lines, "permits")!.fee === true);
const re = byKey(lines, "rough-elec")!.desc;
check("the circuits named for what's placed", /counters and dedicated circuits for the dishwasher, range and fridge/.test(re) && !/microwave/.test(re), re);
const total = estimateTotal(lines);
check("total = the lines", Math.abs(total - lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)) < lines.length);
const bench = benchmark(t.kitchenSqft, 1);
check("a 14 × 12 kitchen sits in line with the book's whole-kitchen benchmark", benchmarkTone(total, bench) === "in", `$${Math.round(total)} vs $${bench.low}–$${bench.high}`);
check("a big open-plan floor is held to the book's typical kitchen", benchmark(400, 1).sqft === 216 && benchmark(60, 1).sqft === 120 && benchmark(150, 1).sqft === 150);
check("a kitchen missing half its lines reads as under", benchmarkTone(total * 0.5, bench) === "under");

console.log("── the city");
const dear = priceDesign(t, f, DEFAULT_OPTIONS, 1.25);
const scaled = (k: string) => Math.abs(byKey(dear, k)!.unitPrice - byKey(lines, k)!.unitPrice * 1.25) <= Math.max(1, byKey(lines, k)!.unitPrice * 0.01);
check("work scales with the city index", ["cab-base", "counter", "floor", "paint"].every(scaled));
check("the permit fee doesn't", byKey(dear, "permits")!.unitPrice === byKey(lines, "permits")!.unitPrice);
check("benchmark scales too", benchmark(150, 1.25).low === Math.round(benchmark(150, 1).low * 1.25) || Math.abs(benchmark(150, 1.25).low - benchmark(150, 1).low * 1.25) <= 1);

console.log("── the shop's own price");
const mine = priceDesign(t, f, DEFAULT_OPTIONS, 1.25, { counter: 99, "appl-REF": 2400 });
check("their price wins, city index or not", byKey(mine, "counter")!.unitPrice === 99 && byKey(mine, "counter")!.basis === "yours");
check("other lines stay on the book", byKey(mine, "cab-base")!.basis === "book");
check("an allowance they set is kept for when they supply", !byKey(mine, "appl-REF"));

console.log("── the choices");
const supply = priceDesign(t, f, { ...DEFAULT_OPTIONS, appliances: "allowance" }, 1, { "appl-REF": 2400 });
const appl = supply.filter((l) => l.key.startsWith("appl-"));
check("we supply: an allowance per appliance", appl.length === t.appliances.length, appl.map((l) => l.key).join(", "));
check("an unset allowance is zero, marked for them to set", appl.filter((l) => l.key !== "appl-REF").every((l) => l.unitPrice === 0 && l.basis === "allowance"));
check("their fridge allowance kept", byKey(supply, "appl-REF")?.unitPrice === 2400 && byKey(supply, "appl-REF")?.basis === "yours");
const fresh = priceDesign(t, f, { ...DEFAULT_OPTIONS, scope: "new", roughIn: false, permits: false }, 1);
check("new construction: nothing to tear out", !fresh.some((l) => l.key.startsWith("demo-") || l.key === "dumpster"));
check("existing rough-in reused: no rough lines", !fresh.some((l) => l.key.startsWith("rough-")));
check("no permits when not asked", !byKey(fresh, "permits"));
check("the new kitchen costs less than the remodel", estimateTotal(fresh) < total);

console.log("── the finishes");
const fancy: Finishes = { ...DEFAULT_FINISHES, floor: { id: "tile-gray", pattern: "herringbone", angle: 0 }, counter: { id: DEFAULT_FINISHES.counter.id, edge: "ogee" }, backsplash: { id: "none", height: "18in" }, wall: { ...DEFAULT_FINISHES.wall, texture: "orange" } };
const tf = takeoff({ ...doc, finishes: { k: fancy } }, "k")!;
const lf = priceDesign(tf, fancy, DEFAULT_OPTIONS, 1);
check("herringbone: 20% waste", tf.floorWastePct === 20 && byKey(lf, "floor")!.qty === Math.round(tf.floorSqft * 1.2));
check("tile floor: no underlayment line", !byKey(lf, "underlay") && /thinset/.test(byKey(lf, "floor")!.desc));
check("no backsplash: no tile line, more wall to paint", !byKey(lf, "splash") && tf.splashSqft === 0 && tf.wallPaintSqft > t.wallPaintSqft);
check("an ogee edge costs more than an eased one", byKey(lf, "edge")!.unitPrice > byKey(lines, "edge")!.unitPrice);
check("a textured wall adds the texture", !!byKey(lf, "texture") && !byKey(lines, "texture"));

console.log("── the scope of work");
const sc = scopeText(t, f, DEFAULT_OPTIONS);
check("names the counter, the cabinets and the floor", sc.includes("countertops") && /ft of base cabinets/.test(sc) && sc.includes("floor"), sc.slice(0, 160));
check("the owner's appliances, set and connected", sc.includes("Set and connect the owner's"));
check("permits when asked", sc.includes("Permits and inspections.") && !scopeText(t, f, { ...DEFAULT_OPTIONS, permits: false }).includes("Permits"));

console.log("── the choices are saved with the design");
const n = normalizeDesign({ ...doc, estimate: { scope: "new", roughIn: false, permits: true, appliances: "allowance", address: "120 Main St, Boise, ID", title: "Smith kitchen" } });
check("kept", n.estimate?.scope === "new" && n.estimate.roughIn === false && n.estimate.appliances === "allowance" && n.estimate.address === "120 Main St, Boise, ID" && n.estimate.title === "Smith kitchen");
const junk = normalizeDesign({ ...doc, estimate: { scope: "x", appliances: 7 } });
check("junk falls back to the defaults", junk.estimate?.scope === "remodel" && junk.estimate.appliances === "owner" && junk.estimate.roughIn === true);
check("lineTotal rounds to cents", lineTotal({ key: "x", group: GROUPS[0], name: "x", desc: "", qty: 3, unit: "ea", unitPrice: 10.333, labor: 0.5, basis: "book" }) === 31);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
