"use client";
// ROUTE DAYS (lawn estimator, 2026-10-18). The week's lawn-plan visits by day, each day in the order the crew drives
// it from the shop, with the drive and the crew's hours; "Balance my mowing days" gives every yard a weekday by where
// it is, "Rained out" pushes a day to the next.
import * as React from "react";
import s from "./lawn.module.css";
import { balanceMowingDays, loadRouteWeek, rainDelay, type RouteDay } from "@/actions/lawnEstimator";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hm = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
const mondayOf = (d: Date) => {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dow = x.getUTCDay() === 0 ? 7 : x.getUTCDay();
  return new Date(x.getTime() - (dow - 1) * 86400000);
};

export function RouteWeek() {
  const [week, setWeek] = React.useState(() => mondayOf(new Date()));
  const [days, setDays] = React.useState<RouteDay[] | null>(null);
  const [info, setInfo] = React.useState<{ plans: number; unlocated: number; shop: boolean; timeZone: string } | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [crewDays, setCrewDays] = React.useState(5);
  const ws = week.toISOString().slice(0, 10);

  const load = React.useCallback(async () => {
    const r = await loadRouteWeek({ weekStart: ws });
    if (!r.ok) return setMsg(r.error);
    setDays(r.days);
    setInfo({ plans: r.plans, unlocated: r.unlocated, shop: r.shop, timeZone: r.timeZone });
  }, [ws]);
  React.useEffect(() => {
    let live = true;
    loadRouteWeek({ weekStart: ws }).then((r) => {
      if (!live) return;
      if (!r.ok) return setMsg(r.error);
      setDays(r.days);
      setInfo({ plans: r.plans, unlocated: r.unlocated, shop: r.shop, timeZone: r.timeZone });
    });
    return () => {
      live = false;
    };
  }, [ws]);

  return (
    <div className={s.studio} data-lawn-routes>
      <header className={s.pageHead}>
        <div>
          <div className={s.kicker}>
            Lawn &amp; landscape estimator · Route days <span className={s.adminNote}>Admin preview</span>
          </div>
          <h1 className={s.pageTitle}>Route days</h1>
          <p className={s.pageSub}>The week&apos;s lawn-plan visits, each day in driving order from your shop — nearby yards on the same day, as few days as the work fills. Times follow the route, in your company&apos;s time zone; the calendar and the crews see the same.</p>
        </div>
        <a className={`${s.btn} ${s.btnSm}`} href="/dashboard/lawn-estimator">
          ← The estimator
        </a>
      </header>
      {msg ? <p className={s.note}>{msg}</p> : null}
      <section className={s.card}>
        <div className={s.body}>
          <div className={s.row}>
            <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => setWeek(new Date(week.getTime() - 7 * 86400000))}>
              ← Week
            </button>
            <span className={s.cardTitle} style={{ fontSize: 13 }}>
              Week of {week.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
            </span>
            <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => setWeek(new Date(week.getTime() + 7 * 86400000))}>
              Week →
            </button>
            <span className={s.toolSep} />
            <label className={s.tool} style={{ fontSize: 12.5, fontWeight: 700 }}>
              Mowing days a week
              <select className={s.in} style={{ width: 70, height: 34 }} value={crewDays} onChange={(e) => setCrewDays(Number(e.target.value))}>
                {[3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={`${s.btn} ${s.btnSm} ${s.btnPrimary}`}
              disabled={busy || !info?.plans}
              onClick={async () => {
                if (!window.confirm(`Give every yard a mowing day (Monday–${WEEKDAY[crewDays]}) by where it is, and move its coming mowings to that day?`)) return;
                setBusy(true);
                const r = await balanceMowingDays({ days: crewDays });
                setBusy(false);
                if (!r.ok) return setMsg(r.error);
                setMsg(`Balanced: ${r.perDay.map((d) => `${WEEKDAY[d.weekday]} ${d.yards} yard${d.yards === 1 ? "" : "s"} (${hm(d.minutes)})`).join(" · ")} — ${r.moved} mowings moved.`);
                void load();
              }}
              data-lawn-balance
            >
              {busy ? "Balancing…" : "Balance my mowing days"}
            </button>
          </div>
          {info ? (
            <p className={s.note}>
              {info.plans} lawn plan{info.plans === 1 ? "" : "s"} active{info.unlocated ? ` · ${info.unlocated} without a location (made before route days) — not routed` : ""}
              {info.shop ? "" : " · set the company's address in Settings so routes start from the shop"}
            </p>
          ) : null}
        </div>
      </section>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
        {(days ?? []).filter((d) => new Date(`${d.date}T12:00:00Z`).getUTCDay() !== 0 || d.stops.length).map((d) => {
          const dow = new Date(`${d.date}T12:00:00Z`).getUTCDay();
          const dayLoad = d.crewMinutes + d.driveMinutes;
          return (
            <section key={d.date} className={s.card} data-lawn-route-day={d.date}>
              <div className={s.head}>
                <div>
                  <div className={s.cardTitle} style={{ fontSize: 12.5 }}>
                    {WEEKDAY[dow]} {Number(d.date.slice(8))}
                  </div>
                  <p className={s.cardSub}>{d.stops.length ? `${d.stops.length} stop${d.stops.length === 1 ? "" : "s"} · ${hm(d.crewMinutes)} on site · ${hm(d.driveMinutes)} driving` : "Nothing booked"}</p>
                </div>
                {d.stops.length ? (
                  <button
                    type="button"
                    className={`${s.btn} ${s.btnSm}`}
                    onClick={async () => {
                      if (!window.confirm(`Rained out? Move ${WEEKDAY[dow]}'s ${d.stops.length} lawn visits to the next working day?`)) return;
                      const r = await rainDelay({ date: d.date });
                      if (!r.ok) return setMsg(r.error);
                      setMsg(`${r.moved} visits moved to ${r.to}.`);
                      void load();
                    }}
                    data-lawn-rain={d.date}
                  >
                    Rained out
                  </button>
                ) : null}
              </div>
              <div className={s.body} style={{ gap: 6 }}>
                {d.stops.length ? (
                  <div className={s.bar} title={`${hm(dayLoad)} of an 8-hour day`}>
                    <div className={s.barFill} style={{ width: `${Math.min(100, (dayLoad / 480) * 100)}%`, background: dayLoad > 480 ? "#b45309" : undefined }} />
                  </div>
                ) : null}
                {d.stops.map((x, i) => (
                  <div key={x.visitId} style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", gap: "0 8px", fontSize: 12.5 }}>
                    <span className={s.mono}>{i + 1}</span>
                    <span style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.client}</span>
                    <span />
                    <span className={s.note} style={{ fontSize: 11.5 }}>
                      {new Date(x.startsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: info?.timeZone })} · {x.label} · {x.minutes} min{x.driveFromPrev ? ` · ${x.driveFromPrev} min drive` : ""}
                      {x.located ? "" : " · no location"}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
