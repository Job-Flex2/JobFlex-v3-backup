// THE DESIGN, PRICED (Home Design Studio, milestone 4 — 2026-10-17). Owner: "when you do the estimate, you can also
// design it — cabinets, finishes, wall colors, wall texture…". The room as designed is counted the way an estimator
// counts a kitchen — cabinet run by the linear foot (base, wall and tall apart), counter area with its exposed edges
// and cut-outs, backsplash to the wall cabinets or the hood, floor with the waste its pattern needs, walls and ceiling
// to paint (less the openings, the cabinets and the tile), baseboard, every fixture and appliance to set, lights and
// countertop outlets — and each count is priced from the JobFlex price book's own kitchen-remodel steps (customer
// prices, overhead and profit in, US average) times the job's city index. The contractor's own price for a line wins;
// what the book does not price (the appliances themselves, pendant fixtures) is an allowance the contractor sets, or
// the owner supplies.
// Every room (2026-10-18): a bath is priced from the book's bathroom-remodel steps (fixtures out, rough plumbing per
// fixture, the shower pan, waterproofing and tile, the vanity set, glass), a laundry from the laundry-room steps, any
// other room as the finish work it is (the floor, paint, trim, lights, closet rods). Furniture and decor are part of
// the design, never of the price. Pure.
import type { DesignDoc, DesignItem, Finishes, RoomKind } from "./model";
import { DEFAULT_CEILING } from "./model";
import { roomsOf, type Room } from "./geometry";
import { roomSpans, cornersOf, splashTopFor } from "./kitchen";
import { COUNTER_T, counterPreset, floorPreset, itemCode, lib, splashPreset } from "./library";
import { PRICES } from "@/lib/estimate/step-prices/interior-finishes";
import { PRICES as CORE } from "@/lib/estimate/step-prices/core-building-trades";
import { PRICES as GENERAL } from "@/lib/estimate/step-prices/general-professional";
import { houseChanges, type HouseChange } from "./structure";
import { kindOfRoom } from "./rooms";
import { productName, stockWords, type DesignProduct } from "./inventory";
import { roomFinishes } from "./roomKinds";
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
  appliances: Array<{ lib: string; name: string; code: string; /** The shop's product it is, when it's one. */ product?: string }>;
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
  /** The changes to the house (milestone 5): walls out or moved, new and wider openings — house-wide. */
  changes: HouseChange[];
  /** What the room is: it decides which trade's steps price it. */
  kind: RoomKind;
  /** The bath and laundry fixtures placed. */
  fixtures: { toilets: number; vanities: Array<{ code: string; w: number; basins: number }>; tubs: number; freeTubs: number; showers: Array<{ w: number; d: number }>; utilitySinks: number; washers: number; dryers: number };
  /** Tile on the wet walls: a shower's three walls to 7 ft, an alcove tub's surround 5 ft over its rim. */
  wetTileSqft: number;
  /** A shower's floor (its pan) and walls, to waterproof. */
  waterproofSqft: number;
  /** Closet rod and shelf, open shelving — ln ft. */
  shelvingLf: number;
  /** Furniture and decor placed: shown in the design, never priced. */
  furnishings: number;
  /** The doorways' width, ln ft — a threshold or transition at each. */
  doorLf: number;
  /** The shop's products the room uses (opts.product), and how many of each. */
  products: Array<{ id: string; lib: string; count: number }>;
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
  const f = roomFinishes(doc, labelId);
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
  const productIdOf = (i: DesignItem) => (typeof i.opts?.product === "string" ? i.opts.product : undefined);
  const appliances = items.filter((i) => cat(i) === "appliance" || i.lib === "OV").map((i) => ({ lib: i.lib, name: lib(i.lib)?.name ?? i.lib, code: itemCode(i), ...(productIdOf(i) ? { product: productIdOf(i) } : {}) }));
  const productCount = new Map<string, { id: string; lib: string; count: number }>();
  for (const i of items) {
    const id = productIdOf(i);
    if (!id) continue;
    const cur = productCount.get(id) ?? { id, lib: i.lib, count: 0 };
    cur.count++;
    productCount.set(id, cur);
  }
  const pendants = items.filter((i) => i.lib === "PEN").length;
  const cans = items.filter((i) => i.lib === "CAN").length;
  // Countertop receptacles: about one every 4 ft of counter along the walls, one at an island.
  const wallCounterLf = countered.filter((i) => i.lib !== "ISL" && i.wallId).reduce((s, i) => s + i.w, 0) / 12;
  const receptacles = (wallCounterLf > 0 ? Math.ceil(wallCounterLf / 4) : 0) + islands.length;
  const has = (id: string) => items.some((i) => i.lib === id);
  // Circuits: two 20 A small-appliance circuits for the counters, and one each for the dishwasher, the range or
  // cooktop, the microwave and the fridge.
  const circuits = (countered.length ? 2 : 0) + (has("DW") ? 1 : 0) + (has("RNG") || has("CT") || has("OV") ? 1 : 0) + (has("MW") || has("OV") ? 1 : 0) + (has("REF") ? 1 : 0);
  const count = (id: string) => items.filter((i) => i.lib === id).length;
  const fixtures: Takeoff["fixtures"] = {
    toilets: count("WC"),
    vanities: items.filter((i) => i.lib === "VAN").map((i) => ({ code: itemCode(i), w: i.w, basins: i.w >= 60 ? 2 : 1 })),
    tubs: count("TUB"),
    freeTubs: count("FTUB"),
    showers: items.filter((i) => i.lib === "SHW").map((i) => ({ w: i.w, d: i.d })),
    utilitySinks: count("USK"),
    washers: count("WSH"),
    dryers: count("DRY"),
  };
  const basins = fixtures.vanities.reduce((s, v) => s + v.basins, 0);
  const plumbingPoints = sinks + (has("DW") ? 1 : 0) + (has("REF") ? 1 : 0) + fixtures.toilets + basins + fixtures.tubs + fixtures.freeTubs + fixtures.showers.length + fixtures.utilitySinks + (fixtures.washers ? 1 : 0);
  // The wet walls: a shower's back and two sides tiled to 7 ft, an alcove tub's three walls 5 ft over its 20 in rim.
  const showerWalls = fixtures.showers.reduce((s, x) => s + ((x.w + 2 * x.d) * 84) / 144, 0);
  const tubWalls = items.filter((i) => i.lib === "TUB" && i.wallId).reduce((s, i) => s + ((i.w + 2 * i.d) * 60) / 144, 0);
  const wetTileSqft = showerWalls + tubWalls;
  const waterproofSqft = showerWalls + fixtures.showers.reduce((s, x) => s + (x.w * x.d) / 144, 0);
  const shelvingLf = items.filter((i) => i.lib === "CLS" || i.lib === "SHU").reduce((s, i) => s + i.w, 0) / 12;
  const furnishings = items.filter((i) => cat(i) === "furniture" || cat(i) === "decor").filter((i) => i.lib !== "CLS" && i.lib !== "SHU" && i.lib !== "MIR" && !productIdOf(i)).length;

  // Walls to paint: the room's walls to the ceiling, less doors and windows, the cabinets against them and the tile.
  const openingsSqft = doc.openings.filter((o) => room.wallIds.includes(o.wallId)).reduce((s, o) => s + (o.width * o.height) / 144, 0);
  const coveredSqft = items.filter((i) => i.wallId && (cat(i) === "base" || cat(i) === "wall" || cat(i) === "tall" || i.lib === "REF" || i.lib === "DW" || i.lib === "RNG")).reduce((s, i) => s + (i.w * (i.z >= 40 ? i.h : Math.min(i.h + COUNTER_T, ceiling))) / 144, 0);
  const wallsGross = (perimeter * ceiling) / 144;
  const wallPaintSqft = Math.max(0, wallsGross - openingsSqft - coveredSqft - splashSqft - wetTileSqft);
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
    changes: houseChanges(doc),
    kind: kindOfRoom(doc, room),
    fixtures,
    wetTileSqft: Math.round(wetTileSqft),
    waterproofSqft: Math.round(waterproofSqft),
    shelvingLf: r05(shelvingLf),
    furnishings,
    doorLf: r05(doorLf),
    products: [...productCount.values()],
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

