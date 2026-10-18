// THE DESIGN, PRICED (Home Design Studio, milestone 4 — 2026-10-17). Owner: "when you do the estimate, you can also
// design it — cabinets, finishes, wall colors, wall texture…". The room as designed is counted the way an estimator
// counts a kitchen — cabinet run by the linear foot (base, wall and tall apart), counter area with its exposed edges
// and cut-outs, backsplash to the wall cabinets or the hood, floor with the waste its pattern needs, walls and ceiling
// to paint (less the openings, the cabinets and the tile), baseboard, every fixture and appliance to set, lights and
// countertop outlets — and each count is priced from the JobFlex price book's own kitchen-remodel steps (customer
// prices, overhead and profit in, US average) times the job's city index. The contractor's own price for a line wins;
// what the book does not price (the appliances themselves, pendant fixtures) is an allowance the contractor sets, or
// the owner supplies. Pure.
import type { DesignDoc, DesignItem, Finishes } from "./model";
import { DEFAULT_CEILING } from "./model";
import { roomsOf, type Room } from "./geometry";
import { roomSpans, cornersOf, splashTopFor } from "./kitchen";
import { COUNTER_T, counterPreset, finishesFor, floorPreset, itemCode, lib, splashPreset } from "./library";
import { PRICES } from "@/lib/estimate/step-prices/interior-finishes";
import type { PriceRange, StepPrice } from "@/lib/estimate/step-prices/types";

/* ── The counts ────────────────────────────────────────────────────────────────────────────────────────────────── */

export type Takeoff = {
  room: string;
  floorSqft: number;
  /** The kitchen's own part of an open plan (what is placed and a walkway round it), for the benchmark. */
  kitchenSqft: number;
  perimeterFt: number;
  ceiling: number;
  baseLf: number;
  wallLf: number;
  tallLf: number;
  islandLf: number;
  cabinetCodes: string[];
  pulls: number;
  counterSqft: number;
  edgeLf: number;
  sinks: number;
  cooktops: number;
  splashSqft: number;
  appliances: Array<{ lib: string; name: string; code: string }>;
  pendants: number;
  cans: number;
  receptacles: number;
  circuits: number;
  plumbingPoints: number;
  hood: boolean;
  wallPaintSqft: number;
  ceilingSqft: number;
  accentSqft: number;
  floorWastePct: number;
  baseboardLf: number;
};

const BASE_TOP = 36;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r05 = (n: number) => Math.round(n * 2) / 2;

/** Doors and drawer fronts on an item — each gets a pull. */
function pullsOn(it: DesignItem): number {
  switch (it.lib) {
    case "B":
    case "BC":
      return it.w >= 24 && it.lib === "B" ? 3 : 2;
    case "DB":
      return 3;
    case "SB":
      return 2;
    case "W":
      return it.w > 21 ? 2 : 1;
    case "WR":
      return 2;
    case "P":
      return it.w > 21 ? 4 : 2;
    case "OV":
      return 2;
    case "ISL":
      return Math.max(2, Math.round(it.w / 30)) * 2;
    default:
      return 0;
  }
}

