// THE ANSWER TO A SUPPORT TICKET (owner, 2026-10-14: "in admin support, make
// it respond to the client from admin right away") — pure. What a reply must
// be, the letter it becomes, and the status a reply moves a ticket to. The
// thread it is kept in and the send are lib/supportReplies and actions/admin.

export const REPLY_LIMITS = { min: 2, body: 4000 } as const;

/** One answer in a ticket's thread. */
export interface SupportReply {
  id: string;
  at: string;
  /** The admin who wrote it, as signed. */
  by: string;
  /** Where it went. */
  to: string;
  body: string;
}

/** The reply as typed, tidied — or why it cannot go. */
export function checkReply(raw: unknown): { ok: true; body: string } | { ok: false; error: string } {
  const body = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : "";
  if (body.length < REPLY_LIMITS.min) return { ok: false, error: "Write the answer first." };
  if (body.length > REPLY_LIMITS.body) return { ok: false, error: `Keep it under ${REPLY_LIMITS.body.toLocaleString("en-US")} characters.` };
  return { ok: true, body };
}

/** "Re: Bad sizing [JobFlex J7RCFS]" — the ref keeps a reply findable. */
export function replySubject(ticket: { subject: string; ref: string }): string {
  const subject = ticket.subject.replace(/\s+/g, " ").trim().slice(0, 120) || "Your message";
  return `Re: ${subject} [JobFlex ${ticket.ref}]`;
}

/** An answered ticket is being handled: Open becomes In progress; a resolved or closed one stays where it is. */
export function statusAfterReply(status: string): string {
  return status === "OPEN" ? "IN_PROGRESS" : status;
}

/** Paragraphs: blank lines split them; a single line break stays inside one. */
export function paragraphsOf(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const br = (t: string) => esc(t).replace(/\n/g, "<br>");
const QUOTE_MAX = 1500;

export interface ReplyLetter {
  subject: string;
  html: string;
  text: string;
}

/**
 * The email the client gets: a plain letter — the answer's paragraphs, the
 * admin's name over "JobFlex support", one line saying a reply reaches us and
 * where the ticket lives — and the ticket's own words quoted under it, so the
 * answer makes sense on its own. No images, no tracking.
 */
export function replyLetter(input: { body: string; sender: string; ticket: { subject: string; body: string; ref: string; filedAt: string }; base: string }): ReplyLetter {
  const base = input.base.replace(/\/$/, "");
  const paras = paragraphsOf(input.body);
  // The team signs as itself on one line; a person signs over the team.
  const sender = input.sender.trim();
  const team = !sender || /jobflex/i.test(sender);
  const signName = team ? "JobFlex support" : sender;
  const signLine = team ? "jobflex.app" : "JobFlex support · jobflex.app";
  const filed = new Date(input.ticket.filedAt);
  // UTC, as the console shows the filing time — the same words wherever the server runs.
  const when = Number.isNaN(filed.getTime()) ? "" : filed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const original = input.ticket.body.trim();
  const quoted = original.length > QUOTE_MAX ? `${original.slice(0, QUOTE_MAX).trimEnd()}…` : original;
  const link = `${base}/dashboard/support`;
  const P = "style=\"margin:0 0 16px;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;\"";
  const html = [
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(replySubject(input.ticket))}</title></head>`,
    '<body style="margin:0;padding:0;background:#ffffff;">',
    '<div style="max-width:560px;margin:0 auto;padding:28px 20px;">',
    ...paras.map((x) => `<p ${P}>${br(x)}</p>`),
    `<p style="margin:24px 0 0;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">${esc(signName)}<br><span style="color:#6a6a6a;">${esc(signLine)}</span></p>`,
    `<p style="margin:20px 0 0;font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#6a6a6a;">Reply to this email and it reaches us. Your ticket ${esc(input.ticket.ref)} is at <a href="${esc(link)}" style="color:#1854a0;">${esc(link)}</a>.</p>`,
    `<div style="margin:28px 0 0;padding:12px 0 0 14px;border-left:3px solid #e5e5e5;font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#8a8a8a;">${when ? `On ${esc(when)} you wrote:` : "You wrote:"}<br>${br(quoted)}</div>`,
    "</div></body></html>",
  ].join("\n");
  const text = [
    ...paras,
    `${signName}\n${signLine}`,
    `Reply to this email and it reaches us. Your ticket ${input.ticket.ref} is at ${link}`,
    `--\n${when ? `On ${when} you wrote:` : "You wrote:"}\n${quoted.split("\n").map((l) => `> ${l}`).join("\n")}`,
  ].join("\n\n");
  return { subject: replySubject(input.ticket), html, text };
}
