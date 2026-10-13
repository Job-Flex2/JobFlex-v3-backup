// THE WIN-BACK MAILS (owner, 2026-10-08) — to a shop whose card-less trial
// ended with no card (lib/trialWinback): day 1, day 3, the 10% offer on day
// 5, the last word on day 12. Each names what the shop built, because that
// is what it would be walking away from.
import type { BoxRow, EmailDoc, Lockup } from "../doc";

const PLATFORM_LOCKUP: Lockup = { kind: "platform" };
const PLATFORM_FOOTER = { name: "JobFlex" };
const DATE_FMT = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "America/Los_Angeles" });

export type WinbackStage = "d1" | "d3" | "offer" | "last";

export interface WinbackInput {
  stage: WinbackStage;
  name: string | null;
  business: string;
  planName: string;
  /** "$79/mo", or "" when the plan has no price on record. */
  price: string;
  built: { clients: number; proposals: number; jobs: number };
  offer: { pct: number; months: number; until: string } | null;
  href: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function buildWinback(i: WinbackInput): EmailDoc {
  const first = i.name?.trim().split(/\s+/)[0] || "there";
  const made = [i.built.clients > 0 ? plural(i.built.clients, "client", "clients") : "", i.built.proposals > 0 ? plural(i.built.proposals, "proposal", "proposals") : "", i.built.jobs > 0 ? plural(i.built.jobs, "job", "jobs") : ""].filter(Boolean);
  const madeLine = made.length ? `Everything you set up — ${made.join(", ")} — is still there, exactly as you left it.` : "Your workspace is still there, exactly as you left it.";
  const price = i.price ? ` at ${i.price}` : "";
  // A repeating 3-month coupon meets one invoice on a yearly plan.
  const yearly = /\/yr$/.test(i.price);
  const until = i.offer ? DATE_FMT.format(new Date(i.offer.until)) : "";
  const box: BoxRow[] = [
    { type: "field", label: "Workspace", value: i.business },
    { type: "field", label: "Plan", value: i.price ? `${i.planName} · ${i.price}` : i.planName },
    ...(made.length ? [{ type: "field" as const, label: "Still saved", value: made.join(" · ") }] : []),
    ...(i.offer ? [{ type: "cond" as const, label: `${i.offer.pct}% off for ${i.offer.months} months`, chip: `until ${until}`, tone: "ok" as const }] : []),
  ];
  if (i.stage === "d1") {
    return {
      subject: "Your JobFlex trial ended — your work is still there",
      lockup: PLATFORM_LOCKUP, kicker: { text: "Free trial", tone: "warn" }, headline: "Nothing is lost",
      prose: [`Hi ${first} — your free trial of ${i.planName} ended yesterday with no card on file, so ${i.business} is read-only for now.`, `${madeLine} Add a card and you carry on${price} from the next minute — no new set-up, nothing to redo.`],
      box, cta: { label: "Add a card and continue", href: i.href },
      after: ["The first charge is taken when you add the card; cancel anytime from Settings → Billing. Reply to this email if anything is in the way — we read every one."],
      footer: PLATFORM_FOOTER,
    };
  }
  if (i.stage === "d3") {
    return {
      subject: `${i.business} is waiting for you`,
      lockup: PLATFORM_LOCKUP, kicker: { text: "Free trial", tone: "warn" }, headline: "Pick up where you left off",
      prose: [`Hi ${first} — ${madeLine}`, `One card and ${i.business} is open again${price}: the estimators, the proposals your clients can accept and pay from their phone, the leads matched to your trades and your address.`],
      box, cta: { label: "Open my workspace", href: i.href },
      after: ["If the price or something in the app held you back, reply and say so — that is the most useful thing you can tell us."],
      footer: PLATFORM_FOOTER,
    };
  }
  if (i.stage === "offer" && i.offer) {
    return {
      subject: `${i.offer.pct}% off for ${i.offer.months} months to come back — until ${until}`,
      lockup: PLATFORM_LOCKUP, kicker: { text: "An offer", tone: "ok" }, headline: `Come back with ${i.offer.pct}% off`,
      prose: [`Hi ${first} — it has been a few days since your trial ended, so here is a reason to come back: ${i.offer.pct}% off ${i.planName} for your first ${i.offer.months} months.`, `Nothing to type: the discount is applied by itself at the card step. It stands until ${until}. ${madeLine}`],
      box, cta: { label: `Come back with ${i.offer.pct}% off`, href: i.href },
      after: [yearly ? "The discount is taken off your first yearly charge; cancel anytime from Settings → Billing." : "The discount is taken off each of the first three monthly charges; cancel anytime from Settings → Billing."],
      footer: PLATFORM_FOOTER,
    };
  }
  return {
    subject: `Last days of your ${i.offer?.pct ?? 10}% off — ends ${until}`,
    lockup: PLATFORM_LOCKUP, kicker: { text: "An offer", tone: "warn" }, headline: `Your ${i.offer?.pct ?? 10}% off ends ${until}`,
    prose: [`Hi ${first} — a last note from us: the ${i.offer?.pct ?? 10}% off ${i.planName} for ${i.offer?.months ?? 3} months ends on ${until}, and with it this thread.`, `${madeLine} Add a card before then and it is applied by itself; after that, ${i.business} stays read-only and the regular price applies whenever you return.`],
    box, cta: { label: "Add a card before it ends", href: i.href },
    after: ["We will not write again about this trial. Reply any time — a person answers."],
    footer: PLATFORM_FOOTER,
  };
}
