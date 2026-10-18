"use server";
// SUPPORT · THE AI'S SWITCHES (2026-10-15) — platform admins only. The switch
// (answers on its own / drafts for you / off), "Ask AI" on a ticket (always a
// draft), and the fix decisions: Approve, Decline, and "Mark fixed — tell the
// customer". The work is lib/support/aiSupport; nothing here changes a
// customer's account.
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { answerTicketWithAi, decideFix, markFixDone, writeSupportAiMode } from "@/lib/support/aiSupport";
import { SUPPORT_AI_MODES, type SupportAiMode, type SupportAiRecord } from "@/lib/support/aiReply";
import type { ThreadMessage } from "@/lib/supportReply";

type Admin = { id: string; email: string; name: string | null };
type Fail = { ok: false; error: string };

const DENIED = "Only platform admins can do that.";

async function asAdmin(): Promise<Admin | null> {
  try {
    const a = await requirePlatformAdmin();
    return { id: a.id, email: a.email, name: a.name ?? null };
  } catch {
    return null;
  }
}

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

function refresh() {
  revalidatePath("/admin/support");
  revalidatePath("/admin");
  revalidatePath("/dashboard/support");
}

export async function setSupportAiMode(raw: unknown): Promise<{ ok: true; mode: SupportAiMode } | Fail> {
  const admin = await asAdmin();
  if (!admin) return { ok: false, error: DENIED };
  if (!SUPPORT_AI_MODES.includes(raw as SupportAiMode)) return { ok: false, error: "Pick one of the three." };
  await writeSupportAiMode(raw as SupportAiMode, admin.name?.trim() || admin.email);
  revalidatePath("/admin/support");
  return { ok: true, mode: raw as SupportAiMode };
}

/** The AI reads the ticket again and writes a draft for the reply box — never sent. */
export async function askSupportAi(ticketId: unknown): Promise<{ ok: true; record: SupportAiRecord } | Fail> {
  const admin = await asAdmin();
  if (!admin) return { ok: false, error: DENIED };
  if (!isId(ticketId)) return { ok: false, error: "That ticket is gone." };
  const record = await answerTicketWithAi(ticketId, { trigger: "admin" });
  if (!record) return { ok: false, error: "That ticket is gone." };
  refresh();
  if (record.outcome === "failed") return { ok: false, error: record.reason ?? "The AI couldn't read this ticket." };
  return { ok: true, record };
}

export async function approveSupportFix(ticketId: unknown, note?: unknown): Promise<{ ok: true; record: SupportAiRecord } | Fail> {
  const admin = await asAdmin();
  if (!admin) return { ok: false, error: DENIED };
  if (!isId(ticketId)) return { ok: false, error: "That ticket is gone." };
  const r = await decideFix(ticketId, "approve", admin, typeof note === "string" ? note : undefined);
  if (r.ok) refresh();
  return r.ok ? { ok: true, record: r.record } : r;
}

export async function declineSupportFix(ticketId: unknown, note?: unknown): Promise<{ ok: true; record: SupportAiRecord } | Fail> {
  const admin = await asAdmin();
  if (!admin) return { ok: false, error: DENIED };
  if (!isId(ticketId)) return { ok: false, error: "That ticket is gone." };
  const r = await decideFix(ticketId, "decline", admin, typeof note === "string" ? note : undefined);
  if (r.ok) refresh();
  return r.ok ? { ok: true, record: r.record } : r;
}

/** The fix is live: the customer gets the "it's fixed" email and the ticket is resolved. */
export async function markSupportFixed(ticketId: unknown): Promise<{ ok: true; record: SupportAiRecord; reply: ThreadMessage } | Fail> {
  const admin = await asAdmin();
  if (!admin) return { ok: false, error: DENIED };
  if (!isId(ticketId)) return { ok: false, error: "That ticket is gone." };
  const r = await markFixDone(ticketId, admin);
  if (!r.ok) return r;
  refresh();
  return { ok: true, record: r.record, reply: r.reply! };
}
