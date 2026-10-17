// THE LAST 30 DAYS OF SPEND (2026-10-08; facts only 2026-10-17): one bar a day — the counted spend (Meta's own
// figure, or a day booked by hand) in ink, and on a day that went to the no-card trials the part left out, drawn
// lighter on top so it is seen and not counted — and a green mark for each card-trial signup that day. Plain SVG,
// no hooks: the same on the admin page and the shared link.
import { dollars } from "@/lib/investorModel";
import s from "./investor-report.module.css";

export interface SpendBarRow { date: string; cents: number; leftOutCents: number; clicks: number | null; signups: number }

const W = 760;
const H = 180;
const PAD = { l: 44, r: 8, t: 14, b: 26 };
const short = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const compact = (c: number) => (c >= 100000 ? `$${Math.round(c / 100000) / 10}k` : `$${Math.round(c / 100)}`);

export function SpendBars({ rows }: { rows: SpendBarRow[] }) {
  if (rows.length === 0) return null;
  const n = rows.length;
  const max = Math.max(100, ...rows.map((r) => r.cents + r.leftOutCents));
  const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); const m = max / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; })();
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const slot = plotW / n, bw = Math.max(3, slot * 0.66);
  const x = (i: number) => PAD.l + i * slot + (slot - bw) / 2;
  const y = (c: number) => PAD.t + plotH - (c / nice) * plotH;
  const ticks = n <= 10 ? rows.map((_, i) => i) : [0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1];
  const anyLeftOut = rows.some((r) => r.leftOutCents > 0);
  return (
    <figure className={s.bars}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Ad spend by day, ${short(rows[0].date)} to ${short(rows[n - 1].date)}`}>
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(f * nice)} y2={y(f * nice)} className={s.rule} />
            <text x={PAD.l - 6} y={y(f * nice) + 4} textAnchor="end" className={s.axis}>{compact(f * nice)}</text>
          </g>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className={s.base} />
        {rows.map((r, i) => (
          <g key={r.date} data-bar={r.date}>
            <title>{`${short(r.date)}: ${dollars(r.cents)} counted${r.leftOutCents > 0 ? ` · ${dollars(r.leftOutCents)} left out (no-card trials)` : ""}${r.clicks !== null ? ` · ${r.clicks} clicks` : ""}${r.signups ? ` · ${r.signups} signed up` : ""}`}</title>
            <rect x={x(i)} y={y(r.cents)} width={bw} height={Math.max(0, y(0) - y(r.cents))} className={s.bar} />
            {r.leftOutCents > 0 && <rect x={x(i)} y={y(r.cents + r.leftOutCents)} width={bw} height={Math.max(0, y(r.cents) - y(r.cents + r.leftOutCents))} className={s.barLeftOut} />}
            {Array.from({ length: Math.min(r.signups, 6) }).map((_, k) => <circle key={k} cx={x(i) + bw / 2} cy={y(0) + 7 + k * 6} r={2.4} className={s.signupDot} />)}
          </g>
        ))}
        {ticks.map((i) => <text key={i} x={x(i) + bw / 2} y={H - 4} textAnchor="middle" className={s.axis}>{short(rows[i].date)}</text>)}
      </svg>
      <figcaption className={s.legend}>
        <span><i className={s.swBar} />Spent, counted</span>
        {anyLeftOut && <span><i className={s.swLeftOut} />Left out: the no-card trials&apos; days</span>}
        <span><i className={s.swDot} />A trial signup that day</span>
      </figcaption>
    </figure>
  );
}
