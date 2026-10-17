// A server action's refusal, as a VALUE.
//
// Next.js redacts a thrown Server Action message in production (the client
// gets its own fault paragraph and a digest), so "Promo code X is already in
// use", "Enter 100 or less", "This link is invalid or has expired" only ever
// reached an admin or a partner on the dev server. Every refusal a person is
// meant to read comes back in this envelope instead; what is still THROWN is
// what nobody should read — an auth failure, a database that is down.
//
// The same shape actions/influencers.requestPayout and the payout decisions
// already answer with; this names it once.

// Type-only: the save bars import `isRefusal` from here on the client, and a
// runtime import would ship zod in their bundles for one instanceof.
import type { ZodError } from "zod";

const isZodError = (err: unknown): err is ZodError =>
  err instanceof Error && err.name === "ZodError" && Array.isArray((err as ZodError).issues);

/** `field` names the input a form refusal belongs to, so the page can print it
 *  under that field; without it the page prints `error` above the form. */
export type Refusal = { ok: false; error: string; field?: string };

export type ActionResult<T = Record<never, never>> = ({ ok: true } & T) | Refusal;

export const refused = (error: string, field?: string): Refusal => (field ? { ok: false, error, field } : { ok: false, error });

/** A value an action answered with is a refusal — the client-side test the
 *  shared save bars use, so a refused save never reads as "Saved". */
export function isRefusal(value: unknown): value is Refusal {
  return typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === false && typeof (value as { error?: unknown }).error === "string";
}

/** A refusal's words for the slot under its own field: the label is already
 *  printed above the input, so "Email: enter a valid address." reads
 *  "Enter a valid address." there. */
export function underField(r: Refusal): string {
  const at = r.field ? r.error.indexOf(": ") : -1;
  const rest = at >= 0 ? r.error.slice(at + 2) : r.error;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/**
 * A refusal from something that threw: a ZodError's first issue as
 * "field: message" (what the sheets show today), any other Error's message.
 * `labels` swaps the schema key for the words the form prints ("phone" →
 * "Phone"), so a schema's messages are written as the half after the colon.
 * Auth and infrastructure errors are re-thrown — they are not for the reader.
 */
export function refusal(err: unknown, labels?: Record<string, string>): Refusal {
  if (isZodError(err)) {
    const first = err.issues[0];
    const field = first?.path?.[0];
    if (field === undefined) return refused(first?.message ?? "Check the form.");
    const key = String(field);
    return refused(`${labels?.[key] ?? key}: ${first.message}`, key);
  }
  if (err instanceof Error && err.name !== "UnauthorizedError" && err.name !== "NoOrgError" && !/prisma|database|ECONN/i.test(err.message)) {
    return refused(err.message);
  }
  throw err;
}
