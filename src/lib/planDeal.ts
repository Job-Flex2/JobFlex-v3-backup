// THE ANNUAL DEAL IN A CARPENTER'S WORDS (owner, 2026-10-11): "2 months free",
// never a percentage. Since 2026-10-12 a year that is not a whole number of
// months off twelve at the monthly rate gets no stamp at all — not a rounded
// one, and not a percentage — only the dollars it saves ("You save $250").
// Pure: every plan surface (landing, /pricing, the signup plan step, the
// upgrade page on a desk and a phone) prints its deal from here.

/** The billing term a plan card is shown and sold on. */
export type BillingTerm = "MONTH" | "YEAR";

export type AnnualDeal = {
  /** Whole months the year gives away, or null when the saving is not a whole number of them. */
  monthsFree: number | null;
  /** Twelve months at the monthly rate, less the year's price. Always > 0. */
  savedCents: number;
  yearlyCents: number;
  listCents: number;
};

/** The year's deal against twelve months at the monthly rate; null when there
 *  is no yearly price, the plan is free, or the year is not actually cheaper. */
export function annualDeal(monthlyCents: number, yearlyCents: number | null | undefined): AnnualDeal | null {
  if (!yearlyCents || !(monthlyCents > 0)) return null;
  const listCents = monthlyCents * 12;
  if (yearlyCents >= listCents) return null;
  const savedCents = listCents - yearlyCents;
  const monthsFree = savedCents % monthlyCents === 0 ? savedCents / monthlyCents : null;
  return { monthsFree, savedCents, yearlyCents, listCents };
}

/** "2 months free" / "1 month free" — or "" when the deal is not whole months. Never a percentage. */
export function dealWords(deal: AnnualDeal | null): string {
  if (!deal?.monthsFree) return "";
  return `${deal.monthsFree} month${deal.monthsFree === 1 ? "" : "s"} free`;
}

/** Dollars, whole when round: "$398", "$22.50". */
export function dealDollars(cents: number): string {
  const d = cents / 100;
  return Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
}

/** "You save $398" — the green line under a year's price; "" without a deal. */
export function savedWords(deal: AnnualDeal | null): string {
  return deal ? `You save ${dealDollars(deal.savedCents)}` : "";
}

/** "You save $135 a year" — the card's green line on Annual (2026-10-12); "" without a deal. */
export function savedYearWords(deal: AnnualDeal | null): string {
  return deal ? `${savedWords(deal)} a year` : "";
}

/** The term a plan is actually billed on: a plan with no yearly price bills
 *  monthly whatever the switch says (the checkout routes refuse YEAR for it). */
export function planTerm(term: BillingTerm, yearlyCents: number | null | undefined): BillingTerm {
  return term === "YEAR" && yearlyCents ? "YEAR" : "MONTH";
}

/** The switch's own badge on "Annual", always shown (owner, 2026-10-12), read
 *  off the plans that have a yearly price: the range of their WHOLE free
 *  months — "2–3 months free", or "2 months free" when they agree; when none
 *  is whole months, "Save up to $N" with the biggest saving; "" when no year
 *  saves anything. Pass the deals of the plans with a yearly price. */
export function sharedDealWords(deals: (AnnualDeal | null)[]): string {
  const real = deals.filter((d): d is AnnualDeal => Boolean(d));
  const months = real.map((d) => d.monthsFree).filter((m): m is number => Boolean(m));
  if (months.length) {
    const lo = Math.min(...months);
    const hi = Math.max(...months);
    return lo === hi ? `${lo} month${lo === 1 ? "" : "s"} free` : `${lo}–${hi} months free`;
  }
  if (real.length) return `Save up to ${dealDollars(Math.max(...real.map((d) => d.savedCents)))}`;
  return "";
}

/** Whether a Monthly | Annual switch has anything to switch: some plan has a yearly price. */
export function offersYearly(plans: { yearlyPriceCents?: number | null }[]): boolean {
  return plans.some((p) => Boolean(p.yearlyPriceCents));
}

/** The address parameter that carries the switch from the landing or /pricing
 *  to the signup plan step: `?billing=annual`. */
export const BILLING_PARAM = "billing";

/** `?billing=annual` → YEAR, `?billing=monthly` → MONTH, anything else → null. */
export function termFromParam(value: string | null | undefined): BillingTerm | null {
  return value === "annual" ? "YEAR" : value === "monthly" ? "MONTH" : null;
}

/** A start link with the switch on it: Annual adds `billing=annual` (the
 *  link's own query — ?industry=, ?edition=, ?flow= — and its #hash kept);
 *  Monthly leaves the link as it is. */
export function withBillingTerm(href: string, term: BillingTerm): string {
  if (term !== "YEAR") return href;
  const hashAt = href.indexOf("#");
  const path = hashAt < 0 ? href : href.slice(0, hashAt);
  const hash = hashAt < 0 ? "" : href.slice(hashAt);
  return `${path}${path.includes("?") ? "&" : "?"}${BILLING_PARAM}=annual${hash}`;
}
