// The cost guides' prices (2026-10-26) — one source for every number on a
// /cost page: the Smart Proposal price book (lib/estimate/step-prices, what a
// homeowner pays a licensed contractor per unit, U.S. national average,
// overhead and profit included, no sales tax) times the city's construction
// cost index (lib/estimate/location-index-data). A pass-through fee (a permit)
// is not scaled, as the price book says.
//
// A material option reads its own numbers where they already live: the roof
// estimator's catalog (lib/roofPackage/catalog, as a ratio to the
// architectural shingle the price book prices), the HVAC estimator's default
// rate card (lib/hvac/ledger, per ton, as a ratio to the 3-ton AC the price
// book prices), or the range the price book's own note gives for that
// material. A labor uplift is read from the trade profile's words
// (lib/estimate/trade-knowledge). Nothing is priced here; a step whose text
// no longer matches throws, so the build fails instead of a guide going stale.
//
// One check against the outside (owner, 2026-10-26): an option's average
// must stay within 20% of the installed price the source the page cites gives
// for the whole job (SeoVariant.cited, read from the benchmark's own source
// lines). Where the book's steps add up to more, every step of the option but
// a fee is scaled down by one factor, to the middle of that range; an option
// with no source of its own follows its trade's default option. The factor
// and why are printed on the page (lib/seo/content).
//
// Server-side (the pages render at build time); the browser only ever gets
// the finished model (lib/seo/calc). Plain module, no I/O.

import { SPECIALTY_PRICES, type StepPrice } from "@/lib/estimate/step-prices";
import { SPECIALTY_PROCEDURES } from "@/lib/estimate/procedures";
import { TRADES } from "@/lib/estimate/trade-knowledge";
import { ROOF_SYSTEMS } from "@/lib/roofPackage/catalog";
import { DEFAULT_RATE_CARD } from "@/lib/hvac/ledger";
import { calculate, type CalcLine, type CalcModel, type CalcResult } from "./calc";
import type { SeoCity } from "./cities";
import type { SeoCited, SeoLine, SeoRatio, SeoSwap, SeoTrade, SeoVariant } from "./trades";

type Step = StepPrice & { item: string; unit: string };

const stepCache = new Map<string, Step>();

/** The price-book step of a specialty whose text starts with `prefix` — exactly one. */
export function bookStep(specialty: string, prefix: string): Step {
  const key = `${specialty}|${prefix}`;
  const hit = stepCache.get(key);
  if (hit) return hit;
  const book = SPECIALTY_PRICES[specialty];
  const procedure = SPECIALTY_PROCEDURES[specialty];
  if (!book || !procedure) throw new Error(`cost guides: no price book or procedure for "${specialty}".`);
  const items = Object.keys(book.steps).filter((k) => k.startsWith(prefix));
  if (items.length !== 1) throw new Error(`cost guides: "${prefix}" matches ${items.length} steps of ${specialty} — the price book's text moved.`);
  const item = items[0];
  const unit = procedure.steps.find((s) => s.item === item)?.unit;
  if (!unit) throw new Error(`cost guides: "${item.slice(0, 60)}" has a price but no procedure step.`);
  const step = { ...book.steps[item], item, unit };
  stepCache.set(key, step);
  return step;
}

/** "PT or cedar $6-$9/sqft" → [6, 9]: the first range after `label` (itself after `after`, when given). */
export function noteRange(note: string | undefined, label: string, after?: string): [number, number] {
  const text = note ?? "";
  const from = after ? text.indexOf(after) : 0;
  const at = from < 0 ? -1 : text.indexOf(label, from);
  const m = at < 0 ? null : text.slice(at + label.length).match(/^[^$]{0,80}?\$(\d+(?:\.\d+)?)-\$(\d+(?:\.\d+)?)/);
  if (!m) throw new Error(`cost guides: no "$a-$b" after "${label}" in the price book note "${text.slice(0, 80)}".`);
  return [Number(m[1]), Number(m[2])];
}

/** "steep or two-story work adds 15-30% labor" → [0.15, 0.30], from the trade profile's text. */
export function profilePercent(tradeId: string, text: string): [number, number] {
  const trade = TRADES.find((t) => t.id === tradeId);
  const line = trade ? [...trade.keyQuestions, ...trade.anchors].find((l) => l.includes(text)) : undefined;
  const m = line?.slice(line.indexOf(text)).match(/(\d+)-(\d+)%/);
  if (!m) throw new Error(`cost guides: no "a-b%" after "${text}" in the ${tradeId} trade profile.`);
  return [Number(m[1]) / 100, Number(m[2]) / 100];
}

const ROOF_BASE = "architectural";

