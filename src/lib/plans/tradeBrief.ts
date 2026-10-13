// From the takeoff to the estimator: one trade at a time. Pure.
//
// Each trade is priced by the Smart Proposal estimator on its own — its own specialty,
// procedure and price book — from a brief written here: the trade's work and the house
// in words the specialty detector knows, and the takeoff block that lists every measured
// quantity. The estimator's brief binding knows one area and one run per job; a trade
// off a plan has several (drywall walls AND ceilings), so the brief carries no measured
// number at all — the quantities ride in their own block and are bound line by line
// (bindLinesToTakeoff).
import { round } from "./dims";
import { TRADE_LABEL, type House, type PlanTrade, type TakeoffItem } from "./takeoff";

/** What the pricing step needs to know about the house — sent with every trade. */
export type HouseBrief = {
  name: string | null;
  address: string | null;
  levels: Array<{ name: string; areaSqFt: number; plateFt: number }>;
  livingSqFt: number;
  garageSqFt: number;
  porchSqFt: number;
  footprintSqFt: number;
  roof: { rise: number; style: string | null; material: string | null; overhangIn: number };
  foundation: House["foundation"]["type"];
  siding: string | null;
};

export function houseBriefOf(h: House): HouseBrief {
  return {
    name: h.name,
    address: h.address,
    levels: h.levels.map((l) => ({ name: l.name, areaSqFt: l.areaSqFt, plateFt: l.plateFt })),
    livingSqFt: h.livingSqFt,
    garageSqFt: h.garage?.areaSqFt ?? 0,
    porchSqFt: h.porchSqFt,
    footprintSqFt: h.footprintSqFt,
    roof: { rise: h.roof.rise, style: h.roof.style, material: h.roof.material, overhangIn: h.roof.overhangIn },
    foundation: h.foundation.type,
    siding: h.siding,
  };
}

const FOUNDATION_WORD: Record<HouseBrief["foundation"], string> = {
  slab: "slab-on-grade",
  crawlspace: "crawlspace (stem wall on footings)",
  basement: "full basement",
  piers: "pier and beam",
};

const storiesOf = (h: HouseBrief) => Math.max(1, h.levels.filter((l) => l.name !== "Basement").length);
const storyWord = (h: HouseBrief) => ["one", "one", "two", "three", "four"][storiesOf(h)] ?? String(storiesOf(h));

/** The work each trade does on a new house, in the words its specialty's procedure uses. */
const TRADE_WORK: Record<PlanTrade, (h: HouseBrief) => string> = {
  general: () =>
    "General conditions for building a new house: the building permit and fees, survey and staking, temporary power, water and sanitation, site supervision, utility laterals from the street and the final construction clean",
  sitework: () => "Site preparation and excavation for a new single-family house: erosion control, strip topsoil, clear and grade the building pad, excavate the footings, backfill, final grade and landscape restoration",
  foundation: (h) => `Pour the concrete foundation for a new single-family house — ${FOUNDATION_WORD[h.foundation]}: footings, foundation walls, slabs, anchor bolts, footing drains, ${h.foundation === "crawlspace" ? "crawlspace vents and vapor barrier, " : ""}and the driveway and walks`,
  framing: (h) => `Frame a new ${storyWord(h)}-story single-family house: wall framing, floor system and subfloor, roof trusses, wall and roof sheathing, headers, hardware and the rough stairs — the lumber and hardware as listed`,
  roofing: (h) => `New roof on new construction: ${h.roof.material ?? "architectural asphalt shingles"} at ${h.roof.rise}:12 over the new roof deck, underlayment, ice and water shield, drip edge, ridge vent`,
  gutters: () => "Install new seamless aluminum gutters and downspouts on a new house",
  "windows-doors": () => "Supply and install new windows and exterior doors in new construction (nail-fin, flashed and sealed), including the garage door",
  siding: (h) => `Install new ${h.siding ?? "fiber cement lap"} siding on a new ${storyWord(h)}-story house over house wrap, with corner and opening trim, soffit and fascia`,
  insulation: (h) => `Insulate a new house: exterior walls, attic${h.foundation === "crawlspace" ? ", floor over the crawlspace" : ""}, air sealing and the blower-door test`,
  drywall: () => "Hang, tape and finish new drywall throughout a new house, level 4 finish, ceilings and walls, including the garage fire separation",
  "interior-trim": () => "Finish carpentry in a new house: interior pre-hung doors and their hardware, baseboard, casing, window sills, closet shelving, the stair railing and guards, bath accessories and mirrors",
  flooring: () => "Install new flooring in a new house, by room as listed, with its underlayment, transitions and the stair treads",
  tile: () => "Install tile in a new house: bathroom floors, shower and tub walls with backer board and waterproofing, shower pans and niches, kitchen backsplash, and the shower glass",
  cabinets: () => "Supply and install kitchen cabinets, island, bathroom vanities and laundry cabinets, with their countertops and vanity tops, and the kitchen appliances as allowances",
  painting: (h) => `Paint a new ${storyWord(h)}-story house: interior walls and ceilings (prime + two coats), interior doors and trim, exterior siding and trim`,
  plumbing: () => "Plumb a new house: underfloor drain, rough-in supply, drain, waste and vent with every stub-out; gas piping; supply, set and connect every fixture, faucet, valve and trim listed; install the new water heater",
  electrical: () => "Wire a new house: service and panel, rough wiring, dedicated circuits, every device and light fixture as listed, smoke and CO alarms, bath fans, low voltage",
  hvac: () => "Install a new heating and cooling system in a new house with all ductwork, supply and return runs, registers, thermostats, ventilation, exhaust and dryer venting",
};

