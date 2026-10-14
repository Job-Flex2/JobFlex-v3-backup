// Roof package catalog — what a contractor can put on a roof, with US 2026
// ballpark DEFAULT prices. Every price here is a starting point the contractor
// edits in the builder; nothing is authoritative. Client-safe constants only.
//
// Units are the SIX words the proposal understands (see unitToType in
// actions/roofEstimator.ts): "square" (100 sq ft of roof), "sq ft",
// "linear ft", "each", "hour", "lot". The builder never emits anything else,
// so a converted proposal carries a real measurement on every line — the
// 2026-09-12 complaint was every AI line landing as "Unit".

export type PkgUnit = "square" | "sq ft" | "linear ft" | "each" | "hour" | "lot";
export type LineKind = "material" | "labor";
/** Where a quantity came from. Shown on the line so nobody prices a guess as a measurement. */
export type Basis = "measured" | "estimated" | "entered";

export interface CatalogOption {
  id: string;
  label: string;
}

// ── Roof systems ────────────────────────────────────────────────────────────
/** Shingle / panel / tile family — drives cap, starter and low-slope rules. */
export type RoofFamily = "asphalt" | "metal" | "tile" | "shake" | "slate" | "synthetic" | "low-slope";
export const ROOF_FAMILIES: Array<{ id: RoofFamily; label: string }> = [
  { id: "asphalt", label: "Asphalt shingle" },
  { id: "metal", label: "Metal" },
  { id: "tile", label: "Tile" },
  { id: "shake", label: "Wood shake" },
  { id: "slate", label: "Slate" },
  { id: "synthetic", label: "Synthetic" },
  { id: "low-slope", label: "Flat / low slope" },
];

export interface RoofSystem extends CatalogOption {
  family: RoofFamily;
  matPerSq: number;
  laborPerSq: number;
  /** Typical waste for this system; the builder's waste picker starts here. */
  wastePct: number;
  /** Hip & ridge cap, $ per linear ft of ridge + hip. */
  capPerFt: number;
}

