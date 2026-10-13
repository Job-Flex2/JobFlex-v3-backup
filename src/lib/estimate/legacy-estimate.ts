// THE OLD QUOTE-DRAFT ESTIMATOR, WIRED TO THIS APP.
//
// Owner, 2026-09-03: "make sure our estimator works exactly like the old one".
// The previous JobFlex priced a Smart Proposal in one model call whose prompt
// was assembled by lib/ai/prompt.ts: the admin estimator prompt on top, the
// specialty's preamble, its curated material profile, the trade-filtered
// price book, sales-tax guidance, the proposal-template rules, the default
// pricing rules, project-type detection, the project details and the
// specialty's planning questions — sent at temperature 0 with seed 42 and
// parsed by lib/ai/parse.ts. That code is copied verbatim into ./legacy/ (the
// Redis price adjustments and the per-user custom-specialty DB reads are the
// only parts left out; they had no equivalent here).
//
// This module is the seam: it detects the specialty the way the old advanced
// route did, assembles the identical prompt with the owner's master prompt in
// the admin slot, and maps the old draft shape (pricing.lineItems with
// materialCost / laborCost / measurementType) onto this app's fused line
// items. The shop-list search runs after it in actions/advancedEstimator and
// never touches a price.
//
// Plain module, no "use server".

import { ESTIMATOR_MASTER_PROMPT } from "./master-prompt";
import { hvacPromptBlock, isHvacBrief } from "./hvac-prompt";
import { normalizeUnit } from "./console-model";
import { buildQuoteDraftPromptAnchored } from "./legacy/prompt";
import { parseAiDraftResponse, type AiDraftOutput, type AiDraftPricingLineItem } from "./legacy/parse";
import { detectSpecialty } from "./legacy/specialtyDetector";
import { getAiSpecialtyByIdSync, type AiSpecialty } from "./legacy/specialties";
import { buildTradeRulesBlock } from "./estimate-prompt";
import { briefRulesBlock, readBrief, type BriefFacts } from "./brief";
import { coreStepCount, formatProcedureBlock, PROCEDURE_RULES, procedureFor, type SpecialtyProcedure } from "./procedures";
import { briefScope, formatRemodelMethod, inRemodelFamily, remodelDomainsFor, type BriefScope, type RemodelDomain, type RemodelOverrides } from "./remodel-method";
import { rangeLine, remodelJob, remodelRange, type JobRange } from "./remodel-sanity";
import { fitsUtilityJob, utilityJob, utilityPriceBlock, utilityRange, utilityRangeLine, type UtilityJobId } from "./utility-work";
import { locationIndex, locationLine } from "./location-index";
import { pricesFor, specialtyRange, specialtyRangeLine, type SpecialtyPrices } from "./step-prices";
import { permitCall, permitPromptBlock, withoutPermitSteps, type PermitCall } from "./permits";

/** The old route's fallback when no specialty matched. Verbatim. */
export const GENERAL_CONTRACTING: AiSpecialty = {
  id: "general-contracting",
  name: "General Contracting",
  description: "General remodeling and contracting scope.",
  defaultTitle: "Project Proposal",
  promptPreamble:
    "You are an experienced estimator across general contracting trades. Produce a contractor-ready, line-by-line scope with materials and steps.",
  keyQuestions: [
    "What is the existing condition and access?",
    "Are permits or inspections required?",
    "Any preferred materials or brands?",
  ],
  category: "general",
};

/** The old provider's system message. Verbatim. */
export const LEGACY_SYSTEM_MESSAGE =
  "You are an AI assistant that drafts concise, professional contractor proposals. Always return valid JSON in your final answer. Follow all instructions provided in the user message carefully.";

export type LegacyEstimateInput = {
  description: string;
  location?: string | null;
  /** A named type from an older caller; folded into detection. */
  projectType?: string | null;
  sqft?: number;
  companyName?: string | null;
  /** "Regenerate with AI" constraints the contractor edited. */
  assumptions?: string[];
  qualityTier?: "budget" | "standard" | "luxury";
};

