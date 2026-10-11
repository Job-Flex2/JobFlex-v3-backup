"use client";

// BEFORE THE FIRST SEND, THE COMPANY NAME (2026-10-10; lib/orgName). A shop
// that signed up without a password carries its owner's own name until it
// names the business. Before a proposal, an email or a text goes to a client,
// `ensureCompanyName()` asks once, in one field — prefilled with the name the
// client would otherwise see — and the send goes on with Save. Cancel stops
// that send only. Shops with a name never see it: one cheap read per page,
// then the answer is remembered for the session.
//
// Imperative on purpose: the sends live both in React components and in the
// DOM scripts of the blueprint pages (proposals-behavior). Hand-rolled — a
// bottom sheet on a phone, a small framed panel on a desk — like the rest of
// the in-house dialogs.
import * as React from "react";
import { createRoot } from "react-dom/client";
import { companyNameStatus, setCompanyName } from "@/actions/companyName";
import s from "./company-name-gate.module.css";

let known: "set" | null = null;
let open: Promise<boolean> | null = null;

/** True once the business has a name (asking for it when it has none). */
export async function ensureCompanyName(): Promise<boolean> {
  if (known === "set") return true;
  if (open) return open;
  const st = await companyNameStatus().catch(() => null);
  if (!st || !st.unset || !st.canEdit) {
    if (!st?.unset) known = "set";
    return true;
  }
  open = new Promise<boolean>((resolve) => {
    const host = document.createElement("div");
    host.setAttribute("data-company-name-gate", "");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (ok: boolean) => {
      if (ok) known = "set";
      open = null;
      resolve(ok);
      window.setTimeout(() => {
        root.unmount();
        host.remove();
      }, 0);
    };
    root.render(<NamePrompt initial={st.name} onDone={done} />);
  });
  return open;
}

function NamePrompt({ initial, onDone }: { initial: string; onDone: (ok: boolean) => void }) {
  const [name, setName] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [on, setOn] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  const back = React.useRef<HTMLElement | null>(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);

  React.useEffect(() => {
    const id = requestAnimationFrame(() => {
      setOn(true);
      input.current?.focus();
      input.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const close = (ok: boolean) => {
    setOn(false);
    back.current?.focus({ preventScroll: true });
    window.setTimeout(() => onDone(ok), 180);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    const res = await setCompanyName(name).catch(() => ({ ok: false as const, error: "Couldn't save the name. Try again." }));
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    close(true);
  }

  return (
    <div className={s.layer + (on ? " " + s.on : "")} onKeyDown={(e) => { if (e.key === "Escape") close(false); }}>
      <div className={s.scrim} onClick={() => close(false)} />
      <form className={s.box} role="dialog" aria-modal="true" aria-labelledby="cngTitle" onSubmit={(e) => void save(e)}>
        <span className={s.grab} aria-hidden="true" />
        <p className={s.kick}>Before you send</p>
        <h2 className={s.h} id="cngTitle">What&apos;s your company called?</h2>
        <p className={s.p}>Clients see it on the proposal, in the email and in texts. Right now it says your own name.</p>
        <label className={s.fld}>
          <span className={s.lbl}>Company name</span>
          <input ref={input} className={s.in} id="cngName" value={name} maxLength={120} autoComplete="organization" onChange={(e) => setName(e.target.value)} />
        </label>
        {err ? <p className={s.err} role="alert">{err}</p> : null}
        <div className={s.row}>
          <button type="button" className={s.ghost} onClick={() => close(false)} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={s.go} disabled={busy || !name.trim()}>
            {busy ? "Saving…" : "Save and send"}
          </button>
        </div>
      </form>
    </div>
  );
}
