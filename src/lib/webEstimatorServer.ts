import "server-only";
// WEBSITE ESTIMATORS · THE SERVER HALF (2026-10-27, lib/webEstimator for the pure rules): the one switch that opens
// the feature to every account, a shop's settings, the shop behind a public address, the monthly counters (a cost
// guard), a public estimate kept an hour for the quote form, and the lead a homeowner's "Get my full quote" makes —
// with the shop's usual new-lead alert and a confirmation to the homeowner. Everything in SyncState: the production
// schema is not pushed by the build.
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import type { WebAddress, WebHvacSized, WebRoofMeasure } from "@/lib/webEstimatorTrades";
import type { SiteFacts as HvacSiteFacts } from "@/lib/hvac/intake";
import { logActivity } from "@/lib/activityLog";
import { notifyLeadCreated } from "@/lib/notify";
import { afterResponse } from "@/lib/server-events";
import { sendEmail } from "@/lib/sdk/resend";
import {
  DEFAULT_MONTHLY_CAP,
  PROJECT_TYPE,
  WEB_ESTIMATE_TOKEN_RE,
  WEB_LEAD_SOURCE,
  WEB_OPEN_KEY,
  WEB_TRADE,
  emptyCounts,
  homeownerEmail,
  leadDescription,
  monthKey,
  normalizeWebEstimatorSettings,
  webCountsKey,
  webEstimateKey,
  webLeadKey,
  webSettingsKey,
  type WebEstimatorSettings,
  type WebMonthCounts,
  type WebTrade,
} from "./webEstimator";

// ── SyncState, as every feature keeps it

async function readKey(key: string): Promise<string | null> {
  const row = await db.syncState.findUnique({ where: { key }, select: { cursor: true } });
  return row?.cursor ?? null;
}
async function writeKey(key: string, cursor: string | null): Promise<void> {
  if (cursor === null) { await db.syncState.deleteMany({ where: { key } }); return; }
  await db.syncState.upsert({ where: { key }, update: { cursor }, create: { key, cursor } });
}
function readJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

// ── the switch (owner, 2026-10-27: "do not publish to all users till I tested it in admin account")

/** True once the owner opens the feature to every account; until then only platform admins see and use it. */
export async function webEstimatorOpen(): Promise<boolean> {
  return (await readKey(WEB_OPEN_KEY)) === "1";
}
export async function setWebEstimatorOpen(on: boolean): Promise<void> {
  await writeKey(WEB_OPEN_KEY, on ? "1" : null);
}

// ── a shop's settings

export async function readWebSettings(organizationId: string): Promise<WebEstimatorSettings> {
  return normalizeWebEstimatorSettings(readJson(await readKey(webSettingsKey(organizationId))));
}
export async function writeWebSettings(organizationId: string, settings: WebEstimatorSettings): Promise<void> {
  await writeKey(webSettingsKey(organizationId), JSON.stringify(normalizeWebEstimatorSettings(settings)));
}

// ── the shop behind a public address

export interface WebShop {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string | null;
  phone: string | null;
  website: string | null;
  /** The shop's state (from its address), the trade engines' default when the homeowner's address has none. */
  state: string | null;
  settings: WebEstimatorSettings;
}

const ORG_SELECT = { id: true, name: true, slug: true, logoUrl: true, primaryColor: true, phone: true, website: true, address: true, deletedAt: true } as const;

/** The live shop at /estimate/<slug>, with its settings; null when there is no such shop. */
export async function webShopBySlug(slug: string): Promise<WebShop | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) return null;
  const org = await db.organization.findUnique({ where: { slug }, select: ORG_SELECT });
  if (!org || org.deletedAt) return null;
  const settings = await readWebSettings(org.id);
  return { id: org.id, name: org.name, slug: org.slug, logoUrl: org.logoUrl, primaryColor: org.primaryColor, phone: org.phone, website: org.website, state: stateOf(org.address), settings };
}

/** "…, Sacramento, CA 95822" → "CA". */
export function stateOf(address: string | null | undefined): string | null {
  const m = /\b([A-Z]{2})\b(?:\s+\d{5}(?:-\d{4})?)?\s*$/.exec((address || "").trim());
  return m ? m[1] : null;
}

