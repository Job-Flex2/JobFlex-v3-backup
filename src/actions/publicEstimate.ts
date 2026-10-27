"use server";
// THE HOMEOWNER'S ESTIMATORS, with no account (owner, 2026-10-27: "Price my project" in the home portal). Org-less on
// purpose: nothing here imports the contractor gates. Its own brakes instead — a honeypot, 10 roof reads an hour per
// connection and 600 an hour for everyone, the intake's own limits on a submit. Two front doors share these actions:
// the home portal (`caller.kind: "home"` — the lead goes to the Lead Center) and the contractor-website estimators
// (`"site"` — the lead goes to that contractor; wired by that work, accepted here).
//
// Every refusal comes back as `{ ok: false, error }` in words: a thrown error is masked in production, and the
// person reading it has just typed their address from an ad.
import { z } from "zod";
import { getBuildingInsights, isSolarEnabled, SolarUnavailableError } from "@/lib/solar";
import { estimateSolarRoof, type SolarRoofEstimate } from "@/lib/roofSolarEstimate";
import { clientIp, enforceRateLimit, MINUTE } from "@/lib/rateLimit";
import { locationIndex } from "@/lib/estimate/location-index";
import { recordApiSpend } from "@/lib/apiSpend";
import { unitCents } from "@/lib/paidApiCosts";
import { roofGuideRange } from "@/lib/publicEstimate/guide";
import { cacheFresh, cacheable, houseOrgId, pubRoofKey, readPubRoof, writePubRoof, type PubRoofCache } from "@/lib/publicEstimate/store";
import { roofFactsFromSize, roofFactsFromSolar, roofRange, type MaterialId, type RoofAnswers } from "@/lib/publicEstimate/roof";
import { estimateWords, leadEstimateFrom, planNotesFor, type LeadEstimate } from "@/lib/leadCenter/estimate";
import { createHomeownerLead } from "@/lib/leadCenter/intake";
import { LEAD_CONSENT_TEXT } from "@/lib/leadConsent";
import { findOrCreateHome, homePath } from "@/lib/home/portal";
import { db } from "@/lib/db";

export type PublicCaller = { kind: "home" } | { kind: "site"; orgSlug: string };

const US_STATE = /^[A-Z]{2}$/;
const readSchema = z.object({
  address: z.string().trim().min(3).max(200),
  city: z.string().trim().max(120),
  state: z.string().trim().toUpperCase().regex(US_STATE, "state"),
  zip: z.string().trim().max(12),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  /** The honeypot: a person never fills it. */
  website: z.string().max(200).optional(),
  /** The material the range opens on — for the "typical in <city>" line. */
  material: z.string().max(40).optional(),
});
export type PublicRoofReadInput = z.infer<typeof readSchema>;

export type PublicRoofReadResult =
  | {
      ok: true;
      solar: SolarRoofEstimate | null;
      /** Why there is no roof read, in words for the homeowner; null when `solar` is set. */
      noRoofReason: string | null;
      cityFactor: number;
      cityWords: string | null;
      guide: { low: number; high: number; cityWords: string } | null;
      cached: boolean;
    }
  | { ok: false; error: string };

const TRY_AGAIN = "Something went wrong — try again.";
const NO_ROOF = "We couldn't read your roof from the sky.";

/** The roof at this address, read from Google Solar — cached per address for 30 days. */
export async function publicRoofRead(raw: unknown, caller: PublicCaller): Promise<PublicRoofReadResult> {
  try {
    return await readInner(raw, caller);
  } catch (err) {
    const e = err as { name?: string; retryAfterMs?: number };
    if (e?.name === "RateLimitError") {
      const mins = Math.max(1, Math.ceil((e.retryAfterMs ?? 60 * MINUTE) / MINUTE));
      return { ok: false, error: `We've priced a lot of roofs from this connection — try again in ${mins} minute${mins === 1 ? "" : "s"}.` };
    }
    if (err instanceof z.ZodError) return { ok: false, error: "Pick your address from the list, then try again." };
    console.error("[price] roof read failed:", err);
    return { ok: false, error: TRY_AGAIN };
  }
}

