// PRICING THE YARD (2026-10-18). Lawn work is priced the way the trade prices it — by the TIME it takes a crew, from
// production rates per machine, at the company's own rate, never below its minimum stop — and every price is held up
// against what the market charges. Production rates are the industry's baseline table (SingleOps; NALP-sourced): a 21"
// push mower 12,500 / 10,000 / 7,500 sq ft an hour on easy / moderate / difficult lawns, a 36" walk-behind 25k / 22.5k /
// 20k, a 48" 35k / 31k / 27k, a 52–61" walk-behind 50k / 45k / 40k, a 52–61" rider 65k / 57.5k / 50k, a 72" rider 90k /
// 80k / 70k; string trimming 1,500 ft an hour and 60 obstacles; edging 9,000 ft hard / 4,000 soft; blowing 25,000 sq ft;
// a push spreader 43,000 sq ft; mulch by hand 2.5 cu yd; bed detail 6,000 sq ft; shrubs 15 small / 10 medium / 6 large.
// The market check is LawnStarter's (2M+ mows a year; per visit by lot size: ≤¼ acre $41–61, ¼–½ $49–69, ½–1 $59–114,
// 1–2 $99–264) scaled by the JobFlex city index. Every number a company can set is in LawnSettings; the defaults are the research's middle. Pure.
import type { YardMeasures } from "./measure";
import { climateFor, mowVisits, type StateClimate } from "./season";

export type Mower = "21" | "36" | "48" | "52wb" | "61rider" | "72rider";
export const MOWERS: Array<{ id: Mower; name: string; rate: [number, number, number] }> = [
  { id: "21", name: '21" push mower', rate: [12500, 10000, 7500] },
  { id: "36", name: '36" walk-behind', rate: [25000, 22500, 20000] },
  { id: "48", name: '48" walk-behind', rate: [35000, 31000, 27000] },
  { id: "52wb", name: '52–61" walk-behind', rate: [50000, 45000, 40000] },
  { id: "61rider", name: '52–61" zero-turn', rate: [65000, 57500, 50000] },
  { id: "72rider", name: '72" zero-turn', rate: [90000, 80000, 70000] },
];
const RATE = {
  trimFtPerHr: 1500,
  obstaclesPerHr: 60,
  edgeHardFtPerHr: 9000,
  edgeSoftFtPerHr: 4000,
  blowSqftPerHr: 25000,
  spreaderSqftPerHr: 43000,
  aerateSqftPerHr: 12000,
  dethatchSqftPerHr: 8000,
  mulchYdPerHr: 2.5,
  bedDetailSqftPerHr: 6000,
  cleanupSqftPerHr: 2000,
  shrubsPerHr: { small: 15, medium: 10, large: 6 },
  hedgeFaceSqftPerHr: 1500,
};

export type LawnSettings = {
  /** What the company bills for one person's hour on a property (crew time is people × hours). */
  ratePerPersonHour: number;
  crewSize: number;
  /** The machines the crew carries; the biggest that suits the lawn is used. */
  mowers: Mower[];
  /** Never less than this a stop. */
  minimumStop: number;
  /** Driving and unloading per stop, minutes (the whole crew rides). */
  stopMinutes: number;
  /** Materials: cost and the markup on it. */
  mulchCostPerYd: number;
  deliveryFee: number;
  fertCostPer1000: number;
  seedCostPer1000: number;
  materialMarkupPct: number;
  /** Disposal of debris from a cleanup. */
  haulFee: number;
  /** Aerator / dethatcher on the trailer: a charge a job for the machine. */
  equipmentFee: number;
};

export const DEFAULT_LAWN_SETTINGS: LawnSettings = {
  ratePerPersonHour: 55,
  crewSize: 2,
  mowers: ["21", "48", "61rider"],
  minimumStop: 45,
  stopMinutes: 8,
  mulchCostPerYd: 38,
  deliveryFee: 75,
  fertCostPer1000: 4.5,
  seedCostPer1000: 14,
  materialMarkupPct: 30,
  haulFee: 55,
  equipmentFee: 45,
};

export type Difficulty = "easy" | "moderate" | "difficult";

