"use server";

// Замер крыши — data-only (roofcore). Движок построения модели удалён:
// этот модуль ДОБЫВАЕТ и сохраняет данные — EagleView Instant (леджер
// покупок, идемпотентность, дозабор), Google Solar/DSM (бесплатно),
// регистрацию контура к растру, метрику покрытия, completeness по
// строениям, парсель-вето. modelJson остаётся полем схемы; новый код его
// НЕ пишет ("{}").
//
// THE FIRST CLICK GETS THE MEASUREMENT; THE DETAILS LAND BEHIND IT
// (2026-09-18). The area pack is ordered alone and waited for alone
// (lib/eagleviewOrder); the moment it lands the other packs are ordered and
// the click returns with them saved as `pending` — the page collects them
// without a new charge and prices nothing until they are in. Nothing pending
// is ever re-bought: a re-measure skips packs the address already has,
// complete or on the way. The one exception is an area order the provider
// has sat on for STALE_PENDING_MS: it no longer blocks the address, and the
// page offers a new, billed lookup over it. The whole action runs under one
// budget (ACTION_BUDGET_MS) below the page's maxDuration, and the elevation
// pass takes only what is left of it.

import { requireEstimatorOrManager } from "@/lib/orgContext";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { db } from "@/lib/db";
import {
  isEagleViewEnabled,
  EagleViewUnavailableError,
  PdEntitlementError,
  instantCompleteAddress,
  pollInstantResult,
  submitInstantOrder,
  fetchPropertyImage,
  mergeInstantResults,
  PD_DIAGRAM_PACKS,
  eagleViewIdentity,
  instantAddressKey,
  PD_PACK,
  type EvOrderInput,
  type InstantRoofData,
  type PdPack,
} from "@/lib/eagleview";
import { satellitePhotoPng } from "@/lib/staticMapPhoto";
import {
  collectPlacedOrders,
  hasRoof,
  ORDER_COLLECT_BUDGET_MS,
  orderPacksFor,
  packReport,
  packsFromContent,
  rowPacks,
  type OrderDeps,
  type PackReport,
  type PlacedOrder,
} from "@/lib/eagleviewOrder";
import { markPacks, readEntitlements } from "@/lib/eagleviewEntitlements";
import { getBuildingInsights, isSolarEnabled, SOLAR_CALL_BUDGET_MS, SolarUnavailableError, type SolarFailureKind } from "@/lib/solar";
import { estimateSolarRoof, type SolarRoofEstimate } from "@/lib/roofSolarEstimate";
import { geocode } from "@/lib/maps";
import { enforceRateLimit, HOUR, RateLimitError } from "@/lib/rateLimit";
import { roofMeasurementProvider } from "@/lib/roofMeasurementProvider";
import { buildReconModel, ReconUnavailableError, type ReconBuild } from "@/lib/roofReconBuild";
import { latLngRingToFrame } from "@/lib/roofRecon/surveyDsm";
import { registerContourToRaster, type Rigid2D } from "@/lib/roofRecon/register";
import { measureCoverage } from "@/lib/roofRecon/coverage";
import { measurePitch } from "@/lib/roofRecon/measuredPitch";
import { checkCompleteness } from "@/lib/roofRecon/completeness";
import { lotMaskFromPair, ringWhollyOutsideLot, type LotMask } from "@/lib/roofDiagram/parcelMask";
import { lotRingForPoint, ringWhollyOutsideLotRing } from "@/lib/lotRing";
import { areaOf, type FootprintPoint } from "@/lib/roofRecon/footprint";
import { foreignIndices, footprintRead, pickMainStructure, rowFigures } from "@/lib/roofDiagram/instantTotals";
import { toDTO, toSummary, type StoredProvenance } from "@/lib/roofDiagram/dto";
import type { MeasurementProvenance, MeasurementSource, RoofMeasurementDTO, RoofMeasurementSummary } from "@/lib/roofDiagram/types";
import { takeTrialCap } from "@/lib/trialMeter";
import { takeRoofOrderCap } from "@/lib/paidCaps";
import { requirePage } from "@/lib/customPageAccess";

type MeasureResult =
  | {
      ok: true;
      measurement: RoofMeasurementDTO;
      unsaved?: boolean;
      reusedInstant?: { requestId: string; how: "stored" | "recovered" };
      /** EagleView identity + the packs bought — for the browser console (EV_DEBUG). */
      debug?: Record<string, unknown>;
    }
  | {
      ok: false;
      error: string;
      /**
       * The aerial provider answered with no roof at this address. The paid
       * answer is kept so a plain click never re-bills; only an explicit
       * re-measure orders again.
       */
      noRoof?: boolean;
      /** A paid order is still processing — the next click collects it for free. */
      stillProcessing?: boolean;
      /** …and has been for STALE_PENDING_MS: a new, billed lookup may be ordered over it. */
      canReorder?: boolean;
      /** Typed access refusal before an order was accepted; allows provider fallback. */
      providerAccessDenied?: boolean;
      /** The company's daily ceiling on paid orders (lib/paidCaps): nothing was ordered. */
      capped?: boolean;
      debug?: Record<string, unknown>;
    };

interface LatLng {
  lat: number;
  lng: number;
}

const SOLAR_CALL_SLOTS = 2;
const RECON_DEADLINE_MS = SOLAR_CALL_SLOTS * SOLAR_CALL_BUDGET_MS;
/**
 * The whole measure action, start to save, stays under this — below the roof
 * page's maxDuration (300 s) with room for the response. The Instant phase
 * takes what it needs (placing up to seven orders, then one collect budget);
 * the elevation pass gets what is left, never less than a floor worth
 * starting; below that it is skipped and the page's free retry runs it.
 */
const ACTION_BUDGET_MS = 250_000;
const RECON_FLOOR_MS = 20_000;
/** How long a plain click waits for an AREA order an earlier click left processing; detail orders are asked once and left to the page. */
const PENDING_COLLECT_BUDGET_MS = 45_000;
/** An area order the provider has not delivered in this long no longer blocks a new, billed lookup. */
const STALE_PENDING_MS = 15 * 60_000;
/** How long the page's background collect asks about pending orders per call. */
const BACKGROUND_COLLECT_BUDGET_MS = 12_000;
/** The elevation pass re-run when a late pack changes the roof's outline or pitch. */
const LATE_RECON_DEADLINE_MS = 40_000;

// ── helpers (module-private: a "use server" file may only export async fns) ──

const errorMessage = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

/**
 * Reject `p` if it has not settled within `ms`. The underlying work is not
 * cancelled (there is no handle to cancel a plane fit); its result is simply
 * discarded, which is what the fallbacks want.
 */
function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * The ortho we hand to the vision model. Unmasked first — EagleView blurs the
 * neighbours on a masked ortho and the blur edge reads as a roof edge to a
 * vision model; any ortho with a bbox is the fallback, since without a bbox a
 * box cannot be placed in the frame at all.
 */

function reconFailureKind(err: unknown): SolarFailureKind {
  if (err instanceof SolarUnavailableError || err instanceof ReconUnavailableError) return err.kind;
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err);
  if (name === "TimeoutError" || name === "AbortError" || /abort|timed out|timeout/i.test(msg)) return "timeout";
  return "error";
}


