// OPENING A ROOF PROPOSAL AGAIN IN THE ROOF ESTIMATOR (owner, 2026-10-13: "make roofing proposal when open to get
// back to the roofing edit to rebuild it, make smart"). The proposal builder's "Edit the roof estimate" opens
// /dashboard/roof-estimator?proposal=<id>; the estimator comes back with the measurement, the package choices and the
// lines, and "Update PRO-XXXX" re-prices THAT proposal instead of making a second one.
//
// The convert keeps a ROOF_PLAN activity row: what the estimator was looking at (the measurement or the hand
// takeoff, the structures ticked in, the pitch typed, the package spec and the roof it fitted) and what it wrote on
// the proposal (title, scope, line names). The update rules are the deck's (lib/deck/proposalEdit): a signed, paid or
// finished proposal is never re-priced from here, the estimator's own lines are replaced, lines added in the builder
// stay after them, and the title and scope follow only while they are still what the estimator wrote.
//
// Pure, so scripts/qa/roof-proposal-edit.check.ts holds it without a database.
import { readDeckWritten, type DeckWritten } from "@/lib/deck/proposalEdit";
import type { RoofPackageSpec } from "./takeoff";

export const ROOF_PLAN_EVENT = "ROOF_PLAN";
export const ROOF_PLAN_VERSION = 1;

/** A hand takeoff (no measurement): squares and pitch typed in. */
export interface RoofManualTakeoff {
  squares: number;
  pitchLabel: string;
  address: string | null;
}

/** What the estimator kept with the proposal, to open it again. */
export interface RoofPlan {
  v: number;
  measurementId: string | null;
  manual: RoofManualTakeoff | null;
  /** The package builder's spec as converted, and the roof (factsKey) it was fitted to. */
  spec: RoofPackageSpec | null;
  factsKey: string | null;
  /** Other structures on the parcel ticked into the figures. */
  extra: number[];
  /** The pitch typed when the measurement had none. */
  pitchEntered: string | null;
  /** The contractor's notes on where the numbers came from — never the client's. */
  assumptions: string[];
  address: string | null;
  written: DeckWritten | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** A stored plan, read defensively (a row from an older build, or hand-edited, never throws). */
export function readRoofPlan(raw: unknown): RoofPlan | null {
  const r = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!r) return null;
  const m = (r.manual && typeof r.manual === "object" ? r.manual : null) as Record<string, unknown> | null;
  const manual =
    m && typeof m.squares === "number" && Number.isFinite(m.squares) && m.squares > 0
      ? { squares: m.squares, pitchLabel: typeof m.pitchLabel === "string" ? m.pitchLabel : "", address: str(m.address) }
      : null;
  const spec = r.spec && typeof r.spec === "object" && typeof (r.spec as { systemId?: unknown }).systemId === "string" ? (r.spec as RoofPackageSpec) : null;
  return {
    v: typeof r.v === "number" ? r.v : 0,
    measurementId: str(r.measurementId),
    manual,
    spec,
    factsKey: str(r.factsKey),
    extra: Array.isArray(r.extra) ? r.extra.filter((n): n is number => Number.isInteger(n) && n >= 0).slice(0, 50) : [],
    pitchEntered: str(r.pitchEntered),
    assumptions: Array.isArray(r.assumptions) ? r.assumptions.filter((a): a is string => typeof a === "string").slice(0, 60) : [],
    address: str(r.address),
    written: readDeckWritten(r.written),
  };
}

/** A line of the estimator's two tables. */
export interface RoofTableLine {
  name: string;
  quantity: number;
  unitPrice: number;
  unit: string;
}

/** The proposal's measurement types → the estimator's unit words (actions/roofEstimator unitToType reads them back). */
export function roofUnitWord(type: string): string {
  switch (type) {
    case "SQUARE":
      return "sq";
    case "SQFT":
      return "sq ft";
    case "LINEAR_FT":
      return "ln ft";
    case "LUMP_SUM":
      return "lot";
    case "HOUR":
      return "hr";
    case "CUBIC_FT":
      return "cu ft";
    default:
      return "ea";
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The estimator's tables, from the proposal as it stands: the lines the estimator wrote (by name; every line when the
 * plan predates the record), split the way the convert wrote them — a labor line carries labor only. Prices are the
 * lines' own costs (material + labor), the figures the convert sent; the builder's markups stay on the proposal.
 */
export function roofTablesFromProposal(
  lines: readonly { name: string; measurementType: string; quantity: number; unitPrice: number; materialCost: number; laborCost: number }[],
  written: DeckWritten | null,
): { materials: RoofTableLine[]; labor: RoofTableLine[]; others: number } {
  const mine = written ? new Set(written.lines) : null;
  const materials: RoofTableLine[] = [];
  const labor: RoofTableLine[] = [];
  let others = 0;
  for (const l of lines) {
    const name = l.name.trim();
    if (!name) continue;
    if (mine && !mine.has(name)) {
      others++;
      continue;
    }
    const cost = l.materialCost + l.laborCost;
    const unitPrice = round2(cost > 0 ? cost : l.unitPrice);
    const row = { name, quantity: l.quantity, unitPrice, unit: roofUnitWord(l.measurementType) };
    if (l.laborCost > 0 && l.materialCost === 0) labor.push(row);
    else materials.push(row);
  }
  return { materials, labor, others };
}

/** The tables as the update sends them: a material line is material, a labor line labor — the convert's split. */
export function roofUpdateLines(materials: readonly RoofTableLine[], labor: readonly RoofTableLine[]) {
  return [
    ...materials.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit, materialCost: l.unitPrice, laborCost: 0 })),
    ...labor.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit, materialCost: 0, laborCost: l.unitPrice })),
  ].filter((l) => l.name.trim());
}

/**
 * The estimate's free-text unit → the proposal's measurement type. Reads the
 * WORD, not an exact spelling: the AI wrote "linear foot" and the old exact
 * match sent every such line to the proposal as "Unit" (2026-09-12, every
 * line of a converted estimate showed "Unit"). Roofing squares get their own
 * type — SQUARE — so a shingle line stays "24.9 squares" on the proposal.
 */
export function roofUnitType(unit: string | undefined): string {
  const u = (unit ?? "").trim().toLowerCase();
  if (!u) return "UNIT";
  if (/sq\.?\s*ft|sqft|square\s*f(ee|oo)?t|\bsf\b/.test(u)) return "SQFT";
  if (/^sq(uare)?s?$/.test(u) || /\bsquares?\b/.test(u)) return "SQUARE";
  // Cubic before linear: "cu ft" carries "ft" too.
  if (/cu(bic)?\.?\s*(ft|yd)|\bcy\b/.test(u)) return "CUBIC_FT";
  if (/lin|\bln\b|\blf\b|\bft\b|f(ee|oo)t/.test(u)) return "LINEAR_FT";
  if (/hour|\bhrs?\b/.test(u)) return "HOUR";
  if (/lot|lump|allowance|flat|fixed|\bjob\b/.test(u)) return "LUMP_SUM";
  return "UNIT";
}
