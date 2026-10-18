// SUPPORT MAIL · WHERE AND WHETHER (owner, 2026-10-18: we stay on Gmail) — pure.
//
// Replies to support letters come back by email into the platform mailbox
// (the one the app already SENDS from: SMTP_USER on smtp.gmail.com) and are
// read over IMAP by /api/cron/support-mail. Each letter's Reply-To is the
// mailbox's own plus-address, app+t-<ticket>-<signature>@jobflex.app
// (lib/supportInbound plusReplyAddress); Gmail delivers it to the box itself,
// so a reply the cron never reads is still an unread letter a person sees.
//
// ONLY PRODUCTION touches the real mailbox. A preview deployment or a laptop
// shares the same SMTP credentials, and a cron there would mark the owner's
// mail read and file it — so off them the whole thing is OFF (letters keep
// Reply-To support@jobflex.app, the cron returns at once) unless
// SUPPORT_MAIL_LOCAL=1 is set for a test. SUPPORT_MAIL_OFF=1 turns it off
// anywhere, production included.
//
// The address is signed with SUPPORT_REPLY_SECRET, else the app's AUTH_SECRET
// (NEXTAUTH_SECRET): the HMAC is labelled "support-reply:", so it can't stand
// in for anything else. IMAP_HOST / IMAP_USER / IMAP_PASSWORD override the
// defaults (imap.gmail.com, SMTP_USER, SMTP_PASSWORD — a Gmail app password
// works for IMAP too).

export interface SupportMailConfig {
  host: string;
  port: number;
  /** The mailbox: logs in, receives the plus-addresses, and is "us" as a sender. */
  user: string;
  pass: string;
  /** Signs the ticket's plus-address. */
  secret: string;
}

type Env = Record<string, string | undefined>;

/** Production, or a deliberate local test. Never a preview. */
export function mailEnvironmentAllowed(env: Env = process.env): boolean {
  if (env.SUPPORT_MAIL_OFF === "1") return false;
  return env.VERCEL_ENV === "production" || env.SUPPORT_MAIL_LOCAL === "1";
}

/** What the cron and the Reply-To need — null (and why) when any of it is missing. */
export function supportMailConfig(env: Env = process.env): { ok: true; config: SupportMailConfig } | { ok: false; why: string } {
  if (!mailEnvironmentAllowed(env)) {
    return { ok: false, why: env.SUPPORT_MAIL_OFF === "1" ? "switched off (SUPPORT_MAIL_OFF=1)" : `not production (VERCEL_ENV=${env.VERCEL_ENV ?? "unset"})` };
  }
  const user = (env.IMAP_USER || env.SMTP_USER || "").trim();
  const pass = (env.IMAP_PASSWORD || env.SMTP_PASSWORD || "").trim();
  const secret = (env.SUPPORT_REPLY_SECRET || env.AUTH_SECRET || env.NEXTAUTH_SECRET || "").trim();
  if (!user || !user.includes("@")) return { ok: false, why: "no mailbox (IMAP_USER / SMTP_USER)" };
  if (!pass) return { ok: false, why: "no mailbox password (IMAP_PASSWORD / SMTP_PASSWORD)" };
  if (!secret) return { ok: false, why: "no signing secret (SUPPORT_REPLY_SECRET / AUTH_SECRET)" };
  return {
    ok: true,
    config: { host: (env.IMAP_HOST || "imap.gmail.com").trim(), port: Number(env.IMAP_PORT || 993), user: user.toLowerCase(), pass, secret },
  };
}
