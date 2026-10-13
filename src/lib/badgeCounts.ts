// Badge-count queries for the sidebar / mobile tab bar. Server-only plain
// module — deliberately NOT a "use server" action file: these take raw
// (organizationId, userId, role) and must never be client-invokable, or any
// caller could read another tenant's counts. The layout calls them directly.
import { db } from "@/lib/db";
import { unseenClientReturns } from "@/lib/deck/clientLinksServer";
import { lowStockCounts } from "@/lib/inventoryBoard";

// Nav surfaces whose badge clears on view. `key` is the NavSeen row key; `href`
// is the badge key the sidebar/tab bar reads. Kept together so the two can't drift.
export const SEEN_SURFACES = {
  leads: "/dashboard/leads",
  proposals: "/dashboard/proposals",
  hire: "/dashboard/hire/hub",
  referrals: "/dashboard/referrals",
  reviews: "/dashboard/reviews",
  // 2026-08-21 expansion (owner request): every work surface carries a badge.
  calendar: "/dashboard/calendar",
  jobs: "/dashboard/jobs",
  workers: "/dashboard/workers",
  trade: "/dashboard/trade",
  phone: "/dashboard/phone",
  // Not a nav item: the calendar's crew-confirmation bell. Seen-stamped when
  // the office opens the inbox sheet; counts crew ANSWERS since then.
  crewInbox: "/dashboard/calendar#crew",
} as const;
export type SeenKey = keyof typeof SEEN_SURFACES;

/**
 * Per-conversation unread counts for this viewer: messages from other people
 * newer than their lastReadAt in threads they participate in, plus every such
 * message in legacy no-participant threads they authored in. One groupBy —
 * not a count per thread — since this runs on every dashboard render (and
 * every 5s while the Messages poller is on). Mirrors the visibility rule in
 * src/app/(dashboard)/dashboard/messages/page.tsx, which shares this helper.
 */
export async function getUnreadByConversation(
  organizationId: string,
  userId: string,
): Promise<Map<string, number>> {
  const [participantRows, legacyConvs] = await Promise.all([
    db.conversationParticipant.findMany({
      where: { userId, conversation: { organizationId } },
      select: { conversationId: true, lastReadAt: true },
    }),
    db.conversation.findMany({
      where: {
        organizationId,
        participants: { none: {} },
        messages: { some: { authorId: userId } },
      },
      select: { id: true },
    }),
  ]);

  const legacyConvIds = legacyConvs.map((c) => c.id);
  if (participantRows.length === 0 && legacyConvIds.length === 0) return new Map();

  const grouped = await db.message.groupBy({
    by: ["conversationId"],
    _count: { _all: true },
    where: {
      authorId: { not: userId },
      OR: [
        ...participantRows.map((p) => ({
          conversationId: p.conversationId,
          ...(p.lastReadAt ? { createdAt: { gt: p.lastReadAt } } : {}),
        })),
        ...(legacyConvIds.length ? [{ conversationId: { in: legacyConvIds } }] : []),
      ],
    },
  });

  return new Map(grouped.map((g) => [g.conversationId, g._count._all]));
}

/** Total unread messages across every visible thread — the nav badge number. */
async function getUnreadMessageCount(organizationId: string, userId: string): Promise<number> {
  const byConversation = await getUnreadByConversation(organizationId, userId);
  let total = 0;
  for (const n of byConversation.values()) total += n;
  return total;
}

/**
 * Unread / pending-action counts for the sidebar + mobile tab bar, keyed by
 * nav href. Field workers only get their own surfaces (Jobs, Messages);
 * office roles get the full set. Every seen-gated surface clears through
 * markNavSeen (via <MarkNavSeen /> on the page); Messages clears per-thread
 * through markConversationRead.
 */