async function readInner(raw: unknown, caller: PublicCaller): Promise<PublicRoofReadResult> {
  const input = readSchema.parse(raw);
  // A filled honeypot is a script: refused before any brake counts it or any call is made.
  if (input.website && input.website.trim() !== "") return { ok: false, error: TRY_AGAIN };
  const ip = await clientIp();
  await enforceRateLimit(`pubroof:${ip}`, 10, 60 * MINUTE, "reads");
  await enforceRateLimit("pubroof:global", 600, 60 * MINUTE, "reads");

  const idx = locationIndex(`${input.city}, ${input.state}`);
  const cityFactor = idx.factor;
  const cityWords = idx.level === "national" ? null : idx.place;
  const material = (input.material ?? "architectural") as MaterialId;
  const guide = roofGuideRange(`${input.city}, ${input.state}`, material);

  const key = pubRoofKey(input);
  const now = new Date();
  const cached = await readPubRoof(key);
  if (cacheFresh(cached, now)) {
    return { ok: true, solar: cached!.solar, noRoofReason: cached!.solar ? null : NO_ROOF, cityFactor, cityWords, guide, cached: true };
  }
  if (!isSolarEnabled()) return { ok: true, solar: null, noRoofReason: NO_ROOF, cityFactor, cityWords, guide, cached: false };

  let row: PubRoofCache | null = null;
  let outcome: "ok" | "timeout" | "no-coverage" | "config" | "error" = "ok";
  try {
    const insights = await getBuildingInsights(input.lat, input.lng);
    const est = estimateSolarRoof(insights, { lat: input.lat, lng: input.lng }, now);
    row = { v: 1, at: now.toISOString(), solar: est.ok ? est.estimate : null, error: est.ok ? null : est.error };
  } catch (err) {
    outcome = err instanceof SolarUnavailableError ? err.kind : "error";
    row = { v: 1, at: now.toISOString(), solar: null, error: (err as Error)?.message?.slice(0, 300) ?? "solar failed" };
  }
  // The call was made whatever it answered: filed under the house org when one is named.
  const house = await houseOrgId();
  if (house) await recordApiSpend(house, [{ service: "google-solar", op: "buildingInsights", calls: 1, cents: unitCents("google-solar", "buildingInsights") }], now);
  if (cacheable(outcome)) await writePubRoof(key, row);
  if (caller.kind === "site") console.info("[price] site read", caller.orgSlug, key);
  return { ok: true, solar: row.solar, noRoofReason: row.solar ? null : NO_ROOF, cityFactor, cityWords, guide, cached: false };
}

// ── The submits ──────────────────────────────────────────────────────────────

const answersSchema = z.object({
  existing: z.enum(["asphalt", "metal", "tile", "shake", "flat", "unsure"]),
  storeys: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  material: z.enum(["architectural", "standing_seam", "impact_resistant", "designer", "three_tab"]),
  tearOffLayers: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  leaks: z.boolean(),
  skylights: z.boolean(),
  solarPanels: z.boolean(),
});
const siteSchema = readSchema.pick({ address: true, city: true, state: true, zip: true, lat: true, lng: true, website: true });
/** What the browser sends about the range: its answers, where the facts came from, a budget — never the numbers.
 *  The server prices again from the cached roof read (or the home's size) and keeps its own result. */
const pricedSchema = z.object({
  answers: answersSchema,
  basis: z.enum(["solar", "size"]),
  budgetCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  /** With `basis: "size"`: the home's square footage the homeowner typed. */
  homeSqft: z.number().int().min(200).max(50_000).optional(),
  timezone: z.string().max(80).optional(),
});
const leadSchema = siteSchema.merge(pricedSchema).extend({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().min(7).max(40),
  consent: z.boolean(),
  page: z.string().max(300).optional(),
});
const emailSchema = siteSchema.merge(pricedSchema).extend({
  email: z.string().trim().email().max(200),
  name: z.string().trim().max(120).optional(),
});
export type PublicRoofLeadInput = z.infer<typeof leadSchema>;
export type PublicRoofEmailInput = z.infer<typeof emailSchema>;

const CONSENT_MISSING = "Please tick the box to agree to be contacted about your request, then send again.";

/** The record, priced by the server from what it trusts: the cached roof read, or the size the homeowner typed. */
async function serverEstimate(input: z.infer<typeof siteSchema> & z.infer<typeof pricedSchema>): Promise<LeadEstimate | null> {
  const answers: RoofAnswers = input.answers;
  const idx = locationIndex(`${input.city}, ${input.state}`);
  const city = idx.level === "national" ? null : { factor: idx.factor, words: idx.place };
  let facts = null;
  let basis: "solar" | "size" = "size";
  if (input.basis === "solar") {
    const cached = await readPubRoof(pubRoofKey(input));
    if (cached?.solar) {
      facts = roofFactsFromSolar(cached.solar, answers, input.state);
      basis = "solar";
    }
  }
  if (!facts) {
    if (!input.homeSqft) return null;
    facts = roofFactsFromSize(input.homeSqft, answers, input.state);
  }
  const range = roofRange(facts, answers, city, basis);
  const guide = roofGuideRange(`${input.city}, ${input.state}`, answers.material);
  const e = leadEstimateFrom(range, answers, guide);
  e.budgetCents = input.budgetCents && input.budgetCents > 0 ? Math.round(input.budgetCents) : null;
  return e;
}