export function takeoff(doc: DesignDoc, labelId: string): Takeoff | null {
  const room: Room | undefined = roomsOf(doc).find((r) => r.labelId === labelId);
  if (!room) return null;
  const f = finishesFor(doc.finishes, labelId);
  const items = (doc.items ?? []).filter((i) => i.room === labelId);
  const cat = (i: DesignItem) => lib(i.lib)?.cat;
  const ceiling = room.ceiling || DEFAULT_CEILING;
  const spans = roomSpans(doc, room);
  const perimeter = spans.reduce((s, x) => s + x.len, 0);

  const baseItems = items.filter((i) => cat(i) === "base");
  const wallItems = items.filter((i) => cat(i) === "wall");
  const tallItems = items.filter((i) => cat(i) === "tall");
  const islands = items.filter((i) => i.lib === "ISL");
  const baseLf = baseItems.reduce((s, i) => s + i.w, 0) / 12;
  const wallLf = wallItems.reduce((s, i) => s + i.w, 0) / 12;
  const tallLf = tallItems.reduce((s, i) => s + i.w, 0) / 12;
  const islandLf = islands.reduce((s, i) => s + i.w, 0) / 12;

  // Counters: every counter-topped item (bases, the dishwasher, islands) with its 1 in overhang.
  const countered = items.filter((i) => lib(i.lib)?.counter);
  const counterSqft = countered.reduce((s, i) => s + (i.w * (i.d + 1)) / 144, 0);
  // Exposed edges: each counter's front, and the island all round.
  const edgeLf = countered.filter((i) => i.lib !== "ISL").reduce((s, i) => s + i.w, 0) / 12 + islands.reduce((s, i) => s + (2 * i.w + 2 * (i.d + 1)), 0) / 12;
  const sinks = items.filter((i) => i.lib === "SB" || (i.lib === "ISL" && i.opts?.sink)).length;
  const cooktops = items.filter((i) => i.lib === "CT").length;
  // Backsplash: behind each counter (and the range) against a wall, from the counter to its top.
  const sp = splashPreset(f.backsplash.id);
  const splashSqft =
    sp.id === "none"
      ? 0
      : items
          .filter((i) => i.wallId && (lib(i.lib)?.counter || i.lib === "RNG") && i.lib !== "ISL")
          .reduce((s, i) => s + (i.w * Math.max(0, splashTopFor(i, items, f.backsplash.height, ceiling) - (BASE_TOP)))  / 144, 0);
  const appliances = items.filter((i) => cat(i) === "appliance" || i.lib === "OV").map((i) => ({ lib: i.lib, name: lib(i.lib)?.name ?? i.lib, code: itemCode(i) }));
  const pendants = items.filter((i) => i.lib === "PEN").length;
  const cans = items.filter((i) => i.lib === "CAN").length;
  // Countertop receptacles: about one every 4 ft of counter along the walls, one at an island.
  const wallCounterLf = countered.filter((i) => i.lib !== "ISL" && i.wallId).reduce((s, i) => s + i.w, 0) / 12;
  const receptacles = (wallCounterLf > 0 ? Math.ceil(wallCounterLf / 4) : 0) + islands.length;
  const has = (id: string) => items.some((i) => i.lib === id);
  // Circuits: two 20 A small-appliance circuits for the counters, and one each for the dishwasher, the range or
  // cooktop, the microwave and the fridge.
  const circuits = (countered.length ? 2 : 0) + (has("DW") ? 1 : 0) + (has("RNG") || has("CT") || has("OV") ? 1 : 0) + (has("MW") || has("OV") ? 1 : 0) + (has("REF") ? 1 : 0);
  const plumbingPoints = sinks + (has("DW") ? 1 : 0) + (has("REF") ? 1 : 0);

  // Walls to paint: the room's walls to the ceiling, less doors and windows, the cabinets against them and the tile.
  const openingsSqft = doc.openings.filter((o) => room.wallIds.includes(o.wallId)).reduce((s, o) => s + (o.width * o.height) / 144, 0);
  const coveredSqft = items.filter((i) => i.wallId && (cat(i) === "base" || cat(i) === "wall" || cat(i) === "tall" || i.lib === "REF" || i.lib === "DW" || i.lib === "RNG")).reduce((s, i) => s + (i.w * (i.z >= 40 ? i.h : Math.min(i.h + COUNTER_T, ceiling))) / 144, 0);
  const wallsGross = (perimeter * ceiling) / 144;
  const wallPaintSqft = Math.max(0, wallsGross - openingsSqft - coveredSqft - splashSqft);
  const accentWalls = new Set((f.accents ?? []).map((a) => a.wallId));
  const accentSqft = spans.filter((s) => accentWalls.has(s.wallId)).reduce((s, x) => s + (x.len * ceiling) / 144, 0);

  const fp = floorPreset(f.floor.id);
  const floorWastePct = f.floor.pattern === "herringbone" ? 20 : f.floor.pattern === "diagonal" ? 15 : fp.kind === "tile" ? 10 : 8;
  // Baseboard: the room's perimeter less doorways and what stands on the floor against the walls.
  const doorLf = doc.openings.filter((o) => room.wallIds.includes(o.wallId) && o.kind !== "window").reduce((s, o) => s + o.width, 0) / 12;
  const againstLf = items.filter((i) => i.wallId && i.z < 1 && (cat(i) === "base" || cat(i) === "tall" || cat(i) === "appliance")).reduce((s, i) => s + i.w, 0) / 12;
  const baseboardLf = Math.max(0, perimeter / 12 - doorLf - againstLf);

  // The kitchen's own floor in an open plan: the footprint of what's placed, the aisles between the runs and the
  // island counted, within the room.
  const pts = items.filter((i) => cat(i) !== "light").flatMap((i) => cornersOf(i));
  let kitchenSqft = room.sqft;
  if (pts.length && room.names.length > 1) {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    kitchenSqft = Math.min(room.sqft, ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))) / 144);
  }

  return {
    room: room.names.length > 1 ? room.names.join(" · ") : room.name,
    floorSqft: r1(room.sqft),
    kitchenSqft: r1(kitchenSqft),
    perimeterFt: r1(perimeter / 12),
    ceiling,
    baseLf: r05(baseLf),
    wallLf: r05(wallLf),
    tallLf: r05(tallLf),
    islandLf: r05(islandLf),
    cabinetCodes: items.filter((i) => ["base", "wall", "tall", "island"].includes(cat(i) ?? "")).map(itemCode),
    pulls: items.reduce((s, i) => s + pullsOn(i), 0),
    counterSqft: r1(counterSqft),
    edgeLf: r05(edgeLf),
    sinks,
    cooktops,
    splashSqft: r1(splashSqft),
    appliances,
    pendants,
    cans,
    receptacles,
    circuits,
    plumbingPoints,
    hood: has("HD"),
    wallPaintSqft: Math.round(wallPaintSqft),
    ceilingSqft: Math.round(room.sqft),
    accentSqft: Math.round(accentSqft),
    floorWastePct,
    baseboardLf: r05(baseboardLf),
  };
}

