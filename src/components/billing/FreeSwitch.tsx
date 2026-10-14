"use client";

/**
 * THE MOVE TO FREE — the owner's way out, and the way back (owner,
 * 2026-10-13; lib/freePlan). Shared by Settings → Billing (desktop and
 * handheld) and the subscription page, so the words and the money rule
 * cannot drift between them.
 *
 *   · CancelPlanLink — a plain text link at the foot of the Billing pane,
 *     owner only. It opens two windows in turn:
 *       1 "Before you go": what the plan gives that Free does not (read from
 *         the company's own plan — lib/freePlan freePlanLosses), the
 *         company's own numbers, and the date it keeps the plan until.
 *         "Keep <plan>" closes it; "Continue to cancel" goes on.
 *       2 the confirmation: "Cancel <plan>?", two buttons of one size. The
 *         second books the switch (actions/billing cancelSubscription); an
 *         error stays in the window.
 *     The cross, the scrim and Esc close either window and change nothing.
 *   · FreeSwitchNotice — once booked: "Your plan switches to Free on <date>"
 *     and "Keep <plan>", which lifts the booking after one confirmation.
 *
 * Window 1 is drawn on the house dialog's frame (confirm-plan-change.css —
 * the same box, scrim and motion, a bottom sheet under 600px); window 2 IS
 * the house dialog. Icons come from the shell's sprite.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { cancelSubscription, resumeSubscription } from "@/actions/billing";
import { longDate } from "@/lib/format";
import type { FreeLoss } from "@/lib/freePlan";
import { toast } from "@/components/ui/Toast";
import { ConfirmPlanChange } from "./ConfirmPlanChange";
import "./confirm-plan-change.css";
import "./free-switch.css";
import ribbon from "@/components/v3/trial-card/trial-card.module.css";

/** "until Nov 12, 2026", or the cycle in words when the date is not known. */
const untilWords = (iso: string | null) => (iso ? longDate(iso) : "the end of the cycle you've already paid for");

/* ── The way back ─────────────────────────────────────────────────────── */

