"use server";
import { z } from "zod";
import { createHomeownerLead } from "@/lib/leadCenter/intake";
import { isValidTestKey } from "@/lib/leadCenter/testLeads";
import { suggestIntakeQuestions, type IntakeQuestion } from "@/lib/ai/homeownerQuestions";
import { enforceRateLimit, clientIp, rateLimitShared, MINUTE } from "@/lib/rateLimit";
import { needsAddressFor, writeProfessionalScope } from "@/lib/leadScope";
import { SEO_SOURCE_RE } from "@/lib/seo/links";

const homeownerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  projectType: z.string().optional(),
  description: z.string().min(1),
  referralCode: z.string().optional(),
  /** The scope the wizard wrote and the homeowner approved (suggestHomeownerScope); stored as is. */
  scope: z.string().trim().max(3000).optional(),
  /** /homeowner?test=<key> (lib/leadCenter/testLeads). Never echoed back. */
  testKey: z.string().max(200).optional(),
  /** From the home dashboard (lib/home/portal): its key, and the plan being submitted. */
  homeKey: z.string().max(200).optional(),
  planId: z.string().max(60).optional(),
  /** The browser's time zone, for a new home's reminders. */
  timezone: z.string().max(80).optional(),
  /** Started on a cost guide: "seo:<work>:<city>" (lib/seo/links). Anything else is dropped, never refused. */
  source: z.string().max(120).optional().transform((v) => (v && SEO_SOURCE_RE.test(v) ? v : undefined)),
});

/**
 * The homeowner's "Send my project". Every refusal comes back as `{ ok: false, error }` in words (2026-10-14):
 * a thrown error is masked in production ("An error occurred in the Server Components render…"), and the person
 * reading it has just typed out their project from an ad. Their answers stay on the form either way.
 */
export async function submitHomeownerRequest(raw: unknown) {
  try {
    return await submitHomeownerRequestInner(raw);
  } catch (err) {
    const e = err as { name?: string; message?: string; retryAfterMs?: number };
    if (e?.name === "RateLimitError") {
      const mins = Math.max(1, Math.ceil((e.retryAfterMs ?? 10 * MINUTE) / MINUTE));
      return { ok: false as const, error: `We've had several projects from this connection in the last few minutes, so we're pausing for a moment. Please send again in ${mins} minute${mins === 1 ? "" : "s"} — your answers are still here.` };
    }
    if (err instanceof z.ZodError) {
      return { ok: false as const, error: "Something in the form doesn't look right — check your name, email and ZIP code, then send again." };
    }
    console.error("[homeowner] submit failed:", err);
    return { ok: false as const, error: "We couldn't send that just now — nothing was lost. Please try again in a minute." };
  }
}

async function submitHomeownerRequestInner(raw: unknown) {
  const data = homeownerSchema.parse(raw);
  // Public, unauthenticated, and expensive downstream (AI, geocode, email, SMS
  // to a caller-supplied number): per-IP cap plus a platform-wide ceiling.
  await enforceRateLimit(`homeowner:${await clientIp()}`, 3, 10 * MINUTE, "requests");
  await enforceRateLimit("homeowner:global", 60, MINUTE, "requests");

  // A roof, a fence, siding, gutters, a driveway or a deck is measured at the
  // property (lib/leadRules): without the street address the contractor's
  // estimator has nothing to look at. Said back as a plain answer the wizard
  // shows, not a thrown error — those are masked in production.
  if (needsAddressFor(data.description) && !(data.address ?? "").trim()) {
    return {
      ok: false as const,
      error: "This job is measured at the property, so contractors need the street address. Please add it and send again.",
    };
  }

  // A valid ?test=<key> (lib/leadCenter/testLeads) makes this a test lead; a
  // wrong or empty key is simply an ordinary request.
  const isTest = data.testKey ? await isValidTestKey(data.testKey) : false;
  const { testKey: _testKey, homeKey, planId, timezone, source, ...intake } = data;
  void _testKey;
  return createHomeownerLead(intake, { isTest, homeKey: homeKey ?? null, planId: planId ?? null, timezone: timezone ?? null, source: source ?? null });
}

// ── Adaptive clarify questions ─────────────────────────────────────────────
// The wizard's step-2 questions, written from what the homeowner actually
// typed. Public, like the submission itself, so it carries its own brake: the
// call costs an OpenAI request and nothing else, and a caller who exceeds the
// window simply gets the wizard's static questions instead of an error.

const questionsInput = z.object({
  description: z.string().trim().min(1).max(2000),
  category: z.string().trim().max(60).nullable().optional(),
});

/** Per-instance brake, same shape support tickets use. Generous: a homeowner
 *  editing their description and re-refining is normal behaviour. */
const QUESTIONS_PER_WINDOW = 12;
const QUESTIONS_WINDOW_MS = 5 * 60 * 1000;

const scopeInput = z.object({
  description: z.string().trim().min(1).max(4000),
  answers: z.array(z.object({ q: z.string().trim().max(300), a: z.string().trim().max(500) })).max(12).optional(),
});

/**
 * "Generate my scope" in the wizards (owner, 2026-09-21): the description
 * and the answers, written up as the scope a contractor prices from
 * (lib/leadScope). The homeowner reads it on the scope step and sends it
 * with the request. Never throws — null means "show the homeowner's words".
 */
export async function suggestHomeownerScope(raw: unknown): Promise<{ scope: string | null }> {
  let data: z.infer<typeof scopeInput>;
  try {
    data = scopeInput.parse(raw);
  } catch {
    return { scope: null };
  }
  const gate = await rateLimitShared(`homeowner-scope:${await clientIp()}`, QUESTIONS_PER_WINDOW, QUESTIONS_WINDOW_MS);
  if (!gate.ok) return { scope: null };
  const answers = (data.answers ?? [])
    .filter((x) => x.a)
    .map((x) => `${x.q} ${x.a}`)
    .join("\n");
  return { scope: await writeProfessionalScope({ description: answers ? `${data.description}\n\n${answers}` : data.description }) };
}

/**
 * 3-5 follow-up questions for this description, or null when the wizard should
 * keep its own static set (AI off, refused, rate-limited, thin brief).
 * Never throws — a failure here must not stop a homeowner sending the request.
 */
export async function suggestHomeownerQuestions(
  raw: unknown,
): Promise<{ questions: IntakeQuestion[] | null }> {
  let data: z.infer<typeof questionsInput>;
  try {
    data = questionsInput.parse(raw);
  } catch {
    return { questions: null };
  }
  // No session to key on — this runs before a homeowner has told us anything
  // about themselves, so the window is per client IP (cross-instance).
  const gate = await rateLimitShared(`homeowner-questions:${await clientIp()}`, QUESTIONS_PER_WINDOW, QUESTIONS_WINDOW_MS);
  if (!gate.ok) return { questions: null };
  try {
    return { questions: await suggestIntakeQuestions(data.description, data.category ?? null) };
  } catch {
    return { questions: null };
  }
}