/* ── The prices ────────────────────────────────────────────────────────────────────────────────────────────────── */

export type EstimateOptions = {
  /** A remodel takes the old kitchen out first; new construction doesn't. */
  scope: "remodel" | "new";
  /** New plumbing and electrical runs (a changed layout), or the existing ones reused. */
  roughIn: boolean;
  permits: boolean;
  /** The appliances: the owner buys them (we set and connect), or we supply them on an allowance. */
  appliances: "owner" | "allowance";
};
export const DEFAULT_OPTIONS: EstimateOptions = { scope: "remodel", roughIn: true, permits: true, appliances: "owner" };

export type EstUnit = "ea" | "sqft" | "ln ft" | "lot";
export type EstLine = {
  key: string;
  group: string;
  name: string;
  desc: string;
  qty: number;
  unit: EstUnit;
  unitPrice: number;
  /** Labor's share of the price. */
  labor: number;
  /** Where the price came from. */
  basis: "book" | "yours" | "allowance";
  /** Passed through, not marked up (a permit fee). */
  fee?: boolean;
};

export const GROUPS = ["Prep & demolition", "Rough-in", "Cabinets", "Countertops & backsplash", "Appliances & fixtures", "Electrical & lighting", "Floor, walls & trim"] as const;

const K = PRICES["kitchen-remodel"].steps;
const CT = PRICES["countertop-installer"].steps;
const MC = PRICES["millwork-cabinet"].steps;
const FL = PRICES["flooring-installation"].steps;
const TS = PRICES["tile-stone"].steps;
const PT = PRICES.painting.steps;
const DW_ = PRICES.drywall.steps;