/** "Bothell, WA" / "13520 Bothell-Everett Hwy, Bothell, WA 98012" → {city, state}. */
export function localeFromLocation(location: string | null | undefined): { city?: string; state?: string } {
  const raw = (location ?? "").trim();
  if (!raw) return {};
  const state = raw.toUpperCase().match(/\b([A-Z]{2})\b(?=[\s,]*\d{5})?/g)?.pop() ?? undefined;
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  let city: string | undefined;
  if (parts.length >= 2) {
    // The token before the state is the city; a street line before it is not.
    const stateIdx = parts.findIndex((p) => /^[A-Za-z]{2}(\s+\d{5})?$/.test(p) || /^[A-Za-z]{2}\s/.test(p) === false && /\b[A-Z]{2}\b/.test(p) && p.length <= 8);
    const cand = stateIdx > 0 ? parts[stateIdx - 1] : parts[parts.length - 2];
    if (cand && !/\d/.test(cand)) city = cand;
  } else if (parts.length === 1 && !/\d/.test(parts[0]) && !/^[A-Za-z]{2}$/.test(parts[0])) {
    city = parts[0];
  }
  const st = state && /^[A-Z]{2}$/.test(state) ? state : undefined;
  return { city, state: st };
}

/** Pick the specialty the way the old advanced route did: keyword detection,
 *  else general contracting. */
export function specialtyFor(input: LegacyEstimateInput): { specialty: AiSpecialty; detected: boolean } {
  const text = `${input.projectType ?? ""} ${input.description}`.trim();
  const hit = detectSpecialty(text);
  if (hit) return { specialty: hit.specialty, detected: true };
  return { specialty: getAiSpecialtyByIdSync("general-contracting") ?? GENERAL_CONTRACTING, detected: false };
}

/** The whole prompt, assembled by the copied builder with the master prompt
 *  in the admin slot. `includePricing` is always on here. */
export type LegacyPromptOptions = {
  /**
   * Put the trade-profile + hard-rules block in the old prompt's "extra admin"
   * slot. On gpt-5-class models the verbatim old prompt is enough (that is
   * what the previous JobFlex ran); gpt-4o-class models return 4-6 lines
   * without it and the old output's 12 with it.
   */
  withTradeRules?: boolean;
  /**
   * What the platform admin changed on /admin/prompts (lib/estimate/
   * promptOverrides): the master prompt, the procedure rules, a specialty's
   * preamble or procedure. Absent = the code defaults.
   */
  overrides?: PromptOverrideSet | null;
  /** Skip detection and build for this specialty (the admin's prompt preview). */
  specialtyId?: string | null;
  /**
   * A trade of a NEW house priced from its blueprint takeoff (lib/plans): no remodel
   * method, partial scope or utility pricing (a new house has no rooms to tear out),
   * the permit decided by the trade instead of read off the brief, the benchmark sized
   * by the takeoff, and the old builder told it is new construction.
   */
  newBuild?: { permit: PermitCall | null; benchmarkQty: number | null } | null;
};

/** The override shape this module reads — the loader's type without the db. */
export type PromptOverrideSet = {
  master?: string;
  procedureRules?: string;
  specialties: Record<string, { preamble?: string; procedure?: SpecialtyProcedure }>;
  /** The remodel method's parts as the admin edited them. */
  remodel?: RemodelOverrides;
};

/**
 * The procedure block for a specialty — the lines a professional estimate
 * itemizes (lib/estimate/procedures), with the admin's edits applied. Null
 * for a specialty no procedure is written for.
 */
export function procedureBlockFor(
  specialty: AiSpecialty,
  overrides?: PromptOverrideSet | null,
  scope: BriefScope = "full",
  prices: SpecialtyPrices | null = pricesFor(specialty.id),
  /** A job that writes no permit line is not shown the permit step (lib/estimate/permits). */
  dropPermitSteps = false,
): string | null {
  const effective = effectiveProcedure(specialty.id, overrides);
  if (!effective) return null;
  const procedure = dropPermitSteps ? withoutPermitSteps(effective) : effective;
  return formatProcedureBlock(specialty.name, procedure, overrides?.procedureRules ?? PROCEDURE_RULES, {
    partial: scope === "partial",
    prices,
  });
}

