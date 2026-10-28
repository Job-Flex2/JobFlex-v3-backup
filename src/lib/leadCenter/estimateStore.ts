// THE ESTIMATE BESIDE A LEAD — the store (server only). One SyncState row per PlatformLead
// (`leadestimate:<leadId>`, lib/leadCenter/estimate for what is in it).
import { db } from "@/lib/db";
import { LEAD_ESTIMATE_KEY, type LeadEstimate } from "./estimate";

export async function writeLeadEstimate(leadId: string, e: LeadEstimate): Promise<void> {
  const key = LEAD_ESTIMATE_KEY(leadId);
  const cursor = JSON.stringify(e);
  await db.syncState.upsert({ where: { key }, update: { cursor }, create: { key, cursor } });
}

/** The estimates for these leads, by lead id — one query. */
export async function readLeadEstimates(leadIds: string[]): Promise<Map<string, LeadEstimate>> {
  const out = new Map<string, LeadEstimate>();
  if (!leadIds.length) return out;
  try {
    const rows = await db.syncState.findMany({ where: { key: { in: leadIds.map(LEAD_ESTIMATE_KEY) } } });
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.cursor) as LeadEstimate;
        if (parsed && parsed.v === 1) out.set(row.key.slice("leadestimate:".length), parsed);
      } catch {
        /* a bad row is no estimate */
      }
    }
  } catch (err) {
    console.warn("[leadCenter] estimates not read:", err);
  }
  return out;
}