/** A price multiplier (roof systems) or a quantity rule (HVAC tonnage) read from an estimator's own numbers. */
function readRatio(r: SeoRatio): { price: number } | { fix: number; per: number } {
  if (r.kind === "roof") {
    const base = ROOF_SYSTEMS.find((s) => s.id === ROOF_BASE);
    const sys = ROOF_SYSTEMS.find((s) => s.id === r.system);
    if (!base || !sys) throw new Error(`cost guides: roof system "${r.system}" is not in the roof catalog.`);
    const pick = (s: typeof base) => (r.part === "material" ? s.matPerSq : r.part === "labor" ? s.laborPerSq : s.capPerFt);
    return { price: pick(sys) / pick(base) };
  }
  // The price book prices a 3-ton AC and its coil; the rate card gives the
  // equipment per ton (at cost, plus the card's equipment markup) and the
  // set labor per piece. A t-ton unit = step price x (perTon x t x markup + set) / (the same for 3-ton AC).
  const card = DEFAULT_RATE_CARD;
  const m = 1 + card.equipmentMarkupPct / 100;
  const d = card.equipmentDefaults;
  if (r.part === "outdoor") {
    const base = d.airConditionerPerTon * 3 * m + card.labor.setOutdoor;
    const perTon = r.equipment === "airConditioner" ? d.airConditionerPerTon : r.equipment === "heatPump" ? d.heatPumpPerTon : d.coldClimateHeatPumpPerTon;
    return { fix: card.labor.setOutdoor / base, per: (perTon * m) / base };
  }
  const base = d.coilPerTon * 3 * m + card.labor.setCoil;
  if (r.equipment === "airConditioner") return { fix: card.labor.setCoil / base, per: (d.coilPerTon * m) / base };
  return { fix: card.labor.setAirHandler / base, per: (d.airHandlerPerTon * m) / base };
}

/** A line of the job as national prices and quantities. */
function resolveLine(trade: SeoTrade, line: SeoLine): Omit<CalcLine, "lo" | "hi"> & { price: [number, number] } {
  const step = bookStep(trade.specialty, line.step);
  const bench = SPECIALTY_PRICES[trade.specialty].benchmark;
  const jobQty = bench.jobQty ?? (bench.typicalQty[0] + bench.typicalQty[1]) / 2;
  let fix = 0;
  let per = 0;
  if (line.scale === "fixed") fix = step.q ?? 1;
  else if (line.perUnit != null) per = line.perUnit;
  else {
    if (step.q == null) throw new Error(`cost guides: "${line.step}" scales with size but has no typical quantity.`);
    per = (step.q / jobQty) * trade.size.toBenchmark(1) * (line.share ?? 1);
  }
  return { label: line.label, price: [step.price[0], step.price[1]], lab: Math.min(1, Math.max(0, step.labor)), fix, per, ...(step.fee ? { fee: 1 as const } : {}) };
}

function applySwap(trade: SeoTrade, l: ReturnType<typeof resolveLine>, swap: SeoSwap): ReturnType<typeof resolveLine> {
  if ("note" in swap) {
    const step = bookStep(trade.specialty, swap.step);
    return { ...l, price: noteRange(step.note, swap.note.label, swap.note.after) };
  }
  const r = readRatio(swap.ratio);
  if ("price" in r) return { ...l, price: [l.price[0] * r.price, l.price[1] * r.price] };
  return { ...l, fix: r.fix, per: r.per };
}

function variantLines(trade: SeoTrade, v: SeoVariant) {
  const base = (v.only ?? trade.lines).filter((l) => !(v.drop ?? []).includes(l.step));
  return [...base, ...(v.add ?? [])].map((line) => {
    let l = resolveLine(trade, line);
    for (const s of v.swaps ?? []) if (s.step === line.step) l = applySwap(trade, l, s);
    return l;
  });
}

/** National line → this city's line: everything but a fee follows the city's index, and the option's calibration. */
function priced(l: ReturnType<typeof resolveLine>, factor: number, calibrate = 1): CalcLine {
  const k = l.fee ? 1 : factor * calibrate;
  const { price, ...rest } = l;
  return { ...rest, lo: price[0] * k, hi: price[1] * k };
}

