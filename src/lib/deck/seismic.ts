// THE SEISMIC DESIGN CATEGORY FROM THE USGS (2026-10-28, owner: "it has to adapt for any state and city"). The
// counties on file carry the category their department publishes; everywhere else the USGS design-maps web service
// answers any point in the country — ASCE 7-22, Risk Category II, site class D (the IRC's defaults) — with no key,
// in about a second. The IRC's category (Table R301.2.2.1.1) is read off S_DS, so D comes back as D0, D1 or D2 the
// way the department's own table says it. Best effort: a slow or failed read is simply no category.
export const USGS_SOURCE = "USGS seismic design web service (ASCE 7-22, Risk Category II, site class D)";

/** IRC Table R301.2.2.1.1: the category from the design spectral response acceleration at short periods. */
export function ircSdcFromSds(sds: number): string {
  if (!Number.isFinite(sds) || sds < 0) return "";
  if (sds <= 0.17) return "A";
  if (sds <= 0.33) return "B";
  if (sds <= 0.5) return "C";
  if (sds <= 0.67) return "D0";
  if (sds <= 0.83) return "D1";
  if (sds <= 1.17) return "D2";
  return "E";
}

/** The category from the service's answer: the IRC's reading of S_DS when it is there, else the ASCE letter. */
export function parseUsgsSdc(json: unknown): string | null {
  const data = (json as { response?: { data?: Record<string, unknown> } } | null)?.response?.data;
  if (!data || typeof data !== "object") return null;
  const sds = typeof data.sds === "number" ? data.sds : null;
  if (sds !== null) {
    const irc = ircSdcFromSds(sds);
    if (irc) return irc;
  }
  const letter = typeof data.sdc === "string" ? data.sdc.trim().toUpperCase() : "";
  return /^[A-F]$/.test(letter) ? letter : null;
}

export async function usgsSeismicCategory(lat: number, lng: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  try {
    const q = new URLSearchParams({ latitude: String(lat), longitude: String(lng), riskCategory: "II", siteClass: "D", title: "JobFlex deck" });
    const r = await fetch(`https://earthquake.usgs.gov/ws/designmaps/asce7-22.json?${q}`, { signal: AbortSignal.timeout(6000), cache: "no-store" });
    if (!r.ok) return null;
    return parseUsgsSdc(await r.json());
  } catch {
    return null;
  }
}
