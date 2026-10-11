"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { confirmOtpLink } from "@/actions/signupOtp";
import styles from "@/components/v3/auth-register-blueprint/auth-register.module.css";

type View = { kind: "working" } | { kind: "error"; text: string };

export function ContinueWithCode() {
  const params = useSearchParams();
  const secret = params?.get("k") ?? "";
  const [view, setView] = React.useState<View>({ kind: "working" });
  // Once: the button is spent by its first use, and StrictMode runs effects twice.
  const ran = React.useRef(false);
  React.useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void confirmOtpLink(secret)
      .then(async (res) => {
        if (!res.ok) {
          setView({ kind: "error", text: res.error });
          return;
        }
        if (res.kind === "signup") {
          // The plan step of this sign-up, with its trade and campaign; the
          // passwordless mode rides along for this browser.
          const q = new URLSearchParams(res.query ?? "");
          q.set("signup", res.signupToken);
          q.set("flow", "otp");
          window.location.replace(`/auth/register?${q.toString()}`);
          return;
        }
        const auth = await signIn("signup-ticket", { ticket: res.ticket, redirect: false }).catch(() => null);
        window.location.replace(auth && !auth.error ? res.next : `/auth/login?next=${encodeURIComponent(res.next)}&email=${encodeURIComponent(res.email)}`);
      })
      .catch(() => setView({ kind: "error", text: "Couldn't open the link. Try it again, or type the code instead." }));
  }, [secret]);

  return (
    <div className={styles.bp} style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "24px 0", background: "var(--paper)" }}>
      <div className="pw-confirm" role="status" aria-live="polite" style={{ width: "min(560px, calc(100vw - 36px))", margin: 0 }}>
        {view.kind === "working" ? (
          <>
            <span className="pw-confirm-k">Email confirmed</span>
            <p className="pw-confirm-h">One moment…</p>
            <p className="pw-confirm-p">Taking you to the next step.</p>
          </>
        ) : (
          <>
            <span className="pw-confirm-k" style={{ color: "var(--danger)" }}>
              Link not valid
            </span>
            <p className="pw-confirm-h">That link didn&apos;t work.</p>
            <p className="pw-confirm-p">{view.text}</p>
            <div className="pw-confirm-row">
              <Link className="btn pw-go" href={"/auth/register?flow=otp" as Route}>
                Start again
              </Link>
              <Link className="pw-confirm-back" href={"/auth/login" as Route}>
                Sign in
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
