// Server-side only. No generation, searches, reports, messages or payment probes.
// Sources and limits: docs/api-health-monitoring.md.
import { db } from "@/lib/db";
import { readOverpassDay } from "@/lib/overpassStore";
import { getIntegrationStatuses } from "@/lib/sdk/integrations";
import { evidence, freshReport, isFresh, HEALTH_INTERVAL_MS, type HealthReport, type ServiceHealth } from "@/lib/integrationHealthModel";
export type { HealthLevel, HealthReport, ServiceHealth } from "@/lib/integrationHealthModel";
export const HEALTH_KEY = "integrations:health";
const LEASE_KEY = "integrations:health-lease:v2";
const ALERT_KEY = "integrations:health-alerted";
export const REGRID_STATUS_KEY = "regrid:last-status";
export const EMAIL_SENT_KEY = "email:last-sent";
export const SMS_SENT_KEY = "sms:last-sent";
const iso = (d: Date | null | undefined) => d?.toISOString();
async function readState(key: string) { return db.syncState.findUnique({ where: { key } }); }

export async function readIntegrationsHealth(): Promise<HealthReport | null> {
  try {
    const row = await readState(HEALTH_KEY);
    if (!row) return null;
    const report = JSON.parse(row.cursor) as HealthReport;
    // Legacy reports contain misleading green credentials/stale checks. Never reuse them.
    if (report.version !== 2 || !Array.isArray(report.services) || !Number.isFinite(Date.parse(report.ranAt))) return null;
    return freshReport(report);
  } catch { return null; }
}

async function jsonGet(url: string) {
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(6000) });
  return { status: response.status, body: response.ok ? await response.json() : null };
}

