"use client";

/* JobFlex team invite — PORT of `jobflex-auth-invite-blueprint.html`
 * (design of record).
 *
 * Markup is the donor's, element for element, class for class, string for
 * string — including the donor's own element ids, which are kept even though
 * React drives the behaviour now. Class names stay LITERAL
 * (className="auth-form", never className={styles.authForm}) because
 * auth-invite.css is a plain scoped stylesheet, not a CSS module — see the
 * header of auth-invite.css for why hashing would break this page.
 * `<div className="jf-auth-invite">` is the single scope root every ported
 * rule hangs off.
 *
 * The page chrome is KEPT. The app-shell rule does not apply: `(auth)` has no
 * route-group layout, blueprint-shell never mounts here, so the brand lockup
 * and the right-hand drafting panel are this page's only chrome. Stripping
 * them would leave a headless form.
 *
 * ── BEHAVIOUR ───────────────────────────────────────────────────────────
 * The donor's IIFE is React state now; the rendered result is the same DOM.
 *   • password show/hide — swaps input type and the <use> href between
 *     #i-eye and #i-eye-off, exactly the donor's branch.
 *   • the three `.state` panels stay mounted and toggle `is-hidden`, the
 *     donor's own mechanism, rather than unmounting.
 *   • client validation strings, order and the `.err.is-hidden` toggle are
 *     the donor's, character for character.
 *   • the donor's `.chip` click-to-toggle listener is NOT ported: this page
 *     has no chips (the donor shares one script across all five auth
 *     mockups; chips belong to register).
 *
 * ── WHERE THE MOCKUP AND THE LIVE HANDLER DISAGREE ──────────────────────
 * The donor's 900ms `setTimeout` is `acceptInvite(token)` / the decline
 * button is `declineInvite(token)` — the pre-existing server actions,
 * unchanged. Two mismatches are DELIBERATELY left as-is because the data
 * layer is out of scope; both are called out in the port report:
 *
 *   1. The mockup collects "Your name" and "Create a password".
 *      `acceptInvite(token)` accepts neither — it derives the name from the
 *      invited email and never sets a password. The fields are ported (they
 *      are the design of record) and validated exactly as the donor
 *      validates them, but their values are not yet persisted. Honouring
 *      them needs a server-action signature change, which requires approval.
 *   2. The donor has no server-error path at all. A thrown action error is
 *      surfaced in the donor's own `.err` box, which is the only place on
 *      the page built to hold a message.
 *
 * Everything else — the org name, role, inviter, invited email, expiry and
 * the expired/declined branches — is real data from the server component.
 */