export type PublicRoofLeadResult = { ok: true; statusPath: string; homePath: string | null } | { ok: false; error: string };

/** "Get quotes from local pros": the range becomes a Lead Center lead that carries the whole estimate. */
export async function publicRoofLead(raw: unknown): Promise<PublicRoofLeadResult> {
  try {
    const input = leadSchema.parse(raw);
    if (input.website && input.website.trim() !== "") return { ok: false, error: TRY_AGAIN };
    // Nobody is contacted without the box ticked (owner, 2026-10-26) — said back before the brakes count the attempt.
    if (input.consent !== true) return { ok: false, error: CONSENT_MISSING };
    const ip = await clientIp();
    await enforceRateLimit(`homeowner:${ip}`, 3, 10 * MINUTE, "requests");
    await enforceRateLimit("homeowner:global", 60, MINUTE, "requests");
    const estimate = await serverEstimate(input);
    if (!estimate) return { ok: false, error: "We lost the roof read — go back a step and price it again." };
    const words = estimateWords(estimate);
    const res = await createHomeownerLead(
      {
        name: input.name,
        email: input.email,
        phone: input.phone,
        address: input.address,
        city: input.city,
        state: input.state,
        zip: input.zip,
        projectType: "roofing",
        description: words,
        // Pre-written and over 20 characters: the intake keeps it as the scope and skips the scope writer.
        scope: words,
      },
      {
        isTest: false,
        timezone: input.timezone ?? null,
        source: "price:roof",
        consent: { text: LEAD_CONSENT_TEXT, at: new Date(), ip: ip === "local" || ip === "unknown" ? null : ip, page: input.page?.startsWith("/") ? input.page : "/price/roof" },
        estimate,
      },
    );
    return { ok: true, statusPath: res.statusPath, homePath: res.homePath ?? null };
  } catch (err) {
    const e = err as { name?: string; retryAfterMs?: number };
    if (e?.name === "RateLimitError") {
      const mins = Math.max(1, Math.ceil((e.retryAfterMs ?? 10 * MINUTE) / MINUTE));
      return { ok: false, error: `We've had several projects from this connection in the last few minutes, so we're pausing for a moment. Please send again in ${mins} minute${mins === 1 ? "" : "s"}.` };
    }
    if (err instanceof z.ZodError) return { ok: false, error: "Something in the form doesn't look right — check your name, email and phone, then send again." };
    console.error("[price] lead failed:", err);
    return { ok: false, error: "We couldn't send that just now — nothing was lost. Please try again in a minute." };
  }
}

export type PublicRoofEmailResult = { ok: true; homePath: string; planId: string } | { ok: false; error: string };

/** "Email me this range": no lead, no consent box — the range becomes a planned project on their home dashboard,
 *  with the plan reminder (lib/home/reminders) nudging in two days; "Get quotes" from the email or the dashboard
 *  turns it into a request. */
export async function publicRoofEmail(raw: unknown): Promise<PublicRoofEmailResult> {
  try {
    const input = emailSchema.parse(raw);
    if (input.website && input.website.trim() !== "") return { ok: false, error: TRY_AGAIN };
    const ip = await clientIp();
    await enforceRateLimit(`pubemail:${ip}`, 5, 10 * MINUTE, "emails");
    const estimate = await serverEstimate(input);
    if (!estimate) return { ok: false, error: "We lost the roof read — go back a step and price it again." };
    const { home } = await findOrCreateHome({
      name: input.name?.trim() || "Homeowner",
      email: input.email,
      address: input.address,
      city: input.city,
      state: input.state,
      zip: input.zip,
      timezone: input.timezone ?? null,
    });
    const now = new Date();
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const plan = await db.homePlan.create({
      data: {
        homeId: home.id,
        title: `Roof · ${input.address}`,
        notes: planNotesFor(estimate),
        plannedFor: nextMonth,
        wholeMonth: true,
        remindAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    });
    return { ok: true, homePath: homePath(home.accessToken), planId: plan.id };
  } catch (err) {
    const e = err as { name?: string; retryAfterMs?: number };
    if (e?.name === "RateLimitError") return { ok: false, error: "That's a few emails from this connection — try again in a few minutes." };
    if (err instanceof z.ZodError) return { ok: false, error: "Check the email address, then try again." };
    console.error("[price] email-only failed:", err);
    return { ok: false, error: "We couldn't send that just now — please try again in a minute." };
  }
}
