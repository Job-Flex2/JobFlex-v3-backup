"use server";
import { enforceRateLimit, HOUR } from "@/lib/rateLimit";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireEstimatorOrManager } from "@/lib/orgContext";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { db } from "@/lib/db";
import { recordInventoryLink } from "@/lib/inventoryPick";
import { clearFilingContext, filedClientId, leadProposalText, readFilingContext } from "@/lib/filingContext";
import {
  friendlyAIError,
  getOpenAI,
  isOpenAIEnabled,
  isTransientAIError,
  resolveOpenAIModel,
  samplingOptions,
} from "@/lib/sdk/openai";
import { ProposalStatus } from "@/lib/prismaEnums";
import { checkPlanLimit, enforcePlanLimit } from "@/lib/limitsEngine";
import { PLAN_LIMIT_MESSAGE, type LimitKey } from "@/lib/planLimits";
import { sellUnitPrice, resolveMarkupRates } from "@/lib/pricing/markup";
import { PRICING_RULES, UNIT_RULES } from "@/lib/estimate/master-prompt";
import { measureUnit, pairEstimateLines } from "@/lib/estimate/console-model";
import { applyRepairs, repairInstruction, validateEstimate } from "@/lib/estimate/validate-estimate";
import { computeLines, computedPromptBlock, mergeComputed } from "@/lib/estimate/computed-lines";
import { detectTrade, GENERAL_TRADE, TRADES, type TradeProfile } from "@/lib/estimate/trade-knowledge";
import { buildLegacyEstimatePrompt, effectiveProcedure, legacyEstimateFromText, LEGACY_SYSTEM_MESSAGE, specialtyFor } from "@/lib/estimate/legacy-estimate";
import { costQuestionBlock, costQuestions } from "@/lib/estimate/intake-questions";
import { isTradeId } from "@/lib/inventory";
import { procedureFor } from "@/lib/estimate/procedures";
import { loadPromptOverrides } from "@/lib/estimate/promptOverrides";
import { floorNote, floorToRange, fullerAnswer, linesTotal, retryReasons } from "@/lib/estimate/remodel-sanity";
import { bindEstimateToBrief, bindLinesToBrief, bindTextToBrief, keepCostCritical, readBrief, scrubUnaskedText, scrubUnaskedWork } from "@/lib/estimate/brief";
import { holdPermitDecision, permitSummary } from "@/lib/estimate/permits";
import { stateFromAddress, stateTaxRate } from "@/lib/pricing/salesTax";
import { applyCompanyPricing, companyPricingActive, hoursPromptBlock, materialsTaxLine, snapshotOf } from "@/lib/estimate/companyPricing";
import { readCompanyPricing } from "@/lib/estimate/companyPricingServer";
import {
  discountSchema,
  estimateSchema,
  lineSchema,
  pricingSnapshotSchema,
  promptAnalysisSchema,
  type GeneratedEstimate,
  type PromptAnalysis,
} from "@/lib/estimatorSchema";
import { trackActivation, trackProposalCreated } from "@/lib/activation-events";
import { applyMemberDiscount } from "@/lib/servicePlanBook";
import { takeTrialCap } from "@/lib/trialMeter";
import { briefFingerprint, keepEstimate, photoPrint, SAME_NOTE, sameEstimate } from "@/lib/estimate/sameBrief";
import { requirePage } from "@/lib/customPageAccess";
import { readPlanPass } from "@/lib/plans/planToken";
import { bindLinesToTakeoff } from "@/lib/plans/tradeBrief";
import { GENERAL_CONDITIONS_PROCEDURE, newBuildPhases, newBuildProcedure, planTradeRun, type PlanTradeRun } from "@/lib/plans/tradeSetup";
import { tradePriceInput } from "@/lib/plans/wire";

/**
 * Quota gate for the AI *run* functions. Returned (not thrown) because these
 * actions signal errors via { ok: false } unions and thrown messages are
 * redacted in prod. Runs are capped by the same "estimatorUses" budget that
 * saveEstimate consumes (usage = saved AiEstimate rows).
 */
async function estimatorRunBlocked(
  organizationId: string,
): Promise<{ ok: false; error: string; code: "PLAN_LIMIT_REACHED"; resource: LimitKey } | null> {
  const quota = await checkPlanLimit(organizationId, "estimatorUses");
  if (quota.allowed) return null;
  return {
    ok: false,
    error: PLAN_LIMIT_MESSAGE,
    code: "PLAN_LIMIT_REACHED",
    // estimatorUses is capped by proposalsCreated (every estimate → a proposal),
    // so report whichever actually ran out.
    resource: quota.cappedBy ?? "estimatorUses",
  };
}

/** The "Project type:" line of a user turn — omitted when the intake no longer
 *  asks for one (2026-09-02), so the model reads the type off the brief. */
function projectLine(projectType: string | null | undefined): string {
  const t = (projectType ?? "").trim();
  return t ? `Project type: ${t}` : "Project type: infer it from the description";
}

/** How long to wait before the single retry of a busy model call. */
const RETRY_DELAY_MS = 3_000;

const STUB: GeneratedEstimate = {
  title: "Sample Roof Replacement Estimate · AI Disabled",
  scope:
    "Full tear-off, synthetic underlayment, 30-year architectural shingles, new ridge vents, ice & water shield at valleys and eaves, drip edge, pipe collars. Full cleanup and magnetic sweep.",
  assumptions: [
    "No decking replacement needed beyond 2 sheets",
    "Existing chimney flashing to be reused",
    "One-layer tear-off; dumpster on driveway",
    "Pricing placeholders — add OPENAI_API_KEY for real generation",
  ],
  materials: [
    { name: "Architectural shingles (30-yr)", quantity: 24, unitPrice: 115, unit: "sq boards" },
    { name: "Synthetic underlayment", quantity: 24, unitPrice: 32, unit: "sq boards" },
    { name: "Ice & water shield", quantity: 400, unitPrice: 1.1, unit: "sqft" },
    { name: "Ridge vent system", quantity: 60, unitPrice: 6, unit: "linear ft" },
    { name: "Drip edge + flashing", quantity: 1, unitPrice: 480, unit: "fixed" },
  ],
  labor: [
    { name: "Tear-off + disposal", quantity: 2400, unitPrice: 0.8, unit: "sqft" },
    { name: "Installation labor", quantity: 2400, unitPrice: 1.8, unit: "sqft" },
    { name: "Cleanup + magnetic sweep", quantity: 1, unitPrice: 380, unit: "fixed" },
  ],
  estimatedTimelineDays: 3,
};

interface GenerateInput {
  projectType: string;
  description: string;
  location?: string;
  sqft?: number;
  qualityTier?: "budget" | "standard" | "luxury";
  /** User-edited assumptions fed back in via "Regenerate with AI" — treated as constraints. */
  assumptions?: string[];
  /**
   * Site photos from the intake step, as base64 data URLs (or https URLs).
   * Sent to the model as vision input, never stored. See `safePhotos`.
   */
  photos?: SitePhoto[];
  /** "Ask for a fresh estimate": price it again even when this exact brief was priced before (lib/estimate/sameBrief). */
  fresh?: boolean;
}

/**
 * One site photo. The browser sends `{ url }`: React's server-action decoder refuses an
 * ARRAY whose strings add up past a million characters ("Maximum array nesting
 * exceeded"), which two phone photos do. A bare string is still read, for older pages.
 */
type SitePhoto = string | { url: string };

/** How many times a rejected estimate is handed back to the model with its
 *  violations before the deterministic repair takes over (audit 2026-09-17). */
const MAX_ESTIMATE_REPAIRS = 2;
// ── Site photos (vision input) ──────────────────────────────────────────────
//
// The intake step lets a contractor drop photos of the job. They are read to
// base64 data URLs in the browser and passed straight through to the model —
// nothing is uploaded or persisted, so a photo exists only for the length of
// the request that prices it.
//
// The cap is deliberate: images dominate the token cost of these calls, and a
// modern phone camera roll will happily hand over 12MB frames. Six images at
// roughly 6MB of base64 each is the ceiling a single estimate can spend.
const MAX_PHOTOS = 6;
const MAX_PHOTO_CHARS = 8_000_000; // ~6MB binary once base64-decoded.

/**
 * Keep only what is safe to hand OpenAI as an image: an inline base64 image, or
 * an https image URL. Anything else — a `javascript:` scheme, a `file:` path, a
 * non-image data URL, an oversized frame — is dropped silently rather than
 * failing the estimate the contractor is waiting on.
 */