export async function getBadgeCounts(
  organizationId: string,
  userId: string,
  role: string | null,
): Promise<Record<string, number>> {
  // "Seen" cutoffs: each of these badges counts only items newer than the last
  // time the user opened that surface, so visiting the page clears the badge
  // until something new arrives. A missing row (never visited) means no cutoff.
  const seenRows = await db.navSeen.findMany({
    where: { userId, organizationId, key: { in: Object.keys(SEEN_SURFACES) } },
    select: { key: true, seenAt: true },
  });
  const seenAt = (key: SeenKey) => seenRows.find((r) => r.key === key)?.seenAt;

  if (role === "INSTALLER") {
    // A field worker's world: their own assignments, their inbox and their
    // calendar. The jobs badge is SEEN-gated on purpose — opening
    // the offers popup clears it even without an accept/decline (owner
    // request 2026-08-21); the offers themselves stay listed until answered.
    const [jobsNew, messagesUnread, calendarNew] = await Promise.all([
      countNewForSurface("jobs", organizationId, seenAt("jobs"), userId),
      getUnreadMessageCount(organizationId, userId),
      countNewForSurface("calendar", organizationId, seenAt("calendar"), userId),
    ]);
    return {
      "/dashboard/jobs": jobsNew,
      "/dashboard/messages": messagesUnread,
      "/dashboard/calendar": calendarNew,
    };
  }

  const [
    messagesUnread,
    leads,
    proposalsUnscheduled,
    hireApplied,
    reviewsUnread,
    referralsPending,
    calendarNew,
    jobsNew,
    workersNew,
    tradeNew,
    phoneMissed,
  ] = await Promise.all([
    getUnreadMessageCount(organizationId, userId),
    countNewForSurface("leads", organizationId, seenAt("leads")),
    countNewForSurface("proposals", organizationId, seenAt("proposals")),
    countNewForSurface("hire", organizationId, seenAt("hire")),
    countNewForSurface("reviews", organizationId, seenAt("reviews")),
    countNewForSurface("referrals", organizationId, seenAt("referrals")),
    countNewForSurface("calendar", organizationId, seenAt("calendar"), userId),
    countNewForSurface("jobs", organizationId, seenAt("jobs"), userId),
    countNewForSurface("workers", organizationId, seenAt("workers")),
    countNewForSurface("trade", organizationId, seenAt("trade"), userId),
    countNewForSurface("phone", organizationId, seenAt("phone")),
  ]);

  const low = await lowStockCounts(organizationId).catch(() => ({ fence: 0, roof: 0, hvac: 0 }));
  // Deck designs clients sent back that nobody has opened (2026-10-13, lib/deck/clientLinksServer): one index
  // read, nothing more for a shop with no links. Cosmetic like every badge.
  const deckReturns = await unseenClientReturns(organizationId).then((l) => l.length).catch(() => 0);
  return {
    "/dashboard/deck-estimator": deckReturns,
    "/dashboard/messages": messagesUnread,
    "/dashboard/leads": leads,
    "/dashboard/proposals": proposalsUnscheduled,
    "/dashboard/hire/hub": hireApplied,
    // The blueprint nav's Hire item points at /dashboard/hire (the hub is a
    // child route) — publish the same count under both keys so either shell
    // finds it.
    "/dashboard/hire": hireApplied,
    "/dashboard/reviews": reviewsUnread,
    "/dashboard/referrals": referralsPending,
    "/dashboard/calendar": calendarNew,
    "/dashboard/jobs": jobsNew,
    "/dashboard/workers": workersNew,
    "/dashboard/trade": tradeNew,
    "/dashboard/phone": phoneMissed,
    // Warehouse stock low for the next job (2026-09-20), each trade on its own
    // inventory row under its estimator since 2026-10-10. Cosmetic like every
    // badge: a failure here is a zero, never an error.
    "/dashboard/roof-estimator/inventory": low.roof,
    "/dashboard/fence-estimator/inventory": low.fence,
    "/dashboard/hvac-estimator/inventory": low.hvac,
  };
}

/**
 * Badge count for ONE seen-gated surface: items newer than `since` (no cutoff
 * when undefined). Shared by getBadgeCounts above and by markNavSeen, which
 * uses it to decide whether the visit actually cleared anything — so the page
 * only pays for a router.refresh() when a badge was really showing.
 */
