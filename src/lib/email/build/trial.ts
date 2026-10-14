// The card-less trial's two reminders (owner, 2026-10-01; lib/cardlessTrial):
// two days before the trial ends, and on the day. Platform emails — JobFlex's
// own lockup — built the way build/planGrant.ts builds its one: pure, no I/O,
// one box, one button (to /dashboard/trial, where the card is added).
import type { BoxRow, EmailDoc, Lockup } from "../doc";

const PLATFORM_LOCKUP: Lockup = { kind: "platform" };
const PLATFORM_FOOTER = { name: "JobFlex" };
const DATE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });

export interface TrialReminderInput {
  name: string | null;
  /** The plan the trial runs on, by its catalog name. */
  planName: string;
  trialDays?: number;
  /** "$79/mo" */
  price: string;
  endsAt: Date;
  /** Absolute link to /dashboard/trial. */
  href: string;
  /** "soon" — two days out; "today" — the last day. */
  when: "soon" | "today";
}

export function buildTrialReminder(i: TrialReminderInput): EmailDoc {
  const first = i.name?.trim().split(/\s+/)[0] || "there";
  const date = DATE_FMT.format(i.endsAt);
  const today = i.when === "today";
  const box: BoxRow[] = [
    { type: "field", label: "Plan", value: `${i.planName} · ${i.price}` },
    { type: "field", label: "Trial ends", value: today ? `Today, ${date}` : date },
    { type: "cond", label: "Card on file", chip: "None yet", tone: "warn" },
  ];
  return {
    subject: today ? "Your JobFlex trial ends today" : "2 days left in your JobFlex trial",
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Free trial", tone: "warn" },
    headline: today ? "Your free trial ends today" : "Two days left in your free trial",
    prose: [
      today
        ? `Hi ${first} — your ${i.trialDays ?? 7}-day trial of ${i.planName} ends today, and there is no card on file yet.`
        : `Hi ${first} — your ${i.trialDays ?? 7}-day trial of ${i.planName} ends on ${date}, and there is no card on file yet.`,
      `Add a card to keep your workspace open: ${i.planName} carries on at ${i.price}, charged when the trial ends. Without one your account moves to the Free plan — everything you made stays, and a card brings ${i.planName} back.`,
    ],
    box,
    cta: { label: "Add a card", href: i.href },
    after: ["Nothing is charged until you add a card. Questions? Reply to this email and we'll help."],
    footer: PLATFORM_FOOTER,
  };
}

export interface TrialConfirmInput {
  name: string | null;
  /** The plan picked on the plan step, by its catalog name. */
  planName: string;
  trialDays?: number;
  /** Absolute link to /auth/register/confirm?t=… */
  href: string;
}

/** The address check the card-less trial starts from (stage 3, 2026-10-01):
 *  the account and the trial are created when this link is opened. */
export function buildTrialConfirm(i: TrialConfirmInput): EmailDoc {
  const first = i.name?.trim().split(/\s+/)[0] || "there";
  const box: BoxRow[] = [
    { type: "field", label: "Plan", value: `${i.planName} · ${i.trialDays ?? 7} days free` },
    { type: "cond", label: "Card", chip: "Not needed", tone: "ok" },
    { type: "field", label: "Link expires", value: "In 24 hours" },
  ];
  return {
    subject: "Confirm your email to start your JobFlex trial",
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "One step left" },
    headline: "Confirm your email to start your trial",
    prose: [
      `Hi ${first} — open the link below and your shop is created with a ${i.trialDays ?? 7}-day free trial of ${i.planName}. No card needed.`,
    ],
    box,
    cta: { label: "Confirm and start my trial", href: i.href },
    after: ["Didn't sign up for JobFlex? Ignore this email — nothing is created without the link."],
    footer: PLATFORM_FOOTER,
  };
}
