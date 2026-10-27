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
import type { MaterialId } from "@/lib/publicEstimate/roof";

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
