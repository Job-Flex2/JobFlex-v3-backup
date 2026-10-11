"use client";

// "EMAIL ME A CODE" ON THE SIGN-IN PAGES (2026-10-10; lib/signupOtp, kind
// "login"). The address typed above, a six-digit code in an email, signed in —
// no password. The page answers the same for every address (the email says
// whether there is an account), so nothing here tells a stranger who has one.
// Mounted by the desktop login (/auth/login) and the handheld one.
import * as React from "react";
import { signIn } from "next-auth/react";
import { resendOtpCode, startOtpLogin, verifyOtpCode } from "@/actions/signupOtp";
import { rememberOtpDraft } from "@/lib/signupMode";
import s from "./email-code-signin.module.css";

const SERVER_TROUBLE = "Something went wrong on our side. Try again in a minute.";

export function EmailCodeSignIn({ email, nextPath }: { email: string; nextPath: string }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const [sentTo, setSentTo] = React.useState("");
  const [code, setCode] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [resendAt, setResendAt] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  const ref = React.useRef<HTMLInputElement>(null);
  const checking = React.useRef(false);

  React.useEffect(() => {
    if (!draft || resendAt <= Date.now()) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [draft, resendAt, now]);
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  async function ask() {
    const em = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setErr("Type your email above first.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await startOtpLogin({ email: em });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      rememberOtpDraft(res.draft);
      setDraft(res.draft);
      setSentTo(res.email);
      setResendAt(res.resendAt);
      setNow(Date.now());
      setNote(null);
      window.setTimeout(() => ref.current?.focus(), 60);
    } catch {
      setErr(SERVER_TROUBLE);
    } finally {
      setBusy(false);
    }
  }

  async function check(value: string) {
    if (!draft || checking.current || value.length !== 6) return;
    checking.current = true;
    setBusy(true);
    setErr(null);
    try {
      const res = await verifyOtpCode(draft, value);
      if (!res.ok) {
        setErr(res.error);
        setCode("");
        window.setTimeout(() => ref.current?.focus(), 30);
        return;
      }
      if (res.kind !== "signin") {
        setErr("That code isn't right.");
        return;
      }
      const auth = await signIn("signup-ticket", { ticket: res.ticket, redirect: false }).catch(() => null);
      if (!auth || auth.error) {
        setErr("Couldn't sign you in just now. Try again.");
        return;
      }
      // `?next=` wins; without one, the account's own place (the plan picker for a shop with no plan).
      window.location.assign(nextPath && nextPath !== "/dashboard" ? nextPath : res.next);
    } catch {
      setErr(SERVER_TROUBLE);
    } finally {
      checking.current = false;
      setBusy(false);
    }
  }

  function onChange(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (err && digits.length) setErr(null);
    if (digits.length === 6) void check(digits);
  }

  async function resend() {
    if (!draft || busy || resendIn > 0) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await resendOtpCode(draft);
      if (!res.ok) {
        if (res.resendAt) setResendAt(res.resendAt);
        setErr(res.error);
        return;
      }
      setResendAt(res.resendAt);
      setNow(Date.now());
      setCode("");
      setNote("A new code is on its way. The one before it no longer works.");
    } catch {
      setErr(SERVER_TROUBLE);
    } finally {
      setBusy(false);
    }
  }

  if (!draft) {
    return (
      <div className={s.box} data-email-code="ask">
        <button type="button" className={s.ask} id="emailCodeBtn" onClick={() => void ask()} disabled={busy}>
          {busy ? "Sending…" : "Email me a code"}
        </button>
        {err ? (
          <p className={s.note} data-err role="alert">
            {err}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={s.box} data-email-code="code">
      <form
        className={s.panel}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void check(code);
        }}
      >
        <p className={s.lead}>
          If <b>{sentTo}</b> has a JobFlex account, a 6-digit code is on its way. It works for 10 minutes.
        </p>
        <label>
          <span className={s.lbl}>6-digit code</span>
          <input
            ref={ref}
            className={s.code}
            id="loginCode"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="••••••"
            value={code}
            aria-invalid={err ? true : undefined}
            onChange={(e) => onChange(e.target.value)}
            onPaste={(e) => {
              const t = e.clipboardData.getData("text");
              if (!t) return;
              e.preventDefault();
              onChange(t);
            }}
          />
        </label>
        <p className={s.note} data-err={err ? "" : undefined} role={err ? "alert" : "status"} aria-live="polite">
          {err ?? note ?? "Pasting it works too."}
        </p>
        <button type="submit" className={s.go} disabled={busy || code.length !== 6}>
          {busy && code.length === 6 ? "Checking…" : "Sign in"}
        </button>
        <div className={s.row}>
          <button type="button" className={s.quiet} onClick={() => void resend()} disabled={busy || resendIn > 0}>
            {resendIn > 0 ? `Resend code in ${resendIn} s` : "Resend code"}
          </button>
          <button
            type="button"
            className={s.quiet}
            onClick={() => {
              setDraft(null);
              setCode("");
              setErr(null);
            }}
          >
            Use my password
          </button>
        </div>
      </form>
    </div>
  );
}
