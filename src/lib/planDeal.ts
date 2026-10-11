// THE ANNUAL DEAL IN A CARPENTER'S WORDS (owner, 2026-10-11): "2 months free",
// never a percentage, when a year's price is a whole number of months off
// twelve at the monthly rate; a percentage only when it is not. Pure.
export type AnnualDeal =
  | { kind: "months"; monthsFree: number; yearlyCents: number; listCents: number }
  | { kind: "percent"; pct: number; yearlyCents: number; listCents: number };

export function annualDeal(monthlyCents: number, yearlyCents: number | null | undefined): AnnualDeal | null {
  if (!yearlyCents || !(monthlyCents > 0) || yearlyCents >= monthlyCents * 12) return null;
  const listCents = monthlyCents * 12;
  const months = (listCents - yearlyCents) / monthlyCents;
  const whole = Math.round(months);
  if (whole >= 1 && Math.abs(months - whole) <= 0.02) return { kind: "months", monthsFree: whole, yearlyCents, listCents };
  return { kind: "percent", pct: Math.round((1 - yearlyCents / listCents) * 100), yearlyCents, listCents };
}

/** "2 months free" / "Save 11%" / "". */
export function dealWords(deal: AnnualDeal | null): string {
  if (!deal) return "";
  return deal.kind === "months" ? `${deal.monthsFree} month${deal.monthsFree === 1 ? "" : "s"} free` : `Save ${deal.pct}%`;
}
