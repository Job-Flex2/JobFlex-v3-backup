// Roof diagram — shared contracts between the calibration engine, the chimney
// detectors, the measurement actions and (later) the drawing + export layers.
// Pure types only: this file must stay importable from client components.

import type { InstantRoofData } from "@/lib/eagleview";
import type { SolarRoofEstimate } from "@/lib/roofSolarEstimate";
// отчёты этапов построения удалены вместе с движком (roofcore):
// диагностика хранится как непрозрачные данные старых строк
type PlanarizeReport = Record<string, unknown>;
type SynthesizeReport = Record<string, unknown>;
type GraftReport = Record<string, unknown>;
type ConformReport = Record<string, unknown>;

/**
 * Where a saved measurement's geometry and numbers came from.
 *   instant+recon   — Instant numbers, reconstructed facets calibrated to them
 *   instant-outline — Instant numbers, no usable imagery: building outline only
 *   recon           — free aerial reconstruction alone (an ESTIMATE, never priced)
 */
export type MeasurementSource = "instant+recon" | "instant-outline" | "recon" | "solar";

/** Which candidate the calibration selection gate shipped (spec §6.5):
 *  synthesized (straight skeleton from the Instant outline), refined
 *  (rectify+refine repair) or rectified (pre-refine fallback). Widened
 *  ADDITIVELY to string for multi-structure lots, where each structure is
 *  gated independently and the shipped model is a composition — the value is
 *  then a summary like "s0:synthesized+graft, s1:refined". The `(string & {})`
 *  arm keeps the three plain names in autocomplete. */
export type MeasurementPipeline = "synthesized" | "refined" | "rectified" | (string & {});

/** A roof penetration located in the model's local-feet frame (x east, y north). */
export interface ChimneyCandidate {
  x: number;
  y: number;
  wFt: number;
  hFt: number;
  /** DSM only: how far the post rises above the facet plane, feet. */
  heightFt?: number;
  kind: "chimney" | "vent" | "skylight";
  /** 0..1 */
  confidence: number;
  method: "dsm" | "vision" | "dsm+vision";
}

/** What calibrateModel did to the reconstruction so the drawing can say so. */
export interface CalibrationReport {
  /** XY scale applied so facet areas sum to Instant's total (1 = untouched). */
  scaleK: number;
  reconAreaSqft: number;
  instantAreaSqft: number | null;
  /** The dominant pitches (rise/12) every facet was snapped onto. */
  pitchesKept: number[];
  reclassified: { eave: number; rake: number };
  /** How many vertices the grid rectification moved under a direction
   *  constraint (the rectify report's `constrained` count). The field name is
   *  kept for compatibility with stored rows, which once held the per-vertex
   *  outline-snap count here. */
  snappedVertices: number;
  predominantPitchForced: boolean;
  /**
   * Rigid transform (rotation about the pin, then translation, feet) that
   * moved the Instant outline INTO the reconstruction's raster frame before
   * snapping — absorbs UTM grid convergence and georeferencing offset. Apply
   * the same transform to anything else converted from lat/lng with the pin as
   * origin (vision chimney boxes). Identity when no outline was available.
   */
  outlineTransform: { thetaRad: number; tx: number; ty: number };
  /**
   * Multi-structure compositions only (additive — absent on single-ring lots
   * and on older rows): the scale each shipped structure's figures actually
   * carry, fit against that structure's own Instant areaSqft when available
   * (else the winning candidate's whole-lot k). `ringIndexes` are the Instant
   * outline rings (largest-area first, the pipeline's ordering) the entry
   * covers — more than one when straddling facets forced rings onto one
   * candidate. The top-level `scaleK`/`reconAreaSqft` then describe the
   * composition as shipped: reconAreaSqft·scaleK² equals the printed area.
   */
  structureScaleK?: Array<{ ringIndexes: number[]; scaleK: number }>;
}

/** Validator verdict persisted with a measurement (drawing-rules spec §4). */
export interface MeasurementValidation {
  /** Quality score 0–100. */
  score: number;
  errors: number;
  warns: number;
  /** True when the REFINED candidate scored below the pre-refine (rectified)
   *  one at the selection gate. It does NOT say what shipped — the gate may
   *  ship the synthesized candidate regardless — read it alongside
   *  `RoofMeasurementDTO.pipeline`, which names the winner. */
  gateFellBack: boolean;
  /** Faithfulness 0–100 of the shipped candidate to the measured evidence
   *  (facet count vs Instant, footage vs the refined recon). Absent on rows
   *  saved before the fidelity gate. */
  fidelity?: number;
  /** The gate's combined metric for the shipped candidate:
   *  0.6·score + 0.4·fidelity (soundness × faithfulness). */
  gateMetric?: number;
}

