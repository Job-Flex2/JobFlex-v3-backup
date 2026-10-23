// THE APP BEHIND THE SIGN-UP (owner, 2026-10-22, lib/signupView): when the sign-up screen is "inside the app", the
// register page draws JobFlex itself behind the form — the sidebar, the top bar and the overview on a desk, the phone
// app's header and overview on a phone — with sample work for the trade the visitor came in on (lib/signupPreview).
//
// A PICTURE, NOT THE APP. A server component with no script of its own: it paints with the first HTML (the visitor
// is "in JobFlex" before the form is live) and costs the phone nothing to hydrate. `inert` + aria-hidden: nothing in
// it can be clicked, focused or read out — the form in the middle is the only thing on the page. The real shell is
// not reused on purpose: it mounts the command palette, the estimator picker, the help widget and a notification
// feed that all expect a signed-in shop.
//
// The visitor's name appears in it as they type it (app-preview-live.tsx fills the [data-pv-*] slots).
import { Fragment } from "react";
import { ProductMark } from "@/components/brand/ProductMark";
import type { TradeType } from "@/lib/tradeTypes";
import { previewCalendar, previewMoney, previewPackFor, type PreviewIcon } from "@/lib/signupPreview";
import css from "./app-preview.module.css";

// The icons: the sidebar's verbatim from the app's own sprite (proposals-blueprint/sprite.tsx — so they are the
// sidebar's own drawings), the rest drawn in the same line style. Inline rather than through <use>: the register page
// carries its own sprite, and some ids are the same.
const ICON: Record<string, string> = {
  "i-grid": '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  "i-file": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  "i-users": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  "i-target": '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  "i-folder": '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  "i-crm": '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/>',
  "i-bulb": '<path d="M9 15c-.2-1-.7-1.7-1.4-2.4A4.9 4.9 0 0 1 7.1 9.4a4.9 4.9 0 0 1 9.8 0c0 1.2-.5 2.3-1.5 3.2-.7.7-1.2 1.4-1.4 2.4"/><path d="M9.5 18h5"/><path d="M10.5 21h3"/><path d="M12 1.5V3"/><path d="m5.4 4.2 1.1 1.1"/><path d="m18.6 4.2-1.1 1.1"/><path d="M3 9.5h1.5"/><path d="M19.5 9.5H21"/>',
  "i-plans": '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 10h6"/><path d="M13 10h8"/><path d="M11 3v10"/><path d="M14 21v-6h7"/><path d="M6 15v3"/>',
  "i-sofa": '<path d="M5 10V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/><path d="M3 11a2 2 0 0 1 2 2v2h14v-2a2 2 0 1 1 4 0v4a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-4a2 2 0 0 1 2-2Z"/><path d="M5 18v2"/><path d="M19 18v2"/>',
  "i-leaf": '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
  "i-roof": '<path d="m2 11 10-8 10 8"/><path d="M5 9v12h14V9"/>',
  "i-fence": '<path d="M4 21V8l2-3 2 3v13"/><path d="M10 21V8l2-3 2 3v13"/><path d="M16 21V8l2-3 2 3v13"/><path d="M2 12h20"/><path d="M2 17h20"/>',
  "i-video": '<rect x="2" y="6" width="13" height="12" rx="1.5"/><path d="M15 10.5 21 7v10l-6-3.5"/>',
  "i-heatpump": '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12V8.5"/><path d="m12 12 3 1.8"/><path d="m12 12-3 1.8"/>',
  "i-deck": '<path d="M2 10h20"/><path d="M2 13h20"/><path d="M4 13v8"/><path d="M20 13v8"/><path d="M12 13v8"/><path d="M5 10V5h14v5"/>',
  "i-cal": '<g stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="1"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></g>',
  "i-jobs": '<g stroke-width="2.5"><rect x="2" y="7" width="20" height="14" rx="1"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M2 13h20"/></g>',
  "i-hardhat": '<path d="M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1z"/><path d="M10 10V5a2 2 0 1 1 4 0v5"/><path d="M4 15v-3a8 8 0 0 1 16 0v3"/>',
  "i-userplus": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>',
  "i-building": '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
  "i-phone": '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.45c.9.34 1.84.57 2.8.7A2 2 0 0 1 22 16.9z"/>',
  "i-sms": '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 7h6"/><path d="M9 11h4"/><path d="M12 18h.01"/>',
  "i-msg": '<g stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></g>',
  "i-thumb": '<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>',
  "i-board": '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  "i-gift": '<rect x="3" y="8" width="18" height="4"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  "i-chart": '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  "i-bank": '<path d="M3 22h18"/><path d="M6 18v-7"/><path d="M10 18v-7"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="m12 2 9 5H3z"/>',
  "i-card": '<rect x="2" y="5" width="20" height="14" rx="1"/><path d="M2 10h20"/>',
  search: '<path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
  lead: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5"/>',
  gear: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  user: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0"/>',
  docPlus: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M12 11v6M9 14h6"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
};

