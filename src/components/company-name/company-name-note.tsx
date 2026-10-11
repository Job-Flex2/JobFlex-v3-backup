"use client";

// Under the company page's name field while the name is the passwordless
// sign-up's stand-in (lib/orgName): what it is, and "Keep this name" for the
// owner who trades under their own name. Typing a new name hides it (the save
// clears the mark — actions/company updateBranding). Also answers the
// `#company-name` links from the dashboard banner and the daily email:
// scrolls the field into view and puts the cursor in it.
import * as React from "react";
import { setCompanyName } from "@/actions/companyName";
import s from "./company-name-note.module.css";

export function CompanyNameNote({ inputId, unset, canEdit = true }: { inputId: string; unset: boolean; canEdit?: boolean }) {
  const [show, setShow] = React.useState(unset);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    const el = document.getElementById(inputId) as HTMLInputElement | null;
    if (!el) return;
    const start = el.value;
    const onInput = () => {
      if (el.value.trim() && el.value.trim() !== start.trim()) setShow(false);
    };
    el.addEventListener("input", onInput);
    if (window.location.hash === "#company-name") {
      window.setTimeout(() => {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.focus({ preventScroll: true });
        el.select();
      }, 350);
    }
    return () => el.removeEventListener("input", onInput);
  }, [inputId]);

  if (!show) return null;

  async function keep() {
    const el = document.getElementById(inputId) as HTMLInputElement | null;
    setBusy(true);
    setErr(null);
    const res = await setCompanyName(el?.value ?? "").catch(() => ({ ok: false as const, error: "Couldn't save. Try again." }));
    setBusy(false);
    if (res.ok) setShow(false);
    else setErr(res.error);
  }

  return (
    <span className={s.note} role="status" data-company-name-note>
      <b>Not set yet</b> — this is your own name for now. Clients see it on proposals, emails and texts.
      {canEdit ? (
        <>
          {" "}
          <button type="button" className={s.keep} onClick={() => void keep()} disabled={busy}>
            {busy ? "Saving…" : "Keep this name"}
          </button>
        </>
      ) : null}
      {err ? <span className={s.err}> {err}</span> : null}
    </span>
  );
}