// ── the month's counters

export async function readWebCounts(organizationId: string, month = monthKey()): Promise<WebMonthCounts> {
  return { ...emptyCounts(), ...(readJson<Partial<WebMonthCounts>>(await readKey(webCountsKey(organizationId, month))) ?? {}) };
}
export async function bumpWebCount(organizationId: string, what: keyof WebMonthCounts): Promise<WebMonthCounts> {
  const month = monthKey();
  const c = await readWebCounts(organizationId, month);
  c[what] = (c[what] ?? 0) + 1;
  await writeKey(webCountsKey(organizationId, month), JSON.stringify(c));
  return c;
}
/** The shop's own cost guard: no more public estimates this month once the cap is reached. */
export async function webCapReached(shop: WebShop): Promise<boolean> {
  const c = await readWebCounts(shop.id);
  return c.estimates >= (shop.settings.monthlyCap || DEFAULT_MONTHLY_CAP);
}

// ── a public estimate, kept an hour

export const ESTIMATE_TTL_MS = 60 * 60 * 1000;

/** What every trade's engine gives the public page — the words, the number, and what the lead will carry. */
export interface WebEstimateRecord {
  token: string;
  organizationId: string;
  trade: WebTrade;
  at: string;
  /** The homeowner's address as typed, and its parts when known. */
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** One line about what was measured or asked: "26 squares at a 6:12 pitch, 3 facets." */
  summary: string;
  /** What they picked: "GAF Timberline HDZ, Charcoal". */
  choice: string;
  /** The price before the band, in cents, and the band shown. */
  cents: number;
  band: { low: number; high: number };
  show: "range" | "exact";
  /** The trade's own facts for the estimator hand-off (a RoofMeasurement id, the HVAC inputs, the deck design…). */
  facts: Record<string, unknown>;
}

export async function storeWebEstimate(rec: Omit<WebEstimateRecord, "token" | "at">): Promise<WebEstimateRecord> {
  const full: WebEstimateRecord = { ...rec, token: randomBytes(18).toString("base64url"), at: new Date().toISOString() };
  await writeKey(webEstimateKey(full.token), JSON.stringify(full));
  return full;
}
export async function readWebEstimate(token: string, organizationId: string): Promise<WebEstimateRecord | null> {
  if (!WEB_ESTIMATE_TOKEN_RE.test(token)) return null;
  const rec = readJson<WebEstimateRecord>(await readKey(webEstimateKey(token)));
  if (!rec || rec.organizationId !== organizationId || rec.token !== token) return null;
  if (Date.now() - Date.parse(rec.at) > ESTIMATE_TTL_MS) return null;
  return rec;
}

// ── the roof's measurement, kept an hour: each material the homeowner tries prices from one aerial measurement (2026-10-28)

export const webRoofKey = (token: string) => `webRoof:${token}`;
export interface WebRoofRecord { token: string; organizationId: string; at: string; measure: WebRoofMeasure }
export async function storeWebRoof(organizationId: string, measure: WebRoofMeasure): Promise<WebRoofRecord> {
  const rec: WebRoofRecord = { token: randomBytes(18).toString("base64url"), organizationId, at: new Date().toISOString(), measure };
  await writeKey(webRoofKey(rec.token), JSON.stringify(rec));
  return rec;
}
export async function readWebRoof(token: string, organizationId: string): Promise<WebRoofRecord | null> {
  if (!WEB_ESTIMATE_TOKEN_RE.test(token)) return null;
  const rec = readJson<WebRoofRecord>(await readKey(webRoofKey(token)));
  if (!rec || rec.organizationId !== organizationId || rec.token !== token || !rec.measure) return null;
  if (Date.now() - Date.parse(rec.at) > ESTIMATE_TTL_MS) return null;
  return rec;
}

// ── the HVAC house, looked up and sized, kept an hour (2026-10-28): the homeowner confirms the facts, then picks a tier