/**
 * Work one trade owns that a neighbouring trade's procedure also names (a window
 * contractor flashes the opening, so does a sider). When the owner is priced on the
 * same estimate, the neighbour is told to leave it out — the house pays for it once.
 */
const OWNED_WORK: Array<{ owner: PlanTrade; work: string; not: PlanTrade[] | "all" }> = [
  { owner: "general", work: "the building permit, survey, temporary power, water and toilet, site supervision and the final construction clean", not: "all" },
  { owner: "sitework", work: "excavation, pad grading and backfill", not: ["foundation"] },
  { owner: "foundation", work: "footings, foundation walls, slabs, anchor bolts and the driveway and walks", not: ["sitework", "framing"] },
  { owner: "framing", work: "roof and wall sheathing, blocking and the rough stairs", not: ["roofing", "siding", "drywall"] },
  { owner: "windows-doors", work: "setting, flashing and sealing the windows and exterior doors", not: ["framing", "siding"] },
  { owner: "siding", work: "house wrap, exterior trim at the openings, soffit and fascia", not: ["framing", "windows-doors", "roofing", "gutters"] },
  { owner: "gutters", work: "gutters and downspouts", not: ["roofing", "siding"] },
  { owner: "insulation", work: "insulation, air sealing and the blower-door test", not: ["framing", "drywall", "hvac"] },
  { owner: "drywall", work: "drywall hanging, taping and texture, and patching after the trades", not: ["painting", "electrical", "plumbing"] },
  { owner: "interior-trim", work: "interior casing, stool and apron, baseboard and shoe, the stair railing", not: ["windows-doors", "flooring"] },
  { owner: "tile", work: "tile floors, shower and tub walls and the kitchen backsplash", not: ["cabinets", "flooring"] },
  { owner: "cabinets", work: "countertops and vanity tops", not: ["tile"] },
  { owner: "cabinets", work: "the kitchen appliances (supply and set)", not: ["electrical", "plumbing"] },
  { owner: "tile", work: "the shower glass", not: ["plumbing", "windows-doors"] },
  { owner: "hvac", work: "the gas fireplace unit and its vent, and the exhaust and dryer duct runs", not: ["plumbing", "interior-trim", "electrical"] },
  { owner: "windows-doors", work: "the garage door openers", not: ["electrical"] },
  { owner: "painting", work: "priming and painting (siding, trim, doors, walls and ceilings)", not: ["siding", "windows-doors", "drywall", "interior-trim"] },
  { owner: "plumbing", work: "the water heater, gas piping and every fixture's water and drain connection", not: ["hvac", "cabinets"] },
  { owner: "electrical", work: "bath exhaust fans and every circuit, disconnect and appliance connection", not: ["hvac", "plumbing", "cabinets"] },
];

/** The neighbours' work this trade leaves out, given who else is on the estimate. */
export function excludedWork(trade: PlanTrade, alsoPriced: readonly PlanTrade[]): Array<{ owner: PlanTrade; work: string }> {
  return OWNED_WORK.filter((o) => o.owner !== trade && alsoPriced.includes(o.owner) && (o.not === "all" || o.not.includes(trade))).map(({ owner, work }) => ({ owner, work }));
}

