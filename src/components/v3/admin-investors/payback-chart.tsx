"use client";

// THE PAYBACK CHART (2026-10-06; interactive the same evening — owner: "show
// better growth lines, interactive, understandable for current and future").
// Three views of the one day-by-day curve (lib/investorModel):
//   · Spend vs revenue — dollars out against dollars in, added up from the start day;
//   · Monthly run-rate — what a month brings at that day's accounts, against a month of ads;
//   · Accounts — signed up, and paying (realistic, and if every trial pays).
// Over the next 30 / 90 / 180 days or the whole horizon. A hover or tap reads
// one day; today, the break-even and the horizon's end are read out under it.
// Plain SVG scaled to its box; the same component on the admin page and the
// shared link.
import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { CurvePoint } from "@/lib/investorModel";
import { daysBetween, dollars, longDate } from "@/lib/investorModel";
import s from "./investor-report.module.css";

type View = "cash" | "mrr" | "accounts";
const VIEWS: Array<{ key: View; label: string; hint: string }> = [
  { key: "cash", label: "Spend vs revenue", hint: "Dollars out against dollars in, added up from the start day. Where the blue line crosses the black one, the ads have paid for themselves." },
  { key: "mrr", label: "Monthly run-rate", hint: "What a month brings in at that day's accounts, against what a month of ads costs. Where blue crosses black, each month earns more than it spends." },
  { key: "accounts", label: "Accounts", hint: "Signed up so far, and paying — realistic, and if every trial pays. Past today, at the recent signup pace." },
];
const SPANS: Array<{ days: number; label: string }> = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 180, label: "180 days" },
  { days: 0, label: "Horizon" },
];

const W = 760;
const H = 320;
const PAD = { r: 18, t: 22, b: 40 };

const niceMax = (v: number) => {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return step * p;
};
const short = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
/** "$1.2M", "$48k", "$650" — the axis. */
const compact = (cents: number) => {
  const d = cents / 100;
  const unit = (v: number, suffix: string) => `$${v >= 10 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)}${suffix}`;
  if (d >= 1e6) return unit(d / 1e6, "M");
  if (d >= 1e3) return unit(d / 1e3, "k");
  return `$${Math.round(d)}`;
};
const count = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);
const approx = (n: number) => (n === Math.round(n) ? `${n}` : `≈${Math.round(n)}`);

interface Series { key: string; label: string; cls: string; pick: (p: CurvePoint, i: number) => number }