export const GROUPS = ["Prep & demolition", "Walls & structure", "Rough-in", "Cabinets", "Countertops & backsplash", "Tile & shower", "Appliances & fixtures", "Furnishings", "Closets & shelving", "Electrical & lighting", "Floor, walls & trim"] as const;

const K = PRICES["kitchen-remodel"].steps;
const CT = PRICES["countertop-installer"].steps;
const MC = PRICES["millwork-cabinet"].steps;
const FL = PRICES["flooring-installation"].steps;
const TS = PRICES["tile-stone"].steps;
const PT = PRICES.painting.steps;
const DW_ = PRICES.drywall.steps;
const GC = GENERAL["general-contracting"].steps;
const FOUNDATION = CORE["residential-foundation-repair"].steps;
const BATH = PRICES["bathroom-remodel"].steps;
const LAUNDRY = PRICES["laundry-room-remodel"].steps;
const INTERIOR = PRICES["interior-remodel"].steps;

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

/** The benchmark for the room's kind, in words the sheet can say — none for a room no book prices whole. */
export function benchmarkFor(t: Takeoff, factor: number): { low: number; high: number; minJob: number; words: string } | null {
  if (t.kind === "kitchen") {
    const b = benchmark(t.kitchenSqft, factor);
    return { ...b, words: `A whole kitchen remodel of about ${Math.round(b.sqft)} sq ft` };
  }
  const book = t.kind === "bath" && (t.fixtures.tubs || t.fixtures.freeTubs || t.fixtures.showers.length) ? PRICES["bathroom-remodel"] : t.kind === "laundry" ? PRICES["laundry-room-remodel"] : null;
  if (!book) return null;
  const b = book.benchmark;
  return { low: Math.round(b.price[0] * factor), high: Math.round(b.price[1] * factor), minJob: Math.round((b.minJob ?? 0) * factor), words: t.kind === "bath" ? "A full bathroom remodel (a hall bath taken to the studs, about 5×8)" : "A whole laundry room remodel (about 40–80 sq ft)" };
}

/** Where an estimate sits against the benchmark: well under (something missing?), well over, or in line. */
export function benchmarkTone(total: number, bench: { low: number; high: number }): "under" | "over" | "in" {
  return total < bench.low * 0.8 ? "under" : total > bench.high * 1.2 ? "over" : "in";
}

type Group = (typeof GROUPS)[number];
type Allowance = (key: string, group: Group, name: string, desc: string, qty: number) => void;

