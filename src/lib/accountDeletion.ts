import "server-only";

// DELETING AN ACCOUNT OR A COMPANY — the one set of rules behind every door
// that does it: Settings → Delete my account (actions/accountSettings
// deleteMyAccount), the org's own soft delete (deleteOrganization) and the
// platform admin's Delete account (actions/adminUsers deleteAdminUser).
// A plain module, not "use server": an export here is never an RPC endpoint.
//
//   accountDeletionPlan  — what deleting this user takes with it, per company
//   retireOrganization   — SOFT delete: marked deleted first, then the money
//                          side unwound; the purge cron hard-deletes 30 days on
//   unwindOrganization   — subscription cancelled now, processors disconnected
//   removeUserRow        — the User row, every optional pointer at it nulled
//
// What stays on purpose: the Stripe Customer and its payment history (refunds
// and the books need them) — only the subscription is cancelled.

import type Stripe from "stripe";
import { db } from "@/lib/db";
import { isStripeEnabled, stripeClientForMode } from "@/lib/sdk/stripe";
import { releaseAttachedSchedule } from "@/lib/scheduleRelease";
import { markSubscriptionCanceled } from "@/lib/stripeSync";
import { disconnectSquareFor, disconnectStaxFor, disconnectStripeConnectFor } from "@/lib/payments/connections";
import { ActivityKind, SubscriptionStatus } from "@/lib/prismaEnums";

/* ───────────────────────────── the plan ───────────────────────────── */

export interface OrgFate {
  orgId: string;
  orgName: string;
  /** The user's role there. */
  role: string;
  memberCount: number;
  /** OWNERs other than this user. */
  otherOwners: number;
  /** Already soft-deleted — the user's membership simply goes with them. */
  alreadyDeleted: boolean;
  /**
   * The company goes with the account: nobody else would own it, or nobody
   * else is in it. Otherwise only the membership goes.
   */
  deletesOrg: boolean;
  subscription: {
    plan: string;
    status: string;
    provider: string;
    externalSubId: string | null;
    externalCustomerId: string | null;
  } | null;
  /** Connected payment processors: STRIPE (Connect), SQUARE, STAX. */
  processors: string[];
}

export async function accountDeletionPlan(userId: string): Promise<OrgFate[]> {
  const memberships = await db.membership.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      role: true,
      organization: {
        select: {
          id: true,
          name: true,
          deletedAt: true,
          _count: { select: { memberships: true } },
          subscription: { select: { plan: true, status: true, provider: true, externalSubId: true, externalCustomerId: true } },
          paymentConnections: { select: { provider: true } },
        },
      },
    },
  });
  return Promise.all(
    memberships.map(async ({ role, organization: org }) => {
      const otherOwners = await db.membership.count({
        where: { organizationId: org.id, role: "OWNER", NOT: { userId } },
      });
      const alreadyDeleted = org.deletedAt !== null;
      const memberCount = org._count.memberships;
      return {
        orgId: org.id,
        orgName: org.name,
        role,
        memberCount,
        otherOwners,
        alreadyDeleted,
        deletesOrg: !alreadyDeleted && ((role === "OWNER" && otherOwners === 0) || memberCount === 1),
        subscription: org.subscription,
        processors: org.paymentConnections.map((c) => c.provider),
      };
    }),
  );
}

/* ─────────────────────────── the money side ──────────────────────────── */

const ENDED = new Set<Stripe.Subscription.Status>(["canceled", "incomplete_expired"]);

/**
 * Cancel a subscription NOW, in whichever account holds it: the live account
 * of record first, the sandbox second (a rehearsal's subscription lives
 * there, and the admin's mode switch says nothing about where an old one
 * was made). The mirror row is written from Stripe's answer. A subscription
 * neither account knows can bill nobody — the row is closed here so the purge
 * cron is not held back by it forever.
 */
export async function cancelSubscriptionNow(subId: string): Promise<"canceled" | "already-ended" | "not-found"> {
  const clients = [...new Set([stripeClientForMode("live"), stripeClientForMode("test")])].filter(
    (c): c is Stripe => c !== null,
  );
  for (const stripe of clients) {
    let sub: Stripe.Subscription;
    try {
      sub = await stripe.subscriptions.retrieve(subId);
    } catch (err) {
      if ((err as { code?: string } | null)?.code === "resource_missing") continue;
      throw err;
    }
    if (ENDED.has(sub.status)) {
      await markSubscriptionCanceled(sub);
      return "already-ended";
    }
    await releaseAttachedSchedule(stripe, subId).catch(() => null);
    await markSubscriptionCanceled(await stripe.subscriptions.cancel(subId));
    return "canceled";
  }
  await db.subscription.updateMany({
    where: { externalSubId: subId, status: { notIn: [SubscriptionStatus.CANCELED, SubscriptionStatus.TRIAL_ENDED] } },
    data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date() },
  });
  return "not-found";
}