async function checkService(item: Awaited<ReturnType<typeof getIntegrationStatuses>>[number], now: string): Promise<ServiceHealth> {
  const service: ServiceHealth = {
    key: item.key, name: item.name, checkedAt: now, level: item.enabled ? "unknown" : "off",
    reason: item.enabled ? "End-to-end availability is not verified" : "Not configured in this deployment",
    authentication: evidence("unsupported", "No verified free authentication probe", "Configuration only"),
    quota: evidence("unsupported", "No verified free quota / trial endpoint; use provider billing", "No safe probe"),
    provider: evidence("unsupported", "No verified public status API configured", "No safe probe"),
    feature: evidence("unknown", "No recent end-to-end observation; monitoring does not perform customer actions", "No synthetic transactions"),
  };
  if (!item.enabled) return service;
  try {
    if (item.key === "overpass") {
      const day = await readOverpassDay();
      service.feature = evidence("unknown", `${day.ok} successful and ${day.failed} failed lookups in the rolling 24-hour window; aggregate history does not prove current availability`, "Existing Overpass telemetry", iso(day.lastAt));
    }
    if (item.key === "serpapi") {
      const { status, body } = await jsonGet(`https://serpapi.com/account.json?api_key=${encodeURIComponent(process.env.SERPAPI_API_KEY!)}`);
      const source = "SerpAPI free Account API";
      service.probeFailed = status !== 200;
      service.authentication = evidence(status === 200 ? "ok" : status === 401 || status === 403 ? "error" : "unknown", `Account endpoint HTTP ${status}`, source, now);
      const left = body?.total_searches_left ?? body?.plan_searches_left;
      service.quota = typeof left === "number" && Number.isFinite(left) && left >= 0
        ? evidence(left === 0 ? "error" : left < 100 ? "limited" : "ok", `${left} searches remaining`, source, now)
        : evidence(status === 429 ? "limited" : "unknown", status === 429 ? "Account endpoint rate limited; balance unknown" : "Balance unavailable", source, now);
      // Allowlist states; never send provider bodies, account email, keys or arbitrary error text.
      if (left !== 0 && body?.account_status && body.account_status !== "Active") service.quota = evidence("unknown", "Account is not reported Active; check provider billing / trial access", source, now);
    }
    const publicStatus = item.key === "twilio" ? "https://status.twilio.com/api/v2/status.json"
      : item.key === "blob" ? "https://www.vercel-status.com/api/v2/status.json" : null;
    if (publicStatus) {
      const { status, body } = await jsonGet(publicStatus);
      const indicator = body?.status?.indicator;
      service.probeFailed = status !== 200 || !["none", "minor", "major", "critical"].includes(indicator);
      service.provider = evidence(status === 200 && indicator === "none" ? "ok"
        : status === 200 && ["minor", "major", "critical"].includes(indicator) ? "limited" : "unknown",
        status === 200 && indicator === "none" ? "Provider reports no incident (provider-wide; not account or feature health)"
          : status === 200 && ["minor", "major", "critical"].includes(indicator) ? "Provider reports an incident; JobFlex impact is unverified" : "Public status could not be read",
        publicStatus, now);
    }
    if (item.key === "reportall" || item.key === "regrid" || item.key === "twilio") {
      const key = item.key === "reportall" ? "reportall:quota-remaining" : item.key === "regrid" ? REGRID_STATUS_KEY : SMS_SENT_KEY;
      const row = await readState(key);
      if (row) {
        const at = iso(row.updatedAt)!;
        const number = row.cursor.trim() ? Number(row.cursor) : NaN;
        const current = isFresh(at);
        if (item.key === "reportall") service.quota = evidence(current && Number.isFinite(number) && number >= 0 ? number < 100 ? "error" : number < 300 ? "limited" : "ok" : "unknown",
          Number.isFinite(number) && number >= 0 ? `${number} lookups last observed; below 100 reserve pauses lookups${current ? "" : " (stale)"}` : "Stored balance is invalid", "Existing ReportAll response header; no lookup performed", at);
        if (item.key === "regrid") {
          service.feature = evidence(current && number >= 400 ? "limited" : "unknown", `Last HTTP response: ${Number.isInteger(number) && number >= 100 && number < 600 ? number : "invalid"}${current ? "" : " (stale)"}; does not prove parcel coverage`, "Existing Regrid response telemetry", at);
          if (number === 401) service.authentication = evidence(current ? "error" : "unknown", "Last request rejected the credentials (401)", "Existing Regrid response telemetry", at);
          if (number === 403) service.quota = evidence(current ? "limited" : "unknown", "Last request denied (403); scope / entitlement may be limited", "Existing Regrid response telemetry", at);
          if (number === 200) service.feature.lastSuccessAt = at;
        }
        if (item.key === "twilio") service.feature = { ...evidence("unknown", "Last SMS accepted; delivery and subsequent failures are not tracked here", "Existing successful-send telemetry", at), lastSuccessAt: at };
      }
    }
    if (item.key === "openai") {
      const row = await readState("integrations:observed:openai");
      if (row) {
        const record = JSON.parse(row.cursor) as { status?: number; quotaExhausted?: boolean; observedAt?: string; lastSuccessAt?: string };
        const at = record.observedAt;
        const status = record.status;
        const current = isFresh(at);
        const source = "Passive OpenAI feature request telemetry (platform-wide, latest request)";
        const success = typeof status === "number" && status >= 200 && status < 300;
        service.feature = { ...evidence(current && (status === 0 || (typeof status === "number" && status >= 500)) ? "limited" : "unknown", success ? "Last feature HTTP request accepted; streamed completion and every workflow are not verified" : "Last feature request failed; check authentication, limits and provider availability", source, at), lastSuccessAt: record.lastSuccessAt };
        service.authentication = evidence(current && status === 401 ? "error" : current && success ? "ok" : "unknown", status === 401 ? "Key rejected (401)" : success ? "Key accepted on last feature request" : "Authentication not verified", source, at);
        if (record.quotaExhausted) service.quota = evidence(current ? "error" : "unknown", "Last request reported insufficient_quota; balance / trial access needs attention", source, at);
        else if (status === 429) service.quota = evidence(current ? "limited" : "unknown", "Rate limited (429); exhausted balance is not confirmed", source, at);
        else if (status === 403) service.quota = evidence("unknown", "Access denied (403); scope, model or entitlement may be responsible", source, at);
      }
    }
    if (item.key === "resend" || item.key === "smtp") {
      const row = await readState(EMAIL_SENT_KEY);
      service.feature = { ...evidence("unknown", "Shared email success history cannot identify this transport or prove delivery / absence of later failures", "Existing email transport telemetry", iso(row?.updatedAt)), lastSuccessAt: undefined };
    }
    if (item.key === "eagleview") {
      const rows: { status: string; checkedAt: Date }[] = await db.eagleViewEntitlement.findMany({ select: { status: true, checkedAt: true } });
      const latest = rows.reduce<Date | undefined>((d, r) => !d || r.checkedAt > d ? r.checkedAt : d, undefined);
      service.quota = evidence("unknown", `${rows.filter(r => r.status === "live").length} historically live packs, ${rows.filter(r => r.status === "denied").length} denied; account balance and trial access unknown`, "Stored Property Data entitlement observations", iso(latest));
      service.feature = evidence("unknown", "Property Data not probed: multipack orders may be billable. Legacy OAuth/catalog diagnostics do not prove this API works", "No report ordered");
    }
    if (["maps", "solar", "reportall", "regrid", "eagleview", "census", "fcc", "nominatim", "assessor", "naip", "usa-structures"].includes(item.key)) {
      const row = await readState(`integrations:observed:${item.key}`);
      if (row) {
        const record = JSON.parse(row.cursor) as { status?: number; observedAt?: string; lastSuccessAt?: string };
        const status = record.status;
        const at = record.observedAt;
        const current = isFresh(at);
        if (item.key === "regrid") {
          const priorAt = service.feature?.observedAt;
          if (priorAt && at && Date.parse(priorAt) > Date.parse(at)) return service;
          service.authentication = evidence("unknown", "Latest response does not verify authentication", "Passive feature HTTP telemetry", at);
          service.quota = evidence("unknown", "Latest response does not verify account quota", "Passive feature HTTP telemetry", at);
        }
        const incident = status === 0 || status === 401 || status === 403 || (typeof status === "number" && status >= 500);
        service.feature = { ...evidence(current && incident ? "limited" : "unknown", `Last observed HTTP outcome: ${typeof status === "number" && status >= 0 && status <= 599 ? status : "unknown"}. One request does not establish all features, addresses or packs`, "Passive feature HTTP telemetry; no synthetic requests", at), lastSuccessAt: record.lastSuccessAt };
        if (status === 401) service.authentication = evidence(current ? "error" : "unknown", "Last feature request rejected the credentials (401)", "Passive feature HTTP telemetry", at);
        if (status === 403) service.quota = evidence(current ? "limited" : "unknown", "One request denied (403): scope / entitlement may be limited; other features or packs may work", "Passive feature HTTP telemetry", at);
        if (status === 429) service.quota = evidence(current ? "limited" : "unknown", "Last request rate/quota limited (429); balance not confirmed", "Passive feature HTTP telemetry", at);
      }
    }
  } catch {
    // Never include exception messages: fetch errors can contain credential URLs.
    service.probeFailed = true;
    service.note = "Check unavailable: timeout, network failure, invalid response or telemetry storage error";
  }
  return service;
}