/** The admin's procedure for the specialty when saved, else the code's. */
export function effectiveProcedure(specialtyId: string, overrides?: PromptOverrideSet | null): SpecialtyProcedure | null {
  return overrides?.specialties[specialtyId]?.procedure ?? procedureFor(specialtyId);
}

export function buildLegacyEstimatePrompt(
  input: LegacyEstimateInput,
  opts: LegacyPromptOptions = {},
): {
  specialty: AiSpecialty;
  prompt: string;
  hvac: boolean;
  facts: BriefFacts;
  procedure: boolean;
  /** The fewest lines a complete answer has — 0 for a brief that names part of a room. */
  procedureCoreSteps: number;
  /** "partial" when the brief names a piece of a room the specialty remodels whole. */
  scope: BriefScope;
  /** The remodel method's room parts this brief carries (empty = no method). */
  remodelDomains: RemodelDomain[];
  /** A whole remodel of a known kind, an underground utility run, or a whole job of stated size: its range here, before markup. */
  range: JobRange | null;
  /** The kind of underground utility job the brief is (sewer, storm, water; street or yard). */
  utilityJob: UtilityJobId | null;
  /** How many of the procedure's steps the price book prices (null: no procedure or no book). */
  priced: { steps: number; of: number } | null;
  /** Whether this job takes a permit, decided from the brief (null: the trade's own procedure decides). */
  permit: PermitCall | null;
} {
  const chosen = opts.specialtyId ? getAiSpecialtyByIdSync(opts.specialtyId) : undefined;
  const found = chosen ? null : specialtyFor(input);
  const detected = chosen ?? found!.specialty;
  // No specialty matched: the general-contracting fallback. It prices its
  // steps, but gets no benchmark range — that is a remodel's, and an
  // unmatched small job must never be asked to reach it.
  const fallback = !!found && !found.detected;
  // The admin's preamble, when one was saved for this specialty.
  const ownPreamble = opts.overrides?.specialties[detected.id]?.preamble?.trim();
  const specialty: AiSpecialty = ownPreamble ? { ...detected, promptPreamble: ownPreamble } : detected;
  const master = opts.overrides?.master?.trim() || ESTIMATOR_MASTER_PROMPT;
  // The numbers the brief states — bound into the prompt here, held on the
  // reply by the action (lib/estimate/brief).
  const facts = readBrief(input.description, { sqft: input.sqft });
  const locale = localeFromLocation(input.location);
  // An HVAC brief gets the owner's HVAC proposal method right after the
  // master prompt, whatever model answers (lib/estimate/hvac-prompt). Either
  // detector saying HVAC is enough: the old specialty detector or the trade
  // profile's keyword pass.
  const hvac = specialty.id === "hvac" || isHvacBrief(`${input.projectType ?? ""} ${input.description}`);
  const clean = (input.assumptions ?? []).map((a) => a.trim()).filter(Boolean);
  const tier = input.qualityTier && input.qualityTier !== "standard" ? input.qualityTier : null;
  // The old summary was the contractor's text alone. The refine-loop
  // assumptions and the tier ride along as more summary so the builder is
  // untouched.
  const summary = [
    input.description.trim(),
    tier ? `Quality tier requested: ${tier}.` : "",
    clean.length ? `Contractor assumptions and constraints (treat as ground truth):\n${clean.map((a) => `- ${a}`).join("\n")}` : "",
    briefRulesBlock(facts),
  ]
    .filter(Boolean)
    .join("\n\n");
  // The specialty's procedure — the lines a pro itemizes, in order, with
  // their units — rides in the old prompt's "extra admin" slot for every
  // model, ahead of the trade profile block when that is sent too.
  const briefText = `${input.projectType ?? ""} ${input.description}`;
  const newBuild = opts.newBuild ?? null;
  const scope: BriefScope = newBuild ? "full" : briefScope(briefText, specialty.id);
  // The remodel method — what this brief implies, the chains, the code
  // triggers, the never-forgotten lines and the sanity ranges — for the
  // rooms the brief's words reach (lib/estimate/remodel-method).
  const remodelDomains = newBuild ? [] : remodelDomainsFor(briefText, specialty.id);
  // Sewer, storm and water lines are civil work, priced at public bid prices
  // (lib/estimate/utility-work) — never as house plumbing.
  const utility = remodelDomains.length || newBuild ? null : utilityJob(briefText, specialty.id);
  // The price book's cost on every step (lib/estimate/step-prices) — unless
  // this is a utility job the specialty's book is the wrong scale for (a
  // side-sewer book on a street main): then the job's bid prices govern.
  const book = pricesFor(specialty.id);
  const prices = book && utility && !fitsUtilityJob(book, utility) ? null : book;
  // Not every job takes a permit (owner, 2026-10-09): decided here from the
  // brief, the permit step leaves the procedure of a job that writes none,
  // and the decision rides last so it outranks every earlier word on permits.
  const permit = newBuild ? newBuild.permit : permitCall({ text: briefText, specialtyId: specialty.id, scope });
  const dropPermit = !!permit && permit.need !== "required";
  const procedureBlock = procedureBlockFor(specialty, opts.overrides, scope, prices, dropPermit);
  const remodelMethod = formatRemodelMethod(remodelDomains, opts.overrides?.remodel);
  // A whole remodel of a known kind carries its range, so the model sees the
  // number before it answers; the action asks again when the reply falls
  // under it (lib/estimate/remodel-sanity). A stated price has no range.
  const remodel = newBuild ? null : remodelRange(remodelJob(briefText, facts, scope, specialty.id, remodelDomains), facts, input.location, briefText);
  const remodelBlock = remodelMethod ? (remodel ? `${remodelMethod}\n\n${rangeLine(remodel)}` : remodelMethod) : null;
  const utilityRun = utilityRange(utility, facts, input.location);
  // Any other whole job whose size the brief states in the unit the trade
  // sells by gets the price book's benchmark for the trade
  // (lib/estimate/step-prices) — a floor or a paint job that names a room
  // too. Remodelers and general contractors keep the method's ranges. A
  // stated price is binding and has no range.
  const statedPrice = !!(facts.sellTotal || facts.sellPerUnit);
  const benchmark = newBuild
    ? newBuild.benchmarkQty
      ? specialtyRange(specialty, facts, input.location, newBuild.benchmarkQty)
      : null
    : !remodel && !utility && !inRemodelFamily(specialty.id) && scope === "full" && !statedPrice && !fallback
      ? specialtyRange(specialty, facts, input.location)
      : null;
  const range: JobRange | null = remodel ?? utilityRun ?? benchmark;
  const tradeRules = opts.withTradeRules
    ? buildTradeRulesBlock({
        description: input.description,
        location: input.location,
        qualityTier: input.qualityTier ?? "standard",
        projectType: input.projectType,
      })
    : null;
  // The job's market, city first (lib/estimate/location-index). The trade
  // block carries the same line when it is sent, so it rides alone otherwise.
  const location = tradeRules ? null : locationLine(locationIndex(input.location));
  const utilityBlock = utility
    ? [tradeRules ? null : utilityPriceBlock(utility), utilityRun ? utilityRangeLine(utilityRun) : null].filter((b): b is string => !!b).join("\n\n") || null
    : null;
  const benchmarkLine = benchmark ? specialtyRangeLine(benchmark) : null;
  const extra = [location, procedureBlock, benchmarkLine, remodelBlock, utilityBlock, tradeRules, permitPromptBlock(permit, input.location)].filter((b): b is string => !!b).join("\n\n");
  // The previous JobFlex sent the price book and the material profile with
  // every estimate; the anchored builder puts them back (2026-09-18).
  const prompt = buildQuoteDraftPromptAnchored({
    specialty,
    summary,
    projectSize: input.sqft ? `${input.sqft} sqft` : undefined,
    projectType: newBuild ? "new-construction" : "remodel",
    companyName: input.companyName ?? undefined,
    locale,
    includePricing: true,
    adminPrompt: hvac ? `${master}\n\n${hvacPromptBlock()}` : master,
    adminPromptExtra: extra || null,
    pricingPrompt: null,
  });
  const own = effectiveProcedure(specialty.id, opts.overrides);
  const effective = own && dropPermit ? withoutPermitSteps(own) : own;
  const priced = effective && prices ? { steps: effective.steps.filter((s) => prices.steps[s.item.trim()]).length, of: effective.steps.length } : null;
  return {
    specialty,
    prompt,
    hvac,
    facts,
    procedure: procedureBlock !== null,
    procedureCoreSteps: scope === "full" ? coreStepCount(effective) : 0,
    scope,
    remodelDomains,
    range,
    utilityJob: utility,
    priced,
    permit,
  };
}