export async function countNewForSurface(
  key: SeenKey,
  organizationId: string,
  since: Date | undefined,
  // Needed by the person-scoped surfaces (calendar / jobs / trade); the
  // org-scoped ones ignore it.
  userId?: string,
): Promise<number> {
  const after = since ? { gt: since } : undefined;
  switch (key) {
    case "calendar": {
      // "You were put on the calendar": job + appointment assignments naming
      // this person, newer than their last look at the calendar.
      if (!userId) return 0;
      const wp = await db.workerProfile.findUnique({ where: { userId }, select: { id: true } });
      if (!wp) return 0;
      const [jobs, appts] = await Promise.all([
        db.jobAssignment.count({ where: { workerId: wp.id, assignedAt: after } }),
        db.appointmentAssignment.count({ where: { workerId: wp.id, createdAt: after } }),
      ]);
      return jobs + appts;
    }
    case "jobs": {
      // A crew member counts THEIR unanswered offers; office roles count the
      // org's unanswered offers (crew that hasn't responded yet).
      if (userId) {
        const wp = await db.workerProfile.findUnique({ where: { userId }, select: { id: true } });
        if (wp) {
          return db.jobAssignment.count({
            where: { workerId: wp.id, status: "PENDING", assignedAt: after },
          });
        }
      }
      return db.jobAssignment.count({
        where: { status: "PENDING", assignedAt: after, job: { organizationId } },
      });
    }
    case "workers": {
      // Roster movement: crew invites answered (accept events carry no
      // proposal link — that's what separates them from proposal accepts).
      return db.activityEvent.count({
        where: { organizationId, kind: "ACCEPTED", proposalId: null, createdAt: after },
      });
    }
    case "trade": {
      // Both directions of the trade board: work sent TO you still marked
      // NEW, and interest that landed ON your posted jobs.
      if (!userId) return 0;
      const [inbound, responses] = await Promise.all([
        db.tradeJobRecipient.count({
          where: { recipientId: userId, status: "NEW", createdAt: after },
        }),
        db.tradeJobRecipient.count({
          where: {
            status: "INTERESTED",
            interestedAt: after,
            tradeJob: { authorId: userId },
          },
        }),
      ]);
      return inbound + responses;
    }
    case "crewInbox": {
      // Crew answers the office hasn't looked at: accept/decline events
      // written by lib/assignmentResponse (its meta names the assignment).
      return db.activityEvent.count({
        where: {
          organizationId,
          kind: { in: ["ACCEPTED", "DECLINED"] },
          meta: { contains: '"assignmentId"' },
          createdAt: after,
        },
      });
    }
    case "phone": {
      // Missed calls: inbound legs that never completed.
      return db.aiPhoneCall.count({
        where: { organizationId, direction: "INBOUND", status: "FAILED", startedAt: after },
      });
    }
    case "leads": {
      // Un-triaged leads (NEW plus lead-center ROUTED) + live Lead Center
      // offers awaiting an accept/decline — the two feeds share one badge.
      const [leadRows, offers] = await Promise.all([
        db.lead.count({
          where: { organizationId, status: { in: ["NEW", "ROUTED"] }, createdAt: after },
        }),
        db.leadOffer.count({
          where: { organizationId, status: "OFFERED", expiresAt: { gt: new Date() }, createdAt: after },
        }),
      ]);
      return leadRows + offers;
    }
    case "proposals":
      return db.proposal.count({
        where: { organizationId, status: "ACCEPTED", jobs: { none: {} }, acceptedAt: after },
      });
    case "hire":
      // Hire & Work (rebuilt 2026-09-03): hands raised on this company's open
      // posts since the page was last opened. The applicant pipeline the badge
      // used to count no longer renders on /dashboard/hire.
      return db.tradeJobRecipient.count({
        where: {
          status: "INTERESTED",
          interestedAt: after,
          tradeJob: { authorOrgId: organizationId, status: "OPEN" },
        },
      });
    case "reviews":
      return db.reviewRequest.count({
        where: { organizationId, status: "COMPLETED", completedAt: after },
      });
    case "referrals":
      return db.referralConversion.count({
        where: { status: "PENDING", code: { organizationId }, createdAt: after },
      });
  }
}