export const ROOF_SYSTEMS: RoofSystem[] = [
  // Ordered by how often each is put on a US house — the common ones first.
  // Every price is a 2026 ballpark the contractor edits (Manage roof types).
  { id: "architectural", label: "Architectural shingle · 30-yr", family: "asphalt", matPerSq: 125, laborPerSq: 200, wastePct: 12, capPerFt: 2.1 },
  { id: "three_tab", label: "3-tab asphalt shingle", family: "asphalt", matPerSq: 95, laborPerSq: 175, wastePct: 10, capPerFt: 1.9 },
  { id: "impact_resistant", label: "Impact-resistant shingle · Class 4", family: "asphalt", matPerSq: 175, laborPerSq: 210, wastePct: 12, capPerFt: 2.4 },
  { id: "designer", label: "Designer shingle · Presidential", family: "asphalt", matPerSq: 265, laborPerSq: 260, wastePct: 12, capPerFt: 3.6 },
  { id: "standing_seam", label: "Standing-seam metal", family: "metal", matPerSq: 550, laborPerSq: 450, wastePct: 8, capPerFt: 12 },
  { id: "metal_panel", label: "Metal panel · exposed fastener", family: "metal", matPerSq: 250, laborPerSq: 300, wastePct: 8, capPerFt: 9 },
  { id: "stone_coated_steel", label: "Stone-coated steel", family: "metal", matPerSq: 450, laborPerSq: 400, wastePct: 10, capPerFt: 10 },
  { id: "metal_shingle", label: "Metal shingle / shake", family: "metal", matPerSq: 400, laborPerSq: 380, wastePct: 10, capPerFt: 9 },
  { id: "concrete_tile", label: "Concrete tile", family: "tile", matPerSq: 400, laborPerSq: 500, wastePct: 12, capPerFt: 8 },
  { id: "clay_tile", label: "Clay tile", family: "tile", matPerSq: 700, laborPerSq: 600, wastePct: 12, capPerFt: 9.5 },
  { id: "cedar_shake", label: "Cedar shake", family: "shake", matPerSq: 500, laborPerSq: 450, wastePct: 15, capPerFt: 4.2 },
  { id: "cedar_shingle", label: "Cedar shingle", family: "shake", matPerSq: 450, laborPerSq: 430, wastePct: 15, capPerFt: 4 },
  { id: "synthetic_slate", label: "Synthetic slate", family: "synthetic", matPerSq: 450, laborPerSq: 350, wastePct: 10, capPerFt: 4.5 },
  { id: "synthetic_shake", label: "Synthetic shake", family: "synthetic", matPerSq: 420, laborPerSq: 350, wastePct: 10, capPerFt: 4.5 },
  { id: "slate", label: "Natural slate", family: "slate", matPerSq: 1100, laborPerSq: 900, wastePct: 12, capPerFt: 8.5 },
  { id: "copper", label: "Copper standing seam", family: "metal", matPerSq: 1600, laborPerSq: 900, wastePct: 8, capPerFt: 30 },
  { id: "standing_seam_low", label: "Standing seam · low slope 1:12", family: "metal", matPerSq: 620, laborPerSq: 520, wastePct: 8, capPerFt: 14 },
  { id: "solar_shingle", label: "Solar shingles", family: "asphalt", matPerSq: 2200, laborPerSq: 900, wastePct: 5, capPerFt: 2.4 },

  // ── Flat / low slope ──────────────────────────────────────────────────────
  // Most-installed in the US first. PRICED AS THE MEMBRANE (or plies, or
  // coating) plus its seam and detail stock, and the crew that lays it —
  // NOTHING ELSE. Insulation, cover board, fasteners, adhesive, edge metal,
  // coping, drains, curbs, walkway pads and the warranty are their own lines
  // (lowSlope.ts), so a price here never double-counts one of them. The ids
  // "tpo", "epdm", "pvc", "mod_bit", "bur", "rolled" and "green_roof" are the
  // original rows' ids, kept so a company's saved catalog still resolves.
  { id: "tpo", label: "TPO 60 mil · mech attached", family: "low-slope", matPerSq: 125, laborPerSq: 165, wastePct: 5, capPerFt: 0 },
  { id: "tpo_60_adhered", label: "TPO 60 mil · fully adhered", family: "low-slope", matPerSq: 130, laborPerSq: 205, wastePct: 8, capPerFt: 0 },
  { id: "epdm", label: "EPDM 60 mil · fully adhered", family: "low-slope", matPerSq: 140, laborPerSq: 210, wastePct: 8, capPerFt: 0 },
  { id: "mod_bit", label: "Mod bit 2-ply · torch-down", family: "low-slope", matPerSq: 225, laborPerSq: 245, wastePct: 10, capPerFt: 0 },
  { id: "tpo_45", label: "TPO 45 mil · mech attached", family: "low-slope", matPerSq: 105, laborPerSq: 155, wastePct: 5, capPerFt: 0 },
  { id: "epdm_mech", label: "EPDM 60 mil · mech attached", family: "low-slope", matPerSq: 145, laborPerSq: 175, wastePct: 5, capPerFt: 0 },
  { id: "pvc", label: "PVC 60 mil · mech attached", family: "low-slope", matPerSq: 165, laborPerSq: 170, wastePct: 5, capPerFt: 0 },
  { id: "pvc_adhered", label: "PVC 60 mil · fully adhered", family: "low-slope", matPerSq: 175, laborPerSq: 210, wastePct: 8, capPerFt: 0 },
  { id: "tpo_80", label: "TPO 80 mil · mech attached", family: "low-slope", matPerSq: 160, laborPerSq: 175, wastePct: 5, capPerFt: 0 },
  { id: "mod_bit_sa", label: "Mod bit 2-ply · self-adhered", family: "low-slope", matPerSq: 275, laborPerSq: 215, wastePct: 10, capPerFt: 0 },
  { id: "coat_silicone", label: "Silicone coating · 10-yr", family: "low-slope", matPerSq: 105, laborPerSq: 115, wastePct: 12, capPerFt: 0 },
  { id: "tpo_induction", label: "TPO 60 mil · induction welded", family: "low-slope", matPerSq: 135, laborPerSq: 200, wastePct: 5, capPerFt: 0 },
  { id: "bur", label: "Built-up 4-ply · gravel", family: "low-slope", matPerSq: 220, laborPerSq: 320, wastePct: 8, capPerFt: 0 },
  { id: "bur_cap", label: "Built-up 3-ply · mod bit cap", family: "low-slope", matPerSq: 225, laborPerSq: 290, wastePct: 8, capPerFt: 0 },
  { id: "epdm_45", label: "EPDM 45 mil · fully adhered", family: "low-slope", matPerSq: 115, laborPerSq: 195, wastePct: 8, capPerFt: 0 },
  { id: "spf_silicone", label: "Spray foam 1.5 in · silicone", family: "low-slope", matPerSq: 215, laborPerSq: 205, wastePct: 10, capPerFt: 0 },
  { id: "coat_silicone_20", label: "Silicone coating · 20-yr", family: "low-slope", matPerSq: 145, laborPerSq: 125, wastePct: 12, capPerFt: 0 },
  { id: "coat_silicone_metal", label: "Silicone coating · metal roof", family: "low-slope", matPerSq: 145, laborPerSq: 135, wastePct: 10, capPerFt: 0 },
  { id: "coat_acrylic", label: "Acrylic coating · restoration", family: "low-slope", matPerSq: 95, laborPerSq: 105, wastePct: 15, capPerFt: 0 },
  { id: "rolled", label: "Rolled roofing · 90 lb", family: "low-slope", matPerSq: 90, laborPerSq: 135, wastePct: 10, capPerFt: 0 },
  { id: "mod_bit_hot", label: "Mod bit 2-ply · hot-mopped", family: "low-slope", matPerSq: 210, laborPerSq: 260, wastePct: 10, capPerFt: 0 },
  { id: "pvc_80", label: "PVC 80 mil · mech attached", family: "low-slope", matPerSq: 215, laborPerSq: 180, wastePct: 5, capPerFt: 0 },
  { id: "tpo_fleece_adhered", label: "TPO fleece-back · adhered", family: "low-slope", matPerSq: 185, laborPerSq: 210, wastePct: 8, capPerFt: 0 },
  { id: "bur_3ply_smooth", label: "Built-up 3-ply · smooth", family: "low-slope", matPerSq: 185, laborPerSq: 265, wastePct: 8, capPerFt: 0 },
  { id: "epdm_90", label: "EPDM 90 mil · fully adhered", family: "low-slope", matPerSq: 195, laborPerSq: 225, wastePct: 8, capPerFt: 0 },
  { id: "mod_bit_cold", label: "Mod bit 2-ply · cold-applied", family: "low-slope", matPerSq: 215, laborPerSq: 230, wastePct: 10, capPerFt: 0 },
  { id: "epdm_ballast", label: "EPDM 60 mil · ballasted", family: "low-slope", matPerSq: 120, laborPerSq: 150, wastePct: 5, capPerFt: 0 },
  { id: "pvc_fleece_adhered", label: "PVC fleece-back · adhered", family: "low-slope", matPerSq: 225, laborPerSq: 215, wastePct: 8, capPerFt: 0 },
  { id: "kee", label: "KEE 50 mil · mech attached", family: "low-slope", matPerSq: 255, laborPerSq: 180, wastePct: 5, capPerFt: 0 },
  { id: "coat_urethane", label: "Urethane coating · restoration", family: "low-slope", matPerSq: 195, laborPerSq: 125, wastePct: 12, capPerFt: 0 },
  { id: "spf_acrylic", label: "Spray foam 1 in · acrylic", family: "low-slope", matPerSq: 165, laborPerSq: 175, wastePct: 10, capPerFt: 0 },
  { id: "coat_emulsion", label: "Aluminum / emulsion coating", family: "low-slope", matPerSq: 55, laborPerSq: 70, wastePct: 15, capPerFt: 0 },
  { id: "mod_bit_cap_recover", label: "Cap sheet overlay · repair", family: "low-slope", matPerSq: 120, laborPerSq: 145, wastePct: 10, capPerFt: 0 },
  { id: "liquid_pu", label: "Liquid PU membrane · fleece", family: "low-slope", matPerSq: 500, laborPerSq: 420, wastePct: 10, capPerFt: 0 },
  { id: "pmma", label: "PMMA liquid membrane", family: "low-slope", matPerSq: 1100, laborPerSq: 1000, wastePct: 10, capPerFt: 0 },
  { id: "green_roof", label: "Vegetative roof · extensive", family: "low-slope", matPerSq: 1450, laborPerSq: 1150, wastePct: 5, capPerFt: 0 },
  { id: "ballast_paver", label: "Paver deck · on pedestals", family: "low-slope", matPerSq: 1150, laborPerSq: 600, wastePct: 5, capPerFt: 0 },
];

