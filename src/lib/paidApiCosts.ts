// WHAT ONE PAID CALL COSTS US, IN CENTS (2026-10-02) — for the trial meter
// (lib/trialMeter) and the admin's trial list. Estimates at list price, first
// volume tier; what a call is billed by is in the comment beside it. Change a
// number here and every new record uses it; records already written keep the
// cents they were written with.
//
// Sources, read 2026-10-02:
//   Google Maps Platform — developers.google.com/maps/billing-and-pricing/pricing
//   OpenAI — list prices per 1M tokens; whisper-1 $0.006 a minute
//   ReportAll — metered package $1,875 = 15,000 parcels + 375,000 tiles
//   Regrid — self-serve overage $0.10 a parcel record
//   SerpAPI — Developer plan $75 / 5,000 searches
//   Cool Calc — $3 to $15 a Manual J report credit (pack size)
//   Twilio — $0.0083 a US segment + ~$0.004 carrier fee; local number $1.15/month
//   EagleView — the published report price runs $24.25–$87; the Property Data
//               (Instant) price per pack is the contract's and is NOT public —
//               the figure below is a placeholder until the owner puts the
//               contract price in.

export type PaidService =
  | "openai"
  | "google-solar"
  | "google-geocoding"
  | "google-static-maps"
  | "google-elevation"
  | "reportall"
  | "regrid"
  | "eagleview"
  | "serpapi"
  | "coolcalc"
  | "twilio";

export const PAID_SERVICE_LABEL: Record<PaidService, string> = {
  openai: "OpenAI",
  "google-solar": "Google Solar",
  "google-geocoding": "Google Geocoding",
  "google-static-maps": "Google Static Maps",
  "google-elevation": "Google Elevation",
  reportall: "ReportAll",
  regrid: "Regrid",
  eagleview: "EagleView",
  serpapi: "SerpAPI",
  coolcalc: "Cool Calc",
  twilio: "Twilio",
};

/** Cents per unit, by service and operation. A missing op costs nothing. */
export const UNIT_CENTS: Record<PaidService, Record<string, number>> = {
  openai: {
    // Chat calls are priced from their own token counts (OPENAI_PER_1M);
    // this is the fallback when a response carries no usage.
    chat: 3,
    "transcribe-minute": 0.6,
    // The AI desk (2026-10-13): a realtime minute on the mini model ≈ 3–5¢ (audio in
    // and out); a voice preview is a few seconds of gpt-4o-mini-tts.
    "realtime-minute": 4,
    "tts-preview": 1,
  },
  "google-solar": { buildingInsights: 1, dataLayers: 7.5, raster: 0 },
  "google-geocoding": { geocode: 0.5, geocodeAddress: 0.5 },
  "google-static-maps": { staticmap: 0.2 },
  "google-elevation": { elevation: 0.5 },
  reportall: { parcel: 12.5, tile: 0.5 },
  regrid: { parcel: 10 },
  // PLACEHOLDER — the contract price per Instant pack is not public.
  eagleview: { pack: 500, report: 4500 },
  serpapi: { search: 1.5 },
  coolcalc: { report: 1000 },
  twilio: { sms: 1.25, number: 115 },
};

/** OpenAI list prices, dollars per 1M tokens: [input, output]. */
const OPENAI_PER_1M: Array<[RegExp, number, number]> = [
  [/^gpt-4\.1-nano/, 0.1, 0.4],
  [/^gpt-4\.1-mini/, 0.4, 1.6],
  [/^gpt-4\.1/, 2, 8],
  [/^gpt-4o-mini/, 0.15, 0.6],
  [/^gpt-4o/, 2.5, 10],
  [/^gpt-5-nano/, 0.05, 0.4],
  [/^gpt-5-mini/, 0.25, 2],
  [/^gpt-5/, 1.25, 10],
  [/^o4-mini|^o3-mini/, 1.1, 4.4],
  [/^o3/, 2, 8],
];

/** Cents for one chat completion, from its usage. Unknown models price as gpt-4o. */
export function openAiChatCents(model: string, promptTokens: number, completionTokens: number): number {
  const [, inPrice, outPrice] = OPENAI_PER_1M.find(([re]) => re.test(model)) ?? [null, 2.5, 10];
  return ((promptTokens * inPrice + completionTokens * outPrice) / 1_000_000) * 100;
}

/** Cents for `units` of an operation, or 0 when it is not billed. */
export function unitCents(service: PaidService, op: string, units = 1): number {
  return (UNIT_CENTS[service]?.[op] ?? 0) * units;
}

/** "$1.23" — and "<$0.01" for a spend that rounds to nothing but is not nothing. */
export function formatSpend(cents: number): string {
  if (cents > 0 && cents < 1) return "<$0.01";
  return `$${(cents / 100).toFixed(2)}`;
}
