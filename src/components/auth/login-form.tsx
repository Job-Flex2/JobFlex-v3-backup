"use client";

// THE SIGN-IN FORM (owner, 2026-10-10): the passwordless sign-up's order —
// Continue with Google, "or continue with email", the email, "Email me a
// code". The password is one link away ("Use password instead": the field,
// Sign in, Forgot password; back with "Use a code instead"), and it opens on
// the password at once when the browser or a password manager fills a saved
// one. Mounted by the desktop sign-in page (/auth/login) and the handheld one;
// the worker, partner and admin sign-ins are other pages.
//
// THE CODE is lib/signupOtp's "login" draft: the page says the same for every
// address, the email says whether there is an account. In Instagram / Facebook
// webviews Google hands the page to Safari / Chrome with `google=1`, where
// Google starts at once — the register page's rule (open-in-browser).
//
// The password field is always in the page, out of sight until asked for: a
// browser only fills a saved password into a field that exists, and the fill
// is how this form knows to show it (`:-webkit-autofill` / `:autofill` start a
// no-op animation; a manager's fill fires `input`).
import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { HandoffHelp, useBrowserHandoff } from "@/components/auth/open-in-browser";
import { useInAppBrowser } from "@/components/auth/use-in-app-browser";
import { resendOtpCode, startOtpLogin, verifyOtpCode } from "@/actions/signupOtp";
import { rememberOtpDraft } from "@/lib/signupMode";
import s from "./login-form.module.css";