export interface MeasurementProvenance {
  /** Google aerial estimate; never an EagleView order or surveyed measurement. */
  solar?: SolarRoofEstimate;
  /** Requested location, retained separately from the selected building center. */
  solarRequestedPin?: { lat: number; lng: number };
  /** Google Solar imagery behind the reconstruction. */
  imageryQuality?: string;
  imageryDate?: string;
  pixelSizeM?: number;
  /** EagleView Instant ortho shot date, when imagery was returned. */
  instantImageryDate?: string;
  /** Google's own whole-roof figure, as an independent check. */
  googleAreaSqft?: number | null;
  /** Google's roof-segment count — shown as an ESTIMATED facet count when
   *  the measured data came back without one. Never a measured fact. */
  googleSegmentCount?: number | null;
  /** What planarization (spec §5) did to the shipped model. */
  planarize?: PlanarizeReport;
  /** What synthesis (spec §6) built, whether or not its candidate won. */
  synthesize?: SynthesizeReport;
  /** What grafting sub-roofs from the refined evidence onto the synthesized
   *  candidate did, whether or not that candidate won. Absent when synthesis
   *  produced nothing to graft onto (and on rows saved before grafting). */
  graft?: GraftReport;
  /** Where the drawn roof-edge PERIMETER geometry came from (additive):
   *  "vision" when an accepted AI-traced outline shaped the synthesis base and
   *  the planarize clip target, "instant" when the wall outline + measured
   *  overhang did while a vision trace participated. Absent when no vision
   *  outline reached the calibration (older rows, free path, outline-only) —
   *  read absence as "instant". Numbers are Instant-calibrated either way. */
  outlineSource?: "vision" | "instant";
  /** The vision-outline trace verdict behind `outlineSource` (additive). */
  visionOutline?: VisionOutlineProvenance;
  /**
   * Set when only PART of the property was measured and the user must be told.
   * Today the one cause is a missing parcel ring on the no-Instant path: with
   * no lot boundary only the structure under the pin is taken, so a detached
   * garage is left out — measured at 28 % of the roof on the one address where
   * both answers exist. Never log this without also showing it.
   */
  partialCoverage?: { reason: string; measuredStructures: number };
  /**
   * How much of the roof was actually seen from above: gated mask area against
   * the drawn contour's area. The only condition that withholds a drawing
   * (confidence.ts); absent when there was no reconstruction to measure it
   * from, which is itself not a reason to withhold anything.
   */
  /**
   * How much of the roof the elevation data saw. `insetShare` ignores a 4 ft
   * band along the boundary and is the figure the confidence tier is judged
   * on; `share` covers the whole contour and is kept as the control. A wide
   * gap between them is a fact about the mask on this house.
   */
  coverage?: { seenSqft: number; contourSqft: number; share: number; insetShare?: number | null };
  /**
   * Where the pitch came from and why. "instant" means the elevation data was
   * describing something ON the roof rather than the roof — a solar array is
   * the usual cause — so the published pitch was used instead of one averaged
   * out of panels. Geometry is unaffected either way.
   */
  pitchSource?: PitchSourceProvenance;
  /** How the Instant contour was put onto the Google raster (register.ts). */
  registration?: RegistrationProvenance;
  /**
   * Set when ROOF_RECON_V2 was ON but could not build this roof, so the row
   * was measured by the old calibrated path. A fallthrough must be readable
   * off the row, not only in a server log that scrolls away.
   */
  v2Fallthrough?: { reason: string };
  /**
   * Set when this measurement did NOT order a new EagleView lookup: "stored"
   * means an already-paid answer for the same address was reused, "recovered"
   * means a previously orphaned pending order was collected. Absent when the
   * lookup was ordered (and paid for) by this very measurement.
   */
  instantReuse?: { requestId: string; how: "stored" | "recovered" };
  /**
   * Recon-only rows: why EagleView Instant was not part of this measurement.
   * `pendingOrderId` is set when the cause was a poll TIMEOUT on an already
   * accepted (billable) order — a timeout is NOT evidence the address is
   * uncovered (12117 202nd St SE timed out twice and is covered), so the UI
   * must offer "collect the paid order" instead of "order a report".
   */
  instantMissing?: { reason: string; pendingOrderId?: string };
  /**
   * Facets whose trusted DSM azimuth disagrees with their drawn drain by more
   * than the clustering tolerance: topology the pipeline KNOWS it has not
   * reproduced (gables it could not convert, pent wings, split slopes). The
   * open case list, filled from the field instead of from the head.
   */
  /**
   * What EagleView said about this roof BEYOND the numbers we print — its own
   * view of how obstructed the roof is, the confidence it attached to each
   * field, and how its roof-material polygon compares with the outline we drew
   * from. All of it arrives free in every paid response and used to be dropped
   * by the parser.
   */
  instantSurvey?: {
    /** `roof_occlusion_none|_minor|_major`, EagleView's own wording. */
    occlusion: string | null;
    /** `tree_overhang_none|_minor|_major`. */
    treeOverhang: string | null;
    /** Per-field confidence 0–1, keyed by our field name; absent = not scored. */
    confidence?: Record<string, number>;
    /**
     * The outline we draw from, checked against EagleView's independent
     * roof-material polygon for the same building. A check, never a source.
     */
    outlineCheck?: {
      outlineSqft: number;
      materialSqft: number;
      diffPct: number;
      /** False when the two disagree by more than the coverage tolerance. */
      agrees: boolean;
      materialPoints: number;
      outlinePoints: number;
    };
  };
  /**
   * The 3DEP crease step: folds the point cloud found inside facets the drawing
   * had flat, and what happened to each. `applied: false` carries the reason —
   * no coverage, a slow bucket, or every candidate refused by a guard.
   */
  creases?: {
    applied: boolean;
    reason?: string;
    project?: string;
    points?: number;
    nodes?: number;
    ms?: number;
    cuts?: Array<{ facet: string; type: string; lengthFt: number; bendDeg: number }>;
    refused?: Array<{ facet: string; reason: string }>;
  };
  /**
   * Why the lot boundary could not be looked up.
   *
   * Absent means it was had, or the point genuinely has no parcel on file.
   * Present means the LOOKUP failed — and that matters to the reader, because
   * the boundary is what decides which buildings on the tile belong to this
   * property. Without it only the structure under the pin is measured, and a
   * detached garage leaves the drawing without anything looking wrong: 629 of
   * 2240 sq ft on 17028 NE 100th St.
   */
  parcelBlocked?: { kind: string; message: string };
  /**
   * Which service the lot boundary came from: the parcel cache, a fresh
   * ReportAll lookup, Regrid (only ever consulted when ReportAll says the
   * point has no parcel), or nobody. The roof used to take this outline from
   * Regrid alone, where an expired token read exactly like "no parcel here";
   * naming the source is how that failure becomes visible on a saved
   * measurement rather than a shrug. See lib/lotRing.
   */
  parcelSource?: "cache" | "reportall" | "regrid" | "none";
  /**
   * Why there is no reconstruction on this drawing.
   *
   * Absent means there IS one. Present means the plan is EagleView's outline
   * alone, and this says why — which the screen needs, because the two causes
   * call for opposite actions. `timeout` and `error` are ours or the network's
   * and a second press usually works; `no-coverage` is Google's final answer
   * and pressing again is a waste of the user's time.
   *
   * Before this field the reason went to console.warn and nowhere else: the
   * owner watched 12629 come out as a bare outline on 2026-08-28 and could not
   * learn what happened, and neither could we — the evidence survived only
   * because the dev server had not been restarted.
   */
  reconUnavailable?: {
    kind: "timeout" | "no-coverage" | "config" | "error";
    /** The message the thrown error carried, verbatim. */
    message: string;
  };
  /**
   * Did anything go MISSING from this drawing? Every other check on this record
   * compares the model against itself; ROOF-STATE §J's first-level rule says
   * none of them can see an omission, because an omission looks like "less" and
   * re-summing the same set a second way loses the same term twice. These
   * findings alone come from comparing a total against a value from OUTSIDE it:
   * the contours that went in, and EagleView's own count and footprint.
   */
  completeness?: {
    findings: Array<{ level: "error" | "warn"; code: string; message: string }>;
    structuresIn: number;
    structuresDrawn: number;
    planSqft: number;
    contourSqft: number;
    /** EagleView's facet count minus ours, when its own confidence allowed the test. */
    facetDeficit: number | null;
    facetDeficitShare: number | null;
  };
  /**
   * Which EagleView Property Data packs the Instant answer behind this row is
   * made of (2026-09-08, partial entitlement — packs are bought one by one).
   * `have` were bought, by this order or an earlier one for the address;
   * `denied` the account is not entitled to (403 / 10880); `failed` errored
   * for another reason; `missing` were not attempted; `pending` were placed
   * and paid for but had not answered when the row was saved — the page
   * collects them without a new charge and prices nothing until they land
   * (2026-09-17). Absent on rows saved before per-pack ordering, which were
   * single seven-pack orders.
   */
  instantPacks?: { have: string[]; denied: string[]; failed: string[]; missing: string[]; pending?: string[]; unknown?: string[] };
  /**
   * Which of the answer's structures the row's figures are about (audit
   * 2026-09-08). EagleView returns every structure on the parcel; the hero,
   * the columns and the estimate follow ONE — `how` says how it was chosen
   * (lib/roofDiagram/instantTotals.pickMainStructure). `others` / `othersSqft`
   * are the rest, listed on the page with checkboxes.
   */
  mainStructure?: { index: number; how: string; others: number; othersSqft: number };
  /**
   * Which footprint the estimate prices on, and why (audit 2026-09-17).
   * `eagleview` = the reported `structure_footprint_sqft`; `outline` = the
   * building's own ring, believed when the two disagree by more than
   * FOOTPRINT_OUTLINE_TOLERANCE (lib/roofDiagram/instantTotals.footprintRead).
   */
  footprintSource?: { source: "eagleview" | "outline" | "none"; sqft: number; reportedSqft: number | null; outlineSqft: number | null; deltaPct: number | null };
  unrecognisedFacets?: Array<{ facet: string; dsmAz: number; faceAz: number; diffDeg: number }>;
  /** Share of roof PLAN area sitting in those facets, 0–1 — the figure the
   *  confidence gate judges the layout on. */
  unrecognisedShare?: number;
  /**
   * Which engine drew the interior of this roof. The straight skeleton assumes
   * an equal-pitch hip everywhere, which costs a gabled house its rakes and
   * doubles its hips; the weighted wavefront draws the gables the DSM
   * measured. `applied: false` carries the reason the skeleton was kept — a
   * fallback is never silent.
   */
  wavefront?:
    | { applied: true; carriers: string[]; gableEdges: number[]; slopeClasses: Array<{ pitch12: number; edges: number }> }
    | { applied: false; reason: string };
  /**
   * What the AI structure read (gpt-5.4 over the ortho) says the roof's
   * topology is, and how well that agrees with the DSM on this house.
   * EVIDENCE ONLY — it never moves a vertex; see visionEvidence.ts for the
   * measurement that put it there.
   */
  visionStructure?: {
    lines: { ridge: number; hip: number; valley: number };
    agreement: { both: number; agreed: number; share: number | null };
    walls: Array<{ edge: number; lengthFt: number; facet: string | null; dsm: string; vision: string }>;
    corroborated: string[];
    source: string;
    model: string;
  };
  /**
   * Set when EagleView shipped NESTED structure outlines (a sub-roof drawn as
   * a sibling): this much plan area is counted twice — in our drawn total AND
   * in Instant's own totals.areaSqft, which is the plain sum of structure
   * areas. An area cross-check against Instant on such a lot compares our
   * error with theirs and must not be trusted; the UI says so instead of
   * applying the band.
   */
  nestedOutlines?: { overlapSqft: number; pairs: string[] };
  /**
   * V2 paths, one entry per structure (facet-letter prefix). Coverage and
   * registration are judged PER STRUCTURE: the Solar tile is centred on the
   * house, so on a farmstead the barns read 0 % coverage while the house reads
   * full — one aggregate number would let the barns hide the house (measured:
   * 12117 202nd St SE aggregates to 20 % while its house is fully covered).
   * A structure without data is marked here individually and the drawing
   * stays; the floor applies to the structure, not to the measurement.
   */
  structures?: StructureProvenance[];
}

