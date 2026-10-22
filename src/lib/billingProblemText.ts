// THE OWNER'S TEXT WHEN THE PLAN PAYMENT FAILS (owner, 2026-10-21).
//
// invoice.payment_failed, a real missed bill (the webhook already skipped an
// active or trialing subscription) → one text to the company's owner:
//
//   JobFlex: payment of $95 for Professional didn't go through (insufficient
//   funds). Update your card: jobflex.app/dashboard/subscription
//
// The link is the Subscription page — its payment banner holds the card form
// and the invoice (components/v3/payment-ribbon) — never Stripe directly.
//
//   · the first failed try of an invoice (attempt 1) opens it; a later try
//     that fails too gets a second text only when three days have passed
//     since the first; never more than two per invoice;
//   · the owner's phone: the verified texting mobile (Settings → Texting),
//     else the Profile phone; none → no text;
//   · the owner's "Billing problems" Text cell (lib/notificationPrefs, on by
//     default), the texts-paused switch, and their quiet hours (held until
//     the morning, as every member text is);
//   · never to a QA Lab company (lib/qaTestMode);
//   · from JobFlex's own number (organizationId null, kind "jobflex-…" —
//     lib/sms/send), as the team's alerts are.
//
// Each invoice's texts are stamped in SyncState `billingText:<invoice>` —
// `{ sent: [iso, iso?] }`, claimed before the send (a redelivered event finds
// it taken) — so the same day never sees two. No push or in-app copy: the
// banner is already there.
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { invoiceSubscriptionId } from "@/lib/stripeCompat";
import { isQaOrg } from "@/lib/qaTestMode";
import { sendText } from "@/lib/sms/send";
import { nextQuietEnd, parseNotificationPrefs, smsDecision } from "@/lib/notificationPrefsShared";
import { failureCode, plainDeclineWords } from "@/lib/paymentFailureShared";

const KIND = "jobflex-billing";
const KEY = (invoiceId: string) => `billingText:${invoiceId}`;
const SECOND_AFTER_MS = 3 * 86_400_000;
const MAX_TEXTS = 2;

type Stamp = { sent: string[] };

function readStamp(cursor: string | null | undefined): Stamp | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(cursor) as { sent?: unknown };
    return Array.isArray(v.sent) ? { sent: v.sent.filter((x): x is string => typeof x === "string") } : null;
  } catch {
    return null;
  }
}

function dollars(cents: number, currency: string): string {
  const whole = cents % 100 === 0;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: whole ? 0 : 2 }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(whole ? 0 : 2)}`;
  }
}

/** The link as a phone shows it: no scheme, no www — "jobflex.app/dashboard/subscription". */
async function shortLink(path: string): Promise<string> {
  return `${(await appBaseUrl()).replace(/\/$/, "").replace(/^https?:\/\//, "").replace(/^www\./, "")}${path}`;
}

export type BillingTextResult = "sent" | "held" | "skipped";

/** Never throws: a text that cannot go loses the text, not the webhook. */
export async function textOwnerPaymentFailed(
  invoice: Stripe.Invoice,
  failed: { declineCode: string | null; errorCode: string | null } | null,
  now = new Date(),
): Promise<BillingTextResult> {
  const skip = (why: string): BillingTextResult => {
    console.info(`[billing-text] ${invoice.id}: not texted — ${why}`);
    return "skipped";
  };
  try {
    const subId = invoiceSubscriptionId(invoice);
    const cents = invoice.amount_due ?? 0;
    if (!invoice.id || !subId || cents <= 0) return "skipped";
    const attempt = invoice.attempt_count || 1;
    const mirror = await db.subscription.findFirst({ where: { externalSubId: subId }, select: { organizationId: true, plan: true } });
    if (!mirror) return skip("no subscription on record");
    if (await isQaOrg(mirror.organizationId)) return skip("QA Lab company");

    const owner = await db.membership.findFirst({
      where: { organizationId: mirror.organizationId, role: "OWNER", organization: { deletedAt: null } },
      orderBy: { createdAt: "asc" },
      select: {
        user: { select: { phone: true, smsPhone: true, smsVerifiedAt: true, notificationPrefsJson: true } },
        organization: { select: { timezone: true } },
      },
    });
    if (!owner) return skip("no owner");
    const to = owner.user.smsVerifiedAt && owner.user.smsPhone ? owner.user.smsPhone : owner.user.phone;
    if (!to) return skip("the owner has no phone");
    const prefs = parseNotificationPrefs(owner.user.notificationPrefsJson, "OWNER");
    if (prefs.smsPaused) return skip("the owner's texts are paused");
    const tz = owner.organization.timezone || "America/New_York";
    const decision = smsDecision(prefs, "billing-problems", now, tz);
    if (decision === "skip") return skip("the owner switched billing texts off");

    // The claim: the first try opens the stamp, a later one adds the second text once three days have passed.
    const key = KEY(invoice.id);
    const row = await db.syncState.findUnique({ where: { key }, select: { cursor: true } });
    const stamp = readStamp(row?.cursor);
    if (!stamp) {
      if (attempt > 1) return skip(`try ${attempt} with no first text`);
      try {
        await db.syncState.create({ data: { key, cursor: JSON.stringify({ sent: [now.toISOString()] } satisfies Stamp) } });
      } catch {
        return skip("already texted for this invoice");
      }
    } else {
      if (stamp.sent.length >= MAX_TEXTS) return skip("two texts already sent for this invoice");
      const first = Date.parse(stamp.sent[0] ?? "");
      if (attempt <= 1 || !Number.isFinite(first) || now.getTime() - first < SECOND_AFTER_MS) return skip("the second text waits three days from the first");
      const next: Stamp = { sent: [...stamp.sent, now.toISOString()] };
      // Compare-and-set: a redelivery racing this one finds the cursor changed.
      const won = await db.syncState.updateMany({ where: { key, cursor: row!.cursor }, data: { cursor: JSON.stringify(next) } });
      if (won.count !== 1) return skip("already texted for this try");
    }

    const { getPlanDisplayName } = await import("@/lib/planCatalogServer");
    const planName = await getPlanDisplayName(mirror.plan).catch(() => mirror.plan);
    const why = plainDeclineWords(failed ? failureCode(failed) : null);
    const again = stamp ? " again" : "";
    const body = `JobFlex: payment of ${dollars(cents, invoice.currency ?? "usd")} for ${planName} didn't go through${again} (${why}). Update your card: ${await shortLink("/dashboard/subscription")}`;
    const sendAfter = decision === "hold" ? nextQuietEnd(prefs, now, tz) : null;
    const r = await sendText({ organizationId: null, to, body, kind: KIND, sendAfter });
    const outcome = r.ok ? (r.status === "SKIPPED" ? `SKIPPED (${r.why})` : r.status) : `refused (${r.reason})`;
    console.info(`[billing-text] ${invoice.id} try ${attempt} → …${to.slice(-4)}: ${outcome} — ${body}`);
    return r.ok && r.status === "HELD" ? "held" : r.ok && r.status === "SENT" ? "sent" : "skipped";
  } catch (err) {
    console.warn(`[billing-text] ${invoice.id}: not texted —`, err instanceof Error ? err.message : err);
    return "skipped";
  }
}
