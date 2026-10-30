import "server-only";
// SmartHelp · THE SERVER — the person's context and their account's setup, the model call, and the records (the
// question log, the guide counters). What is asked when, and the limits, are the actions' (src/actions/smartHelp.ts);
// the pure parts are ./log.
//
// THE CONTEXT is read fresh for every panel open, guide and question, all at once: eight setup facts — each one that
// can't be read counts as "not done", so its guide stays on top (the safe side) — the plan, the pages it locks, and
// the two features still opening (online booking, website estimators). No client, lead or money data.
//
// THE MODEL IS THE PLATFORM'S COST: lib/support/unmeteredOpenAI, never getOpenAI() or anything that meters the
// organization's trial budget (lib/trialMeter).
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { readDeskSettings } from "@/lib/aiDesk/numbers";
import { parseBookingSettings } from "@/lib/booking";
import { getBlockedCustomPages } from "@/lib/customPageAccess";
import { canSeeEarlyAccess } from "@/lib/earlyAccess";
import { FREE_PLAN_NAME, onFreePlan } from "@/lib/freePlan";
import { leadSetupNeed } from "@/lib/leadSetup";
import { isOrgNameUnset } from "@/lib/orgName";
import { getPaymentConnectionStatus } from "@/lib/payments/connections";
import { getPlanDisplayName } from "@/lib/planCatalogServer";
import { resolveOpenAIModel, samplingOptions } from "@/lib/sdk/openai";
import { readRegistration } from "@/lib/sms/registration";
import { unmeteredOpenAI } from "@/lib/support/unmeteredOpenAI";
import { readWebSettings, webEstimatorOpen } from "@/lib/webEstimatorServer";
import { HISTORY_TURNS, cleanAnswer, helpTargets, smartHelpAnswerSchema, smartHelpSystemPrompt, smartHelpUserPrompt, type SmartHelpReply } from "./answer";
import {
  LOG_KEEP_DAYS,
  LOG_PREFIX,
  bumpGuideCount,
  cleanPage,
  guideKey,
  isLogId,
  logKey,
  parseGuideCounts,
  parseQuestionLog,
  questionLog,
  withOutcome,
  type GuideCounts,
  type QuestionLog,
  type Turn,
} from "./log";
import type { HelpContext, SetupState } from "./types";

/** Who is asking — requireOrg()'s answer (lib/orgContext), never ids from the panel. */
export type Asker = { organizationId: string; role: string | null; user: { id: string; email?: string | null; name?: string | null } };

// ── The person's context ─────────────────────────────────────────────────────

/** One setup fact; a read that fails is "not done". */
async function fact(read: () => Promise<boolean>): Promise<boolean> {
  try {
    return await read();
  } catch {
    return false;
  }
}

/** What this company has set up, the eight facts read in parallel. */
export async function readSetupState(orgId: string): Promise<SetupState> {
  const now = new Date();
  const [profile, aiDesk, texting, payments, booking, website, team, proposalSent] = await Promise.all([
    // Leads can find the shop — an address and its trades (lib/leadSetup) — and the business has its own name.
    fact(async () => {
      const [need, nameUnset] = await Promise.all([leadSetupNeed(orgId), isOrgNameUnset(orgId)]);
      return need !== null && !need.needs && !nameUnset;
    }),
    // The desk's profile is written ("Describe your business").
    fact(async () => (await readDeskSettings(orgId)).profile !== null),
    // The texting number is registered and approved.
    fact(async () => (await readRegistration(orgId)).stage === "approved"),
    fact(async () => {
      const s = await getPaymentConnectionStatus(orgId);
      return [s.stripe.state, s.square.state, s.stax.state].some((state) => state === "connected");
    }),
    // Saved booking settings that leave the page on: with none saved the defaults read "on" though nothing is set up,
    // and the page's switch can be turned off.
    fact(async () => {
      const org = await db.organization.findUnique({ where: { id: orgId }, select: { bookingSettingsJson: true } });
      const json = org?.bookingSettingsJson ?? null;
      return json !== null && parseBookingSettings(json, []).enabled;
    }),
    fact(async () => Object.values((await readWebSettings(orgId)).trades).some((t) => t.on)),
    // Somebody else has a seat (a worker invite writes the seat at once), or an invite is still open.
    fact(async () => {
      const [seats, invite] = await Promise.all([
        db.membership.count({ where: { organizationId: orgId } }),
        db.invite.findFirst({ where: { organizationId: orgId, acceptedAt: null, expiresAt: { gt: now } }, select: { id: true } }),
      ]);
      return seats > 1 || invite !== null;
    }),
    fact(async () => (await db.proposal.findFirst({ where: { organizationId: orgId, sentAt: { not: null } }, select: { id: true } })) !== null),
  ]);
  return { profile, aiDesk, texting, payments, booking, website, team, proposalSent };
}

/** The plan by the name the sidebar shows (app/(dashboard)/layout): an ended subscription is the Free plan. */
async function planNameOf(orgId: string): Promise<string | null> {
  const sub = await db.subscription.findUnique({ where: { organizationId: orgId }, select: { plan: true, status: true } });
  if (onFreePlan(sub)) return FREE_PLAN_NAME;
  return sub?.plan ? await getPlanDisplayName(sub.plan) : null;
}

/** Everything SmartHelp knows about the person: role, plan, locked pages, setup, open features, and the page they
 *  are on (`page` is the panel's word — context only, see cleanPage). */
