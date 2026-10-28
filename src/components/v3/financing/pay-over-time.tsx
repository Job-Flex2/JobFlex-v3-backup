"use client";

// "Pay over time" on the client's proposal page — both portal trees (desk /portal/q and the handheld build) render
// this one card from the server's PortalFinancing (lib/financing/view): before signing, what they qualify for through
// the contractor's own link; after, the button that opens Wisetack with them and the amount filled in; once they have
// applied, where the loan stands. Wisetack's disclosure under every state.

import { useState } from "react";
import type { PortalFinancing } from "@/lib/financing/view";
import { FIN } from "@/lib/financing/words";
import s from "./pay-over-time.module.css";

export function PayOverTime({ f, publicId, accepted }: { f: PortalFinancing; publicId: string; accepted: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The Accept tap on this page is seen before the server re-renders: the button is ready at once.
  const mode = f.mode === "prequal" && accepted ? "apply" : f.mode;

  async function open() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/pay/wisetack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicId }) });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && body.url) {
        window.location.href = body.url;
        return;
      }
      setError(body.error ?? "Couldn't open Wisetack. Please try again.");
    } catch {
      setError("Couldn't reach Wisetack. Please try again.");
    }
    setBusy(false);
  }

  return (
    <div className={s.card} id="pay-over-time" data-fin-client={mode} data-fin-state={f.loan?.state ?? ""}>
      {mode === "prequal" ? (
        <>
          <p className={s.title}>{FIN.prequalLine}</p>
          <p className={s.sub}>{FIN.buttonSub}</p>
          {f.prequalUrl ? (
            <a className={s.ghost} href={f.prequalUrl} target="_blank" rel="noreferrer" data-fin-prequal>
              {FIN.prequalButton}
            </a>
          ) : null}
        </>
      ) : null}

      {mode === "apply" ? (
        <>
          {f.loan ? (
            <>
              <p className={s.title}>{f.loan.title}</p>
              <p className={s.sub}>{f.loan.sub}</p>
            </>
          ) : null}
          <button className={s.primary} type="button" disabled={busy} onClick={() => void open()} data-fin-apply>
            {busy ? "Opening Wisetack…" : FIN.button}
          </button>
          <p className={s.sub}>{f.monthly ?? FIN.buttonSub}</p>
        </>
      ) : null}

      {mode === "status" && f.loan ? (
        <>
          <p className={s.title} data-fin-title>
            {f.loan.title}
          </p>
          <p className={s.sub}>{f.loan.sub}</p>
          {f.covered ? <p className={s.line}>{f.covered}</p> : null}
          {f.rest ? <p className={s.line}>{`${FIN.restLabel(f.rest)} — pay it below when it's due.`}</p> : null}
          {f.loan.url ? (
            <a className={s.ghost} href={f.loan.url} data-fin-continue>
              {FIN.continueButton}
            </a>
          ) : null}
        </>
      ) : null}

      {error ? (
        <p className={s.error} role="alert">
          {error}
        </p>
      ) : null}
      <p className={s.fine}>{f.disclosure}</p>
    </div>
  );
}
