"use server";
// WEBSITE ESTIMATORS · THE ACTIONS (2026-10-27). Two doors:
//   the shop's — Settings → Website estimators: load, save, the admin's "open to every account" switch, and the
//     hand-off that opens a website lead in the shop's own estimator, already measured and priced;
//   the public's — the page on the contractor's website: a view counted, an estimate run, a lead made. Each public
//     action finds the shop by its handle again, checks the trade is on, and is braked per visitor and per shop.
// Rules in lib/webEstimator; the server half in lib/webEstimatorServer; the engines in lib/webEstimatorTrades.
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { NoOrgError, UnauthorizedError, requireEstimatorOrManager, requireManager, requirePlatformAdmin } from "@/lib/orgContext";
import { HOUR, MINUTE, RateLimitError, clientIp, enforceRateLimit } from "@/lib/rateLimit";
import { noteRequestOrg } from "@/lib/trialMeter";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { startEstimateFromLead } from "@/actions/leadEstimate";
import {
  PROJECT_TYPE,
  WEB_TRADE,
  WEB_TRADES,
  embedSnippets,
  hostAllowed,
  isWebTrade,
  normalizeWebEstimatorSettings,
  priceBand,
  type WebEstimatorSettings,
  type WebMonthCounts,
  type WebTrade,
  splitTypedAddress,
} from "@/lib/webEstimator";
import {
  bumpWebCount,
  createWebLead,
  readWebCounts,
  readWebEstimate,
  readWebLead,
  readWebSettings,
  setWebEstimatorOpen,
  storeWebEstimate,
  webCapReached,
  webEstimatorOpen,
  webShopBySlug,
  writeWebSettings,
  type WebShop,
} from "@/lib/webEstimatorServer";
import { runWebTrade, webTradeAllChoices, webTradeChoices, webTradeQuestions, type WebAddress, type WebChoice, type WebQuestion } from "@/lib/webEstimatorTrades";

type Fail = { ok: false; error: string };
const DENIED = "You don't have access to this.";

async function platformAdmin(): Promise<boolean> {
  try { await requirePlatformAdmin(); return true; } catch { return false; }
}

// ── the shop's door

export interface WebEstimatorView {
  settings: WebEstimatorSettings;
  slug: string;
  base: string;
  counts: WebMonthCounts;
  /** Everything each trade could offer (the pickers). */
  choices: Record<WebTrade, WebChoice[]>;
  canEdit: boolean;
  admin: boolean;
  /** The owner's switch: false = platform admins only (nothing billed), true = every account. */
  open: boolean;
}

export async function loadWebEstimator(): Promise<{ ok: true; view: WebEstimatorView } | Fail> {
  let ctx;
  try { ctx = await requireManager(); } catch (err) { if (err instanceof UnauthorizedError || err instanceof NoOrgError) return { ok: false, error: DENIED }; throw err; }
  const [admin, open, org, settings, counts] = await Promise.all([
    platformAdmin(), webEstimatorOpen(),
    db.organization.findUnique({ where: { id: ctx.organizationId }, select: { slug: true } }),
    readWebSettings(ctx.organizationId), readWebCounts(ctx.organizationId),
  ]);
  if (!open && !admin) return { ok: false, error: DENIED };
  const choices = Object.fromEntries(WEB_TRADES.map((t) => [t, webTradeAllChoices(t)])) as Record<WebTrade, WebChoice[]>;
  return { ok: true, view: { settings, slug: org?.slug ?? "", base: await appBaseUrl(), counts, choices, canEdit: true, admin, open } };
}