/**
 * Install-labor multiplier by pitch. Below 4/12 most shingle work needs
 * low-slope treatment; 8/12 and up is walk-with-care, 10/12 and up is roped,
 * 12/12 and up is staged.
 */
export function pitchLaborFactor(pitch12: number, family?: RoofFamily): number {
  // A membrane is chosen FOR a flat roof; the shallow-pitch surcharge exists
  // to penalise shingles laid below 4/12 and must never stack on it.
  if (family === "low-slope") return 1;
  if (pitch12 < 4) return 1.1;
  if (pitch12 <= 6) return 1;
  if (pitch12 <= 7) return 1.1;
  if (pitch12 <= 9) return 1.25;
  if (pitch12 <= 11) return 1.45;
  return 1.7;
}
/** From here up the package carries a safety / staging line. */
export const STEEP_PITCH = 8;

/**
 * THE pitch a roof is priced and labelled on — the whole number a contractor
 * reads, never the raw measurement behind it.
 *
 * WHY (audit 2026-09-17). The measured pitch is a decimal (7.46/12) and the
 * page has always DISPLAYED it rounded, while `pitchLaborFactor` and the
 * steep-slope test read the raw figure. Two real roofs came out inconsistent:
 * 12629 NE 100th Pl showed "7/12" and was priced at $250/sq — the 8-9/12 rate
 * ($702 more than its own label implies) — and 12618 NE 100th St showed "8/12"
 * yet carried no steep-slope safety line, because 7.563 < 8. One number now
 * feeds all three: the rate, the STEEP_PITCH test and the line's own name.
 *
 * Deliberately NOT used by the flat rule (flatRule.ts) — rounding a measured
 * 1.6/12 roof up to 2/12 would price a flat roof as shingles.
 */