function makers(out: EstLine[], factor: number, yours: Record<string, number>): { add: AddLine; allowance: Allowance } {
  const add: AddLine = (key, group, name, desc, qty, unit, sp, mult = 1) => {
    if (!(qty > 0)) return;
    const own = yours[key];
    const book = sp ? money(mid(sp.price) * mult * (sp.fee ? 1 : factor)) : 0;
    out.push({ key, group, name, desc, qty, unit, unitPrice: own != null ? own : book, labor: sp?.labor ?? 0.5, basis: own != null ? "yours" : sp ? "book" : "allowance", ...(sp?.fee ? { fee: true } : {}) });
  };
  const allowance: Allowance = (key, group, name, desc, qty) => {
    if (!(qty > 0)) return;
    const own = yours[key];
    out.push({ key, group, name, desc, qty, unit: "ea", unitPrice: own ?? 0, labor: 0, basis: own != null ? "yours" : "allowance" });
  };
  return { add, allowance };
}

export function priceDesign(t: Takeoff, f: Finishes, opts: EstimateOptions, factor: number, yours: Record<string, number> = {}, products: readonly DesignProduct[] = []): EstLine[] {
  const out: EstLine[] = [];
  const { add, allowance } = makers(out, factor, yours);
  // What the shop supplies from its own inventory is priced as its product, so no allowance stands in for it.
  const supplied = new Set(t.products.filter((u) => products.some((p) => p.id === u.id)).map((u) => u.id));
  const covered = (lib: string) => t.products.filter((u) => u.lib === lib && supplied.has(u.id)).reduce((n, u) => n + u.count, 0);
  const lines = t.kind === "bath" ? priceBath(t, f, opts, add, allowance, out, covered) : t.kind === "laundry" ? priceLaundry(t, f, opts, add, out) : t.kind !== "kitchen" ? priceFinishRoom(t, f, opts, add, out) : priceKitchen(t, f, opts, add, allowance, out, supplied);
  return productLines(t, products, yours, lines);
}

/** The shop's own products the design uses: each at its price, with what the shelf holds. */
function productLines(t: Takeoff, products: readonly DesignProduct[], yours: Record<string, number>, out: EstLine[]): EstLine[] {
  for (const u of t.products) {
    const p = products.find((x) => x.id === u.id);
    if (!p) continue;
    const e = lib(p.lib);
    const key = `prod-${p.id}`;
    const own = yours[key];
    const furnishing = e?.cat === "furniture" || e?.cat === "decor";
    out.push({
      key,
      group: furnishing ? "Furnishings" : "Appliances & fixtures",
      name: productName(p),
      desc: `${e?.name ?? p.lib} · ${p.w} × ${p.d} × ${p.h} in — ${stockWords(p, u.count)}`,
      qty: u.count,
      unit: "ea",
      unitPrice: own ?? p.price ?? 0,
      labor: 0,
      basis: own != null || p.price != null ? "yours" : "allowance",
    });
  }
  return out;
}

function priceKitchen(t: Takeoff, f: Finishes, opts: EstimateOptions, add: AddLine, allowance: Allowance, out: EstLine[], supplied: ReadonlySet<string>): EstLine[] {
  const cabRun = t.baseLf + t.wallLf + t.tallLf + t.islandLf;

  // Prep & demolition.
  if (opts.permits) add("permits", "Prep & demolition", "Permits and inspections", "Building, electrical and plumbing permits; rough and final inspections (fees at cost)", 1, "lot", step(K, "Permits and inspections"));
  add("protect", "Prep & demolition", "Protection and dust control", "Floor protection on the path, plastic dust walls, registers sealed, a temporary kitchen set up", 1, "lot", step(K, "Protection and dust control"));
  if (opts.scope === "remodel") {
    add("demo-cab", "Prep & demolition", "Remove the existing kitchen", "Cabinets, countertops, backsplash, sink and appliances disconnected, removed and hauled", r05(cabRun), "ln ft", step(K, "Demolition of cabinets"));
    add("demo-floor", "Prep & demolition", "Remove the existing floor", "Flooring and underlayment taken up to the subfloor", t.floorSqft, "sqft", step(K, "Removal of existing flooring"));
    add("dumpster", "Prep & demolition", "Dumpster and disposal", "Debris container and dump fees", 1, "lot", step(K, "Dumpster and disposal"));
  }
  // Walls and structure: the changes to the house, each kind on one line (so the shop's own price for it carries).
  priceChanges(t, add);
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
  if (opts.appliances === "allowance") for (const a of t.appliances) if (!a.product || !supplied.has(a.product)) allowance(`appl-${a.lib}`, "Appliances & fixtures", `${a.name} · allowance`, `${a.code} — set the allowance, or the client's model`, 1);
  // Electrical and lighting.
  add("finish-elec", "Electrical & lighting", "Finish electrical", `${t.cans} recessed light${t.cans === 1 ? "" : "s"}, ${t.pendants} pendant${t.pendants === 1 ? "" : "s"}, ${t.receptacles} countertop GFCI outlets — devices, plates and trims`, t.cans + t.pendants + t.receptacles, "ea", step(K, "Finish electrical"));
  allowance("pendant-fixtures", "Electrical & lighting", "Pendant fixtures · allowance", "The fixtures themselves — set the allowance", t.pendants);
  // Floor, walls and trim.
  floorLines(t, f, add);
  add("paint", "Floor, walls & trim", "Paint walls and ceiling", `Primed and two coats — walls in ${paintWordsOf(f)}`, t.wallPaintSqft + t.ceilingSqft, "sqft", step(K, "Walls and ceiling primed"));
  accentAndTexture(t, f, add);
  add("trim", "Floor, walls & trim", "Baseboard and trim", "Baseboard, casing and shoe installed, filled and caulked; transitions at doorways", t.baseboardLf, "ln ft", step(K, "Trim: baseboard"));
  return out;
}