/** How hard the lawn is to mow: trees to go around, slope, and how broken up it is (edge per area). */
export function difficultyOf(m: YardMeasures): { level: Difficulty; why: string[] } {
  const why: string[] = [];
  let score = 0;
  const per1000 = m.lawnSqft > 0 ? (m.treesInLawn / m.lawnSqft) * 1000 : 0;
  if (per1000 > 1.5) {
    score += 2;
    why.push(`${m.treesInLawn} trees in the lawn`);
  } else if (m.treesInLawn >= 2) {
    score += 1;
    why.push(`${m.treesInLawn} trees to mow around`);
  }
  if (m.slope.steep > 0.2) {
    score += 2;
    why.push(`${Math.round(m.slope.steep * 100)}% of it steeper than 20%`);
  } else if (m.slope.moderate + m.slope.steep > 0.3) {
    score += 1;
    why.push("rolling ground");
  }
  const edgeFt = m.edges.hardFt + m.edges.bedFt + m.edges.houseFt + m.edges.treeFt + m.edges.lotLineFt;
  const edgePer1000 = m.lawnSqft > 0 ? (edgeFt / m.lawnSqft) * 1000 : 0;
  if (edgePer1000 > 110) {
    score += 2;
    why.push("many small pieces of lawn");
  } else if (edgePer1000 > 70) {
    score += 1;
    why.push("broken up by beds and walks");
  }
  return { level: score >= 4 ? "difficult" : score >= 2 ? "moderate" : "easy", why };
}

/** The mower that suits the lawn among those the crew has: the biggest it carries that the lawn is big enough for —
 *  a small lawn takes the push mower, a typical yard a 36–48" walk-behind (it fits a backyard gate), only a big open
 *  lawn the rider. */
export function pickMower(m: YardMeasures, have: Mower[]): Mower {
  const order: Mower[] = ["21", "36", "48", "52wb", "61rider", "72rider"];
  const owned = order.filter((x) => have.includes(x));
  if (!owned.length) return "21";
  const cap: Mower = m.lawnSqft < 1500 ? "21" : m.lawnSqft < 6000 ? "48" : m.lawnSqft < 15000 ? "61rider" : "72rider";
  const fits = owned.filter((x) => order.indexOf(x) <= order.indexOf(cap));
  return fits.length ? fits[fits.length - 1] : owned[0];
}

const money = (n: number) => Math.max(0, Math.round(n));
const round5 = (n: number) => Math.round(n / 5) * 5;

export type ServiceId =
  | "mow"
  | "fert"
  | "aerate"
  | "overseed"
  | "dethatch"
  | "springCleanup"
  | "fallCleanup"
  | "mulch"
  | "bedWeeding"
  | "shrubs"
  | "hedges"
  | "irrigationStart"
  | "irrigationBlowout"
  | "gutters"
  | "snow";

/** Units the proposal speaks. */
export type LawnUnit = "visit" | "application" | "sqft" | "cu yd" | "ea" | "ln ft" | "lot" | "push";

export type PricedService = {
  id: ServiceId;
  name: string;
  desc: string;
  /** Per visit / application / job. */
  unitPrice: number;
  unit: LawnUnit;
  /** How many a season (a mow: the season's visits; mulch: cubic yards; a cleanup: 1). */
  qty: number;
  /** The share of the price that is labour (for the proposal's lines). */
  labor: number;
  /** Person-hours a visit — for the schedule and the crew's day. */
  hours: number;
  /** What the market charges for the same, when the research has a number. */
  market?: { low: number; high: number; basis: string };
  /** Maintenance (a service), install (an improvement) or materials — sales tax treats them apart in some states. */
  taxClass: "service" | "install";
};

export type ServiceOptions = {
  frequency: "weekly" | "biweekly";
  /** Fertilizer and weed-control rounds a year. */
  fertRounds: number;
  mulchDepthIn: 2 | 3;
  /** Shrubs by size, hedge face (length × height), irrigation zones, the house's stories — what the photo can't see. */
  shrubs: { small: number; medium: number; large: number };
  hedgeFaceSqft: number;
  irrigationZones: number;
  stories: number;
  /** Snow: pushes a season (a contract) — 0 for none. */
  snowPushes: number;
};

export const DEFAULT_OPTIONS: ServiceOptions = { frequency: "weekly", fertRounds: 5, mulchDepthIn: 2, shrubs: { small: 0, medium: 0, large: 0 }, hedgeFaceSqft: 0, irrigationZones: 0, stories: 1, snowPushes: 0 };

export type PricingContext = {
  measures: YardMeasures;
  settings: LawnSettings;
  options: ServiceOptions;
  /** The JobFlex city index (1 = US average) — scales the market check, and the default rate until the company sets its own. */
  locationFactor: number;
  state: string | null;
  /** The company set its own rate (else the default is scaled to the market). */
  ownRate: boolean;
};

