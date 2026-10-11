"use client";

// THE PASSWORD ROW'S BUTTON AND FORM (owner, 2026-10-10; actions/accountPassword).
// No password yet: "Add password" — New and Confirm, at least 8 characters,
// show / hide, no code asked. A password already: "Change password" — the
// current one, then New and Confirm. Only ever the signed-in user's own.
// A bottom sheet on a phone, a small framed panel on a desk (hand-rolled, like
// the rest of the in-house dialogs). Used by the desktop and the handheld
// Account panes; `/dashboard/settings#password` scrolls to the row.
import * as React from "react";
import { createPortal } from "react-dom";
import { setMyPassword } from "@/actions/accountPassword";
import s from "./password-control.module.css";

type Field = "current" | "password" | "confirm";

function PwInput({ id, label, value, onChange, autoComplete, invalid, describedBy, inputRef }: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  invalid: boolean;
  describedBy?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [show, setShow] = React.useState(false);
  return (
    <label className={s.fld} htmlFor={id}>
      <span className={s.lbl}>{label}</span>
      <span className={s.wrap}>
        <input
          ref={inputRef}
          id={id}
          className={s.in}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className={s.eye} aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-pressed={show} onClick={() => setShow((v) => !v)}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            {show ? (
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
        </button>
      </span>
    </label>
  );
}

export function PasswordControl({ hasPassword: initial, email, buttonClassName, onSaved }: {
  email: string;
  hasPassword: boolean;
  buttonClassName: string;
  /** The row's own words follow the change (Set / Not set). */
  onSaved?: (hasPassword: boolean) => void;
}) {
  const [has, setHas] = React.useState(initial);
  const [open, setOpen] = React.useState(false);
  const [on, setOn] = React.useState(false);
  const [current, setCurrent] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [checked, setChecked] = React.useState(false);
  const [err, setErr] = React.useState<{ text: string; field?: Field } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<string | null>(null);
  const first = React.useRef<HTMLInputElement>(null);
  const back = React.useRef<HTMLElement | null>(null);

  /* /dashboard/settings#password: the row in view. */
  React.useEffect(() => {
    if (window.location.hash !== "#password") return;
    const t = window.setTimeout(() => document.getElementById("password")?.scrollIntoView({ block: "center" }), 300);
    return () => window.clearTimeout(t);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      setOn(true);
      first.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  function show() {
    back.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCurrent("");
    setPassword("");
    setConfirm("");
    setChecked(false);
    setErr(null);
    setOpen(true);
  }
  function hide() {
    setOn(false);
    window.setTimeout(() => {
      setOpen(false);
      back.current?.focus({ preventScroll: true });
    }, 200);
  }

  // The form's own checks, shown once Save is pressed: length and the match.
  const shortErr = checked && password.length < 8 ? "Use at least 8 characters." : null;
  const matchErr = checked && !shortErr && confirm !== password ? "The two passwords don't match." : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setChecked(true);
    setErr(null);
    if (password.length < 8 || confirm !== password || (has && !current)) {
      if (has && !current) setErr({ text: "Type your current password.", field: "current" });
      return;
    }
    setBusy(true);
    const res = await setMyPassword({ current: has ? current : undefined, password, confirm }).catch(() => ({ ok: false as const, error: "Couldn't save the password. Try again." }));
    setBusy(false);
    if (!res.ok) {
      setErr({ text: res.error, field: "field" in res ? res.field : undefined });
      return;
    }
    setDone(res.added ? "Password added. We emailed you about it." : "Password changed. We emailed you about it.");
    setHas(true);
    onSaved?.(true);
    hide();
  }

  const fieldErr = (f: Field) => (err?.field === f ? err.text : null);
  const titleId = "pwcTitle";

  return (
    <>
      <button className={buttonClassName} type="button" onClick={show} data-password-action={has ? "change" : "add"}>
        {has ? "Change password" : "Add password"}
      </button>
      {done ? (
        <span className={s.done} role="status">
          {done}
        </span>
      ) : null}
      {open
        ? createPortal(
            <div className={s.layer + (on ? " " + s.on : "")} onKeyDown={(e) => { if (e.key === "Escape" && !busy) hide(); }}>
              <div className={s.scrim} onClick={() => (busy ? undefined : hide())} />
              <form className={s.box} role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={(e) => void save(e)} noValidate>
                <span className={s.grab} aria-hidden="true" />
                <p className={s.kick}>Account security</p>
                <h2 className={s.h} id={titleId}>{has ? "Change password" : "Add a password"}</h2>
                <p className={s.p}>
                  {has
                    ? "Type the one you have, then the new one twice."
                    : "Then you can also sign in with your email and this password. Codes from email and Google keep working."}
                </p>
                {/* The address, for a password manager to file the new password under. */}
                <input type="email" autoComplete="username" className={s.hiddenUser} tabIndex={-1} aria-hidden="true" readOnly value={email} />
                {has ? (
                  <PwInput id="pwcCurrent" label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" invalid={Boolean(fieldErr("current"))} describedBy={fieldErr("current") ? "pwcCurrentErr" : undefined} inputRef={first} />
                ) : null}
                {fieldErr("current") ? <p className={s.err} id="pwcCurrentErr" role="alert">{fieldErr("current")}</p> : null}
                <PwInput id="pwcNew" label="New password" value={password} onChange={setPassword} autoComplete="new-password" invalid={Boolean(shortErr || fieldErr("password"))} describedBy="pwcNewNote" inputRef={has ? undefined : first} />
                <p className={shortErr || fieldErr("password") ? s.err : s.note} id="pwcNewNote" aria-live="polite">
                  {shortErr ?? fieldErr("password") ?? "At least 8 characters."}
                </p>
                <PwInput id="pwcConfirm" label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" invalid={Boolean(matchErr || fieldErr("confirm"))} describedBy="pwcConfirmNote" />
                <p className={matchErr || fieldErr("confirm") ? s.err : s.note} id="pwcConfirmNote" aria-live="polite">
                  {matchErr ?? fieldErr("confirm") ?? "Type it again."}
                </p>
                {err && !err.field ? <p className={s.err} role="alert">{err.text}</p> : null}
                <div className={s.row}>
                  <button type="button" className={s.ghost} onClick={hide} disabled={busy}>
                    Cancel
                  </button>
                  <button type="submit" className={s.go} disabled={busy}>
                    {busy ? "Saving…" : has ? "Change password" : "Add password"}
                  </button>
                </div>
              </form>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