type AddLine = (key: string, group: Group, name: string, desc: string, qty: number, unit: EstUnit, sp: StepPrice | null, mult?: number) => void;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const listWords = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "");
const floorQtyOf = (t: Takeoff) => Math.round(t.floorSqft * (1 + t.floorWastePct / 100));

/** The floor, from the shared flooring book (any room but a bath's tile, which the bath book prices). */
function floorLines(t: Takeoff, f: Finishes, add: AddLine) {
  const fp = floorPreset(f.floor.id);
  const q = floorQtyOf(t);
  const patternWord = f.floor.pattern === "herringbone" ? "herringbone" : f.floor.pattern === "diagonal" ? "on the diagonal" : f.floor.pattern === "offset" ? "offset" : "straight";
  if (fp.kind === "carpet") return add("carpet", "Floor, walls & trim", `Floor · ${fp.name}`, `Tack strip, 8 lb pad, seams heat-taped, power-stretched; ${t.floorWastePct}% for seams`, q, "sqft", step(FL, "Carpet:"), 1 / 9);
  if (fp.kind === "tile") return add("floor", "Floor, walls & trim", `Floor · ${fp.name}`, `Set on thinset, ${patternWord}; ${t.floorWastePct}% for cuts`, q, "sqft", step(TS, "Floor tile set"));
  add("floor", "Floor, walls & trim", `Floor · ${fp.name}`, `${fp.kind === "lvp" ? "Floating click-lock" : "Nailed or glued down"}, ${patternWord}; ${t.floorWastePct}% for cuts`, q, "sqft", step(FL, fp.kind === "lvp" ? "Luxury vinyl plank" : "Hardwood"));
  add("underlay", "Floor, walls & trim", "Underlayment", fp.kind === "lvp" ? "Foam or cork underlayment, seams taped" : "Felt or underlayment under the wood", t.floorSqft, "sqft", step(FL, "Underlayment"));
}

const paintWordsOf = (f: Finishes) => `${f.wall.name}${f.wall.code ? ` (${f.wall.code})` : ""}, ${f.wall.sheen === "semi" ? "semi-gloss" : f.wall.sheen}`;

function accentAndTexture(t: Takeoff, f: Finishes, add: AddLine) {
  add("accent", "Floor, walls & trim", "Accent wall color", (f.accents ?? []).map((a) => `${a.name}${a.code ? ` (${a.code})` : ""}`).join(", ") || "Accent color", t.accentSqft, "sqft", step(PT, "Accent walls"));
  if (f.wall.texture !== "smooth") add("texture", "Floor, walls & trim", `Wall texture · ${f.wall.texture === "orange" ? "orange peel" : f.wall.texture}`, "Sprayed and knocked down, matched to a test patch", t.wallPaintSqft, "sqft", step(DW_, "Texture:"));
}