/** A price-book step by the start of its text (the book keys steps by their full sentence). */
function step(book: Record<string, StepPrice>, starts: string): StepPrice | null {
  const k = Object.keys(book).find((x) => x.startsWith(starts));
  return k ? book[k] : null;
}
const mid = (r: PriceRange) => (r[0] + r[1]) / 2;
const money = (n: number) => (n >= 100 ? Math.round(n) : Math.round(n * 100) / 100);

/** The benchmark: what a whole kitchen remodel this size runs in this city, by the book. The book's per-foot range is
 *  drawn from kitchens of its typical size (120–216 sq ft); a kitchen outside that is held to it — a big open-plan
 *  kitchen doesn't cost by the floor it opens onto. */
export function benchmark(sqft: number, factor: number): { low: number; high: number; minJob: number; sqft: number } {
  const b = PRICES["kitchen-remodel"].benchmark;
  const [lo, hi] = b.typicalQty;
  const q = Math.min(hi, Math.max(lo, sqft));
  return { low: Math.round(b.price[0] * q * factor), high: Math.round(b.price[1] * q * factor), minJob: Math.round((b.minJob ?? 0) * factor), sqft: q };
}

/** Where an estimate sits against the benchmark: well under (something missing?), well over, or in line. */
export function benchmarkTone(total: number, bench: { low: number; high: number }): "under" | "over" | "in" {
  return total < bench.low * 0.8 ? "under" : total > bench.high * 1.2 ? "over" : "in";
}

