// The cost guide's arithmetic (2026-10-26) — one function for the page's
// tables (server) and its calculator (browser), so the two can never
// disagree. The model arrives already priced for the city (lib/seo/pricing);
// this only multiplies quantities out. No imports: it ships to the browser.

/** One priced line: [low, high] price per unit in this city, labor share, fixed quantity, quantity per unit of job size, 1 for a pass-through fee. */
export type CalcLine = { label: string; lo: number; hi: number; lab: number; fix: number; per: number; fee?: 1 };

export type CalcVariant = { id: string; label: string; lines: CalcLine[] };
export type CalcExtra = { id: string; label: string; lines: CalcLine[]; uplift?: [number, number] };

export type CalcModel = {
  variants: CalcVariant[];
  extras: CalcExtra[];
  /** The least a contractor bills for this work, in this city. */
  minJob: number;
};

export type CalcResult = {
  lo: number;
  hi: number;
  avg: number;
  /** At the midpoint: what goes to labor, to material and equipment, and to pass-through fees. */
  labor: number;
  material: number;
  fees: number;
  lines: Array<{ label: string; lo: number; hi: number; fee: boolean }>;
};

export function calculate(model: CalcModel, variantId: string, size: number, extraIds: readonly string[] = []): CalcResult {
  const variant = model.variants.find((v) => v.id === variantId) ?? model.variants[0];
  const extras = model.extras.filter((e) => extraIds.includes(e.id));
  const lines = [...variant.lines, ...extras.flatMap((e) => e.lines)];
  // A labor uplift (steep roof, sloped yard) raises the labor part of every line but a fee.
  const up = extras.reduce<[number, number]>((acc, e) => (e.uplift ? [acc[0] + e.uplift[0], acc[1] + e.uplift[1]] : acc), [0, 0]);
  let lo = 0;
  let hi = 0;
  let labor = 0;
  let fees = 0;
  const out: CalcResult["lines"] = [];
  for (const l of lines) {
    const qty = l.fix + l.per * size;
    if (qty <= 0) continue;
    const lab = l.fee ? 0 : l.lab;
    const a = l.lo * qty * (1 + up[0] * lab);
    const b = l.hi * qty * (1 + up[1] * lab);
    lo += a;
    hi += b;
    const mid = (a + b) / 2;
    if (l.fee) fees += mid;
    else labor += mid * lab;
    out.push({ label: l.label, lo: a, hi: b, fee: l.fee === 1 });
  }
  lo = Math.max(lo, model.minJob);
  hi = Math.max(hi, model.minJob);
  const avg = (lo + hi) / 2;
  const sum = out.reduce((s, l) => s + (l.lo + l.hi) / 2, 0) || 1;
  // Below the minimum the job is billed at the minimum; the split keeps its shares.
  const k = avg / sum;
  return { lo, hi, avg, labor: labor * k, material: (sum - labor - fees) * k, fees: fees * k, lines: out };
}

/** The model as the browser needs it: the calculator shows totals, so the line names stay on the server. */
export function bareModel(m: CalcModel): CalcModel {
  const r = (n: number) => Math.round(n * 1e5) / 1e5;
  const bare = (lines: CalcLine[]) => lines.map((l) => ({ ...l, label: "", lo: r(l.lo), hi: r(l.hi), lab: r(l.lab), fix: r(l.fix), per: r(l.per) }));
  return { ...m, variants: m.variants.map((v) => ({ ...v, lines: bare(v.lines) })), extras: m.extras.map((e) => ({ ...e, lines: bare(e.lines) })) };
}

/** A total as a quote prints it: tens under $1,000, fifties under $10,000, hundreds above. */
export function roundMoney(n: number): number {
  if (n < 1000) return Math.round(n / 10) * 10;
  if (n < 10000) return Math.round(n / 50) * 50;
  return Math.round(n / 100) * 100;
}

export function usd(n: number): string {
  return `$${roundMoney(n).toLocaleString("en-US")}`;
}

/** A unit price: cents under $20 ("$7.45"), whole dollars above ("$4,380"). */
export function unitUsd(n: number): string {
  if (n < 20) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