/** A bathroom, by the book's bathroom-remodel steps. */
function priceBath(t: Takeoff, f: Finishes, opts: EstimateOptions, add: AddLine, allowance: Allowance, out: EstLine[], covered: (lib: string) => number): EstLine[] {
  const fx = t.fixtures;
  const fixtureCount = fx.toilets + fx.vanities.length + fx.tubs + fx.freeTubs + fx.showers.length;
  if (opts.permits) add("bath-permits", "Prep & demolition", "Permits and inspections", "Building, plumbing and electrical permits; rough and final inspections (fees at cost)", 1, "lot", step(BATH, "Permits and inspections"));
  add("bath-protect", "Prep & demolition", "Protection and dust containment", "Floor runners on the path, plastic on the door, the fan or a negative-air unit running", 1, "lot", step(BATH, "Protection and dust containment"));
  if (opts.scope === "remodel") {
    add("bath-demo-fix", "Prep & demolition", "Remove the existing fixtures", "Toilet, vanity, tub or shower, mirror, accessories and lighting disconnected and hauled", Math.max(1, fixtureCount), "ea", step(BATH, "Fixtures removed"));
    add("bath-demo-tile", "Prep & demolition", "Tile, backer and floor out", "Demolished to the studs and subfloor, bagged, carried out and disposed of", Math.round(t.floorSqft + t.wetTileSqft), "sqft", step(BATH, "Tile, backer and flooring demolished"));
  }
  priceChanges(t, add);
  if (opts.roughIn) {
    const what = listWords([fx.toilets && plural(fx.toilets, "toilet"), fx.vanities.length && plural(fx.vanities.reduce((s, v) => s + v.basins, 0), "basin"), fx.tubs + fx.freeTubs && plural(fx.tubs + fx.freeTubs, "tub"), fx.showers.length && plural(fx.showers.length, "shower")].filter(Boolean) as string[]);
    add("bath-rough-plumb", "Rough-in", "Rough plumbing", `Supply and drain${what ? ` for the ${what}` : ""}; pressure-balance valves, toilet flange at the finished floor`, t.plumbingPoints, "ea", step(BATH, "Rough plumbing"));
    add("bath-rough-elec", "Rough-in", "Rough electrical", "20 A GFCI circuit, vanity light and sconce boxes, the fan's circuit, switch loops", 1, "ea", step(BATH, "Rough electrical"));
  }
  add("bath-fan", "Rough-in", "Exhaust fan", "80–110 cfm ENERGY STAR fan with a humidity sensor, rigid duct to a roof or wall cap", 1, "ea", step(BATH, "Exhaust fan"));
  // The wet areas.
  add("bath-board", "Tile & shower", "Cement board at the wet walls", "½ in cement board behind the tile, moisture-resistant board elsewhere, taped and finished", t.wetTileSqft, "sqft", step(BATH, "Wall board"));
  add("bath-pan", "Tile & shower", "Shower pan", "Foam tray or a mud pan with a bonded drain, flood-tested 24 hours before tile", fx.showers.length, "ea", step(BATH, "Shower pan"));
  add("bath-waterproof", "Tile & shower", "Waterproofing", "Sheet or liquid membrane on the shower walls, curb and pan, seams banded and corners sealed", t.waterproofSqft, "sqft", step(BATH, "Waterproofing"));
  add("bath-wall-tile", "Tile & shower", "Shower and tub surround tile", `${fx.showers.length ? "The shower's walls to 7 ft" : ""}${fx.showers.length && fx.tubs ? ", " : ""}${fx.tubs ? "the tub's surround 5 ft over the rim" : ""} — set on thinset, edge profiles, grouted and caulked`, t.wetTileSqft, "sqft", step(BATH, "Shower and wall tile"));
  add("bath-glass", "Tile & shower", "Frameless glass shower door", "3/8 in tempered glass door and panel, measured after tile", fx.showers.length, "ea", step(BATH, "Frameless"));
  // Fixtures.
  const cp = counterPreset(f.counter.id);
  for (const [i, v] of fx.vanities.entries()) add(`bath-vanity${i ? `-${i + 1}` : ""}`, "Appliances & fixtures", `Vanity ${v.code} · ${cp.name} top`, `${v.w} in vanity, ${v.basins === 2 ? "two undermount basins" : "an undermount basin"}, faucet${v.basins === 2 ? "s" : ""} and drain${v.basins === 2 ? "s" : ""} connected; doors in ${f.cabinets.name.toLowerCase()}`, 1, "ea", step(BATH, "Vanity and top set"));
  add("bath-fixtures", "Appliances & fixtures", "Set the fixtures", listWords([fx.toilets && plural(fx.toilets, "toilet") + " on new wax rings", fx.tubs && plural(fx.tubs, "alcove tub"), fx.freeTubs && plural(fx.freeTubs, "freestanding tub") + " with a floor filler", fx.showers.length && "shower trim and head"].filter(Boolean) as string[]) + "; towel bars, paper holder", fx.toilets + fx.tubs + fx.freeTubs + fx.showers.length, "ea", step(BATH, "Fixtures set"));
  if (opts.appliances === "allowance") {
    allowance("allow-toilet", "Appliances & fixtures", "Toilet · allowance", "The toilet itself — set the allowance, or the client's model", fx.toilets - covered("WC"));
    allowance("allow-tub", "Appliances & fixtures", "Tub · allowance", "The tub itself — set the allowance, or the client's model", fx.tubs - covered("TUB") + fx.freeTubs - covered("FTUB"));
  }
  // Floor, walls, trim.
  const fp = floorPreset(f.floor.id);
  if (fp.kind === "tile") add("bath-floor", "Floor, walls & trim", `Floor · ${fp.name}`, `Porcelain on modified thinset with leveling clips, grouted and sealed; ${t.floorWastePct}% for cuts`, floorQtyOf(t), "sqft", step(BATH, "Floor tile"));
  else floorLines(t, f, add);
  add("bath-paint", "Floor, walls & trim", "Paint walls and ceiling", `Primed and two coats of moisture-resistant paint — walls in ${paintWordsOf(f)}`, t.wallPaintSqft + t.ceilingSqft, "sqft", step(BATH, "Walls and ceiling primed"));
  accentAndTexture(t, f, add);
  add("bath-trim", "Floor, walls & trim", "Baseboard, casing and threshold", "Installed, filled and caulked", t.baseboardLf, "ln ft", step(BATH, "Trim and door"));
  add("bath-finish", "Electrical & lighting", "Mirror, lights and accessories; final clean", `${t.cans ? `${plural(t.cans, "recessed light")}, ` : ""}mirror, fan grille and accessories installed; silicone cured, walk-through and warranty`, 1, "lot", step(BATH, "Mirror, lighting"));
  return out;
}

