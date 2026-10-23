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
import { ProductMark } from "@/components/brand/ProductMark";
import type { TradeType } from "@/lib/tradeTypes";
import { previewCalendar, previewMoney, previewPackFor, type PreviewIcon } from "@/lib/signupPreview";
import css from "./app-preview.module.css";

const ICON: Record<string, string> = {
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  doc: "M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h6",
  users: "M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.2a3.5 3.5 0 0 1 0 6.6",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 12h.01",
  folder: "M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z",
  share: "M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6M8.6 13.5l6.8 4M15.4 6.5l-6.8 4",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3",
  plan: "M3 3h18v18H3zM3 9h8v12M11 13h10M15 3v6",
  roof: "M3 11l9-7 9 7M5 9.5V20h14V9.5M10 20v-5h4v5",
  fence: "M4 21V8l2-3 2 3v13M16 21V8l2-3 2 3v13M10 21V8l2-3 2 3v13M2 11h20M2 16h20",
  video: "M3 6h12v12H3zM15 10l6-3v10l-6-3",
  fan: "M12 12m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0M12 10c0-4 2-7 5-7 1.5 0 2 2 1 3.5L14 10M14 12c4 0 7 2 7 5 0 1.5-2 2-3.5 1L14 14M12 14c0 4-2 7-5 7-1.5 0-2-2-1-3.5L10 14M10 12c-4 0-7-2-7-5 0-1.5 2-2 3.5-1L10 10",
  deck: "M3 10h18M5 10V6h14v4M4 14h16M6 14v7M18 14v7M12 14v7",
  cal: "M4 6h16v15H4zM4 10h16M8 3v4M16 3v4",
  case: "M3 8h18v12H3zM8 8V5h8v3M3 13h18",
  hat: "M4 17h16M6 17v-3a6 6 0 0 1 12 0v3M10 8V5h4v3",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-4-4",
  plus: "M12 5v14M5 12h14",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4",
  check: "M5 12.5l4.5 4.5L19 7.5",
  send: "M21 3L10 14M21 3l-7 18-4-7-7-4z",
  lead: "M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3",
  menu: "M4 7h16M4 12h16M4 17h16",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0",
  docPlus: "M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M12 11v6M9 14h6",
  chev: "M6 9l6 6 6-6",
};

function Ic({ id, className }: { id: string; className?: string }) {
  return (
    <svg className={className ?? css.ic} viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICON[id]} />
    </svg>
  );
}

const WORK = [
  { id: "grid", label: "Overview", on: true },
  { id: "doc", label: "Proposals" },
  { id: "users", label: "Clients" },
  { id: "target", label: "Leads", badge: true },
  { id: "folder", label: "Projects" },
  { id: "share", label: "CRM" },
];
// The estimators, in the sidebar's own order and colours (blueprint-shell/nav-map).
const TOOLS = [
  { id: "bulb", label: "Smart Proposal", tone: "#7c4dff" },
  { id: "plan", label: "Blueprint estimator", tone: "#1854a0" },
  { id: "roof", label: "Roof estimator", tone: "#c0392b", fold: true },
  { id: "fence", label: "Fence estimator", tone: "#2e7d32", fold: true },
  { id: "video", label: "Video estimator", tone: "#d63384" },
  { id: "fan", label: "HVAC estimator", tone: "#00838f", fold: true },
  { id: "deck", label: "Deck Studio", tone: "#d9822b", fold: true },
];
const DELIVERY = [
  { id: "cal", label: "Calendar" },
  { id: "case", label: "Jobs" },
  { id: "hat", label: "Workers" },
];

const ACT_ICON: Record<PreviewIcon, string> = { check: "check", send: "send", lead: "lead", cal: "cal" };

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
            <div className={css.sec}>Work</div>
            {WORK.map((w) => (
              <div key={w.label} className={w.on ? `${css.item} ${css.on}` : css.item}>
                <Ic id={w.id} />
                {w.label}
                {w.badge ? <em className={css.badge}>{pack.leads}</em> : null}
              </div>
            ))}
            <div className={css.sec}>Estimating tools</div>
            {TOOLS.map((t) => (
              <div key={t.label} className={css.tool} style={{ "--tone": t.tone } as React.CSSProperties}>
                <span className={css.toolBox}>
                  <Ic id={t.id} />
                </span>
                {t.label}
                {t.fold ? (
                  <span className={css.fold}>
                    <Ic id="chev" />
                  </span>
                ) : null}
              </div>
            ))}
            <div className={css.sec}>Delivery</div>
            {DELIVERY.map((d) => (
              <div key={d.label} className={css.item}>
                <Ic id={d.id} />
                {d.label}
              </div>
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
                  <Ic id="bulb" />
                  Smart Proposal
                </span>
                <span className={css.btn}>
                  <Ic id="doc" />
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
