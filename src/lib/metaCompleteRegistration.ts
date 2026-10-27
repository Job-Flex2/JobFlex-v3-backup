// META CompleteRegistration (owner, 2026-10-23: "send sign-ups to Meta again"). Since the pixel was replaced on
// 2026-10-17 Meta heard Lead (the email step) and, from 2026-10-22, StartTrial (a card on Stripe) — never a finished
// sign-up, so a campaign had no sign-up to learn from. Since 2026-10-26 (owner: "leads = signups") Lead goes with this
// event, from the dashboard layout, instead of at the email step. This is the server half: whether the event is due. The browser
// half (components/dashboard/MetaPixelOnce) sends it once per company, on the first dashboard after the company step,
// the same way StartTrial goes (lib/metaStartTrial). No Conversions API copy.
//
// DUE only on the live site (VERCEL_ENV=production, where layout.tsx loads the pixel), for a company made within the
// hour (so a deploy never fires it for the companies already here) that is not one of ours (isInternal).

const FRESH_MS = 60 * 60 * 1000;

export type MetaCompleteRegistrationEvent = {
  /** The once-per-company key the browser remembers. */
  organizationId: string;
};

export function metaCompleteRegistrationEvent(
  org: { id: string; createdAt: Date; isInternal: boolean },
  now = new Date(),
): MetaCompleteRegistrationEvent | null {
  if (process.env.VERCEL_ENV !== "production") return null;
  if (org.isInternal) return null;
  const age = now.getTime() - org.createdAt.getTime();
  if (age < 0 || age > FRESH_MS) return null;
  return { organizationId: org.id };
}