/** A laundry room, by the book's laundry-room steps. */
function priceLaundry(t: Takeoff, f: Finishes, opts: EstimateOptions, add: AddLine, out: EstLine[]): EstLine[] {
  const fx = t.fixtures;
  if (opts.permits) add("laundry-permits", "Prep & demolition", "Permit", "Plumbing, electrical and dryer-venting changes with the rough and final inspections (fee at cost)", 1, "lot", step(LAUNDRY, "Permit for the plumbing"));
  if (fx.washers || fx.dryers) add("laundry-protect", "Prep & demolition", "Machines out and the floors protected", "Washer and dryer disconnected, capped and moved out", 1, "ea", step(LAUNDRY, "Protection and machine handling"));
  if (opts.scope === "remodel") add("laundry-demo", "Prep & demolition", "Demolition", "Cabinets, shelving, flooring and damaged drywall out, bagged and hauled", t.floorSqft, "sqft", step(LAUNDRY, "Demolition of cabinets"));
  priceChanges(t, add);
  if (opts.roughIn) {
    if (fx.washers || fx.utilitySinks) add("laundry-plumb", "Rough-in", "Laundry plumbing", `Recessed washer box with quarter-turn valves and hammer arrestors, 2 in standpipe${fx.utilitySinks ? ", supply and drain for the utility sink" : ""}`, 1, "ea", step(LAUNDRY, "Plumbing: recessed laundry box"));
    if (fx.washers || fx.dryers) add("laundry-elec", "Rough-in", "Laundry electrical", "Dedicated 20 A laundry circuit, 30 A / 240 V dryer receptacle, GFCI receptacles, light and switch", 1, "ea", step(LAUNDRY, "Electrical: dedicated 20A"));
  }
  if (fx.dryers) add("laundry-vent", "Rough-in", "Dryer vent", "4 in rigid metal duct to the outside with a damper hood, inside the 35 ft equivalent-length limit (about 10 ft — set the run)", 10, "ln ft", step(LAUNDRY, "Dryer vent"));
  add("laundry-cab", "Cabinets", "Cabinets", `Over the machines and at the sink; ${t.cabinetCodes.join(", ")}`, r05(t.baseLf + t.wallLf + t.tallLf), "ln ft", step(LAUNDRY, "Cabinets: wall cabinets"));
  add("laundry-counter", "Countertops & backsplash", "Countertop", "Over the machines or the base cabinet, with the sink cutout", t.counterSqft, "sqft", step(LAUNDRY, "Countertop over the machines"));
  add("laundry-sink", "Appliances & fixtures", "Utility sink and faucet", "Set and connected", fx.utilitySinks, "ea", step(LAUNDRY, "Utility sink and faucet"));
  add("laundry-set", "Appliances & fixtures", "Washer and dryer set", "Leveled, connected and run through a test cycle; the vent connection checked", fx.washers + fx.dryers, "ea", step(LAUNDRY, "Washer and dryer set"));
  add("laundry-shelf", "Closets & shelving", "Shelving", "Hanging rod, folding shelf and open shelving screwed to the studs", t.shelvingLf, "ln ft", step(LAUNDRY, "Hanging rod"));
  const fp = floorPreset(f.floor.id);
  add("laundry-floor", "Floor, walls & trim", `Floor · ${fp.name}`, `Over the proper underlayment${fp.kind === "wood" ? " (priced as LVP or tile — wood is a poor choice by a washer)" : ""}; ${t.floorWastePct}% for cuts`, floorQtyOf(t), "sqft", step(LAUNDRY, "Flooring: waterproof"));
  add("laundry-paint", "Floor, walls & trim", "Paint walls and ceiling", `Two coats of scrubbable satin — walls in ${paintWordsOf(f)}`, t.wallPaintSqft + t.ceilingSqft, "sqft", step(LAUNDRY, "Walls and ceiling painted"));
  accentAndTexture(t, f, add);
  add("laundry-trim", "Floor, walls & trim", "Baseboard and casing", "Installed and caulked", t.baseboardLf, "ln ft", step(LAUNDRY, "Baseboard, casing"));
  add("laundry-final", "Floor, walls & trim", "Final clean and walk-through", "", 1, "lot", step(LAUNDRY, "Final clean"));
  return out;
}

/** Any other room: the finish work it is — the floor, paint, trim, lights and closets. Furniture isn't priced. */
function priceFinishRoom(t: Takeoff, f: Finishes, opts: EstimateOptions, add: AddLine, out: EstLine[]): EstLine[] {
  if (t.kind === "outdoor") return out;
  if (opts.permits && (t.changes.length || (opts.roughIn && t.cans + t.pendants > 0))) add("room-permits", "Prep & demolition", "Permits and inspections", "Building and electrical permits; rough and final inspections (fees at cost)", 1, "lot", step(INTERIOR, "Permits, plans and inspections"));
  add("room-protect", "Prep & demolition", "Protection and masking", "Drop cloths, plastic and paper masking over what stays", t.wallPaintSqft + t.ceilingSqft, "sqft", step(PT, "Protection and masking"));
  if (opts.scope === "remodel") {
    add("room-demo-floor", "Prep & demolition", "Remove the existing floor", "Carpet and pad with the tack strip, or the old floor, taken up to the subfloor", t.floorSqft, "sqft", step(FL, "Remove existing flooring"));
    add("room-haul", "Prep & demolition", "Haul the old floor", "To the dump; the floor vacuumed and damp-mopped", 1, "lot", step(FL, "Old flooring and pad hauled"));
  }
  priceChanges(t, add);
  if (opts.roughIn) add("room-rough-elec", "Rough-in", "Rough electrical · new lights", `Boxes and switch loops for ${listWords([t.cans && plural(t.cans, "recessed light"), t.pendants && plural(t.pendants, "pendant")].filter(Boolean) as string[])}`, t.cans + t.pendants, "ea", step(INTERIOR, "Rough electrical"));
  add("room-closet", "Closets & shelving", "Closet rods and shelving", "Rod and shelf, open shelving — screwed to the studs", t.shelvingLf, "ln ft", step(LAUNDRY, "Hanging rod"));
  add("room-finish-elec", "Electrical & lighting", "Finish electrical", `${listWords([t.cans && plural(t.cans, "recessed light"), t.pendants && plural(t.pendants, "pendant")].filter(Boolean) as string[])} — fixtures, devices and plates set and tested`, t.cans + t.pendants, "ea", step(INTERIOR, "Finish electrical and plumbing"));
  floorLines(t, f, add);
  add("room-transitions", "Floor, walls & trim", "Transitions at the doorways", "T-molding, reducers and thresholds", t.doorLf, "ln ft", step(FL, "Transitions"));
  add("room-paint-walls", "Floor, walls & trim", "Paint the walls", `Two finish coats of premium acrylic — ${paintWordsOf(f)}`, t.wallPaintSqft, "sqft", step(PT, "Walls: two finish coats"));
  add("room-paint-ceiling", "Floor, walls & trim", "Paint the ceiling", "Two coats of flat ceiling paint", t.ceilingSqft, "sqft", step(PT, "Ceilings: two coats"));
  accentAndTexture(t, f, add);
  add("room-trim", "Floor, walls & trim", "Baseboard and casing", "New baseboard, casing and shoe, filled, caulked and painted", t.baseboardLf, "ln ft", step(INTERIOR, "Trim package"));
  return out;
}

