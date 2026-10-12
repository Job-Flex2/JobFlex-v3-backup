"use client";

// AUTH · SET A NEW PASSWORD (/auth/reset) — the donor page body, verbatim.
//
// A port of `jobflex-auth-reset-blueprint.html`. Every class name is the
// donor's own literal (`<main className="auth">`, never `styles.auth`) because
// the stylesheet is a plain, root-class-prefixed file rather than a CSS module
// — see the long note at the top of auth-reset.css for why.
//
// `.jf-auth-reset` is the single root class every donor selector hangs off. It
// is deliberately not a shared `.jf-auth`: the other auth mockups are being
// ported separately and each owns its own root.
//
// STANDALONE CHROME. This page is NOT mounted inside `blueprint-shell` — the
// donor is a full-bleed two-column document (its own brand lockup on the left,
// its own drafting-sheet panel on the right) and has no shell chrome to
// inherit. Its sprite ships with the page for the same reason.
//
// BEHAVIOUR. The donor's script does three things and all three are ported:
// per-field show/hide password (icon swaps `#i-eye` ⇄ `#i-eye-off`), the two
// client-side checks (min 8 characters, the two fields must match) surfaced in
// `.err`, and the swap from `#formState` to `#doneState` on success. Its fourth
// handler — the `.chip` toggle — belongs to the register mockup and has no
// chips on this page, so it is not ported.
//
// WIRING IS UNCHANGED. The reset token still comes from `?token=`, the submit
// still calls the `resetPassword` server action with the same
// `{ token, password }` contract, the same two validation strings are used
// (they were already identical in both the app and the mockup), server errors
// still raise a toast, and the no-token guard the route already had is kept.
// No server action, API route or Prisma model was touched.
//
// The `.state` blocks are both always rendered and toggled with the donor's
// `is-hidden` class rather than conditionally mounted, so the donor's
// `.state.is-hidden { display: none }` rule stays the thing that does the work.

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "@/components/ui/Toast";
import { resetPassword } from "@/actions/auth";
import "./auth-reset.css";
import { ProductMark } from "@/components/brand/ProductMark";

/** The donor's inline sprite, verbatim — three symbols, same ids, same paths. */
function Sprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></symbol>
      <symbol id="i-eye-off" viewBox="0 0 24 24"><path d="M10.6 5.2A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.4 3.2"/><path d="M6.6 6.8A17 17 0 0 0 2 12s3.6 7 10 7c1.7 0 3.2-.5 4.5-1.2"/><path d="M3 3l18 18"/></symbol>
      <symbol id="i-check" viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5"/></symbol>
    </svg>
  );
}

export function AuthResetContent() {
  const token = useSearchParams().get("token") ?? "";

  const [pw1, setPw1] = React.useState("");
  const [pw2, setPw2] = React.useState("");
  const [show1, setShow1] = React.useState(false);
  const [show2, setShow2] = React.useState(false);
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [done, setDone] = React.useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // The donor's two client-side checks, with its exact strings.
    if (pw1.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (pw1 !== pw2) {
      setError("Passwords don't match.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await resetPassword({ token, password: pw1 });
      toast.success("Password updated", "Sign in with your new password.");
      setDone(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Couldn't reset your password.";
      setError(msg);
      toast.error("Couldn't reset password", msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="jf-auth-reset">
      <Sprite />

      <main className="auth">
        <section className="auth-form">
          <Link className="brand" href="/"><ProductMark /><span className="brand-name">JobFlex</span></Link>

          {/* No `?token=` in the URL — the route has always guarded this, and the
              guard is kept. The mockup has no such state, so it is composed
              strictly from the mockup's own vocabulary; no new CSS. */}
          {!token ? (
            <div className="state" id="noTokenState">
              <div className="auth-kicker kpi-lbl">Reset link missing</div>
              <h1 className="auth-h1">This link isn&rsquo;t valid.</h1>
              <p className="auth-lede">
                This page needs a valid reset link. Request a fresh one and we&rsquo;ll email it over.
              </p>
              <div className="btn-pair"><Link className="btn" href={"/auth/forgot" as never}>Request a new link</Link></div>
            </div>
          ) : (
            <>
              <div className={done ? "state is-hidden" : "state"} id="formState">
                <div className="auth-kicker kpi-lbl">Set a new password</div>
                <h1 className="auth-h1">Pick something new.</h1>

                <form id="resetForm" noValidate onSubmit={onSubmit}>
                  <label className="fld"><span className="fld-lbl">New password</span>
                    <span className="pw-wrap">
                      <input
                        className="fld-in"
                        type={show1 ? "text" : "password"}
                        id="pw1"
                        placeholder="Password"
                        autoComplete="new-password"
                        value={pw1}
                        onChange={(e) => setPw1(e.target.value)}
                      />
                      <button
                        className="pw-toggle"
                        type="button"
                        aria-label="Show password"
                        onClick={() => setShow1((v) => !v)}
                      ><svg className="ic"><use href={show1 ? "#i-eye-off" : "#i-eye"}/></svg></button>
                    </span>
                    <span className="fld-note">At least 8 characters.</span></label>
                  <label className="fld"><span className="fld-lbl">Confirm password</span>
                    <span className="pw-wrap">
                      <input
                        className="fld-in"
                        type={show2 ? "text" : "password"}
                        id="pw2"
                        placeholder="Password"
                        autoComplete="new-password"
                        value={pw2}
                        onChange={(e) => setPw2(e.target.value)}
                      />
                      <button
                        className="pw-toggle"
                        type="button"
                        aria-label="Show password"
                        onClick={() => setShow2((v) => !v)}
                      ><svg className="ic"><use href={show2 ? "#i-eye-off" : "#i-eye"}/></svg></button>
                    </span></label>
                  <button className="btn" type="submit" id="submitBtn" disabled={saving}>
                    {saving ? "Saving…" : "Save password"}
                  </button>
                  <div className={error ? "err" : "err is-hidden"} id="err" role="alert">{error}</div>
                </form>

              </div>

              <div className={done ? "state" : "state is-hidden"} id="doneState">
                <div className="done-mark"><svg className="ic"><use href="#i-check"/></svg></div>
                <div className="auth-kicker kpi-lbl">Saved</div>
                <h1 className="auth-h1">Password updated.</h1>
                <p className="auth-lede">You can sign in with the new one now.</p>
                <div className="btn-pair"><Link className="btn" href={"/auth/login" as never}>Sign in</Link></div>
              </div>
            </>
          )}

        </section>

        <aside className="auth-side">
          <div className="side-wash"></div>
          <figure className="side-card" id="sideCard">
            <div className="kpi-lbl">One-time link</div>
            <blockquote className="side-q">“New password saved — the old one stops working immediately.”</blockquote>
            <figcaption className="side-n">Sessions on other devices stay signed in until they expire.</figcaption>
          </figure>
        </aside>
      </main>
    </div>
  );
}
