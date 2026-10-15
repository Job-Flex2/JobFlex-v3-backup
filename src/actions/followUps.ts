"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager, requireSalesOrManager } from "@/lib/orgContext";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { db } from "@/lib/db";
import { dispatchOne } from "@/lib/followUps/engine";
import { isTwilioEnabled } from "@/lib/sdk/twilio";
import { encodeChannel, MAX_DELAY_MINUTES, TEXT_NEEDS_TWILIO } from "@/lib/followUps/copy";
import { ProposalStatus } from "@/lib/prismaEnums";
import { refusal, refused, type ActionResult } from "@/lib/actionResult";

// A rule fires when a proposal's status becomes `triggerStatus`
// (lib/followUps/engine scheduleFollowUpsFor), so the proposal statuses are the
// only values that can ever match. The editors offer a subset.
const TRIGGER_STATUSES = Object.values(ProposalStatus) as [ProposalStatus, ...ProposalStatus[]];

// Messages are the half after the label — `refusal` adds "Delay: " and the rest.
const ruleInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "required.").max(120, "120 characters at most."),
  triggerStatus: z.enum(TRIGGER_STATUSES, { errorMap: () => ({ message: "pick one from the list." }) }),
  delayMinutes: z
    .number({ invalid_type_error: "enter a number." })
    .int("use whole minutes.")
    .min(1, "at least 1 minute.")
    .max(MAX_DELAY_MINUTES, "365 days at most."),
  enabled: z.boolean().default(true),
  /** EMAIL or TEXT. Stored in the `template` column — see
   *  src/lib/followUps/copy.ts for why that column carries the channel now. */
  channel: z.enum(["EMAIL", "TEXT"]).default("EMAIL"),
});

const RULE_LABELS = { name: "Rule name", triggerStatus: "Trigger", delayMinutes: "Delay", channel: "Send by" };

/** Every refusal is a value the editor prints (lib/actionResult) — a thrown
 *  one reached the page as a 500 with Prisma's own text in it. */
export async function upsertFollowUpRule(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const { organizationId, user } = await requireManager();
  const parsed = ruleInput.safeParse(raw);
  if (!parsed.success) return refusal(parsed.error, RULE_LABELS);
  const data = parsed.data;

  // A rule can only promise what this deployment can actually deliver. Offering
  // TEXT in the editor is gated on the same flag, but the server is the one that
  // has to refuse — otherwise a rule quietly stops sending the day the number
  // is removed.
  if (data.channel === "TEXT" && !await isTwilioEnabled()) {
    return refused(TEXT_NEEDS_TWILIO, "channel");
  }
  const channel = encodeChannel(data.channel);

  if (data.id) {
    const existing = await db.followUpRule.findUnique({ where: { id: data.id } });
    if (!existing || existing.organizationId !== organizationId) return refused("This rule is gone — it was deleted. Reload the page.");
    const updated = await db.followUpRule.update({
      where: { id: data.id },
      data: {
        name: data.name,
        triggerStatus: data.triggerStatus,
        delayMinutes: data.delayMinutes,
        enabled: data.enabled,
        template: channel,
      },
    });
    revalidatePath("/dashboard/follow-ups");
    revalidatePath("/dashboard/crm");
    await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: `Updated follow-up rule settings — edited "${data.name}"`, meta: { area: "follow-up rules", ruleId: updated.id, channel: data.channel, enabled: data.enabled } });
    return { ok: true, id: updated.id };
  }

  const created = await db.followUpRule.create({
    data: {
      organizationId,
      name: data.name,
      triggerStatus: data.triggerStatus,
      delayMinutes: data.delayMinutes,
      enabled: data.enabled,
      template: channel,
    },
  });
  revalidatePath("/dashboard/follow-ups");
  revalidatePath("/dashboard/crm");
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: `Updated follow-up rule settings — added "${data.name}"`, meta: { area: "follow-up rules", ruleId: created.id, channel: data.channel, enabled: data.enabled } });
  return { ok: true, id: created.id };
}

export async function setFollowUpRuleEnabled(id: string, enabled: boolean) {
  const { organizationId, user } = await requireManager();
  const rule = await db.followUpRule.findUnique({ where: { id } });
  if (!rule || rule.organizationId !== organizationId) throw new Error("Not found");
  await db.followUpRule.update({ where: { id }, data: { enabled } });
  revalidatePath("/dashboard/follow-ups");
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: `Updated follow-up rule settings — turned "${rule.name}" ${enabled ? "on" : "off"}`, meta: { area: "follow-up rules", ruleId: id, enabled } });
}

export async function deleteFollowUpRule(id: string) {
  const { organizationId, user } = await requireManager();
  const rule = await db.followUpRule.findUnique({ where: { id } });
  if (!rule || rule.organizationId !== organizationId) throw new Error("Not found");
  await db.followUpRule.delete({ where: { id } });
  revalidatePath("/dashboard/follow-ups");
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: `Updated follow-up rule settings — deleted "${rule.name}"`, meta: { area: "follow-up rules", ruleId: id, deleted: true } });
}

export async function runFollowUpNow(id: string) {
  // Working the CRM queue is a sales activity; rule CRUD above stays manager-only.
  const { organizationId } = await requireSalesOrManager();
  const fu = await db.followUp.findUnique({ where: { id } });
  if (!fu || fu.organizationId !== organizationId) throw new Error("Not found");
  await dispatchOne(fu.id);
  revalidatePath("/dashboard/follow-ups");
  revalidatePath("/dashboard/crm/queue");
}

export async function markFollowUpDone(id: string) {
  const { organizationId, user } = await requireSalesOrManager();
  const fu = await db.followUp.findUnique({ where: { id } });
  if (!fu || fu.organizationId !== organizationId) throw new Error("Not found");
  if (fu.completedAt) return;
  await db.followUp.update({ where: { id }, data: { completedAt: new Date() } });
  revalidatePath("/dashboard/follow-ups");
  revalidatePath("/dashboard/crm/queue");
  const proposal = fu.proposalId
    ? await db.proposal.findUnique({ where: { id: fu.proposalId }, select: { title: true, clientId: true } })
    : null;
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.FOLLOW_UP,
    summary: proposal ? `Marked the follow-up on ${proposal.title} done` : "Marked a follow-up done",
    clientId: proposal?.clientId ?? null,
    proposalId: fu.proposalId ?? null,
    meta: { followUpId: id },
  });
}

