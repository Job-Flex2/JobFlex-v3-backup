"use server";
// BLUEPRINTS — the server half of Smart Proposal's plan reader (lib/plans).
//
//   startPlanSession  the gates of an estimate run, the trial cap taken ONCE for the
//                     whole plan set, and a signed pass the sheet reads and the trade
//                     estimates carry after it (lib/plans/planToken)
//   readPlanSheet     one sheet — its picture, close-up tiles of a scan, and its text
//                     layer — read by the vision model into a SheetRead
//   getPlanPriceChecks the builder price book's ranges for the house and its trades
//                     (no model call), for the notes under the ledger
//
// Pricing a trade is the Smart estimate's own pipeline: advancedEstimator.pricePlanTrade.
import { enforceRateLimit, HOUR } from "@/lib/rateLimit";
import { requireEstimatorOrManager } from "@/lib/orgContext";
import { requirePage } from "@/lib/customPageAccess";
import { checkPlanLimit } from "@/lib/limitsEngine";
import { PLAN_LIMIT_MESSAGE, type LimitKey } from "@/lib/planLimits";
import { takeTrialCap } from "@/lib/trialMeter";
import { friendlyAIError, getOpenAI, getVisionModel, isOpenAIEnabled, isTransientAIError, samplingOptions } from "@/lib/sdk/openai";
import { issuePlanPass, readPlanPass } from "@/lib/plans/planToken";
import { PLAN_READ_SYSTEM, planReadPrompt } from "@/lib/plans/readPrompt";
import { cleanSheetRead, type SheetRead } from "@/lib/plans/sheet";
import { planPriceChecks, type PriceChecks } from "@/lib/plans/priceChecks";
import { MAX_SHEET_IMAGE_CHARS, priceChecksInput, sheetReadInput } from "@/lib/plans/wire";

type Fail = { ok: false; error: string; code?: "PLAN_LIMIT_REACHED"; resource?: LimitKey };

const EXPIRED = "This blueprint session has expired — open the plans again.";

/**
 * Open a plan set: the same gates as an estimate run, and the one trial cap use the
 * whole set costs. Nothing is read yet — the browser has the pages.
 */
export async function startPlanSession(): Promise<{ ok: true; token: string } | Fail> {
  let organizationId: string;
  try {
    ({ organizationId } = await requireEstimatorOrManager());
    await requirePage(organizationId, ["smart-proposal"]);
    await enforceRateLimit(`ai-plans:${organizationId}`, 12, HOUR, "blueprint runs");
    const { requireFeatureOrThrow } = await import("@/lib/entitlements");
    const { getOrgPlanById } = await import("@/lib/orgPlan");
    requireFeatureOrThrow(await getOrgPlanById(organizationId), "advanced_estimator");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Upgrade required" };
  }
  // The same monthly budget an estimate run is held to (saved estimates).
  const quota = await checkPlanLimit(organizationId, "estimatorUses");
  if (!quota.allowed) return { ok: false, error: PLAN_LIMIT_MESSAGE, code: "PLAN_LIMIT_REACHED", resource: quota.cappedBy ?? "estimatorUses" };
  if (!isOpenAIEnabled()) return { ok: false, error: "Reading blueprints needs the estimator's AI service, which is not set up on this workspace." };
  const trial = await takeTrialCap(organizationId, "aiCalls");
  if (!trial.ok) return trial.failure;
  try {
    return { ok: true, token: issuePlanPass(organizationId).token };
  } catch (err) {
    await trial.refund();
    return { ok: false, error: err instanceof Error ? err.message : "Could not open the plans." };
  }
}

/** The model's reply as an object: plain JSON, or the first {...} in a chatty one. */
function replyObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(text.slice(a, b + 1));
      } catch {
        return {};
      }
    }
    return {};
  }
}

/**
 * Read one sheet. The picture goes at high detail — a plan's dimension strings are
 * eighth-inch text — with the sheet's own text layer, which a CAD export carries and
 * the model is told to trust over the pixels. The answer is cleaned into a SheetRead
 * (lib/plans/sheet), which never throws: a sheet the model misread is an empty one.
 */
export async function readPlanSheet(raw: unknown): Promise<{ ok: true; sheet: SheetRead } | Fail> {
  const parsed = sheetReadInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "This sheet could not be sent — read it again." };
  const input = parsed.data;
  let organizationId: string;
  try {
    ({ organizationId } = await requireEstimatorOrManager());
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sign in again." };
  }
  const pass = readPlanPass(input.token, organizationId);
  if (!pass) return { ok: false, error: EXPIRED };
  if (input.images.reduce((n, i) => n + i.url.length, 0) > MAX_SHEET_IMAGE_CHARS) return { ok: false, error: "This sheet's pictures are too large to send." };
  try {
    // A 60-sheet set read once, with room to re-read the few that fail.
    await enforceRateLimit(`plan-read:${pass.nonce}`, 75, 6 * HOUR, "sheet reads");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Too many sheet reads." };
  }

  const client = getOpenAI();
  const model = getVisionModel();
  const content = [
    { type: "text" as const, text: planReadPrompt({ page: input.page, pages: input.pages, textLayer: input.textLayer, tiles: input.images.length - 1, grid: input.grid ?? null, fileName: input.fileName }) },
    ...input.images.map((i) => ({ type: "image_url" as const, image_url: { url: i.url, detail: "high" as const } })),
  ];
  const ask = () =>
    client.chat.completions.create(
      {
        model,
        ...samplingOptions(0),
        messages: [
          { role: "system", content: PLAN_READ_SYSTEM },
          { role: "user", content },
        ],
        response_format: { type: "json_object" },
      },
      { maxRetries: 0 },
    );
  try {
    let completion: Awaited<ReturnType<typeof ask>>;
    try {
      completion = await ask();
    } catch (err) {
      // 429 and 5xx mean "not now": one wait, one more try.
      if (!isTransientAIError(err)) throw err;
      await new Promise((r) => setTimeout(r, 3_000));
      completion = await ask();
    }
    const sheet = cleanSheetRead(input.page, replyObject(completion.choices[0]?.message?.content ?? "{}"));
    console.info(
      `[planEstimator] sheet ${input.page}/${input.pages} · ${sheet.kind} "${sheet.title ?? ""}" · rooms ${sheet.rooms.length} · windows ${sheet.windows.length} · doors ${sheet.doors.length} · ${sheet.confidence} · model=${model} text=${input.textLayer.length}ch images=${input.images.length}`,
    );
    return { ok: true, sheet };
  } catch (err) {
    console.warn(`[planEstimator] sheet ${input.page} failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: friendlyAIError(err, "reading this sheet") };
  }
}

/** The builder price book's ranges for this house in its market (no model call). */
export async function getPlanPriceChecks(raw: unknown): Promise<{ ok: true; data: PriceChecks } | Fail> {
  const parsed = priceChecksInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "The takeoff could not be read." };
  try {
    await requireEstimatorOrManager();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sign in again." };
  }
  const { house, items, location } = parsed.data;
  return { ok: true, data: planPriceChecks(house, items, location) };
}
