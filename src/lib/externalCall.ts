// The one contract for calling an external service.
//
// The audit of 2026-08-28 found twelve external calls in twelve states: one
// with no timeout at all (the legacy EagleView Reports API), most with a
// ceiling but no retry, four swallowing every failure into a bare null or [],
// and only two — Solar and Instant, the two that had already burned the owner —
// distinguishing "the service did not answer" from "the service answered:
// nothing here". Each incident got its own hand-rolled fix, which is how the
// three retry loops this file replaces came to exist (§K7: duplicated helper
// code duplicates its bugs).
//
// THE DISTINCTION THIS ENCODES, because every consumer needs it and almost none
// had it: a failure to ANSWER (timeout, dropped connection, 5xx, rate limit)
// justifies retrying now and telling the user to try again later; an ANSWER of
// "no data" (404, no coverage) makes both of those wrong — retrying wastes
// spend and telling the user to retry wastes their time. Conflating the two is
// exactly how a network hiccup got captioned "no usable aerial elevation data
// for this address" on a house that measured 16 facets the day before.
//
// RETRY POLICY, solarFetch's rules: 429 and 5xx and aborts are asked again with
// doubling backoff; any other 4xx is an answer and is not. Services override
// where their semantics differ — ReportAll's 429 means an ALLTIME quota is
// exhausted, so asking again is not merely useless but wrong, and a call that
// PLACES A BILLED ORDER sets attempts to 1 because a timeout does not say
// whether the order landed.

/**
 * Why the call failed, in the two-way split that matters plus the two flavours
 * of "answered no" that need different handling:
 *
 *   unreachable  the service did not answer: timeout, network, 5xx, 429 after
 *                retries. Trying again later is reasonable.
 *   no-data      the service answered that it has nothing here: 404, or a
 *                status the service's policy lists as meaning that. Retrying
 *                changes nothing; the user should not be told to try again.
 *   auth         401/403 — our credentials or entitlement. Ours to fix.
 *   refused      any other 4xx: the request was understood and turned down.
 */
export type ExternalFailureKind = "unreachable" | "no-data" | "auth" | "refused";

export class ExternalCallError extends Error {
  constructor(
    message: string,
    readonly service: string,
    readonly op: string,
    readonly kind: ExternalFailureKind,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "ExternalCallError";
  }
}

/** Success-or-failure without throwing, for callers that record rather than abort. */
export type ExternalResult<T> = { ok: true; value: T } | { ok: false; failure: ExternalCallError };

export interface CallPolicy {
  /** One attempt's ceiling, milliseconds. Required — the audit's root finding. */
  timeoutMs: number;
  /** Total attempts. Default 3; a call that spends money sets 1. */
  attempts?: number;
  /** First pause before a retry; doubles each time. Default 1000. */
  backoffMs?: number;
  /** Which statuses are worth a second ask. Default: 429 or 5xx. */
  retryOn?: (status: number) => boolean;
  /** Statuses that mean "answered: no data here". Default: [404]. */
  noDataOn?: readonly number[];
  /** Non-2xx statuses to hand back as success (e.g. 202 "not ready yet"). */
  acceptStatuses?: readonly number[];
  /**
   * Called with EVERY response received, success or failure, before any
   * classification. Exists for ReportAll, whose quota headers arrive on every
   * response including a 429 — bookkeeping that must not depend on the call
   * having gone well.
   */
  onResponse?: (res: Response) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const defaultRetryOn = (status: number): boolean => status === 429 || status >= 500;

const kindFor = (status: number, noDataOn: readonly number[]): ExternalFailureKind =>
  noDataOn.includes(status) ? "no-data" : status === 401 || status === 403 ? "auth" : "refused";

/**
 * One external request under the contract: a ceiling on every attempt, retries
 * for the failures a retry can answer, and every throw an ExternalCallError
 * whose `kind` already carries the answered/unanswered distinction. The body
 * text of a failed response is folded into the message (up to 160 chars),
 * because Google's and EagleView's bodies name the actual problem and every
 * hand-rolled predecessor of this function had grown its own body-reading code.
 */
export async function externalFetch(
  service: string,
  op: string,
  url: string,
  init: RequestInit,
  policy: CallPolicy,
): Promise<Response> {
  const attempts = policy.attempts ?? 3;
  const backoffMs = policy.backoffMs ?? 1_000;
  const retryOn = policy.retryOn ?? defaultRetryOn;
  const noDataOn = policy.noDataOn ?? [404];
  const accept = policy.acceptStatuses ?? [];

  // Observe existing traffic only. Legacy EagleView OAuth/catalog cannot stand
  // in for Property Data. Persist no URL, operation text, response body or customer data.
  const observe = async (status: number) => {
    if (service === "eagleview" && !["property request", "property result", "property image"].includes(op)) return;
    try { const { recordIntegrationOutcome } = await import("@/lib/integrationTelemetry"); await recordIntegrationOutcome(service, status); } catch { /* Best effort. */ }
  };
  let last: ExternalCallError | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(policy.timeoutMs) });
      policy.onResponse?.(res);
      await observe(res.status);
      if (res.ok || accept.includes(res.status)) {
        meterPaidCall(service, op);
        return res;
      }
      const detail = (await res.text().catch(() => "")).slice(0, 160);
      const err = new ExternalCallError(
        `${service} ${op} failed (${res.status})${detail ? `: ${detail}` : ""}`,
        service,
        op,
        retryOn(res.status) ? "unreachable" : kindFor(res.status, noDataOn),
        res.status,
      );
      if (!retryOn(res.status)) throw err;
      last = err;
    } catch (err) {
      if (!(err instanceof ExternalCallError)) await observe(0);
      // A definitive answer classified above must escape, not be retried past.
      if (err instanceof ExternalCallError && err.kind !== "unreachable") throw err;
      last =
        err instanceof ExternalCallError
          ? err
          : new ExternalCallError(
              `${service} did not answer in ${policy.timeoutMs / 1000}s (${op})`,
              service,
              op,
              "unreachable",
            );
    }
    if (attempt < attempts) {
      console.warn(`[${service}] ${op} attempt ${attempt}/${attempts} failed (${last?.message}) — retrying`);
      await sleep(backoffMs << (attempt - 1));
    }
  }
  throw last ?? new ExternalCallError(`${service} ${op} failed`, service, op, "unreachable");
}

/* THE SPEND (2026-10-02). The services billed per answered request are
   recorded against the organization of the request (lib/trialMeter, which
   prices them from lib/paidApiCosts). EagleView and ReportAll are recorded
   where they are called — what they bill by (a pack, a parcel returned) is
   known only there. Loaded lazily: this module is imported by scripts and
   checks that never meet a request. */
const METERED: Record<string, { service: "google-solar" | "google-geocoding" | "regrid"; op?: string }> = {
  solar: { service: "google-solar" },
  maps: { service: "google-geocoding" },
  regrid: { service: "regrid", op: "parcel" },
};

function meterPaidCall(service: string, op: string): void {
  const m = METERED[service];
  if (!m) return;
  void import("@/lib/trialMeter").then((t) => t.notePaidCall(m.service, m.op ?? op)).catch(() => {});
}

/** Run any promise into the non-throwing result shape. */
export async function asExternalResult<T>(service: string, op: string, p: Promise<T>): Promise<ExternalResult<T>> {
  try {
    return { ok: true, value: await p };
  } catch (err) {
    return {
      ok: false,
      failure:
        err instanceof ExternalCallError
          ? err
          : new ExternalCallError(err instanceof Error ? err.message : String(err), service, op, "unreachable"),
    };
  }
}
