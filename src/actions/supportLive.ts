"use server";
// SUPPORT · THE ANSWER IN THE HELP WINDOW (owner, 2026-10-15: "add it") — the
// customer's side. The window asks for the AI's answer to the ticket it just
// filed until it lands (lib/support/aiSupport liveAnswerFor), and passes the
// customer's word on it back: "That solved it" or "I still need help". Only
// the person who filed the ticket can read or rate it.
import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/orgContext";
import { rateLimitShared } from "@/lib/rateLimit";
import { liveAnswerFor, recordCustomerVerdict } from "@/lib/support/aiSupport";
import type { LiveState } from "@/lib/support/aiState";

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

export async function liveSupportAnswer(ticketId: unknown): Promise<LiveState> {
  if (!isId(ticketId)) return { state: "none" };
  const { organizationId, user } = await requireOrg();
  return (await liveAnswerFor(ticketId, { userId: user.id, organizationId })) ?? { state: "none" };
}

export async function answerSupportVerdict(ticketId: unknown, verdict: unknown, note?: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isId(ticketId)) return { ok: false, error: "That ticket is gone." };
  if (verdict !== "solved" && verdict !== "needs-person") return { ok: false, error: "Pick one." };
  const { organizationId, user } = await requireOrg();
  const gate = await rateLimitShared(`support-verdict:${user.id}`, 10, 10 * 60 * 1000);
  if (!gate.ok) return { ok: false, error: "That's several in a row — try again in a few minutes." };
  const r = await recordCustomerVerdict(ticketId, { userId: user.id, organizationId }, verdict, typeof note === "string" ? note : undefined);
  if (r.ok) {
    revalidatePath("/dashboard/support");
    revalidatePath("/admin/support");
  }
  return r;
}
