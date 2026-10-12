"use client";

// AUTH · FORGOT PASSWORD (/auth/forgot) — the donor page body, verbatim.
//
// A port of `jobflex-auth-forgot-blueprint.html`. Every class name is the
// donor's own literal (`<main className="auth">`, never `styles.auth`) because
// the stylesheet is a plain, root-class-prefixed file rather than a CSS module
// — see the long note at the top of auth-forgot.css for why that is not
// negotiable here.
//
// `.jf-auth-forgot` is the single root class every donor selector hangs off,
// and the class the `body:has()` / `html:has()` rules gate on. The wrapper
// <div> that carries it stands in for the donor's <body>.
//
// CHROME. This is a standalone auth page and carries its own chrome (the
// brand lockup and the drafting-sheet right panel). It is deliberately NOT
// mounted inside `blueprint-shell` — the donor has no sidebar and no topbar.
//
// BEHAVIOUR. The donor's mock `setTimeout(…, 800)` is replaced by the real
// `requestPasswordReset` server action that this route already used; nothing
// else about the reset flow changed. The action is anti-enumeration by
// design (it resolves `{ ok: true }` whether or not the address exists), so
// the page always lands on the "Link sent" state — including on a thrown
// error, which is the behaviour the previous implementation shipped and is
// preserved here on purpose.
//
// The donor's own client validation (non-empty, contains "@") and its exact
// error copy are ported as-is, and drive the donor's `.err` box.
//
// The email input stays UNCONTROLLED, read from a ref at submit time, because
// that is what the donor does: "Use a different email" returns to the form
// with whatever was typed still in the field.

import * as React from "react";
import Link from "next/link";
import "./auth-forgot.css";
import { requestPasswordReset } from "@/actions/auth";
import { ProductMark } from "@/components/brand/ProductMark";

export function ForgotContent() {
  const emailRef = React.useRef<HTMLInputElement>(null);
  // Donor: `#err` keeps its last textContent even while `.is-hidden` — the
  // string and the visibility are two separate pieces of state, not one.
  const [errText, setErrText] = React.useState("");
  const [errHidden, setErrHidden] = React.useState(true);
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  // Donor: `#sentEmail` ships with the fallback copy "that address" and is
  // overwritten with the submitted address at the moment the link goes out.
  const [sentEmail, setSentEmail] = React.useState("that address");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = emailRef.current?.value.trim() ?? "";
    if (!email || email.indexOf("@") === -1) {
      setErrText("Enter a valid email address.");
      setErrHidden(false);
      return;
    }
    setErrHidden(true);
    setSending(true);
    try {
      await requestPasswordReset({ email });
      // Always lands here regardless of whether the email exists (anti-enumeration).
    } catch {
      // The action never throws for normal input; if it does, keep the generic
      // confirmation rather than revealing anything.
    }
    setSentEmail(email);
    setSent(true);
    // Donor: the submit button is NOT restored here — only `#againBtn` does
    // that. It is off-screen behind the sent state either way.
  }

  function onAgain() {
    setSent(false);
    setSending(false);
    emailRef.current?.focus();
  }

  return (
    <div className="jf-auth-forgot">
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></symbol>
        <symbol id="i-eye-off" viewBox="0 0 24 24"><path d="M10.6 5.2A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.4 3.2"/><path d="M6.6 6.8A17 17 0 0 0 2 12s3.6 7 10 7c1.7 0 3.2-.5 4.5-1.2"/><path d="M3 3l18 18"/></symbol>
        <symbol id="i-check" viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5"/></symbol>
        <symbol id="i-back" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></symbol>
      </svg>

      <main className="auth">
        <section className="auth-form">
          <Link className="brand" href="/"><ProductMark /><span className="brand-name">JobFlex</span></Link>

          <div className={sent ? "state is-hidden" : "state"} id="formState">
            <div className="auth-kicker kpi-lbl">Forgot password</div>
            <h1 className="auth-h1">Let&apos;s get you back in.</h1>

            <form id="forgotForm" noValidate onSubmit={onSubmit}>
              <label className="fld"><span className="fld-lbl">Email</span>
                <input className="fld-in" type="email" id="email" placeholder="you@yourshop.com" autoComplete="email" ref={emailRef}/></label>
              <button className="btn" type="submit" id="submitBtn" disabled={sending}>{sending ? "Sending…" : "Send reset link"}</button>
              <div className={errHidden ? "err is-hidden" : "err"} id="err">{errText}</div>
            </form>

            <div className="foot"><Link className="link-quiet link-back" href="/auth/login"><svg className="ic"><use href="#i-back"/></svg>Back to sign in</Link></div>
          </div>

          <div className={sent ? "state" : "state is-hidden"} id="sentState">
            <div className="done-mark"><svg className="ic"><use href="#i-check"/></svg></div>
            <div className="auth-kicker kpi-lbl">Link sent</div>
            <h1 className="auth-h1">Check your inbox.</h1>
            <p className="auth-lede">If an account exists for <b id="sentEmail">{sentEmail}</b>, we&apos;ve sent a link
              to reset your password. It expires in an hour.</p>
            <div className="btn-pair">
              <button className="btn btn--ghost" type="button" id="againBtn" onClick={onAgain}>Use a different email</button>
              <Link className="btn" href="/auth/login">Back to sign in</Link>
            </div>
          </div>

        </section>

        <aside className="auth-side">
          <div className="side-wash"></div>
          <figure className="side-card" id="sideCard">
            <div className="kpi-lbl">Reset window</div>
            <blockquote className="side-q">“The link expires in an hour — request a fresh one any time.”</blockquote>
            <figcaption className="side-n">Password resets are single-use and tied to the email on file.</figcaption>
          </figure>
        </aside>
      </main>
    </div>
  );
}