export function displayPitch12(pitch12: number): number {
  return Math.round(pitch12);
}

// ── Underlayment ────────────────────────────────────────────────────────────
export interface Underlayment extends CatalogOption {
  perSq: number;
}
export const UNDERLAYMENTS: Underlayment[] = [
  { id: "synthetic", label: "Synthetic underlayment", perSq: 32 },
  { id: "synthetic_premium", label: "Premium synthetic · high-temp", perSq: 48 },
  { id: "felt15", label: "#15 asphalt felt", perSq: 18 },
  { id: "felt30", label: "#30 asphalt felt", perSq: 26 },
  { id: "paper60", label: "60-minute paper", perSq: 30 },
  { id: "peel_stick", label: "Peel & stick · full deck", perSq: 110 },
  { id: "none", label: "None · membrane system", perSq: 0 },
];

export type IceWaterCoverage = "none" | "eaves" | "eaves_valleys" | "full";
export const ICE_WATER: Array<CatalogOption & { id: IceWaterCoverage }> = [
  { id: "none", label: "None" },
  { id: "eaves", label: "Eaves only (two rows, 6 ft up)" },
  { id: "eaves_valleys", label: "Eaves + valleys (36 in on each valley)" },
  { id: "full", label: "Full deck" },
];
export const ICE_WATER_PER_SQFT = 0.6;
/** Two courses of 36 in membrane up from the eave. */
export const ICE_WATER_EAVE_BAND_FT = 6;
/** One 36 in course centred on the valley. */
export const ICE_WATER_VALLEY_BAND_FT = 3;

