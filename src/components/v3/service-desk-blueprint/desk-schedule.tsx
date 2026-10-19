"use client";

// HVAC SERVICES · SCHEDULE (2026-10-18): the season at a glance (plan visits a
// month for the next twelve — spring and fall are where the crew goes), then
// every plan visit by month with its client, address, tech and state. A visit
// moves (day and time) or gets its tech right here; the calendar shows the
// same appointment, so moving it in either place is the same move.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { completePlanVisit } from "@/actions/servicePlans";
import { moveServiceVisit, staffServiceVisit } from "@/actions/serviceDesk";
import type { VisitStage } from "@/lib/serviceDesk";
import type { DeskVisitView } from "@/lib/serviceDeskBook";
import { Plate, clientHref, cx, dayWords, useDesk } from "./desk-shared";

export const STAGE_WORD: Record<VisitStage, string> = { overdue: "Overdue", today: "Today", soon: "Coming up", later: "Scheduled", done: "Done", skipped: "Skipped" };

type Show = "open" | "overdue" | "done" | "all";

export function ScheduleTab() {
  const { data, focus } = useDesk();
  const [show, setShow] = useState<Show>("open");
  const [month, setMonth] = useState<string | null>(null);
  const [tech, setTech] = useState<string>("any");
  const live = useMemo(() => data.visits.filter((v) => v.planStatus === "ACTIVE" || v.status === "DONE"), [data.visits]);
  const counts: Record<Show, number> = {
    open: live.filter((v) => v.status === "SCHEDULED").length,
    overdue: live.filter((v) => v.stage === "overdue").length,
    done: live.filter((v) => v.status === "DONE").length,
    all: live.length,
  };
  const max = Math.max(1, ...data.load.map((m) => m.count));

  const list = useMemo(() => {
    let rows = live;
    if (show === "open") rows = rows.filter((v) => v.status === "SCHEDULED");
    if (show === "overdue") rows = rows.filter((v) => v.stage === "overdue");
    if (show === "done") rows = rows.filter((v) => v.status === "DONE");
    if (month) rows = rows.filter((v) => v.day.slice(0, 7) === month);
    if (tech === "none") rows = rows.filter((v) => v.techIds.length === 0);
    else if (tech !== "any") rows = rows.filter((v) => v.techIds.includes(tech));
    if (show === "done") rows = [...rows].reverse();
    const groups = new Map<string, DeskVisitView[]>();
    for (const v of rows) groups.set(v.day.slice(0, 7), [...(groups.get(v.day.slice(0, 7)) ?? []), v]);
    return [...groups.entries()];
  }, [live, show, month, tech]);

  return (
    <div className={cx("stack")}>
      <section className={cx("card")} data-desk-season>
        <div className={cx("card-h")}>
          <div className={cx("card-t")}>The season</div>
          <div className={cx("card-s")}>plan visits a month · tap a month to see its visits</div>
        </div>
        <div className={cx("load")}>
          {data.load.map((m) => (
            <button key={m.key} type="button" className={cx("bar", month === m.key && "bar--on")} onClick={() => setMonth(month === m.key ? null : m.key)} title={`${m.label} ${m.year}: ${m.count} visit${m.count === 1 ? "" : "s"}, ${m.done} done`} data-month={m.key}>
              <span className={cx("bar-n")}>{m.count || ""}</span>
              <span className={cx("bar-track")}>
                <span className={cx("bar-fill")} style={{ height: `${(m.count / max) * 100}%` }} />
                <span className={cx("bar-done")} style={{ height: `${(m.done / max) * 100}%` }} />
              </span>
              <span className={cx("bar-l")}>{m.label}</span>
            </button>
          ))}
        </div>
        <div className={cx("legend")}>
          <span>
            <i style={{ background: "rgba(13, 122, 138, 0.28)" }} />
            on the calendar
          </span>
          <span>
            <i style={{ background: "var(--tool-hvac, #0d7a8a)" }} />
            done
          </span>
          <span>Two-visit plans land around Apr 15 (cooling) and Oct 1 (heating), at 9:00.</span>
        </div>
      </section>

      <section className={cx("card")} data-desk-schedule>
        <div className={cx("toolbar")}>
          <div className={cx("chips")}>
            {(["open", "overdue", "done", "all"] as Show[]).map((s) => (
              <button key={s} type="button" className={cx("chip", show === s && "chip--on")} onClick={() => setShow(s)} data-show={s}>
                {s === "open" ? "Coming up" : s === "overdue" ? "Overdue" : s === "done" ? "Done" : "All"} <b>{counts[s]}</b>
              </button>
            ))}
            {month && (
              <button type="button" className={cx("chip", "chip--on")} onClick={() => setMonth(null)} title="Show every month">
                {data.load.find((m) => m.key === month)?.label ?? month} ✕
              </button>
            )}
          </div>
          <select className={cx("sel", "sel--sm")} style={{ width: "auto", marginLeft: "auto" }} value={tech} onChange={(e) => setTech(e.target.value)} aria-label="Whose visits" data-tech-filter>
            <option value="any">Every tech</option>
            <option value="none">Nobody on it yet</option>
            {data.workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>

        {list.length === 0 ? (
          <div className={cx("empty")}>
            {data.visits.length === 0 ? "No plan visits yet. When a client's plan starts, its tune-ups land here and on the calendar on their own." : "Nothing here with these filters."}
          </div>
        ) : (
          list.map(([key, rows]) => (
            <div key={key}>
              <div className={cx("month-h")}>
                <b>{new Date(`${key}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</b>
                <span className={cx("card-s")}>
                  {rows.length} visit{rows.length === 1 ? "" : "s"}
                </span>
              </div>
              {rows.map((v) => (
                <VisitRow key={v.id} v={v} focused={focus === v.id} />
              ))}
            </div>
          ))
        )}
        <p className={cx("hint")} style={{ marginTop: 12 }}>
          Every visit is on the Calendar too, with the crew&apos;s tune-up checklist in its notes. Moving it here or there is the same move — the crew on it gets a text.
        </p>
      </section>
    </div>
  );
}

function VisitRow({ v, focused }: { v: DeskVisitView; focused: boolean }) {
  const { data, act, busy } = useDesk();
  const [moving, setMoving] = useState(focused && v.status === "SCHEDULED");
  const [day, setDay] = useState(v.day);
  const [time, setTime] = useState(() => {
    try {
      return new Date(v.startsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: data.tz });
    } catch {
      return "09:00";
    }
  });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focused]);
  const k = (w: string) => `visit:${v.id}:${w}`;
  const d = new Date(`${v.day}T12:00:00Z`);

  return (
    <div ref={ref} className={cx("vrow", focused && "vrow--focus")} data-visit={v.id} data-stage={v.stage}>
      <div className={cx("vdate")}>
        <b>{d.getUTCDate()}</b>
        <span>{d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}</span>
      </div>
      <div>
        <div className={cx("vt")}>
          <span className={cx("mono")}>{v.time}</span>
          {v.label}
        </div>
        <Link className={cx("who")} href={clientHref(v.clientId) as Route}>
          {v.clientName}
        </Link>
        <span className={cx("sub")}>
          {[v.address, v.phone, v.planName].filter(Boolean).join(" · ")}
        </span>
      </div>
      <div>
        {v.status === "SCHEDULED" && v.appointmentId ? (
          <select
            className={cx("sel", "sel--sm")}
            value={v.techIds[0] ?? ""}
            disabled={!!busy}
            onChange={(e) => act(k("tech"), () => staffServiceVisit(v.id, e.target.value ? [e.target.value] : []))}
            aria-label={`Tech for ${v.clientName}'s visit`}
            data-visit-tech
          >
            <option value="">{data.workers.length ? "No tech yet" : "No crew in Workers yet"}</option>
            {data.workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        ) : (
          <span className={cx("sub")}>{v.techs.join(", ") || "—"}</span>
        )}
      </div>
      <div>
        <Plate tone={v.stage}>{STAGE_WORD[v.stage]}</Plate>
        {v.report !== "none" && <span className={cx("sub")}>report {v.report}</span>}
      </div>
      <div className={cx("acts")}>
        {v.appointmentId && (
          <Link className={cx("btn", v.stage === "overdue" || v.stage === "today" ? "btn-primary" : "btn-ghost", "btn--xs")} href={`/dashboard/visits/${v.appointmentId}` as Route}>
            Report
          </Link>
        )}
        {v.status === "SCHEDULED" && (
          <>
            <button type="button" className={cx("btn", "btn-ghost", "btn--xs")} disabled={!!busy} onClick={() => act(k("done"), () => completePlanVisit(v.id), "Visit marked done.")} data-visit-done>
              {busy === k("done") ? "…" : "Done"}
            </button>
            {v.appointmentId && (
              <button type="button" className={cx("btn", "btn-ghost", "btn--xs")} onClick={() => setMoving((m) => !m)} aria-expanded={moving} data-visit-move>
                Move
              </button>
            )}
          </>
        )}
      </div>
      {moving && v.status === "SCHEDULED" && (
        <form
          className={cx("vmove")}
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act(k("move"), () => moveServiceVisit(v.id, day, time))) setMoving(false);
          }}
          data-visit-move-form
        >
          <label className={cx("fld")}>
            <span className={cx("lbl")}>Day</span>
            <input className={cx("in")} type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
          </label>
          <label className={cx("fld")}>
            <span className={cx("lbl")}>Time</span>
            <input className={cx("in")} type="time" value={time} step={900} onChange={(e) => setTime(e.target.value)} required />
          </label>
          <button type="submit" className={cx("btn", "btn-primary", "btn--sm")} disabled={!!busy}>
            {busy === k("move") ? "Moving…" : `Move to ${day ? dayWords(day) : "…"}`}
          </button>
          <button type="button" className={cx("btn", "btn-ghost", "btn--sm")} onClick={() => setMoving(false)}>
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