export type LawnQuote = {
  mower: Mower;
  difficulty: { level: Difficulty; why: string[] };
  climate: StateClimate;
  visits: number;
  services: PricedService[];
  rate: number;
};

/** The company's hour, scaled to the market when it hasn't set its own. */
export const effectiveRate = (c: Pick<PricingContext, "settings" | "locationFactor" | "ownRate">) => (c.ownRate ? c.settings.ratePerPersonHour : Math.round(c.settings.ratePerPersonHour * c.locationFactor));

export function priceYard(ctx: PricingContext): LawnQuote {
  const { measures: m, settings: s, options: o } = ctx;
  const rate = effectiveRate(ctx);
  const mk = 1 + s.materialMarkupPct / 100;
  const stopHrs = (s.stopMinutes / 60) * s.crewSize;
  const diff = difficultyOf(m);
  const di = diff.level === "easy" ? 0 : diff.level === "moderate" ? 1 : 2;
  const mower = pickMower(m, s.mowers);
  const mowRate = MOWERS.find((x) => x.id === mower)!.rate[di];
  const slopeK = 1 + m.slope.moderate * 0.15 + m.slope.steep * 0.35;
  const climate = climateFor(ctx.state);
  const visits = mowVisits(climate, o.frequency);
  const lf = ctx.locationFactor;
  const out: PricedService[] = [];
  const push = (p: PricedService) => {
    if (p.qty > 0 && p.unitPrice > 0) out.push(p);
  };

  // Mowing: mow, string-trim the house, trees and fence lines, edge the pavement, blow the hard surfaces off.
  if (m.lawnSqft > 0) {
    const mowH = (m.lawnSqft / mowRate) * slopeK;
    const trimH = (m.edges.houseFt + m.edges.treeFt + m.edges.lotLineFt + m.edges.bedFt * 0.5) / RATE.trimFtPerHr + m.treesInLawn / RATE.obstaclesPerHr;
    const edgeH = m.edges.hardFt / RATE.edgeHardFtPerHr;
    const blowH = Math.min(m.hardSqft, 4000) / RATE.blowSqftPerHr;
    const hours = mowH + trimH + edgeH + blowH + stopHrs;
    const price = Math.max(s.minimumStop, round5(hours * rate));
    // LawnStarter's per-visit prices by LOT size (2026): ≤¼ acre $41–61, ¼–½ $49–69, ½–1 $59–114, 1–2 $99–264.
    const acres = m.lotSqft / 43560;
    const band = acres <= 0.25 ? [41, 61] : acres <= 0.5 ? [49, 69] : acres <= 1 ? [59, 114] : [99, 264];
    push({
      id: "mow",
      name: o.frequency === "weekly" ? "Weekly mowing" : "Every-other-week mowing",
      desc: `Mow ${m.lawnSqft.toLocaleString("en-US")} sq ft (${MOWERS.find((x) => x.id === mower)!.name}), string-trim along the house, trees and fence lines, edge ${m.edges.hardFt} ft of walks and drive, blow the hard surfaces clean — ${visits} visits a season`,
      unitPrice: price,
      unit: "visit",
      qty: visits,
      labor: 0.92,
      hours: Math.round(hours * 100) / 100,
      market: { low: money(band[0] * lf), high: money(band[1] * lf), basis: `LawnStarter, a ${acres <= 0.25 ? "lot up to ¼ acre" : acres <= 0.5 ? "¼–½ acre lot" : acres <= 1 ? "½–1 acre lot" : "1–2 acre lot"}, at this city's index` },
      taxClass: "service",
    });
  }
  // Fertilizer and weed control: per application, by the thousand square feet.
  if (m.lawnSqft > 0 && o.fertRounds > 0) {
    const hours = m.lawnSqft / RATE.spreaderSqftPerHr + 0.25 + stopHrs / s.crewSize;
    const price = Math.max(s.minimumStop, round5(hours * rate + (m.lawnSqft / 1000) * s.fertCostPer1000 * mk));
    push({
      id: "fert",
      name: "Fertilizer & weed control",
      desc: `${o.fertRounds} applications a year on ${m.lawnSqft.toLocaleString("en-US")} sq ft — slow-release feeding, pre-emergent for crabgrass in spring, broadleaf weeds spot-treated`,
      unitPrice: price,
      unit: "application",
      qty: o.fertRounds,
      labor: 0.45,
      hours: Math.round(hours * 100) / 100,
      market: { low: money(50 * lf), high: money(100 * lf), basis: "Fixr 2025, per visit in a program" },
      taxClass: "service",
    });
  }
  // Core aeration, and overseeding behind it.
  if (m.lawnSqft > 0) {
    const hours = m.lawnSqft / RATE.aerateSqftPerHr + 0.3 + stopHrs / s.crewSize;
    const price = round5(Math.max(85 * lf, hours * rate + s.equipmentFee));
    push({
      id: "aerate",
      name: "Core aeration",
      desc: `Core-aerate ${m.lawnSqft.toLocaleString("en-US")} sq ft, two passes on compacted ground; sprinkler heads flagged first`,
      unitPrice: price,
      unit: "lot",
      qty: 1,
      labor: 0.7,
      hours: Math.round(hours * 100) / 100,
      market: { low: money(((m.lawnSqft / 10000) * 120 + 20) * lf), high: money(((m.lawnSqft / 10000) * 175 + 40) * lf), basis: "HomeAdvisor, $120–175 per 10,000 sq ft" },
      taxClass: "service",
    });
    const seedH = m.lawnSqft / RATE.spreaderSqftPerHr + 0.2;
    push({
      id: "overseed",
      name: "Overseeding",
      desc:
        climate.zone !== "warm"
          ? `Seed spread behind the aerator over ${m.lawnSqft.toLocaleString("en-US")} sq ft, the grass the lawn has (${climate.grasses})`
          : climate.grasses.toLowerCase().startsWith("bermuda")
            ? `Winter rye overseeded into ${m.lawnSqft.toLocaleString("en-US")} sq ft of bermuda in October, for a green winter`
            : `Bare spots patched in spring — St. Augustine and centipede with plugs or sod, seed only where the grass takes it`,
      unitPrice: round5(seedH * rate + (m.lawnSqft / 1000) * s.seedCostPer1000 * mk),
      unit: "lot",
      qty: 1,
      labor: 0.35,
      hours: Math.round(seedH * 100) / 100,
      taxClass: "service",
    });
    const dH = m.lawnSqft / RATE.dethatchSqftPerHr + 0.3;
    push({
      id: "dethatch",
      name: "Dethatching",
      desc: "Power-rake the thatch out and haul it away",
      unitPrice: round5(dH * rate + s.equipmentFee + s.haulFee * 0.5),
      unit: "lot",
      qty: 1,
      labor: 0.75,
      hours: Math.round(dH * 100) / 100,
      market: { low: money(((m.lawnSqft / 1000) * 10) * lf), high: money(((m.lawnSqft / 1000) * 30) * lf), basis: "Angi, $10–30 per 1,000 sq ft" },
      taxClass: "service",
    });
  }
  // Cleanups: the whole yard (lawn and beds), slower the more trees drop leaves on it.
  const yard = m.lawnSqft + m.bedSqft;
  if (yard > 0) {
    const canopy = m.lotSqft ? m.treeCanopySqft / m.lotSqft : 0;
    const springH = (yard / RATE.cleanupSqftPerHr) * (1 + canopy * 1.5) + stopHrs;
    const fallH = (yard / RATE.cleanupSqftPerHr) * (1 + canopy * 3) + stopHrs;
    const acres = m.lotSqft / 43560;
    push({ id: "springCleanup", name: "Spring cleanup", desc: "Winter debris raked out of the lawn and beds, beds tidied, the first cut's height set", unitPrice: Math.max(s.minimumStop * 2, round5(springH * rate + s.haulFee)), unit: "lot", qty: 1, labor: 0.85, hours: Math.round(springH * 100) / 100, market: { low: money(Math.max(150, acres * 900) * lf), high: money(Math.max(250, acres * 1600) * lf), basis: "Jobber, ¼ acre $225–400" }, taxClass: "service" });
    push({ id: "fallCleanup", name: "Fall leaf cleanup", desc: `Leaves blown and mulched or hauled from the lawn and beds — ${Math.round(canopy * 100)}% of the lot is under trees`, unitPrice: Math.max(s.minimumStop * 2, round5(fallH * rate + s.haulFee)), unit: "lot", qty: 1, labor: 0.85, hours: Math.round(fallH * 100) / 100, market: { low: money(Math.max(70, acres * 400) * lf), high: money(Math.max(200, acres * 1000) * lf), basis: "HomeAdvisor, $400–1,000 an acre" }, taxClass: "service" });
  }
  // Mulch: cubic yards = bed area × depth ÷ 324, plus 10% for settling and edges; the beds re-edged.
  if (m.bedSqft > 0) {
    const yd = Math.ceil(((m.bedSqft * o.mulchDepthIn) / 324) * 1.1 * 2) / 2;
    const hours = yd / RATE.mulchYdPerHr + m.bedPerimeterFt / RATE.edgeSoftFtPerHr;
    const perYd = round5((hours * rate) / yd + s.mulchCostPerYd * mk);
    push({
      id: "mulch",
      name: `Mulch, ${o.mulchDepthIn}" deep`,
      desc: `${yd} cu yd over ${m.bedSqft.toLocaleString("en-US")} sq ft of beds, beds edged (${m.bedPerimeterFt} ft), weeds pulled first; delivery ${s.deliveryFee ? `$${s.deliveryFee}` : "included"}`,
      unitPrice: perYd,
      unit: "cu yd",
      qty: yd,
      labor: 0.55,
      hours: Math.round(hours * 100) / 100,
      market: { low: money(35 * lf), high: money(170 * lf), basis: "HomeAdvisor 2026, installed per cu yd" },
      taxClass: "install",
    });
    const wH = m.bedSqft / RATE.bedDetailSqftPerHr + 0.1;
    push({ id: "bedWeeding", name: "Bed weeding & detail", desc: `Weeds pulled and beds tidied, ${m.bedSqft.toLocaleString("en-US")} sq ft — each visit it's booked`, unitPrice: Math.max(25, round5(wH * rate)), unit: "visit", qty: Math.max(1, Math.round(visits / 4)), labor: 0.95, hours: Math.round(wH * 100) / 100, taxClass: "service" });
  }
  const shrubCount = o.shrubs.small + o.shrubs.medium + o.shrubs.large;
  if (shrubCount > 0) {
    const hours = o.shrubs.small / RATE.shrubsPerHr.small + o.shrubs.medium / RATE.shrubsPerHr.medium + o.shrubs.large / RATE.shrubsPerHr.large + 0.2;
    push({ id: "shrubs", name: "Shrub trimming", desc: `${o.shrubs.small} small, ${o.shrubs.medium} medium and ${o.shrubs.large} large shrubs shaped, clippings hauled`, unitPrice: round5(hours * rate + s.haulFee * 0.5), unit: "lot", qty: 1, labor: 0.9, hours: Math.round(hours * 100) / 100, market: { low: money(shrubCount * 5 * lf), high: money(shrubCount * 20 * lf), basis: "Jobber, $5–20 a bush" }, taxClass: "service" });
  }
  if (o.hedgeFaceSqft > 0) {
    const hours = o.hedgeFaceSqft / RATE.hedgeFaceSqftPerHr + 0.25;
    push({ id: "hedges", name: "Hedge trimming", desc: `${o.hedgeFaceSqft} sq ft of hedge face (both sides and the top) sheared, clippings hauled`, unitPrice: round5(hours * rate + s.haulFee * 0.5), unit: "lot", qty: 1, labor: 0.9, hours: Math.round(hours * 100) / 100, taxClass: "service" });
  }
  if (o.irrigationZones > 0) {
    const z = o.irrigationZones;
    const blow = z <= 2 ? [50, 85] : z <= 4 ? [80, 100] : z <= 6 ? [100, 135] : [150, 235];
    push({ id: "irrigationStart", name: "Sprinkler start-up", desc: `${z} zones turned on, heads checked and aimed, the controller set to the season`, unitPrice: round5(((blow[0] + blow[1]) / 2) * lf), unit: "lot", qty: 1, labor: 0.8, hours: 0.15 * z + 0.3, market: { low: money(50 * lf), high: money(150 * lf), basis: "start-up $50–150" }, taxClass: "service" });
    push({ id: "irrigationBlowout", name: "Sprinkler winterization (blowout)", desc: `${z} zones blown out with compressed air before the first freeze, the backflow drained`, unitPrice: round5(((blow[0] + blow[1]) / 2) * lf), unit: "lot", qty: 1, labor: 0.8, hours: 0.12 * z + 0.3, market: { low: money(blow[0] * lf), high: money(blow[1] * lf), basis: `LawnStarter, ${z} zones` }, taxClass: "service" });
  }
  // Gutters: the house's outline is the gutter line (from the footprint); the stories set the ladder.
  if (m.houseSqft > 0) {
    const gutterFt = Math.round(Math.sqrt(m.houseSqft) * 4 * 1.05);
    const perFt = o.stories >= 3 ? 1.75 : o.stories === 2 ? 1.4 : 1.1;
    push({ id: "gutters", name: "Gutter cleaning", desc: `About ${gutterFt} ft of gutter on a ${o.stories}-story house, downspouts flushed`, unitPrice: Math.max(s.minimumStop * 2, round5(gutterFt * perFt * lf)), unit: "lot", qty: 1, labor: 0.9, hours: Math.round((gutterFt / 120) * 100) / 100, market: { low: money(gutterFt * (o.stories >= 2 ? 1 : 0.95) * lf), high: money(gutterFt * (o.stories >= 2 ? 1.85 : 1.25) * lf), basis: "HomeAdvisor, per linear foot" }, taxClass: "service" });
  }
  // Snow: the driveway and walks (the hard surfaces in the lot) cleared a push at a time.
  if (o.snowPushes > 0 && m.hardSqft > 0) {
    const area = Math.min(m.hardSqft, 6000);
    const per = Math.max(45 * lf, round5((35 + area * 0.03) * lf));
    push({ id: "snow", name: "Snow clearing", desc: `Driveway and walks (about ${area.toLocaleString("en-US")} sq ft) cleared after each snowfall of 2" or more; salt billed apart`, unitPrice: per, unit: "push", qty: o.snowPushes, labor: 0.85, hours: area / 3000 + 0.2, market: { low: money(45 * lf), high: money(160 * lf), basis: "LawnStarter 2025, per visit" }, taxClass: "service" });
  }
  return { mower, difficulty: diff, climate, visits, services: out, rate };
}