export async function saveWebEstimator(raw: unknown): Promise<{ ok: true; settings: WebEstimatorSettings } | Fail> {
  let ctx;
  try { ctx = await requireManager(); } catch (err) { if (err instanceof UnauthorizedError || err instanceof NoOrgError) return { ok: false, error: DENIED }; throw err; }
  const [admin, open] = await Promise.all([platformAdmin(), webEstimatorOpen()]);
  if (!open && !admin) return { ok: false, error: "The website estimators are in preview — a JobFlex admin turns them on for now." };
  const settings = normalizeWebEstimatorSettings(raw);
  await writeWebSettings(ctx.organizationId, settings);
  const on = WEB_TRADES.filter((t) => settings.trades[t].on).map((t) => PROJECT_TYPE[t]);
  await logActivity({ organizationId: ctx.organizationId, actorId: ctx.user.id, kind: TRAIL_KINDS.SETTINGS, summary: `Website estimators: ${on.length ? on.join(", ") + " on" : "all off"}${settings.domains.length ? ` · sites ${settings.domains.join(", ")}` : ""}` }).catch(() => {});
  revalidatePath("/dashboard/settings");
  return { ok: true, settings };
}

/** The owner's switch (a platform admin): false keeps the feature to admins and unbilled; true opens it to every account. */
export async function setWebEstimatorOpenAction(on: boolean): Promise<{ ok: true; open: boolean } | Fail> {
  if (!(await platformAdmin())) return { ok: false, error: DENIED };
  await setWebEstimatorOpen(on === true);
  revalidatePath("/dashboard/settings");
  return { ok: true, open: on === true };
}

/** A website lead opens in the shop's own estimator, already measured and priced — the deck as a studio draft, the
 *  roof with its aerial measurement on file, HVAC and fence with the lead's address seeded. Redirects. */
export async function openWebLeadInEstimator(leadId: string): Promise<void> {
  const ctx = await requireEstimatorOrManager();
  if (typeof leadId !== "string" || !/^[\w-]{1,64}$/.test(leadId)) throw new Error("No such lead.");
  const lead = await db.lead.findFirst({ where: { id: leadId, organizationId: ctx.organizationId }, select: { id: true, name: true, address: true, city: true, state: true, zip: true } });
  const rec = lead ? await readWebLead(lead.id) : null;
  if (!lead || !rec) throw new Error("No such website lead.");
  const est = rec.estimate;
  if (rec.trade === "deck") {
    const design = est.facts.design;
    const id = randomUUID();
    const address = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ");
    const body = JSON.stringify({ v: 1, title: `${lead.name} — from the website · ${est.choice}`.slice(0, 120), address: address.slice(0, 300), updatedAt: new Date().toISOString(), by: `${lead.name} (website)`, proposalId: null, clientToken: null, design });
    await db.syncState.upsert({ where: { key: `deckdraft:${ctx.organizationId}:${id}` }, update: { cursor: body }, create: { key: `deckdraft:${ctx.organizationId}:${id}`, cursor: body } });
    redirect(`/dashboard/deck-estimator?draft=${id}`);
  }
  if (rec.trade === "roof" && est.facts.solar && !est.facts.measurementId) {
    // the aerial measurement the homeowner's page made, on the shop's file: the estimator reuses it for this address
    const solar = est.facts.solar as { areaSqft: number; footprintSqft: number; pitchLabel: string; segmentCount: number; center: { lat: number; lng: number }; imageryQuality: string; imageryDate: string | null };
    const pin = est.facts.pin as { lat: number; lng: number };
    const input = { address: lead.address ?? "", city: lead.city ?? "", state: lead.state ?? "", zip: lead.zip ?? "" };
    const structure = { areaSqft: solar.areaSqft, squares: solar.areaSqft / 100, pitch: solar.pitchLabel, footprintSqft: solar.footprintSqft, eaveHeightFt: null, outline: null, facetCount: null, shape: null, material: null, conditionRating: null, roofAgeYears: null, chimney: null, solarPanels: null, rooftopAcCount: null, occlusion: null, treeOverhang: null, confidence: null, materialRings: null };
    const instant = { requestId: "", address: [input.address, input.city, input.state, input.zip].filter(Boolean).join(", "), lat: solar.center.lat, lng: solar.center.lng, structures: [structure], imagery: [], totals: { areaSqft: solar.areaSqft, squares: solar.areaSqft / 100, predominantPitch: Number(String(solar.pitchLabel).split(":")[0]) || null, pitchLabel: solar.pitchLabel, maxEaveFt: null, facetCount: null, footprintSqft: solar.footprintSqft } };
    try {
      const row = await db.roofMeasurement.create({
        data: {
          organizationId: ctx.organizationId, createdById: ctx.user.id, source: "solar",
          address: input.address, city: input.city, state: input.state, zip: input.zip, lat: solar.center.lat, lng: solar.center.lng,
          areaSqft: solar.areaSqft, squares: solar.areaSqft / 100, predominantPitch: solar.pitchLabel, facetCount: solar.segmentCount,
          instantRequestId: null, instantJson: JSON.stringify(instant), modelJson: "{}", chimneyJson: "[]",
          provenanceJson: JSON.stringify({ calibration: null, provenance: { solar, solarRequestedPin: pin, imageryQuality: solar.imageryQuality, imageryDate: solar.imageryDate ?? undefined, website: true } }),
        },
        select: { id: true },
      });
      await db.syncState.update({ where: { key: `webLead:${lead.id}` }, data: { cursor: JSON.stringify({ ...rec, estimate: { ...est, facts: { ...est.facts, measurementId: row.id } } }) } }).catch(() => {});
    } catch (err) {
      console.error("[web-estimator] roof measurement row failed:", err instanceof Error ? err.message : err);
    }
  }
  await startEstimateFromLead(lead.id, WEB_TRADE[rec.trade].estimator);
}

