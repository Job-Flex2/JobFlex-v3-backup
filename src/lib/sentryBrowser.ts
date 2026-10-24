// The browser's Sentry, by name (2026-10-23). lib/sentryClient imports this module lazily. The calls are named, so the
// bundler leaves out everything else in @sentry/nextjs. A namespace import also brought in session replay and the
// feedback widget, which we do not use — 179 KB gzip of SDK fetched as the page started.
export { captureException, captureRouterTransitionStart, init, withScope } from "@sentry/nextjs";
