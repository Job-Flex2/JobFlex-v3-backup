"use client";

// MANAGE A BOOKED VISIT (2026-09-23) — the customer's own link: move it to
// another open time, or cancel it. The desk sees either at once.

import { useState, useTransition } from "react";
import { availabilityForToken, cancelBookingPublic, rescheduleBookingPublic, type PublicDay } from "@/actions/booking";
import { DayPicker, SlotGroups } from "../../[slug]/book-wizard";

export function ManageVisit({ token, status, when }: { token: string; status: string; when: string }) {
  const [days, setDays] = useState<PublicDay[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [state, setState] = useState<{ status: string; when: string }>({ status, when });
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const done = state.status === "CANCELED";

  const openTimes = () =>
    start(async () => {
      const r = await availabilityForToken(token);
      if (r.ok) {
        setDays(r.days);
        setDay(r.days[0]?.day ?? null);
      } else setMsg("Could not load open times.");
    });
  const move = (iso: string) =>
    start(async () => {
      const r = await rescheduleBookingPublic(token, iso);
      if (r.ok && r.when) {
        setState({ status: "RESCHEDULED", when: r.when });
        setDays(null);
        setMsg("Moved. A confirmation is on its way.");
      } else setMsg(r.error ?? "Could not move it.");
    });
  const cancel = () =>
    start(async () => {
      const r = await cancelBookingPublic(token);
      if (r.ok) setState((s) => ({ ...s, status: "CANCELED" }));
      else setMsg("Could not cancel.");
    });

  return (
    <div className="jfb-manage" data-manage-status={state.status}>
      <div className={`jfb-when${done ? " is-canceled" : ""}`}>
        <span className="jfb-pick-k">{done ? "Status" : "Booked for"}</span>
        <strong>{done ? "Canceled" : state.when}</strong>
      </div>
      {msg && <p className="jfb-msg" role="status">{msg}</p>}
      {!done && (
        <div className="jfb-acts">
          <button type="button" className="jfb-btn jfb-btn--primary" onClick={openTimes} disabled={pending} data-manage-move>Pick another time</button>
          <button type="button" className="jfb-btn jfb-btn--danger" onClick={cancel} disabled={pending} data-manage-cancel>Cancel the visit</button>
        </div>
      )}
      {days && (
        <div className="jfb-move">
          <DayPicker days={days} day={day} onDay={setDay} />
          <SlotGroups slots={days.find((d) => d.day === day)?.slots ?? []} onSlot={(s) => move(s.iso)} disabled={pending} attr="manage" />
        </div>
      )}
    </div>
  );
}