/** The walls and openings changed, priced from the book: the kitchen-remodel "Wall removal" step at its own note's
 *  ranges (a partition $350–750 a foot; a bearing wall on an LVL beam with posts and footings $850–2,100), a new
 *  opening in an outside wall per opening (header, studs, a standard unit set and flashed), partitions framed and
 *  drywalled, the patching, and the engineer's stamped letter when a beam or header is the engineer's to size. A wall
 *  that can't be told from the plan is priced as bearing until it's checked. */
function priceChanges(t: Takeoff, add: AddLine) {
  const cs = t.changes;
  if (!cs.length) return;
  const G = "Walls & structure" as const;
  const out = step(K, "Wall removal");
  const bearingRate = out ? { ...out, price: [850, 2100] as PriceRange } : null;
  const partitionRate = out ? { ...out, price: [350, 750] as PriceRange } : null;
  const frame = step(K, "Framing changes");
  const patch = step(K, "Drywall and patching");
  const opening = step(GC, "New or relocated window and exterior door openings");
  const envelope = step(GC, "Exterior envelope");
  const engineer = step(FOUNDATION, "Structural engineer's stamped");
  const ft = (inches: number) => r05(inches / 12);
  const list = (xs: HouseChange[]) => xs.map((c) => c.title.replace(/^./, (s) => s.toLowerCase())).join("; ");
  const bearingish = (c: HouseChange) => c.reading.bearing !== false;
  const unsure = (xs: HouseChange[]) => (xs.some((c) => c.reading.bearing === null) ? " — priced as bearing until it's checked on site" : "");

  const wallsOut = cs.filter((c) => c.kind === "remove-wall" || c.kind === "move-wall");
  const bOut = wallsOut.filter(bearingish);
  const pOut = wallsOut.filter((c) => !bearingish(c));
  add("wall-out-bearing", G, "Take out a bearing wall · beam", `Shored, ${list(bOut)}; an engineered LVL beam with posts and footings to the engineer's size; outlets in it moved${unsure(bOut)}`, ft(bOut.reduce((s, c) => s + c.inches, 0)), "ln ft", bearingRate);
  add("wall-out-partition", G, "Take out a partition", `${list(pOut)} — to the framing, outlets and switches in it moved`, ft(pOut.reduce((s, c) => s + c.inches, 0)), "ln ft", partitionRate);

  const ops = cs.filter((c) => c.kind === "new-opening" || c.kind === "wider-opening" || c.kind === "moved-opening");
  const ext = ops.filter((c) => c.exterior);
  const intB = ops.filter((c) => !c.exterior && bearingish(c));
  const intP = ops.filter((c) => !c.exterior && !bearingish(c));
  add("opening-outside", G, "New or changed opening in an outside wall", `${list(ext)} — header, king and jack studs, a standard unit set, flashed and trimmed`, ext.length, "ea", opening);
  add("opening-bearing", G, "Opening in a bearing wall · header", `${list(intB)} — shored, a header to the engineer's size, jack and king studs${unsure(intB)}`, ft(intB.reduce((s, c) => s + c.inches, 0)), "ln ft", bearingRate);
  add("opening-partition", G, "Opening in a partition", `${list(intP)} — cut and framed, cased`, ft(intP.reduce((s, c) => s + c.inches, 0)), "ln ft", partitionRate);

  // New partitions: new walls, walls extended, and where a moved wall goes.
  const fresh = cs.filter((c) => c.kind === "new-wall" || c.kind === "move-wall");
  const freshLf = ft(fresh.reduce((s, c) => s + c.inches, 0));
  add("partition-new", G, "Frame new walls", `${list(fresh)} — 2×4 studs, plates, blocking for what hangs on them`, freshLf, "ln ft", frame);
  const closed = cs.filter((c) => c.kind === "closed-opening");
  add("infill", G, "Frame in closed openings", `${list(closed)} — framed in to match the wall`, ft(closed.reduce((s, c) => s + c.inches, 0)), "ln ft", frame);
  const extClosed = closed.filter((c) => c.exterior);
  add("envelope-patch", G, "Patch the outside where an opening closed", "Sheathing, wrap and siding patched to match", Math.round(extClosed.reduce((s, c) => s + (c.inches * 80) / 144, 0)), "sqft", envelope);

  // Drywall: both faces of new walls, a strip at the ceiling and floor and the ends where a wall came out, closed openings.
  const h = t.ceiling / 12;
  const patchSqft = Math.round(wallsOut.reduce((s, c) => s + 2 * (c.inches / 12) + 16, 0) + freshLf * h * 2 + closed.reduce((s, c) => s + (c.inches * 80 * (c.exterior ? 1 : 2)) / 144, 0));
  add("wall-patch", G, "Drywall where walls changed", "New board on new walls, patches where walls came out and openings closed — taped and finished to Level 4", patchSqft, "sqft", patch);

  if (cs.some((c) => c.needs === "engineer")) add("engineer", G, "Structural engineer", "Beam and header design for the changes above, a stamped letter for the permit (fee, at cost)", 1, "lot", engineer);
}

