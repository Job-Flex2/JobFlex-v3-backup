"use client";

// "Find me another contractor" — available at ANY time while the request is
// matched (owner, 2026-10-02: the 24-hour lock is gone). One tap opens a short
// "what went wrong?" sheet; the reason is optional and skippable (rule #6).
// The server re-checks the match (homeownerPortal.requestAnotherContractor) —
// this component only asks.

import * as React from "react";
import { useRouter } from "next/navigation";
import { requestAnotherContractor } from "@/actions/homeownerPortal";
import s from "./request.module.css";

const REASONS = ["Never heard from them", "Couldn't agree on price", "Scheduling didn't work out"];

export function RerouteButton({ token, orgName, accepted }: { token: string; orgName: string; accepted: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState<string | null>(null);
  const [other, setOther] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const firstRef = React.useRef<HTMLInputElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  // Closing hands focus back to the button that opened the sheet.
  const close = React.useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  React.useEffect(() => {
    if (!open) return;
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, close]);

  async function submit(withReason: string | null) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await requestAnotherContractor({ token, reason: withReason ?? undefined });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setDone("Done — we're finding your next contractor now. This page updates when one takes your project.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p className={s.doneNote}>{done}</p>;

  return (
    <>
      <button ref={triggerRef} type="button" className={s.btnGhost} onClick={() => setOpen(true)} disabled={busy}>
        Find me another contractor
      </button>
      {error && !open && <p className={s.err}>{error}</p>}

      {open && (
        <div className={s.scrim} onClick={() => !busy && close()}>
          <div
            className={s.sheet}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reroute-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="reroute-title" className={s.sheetTitle}>
              Find another contractor?
            </h2>
            <p className={s.sheetLede}>
              {accepted
                ? `You accepted ${orgName}'s proposal — if you're canceling it, tell them directly too. We'll let them know you asked for another contractor and match your project with another local JobFlex pro.`
                : `We'll let ${orgName} know and match your project with another local JobFlex pro. Tell us what went wrong — optional, it helps us pick a better match.`}
            </p>
            <div className={s.reasons} role="radiogroup" aria-label="What went wrong">
              {REASONS.map((r, i) => (
                <label key={r} className={s.reason}>
                  <input
                    ref={i === 0 ? firstRef : undefined}
                    type="radio"
                    name="reroute-reason"
                    checked={reason === r}
                    onChange={() => setReason(r)}
                  />
                  <span>{r}</span>
                </label>
              ))}
              <label className={s.reason}>
                <input type="radio" name="reroute-reason" checked={reason === "__other"} onChange={() => setReason("__other")} />
                <span>Something else</span>
              </label>
              {reason === "__other" && (
                <textarea
                  className={s.otherText}
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="A sentence is plenty"
                  aria-label="What went wrong"
                />
              )}
            </div>
            {error && <p className={s.err}>{error}</p>}
            <div className={s.sheetActions}>
              <button
                type="button"
                className={s.btnPrimary}
                disabled={busy}
                onClick={() => void submit(reason === "__other" ? other.trim() || null : reason)}
              >
                {busy ? "Sending…" : "Find another contractor"}
              </button>
              <button type="button" className={s.btnText} disabled={busy} onClick={() => void submit(null)}>
                Skip the reason — just find another
              </button>
              <button type="button" className={s.btnText} disabled={busy} onClick={close}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