// ── Mapping the old draft onto fused line items ─────────────────────────────

/** measurementType (old) → the ten-unit picker. */
const UNIT_OF_MEASUREMENT: Record<string, string> = {
  sqft: "sqft",
  linear: "linear ft",
  linearft: "linear ft",
  lf: "lf",
  cubic: "cu yards",
  unit: "unit",
  hour: "hour",
  fixed: "fixed",
  sqboards: "sq boards",
  yards: "yards",
  sqyards: "sq yards",
};

export type LegacyItem = {
  name: string;
  unit: string;
  quantity: number;
  materialUnitPrice: number;
  laborUnitPrice: number;
  notes?: string;
  searchQuery: string | null;
  /** Set by the post-generation validation pass, never by the model
   *  (lib/estimate/validate-estimate): a line the app added, a price it pulled
   *  to the anchor, or work the brief never asked for. */
  flag?: "auto" | "adjusted" | "suggested" | "computed";
  flagNote?: string;
};

const money = (n: number) => Math.round(n * 100) / 100;
const PACKAGE_WORD = /\b(bundles?|rolls?|coils?|box(es)?|cartons?|bags?|sheets?|pieces?|tubes?|buckets?|pails?|gallons?)\b/i;

/**
 * One old line → one fused item.
 *
 * Quantity is `sqft` for sqft lines, `quantity` otherwise, 1 for a fixed
 * line. Costs are per-line dollars in the old shape (materialCost, laborCost
 * ≈ total), so the per-unit prices are cost ÷ quantity. When the model
 * skipped the split but gave a total, the old default rule applies: 55%
 * material, 45% labor on measured lines; a labor-only reading for hours.
 */
