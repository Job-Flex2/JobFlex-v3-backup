import { NextResponse } from "next/server";
import { after } from "next/server";
import { db } from "@/lib/db";
import { getResend, isResendEnabled } from "@/lib/sdk/resend";
import { rateLimitShared } from "@/lib/rateLimit";
import { supportTicketRef } from "@/lib/notify";
import { checkReply } from "@/lib/supportReply";
import { emailAddressOf, htmlToText, isAutoReply, ticketFromAddress, trimQuoted, verifyWebhook, webhookHeaders } from "@/lib/supportInbound";
import { inboundConfig, postSupportMessage, senderOnTicket } from "@/lib/supportThread";
import { answerTicketWithAi } from "@/lib/support/aiSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SUPPORT · A REPLY BY EMAIL (owner, 2026-10-17, stage 2 — prepared, off until
// the owner turns it on; lib/supportInbound has the whole story).
//
// Resend Inbound posts `email.received` here (a Standard Webhooks signature,
// secret RESEND_INBOUND_WEBHOOK_SECRET). Its payload names the letter; the
// words are read back from Resend (emails.receiving.get) unless the signed
// payload already carries them. Then:
//   · the ticket comes from the t-<id>-<signature>@reply.jobflex.app address
//     it was sent to — no address of ours, or a forged signature: dropped;
//   · the sender must be the ticket's customer (→ from "customer") or the
//     support inbox (→ from "team") — anyone else: dropped;
//   · out-of-office and other machine replies: dropped;
//   · the quoted letter is cut off; what is left is added to the
//     conversation with channel "email", exactly as if written in the app
//     (lib/supportThread: the other side is emailed, the ticket moves).
// A dropped letter answers 200 with the reason, so the service doesn't retry
// it; only a bad or missing signature is refused (401). The same letter
// delivered twice (its Message-ID) is kept once.

/** Twenty letters an hour per ticket — a conversation, not a mail loop. */
const PER_TICKET_HOUR = 20;

type Received = {
  type?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    cc?: string[];
    received_for?: string[];
    subject?: string;
    message_id?: string;
    /** Not in Resend's payload — read from its API; a signed payload may carry them (tests, other services). */
    text?: string | null;
    html?: string | null;
    headers?: Record<string, string> | null;
  };
};

const drop = (reason: string, extra: Record<string, unknown> = {}) => {
  console.info(`[support-inbound] dropped: ${reason}`, Object.keys(extra).length ? extra : "");
  return NextResponse.json({ ok: true, dropped: reason, ...extra });
};

export async function POST(req: Request) {
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET?.trim();
  const cfg = inboundConfig();
  if (!secret || !cfg) return NextResponse.json({ ok: false, error: "Replies by email are not switched on." }, { status: 503 });

  const raw = await req.text();
  if (!verifyWebhook(webhookHeaders((n) => req.headers.get(n)), raw, secret)) {
    return NextResponse.json({ ok: false, error: "Bad signature." }, { status: 401 });
  }

  let event: Received;
  try {
    event = JSON.parse(raw) as Received;
  } catch {
    return drop("not-json");
  }
  if (event.type !== "email.received" || !event.data) return drop("not-a-received-email", { type: event.type ?? null });
  const d = event.data;

  // Which ticket: the first of our addresses it was sent to whose signature holds.
  const addresses = [...(d.to ?? []), ...(d.cc ?? []), ...(d.received_for ?? [])];
  const ticketId = addresses.map((a) => ticketFromAddress(a, cfg)).find((id): id is string => Boolean(id)) ?? null;
  if (!ticketId) return drop("no-ticket-address");
  const ref = supportTicketRef(ticketId);

  const sender = emailAddressOf(d.from);
  if (!sender) return drop("no-sender", { ref });
  const who = await senderOnTicket(ticketId, sender);
  if (!who) return drop("stranger", { ref });

  const messageId = d.message_id?.trim() || null;
  if (messageId) {
    const seen = await db.supportMessage.findFirst({ where: { ticketId, emailMessageId: messageId }, select: { id: true } });
    if (seen) return drop("duplicate", { ref });
  }

  const gate = await rateLimitShared(`support-inbound:${ticketId}`, PER_TICKET_HOUR, 60 * 60 * 1000);
  if (!gate.ok) return drop("too-many", { ref });

  // The words: carried in the signed payload, else read back from Resend.
  let text = d.text ?? null;
  let html = d.html ?? null;
  let headers = d.headers ?? null;
  let subject = d.subject ?? "";
  if (text == null && html == null) {
    if (!d.email_id || !isResendEnabled()) return drop("no-body", { ref });
    const got = await getResend().emails.receiving.get(d.email_id);
    if (got.error || !got.data) {
      // The service retries a 5xx; a letter we can't read yet may be readable in a moment.
      console.error(`[support-inbound] ${ref}: reading the letter failed:`, got.error?.message ?? "no data");
      return NextResponse.json({ ok: false, error: "Couldn't read the letter." }, { status: 502 });
    }
    text = got.data.text;
    html = got.data.html;
    headers = got.data.headers;
    subject = got.data.subject || subject;
  }
  if (isAutoReply(subject, headers)) return drop("auto-reply", { ref });

  const body = trimQuoted(text?.trim() ? text : html ? htmlToText(html) : "");
  const check = checkReply(body.slice(0, 4000));
  if (!check.ok) return drop("empty", { ref });

  const r = await postSupportMessage({
    ticketId,
    from: who.from,
    body: check.body,
    channel: "email",
    authorUserId: who.authorUserId,
    authorName: who.authorName,
    emailMessageId: messageId,
  });
  if (!r) return drop("ticket-gone", { ref });

  // The customer's next message may be answered by the AI, as in the app — while no person leads the ticket.
  if (who.from === "customer") {
    after(() =>
      answerTicketWithAi(ticketId, { trigger: "follow-up" }).then(
        () => undefined,
        (err) => console.error(`[support-ai] ${ref}: the follow-up by email was not answered:`, err instanceof Error ? err.message : err),
      ),
    );
  }
  console.info(`[support-inbound] ${ref}: ${who.from} message added by email (${check.body.length} chars).`);
  return NextResponse.json({ ok: true, ref, from: who.from, messageId: r.message.id });
}
