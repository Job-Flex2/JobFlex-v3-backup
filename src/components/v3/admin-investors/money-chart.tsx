"use client";

// THE MONEY CHART (2026-10-17, facts only — it replaces the payback curve and its projections). Two views of the
// days from the start day to today (lib/investorModel `chart`):
//   · Money — the ad spend added up, against what customers have paid (Stripe), added up;
//   · Customers — trial signups so far, against paying customers.
// Over the last 30 days or since the start. A hover, a tap or the arrow keys read one day. Plain SVG scaled to its
// box; the same component on the admin page and the shared link.
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { dollars, longDate, type MoneyPoint } from "@/lib/investorModel";
import s from "./investor-report.module.css";

type View = "money" | "customers";
const W = 760;
const H = 300;
const PAD = { r: 18, t: 22, b: 40 };

const niceMax = (v: number) => {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
};
const short = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const compact = (cents: number) => {
  const d = cents / 100;
  if (d >= 1e6) return `$${(d / 1e6).toFixed(d >= 1e7 ? 0 : 1)}M`;
  if (d >= 1e3) return `$${(d / 1e3).toFixed(d >= 1e4 ? 0 : 1)}k`;
  return `$${Math.round(d)}`;
};

interface Series { key: string; label: string; cls: string; pick: (p: MoneyPoint) => number | null }

export function MoneyChart({ points }: { points: MoneyPoint[] }) {
  const [view, setView] = useState<View>("money");
  const [all, setAll] = useState(points.length <= 45);
  const [cur, setCur] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  if (points.length === 0) return null;

  const pts = all ? points : points.slice(-30);
  const n = pts.length;
  const paidKnown = pts.some((p) => p.collectedCents !== null);
  const lines: Series[] = view === "money"
    ? [
      { key: "spent", label: "Spent on ads", cls: s.lineSpend, pick: (p) => p.spentCents },
      ...(paidKnown ? [{ key: "paid", label: "Paid by customers", cls: s.lineReal, pick: (p: MoneyPoint) => p.collectedCents }] : []),
    ]
    : [
      { key: "signups", label: "Trial signups so far", cls: s.lineSpend, pick: (p) => p.signups },
      { key: "paying", label: "Paying customers", cls: s.linePaying, pick: (p) => p.paying },
    ];
  const money = view === "money";
  const maxVal = niceMax(Math.max(1, ...pts.flatMap((p) => lines.map((l) => l.pick(p) ?? 0))));
  const fmtAxis = money ? compact : (v: number) => `${Math.round(v)}`;
  const padL = 14 + 7.4 * Math.max(...[0.25, 0.5, 0.75, 1].map((f) => fmtAxis(f * maxVal).length));
  const plotW = W - padL - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const x = (i: number) => padL + (n > 1 ? (i * plotW) / (n - 1) : plotW / 2);
  const y = (v: number) => PAD.t + plotH - (v / maxVal) * plotH;
  const path = (l: Series) => pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(l.pick(p) ?? 0).toFixed(1)}`).join(" ");
  const ticks = Array.from(new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (n - 1)))));

  const place = (clientX: number) => {
    const el = svgRef.current;
    if (!el || n < 1) return;
    const box = el.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * W;
    const i = n > 1 ? Math.round(((px - padL) / plotW) * (n - 1)) : 0;
    setCur(Math.max(0, Math.min(n - 1, i)));
  };
  const onPointer = (e: ReactPointerEvent<SVGSVGElement>) => place(e.clientX);
  const onLeave = (e: ReactPointerEvent<SVGSVGElement>) => { if (e.pointerType === "mouse") setCur(null); };
  const onKey = (e: ReactKeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setCur((c) => Math.max(0, Math.min(n - 1, (c ?? n - 1) + (e.key === "ArrowLeft" ? -1 : 1))));
    } else if (e.key === "Escape") setCur(null);
  };
  const at = cur !== null && cur < n ? pts[cur] : null;
  const tipLeft = at && cur !== null ? (x(cur) / W) * 100 : 0;
  const last = pts[n - 1];
  const hint = money
    ? paidKnown
      ? "What the ads have cost, added up from the start day, against what customers have paid for JobFlex. Where the blue line meets the black one, the ads have paid for themselves."
      : "What the ads have cost, added up from the start day. Customers' payments show here once Stripe answers."
    : "Every trial signup so far, and the customers paying on each day.";

  return (
    <div className={s.chartWrap} data-money-chart>
      <div className={s.chartBar}>
        <div className={s.seg} role="group" aria-label="What to show">
          <button type="button" aria-pressed={view === "money"} onClick={() => { setView("money"); setCur(null); }}>Money</button>
          <button type="button" aria-pressed={view === "customers"} onClick={() => { setView("customers"); setCur(null); }}>Customers</button>
        </div>
        {points.length > 30 && (
          <div className={s.seg} role="group" aria-label="Which days">
            <button type="button" aria-pressed={!all} onClick={() => { setAll(false); setCur(null); }}>Last 30 days</button>
            <button type="button" aria-pressed={all} onClick={() => { setAll(true); setCur(null); }}>Since the start</button>
          </div>
        )}
      </div>
      <p className={s.hintLine}>{hint} Hover or tap a day to read it.</p>
      <figure className={s.chart}>
        <div className={s.chartInner}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            tabIndex={0}
            aria-label={`${money ? "Money" : "Customers"} from ${short(pts[0].date)} to ${short(last.date)}. Arrow keys read day by day.`}
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
            <line x1={padL} x2={W - PAD.r} y1={y(0)} y2={y(0)} className={s.base} />
            {ticks.map((i) => (
              <text key={i} x={x(i)} y={H - 14} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className={s.axis}>{short(pts[i].date)}</text>
            ))}
            {[...lines].reverse().map((l) => <path key={l.key} d={path(l)} className={l.cls} />)}
            {at && cur !== null && (
              <g>
                <line x1={x(cur)} x2={x(cur)} y1={PAD.t} y2={PAD.t + plotH} className={s.cursor} />
                {lines.map((l) => <circle key={l.key} cx={x(cur)} cy={y(l.pick(at) ?? 0)} r={4} className={`${s.dot} ${l.cls}`} />)}
              </g>
            )}
          </svg>
          {at && cur !== null && (
            <div className={`${s.tip} ${tipLeft > 58 ? s.tipLeft : ""}`} style={{ left: `${tipLeft}%` }} data-tip>
              <div className={s.tipDate}>{longDate(at.date)}</div>
              {lines.map((l) => <div key={l.key} className={s.tipRow}><span>{l.label}</span><b>{money ? dollars(l.pick(at) ?? 0) : l.pick(at)}</b></div>)}
              <div className={`${s.tipRow} ${s.tipMuted}`}><span>{money ? `${at.paying} paying · ${at.signups} trial signups` : `${dollars(at.spentCents)} spent${at.collectedCents !== null ? ` · ${dollars(at.collectedCents)} paid` : ""}`}</span></div>
            </div>
          )}
        </div>
        <figcaption className={s.legend}>
          {lines.map((l) => <span key={l.key}><i className={`${s.sw} ${l.cls}`} />{l.label}</span>)}
          <span className={s.legendNote}>Every point is a day that has happened.</span>
        </figcaption>
      </figure>
    </div>
  );
}
