import { z } from "zod";

// Shared estimator schema/types. Kept OUT of the "use server" action files
// (advancedEstimator/roofEstimator/fenceEstimator) because a "use server" file
// may only export async functions — exporting a Zod object from one throws
// "A 'use server' file can only export async functions, found object."

// Accept only http(s) URLs from the (untrusted) model + SerpAPI output. Coerce
// anything else (javascript:, data:, malformed) to undefined so a hostile or
// hallucinated scheme can never persist and later render into an href/src.
const httpUrl = z
  .string()
  .optional()
  .transform((v) => {
    const t = v?.trim();
    return t && /^https?:\/\//i.test(t) ? t : undefined;
  });

// Free-text optional: blank / whitespace-only normalizes to undefined so it
// never renders an empty meta chip (mirrors the httpUrl hygiene).
const trimmedOpt = z
  .string()
  .optional()
  .transform((v) => {
    const t = v?.trim();
    return t ? t : undefined;
  });

export const lineSchema = z.object({
  // Client row identity, passed through the AI round-trip. Lets the refine
  // match lines by identity (not name), so a rename never re-shops/re-prices.
  // The model echoes it; brand-new lines omit it. Optional for back-compat.
  id: z.string().optional(),
  name: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  unit: trimmedOpt,
  // The shop-list price: what the matched retail listing sells the package for
  // (a $45 box, a $180 five-gallon pail). Set server-side from the chosen
  // option, never by the model. Independent of `unitPrice`, which is the
  // estimator's price per measured unit — the material list is a "where to buy
  // it and what it costs" reference, not the line's pricing (owner, 2026-09-02).
  retailPrice: z.number().nonnegative().optional(),
  // Product metadata surfaced by the live-pricing estimator so the purchases
  // page can render a real shoppable line (store, link, image, size, math notes).
  store: trimmedOpt,
  productUrl: httpUrl,
  imageUrl: httpUrl,
  dimensions: trimmedOpt,
  notes: trimmedOpt,
  // What the post-generation validation did to this line (audit 2026-09-17,
  // lib/estimate/validate-estimate): "auto" = the app added it from the
  // trade's standard scope, "adjusted" = its price was pulled to the
  // catalogue anchor, "suggested" = the description never asked for this
  // work, so it is offered as an option and stays OUT of every total until
  // the contractor adds it. `flagNote` is the short reason, shown on the row.
  // "computed" is the fourth state (2026-09-18): the line's quantity was
  // measured out of the brief and its price built from the merchant path or a
  // trade anchor, so neither the model nor the repair pass may move it.
  flag: z.enum(["auto", "adjusted", "suggested", "computed"]).optional(),
  flagNote: trimmedOpt,
});

// One order-level discount, mirroring the Prisma Discount row on Proposal
// ({label, amount, isPercent}) so it converts 1:1. amount is dollars when
// isPercent=false, a 0-100 percentage when true.
export const discountSchema = z.object({
  label: z.string().min(1).max(80),
  amount: z.number().positive(),
  isPercent: z.boolean(),
});
export type EstimateDiscount = z.infer<typeof discountSchema>;

/** How an estimate was priced when the company's own method was on (lib/estimate/companyPricing, 2026-10-16). */
export const pricingSnapshotSchema = z.object({
  mode: z.literal("company"),
  laborBasis: z.enum(["crew", "person"]),
  crewSize: z.number().min(1).max(20),
  laborRate: z.number().min(0).max(5000),
  materialMarkupPct: z.number().min(0).max(300),
  overheadPct: z.number().min(0).max(100),
  profitPct: z.number().min(0).max(100),
  taxMode: z.enum(["none", "materials", "job"]),
  taxRatePct: z.number().min(0).max(30).nullable(),
  words: z.string().max(400),
});
export type PricingSnapshotWire = z.infer<typeof pricingSnapshotSchema>;

export const estimateSchema = z.object({
  title: z.string(),
  scope: z.string(),
  assumptions: z.array(z.string()).default([]),
  materials: z.array(lineSchema).default([]),
  labor: z.array(lineSchema).default([]),
  estimatedTimelineDays: z.number().optional(),
  // Set by the refine when the contractor asks for a discount ("10% off",
  // "knock $500 off") — kept order-level instead of mangled into line prices.
  discount: discountSchema.nullish(),
  // What the validation pass changed, in the contractor's words ("2 lines
  // added from standard scope"). Shown under the estimate, never on the
  // proposal the client reads.
  notes: z.array(z.string()).optional(),
  // Priced the company's way (labor in hours at its rate, its markup, its tax rule) — absent: the price book's way.
  pricing: pricingSnapshotSchema.optional(),
  // The estimate this same brief got before (lib/estimate/sameBrief): when it was made. Absent: just priced.
  remembered: z.object({ at: z.string() }).optional(),
});

export type GeneratedEstimate = z.infer<typeof estimateSchema>;

/** The note on an estimate this same brief got before (lib/estimate/sameBrief) — shared so a screen that shows its own
 *  line for it can leave the note out of the list. */
export const SAME_BRIEF_NOTE = "Same brief as before, so the same estimate and the same price. Change the brief, the photos or your prices for a new one — or ask for a fresh estimate.";

// ── Prompt analysis (intake gate) ───────────────────────────────────────────
// Before generating, the AI checks the brief is descriptive enough and corrects
// the location. If thin, it returns 3-8 targeted clarifying questions.
export const clarifyQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  /** How the answer moves the price — the reason the question is worth asking (owner, 2026-09-17: only cost-critical questions). */
  why: z.string().optional(),
  kind: z.enum(["select", "number", "text"]).default("text"),
  options: z.array(z.string()).optional(),
  unit: z.string().optional(),
  placeholder: z.string().optional(),
});

export const promptAnalysisSchema = z.object({
  /** Normalized "City, ST", or null when none/invalid. */
  correctedLocation: z.string().nullable().default(null),
  enoughDetail: z.boolean().default(true),
  questions: z.array(clarifyQuestionSchema).default([]),
});

export type ClarifyQuestion = z.infer<typeof clarifyQuestionSchema>;
export type PromptAnalysis = z.infer<typeof promptAnalysisSchema>;