import { useRef, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { acceptInvite, declineInvite } from "@/actions/team";
import { AuthInviteSprite } from "./auth-invite-sprite";
import "./auth-invite.css";
import { ProductMark } from "@/components/brand/ProductMark";

interface AuthInviteContentProps {
  token: string;
  orgName: string;
  role: string;
  inviterName: string;
  invitedEmail: string;
  /** Pre-rendered on the server ("in 6 days") so the two passes agree. */
  expiresIn: string;
  expired: boolean;
}

export function AuthInviteContent({
  token,
  orgName,
  role,
  inviterName,
  invitedEmail,
  expiresIn,
  expired,
}: AuthInviteContentProps) {
  const [stage, setStage] = useState<"accept" | "joined" | "expired">(
    expired ? "expired" : "accept",
  );
  const [declined, setDeclined] = useState(false);
  const [pwShown, setPwShown] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [joinedHref, setJoinedHref] = useState("/dashboard");

  const nameRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  // The donor writes "as an installer" — the article is only right for a
  // vowel-initial role, so it is derived rather than hardcoded. Sentence
  // shape is the donor's.
  const roleLabel = role.toLowerCase();
  const article = /^[aeiou]/.test(roleLabel) ? "an" : "a";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const name = nameRef.current?.value.trim() ?? "";
    const pw = pwRef.current?.value ?? "";
    if (!name) {
      setErr("Enter your name.");
      return;
    }
    if (pw.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const res = await acceptInvite(token);
      setJoinedHref(res.requiresLogin ? "/auth/login?next=/dashboard" : "/dashboard");
      setStage("joined");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  // The donor never guards its Decline button — it had nothing to await. The
  // guard is `if (busy) return`, not `disabled`, so the button's rendering
  // never changes: `.btn[disabled]` would drop it to opacity 0.55 mid-accept,
  // which the donor never shows.
  async function onDecline() {
    if (busy) return;
    setBusy(true);
    try {
      await declineInvite(token);
      setDeclined(true);
      setStage("expired");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="jf-auth-invite">
      <AuthInviteSprite />

      <main className="auth">
        <section className="auth-form">
          <Link className="brand" href="/"><ProductMark /><span className="brand-name">JobFlex</span></Link>

          <div className={stage === "accept" ? "state" : "state is-hidden"} id="acceptState">
            {/* &apos; is the lint-required spelling of the donor's straight
                apostrophe; it decodes to the same U+0027. */}
            <div className="auth-kicker kpi-lbl">You&apos;re invited</div>
            <h1 className="auth-h1">Join {orgName}.</h1>

            <div className="meta">
              <div className="meta-row"><span className="caps">Role</span><span className="badge">{roleLabel}</span></div>
              <div className="meta-row"><span className="caps">Invited by</span><span className="meta-v">{inviterName}</span></div>
              <div className="meta-row"><span className="caps">For</span><span className="meta-v">{invitedEmail}</span></div>
              <div className="meta-row"><span className="caps">Expires</span><span className="meta-v">{expiresIn}</span></div>
            </div>

            <form id="inviteForm" noValidate onSubmit={onSubmit}>
              <label className="fld" style={{ marginTop: 22 }}><span className="fld-lbl">Your name</span>
                <input className="fld-in" id="name" placeholder="First and last" autoComplete="name" ref={nameRef} /></label>
              <label className="fld"><span className="fld-lbl">Create a password</span>
                <span className="pw-wrap">
                  <input className="fld-in" type={pwShown ? "text" : "password"} id="pw" placeholder="••••••••" autoComplete="new-password" ref={pwRef} />
                  {/* aria-label is static, exactly as the donor left it — its
                      script swapped only the icon. Ported verbatim and
                      flagged in the port report. */}
                  <button className="pw-toggle" type="button" aria-label="Show password" onClick={() => setPwShown((v) => !v)}><svg className="ic"><use href={pwShown ? "#i-eye-off" : "#i-eye"} /></svg></button>
                </span>
                <span className="fld-note">At least 8 characters.</span></label>

              <div className="btn-pair" style={{ marginTop: 6 }}>
                <button className="btn btn--ghost" type="button" id="declineBtn" onClick={onDecline}>Decline</button>
                <button className="btn" type="submit" id="acceptBtn" disabled={busy}>{busy ? "Joining…" : "Accept & join"}</button>
              </div>
              <div className={err ? "err" : "err is-hidden"} id="err">{err}</div>
            </form>
          </div>

          <div className={stage === "joined" ? "state" : "state is-hidden"} id="joinedState">
            <div className="done-mark"><svg className="ic"><use href="#i-check" /></svg></div>
            <div className="auth-kicker kpi-lbl">You&apos;re in</div>
            <h1 className="auth-h1">Welcome to the crew.</h1>
            <p className="auth-lede">Your account is active on {orgName} as {article} {roleLabel}.</p>
            <div className="btn-pair"><Link className="btn" href={joinedHref as Route}>Open the dashboard</Link></div>
          </div>

          <div className={stage === "expired" ? "state" : "state is-hidden"} id="expiredState">
            <div className="auth-kicker kpi-lbl">{declined ? "Declined" : "Expired"}</div>
            <h1 className="auth-h1">{declined ? "Invite declined." : "This invite has expired."}</h1>
            <p className="auth-lede">{declined
              ? `Nothing was created. If you change your mind, ask ${inviterName} to send it again.`
              : `Ask ${inviterName} for a fresh link — invites are good for seven days.`}</p>
            <div className="btn-pair"><Link className="btn btn--ghost" href="/auth/login">Back to sign in</Link></div>
          </div>

        </section>

        <aside className="auth-side">
          <div className="side-wash"></div>
          <figure className="side-card" id="sideCard">
            <div className="kpi-lbl">Joining</div>
            <blockquote className="side-q">“Marcus took the invite and clocked into his first job the same afternoon.”</blockquote>
            <figcaption className="side-n">Invites carry a role and expire — no shared logins, no password juggling.</figcaption>
          </figure>
        </aside>
      </main>
    </div>
  );
}