// ── Edge metal ──────────────────────────────────────────────────────────────
export interface DripEdgeProfile extends CatalogOption {
  perFt: number;
}
export const DRIP_EDGE_PROFILES: DripEdgeProfile[] = [
  { id: "f", label: "F-style (standard)", perFt: 1.5 },
  { id: "t", label: "T-style (extended lip)", perFt: 1.9 },
  { id: "apron", label: "Gutter apron", perFt: 2.2 },
  { id: "custom", label: "Custom…", perFt: 0 },
];
export const DRIP_EDGE_SIZES: CatalogOption[] = [
  { id: "1.5", label: "1½ in face" },
  { id: "2", label: "2 in face" },
  { id: "3", label: "3 in face" },
];
export const STARTER_PER_FT = 0.8;

// ── Flashing ────────────────────────────────────────────────────────────────
export interface ValleyType extends CatalogOption {
  matPerFt: number;
  laborPerFt: number;
}
export const VALLEY_TYPES: ValleyType[] = [
  { id: "closed_cut", label: "Closed-cut (shingles, membrane under)", matPerFt: 0, laborPerFt: 2.5 },
  { id: "open_w24", label: "Open metal · W-valley 24 in", matPerFt: 3.5, laborPerFt: 3 },
  { id: "open_w20", label: "Open metal · W-valley 20 in", matPerFt: 3.1, laborPerFt: 3 },
  { id: "open_copper", label: "Open metal · copper", matPerFt: 28, laborPerFt: 6 },
  { id: "raised_rib", label: "Raised-rib · tile / slate", matPerFt: 8, laborPerFt: 10 },
  { id: "formed_pan", label: "Formed valley pan · metal", matPerFt: 15, laborPerFt: 10 },
  { id: "custom", label: "Custom…", matPerFt: 0, laborPerFt: 0 },
];

export interface StepFlashingSize extends CatalogOption {
  perPiece: number;
  /** Exposure the pieces are lapped at, inches — sets pieces per foot. */
  exposureIn: number;
}
export const STEP_FLASHING_SIZES: StepFlashingSize[] = [
  { id: "4x4x8", label: "4 × 4 × 8 in", perPiece: 0.85, exposureIn: 5.625 },
  { id: "5x5x8", label: "5 × 5 × 8 in", perPiece: 1.05, exposureIn: 5.625 },
  { id: "4x4x10", label: "4 × 4 × 10 in", perPiece: 1.1, exposureIn: 7.5 },
  { id: "custom", label: "Custom…", perPiece: 0, exposureIn: 5.625 },
];
export const STEP_FLASHING_LABOR_PER_FT = 4;
export const APRON_PER_FT = 3.2;
export const APRON_LABOR_PER_FT = 3;
export const COUNTER_PER_FT = 4.5;
export const COUNTER_LABOR_PER_FT = 6;

export interface PipeBootSize extends CatalogOption {
  each: number;
  labor: number;
}
export const PIPE_BOOT_SIZES: PipeBootSize[] = [
  { id: "small", label: "1½–3 in", each: 14, labor: 25 },
  { id: "medium", label: "3–4 in", each: 18, labor: 25 },
  { id: "large", label: "4–6 in", each: 28, labor: 30 },
];

export interface ChimneySize extends CatalogOption {
  each: number;
  labor: number;
}
export const CHIMNEY_SIZES: ChimneySize[] = [
  { id: "small", label: "Small (to 24 in)", each: 180, labor: 250 },
  { id: "medium", label: "Medium (to 36 in)", each: 260, labor: 350 },
  { id: "large", label: "Large (over 36 in) / cricket", each: 380, labor: 450 },
];
// ── Fascia & gutters (owner, 2026-09-19: "most of the time when roof getting
// replaced facia gets replaced as well") ────────────────────────────────────
// The fascia is the board the gutter hangs on, behind the drip edge. It is
// open once the roof is off, which is the only cheap time to change it — so a
// tear-off opens with it ON, priced along the eaves, and the contractor turns
// it off for a roof whose trim is sound.
export interface FasciaOption extends CatalogOption {
  /** Board (or wrap) per foot. */
  perFt: number;
  /** Tear off the old board and hang the new one, per foot. */
  laborPerFt: number;
  /** True where the existing board stays and is covered rather than replaced. */
  wrap?: boolean;
}
export const FASCIA_OPTIONS: FasciaOption[] = [
  { id: "pine", label: "Primed pine 1×6", perFt: 3.2, laborPerFt: 4.5 },
  { id: "cedar", label: "Cedar 1×6", perFt: 5.4, laborPerFt: 4.5 },
  { id: "pvc", label: "PVC / composite 1×6", perFt: 6.5, laborPerFt: 5 },
  { id: "subfascia", label: "2× sub-fascia + 1×6 face", perFt: 5.8, laborPerFt: 6 },
  { id: "wrap", label: "Aluminum wrap over existing", perFt: 3, laborPerFt: 4, wrap: true },
];
/** Which lengths the fascia runs: the eaves alone, the whole perimeter, or a figure typed in. */
export type FasciaRun = "eaves" | "eaves_rakes" | "custom";
/** The gutters have to come off to change the fascia — this is what happens to them. */
export type GutterPlan = "none" | "reset" | "replace";
export const GUTTER_PLANS: Array<CatalogOption & { id: GutterPlan }> = [
  { id: "reset", label: "Detach & reset" },
  { id: "replace", label: "Replace · 6 in seamless" },
  { id: "none", label: "No gutters on the house" },
];
export const GUTTER_RESET_LABOR_PER_FT = 2.5;
export const GUTTER_NEW_PER_FT = 7;
export const GUTTER_NEW_LABOR_PER_FT = 5;

