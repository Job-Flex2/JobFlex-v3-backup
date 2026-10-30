"use server";
// SMARTHELP · THE PANEL'S SERVER ACTIONS (2026-10-30) — the guides for this person, one guide's steps, a typed
// question, a 👍 / 👎. Each asks requireOrg() who is asking and uses ITS organization and user, never an id from the
// panel; the page the panel names is only words for the model and the log (cleanPage).
//
// A TYPED QUESTION, IN THIS ORDER (lib/smarthelp/log replyWithoutModel, then here):
//   1. a secret pasted in — a card, a password, a code — is answered "a person will help, never share it" and goes
//      nowhere: no model call, and the log keeps a held line, not the question. "Answer it anyway" can't skip this;
//   2. a person topic (cancelling, refunds, deleting the account …) is answered without the model, with "Answer it
//      anyway" offered (canForce) — a forced ask still meets the model's person-only rules and cleanAnswer's guards;
//   3. the limits, counted on model calls only: 20 a person an hour, 300 a company a day;
//   4. the model (lib/smarthelp/server), its answer checked by cleanAnswer.
// A failure or a limit is one plain line; the guides and "Ask a person" still work. The log is written after the
// response (next/server after), so no answer waits on it.
import { after } from "next/server";
import { NoOrgError, UnauthorizedError, requireOrg } from "@/lib/orgContext";
import { rateLimitShared, retryInWords } from "@/lib/rateLimit";
import type { SmartHelpReply } from "@/lib/smarthelp/answer";
import { GUIDES } from "@/lib/smarthelp/guides";
import { cleanHistory, isLogId, questionOf, replyWithoutModel } from "@/lib/smarthelp/log";
import { countGuide, helpContextFor, modelReply, questionEntry, setQuestionOutcome, type Asker } from "@/lib/smarthelp/server";
import type { GuideCard, HelpContext, StepView } from "@/lib/smarthelp/types";
import { guideCards, stepView } from "@/lib/smarthelp/view";

const ASK_FAILED = "SmartHelp couldn't answer just now. The guides below still work, or ask a person.";
const SIGNED_OUT = "You're signed out — sign in again to use SmartHelp.";
const STILL_WORKS = "The guides below still work, and Ask a person reaches our team.";

/** requireOrg(), or null when nobody is signed in to a company — the panel gets a plain line, not a throw. */
async function asker(): Promise<Asker | null> {
  try {
    return await requireOrg();
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof NoOrgError) return null;
    throw err;
  }
}

/** When a limit opens again: "a minute" / "14 minutes" (rounded up), past an hour and a half "about 5 hours". */
function reopensIn(ms: number): string {
  if (ms <= 90 * 60_000) return retryInWords(ms);
  return `about ${Math.round(ms / 3_600_000)} hours`;
}

/** The limits, consulted only right before a model call: the person's first, so someone over theirs doesn't spend
 *  the company's. */
async function overLimit(who: Asker): Promise<{ error: string; retryAfterMs: number } | null> {
  const person = await rateLimitShared(`smarthelp:u:${who.user.id}`, 20, 3_600_000);
  if (!person.ok) {
    return {
      error: `SmartHelp answers up to 20 questions an hour for each person — you can ask again in ${reopensIn(person.retryAfterMs)}. ${STILL_WORKS}`,
      retryAfterMs: person.retryAfterMs,
    };
  }
  const company = await rateLimitShared(`smarthelp:o:${who.organizationId}`, 300, 86_400_000);
  if (!company.ok) {
    return {
      error: `Your company has asked SmartHelp 300 questions today — it answers again in ${reopensIn(company.retryAfterMs)}. ${STILL_WORKS}`,
      retryAfterMs: company.retryAfterMs,
    };
  }
  return null;
}

/** The guide cards for this person, in order (to do first), and what SmartHelp knows about them. Signed out, this
 *  throws like any requireOrg() action — the panel is drawn only for someone signed in. */
export async function smartHelpPanel(page: string): Promise<{ cards: GuideCard[]; ctx: HelpContext }> {
  const ctx = await helpContextFor(await requireOrg(), page);
  return { cards: guideCards(GUIDES, ctx), ctx };
}

/** One guide's steps as this person may follow them (a page their role or plan can't open has no buttons). Counts the
 *  open. */