export const lineTotal = (l: EstLine) => Math.round(l.qty * l.unitPrice * 100) / 100;
export const estimateTotal = (lines: EstLine[]) => lines.reduce((s, l) => s + lineTotal(l), 0);

/** The proposal's scope of work, from the design. */
export function scopeText(t: Takeoff, f: Finishes, opts: EstimateOptions, products: readonly DesignProduct[] = []): string {
  const used = t.products.map((u) => products.find((p) => p.id === u.id)).filter((p): p is DesignProduct => !!p);
  const supply = used.length ? ` Supplied from our inventory: ${used.map((p) => productName(p)).join("; ")}.` : "";
  return (t.kind !== "kitchen" ? roomScopeText(t, f, opts) : kitchenScopeText(t, f, opts)) + supply;
}

function kitchenScopeText(t: Takeoff, f: Finishes, opts: EstimateOptions): string {
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
  if (t.changes.length) {
    const eng = t.changes.some((c) => c.needs === "engineer");
    parts.push(`Changes to the house: ${t.changes.map((c) => c.title.replace(/^./, (s) => s.toLowerCase())).join("; ")}${eng ? " — beams and headers to a structural engineer's stamped design" : ""}.`);
  }
  if (opts.permits) parts.push("Permits and inspections.");
  return parts.join(" ");
}

/** The scope of work for any room but the kitchen. */
function roomScopeText(t: Takeoff, f: Finishes, opts: EstimateOptions): string {
  const fx = t.fixtures;
  const fp = floorPreset(f.floor.id);
  const cp = counterPreset(f.counter.id);
  const parts: string[] = [];
  if (t.kind === "bath") {
    if (opts.scope === "remodel") parts.push("Remove the existing fixtures, tile and floor to the studs and subfloor; protect the house and haul the debris.");
    for (const v of fx.vanities) parts.push(`Set a ${v.w} in vanity (${v.code}) with a ${cp.name.toLowerCase()} top, ${v.basins === 2 ? "two undermount basins" : "an undermount basin"} and a mirror over it.`);
    if (fx.toilets) parts.push(`Set ${fx.toilets === 1 ? "the toilet" : `${fx.toilets} toilets`} on new wax rings.`);
    if (fx.tubs) parts.push(`${fx.tubs === 1 ? "An alcove tub" : `${fx.tubs} alcove tubs`} with a tiled surround on cement board.`);
    if (fx.freeTubs) parts.push(`${fx.freeTubs === 1 ? "A freestanding tub" : `${fx.freeTubs} freestanding tubs`} with a floor-mounted filler.`);
    for (const sh of fx.showers) parts.push(`A ${sh.w}×${sh.d} in tiled shower: a waterproofed pan flood-tested before tile, tile to 7 ft, a frameless glass door.`);
    parts.push("A humidity-sensing exhaust fan ducted outside; a 20 A GFCI circuit.");
  } else if (t.kind === "laundry") {
    if (opts.scope === "remodel") parts.push("Take out the old cabinets, shelving and floor; protect the house and haul the debris.");
    if (fx.washers || fx.dryers) parts.push(`Set and connect the washer and dryer${fx.dryers ? ", the dryer vented outside in rigid metal duct" : ""}.`);
    if (fx.utilitySinks) parts.push("A utility sink with its faucet.");
    if (t.cabinetCodes.length) parts.push(`Cabinets: ${t.cabinetCodes.join(", ")}.`);
    if (t.shelvingLf) parts.push(`${t.shelvingLf} ft of shelving and hanging rod.`);
  } else if (opts.scope === "remodel") parts.push("Take up the existing floor and haul it; protect what stays.");
  if (t.kind !== "kitchen" && t.kind !== "bath" && t.kind !== "laundry" && t.shelvingLf) parts.push(`${t.shelvingLf} ft of closet rod and shelving.`);
  parts.push(`${fp.name} floor${f.floor.pattern === "herringbone" ? " in herringbone" : f.floor.pattern === "diagonal" ? " on the diagonal" : ""}.`);
  parts.push(`Walls in ${f.wall.name}${f.wall.code ? ` (${f.wall.code})` : ""}, ${f.wall.sheen === "semi" ? "semi-gloss" : f.wall.sheen}${f.wall.texture !== "smooth" ? `, ${f.wall.texture === "orange" ? "orange-peel" : f.wall.texture} texture` : ""}; ceiling painted; new baseboard.`);
  if (t.cans || t.pendants) parts.push(`${listWords([t.cans && plural(t.cans, "recessed light"), t.pendants && plural(t.pendants, "pendant")].filter(Boolean) as string[])}.`);
  if (t.changes.length) parts.push(`Changes to the house: ${t.changes.map((c) => c.title.replace(/^./, (x) => x.toLowerCase())).join("; ")}.`);
  if (t.furnishings) parts.push("The furniture in the design is there to show the room — it is not part of this price.");
  if (opts.permits && t.kind !== "outdoor") parts.push("Permits and inspections.");
  return parts.join(" ");
}