export const CURB_EACH = 120;
export const CURB_LABOR = 150;

// ── Ventilation ─────────────────────────────────────────────────────────────
export interface VentType extends CatalogOption {
  unit: "linear ft" | "each";
  each: number;
  labor: number;
  /** Net free area per unit, sq in — 0 for powered units (they move air, not NFA). */
  nfaSqIn: number;
  role: "exhaust" | "intake";
}
export const VENT_TYPES: VentType[] = [
  { id: "ridge", label: "Ridge vent", unit: "linear ft", each: 4.5, labor: 3, nfaSqIn: 18, role: "exhaust" },
  { id: "box50", label: "Box / static vent · 50 sq in", unit: "each", each: 22, labor: 35, nfaSqIn: 50, role: "exhaust" },
  { id: "box60", label: "Box / static vent · 60 sq in", unit: "each", each: 28, labor: 35, nfaSqIn: 60, role: "exhaust" },
  { id: "turbine12", label: "Turbine · 12 in", unit: "each", each: 65, labor: 60, nfaSqIn: 113, role: "exhaust" },
  { id: "turbine14", label: "Turbine · 14 in", unit: "each", each: 80, labor: 60, nfaSqIn: 154, role: "exhaust" },
  { id: "power_fan", label: "Power attic fan", unit: "each", each: 180, labor: 150, nfaSqIn: 0, role: "exhaust" },
  { id: "solar_fan", label: "Solar attic fan", unit: "each", each: 420, labor: 150, nfaSqIn: 0, role: "exhaust" },
  { id: "gable", label: "Gable vent", unit: "each", each: 45, labor: 60, nfaSqIn: 90, role: "exhaust" },
  { id: "soffit16x8", label: "Soffit / intake vent · 16 × 8 in", unit: "each", each: 8, labor: 15, nfaSqIn: 56, role: "intake" },
  { id: "soffit_strip", label: "Continuous soffit strip", unit: "linear ft", each: 2.2, labor: 2, nfaSqIn: 9, role: "intake" },
  { id: "edge_intake", label: "Edge / eave intake vent", unit: "linear ft", each: 3.8, labor: 2.5, nfaSqIn: 9, role: "intake" },
];
/** Attic sq in of net free area per sq ft of attic floor: 1/150 plain, 1/300 balanced with a vapor retarder. */
export const NFA_RATIO_PLAIN = 150;
export const NFA_RATIO_BALANCED = 300;

// ── Tear-off & extras ───────────────────────────────────────────────────────
export const TEAROFF_LABOR_PER_SQ_LAYER = 55;
export const DISPOSAL_PER_SQ_LAYER = 28;
/**
 * Tear-off labor and disposal per square per layer BY WHAT IS ON THE ROOF
 * NOW (review 2026-09-17: a tile or slate roof was torn off at the shingle
 * rate, though it weighs three to four times as much and comes off piece by
 * piece). Seeded from the aerial data's material word; the contractor edits
 * the rate on the card as always.
 */
