"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { confirmCardlessTrial } from "@/actions/signupCheckout";
import styles from "@/components/v3/auth-register-blueprint/auth-register.module.css";

type View =
  | { kind: "working" }
  | { kind: "done"; email: string; signedIn: boolean }
  | { kind: "error"; text: string; done?: boolean; cardHref?: string };

export function ConfirmTrial() {
  const router = useRouter();
  const params = useSearchParams();
  const secret = params?.get("t") ?? "";
  const [view, setView] = React.useState<View>({ kind: "working" });
  // Once: the link is spent by its first use, and StrictMode runs effects twice.
  const ran = React.useRef(false);
  React.useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void confirmCardlessTrial(secret)
      .then(async (res) => {
        if (!res.ok) {
          // A link already used: to sign-in with the address filled in, not an error.
          if (res.done) {
            const q = new URLSearchParams({ next: "/dashboard", ...(res.email ? { email: res.email } : {}) });
            router.replace(`/auth/login?${q.toString()}` as Route);
            return;
          }
          setView({ kind: "error", text: res.error, done: res.done, cardHref: res.cardHref });
          return;
        }
        const auth = res.ticket ? await signIn("signup-ticket", { ticket: res.ticket, redirect: false }) : null;
        const signedIn = Boolean(auth && !auth.error);
        setView({ kind: "done", email: res.email, signedIn });
        if (signedIn) router.replace("/dashboard" as Route);
      })
      .catch(() => setView({ kind: "error", text: "Couldn't confirm the link. Try opening it again." }));
  }, [secret, router]);

  return (
    <div className={styles.bp} style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "24px 0", background: "var(--paper)" }}>
      <div className="pw-confirm" role="status" aria-live="polite" style={{ width: "min(560px, calc(100vw - 36px))", margin: 0 }}>
        {view.kind === "working" ? (
          <>
            <span className="pw-confirm-k">Confirming</span>
            <p className="pw-confirm-h">Creating your shop…</p>
            <p className="pw-confirm-p">Your free trial starts in a moment. No card needed.</p>
          </>
        ) : view.kind === "done" ? (
          <>
            <span className="pw-confirm-k">Email confirmed</span>
            <p className="pw-confirm-h">Your shop is live.</p>
            <p className="pw-confirm-p">
              {view.signedIn
                ? "Opening your dashboard…"
                : `Your free trial is on for ${view.email}. Sign in to open your dashboard.`}
            </p>
            <div className="pw-confirm-row">
              <Link className="btn pw-go" href={(view.signedIn ? "/dashboard" : "/auth/login?next=%2Fdashboard") as Route}>
                {view.signedIn ? "Open the dashboard" : "Sign in"}
              </Link>
            </div>
          </>
        ) : view.cardHref ? (
          /* The day's card-less trials are taken (lib/trialDailyCap): the same
             signup goes on at the plan step, where the trial takes a card. */
          <>
            <span className="pw-confirm-k">Email confirmed</span>
            <p className="pw-confirm-h">Add a card to start your trial.</p>
            <p className="pw-confirm-p">{view.text}</p>
            <div className="pw-confirm-row">
              <Link className="btn pw-go" href={view.cardHref as Route}>
                Continue with a card
              </Link>
            </div>
          </>
        ) : (
          <>
            <span className="pw-confirm-k" style={{ color: "var(--danger)" }}>
              {view.done ? "Already set up" : "Link not valid"}
            </span>
            <p className="pw-confirm-h">{view.done ? "This shop is already set up." : "That link didn't work."}</p>
            <p className="pw-confirm-p">{view.text}</p>
            <div className="pw-confirm-row">
              <Link className="btn pw-go" href={(view.done ? "/auth/login?next=%2Fdashboard" : "/auth/register") as Route}>
                {view.done ? "Sign in" : "Start again"}
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
