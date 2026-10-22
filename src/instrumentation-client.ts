// Next's browser instrumentation hook — runs before the app hydrates. Starts
// Sentry when NEXT_PUBLIC_SENTRY_DSN is set (lib/sentryClient; docs/sentry.md)
// and hands it the App Router's navigations for the 5% of production traces.
// Without a DSN both are no-ops.
import { startSentry } from "@/lib/sentryClient";

let sentry: Awaited<ReturnType<typeof startSentry>> = null;
void startSentry().then((s) => {
  sentry = s;
});

export function onRouterTransitionStart(href: string, navigationType: string): void {
  sentry?.captureRouterTransitionStart(href, navigationType);
}