/**
 * Best-effort, every step on its own: the subscription cancelled at once,
 * Stripe Connect / Square / Stax disconnected, the Gmail tokens dropped. A
 * failed step is logged and named in the returned warnings — it never stops
 * the next one, and it never resurrects anything.
 */
export async function unwindOrganization(orgId: string, externalSubId: string | null, tag: string): Promise<string[]> {
  const warnings: string[] = [];
  if (externalSubId && isStripeEnabled()) {
    try {
      const r = await cancelSubscriptionNow(externalSubId);
      if (r === "not-found") warnings.push("stripe-subscription-not-found");
    } catch (err) {
      console.error(`[${tag}] stripe cancel failed`, orgId, err);
      warnings.push("stripe-subscription");
    }
  }
  const processors: Array<[string, (id: string) => Promise<unknown>]> = [
    ["stripe-connect", disconnectStripeConnectFor],
    ["square", disconnectSquareFor],
    ["stax", disconnectStaxFor],
  ];
  for (const [name, disconnect] of processors) {
    try {
      await disconnect(orgId);
    } catch (err) {
      console.error(`[${tag}] ${name}`, orgId, err);
      warnings.push(name);
    }
  }
  await db.organization.update({ where: { id: orgId }, data: { gmailTokensJson: null } }).catch(() => null);
  return warnings;
}

/**
 * SOFT delete. Order matters: the org is marked deleted FIRST — from that
 * instant requireOrg() and every public surface treat it as gone — then the
 * external side is unwound. The purge cron (30 days) hard-deletes it and
 * refuses to while a subscription is still live. Members keep their rows so
 * an admin restore is possible.
 */
export async function retireOrganization(
  org: { id: string; name: string; externalSubId: string | null },
  actorId: string,
  tag: string,
  summary = `Organization "${org.name}" scheduled for deletion`,
): Promise<string[]> {
  await db.organization.update({ where: { id: org.id }, data: { deletedAt: new Date(), deletedById: actorId } });
  const warnings = await unwindOrganization(org.id, org.externalSubId, tag);
  // Every member's next request falls through to another org (or NoOrg).
  await db.user.updateMany({ where: { activeOrgId: org.id }, data: { activeOrgId: null } });
  await db.activityEvent.create({
    data: { organizationId: org.id, actorId, kind: ActivityKind.UPDATED, summary },
  });
  return warnings;
}

/* ─────────────────────────────── the user ────────────────────────────── */

/**
 * The User row, hard. Every optional pointer at it in whatever survives is
 * nulled so those rows stay; cross-org trade-network rows that REQUIRE the
 * user go with it. Account / Session / Membership / profile rows cascade.
 */
export async function removeUserRow(uid: string): Promise<void> {
  await db.$transaction([
    db.proposal.updateMany({ where: { ownerId: uid }, data: { ownerId: null } }),
    db.lead.updateMany({ where: { assignedToId: uid }, data: { assignedToId: null } }),
    db.lead.updateMany({ where: { claimedById: uid }, data: { claimedById: null } }),
    db.invite.updateMany({ where: { invitedById: uid }, data: { invitedById: null } }),
    db.jobEvent.updateMany({ where: { createdById: uid }, data: { createdById: null } }),
    db.message.updateMany({ where: { authorId: uid }, data: { authorId: null } }),
    db.activityEvent.updateMany({ where: { actorId: uid }, data: { actorId: null } }),
    db.appointment.updateMany({ where: { createdById: uid }, data: { createdById: null } }),
    db.blockedTime.updateMany({ where: { ownerId: uid }, data: { ownerId: null } }),
    db.tradeJobMessage.deleteMany({ where: { authorId: uid } }),
    db.tradeJobConversation.deleteMany({ where: { OR: [{ authorId: uid }, { recipientId: uid }] } }),
    db.tradeJobRecipient.deleteMany({ where: { recipientId: uid } }),
    db.tradeJob.deleteMany({ where: { authorId: uid } }),
    db.tradeReply.deleteMany({ where: { authorId: uid } }),
    db.tradePost.deleteMany({ where: { authorId: uid } }),
    db.user.delete({ where: { id: uid } }),
  ]);
}
