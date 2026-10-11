"use client";
import { safeNextPath } from "@/lib/safeNext";

// MOBILE AUTH · SIGN IN — the component.
// Rendered by src/app/(mobile)/mobile-v1/auth/login/page.tsx → /mobile-v1/auth/login.
//
// ── SIDE BY SIDE, NOT A REPLACEMENT ────────────────────────────────────────
// This ships BESIDE the desktop /auth/login, which is untouched, per the
// mobile route strategy in CLAUDE.md ("mobile pages live side-by-side with
// existing routes"). The desktop page's own header records that the auth
// family was REPLACED in place when it was ported from the mockup; that
// instruction covered the desktop port and does not extend to this mobile
// build, which is an addition.
//
// ── DESIGN ─────────────────────────────────────────────────────────────────
// Built with the jobflex-page-styler skill (visual system: Blueprint tokens,
// palette, 2px ink frames, 2px radii, hard offset shadows with no blur, Inter
// 800/900 caps + JetBrains Mono annotation layer, Motion System "Balanced")
// and the mobile-app-ui-design skill (structure: thumb reach, ≥44px targets,
// one primary action, peak-and-end). Where the two disagree the house system
// wins — the mobile skill's soft shadows, rounded-3xl cards and 60/30/10
// palette are all overridden by DESIGN.md.
//
// The design language is translated from the desktop port
// (src/app/(auth)/auth/login/page.tsx + login.module.css), which is the source
// of truth here — there is no HTML mockup for this page. Below 1000px that
// port drops its ink drafting-sheet half and becomes an all-cream form; the
// ink band at the top of this page is that half rebuilt for handheld, so the
// mobile surface keeps the design's colour blocking rather than flattening.
//
// ── STYLES ─────────────────────────────────────────────────────────────────
// ./mobile-auth-login.css is a PLAIN stylesheet, not a CSS Module. Every
// selector is prefixed with the literal root class `.jf-mobile-auth-login`.
// See the file header for why a module is the wrong tool here.
//
// ── ICONS ──────────────────────────────────────────────────────────────────
// Inline <svg> with no `id` attribute anywhere, rather than the house
// `<symbol>` sprite + `<use href="#…">`. SVG symbol ids are document-global;
// the desktop login ships `#i-eye`, `#i-eye-off`, `#i-check` and `#i-google`
// under exactly those names, and inline elements remove the collision surface
// entirely.
//
// ── AUTH BEHAVIOUR IS THE DESKTOP PAGE'S, VERBATIM ─────────────────────────
// Same signIn("credentials", …) call with the UNTRIMMED email, same three
// error branches with byte-identical message strings, same toast.error on
// each, same router.push(nextPath) + router.refresh(), same
// signIn("google", { callbackUrl: nextPath }), same ?next= open-redirect guard
// (relative paths only; absolute URLs and protocol-relative //evil.com are
// rejected), same React.Suspense boundary around useSearchParams (in
// page.tsx), same dev-only prefill, same password show/hide toggle.
//
// DATA LAYER UNTOUCHED. No server action, no API route, no Prisma.
//
// One deliberate accessibility change from the desktop port: the toggle's
// aria-label flips with state and the button carries aria-pressed. The desktop
// port keeps a static "Show password" and flags it in place as an authored
// quirk of its donor mockup; this page has no donor and a control whose
// accessible name contradicts its state fails WCAG 2.2 AA 4.1.2, which
// DESIGN.md lists as a hard constraint.

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { toast } from "@/components/ui/Toast";
import { OpenInBrowser } from "@/components/auth/open-in-browser";
import { EmailCodeSignIn } from "@/components/auth/email-code-signin";
import { useInAppBrowser } from "@/components/auth/use-in-app-browser";
import "./mobile-auth-login.css";

/* ── Icons. 24×24 grid, stroke 2-ish, currentColor — the house line style. ── */

function EyeIcon() {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10.6 5.2A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.4 3.2" />
      <path d="M6.6 6.8A17 17 0 0 0 2 12s3.6 7 10 7c1.7 0 3.2-.5 4.5-1.2" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg className="ic ic--brand" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.28-3.14.76-4.59l-7.97-6.19A23.9 23.9 0 0 0 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19Z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.9l-7.97 6.19C6.51 42.62 14.62 48 24 48Z" />
    </svg>
  );
}


/** NextAuth's ?error= codes, in the product's words. */
function authErrorMessage(code: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case "AccessDenied":
      return "Google sign-in was refused for that address. Sign in with your email and password, or use the Google account that matches it.";
    case "OAuthAccountNotLinked":
      return "That email already has a password account. Sign in with the password.";
    case "OAuthCallbackError":
    case "OAuthSignin":
    case "OAuthCallback":
      return "Google sign-in didn't complete. Try again.";
    case "Configuration":
      return "Sign-in didn't complete. Open www.jobflex.app and try again — starting from another address breaks the Google hand-off.";
    default:
      return "Sign in didn't work. Try again.";
  }
}

