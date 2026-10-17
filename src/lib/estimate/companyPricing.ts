// THE COMPANY'S OWN ESTIMATING METHOD (2026-10-16). A trial contractor (Done Right Construction LLC) wrote in: "we
// estimate with a two-person crew at $220 per crew-hour, a 30% materials markup and no overhead or profit — can Smart
// Proposal use that by itself, with labor in crew-hours, instead of us correcting every proposal?". Owner: make it an
// option every company can use, crew-hour or person-hour as they choose, for Smart Proposal and the video estimator,
// OFF by default.
//
// When it is on, an estimate is priced the company's way:
//   · labor   — hours × the company's rate: crew-hours for its crew, or person-hours (the AI says the hours, line by
//               line; JobFlex does the multiplying)
//   · materials — the price book's contractor cost × (1 + the company's materials markup); a permit is passed through
//   · overhead, profit — the company's percentages, inside every price the way a proposal carries them
//   · sales tax — on the whole job, on materials only, or none; at the company's rate or the job state's
// Off — or switched on with no rate yet — every estimate is priced exactly as before.
//
// Pure, browser-safe: the settings pane, the estimate screens, the server action and the QA read it.

export type LaborBasis = "crew" | "person";
export type TaxMode = "none" | "materials" | "job";

export type CompanyPricing = {
  on: boolean;
  /** How the rate is quoted: per hour for the whole crew, or per worker-hour. */
  laborBasis: LaborBasis;
  /** People on a crew. */
  crewSize: number;
  /** $ per crew-hour (basis "crew") or per person-hour (basis "person"). The SELLING rate — what the company bills. */
  laborRate: number;
  materialMarkupPct: number;
  overheadPct: number;
  profitPct: number;
  taxMode: TaxMode;
  /** The company's own sales-tax rate, %; null = the job's state rate. */
  taxRatePct: number | null;
};

export const DEFAULT_COMPANY_PRICING: CompanyPricing = {
  on: false,
  laborBasis: "crew",
  crewSize: 2,
  laborRate: 0,
  materialMarkupPct: 0,
  overheadPct: 0,
  profitPct: 0,
  taxMode: "job",
  taxRatePct: null,
};

export const companyPricingKey = (organizationId: string) => `companyPricing:${organizationId}`;

const num = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function cleanCompanyPricing(raw: unknown): CompanyPricing {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_COMPANY_PRICING;
  const tax = o.taxRatePct;
  return {
    on: o.on === true,
    laborBasis: o.laborBasis === "person" ? "person" : "crew",
    crewSize: Math.round(num(o.crewSize, 1, 20, d.crewSize)),
    laborRate: round2(num(o.laborRate, 0, 5000, d.laborRate)),
    materialMarkupPct: round2(num(o.materialMarkupPct, 0, 300, d.materialMarkupPct)),
    overheadPct: round2(num(o.overheadPct, 0, 100, d.overheadPct)),
    profitPct: round2(num(o.profitPct, 0, 100, d.profitPct)),
    taxMode: o.taxMode === "none" || o.taxMode === "materials" ? o.taxMode : "job",
    taxRatePct: tax === null || tax === undefined || tax === "" ? null : round2(num(tax, 0, 30, 0)),
  };
}

export function parseCompanyPricing(cursor: string | null | undefined): CompanyPricing {
  if (!cursor) return { ...DEFAULT_COMPANY_PRICING };
  try {
    return cleanCompanyPricing(JSON.parse(cursor));
  } catch {
    return { ...DEFAULT_COMPANY_PRICING };
  }
}

/** On, and enough set to price by — a switch turned on before a rate is typed changes nothing. */
export function companyPricingActive(p: CompanyPricing | null | undefined): p is CompanyPricing {
  return !!p && p.on && p.laborRate > 0;
}

/** Overhead on the subtotal, profit on subtotal + overhead — the proposal's own chain (lib/pricing/markup). */
export function overheadProfitFactor(p: Pick<CompanyPricing, "overheadPct" | "profitPct">): number {
  return (1 + p.overheadPct / 100) * (1 + p.profitPct / 100);
}

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** "2-person crew at $220 per crew-hour". */
export function laborWords(p: CompanyPricing): string {
  return p.laborBasis === "crew"
    ? `${p.crewSize}-person crew at ${money(p.laborRate)} per crew-hour`
    : `${money(p.laborRate)} per person-hour${p.crewSize > 1 ? `, ${p.crewSize}-person crew` : ""}`;
}

/** The one line an estimate says about how it was priced. */
export function pricingWords(p: CompanyPricing): string {
  const parts = [laborWords(p), p.materialMarkupPct ? `materials +${p.materialMarkupPct}%` : "materials at cost"];
  parts.push(p.overheadPct || p.profitPct ? `overhead ${p.overheadPct}% · profit ${p.profitPct}%` : "no overhead or profit");
  parts.push(p.taxMode === "none" ? "no sales tax" : `sales tax on ${p.taxMode === "materials" ? "materials only" : "the whole job"}${p.taxRatePct != null ? ` at ${p.taxRatePct}%` : " at the state rate"}`);
  return parts.join(" · ");
}

/** What the estimator is told when the company prices labor by the hour: the hours on every line, in its unit. */
export function hoursPromptBlock(p: CompanyPricing): string {
  const unit =
    p.laborBasis === "crew"
      ? `CREW-HOURS for this company's crew of ${p.crewSize} (${p.crewSize} people working 3 hours = 3 crew-hours)`
      : `PERSON-HOURS — the hours of every worker added together (${Math.max(2, p.crewSize)} people working 3 hours = ${Math.max(2, p.crewSize) * 3} person-hours)`;
  return [
    "",
    "",
    "THIS COMPANY PRICES LABOR BY THE HOUR. For EVERY lineItem that has any labor, add the field \"laborHours\": the time that line's work takes, in " + unit + ".",
    "Count the real work on site for that line — setup, the work, cleanup of that step. Hours must scale with the quantity. A line with no labor has laborHours 0.",
    "Keep materialCost at contractor cost as before; JobFlex prices the labor from laborHours and the company's own rate, so laborCost is only a cross-check.",
  ].join("\n");
}