export function legacyLineToItem(l: AiDraftPricingLineItem): LegacyItem | null {
  const name = (l.name ?? "").trim();
  if (!name) return null;
  const mt = (l.measurementType ?? "").toLowerCase().replace(/[^a-z]/g, "");
  let unit = normalizeUnit(UNIT_OF_MEASUREMENT[mt] ?? mt ?? "unit");
  // The old shape filed roofing squares under 'unit' ("use 'unit' with
  // quantity in squares"); this picker has a word for them.
  // A line that names its package ("shingles, 3 bundles a square", "10-square rolls") is
  // counted in that package — a blueprint build list buys by the bundle — not in squares.
  if (unit === "unit" && /\bshingle|roofing square|\bsquares?\b/i.test(name) && !PACKAGE_WORD.test(name)) unit = "sq boards";
  let qty =
    unit === "fixed"
      ? 1
      : unit === "sqft"
        ? l.sqft ?? l.quantity ?? 0
        : l.quantity ?? l.sqft ?? 0;
  if (!Number.isFinite(qty) || qty <= 0) qty = 1;

  let material = Number.isFinite(l.materialCost) ? Number(l.materialCost) : NaN;
  let labor = Number.isFinite(l.laborCost) ? Number(l.laborCost) : NaN;
  const total = Number.isFinite(l.total)
    ? Number(l.total)
    : unit === "fixed"
      ? l.fixedPrice ?? 0
      : (l.unitPrice ?? 0) * qty;
  if (!Number.isFinite(material) && !Number.isFinite(labor)) {
    if (unit === "hour") {
      material = 0;
      labor = total;
    } else {
      material = total * 0.55;
      labor = total * 0.45;
    }
  } else if (!Number.isFinite(material)) {
    material = Math.max(0, total - labor);
  } else if (!Number.isFinite(labor)) {
    labor = Math.max(0, total - material);
  }
  material = Math.max(0, material);
  labor = Math.max(0, labor);
  const desc = (l.description ?? "").trim();
  return {
    name,
    unit,
    quantity: qty,
    materialUnitPrice: money(material / qty),
    laborUnitPrice: money(labor / qty),
    notes: desc || undefined,
    // The shop list's query: the line itself names the product ("Supply
    // contractor-grade Class A architectural laminated asphalt shingles…").
    searchQuery: material > 0 ? name.slice(0, 120) : null,
  };
}

