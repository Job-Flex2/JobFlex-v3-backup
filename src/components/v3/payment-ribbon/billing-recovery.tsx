"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { checkBillingRecovery } from "@/actions/billingRecovery";
import type { BillingRecoveryState } from "@/lib/billingRecovery";
import { useUpdateCard } from "./payment-ribbon";
import s from "./billing-recovery.module.css";

export function BillingRecovery({ isOwner, pageLabel, status, blocked = false }: {
  isOwner: boolean;
  pageLabel?: string;
  status?: string;
  blocked?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<BillingRecoveryState | null>(null);
  // The Free plan (lib/freePlan) is a plan, not a problem: the subscription
  // page says "Free" in its hero and offers the plans. The card still stands
  // in front of a page Free does not open (the gate passes pageLabel).
  const onFree = ["CANCELED", "TRIAL_ENDED", "FREE"].includes(status ?? "") && !pageLabel;
  const needed = !onFree && (blocked || ["PAST_DUE", "UNPAID", "CANCELED", "EXPIRED", "TRIAL_ENDED"].includes(status ?? ""));
  const [busy, setBusy] = useState(needed);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const card = useUpdateCard();
  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await checkBillingRecovery();
      if (!mounted.current) return;
      setState(next);
      if (next.kind === "active" && next.verified) router.refresh();
    } catch {
      if (mounted.current) setError("We couldn't check billing right now. Try again in a moment.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [router]);
  useEffect(() => {
    mounted.current = true;
    if (needed && !inFlight.current) {
      inFlight.current = true;
      checkBillingRecovery().then((next) => {
        if (!mounted.current) return;
        setState(next);
        if (next.kind === "active" && next.verified) router.refresh();
      }).catch(() => {
        if (mounted.current) setError("We couldn't check billing right now. Try again in a moment.");
      }).finally(() => {
        inFlight.current = false;
        if (mounted.current) setBusy(false);
      });
    }
    return () => { mounted.current = false; };
  }, [needed, router]);
  // Coming back from the hosted invoice should reconcile access without
  // needing to sign out. Only a read/status sync; focus never charges a card.
  useEffect(() => {
    if (!needed) return;
    const onFocus = () => { void check(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [check, needed]);
  if (!needed) return null;
  return <BillingRecoveryCard isOwner={isOwner} state={state} pageLabel={pageLabel} busy={busy} error={error || card.error}
    cardBusy={card.busy} onCheck={() => void check()} onUpdateCard={() => void card.go()} />;
}

/** Presentation shared by the blocked page and both subscription layouts. */
export function BillingRecoveryCard({ isOwner, state, pageLabel, busy, error, cardBusy, onCheck, onUpdateCard }: {
  isOwner: boolean; state: BillingRecoveryState | null; pageLabel?: string; busy: boolean; error: string | null;
  cardBusy: boolean; onCheck: () => void; onUpdateCard: () => void;
}) {
  const owner = isOwner && state?.isOwner;
  const kind = state?.kind;
  const title = !state ? "Checking your subscription" : kind === "payment" ? "Payment needs attention" :
    kind === "trial-ended" || kind === "canceled" ? "You're on the Free plan" :
    kind === "active" ? "Your plan is active" : "Your plan access has expired";
  const details = !state ? "We're checking the latest billing status before asking you to take action." :
    kind === "payment" ? (owner ? state.reason : "The payment for this workspace's plan did not go through. Ask the account owner to resolve it.") :
    kind === "trial-ended" ? `${pageLabel ? `${pageLabel} isn't on the Free plan. ` : ""}Your trial ended and your account moved to the Free plan — everything you made is still here. Pick a plan to open your tools again.` :
    kind === "canceled" ? state.reason || `${pageLabel ? `${pageLabel} isn't on the Free plan.` : "Your account is on the Free plan."} Your proposals, clients and jobs are all here — choose a plan to open your tools again.` :
    kind === "active" ? "Your subscription is up to date. Your available tools will reopen when the page refreshes." :
    "The access period recorded for this plan has ended. If you already renewed or were given ongoing access, check the status again or contact JobFlex support.";
  const amount = state?.amountCents != null ? new Intl.NumberFormat("en-US", { style: "currency", currency: state.currency }).format(state.amountCents / 100) : null;
  return (
    <section className={s.card} data-nest="" aria-label="Subscription recovery" aria-busy={busy}>
      <div className={s.kicker}>{pageLabel ? `${pageLabel} · Access` : "Subscription · Action needed"}</div>
      <h2 className={s.title}>{title}</h2>
      <p className={s.text}>{details}</p>
      {state?.kind === "payment" && <>
        <p className={s.text}>{state.blocked ? "Plan tools are paused until the subscription becomes active again. Your saved work is safe." : "Your tools remain available during the payment grace period."}</p>
        {owner && <p className={s.note}>
          {state.nextRetryAt ? `Next automatic attempt: ${new Date(state.nextRetryAt).toLocaleString()}. ` : "No automatic retry date is confirmed. "}
          Added funds to the same card? Open the invoice to review and retry payment now. Payment is confirmed on the next screen.
        </p>}
      </>}
      {state && !state.verified && <p className={s.note}>Live billing could not be confirmed. This is the last known status; check again before starting another subscription.</p>}
      {state && !isOwner && kind !== "active" && <p className={s.note}>Only the account owner can manage payments and renew the plan.</p>}
      {error && <p className={s.error} role="alert">{error}</p>}
      <div className={s.actions}>
        {owner && state.invoiceUrl && <a className={s.primary} href={state.invoiceUrl} target="_blank" rel="noopener noreferrer">
          {amount ? `Review & pay ${amount}` : "Review & retry payment"}
        </a>}
        {owner && state.canUpdateCard && kind === "payment" && <button className={s.secondary} type="button" onClick={onUpdateCard} disabled={cardBusy || busy}>
          {cardBusy ? "Opening card form…" : "Update card"}
        </button>}
        {owner && state.verified && ["canceled", "trial-ended", "expired"].includes(kind ?? "") && <Link className={s.primary} href="/dashboard/upgrade">Choose a plan</Link>}
        <button className={s.secondary} type="button" disabled={busy || cardBusy} onClick={onCheck}>{busy ? "Checking…" : "Check payment status"}</button>
        {pageLabel && isOwner && <Link className={s.secondary} href="/dashboard/subscription">Manage subscription</Link>}
      </div>
      {owner && kind === "payment" && state.canUpdateCard && <p className={s.note}>Saving a new card also attempts payment of outstanding subscription invoices.</p>}
    </section>
  );
}