export function priceDesign(t: Takeoff, f: Finishes, opts: EstimateOptions, factor: number, yours: Record<string, number> = {}): EstLine[] {
  const out: EstLine[] = [];
  const add = (key: string, group: (typeof GROUPS)[number], name: string, desc: string, qty: number, unit: EstUnit, sp: StepPrice | null, mult = 1) => {
    if (!(qty > 0)) return;
    const own = yours[key];
    const book = sp ? money(mid(sp.price) * mult * (sp.fee ? 1 : factor)) : 0;
    out.push({ key, group, name, desc, qty, unit, unitPrice: own != null ? own : book, labor: sp?.labor ?? 0.5, basis: own != null ? "yours" : sp ? "book" : "allowance", ...(sp?.fee ? { fee: true } : {}) });
  };
  const allowance = (key: string, group: (typeof GROUPS)[number], name: string, desc: string, qty: number) => {
    if (!(qty > 0)) return;
    const own = yours[key];
    out.push({ key, group, name, desc, qty, unit: "ea", unitPrice: own ?? 0, labor: 0, basis: own != null ? "yours" : "allowance" });
  };
  const cabRun = t.baseLf + t.wallLf + t.tallLf + t.islandLf;

  // Prep & demolition.
  if (opts.permits) add("permits", "Prep & demolition", "Permits and inspections", "Building, electrical and plumbing permits; rough and final inspections (fees at cost)", 1, "lot", step(K, "Permits and inspections"));
  add("protect", "Prep & demolition", "Protection and dust control", "Floor protection on the path, plastic dust walls, registers sealed, a temporary kitchen set up", 1, "lot", step(K, "Protection and dust control"));
  if (opts.scope === "remodel") {
    add("demo-cab", "Prep & demolition", "Remove the existing kitchen", "Cabinets, countertops, backsplash, sink and appliances disconnected, removed and hauled", r05(cabRun), "ln ft", step(K, "Demolition of cabinets"));
    add("demo-floor", "Prep & demolition", "Remove the existing floor", "Flooring and underlayment taken up to the subfloor", t.floorSqft, "sqft", step(K, "Removal of existing flooring"));
    add("dumpster", "Prep & demolition", "Dumpster and disposal", "Debris container and dump fees", 1, "lot", step(K, "Dumpster and disposal"));
  }
  // Rough-in.
  if (opts.roughIn) {
    add("rough-plumb", "Rough-in", "Rough plumbing", `Supply and drain to the sink${t.plumbingPoints > t.sinks ? ", dishwasher and fridge water line" : ""}`, t.plumbingPoints, "ea", step(K, "Rough plumbing"));
    // The dedicated circuits named for what's placed (the same rule as the count).
    const on = (...ids: string[]) => t.appliances.some((a) => ids.includes(a.lib));
    const dedicated = [on("DW") && "dishwasher", on("RNG") ? "range" : on("CT") ? "cooktop" : on("OV") ? "wall oven" : false, on("MW", "OV") && "microwave", on("REF") && "fridge"].filter(Boolean) as string[];
    const list = dedicated.length > 1 ? `${dedicated.slice(0, -1).join(", ")} and ${dedicated[dedicated.length - 1]}` : dedicated[0] ?? "";
    const runs = [t.circuits > dedicated.length && "two 20 A small-appliance circuits for the counters", list && `dedicated circuits for the ${list}`].filter(Boolean).join(" and ");
    add("rough-elec", "Rough-in", "Rough electrical · new circuits", `${runs.charAt(0).toUpperCase()}${runs.slice(1)}, GFCI protected`, t.circuits, "ea", step(K, "Rough electrical"));
  }
  if (t.hood) add("hood-vent", "Rough-in", "Range hood venting", "Rigid duct to the outside with a backdraft damper and cap", 1, "ea", step(K, "Range hood venting"));
  // Cabinets: semi-custom, set and scribed, with fillers, toe kicks, panels and crown (the book's kitchen line).
  const style = `${f.cabinets.style === "slab" ? "slab" : f.cabinets.style === "raised" ? "raised-panel" : "shaker"} doors in ${f.cabinets.name.toLowerCase()}`;
  const codes = (pred: (c: string) => boolean) => t.cabinetCodes.filter(pred).join(", ");
  add("cab-base", "Cabinets", "Base cabinets", `Semi-custom ${style}, leveled, screwed to studs, scribed; ${codes((c) => /^(B|DB|SB|BC|BF)\d/.test(c))}`, t.baseLf, "ln ft", step(K, "Cabinets installed"));
  add("cab-wall", "Cabinets", "Wall cabinets", `${f.cabinets.uppersName ? f.cabinets.uppersName : "Matching"} wall cabinets, 18 in over the counter; ${codes((c) => /^W/.test(c))}`, t.wallLf, "ln ft", step(K, "Cabinets installed"));
  add("cab-tall", "Cabinets", "Tall cabinets", `Pantry and oven cabinets (counted as a base and a wall run); ${codes((c) => /^(P|OV)\d/.test(c))}`, t.tallLf, "ln ft", step(K, "Cabinets installed"), 2);
  add("cab-island", "Cabinets", "Island", `Island cabinets${f.cabinets.islandName ? ` in ${f.cabinets.islandName.toLowerCase()}` : ""} with a finished back panel`, t.islandLf, "ln ft", step(K, "Cabinets installed"));
  add("pulls", "Cabinets", `${f.hardware.kind === "knob" ? "Knobs" : "Pulls"} · ${f.hardware.finish}`, "Drilled with a jig and installed; doors and drawers aligned", t.pulls, "ea", step(MC, "Pulls and knobs"));
  // Countertops and backsplash.
  const cp = counterPreset(f.counter.id);
  add("counter", "Countertops & backsplash", `Countertops · ${cp.name}`, `3 cm, templated and fabricated, seams color-matched${cp.look === "wood" ? " (priced as stone — set your price for wood)" : ""}`, t.counterSqft, "sqft", step(K, "Countertops: 3 cm"));
  const fancyEdge = f.counter.edge === "ogee" || f.counter.edge === "bullnose";
  const edgeStep = step(CT, "Edge profile");
  add("edge", "Countertops & backsplash", `${f.counter.edge[0].toUpperCase()}${f.counter.edge.slice(1)} edge`, "Polished on every exposed edge", t.edgeLf, "ln ft", fancyEdge && edgeStep ? { ...edgeStep, price: [15, 45] } : edgeStep);
  add("sink-cut", "Countertops & backsplash", "Undermount sink cutout", "Polished reveal, sink clips and silicone", t.sinks, "ea", step(CT, "Undermount sink cutout"));
  add("cooktop-cut", "Countertops & backsplash", "Cooktop cutout", "With the burner clearances the cooktop needs", t.cooktops, "ea", step(CT, "Cooktop cutout"));
  const sp = splashPreset(f.backsplash.id);
  if (sp.id !== "none") {
    if (sp.slab) add("splash", "Countertops & backsplash", `Backsplash · ${cp.name} slab`, "Full-height slab behind the counters", t.splashSqft, "sqft", step(K, "Countertops: 3 cm"));
    else add("splash", "Countertops & backsplash", `Backsplash · ${sp.name}`, `Set on thinset, grouted and caulked at the counter${f.backsplash.height === "4in" ? ", 4 in high" : f.backsplash.height === "full" ? ", full height" : ", up to the wall cabinets"}`, t.splashSqft, "sqft", step(K, "Backsplash tile set"));
  }
  // Appliances and fixtures.
  const setCount = t.sinks * 2 + t.appliances.length;
  add("set", "Appliances & fixtures", "Set and connect appliances and fixtures", `Sink and faucet (standard allowance), ${t.appliances.map((a) => a.name.toLowerCase()).join(", ") || "appliances"}`, setCount, "ea", step(K, "Fixtures and appliances set"));
  if (opts.appliances === "allowance") for (const a of t.appliances) allowance(`appl-${a.lib}`, "Appliances & fixtures", `${a.name} · allowance`, `${a.code} — set the allowance, or the client's model`, 1);
  // Electrical and lighting.
  add("finish-elec", "Electrical & lighting", "Finish electrical", `${t.cans} recessed light${t.cans === 1 ? "" : "s"}, ${t.pendants} pendant${t.pendants === 1 ? "" : "s"}, ${t.receptacles} countertop GFCI outlets — devices, plates and trims`, t.cans + t.pendants + t.receptacles, "ea", step(K, "Finish electrical"));
  allowance("pendant-fixtures", "Electrical & lighting", "Pendant fixtures · allowance", "The fixtures themselves — set the allowance", t.pendants);
  // Floor, walls and trim.
  const fp = floorPreset(f.floor.id);
  const floorQty = Math.round(t.floorSqft * (1 + t.floorWastePct / 100));
  const patternWord = f.floor.pattern === "herringbone" ? "herringbone" : f.floor.pattern === "diagonal" ? "on the diagonal" : f.floor.pattern === "offset" ? "offset" : "straight";
  if (fp.kind === "tile") add("floor", "Floor, walls & trim", `Floor · ${fp.name}`, `Set on thinset, ${patternWord}; ${t.floorWastePct}% for cuts`, floorQty, "sqft", step(TS, "Floor tile set"));
  else {
    add("floor", "Floor, walls & trim", `Floor · ${fp.name}`, `${fp.kind === "lvp" ? "Floating click-lock" : "Nailed or glued down"}, ${patternWord}; ${t.floorWastePct}% for cuts`, floorQty, "sqft", step(FL, fp.kind === "lvp" ? "Luxury vinyl plank" : "Hardwood"));
    add("underlay", "Floor, walls & trim", "Underlayment", fp.kind === "lvp" ? "Foam or cork underlayment, seams taped" : "Felt or underlayment under the wood", t.floorSqft, "sqft", step(FL, "Underlayment"));
  }
  const paintWords = `${f.wall.name}${f.wall.code ? ` (${f.wall.code})` : ""}, ${f.wall.sheen === "semi" ? "semi-gloss" : f.wall.sheen}`;
  add("paint", "Floor, walls & trim", "Paint walls and ceiling", `Primed and two coats — walls in ${paintWords}`, t.wallPaintSqft + t.ceilingSqft, "sqft", step(K, "Walls and ceiling primed"));
  add("accent", "Floor, walls & trim", "Accent wall color", (f.accents ?? []).map((a) => `${a.name}${a.code ? ` (${a.code})` : ""}`).join(", ") || "Accent color", t.accentSqft, "sqft", step(PT, "Accent walls"));
  if (f.wall.texture !== "smooth") add("texture", "Floor, walls & trim", `Wall texture · ${f.wall.texture === "orange" ? "orange peel" : f.wall.texture}`, "Sprayed and knocked down, matched to a test patch", t.wallPaintSqft, "sqft", step(DW_, "Texture:"));
  add("trim", "Floor, walls & trim", "Baseboard and trim", "Baseboard, casing and shoe installed, filled and caulked; transitions at doorways", t.baseboardLf, "ln ft", step(K, "Trim: baseboard"));
  return out;
}

