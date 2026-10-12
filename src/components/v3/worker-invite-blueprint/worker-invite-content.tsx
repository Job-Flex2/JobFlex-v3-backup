"use client";

/* JobFlex WORKER invite — the page a crew member opens from the invite email
 * (/w/<token>, while WorkerProfile.inviteStatus is still PENDING).
 *
 * It replaces src/components/workers/WorkerInviteCard.tsx, which was the last
 * pre-blueprint surface on the invite path: a centred paper card with a blurred
 * accent glow, `font-display`, `paper-card`, Framer Motion and the shared
 * Button/Input/Badge/Toast primitives — none of which are the house system any
 * more. This is built on the same rules as the TEAM invite page beside it
 * (components/v3/auth-invite-blueprint), which is the design of record for a
 * public "one person, one decision" JobFlex page.
 *
 * ── WHAT CHANGED AND WHAT DID NOT ───────────────────────────────────────
 * The data layer is untouched. Same token lookup on the server, same
 * `acceptWorkerInvite({ token, password })` / `declineWorkerInvite(token)`
 * server actions, same eight-character rule, same auto-sign-in on accept.
 * Only the markup, the styling and the copy changed.
 *
 * Errors are shown in the page's own `.err` box rather than a toast: this is a
 * standalone public page with no toast host of its own, and the message belongs
 * next to the button that produced it.
 *
 * The class names are LITERAL (className="auth-form", never a module binding)
 * because worker-invite.css is a plain scoped stylesheet — see its header for
 * why hashing would break the reset and the `is-hidden` toggles.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { acceptWorkerInvite, declineWorkerInvite } from "@/actions/workers";
import { roleLabel } from "@/lib/prismaEnums";
import { isRedirectError } from "@/lib/redirectError";
import { WorkerInviteSprite } from "./worker-invite-sprite";
import "./worker-invite.css";
import { ProductMark } from "@/components/brand/ProductMark";

interface WorkerInviteContentProps {
  token: string;
  orgName: string;
  workerName: string;
  /** The invited address — their login identity. May be empty on old rows. */
  email: string;
  /** Membership role: INSTALLER / SALES / ESTIMATOR / MANAGER / … */
  role: string;
  /** True when the invite was already declined — open on the terminal state. */
  alreadyDeclined?: boolean;
}

