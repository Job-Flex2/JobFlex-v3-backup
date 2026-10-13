// The trades of a house, priced one by one, made into ONE estimate. Pure, browser-safe.
//
// Each trade came back as its own estimate. The ledger gets every line, in build order
// (general conditions first, then the site, the foundation, the frame…), each tagged with
// its trade so the ledger can head it and the proposal can name it. Under the ledger go
// the notes the contractor must read: the builder price book's check, what the plans did
// not say, and what each trade's own checks changed.
import { isBilled, lineTotal, linesFromEstimate, type ConsoleLine } from "../estimate/console-model";
import type { GeneratedEstimate } from "../estimatorSchema";
import type { PriceChecks } from "./priceChecks";
import { PLAN_TRADES, TRADE_LABEL, type PlanTrade, type TakeoffCheck } from "./takeoff";
import type { HouseBrief } from "./tradeBrief";

export type TradeResult = { trade: PlanTrade; est: GeneratedEstimate };

export type PlanEstimate = {
  lines: ConsoleLine[];
  title: string;
  scope: string;
  assumptions: string[];
  notes: string[];
  timelineDays: number | null;
  /** Each trade's billed total at cost (suggestions left out). */
  totals: Partial<Record<PlanTrade, number>>;
};

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const money = (n: number) => `$${fmt(n)}`;

/**
 * The price book's checks as the contractor reads them under the ledger: only a trade
 * (or a phase of two or more trades) that came back well outside the book — under 75%
 * of its low or over 135% of its high — and the whole house when all of it was priced.
 */
export function priceCheckNotes(pc: PriceChecks, totals: Partial<Record<PlanTrade, number>>, wholeHouse: boolean): string[] {
  const notes: string[] = [];
  for (const c of pc.checks) {
    if (!c.trades.every((t) => totals[t] != null)) continue;
    const total = c.trades.reduce((a, t) => a + (totals[t] ?? 0), 0);
    if (total < c.low * 0.75) {
      notes.push(`Price book check · ${c.label}: ${money(total)} is under the builder price book's ${money(c.low)}–${money(c.high)} at cost for ${c.basis} in ${pc.place} — check its lines for missing work.`);
    } else if (total > c.high * 1.35) {
      notes.push(`Price book check · ${c.label}: ${money(total)} is over the builder price book's ${money(c.low)}–${money(c.high)} at cost for ${c.basis} in ${pc.place} — check its quantities and unit prices.`);
    }
  }
  if (wholeHouse && pc.house) {
    const total = Object.values(totals).reduce((a: number, n) => a + (n ?? 0), 0);
    const per = total / Math.max(1, pc.house.livingSqFt);
    notes.unshift(
      `Price book check · whole house: ${money(total)} at cost = ${money(per)}/sq ft of living area. A new house in ${pc.place} runs ${money(pc.house.perSqFt[0])}–${money(pc.house.perSqFt[1])}/sq ft at cost (${money(pc.house.low)}–${money(pc.house.high)}) before your markup.`,
    );
  }
  return notes;
}

export function planTitle(house: HouseBrief, trades: readonly PlanTrade[], wholeHouse: boolean): string {
  const stories = Math.max(1, house.levels.filter((l) => l.name !== "Basement").length);
  const head = house.name?.trim() || `New ${stories}-story house, ${fmt(house.livingSqFt)} sq ft`;
  const what = wholeHouse ? "whole house" : trades.length <= 2 ? trades.map((t) => TRADE_LABEL[t].toLowerCase()).join(" and ") : `${trades.length} trades`;
  return `${head} — ${what}`.slice(0, 140);
}

export function mergePlanEstimate(input: {
  house: HouseBrief;
  results: TradeResult[];
  checks: TakeoffCheck[];
  priceChecks: PriceChecks | null;
  wholeHouse: boolean;
}): PlanEstimate {
  const ordered = PLAN_TRADES.flatMap((t) => input.results.filter((r) => r.trade === t));
  const lines: ConsoleLine[] = [];
  const totals: Partial<Record<PlanTrade, number>> = {};
  const assumptions: string[] = [];
  const tradeNotes: string[] = [];
  const scopes: string[] = [];
  let days = 0;
  for (const r of ordered) {
    const label = TRADE_LABEL[r.trade];
    const mine = linesFromEstimate(r.est).map((l) => ({ ...l, id: `${r.trade}.${l.id}`, group: label }));
    lines.push(...mine);
    totals[r.trade] = Math.round(mine.filter(isBilled).reduce((a, l) => a + lineTotal(l), 0) * 100) / 100;
    for (const a of r.est.assumptions ?? []) if (a.trim() && !assumptions.includes(a.trim())) assumptions.push(a.trim());
    for (const n of r.est.notes ?? []) tradeNotes.push(`${label} · ${n}`);
    const sc = (r.est.scope ?? "").trim();
    if (sc) scopes.push(`${label.toUpperCase()}\n${sc.length > 900 ? `${sc.slice(0, 900).replace(/\s+\S*$/, "")}…` : sc}`);
    days += r.est.estimatedTimelineDays ?? 0;
  }
  const trades = ordered.map((r) => r.trade);
  const notes = [
    ...(input.priceChecks ? priceCheckNotes(input.priceChecks, totals, input.wholeHouse) : []),
    ...input.checks.filter((c) => c.level === "warn").map((c) => `Plans · ${c.text}`),
    ...tradeNotes,
  ].slice(0, 40);
  return {
    lines,
    title: planTitle(input.house, trades, input.wholeHouse),
    scope: scopes.join("\n\n"),
    assumptions: assumptions.slice(0, 40),
    notes,
    // Trades overlap on a house: the framer is gone before the painter comes, but the
    // electrician and the plumber rough in the same weeks.
    timelineDays: days > 0 ? Math.max(1, Math.round(input.wholeHouse ? days * 0.75 : days)) : null,
    totals,
  };
}
