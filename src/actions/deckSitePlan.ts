"use server";
// THE PERMIT SET'S SITE PLAN (2026-10-20): keep it, read the county, read the
// lot. Behind the same gate as the studio's printing ("full" Deck Studio).
//
// The county comes from the Census Bureau's geocoder (free, keyless): it names
// the county the address lies in, which picks the county's own design values
// (lib/deck/countyCodes). The lot comes from the county's parcel record
// (lib/parcelLookup — the cache first; ReportAll's allowance is for the life
// of the key, so it is read only when the contractor asks): the outline, the
// assessor's building footprint, the parcel number. The Census point lies on
// the street's centre line, which says which edge of the lot is the street.

import { NoOrgError, UnauthorizedError, requireEstimatorOrManager } from "@/lib/orgContext";
import { deckStudioAccess } from "@/lib/deck/access";
import { logServerError } from "@/lib/server-events";
import { censusGeocode } from "@/lib/hvac/publicGeo";
import { geocode, isMapsEnabled } from "@/lib/maps";
import { lookupParcelByPoint } from "@/lib/parcelLookup";
import { addressKey, writeSitePlan } from "@/lib/deck/sitePlanStore";
import { boxOf, lotFromRing, normalizeSitePlan, pointInPolygon, polygonArea, streetFrom, type SitePlan, type XY } from "@/lib/deck/sitePlan";

type Gate = { ok: true; organizationId: string } | { ok: false; error: string };

async function gate(): Promise<Gate> {
  try {
    const ctx = await requireEstimatorOrManager();
    const level = await deckStudioAccess(ctx.user, ctx.organizationId);
    if (level !== "full") return { ok: false, error: "The permit set is part of Deck Studio." };
    return { ok: true, organizationId: ctx.organizationId };
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, error: "Only an estimator, a manager or the owner can do this." };
    if (err instanceof NoOrgError) return { ok: false, error: "Sign in to an organization first." };
    throw err;
  }
}

/** Keep the site plan for this address. */
export async function saveDeckSitePlan(input: { address: string; plan: unknown; fallback: unknown }): Promise<{ ok: true; plan: SitePlan } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!addressKey(input.address)) return { ok: false, error: "Set the job's address first — the site plan is kept by the property." };
  const plan = normalizeSitePlan(input.plan, normalizeSitePlan(input.fallback));
  try {
    await writeSitePlan(g.organizationId, input.address, plan);
    return { ok: true, plan };
  } catch (err) {
    logServerError("deck-site-plan", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The site plan could not be saved. Try again in a moment." };
  }
}

/** The county the address lies in (the Census Bureau's geocoder), for the county's design values. */
export async function readDeckCounty(address: string): Promise<{ ok: true; county: { name: string; state: string; city: string | null } | null; street: string | null } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const text = (address ?? "").trim().slice(0, 300);
  if (text.length < 8) return { ok: false, error: "Set the job's street address first." };
  const hit = await censusGeocode(text);
  if (!hit) return { ok: true, county: null, street: null };
  // The city too (the Census geocoder's address components): a city with its own permit office reads its own figures.
  return { ok: true, county: hit.county && hit.state ? { name: hit.county, state: hit.state.toUpperCase(), city: hit.city?.trim() || null } : null, street: hit.matched ? streetFrom(hit.matched) : null };
}

/**
 * The lot from the county's parcel record, turned into the site frame: the
 * outline with its street edge along the bottom, north where it really is,
 * the assessor's building footprint as the house, the parcel number. The
 * plan comes back with them filled in; nothing is kept until it is saved.
 */
