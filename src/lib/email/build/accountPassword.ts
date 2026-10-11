// "A password was added / changed" (2026-10-10, actions/accountPassword): the
// account's own address hears of it, with a way back if it was not them.
// Pure, no I/O — the platform's lockup, one short paragraph, no button.
import type { EmailDoc, Lockup } from "../doc";

const PLATFORM_LOCKUP: Lockup = { kind: "platform" };

export function buildPasswordSet(i: { name: string | null; email: string; added: boolean; at: Date; forgotHref: string }): EmailDoc {
  const first = i.name?.trim().split(/\s+/)[0] || "there";
  const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" }).format(i.at);
  return {
    subject: i.added ? "A password was added to your JobFlex account" : "Your JobFlex password was changed",
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Account security" },
    headline: i.added ? "A password was added" : "Your password was changed",
    prose: [
      i.added
        ? `Hi ${first} — a password was added to ${i.email} in your account settings. You can now sign in with it, as well as with a code from email or with Google.`
        : `Hi ${first} — the password for ${i.email} was changed in your account settings. Signing in with a code from email or with Google works as before.`,
    ],
    box: [{ type: "field", label: "When", value: `${when} PT` }],
    link: { label: "Wasn't you? Reset the password", href: i.forgotHref },
    after: ["Questions? Reply to this email and we'll help."],
    footer: { name: "JobFlex" },
  };
}