/**
 * The price book's labor dollars as hours, for a line the estimator gave no hours — what a loaded worker-hour costs
 * across residential trades in the book (2026 national average). Only a fallback, and the line says so.
 */
export const PRICE_BOOK_PERSON_RATE = 65;

export type PricingLineIn = {
  name: string;
  unit: string;
  quantity: number;
  materialUnitPrice: number;
  laborUnitPrice: number;
  /** From the estimator: crew-hours (basis crew) or person-hours (basis person) for the whole line. */
  laborHours?: number;
  flag?: "auto" | "adjusted" | "suggested" | "computed";
  flagNote?: string;
  notes?: string;
  dimensions?: string | null;
};

export type PricingRowOut = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  flag?: "auto" | "adjusted" | "suggested" | "computed";
  flagNote?: string;
  notes?: string;
  dimensions?: string;
};

const quarter = (h: number) => Math.max(0.25, Math.round(h * 4) / 4);
const PASS_THROUGH = /\bpermits?\b|\binspection fees?\b|\bplan review\b/i;

/**
 * The estimate's items, priced the company's way: a materials row per item that has material (cost × markup × the
 * overhead-and-profit factor) and its own labor row — "Labor · <the work> (crew-hours)", quantity in hours, the
 * company's rate × that factor — with its own id, so no screen or proposal folds hours into a square-foot quantity.
 */
export function applyCompanyPricing(
  items: readonly PricingLineIn[],
  p: CompanyPricing,
  idFor: (i: number) => string,
): { materials: PricingRowOut[]; labor: PricingRowOut[]; derivedHours: number } {
  const factor = overheadProfitFactor(p);
  const materials: PricingRowOut[] = [];
  const labor: PricingRowOut[] = [];
  let derivedHours = 0;
  const hourWord = p.laborBasis === "crew" ? "crew-hours" : "person-hours";
  items.forEach((it, i) => {
    const id = idFor(i);
    const qty = Number.isFinite(it.quantity) && it.quantity > 0 ? it.quantity : 1;
    const passThrough = PASS_THROUGH.test(it.name);
    const laborDollars = Math.max(0, it.laborUnitPrice) * qty;
    const hasLabor = !passThrough && (laborDollars > 0 || (it.laborHours ?? 0) > 0);
    const matCost = Math.max(0, it.materialUnitPrice) + (passThrough ? Math.max(0, it.laborUnitPrice) : 0);
    if (matCost > 0 || !hasLabor) {
      materials.push({
        id,
        name: it.name.trim(),
        quantity: qty,
        unit: it.unit,
        unitPrice: passThrough ? round2(matCost) : round2(matCost * (1 + p.materialMarkupPct / 100) * factor),
        flag: it.flag,
        flagNote: it.flagNote,
        notes: it.notes?.trim() || undefined,
        dimensions: it.dimensions?.trim() || undefined,
      });
    }
    if (hasLabor) {
      const given = Number.isFinite(it.laborHours) && (it.laborHours ?? 0) > 0 ? (it.laborHours as number) : null;
      const personHours = laborDollars / PRICE_BOOK_PERSON_RATE;
      const hours = quarter(given ?? (p.laborBasis === "crew" ? personHours / Math.max(1, p.crewSize) : personHours));
      if (given == null) derivedHours += 1;
      labor.push({
        id: `${id}-L`,
        name: `Labor · ${it.name.trim()} (${hourWord})`,
        quantity: hours,
        unit: "hour",
        unitPrice: round2(p.laborRate * factor),
        flag: it.flag,
        flagNote: it.flagNote,
        notes: given == null ? `Hours worked out from the price book's labor cost — check them (${hours} ${hourWord}).` : undefined,
      });
    }
  });
  return { materials, labor, derivedHours };
}

/** The estimate's record of how it was priced, so its screen, its refine and its proposal follow the same rules. */
export type PricingSnapshot = {
  mode: "company";
  laborBasis: LaborBasis;
  crewSize: number;
  laborRate: number;
  materialMarkupPct: number;
  overheadPct: number;
  profitPct: number;
  taxMode: TaxMode;
  taxRatePct: number | null;
  words: string;
};

export function snapshotOf(p: CompanyPricing): PricingSnapshot {
  return {
    mode: "company",
    laborBasis: p.laborBasis,
    crewSize: p.crewSize,
    laborRate: p.laborRate,
    materialMarkupPct: p.materialMarkupPct,
    overheadPct: p.overheadPct,
    profitPct: p.profitPct,
    taxMode: p.taxMode,
    taxRatePct: p.taxRatePct,
    words: pricingWords(p),
  };
}

/**
 * Sales tax on materials only, as one proposal line: the materials' share of the job after its discount, at the rate.
 * A percent discount is applied by the proposal to every line, this one too, so it is not taken here; a dollar
 * discount is spread over the job by its share.
 */
export function materialsTaxLine(input: { materialsTotal: number; subtotal: number; discount: { amount: number; isPercent: boolean } | null | undefined; ratePct: number }): number {
  const { materialsTotal, subtotal, discount, ratePct } = input;
  if (materialsTotal <= 0 || ratePct <= 0) return 0;
  const share = discount && !discount.isPercent && subtotal > 0 ? Math.max(0, 1 - Math.min(discount.amount, subtotal) / subtotal) : 1;
  return round2(materialsTotal * share * (ratePct / 100));
}
