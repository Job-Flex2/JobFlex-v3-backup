"use client";

// Route-segment error boundary. Without one, any error thrown while rendering
// a page or layout below the root blanks the whole screen with Next's default
// "Application error" text and no way back. This keeps the shell's ground and
// offers a retry; the message itself is never shown in production (it can
// carry internal detail), only a digest the operator can grep in the logs.

import { useEffect } from "react";
import { trackException } from "@/lib/traffic-client";
import { captureClientException } from "@/lib/sentryClient";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route-error]", error.digest ?? "", error);
    // $exception to PostHog: scrubbed message, digest, route, role, plan — see lib/traffic-client.
    trackException(error, "route");
    // And to Sentry with the stack, when NEXT_PUBLIC_SENTRY_DSN is set (lib/sentryClient; scrubbed by lib/sentryScrub).
    captureClientException(error, "route");
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "var(--paper, #f6f5f1)",
        color: "var(--ink, #111)",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
      }}
    >
      <section
        role="alert"
        style={{
          width: "min(100%, 420px)",
          border: "2px solid currentColor",
          padding: "24px",
          boxShadow: "4px 4px 0 currentColor",
          background: "#fff",
        }}
      >
        <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Something went wrong
        </p>
        <h1 style={{ margin: "8px 0 12px", fontSize: 22, lineHeight: 1.2 }}>
          This page hit an error.
        </h1>
        <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.5 }}>
          Nothing you entered was lost on the server. Try again, or head back to the dashboard.
          {error.digest ? (
            <>
              {" "}
              <span style={{ opacity: 0.6 }}>Reference {error.digest}</span>
            </>
          ) : null}
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: 44,
              padding: "0 18px",
              border: "2px solid currentColor",
              background: "#1854a0",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <a
            href="/dashboard"
            style={{
              minHeight: 44,
              display: "inline-flex",
              alignItems: "center",
              padding: "0 18px",
              border: "2px solid currentColor",
              textDecoration: "none",
              color: "inherit",
              fontWeight: 600,
            }}
          >
            Dashboard
          </a>
        </div>
      </section>
    </main>
  );
}
