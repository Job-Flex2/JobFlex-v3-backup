import { ExternalCallError, externalFetch } from "@/lib/externalCall";

// Outside production a stand may point Google's geocoder at a fake (MAPS_API_BASE), as the static map and Solar
// do — the website estimator's walk (2026-10-27) prices a roof without a real key.
const MAPS_API_BASE = process.env.NODE_ENV !== "production" && process.env.MAPS_API_BASE ? process.env.MAPS_API_BASE.replace(/\/+$/, "") : "https://maps.googleapis.com";

export function isMapsEnabled() {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

/**
 * How long a Maps request may take. Not a new number: geocodeAddress below has
 * used 8 s since it was written, and it is the same kind of call — one JSON
 * lookup against the same host. The other two had NO ceiling at all, which is
 * how `geocode()` came to sit on the roof-measurement path able to hang
 * forever: it geocodes whenever the caller has no coordinates.
 */
const MAPS_TIMEOUT_MS = 8_000;

// Structured geocode for Lead Center matching — joins whatever address parts
// exist and pins them. Best-effort by design: null on disabled / no result /
// network error, and callers fall back to zip or neutral distance scoring.
// The city and the state come back from the same answer (2026-10-02): the
// homeowner wizard asks for a street and a ZIP only, and the lead fills its
// city and state from here. Either may be missing on an odd result.
export async function geocodeAddress(parts: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): Promise<{ lat: number; lng: number; city?: string; state?: string } | null> {
  const query = [parts.address, parts.city, parts.state, parts.zip]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(", ");
  if (!query || !isMapsEnabled()) return null;
  const url = new URL(`${MAPS_API_BASE}/maps/api/geocode/json`);
  url.searchParams.set("address", query);
  url.searchParams.set("region", "us");
  url.searchParams.set("key", process.env.GOOGLE_MAPS_API_KEY!);
  try {
    const res = await externalFetch("maps", "geocodeAddress", url.toString(), {}, { timeoutMs: MAPS_TIMEOUT_MS });
    const data = (await res.json()) as {
      status?: string;
      results?: {
        geometry?: { location?: { lat: number; lng: number } };
        address_components?: Array<{ long_name: string; short_name: string; types: string[] }>;
      }[];
    };
    const hit = data.results?.[0];
    const loc = hit?.geometry?.location;
    if (data.status !== "OK" || typeof loc?.lat !== "number" || typeof loc?.lng !== "number") {
      return null;
    }
    const comp = (type: string, short = false) => {
      const c = hit?.address_components?.find((a) => a.types.includes(type));
      return c ? (short ? c.short_name : c.long_name) : undefined;
    };
    return {
      lat: loc.lat,
      lng: loc.lng,
      // Same picks as geocodePlace below: the town, else the postal town or
      // the neighbourhood; the state as its two-letter code.
      city: comp("locality") ?? comp("postal_town") ?? comp("sublocality"),
      state: comp("administrative_area_level_1", true),
    };
  } catch {
    // Best-effort by contract: lead matching falls back to zip or neutral
    // distance scoring, so the reason is deliberately not surfaced here.
    return null;
  }
}

// Geocode an address string → lat/lng.
//
// This one is on the roof-measurement path — buildReconModel calls it whenever
// the caller supplied no coordinates — so its two failure modes must not be one:
//
//   null                 Google ANSWERED and has no such address. Retrying is
//                        pointless; the address itself is the problem.
//   ExternalCallError    Google did not answer (timeout, network, 5xx after
//                        retries). The address may be fine; try again later.
//
// Until 2026-08-28 both came back as null (and before that, with no ceiling at
// all, a hung request held the whole measurement). A Maps outage therefore read
// as "couldn't locate that address" — the wrong claim, inviting the user to fix
// an address that was never wrong.
//
// A THIRD failure hid inside the first until 2026-09-05: Google answers a bad
// or under-entitled key with HTTP 200 and `status: REQUEST_DENIED` (likewise
// OVER_DAILY_LIMIT, OVER_QUERY_LIMIT, INVALID_REQUEST), which has an empty
// results array and so read as "no such address". On the live deploy that
// captioned a key problem as "Couldn't locate that address" for a house the
// same code geocoded fine locally. Only ZERO_RESULTS is Google saying "no such
// place"; every other non-OK status is Google refusing to look, and it says
// why in `error_message` — so that text is what the user now sees.
export async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!isMapsEnabled()) return null;
  const url = `${MAPS_API_BASE}/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
  const res = await externalFetch("maps", "geocode", url, {}, { timeoutMs: MAPS_TIMEOUT_MS });
  const data = (await res.json()) as {
    status?: string;
    error_message?: string;
    results?: { geometry?: { location?: { lat: number; lng: number } } }[];
  };
  if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    const why = data.error_message ? ` — ${data.error_message.slice(0, 200)}` : "";
    throw new ExternalCallError(
      `Google Geocoding refused the lookup (${data.status}${why})`,
      "maps",
      "geocode",
      data.status === "REQUEST_DENIED" ? "auth" : "refused",
      res.status,
    );
  }
  const loc = data.results?.[0]?.geometry?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}

export { ExternalCallError as MapsCallError };

/**
 * A geocode that keeps the address components: the county (Google's
 * `administrative_area_level_2`) is what the HVAC estimator's design-condition
 * table is keyed on, and nothing else in the app had ever asked for it. Best
 * effort like geocodeAddress: null when Maps is off, refused, or empty.
 */
export async function geocodePlace(address: string): Promise<{
  lat: number;
  lng: number;
  county?: string;
  state?: string;
  city?: string;
  zip?: string;
  formatted?: string;
} | null> {
  const q = address.trim();
  if (!q || !isMapsEnabled()) return null;
  const url = `${MAPS_API_BASE}/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
  try {
    const res = await externalFetch("maps", "geocode", url, {}, { timeoutMs: MAPS_TIMEOUT_MS });
    const data = (await res.json()) as {
      status?: string;
      results?: Array<{
        formatted_address?: string;
        geometry?: { location?: { lat: number; lng: number } };
        address_components?: Array<{ long_name: string; short_name: string; types: string[] }>;
      }>;
    };
    const hit = data.results?.[0];
    const loc = hit?.geometry?.location;
    if (data.status !== "OK" || !loc) return null;
    const comp = (type: string, short = false) => {
      const c = hit?.address_components?.find((a) => a.types.includes(type));
      return c ? (short ? c.short_name : c.long_name) : undefined;
    };
    return {
      lat: loc.lat,
      lng: loc.lng,
      county: comp("administrative_area_level_2"),
      state: comp("administrative_area_level_1", true),
      city: comp("locality") ?? comp("postal_town") ?? comp("sublocality"),
      zip: comp("postal_code"),
      formatted: hit?.formatted_address?.replace(/,\s*USA$/, ""),
    };
  } catch {
    return null;
  }
}