export function FreeSwitchNotice({
  planName,
  at,
  canKeep,
  className,
}: {
  planName: string;
  /** ISO day the plan switches to Free. */
  at: string | null;
  /** The owner; anyone else reads the line without the button. */
  canKeep: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const keep = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await resumeSubscription();
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setAsk(false);
      toast.success(`${planName} kept`, res.endsAt ? `Billing goes on as normal · next bill ${longDate(res.endsAt)}.` : "Billing goes on as normal.");
      router.refresh();
    } catch {
      setErr("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, planName, router]);

  return (
    <>
      {/* The dashboard's plate (owner, 2026-10-14): the ribbons' own text and
          blue button (trial-card.module.css — PaymentRibbon, TrialRibbon). */}
      {/* data-nest: the pages' root resets step around it (DESIGN.md, mobile notes). */}
      <div className={"jffs" + (className ? ` ${className}` : "")} data-free-switch="" data-nest="">
        <p className={`jffs-t ${ribbon.ribbonText}`}>
          {at ? (
            <>
              Your plan switches to Free on <b>{longDate(at)}</b>
            </>
          ) : (
            "Your plan switches to Free at the end of this cycle"
          )}
        </p>
        {canKeep ? (
          <button type="button" className={`jffs-keep ${ribbon.button}`} disabled={busy} onClick={() => { setErr(null); setAsk(true); }}>
            {`Keep ${planName}`}
          </button>
        ) : null}
      </div>
      <ConfirmPlanChange
        open={ask}
        kicker="Keep subscription"
        title={`Keep ${planName}?`}
        confirmLabel={`Keep ${planName}`}
        cancelLabel="Not now"
        busy={busy}
        onConfirm={() => void keep()}
        onCancel={() => {
          if (!busy) setAsk(false);
        }}
        body={
          <>
            <p>
              Billing goes back to normal{at ? `, starting with your next bill on ${longDate(at)}` : ""}. Your plan and everything on it
              stay exactly as they are.
            </p>
            {err ? (
              <p className="jffs-err" role="alert">
                {err}
              </p>
            ) : null}
          </>
        }
      />
    </>
  );
}

/* ── The way out ──────────────────────────────────────────────────────── */

export interface CancelOffer {
  planName: string;
  keepsUntil: string | null;
  losses: FreeLoss[];
  made: string | null;
}

export function CancelPlanLink({ offer, className }: { offer: CancelOffer; className?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const plan = offer.planName;
  const until = untilWords(offer.keepsUntil);

  const book = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await cancelSubscription();
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setStep(0);
      toast.success(
        res.endsAt ? `Your plan switches to Free on ${longDate(res.endsAt)}` : "Your plan switches to Free at the end of this cycle",
        "You won't be billed again. Change your mind any time before then.",
      );
      router.refresh();
    } catch {
      setErr("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, router]);

  return (
    <>
      <div className={"jffs-cancel" + (className ? ` ${className}` : "")}>
        <button type="button" className="jffs-link" onClick={() => { setErr(null); setStep(1); }}>
          Cancel subscription
        </button>
      </div>

      <BeforeYouGo
        open={step === 1}
        offer={offer}
        until={until}
        onKeep={() => setStep(0)}
        onContinue={() => setStep(2)}
      />

      <ConfirmPlanChange
        open={step === 2}
        kicker="Cancel subscription"
        title={`Cancel ${plan}?`}
        confirmLabel="Cancel subscription"
        cancelLabel={`Keep ${plan}`}
        busy={busy}
        onConfirm={() => void book()}
        onCancel={() => {
          if (!busy) setStep(0);
        }}
        body={
          <>
            <p>
              {`You keep ${plan} until ${until} — the cycle you've already paid for — and you won't be billed again. Then your account moves to the Free plan. Nothing is refunded for the days you don't use.`}
            </p>
            {err ? (
              <p className="jffs-err" role="alert">
                {err}
              </p>
            ) : null}
          </>
        }
      />
    </>
  );
}

/** Window 1. The house dialog's frame with a cross, a list and a link. */
function BeforeYouGo({
  open,
  offer,
  until,
  onKeep,
  onContinue,
}: {
  open: boolean;
  offer: CancelOffer;
  until: string;
  onKeep: () => void;
  onContinue: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [on, setOn] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  const exit = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- mount/unmount follows
     `open`; the second flag lands a frame later so the box has a start state
     (the house dialog's own pattern, ConfirmPlanChange) */
  useEffect(() => {
    if (open) {
      if (exit.current) {
        clearTimeout(exit.current);
        exit.current = null;
      }
      setMounted(true);
      const id = requestAnimationFrame(() => setOn(true));
      return () => cancelAnimationFrame(id);
    }
    setOn(false);
    exit.current = setTimeout(() => {
      setMounted(false);
      exit.current = null;
    }, 220);
    return () => {
      if (exit.current) clearTimeout(exit.current);
    };
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // The way back first: the focus lands on "Keep <plan>" once the box is in.
  useEffect(() => {
    if (on) keepRef.current?.focus();
  }, [on]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onKeep();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onKeep]);

  if (!mounted || typeof document === "undefined") return null;
  const plan = offer.planName;

  return createPortal(
    <div className={"jf-confirm jffs-dlg" + (on ? " is-on" : "")} data-nest="" role="dialog" aria-modal="true" aria-labelledby="jffs-go-title">
      <div className="jf-confirm-scrim" onClick={onKeep} />
      <div className="jf-confirm-box">
        <button type="button" className="jffs-x" aria-label="Close" onClick={onKeep}>
          <svg aria-hidden="true">
            <use href="#i-x" />
          </svg>
        </button>
        <div className="jf-confirm-kick">Cancel subscription</div>
        <h2 className="jf-confirm-h" id="jffs-go-title">
          Before you go
        </h2>
        <p className="jffs-lead">{`What ${plan} gives you that the Free plan doesn't:`}</p>
        <ul className="jffs-list">
          {offer.losses.map((l) => (
            <li key={l.text}>
              <span className="jffs-ic" aria-hidden="true">
                <svg>
                  <use href={`#${l.icon}`} />
                </svg>
              </span>
              <span className="jffs-li-t">{l.text}</span>
            </li>
          ))}
        </ul>
        {offer.made ? <p className="jffs-made">{offer.made}</p> : null}
        <p className="jffs-keeps">
          {`You keep ${plan} until ${until}. After that your account moves to the Free plan — your data stays.`}
        </p>
        <div className="jffs-acts">
          <button ref={keepRef} type="button" className="jf-confirm-btn primary" onClick={onKeep}>
            {`Keep ${plan}`}
          </button>
          <button type="button" className="jffs-link jffs-go" onClick={onContinue}>
            Continue to cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