function safePhotos(photos: SitePhoto[] | undefined): string[] {
  if (!photos?.length) return [];
  const clean: string[] = [];
  for (const p of photos) {
    const raw = typeof p === "string" ? p : p && typeof p === "object" && typeof p.url === "string" ? p.url : "";
    const v = raw.trim();
    if (!v || v.length > MAX_PHOTO_CHARS) continue;
    const inlineImage = /^data:image\/(png|jpe?g|webp|gif|heic|heif);base64,[A-Za-z0-9+/=]+$/i.test(v);
    const httpsImage = /^https:\/\//i.test(v);
    if (inlineImage || httpsImage) clean.push(v);
    if (clean.length === MAX_PHOTOS) break;
  }
  return clean;
}

/**
 * A chat `content` value carrying the prompt text plus any photos.
 *
 * Returns the plain string when there are no photos so the text-only path stays
 * byte-identical to what it was before photos existed — the multimodal array
 * form is only used when it earns its place.
 */
function withPhotos(text: string, photos: string[]) {
  if (!photos.length) return text;
  return [
    { type: "text", text },
    ...photos.map((url) => ({ type: "image_url", image_url: { url, detail: "auto" } })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any;
}

/**
 * Intake gate — runs BEFORE generation. Corrects the location and judges whether
 * the brief is descriptive enough for an accurate proposal. When it's thin, it
 * returns 3-8 targeted clarifying questions (scaled to how under-specified the
 * brief is). Never blocks: on any failure it returns enoughDetail=true.
 */
export async function analyzeEstimatePrompt(input: {
  projectType: string;
  description: string;
  location?: string;
  sqft?: number;
  /** Site photos as data/https URLs — a photo often answers a question the gate would otherwise ask. */
  photos?: SitePhoto[];
}): Promise<
  | { ok: true; data: PromptAnalysis }
  | { ok: false; error: string; code?: "PLAN_LIMIT_REACHED"; resource?: LimitKey }
> {
  let organizationId: string;
  try {
    ({ organizationId } = await requireEstimatorOrManager());
    await requirePage(organizationId, ["smart-proposal", "video-estimator"]);
    await enforceRateLimit(`ai:${organizationId}`, 60, HOUR, "AI runs");
    const { requireFeatureOrThrow } = await import("@/lib/entitlements");
    const { getOrgPlanById } = await import("@/lib/orgPlan");
    const plan = await getOrgPlanById(organizationId);
    requireFeatureOrThrow(plan, "advanced_estimator");
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Upgrade required" };
  }
  const blocked = await estimatorRunBlocked(organizationId);
  if (blocked) return blocked;

  const passthrough: PromptAnalysis = {
    correctedLocation: input.location?.trim() || null,
    enoughDetail: true,
    questions: [],
  };
  if (!isOpenAIEnabled()) return { ok: true, data: passthrough };
  // The card-less trial's AI ceiling (lib/trialMeter): one run, one use.
  const trial = await takeTrialCap(organizationId, "aiCalls");
  if (!trial.ok) return trial.failure;

  const analyzePhotos = safePhotos(input.photos);
  const facts = readBrief(input.description, { sqft: input.sqft });
  // What to ask is decided here, not by the model: the job's own measure
  // (without it no range checks the price) and the conditional steps of this
  // trade's procedure, ranked by what each costs on this job
  // (lib/estimate/intake-questions). The model only puts them in words.
  const gateSpecialty = specialtyFor({ description: input.description, projectType: input.projectType }).specialty;
  const wanted = costQuestions(gateSpecialty.id, procedureFor(gateSpecialty.id), facts, input.location, { brief: input.description });
  const wantedBlock = costQuestionBlock(wanted);
  const stated = [
    facts.area ? `the area (${facts.area} sqft)` : "",
    facts.length ? `the run (${facts.length} linear ft)` : "",
    facts.sellPerUnit ? `the customer price ($${facts.sellPerUnit.amount} per ${facts.sellPerUnit.unit})` : "",
    facts.sellTotal ? `the job price ($${facts.sellTotal.amount})` : "",
  ].filter(Boolean);

  try {
    const client = getOpenAI();
    const completion = await client.chat.completions.create({
      // The model this process may call (lib/sdk/openai), at temperature 0 with a seed (2026-10-21): this read
      // corrects the place the job is priced in and words the questions, so the same brief should read the same way
      // twice — at 0.2 the place could come back differently and move the city's price index.
      model: await resolveOpenAIModel(),
      ...(await samplingOptions(0, 42)),
      messages: [
        {
          role: "system",
          content:
            'You are a senior estimator\'s intake assistant. Return JSON ONLY matching: {"correctedLocation": string|null, "enoughDetail": boolean, "questions": [{"id": string, "question": string, "why": string, "kind": "select"|"number"|"text", "options"?: string[], "unit"?: string, "placeholder"?: string}]}. ' +
            "(1) correctedLocation: if a location is given, fix typos and normalize to \"City, ST\" (2-letter US state). If none or clearly not a place, null. " +
            "(2) The contractor's brief is the whole intake. Ask a question ONLY when its answer is critical to the cost — an existing condition the contractor cannot price without knowing, that adds a line or moves the job's price by roughly 10% or more: cracks, pits or spalling to repair; an old coating, sealer or floor to grind off or remove; a second layer of shingles; rotten decking or framing; a fence to tear out; rocky or sloped ground; drywall repairs before paint; lead or asbestos era; a panel with no room. " +
            "Never ask about preferences or logistics: color, pattern, brand, style, finish look, schedule, start date, access, parking, how they found you, or anything the brief already states. Never ask for a quantity, a system or a price the brief gives. " +
            "Most briefs need NO question: then enoughDetail=true and questions=[]. Ask at most 3, the most cost-critical first. Each question is one plain sentence a contractor answers in a tap, its `why` is one short clause saying how the answer moves the price ('crack repair adds prep time and epoxy patch'), and its options (2-4, kind 'select') always include the standard case first ('Bare, sound concrete') so the contractor can confirm the default. Use kind 'number' with a `unit` for a measurement, 'text' with a `placeholder` only when no options fit.",
        },
        {
          role: "user",
          content: withPhotos(
            `${projectLine(input.projectType)}
${input.location ? `Location: ${input.location}` : "Location: (none given)"}
${input.sqft ? `Approx size: ${input.sqft} sqft` : ""}
Description: ${input.description}${stated.length ? `\n\nThe brief already states ${stated.join(", ")} — do not ask about those.` : ""}${wantedBlock ? `\n\n${wantedBlock}` : ""}${
              analyzePhotos.length
                ? `\n\n${analyzePhotos.length} site photo(s) are attached. Read them before asking — a photo that shows the slab, the roof or the ground answers the condition question.`
                : ""
            }`,
            analyzePhotos,
          ),
        },
      ],
      response_format: { type: "json_object" },
    });
    const text = completion.choices[0]?.message?.content ?? "{}";
    const parsed = promptAnalysisSchema.parse(JSON.parse(text));
    // Only cost-critical questions survive (preferences and logistics are
    // dropped whatever the model said), at most three, and an option-less
    // "select" becomes "text" so the UI never renders an unanswerable one. If
    // "not enough" but zero questions came back, the brief is enough.
    // The chosen questions ride in their own order with the model's wording;
    // anything else it asked follows, and the cost-critical filter still rules.
    // A missing measure is a fact, so it is always asked. A condition is a
    // judgment: it rides only when the model, which read the brief and the
    // photos, asked it back — that is what drops the ones the job rules out.
    const said = new Map(parsed.questions.map((q) => [q.id, q]));
    const asked = wanted
      .filter((w) => w.id === "job-measure" || said.has(w.id))
      .map((w) => {
        const m = said.get(w.id);
        return {
          id: w.id,
          question: m?.question?.trim() || w.question,
          why: m?.why?.trim() || w.why,
          kind: m?.kind ?? w.kind,
          options: w.kind === "select" ? (m?.options?.length ? m.options : w.options) : m?.options,
          unit: w.unit ?? m?.unit,
          placeholder: m?.placeholder,
        };
      });
    const extras = parsed.questions.filter((q) => !wanted.some((w) => w.id === q.id));
    const questions = keepCostCritical([...asked, ...extras], input.description)
      .slice(0, 3)
      .map((q) =>
        q.kind === "select" && (!q.options || q.options.length === 0)
          ? { ...q, kind: "text" as const }
          : q,
      );
    console.info(
      `[analyzeEstimatePrompt] ${gateSpecialty.id} · ${wanted.length} cost-critical (${wanted.map((w) => `${w.id} $${Math.round(w.impact)}`).join(", ") || "none"}) · asking ${questions.length}`,
    );
    return {
      ok: true,
      data: { ...parsed, questions, enoughDetail: parsed.enoughDetail || questions.length === 0 },
    };
  } catch (err: any) {
    console.warn(`[analyzeEstimatePrompt] failed, proceeding without clarify: ${err?.message ?? err}`);
    // The provider refused (no completion billed): the run is given back.
    if (typeof err?.status === "number") await trial.refund();
    return { ok: true, data: passthrough };
  }
}

/**
 * The Smart estimate: the model writes the job's lines, the brief's measured
 * phases are costed here, and validation holds both to the contractor's own
 * numbers. No store is searched — material prices come from the trade price
 * book (owner, 2026-10-09: a shop list of the wrong products embarrassed the
 * contractor in front of the client).
 */
type EstimateRun =
  | { ok: true; data: GeneratedEstimate; disabled?: false }
  | { ok: true; data: GeneratedEstimate; disabled: true }
  | { ok: false; error: string; code?: "PLAN_LIMIT_REACHED"; resource?: LimitKey };

export async function generateAdvancedEstimate(input: GenerateInput): Promise<EstimateRun> {
  let organizationId: string;
  try {
    ({ organizationId } = await requireEstimatorOrManager());
    await requirePage(organizationId, ["smart-proposal", "video-estimator"]);
    await enforceRateLimit(`ai:${organizationId}`, 60, HOUR, "AI runs");
    const { requireFeatureOrThrow } = await import("@/lib/entitlements");
    const { getOrgPlanById } = await import("@/lib/orgPlan");
    const plan = await getOrgPlanById(organizationId);
    requireFeatureOrThrow(plan, "advanced_estimator");
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Upgrade required" };
  }
  const blocked = await estimatorRunBlocked(organizationId);
  if (blocked) return blocked;

  if (!isOpenAIEnabled()) {
    return { ok: true, data: { ...STUB, title: `${input.projectType || "Sample"} estimate · AI disabled` }, disabled: true };
  }
  const trial = await takeTrialCap(organizationId, "aiCalls");
  if (!trial.ok) return trial.failure;
  return runSmartEstimate(organizationId, input, null, trial.refund);
}

/**
 * A trade of a house priced from its blueprint takeoff (lib/plans): the brief is
 * written on the server from the takeoff, the specialty is pinned, and the trial cap
 * was taken once when the plan set was opened (planEstimator.startPlanSession) — the
 * signed pass that proves it rides with every trade.
 */
export async function pricePlanTrade(raw: unknown): Promise<EstimateRun> {
  const parsed = tradePriceInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "This trade's takeoff could not be read — open the plans again." };
  const input = parsed.data;
  let organizationId: string;
  try {
    ({ organizationId } = await requireEstimatorOrManager());
    await requirePage(organizationId, ["smart-proposal"]);
    const { requireFeatureOrThrow } = await import("@/lib/entitlements");
    const { getOrgPlanById } = await import("@/lib/orgPlan");
    requireFeatureOrThrow(await getOrgPlanById(organizationId), "advanced_estimator");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Upgrade required" };
  }
  const pass = readPlanPass(input.token, organizationId);
  if (!pass) return { ok: false, error: "This blueprint session has expired — open the plans again." };
  try {
    // One whole house is 18 trades: pricing it twice (after a takeoff change) with a
    // few retries is fine, a loop is not — the whole plan set cost one trial use.
    await enforceRateLimit(`plan-price:${pass.nonce}`, 40, 6 * HOUR, "trade estimates");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Too many trade estimates." };
  }
  const blocked = await estimatorRunBlocked(organizationId);
  if (blocked) return blocked;
  if (!isOpenAIEnabled()) return { ok: false, error: "Pricing needs the estimator's AI service, which is not set up on this workspace." };
  const run = planTradeRun({ trade: input.trade, house: input.house, items: input.items, alsoPriced: input.alsoPriced, ask: input.ask ?? null });
  if (!run.items.length) return { ok: false, error: `The takeoff has nothing for ${run.label.toLowerCase()}.` };
  return runSmartEstimate(organizationId, { projectType: input.ask?.title ?? run.label, description: run.brief, location: input.location ?? undefined }, run, async () => {});
}

/** The validator's view of a blueprint trade: its profile without the remodel phases. */
function planProfile(run: PlanTradeRun): TradeProfile {
  const base = TRADES.find((t) => t.id === run.setup.profileId) ?? GENERAL_TRADE;
  return { ...base, phases: newBuildPhases(base.phases), lineRange: run.setup.lineRange ?? base.lineRange };
}

/**
 * The estimate itself, once the gates have passed — for a brief (generateAdvancedEstimate)
 * or for one trade of a house off its plans (pricePlanTrade, `plan` set).
 */
async function runSmartEstimate(organizationId: string, input: GenerateInput, plan: PlanTradeRun | null, refund: () => Promise<void>): Promise<EstimateRun> {
  const qualityTier = input.qualityTier ?? "standard";
  // "Regenerate with AI" feeds the user's edited assumptions in as constraints.
  const cleanAssumptions = (input.assumptions ?? []).map((a) => a.trim()).filter(Boolean);
  // Photos ride into the estimate call: the estimator needs them to see what
  // is actually on site (a second layer of shingles, a rotted post, the fence
  // that is already there) before it prices anything.
  const photos = safePhotos(input.photos);

  try {
    const client = getOpenAI();

    // ── Step 1 · The estimate — the old quote-draft call, verbatim ─────────
    // Owner, 2026-09-03: "exactly like the old one". lib/estimate/legacy-estimate
    // assembles the previous JobFlex prompt (master prompt in the admin slot,
    // specialty preamble, material profile, price book, tax guidance, template
    // rules, pricing rules, key questions) and parses the reply with the old
    // parser. One call at temperature 0 with seed 42, as it always ran.
    const [org, company] = await Promise.all([
      db.organization.findUnique({ where: { id: organizationId }, select: { name: true, materialMarkupPct: true, laborMarkupPct: true } }),
      plan ? Promise.resolve(null) : readCompanyPricing(organizationId),
    ]);
    // The company's own method (Settings → Estimating, lib/estimate/companyPricing): on, with a rate. A blueprint
    // trade keeps the builder price book — the method is for Smart Proposal and the video estimator.
    const companyOn = companyPricingActive(company) ? company : null;
    // gpt-5-class models (what the previous JobFlex ran) get the verbatim old
    // prompt. gpt-4o-class models answer it with 4-6 lines, so they also get
    // the trade profile + hard rules in the old "extra admin" slot, which
    // brings them to the old output's 12-13 lines (harness, 2026-09-03).
    // The model this process can actually call — the env name when the key's
    // project is entitled to it, the default when it is not (lib/sdk/openai).
    const model = await resolveOpenAIModel();
    const reasoningModel = /^(gpt-5|o[1-9])/.test(model);
    // What the platform admin changed on /admin/prompts — the master prompt,
    // the system message, a specialty's preamble or procedure. Defaults when
    // nothing was saved (or the table is not there yet).
    const overrides = await loadPromptOverrides();
    // A trade off a blueprint prices from its specialty's procedure without the steps a
    // new house never has (a tear-off, a removal, a patch), or — for the general
    // conditions — from the builder's own list (lib/plans/tradeSetup).
    const planProcedure = plan
      ? plan.trade === "general"
        ? GENERAL_CONDITIONS_PROCEDURE
        : (() => {
            const own = effectiveProcedure(plan.setup.specialtyId, overrides);
            return own ? newBuildProcedure(own) : null;
          })()
      : null;
    const promptOverrides =
      plan && planProcedure
        ? { ...overrides, specialties: { ...overrides.specialties, [plan.setup.specialtyId]: { ...overrides.specialties[plan.setup.specialtyId], procedure: planProcedure } } }
        : overrides;
    const legacy = buildLegacyEstimatePrompt(
      {
        description: input.description,
        location: input.location,
        projectType: input.projectType,
        sqft: input.sqft,
        companyName: org?.name ?? null,
        assumptions: cleanAssumptions,
        qualityTier,
      },
      {
        // The trade-rules block re-detects the trade and lists its remodel phases;
        // a blueprint trade has its takeoff block instead.
        withTradeRules: !reasoningModel && !plan,
        overrides: promptOverrides,
        specialtyId: plan?.setup.specialtyId,
        newBuild: plan ? { permit: plan.setup.permit, benchmarkQty: plan.benchmarkQty } : null,
      },
    );
    console.info(
      `[advancedEstimator] Step 1 (estimate) · specialty=${legacy.specialty.id} scope=${legacy.scope} method=${legacy.remodelDomains.join("+") || "none"} utility=${legacy.utilityJob ?? "none"} prices=${legacy.priced ? `${legacy.priced.steps}/${legacy.priced.of}` : "none"} range=${legacy.range ? `${legacy.range.low}-${legacy.range.high}` : "none"} procedure=${legacy.procedure} hvac=${legacy.hvac} tier=${qualityTier} photos=${photos.length} prompt=${legacy.prompt.length}ch`
    );
    // temperature 0 + seed 42, as the old provider sent. This is NOT
    // determinism: the audit of 2026-09-17 ran ten briefs three times each and
    // the same brief came back between 4% and 98% apart — a water-heater swap
    // at $1,021 and at $3,000. That is why the answer is validated below
    // rather than trusted. Reasoning models reject a temperature.
    const askEstimate = async (extra: string, prefix = "") => {
      const completion = await client.chat.completions.create(
        {
          model,
          ...(reasoningModel ? {} : { temperature: 0, seed: 42 }),
          messages: [
            // The platform admin's system message when one is saved on
            // /admin/prompts, the built-in one otherwise.
            { role: "system", content: overrides.system?.trim() || LEGACY_SYSTEM_MESSAGE },
            // A blueprint trade's takeoff rides last of the prompt proper, on every ask.
            { role: "user", content: withPhotos(`${prefix}${legacy.prompt}${plan ? `\n\n${plan.block}` : ""}${extra}`, photos) },
          ],
          response_format: { type: "json_object" },
        },
        // The SDK retries twice on its own, which turned one busy minute into
        // six requests and a minute of a contractor watching a spinner. The
        // retry policy for this call is the one below, and it is visible.
        { maxRetries: 0 },
      );
      return legacyEstimateFromText(completion.choices[0]?.message?.content ?? "{}", legacy.specialty);
    };

    /* THE FIRST ASK, ONCE MORE IF THE SERVICE WAS BUSY (owner, 2026-09-18).
       429 and 5xx are the two answers that mean "not now" rather than "no", and
       a single three-second wait clears most of them. One retry, not a loop: a
       contractor waiting on an estimate would rather be told than watched. A
       live key is never quietly answered with the demo stub — that stub exists
       for a workspace with no key at all, and dressing a failure as an estimate
       would put invented prices in front of a customer. */
    const askEstimateOnce = async (extra: string, prefix = "") => {
      try {
        return await askEstimate(extra, prefix);
      } catch (err) {
        if (!isTransientAIError(err)) throw err;
        const status = (err as { status?: number })?.status;
        console.warn(`[advancedEstimator] Step 1 · ${status} from the model — one retry in ${RETRY_DELAY_MS} ms`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        return askEstimate(extra, prefix);
      }
    };

    // ── Step 1b · Judge the answer, and make it fix what it got wrong ──────
    // Up to two re-asks with the violations listed; whatever is still wrong
    // after that is repaired here and said out loud on the estimate
    // (lib/estimate/validate-estimate).
    const trade = plan ? planProfile(plan) : detectTrade(`${input.projectType ?? ""} ${input.description}`);

    // ── Step 1a · The lines the brief MEASURES, priced without the model ────
    // The audit of 2026-09-17 showed the spread is a quantity problem: asked
    // the same brief three times the model invented a different set of
    // quantities each time, for work the customer had never mentioned. So the
    // phases the description actually measures are costed here — quantity out
    // of the brief, material and labor from the trade anchor at this state's
    // index — handed to the model as settled facts, and merged back over
    // anything it restates anyway.
    //
    // No priceMaterial: the estimate is disconnected from store listings
    // (owner, 2026-10-09), so a computed line's material is always its anchor
    // — which also makes two runs of one brief agree to the cent.
    const computed = await computeLines({
      // A blueprint trade's quantities are the takeoff's, bound after the answer.
      description: plan ? "" : input.description,
      trade,
      state: input.location,
      // No organization stores a labor rate today (schema check, 2026-09-18),
      // so this is always null and labor comes from the anchor. The hook is
      // here so the day one exists, one line changes.
      orgLaborRate: null,
    });
    if (computed.lines.length) {
      console.info(
        `[advancedEstimator] Step 1a · ${computed.lines.length} computed line(s) [${computed.lines.map((l) => `${l.phaseId}:${l.quantity}${l.unit}`).join(", ")}], ${computed.skipped.length} phase(s) left to the model`,
      );
    }
    // With the company's method on, every ask also says to give each line its hours.
    const computedBlock = computedPromptBlock(computed.lines) + (companyOn ? hoursPromptBlock(companyOn) : "");

    /** Every answer, first or re-ask, gets the computed lines merged over it. */
    const withComputed = (r: Awaited<ReturnType<typeof askEstimateOnce>>) => {
      const merged = mergeComputed(r.items, computed.lines);
      if (merged.dropped.length) {
        console.info(`[advancedEstimator] Step 1a · dropped ${merged.dropped.length} model line(s) already computed: ${merged.dropped.map((d) => d.name.slice(0, 40)).join(" | ")}`);
      }
      return { ...r, items: merged.items as typeof r.items };
    };

    // ── Same brief, same estimate (lib/estimate/sameBrief) ──────────────────
    // The fingerprint of exactly this question: the built prompt carries the brief, the place, the price book, the
    // procedures and the tier; the rest is what decides the answer outside it.
    const fingerprint = briefFingerprint({
      v: 1,
      model,
      system: overrides.system?.trim() || LEGACY_SYSTEM_MESSAGE,
      prompt: legacy.prompt,
      plan: plan?.block ?? null,
      computed: computedBlock,
      photos: photos.map(photoPrint),
      company: companyOn ? snapshotOf(companyOn) : null,
      markup: [org?.materialMarkupPct ?? null, org?.laborMarkupPct ?? null],
      tier: qualityTier,
    });
    if (!input.fresh) {
      const before = await sameEstimate(organizationId, fingerprint);
      if (before) {
        // No AI was spent: the trial's use goes back.
        await refund().catch(() => {});
        console.info(`[advancedEstimator] same brief as ${before.at} · the estimate it got then (${fingerprint.slice(0, 10)})`);
        return { ok: true, data: { ...before.estimate, notes: [SAME_NOTE, ...(before.estimate.notes ?? [])], remembered: { at: before.at } } };
      }
    }

    let called = withComputed(await askEstimateOnce(computedBlock));

    /* ONE RE-ASK BUDGET, TWO REASONS TO SPEND IT (merge, 2026-09-19).
       Two passes used to ask the model again for different reasons: this one,
       because the answer is thin or cheap for the job it describes
       (lib/estimate/remodel-sanity — a bathroom that came back as eight lines,
       a whole remodel priced under its range), and the validation pass below,
       because the answer broke a rule. Both are worth asking for, and neither
       is worth two more minutes and two more calls on top of each other, so
       they share MAX_ESTIMATE_REPAIRS between them: whatever this one spends,
       the validation loop no longer has. A brief for part of a room has no
       line quota; a stated price has no range. The fuller answer is kept. */
    let reaskBudget = MAX_ESTIMATE_REPAIRS;
    const reasons = retryReasons({
      lines: called.items.length,
      coreSteps: legacy.procedureCoreSteps,
      total: linesTotal(called.items),
      range: legacy.range,
    });
    if (reasons.length && reaskBudget > 0) {
      console.warn(
        `[advancedEstimator] asking again · ${called.items.length} lines for ${legacy.procedureCoreSteps} core steps · total ${Math.round(linesTotal(called.items))}${legacy.range ? ` vs ${legacy.range.low}-${legacy.range.high} (${legacy.range.job}, ${legacy.range.place})` : ""}`,
      );
      reaskBudget -= 1;
      try {
        // Merged through the same computed-lines path, or the two answers
        // would be compared on different terms.
        const again = withComputed(
          await askEstimateOnce(computedBlock, reasons.join("\n\n") + "\n\n"),
        );
        console.info(`[advancedEstimator] second answer: ${again.items.length} lines, total ${Math.round(linesTotal(again.items))}`);
        called = fullerAnswer(called, again);
      } catch (err) {
        // The answer in hand is still an answer.
        console.warn(`[advancedEstimator] thin-answer re-ask failed, keeping the first: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (called.warnings.length) console.warn(`[advancedEstimator] parser: ${called.warnings.join(" | ")}`);
    if (called.items.length === 0) throw new Error("The estimator returned no line items — try a more specific description.");
    // Whether this job takes a permit, decided from the brief when the prompt
    // was built (lib/estimate/permits): the validator asks for a permit line
    // only when it does.
    const permit = legacy.permit?.need ?? null;
    let report = validateEstimate({ items: called.items, description: input.description, location: input.location, assumptions: called.assumptions, trade, permit });
    for (let attempt = 1; attempt <= reaskBudget && report.blocking.length; attempt++) {
      console.info(`[advancedEstimator] Step 1b · ${report.blocking.length} blocking violation(s), re-asking (${attempt}/${reaskBudget} left of ${MAX_ESTIMATE_REPAIRS}): ${report.blocking.map((x) => x.code).join(", ")}`);
      // A re-ask that fails (rate limit, spent account, a bad reply) must
      // never cost the contractor the estimate already in hand.
      let retry: Awaited<ReturnType<typeof askEstimate>>;
      try {
        retry = await askEstimate(`${computedBlock}${repairInstruction(report)}`);
      } catch (err) {
        console.warn(`[advancedEstimator] Step 1b · re-ask failed, keeping the first answer: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }
      if (!retry.items.length) break;
      retry = withComputed(retry);
      const retryReport = validateEstimate({ items: retry.items, description: input.description, location: input.location, assumptions: retry.assumptions, trade, permit });
      // Keep the better answer: fewer blocking violations wins, ties go to the newer.
      if (retryReport.blocking.length <= report.blocking.length) {
        called = retry;
        report = retryReport;
      }
      if (!report.blocking.length) break;
    }
    const repaired = applyRepairs({ items: called.items, description: input.description, location: input.location, assumptions: called.assumptions, trade, permit }, report);
    const estimateNotes = repaired.notes;
    if (estimateNotes.length) console.info(`[advancedEstimator] Step 1b · ${estimateNotes.join(" ")}`);
    called = { ...called, items: repaired.items, assumptions: repaired.assumptions };
    // A job that needs no permit (or whose city decides) carries no permit
    // line even when the model wrote one anyway, and says why (owner,
    // 2026-10-09: a door swap came back with "Permit and inspection").
    const held = holdPermitDecision({ items: called.items, assumptions: called.assumptions, scope: called.scope }, legacy.permit, input.location);
    console.info(`[advancedEstimator] permit · ${legacy.permit ? `${legacy.permit.need} (${legacy.permit.reason})` : "the trade's procedure decides"}${held.dropped.length ? ` · dropped ${held.dropped.join(" | ")}` : ""}`);
    called = { ...called, items: held.items, assumptions: held.assumptions, scope: held.scope };
    // Said under the ledger, where the contractor reads the checks.
    const permitLine = permitSummary(legacy.permit, input.location);
    if (permitLine) estimateNotes.push(permitLine);
    // The last word on the prices, after every re-ask and repair: a total
    // still far under the job's range is not an estimate. Every line but the
    // pass-through fees rises by one share to the range's point for the tier
    // (lib/estimate/remodel-sanity).
    // Not on a blueprint trade: its benchmark is shown to the model, but a house's
    // trade is held to the builder price book on the estimate's notes instead
    // (lib/plans/priceChecks) — raising it silently would hide the question.
    const floored = plan ? null : floorToRange(called.items, legacy.range, qualityTier);
    if (floored && legacy.range) {
      console.warn(
        `[advancedEstimator] raised to the range · total ${Math.round(floored.from)} → ${Math.round(floored.to)} (${legacy.range.job}, ${legacy.range.place}, ${qualityTier})`,
      );
      called = { ...called, items: floored.items, assumptions: [...called.assumptions, floorNote(legacy.range, floored.from, floored.to)] };
    }
    // Guard the ledger's arithmetic: no negative or NaN quantities, no line
    // with nothing on it. A zero-priced line is kept (the contractor fills it)
    // but logged, so a silent regression in the prompt is visible.
    const parsedItems = called.items.map((it) => ({
      ...it,
      dimensions: null as string | null,
      quantity: Number.isFinite(it.quantity) && it.quantity > 0 ? it.quantity : 1,
      unit: measureUnit(it.unit, it.materialUnitPrice > 0 ? "materials" : "labor"),
    }));
    // ── The contractor's numbers win (lib/estimate/brief) ──────────────────
    // Work the brief never asked for comes off (a coatings reply's moisture
    // testing), the stated quantity goes back on every line in that unit (a
    // 450 that was 400 plus waste), and the stated customer price is what the
    // lines add up to — after the org's markup, which the proposal applies.
    const scrub = scrubUnaskedWork(parsedItems, input.description, legacy.specialty.id);
    if (scrub.dropped.length) console.info(`[advancedEstimator] dropped work the brief did not ask for: ${scrub.dropped.join(" | ")}`);
    const bound = plan
      ? { ...bindLinesToTakeoff(scrub.lines, plan.items), snapped: [] as ReturnType<typeof bindLinesToBrief>["snapped"], fitted: false, sellTotal: undefined }
      : bindLinesToBrief(scrub.lines, legacy.facts, resolveMarkupRates(null, org));
    if (bound.snapped.length || bound.fitted) console.info(`[advancedEstimator] held to the brief · snapped ${bound.snapped.map((x) => `${x.from}→${x.to} ${x.unit}`).join(", ") || "none"} · fitted ${bound.fitted ? `$${bound.sellTotal}` : "no"}`);
    const items = bound.lines;
    const heldTitle = bindTextToBrief(scrubUnaskedText(called.title, input.description, legacy.specialty.id), bound.snapped);
    const heldScope = bindTextToBrief(scrubUnaskedText(called.scope, input.description, legacy.specialty.id), bound.snapped);
    const zeroed = items.filter((it) => it.materialUnitPrice <= 0 && it.laborUnitPrice <= 0);
    if (zeroed.length) {
      console.warn(`[advancedEstimator] ${zeroed.length} line(s) came back unpriced: ${zeroed.map((z) => z.name).join(" | ")}`);
    }
    console.info(`[advancedEstimator] Step 1 produced ${items.length} lines`);

    // ── Step 2 · The wire format ────────────────────────────────────────────
    // SPLIT each fused item into a material row (every item, so pairing and
    // order survive) and a labor row when the item carries labor, under ONE id
    // so the client pairs them exactly (console-model pairEstimateLines).
    const materials: GeneratedEstimate["materials"] = [];
    const labor: GeneratedEstimate["labor"] = [];
    if (companyOn) {
      // THE COMPANY'S WAY (2026-10-16): materials at cost × its markup, labor its own rows in hours × its rate,
      // overhead and profit inside the prices — the screens and the proposal show what the company would charge.
      const priced = applyCompanyPricing(items, companyOn, (i) => `i${i + 1}-${randomUUID().slice(0, 8)}`);
      materials.push(...priced.materials);
      labor.push(...priced.labor);
      estimateNotes.unshift(`Priced your company's way (Settings → Estimating): ${snapshotOf(companyOn).words}.`);
      if (priced.derivedHours) {
        estimateNotes.push(`${priced.derivedHours} labor line${priced.derivedHours === 1 ? "" : "s"} came without hours from the estimator — the hours were worked out from the price book's labor cost. Check ${priced.derivedHours === 1 ? "it" : "them"}.`);
      }
      // A price named in the brief was fitted at the price book's rates; the company's own rates decide here, so the
      // contractor sees both figures rather than a stated price quietly missed.
      if (bound.fitted && bound.sellTotal) {
        const own = [...materials, ...labor].reduce((a, r) => a + r.quantity * r.unitPrice, 0);
        if (Math.abs(own - bound.sellTotal) >= 1) {
          estimateNotes.push(`Your brief named $${Math.round(bound.sellTotal).toLocaleString("en-US")}; priced your company's way the lines come to $${Math.round(own).toLocaleString("en-US")} before tax.`);
        }
      }
      console.info(`[advancedEstimator] company pricing · ${materials.length} material row(s), ${labor.length} labor row(s) in hours, ${priced.derivedHours} hours worked out`);
    } else items.forEach((it, i) => {
      const id = `i${i + 1}-${randomUUID().slice(0, 8)}`;
      materials.push({
        id,
        name: it.name.trim(),
        quantity: it.quantity,
        unit: it.unit,
        unitPrice: it.materialUnitPrice,
        // What the validation pass did to this line, for the row to show and
        // for the totals to honour (a suggestion is not billed).
        flag: it.flag,
        flagNote: it.flagNote,
        dimensions: it.dimensions?.trim() || undefined,
        notes: it.notes?.trim() || undefined,
      });
      if (it.laborUnitPrice > 0) {
        labor.push({ id, name: it.name.trim(), quantity: it.quantity, unit: it.unit, unitPrice: it.laborUnitPrice, flag: it.flag, flagNote: it.flagNote });
      }
    });
    const estimate: GeneratedEstimate = {
      title: heldTitle.trim(),
      scope: heldScope,
      assumptions: [...bound.notes, ...called.assumptions],
      estimatedTimelineDays: called.estimatedTimelineDays,
      materials,
      labor,
      notes: estimateNotes.length ? estimateNotes : undefined,
      ...(companyOn ? { pricing: snapshotOf(companyOn) } : {}),
    };
    console.info(`[advancedEstimator] Step 2 complete · ${materials.length} lines, ${labor.length} carry labor`);
    // This brief's answer from now on (a fresh estimate replaces the one before).
    await keepEstimate(organizationId, fingerprint, estimate);

    return { ok: true, data: estimate };
  } catch (err: any) {
    // A message this code wrote itself (no line items, a length cap) is for the
    // contractor; anything the provider raised is for the log only.
    if (typeof err?.status !== "number" && err?.message) {
      console.error(`[advancedEstimator] generation failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
    await refund();
    return { ok: false, error: friendlyAIError(err, "estimate generation") };
  }
}

// ── Incremental refine ──────────────────────────────────────────────────────
// The "Apply changes" path. Unlike generateAdvancedEstimate, this does NOT
// re-plan — it makes a single surgical pass that edits the EXISTING estimate
// per the contractor's request, preserving every untouched line and price.
// Same costing rules, applied only where asked; nothing is shopped.
const refineInputSchema = z.object({
  projectType: z.string(),
  location: z.string().optional(),
  // NOTE: no intake UI sets a tier yet, so refine effectively always runs at
  // "standard". If a tier picker ships, the client MUST start sending this or
  // every refine will silently re-price at standard.
  qualityTier: z.enum(["budget", "standard", "luxury"]).optional(),
  instructions: z
    .string()
    .max(4000, "Change request is too long — keep it under 4,000 characters.")
    .default(""),
  // The last few APPLIED change requests (oldest first). The refine itself is
  // stateless — this is its short-term memory, so "now make it cheaper" knows
  // what "it" was.
  history: z.array(z.string().max(4000)).max(10).default([]),
  assumptions: z.array(z.string()).default([]),
  current: estimateSchema,
});

export async function refineAdvancedEstimate(raw: unknown): Promise<
  | {
      ok: true;
      data: GeneratedEstimate;
      /** Human-readable caveats for the review UI. */
      warnings: string[];
      /** Always false since the estimate stopped shopping (2026-10-09); kept on
       *  the wire so the review screens need no change. */
      reshopFailed: boolean;
      disabled?: boolean;
    }
  | { ok: false; error: string; code?: "PLAN_LIMIT_REACHED"; resource?: LimitKey }
> {
  let input: z.infer<typeof refineInputSchema>;
  try {
    input = refineInputSchema.parse(raw);
  } catch (err) {
    // Surface the friendly custom message (e.g. the instructions length cap);
    // fall back to the generic line for structural mismatches.
    const first = err instanceof z.ZodError ? err.issues[0]?.message : null;
    return { ok: false, error: first?.includes("—") ? first : "Invalid estimate payload" };
  }

  let organizationId: string;
  try {
    ({ organizationId } = await requireEstimatorOrManager());
    await requirePage(organizationId, ["smart-proposal", "video-estimator"]);
    await enforceRateLimit(`ai:${organizationId}`, 60, HOUR, "AI runs");
    const { requireFeatureOrThrow } = await import("@/lib/entitlements");
    const { getOrgPlanById } = await import("@/lib/orgPlan");
    const plan = await getOrgPlanById(organizationId);
    requireFeatureOrThrow(plan, "advanced_estimator");
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Upgrade required" };
  }
  const blocked = await estimatorRunBlocked(organizationId);
  if (blocked) return blocked;

  const cleanAssumptions = input.assumptions.map((a) => a.trim()).filter(Boolean);
  const instructions = input.instructions.trim();

  // No AI configured — echo the current estimate back (folding in any edited
  // assumptions) so the UI stays consistent in demo mode.
  if (!isOpenAIEnabled()) {
    return {
      ok: true,
      data: {
        ...input.current,
        assumptions: cleanAssumptions.length ? cleanAssumptions : input.current.assumptions,
      },
      warnings: [],
      reshopFailed: false,
      disabled: true,
    };
  }
  const trial = await takeTrialCap(organizationId, "aiCalls");
  if (!trial.ok) return trial.failure;

  const qualityTier = input.qualityTier ?? "standard";
  try {
    const client = getOpenAI();
    console.info(
      `[advancedEstimator] refine · "${instructions.slice(0, 80)}" · ${input.current.materials.length} materials`
    );
    const completion = await client.chat.completions.create({
      model: await resolveOpenAIModel(),
      ...(await samplingOptions(0.3)),
      messages: [
        {
          role: "system",
          content:
            'You are a senior contractor AI estimator EDITING an existing estimate. You receive the current estimate as JSON plus a plain-English change request from the contractor. Apply ONLY the requested changes and return the COMPLETE updated estimate as JSON matching: {title, scope, assumptions: string[], materials: [{id, name, quantity, unitPrice, unit, dimensions, notes}], labor: [{id, name, quantity, unitPrice, unit, notes}], estimatedTimelineDays: number, discount: {label, amount, isPercent} | null}. ' +
            "Rules: (1) Preserve every line, price, and dimensions that the request does NOT touch — copy them through unchanged; do not re-price untouched items. " +
            `(2) Keep the same costing formula as the original: quality tier "${qualityTier}", waste factors (10% tile/drywall/paint, 15% lumber/trim, 0% fixtures), quantities MEASURED in the line's unit (never package counts) and unitPrice = the estimator's price per ONE of that unit from the pricing guidelines, never a listing's package price. ${UNIT_RULES} ${PRICING_RULES} EXCEPT if the instructions or assumptions explicitly ask for a different quality/grade for specific items, adjust those items. ` +
            "(3) Keep `dimensions` set to each product's real size/pack spec. " +
            "(4) If you add a new material, OR if you upgrade/change a material's specification based on the instructions or assumptions, price it per ONE of its unit from the pricing guidelines at the new grade. " +
            "(5) Treat the contractor's assumptions as ground truth. If an assumption conflicts with the current estimate (e.g. requires a different material, quantity, or scope), you MUST update the estimate to match. " +
            "(6) Every existing line carries an `id`. Keep the SAME `id` on every line you keep or edit — including renamed or re-specced lines. A task's material row and its labor row share one id and one name (material and labor are two prices of ONE line item); keep them paired, and when you add a task that has both, give its material row and its labor row the same new id and name. Omit `id` only on brand-new lines. " +
            "(7) Renaming or rewording a line is NOT a spec change: keep its id, price, and quantity unchanged unless the request explicitly changes the product itself. " +
            "(8) If the request asks for a discount ('10% off', 'knock $500 off'), do NOT alter any line prices — set `discount` to {label, amount, isPercent} (isPercent=true means amount is a 0-100 percentage). If asked to remove the discount, set it to null. Otherwise copy the existing discount through unchanged. " +
            "(9) Update `scope` and `estimatedTimelineDays` when the changes affect them; otherwise copy them through unchanged. Return JSON only." +
            // Priced the company's way (lib/estimate/companyPricing): labor is its own rows, in hours, at the company's rate.
            (input.current.pricing
              ? ` (10) THIS ESTIMATE IS PRICED THE COMPANY'S WAY (${input.current.pricing.words}). Labor is NOT paired with materials here: every labor row is its own line, unit "hour", quantity = ${input.current.pricing.laborBasis === "crew" ? "crew-hours" : "person-hours"}, id ending in "-L", named "Labor · <the work> (${input.current.pricing.laborBasis === "crew" ? "crew-hours" : "person-hours"})", and every one keeps the SAME unitPrice it has now. A new task gets a material row and its own labor row of that shape; a change in work changes the HOURS, never the rate. Material prices already include the company's markup — keep them as they are unless a material itself changes. Never add an overhead, profit or tax line.`
              : ""),
        },
        {
          role: "user",
          content: `${projectLine(input.projectType)}
${input.location ? `Location: ${input.location}` : ""}
Quality tier: ${qualityTier}

${
  input.history.length
    ? `Changes already applied in earlier passes (oldest first — context, do not re-apply):
${input.history.map((h) => `- ${h}`).join("\n")}

`
    : ""
}Change request from the contractor:
${instructions || "(no free-text request — apply the updated assumptions below)"}

${
  cleanAssumptions.length
    ? `Assumptions to honor:\n${cleanAssumptions.map((a) => `- ${a}`).join("\n")}\n\n`
    : ""
}Current estimate (JSON) — edit this and return the full updated version:
${JSON.stringify(input.current)}`,
        },
      ],
      response_format: { type: "json_object" },
    });
    const text = completion.choices[0]?.message?.content ?? "{}";
    const parsed = estimateSchema.parse(JSON.parse(text));
    // How it was priced is the estimate's, not the model's to drop.
    if (input.current.pricing) parsed.pricing = input.current.pricing;

    // The estimate carries no shop list any more (owner, 2026-10-09), so no
    // store, link, picture or listing price survives an edit — not even one an
    // estimate made before the change still holds.
    for (const mat of parsed.materials) {
      mat.store = undefined;
      mat.productUrl = undefined;
      mat.imageUrl = undefined;
      mat.retailPrice = undefined;
    }

    // A price in the change request ("make it $4,000 total", "$10 per sq ft
    // on the 400") is held the way the brief's is.
    const asked = readBrief(instructions);
    if (asked.targetSell) {
      const org = await db.organization.findUnique({ where: { id: organizationId }, select: { materialMarkupPct: true, laborMarkupPct: true } });
      const held = bindEstimateToBrief(parsed, { ...asked, area: undefined, length: undefined, measures: [] }, resolveMarkupRates(null, org));
      parsed.assumptions = [...held.notes, ...parsed.assumptions.filter((a) => !/^Priced to /.test(a))];
      console.info(`[advancedEstimator] refine · held to $${held.sellTotal}`);
    }

    console.info(
      `[advancedEstimator] refine complete · ${parsed.materials.length} materials, ${parsed.labor.length} labor`
    );
    return { ok: true, data: parsed, warnings: [], reshopFailed: false };
  } catch (err: any) {
    // Never leak Zod/OpenAI internals into the toast: the parse failures have
    // their own line, everything the provider raised goes through the one
    // helper that writes the log line and returns a sentence (lib/sdk/openai).
    if (err instanceof z.ZodError || err instanceof SyntaxError) {
      console.error(`[advancedEstimator] refine failed: ${err?.message ?? err}`);
      return {
        ok: false,
        error: "The AI returned an edit we couldn't apply. Try rephrasing, or make one change at a time.",
      };
    }
    if (typeof err?.status === "number") await trial.refund();
    return { ok: false, error: friendlyAIError(err, "estimate refine") };
  }
}

// Persist estimate
export async function saveEstimate(raw: {
  projectType: string;
  location?: string | null;
  data: GeneratedEstimate;
}) {
  const { organizationId, user } = await requireEstimatorOrManager();
  await requirePage(organizationId, ["smart-proposal", "video-estimator"]);
  await enforcePlanLimit(organizationId, "estimatorUses");
  const total =
    raw.data.materials.reduce((a, l) => a + l.quantity * l.unitPrice, 0) +
    raw.data.labor.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  const est = await db.aiEstimate.create({
    data: {
      organizationId,
      projectType: raw.projectType,
      location: raw.location ?? null,
      materials: JSON.stringify(raw.data.materials),
      labor: JSON.stringify(raw.data.labor),
      categories: JSON.stringify({
        title: raw.data.title,
        assumptions: raw.data.assumptions,
        estimatedTimelineDays: raw.data.estimatedTimelineDays,
        discount: raw.data.discount ?? null,
      }),
      assumptions: raw.data.assumptions.join("\n"),
      total,
    },
  });
  trackActivation("estimator_used", organizationId, { estimator: "smart" });
  revalidatePath("/dashboard/advanced-ai");
  await logActivity({
    organizationId,
    actorId: user.id,
    kind: TRAIL_KINDS.ESTIMATE,
    summary: `Saved a ${raw.projectType} estimate${raw.location ? ` at ${raw.location}` : ""} — ${raw.data.title}, $${Math.round(total).toLocaleString("en-US")}`,
    meta: { estimateId: est.id, trade: raw.projectType, amount: Math.round(total * 100) / 100, location: raw.location ?? undefined },
  });
  return { id: est.id };
}

// Convert estimate → new Proposal
const convertInput = z.object({
  projectType: z.string(),
  /** Which tool is converting (2026-10-17, lib/proposalKind): the proposals list names it. Smart Proposal when absent. */
  source: z.enum(["smart", "video", "blueprint"]).optional(),
  title: z.string(),
  scope: z.string().optional(),
  materials: z.array(lineSchema).default([]),
  labor: z.array(lineSchema).default([]),
  assumptions: z.array(z.string()).default([]),
  // Pre-links the proposal to a client when converted from a client's page.
  clientId: z.string().optional().nullable(),
  inventoryLinked: z.boolean().optional().nullable(),
  // The estimate's job location ("City, ST") — becomes the proposal's job
  // address and, when its state resolves, seeds the tax rate for that market.
  location: z.string().optional().nullable(),
  // Order-level discount from the estimator ("10% off") — materializes as a
  // Discount row + discountTotal on the proposal.
  discount: discountSchema.nullish(),
  // Priced the company's way (lib/estimate/companyPricing): the prices are final — no markup is added — and the
  // tax follows the company's rule at the rate the screen showed (`taxPct`, %).
  pricing: pricingSnapshotSchema.optional(),
  taxPct: z.number().min(0).max(30).optional(),
});

/**
 * An estimate line's unit → the `LineItem.measurementType` column.
 *
 * The estimator is instructed to answer from the manual builder's own ten-value
 * picker, and this collapses those ten onto the six the schema has — the same
 * lossy map the builder itself applies (see manual-blueprint-bridge.ts). It
 * still tolerates the older free-text units ("ln ft", "each", "box") that live
 * on estimates generated before the vocabulary was pinned, so reopening one of
 * those does not land every line on UNIT by accident.
 */
const MEASUREMENT_FOR_UNIT: Record<string, string> = {
  sqft: "SQFT",
  "sq ft": "SQFT",
  "sq yards": "SQ_YARD",
  sqyards: "SQ_YARD",
  lf: "LINEAR_FT",
  "linear ft": "LINEAR_FT",
  "ln ft": "LINEAR_FT",
  yards: "LINEAR_FT",
  // Exact since 2026-10-21 (they had become cubic FEET, square feet and "unit").
  "cu yards": "CU_YARD",
  "sq boards": "SQUARE",
  unit: "UNIT",
  // The real measures a line is counted or bought in.
  each: "EACH",
  sheets: "SHEET",
  bundles: "BUNDLE",
  rolls: "ROLL",
  boxes: "BOX",
  bags: "BAG",
  pieces: "PIECE",
  gallons: "GALLON",
  buckets: "BUCKET",
  tubes: "TUBE",
  sets: "SET",
  tons: "TON",
  hour: "HOUR",
  hr: "HOUR",
  hours: "HOUR",
  fixed: "LUMP_SUM",
  "lump sum": "LUMP_SUM",
};

const MEASURED_IN: Record<string, string> = {
  hour: "Measured in hours", hr: "Measured in hours", hrs: "Measured in hours", hours: "Measured in hours",
  sqft: "Measured in square feet", "sq ft": "Measured in square feet",
  lf: "Measured in linear feet", "linear ft": "Measured in linear feet", "ln ft": "Measured in linear feet", yards: "Measured in linear yards",
  "cu yards": "Measured in cubic yards", "sq yards": "Measured in square yards", "sq boards": "Measured in roofing squares",
  sheets: "Bought in sheets", bundles: "Bought in bundles", rolls: "Bought in rolls", boxes: "Bought in boxes", bags: "Bought in bags",
  pieces: "Bought in pieces", gallons: "Bought in gallons", buckets: "Bought in buckets", tubes: "Bought in tubes", sets: "Bought in sets", tons: "Bought in tons",
};
/** A line's measure in words for the line's description — null for a lump sum or a plain count. */
function measureCaption(unit: string | null | undefined): string | null {
  return MEASURED_IN[(unit ?? "").trim().toLowerCase()] ?? null;
}

function measurementForUnit(unit: string | null | undefined): string {
  return MEASUREMENT_FOR_UNIT[(unit ?? "").trim().toLowerCase()] ?? "UNIT";
}

export async function convertEstimateToProposal(raw: unknown) {
  const { organizationId, user, role } = await requireEstimatorOrManager();
  await requirePage(organizationId, ["smart-proposal", "video-estimator"]);
  await enforcePlanLimit(organizationId, "proposalsCreated");
  const data = convertInput.parse(raw);

  // Never trust a client id from the browser — it must belong to this org.
  const named = data.clientId
    ? (
        await db.client.findFirst({
          where: { id: data.clientId, organizationId },
          select: { id: true },
        })
      )?.id ?? null
    : null;
  // Started from a project or a client's page, the picker recorded where this
  // estimate files (lib/filingContext); an explicit client still wins. Started
  // from a lead, the filing carries the lead: its client, and its scope as the
  // proposal's overview beside the scope this estimate wrote.
  const filing = await readFilingContext(organizationId);
  const clientId = named ?? (await filedClientId(organizationId, role, filing));
  const projectId = filing?.projectId ?? null;

  // Hidden profit markup: seed this proposal from the org-wide default, then
  // apply it so each line's unitPrice is the SELL price (0% → equals cost).
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { materialMarkupPct: true, laborMarkupPct: true, defaultTaxRate: true },
  });
  // An estimate priced the company's way already carries its markup, overhead and profit in every price.
  const company = data.pricing ?? null;
  const markupRates = company ? { materialMarkupPct: 0, laborMarkupPct: 0 } : resolveMarkupRates(null, org);

  // ONE LINE ITEM PER TASK. A material row and the labor row that shares its
  // id (or name + unit) become one proposal line with both costs — the shape
  // the proposal table has always had (Description | Qty | Unit | Material |
  // Labor | Total). Unpaired rows become one-sided lines.
  const lines = pairEstimateLines(data).map(({ material: m, labor: l }) => {
    const src = (m ?? l)!;
    const materialCost = m ? m.unitPrice : 0;
    const laborCost = l ? l.unitPrice : 0;
    // Fold the product size into the line name so the proposal reads e.g.
    // "Asphalt shingles (4x8 sheet)" — the buyer sees how big each unit is,
    // not just the material name. Skip if the name already states the size.
    const size = m?.dimensions?.trim() || "";
    const name =
      size && !src.name.toLowerCase().includes(size.toLowerCase())
        ? `${src.name} (${size})`
        : src.name;
    const sell = sellUnitPrice(
      { unitPrice: materialCost + laborCost, materialCost, laborCost },
      markupRates,
    );
    const quantity = m?.quantity ?? l?.quantity ?? 0;
    return {
      name,
      // The measure in words under the line (2026-10-21): "Measured in square feet", "Bought in bundles" — none for a
      // lump sum or a plain count, which say it themselves ("Measured in fixed" read as nonsense to a client).
      description: measureCaption(src.unit),
      measurementType: measurementForUnit(src.unit),
      quantity,
      unitPrice: sell,
      materialCost,
      laborCost,
      total: quantity * sell,
      // No store, link or picture: a Smart estimate is not a shop list
      // (owner, 2026-10-09) — even one made before the change that still
      // carries them. Empty strings normalize to null.
      store: null,
      productUrl: null,
      imageUrl: null,
      dimensions: m?.dimensions?.trim() || null,
    };
  });

  // The company's tax rule: on materials only, the tax is a line of its own ("Sales tax on materials (8.25%)") —
  // the proposal's own tax is on the whole job; on the whole job, the proposal's tax at the company's rate; none.
  const address = data.location?.trim() || null;
  const stateRate = stateTaxRate(stateFromAddress(address));
  const companyTaxPct = company ? (company.taxMode === "none" ? 0 : (data.taxPct ?? company.taxRatePct ?? (stateRate ?? org?.defaultTaxRate ?? 0) * 100)) : 0;
  if (company && company.taxMode === "materials" && companyTaxPct > 0) {
    const materialsTotal = lines.filter((l) => l.materialCost > 0 && l.laborCost === 0).reduce((a, l) => a + l.total, 0);
    const before = lines.reduce((a, l) => a + l.total, 0);
    const tax = materialsTaxLine({ materialsTotal, subtotal: before, discount: data.discount, ratePct: companyTaxPct });
    if (tax > 0) {
      lines.push({
        name: `Sales tax on materials (${Math.round(companyTaxPct * 100) / 100}%)`,
        description: null,
        measurementType: "FIXED",
        quantity: 1,
        unitPrice: tax,
        materialCost: 0,
        laborCost: 0,
        total: tax,
        store: null,
        productUrl: null,
        imageUrl: null,
        dimensions: null,
      });
    }
  }
  const subtotal = lines.reduce((a, l) => a + l.total, 0);
  // Order-level discount (estimator "10% off" etc). Percent clamps to 100,
  // dollars clamp to the subtotal, and tax applies to the DISCOUNTED base.
  const discountTotal = data.discount
    ? Math.min(
        subtotal,
        data.discount.isPercent
          ? (subtotal * Math.min(data.discount.amount, 100)) / 100
          : data.discount.amount,
      )
    : 0;
  // Tax sits on top of the marked-up subtotal (sell price), applied once.
  // The estimate's location wins when its state resolves (the contractor gave
  // a market, so tax that market); the org default is the fallback. taxRate is
  // a FRACTION (0.08 = 8%), not a percent.
  const taxRate = company ? (company.taxMode === "job" ? companyTaxPct / 100 : 0) : stateRate ?? org?.defaultTaxRate ?? 0;
  const taxTotal = (subtotal - discountTotal) * taxRate;

  // Scope only — assumptions stay on the estimate (AiEstimate), never baked into
  // the proposal's scope, so the preview / calendar / job detail stay clean.
  const text = leadProposalText(filing?.lead ?? null, (data.scope ?? "").trim());

  const proposal = await db.proposal.create({
    data: {
      publicId: randomUUID(),
      organizationId,
      ownerId: user.id,
      clientId,
      projectId,
      title: data.title,
      scopeOfWork: text.scopeOfWork || null,
      description: text.overview,
      address,
      status: ProposalStatus.DRAFT,
      // A Smart Proposal for a fence, a roof or HVAC belongs to that trade's
      // board and its stock (2026-09-20); anything else has no trade.
      trade: isTradeId(data.projectType) ? data.projectType : null,
      subtotal,
      discountTotal,
      taxRate,
      taxTotal,
      total: subtotal - discountTotal + taxTotal,
      materialMarkupPct: markupRates.materialMarkupPct,
      laborMarkupPct: markupRates.laborMarkupPct,
      validUntil: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
      lineItems: {
        create: lines.map((l, i) => ({ ...l, position: i })),
      },
      discounts: data.discount
        ? {
            create: [
              {
                label: data.discount.label,
                amount: data.discount.amount,
                isPercent: data.discount.isPercent,
              },
            ],
          }
        : undefined,
      installments: {
        create: [
          { label: "Deposit", amount: 30, isPercent: true, position: 0 },
          { label: "Completion", amount: 70, isPercent: true, position: 1 },
        ],
      },
    },
  });
  // A member client (2026-09-22): the plan's discount rides on the new proposal (lib/servicePlanBook).
  await applyMemberDiscount(proposal.id).catch(() => {});
  // The connect-or-not choice, when one was made (lib/inventoryPick; null = the company's default).
  await recordInventoryLink(organizationId, proposal.id, data.inventoryLinked, user.id);

  await db.activityEvent.create({
    data: {
      organizationId,
      actorId: user.id,
      proposalId: proposal.id,
      kind: "CREATED",
      summary: `Converted "${data.projectType}" AI estimate to proposal "${proposal.title}"`,
      // The tool that made it — Smart Proposal, the video or the blueprint estimator (lib/proposalKind reads it).
      meta: JSON.stringify({ source: data.source ?? "smart", projectType: data.projectType }),
    },
  });
  trackProposalCreated(organizationId, "smart");

  if (filing) await clearFilingContext();
  if (projectId) revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/dashboard/proposals");
  return { id: proposal.id };
}
