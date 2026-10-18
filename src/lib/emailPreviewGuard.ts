// EMAIL FROM A PREVIEW DEPLOYMENT (owner, 2026-10-18) — pure.
//
// Preview deployments carry the same SMTP credentials as production (the
// platform's Gmail box), and a preview is a copy of the app pointed at real
// data: without a guard, testing a branch could email a real customer. On
// VERCEL_ENV=preview a letter goes only to the addresses PREVIEW_EMAIL_ALLOW
// lists (comma-separated; "name@x.com" for one address, "@x.com" for a whole
// domain); default: anyone at jobflex.app. Everyone else on the letter is
// dropped, and a letter left with nobody is only logged. Production, local and
// every other environment send as before.

export const DEFAULT_PREVIEW_ALLOW = ["@jobflex.app"];

export function previewAllowList(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.PREVIEW_EMAIL_ALLOW?.trim();
  const list = raw ? raw.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) : DEFAULT_PREVIEW_ALLOW;
  return list.length ? list : DEFAULT_PREVIEW_ALLOW;
}

const addressOf = (r: string) => (r.match(/<([^>]+)>/)?.[1] ?? r).trim().toLowerCase();

export function allowedOnPreview(recipient: string, allow: string[]): boolean {
  const a = addressOf(recipient);
  return allow.some((rule) => (rule.startsWith("@") ? a.endsWith(rule) : a === rule));
}

/** On a preview: the recipients that may get the letter (possibly none). Elsewhere: null — no filtering. */
export function previewRecipients(to: string[], env: Record<string, string | undefined> = process.env): string[] | null {
  if (env.VERCEL_ENV !== "preview") return null;
  const allow = previewAllowList(env);
  return to.filter((r) => allowedOnPreview(r, allow));
}
