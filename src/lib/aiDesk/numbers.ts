// A COMPANY'S NUMBER, FOR CALLS — server only.
//
// Which company a call is for is the number it dialed. The index is a SyncState row per
// number (`voicenum:<E.164>` → organizationId), written when lib/sms/registration buys
// the number and removed when it releases it. The desk settings sit beside it
// (`aidesk:<orgId>`, lib/aiDesk/shared). No schema change.
import { db } from "@/lib/db";
import { toE164 } from "@/lib/phone";
import { DEFAULT_DESK, parseDeskSettings, type DeskSettings } from "./shared";

const VOICE_KEY = "voicenum:";
const DESK_KEY = "aidesk:";

/** The company a number belongs to, or null for a number nobody registered (JobFlex's own). */
export async function organizationForCall(to: string | null | undefined): Promise<string | null> {
  const e164 = toE164(to ?? "");
  if (!e164) return null;
  const row = await db.syncState.findUnique({ where: { key: `${VOICE_KEY}${e164}` }, select: { cursor: true } }).catch(() => null);
  return row?.cursor || null;
}

export async function indexVoiceNumber(organizationId: string, e164: string): Promise<void> {
  const key = `${VOICE_KEY}${e164}`;
  await db.syncState.upsert({ where: { key }, create: { key, cursor: organizationId }, update: { cursor: organizationId } });
}

export async function forgetVoiceNumber(e164: string | null | undefined): Promise<void> {
  if (!e164) return;
  await db.syncState.delete({ where: { key: `${VOICE_KEY}${e164}` } }).catch(() => null);
}

export async function readDeskSettings(organizationId: string): Promise<DeskSettings> {
  const row = await db.syncState.findUnique({ where: { key: `${DESK_KEY}${organizationId}` }, select: { cursor: true } }).catch(() => null);
  return row ? parseDeskSettings(row.cursor) : { ...DEFAULT_DESK };
}

export async function saveDeskSettings(organizationId: string, settings: DeskSettings): Promise<void> {
  const key = `${DESK_KEY}${organizationId}`;
  const cursor = JSON.stringify(settings);
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
}

/**
 * Point a bought number's calls at the voice webhook. Idempotent — the registration
 * calls it at purchase, and again for a number bought before calls were wired.
 */
export async function attachVoiceToNumber(client: { incomingPhoneNumbers: (sid: string) => { update: (o: { voiceUrl: string; voiceMethod: string }) => Promise<unknown> } }, numberSid: string, base: string): Promise<void> {
  await client.incomingPhoneNumbers(numberSid).update({ voiceUrl: `${base}/api/twilio/voice`, voiceMethod: "POST" });
}
