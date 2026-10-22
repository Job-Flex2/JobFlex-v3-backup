// Starter follow-up rules — what every company has from day one.
//
// A new organisation used to have no rules at all, so the engine
// (lib/followUps/engine) sat idle until somebody found the page and wrote
// some. These are written into each company's own FollowUpRule rows by
// ensureDefaultFollowUpRules (below); from then on they are ordinary rules the
// owner can rename, retime, switch channel or turn off.
//
// Server-only (it writes through `db`). Called where a company is created
// (actions/signupCheckout createAccountFromPending, actions/auth
// registerAccount), on every visit to /dashboard/crm, and by
// scripts/backfill-follow-up-defaults.ts.
//
// `key` is the row's `defaultKey`, unique per organisation, so a starter rule
// is written once. Never rename a key: a renamed key reads as a new rule and
// lands a second copy on every company that already has the old one.

import { db } from "@/lib/db";
import { encodeChannel, type FollowUpChannel } from "@/lib/followUps/copy";
import { ProposalStatus } from "@/lib/prismaEnums";

export interface DefaultFollowUpRule {
  key: string;
  name: string;
  triggerStatus: ProposalStatus;
  delayMinutes: number;
  /** TEXT falls back to email in the engine when texting can't go (no
   *  number, no phone on the client, a card-less trial). */
  channel: FollowUpChannel;
}

const DAY = 24 * 60;

export const DEFAULT_RULES: readonly DefaultFollowUpRule[] = [
  { key: "sent-day-2", name: "Sent · day 2", triggerStatus: ProposalStatus.SENT, delayMinutes: 2 * DAY, channel: "EMAIL" },
  { key: "sent-day-5", name: "Sent · day 5", triggerStatus: ProposalStatus.SENT, delayMinutes: 5 * DAY, channel: "TEXT" },
  { key: "sent-day-10", name: "Sent · day 10", triggerStatus: ProposalStatus.SENT, delayMinutes: 10 * DAY, channel: "EMAIL" },
  { key: "viewed-day-3", name: "Viewed · day 3", triggerStatus: ProposalStatus.VIEWED, delayMinutes: 3 * DAY, channel: "EMAIL" },
];

/**
 * Write the starter rules this company does not have yet. On (`enabled`) by
 * default — a new company's follow-ups work from the first proposal sent; the
 * backfill of companies that existed before the starter set writes them OFF
 * (owner, 2026-10-22: `enabled: false`), for the owner to switch on. Idempotent: a rule
 * is looked up by its `defaultKey`, so one that exists — edited, turned off
 * (which is what deleting a starter rule does) — is never touched or brought
 * back; only a key with no row at all is written.
 *
 * A company that wrote its own rules before the starter set existed keeps
 * exactly those: two "sent, 2 days" rules would mail the client twice. Only
 * "Turn on defaults" (actions/followUps) passes `evenWithOwnRules`.
 */
export async function ensureDefaultFollowUpRules(
  organizationId: string,
  opts: { evenWithOwnRules?: boolean; enabled?: boolean } = {},
): Promise<{ created: number }> {
  const rows = await db.followUpRule.findMany({ where: { organizationId }, select: { defaultKey: true } });
  const have = new Set(rows.map((r) => r.defaultKey).filter((k): k is string => Boolean(k)));
  if (!opts.evenWithOwnRules && have.size === 0 && rows.length > 0) return { created: 0 };

  let created = 0;
  for (const d of DEFAULT_RULES) {
    if (have.has(d.key)) continue;
    try {
      await db.followUpRule.create({
        data: {
          organizationId,
          name: d.name,
          triggerStatus: d.triggerStatus,
          delayMinutes: d.delayMinutes,
          enabled: opts.enabled ?? true,
          template: encodeChannel(d.channel),
          isDefault: true,
          defaultKey: d.key,
        },
      });
      created++;
    } catch (e) {
      // Two first visits at once: the other one wrote it — (organizationId, defaultKey) is unique.
      if ((e as { code?: string })?.code !== "P2002") throw e;
    }
  }
  return { created };
}