export async function guideFor(id: string, page: string): Promise<{ guide: { id: string; title: string; steps: StepView[] } } | { error: string }> {
  const guide = GUIDES.find((g) => g.id === id);
  if (!guide) return { error: "That guide isn't here anymore — close SmartHelp and open it again." };
  const who = await asker();
  if (!who) return { error: SIGNED_OUT };
  const ctx = await helpContextFor(who, page);
  if (guide.feature && !ctx.features[guide.feature]) return { error: "That guide isn't open to your account yet." };
  after(() => countGuide(guide.id, "opens"));
  return { guide: { id: guide.id, title: guide.title, steps: guide.steps.map((s) => stepView(s, ctx)) } };
}

/** A typed question, answered — see the header for the order. `canForce` is true only on a person-topic reply given
 *  without the model: the panel then offers "Answer it anyway" (`force: true`). */
export async function askSmartHelp(input: {
  question: string;
  history: Array<{ q: string; a: string }>;
  page: string;
  force?: boolean;
}): Promise<{ reply: SmartHelpReply; logId: string; canForce: boolean } | { error: string; retryAfterMs?: number }> {
  const asked = questionOf(input?.question);
  if ("error" in asked) return asked;
  const { question } = asked;
  const who = await asker();
  if (!who) return { error: SIGNED_OUT };

  const answered = (ctx: HelpContext, reply: SmartHelpReply, canForce: boolean) => {
    const entry = questionEntry(who, ctx, question, reply);
    after(entry.save);
    return { reply, logId: entry.id, canForce };
  };

  const early = replyWithoutModel(question, input.force === true);
  if (early) return answered(await helpContextFor(who, input.page), early.reply, early.canForce);

  const [ctx, limited] = await Promise.all([helpContextFor(who, input.page), overLimit(who)]);
  if (limited) return limited;
  let reply: SmartHelpReply;
  try {
    reply = await modelReply({ question, history: cleanHistory(input.history), ctx });
  } catch (err) {
    // Logged too, as not answered: the owner sees the question SmartHelp couldn't take.
    console.error("[smarthelp] no answer from the model:", err instanceof Error ? err.message : err);
    after(questionEntry(who, ctx, question, { kind: "unknown", title: ASK_FAILED, steps: [], note: null }).save);
    return { error: ASK_FAILED };
  }
  return answered(ctx, reply, false);
}

/** What a rating is on: a log entry (by its id's shape) or a guide (by its id in GUIDES) — else nothing. */
function ratedOf(target: unknown): { logId: string } | { guideId: string } | null {
  const field = (key: string): unknown => (target && typeof target === "object" ? (target as Record<string, unknown>)[key] : undefined);
  const logId = field("logId");
  if (isLogId(logId)) return { logId };
  const guide = GUIDES.find((g) => g.id === field("guideId"));
  return guide ? { guideId: guide.id } : null;
}

/** A 👍 / 👎 on an answer — only the person who asked may rate it — or on a guide. 30 in 10 minutes. */
export async function rateSmartHelp(
  target: { logId: string } | { guideId: string },
  verdict: "up" | "down",
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (verdict !== "up" && verdict !== "down") return { ok: false, error: "Pick a thumbs up or a thumbs down." };
  const rated = ratedOf(target);
  if (!rated) return { ok: false, error: "That answer isn't here anymore." };
  const who = await asker();
  if (!who) return { ok: false, error: SIGNED_OUT };
  const gate = await rateLimitShared(`smarthelp:rate:${who.user.id}`, 30, 600_000);
  if (!gate.ok) return { ok: false, error: `That's a lot of ratings in a row — try again in ${retryInWords(gate.retryAfterMs)}.` };

  if ("guideId" in rated) {
    after(() => countGuide(rated.guideId, verdict));
    return { ok: true };
  }
  try {
    const r = await setQuestionOutcome(rated.logId, who.user.id, verdict);
    if (r === "gone") return { ok: false, error: "That answer isn't here anymore." };
    if (r === "not-yours") return { ok: false, error: "Only the person who asked can rate this answer." };
    return { ok: true };
  } catch (err) {
    console.warn("[smarthelp] a rating was not saved:", err instanceof Error ? err.message : err);
    return { ok: false, error: "That didn't save — try again in a moment." };
  }
}