export const EXISTING_STEEP: Record<Exclude<RoofFamily, "low-slope">, { tearOff: number; disposal: number }> = {
  asphalt: { tearOff: TEAROFF_LABOR_PER_SQ_LAYER, disposal: DISPOSAL_PER_SQ_LAYER },
  synthetic: { tearOff: 55, disposal: 28 },
  shake: { tearOff: 70, disposal: 40 },
  metal: { tearOff: 60, disposal: 25 },
  tile: { tearOff: 120, disposal: 75 },
  slate: { tearOff: 130, disposal: 90 },
};
/** The tear-off rates the existing roof calls for; the shingle rates when the material is unknown or a membrane. */
export function tearOffRatesFor(existingMaterial: string | null | undefined): { tearOff: number; disposal: number; family: RoofFamily | null } {
  const family = familyOfMaterial(existingMaterial);
  if (!family || family === "low-slope") return { tearOff: TEAROFF_LABOR_PER_SQ_LAYER, disposal: DISPOSAL_PER_SQ_LAYER, family };
  return { ...EXISTING_STEEP[family], family };
}
/**
 * Labor factor for the height of the work: a two-storey eave means longer
 * ladders, more staging and slower loading on every square; three storeys
 * more so. 1 for a single storey or when the height is unknown.
 */
export function storeyLaborFactor(storeys: number | null | undefined): number {
  if (storeys == null || storeys <= 1) return 1;
  return storeys >= 3 ? 1.15 : 1.08;
}
export const PLYWOOD_SHEET_EACH = 42;
export const PLYWOOD_SHEET_LABOR = 35;

/**
 * THE DECKING A DAMAGED SHEET IS REPLACED WITH (owner, 2026-10-13: "what kind, what thickness and size? add it").
 * Each board seeds its own two prices per 4 × 8 sheet — the board, and fitting it — as STARTING figures the
 * contractor sets under Your rates (a pick seeds them, like the fascia boards). The ½ in CDX row keeps the prices
 * the builder always had. "plywood" names a plywood line; OSB and ZIP are named as roof decking.
 */
export interface DeckBoardOption extends CatalogOption {
  kind: "plywood" | "osb" | "zip";
  each: number;
  labor: number;
}
export const DECK_BOARDS: DeckBoardOption[] = [
  { id: "cdx_12", label: "½ in CDX plywood", kind: "plywood", each: PLYWOOD_SHEET_EACH, labor: PLYWOOD_SHEET_LABOR },
  { id: "osb_716", label: "7/16 in OSB", kind: "osb", each: 24, labor: PLYWOOD_SHEET_LABOR },
  { id: "cdx_58", label: "⅝ in CDX plywood", kind: "plywood", each: 54, labor: 38 },
  { id: "osb_58", label: "⅝ in OSB", kind: "osb", each: 34, labor: 38 },
  { id: "cdx_34", label: "¾ in CDX plywood", kind: "plywood", each: 66, labor: 42 },
  { id: "zip_716", label: "7/16 in ZIP System roof sheathing", kind: "zip", each: 40, labor: 40 },
  { id: "zip_58", label: "⅝ in ZIP System roof sheathing", kind: "zip", each: 52, labor: 42 },
];
/** The sheet sizes a deck is patched with; the board prices above are per 4 × 8 and scale with the area. */
export type DeckSheetSize = "4x8" | "4x10";
export const DECK_SHEET_SIZES: Array<{ id: DeckSheetSize; label: string; sqft: number }> = [
  { id: "4x8", label: "4 × 8 ft", sqft: 32 },
  { id: "4x10", label: "4 × 10 ft", sqft: 40 },
];
export const NAILS_PER_SQ = 4.5;
export const SEALANT_PER_SQ = 1.2;
export const CLEANUP_LUMP = 250;
export const STEEP_SAFETY_LUMP = 250;
export const MATERIAL_DELIVERY_LUMP = 150;

/** The waste picker's options; the chosen roof system pre-selects one. */
export const WASTE_OPTIONS = [5, 8, 10, 12, 15, 18, 20];