/** "Homewyse 2026: 6 ft wood privacy fence $33-$53/linear ft installed" → [33, 53]; "$7,000-$14,000" reads too. */
function citedPart(trade: SeoTrade, part: SeoCited["parts"][number]): { range: [number, number]; line: string } {
  const line = SPECIALTY_PRICES[trade.specialty].benchmark.sources.find((s) => s.startsWith(part.source) && s.includes(part.label));
  const m = line?.slice(line.indexOf(part.label) + part.label.length).match(/^[^$]{0,80}?\$([\d,]+(?:\.\d+)?)-\$([\d,]+(?:\.\d+)?)/);
  if (!line || !m) throw new Error(`cost guides: no "${part.source} … ${part.label} $a-$b" among the ${trade.specialty} benchmark's sources.`);
  const n = (x: string) => Number(x.replace(/,/g, "")) * (part.scale ?? 1);
  return { range: [n(m[1]), n(m[2])], line };
}

export type Calibration = {
  /** The factor every step but a fee is multiplied by; 1 = within 20%, left as the book builds it. */
  k: number;
  /** The option whose cited range set it (itself, or the trade's default option). */
  from: string;
  per: "unit" | "job";
  /** The book's national average for the typical job, per unit or for the job. */
  book: number;
  /** The cited installed range, summed over its parts, and the source lines it was read from. */
  cited: [number, number];
  sources: string[];
};

const calCache = new Map<string, Calibration | null>();

/** How an option's steps are scaled to the source the page cites (null: no cited range for it or its trade's default). */
export function calibration(trade: SeoTrade, variantId: string): Calibration | null {
  const key = `${trade.slug}|${variantId}`;
  if (calCache.has(key)) return calCache.get(key) ?? null;
  const own = trade.variants.find((v) => v.id === variantId);
  const ref = own?.cited ? own : trade.variants.find((v) => v.id === trade.defaultVariant);
  let out: Calibration | null = null;
  if (ref?.cited) {
    const parts = ref.cited.parts.map((p) => citedPart(trade, p));
    const cited: [number, number] = [parts.reduce((a, p) => a + p.range[0], 0), parts.reduce((a, p) => a + p.range[1], 0)];
    const size = trade.size.typical;
    const per = ref.cited.per === "unit" ? size : 1;
    // The book as is, nationally, for the typical job.
    const raw = calculate({ variants: [{ id: ref.id, label: ref.label, lines: variantLines(trade, ref).map((l) => priced(l, 1)) }], extras: [], minJob: 0 }, ref.id, size);
    const mid = (cited[0] + cited[1]) / 2;
    const k = raw.avg / per > mid * 1.2 ? (mid * per - raw.fees) / (raw.avg - raw.fees) : 1;
    out = { k, from: ref.id, per: ref.cited.per, book: raw.avg / per, cited, sources: parts.map((p) => p.line) };
  }
  calCache.set(key, out);
  return out;
}

const modelCache = new Map<string, CalcModel>();

/** The whole priced model of a work in a city (factor 1 = the U.S. average). */
export function costModel(trade: SeoTrade, factor: number): CalcModel {
  const key = `${trade.slug}|${factor}`;
  const hit = modelCache.get(key);
  if (hit) return hit;
  const bench = SPECIALTY_PRICES[trade.specialty].benchmark;
  const model: CalcModel = {
    variants: trade.variants.map((v) => {
      const k = calibration(trade, v.id)?.k ?? 1;
      return { id: v.id, label: v.label, lines: variantLines(trade, v).map((l) => priced(l, factor, k)) };
    }),
    extras: trade.extras.map((e) => {
      const lines: CalcLine[] = (e.add ?? []).map((line) => priced(resolveLine(trade, line), factor));
      if (e.noteLine) {
        const step = bookStep(trade.specialty, e.noteLine.step);
        const base = resolveLine(trade, trade.lines.find((l) => l.step === e.noteLine?.step) ?? { step: e.noteLine.step, label: "", scale: "size" });
        lines.push(priced({ ...base, label: e.noteLine.lineLabel, lab: e.noteLine.labor, price: noteRange(step.note, e.noteLine.label) }, factor));
      }
      return { id: e.id, label: e.label, lines, ...(e.laborUplift ? { uplift: profilePercent(e.laborUplift.tradeId, e.laborUplift.text) } : {}) };
    }),
    minJob: (bench.minJob ?? 0) * factor,
  };
  modelCache.set(key, model);
  return model;
}

export function quote(trade: SeoTrade, city: Pick<SeoCity, "factor"> | null, size: number, variantId = trade.defaultVariant, extras: string[] = []): CalcResult {
  return calculate(costModel(trade, city?.factor ?? 1), variantId, size, extras);
}

/** The price book's public sources for the work — printed under the tables. JobFlex's own rate cards are
 *  named in the sentence above them; their entries carry internal names and file paths, so they stay out. */
export function bookSources(trade: SeoTrade): string[] {
  return SPECIALTY_PRICES[trade.specialty].benchmark.sources.filter((s) => !/jobflex|\brepo\b|src\//i.test(s));
}