let inFlight: Promise<HealthReport> | undefined;
let memory: HealthReport | undefined;
let localRetryAt = 0;
export async function runIntegrationsHealth(): Promise<HealthReport> {
  if (memory?.nextCheckAt && Date.parse(memory.nextCheckAt) > Date.now()) return freshReport(memory);
  if (inFlight) return inFlight;
  if (localRetryAt > Date.now()) throw new Error("Monitoring temporarily unavailable");
  inFlight = sweep().catch(() => { localRetryAt = Date.now() + HEALTH_INTERVAL_MS; throw new Error("Monitoring temporarily unavailable"); }).finally(() => { inFlight = undefined; });
  return inFlight;
}
async function sweep(): Promise<HealthReport> {
  const started = Date.now();
  const now = new Date(started).toISOString();
  const previous = await readIntegrationsHealth();
  if (previous?.nextCheckAt && Date.parse(previous.nextCheckAt) > started) { memory = previous; return previous; }
  // Cross-instance CAS lease. No provider traffic unless shared storage grants it.
  // Keep lease at least 5 min even after a crash; never delete a lock row.
  await db.syncState.upsert({ where: { key: LEASE_KEY }, create: { key: LEASE_KEY, cursor: "0" }, update: {} });
  const lease = await readState(LEASE_KEY);
  if (!lease || Number(lease.cursor) > started) {
    if (previous) return previous;
    throw new Error("Another check is running; retry later");
  }
  const claimed = await db.syncState.updateMany({ where: { key: LEASE_KEY, cursor: lease.cursor }, data: { cursor: String(started + HEALTH_INTERVAL_MS) } });
  if (!claimed.count) { if (previous) return previous; throw new Error("Another check is running"); }
  const items = await getIntegrationStatuses();
  if (Date.now() > started + HEALTH_INTERVAL_MS - 15_000) throw new Error("Monitoring lease expired before probes");
  const services = await Promise.all(items.map(item => checkService(item, now)));
  // Preserve the overview's operational payout warning without treating queue
  // state (or a failed count) as proof that a payment provider is healthy.
  const payout = await checkInfluencerPayouts(now).catch((): ServiceHealth => ({ key: "influencer-payouts", name: "Influencer payouts", level: "unknown", reason: "Queue unavailable", checkedAt: now, optional: true }));
  payout.feature = evidence(payout.level === "degraded" ? "limited" : "unknown", payout.reason, "Stored payout queue; not a payment API probe", now);
  services.push(payout);
  for (const service of services) {
    const prior = previous?.services.find(s => s.key === service.key);
    for (const key of ["authentication", "quota", "provider", "feature"] as const) {
      const part = service[key];
      if (part) part.lastSuccessAt = part.state === "ok" ? part.observedAt : part.lastSuccessAt ?? prior?.[key]?.lastSuccessAt;
    }
  }
  const failed = services.some(s => s.probeFailed);
  const failures = failed ? Math.min((previous?.failures ?? 0) + 1, 4) : 0;
  const nextCheckAt = new Date(Date.now() + HEALTH_INTERVAL_MS * 2 ** failures).toISOString();
  const report = freshReport({ version: 2, ranAt: now, tookMs: Date.now() - started, worst: "unknown", services, nextCheckAt, failures });
  // Fence a worker that outlived its lease: it cannot overwrite a newer sweep.
  // Persist report and cooldown together, so every instance observes backoff.
  await db.$transaction(async (tx) => {
    const owned = await tx.syncState.updateMany({ where: { key: LEASE_KEY, cursor: String(started + HEALTH_INTERVAL_MS) }, data: { cursor: String(Date.parse(nextCheckAt)) } });
    if (!owned.count) throw new Error("Monitoring lease was superseded");
    await tx.syncState.upsert({ where: { key: HEALTH_KEY }, create: { key: HEALTH_KEY, cursor: JSON.stringify(report) }, update: { cursor: JSON.stringify(report) } });
  });
  memory = report;
  return report;
}