const SERVER_TROUBLE = "Something went wrong on our side. Try again in a minute.";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function GoogleIcon() {
  return (
    <svg className={s.g} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.28-3.14.76-4.59l-7.97-6.19A23.9 23.9 0 0 0 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19Z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.9l-7.97 6.19C6.51 42.62 14.62 48 24 48Z" />
    </svg>
  );
}
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg className={s.eye} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {off ? (
        <>
          <path d="M10.6 5.2A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.4 3.2" />
          <path d="M6.6 6.8A17 17 0 0 0 2 12s3.6 7 10 7c1.7 0 3.2-.5 4.5-1.2" />
          <path d="M3 3l18 18" />
        </>
      ) : (
        <>
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

export function LoginForm({
  nextPath,
  initialEmail,
  initialPassword = "",
  initialError,
}: {
  nextPath: string;
  initialEmail: string;
  /** The development prefill only — it opens the form on the password. */
  initialPassword?: string;
  initialError: string | null;
}) {
  const router = useRouter();
  const inApp = useInAppBrowser();
  const handoff = useBrowserHandoff(inApp ?? "instagram");
  const [usePassword, setUsePassword] = React.useState(Boolean(initialPassword));
  const [email, setEmail] = React.useState(initialEmail);
  const [password, setPassword] = React.useState(initialPassword);
  const [showPw, setShowPw] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(initialError);
  const [busy, setBusy] = React.useState(false);
  const [signedIn, setSignedIn] = React.useState(false);
  const [googleBusy, setGoogleBusy] = React.useState(false);
  // The code, once asked for.
  const [draft, setDraft] = React.useState<string | null>(null);
  const [sentTo, setSentTo] = React.useState("");
  const [code, setCode] = React.useState("");
  const [note, setNote] = React.useState<string | null>(null);
  const [resendAt, setResendAt] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  const pwRef = React.useRef<HTMLInputElement>(null);
  const codeRef = React.useRef<HTMLInputElement>(null);
  const checking = React.useRef(false);

  React.useEffect(() => {
    if (!draft || resendAt <= Date.now()) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [draft, resendAt, now]);
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  /* A saved password filled in before or after the form went live. */
  const filled = React.useCallback(() => {
    setUsePassword(true);
    setDraft(null);
  }, []);
  React.useEffect(() => {
    const el = pwRef.current;
    if (!el) return;
    const look = () => {
      if (el.value || el.matches(":-webkit-autofill") || (() => { try { return el.matches(":autofill"); } catch { return false; } })()) filled();
    };
    look();
    const t1 = window.setTimeout(look, 400);
    const t2 = window.setTimeout(look, 1200);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [filled]);

  /* Opened in the system browser by the in-app hand-off: Google starts at once. */
  React.useEffect(() => {
    if (inApp) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("google") !== "1") return;
    url.searchParams.delete("google");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address said to start Google; the button shows it is on its way
    setGoogleBusy(true);
    void signIn("google", { callbackUrl: nextPath });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the page opens
  }, []);

  function onGoogle() {
    if (inApp) {
      const url = new URL(window.location.href);
      url.searchParams.set("google", "1");
      handoff.open(url.toString());
      return;
    }
    if (googleBusy) return;
    setGoogleBusy(true);
    void signIn("google", { callbackUrl: nextPath });
  }

  async function signInWithPassword() {
    if (!email.trim() || !password) {
      setErr("Enter your email and password.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await signIn("credentials", { email, password, redirect: false });
      if (!res) {
        setErr("The sign-in service did not answer. Try again in a minute.");
        return;
      }
      if (res.error) {
        // `throttled-<minutes>`: the sign-in brake, not a wrong password (lib/auth).
        const throttledFor = /^throttled-(\d+)$/.exec(res.code ?? "")?.[1];
        setErr(
          res.error === "CredentialsSignin"
            ? res.code === "db"
              ? "Couldn't reach the database just now. Try again."
              : throttledFor
                ? `Too many attempts — try again in ${throttledFor} minute${throttledFor === "1" ? "" : "s"}.`
                : "Email or password is wrong."
            : `Sign-in hit a temporary error (${res.error}). Try once more.`,
        );
        return;
      }
      setSignedIn(true);
      router.push(nextPath as Route);
      router.refresh();
    } catch {
      setErr(SERVER_TROUBLE);
    } finally {
      setBusy(false);
    }
  }

  async function askForCode() {
    const em = email.trim();
    if (!EMAIL_RE.test(em)) {
      setErr("Enter your email address.");
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
      setCode("");
      setNote(null);
      window.setTimeout(() => codeRef.current?.focus(), 60);
    } catch {
      setErr(SERVER_TROUBLE);
    } finally {
      setBusy(false);
    }
  }

  async function checkCode(value: string) {
    if (!draft || checking.current || value.length !== 6) return;
    checking.current = true;
    setBusy(true);
    setErr(null);
    try {
      const res = await verifyOtpCode(draft, value);
      if (!res.ok || res.kind !== "signin") {
        setErr(res.ok ? "That code isn't right." : res.error);
        setCode("");
        window.setTimeout(() => codeRef.current?.focus(), 30);
        return;
      }
      const auth = await signIn("signup-ticket", { ticket: res.ticket, redirect: false }).catch(() => null);
      if (!auth || auth.error) {
        setErr("Couldn't sign you in just now. Try again.");
        return;
      }
      setSignedIn(true);
      // `?next=` wins; without one, the account's own place (the plan picker for a shop with no plan).
      window.location.assign(nextPath && nextPath !== "/dashboard" ? nextPath : res.next);
    } catch {
      setErr(SERVER_TROUBLE);
    } finally {
      checking.current = false;
      setBusy(false);
    }
  }

  function onCode(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (err && digits.length) setErr(null);
    if (digits.length === 6) void checkCode(digits);
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

  function switchTo(password: boolean) {
    setUsePassword(password);
    setErr(null);
    setDraft(null);
    setCode("");
    window.setTimeout(() => (password ? pwRef.current : document.getElementById("loginEmail"))?.focus(), 30);
  }

  return (
    <div className={s.lf} data-login-mode={usePassword ? "password" : draft ? "code-sent" : "code"}>
      <button className={s.ghost} type="button" id="googleBtn" onClick={onGoogle} disabled={googleBusy}>
        <GoogleIcon />
        {googleBusy ? "Redirecting to Google…" : "Continue with Google"}
      </button>
      {inApp ? <HandoffHelp handoff={handoff} /> : null}

      <div className={s.divider}>
        <span>or continue with email</span>
      </div>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (usePassword) void signInWithPassword();
          else if (draft) void checkCode(code);
          else void askForCode();
        }}
      >
        <label className={s.fld}>
          <span className={s.lbl}>Email</span>
          <input
            className={s.in}
            type="email"
            id="loginEmail"
            name="email"
            placeholder="you@yourshop.com"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            readOnly={Boolean(draft)}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        {/* The password: always in the page, shown when asked for or filled. */}
        <div className={usePassword ? s.pwShown : s.pwStash} aria-hidden={usePassword ? undefined : true}>
          <label className={s.fld}>
            <span className={s.lbl}>Password</span>
            <span className={s.pwWrap}>
              <input
                ref={pwRef}
                className={`${s.in} ${s.pwIn}`}
                type={showPw ? "text" : "password"}
                id="loginPassword"
                name="password"
                placeholder="••••••••"
                autoComplete="current-password"
                tabIndex={usePassword ? undefined : -1}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (!usePassword && e.target.value) filled();
                }}
                onAnimationStart={() => filled()}
              />
              <button className={s.eyeBtn} type="button" tabIndex={usePassword ? undefined : -1} aria-label={showPw ? "Hide password" : "Show password"} aria-pressed={showPw} onClick={() => setShowPw((v) => !v)}>
                <EyeIcon off={showPw} />
              </button>
            </span>
          </label>
          {usePassword ? (
            <div className={s.row}>
              <Link className={s.quietLink} href={"/auth/forgot" as Route}>
                Forgot password?
              </Link>
            </div>
          ) : null}
        </div>

        {!usePassword && draft ? (
          <div className={s.codeBox}>
            <p className={s.lead}>
              If <b>{sentTo}</b> has a JobFlex account, a 6-digit code is on its way. It works for 10 minutes.
            </p>
            <label className={s.fld}>
              <span className={s.lbl}>6-digit code</span>
              <input
                ref={codeRef}
                className={`${s.in} ${s.code}`}
                id="loginCode"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="••••••"
                value={code}
                aria-invalid={err ? true : undefined}
                onChange={(e) => onCode(e.target.value)}
                onPaste={(e) => {
                  const t = e.clipboardData.getData("text");
                  if (!t) return;
                  e.preventDefault();
                  onCode(t);
                }}
              />
            </label>
            {note ? <p className={s.note} role="status">{note}</p> : null}
          </div>
        ) : null}

        <button className={s.primary} type="submit" id={usePassword ? "signInBtn" : draft ? "codeSignInBtn" : "emailCodeBtn"} disabled={busy || signedIn || (Boolean(draft) && !usePassword && code.length !== 6)}>
          {signedIn ? "Signed in" : usePassword ? (busy ? "Signing in…" : "Sign in") : draft ? (busy && code.length === 6 ? "Checking…" : "Sign in") : busy ? "Sending…" : "Email me a code"}
        </button>

        <div className={err ? s.err : s.errHidden} role="alert">
          {err}
        </div>

        <div className={s.links}>
          {!usePassword && draft ? (
            <>
              <button type="button" className={s.quiet} onClick={() => void resend()} disabled={busy || resendIn > 0}>
                {resendIn > 0 ? `Resend code in ${resendIn} s` : "Resend code"}
              </button>
              <button type="button" className={s.quiet} onClick={() => switchTo(false)}>
                Use a different email
              </button>
            </>
          ) : null}
          <button type="button" className={s.quiet} id={usePassword ? "useCodeLink" : "usePasswordLink"} onClick={() => switchTo(!usePassword)}>
            {usePassword ? "Use a code instead" : "Use password instead"}
          </button>
        </div>
      </form>
    </div>
  );
}