export interface StructureProvenance {
  /** Facet-letter prefix (A, B, …) — facets map to structures by it. */
  prefix: string;
  contourSqft: number;
  coverage: { seenSqft: number; share: number; insetShare?: number | null } | null;
  /** Meets the per-structure coverage floor. */
  covered: boolean;
  registration?: {
    applied: boolean;
    iouBefore?: number;
    iouAfter?: number | null;
    reason?: string;
    transform?: { dxFt: number; dyFt: number; thetaDeg: number };
  };
  /** This contour lies mostly inside the named sibling's — a nested sub-roof. */
  nestedIn?: string;
  /** Why this structure carries no measured data, when it does not. */
  note?: string;
}

/** Where the printed pitch came from, and why — shown to the user. */
export interface PitchSourceProvenance {
  source: "measured" | "instant";
  pitch12: number;
  /** Share of plan area whose facets fitted a plane to the DSM's noise floor. */
  trustedShare: number;
  reason: string;
  solarPanels?: boolean;
  /** EagleView's published rise/12 for the main structure, null when pack 002
   *  was not bought. Lets the verdict say "published figure" only when there
   *  IS one (audit 2026-09-08: 11810 was captioned with a pitch it never had). */
  instantPitch12?: number | null;
}

/** The per-house frame registration, cached with the model: the two frames are
 *  4–7.25 ft apart and there is no constant, so it is solved and kept. */
