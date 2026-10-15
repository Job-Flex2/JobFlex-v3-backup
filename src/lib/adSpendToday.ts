// Spent on ads today, for the traffic page (2026-10-15) — server only. The rule is
// lib/adSpendTodayShared; this reads what it needs and keeps Meta fresh.
//
// Meta's figure is read by lib/metaAdSpend (also the investors page and a daily
// cron). The traffic page polls every 15–60 seconds, so the read here is ASKED
// FOR after the response and only when the last one is 15 minutes old: the poll
// never waits on Meta, and Meta is asked at most four times an hour. One read at
// a time per server instance.

import { afterResponse } from "@/lib/server-events";
import { metaAdsConfigured, readAdSpend, readInvestorSettings, readMetaStatus } from "@/lib/investors";
import { metaPullIfStale } from "@/lib/metaAdSpend";
import { TRAFFIC_TZ } from "@/lib/traffic-visitor";
import { spendTodayFrom, type AdSpendToday } from "@/lib/adSpendTodayShared";

const FRESH_MINUTES = 15;
/** A failed read is retried by metaPullIfStale on every call; the page polls every 15 s, so this instance waits between tries. */
const RETRY_MS = 5 * 60_000;
let reading: Promise<unknown> | null = null;
let triedAt = 0;

const dayIn = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TRAFFIC_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export async function adSpendToday(): Promise<AdSpendToday> {
  const metaConnected = metaAdsConfigured();
  if (metaConnected && !reading && Date.now() - triedAt > RETRY_MS) {
    afterResponse(async () => {
      if (reading || Date.now() - triedAt <= RETRY_MS) return;
      reading = metaPullIfStale(FRESH_MINUTES).then((r) => { if (r) triedAt = Date.now(); }).finally(() => { reading = null; });
      await reading;
    });
  }
  const [entries, status, settings] = await Promise.all([readAdSpend(), readMetaStatus(), readInvestorSettings()]);
  const pulled = status.lastPulledAt ? new Date(status.lastPulledAt) : null;
  return spendTodayFrom({
    entries,
    today: dayIn(new Date()),
    metaConnected,
    lastPulledAt: status.lastPulledAt,
    lastPulledDay: pulled && Number.isFinite(pulled.getTime()) ? dayIn(pulled) : null,
    lastError: status.lastError,
    dailyBudgetCents: settings.dailyBudgetCents,
    budgetFrom: settings.budgetFrom,
  });
}
