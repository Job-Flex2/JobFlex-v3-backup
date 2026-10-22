// Sentry on the edge runtime (2026-10-22; docs/sentry.md) — the same rules as
// src/sentry.server.config: loaded by src/instrumentation.ts register() only
// when a DSN is set, PII cut by lib/sentryScrub, traces 5% on production.
import * as Sentry from "@sentry/nextjs";
import { SENTRY_DATA_COLLECTION, scrubBreadcrumb, scrubEvent, scrubSpan, sentryEnvironment, sentryTracesSampleRate } from "@/lib/sentryScrub";

const vercelEnv = process.env.VERCEL_ENV;

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: sentryEnvironment(vercelEnv),
  dataCollection: SENTRY_DATA_COLLECTION,
  tracesSampleRate: sentryTracesSampleRate(vercelEnv),
  initialScope: { tags: { vercel_env: sentryEnvironment(vercelEnv) } },
  beforeSend: scrubEvent,
  beforeSendSpan: scrubSpan,
  beforeBreadcrumb: scrubBreadcrumb,
});