/** A terminal Property Data verdict (failed/rejected), as opposed to "not ready yet". */
const isTerminalPdFailure = (err: unknown): boolean =>
  err instanceof Error && /^Property Data request (?!failed \()/i.test(err.message) && /fail|error|reject|cancel/i.test(err.message);

interface ObtainedInstant {
  instant: InstantRoofData;
  /** Absent when this call ordered (and paid for) a fresh lookup. */
  reuse?: { requestId: string; how: "stored" | "recovered" };
  /** Which packs the answer is made of — see MeasurementProvenance.instantPacks. */
  packs: PackReport;
}

/** The I/O the pack-by-pack planner needs, bound to this org's ledger. */
function orderDeps(organizationId: string, addressKey: string, input: EvOrderInput): OrderDeps {
  return {
    submit: (inp, packs) => submitInstantOrder(inp, packs),
    poll: (requestId, inp, completeAddress, onRaw, maxWaitMs) => pollInstantResult(requestId, inp, completeAddress, maxWaitMs, { onRaw }),
    ledger: {
      create: async (requestId, packs) => {
        console.info("[roofMeasurement] instant order placed", { requestId, packs, org: organizationId });
        await db.instantOrder.create({
          data: { organizationId, addressKey, address: input.address ?? null, requestId, packs: JSON.stringify(packs) },
        });
      },
      complete: async (requestId, instant, raw) => {
        await db.instantOrder.update({
          where: { requestId },
          data: { status: "complete", instantJson: JSON.stringify(instant), ...(raw ? { instantRawJson: raw } : {}) },
        });
      },
      fail: async (requestId, error) => {
        await db.instantOrder.update({ where: { requestId }, data: { status: "failed", error } });
      },
    },
    entitlements: { read: readEntitlements, mark: markPacks },
    isTerminalFailure: isTerminalPdFailure,
    log: (msg) => console.error("[roofMeasurement] " + msg),
  };
}

/** Every complete order for the address, oldest first, the pack-001 order first of all. */
async function completeOrdersFor(organizationId: string, addressKey: string): Promise<{ parts: InstantRoofData[]; have: string[]; requestId: string | null }> {
  const rows = await db.instantOrder.findMany({
    where: { organizationId, addressKey, status: "complete", instantJson: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  const parsed: Array<{ instant: InstantRoofData; packs: string[] }> = [];
  for (const row of rows) {
    try {
      parsed.push({ instant: JSON.parse(row.instantJson as string) as InstantRoofData, packs: rowPacks(row.packs) });
    } catch {
      /* an unreadable stored answer is skipped */
    }
  }
  parsed.sort((a, b) => Number(b.packs.includes(PD_PACK.ROOF_AREA)) - Number(a.packs.includes(PD_PACK.ROOF_AREA)));
  const have = [...new Set(parsed.flatMap((p) => p.packs))];
  return { parts: parsed.map((p) => p.instant), have, requestId: parsed[0]?.instant.requestId ?? null };
}

/** Orders for the address that were placed but not collected yet, oldest first. */
async function pendingOrdersFor(organizationId: string, addressKey: string, input: EvOrderInput): Promise<Array<PlacedOrder & { placedAt: Date }>> {
  const rows = await db.instantOrder.findMany({ where: { organizationId, addressKey, status: "pending" }, orderBy: { createdAt: "asc" } });
  const completeAddress = instantCompleteAddress(input);
  return rows.map((r) => ({ requestId: r.requestId, packs: rowPacks(r.packs) as PdPack[], completeAddress, placedAt: r.createdAt }));
}

/** What the account is currently refused, for the report of a reused answer. */
async function deniedNow(): Promise<string[]> {
  try {
    return [...(await readEntitlements()).values()].filter((r) => r.status === "denied").map((r) => r.pack);
  } catch {
    return [];
  }
}

/** The answer's parts with the roof-area part first — the merge's base. */
const areaFirst = (parts: InstantRoofData[]): InstantRoofData[] =>
  [...parts].sort((a, b) => Number(b.structures.some((s) => s.areaSqft != null)) - Number(a.structures.some((s) => s.areaSqft != null)));

/** The aerial provider answered, and the answer holds no roof. Kept, never re-billed by a plain click. */
/** The company's daily ceiling on paid orders (lib/paidCaps) — said, not thrown at the page. */
class RoofCapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoofCapError";
  }
}

class NoRoofError extends Error {
  constructor(requestId: string | null) {
    super(
      `No roof was found at this address${requestId ? ` (order ${requestId})` : ""}. Check the address and the pin; a new measurement can be ordered from the report.`,
    );
    this.name = "NoRoofError";
  }
}

/**
 * A paid order for the roof area is still processing — nothing to build on
 * yet, and no second order over it by a plain click. Once the provider has
 * sat on it for STALE_PENDING_MS the order is `stale`: the page may offer a
 * new, billed lookup, which abandons it.
 */
class StillProcessingError extends Error {
  constructor(requestId: string, readonly stale: boolean) {
    super(
      stale
        ? `This address has been measuring for over ${Math.round(STALE_PENDING_MS / 60_000)} minutes (order ${requestId}). Check again for free, or order a new measurement — billed.`
        : `This address is still being measured (order ${requestId}). Measure again in a minute — the paid order is collected then without a new charge.`,
    );
    this.name = "StillProcessingError";
  }
}

/**
 * The only place the product path gets Instant data, and the reason each click
 * is no longer a new bill:
 *
 *   1. Orders an earlier click left PROCESSING are collected first — all of
 *      them, together, under one budget — and never re-ordered over. This is
 *      the recovery half: a first click whose orders outran the wait leaves
 *      the paid results in the ledger, and the next click picks them up.
 *   2. An already-paid answer for the same address — every complete
 *      InstantOrder row for it, merged (one address is several pack orders
 *      since 2026-09-08), or the latest saved measurement's instantJson — is
 *      reused as is. Nothing is bought on this path, not even packs the
 *      address lacks: buying is a deliberate act (re-measure), and the page
 *      says which packs are missing and offers it.
 *   3. Only then is anything ordered — every pack placed up front and
 *      collected together through lib/eagleviewOrder, each accepted request
 *      written to the ledger BEFORE its first poll, because from the moment
 *      EagleView accepts an order it is billable whether or not we wait.
 *      Losing the id to a timeout exception is how two paid Snohomish lookups
 *      became unrecoverable on 2026-08-26.
 *
 * `forceNewOrder` is the explicit "re-measure at a new cost": it buys the
 * packs the address does not have yet (nothing already bought or still
 * processing is bought twice), and only when the address already has every
 * pack does it place a fresh full order.
 */
async function obtainInstant(input: EvOrderInput, organizationId: string, forceNewOrder: boolean, deadlineAt: number): Promise<ObtainedInstant> {
  const addressKey = instantAddressKey(input);
  const keyed = addressKey !== "|||";
  const deps = orderDeps(organizationId, addressKey, input);
  const owned = keyed ? await completeOrdersFor(organizationId, addressKey) : { parts: [], have: [], requestId: null };

  // 1. what an earlier click left processing. The area on the way is waited
  //    for (it is the measurement, up to PENDING_COLLECT_BUDGET_MS); detail
  //    orders on the way are asked once and left to the page's collect.
  let recovered: Array<{ instant: InstantRoofData; packs: PdPack[]; requestId: string }> = [];
  let stillPending: string[] = [];
  let pendingArea: { requestId: string; packs: PdPack[]; placedAt: Date } | null = null;
  if (keyed) {
    const open = await pendingOrdersFor(organizationId, addressKey, input);
    if (open.length) {
      const areaOnTheWay = !owned.have.includes(PD_PACK.ROOF_AREA) && open.some((o) => o.packs.includes(PD_PACK.ROOF_AREA));
      const budget = areaOnTheWay ? Math.min(PENDING_COLLECT_BUDGET_MS, Math.max(0, deadlineAt - Date.now() - RECON_FLOOR_MS)) : 0;
      const c = await collectPlacedOrders(open, input, deps, budget, areaOnTheWay ? { untilPack: PD_PACK.ROOF_AREA } : {});
      recovered = c.landed.map((l) => ({ instant: l.instant, packs: l.order.packs, requestId: l.order.requestId }));
      stillPending = c.pending.flatMap((o) => o.packs);
      const pa = c.pending.find((o) => o.packs.includes(PD_PACK.ROOF_AREA));
      if (pa) pendingArea = { requestId: pa.requestId, packs: pa.packs, placedAt: open.find((o) => o.requestId === pa.requestId)?.placedAt ?? new Date() };
    }
  }
  const have = [...new Set([...owned.have, ...recovered.flatMap((r) => r.packs)])];
  const parts = areaFirst([...owned.parts, ...recovered.map((r) => r.instant)]);
  // The area itself is still on the way: nothing to build on, and no second
  // order over it — unless the provider has sat on it past STALE_PENDING_MS
  // and the contractor explicitly orders a new lookup, which abandons it.
  if (!have.includes(PD_PACK.ROOF_AREA) && pendingArea) {
    const stale = Date.now() - pendingArea.placedAt.getTime() >= STALE_PENDING_MS;
    if (!(forceNewOrder && stale)) throw new StillProcessingError(pendingArea.requestId, stale);
    console.warn("[roofMeasurement] abandoning a stale area order for a new lookup", { requestId: pendingArea.requestId, placedAt: pendingArea.placedAt });
    await db.instantOrder
      .update({
        where: { requestId: pendingArea.requestId },
        data: { status: "failed", error: `Not delivered in ${Math.round(STALE_PENDING_MS / 60_000)} min — a new lookup was ordered over it on ${new Date().toISOString()}` },
      })
      .catch(() => {});
    const abandoned = new Set<string>(pendingArea.packs);
    stillPending = stillPending.filter((p) => !abandoned.has(p));
  }

  if (keyed && !forceNewOrder) {
    // 2a. complete orders in the ledger (and what was just collected), merged
    if (parts.length && have.includes(PD_PACK.ROOF_AREA)) {
      const instant = mergeInstantResults(parts);
      if (!hasRoof(instant)) throw new NoRoofError(instant.requestId);
      const first = recovered.find((r) => r.packs.includes(PD_PACK.ROOF_AREA)) ?? recovered[0];
      return {
        instant,
        reuse: { requestId: first?.requestId ?? owned.requestId ?? instant.requestId, how: recovered.length ? "recovered" : "stored" },
        packs: packReport(have, await deniedNow(), [], [], stillPending),
      };
    }
    // 2b. an answer already saved on a measurement row (rows predate the ledger)
    if (!parts.length) {
      const prior = await db.roofMeasurement.findMany({
        where: { organizationId, source: { not: "solar" }, instantJson: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { instantJson: true, instantRequestId: true, address: true, city: true, state: true, zip: true },
      });
      for (const row of prior) {
        if (instantAddressKey({ address: row.address ?? "", city: row.city ?? "", state: row.state ?? "", zip: row.zip ?? "" }) !== addressKey) continue;
        try {
          const parsed = JSON.parse(row.instantJson as string) as InstantRoofData;
          if (parsed.structures?.some((st) => (st.outline?.length ?? 0) >= 3)) {
            // A pre-ledger row records what the answer CONTAINS, not what was
            // asked for: the packs are read off the fields, the rest is unknown
            // — never "all seven" by assumption (audit 2026-09-09).
            const evident = packsFromContent(parsed);
            return {
              instant: parsed,
              reuse: { requestId: row.instantRequestId ?? parsed.requestId, how: "stored" },
              packs: packReport(evident.have, [], [], evident.unknown),
            };
          }
        } catch {
          /* skip unreadable rows */
        }
      }
    }
  }

  // 3. buy — every pack the address lacks, placed up front and collected
  // together. A re-measure on an address that has every pack is the one case
  // that orders everything again.
  const hasAll = PD_DIAGRAM_PACKS.every((p) => have.includes(p));
  // THE DAILY CEILINGS (2026-10-12, lib/paidCaps): an order is placed below,
  // and it is paid — 30 a day per company, a "measure again" 5 of those.
  // Everything above (a roof already measured, an order collected) is free
  // and never reaches this line.
  const cap = await takeRoofOrderCap(organizationId, forceNewOrder);
  if (!cap.ok) throw new RoofCapError(cap.error);
  const skip = forceNewOrder && hasAll ? [] : [...have, ...stillPending];
  const base = skip.length && parts.length ? mergeInstantResults(parts) : null;
  // The area order is waited for under this budget; the other packs are placed
  // once it lands and left to the page, and the elevation pass keeps its floor.
  const collectBudgetMs = Math.max(15_000, Math.min(ORDER_COLLECT_BUDGET_MS, deadlineAt - Date.now() - RECON_FLOOR_MS - 30_000));
  const { instant, report } = await orderPacksFor(input, deps, { skip, base, collectBudgetMs });
  if (!hasRoof(instant)) throw new NoRoofError(instant.requestId);
  const pendingNow = [...new Set([...(report.pending ?? []), ...stillPending.filter((p) => !report.have.includes(p))])];
  return { instant, packs: packReport(report.have, report.denied, report.failed, report.unknown ?? [], pendingNow) };
}

/** Everything the witnesses established about an answer — what persistData saves. */
interface Witnessed {
  provenance: MeasurementProvenance;
  origin: LatLng | null;
}

/** A frame-feet ring moved by the registration's rigid transform (register.ts forward). */
function applyRigid(ring: FootprintPoint[], t: Rigid2D): FootprintPoint[] {
  const c = Math.cos((t.thetaDeg * Math.PI) / 180);
  const s = Math.sin((t.thetaDeg * Math.PI) / 180);
  return ring.map((p) => ({ ...p, x: p.x * c - p.y * s + t.dxFt, y: p.x * s + p.y * c + t.dyFt }));
}

/**
 * The WITNESSES: everything the free data says about the paid answer —
 * parcel veto, the main structure, the elevation pass (registration,
 * coverage, measured pitch), completeness. One function for both the
 * measure and the late-pack collect, so a pack that lands after the row was
 * saved (the outline, the pitch) gets the same treatment as one that landed
 * on the first click (review 2026-09-17: before this, a late outline never
 * got a coverage figure or a measured pitch).
 *
 * `reconDeadlineMs` ≤ 0 skips the elevation pass and says so on the row; the
 * page's free retry runs it then.
 */
async function witnessInstant(p: {
  instant: InstantRoofData;
  input: EvOrderInput;
  packs: PackReport;
  refreshSolar: boolean;
  reconDeadlineMs: number;
}): Promise<Witnessed> {
  const { instant, input, packs } = p;
  const origin: LatLng | null = instant.lat != null && instant.lng != null ? { lat: instant.lat, lng: instant.lng } : null;
  const contours = instant.structures.map((st) => st.outline ?? []).filter((r) => r.length >= 3);

  const provenance: MeasurementProvenance = {};

  // ПАРСЕЛЬ-ВЕТО: строения целиком вне лота — BEFORE the main structure is
  // chosen, because the choice excludes vetoed structures.
  //
  // TWO WITNESSES, same safe direction (2026-09-17). EagleView's own masked /
  // unmasked ortho pair is one; the recorded lot outline — ParcelCache, then
  // ReportAll, then Regrid only if ReportAll has no parcel here — is the other.
  // The pair is not always there (it needs two ortho images over the pin that
  // differ only by the mask) and at 12117 202nd St SE it produced nothing,
  // leaving nineteen outbuildings looking like part of the property. Either
  // witness may veto, and each only ever vetoes a structure EVERY vertex of
  // which falls outside the lot: keeping a neighbour's shed is a visible
  // mistake, dropping a real roof is an expensive one.
  const lot = await lotMaskFor(instant, origin);
  const lotRing = origin
    ? await lotRingForPoint(origin.lat, origin.lng)
    : { ring: [] as { lat: number; lng: number }[], source: "none" as const };
  provenance.parcelSource = lotRing.source;
  const haveOutline = lotRing.ring.length >= 3;
  console.log(
    `[roofMeasurement] lot boundary: ${lotRing.source}` +
      (haveOutline ? ` (${lotRing.ring.length} points)` : " — no outline") +
      `, imagery mask: ${lot ? "yes" : "no"}`,
  );
  if (origin && (lot || haveOutline)) {
    const foreign: string[] = [];
    let byMask = 0;
    let byOutline = 0;
    instant.structures.forEach((st, i) => {
      const ring = st.outline ?? [];
      if (ring.length < 3) return;
      const outsideMask = lot ? ringWhollyOutsideLot(lot, ring) : false;
      const outsideOutline = haveOutline ? ringWhollyOutsideLotRing(lotRing.ring, ring) : false;
      if (!outsideMask && !outsideOutline) return;
      if (outsideMask) byMask += 1;
      if (outsideOutline) byOutline += 1;
      foreign.push("s" + i);
    });
    if (foreign.length) {
      (provenance as Record<string, unknown>).parcelVeto = {
        foreignStructures: foreign,
        /* Which witness saw what, so a veto can be argued with. */
        by: { imageryMask: byMask, lotOutline: byOutline, source: lotRing.source },
      };
      console.log(
        `[roofMeasurement] parcel veto: ${foreign.length} of ${instant.structures.length} structures are off the lot ` +
          `(imagery mask ${byMask}, lot outline ${byOutline} via ${lotRing.source})`,
      );
    }
  }

  // THE MAIN STRUCTURE (audit 2026-09-08). EagleView answers with every
  // structure on the parcel (12117: the house and nineteen outbuildings);
  // the row's figures, the hero, the estimate — and every witness below:
  // registration, coverage, measured pitch, completeness — are about ONE of
  // them. The rest are listed on the page with checkboxes.
  const veto = (provenance as Record<string, unknown>).parcelVeto as { foreignStructures?: string[] } | undefined;
  const pick = pickMainStructure(instant.structures, {
    foreign: foreignIndices(veto?.foreignStructures),
    origin,
    // Either witness counts as knowing where the lot is.
    parcelKnown: lot != null || haveOutline,
  });
  const mainSt = pick.index != null ? instant.structures[pick.index] : null;
  if (pick.index != null) {
    const others = instant.structures.filter((_, i) => i !== pick.index);
    provenance.mainStructure = {
      index: pick.index,
      how: pick.how,
      others: others.length,
      othersSqft: Math.round(others.reduce((a, s) => a + (s.areaSqft ?? 0), 0)),
    };
  }
  // Which footprint the estimate will price on, recorded where it can be read
  // back: EagleView's figure, or the building's own outline when the two
  // disagree by more than a tenth (audit 2026-09-17, 12117 202nd St SE).
  if (mainSt) {
    const fp = footprintRead(mainSt);
    if (fp.sqft != null) {
      provenance.footprintSource = {
        source: fp.source,
        sqft: Math.round(fp.sqft),
        reportedSqft: fp.reportedSqft != null ? Math.round(fp.reportedSqft) : null,
        outlineSqft: fp.outlineSqft != null ? Math.round(fp.outlineSqft) : null,
        deltaPct: fp.delta != null ? Math.round(fp.delta * 1000) / 10 : null,
      };
    }
  }
  const mainOutline = mainSt?.outline && mainSt.outline.length >= 3 ? mainSt.outline : contours[0] ?? null;

  // DSM/Solar (бесплатно): покрытие и регистрация; отказ не валит замер
  let recon: ReconBuild | null = null;
  if (!isSolarEnabled()) {
    provenance.reconUnavailable = { kind: "unreachable" as SolarFailureKind, message: "Google Solar is not configured" };
  } else if (p.reconDeadlineMs < RECON_FLOOR_MS) {
    provenance.reconUnavailable = {
      kind: "timeout",
      message: "The aerial order used the time this measurement had; the elevation check was not started. Measure again (free) to add it.",
    };
  } else {
    try {
      recon = await withDeadline(
        buildReconModel({
          ...input,
          ...(p.refreshSolar ? { refreshSolar: true } : {}),
          ...(contours.length ? { contours } : {}),
        }),
        Math.min(RECON_DEADLINE_MS, p.reconDeadlineMs),
        "Roof reconstruction data",
      );
    } catch (err) {
      provenance.reconUnavailable = { kind: reconFailureKind(err), message: errorMessage(err, String(err)) };
    }
  }

  if (recon) {
    provenance.imageryQuality = recon.layers.imageryQuality;
    // Solar hands the capture date as {year, month, day} — stringify it as an
    // ISO day, not String(object) (which stored "[object Object]").
    const d = recon.layers.imageryDate;
    provenance.imageryDate = d?.year
      ? `${d.year}-${String(d.month ?? 0).padStart(2, "0")}-${String(d.day ?? 0).padStart(2, "0")}`
      : undefined;
    provenance.pixelSizeM = recon.dsm.pixelSizeM;
    provenance.googleAreaSqft = recon.googleAreaSqft ?? null;
    provenance.googleSegmentCount = recon.googleSegmentCount ?? null;
    // The raster's frame has its origin at the pin the tile was fetched
    // around (recon.origin) — the Places pin, or the cached tile's — not at
    // EagleView's own lat/lng. Rings are converted into THAT frame; the
    // registration then says how far the outline sits from the roof the
    // raster shows, and coverage is measured on the registered outline
    // (review 2026-09-17: before this, rings converted from the other pin
    // were measured unregistered, and a few metres of offset read as roof
    // the elevation data "did not see").
    const ring0: FootprintPoint[] | null = mainOutline ? (latLngRingToFrame(recon.origin, mainOutline).ring as FootprintPoint[]) : null;
    let mainContours: FootprintPoint[][] = ring0 ? [ring0] : contours.map((r) => latLngRingToFrame(recon!.origin, r).ring as FootprintPoint[]);
    let regT: Rigid2D | null = null;
    if (ring0) {
      try {
        const reg = registerContourToRaster({
          contour: ring0,
          mask: recon.mask as never,
          dsm: recon.dsm as never,
          groundElevFt: recon.diagnostics.groundElevFt,
        });
        if (reg.applied) {
          regT = reg.transform;
          provenance.registration = {
            dxFt: reg.transform.dxFt,
            dyFt: reg.transform.dyFt,
            thetaDeg: reg.transform.thetaDeg,
          } as unknown as MeasurementProvenance["registration"];
        }
      } catch {
        /* регистрация — свидетель, не условие */
      }
    }
    if (regT) mainContours = mainContours.map((r) => applyRigid(r, regT!));
    const cov = measureCoverage({
      mask: recon.mask as never,
      dsm: recon.dsm as never,
      groundElevFt: recon.diagnostics.groundElevFt,
      rings: mainContours,
    });
    if (cov) provenance.coverage = { seenSqft: cov.seenSqft, contourSqft: cov.contourSqft, share: cov.share, insetShare: cov.insetShare };

    // ── measured pitch — the retired line's proven DSM measurement (cells →
    // plane court → consistency), data-only. The report is stored whole; the
    // page decides how to word it. pitchSource mirrors the verdict in the
    // shape confidence.ts already reads. measurePitch applies the transform
    // itself, so it takes the unregistered rings.
    try {
      const pitchLabel = mainSt?.pitch ?? instant.totals.pitchLabel;
      const instantPitch12 = pitchLabel ? Number(pitchLabel.split("/")[0]) : null;
      const solarPanels = mainSt ? mainSt.solarPanels === true : instant.structures.some((st) => st.solarPanels === true);
      const pitchRep = measurePitch({
        dsm: recon.dsm as never,
        contours: ring0 ? [ring0] : contours.map((r) => latLngRingToFrame(recon!.origin, r).ring as FootprintPoint[]),
        transform: regT,
        instantPitch12,
        solarPanels,
        coverageShare: cov?.share ?? null,
      });
      (provenance as Record<string, unknown>).pitchMeasurement = {
        ...pitchRep,
        instantPitch12,
        // Known case (12629/12621 published 6/12, measured ≈7.1): a gap over
        // 1/12 between the measured dominant and the published figure is worth
        // a line in the source status.
        disagrees:
          pitchRep.source === "measured" &&
          instantPitch12 != null &&
          Math.abs(pitchRep.families[0].pitch12 - instantPitch12) > 1,
      };
      provenance.pitchSource = {
        source: pitchRep.source,
        reason: pitchRep.reason,
        trustedShare: pitchRep.trustedShare,
        instantPitch12,
        ...(solarPanels ? { solarPanels } : {}),
      } as unknown as MeasurementProvenance["pitchSource"];
    } catch (err) {
      console.warn("[roofMeasurement] pitch measurement failed:", errorMessage(err, String(err)));
    }
  }

  // completeness по строениям (контуры против Instant)
  //
  // Without pack 007 no structure has a ring; that is "outline not
  // purchased", a warn, never the LOW CONFIDENCE "building missing" verdict
  // that would disable pricing on figures that are complete.
  const frameOrigin = recon?.origin ?? origin;
  const mainFrame = frameOrigin && mainOutline ? (latLngRingToFrame(frameOrigin, mainOutline).ring as FootprintPoint[]) : null;
  const planAreaSqft = mainFrame ? Math.abs(areaOf(mainFrame)) : 0;
  const completeness = checkCompleteness({
    mainIndex: pick.index,
    planAreaSqft,
    structures: instant.structures.map((st, i) => {
      const fr = frameOrigin && st.outline && st.outline.length >= 3 ? (latLngRingToFrame(frameOrigin, st.outline).ring as FootprintPoint[]) : null;
      return {
        prefix: "s" + i,
        ring: fr,
        contourAreaSqft: fr ? Math.abs(areaOf(fr)) : 0,
      };
    }),
    instant,
    // No outline is not a lost building when the outline pack was never
    // bought — or is still on its way: refused, not attempted or pending →
    // a note, not an error.
    outlinesNotPurchased: !packs.have.includes(PD_PACK.OUTLINES),
  });
  provenance.completeness = {
    findings: completeness.findings,
    planSqft: completeness.planSqft,
    instantSqft: (completeness as unknown as { instantSqft?: number | null }).instantSqft ?? null,
  } as unknown as MeasurementProvenance["completeness"];
  provenance.instantPacks = packs;

  return { provenance, origin };
}

/**
 * Collect the packs EagleView had not finished when the measurement was
 * saved. Since 2026-09-18 this is the rule, not the exception: the first
 * click waits for the area alone and returns the moment it lands, with the
 * detail packs saved as `pending` on the row, and the page calls this every
 * few seconds for about two minutes until they are in. Each
 * pending order is asked about briefly; what has landed is merged into the
 * saved row (columns, packs report and all) and, when a pack the witnesses
 * read landed (the outline, the pitch, the details), the elevation pass is
 * re-run so the row gets its coverage and measured pitch the way a first-
 * click answer does. Nothing is ordered.
 */
export async function collectPendingInstant(measurementId: string): Promise<
  | { ok: true; pending: number; updated: false }
  | { ok: true; pending: number; updated: true; measurement: RoofMeasurementDTO }
  | { ok: false; error: string }
> {
  let organizationId: string;
  try {
    organizationId = (await requireEstimatorOrManager()).organizationId;
    await requirePage(organizationId, "roof-estimator");
  } catch (err) {
    return { ok: false, error: errorMessage(err, "Not authorised") };
  }
  const row = await db.roofMeasurement.findFirst({ where: { id: measurementId, organizationId } });
  if (!row) return { ok: false, error: "Measurement not found" };
  // A Google result must never be merged with an unrelated EagleView order.
  if (row.source === "solar") return { ok: true, pending: 0, updated: false };
  const input: EvOrderInput = {
    address: row.address ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    zip: row.zip ?? "",
    lat: row.lat ?? undefined,
    lng: row.lng ?? undefined,
  };
  const addressKey = instantAddressKey(input);
  if (addressKey === "|||") return { ok: true, pending: 0, updated: false };
  // SELF-HEAL THE FACET COUNT (2026-10-16): the measured data sometimes
  // comes back without structure_roof_facet_count at all — the tile sat
  // on "—" forever. When the row has no measured count and the witnesses
  // never kept Google's segment count, one building-insights call fills
  // the ESTIMATE the page then shows as "≈N". Once per row (0 = Google
  // saw none — tried, nothing there); an API failure leaves null so a
  // later open may try again. Never touches the measured column.
  let healed: typeof row | null = null;
  if (row.facetCount == null && row.lat != null && row.lng != null && isSolarEnabled()) {
    try {
      const storedP = row.provenanceJson ? (JSON.parse(row.provenanceJson) as Partial<StoredProvenance>) : null;
      const prov = (storedP?.provenance ?? {}) as MeasurementProvenance;
      if (prov.googleSegmentCount == null) {
        const insights = await getBuildingInsights(row.lat, row.lng);
        prov.googleSegmentCount = insights?.segments?.length ?? 0;
        healed = await db.roofMeasurement.update({
          where: { id: row.id },
          data: { provenanceJson: JSON.stringify({ calibration: storedP?.calibration ?? null, provenance: prov }) },
        });
      }
    } catch (err) {
      console.warn("[roofMeasurement] facet-estimate heal skipped:", errorMessage(err, String(err)));
    }
  }
  const open = await pendingOrdersFor(organizationId, addressKey, input);
  if (!open.length) {
    // Nothing on order — but a healed estimate is still news the page
    // should swap in rather than keep its "—".
    if (healed) return { ok: true, pending: 0, updated: true, measurement: toDTO(healed) };
    return { ok: true, pending: 0, updated: false };
  }

  const deps = orderDeps(organizationId, addressKey, input);
  const c = await collectPlacedOrders(open, input, deps, BACKGROUND_COLLECT_BUDGET_MS);
  const stillPending = c.pending.flatMap((o) => o.packs);
  if (!c.landed.length && !c.failed.length) return { ok: true, pending: c.pending.length, updated: false };

  // Merge what landed into the saved answer — the stored answer is the base,
  // every null field takes the first later part's value (mergeInstantResults).
  let stored: InstantRoofData | null = null;
  try {
    stored = row.instantJson ? (JSON.parse(row.instantJson) as InstantRoofData) : null;
  } catch {
    stored = null;
  }
  const landed = c.landed.map((l) => l.instant);
  const merged = landed.length ? mergeInstantResults(stored ? [stored, ...landed] : areaFirst(landed)) : stored;
  if (!merged) return { ok: true, pending: c.pending.length, updated: false };

  let storedProv: StoredProvenance = { calibration: null, provenance: {} as MeasurementProvenance };
  try {
    const parsed = row.provenanceJson ? (JSON.parse(row.provenanceJson) as Partial<StoredProvenance>) : null;
    if (parsed && typeof parsed === "object") storedProv = { calibration: parsed.calibration ?? null, provenance: (parsed.provenance ?? {}) as MeasurementProvenance };
  } catch {
    /* unreadable provenance — rebuilt below with what is known */
  }
  const owned = await completeOrdersFor(organizationId, addressKey);
  const prior = storedProv.provenance.instantPacks;
  const packs = packReport(owned.have, await deniedNow(), [...(prior?.failed ?? []), ...c.failed.flatMap((o) => o.packs)], prior?.unknown ?? [], stillPending);

  // A late outline, pitch or details pack changes what the witnesses see:
  // re-run them, keeping what only the first click knew (the reuse note).
  const landedPacks = new Set(c.landed.flatMap((l) => l.order.packs));
  const witnessed = [PD_PACK.OUTLINES, PD_PACK.PITCH_EAVE, PD_PACK.PROPERTY_DETAILS, PD_PACK.ORTHO].some((p) => landedPacks.has(p));
  let provenance = storedProv.provenance;
  let origin: LatLng | null = row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : null;
  if (witnessed) {
    try {
      const w = await witnessInstant({ instant: merged, input, packs, refreshSolar: false, reconDeadlineMs: LATE_RECON_DEADLINE_MS });
      provenance = { ...w.provenance, ...(storedProv.provenance.instantReuse ? { instantReuse: storedProv.provenance.instantReuse } : {}) };
      origin = w.origin ?? origin;
    } catch (err) {
      console.warn("[roofMeasurement] late witnesses failed, keeping the saved ones:", errorMessage(err, String(err)));
      provenance = { ...storedProv.provenance, instantPacks: packs };
    }
  } else {
    provenance = { ...storedProv.provenance, instantPacks: packs };
  }
  storedProv = { calibration: storedProv.calibration, provenance };

  const fig = rowFigures({
    instant: merged,
    provenance: provenance as unknown as Record<string, unknown>,
    columns: { areaSqft: row.areaSqft, squares: row.squares, lat: row.lat, lng: row.lng },
  });
  const updated = await db.roofMeasurement.update({
    where: { id: row.id },
    data: {
      areaSqft: fig.areaSqft,
      squares: fig.squares,
      predominantPitch: fig.predominantPitch,
      facetCount: fig.facetCount,
      lat: row.lat ?? origin?.lat ?? merged.lat ?? null,
      lng: row.lng ?? origin?.lng ?? merged.lng ?? null,
      instantJson: JSON.stringify(merged),
      provenanceJson: JSON.stringify(storedProv),
    },
  });
  return { ok: true, pending: c.pending.length, updated: true, measurement: toDTO(updated) };
}

// ── actions ──────────────────────────────────────────────────────────────────

/**
 * Instant measure: one billed EagleView Instant lookup + the free reconstruction,
 * run together, calibrated, chimney-scanned and saved.
 */

async function lotMaskFor(instant: InstantRoofData, origin: LatLng | null): Promise<LotMask | null> {
  if (!origin) return null;
  const groups = new Map<string, typeof instant.imagery>();
  for (const im of instant.imagery) {
    if (im.view !== "ortho" || !im.bbox || typeof im.masked !== "boolean") continue;
    const [a, b, c, d] = im.bbox;
    if (!(origin.lng >= a && origin.lng <= c && origin.lat >= b && origin.lat <= d)) continue;
    const k = im.bbox.join(",");
    groups.set(k, [...(groups.get(k) ?? []), im]);
  }
  const area = (b: [number, number, number, number]) => (b[2] - b[0]) * (b[3] - b[1]);
  const pair = [...groups.values()]
    .filter((g) => g.some((i) => i.masked) && g.some((i) => !i.masked))
    .sort((x, y) => area(y[0].bbox!) - area(x[0].bbox!))[0];
  if (!pair) return null;
  try {
    const fetched = await withDeadline(
      Promise.all([
        fetchPropertyImage(pair.find((i) => !i.masked)!.token),
        fetchPropertyImage(pair.find((i) => i.masked)!.token),
      ]),
      8_000,
      "Parcel mask imagery",
    );
    return lotMaskFromPair(new Uint8Array(fetched[0].bytes), new Uint8Array(fetched[1].bytes), pair[0].bbox!);
  } catch (err) {
    console.warn("[roofMeasurement] parcel mask unavailable:", errorMessage(err, String(err)));
    return null;
  }
}

async function persistData(p: {
  organizationId: string;
  createdById: string;
  source: MeasurementSource;
  input: EvOrderInput;
  origin: LatLng | null;
  instant: InstantRoofData | null;
  provenance: MeasurementProvenance;
}): Promise<RoofMeasurementDTO> {
  // The row's figures are the MAIN structure's, and the pitch column is the
  // pitch the page shows (measured families when there are any), so the
  // Recent list and the hero cannot disagree (audit 2026-09-08).
  const fig = rowFigures({
    instant: p.instant,
    provenance: p.provenance as Record<string, unknown>,
    columns: { areaSqft: null, squares: null, lat: p.origin?.lat ?? null, lng: p.origin?.lng ?? null },
  });
  const stored: StoredProvenance = { calibration: null, provenance: p.provenance };
  const row = await db.roofMeasurement.create({
    data: {
      organizationId: p.organizationId,
      createdById: p.createdById,
      source: p.source,
      address: p.input.address ?? p.instant?.address ?? null,
      city: p.input.city ?? null,
      state: p.input.state ?? null,
      zip: p.input.zip ?? null,
      lat: p.origin?.lat ?? p.instant?.lat ?? null,
      lng: p.origin?.lng ?? p.instant?.lng ?? null,
      areaSqft: fig.areaSqft,
      squares: fig.squares,
      predominantPitch: fig.predominantPitch,
      facetCount: fig.facetCount,
      instantRequestId: p.source === "solar" ? null : p.instant?.requestId ?? null,
      instantJson: p.instant ? JSON.stringify(p.instant) : null,
      // движок удалён: геометрия не пишется, поле схемы не тронуто
      modelJson: "{}",
      chimneyJson: "[]",
      provenanceJson: JSON.stringify(stored),
    },
  });
  return toDTO(row);
}

/**
 * What the contractor reads when the aerial order fails. The full message —
 * account, client id, host — stays in the console debug line; the toast
 * says what happened in one plain sentence (review 2026-09-17: the first
 * thing a contractor saw on a failed first measurement was a raw 401 body).
 */
function userFacingInstantError(err: unknown): string {
  if (err instanceof NoRoofError || err instanceof StillProcessingError) return err.message;
  const msg = errorMessage(err, "");
  if (/not entitled|entitlement|403/i.test(msg)) return "This order was refused: the account is not entitled to roof-area measurements. This is an account setting, not the address.";
  if (/credentials|invalid_client|401|sandbox app/i.test(msg)) return "The measurement service rejected our credentials. This is a setup problem on our side, not the address.";
  if (/taking longer|still processing/i.test(msg)) return msg.replace(/\s*Account org.*$/s, "");
  if (/timed out|timeout|abort/i.test(msg)) return "The measurement did not come back in time. Nothing was lost — measure again in a minute; any order that was placed is collected without a new charge.";
  if (/no request id|nothing to measure/i.test(msg)) return "No roof data came back for this address.";
  return "This address could not be measured" + (msg ? ` (${msg.replace(/\s*Account org.*$/s, "").slice(0, 140)})` : "") + ".";
}

/**
 * Замер: добыть Instant (леджер/идемпотентность/дозабор), добыть
 * DSM/Solar (бесплатно), зарегистрировать контур к растру, померить
 * покрытие и completeness, применить парсель-вето — и сохранить ДАННЫЕ.
 * Чертёж не строится.
 */
export async function measureRoofInstant(
  input: EvOrderInput,
  opts?: { forceNewOrder?: boolean },
): Promise<MeasureResult> {
  let organizationId: string;
  let userId: string;
  try {
    const ctx = await requireEstimatorOrManager();
    await requirePage(ctx.organizationId, "roof-estimator");
    organizationId = ctx.organizationId;
    userId = ctx.user.id;
  } catch (err) {
    return { ok: false, error: errorMessage(err, "Not authorised") };
  }
  if (!isEagleViewEnabled()) return { ok: false, error: "Roof measurement is not configured" };
  if (!input.address && input.lat == null) return { ok: false, error: "Pick an address first" };
  // The card-less trial's ceilings (lib/trialMeter): a measurement is one
  // roof measurement — given back below when a stored order answers it — and
  // a paid re-measure is an EagleView order, which needs a card.
  const trial = await takeTrialCap(organizationId, opts?.forceNewOrder ? "eagleViewOrders" : "roofMeasurements");
  if (!trial.ok) return trial.failure;
  const deadlineAt = Date.now() + ACTION_BUDGET_MS;

  // Instant: через леджер заказов (переиспользование, дозабор, покупка)
  let instant: InstantRoofData;
  let reuse: { requestId: string; how: "stored" | "recovered" } | undefined;
  let packs: PackReport;
  try {
    const got = await obtainInstant(input, organizationId, opts?.forceNewOrder === true, deadlineAt);
    instant = got.instant;
    reuse = got.reuse;
    packs = got.packs;
    if (reuse) await trial.refund();
  } catch (err) {
    // Over the company's daily ceiling: nothing was ordered, the trial's
    // allowance goes back, and the person reads why.
    if (err instanceof RoofCapError) {
      await trial.refund();
      return { ok: false, error: err.message, capped: true };
    }
    const debug = { ...eagleViewIdentity(), stage: "instant order", error: errorMessage(err, String(err)) };
    console.warn("[roofMeasurement] instant failed", debug);
    // Only submission/auth refusals are safe to refund or switch providers.
    // Pending/no-roof errors contain paid order IDs, which may include 401/403.
    const providerAccessDenied = !(err instanceof NoRoofError) && !(err instanceof StillProcessingError) &&
      (err instanceof PdEntitlementError || (err instanceof EagleViewUnavailableError &&
        err.kind === "auth" && (err.op === "auth" || err.op === "property request")));
    // A refused provider lookup produced no measurement. In particular, a
    // Google fallback must not consume a second trial measurement allowance.
    if (providerAccessDenied) await trial.refund();
    return {
      ok: false,
      error: userFacingInstantError(err),
      providerAccessDenied,
      ...(err instanceof NoRoofError ? { noRoof: true } : {}),
      ...(err instanceof StillProcessingError ? { stillProcessing: true, ...(err.stale ? { canReorder: true } : {}) } : {}),
      debug,
    };
  }
  const debug = { ...eagleViewIdentity(), packs, reused: reuse ?? null, requestId: instant.requestId };

  // The witnesses take what is left of the budget; the elevation pass is
  // skipped (and said so) when the order used it up.
  const { provenance, origin } = await witnessInstant({
    instant,
    input,
    packs,
    refreshSolar: opts?.forceNewOrder === true,
    reconDeadlineMs: deadlineAt - Date.now(),
  });
  if (reuse) provenance.instantReuse = reuse;

  try {
    const measurement = await persistData({
      organizationId,
      createdById: userId,
      source: "instant+recon",
      input,
      origin,
      instant,
      provenance,
    });
    const where = [input.address, input.city, input.state].map((s) => s?.trim()).filter(Boolean).join(", ") || (input.lat != null && input.lng != null ? `${input.lat.toFixed(5)}, ${input.lng.toFixed(5)}` : "the map pin");
    await logActivity({
      organizationId,
      actorId: userId,
      kind: TRAIL_KINDS.ESTIMATE,
      summary: reuse
        ? `Measured the roof at ${where} from the ${reuse.how} aerial order`
        : `Ordered an aerial roof measurement at ${where}`,
      meta: { trade: "roof", measurementId: measurement.id, address: where, requestId: instant.requestId, reused: !!reuse, packs },
    });
    return { ok: true, measurement, ...(reuse ? { reusedInstant: reuse } : {}), debug };
  } catch (err) {
    console.warn("[roofMeasurement] row not saved:", errorMessage(err, String(err)));
    return { ok: false, error: "Measured, but the row could not be saved", debug };
  }
}

/** Numeric adapter for the existing takeoff contract, explicitly attributed by source/provenance. */
function solarRoofData(estimate: SolarRoofEstimate, input: EvOrderInput): InstantRoofData {
  const structure = {
    areaSqft: estimate.areaSqft, squares: estimate.areaSqft / 100,
    pitch: estimate.pitchLabel, footprintSqft: estimate.footprintSqft,
    eaveHeightFt: null, outline: null, facetCount: null, shape: null,
    material: null, conditionRating: null, roofAgeYears: null, chimney: null,
    solarPanels: null, rooftopAcCount: null, occlusion: null, treeOverhang: null,
    confidence: null, materialRings: null,
  };
  return {
    requestId: "", address: instantCompleteAddress(input),
    lat: estimate.center.lat, lng: estimate.center.lng,
    structures: [structure], imagery: [],
    totals: {
      areaSqft: estimate.areaSqft, squares: estimate.areaSqft / 100,
      predominantPitch: estimate.predominantPitch12, pitchLabel: estimate.pitchLabel,
      maxEaveFt: null, facetCount: null, footprintSqft: estimate.footprintSqft,
    },
  };
}

/** Google-only preliminary estimate. No EagleView orders, schema changes or AI dimensions. */
export async function measureRoofSolar(input: EvOrderInput): Promise<MeasureResult> {
  const { organizationId, user } = await requireEstimatorOrManager();
  await requirePage(organizationId, "roof-estimator");
  return solarMeasure(input, organizationId, user.id, "take");
}

/**
 * The Google measurement itself. Module-private, so the trial allowance can
 * only be waived from the server: "covered" when this click already spent its
 * allowance on an EagleView answer that held no roof.
 */
async function solarMeasure(input: EvOrderInput, organizationId: string, userId: string, trialMode: "take" | "covered"): Promise<MeasureResult> {
  if (!isSolarEnabled()) return { ok: false, error: "Google aerial measurement is not configured for this account." };
  if (!input || typeof input.address !== "string" || input.address.length > 500 ||
      [input.city, input.state, input.zip].some(v => typeof v !== "string" || v.length > 200)) {
    return { ok: false, error: "Choose a valid street address first." };
  }
  const validPin = (lat: unknown, lng: unknown): boolean =>
    typeof lat === "number" && Number.isFinite(lat) && Math.abs(lat) <= 90 &&
    typeof lng === "number" && Number.isFinite(lng) && Math.abs(lng) <= 180;
  if ((input.lat != null || input.lng != null) && !validPin(input.lat, input.lng)) {
    return { ok: false, error: "The map pin is invalid. Select the address again." };
  }
  if (!input.address.trim() && input.lat == null) return { ok: false, error: "Choose an address first." };
  try {
    await enforceRateLimit(`roof-solar:${organizationId}`, 30, HOUR, "aerial roof estimates");
    // Reopening the same estimate should not buy another Google lookup. Match
    // both the address and supplied pin, never another organization's row.
    const prior = await db.roofMeasurement.findFirst({
      where: {
        organizationId, source: "solar", address: input.address,
        city: input.city, state: input.state, zip: input.zip,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (prior) {
      const measurement = toDTO(prior);
      const requestedPin = measurement.provenance.solarRequestedPin;
      const samePin = input.lat == null || input.lng == null || (requestedPin &&
        Math.abs(requestedPin.lat - input.lat) <= 0.00001 && Math.abs(requestedPin.lng - input.lng) <= 0.00001);
      if (measurement.provenance.solar && samePin) return { ok: true, measurement };
    }
    if (trialMode === "take") {
      const trial = await takeTrialCap(organizationId, "roofMeasurements");
      if (!trial.ok) return trial.failure;
    }
    const pin = input.lat != null && input.lng != null
      ? { lat: input.lat, lng: input.lng }
      : await geocode(instantCompleteAddress(input));
    if (!pin || !validPin(pin.lat, pin.lng)) return { ok: false, error: "Couldn't locate that house. Select a complete street address." };
    const result = estimateSolarRoof(await getBuildingInsights(pin.lat, pin.lng), pin);
    if (!result.ok) return result;
    const estimate = result.estimate;
    const measurement = await persistData({
      organizationId, createdById: userId, source: "solar", input,
      // Every downstream photo (including proposal/PDF) uses the selected
      // building, while the original request pin stays available for reuse.
      origin: estimate.center, instant: solarRoofData(estimate, input),
      provenance: { solar: estimate, solarRequestedPin: pin, imageryQuality: estimate.imageryQuality, ...(estimate.imageryDate ? { imageryDate: estimate.imageryDate } : {}) },
    });
    // A logging failure must not report a successfully saved estimate as failed.
    await logActivity({ organizationId, actorId: userId, kind: TRAIL_KINDS.ESTIMATE,
      summary: `Created a Google aerial roof estimate at ${instantCompleteAddress(input)}`,
      meta: { trade: "roof", measurementId: measurement.id, source: "solar" },
    }).catch(() => console.warn("[roofMeasurement] solar activity log unavailable"));
    return { ok: true, measurement };
  } catch (err) {
    if (err instanceof RateLimitError) return { ok: false, error: err.message };
    if (err instanceof SolarUnavailableError) {
      return { ok: false, error: err.kind === "no-coverage"
        ? "Google has no high-resolution roof data for this address. Open an existing saved measurement or use verified site measurements."
        : err.kind === "config" ? "Google Solar access needs attention in the API account. Try an existing saved measurement."
        : "Google aerial data is temporarily unavailable. Please try again." };
    }
    // Avoid echoing provider URLs, API keys, or database diagnostics to clients.
    console.warn("[roofMeasurement] solar estimate failed", { name: err instanceof Error ? err.name : "unknown" });
    return { ok: false, error: "The aerial estimate could not be completed or saved. Please try again." };
  }
}

/** One UI action; the active engine is controlled on the server. */
export async function measureRoof(input: EvOrderInput): Promise<MeasureResult> {
  // Authenticate before deciding on any provider, including fallback paths.
  const { organizationId, user } = await requireEstimatorOrManager();
  await requirePage(organizationId, "roof-estimator");
  if (roofMeasurementProvider() === "google" || !isEagleViewEnabled()) {
    return solarMeasure(input, organizationId, user.id, "take");
  }
  const result = await measureRoofInstant(input);
  if (result.ok || !isSolarEnabled()) return result;
  // EagleView answered and its answer holds no roof (2026-10-10: a Seattle
  // house under a solar array). That answer is paid and kept, so a click
  // never re-bills it — and Google's aerial model measures the house in the
  // same click instead of leaving the contractor at a dead end. The click
  // already spent its trial allowance on the EagleView order.
  if (result.noRoof) {
    const google = await solarMeasure(input, organizationId, user.id, "covered");
    if (google.ok) return google;
    return { ...result, error: `${result.error} Google's aerial data could not measure it either: ${google.error}` };
  }
  // Only an explicit provider access failure permits automatic fallback.
  // Pending paid orders, plan limits and save failures keep their own state.
  if (result.providerAccessDenied !== true || result.stillProcessing) return result;
  return solarMeasure(input, organizationId, user.id, "take");
}

/** Бесплатная реконструкция строила модель — движок удалён. */
export async function measureRoofFree(): Promise<MeasureResult> {
  return { ok: false, error: "Free reconstruction was removed with the drawing engine (roofcore): use Instant measure." };
}

export async function listRoofMeasurements(limit = 20): Promise<RoofMeasurementSummary[]> {
  const ctx = await requireEstimatorOrManager();
  await requirePage(ctx.organizationId, "roof-estimator");
  const rows = await db.roofMeasurement.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(100, limit)),
    select: {
      id: true, source: true, address: true, city: true, state: true,
      areaSqft: true, squares: true, predominantPitch: true, facetCount: true,
      pngUrl: true, createdAt: true, lat: true, lng: true,
      instantJson: true, provenanceJson: true,
    },
  });
  // The list shows the same figures the page it opens shows — the one rule
  // in lib/roofDiagram/instantTotals.rowFigures, not the columns as saved by
  // whichever pipeline wrote them (audit 2026-09-09).
  return rows.map((row) => {
    let instant: InstantRoofData | null = null;
    let provenance: Record<string, unknown> | null = null;
    try { instant = row.instantJson ? (JSON.parse(row.instantJson) as InstantRoofData) : null; } catch { instant = null; }
    try { provenance = row.provenanceJson ? ((JSON.parse(row.provenanceJson) as { provenance?: Record<string, unknown> }).provenance ?? null) : null; } catch { provenance = null; }
    const fig = rowFigures({ instant, provenance, columns: { areaSqft: row.areaSqft, squares: row.squares, lat: row.lat, lng: row.lng } });
    return {
      ...toSummary(row),
      areaSqft: fig.areaSqft,
      squares: fig.squares,
      predominantPitch: fig.predominantPitch,
      facetCount: fig.facetCount,
      pitchKind: fig.pitchKind,
    };
  });
}

export async function getRoofMeasurement(id: string): Promise<RoofMeasurementDTO | null> {
  const ctx = await requireEstimatorOrManager();
  await requirePage(ctx.organizationId, "roof-estimator");
  const row = await db.roofMeasurement.findFirst({ where: { id, organizationId: ctx.organizationId } });
  return row ? toDTO(row) : null;
}

/**
 * Google Maps satellite photo for the measurement — what the data view shows
 * in place of the drawing (owner's call 2026-09-02: the familiar Google Maps
 * look, clean, no outlines; EagleView ortho deliberately NOT used).
 *
 * Centre = the measurement's pin; zoom fitted to the Instant outlines' bbox
 * (the whole lot plus a little surroundings), default 20 for a house when
 * there is nothing to fit to. scale=2 for crispness. Cached on disk by
 * address+zoom (.cache/staticmap) so reopening the page costs no API call.
 */

/** One fixed zoom for every address — the standard Google Maps address view
 *  (owner's call: no per-lot fitting at all; the pin centres the house). */

export async function getMeasurementPhoto(
  id: string,
): Promise<{ ok: true; dataUrl: string; zoom: number } | { ok: false; error: string }> {
  const ctx = await requireEstimatorOrManager();
  await requirePage(ctx.organizationId, "roof-estimator");
  const row = await db.roofMeasurement.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { source: true, address: true, city: true, state: true, zip: true, lat: true, lng: true, instantJson: true },
  });
  if (!row) return { ok: false, error: "Measurement not found" };
  // The fetch + disk cache live in lib/staticMapPhoto, shared with the
  // client's public proposal page (its site-photo route).
  if (row.source === "solar" && row.instantJson) {
    try {
      const data = JSON.parse(row.instantJson) as InstantRoofData;
      if (typeof data.lat === "number" && Number.isFinite(data.lat) && typeof data.lng === "number" && Number.isFinite(data.lng)) {
        row.lat = data.lat;
        row.lng = data.lng;
      }
    } catch { return { ok: false, error: "The selected building location could not be read." }; }
  }
  const photo = await satellitePhotoPng(row);
  if (!photo.ok) return photo;
  return { ok: true, dataUrl: "data:image/png;base64," + photo.bytes.toString("base64"), zoom: photo.zoom };
}

/** Орто EagleView (данные, без чертежа) — the report's ORTHO tab, shown only
 *  when the paid answer carried imagery; the default view is the Google Maps
 *  photo (getMeasurementPhoto above). */
export async function getMeasurementOrtho(id: string): Promise<
  | { ok: true; dataUrl: string; bbox: [number, number, number, number]; rings: Array<Array<{ lat: number; lng: number }>> }
  | { ok: false; error: string }
> {
  const ctx = await requireEstimatorOrManager();
  await requirePage(ctx.organizationId, "roof-estimator");
  const row = await db.roofMeasurement.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { instantJson: true } });
  if (!row?.instantJson) return { ok: false, error: "No Instant data on this measurement" };
  let instant: InstantRoofData;
  try {
    instant = JSON.parse(row.instantJson) as InstantRoofData;
  } catch {
    return { ok: false, error: "Stored Instant data is unreadable" };
  }
  const wide = instant.imagery
    .filter((im) => im.view === "ortho" && im.bbox && im.masked === false)
    .sort((a, b) => (b.bbox![2] - b.bbox![0]) * (b.bbox![3] - b.bbox![1]) - (a.bbox![2] - a.bbox![0]) * (a.bbox![3] - a.bbox![1]))[0];
  if (!wide?.token || !wide.bbox) return { ok: false, error: "No ortho imagery on this measurement" };
  try {
    const img = await fetchPropertyImage(wide.token);
    const b64 = Buffer.from(img.bytes).toString("base64");
    const mime = img.contentType || "image/png";
    return {
      ok: true,
      dataUrl: "data:" + mime + ";base64," + b64,
      bbox: wide.bbox as [number, number, number, number],
      rings: instant.structures.map((st) => st.outline ?? []).filter((r) => r.length >= 3),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err, "Ortho image unavailable") };
  }
}
