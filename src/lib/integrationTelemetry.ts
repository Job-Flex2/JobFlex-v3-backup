// Passive observations only. No request payload, URL, account, token or error text.
import { db } from "@/lib/db";
const SERVICES = new Set(["openai", "maps", "solar", "reportall", "regrid", "eagleview", "census", "fcc", "nominatim", "assessor", "naip", "usa-structures"]);
export async function recordIntegrationOutcome(service: string, status: number, quotaExhausted = false): Promise<void> {
  if (!SERVICES.has(service) || !Number.isInteger(status) || status < 0 || status > 599) return;
  const now = new Date().toISOString();
  const persist = async () => {
    const key = `integrations:observed:${service}`;
    const initial = JSON.stringify({ status, quotaExhausted, observedAt: now, lastSuccessAt: status >= 200 && status < 300 ? now : undefined });
    // Initialize without replacing another request's observation.
    let row = await db.syncState.upsert({ where: { key }, create: { key, cursor: initial }, update: {} });
    for (let attempt = 0; attempt < 3; attempt++) {
      const previous = JSON.parse(row.cursor) as { observedAt?: string; lastSuccessAt?: string };
      // A slower writer must not replace a later response with an older one.
      if (previous.observedAt && previous.observedAt > now) return;
      const cursor = JSON.stringify({ status, quotaExhausted, observedAt: now, lastSuccessAt: status >= 200 && status < 300 ? now : previous.lastSuccessAt });
      const result = await db.syncState.updateMany({ where: { key, cursor: row.cursor }, data: { cursor } });
      if (result.count) return;
      const latest = await db.syncState.findUnique({ where: { key } });
      if (!latest) return;
      row = latest;
    }
  };
  // Bound latency added to the customer's request. The small storage write may
  // finish later; its CAS still prevents an older result overwriting a newer one.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([persist().catch(() => {}), new Promise<void>(resolve => { timer = setTimeout(resolve, 250); })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function recordOpenAIOutcome(status: number, quotaExhausted = false): Promise<void> {
  return recordIntegrationOutcome("openai", status, quotaExhausted);
}