function Ic({ id, className }: { id: string; className?: string }) {
  // Constant markup from the table above — never anything a visitor typed.
  return <svg className={className ?? css.ic} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON[id] ?? "" }} />;
}

/* THE WHOLE SIDEBAR (owner, 2026-10-22: "make sure the sidebar is shown in full"): every section and row of the app's
   own (blueprint-shell/nav-map NAV_SECTIONS), in the owner's order and words — the tools in their colours
   (globals.css --tool-*), "Deck Studio" as the sidebar names it. Rows share the window's height, so all of it is in view. */
type Row = { icon: string; label: string; on?: boolean; badge?: boolean; tone?: string; fold?: boolean };
const NAV: Array<{ label: string; rows: Row[] }> = [
  {
    label: "Work",
    rows: [
      { icon: "i-grid", label: "Overview", on: true },
      { icon: "i-file", label: "Proposals" },
      { icon: "i-users", label: "Clients" },
      { icon: "i-target", label: "Leads", badge: true },
      { icon: "i-folder", label: "Projects" },
      { icon: "i-crm", label: "CRM" },
    ],
  },
  {
    label: "Estimating tools",
    rows: [
      { icon: "i-bulb", label: "Smart Proposal", tone: "#6a4bd1" },
      { icon: "i-plans", label: "Blueprint estimator", tone: "#2f4a7a" },
      { icon: "i-sofa", label: "Design Studio", tone: "#66702a", fold: true },
      { icon: "i-leaf", label: "Lawn estimator", tone: "#2c7a5a" },
      { icon: "i-roof", label: "Roof estimator", tone: "#1854a0", fold: true },
      { icon: "i-fence", label: "Fence estimator", tone: "#2c7a5a", fold: true },
      { icon: "i-video", label: "Video estimator", tone: "#b8406a" },
      { icon: "i-heatpump", label: "HVAC estimator", tone: "#0d7a8a", fold: true },
      { icon: "i-deck", label: "Deck Studio", tone: "#a0582a", fold: true },
    ],
  },
  {
    label: "Delivery",
    rows: [
      { icon: "i-cal", label: "Calendar" },
      { icon: "i-jobs", label: "Jobs" },
      { icon: "i-hardhat", label: "Workers" },
      { icon: "i-userplus", label: "Hire" },
      { icon: "i-building", label: "Company" },
    ],
  },
  {
    label: "Automation",
    rows: [
      { icon: "i-phone", label: "AI desk" },
      { icon: "i-sms", label: "Texting" },
      { icon: "i-msg", label: "Messages" },
      { icon: "i-thumb", label: "Reviews" },
      { icon: "i-board", label: "Trade board" },
      { icon: "i-gift", label: "Referrals" },
      { icon: "i-chart", label: "Reports" },
    ],
  },
  {
    label: "Money",
    rows: [
      { icon: "i-bank", label: "Financials" },
      { icon: "i-card", label: "Subscription" },
    ],
  },
];

const ACT_ICON: Record<PreviewIcon, string> = { check: "check", send: "send", lead: "lead", cal: "i-cal" };

/** The trend's polyline in a 560×200 box: x from 44 to 548, y from 12 (the top tick) to 176 (zero). */
function trendGeometry(values: number[]) {
  const top = Math.max(2000, Math.ceil(Math.max(...values) / 2000) * 2000);
  const x = (i: number) => 44 + (i * (548 - 44)) / (values.length - 1);
  const y = (v: number) => 176 - (v / top) * (176 - 12);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => ({ y: y(top * k), label: k === 0 ? "$0" : `$${Math.round((top * k) / 100) / 10}K` }));
  return { points: values.map((v, i) => ({ x: x(i), y: y(v) })), ticks };
}

