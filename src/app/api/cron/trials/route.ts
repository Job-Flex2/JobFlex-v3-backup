import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { runCardlessTrialSweep } from "@/lib/cardlessTrial";
import { runCardTrialReminders } from "@/lib/trialEndingMail";

export const runtime = "nodejs";

// Hourly: the card-less trial's reminder emails (two days out, the last day)
// and the "ended" stamp — lib/cardlessTrial runCardlessTrialSweep. Idempotent:
// each email is sent once per trial, recorded on the trial's own row.
// And a trial that took a card: "two days left", once (lib/trialEndingMail, 2026-10-16).
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const res = await runCardlessTrialSweep();
  const cardTrials = await runCardTrialReminders().catch((err) => {
    console.warn("[cron/trials] card-trial reminders failed:", err instanceof Error ? err.message : err);
    return { scanned: 0, sent: 0, failed: true };
  });
  return NextResponse.json({ ok: true, ...res, cardTrials });
}