export const lineTotal = (l: EstLine) => Math.round(l.qty * l.unitPrice * 100) / 100;
export const estimateTotal = (lines: EstLine[]) => lines.reduce((s, l) => s + lineTotal(l), 0);

/** The proposal's scope of work, from the design. */
export function scopeText(t: Takeoff, f: Finishes, opts: EstimateOptions): string {
  const cp = counterPreset(f.counter.id);
  const sp = splashPreset(f.backsplash.id);
  const fp = floorPreset(f.floor.id);
  const parts: string[] = [];
  if (opts.scope === "remodel") parts.push("Remove the existing kitchen and floor, protect the house and haul the debris.");
  parts.push(
    `Install ${r05(t.baseLf + t.islandLf)} ft of base cabinets${t.wallLf ? ` and ${t.wallLf} ft of wall cabinets` : ""}${t.tallLf ? ` and ${t.tallLf} ft of tall cabinets` : ""} — ${f.cabinets.style === "slab" ? "slab" : f.cabinets.style === "raised" ? "raised-panel" : "shaker"} doors in ${f.cabinets.name.toLowerCase()}${f.cabinets.islandName ? `, the island in ${f.cabinets.islandName.toLowerCase()}` : ""}, ${f.hardware.finish} ${f.hardware.kind === "knob" ? "knobs" : "pulls"}.`,
  );
  parts.push(`${cp.name} countertops, 3 cm with ${f.counter.edge === "eased" ? "an eased" : `a ${f.counter.edge}`} edge${t.sinks ? ", undermount sink" : ""}${t.cooktops ? ", cooktop cutout" : ""}.`);
  if (sp.id !== "none") parts.push(`${sp.slab ? `${cp.name} full-height slab` : sp.name} backsplash${sp.slab ? "" : f.backsplash.height === "full" ? " to the ceiling" : f.backsplash.height === "4in" ? " (4 in)" : " up to the wall cabinets"}.`);
  if (t.appliances.length) parts.push(`${opts.appliances === "owner" ? "Set and connect the owner's" : "Supply, set and connect the"} ${t.appliances.map((a) => a.name.toLowerCase()).join(", ")}.`);
  parts.push(`${fp.name} floor${f.floor.pattern === "herringbone" ? " in herringbone" : f.floor.pattern === "diagonal" ? " on the diagonal" : ""}.`);
  parts.push(`Walls in ${f.wall.name}${f.wall.code ? ` (${f.wall.code})` : ""}, ${f.wall.sheen === "semi" ? "semi-gloss" : f.wall.sheen}${f.wall.texture !== "smooth" ? `, ${f.wall.texture === "orange" ? "orange-peel" : f.wall.texture} texture` : ""}; ceiling painted; new baseboard.`);
  if (t.cans || t.pendants) parts.push(`${t.cans ? `${t.cans} recessed lights` : ""}${t.cans && t.pendants ? " and " : ""}${t.pendants ? `${t.pendants} pendants` : ""}, ${t.receptacles} countertop GFCI outlets.`);
  if (opts.permits) parts.push("Permits and inspections.");
  return parts.join(" ");
}