/** "2-3 weeks", "10 working days", "approximately 4 days" → days, or undefined. */
export function timelineDays(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = text.toLowerCase().match(/(\d+)(?:\s*[-–to]+\s*(\d+))?\s*(day|week|month)/);
  if (!m) return undefined;
  const n = m[2] ? (Number(m[1]) + Number(m[2])) / 2 : Number(m[1]);
  const per = m[3] === "week" ? 5 : m[3] === "month" ? 22 : 1;
  const days = Math.round(n * per);
  return days > 0 ? days : undefined;
}

export type LegacyEstimate = {
  title: string;
  scope: string;
  assumptions: string[];
  estimatedTimelineDays?: number;
  items: LegacyItem[];
  /** The old pricing block's markup, surfaced as text; this app applies the org's own markup on conversion. */
  overheadPct?: number;
  profitPct?: number;
  warnings: string[];
  draft: AiDraftOutput;
};

/** Parse the model's text with the old parser and map it. */
export function legacyEstimateFromText(raw: string, specialty: AiSpecialty): LegacyEstimate {
  const { draft, warnings } = parseAiDraftResponse(raw);
  const items = (draft.pricing?.lineItems ?? [])
    .map(legacyLineToItem)
    .filter((x): x is LegacyItem => x !== null);
  const scope = [draft.summary?.trim(), draft.scope?.length ? draft.scope.map((s) => `- ${s.trim()}`).join("\n") : ""]
    .filter(Boolean)
    .join("\n\n");
  // The old shape asked for fractions (0.10); models also answer in percent
  // (10) or, occasionally, dollars — anything past 100% is not a rate.
  const pct = (v: number | undefined): number | undefined => {
    if (v == null || !Number.isFinite(v) || v < 0) return undefined;
    const p = v <= 1 ? v * 100 : v;
    return p <= 100 ? Math.round(p) : undefined;
  };
  const overheadPct = pct(draft.pricing?.overhead);
  const profitPct = pct(draft.pricing?.profit);
  const assumptions = [
    ...(draft.pricing?.notes ?? []),
    ...(draft.disclaimers ?? []),
    overheadPct != null || profitPct != null
      ? `Estimator suggested overhead ${overheadPct ?? 0}% and profit ${profitPct ?? 0}% on top of these costs — your markup settings apply when this converts to a proposal.`
      : "",
  ]
    .map((a) => a.trim())
    .filter(Boolean);
  return {
    title: draft.title?.trim() || specialty.defaultTitle,
    scope,
    assumptions,
    estimatedTimelineDays: timelineDays(draft.timeline),
    items,
    overheadPct,
    profitPct,
    warnings,
    draft,
  };
}