export interface RegistrationProvenance {
  applied: boolean;
  transform?: { dxFt: number; dyFt: number; thetaDeg: number };
  iouBefore: number;
  iouAfter: number | null;
  /** Present only when it was refused — never a silent identity. */
  reason?: string;
}

/** Verdict of the AI roof-outline trace recorded with a measurement — how the
 *  drawn perimeter's source was decided (additive; absent on older rows and
 *  wherever no trace was attempted). */
export interface VisionOutlineProvenance {
  /** True when the accepted vision ring actually shaped the shipped geometry. */
  applied: boolean;
  /** "vision" = fresh trace this run; "vision-cache" = cached accepted trace. */
  source?: "vision" | "vision-cache";
  /** IoU of the ring vs the dilated wall outline (acceptance gate ≥ 0.80). */
  iou?: number;
  cornerCount?: number;
  /** Why no ring was accepted (trace / gate failures), when one was attempted. */
  reasons?: string[];
  /** Why an ACCEPTED ring was still not applied (e.g. a multi-ring lot). */
  skippedReason?: string;
  /** What conforming the shipped repair candidate's outer contour onto the
   *  accepted ring did (additive) — recorded only when a refined/rectified
   *  candidate shipped under an applied vision ring; the synthesized
   *  candidate is built FROM the ring and records nothing here. */
  conform?: ConformOutlineProvenance;
}