export function PaybackChart({ curve, today, breakEven, horizonDays }: { curve: CurvePoint[]; today: string; breakEven: string | null; horizonDays: number }) {
  const [view, setView] = useState<View>("cash");
  const [span, setSpan] = useState<number>(horizonDays > 90 ? 90 : 0);
  const [cur, setCur] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // A month of ads at that day's pace: the trailing week's spend, as a month.
  const pace = useMemo(() => curve.map((_, i) => {
    const from = Math.max(0, i - 6);
    const sum = curve.slice(from, i + 1).reduce((x, p) => x + p.spendDayCents, 0);
    return Math.round((sum / (i + 1 - from)) * 30);
  }), [curve]);
  const series = useMemo<Record<View, Series[]>>(() => ({
    cash: [
      { key: "spend", label: "Ad spend", cls: s.lineSpend, pick: (p) => p.spendCents },
      { key: "real", label: "Revenue, realistic", cls: s.lineReal, pick: (p) => p.realisticCents },
      { key: "all", label: "Revenue if every trial pays", cls: s.lineAll, pick: (p) => p.allPayCents },
    ],
    mrr: [
      { key: "pace", label: "Ad spend per month", cls: s.lineSpend, pick: (_p, i) => pace[i] ?? 0 },
      { key: "mrrReal", label: "Monthly revenue, realistic", cls: s.lineReal, pick: (p) => p.mrrRealisticCents },
      { key: "mrrAll", label: "Monthly revenue if every trial pays", cls: s.lineAll, pick: (p) => p.mrrAllPayCents },
    ],
    accounts: [
      { key: "signups", label: "Signed up", cls: s.lineSpend, pick: (p) => p.signups },
      { key: "payReal", label: "Paying, realistic", cls: s.lineReal, pick: (p) => p.payingRealistic },
      { key: "payAll", label: "Paying if every trial pays", cls: s.lineAll, pick: (p) => p.payingAllPay },
    ],
  }), [pace]);

  const todayIdxAll = curve.findIndex((p) => p.date === today);
  // The visible days: everything booked, then `span` days ahead (or the whole horizon).
  const cut = span === 0 ? -1 : curve.findIndex((p) => daysBetween(today, p.date) >= span);
  const pts = cut === -1 ? curve : curve.slice(0, cut + 1);
  const n = pts.length;
  const money = view !== "accounts";
  const lines = series[view];
  const maxVal = niceMax(Math.max(1, ...pts.map((p, i) => Math.max(...lines.map((l) => l.pick(p, i))))));
  const fmtAxis = money ? compact : count;
  const padL = 14 + 7.4 * Math.max(...[0.25, 0.5, 0.75, 1].map((f) => fmtAxis(f * maxVal).length));
  const plotW = W - padL - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const x = (i: number) => padL + (n > 1 ? (i * plotW) / (n - 1) : 0);
  const y = (v: number) => PAD.t + plotH - (v / maxVal) * plotH;
  const path = (l: Series) => pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(l.pick(p, i)).toFixed(1)}`).join(" ");
  const todayIdx = pts.findIndex((p) => p.date === today);
  // The marker: cash — the break-even; run-rate — the first projected day a month earns more than it spends.
  const markIdx = view === "cash"
    ? (breakEven ? pts.findIndex((p) => p.date === breakEven) : -1)
    : view === "mrr"
      ? pts.findIndex((p, i) => p.projected && (pace[i] ?? 0) > 0 && p.mrrRealisticCents >= (pace[i] ?? 0))
      : -1;
  const markLabel = view === "cash" ? "break-even" : "pays monthly";
  const ticks = Array.from(new Set([0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => Math.round(f * (n - 1)))));

  const place = (clientX: number) => {
    const el = svgRef.current;
    if (!el || n < 2) return;
    const box = el.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * W;
    const i = Math.round(((px - padL) / plotW) * (n - 1));
    setCur(Math.max(0, Math.min(n - 1, i)));
  };
  const onPointer = (e: ReactPointerEvent<SVGSVGElement>) => place(e.clientX);
  const onLeave = (e: ReactPointerEvent<SVGSVGElement>) => { if (e.pointerType === "mouse") setCur(null); };
  const onKey = (e: ReactKeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setCur((c) => Math.max(0, Math.min(n - 1, (c ?? Math.max(0, todayIdx)) + (e.key === "ArrowLeft" ? -1 : 1))));
    } else if (e.key === "Escape") setCur(null);
  };
  const at = cur !== null && cur < n ? pts[cur] : null;
  const tipLeft = at && cur !== null ? (x(cur) / W) * 100 : 0;
  const fmt = (v: number) => (money ? dollars(v) : approx(v));

  // The three days read out under the chart.
  const reading = (label: string, key: string, p: CurvePoint | undefined) => p ? (
    <div className={s.reading} data-reading={key} key={key}>
      <div className={s.readingHead}>{label} · {short(p.date)}</div>
      <div className={s.readingBig}>{dollars(p.realisticCents)} <span>earned</span></div>
      <div className={s.readingRows}>
        <span>{dollars(p.spendCents)} spent</span>
        <span>{dollars(p.mrrRealisticCents)}/mo run-rate</span>
        <span>{approx(p.payingRealistic)} paying · {approx(p.signups)} signed up</span>
      </div>
    </div>
  ) : null;
  const beAll = breakEven ? curve.find((p) => p.date === breakEven) : undefined;

  return (
    <div className={s.chartWrap}>
      <div className={s.chartBar}>
        <div className={s.seg} role="group" aria-label="What to show">
          {VIEWS.map((v) => <button key={v.key} type="button" aria-pressed={view === v.key} onClick={() => { setView(v.key); setCur(null); }}>{v.label}</button>)}
        </div>
        <div className={s.seg} role="group" aria-label="How far ahead">
          {SPANS.filter((sp) => sp.days === 0 || sp.days < horizonDays).map((sp) => <button key={sp.days} type="button" aria-pressed={span === sp.days} onClick={() => { setSpan(sp.days); setCur(null); }}>{sp.label}</button>)}
        </div>
      </div>
      <p className={s.hintLine}>{VIEWS.find((v) => v.key === view)?.hint} Hover or tap a day to read it.</p>
      <figure className={s.chart}>
        <div className={s.chartInner}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            tabIndex={0}
            aria-label={`${VIEWS.find((v) => v.key === view)?.label} from ${short(pts[0].date)} to ${short(pts[n - 1].date)}${markIdx >= 0 ? `; ${markLabel} ${short(pts[markIdx].date)}` : ""}. Arrow keys read day by day.`}
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={onLeave}
            onKeyDown={onKey}
          >
            {[0.25, 0.5, 0.75, 1].map((f) => (
              <g key={f}>
                <line x1={padL} x2={W - PAD.r} y1={y(f * maxVal)} y2={y(f * maxVal)} className={s.rule} />
                <text x={padL - 8} y={y(f * maxVal) + 4} textAnchor="end" className={s.axis}>{fmtAxis(f * maxVal)}</text>
              </g>
            ))}
            {todayIdx >= 0 && todayIdx < n - 1 && <rect x={x(todayIdx)} y={PAD.t} width={x(n - 1) - x(todayIdx)} height={plotH} className={s.future} />}
            <line x1={padL} x2={W - PAD.r} y1={y(0)} y2={y(0)} className={s.base} />
            {ticks.map((i) => (
              <text key={i} x={x(i)} y={H - 14} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className={s.axis}>{short(pts[i].date)}</text>
            ))}
            {todayIdx >= 0 && (
              <g>
                <line x1={x(todayIdx)} x2={x(todayIdx)} y1={PAD.t} y2={PAD.t + plotH} className={s.today} />
                <text x={x(todayIdx) + 5} y={PAD.t + 12} className={s.axisStrong}>today</text>
              </g>
            )}
            {[...lines].reverse().map((l) => <path key={l.key} d={path(l)} className={l.cls} />)}
            {markIdx >= 0 && (
              <g>
                <circle cx={x(markIdx)} cy={y(lines[1].pick(pts[markIdx], markIdx))} r={5} className={s.mark} />
                <text x={x(markIdx) + (markIdx > n * 0.7 ? -9 : 9)} y={y(lines[1].pick(pts[markIdx], markIdx)) - 10} textAnchor={markIdx > n * 0.7 ? "end" : "start"} className={s.axisStrong}>{markLabel} · {short(pts[markIdx].date)}</text>
              </g>
            )}
            {at && cur !== null && (
              <g>
                <line x1={x(cur)} x2={x(cur)} y1={PAD.t} y2={PAD.t + plotH} className={s.cursor} />
                {lines.map((l) => <circle key={l.key} cx={x(cur)} cy={y(l.pick(at, cur))} r={4} className={`${s.dot} ${l.cls}`} />)}
              </g>
            )}
          </svg>
          {at && cur !== null && (
            <div className={`${s.tip} ${tipLeft > 58 ? s.tipLeft : ""}`} style={{ left: `${tipLeft}%` }} data-tip>
              <div className={s.tipDate}>{longDate(at.date)} <span className={s.tipTag}>{at.date === today ? "today" : at.projected ? "projected" : at.spendSource === "budget" ? "budget" : at.spendSource === "booked" ? "booked" : "no spend"}</span></div>
              {lines.map((l) => <div key={l.key} className={s.tipRow}><span>{l.label}</span><b>{fmt(l.pick(at, cur))}</b></div>)}
              {view === "cash" && <div className={s.tipRow}><span>That day&apos;s ads</span><b>{dollars(at.spendDayCents)}</b></div>}
              {view !== "accounts" && <div className={`${s.tipRow} ${s.tipMuted}`}><span>{approx(at.payingRealistic)} paying · {approx(at.signups)} signed up</span></div>}
              {view === "accounts" && <div className={`${s.tipRow} ${s.tipMuted}`}><span>{dollars(at.spendCents)} spent · {dollars(at.realisticCents)} earned</span></div>}
            </div>
          )}
        </div>
        <figcaption className={s.legend}>
          {lines.map((l) => <span key={l.key}><i className={`${s.sw} ${l.cls}`} />{l.label}</span>)}
          <span className={s.legendNote}>Shaded: projected. Revenue at list price.</span>
        </figcaption>
      </figure>
      <div className={s.readings}>
        {reading("Today", "today", curve[todayIdxAll])}
        {reading("Break-even", "break-even", beAll)}
        {reading("End of horizon", "horizon", curve.at(-1))}
      </div>
    </div>
  );
}
