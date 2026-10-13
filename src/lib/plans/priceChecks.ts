// The builder price book's word on a house priced from its plans. Pure (server-side:
// the price book is too big to ship to the browser).
//
// Every trade is priced on its own by the estimator; nothing there knows what a whole
// new house costs. The new-home builder's price book does (lib/estimate/step-prices,
// residential-new-home-builder, NAHB 2024 and its sources): a cost per square foot of
// living area for the house and for each phase of it. Those numbers are set against
// the trades here — not to change a price, but to tell the contractor which trade
// came back far under or over what a house this size costs in this market.
import { locationIndex } from "../estimate/location-index";
import { pricesFor, toCost } from "../estimate/step-prices";
import type { HouseBrief } from "./tradeBrief";
import type { PlanTrade, TakeoffItem } from "./takeoff";

export type PriceCheck = {
  /** The trades whose total is held to this range (two or more for a combined phase). */
  trades: PlanTrade[];
  label: string;
  /** Contractor cost, before markup, in the job's market. */
  low: number;
  high: number;
  /** What the range is per, in words ("2,280 sq ft of living area"). */
  basis: string;
};

export type PriceChecks = {
  place: string;
  checks: PriceCheck[];
  /** The whole house: cost per sq ft of living area, and in total. */
  house: { low: number; high: number; perSqFt: [number, number]; livingSqFt: number } | null;
};

const BUILDER = "residential-new-home-builder";
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function planPriceChecks(h: HouseBrief, items: TakeoffItem[], location: string | null | undefined): PriceChecks {
  const book = pricesFor(BUILDER);
  const idx = locationIndex(location);
  const place = idx.level === "national" ? "the US" : idx.place;
  const checks: PriceCheck[] = [];
  if (!book) return { place, checks, house: null };
  const q = (id: string) => items.find((i) => i.id === id)?.qty ?? 0;
  const count = (trade: PlanTrade, pred: (i: TakeoffItem) => boolean = () => true) =>
    items.filter((i) => i.trade === trade && i.unit === "each" && pred(i)).reduce((a, i) => a + i.qty, 0);
  const cost = (prefix: string, qty: number): [number, number] | null => {
    const hit = Object.entries(book.steps).find(([k]) => k.startsWith(prefix));
    if (!hit || !(qty > 0)) return null;
    const p = hit[1];
    return [toCost(p.price[0], book.op, p.fee) * idx.factor * qty, toCost(p.price[1], book.op, p.fee) * idx.factor * qty];
  };
  const push = (trades: PlanTrade[], label: string, basis: string, ...parts: Array<[number, number] | null>) => {
    const got = parts.filter((p): p is [number, number] => !!p);
    if (!got.length) return;
    checks.push({ trades, label, basis, low: Math.round(got.reduce((a, p) => a + p[0], 0)), high: Math.round(got.reduce((a, p) => a + p[1], 0)) });
  };
  const living = h.livingSqFt;
  const livingWords = `${fmt(living)} sq ft of living area`;

  push(["sitework"], "Site work", `a ${fmt(q("sitework.pad"))} sq ft building pad`, cost("Site work:", q("sitework.pad")));
  const foundationCy = q("foundation.footing-cy") + q("foundation.wall-cy") + (h.foundation === "slab" ? q("foundation.slab-cy") : 0);
  const flatSqFt = (h.foundation === "slab" ? 0 : q("foundation.slab")) + q("foundation.flatwork");
  push(["foundation"], "Foundation & concrete", `${fmt(foundationCy)} cu yd of foundation${flatSqFt ? ` and ${fmt(flatSqFt)} sq ft of slab and flatwork` : ""}`, cost("Foundation:", foundationCy), cost("Garage slab, driveway, walks and porch:", flatSqFt));
  push(["framing"], "Framing", livingWords, cost("Framing:", living));
  push(["roofing"], "Roofing", `${fmt(q("roofing.area"))} sq ft of roof`, cost("Roofing:", q("roofing.area")));
  // The openings themselves — not their install lines, openers or hardware.
  const openings = count("windows-doors", (i) => /^windows-doors\.(win-|door-|windows$|ext-doors$|garage-door$)/.test(i.id));
  push(["windows-doors"], "Windows & exterior doors", `${fmt(openings)} windows and doors`, cost("Windows and exterior doors:", openings));
  // The book prices cladding per sq ft of wall WITH the gutters — one phase, two trades.
  push(["siding", "gutters"], "Siding, trim and gutters", `${fmt(q("siding.wrap") || q("siding.net"))} sq ft of exterior wall`, cost("Exterior cladding:", q("siding.wrap") || q("siding.net")));
  const fixtures = q("plumbing.rough") || count("plumbing", (i) => i.id.startsWith("plumbing.fix-") && !/hoseBib|gas|iceMaker/.test(i.id));
  push(["plumbing"], "Plumbing", `${fmt(fixtures)} fixtures`, cost("Rough plumbing by fixture:", fixtures));
  push(["electrical"], "Electrical", livingWords, cost("Rough electrical:", living));
  const systems = q("hvac.system") || 1;
  push(["hvac"], "HVAC", systems > 1 ? `${systems} systems with their ducts` : "one system with its ducts", cost("HVAC:", systems));
  push(["insulation"], "Insulation", livingWords, cost("Insulation and air sealing:", living));
  push(["drywall"], "Drywall", livingWords, cost("Drywall:", living));
  push(["painting", "interior-trim", "cabinets", "flooring", "tile"], "Interior finishes (paint, trim, cabinets, flooring, tile)", livingWords, cost("Interior finishes:", living));

  const b = book.benchmark;
  const per: [number, number] = [toCost(b.price[0], book.op) * idx.factor, toCost(b.price[1], book.op) * idx.factor];
  const house = living > 0 ? { low: Math.round(per[0] * living), high: Math.round(per[1] * living), perSqFt: [Math.round(per[0]), Math.round(per[1])] as [number, number], livingSqFt: living } : null;
  return { place, checks, house };
}