export function MobileLoginContent() {
  const router = useRouter();
  const search = useSearchParams();
  // Only honor same-site relative paths so `?next=` can't be used as an open
  // redirect (reject absolute URLs and protocol-relative `//evil.com`).
  // A prefix check alone is not enough (`/\evil.com` resolves off-site) —
  // see lib/safeNext for the origin comparison.
  const nextPath = safeNextPath(search.get("next"));
  const [loading, setLoading] = React.useState(false);
  // Prefill demo credentials only in local development — never in production.
  const isDev = process.env.NODE_ENV === "development";
  // ?email= prefills the address (a used trial confirmation link lands here,
  // /auth/register/confirm); the dev prefill stands only without it.
  const emailParam = search.get("email")?.trim().slice(0, 200) || null;
  const [email, setEmail] = React.useState(emailParam ?? (isDev ? "owner@acme.test" : ""));
  const [password, setPassword] = React.useState(isDev && !emailParam ? "password123" : "");

  const [inlineError, setInlineError] = React.useState<string | null>(() =>
    authErrorMessage(search.get("error")),
  );
  const [showPw, setShowPw] = React.useState(false);
  const [signedIn, setSignedIn] = React.useState(false);
  const [googleBusy, setGoogleBusy] = React.useState(false);
  // Instagram / Facebook / LINE / TikTok webview: no Google button — Google
  // refuses its sign-in there (lib/inAppBrowser) — and a way out instead.
  const inApp = useInAppBrowser();

  // The drawing annotation in the hero only earns its place when it says
  // something: where the user lands after signing in, when that isn't the
  // default. Never rendered for the default /dashboard destination.
  const returningTo = nextPath === "/dashboard" ? null : nextPath;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Trimmed only for the emptiness test; the value handed to NextAuth is
    // untouched, exactly as on the desktop page.
    if (!email.trim() || !password) {
      setInlineError("Enter your email and password.");
      return;
    }
    setLoading(true);
    setInlineError(null);
    try {
      const res = await signIn("credentials", { email, password, redirect: false });
      setLoading(false);
      if (!res) {
        const msg =
          "The auth endpoint did not respond. The database probably isn't reachable — see .env.local.";
        setInlineError(msg);
        toast.error("Sign in failed", msg);
        return;
      }
      if (res.error) {
        // `throttled-<minutes>`: the sign-in brake, not a wrong password (lib/auth).
        const throttledFor = /^throttled-(\d+)$/.exec(res.code ?? "")?.[1];
        const msg =
          res.error === "CredentialsSignin"
            ? res.code === "db"
              ? "Couldn't reach the database just now. Try again."
              : throttledFor
                ? `Too many attempts — try again in ${throttledFor} minute${throttledFor === "1" ? "" : "s"}.`
                : "Email or password is wrong."
            : `Sign-in hit a temporary error (${res.error}). Try once more.`;
        setInlineError(msg);
        toast.error("Sign in failed", msg);
        return;
      }
      // Terminal state: check mark + "Signed in", button still disabled. Real
      // navigation follows immediately.
      setSignedIn(true);
      router.push(nextPath as Route);
      router.refresh();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setLoading(false);
      const msg = err?.message ?? "Unexpected error — check the terminal running `npm run dev`.";
      setInlineError(msg);
      toast.error("Sign in failed", msg);
    }
  }

  function onGoogle() {
    if (googleBusy) return;
    setGoogleBusy(true);
    signIn("google", { callbackUrl: nextPath });
  }

  return (
    <div className="jf-mobile-auth-login">
      <header className="hero">
        <div className="hero-wash" />
        <div className="hero-inner">
          <Link className="brand rv rv-1" href="/">
            <span className="brand-mark">J</span>
            <span className="brand-name">JobFlex</span>
          </Link>

          <div className="kicker rv rv-2">
            <span className="kpi-lbl">Sign in</span>
          </div>
          <h1 className="h1 rv rv-2">Welcome back.</h1>
          <p className="lede rv rv-3">
            Your proposals, jobs and money — right where you left them.
          </p>

          {returningTo ? (
            <p className="hero-note rv rv-3">
              <span>Returning to</span>
              <b>{returningTo}</b>
            </p>
          ) : null}
        </div>
      </header>

      <main className="body">
        <section className="card rv rv-4">
          <form onSubmit={onSubmit} noValidate>
            <label className="fld">
              <span className="fld-lbl">Email</span>
              <input
                className="fld-in"
                type="email"
                id="mal-email"
                name="email"
                placeholder="you@yourshop.com"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>

            <label className="fld">
              <span className="fld-lbl">Password</span>
              <span className="pw-wrap">
                <input
                  className="fld-in"
                  type={showPw ? "text" : "password"}
                  id="mal-password"
                  name="password"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  className="pw-toggle"
                  type="button"
                  aria-label={showPw ? "Hide password" : "Show password"}
                  aria-pressed={showPw}
                  onClick={() => setShowPw((v) => !v)}
                >
                  {showPw ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </span>
            </label>

            <div className="row">
              <Link className="link-quiet" href={"/auth/forgot" as Route}>
                Forgot password?
              </Link>
            </div>

            <button className="btn btn--primary" type="submit" disabled={loading || signedIn}>
              {signedIn ? (
                <>
                  <CheckIcon />
                  Signed in
                </>
              ) : loading ? (
                "Signing in…"
              ) : (
                "Sign in"
              )}
            </button>

            <div className={inlineError ? "err" : "err is-hidden"} role="alert">
              {inlineError}
            </div>
          </form>

          {/* No password needed (2026-10-10): a code to the address above. */}
          <EmailCodeSignIn email={email} nextPath={nextPath} />

          {inApp ? (
            <OpenInBrowser app={inApp} />
          ) : (
          <>
          <div className="divider">
            <span className="kpi-lbl">or</span>
          </div>

          <button className="btn btn--ghost" type="button" onClick={onGoogle}>
            {googleBusy ? (
              <>
                <CheckIcon />
                Redirecting to Google…
              </>
            ) : (
              <>
                <GoogleIcon />
                Continue with Google
              </>
            )}
          </button>
          </>
          )}
        </section>

        <p className="foot">
          Don&apos;t have an account?{" "}
          <Link className="link-ink" href={"/auth/register" as Route}>
            Create an account
          </Link>
        </p>

      </main>
    </div>
  );
}