export const webHvacKey = (token: string) => `webHvac:${token}`;
export interface WebHvacRecord { token: string; organizationId: string; at: string; address: WebAddress; site: HvacSiteFacts; sized: WebHvacSized | null }
export async function storeWebHvac(organizationId: string, address: WebAddress, site: HvacSiteFacts): Promise<WebHvacRecord> {
  const rec: WebHvacRecord = { token: randomBytes(18).toString("base64url"), organizationId, at: new Date().toISOString(), address, site, sized: null };
  await writeKey(webHvacKey(rec.token), JSON.stringify(rec));
  return rec;
}
export async function updateWebHvac(rec: WebHvacRecord): Promise<void> {
  await writeKey(webHvacKey(rec.token), JSON.stringify(rec));
}
export async function readWebHvac(token: string, organizationId: string): Promise<WebHvacRecord | null> {
  if (!WEB_ESTIMATE_TOKEN_RE.test(token)) return null;
  const rec = readJson<WebHvacRecord>(await readKey(webHvacKey(token)));
  if (!rec || rec.organizationId !== organizationId || rec.token !== token || !rec.site) return null;
  if (Date.now() - Date.parse(rec.at) > ESTIMATE_TTL_MS) return null;
  return rec;
}

// ── the lead

export interface WebLeadContact { name: string; phone: string; email: string | null; note: string | null }

/** What the lead carries beyond the Lead row — read by My leads and the estimator hand-off. */
export interface WebLeadRecord { leadId: string; trade: WebTrade; estimate: WebEstimateRecord; contact: WebLeadContact; at: string }

export async function readWebLead(leadId: string): Promise<WebLeadRecord | null> {
  return readJson<WebLeadRecord>(await readKey(webLeadKey(leadId)));
}

/** "Get my full quote": the Lead on the shop's My leads, the shop's usual alert, a confirmation to the homeowner. */
export async function createWebLead(shop: WebShop, est: WebEstimateRecord, contact: WebLeadContact): Promise<{ leadId: string }> {
  const trade = est.trade;
  const tradeSettings = shop.settings.trades[trade];
  const description = leadDescription(trade, { summary: est.summary, choice: est.choice, band: est.band, show: est.show, note: contact.note ? `Homeowner's note: "${contact.note}"` : "" });
  const lead = await db.lead.create({
    data: {
      organizationId: shop.id,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      address: est.address,
      city: est.city,
      state: est.state,
      zip: est.zip,
      projectType: PROJECT_TYPE[trade],
      description,
      source: WEB_LEAD_SOURCE,
      status: "NEW",
    },
    select: { id: true },
  });
  const rec: WebLeadRecord = { leadId: lead.id, trade, estimate: est, contact, at: new Date().toISOString() };
  await writeKey(webLeadKey(lead.id), JSON.stringify(rec));
  await writeKey(webEstimateKey(est.token), null);
  await logActivity({ organizationId: shop.id, actorId: null, kind: "LEAD_WEBSITE", leadId: lead.id, summary: `${contact.name} asked for a full ${PROJECT_TYPE[trade].toLowerCase()} quote from the ${WEB_TRADE[trade].name.replace(" on your website", "").toLowerCase()} on the website — ${est.address}` }).catch(() => {});
  await bumpWebCount(shop.id, "leads").catch(() => {});
  // the shop's own new-lead alert (text + email by their preferences) and the homeowner's confirmation, after the response
  afterResponse(async () => {
    try { await notifyLeadCreated(lead.id); } catch (err) { console.error("[web-estimator] lead alert failed:", err instanceof Error ? err.message : err); }
    if (contact.email) {
      const m = homeownerEmail({ shop: shop.name, trade, band: est.band, show: est.show, summary: est.summary, choice: est.choice, phone: contact.phone, note: tradeSettings.note || undefined });
      try {
        await sendEmail({ to: contact.email, subject: m.subject, text: m.text, html: `<pre style="font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;white-space:pre-wrap">${escapeHtml(m.text)}</pre>`, organizationId: shop.id });
      } catch (err) { console.error("[web-estimator] homeowner email failed:", err instanceof Error ? err.message : err); }
    }
  });
  return { leadId: lead.id };
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