const clampNum = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** A company's lawn rates from anything (a form, a stored row), every number held to sense. */
export function cleanLawnSettings(raw: unknown): LawnSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_LAWN_SETTINGS;
  const mowers = Array.isArray(o.mowers) ? (o.mowers.filter((m) => MOWERS.some((x) => x.id === m)) as Mower[]) : d.mowers;
  return {
    ratePerPersonHour: clampNum(o.ratePerPersonHour, 15, 400, d.ratePerPersonHour),
    crewSize: Math.round(clampNum(o.crewSize, 1, 8, d.crewSize)),
    mowers: mowers.length ? mowers : d.mowers,
    minimumStop: clampNum(o.minimumStop, 0, 1000, d.minimumStop),
    stopMinutes: clampNum(o.stopMinutes, 0, 120, d.stopMinutes),
    mulchCostPerYd: clampNum(o.mulchCostPerYd, 0, 400, d.mulchCostPerYd),
    deliveryFee: clampNum(o.deliveryFee, 0, 1000, d.deliveryFee),
    fertCostPer1000: clampNum(o.fertCostPer1000, 0, 100, d.fertCostPer1000),
    seedCostPer1000: clampNum(o.seedCostPer1000, 0, 200, d.seedCostPer1000),
    materialMarkupPct: clampNum(o.materialMarkupPct, 0, 300, d.materialMarkupPct),
    haulFee: clampNum(o.haulFee, 0, 1000, d.haulFee),
    equipmentFee: clampNum(o.equipmentFee, 0, 1000, d.equipmentFee),
  };
}

export function cleanOptions(raw: unknown): ServiceOptions {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_OPTIONS;
  const sh = (o.shrubs && typeof o.shrubs === "object" ? o.shrubs : {}) as Record<string, unknown>;
  return {
    frequency: o.frequency === "biweekly" ? "biweekly" : "weekly",
    fertRounds: Math.round(clampNum(o.fertRounds, 0, 10, d.fertRounds)),
    mulchDepthIn: o.mulchDepthIn === 3 ? 3 : 2,
    shrubs: { small: Math.round(clampNum(sh.small, 0, 500, 0)), medium: Math.round(clampNum(sh.medium, 0, 500, 0)), large: Math.round(clampNum(sh.large, 0, 500, 0)) },
    hedgeFaceSqft: Math.round(clampNum(o.hedgeFaceSqft, 0, 100000, 0)),
    irrigationZones: Math.round(clampNum(o.irrigationZones, 0, 60, 0)),
    stories: Math.round(clampNum(o.stories, 1, 4, d.stories)),
    snowPushes: Math.round(clampNum(o.snowPushes, 0, 60, 0)),
  };
}
