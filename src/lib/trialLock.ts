// THE WRITE LOCK AFTER A CARD-LESS TRIAL (owner, 2026-10-01): "the dashboard
// reads, writing is blocked" until a card is added (lib/trialState).
//
// HOW IT IS ENFORCED WITHOUT TOUCHING 450 SERVER ACTIONS. Writes in this app
// go through server actions, and every one of them resolves its organization
// with requireOrg (lib/orgContext). requireOrg notes, for the request it runs
// in, that the organization is locked — only when the request IS a server
// action (the `next-action` header). The database client (lib/db) then
// refuses every create / update / delete in a noted request, except on the
// housekeeping models below. Reads are never touched, so a server action
// that only loads data keeps working, and page renders (GET) are never noted
// at all.
//
// The note is keyed by the request's own headers object — the same object
// for every `headers()` call within one request — so it lives exactly as long
// as the request. Outside a request (crons, webhooks, scripts) `headers()`
// throws and nothing is ever locked. No database import here: lib/db imports
// this module.

/** What the owner reads when a write is refused. */
export const TRIAL_ENDED_MESSAGE = "Your free trial has ended. Add a card to keep working — everything you made is still here.";

/**
 * The error a locked write throws. It carries OUR TEXT for every action that
 * catches and returns the message (most do). For the ones that let it
 * propagate, a production build would replace the message with React's
 * generic "An error occurred in the Server Components render…" — so the error
 * also carries Next's redirect digest: Next treats it as `redirect()` and the
 * browser lands on /dashboard/trial?locked=1, which says what happened and
 * offers the card. Same in dev and in a production build.
 */
export class TrialEndedError extends Error {
  readonly digest = "NEXT_REDIRECT;push;/dashboard/trial?locked=1;303;";
  constructor() {
    super(TRIAL_ENDED_MESSAGE);
    this.name = "TrialEndedError";
  }
}

// ON globalThis, like the database client itself (lib/db keeps one Prisma
// client on globalThis across hot reloads and route bundles): the client's
// write guard and requireOrg's note must share ONE map, and a map held in
// module state is not shared when the two reach this module through
// different copies of it — the note was then written in one copy and the
// guard read another, and nothing was ever refused (found 2026-10-14).
const LOCK_MAP = "__jobflexTrialLockNoted";
const noted: WeakMap<object, string> = ((globalThis as unknown as Record<string, unknown>)[LOCK_MAP] as WeakMap<object, string> | undefined) ?? new WeakMap<object, string>();
(globalThis as unknown as Record<string, unknown>)[LOCK_MAP] = noted;

async function requestHeaders(): Promise<Headers | null> {
  try {
    const { headers } = await import("next/headers");
    return (await headers()) as unknown as Headers;
  } catch {
    return null;
  }
}

/** True when the current request is a server action. */
export async function isServerActionRequest(): Promise<boolean> {
  const h = await requestHeaders();
  return Boolean(h?.get("next-action"));
}

/** Called by requireOrg: lock this server-action request to reads. */
export async function noteTrialLock(orgId: string): Promise<void> {
  const h = await requestHeaders();
  if (h) noted.set(h, orgId);
}

/** Models a locked request may still write: sessions and sign-in, the app's
 *  own counters and caches, analytics, billing sync, and support. */
const WRITABLE_WHEN_LOCKED = new Set([
  "Account",
  "Session",
  "VerificationToken",
  "User",
  "NavSeen",
  "SyncState",
  "WebhookEvent",
  "PageView",
  "ActivityEvent",
  "ProductPriceCache",
  "ParcelCache",
  "ParcelMiss",
  "SolarCache",
  "Subscription",
  "SupportTicket",
  "SupportMessage",
]);

const WRITE_OPERATIONS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);

/** Called by the database client before every model operation. */
export async function assertWriteAllowed(model: string | undefined, operation: string): Promise<void> {
  if (!model || !WRITE_OPERATIONS.has(operation) || WRITABLE_WHEN_LOCKED.has(model)) return;
  const h = await requestHeaders();
  if (h && noted.has(h)) throw new TrialEndedError();
}
