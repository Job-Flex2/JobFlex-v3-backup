import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isCronAuthorized } from "@/lib/cronAuth";
import { isStripeEnabled } from "@/lib/sdk/stripe";
import { cancelSubscriptionNow } from "@/lib/accountDeletion";
import { releaseNumbersForPurge } from "@/lib/sms/registration";
import { alertNumberLeft } from "@/lib/adminAlerts";
import { SubscriptionStatus } from "@/lib/prismaEnums";

export const runtime = "nodejs";

// Soft-deleted organizations (Settings, Delete my account, the admin's Delete
// account) are hard-deleted 30 days later — one `organization.delete`, every
// relation cascades. A subscription still live in the mirror (UNPAID too:
// Stripe keeps that one open) is cancelled first; when the cancel fails the
// org is NOT purged — the row is logged and the next run tries again, so the
// money side never silently disappears.
//
// The company's own Twilio number is released here, not at the soft delete
// (that one can still be undone). A number Twilio will not let go of does not
// hold the purge back: it is logged, kept in SyncState `twilioLeft:<sid>` and
// sent as the "cleanup" admin alert, because JobFlex pays for it every month.
const GRACE_DAYS = 30;
const LIVE = [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE, SubscriptionStatus.UNPAID];

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const cutoff = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000);
  const due = await db.organization.findMany({
    where: { deletedAt: { not: null, lt: cutoff } },
    select: { id: true, name: true, subscription: { select: { status: true, externalSubId: true } } },
    take: 50,
  });

  let purged = 0;
  let blocked = 0;
  let numbersReleased = 0;
  let numbersLeft = 0;
  for (const org of due) {
    const sub = org.subscription;
    if (sub?.externalSubId && LIVE.includes(sub.status as (typeof LIVE)[number])) {
      try {
        if (!isStripeEnabled()) throw new Error("Stripe is not configured");
        await cancelSubscriptionNow(sub.externalSubId);
      } catch (err) {
        console.error("[cron/purge-deleted-orgs] blocked — stripe cancel failed", org.id, err);
        blocked += 1;
        continue;
      }
    }

    const numbers = await releaseNumbersForPurge(org.id).catch((err) => {
      console.error("[cron/purge-deleted-orgs] number release crashed", org.id, err);
      return null;
    });
    numbersReleased += numbers?.released.length ?? 0;
    for (const left of numbers?.failed ?? []) {
      numbersLeft += 1;
      console.error(`[cron/purge-deleted-orgs] Twilio number NOT released — ${left.number ?? "?"} (${left.numberSid ?? "?"}) of ${org.name} (${org.id}): ${left.error}`);
      const key = `twilioLeft:${left.numberSid ?? left.number ?? org.id}`;
      const cursor = JSON.stringify({ ...left, organizationId: org.id, orgName: org.name, at: new Date().toISOString() });
      await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } }).catch(() => null);
      await alertNumberLeft({ orgName: org.name, number: left.number, numberSid: left.numberSid });
    }

    try {
      await db.organization.delete({ where: { id: org.id } });
      purged += 1;
    } catch (err) {
      console.error("[cron/purge-deleted-orgs] delete failed", org.id, err);
    }
  }
  return NextResponse.json({ due: due.length, purged, blocked, numbersReleased, numbersLeft });
}
