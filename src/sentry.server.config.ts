// Sentry on the Node.js server (2026-10-22; docs/sentry.md). Loaded by
// src/instrumentation.ts register() only when SENTRY_DSN (or
// NEXT_PUBLIC_SENTRY_DSN) is set — without one nothing here runs and nothing
// is sent. Errors only reach Sentry through onRequestError
// (captureRequestError) and the SDK's own capture; what they carry is cut by
// lib/sentryScrub. No replay; traces 5% on production, none on preview.
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