const PAYOUT_STALE_DAYS = 7;

/** Exported so scripts/qa can assert it without running the whole sweep — that
 *  one does reach OpenAI and SerpAPI, and a check must never spend money. */
export async function checkInfluencerPayouts(now: string): Promise<ServiceHealth> {
  const base = {
    key: "influencer-payouts",
    name: "Influencer payouts",
    checkedAt: now,
    optional: true,
    note: "optional · partner commission",
  };
  const staleBefore = new Date(Date.now() - PAYOUT_STALE_DAYS * 86_400_000);
  // runApprovedPayouts stops retrying an unknown transfer outcome after 20 hours
  // (Stripe keeps an idempotency key for ~24), because a retry past that could
  // pay twice. From then on only a person can settle it, by looking the transfer
  // up in the Stripe dashboard — so this is the one line here that is URGENT.
  const unconfirmedBefore = new Date(Date.now() - 20 * 60 * 60 * 1000);
  const unconfirmed = await db.payoutTransfer
    .count({ where: { status: "PENDING", stripeTransferId: null, createdAt: { lt: unconfirmedBefore } } })
    ;
  // A reversed transfer that nobody has decided on (Retry payout / Write off),
  // and a partial reversal, which the code deliberately does not guess at.
  const [reversedAwaiting, partialReversals] = await Promise.all([
    db.payoutRequest.count({ where: { status: "REVERSED" } }),
    db.payoutTransfer
      .count({ where: { failureReason: { startsWith: "Partially reversed" } } })
      ,
  ]);
  const [pending, stale, failedTransfers, stuck] = await Promise.all([
    db.payoutRequest.count({ where: { status: "PENDING" } }),
    db.payoutRequest.count({ where: { status: "PENDING", createdAt: { lt: staleBefore } } }),
    db.payoutTransfer.count({ where: { status: "FAILED" } }),
    // Approved but never sent: the cron could not pay it (no Connect account,
    // no cleared balance) or died mid-run and left it in PROCESSING.
    db.payoutRequest.count({ where: { status: { in: ["APPROVED", "PROCESSING"] }, createdAt: { lt: staleBefore } } }),
  ]);

  if (pending + stale + failedTransfers + stuck + unconfirmed + reversedAwaiting + partialReversals === 0) {
    return { ...base, level: "ok", reason: "nothing waiting, no failed transfers" };
  }
  const parts: string[] = [];
  // First, because it is the only one with a clock on it.
  if (unconfirmed > 0) {
    parts.push(`${unconfirmed} transfer${unconfirmed === 1 ? "" : "s"} unconfirmed with Stripe — look ${unconfirmed === 1 ? "it" : "them"} up in the dashboard before re-sending`);
  }
  if (stale > 0) parts.push(`${stale} request${stale === 1 ? "" : "s"} undecided for over ${PAYOUT_STALE_DAYS} days`);
  else if (pending > 0) parts.push(`${pending} request${pending === 1 ? "" : "s"} waiting for review`);
  if (stuck > 0) parts.push(`${stuck} approved but still unsent after ${PAYOUT_STALE_DAYS} days`);
  if (failedTransfers > 0) parts.push(`${failedTransfers} failed transfer${failedTransfers === 1 ? "" : "s"}`);
  if (reversedAwaiting > 0) {
    parts.push(`${reversedAwaiting} reversed transfer${reversedAwaiting === 1 ? "" : "s"} awaiting Retry payout or Write off`);
  }
  if (partialReversals > 0) {
    parts.push(`${partialReversals} partially reversed transfer${partialReversals === 1 ? "" : "s"} to settle by hand`);
  }
  const needsSomeone =
    unconfirmed > 0 || stale > 0 || stuck > 0 || failedTransfers > 0 || reversedAwaiting > 0 || partialReversals > 0;
  return {
    ...base,
    level: needsSomeone ? "degraded" : "ok",
    reason: needsSomeone ? `${parts.join(" · ")} — /admin/payouts` : parts.join(" · "),
  };
}

