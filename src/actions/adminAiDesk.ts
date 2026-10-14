"use server";
// THE AI DESK, from the platform admin's side (2026-10-13): the go-live checklist on
// /admin/health has one button — point a company's number at the voice webhook when it
// still points elsewhere (a number bought before the desk, or edited by hand on Twilio).
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { twilioClient } from "@/lib/sdk/twilio";
import { toE164 } from "@/lib/phone";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { attachVoiceToNumber, forgetVoiceNumber, indexVoiceNumber } from "@/lib/aiDesk/numbers";
import { voiceWebhookBase } from "@/lib/aiDesk/readiness";

/**
 * The platform's own line answers for a chosen company — the same index a bought number
 * uses (lib/aiDesk/numbers), so a call to it is routed like any company number instead of
 * falling back to the oldest company. Empty `organizationId` takes the assignment away.
 */
export async function assignPlatformLine(number: string, organizationId: string): Promise<{ ok: true; company: string | null } | { ok: false; error: string }> {
  const admin = await requirePlatformAdmin();
  const e164 = toE164(number);
  if (!e164) return { ok: false, error: "That is not a phone number." };
  if (!organizationId) {
    await forgetVoiceNumber(e164);
    revalidatePath("/admin/health");
    return { ok: true, company: null };
  }
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true } });
  if (!org) return { ok: false, error: "No such company." };
  await indexVoiceNumber(org.id, e164);
  await logActivity({ organizationId: org.id, actorId: admin.id, kind: TRAIL_KINDS.SETTINGS, summary: `JobFlex's own line ${e164} now answers for this company` }).catch(() => null);
  revalidatePath("/admin/health");
  return { ok: true, company: org.name || org.id };
}

export async function pointVoiceWebhook(numberSid: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requirePlatformAdmin();
  if (!/^PN[a-f0-9]{32}$/i.test(numberSid)) return { ok: false, error: "That is not a Twilio number id." };
  try {
    const client = await twilioClient();
    const base = await voiceWebhookBase();
    await attachVoiceToNumber(client, numberSid, base);
    revalidatePath("/admin/health");
    return { ok: true, url: `${base}/api/twilio/voice` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Twilio did not take the change." };
  }
}
