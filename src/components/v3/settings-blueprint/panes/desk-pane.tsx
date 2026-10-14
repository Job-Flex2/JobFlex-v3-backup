"use client";

// Settings blueprint — AI desk pane (2026-10-13).
//
// Owner: "AI desk to answer client calls, give info and schedule appointments … users
// create a prompt about the company by typing or talking, and it's converted to a
// professional prompt". Two cards: who answers the company's number, and the desk's
// instructions — the owner's description in, the profile out, section by section, with
// the questions the desk still has and a box to try it.

import { DeskSetup, DeskStatus } from "@/components/v3/ai-desk/desk-setup";
import { DeskMinutes } from "@/components/v3/ai-desk/desk-minutes";
import type { PaneProps } from "../settings-data";
import { DESK_COPY } from "../settings-data";

export function DeskPane({ data, navigate }: PaneProps) {
  const desk = data.desk;
  const registration = data.notifications.sms.registration;
  return (
    <>
      <section className="sc" id="desk-status">
        <div className="sc-h">
          <div>
            <div className="sc-t">{DESK_COPY.title}</div>
            <div className="sc-s">{DESK_COPY.sub}</div>
          </div>
        </div>
        <div className="sc-b">
          {desk.canManage ? <DeskStatus desk={desk} registration={registration} onNumber={() => navigate("texting")} /> : <p className="tx-note" style={{ margin: 0 }}>{DESK_COPY.managersOnly}</p>}
        </div>
      </section>
      {desk.canManage ? (
        <section className="sc" id="desk-minutes">
          <div className="sc-h">
            <div>
              <div className="sc-t">{DESK_COPY.minutesTitle}</div>
              <div className="sc-s">{DESK_COPY.minutesSub}</div>
            </div>
          </div>
          <div className="sc-b">
            <DeskMinutes desk={desk} />
          </div>
        </section>
      ) : null}
      {desk.canManage ? (
        <section className="sc" id="desk-setup">
          <div className="sc-h">
            <div>
              <div className="sc-t">{DESK_COPY.setupTitle}</div>
              <div className="sc-s">{DESK_COPY.setupSub}</div>
            </div>
          </div>
          <div className="sc-b">
            <DeskSetup desk={desk} />
          </div>
        </section>
      ) : null}
    </>
  );
}
