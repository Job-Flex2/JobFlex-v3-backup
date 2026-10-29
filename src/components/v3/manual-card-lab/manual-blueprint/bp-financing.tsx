"use client";

// "Offer monthly payments" on one proposal (Wisetack, owner 2026-10-28: "in the proposal you should have a switch in
// the contractor side to offer them that button or not"). It sits at the foot of "Payment & deposits", desk and phone.
// It starts from the company's default (Settings → Payments → Financing) and locks itself, with the reason, when
// financing cannot work for this proposal. Only a saved proposal has one; outside JobFlex's switch it does not exist.

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getProposalFinancing, setProposalFinancing } from "@/actions/financing";
import type { EditorFinancing } from "@/lib/financing/view";
import { FIN, lockWords } from "@/lib/financing/words";
import styles from "./manual-blueprint.module.css";
import { cx } from "./bp-ui";

const money = (minor: number) => `$${Math.round(minor / 100).toLocaleString("en-US")}`;
const SETTINGS_HREF = "/dashboard/settings?pane=payments&sub=financing";

/** `total` only re-reads the row when the price changes. */
export function FinancingRow({ total }: { total: number }) {
  const proposalId = useSearchParams().get("proposal");
  const [row, setRow] = useState<EditorFinancing | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!proposalId) return;
    let live = true;
    const t = setTimeout(() => {
      void getProposalFinancing(proposalId)
        .then((r) => live && setRow(r))
        .catch(() => {});
    }, 600);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [proposalId, total]);

  if (!row) return null;
  const locked = !row.offer.offered && row.offer.why !== "off";
  const why = row.offer.offered ? null : row.offer.why;

  function flip() {
    if (!row || locked) return;
    const next = !row.on;
    setRow({ ...row, on: next });
    setErr("");
    void setProposalFinancing(row.proposalId, next)
      .then((r) => (r.ok ? setRow(r.row) : (setRow(row), setErr(r.error))))
      .catch(() => (setRow(row), setErr("Couldn't save — try again.")));
  }

  return (
    <div data-fin-row data-on={row.on ? "1" : "0"} data-why={why ?? ""} style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line, #e5e5e5)" }}>
      <button type="button" role="switch" aria-checked={row.on && !locked} aria-disabled={locked} disabled={locked} className={styles.toggleCell} onClick={flip}>
        <span className={cx(styles.switch, row.on && !locked && styles.switchOn)} aria-hidden="true">
          <span className={styles.knob} />
        </span>
        <span className={styles.cellText}>{FIN.proposalSwitch}</span>
      </button>
      <p style={{ margin: "6px 0 0", fontSize: 13, opacity: 0.8 }}>
        {why && why !== "off" ? (
          <>
            {lockWords(why, row.limits, money)}
            {why === "not_set_up" || why === "waiting" ? (
              <>
                {" "}
                <a href={SETTINGS_HREF}>Open Financing</a>
              </>
            ) : null}
          </>
        ) : row.on ? (
          row.preview
        ) : (
          "Clients don't see Pay over time on this proposal."
        )}
      </p>
      {row.loanLine ? (
        <p style={{ margin: "4px 0 0", fontSize: 13, fontWeight: 600 }} data-fin-loan>
          {row.loanLine}
        </p>
      ) : null}
      {row.notice ? (
        <p style={{ margin: "4px 0 0", fontSize: 13 }} role="status" data-fin-notice>
          {row.notice}
        </p>
      ) : null}
      {err ? (
        <p style={{ margin: "4px 0 0", fontSize: 13 }} role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}