// ── the public door

async function liveShop(slug: unknown, trade: unknown): Promise<{ shop: WebShop; trade: WebTrade } | Fail> {
  if (typeof slug !== "string" || !isWebTrade(trade)) return { ok: false, error: "This estimator isn't here." };
  const shop = await webShopBySlug(slug);
  if (!shop || !shop.settings.trades[trade].on) return { ok: false, error: "This estimator isn't turned on." };
  return { shop, trade };
}
const brake = async (key: string, max: number, windowMs: number, what: string): Promise<string | null> => {
  try { await enforceRateLimit(key, max, windowMs, what); return null; } catch (err) { if (err instanceof RateLimitError) return "That's a lot of estimates at once — give it a few minutes and try again."; throw err; }
};

/** The page opened on the contractor's site (counted, best-effort). */
export async function webView(slug: unknown, trade: unknown): Promise<void> {
  const r = await liveShop(slug, trade);
  if ("ok" in r) return;
  const ip = await clientIp();
  if (await brake(`web-view:${ip}`, 60, 10 * MINUTE, "views")) return;
  await bumpWebCount(r.shop.id, "views").catch(() => {});
}

export interface WebEstimateView {
  token: string;
  summary: string;
  choice: string;
  band: { low: number; high: number };
  show: "range" | "exact";
  basis: string;
  askEmail: boolean;
}

/** The homeowner's address (and answers) → the price, in the shop's prices. */
export async function webEstimate(slug: unknown, trade: unknown, raw: unknown): Promise<{ ok: true; estimate: WebEstimateView } | (Fail & { code?: string })> {
  const r = await liveShop(slug, trade);
  if ("ok" in r) return r;
  const { shop, trade: t } = r;
  const ip = await clientIp();
  const braked = (await brake(`web-est-ip:${ip}`, 12, 10 * MINUTE, "estimates")) ?? (await brake(`web-est-shop:${shop.id}`, 120, HOUR, "estimates"));
  if (braked) return { ok: false, error: braked, code: "braked" };
  if (await webCapReached(shop)) return { ok: false, error: "This estimator has had a busy month and is resting. Leave your details and the shop will price it by hand.", code: "capped" };
  const input = cleanInput(raw);
  if (!input) return { ok: false, error: "Type the address of the house.", code: "address" };
  await noteRequestOrg(shop.id).catch(() => {});
  const out = await runWebTrade(shop, t, input);
  if (!out.ok) return { ok: false, error: out.error, code: out.code };
  const ts = shop.settings.trades[t];
  const band = priceBand(out.cents, ts.show, ts.spread);
  const rec = await storeWebEstimate({ organizationId: shop.id, trade: t, address: input.address.address.trim(), city: out.city, state: out.state, zip: out.zip, summary: out.summary, choice: out.choice, cents: out.cents, band, show: ts.show, facts: out.facts });
  await bumpWebCount(shop.id, "estimates").catch(() => {});
  return { ok: true, estimate: { token: rec.token, summary: out.summary, choice: out.choice, band, show: ts.show, basis: ts.note || WEB_TRADE[t].basis, askEmail: ts.askEmail } };
}

