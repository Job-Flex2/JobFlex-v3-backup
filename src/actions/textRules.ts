"use server";

// Your own texts (2026-09-29) — save, switch, delete and test a company's own
// text rules. The catalog and the renderer are lib/sms/textRules; the sends
// are lib/sms/rulesEngine. Managers and the owner only.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireManager } from "@/lib/orgContext";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { PLAN_ENDED_TEXT_MESSAGE, sendText, TRIAL_TEXT_MESSAGE } from "@/lib/sms/send";
import { MAX_RULES, RULE_BODY_MAX, SAMPLE_VARS, renderRuleText, signed, triggerOf, unknownFields, withStopLine } from "@/lib/sms/textRules";

export type TextRuleResult = { ok: true; note?: string; id?: string } | { ok: false; error: string };

const SETTINGS_PATH = "/dashboard/settings";

const ruleInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().max(80).optional(),
  trigger: z.string(),
  offset: z.number().int().nullable().optional(),
  toClient: z.boolean(),
  toOffice: z.boolean(),
  toRep: z.boolean(),
  toCrew: z.boolean(),
  toUserIds: z.array(z.string()).max(40).default([]),
  body: z.string().trim().min(1, "Write the text.").max(RULE_BODY_MAX, `Keep it under ${RULE_BODY_MAX} characters.`),
  active: z.boolean().default(true),
});
export type TextRuleInput = z.input<typeof ruleInput>;

function check(raw: TextRuleInput): { ok: true; data: z.infer<typeof ruleInput> } | { ok: false; error: string } {
  const parsed = ruleInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const d = parsed.data;
  const t = triggerOf(d.trigger);
  if (!t) return { ok: false, error: "Pick when the text goes out." };
  if (t.timed) {
    const n = d.offset ?? t.timed.default;
    if (n < t.timed.min || n > t.timed.max) return { ok: false, error: `Between ${t.timed.min} and ${t.timed.max} ${t.timed.unit}.` };
    d.offset = n;
  } else d.offset = null;
  // Only the people this moment can reach.
  if (d.toClient && !t.recipients.includes("client")) d.toClient = false;
  if (d.toCrew && !t.recipients.includes("crew")) d.toCrew = false;
  if (d.toRep && !t.recipients.includes("rep")) d.toRep = false;
  if (!d.toClient && !d.toOffice && !d.toRep && !d.toCrew && d.toUserIds.length === 0) return { ok: false, error: "Pick who gets it." };
  const unknown = unknownFields(d.body, d.trigger);
  if (unknown.length) return { ok: false, error: `This moment can't fill ${unknown.map((f) => `{${f}}`).join(", ")} — pick another field or take it out.` };
  return { ok: true, data: d };
}

export async function saveTextRule(raw: TextRuleInput): Promise<TextRuleResult> {
  const { organizationId, user } = await requireManager();
  const c = check(raw);
  if (!c.ok) return c;
  const d = c.data;
  const members = d.toUserIds.length ? await db.membership.findMany({ where: { organizationId, userId: { in: d.toUserIds } }, select: { userId: true } }) : [];
  const data = {
    name: d.name?.trim() || triggerOf(d.trigger)!.label,
    trigger: d.trigger,
    offset: d.offset ?? null,
    toClient: d.toClient,
    toOffice: d.toOffice,
    toRep: d.toRep,
    toCrew: d.toCrew,
    toUserIdsJson: JSON.stringify(members.map((m) => m.userId)),
    body: d.body,
    active: d.active,
  };
  let id = d.id;
  if (id) {
    const row = await db.textRule.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!row) return { ok: false, error: "That text is gone — refresh the page." };
    await db.textRule.update({ where: { id }, data });
  } else {
    if ((await db.textRule.count({ where: { organizationId } })) >= MAX_RULES) return { ok: false, error: `Up to ${MAX_RULES} of your own texts.` };
    id = (await db.textRule.create({ data: { ...data, organizationId, createdById: user.id } })).id;
  }
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: `${d.id ? "Changed" : "Added"} the text "${data.name}"`, meta: { textRuleId: id } });
  revalidatePath(SETTINGS_PATH);
  return { ok: true, id, note: d.id ? "Saved." : "Saved — it goes out from now on." };
}

export async function setTextRuleActive(id: string, active: boolean): Promise<TextRuleResult> {
  const { organizationId } = await requireManager();
  const r = await db.textRule.updateMany({ where: { id, organizationId }, data: { active } });
  if (!r.count) return { ok: false, error: "That text is gone — refresh the page." };
  revalidatePath(SETTINGS_PATH);
  return { ok: true, note: active ? "On." : "Paused — nothing goes out until you switch it back on." };
}

export async function deleteTextRule(id: string): Promise<TextRuleResult> {
  const { organizationId, user } = await requireManager();
  const row = await db.textRule.findFirst({ where: { id, organizationId }, select: { name: true } });
  if (!row) return { ok: false, error: "Already gone." };
  await db.textRule.delete({ where: { id } });
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: `Deleted the text "${row.name}"`, meta: {} });
  revalidatePath(SETTINGS_PATH);
  return { ok: true, note: "Deleted." };
}

/** The text with sample facts, to the manager's own verified mobile — as a
 *  client would read it when the client is on the list. */
export async function testTextRule(raw: TextRuleInput): Promise<TextRuleResult> {
  const { organizationId, user } = await requireManager();
  const c = check(raw);
  if (!c.ok) return c;
  const me = await db.user.findUnique({ where: { id: user.id }, select: { smsPhone: true, smsVerifiedAt: true } });
  if (!me?.smsPhone || !me.smsVerifiedAt) return { ok: false, error: "Add your own mobile first (Your mobile, below) — the test goes there." };
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  const vars = { ...SAMPLE_VARS, company: org?.name ?? SAMPLE_VARS.company };
  const words = signed(org?.name, renderRuleText(c.data.body, vars));
  const body = c.data.toClient ? withStopLine(words) : words;
  const r = await sendText({ organizationId, to: me.smsPhone, body: `(test) ${body}`, kind: "rule-test" });
  if (r.ok && r.status === "SKIPPED") return { ok: true, note: "Texting is not set up on this server — nothing was sent." };
  if (!r.ok) return { ok: false, error: r.reason === "duplicate" ? "Same test went out a minute ago." : r.reason === "trial" ? TRIAL_TEXT_MESSAGE : r.reason === "plan-ended" ? PLAN_ENDED_TEXT_MESSAGE : "Couldn't send the test." };
  return { ok: true, note: "Test sent to your mobile." };
}
