"use client";

// Settings blueprint — AI desk pane (2026-10-13).
//
// Owner: "AI desk to answer client calls, give info and schedule appointments … users
// create a prompt about the company by typing or talking, and it's converted to a
// professional prompt". Since 2026-10-14 one piece: the desk's overview and its tabs
// (components/v3/ai-desk/desk-steps) — the minutes are one of the tabs.

import { useRouter } from "next/navigation";
import { DeskSteps } from "@/components/v3/ai-desk/desk-steps";
import type { PaneProps } from "../settings-data";
import { DESK_COPY } from "../settings-data";

export function DeskPane({ data }: PaneProps) {
  const router = useRouter();
  const desk = data.desk;
  const registration = data.notifications.sms.registration;
  // The desk is its own overview and tabs (components/v3/ai-desk/desk-steps); the minutes are one of its tabs.
  if (!desk.canManage) {
    return (
      <section className="sc" id="desk-status">
        <div className="sc-b">
          <p className="tx-note" style={{ margin: 0 }}>{DESK_COPY.managersOnly}</p>
        </div>
      </section>
    );
  }
  return (
    <div id="desk-status">
      {/* The number is set up on the Texting page since 2026-10-16. */}
      <DeskSteps desk={desk} registration={registration} onNumber={() => router.push("/dashboard/texting#texting-own-number")} />
    </div>
  );
}
