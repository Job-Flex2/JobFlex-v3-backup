"use server";
// THE AI DESK, from the platform admin's side (2026-10-13): the go-live checklist on
// /admin/health has one button — point a company's number at the voice webhook when it
// still points elsewhere (a number bought before the desk, or edited by hand on Twilio).
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { twilioClient } from "@/lib/sdk/twilio";
import { attachVoiceToNumber } from "@/lib/aiDesk/numbers";
import { voiceWebhookBase } from "@/lib/aiDesk/readiness";

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