export async function helpContextFor(
  ctx: { organizationId: string; role: string | null; user: { email?: string | null } },
  page: string,
): Promise<HelpContext> {
  const orgId = ctx.organizationId;
  const [setup, plan, locked, website] = await Promise.all([
    readSetupState(orgId),
    planNameOf(orgId).catch(() => null),
    getBlockedCustomPages(orgId).catch(() => null),
    fact(() => webEstimatorOpen()),
  ]);
  return {
    role: ctx.role,
    plan,
    lockedHrefs: locked ?? [],
    setup,
    // Online booking is early access (the page itself redirects everyone else); website estimators open with the
    // owner's one switch.
    features: { booking: canSeeEarlyAccess(ctx.user.email), website },
    page: cleanPage(page),
  };
}

// ── The model ────────────────────────────────────────────────────────────────

/** The model's answer to a question, as the panel may show it (cleanAnswer). Throws when the call fails or the answer
 *  isn't a JSON object — the action shows its one plain line instead. */
export async function modelReply(input: { question: string; history: Turn[]; ctx: HelpContext }): Promise<SmartHelpReply> {
  const model = await resolveOpenAIModel();
  const completion = await unmeteredOpenAI().chat.completions.create({
    model,
    ...(await samplingOptions(0.2)),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: smartHelpSystemPrompt() },
      { role: "user", content: smartHelpUserPrompt({ question: input.question, history: input.history.slice(-HISTORY_TURNS), ctx: input.ctx }) },
    ],
  });
  const answer = smartHelpAnswerSchema.parse(JSON.parse(completion.choices[0]?.message?.content ?? ""));
  return cleanAnswer(answer, input.ctx, helpTargets());
}

// ── The question log ─────────────────────────────────────────────────────────

const SWEEP_EVERY_MS = 3_600_000;
let sweptAt = 0;

/** Questions untouched for LOG_KEEP_DAYS go — looked for at most once an hour on each server instance. */
async function sweepOldQuestions(now: number): Promise<void> {
  if (now - sweptAt < SWEEP_EVERY_MS) return;
  sweptAt = now;
  await db.syncState.deleteMany({
    where: { key: { startsWith: LOG_PREFIX }, updatedAt: { lt: new Date(now - LOG_KEEP_DAYS * 86_400_000) } },
  });
}

/** One typed question's log entry: its id at once (the panel rates it, "Ask a person" carries it), and `save`, which
 *  writes the row — the action runs it after the response. Best-effort: a failed write is a log line, never a lost
 *  answer. A secret in the question is not kept (questionLog). */
export function questionEntry(who: Asker, ctx: HelpContext, question: string, reply: SmartHelpReply): { id: string; save: () => Promise<void> } {
  const at = new Date();
  const rand = randomBytes(4).toString("hex");
  return {
    id: logKey(at, rand).slice(LOG_PREFIX.length),
    save: async () => {
      try {
        const org = await db.organization.findUnique({ where: { id: who.organizationId }, select: { name: true } });
        const rec = questionLog({
          at,
          rand,
          orgId: who.organizationId,
          orgName: org?.name ?? "",
          userId: who.user.id,
          userName: who.user.name ?? null,
          role: ctx.role,
          plan: ctx.plan,
          page: ctx.page,
          question,
          reply,
        });
        await db.syncState.create({ data: { key: logKey(at, rand), cursor: JSON.stringify(rec) } });
        await sweepOldQuestions(at.getTime());
      } catch (err) {
        console.warn("[smarthelp] the question log was not written:", err instanceof Error ? err.message : err);
      }
    },
  };
}

/** A 👍 / 👎 — or "Ask a person" — on one log entry, by the person who asked it and nobody else. */
export async function setQuestionOutcome(
  logId: string,
  userId: string,
  outcome: Exclude<QuestionLog["outcome"], "none">,
): Promise<"ok" | "gone" | "not-yours"> {
  if (!isLogId(logId)) return "gone";
  const key = `${LOG_PREFIX}${logId}`;
  const row = await db.syncState.findUnique({ where: { key }, select: { cursor: true } });
  const rec = row ? parseQuestionLog(row.cursor) : null;
  if (!rec) return "gone";
  if (rec.userId !== userId) return "not-yours";
  const next = withOutcome(rec, outcome);
  if (next.outcome !== rec.outcome) await db.syncState.updateMany({ where: { key }, data: { cursor: JSON.stringify(next) } });
  return "ok";
}

// ── Guide counters ───────────────────────────────────────────────────────────

const CAS_ATTEMPTS = 4;

/** One more open, 👍 or 👎 on a guide (`id`: a GUIDES id). Compare-and-swap like lib/rateLimit, so two at once both
 *  count. Best-effort: a counter never stands in a guide's way. */
export async function countGuide(id: string, field: keyof GuideCounts): Promise<void> {
  const key = guideKey(id);
  try {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      const row = await db.syncState.findUnique({ where: { key }, select: { cursor: true } });
      const cursor = JSON.stringify(bumpGuideCount(parseGuideCounts(row?.cursor), field));
      if (!row) {
        try {
          await db.syncState.create({ data: { key, cursor } });
          return;
        } catch {
          continue; // created by another request first — read it again
        }
      }
      const { count } = await db.syncState.updateMany({ where: { key, cursor: row.cursor }, data: { cursor } });
      if (count === 1) return;
    }
  } catch (err) {
    console.warn(`[smarthelp] guide ${id} was not counted:`, err instanceof Error ? err.message : err);
  }
}
