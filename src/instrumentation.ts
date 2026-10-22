// Next's server error hook — the net under lib/server-events' wrapper. Every
// error the framework catches (a server action that threw, a route handler, a
// server component render) lands here once; an error the wrapper has already
// logged is recognised and skipped. Sends `server_error` with the route FILE
// path ("/dashboard/proposals/[id]", never the URL), the kind, a code and the
// organization — no message, no query string, no body.
//
// SENTRY (2026-10-22; docs/sentry.md): with SENTRY_DSN set, register() starts
// the SDK for the runtime (src/sentry.server.config, src/sentry.edge.config)
// and every error here also goes to Sentry with its stack — tagged with the
// route file path, the organization and VERCEL_ENV, and cut by
// lib/sentryScrub (no body, query string, cookies, emails or phones). Without
// a DSN the SDK is never loaded and only the PostHog event goes.

import type { Instrumentation } from "next";
import { getToken } from "next-auth/jwt";
import { reportServerError, type ServerErrorKind } from "@/lib/server-events";

const sentryDsn = () => process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

export async function register() {
  if (!sentryDsn()) return;
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
}

/** The active organization off the session cookie. Best effort: null on any doubt. */
async function organizationOf(headers: Record<string, string | string[] | undefined>): Promise<string | null> {
  try {
    const raw = headers.cookie;
    const cookie = Array.isArray(raw) ? raw.join("; ") : raw ?? "";
    if (!cookie.includes("authjs.session-token")) return null;
    // Same cookie-name rule as the middleware.
    const secureCookie = cookie.includes("__Secure-authjs.session-token");
    const cookieName = secureCookie ? "__Secure-authjs.session-token" : "authjs.session-token";
    const token = await getToken({
      req: { headers: new Headers({ cookie }) },
      secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
      salt: cookieName, secureCookie, cookieName,
    });
    return typeof token?.activeOrgId === "string" ? token.activeOrgId : null;
  } catch { return null; }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const posthog = !!process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const sentry = !!sentryDsn();
  if (!posthog && !sentry) return;
  const organizationId = await organizationOf(request.headers);
  if (sentry) {
    try {
      const Sentry = await import("@sentry/nextjs");
      Sentry.withScope((scope) => {
        scope.setTag("route", context.routePath || "unknown");
        scope.setTag("route_type", context.routeType);
        if (organizationId) scope.setTag("organizationId", organizationId);
        Sentry.captureRequestError(error, request, context);
      });
    } catch { /* reporting never adds a second failure */ }
  }
  if (!posthog) return;
  const kind: ServerErrorKind = context.routeType === "render" ? "render"
    : context.routeType === "action" ? "action"
    : context.routeType === "route" ? (context.routePath.startsWith("/api/webhooks") ? "webhook" : "route") : "proxy";
  await reportServerError(context.routePath || "unknown", error, { kind, organizationId });
};
