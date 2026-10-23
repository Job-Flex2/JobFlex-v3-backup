/* eslint-disable @typescript-eslint/no-unused-vars -- stand-ins keep the real signatures */
// DEMO stand-ins for @/actions/hvacEstimator, @/actions/hvacServices and
// @/actions/leadEstimate (2026-10-01). Same names, same signatures, so the
// copied form compiles against them unchanged; every answer is a fixture and
// nothing leaves the browser. The lookups answer after a short wait, so the
// form shows its "Looking up…" and "Reading…" states the way the real page
// does. The engine, the ledger and the Good · Better · Best are the real
// ones (src/lib/hvac), run in the browser as on the real page.
//
// The example house: 4418 NE 97th St, Kirkland, WA — King County's design
// day (84 °F / 26 °F), 1,980 sq ft on the assessor's record, built 1978, two
// storeys; a 3-ton AC from 2009 on an 80% furnace from 2003, 200 A panel.
// Every figure is an example and is labelled so where the form prints it.

import type { CatalogItem } from "@/lib/hvac/types";
import type { NameplateRead, SiteFacts } from "@/lib/hvac/intake";
import { calibrationStats, type CalibrationStats } from "@/lib/hvac/calibration";
import { DEFAULT_RATE_CARD, STARTER_CATALOG, normalizeRateCard, type HvacRateCard } from "@/lib/hvac/ledger";
// The address lives with the shot's clock (../hvac-timeline), which types it without loading these fixtures.
import { DEMO_ADDRESS } from "../hvac-timeline";

type Fail = { ok: false; error: string; code?: "PLAN_LIMIT_REACHED"; resource?: string };

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const EXAMPLE = "This is the example estimator — sign up and this saves to your own shop.";

// ── the house ───────────────────────────────────────────────────────────────

const RECORD = "county parcel record";
export const DEMO_SITE: SiteFacts = {
  address: DEMO_ADDRESS,
  state: "WA",
  county: "King",
  lat: 47.6991,
  lng: -122.1905,
  elevationFt: 190,
  livingSqft: 1980,
  footprintSqft: 1180,
  perimeterFt: 142,
  storeys: 2,
  yearBuilt: 1978,
  landUse: "Residential",
  sources: {
    living: RECORD,
    yearBuilt: RECORD,
    storeys: `${RECORD}: 2 storeys`,
    footprint: "building footprint (example)",
    elevation: "elevation sample (example)",
    county: "county from the address (example)",
    point: "example house",
  },
};

/** Anything typed looks up the example house: the landing has no parcel
 *  service, and the point is the flow, not the lookup. */
export async function hvacSiteFacts(_raw: unknown): Promise<{ ok: true; facts: SiteFacts; warnings: string[] } | Fail> {
  await wait(1100);
  return { ok: true, facts: structuredClone(DEMO_SITE), warnings: ["Example house — every figure here is an example. On your account the record, the footprint and the elevation are looked up for the address you type."] };
}

// ── the plates ──────────────────────────────────────────────────────────────

export const DEMO_READS: Record<"outdoor" | "indoor" | "panel", NameplateRead> = {
  outdoor: { kind: "outdoor", model: "AC13-036", serial: "0912A4471", tons: 3, seer: 13, refrigerant: "R-410A", yearMade: 2009, voltage: "208/230", mcaAmps: 22.5, confidence: "high", notes: "example plate" },
  indoor: { kind: "furnace", model: "G80-080", serial: "0309K1127", btuInput: 80000, afue: 80, yearMade: 2003, confidence: "high", notes: "example plate" },
  panel: { kind: "other", mcaAmps: 200, confidence: "high", notes: "4 free slots · example panel" },
};

export async function readHvacNameplate(raw: unknown): Promise<{ ok: true; read: NameplateRead } | Fail> {
  const hint = (raw as { hint?: "outdoor" | "indoor" | "panel" })?.hint ?? "outdoor";
  await wait(900);
  return { ok: true, read: structuredClone(DEMO_READS[hint]) };
}

// ── the shop: starter catalog, default rate card ───────────────────────────

export async function listHvacCatalog(): Promise<{ items: CatalogItem[]; own: boolean }> {
  return { items: STARTER_CATALOG, own: false };
}
export async function importHvacCatalogCsv(_raw: unknown): Promise<{ ok: true; imported: number; errors: string[]; note?: string } | { ok: false; error: string }> {
  return { ok: false, error: EXAMPLE };
}
export async function loadUsCatalog(_raw: unknown): Promise<{ ok: true; imported: number; verifiedOn: string } | { ok: false; error: string }> {
  return { ok: false, error: EXAMPLE };
}
export async function saveHvacCatalogItem(_raw: unknown): Promise<{ ok: true; item: CatalogItem } | { ok: false; error: string }> {
  return { ok: false, error: EXAMPLE };
}
export async function clearHvacCatalog(): Promise<{ ok: true } | { ok: false; error: string }> {
  return { ok: false, error: EXAMPLE };
}
export async function getHvacRateCard(): Promise<{ card: HvacRateCard; own: boolean }> {
  return { card: normalizeRateCard(DEFAULT_RATE_CARD), own: false };
}
export async function saveHvacServiceTask(_raw: unknown): Promise<{ ok: true; card: HvacRateCard; id: string } | { ok: false; error: string }> {
  return { ok: false, error: EXAMPLE };
}
export async function saveHvacRateCard(_raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  return { ok: false, error: EXAMPLE };
}
export async function setHvacServiceOverride(_raw: unknown): Promise<{ ok: true; card: HvacRateCard } | { ok: false; error: string }> {
  return { ok: false, error: EXAMPLE };
}

