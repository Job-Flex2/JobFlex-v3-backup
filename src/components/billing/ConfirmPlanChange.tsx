"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { dollars, planDiff, type PlanLike } from "@/lib/planDiff";
import "./confirm-plan-change.css";

/**
 * THE PLAN DIALOG — one box for an upgrade, a downgrade and the plan-limit
 * gate, and for the desktop and handheld builds alike (2026-09-19).
 *
 * The content is "was → now" (the owner's pick, 2026-09-19, over a
 * specification table): the current plan and the new one as two tiles, an
 * arrow between them and nothing else — no price difference, the prices
 * themselves are on the tiles (owner, 2026-09-19) — then what opens (or
 * closes), then the one line that says what the money does.
 *
 * Everything in it is read from the catalog rows (lib/planDiff): prices and
 * entitlements. Nothing is typed in here that /admin/plans could later
 * contradict. The payment line says only what the code does — checkout
 * replaces the subscription on return with no credit; a downgrade is switched
 * in place with nothing charged and nothing refunded.
 *
 * The box is 560px, the two buttons sit on one line at equal height and
 * never wrap their words; under 600px the box takes the width and the
 * buttons stack. A `body` may be passed instead of plans (the custom-plan
 * confirmations, the limit gate) and the same box draws it.
 */

export interface ConfirmPlanChangeProps {
  open: boolean;
  kicker?: string;
  title: string;
  confirmLabel: string;
  /** The way out; "Keep my plan" unless the box is not about a plan. */
  cancelLabel?: string;
  busy?: boolean;
  /** The confirm button stays off while the box's own form is not whole
   *  (the cancel reasons, FreeSwitch); the body says why. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Free content — used when no plan comparison applies. */
  body?: React.ReactNode;
  /** The comparison, when there is one. */
  compare?: {
    plans: PlanLike[];
    /** Null when the org has no catalog plan (nothing yet, or the Custom plan). */
    from: PlanLike | null;
    to: PlanLike;
    /** The term the "after" price is for — "/yr" when the plan is bought on
     *  the year (its priceCents then the year's); "/mo" by default. */
    toPer?: "/mo" | "/yr";
    /** The term the "now" price is for ("/yr" for a shop paying yearly). */
    fromPer?: "/mo" | "/yr";
    direction: "up" | "down";
    /** How the change is carried out — decides the payment line. */
    how: "checkout" | "switch";
    /** What the money does, from Stripe's own preview (lib/planChange) —
     *  replaces the generic line for a change made in place. */
    payLine?: React.ReactNode;
  };
}

const CHECK = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12.5 10 17.5 19 7" />
  </svg>
);
const LOCK = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="4" y="11" width="16" height="10" rx="1.5" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);
const ARROW = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 12h15M13 6l6 6-6 6" />
  </svg>
);

/** The one true sentence about the money, per how the change is made. */
function paymentLine(how: "checkout" | "switch", direction: "up" | "down"): string {
  if (how === "checkout") {
    return "Paid on Stripe now · your current subscription ends the moment payment goes through · no credit for its unused days";
  }
  return direction === "down"
    ? "Switched now · nothing is charged · the lower price is on your next bill · this cycle is not refunded"
    : "Switched now on your card on file · the difference is invoiced today";
}

function Compare({ c }: { c: NonNullable<ConfirmPlanChangeProps["compare"]> }) {
  const d = planDiff(c.plans, c.from?.slug ?? null, c.to.slug);
  const up = c.direction === "up";
  const lines = (up ? d.opens : d.closes).slice(0, 4);
  return (
    <>
      <div className="jf-confirm-tiles">
        <div className="jf-confirm-tile is-now">
          <span className="jf-confirm-tile-k">Now</span>
          <span className="jf-confirm-tile-n">{c.from?.name ?? "No plan"}</span>
          <span className="jf-confirm-tile-p">{c.from ? `${dollars(c.from.priceCents)}${c.fromPer ?? "/mo"}` : "—"}</span>
        </div>
        <div className="jf-confirm-arrow" aria-hidden="true">
          {ARROW}
        </div>
        <div className="jf-confirm-tile is-after">
          <span className="jf-confirm-tile-k">After</span>
          <span className="jf-confirm-tile-n">{c.to.name}</span>
          <span className="jf-confirm-tile-p is-big">
            {dollars(c.to.priceCents)}
            <i>{c.toPer ?? "/mo"}</i>
          </span>
        </div>
      </div>
      {lines.length ? (
        <ul className={"jf-confirm-lines" + (up ? "" : " is-closing")}>
          {lines.map((l) => (
            <li key={l}>
              <span className="jf-confirm-ic">{up ? CHECK : LOCK}</span>
              {l}
            </li>
          ))}
        </ul>
      ) : null}
      {c.payLine ?? <p className="jf-confirm-pay">{paymentLine(c.how, c.direction)}</p>}
    </>
  );
}

export function ConfirmPlanChange({
  open,
  kicker = "Change plan",
  title,
  body,
  compare,
  confirmLabel,
  cancelLabel = "Keep my plan",
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmPlanChangeProps) {
  const [mounted, setMounted] = React.useState(false);
  const [on, setOn] = React.useState(false);
  const exit = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- mount/unmount is driven by
     `open`; the second flag lands a frame later so the box has a start state */
  React.useEffect(() => {
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

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!mounted || typeof document === "undefined") return null;

  /* PORTALLED to <body>: the shell's content column is its own stacking
     context under the topbar, so a fixed overlay rendered inside it left the
     topbar bright above the scrim (owner's screenshot, 2026-09-02). */
  return createPortal(
    <div
      className={"jf-confirm" + (on ? " is-on" : "")}
      data-nest=""
      role="dialog"
      aria-modal="true"
      aria-labelledby="jf-confirm-title"
    >
      <div className="jf-confirm-scrim" onClick={() => !busy && onCancel()} />
      <div className="jf-confirm-box">
        <div className="jf-confirm-kick">{kicker}</div>
        <h2 className="jf-confirm-h" id="jf-confirm-title">
          {title}
        </h2>
        {compare ? (
          <Compare c={compare} />
        ) : body ? (
          <div className="jf-confirm-p">{body}</div>
        ) : null}
        <div className="jf-confirm-row">
          <button type="button" className="jf-confirm-btn" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="jf-confirm-btn primary" disabled={busy || confirmDisabled} onClick={onConfirm}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