export type TradeBrief = {
  trade: PlanTrade;
  label: string;
  /** The free-text brief the estimator reads (the work + the house, no measured numbers). */
  brief: string;
  /** The binding block printed in the prompt (the house, every measured quantity, the rules). */
  takeoffBlock: string;
  items: TakeoffItem[];
};

const fmtQty = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : round(n, 1).toLocaleString("en-US"));

/** The house in one sentence — words only: a measured number here would bind every line. */
export function houseSentence(h: HouseBrief): string {
  const basement = h.levels.some((l) => l.name === "Basement");
  return [
    `New ${storyWord(h)}-story single-family house`,
    basement ? " over a full basement" : ` on a ${FOUNDATION_WORD[h.foundation]} foundation`,
    h.garageSqFt ? " with an attached garage" : "",
    `, ${h.roof.rise}:12 ${h.roof.style ?? "gable"} roof.`,
  ].join("");
}

/** The house with its numbers, for the takeoff block. */
export function houseFacts(h: HouseBrief): string {
  const floors = h.levels.map((l) => `${l.name.toLowerCase()} ${fmtQty(l.areaSqFt)} sq ft`).join(", ");
  return [
    `${storiesOf(h)}-story single-family house, ${fmtQty(h.livingSqFt)} sq ft of living area (${floors})`,
    h.garageSqFt ? `attached garage ${fmtQty(h.garageSqFt)} sq ft` : null,
    h.porchSqFt ? `porch ${fmtQty(h.porchSqFt)} sq ft` : null,
    `footprint ${fmtQty(h.footprintSqFt)} sq ft`,
    `${FOUNDATION_WORD[h.foundation]} foundation`,
    `${h.roof.rise}:12 ${h.roof.style ?? "gable"} roof with a ${h.roof.overhangIn}" overhang${h.roof.material ? `, ${h.roof.material}` : ""}`,
    `plate heights ${h.levels.map((l) => `${l.name.toLowerCase()} ${l.plateFt}'`).join(", ")}`,
    h.siding ? `siding: ${h.siding}` : null,
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * The estimator's own unit words (lib/estimate/console-model ESTIMATE_UNITS). A material
 * bought by the bundle, box or roll is a "unit" there — the takeoff block says which.
 */
export const ESTIMATE_UNIT: Record<TakeoffItem["unit"], string> = {
  "sq ft": "sqft",
  "linear ft": "linear ft",
  each: "unit",
  "cu yards": "cu yards",
  squares: "sq boards",
  sheets: "unit",
  tons: "unit",
  boxes: "unit",
  bundles: "unit",
  rolls: "unit",
  gallons: "unit",
  bags: "unit",
  pieces: "unit",
  sets: "unit",
  buckets: "unit",
  tubes: "unit",
  "sq yd": "sq yards",
  lot: "fixed",
};
const qtyWords = (i: TakeoffItem) => `${fmtQty(i.qty)} ${ESTIMATE_UNIT[i.unit]}${ESTIMATE_UNIT[i.unit] === "unit" && i.unit !== "each" ? ` (${i.unit})` : ""}`;

const ROLE_HEAD: Array<[NonNullable<TakeoffItem["role"]>, string]> = [
  ["labor", "WORK — labor only (each one's materials are listed under MATERIALS):"],
  ["material", "MATERIALS — supply only, in the units they are bought in, waste counted:"],
  ["both", "SUPPLY AND INSTALL — material and labor on one line:"],
];

const SOURCE_WORDS: Record<TakeoffItem["source"], string> = {
  plan: "from the plans",
  derived: "computed from the plans",
  rule: "estimated, the plans are silent",
  entered: "entered by the contractor — exact",
};

export function tradeBrief(trade: PlanTrade, house: HouseBrief, items: TakeoffItem[], alsoPriced: readonly PlanTrade[] = []): TradeBrief {
  const mine = items.filter((i) => i.trade === trade);
  const work = TRADE_WORK[trade](house);
  const brief = `${work}. ${houseSentence(house)} Every quantity is in the blueprint takeoff below.`;
  const leaveOut = excludedWork(trade, alsoPriced);
  const takeoffBlock = [
    "BLUEPRINT TAKEOFF (BINDING — measured from this house's plans; it beats every anchor, default and typical quantity above):",
    `THE HOUSE: ${houseFacts(house)}.`,
    `THIS TRADE'S QUANTITIES (${TRADE_LABEL[trade]}):`,
    ...ROLE_HEAD.flatMap(([role, head]) => {
      const group = mine.filter((i) => (i.role ?? "both") === role);
      return group.length ? [head, ...group.map((i) => `  - ${i.label}: ${qtyWords(i)} (${SOURCE_WORDS[i.source]}: ${i.basis})`)] : [];
    }),
    ...(leaveOut.length
      ? [
          "NOT IN THIS TRADE — another trade prices it on this same estimate, so write no line for it:",
          ...leaveOut.map((o) => `  - ${o.work} (${TRADE_LABEL[o.owner]})`),
        ]
      : []),
    "HOW TO USE IT:",
    "1. Every listed item is work or material this job asks for — price each one, even where the procedure above does not name it, as its own line (or the several steps that build it, each carrying the item's quantity). A line carries its item's quantity exactly, in that unit; never put one item's quantity on another item's line.",
    "2. A WORK line is labor only — its material unit price is 0, because its materials are priced on their own MATERIAL lines. A MATERIAL line is supply only — its labor unit price is 0, because a WORK line installs it. A SUPPLY AND INSTALL line carries both.",
    "3. MATERIAL quantities are already in the unit the material is sold in (a bundle, a 4×12 sheet, a box, a roll, a gallon, a 16' piece) with the waste counted: write the line as `unit` with that quantity, say the package in its name, and price ONE such package at its supplier price, adding no waste. Here this overrides the rule above that packages are not units — shingles stay in bundles, not squares. On WORK and SUPPLY AND INSTALL lines the quantity is measured; waste and coverage loss go into the unit price.",
    '4. An item "estimated, the plans are silent" is a rule of thumb — price it as listed; the contractor adjusts it.',
    "5. This is new construction of the house above, priced for a production new-build crew: no demolition, no removal or repair of existing work.",
  ].join("\n");
  return { trade, label: TRADE_LABEL[trade], brief, takeoffBlock, items: mine };
}

// ── binding the estimator's lines to the takeoff ────────────────────────────

export type BoundLine = { name: string; unit: string; quantity: number; materialUnitPrice: number; laborUnitPrice: number };

const UNIT_ALIASES: Array<[RegExp, TakeoffItem["unit"]]> = [
  [/^(sq\.?\s*ft|sqft|sf|square\s*(feet|foot)|ft2)$/i, "sq ft"],
  [/^(linear\s*(ft|feet|foot)|lf|lin\.?\s*ft|ln\s*ft)$/i, "linear ft"],
  [/^(each|ea|unit|units|pcs?|piece|count|fixture|opening|door|window)s?$/i, "each"],
  [/^(cu\.?\s*(yd|yard)s?|cubic\s*yards?|cy)$/i, "cu yards"],
  [/^(sq|squares?|sq\.?\s*boards?|roofing\s*squares?)$/i, "squares"],
  [/^(sheets?|panels?|boards?)$/i, "sheets"],
  [/^(tons?)$/i, "tons"],
  [/^(box(es)?|cartons?|cases?)$/i, "boxes"],
  [/^(bundles?|bdls?)$/i, "bundles"],
  [/^(rolls?|coils?)$/i, "rolls"],
  [/^(gal(lon)?s?)$/i, "gallons"],
  [/^(bags?|sacks?)$/i, "bags"],
  [/^(sets?|kits?|pairs?)$/i, "sets"],
  [/^(buckets?|pails?)$/i, "buckets"],
  [/^(tubes?|cartridges?)$/i, "tubes"],
  [/^(sq\.?\s*(yd|yard)s?|square\s*yards?|sy)$/i, "sq yd"],
  [/^(lot|fixed|ls|lump\s*sum|allowance)$/i, "lot"],
];
export function takeoffUnit(u: string): TakeoffItem["unit"] | null {
  const s = (u ?? "").trim();
  for (const [re, unit] of UNIT_ALIASES) if (re.test(s)) return unit;
  return null;
}

const STOP = new Set(["and", "the", "of", "a", "an", "to", "for", "with", "in", "on", "new", "install", "supply", "furnish", "labor", "material", "materials", "house", "work"]);
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
function overlap(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  let n = 0;
  for (const w of A) if (B.has(w) || B.has(w.replace(/s$/, "")) || B.has(w + "s")) n++;
  return A.size && B.size ? n / Math.min(A.size, B.size) : 0;
}

/** A line's unit in the estimator's words ("unit" for a bundle, a box, a roll…). */
function estimateUnitOf(u: string): string | null {
  const s = (u ?? "").trim().toLowerCase();
  if (Object.values(ESTIMATE_UNIT).includes(s)) return s;
  if (s === "lf") return "linear ft";
  const t = takeoffUnit(s);
  return t ? ESTIMATE_UNIT[t] : null;
}

/**
 * Hold each line to the takeoff item it prices: same unit (in the estimator's words),
 * and either the names agree or the quantity is a waste-inflated reading of one item
 * (0.85–1.6×). The line's total is kept (the unit prices absorb the change), so the
 * model's money survives and only the quantity goes back to what the plans measure.
 * Lines matching nothing are left alone, and so is a line that measures two items at
 * once ("tape and finish" = walls + ceilings).
 *
 * Then work and supply are kept apart: when the answer prices the trade's materials on
 * their own lines, a line that prices a WORK item drops the material it also carried
 * (the house would buy the shingles twice), and a line that prices a MATERIAL item drops
 * the labor it carried when a work line installs it.
 */
export function bindLinesToTakeoff<T extends BoundLine>(input: T[], items: TakeoffItem[]): { lines: T[]; notes: string[]; snapped: number } {
  const lines = input.map((l) => ({ ...l }));
  let snapped = 0;
  const targets = lines.map((l): TakeoffItem | null => {
    const unit = estimateUnitOf(l.unit);
    if (!unit || !(l.quantity > 0)) return null;
    const same = items.filter((i) => ESTIMATE_UNIT[i.unit] === unit && i.qty > 0);
    if (!same.length) return null;
    const named = (pool: TakeoffItem[]) =>
      pool
        .map((i) => ({ i, s: overlap(l.name, i.label) }))
        .sort((a, b) => b.s - a.s)[0];
    // A quantity the takeoff measures: the item of that quantity the name fits best.
    const exact = same.filter((i) => Math.abs(l.quantity / i.qty - 1) <= 0.03);
    if (exact.length) {
      const best = named(exact);
      // Two items of the same size (the roof and its underlayment) — either is the line's
      // quantity, and when they are the same kind of line its role is known too.
      return best && (best.s >= 0.34 || exact.length === 1 || exact.every((i) => i.role === exact[0].role)) ? best.i : null;
    }
    // Two items measured at once (walls + ceilings) — each a real share of the line, not
    // a bundle count that happens to equal shingles + roof vents.
    const pair = (a: TakeoffItem, b: TakeoffItem) => Math.min(a.qty, b.qty) >= 0.25 * l.quantity && Math.abs(l.quantity / (a.qty + b.qty) - 1) <= 0.03;
    if (same.some((a, k) => same.slice(k + 1).some((b) => pair(a, b)))) return null;
    const byNameHit = named(same);
    const byName = byNameHit && byNameHit.s >= 0.5 ? byNameHit.i : undefined;
    const byQty = same
      .map((i) => ({ i, r: l.quantity / i.qty }))
      .filter((x) => x.r >= 0.85 && x.r <= 1.6)
      .sort((a, b) => Math.abs(Math.log(a.r)) - Math.abs(Math.log(b.r)))[0]?.i;
    const target = byName && l.quantity / byName.qty >= 0.5 && l.quantity / byName.qty <= 2 ? byName : byQty;
    if (!target) return null;
    const r = l.quantity / target.qty;
    l.quantity = target.qty;
    l.materialUnitPrice = Math.round(l.materialUnitPrice * r * 100) / 100;
    l.laborUnitPrice = Math.round(l.laborUnitPrice * r * 100) / 100;
    snapped++;
    return target;
  });
  const pricesMaterials = targets.some((t) => t?.role === "material");
  const pricesWork = targets.some((t) => t?.role === "labor");
  let split = 0;
  lines.forEach((l, k) => {
    const t = targets[k];
    if (t?.role === "labor" && pricesMaterials && l.materialUnitPrice > 0 && l.laborUnitPrice > 0) {
      l.materialUnitPrice = 0;
      split++;
    } else if (t?.role === "material" && pricesWork && l.laborUnitPrice > 0 && l.materialUnitPrice > 0) {
      l.laborUnitPrice = 0;
      split++;
    }
  });
  const notes = [
    snapped ? `${snapped} line quantit${snapped === 1 ? "y follows" : "ies follow"} the blueprint takeoff — waste sits in the unit prices.` : "",
    split ? `${split} line${split === 1 ? "" : "s"} priced both the work and its materials, which have their own lines — kept to ${split === 1 ? "its" : "their"} own part so nothing is bought twice.` : "",
  ].filter(Boolean);
  return { lines, notes, snapped };
}
