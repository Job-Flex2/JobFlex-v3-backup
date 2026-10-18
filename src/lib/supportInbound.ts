// SUPPORT · REPLIES BY EMAIL (owner, 2026-10-17, stage 2 — prepared, off until
// the owner points reply.jobflex.app's MX at the inbound service) — pure.
//
// Every letter about a ticket carries the ticket's own Reply-To,
// t-<ticket id>-<signature>@reply.jobflex.app. The signature is an HMAC of the
// ticket id, so an address can't be guessed or walked to another ticket. A
// reply to it reaches /api/support/inbound (the inbound service's signed
// webhook), which finds the ticket from the address, checks the sender is the
// ticket's customer or the support inbox, cuts the quoted letter off and adds
// what is left to the conversation (channel "email").
//
// Here: the address both ways, the webhook signature (Standard Webhooks — what
// Resend signs its webhooks with), the sender's address, and the cut.
// lib/supportThread decides when the address is used (SUPPORT_REPLY_DOMAIN).

import { createHmac, timingSafeEqual } from "node:crypto";
import { REPLY_ABOVE } from "@/lib/supportReply";

// ── The ticket's own address ─────────────────────────────────────────────────

const SIG_LEN = 20;

function ticketSig(ticketId: string, secret: string): string {
  return createHmac("sha256", secret).update(`support-reply:${ticketId}`).digest("hex").slice(0, SIG_LEN);
}

/** t-<ticket id>-<signature>@<domain>. Ticket ids are cuids (lowercase letters and digits). */
export function replyAddress(ticketId: string, o: { domain: string; secret: string }): string {
  return `t-${ticketId}-${ticketSig(ticketId, o.secret)}@${o.domain.toLowerCase()}`;
}

/** The ticket an address names, when it is one of ours and its signature holds; else null. */
export function ticketFromAddress(raw: string, o: { domain: string; secret: string }): string | null {
  const address = emailAddressOf(raw);
  if (!address) return null;
  const at = address.lastIndexOf("@");
  if (address.slice(at + 1) !== o.domain.toLowerCase()) return null;
  const m = /^t-([a-z0-9]{10,40})-([a-f0-9]{20})$/.exec(address.slice(0, at));
  if (!m) return null;
  const want = Buffer.from(ticketSig(m[1], o.secret));
  const got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got) ? m[1] : null;
}

// ── …or the mailbox's own plus-address (owner, 2026-10-18: we stay on Gmail) ──
//
// Gmail delivers <box>+<anything>@<domain> to <box>@<domain> and keeps the
// whole address in To / Delivered-To, so the ticket rides in the "+" part:
// app+t-<ticket id>-<signature>@jobflex.app. lib/supportMail reads the box
// over IMAP and finds the ticket here. Same HMAC as above.

/** <box>+t-<ticket id>-<signature>@<box's domain>. */
export function plusReplyAddress(ticketId: string, o: { mailbox: string; secret: string }): string {
  const box = o.mailbox.trim().toLowerCase();
  const at = box.lastIndexOf("@");
  const local = box.slice(0, at).split("+")[0];
  return `${local}+t-${ticketId}-${ticketSig(ticketId, o.secret)}@${box.slice(at + 1)}`;
}

/** The ticket a plus-address names, when it is the mailbox's own and its signature holds; else null. */
export function ticketFromPlusAddress(raw: string, o: { mailbox: string; secret: string }): string | null {
  const address = emailAddressOf(raw);
  if (!address) return null;
  const box = o.mailbox.trim().toLowerCase();
  const boxAt = box.lastIndexOf("@");
  const at = address.lastIndexOf("@");
  if (address.slice(at + 1) !== box.slice(boxAt + 1)) return null;
  const m = /^([^+]+)\+t-([a-z0-9]{10,40})-([a-f0-9]{20})$/.exec(address.slice(0, at));
  if (!m || m[1] !== box.slice(0, boxAt).split("+")[0]) return null;
  const want = Buffer.from(ticketSig(m[2], o.secret));
  const got = Buffer.from(m[3]);
  return want.length === got.length && timingSafeEqual(want, got) ? m[2] : null;
}

/** Looks like one of our plus-addresses (signature not checked) — a forged or broken one still counts as "meant for a ticket". */
export function isPlusTicketAddress(raw: string, mailbox: string): boolean {
  const address = emailAddressOf(raw);
  const box = mailbox.trim().toLowerCase();
  if (!address) return false;
  const local = box.slice(0, box.lastIndexOf("@")).split("+")[0];
  return address.startsWith(`${local}+t-`) && address.endsWith(box.slice(box.lastIndexOf("@")));
}

/** "[JobFlex J7RCFS]" in a subject → "J7RCFS" (the ticket's ref, lib/notify supportTicketRef). */
export function refFromSubject(subject: string | null | undefined): string | null {
  const m = /\[JobFlex ([A-Z0-9]{6})\]/.exec(subject ?? "");
  return m ? m[1] : null;
}

/** "Dana Ray <Dana@X.test>" → "dana@x.test"; anything without an address → null. */
export function emailAddressOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const angle = /<([^<>\s]+@[^<>\s]+)>/.exec(raw);
  const bare = angle ? angle[1] : raw.trim();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(bare) ? bare.toLowerCase() : null;
}