export async function readDeckLot(input: { address: string; plan: unknown; fallback: unknown }): Promise<{ ok: true; plan: SitePlan; said: string[] } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const text = (input.address ?? "").trim().slice(0, 300);
  if (text.length < 8) return { ok: false, error: "Set the job's street address first." };
  const fallback = normalizeSitePlan(input.fallback);
  const plan = normalizeSitePlan(input.plan, fallback);
  const said: string[] = [];
  try {
    // The house's point (Google's rooftop) finds the parcel; the Census point on the street says which edge faces it.
    const census = await censusGeocode(text);
    const rooftop = isMapsEnabled() ? await geocode(text).catch(() => null) : null;
    const at = rooftop ?? (census ? { lat: census.lat, lng: census.lng } : null);
    if (!at) return { ok: false, error: "The address could not be found on the map." };
    const found = await lookupParcelByPoint(at.lat, at.lng, { withRecord: true });
    if (!found.ok) {
      if (found.reason === "not-found") return { ok: false, error: "The county's parcel map has no lot at this address — type the lot's width and depth." };
      // The service's own words stay in the log; the contractor gets what to do.
      if (found.error) logServerError("deck-site-lot", new Error(found.error), { kind: "action", organizationId: g.organizationId });
      return { ok: false, error: found.reason === "disabled" ? "Reading the county's parcel map isn't set up on this account — type the lot's width and depth." : "The county's parcel map did not answer just now. Type the lot's width and depth, or try again later." };
    }
    const p = found.parcel;
    const rings = p.rings.map((r) => r.map(([lat, lng]) => ({ lat, lng })));
    const ring = rings.find((r) => insideLatLng(at, r)) ?? rings[0] ?? [];
    const turned = lotFromRing(ring, census && rooftop ? { lat: census.lat, lng: census.lng } : null, at);
    if (!turned || turned.ring.length < 3) return { ok: false, error: "The parcel record carries no usable outline — type the lot's width and depth." };
    said.push(`The lot from the county's parcel record (${found.parcel.cached ? "already on file" : "read now"})${p.parcelId ? `, parcel ${p.parcelId}` : ""}: ${Math.round(Math.abs(polygonArea(turned.ring))).toLocaleString("en-US")} sq ft.`);
    if (!turned.frontFromStreet) said.push("Which edge is the street was not certain — check that the street runs along the bottom of the site plan, and turn the lot if it does not.");
    // The house: the assessor's footprint that holds the house's point, else the largest.
    const blds: XY[][] = p.buildings.map((b) => b.map(([lat, lng]) => turned.toSite({ lat, lng }))).filter((b) => b.length >= 3);
    const pin = turned.toSite(at);
    const house = blds.find((b) => pointInPolygon(pin, b)) ?? blds.sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)))[0] ?? null;
    let houseUpdate: SitePlan["house"] = { ...plan.house, footprint: null };
    if (house) {
      const bx = boxOf(house);
      houseUpdate = { widthFt: Math.round((bx.x1 - bx.x0) * 10) / 10, depthFt: Math.round((bx.y1 - bx.y0) * 10) / 10, frontFt: Math.round(bx.y0 * 10) / 10, leftFt: Math.round(bx.x0 * 10) / 10, footprint: house };
      said.push("The house from the assessor's building footprint — the deck is set on its back wall.");
    } else said.push("The record has no building footprint: the house is drawn from the typed setbacks.");
    const next: SitePlan = {
      ...plan,
      lot: { kind: "parcel", ring: turned.ring, source: found.parcel.cached ? "cache" : "reportall", apn: p.parcelId ?? null, areaSqFt: Math.round(Math.abs(polygonArea(turned.ring))) },
      house: houseUpdate,
      northDeg: turned.northDeg,
      street: plan.street || (census?.matched ? streetFrom(census.matched) : streetFrom(text)),
      county: p.countyName && p.stateAbbr ? { name: /county|parish|borough/i.test(p.countyName) ? p.countyName : `${p.countyName} County`, state: p.stateAbbr.toUpperCase(), source: "parcel" } : census?.county && census.state ? { name: census.county, state: census.state.toUpperCase(), source: "census" } : plan.county,
    };
    return { ok: true, plan: normalizeSitePlan(next, fallback), said };
  } catch (err) {
    logServerError("deck-site-lot", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The lot could not be read. Type the lot's width and depth." };
  }
}

function insideLatLng(p: { lat: number; lng: number }, ring: Array<{ lat: number; lng: number }>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat + 1e-15) + a.lng) inside = !inside;
  }
  return inside;
}
