// Sentry in the browser (2026-10-22; docs/sentry.md). The SDK is loaded only
// when NEXT_PUBLIC_SENTRY_DSN was set at build time — without it this file is
// a few no-ops and the SDK never reaches the page. Started once by
// src/instrumentation-client.ts; the error boundaries (app/error.tsx,
// app/global-error.tsx) wait for the same start before capturing, so an error
// thrown during the first render is not lost to a race. No replay; traces 5%
// on production; what leaves is cut by lib/sentryScrub.
import type * as SentryApi from "@sentry/nextjs";
import { SENTRY_DATA_COLLECTION, scrubBreadcrumb, scrubEvent, scrubSpan, sentryEnvironment, sentryTracesSampleRate, stripQuery } from "@/lib/sentryScrub";

let started: Promise<typeof SentryApi | null> | null = null;

/** The started SDK, or null without a DSN (or if it failed to load). */
export function startSentry(): Promise<typeof SentryApi | null> {
  if (started) return started;
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return (started = Promise.resolve(null));
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;
  started = import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.init({
        dsn,
        environment: sentryEnvironment(vercelEnv),
        dataCollection: SENTRY_DATA_COLLECTION,
        tracesSampleRate: sentryTracesSampleRate(vercelEnv),
        initialScope: { tags: { vercel_env: sentryEnvironment(vercelEnv) } },
        beforeSend: scrubEvent,
        beforeSendSpan: scrubSpan,
        beforeBreadcrumb: scrubBreadcrumb,
      });
      return Sentry;
    })
    .catch(() => null);
  return started;
}

/** An error an error boundary caught, with the boundary and the page's path. */
export function captureClientException(error: unknown, boundary: "route" | "global"): void {
  void startSentry().then((Sentry) => {
    Sentry?.withScope((scope) => {
      scope.setTag("boundary", boundary);
      scope.setTag("route", stripQuery(window.location.pathname));
      Sentry.captureException(error);
    });
  });
}
