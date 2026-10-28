import "server-only";
// THE HOUSE LOOKUP, GATE-FREE (2026-10-28, moved out of actions/hvacEstimator hvacSiteFacts): everything the server
// can learn about a site before a question is asked — the county and the point, the assessor's record (living area,
// year built, storeys), the building footprint, the elevation, a roof measurement on file. Two callers, each behind
// its own gate, brakes and caps: the dashboard's HVAC estimator and the shop's website (actions/webEstimator
// webHvacLookup). `boundary` is the fence module's parcel/OSM lookup for a footprint when the record has none —
// the dashboard passes its action; the website passes nothing and the homeowner confirms the square footage.
import { db } from "@/lib/db";
import { geocodePlace, isMapsEnabled } from "@/lib/maps";
import { censusGeocode, countyAtPoint, nominatimGeocode } from "@/lib/hvac/publicGeo";
import { elevationForPoints } from "@/lib/elevationProfile";
import { lookupParcelByPoint } from "@/lib/parcelLookup";
import { fetchRegridPoint, isRegridEnabled } from "@/lib/parcel";
import { regridRecordOf } from "@/lib/hvac/regridRecord";
import { assessorRecordAt } from "@/lib/hvac/assessors";
import { stateFromAddress } from "@/lib/pricing/salesTax";
import { pickBuilding, ringGeometry, storeysFromHeight, type BuildingRing } from "@/lib/hvac/site";
import type { SiteFacts } from "@/lib/hvac/intake";

export interface SiteLookupInput { address: string; state?: string; county?: string; lat?: number; lng?: number }
export type BoundaryLookup = (lat: number, lng: number) => Promise<{ ok: boolean; buildings: BuildingRing[]; error?: string }>;
export type SiteLookupResult = { ok: true; facts: SiteFacts; warnings: string[] } | { ok: false; error: string };