// ── the estimates ──────────────────────────────────────────────────────────

export interface HvacActual { tons?: number; price?: number; model?: string; notes?: string; recordedAt?: string }
export interface HvacPermit { provider: "coolcalc"; projectId: string; systemId: string; projectUrl: string; reportUrl: string; requestedAt: string; attachedAt?: string }
export interface HvacEstimateSummary {
  id: string;
  address: string;
  status: string;
  subtotal: number;
  createdAt: string;
  title: string;
  sizedTons: number | null;
  jobKind: string | null;
  actual: HvacActual | null;
  permit: "none" | "requested" | "attached";
  approvedReportUrl: string | null;
}

/** Three example estimates for the Recent plate — the status says so. */
const DEMO_RECENT: HvacEstimateSummary[] = [
  { id: "ex-1", address: "2213 142nd Pl SE, Bothell, WA 98012", status: "example", subtotal: 14206, createdAt: "2026-09-26T17:10:00.000Z", title: "AC + furnace replacement — 2213 142nd Pl SE", sizedTons: 3.5, jobKind: "replace-system", actual: null, permit: "none", approvedReportUrl: null },
  { id: "ex-2", address: "17625 Meridian Ave N, Shoreline, WA 98133", status: "example", subtotal: 16890, createdAt: "2026-09-22T21:40:00.000Z", title: "Heat pump conversion — 17625 Meridian Ave N", sizedTons: 2, jobKind: "heat-pump-conversion", actual: { tons: 2, price: 16400, recordedAt: "2026-09-24T18:00:00.000Z" }, permit: "none", approvedReportUrl: null },
  { id: "ex-3", address: "1180 5th Ave, Kirkland, WA 98033", status: "example", subtotal: 1915, createdAt: "2026-09-18T15:05:00.000Z", title: "Service — 1180 5th Ave", sizedTons: null, jobKind: "service", actual: null, permit: "none", approvedReportUrl: null },
];

export async function saveHvacEstimate(_raw: unknown): Promise<{ ok: true; id: string } | Fail> {
  await wait(500);
  return { ok: true, id: "example" };
}
export async function listHvacEstimates(): Promise<HvacEstimateSummary[]> {
  return structuredClone(DEMO_RECENT);
}
export async function hvacCalibration(): Promise<CalibrationStats> {
  return calibrationStats(DEMO_RECENT.map((r) => ({ sizedTons: r.sizedTons, subtotal: r.subtotal, actualTons: r.actual?.tons ?? null, actualPrice: r.actual?.price ?? null })));
}
export async function recordHvacActual(_raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  return { ok: false, error: EXAMPLE };
}
export async function hvacPermitStatus(): Promise<{ enabled: boolean }> {
  return { enabled: false };
}
export async function requestHvacPermitReport(_raw: unknown): Promise<{ ok: true; permit: HvacPermit; appUrl: string } | { ok: false; error: string }> {
  return { ok: false, error: EXAMPLE };
}
export async function attachHvacPermitReport(_raw: unknown): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  return { ok: false, error: EXAMPLE };
}
/** The real action's row, for the form's reopen; the demo never answers one. */
interface SavedRow {
  id: string; address: string; status: string; siteFacts: unknown; model: unknown; engine: unknown;
  draft: { job?: string; input?: unknown; outdoorKind?: string; linesetFt?: number; pick?: string; custom?: unknown; title: string; scope: string; materials: unknown[]; labor: unknown[]; assumptions: string[] };
  proposalId: string | null; approvedReportUrl: string | null; permit: HvacPermit | null; actual: HvacActual | null;
}
export async function getHvacEstimate(_id: string): Promise<{ ok: true; row: SavedRow } | { ok: false; error: string }> {
  return { ok: false, error: "An example estimate — on your account a recent estimate reopens with its house, its plates and its lines." };
}
/** The landing's convert: the form hands over to the page's proposal section. */
export async function convertHvacEstimateToProposal(_raw: unknown): Promise<{ id: string }> {
  await wait(400);
  return { id: "example" };
}
export async function startEstimateFromLead(_leadId: string, _trade: string, _fd: FormData): Promise<void> {
  return;
}