/** The conform-pass verdict persisted with a measurement (additive). */
export interface ConformOutlineProvenance extends ConformReport {
  /** calibrate's no-regression gate rejected the conformed geometry — the
   *  unconformed candidate shipped; the counts describe the discarded attempt. */
  gateReverted?: boolean;
}

/** The saved measurement as the UI consumes it. JSON columns are parsed here. */
export interface RoofMeasurementDTO {
  id: string;
  source: MeasurementSource;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  areaSqft: number | null;
  squares: number | null;
  predominantPitch: string | null;
  facetCount: number | null;
  /** Геометрия старых строк (modelJson) — новый код её не пишет. */
  model: unknown;
  instant: InstantRoofData | null;
  chimneys: ChimneyCandidate[];
  calibration: CalibrationReport | null;
  /** Null for rows saved before the validator existed. */
  validation: MeasurementValidation | null;
  /** Which candidate the selection gate shipped; absent for rows saved before
   *  the gate existed and for outline-only / free-estimate paths. */
  pipeline?: MeasurementPipeline;
  provenance: MeasurementProvenance;
  pngUrl: string | null;
  pdfUrl: string | null;
  createdAt: string;
}

/** Lightweight row for the history list — no geometry. */
export interface RoofMeasurementSummary {
  id: string;
  source: MeasurementSource;
  address: string | null;
  city: string | null;
  state: string | null;
  areaSqft: number | null;
  squares: number | null;
  predominantPitch: string | null;
  facetCount: number | null;
  /** Where the list's pitch comes from — `legacy` is a drawing-pipeline row with no EagleView answer. */
  pitchKind: "measured" | "eagleview" | "solar" | "none" | "legacy";
  pngUrl: string | null;
  createdAt: string;
}
