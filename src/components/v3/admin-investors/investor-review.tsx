"use client";

// THE ADMIN'S YES OR NO ON AN INVESTOR-LINK READER (owner, 2026-10-20: "don't open the link till we approve it … we
// will review their info, who they are, and will approve it, and they will get it"). The buttons on a request and on a
// reader's row, the "Approve each reader" switch, and the request a text or an email pointed to (?review=<id>) brought
// into view. The decision itself is actions/investors decideInvestorReaderAction.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideInvestorReaderAction, saveInvestorSettingsAction } from "@/actions/investors";
import s from "./investor-audience.module.css";

export function ReaderDecision({ id, name, status }: { id: string; name: string; status: "pending" | "approved" | "declined" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const decide = (decision: "approve" | "decline") =>
    start(async () => {
      setError("");
      const r = await decideInvestorReaderAction({ id, decision });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  return (
    // data-nest: the shell's button reset (bp button) leaves these alone — they are drawn here.
    <span className={s.decide} data-reader-decision={status} data-nest>
      {status !== "approved" ? (
        <button type="button" className={s.yes} disabled={pending} onClick={() => decide("approve")} aria-label={`Approve ${name}`} data-approve={id}>
          {pending ? "…" : status === "declined" ? "Approve after all" : "Approve"}
        </button>
      ) : null}
      {status === "pending" ? (
        <button type="button" className={s.no} disabled={pending} onClick={() => decide("decline")} aria-label={`Decline ${name}`} data-decline={id}>
          Decline
        </button>
      ) : null}
      {status === "approved" ? (
        <button type="button" className={s.no} disabled={pending} onClick={() => decide("decline")} aria-label={`Close access for ${name}`} data-revoke={id}>
          {pending ? "…" : "Close access"}
        </button>
      ) : null}
      {error ? <span className={s.err}>{error}</span> : null}
    </span>
  );
}

export function ApprovalSwitch({ on, waiting }: { on: boolean; waiting: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(on);
  const flip = () =>
    start(async () => {
      const next = !value;
      setValue(next);
      const r = await saveInvestorSettingsAction({ approveReaders: next });
      if (!r.ok) setValue(!next);
      else router.refresh();
    });
  return (
    <label className={s.switchRow} data-approval-switch={value ? "on" : "off"}>
      <input type="checkbox" checked={value} disabled={pending} onChange={flip} />
      <span>
        <b>Approve each reader before the figures open</b>
        <em>{value ? "On — every new reader waits for your yes; you get an email and a text." : waiting ? `Off — the link opens at once, and the ${waiting} waiting would open now.` : "Off — the link opens to anyone who says who they are."}</em>
      </span>
    </label>
  );
}

/** The request a text or an email pointed to: scrolled into view and marked for a moment. */
export function ReviewFocus({ id }: { id: string }) {
  useEffect(() => {
    const el = document.querySelector(`[data-request="${CSS.escape(id)}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.setAttribute("data-focused", "true");
    const t = window.setTimeout(() => el.removeAttribute("data-focused"), 4000);
    return () => window.clearTimeout(t);
  }, [id]);
  return null;
}