export function WorkerInviteContent({
  token,
  orgName,
  workerName,
  email,
  role,
  alreadyDeclined = false,
}: WorkerInviteContentProps) {
  const router = useRouter();
  const [stage, setStage] = useState<"intro" | "password" | "joined" | "declined">(
    alreadyDeclined ? "declined" : "intro",
  );
  // One toggle per field, not one shared flag: revealing what you typed to
  // check it against the confirm box is the whole point of the control, and a
  // single flag that unmasks both defeats that.
  const [pwShown, setPwShown] = useState(false);
  const [confirmShown, setConfirmShown] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "accept" | "decline">(null);

  const pwRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const firstName = workerName.trim().split(/\s+/)[0] || workerName;
  const label = roleLabel(role).toLowerCase();
  const article = /^[aeiou]/i.test(label) ? "an" : "a";

  async function onDecline() {
    if (busy) return;
    setErr(null);
    setBusy("decline");
    try {
      await declineWorkerInvite(token);
      setStage("declined");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function onAccept(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const pw = pwRef.current?.value ?? "";
    const confirm = confirmRef.current?.value ?? "";
    if (pw.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    if (pw !== confirm) {
      setErr("The two passwords don't match.");
      return;
    }
    setErr(null);
    setBusy("accept");
    try {
      // Sets the password, signs them in and redirects to their jobs — all in
      // one server step, so there is no second login screen. The navigation
      // below is the fallback for a row with no email on file, where the
      // action returns instead of redirecting.
      await acceptWorkerInvite({ token, password: pw });
      setStage("joined");
      router.push("/dashboard/jobs");
      router.refresh();
    } catch (e: unknown) {
      // The redirect the action performs on success arrives HERE, as a throw:
      // `redirect()` signals itself by throwing, and the throw crosses the
      // server-action boundary. Rendering it printed the literal word
      // NEXT_REDIRECT in the red box for the frame before the router landed on
      // /dashboard/jobs — an error banner on the happy path.
      //
      // Recognised and treated as success, not rethrown: this is a browser
      // event handler, and the router has already accepted the redirect by the
      // time we get here, so a rethrow would add nothing but an unhandled
      // rejection. `busy` deliberately stays set — the button holds its
      // "Setting up…" state until the navigation lands.
      if (isRedirectError(e)) {
        setStage("joined");
        return;
      }
      setErr(e instanceof Error ? e.message : "Something went wrong. Try again.");
      setBusy(null);
    }
  }

  const cls = (s: typeof stage) => (stage === s ? "state" : "state is-hidden");

  return (
    <div className="jf-worker-invite">
      <WorkerInviteSprite />

      <main className="auth">
        <section className="auth-form">
          <Link className="brand" href="/">
            <ProductMark />
            <span className="brand-name">JobFlex</span>
          </Link>

          {/* ── the decision ── */}
          <div className={stage === "intro" || stage === "password" ? "state" : "state is-hidden"}>
            <div className="auth-kicker kpi-lbl">You&apos;re on the crew list</div>
            <h1 className="auth-h1">Join {orgName}.</h1>

            <div className="meta">
              <div className="meta-row"><span className="caps">Role</span><span className="badge">{label}</span></div>
              <div className="meta-row"><span className="caps">Name</span><span className="meta-v">{workerName}</span></div>
              {email ? (
                <div className="meta-row"><span className="caps">Login</span><span className="meta-v">{email}</span></div>
              ) : null}
            </div>

            {stage === "intro" ? (
              <ul className="steps">
                <li><span className="no">01</span><span>Set a password — that address becomes your login.</span></li>
                <li><span className="no">02</span><span>See only the jobs {orgName} assigns to you, with the address and the schedule.</span></li>
                <li><span className="no">03</span><span>Confirm or decline each one, and log receipts from the site.</span></li>
              </ul>
            ) : (
              <form onSubmit={onAccept} noValidate>
                <label className="fld">
                  <span className="fld-lbl">Create a password</span>
                  <span className="pw-wrap">
                    <input
                      className="fld-in"
                      type={pwShown ? "text" : "password"}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      ref={pwRef}
                    />
                    <button
                      className="pw-toggle"
                      type="button"
                      aria-label={pwShown ? "Hide password" : "Show password"}
                      onClick={() => setPwShown((v) => !v)}
                    >
                      <svg className="ic"><use href={pwShown ? "#i-eye-off" : "#i-eye"} /></svg>
                    </button>
                  </span>
                  <span className="fld-note">At least 8 characters.</span>
                </label>

                <label className="fld">
                  <span className="fld-lbl">Confirm password</span>
                  <span className="pw-wrap">
                    <input
                      className="fld-in"
                      type={confirmShown ? "text" : "password"}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      ref={confirmRef}
                    />
                    <button
                      className="pw-toggle"
                      type="button"
                      aria-label={confirmShown ? "Hide confirmed password" : "Show confirmed password"}
                      onClick={() => setConfirmShown((v) => !v)}
                    >
                      <svg className="ic"><use href={confirmShown ? "#i-eye-off" : "#i-eye"} /></svg>
                    </button>
                  </span>
                </label>

                <div className="btn-pair">
                  <button
                    className="btn btn--ghost"
                    type="button"
                    onClick={() => { setErr(null); setStage("intro"); }}
                    disabled={busy === "accept"}
                  >
                    Back
                  </button>
                  <button className="btn" type="submit" disabled={busy === "accept"}>
                    {busy === "accept" ? "Setting up…" : "Create account"}
                  </button>
                </div>
                <div className={err ? "err" : "err is-hidden"} role="alert">{err}</div>
              </form>
            )}

            {stage === "intro" ? (
              <>
                <div className="btn-pair">
                  <button className="btn btn--ghost" type="button" onClick={onDecline} disabled={busy === "decline"}>
                    <svg className="ic"><use href="#i-x" /></svg>
                    {busy === "decline" ? "Declining…" : "Decline"}
                  </button>
                  <button className="btn" type="button" onClick={() => { setErr(null); setStage("password"); }}>
                    <svg className="ic"><use href="#i-check" /></svg>
                    Accept &amp; set up
                  </button>
                </div>
                <div className={err ? "err" : "err is-hidden"} role="alert">{err}</div>
                <p className="foot-note">
                  This link is yours alone — don&apos;t forward it. Not expecting an invite from {orgName}? Ignore this page.
                </p>
              </>
            ) : null}
          </div>

          {/* ── accepted (fallback: the action normally redirects) ── */}
          <div className={cls("joined")}>
            <div className="done-mark"><svg className="ic"><use href="#i-check" /></svg></div>
            <div className="auth-kicker kpi-lbl">You&apos;re in</div>
            <h1 className="auth-h1">Welcome to the crew.</h1>
            <p className="auth-lede">
              Your account is live on {orgName} as {article} {label}, {firstName}. Your jobs are waiting.
            </p>
            <div className="btn-pair">
              <Link className="btn" href="/dashboard/jobs">
                <svg className="ic"><use href="#i-arrow" /></svg>
                Open my jobs
              </Link>
            </div>
          </div>

          {/* ── declined ── */}
          <div className={cls("declined")}>
            <div className="done-mark done-mark--off"><svg className="ic"><use href="#i-x" /></svg></div>
            <div className="auth-kicker kpi-lbl">Declined</div>
            <h1 className="auth-h1">Invite declined.</h1>
            <p className="auth-lede">
              Nothing was created and {orgName} has been told. If that was a mistake, ask them to send a fresh link.
            </p>
            <div className="btn-pair">
              <Link className="btn btn--ghost" href="/">Back to JobFlex</Link>
            </div>
          </div>
        </section>

        <aside className="auth-side">
          <div className="side-wash"></div>
          <div className="side-stamp">Crew invite · {orgName}</div>
          <figure className="side-card">
            <div className="kpi-lbl">Joining</div>
            <blockquote className="side-q">
              &ldquo;Took the invite on the drive over and had the day&apos;s address before I parked.&rdquo;
            </blockquote>
            <figcaption className="side-n">
              One login, your jobs only. No shared passwords, no group texts about where to be.
            </figcaption>
          </figure>
        </aside>
      </main>
    </div>
  );
}
