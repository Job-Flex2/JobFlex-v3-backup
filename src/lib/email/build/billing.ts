// A FAILED SUBSCRIPTION PAYMENT (owner, 2026-10-07; lib/cardUpdate): the
// first failed charge, and Stripe's last try. Platform emails — JobFlex's own
// lockup — built the way build/trial.ts builds its reminders: pure, no I/O,
// one box, one button (to /dashboard/subscription, where the ribbon's
// "Update card" opens the card form). Receipts for successful payments are
// Stripe's own (Settings → Customer emails), not ours.
import type { BoxRow, EmailDoc, Lockup } from "../doc";

const PLATFORM_LOCKUP: Lockup = { kind: "platform" };
const PLATFORM_FOOTER = { name: "JobFlex" };
const DATE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });

export interface PaymentFailedInput {
  name: string | null;
  /** The plan, by its catalog name. */
  planName: string;
  /** What the failed invoice asks for. */
  amountCents: number;
  /** Stripe's next try; null on the last one. */
  nextAttemptAt: Date | null;
  /** Absolute link to /dashboard/subscription. */
  href: string;
  /** True when Stripe has stopped retrying: the account has moved to Free. */
  final: boolean;
}

function money(cents: number): string {
  const d = cents / 100;
  return Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
}

export function buildPaymentFailed(i: PaymentFailedInput): EmailDoc {
  const first = i.name?.trim().split(/\s+/)[0] || "there";
  const amount = money(i.amountCents);
  const box: BoxRow[] = [
    { type: "field", label: "Plan", value: i.planName },
    { type: "field", label: "Amount due", value: amount },
    i.final
      ? { type: "cond", label: "Status", chip: "Moved to Free", tone: "bad" }
      : { type: "cond", label: "Next try", chip: i.nextAttemptAt ? DATE_FMT.format(i.nextAttemptAt) : "Soon", tone: "warn" },
  ];
  if (i.final) {
    return {
      subject: "Your JobFlex plan has moved to Free — the payment didn't go through",
      lockup: PLATFORM_LOCKUP,
      kicker: { text: "Payment failed", tone: "bad" },
      headline: "Your plan has moved to Free",
      prose: [
        `Hi ${first} — we tried your card several times for ${i.planName} (${amount}) and every try was declined, so your account has moved to the Free plan.`,
        `Everything you made is still there — proposals, clients and jobs stay open. Update your card to get ${i.planName} back.`,
      ],
      box,
      cta: { label: `Update card to get ${i.planName} back`, href: i.href },
      after: ["Questions? Reply to this email and we'll help."],
      footer: PLATFORM_FOOTER,
    };
  }
  return {
    subject: "Your JobFlex payment didn't go through",
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Payment failed", tone: "warn" },
    headline: "Update your card to keep your plan",
    prose: [
      `Hi ${first} — the ${amount} charge for ${i.planName} was declined.`,
      i.nextAttemptAt
        ? `Your workspace stays open, and we'll try the card again on ${DATE_FMT.format(i.nextAttemptAt)}. Update it now and the payment goes through right away.`
        : "Your workspace stays open for now. Update your card and the payment goes through right away.",
    ],
    box,
    cta: { label: "Update card", href: i.href },
    after: ["Questions? Reply to this email and we'll help."],
    footer: PLATFORM_FOOTER,
  };
}

/* THE SWITCH TO FREE, BOOKED (owner, 2026-10-13; lib/freePlan): sent when
   the owner cancels from Settings → Billing. It says the one date that
   matters, that nothing more is billed and the data stays, and offers the
   way back — "Keep <plan>" opens Settings → Billing, where it is one press. */
export interface FreeSwitchBookedInput {
  name: string | null;
  planName: string;
  /** The end of the paid cycle (or the trial): the day the plan switches. */
  switchAt: Date | null;
  /** Absolute link to /dashboard/settings?tab=billing. */
  href: string;
}

export function buildFreeSwitchBooked(i: FreeSwitchBookedInput): EmailDoc {
  const first = i.name?.trim().split(/\s+/)[0] || "there";
  const when = i.switchAt ? DATE_FMT.format(i.switchAt) : null;
  return {
    subject: when ? `Your plan switches to Free on ${when}` : "Your plan switches to Free at the end of this cycle",
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Plan cancelled", tone: "warn" },
    headline: when ? `Your plan switches to Free on ${when}` : "Your plan switches to Free",
    prose: [
      `Hi ${first} — you cancelled ${i.planName}. You keep it until ${when ?? "the end of the cycle you've already paid for"}, and you won't be billed again.`,
      "Then your account moves to the Free plan. Your proposals, clients and jobs stay where they are. Nothing is refunded for the days you don't use.",
    ],
    box: [
      { type: "field", label: "Plan", value: i.planName },
      { type: "field", label: "Next charge", value: "None" },
      { type: "cond", label: "Switches to Free", chip: when ?? "End of cycle", tone: "warn" },
    ],
    cta: { label: `Keep ${i.planName}`, href: i.href },
    after: ["Changed your mind? Keep your plan any time before that date from Settings → Billing. Questions? Reply to this email."],
    footer: PLATFORM_FOOTER,
  };
}