/**
 * One email a day, and only while something is down.
 *
 * `off` and `degraded` never wake anybody: a service nobody configured is not
 * an incident, and a low allowance is a decision to make this week, not at
 * 04:00. The stamp is written whether or not the mail got out, so a broken
 * transport cannot turn a nightly alert into a nightly loop.
 */
export async function alertIfDown(report: HealthReport): Promise<"sent" | "already-today" | "nothing-down"> {
  // Optional services are excluded on purpose — see ServiceHealth.optional.
  const down = report.services.filter((s) => s.level === "down" && !s.optional);
  if (!down.length) return "nothing-down";
  const today = report.ranAt.slice(0, 10);
  const stamp = await readState(ALERT_KEY);
  if (stamp?.cursor === today) return "already-today";

  const { sendEmail } = await import("@/lib/sdk/resend");
  const { platformAlertRecipients } = await import("@/lib/integrationsAlertRecipients");
  const to = await platformAlertRecipients();
  const rows = down
    .map((s) => `<li><b>${s.name}</b> — ${s.reason}</li>`)
    .join("");
  const others = report.services
    .filter((s) => s.level !== "down")
    .map((s) => `${s.name}: ${s.level}`)
    .join(" · ");
  try {
    if (to.length) {
      await sendEmail({
        to,
        subject: `JobFlex — ${down.length} integration${down.length === 1 ? "" : "s"} down`,
        html:
          `<p>The nightly integration check found ${down.length} service${down.length === 1 ? "" : "s"} down.</p>` +
          `<ul>${rows}</ul>` +
          `<p style="color:#555">${others}</p>` +
          `<p style="color:#555">Checked ${report.ranAt}. Admin → Overview has the full panel.</p>`,
      });
    }
  } catch {
    console.warn("[integrationsHealth] alert email failed");
  }
  await db.syncState
    .upsert({ where: { key: ALERT_KEY }, update: { cursor: today }, create: { key: ALERT_KEY, cursor: today } })
    .catch(() => {});
  return "sent";
}
