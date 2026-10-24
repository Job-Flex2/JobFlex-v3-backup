"use client";

/* THE INVOICE SHEET — one form, every surface.
 *
 * Invoicing used to live only on the Proposals rail, driven by that page's own
 * DOM code. The Financials page now raises invoices too, on the desk and on a
 * phone, and all three ask for exactly the same two things: WHICH proposal,
 * and HOW the client may pay. So the form is a component (the ChangeOrderSheet
 * precedent — one sheet mounted from the job, the proposal and now here),
 * rather than a second and third copy of the same two fields.
 *
 * It bills the balance still owing (`installmentId: null`), which is what
 * `sendInstallmentInvoice` does with no stage named, and it only offers a rail
 * the shop can actually take money on (`getInvoiceOptions`).
 *
 * Drawn as a BlueprintSheet (2026-09-19): the Financials page's own "Add an
 * expense" dialog — caps title, mono kickers, ink fields, CANCEL / SEND
 * INVOICE. It used to be the Tailwind side panel, rendered in place, and the
 * blueprint page's `.content` resets stripped it to bare selects and text
 * buttons; the sheet now portals out of that scope and carries its own
 * stylesheet. Same state, same actions, same two questions.
 */

import * as React from "react";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import { toast } from "@/components/ui/toast-store";
import { getInvoiceOptions, sendInstallmentInvoice } from "@/actions/notify";

export interface InvoiceTarget {
  /** Proposal id — what the invoice is raised against. */
  id: string;
  /** What the picker shows: the client and the proposal's own label. */
  label: string;
  /** What that contract still owes, in dollars. Shown under the picker so the
   *  office sees the figure before it sends, since this sheet bills the
   *  balance rather than a named stage. */
  owed?: number;
}

type Method = "card" | "bank" | "any";

export function InvoiceSheet({
  open,
  onClose,
  targets,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  /** The proposals this surface can invoice. One entry = no picker. */
  targets: InvoiceTarget[];
  /** After a successful send — the caller reloads its ledger. */
  onSent?: () => void;
}) {
  const [picked, setPicked] = React.useState("");
  /** The caller's list can arrive after the first render, so the choice is
   *  derived rather than synced: whatever was picked, if it is still on the
   *  list, else the first entry. */
  const proposalId = targets.some((t) => t.id === picked) ? picked : targets[0]?.id ?? "";
  const owed = targets.find((t) => t.id === proposalId)?.owed;
  const [method, setMethod] = React.useState<Method>("any");
  const [rails, setRails] = React.useState<{ card: boolean; bank: boolean } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");

  // The rails the shop can actually take money on, read once per opening.
  React.useEffect(() => {
    if (!open || rails) return;
    let alive = true;
    void getInvoiceOptions()
      .then((o) => {
        if (!alive) return;
        setRails({ card: o.card, bank: o.bank });
        setMethod(o.card ? "card" : o.bank ? "bank" : "any");
      })
      .catch(() => {
        if (alive) setRails({ card: false, bank: false });
      });
    return () => {
      alive = false;
    };
  }, [open, rails]);

  const close = () => {
    if (busy) return;
    setErr("");
    onClose();
  };

  async function send() {
    if (!proposalId) {
      setErr("Pick the proposal to invoice.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const res = await sendInstallmentInvoice(proposalId, null, method);
      if (!res.ok) {
        setErr(res.error ?? "The invoice could not be sent.");
        return;
      }
      // Say what actually reached the client — a proposal with no email on
      // file still raises the invoice, and the contractor should know.
      const where = [res.email === "sent" ? "emailed" : null, res.sms === "sent" ? "texted" : null].filter(Boolean).join(" and ");
      // The number is the row it just wrote into the Invoices tab — name it,
      // so the contractor knows what to look for there.
      toast.success(res.number ? `${res.number} sent` : "Invoice sent", `${res.label} · $${res.amount.toLocaleString("en-US")}${where ? ` · ${where}` : " · no contact on file"}`);
      onSent?.();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The invoice could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <BlueprintSheet
      open={open}
      onClose={close}
      title="Send an invoice"
      description="Bills the balance still owing on the proposal, on the rail you pick"
      width="min(420px, 100%)"
      footer={
        <>
          <button className="bps-btn bps-btn--ghost" type="button" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button className="bps-btn bps-btn--primary" type="button" onClick={() => void send()} disabled={busy || !proposalId}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 2L11 13" />
              <path d="M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
            <span>{busy ? "Sending…" : "Send invoice"}</span>
          </button>
        </>
      }
    >
      {targets.length === 0 ? (
        <p className="bps-note">
          Nothing to bill: no accepted contract has a balance owing. Accept a proposal first, and it
          appears here.
        </p>
      ) : (
        <div className="bps-form">
          <label className="bps-fld bps-fld--wide">
            <span>Proposal</span>
            <select className="bps-in" value={proposalId} onChange={(e) => setPicked(e.target.value)} disabled={busy}>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            {owed != null ? (
              <span className="bps-hint">
                Balance owing: ${owed.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </span>
            ) : null}
          </label>

          <label className="bps-fld bps-fld--wide">
            <span>Pay by</span>
            <select className="bps-in" value={method} onChange={(e) => setMethod(e.target.value as Method)} disabled={busy}>
              {rails?.card !== false && <option value="card">Card</option>}
              {rails?.bank !== false && <option value="bank">Bank transfer</option>}
              <option value="any">Let the client choose</option>
            </select>
          </label>

          {err ? (
            <p className="bps-err" role="alert">
              {err}
            </p>
          ) : null}
        </div>
      )}
    </BlueprintSheet>
  );
}
