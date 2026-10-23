"use client";

// THE SIGN-UP SCREEN (owner, 2026-10-22), under the plan switch on Admin → Trials: the sign-up page as built, the same
// form in the middle of a preview of the app, or half and half for the A/B tab (lib/signupView). Same clothes as the
// others.
import { useState } from "react";
import { setSignupViewAction } from "@/actions/trialPolicy";
import type { SignupViewSetting } from "@/lib/trialPolicyServer";
import { SIGNUP_VIEW_EXPERIMENT, type SignupViewMode } from "@/lib/signupView";
import t from "./trial-policy.module.css";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

const CHOICES: Array<{ id: SignupViewMode; label: string }> = [
  { id: "page", label: "Sign-up page" },
  { id: "app", label: "Inside the app" },
  { id: "split", label: "Half and half" },
];

const NOW: Record<SignupViewMode, string> = {
  page: "The sign-up page, as built: the form beside the photo.",
  app: "Inside the app: the visitor lands in JobFlex — the sidebar and the overview with sample work for their trade, nothing to click — and signs up in a card in the middle; on a phone, a sheet over the phone app. Their name appears in the app as they type it. Google, the email form and the card page are the same as now.",
  split: "Half and half: each new visitor gets the sign-up page or the app view and keeps it for 30 days. The A/B tab on the traffic page compares the two — visitors, attempts and verified sign-ups for each.",
};

export function SignupViewPanel({ initial }: { initial: SignupViewSetting }) {
  const [v, setV] = useState(initial);
  const [pending, setPending] = useState<SignupViewMode | null>(null);
  const [error, setError] = useState("");
  const pick = async (mode: SignupViewMode) => {
    if (mode === v.mode || pending) return;
    setPending(mode);
    setError("");
    try {
      const res = await setSignupViewAction({ mode });
      if (res.ok) setV(res.view);
      else setError(res.error);
    } catch {
      setError("The switch could not be saved. Try again.");
    } finally {
      setPending(null);
    }
  };
  const why = v.source === "admin" ? `Set here${v.at ? ` on ${when(v.at)}` : ""}${v.by ? ` by ${v.by}` : ""}.` : "The default; nothing set here yet.";
  return (
    <section className={t.panel} aria-label="Sign-up screen" data-signup-view={v.mode}>
      <div className={t.main}>
        <div className={t.kicker}>Sign-up · screen</div>
        <p className={t.now} aria-live="polite">
          {NOW[v.mode]}
        </p>
        <p className={t.why}>
          {why} Takes effect for new visits within seconds; it changes only what is drawn — the plan and card switches above
          still decide the steps. A link can ask for one screen whatever this says: add <code>?view=app</code> or{" "}
          <code>?view=page</code> to an ad&apos;s link (it holds for that visit). To look at the app view yourself, open{" "}
          <a href="/auth/register?view=app" target="_blank" rel="noreferrer">
            /auth/register?view=app
          </a>{" "}
          in a private window. Sign-up events carry <code>signup_view</code>; the half-and-half test is{" "}
          <code>{SIGNUP_VIEW_EXPERIMENT}</code> on the A/B tab.
        </p>
        {error && (
          <p className={t.err} role="alert">
            {error}
          </p>
        )}
      </div>
      <div className={t.actions}>
        <div className={t.seg} role="radiogroup" aria-label="Sign-up screen">
          {CHOICES.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={v.mode === c.id} className={t.segBtn} disabled={pending !== null} onClick={() => void pick(c.id)}>
              {pending === c.id ? "Saving…" : c.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