export function SignupAppPreview({ trade, name = null, now = new Date() }: { trade: TradeType | null; name?: string | null; now?: Date }) {
  const pack = previewPackFor(trade);
  const cal = previewCalendar(now, pack);
  const g = trendGeometry(pack.trend);
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  const greet = first ? `Welcome, ${first}` : "Welcome";
  const shownName = (name ?? "").trim() || "Your name";
  const initials = (name ?? "").trim() ? (name ?? "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") : "You";
  return (
    <div className={css.root} inert aria-hidden="true" data-signup-preview="">
      {/* ── the desk: sidebar, top bar, overview ───────────────────────────── */}
      <div className={css.desk}>
        <aside className={css.side}>
          <div className={css.brand}>
            <ProductMark tone="paper" className={css.mark} />
            <span className={css.brandName}>
              JobFlex<small>Contractor OS</small>
            </span>
          </div>
          <div className={css.nav}>
            {NAV.map((sec) => (
              <Fragment key={sec.label}>
                <div className={css.sec}>{sec.label}</div>
                {sec.rows.map((r) =>
                  r.tone ? (
                    <div key={r.label} className={css.tool} style={{ "--tone": r.tone } as React.CSSProperties}>
                      <span className={css.toolBox}>
                        <Ic id={r.icon} />
                      </span>
                      <span className={css.label}>{r.label}</span>
                      {r.fold ? (
                        <span className={css.fold}>
                          <Ic id="chev" />
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <div key={r.label} className={r.on ? `${css.item} ${css.on}` : css.item}>
                      <Ic id={r.icon} />
                      <span className={css.label}>{r.label}</span>
                      {r.badge ? <em className={css.badge}>{pack.leads}</em> : null}
                    </div>
                  ),
                )}
              </Fragment>
            ))}
          </div>
          <div className={css.user}>
            <span className={css.avatar} data-pv-initials="">
              {initials}
            </span>
            <span className={css.who}>
              <b data-pv-name="">{shownName}</b>
              <small>Owner</small>
            </span>
            <span className={css.gear}>
              <Ic id="gear" />
            </span>
          </div>
        </aside>

        <div className={css.main}>
          <div className={css.top}>
            <div className={css.search}>
              <Ic id="search" />
              Search clients, proposals, leads…
            </div>
            <span className={css.newEst}>
              <Ic id="plus" />
              New estimate
            </span>
            <span className={css.bell}>
              <Ic id="bell" />
              <em>3</em>
            </span>
          </div>

          <div className={css.content}>
            <div className={css.head}>
              <div>
                <div className={css.kicker}>
                  <span data-pv-greet="">{greet}</span> · {cal.today}
                </div>
                <h1 className={css.h1}>Overview</h1>
              </div>
              <div className={css.actions}>
                <span className={`${css.btn} ${css.btnBlue}`}>
                  <Ic id="i-bulb" />
                  Smart Proposal
                </span>
                <span className={css.btn}>
                  <Ic id="i-file" />
                  Manual proposal
                </span>
              </div>
            </div>

            <div className={css.kpis}>
              <span className={css.sample}>Sample numbers</span>
              <div className={css.kpi}>
                <span className={css.kLbl}>Revenue · 30d</span>
                <b className={css.kVal}>{previewMoney(pack.revenue)}</b>
              </div>
              <div className={css.kpi}>
                <span className={css.kLbl}>Pipeline value</span>
                <b className={css.kVal}>{previewMoney(pack.pipeline)}</b>
              </div>
              <div className={css.kpi}>
                <span className={css.kLbl}>Open proposals</span>
                <b className={`${css.kVal} ${css.blue}`}>{pack.open}</b>
              </div>
              <div className={css.kpi}>
                <span className={css.kLbl}>New leads · 7d</span>
                <b className={css.kVal}>{pack.leads}</b>
              </div>
            </div>

            <div className={css.row}>
              <div className={css.card}>
                <div className={css.cardHead}>
                  <span className={css.cardTitle}>Revenue trend</span>
                  <span className={css.select}>
                    Last 7 days
                    <Ic id="chev" />
                  </span>
                </div>
                <svg className={css.chart} viewBox="0 0 560 200" aria-hidden="true">
                  {g.ticks.map((t) => (
                    <g key={t.label}>
                      <line x1="44" x2="548" y1={t.y} y2={t.y} className={css.gridLine} />
                      <text x="36" y={t.y + 3} className={css.tick} textAnchor="end">
                        {t.label}
                      </text>
                    </g>
                  ))}
                  <polyline className={css.line} pathLength={1} points={g.points.map((p) => `${p.x},${p.y}`).join(" ")} />
                  {g.points.map((p, i) => (
                    <rect key={i} className={i === g.points.length - 1 ? `${css.dot} ${css.dotOn}` : css.dot} x={p.x - 4} y={p.y - 4} width="8" height="8" style={{ animationDelay: `${0.55 + i * 0.12}s` }} />
                  ))}
                  {cal.trendDays.map((d, i) => (
                    <text key={i} x={g.points[i].x} y="196" className={css.tick} textAnchor="middle">
                      {d}
                    </text>
                  ))}
                </svg>
              </div>
              <div className={css.card}>
                <div className={css.cardHead}>
                  <span className={css.cardTitle}>Recent activity</span>
                </div>
                <ul className={css.feed}>
                  {pack.activity.map((a) => (
                    <li key={a.text}>
                      <span className={css.feedIc}>
                        <Ic id={ACT_ICON[a.icon]} />
                      </span>
                      <span>
                        <b>{a.text}</b>
                        <small>{a.meta}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className={css.row2}>
              <div className={css.card}>
                <div className={css.cardHead}>
                  <span className={css.cardTitle}>This week</span>
                </div>
                <p className={css.sub}>{pack.jobs.filter((j) => j.inDays < 7 - cal.week.findIndex((d) => d.today)).length} scheduled</p>
                <div className={css.week}>
                  {cal.week.map((d) => (
                    <span key={`${d.dow}${d.day}`} className={d.today ? `${css.day} ${css.dayOn}` : css.day}>
                      <small>{d.dow}</small>
                      {d.day}
                      {d.jobs ? <i className={css.dayDot} /> : null}
                    </span>
                  ))}
                </div>
              </div>
              <div className={css.card}>
                <div className={css.cardHead}>
                  <span className={css.cardTitle}>Upcoming jobs</span>
                </div>
                <ul className={css.jobs}>
                  {pack.jobs.map((j, i) => (
                    <li key={j.title}>
                      <span className={css.date}>{cal.jobDays[i]}</span>
                      <span>
                        <b>{j.title}</b>
                        <small>
                          {j.time} · {j.who}
                        </small>
                      </span>
                      <span className={j.status === "Confirmed" ? `${css.pill} ${css.pillOk}` : css.pill}>{j.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── the phone: the phone app's header and overview ─────────────────── */}
      <div className={css.phone}>
        <div className={css.pTop}>
          <span className={css.pBtn}>
            <Ic id="menu" />
          </span>
          <ProductMark tone="paper" className={css.pMark} />
          <span className={css.pBrand}>
            JobFlex<small>Contractor OS</small>
          </span>
          <span className={css.pBtn}>
            <Ic id="plus" />
          </span>
          <span className={css.pBtn}>
            <Ic id="bell" />
            <em>3</em>
          </span>
        </div>
        <div className={css.pBody}>
          <div className={css.kicker}>
            <span data-pv-greet="">{greet}</span> · {cal.today}
          </div>
          <h1 className={css.pH1}>Overview</h1>
          <div className={css.pRev}>
            <span className={css.kLbl}>Revenue · 30d</span>
            <b>{previewMoney(pack.revenue)}</b>
            <span className={css.sample}>Sample</span>
          </div>
          <div className={css.pTrio}>
            <div>
              <span className={css.kLbl}>Pipeline</span>
              <b>${Math.round(pack.pipeline / 1000)}K</b>
            </div>
            <div>
              <span className={css.kLbl}>Open prop.</span>
              <b className={css.blue}>{pack.open}</b>
            </div>
            <div>
              <span className={css.kLbl}>Leads · 7d</span>
              <b>{pack.leads}</b>
            </div>
          </div>
          <div className={css.card}>
            <div className={css.cardHead}>
              <span className={css.cardTitle}>Recent activity</span>
            </div>
            <ul className={css.feed}>
              {pack.activity.slice(0, 3).map((a) => (
                <li key={a.text}>
                  <span className={css.feedIc}>
                    <Ic id={ACT_ICON[a.icon]} />
                  </span>
                  <span>
                    <b>{a.text}</b>
                    <small>{a.meta}</small>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className={css.pTabs}>
          <span className={css.pTabOn}>
            <Ic id="docPlus" />
            New proposal
          </span>
          <span>
            <Ic id="gear" />
            Settings
          </span>
          <span>
            <Ic id="user" />
            Account
          </span>
        </div>
      </div>

      <div className={css.scrim} />
      {/* A lead arrives while they look: the app is alive. Desk only, clear of the form. */}
      <div className={css.toast}>
        <span className={css.toastIc}>
          <Ic id="lead" />
        </span>
        <span>
          <b>{pack.toast.title}</b>
          <small>{pack.toast.meta}</small>
        </span>
      </div>
    </div>
  );
}