export async function lookupSiteFacts(input: SiteLookupInput, organizationId: string, opts: { boundary?: BoundaryLookup } = {}): Promise<SiteLookupResult> {
  const warnings: string[] = [];
  const facts: SiteFacts = { address: input.address.trim(), state: (input.state ?? stateFromAddress(input.address) ?? "").toUpperCase(), county: input.county, lat: input.lat, lng: input.lng, sources: {} };

  // 1 · county + point. Google first when the server has a key (rooftop
  // precision), the Census Bureau geocoder otherwise or when Google refuses
  // — it is free and keyless and answers the county in the same call. A pin
  // without a county asks the FCC block API. The badge says which answered.
  if (facts.county) facts.sources.county = "picked";
  const needPoint = facts.lat === undefined || facts.lng === undefined;
  if (needPoint || !facts.county || !facts.state) {
    const g = isMapsEnabled() ? await geocodePlace(facts.address) : null;
    if (g) {
      if (needPoint) { facts.lat = g.lat; facts.lng = g.lng; }
      if (!facts.county && g.county) { facts.county = g.county; facts.sources.county = "Google geocoder"; }
      if (!facts.state && g.state) facts.state = g.state.toUpperCase();
    }
    if (facts.lat === undefined || facts.lng === undefined || !facts.county) {
      const c = (await censusGeocode(facts.address)) ?? (await nominatimGeocode(facts.address));
      if (c) {
        const who = c.matched && /,/.test(c.matched) && !/^[0-9A-Z ,]+$/.test(c.matched) ? "OpenStreetMap geocoder" : "Census Bureau geocoder";
        if (facts.lat === undefined || facts.lng === undefined) { facts.lat = c.lat; facts.lng = c.lng; facts.sources.point = who; }
        if (!facts.county && c.county) { facts.county = c.county; facts.sources.county = who; }
        if (!facts.state && c.state) facts.state = c.state.toUpperCase();
      }
    }
    if (!facts.county && facts.lat !== undefined && facts.lng !== undefined) {
      const f = await countyAtPoint(facts.lat, facts.lng);
      if (f) { facts.county = f.county; facts.sources.county = "FCC census block"; if (!facts.state) facts.state = f.state; }
    }
    if (!facts.county) warnings.push("Couldn't resolve the county for this address — pick it so the design temperatures are the county's, not the state median.");
  }
  if (!facts.state) return { ok: false, error: "Couldn't tell the state from that address — add the state (e.g. TX)." };

  if (facts.lat === undefined || facts.lng === undefined) {
    warnings.push("No map point for this address — footprint and elevation skipped. Check the spelling, or pick it from the suggestions.");
    return { ok: true, facts, warnings };
  }

  // 2 · the assessor's record for the lot the pin is in: living area, year
  // built, storeys, county and the building polygons. First, so the footprint
  // lookup below reads the cache instead of spending a second quota.
  const parcel = await lookupParcelByPoint(facts.lat, facts.lng, { withRecord: true }).catch(() => null);
  const rec = parcel && parcel.ok ? parcel.parcel : null;
  const RECORD = "county parcel record";
  if (rec) {
    if (rec.bldgSqft && rec.bldgSqft >= 300 && rec.bldgSqft <= 20_000) { facts.livingSqft = rec.bldgSqft; facts.sources.living = RECORD; }
    if (rec.yearBuilt) { facts.yearBuilt = rec.yearBuilt; facts.sources.yearBuilt = RECORD; }
    if (rec.storeys) { facts.storeys = rec.storeys; facts.sources.storeys = `${RECORD}: ${rec.storeys} storeys`; }
    if (rec.landUseClass) facts.landUse = rec.landUseClass;
    if (!facts.county && rec.countyName) { facts.county = rec.countyName; facts.sources.county = RECORD; }
    if (!facts.state && rec.stateAbbr) facts.state = rec.stateAbbr;
    if (rec.landUseClass && !/residential/i.test(rec.landUseClass)) warnings.push(`The assessor classes this lot as ${rec.landUseClass} — the residential defaults may not fit.`);
  }

  // 2a · the county's own open-data layer, where one exists (free, keyless;
  // src/lib/hvac/assessors.ts) — the assessor's figures at the source.
  if (!facts.livingSqft || !facts.yearBuilt || !facts.storeys) {
    const ca = await assessorRecordAt(facts.state, facts.county, facts.lat, facts.lng);
    if (ca) {
      if (!facts.livingSqft && ca.livingSqft) { facts.livingSqft = ca.livingSqft; facts.sources.living = ca.source; }
      if (!facts.yearBuilt && ca.yearBuilt) { facts.yearBuilt = ca.yearBuilt; facts.sources.yearBuilt = ca.source; }
      if (!facts.storeys && ca.storeys) { facts.storeys = ca.storeys; facts.sources.storeys = `${ca.source}: ${ca.storeys} storeys`; }
      if (!facts.landUse && ca.landUse) facts.landUse = ca.landUse;
    }
  }

  // 2b · Regrid's copy of the assessor's record fills what the first source
  // lacks (Snohomish and King publish no year built or living area on any
  // public service; Regrid licenses the assessor feed). One call per lookup,
  // and the answer is written back onto the cached parcel row so the next
  // lookup of this house costs nothing.
  if ((!facts.livingSqft || !facts.yearBuilt || !facts.storeys) && isRegridEnabled()) {
    const rg = await fetchRegridPoint(facts.lat, facts.lng).then((r) => regridRecordOf(r.data)).catch(() => null);
    if (rg) {
      const RG = "Regrid parcel record";
      if (!facts.livingSqft && rg.livingSqft) { facts.livingSqft = rg.livingSqft; facts.sources.living = `${RG} (${rg.areaField === "recrdareno" ? "assessor's recorded area" : "total building area"})`; }
      if (!facts.yearBuilt && rg.yearBuilt) { facts.yearBuilt = rg.yearBuilt; facts.sources.yearBuilt = RG; }
      if (!facts.storeys && rg.storeys) { facts.storeys = rg.storeys; facts.sources.storeys = `${RG}: ${rg.storeys} storeys`; }
      if (!facts.landUse && rg.useDesc) facts.landUse = rg.useDesc;
      if (rec) {
        db.parcelCache.update({ where: { robustId: rec.robustId }, data: { ...(rec.bldgSqft ? {} : { bldgSqft: rg.livingSqft ?? null }), ...(rec.yearBuilt ? {} : { yearBuilt: rg.yearBuilt ?? null }), ...(rec.storeys ? {} : { storeys: rg.storeys ?? null }) } }).catch(() => undefined);
      }
    }
  }
  if (rec) {
    const missing = [!facts.livingSqft && "living area", !facts.yearBuilt && "year built", !facts.storeys && "storeys"].filter(Boolean);
    if (rec.enriched && missing.length) warnings.push(`The county record here doesn't carry the ${missing.join(", ")} — ${isRegridEnabled() ? "" : "a Regrid key on the server would fill them for most counties; until then "}say ${missing.length === 1 ? "it" : "them"} on the walk or type ${missing.length === 1 ? "it" : "them"}.`);
  }

  // 3 · the footprint the pin is in — the assessor's polygons when the record
  // carries them, else the parcel/OSM lookup — and 4 · elevation. Independent;
  // a failure in one leaves the other alone.
  const [site, elev] = await Promise.all([
    rec && rec.buildings.length ? Promise.resolve({ ok: true as const, buildings: rec.buildings.map((ring) => ({ ring: ring.map(([la, ln]) => ({ lat: la, lng: ln })), heightFt: null })), error: undefined as string | undefined, fromRecord: true }) : opts.boundary ? opts.boundary(facts.lat, facts.lng).then((s) => ({ ...s, fromRecord: false })).catch(() => null) : Promise.resolve(null),
    elevationForPoints([{ lat: facts.lat, lng: facts.lng }, { lat: facts.lat + 0.00002, lng: facts.lng }], organizationId).catch(() => null),
  ]);
  if (site) {
    const pick = pickBuilding(site.buildings, facts.lat, facts.lng);
    if (pick) {
      const g = ringGeometry(pick.building.ring);
      if (g.areaSqft >= 300 && g.areaSqft <= 20_000) {
        facts.footprintSqft = g.areaSqft;
        facts.perimeterFt = g.perimeterFt;
        facts.footprintEdges = g.edges;
        facts.sources.footprint = site.fromRecord ? (pick.inside ? "building outline on the parcel record" : "nearest building outline on the parcel record") : pick.inside ? "building footprint at the pin" : "nearest building footprint — confirm it is the house";
        if (!pick.inside && !site.fromRecord) warnings.push("The pin is not inside a building footprint; the nearest one was used. Confirm the area.");
        // A tagged height fills a storey count the record lacks; it never
        // overrides the assessor, and an untagged footprint (the one-storey
        // default every Regrid ring and most OSM rings carry) says nothing.
        const storeys = pick.building.heightTagged ? storeysFromHeight(pick.building.heightFt) : undefined;
        if (storeys && !facts.storeys) {
          facts.storeys = storeys;
          facts.sources.storeys = `building height ${Math.round(pick.building.heightFt ?? 0)} ft on the footprint record`;
        }
      }
    } else if (!facts.livingSqft) {
      warnings.push("No building footprint or living area on record here — say the square footage on the walk or type it.");
    }
    if (!site.ok && site.error && !/REPORTALL_CLIENT_KEY/.test(site.error)) warnings.push(site.error);
  } else if (!facts.livingSqft) {
    warnings.push("No building footprint or living area on record here — say the square footage on the walk or type it.");
  }
  if (elev && elev.ok && elev.elevFt.length) {
    facts.elevationFt = Math.round(elev.elevFt[0]);
    facts.sources.elevation = elev.source === "usgs-3dep" ? "USGS 3DEP" : "Google Elevation";
  }

  // 4 · a roof measurement on file for this address (EagleView Instant).
  try {
    const rm = await db.roofMeasurement.findFirst({
      where: { organizationId, lat: { gte: facts.lat - 0.0003, lte: facts.lat + 0.0003 }, lng: { gte: facts.lng - 0.0004, lte: facts.lng + 0.0004 } },
      orderBy: { createdAt: "desc" },
      select: { areaSqft: true, predominantPitch: true },
    });
    if (rm) {
      facts.roof = { areaSqft: rm.areaSqft ?? undefined, pitch: rm.predominantPitch ?? undefined };
      facts.sources.roof = "roof measurement on file";
    }
  } catch {
    /* column names differ on an older schema — the roof is optional */
  }

  return { ok: true, facts, warnings };
}