function cleanInput(raw: unknown): { address: WebAddress; choice: string | null; answers: Record<string, string | number> } | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const a = (r.address && typeof r.address === "object" ? r.address : {}) as Record<string, unknown>;
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const typed = splitTypedAddress({ address: s(a.address, 200), city: s(a.city, 80), state: s(a.state, 2).toUpperCase(), zip: s(a.zip, 10) });
  const address: WebAddress = { ...typed, lat: typeof a.lat === "number" && Number.isFinite(a.lat) ? a.lat : null, lng: typeof a.lng === "number" && Number.isFinite(a.lng) ? a.lng : null };
  if (address.address.length < 5) return null;
  const choice = typeof r.choice === "string" && r.choice.length <= 60 ? r.choice : null;
  const answers: Record<string, string | number> = {};
  const src = (r.answers && typeof r.answers === "object" ? r.answers : {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(src).slice(0, 20)) { if (/^[a-z]{1,20}$/.test(k) && (typeof v === "number" || (typeof v === "string" && v.length <= 40))) answers[k] = v; }
  return { address, choice, answers };
}

/** "Get my full quote": the lead for the shop, a confirmation for the homeowner. */
export async function webLead(slug: unknown, trade: unknown, token: unknown, raw: unknown): Promise<{ ok: true; leadId: string } | Fail> {
  const r = await liveShop(slug, trade);
  if ("ok" in r) return r;
  const { shop } = r;
  const ip = await clientIp();
  const braked = (await brake(`web-lead-ip:${ip}`, 6, 10 * MINUTE, "requests")) ?? (await brake(`web-lead-shop:${shop.id}`, 60, HOUR, "requests"));
  if (braked) return { ok: false, error: braked };
  const est = typeof token === "string" ? await readWebEstimate(token, shop.id) : null;
  if (!est) return { ok: false, error: "That estimate has expired — run it again, it only takes a moment." };
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const name = s(c.name, 80), phone = s(c.phone, 40), email = s(c.email, 120) || null, note = s(c.note, 500) || null;
  if (name.length < 2) return { ok: false, error: "Your name, please." };
  if (phone.replace(/\D/g, "").length < 10) return { ok: false, error: "A phone number with the area code, please." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email doesn't look right." };
  if (c.consent !== true) return { ok: false, error: "Tick the box so the shop may contact you." };
  if (typeof c.company === "string" && c.company.trim()) return { ok: true, leadId: "ok" };   // the honeypot: a bot filled the hidden field
  const { leadId } = await createWebLead(shop, est, { name, phone, email, note });
  return { ok: true, leadId };
}

// ── what the public page needs to draw (server component helper, not an action-only export)

export async function webPageModel(slug: string, trade: string, host: string | null) {
  if (!isWebTrade(trade)) return null;
  const shop = await webShopBySlug(slug);
  if (!shop || !shop.settings.trades[trade].on) return null;
  const base = await appBaseUrl();
  let appHost: string | null = null;
  try { appHost = new URL(base).host; } catch { appHost = null; }
  return {
    shop: { name: shop.name, slug: shop.slug, logoUrl: shop.logoUrl, primaryColor: shop.primaryColor, phone: shop.phone, website: shop.website },
    trade,
    title: WEB_TRADE[trade].title,
    basis: shop.settings.trades[trade].note || WEB_TRADE[trade].basis,
    askEmail: shop.settings.trades[trade].askEmail,
    choices: webTradeChoices(shop, trade),
    questions: webTradeQuestions(trade) as WebQuestion[],
    hostOk: hostAllowed(shop.settings.domains, host, appHost),
    snippets: embedSnippets(base, shop.slug, trade),
  };
}