// ── The webhook's signature (Standard Webhooks: webhook-id / -timestamp / -signature) ──

/** Five minutes either way, as the Standard Webhooks libraries allow. */
const TOLERANCE_S = 5 * 60;

/**
 * True when `payload` was signed with `secret` ("whsec_<base64>") for this id
 * and timestamp, within five minutes of `nowS`. The header may carry several
 * "v1,<base64>" signatures (a rotated secret); one match is enough.
 */
export function verifyWebhook(
  h: { id: string | null; timestamp: string | null; signature: string | null },
  payload: string,
  secret: string,
  nowS = Math.floor(Date.now() / 1000),
): boolean {
  if (!h.id || !h.timestamp || !h.signature || !secret) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowS - ts) > TOLERANCE_S) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret, "base64");
  if (!key.length) return false;
  const want = createHmac("sha256", key).update(`${h.id}.${h.timestamp}.${payload}`).digest();
  return h.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

/** The signature's three headers — Resend sends svix-*, the standard names are webhook-*. */
export function webhookHeaders(get: (name: string) => string | null) {
  return {
    id: get("webhook-id") ?? get("svix-id"),
    timestamp: get("webhook-timestamp") ?? get("svix-timestamp"),
    signature: get("webhook-signature") ?? get("svix-signature"),
  };
}

// ── What the reply says, without the letter it quotes ───────────────────────

/** Where a quoted earlier letter starts: our own marker, the mail apps' "On … wrote:", forwarded headers. */
const CUT_AT: RegExp[] = [
  /^##\s*reply above this line\s*##/i,
  /^-{2,}\s*original message\s*-{2,}/i,
  /^_{5,}\s*$/,
  /^on\s.{4,200}\swrote:\s*$/i, // Gmail, Apple Mail: "On Fri, Oct 17, 2026 at 9:14 AM JobFlex <…> wrote:"
  /^.{4,200}\s(пишет|написал|написала|написал\(а\)):\s*$/i, // the same, in Russian mail apps
  /^el\s.{4,200}\sescribió:\s*$/i,
  /^le\s.{4,200}\sa écrit\s*:\s*$/i,
  /^am\s.{4,200}\sschrieb\s.{0,80}:\s*$/i,
];

/** "Sent from my iPhone" and friends, at the very end. */
const SIGN_OFF = /^(sent from my \w+|get outlook for \w+|sent from (mail|yahoo mail|gmail) for \w+)/i;

/**
 * The new words of a reply: everything above the first line where a quoted
 * letter starts, with a trailing "> …" block and a phone's sign-off dropped.
 * A two-line Gmail header ("On Fri, … at 9:14 AM Name <" / "x@y> wrote:") is
 * joined before matching.
 */
export function trimQuoted(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const joined = i + 1 < lines.length ? `${line} ${lines[i + 1].trim()}` : line;
    if (line.includes(REPLY_ABOVE.replace(/#/g, "").trim()) || CUT_AT.some((re) => re.test(line))) {
      end = i;
      break;
    }
    // The signature: "-- " on a line of its own (RFC 3676), what follows is the sender's footer.
    if (i > 0 && (lines[i] === "-- " || line === "--")) {
      end = i;
      break;
    }
    // Outlook's header block: "From: …" with Sent/Date/To/Subject right under it.
    if (/^from:\s/i.test(line) && lines.slice(i + 1, i + 5).some((l) => /^(sent|date|to|subject):\s/i.test(l.trim()))) {
      end = i;
      break;
    }
    if (/^on\s/i.test(line) && !/wrote:\s*$/i.test(line) && /^on\s.{4,300}\swrote:\s*$/i.test(joined)) {
      end = i;
      break;
    }
  }
  const kept = lines.slice(0, end);
  // A quote some apps put at the bottom with no header, and empty lines under it.
  while (kept.length && (kept[kept.length - 1].trim() === "" || kept[kept.length - 1].trimStart().startsWith(">"))) kept.pop();
  while (kept.length && SIGN_OFF.test(kept[kept.length - 1].trim())) {
    kept.pop();
    while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** A plain-text reading of an HTML letter, for a reply that came without its text part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<blockquote[\s\S]*$/i, "") // the quoted letter, in most mail apps' HTML
    .replace(/<div[^>]*class="?gmail_quote[\s\S]*$/i, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** An out-of-office or other machine reply — never added to a conversation. */
export function isAutoReply(subject: string, headers: Record<string, string> | null | undefined): boolean {
  const h = Object.fromEntries(Object.entries(headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
  if (h["auto-submitted"] && h["auto-submitted"] !== "no") return true;
  if (h["x-autoreply"] || h["x-autorespond"] || h["x-auto-response-suppress"]?.includes("all")) return true;
  if (["bulk", "junk", "list", "auto_reply"].includes(h["precedence"] ?? "")) return true;
  return /^(automatic reply|auto(matic)?[- ]?reply|out of (the )?office|autoreply|undeliverable|delivery status notification)/i.test(subject.trim());
}
