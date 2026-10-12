"use client";
// THE MONEY LINES OF A PLAN CHANGE (owner, 2026-10-12) — what is charged today
// and what comes next, read off Stripe's preview (actions/billing
// previewPlanChange → lib/planChange), never worked out here; the booked
// YEAR → MONTH switch with its undo; and the declined-card line with the way
// to a new card. One set for the desk page, the handheld page and the
// subscription page that embeds them.
import * as React from "react";
import { useRouter } from "next/navigation";
import { cancelScheduledSwitch, type PlanChangePreviewResult } from "@/actions/billing";
import { useUpdateCard } from "@/components/v3/payment-ribbon/payment-ribbon";
import { toast } from "@/components/ui/Toast";
import "./plan-change-notes.css";

type Preview = Extract<PlanChangePreviewResult, { ok: true }>;

/** "$95" / "$63.33" — to the cent when Stripe's number has cents. */
export function money(cents: number): string {
  const d = cents / 100;
  return Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
}
export function longDay(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
}
const per = (t: "MONTH" | "YEAR") => (t === "YEAR" ? "/yr" : "/mo");

/** The dialog's one sentence about the money, per route. */
export function PlanChangeMoney({ preview }: { preview: Preview }) {
  const p = preview;
  if (p.route === "charge") {
    return (
      <p className="jf-pcn" data-plan-change-route="charge" data-due-now-cents={p.dueNowCents ?? 0}>
        <b>Charged today: {money(p.dueNowCents ?? 0)}</b>
        {p.creditCents > 0 ? <> · includes {money(p.creditCents)} back for the unused part of your current plan</> : null}
        {" "}· then {money(p.termCents)}
        {per(p.interval)} from {longDay(p.nextBillAt)} · paid with your card on file
      </p>
    );
  }
  if (p.route === "schedule") {
    return (
      <p className="jf-pcn" data-plan-change-route="schedule" data-due-now-cents="0">
        <b>Nothing is charged today.</b> Your paid year runs to {longDay(p.switchAt)}; on that day you move to {p.planName} at{" "}
        {money(p.termCents)}
        {per(p.interval)}. You can cancel the switch until then.
      </p>
    );
  }
  if (p.route === "trial") {
    return (
      <p className="jf-pcn" data-plan-change-route="trial" data-due-now-cents="0">
        <b>Nothing is charged today.</b> Your trial runs on; the first bill is {money(p.termCents)}
        {per(p.interval)} on {longDay(p.nextBillAt)}.
      </p>
    );
  }
  return (
    <p className="jf-pcn" data-plan-change-route="free" data-due-now-cents="0">
      <b>Nothing is charged today.</b> Switched now · {money(p.termCents)}
      {per(p.interval)} from your next bill on {longDay(p.nextBillAt)} · this cycle is not refunded.
    </p>
  );
}

/** "Switches to monthly on <date>" with the undo. */
export function ScheduledSwitchNote({
  at,
  planName,
  interval,
  className,
}: {
  at: string;
  planName: string;
  interval: "MONTH" | "YEAR";
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <div className={"jf-pcn-switch" + (className ? ` ${className}` : "")} role="status" data-scheduled-switch={at}>
      <span>
        Switches to {interval === "MONTH" ? "monthly" : "annual"} on <b>{longDay(at)}</b> · {planName}
      </span>
      <button
        type="button"
        className="jf-pcn-btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await cancelScheduledSwitch().catch(() => ({ ok: false as const, error: "Couldn't cancel the switch. Try again." }));
          setBusy(false);
          if (!res.ok) {
            toast.error("Switch not cancelled", res.error);
            return;
          }
          toast.success("Switch cancelled", "You stay on your current plan.");
          router.refresh();
        }}
      >
        {busy ? "Cancelling…" : "Cancel switch"}
      </button>
    </div>
  );
}

/** "Card declined — update your card" and the button to a new card. */
export function CardDeclinedNote({ message, className }: { message: string; className?: string }) {
  const card = useUpdateCard();
  return (
    <div className={"jf-pcn-declined" + (className ? ` ${className}` : "")} role="alert" data-card-declined>
      <span>{message}</span>
      <button type="button" className="jf-pcn-btn" disabled={card.busy} onClick={() => void card.go()}>
        {card.busy ? "Opening…" : "Update card"}
      </button>
      {card.error ? <span className="jf-pcn-err">{card.error}</span> : null}
    </div>
  );
}