/** The two lists the contractor edits and saves as the org's own catalog. */
export interface CatalogLists {
  systems: RoofSystem[];
  underlayments: Underlayment[];
}
export const BUILTIN_LISTS: CatalogLists = { systems: ROOF_SYSTEMS, underlayments: UNDERLAYMENTS };

// ── Like-for-like ───────────────────────────────────────────────────────────
// The aerial data names what is on the roof now ("Tile", "Asphalt shingle",
// "Metal"…). A replacement starts from the same family — a tile roof is priced
// as tile, not as the shingle default (owner, 2026-09-14) — and the contractor
// changes the system if the client wants something else.

/** The aerial data's material word → our family; null when it names nothing we price. */
export function familyOfMaterial(word: string | null | undefined): RoofFamily | null {
  const w = (word ?? "").trim().toLowerCase();
  if (!w || w === "unknown" || w === "other" || w === "none") return null;
  if (/tile|clay|concrete|terracotta|barrel/.test(w)) return "tile";
  if (/metal|steel|standing|aluminum|aluminium|copper|tin\b/.test(w)) return "metal";
  if (/slate/.test(w)) return "slate";
  if (/shake|cedar|wood/.test(w)) return "shake";
  if (/synthetic|composite|polymer/.test(w)) return "synthetic";
  if (/membrane|flat|tpo|epdm|pvc|built|bur\b|gravel|tar\b|modified|mod.?bit|rolled|roll\b|rubber|\bcoating\b|silicone|acrylic|elastomeric|spray.?foam|\bspf\b|polyurethane/.test(w)) return "low-slope";
  if (/asphalt|shingle|composition|fiberglass|fibreglass|architectural|laminat/.test(w)) return "asphalt";
  return null;
}

/** The system to start from per family, most common first; a custom catalog
 *  without these ids falls back to its first system of the family. */
const LIKE_FOR_LIKE: Record<RoofFamily, string[]> = {
  asphalt: ["architectural", "impact_resistant", "three_tab"],
  metal: ["standing_seam", "metal_panel", "stone_coated_steel"],
  tile: ["concrete_tile", "clay_tile"],
  shake: ["cedar_shake", "cedar_shingle"],
  slate: ["slate", "synthetic_slate"],
  synthetic: ["synthetic_slate", "synthetic_shake"],
  "low-slope": ["tpo", "mod_bit", "epdm"],
};

/** Every system id the built-in catalog had BEFORE 2026-09-14. A saved
 *  company catalog holding none of the ids added since is from before the
 *  flat-roof release and gets them appended once; after that, a built-in the
 *  contractor deleted stays deleted. */
export const PRE_FLAT_RELEASE_IDS = new Set([
  "architectural", "three_tab", "impact_resistant", "designer", "standing_seam", "metal_panel", "stone_coated_steel",
  "metal_shingle", "concrete_tile", "clay_tile", "cedar_shake", "cedar_shingle", "synthetic_slate", "synthetic_shake",
  "slate", "copper", "tpo", "epdm", "pvc", "mod_bit", "bur", "rolled", "solar_shingle", "green_roof",
]);

/** The valley a roof family is built with: closed-cut on shingles, a formed
 *  pan on metal, raised-rib metal under tile and slate, open metal on shake.
 *  Low slope has no valleys at all. */
export const VALLEY_FOR_FAMILY: Record<RoofFamily, string | null> = {
  asphalt: "closed_cut",
  synthetic: "closed_cut",
  metal: "formed_pan",
  tile: "raised_rib",
  slate: "raised_rib",
  shake: "open_w24",
  "low-slope": null,
};
export function likeForLikeSystem(family: RoofFamily, lists: CatalogLists): RoofSystem | null {
  for (const id of LIKE_FOR_LIKE[family]) {
    const s = lists.systems.find((x) => x.id === id);
    if (s) return s;
  }
  return lists.systems.find((s) => s.family === family) ?? null;
}

export function familyLabel(family: RoofFamily): string {
  return ROOF_FAMILIES.find((f) => f.id === family)?.label ?? family;
}

/** The proposal's measurement vocabulary, as the units the builder emits. */
export const PKG_UNITS: PkgUnit[] = ["square", "sq ft", "linear ft", "each", "hour", "lot"];
