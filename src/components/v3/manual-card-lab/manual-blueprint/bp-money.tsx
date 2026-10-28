"use client";

// MANUAL PROPOSAL / BLUEPRINT — "Payment & deposits".
//
// ── THE RECEIPT LEFT THIS CARD ───────────────────────────────
// This card used to open with the whole money chain — subtotal, discount, tax,
// grand total — printed above the deposit fields. It does not any more. The
// Markup & margin card now owns every figure between the line items and the
// amount the client pays, INCLUDING discount and tax, and it ends on the grand
// total. Printing that same four-row chain again here was the "one number, four
// places" failure at its worst: the same arithmetic, in two cards, a scroll
// apart, with no way for a reader to know which one was authoritative.
//
// What is left is the only question this card was ever really asking: the total
// is $X — WHEN is it paid? The schedule divides a figure produced elsewhere, and
// the coverage meter reports whether the division adds up.
//
// ── THE TOTAL IS STILL PRINTED ONCE, AND ONLY ONCE ───────────
// In the meter's "scheduled $X of $Y" line, which is the one honest reason to
// repeat it: a coverage reading with a single figure in it means nothing. It
// stays at value size, never display size, so it cannot compete with the grand
// total on the card above or with the persistent bar at the foot of the page.
//
// Status colour appears on the coverage reading — meter fill, meter note and the
// percentage readout, which are one reading in three places — and nowhere else.

import { isLockedInstallment, type Installment } from "../manual-focus/manual-focus-types";
import {
  money,
} from "../manual-focus/manual-focus-math";
import styles from "./manual-blueprint.module.css";
import m from "./bp-money.module.css";
import { Btn, Ic, NumField, cx } from "./bp-ui";
import { FinancingRow } from "./bp-financing";
import { scheduleCoverage, unitTogglePatches } from "@/lib/paymentSchedule";

/* ============================================================
   THE SCHEDULE
   ============================================================ */

const NOTE: Record<string, string> = {
  none: "Nothing scheduled yet.",
  exact: "Covers the total exactly.",
};

/* THE DOLLAR COLUMN used to be derived here, with the last row absorbing the
   rounding so three independently rounded percentages could not print a cent
   more than the total the client signs. Both halves of that job now belong to
   lib/paymentSchedule: its largest-remainder split makes the column add up to
   the cent by construction, and it is the only arithmetic that knows a PAID
   stage is frozen at what it collected. The local pass could not — it rounded
   a percentage of the CURRENT total even for a paid stage, and its remainder
   landed on whichever row came last, paid or not. */

export function PaymentBlock({
  installments,
  total,
  pctBase,
  onPatch,
  onAdd,
  onRemove,
}: {
  installments: Installment[];
  /** The CONTRACT the schedule has to cover: this proposal plus every approved
   *  change order (lib/contractTotal). A change order arrives as its own stage,
   *  so measuring it against the proposal alone read "over by the change
   *  order". */
  total: number;
  /** What a percent stage is a percentage OF — the proposal's own total. A
   *  change order raises what is owed without touching the 30/70 split, which
   *  is the rule resolveSchedule keeps. Defaults to `total` for a proposal
   *  with no change orders, where the two are the same number. */
  pctBase?: number;
  onPatch: (id: string, patch: Partial<Installment>) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  // ONE reading of the schedule, taken from the module that resolves money
  // (lib/paymentSchedule), and everything else on this block is a presentation
  // of it: the column, the meter fill and the note under it. A settled stage
  // counts for what it COLLECTED — the card and the rows it prints agree.
  const coverage = scheduleCoverage(installments, total, pctBase ?? total);
  const state = coverage.state;
  const values = coverage.values;

  // The covered figure is the sum of the column the user can SEE, not a second
  // pass over the installments — so the meter can never disagree with the rows
  // above it. For every state but "exact" this is `coveredAmount` by
  // construction; for "exact" it is the total, which is the whole point of the
  // remainder.
  const covered = coverage.covered;
  const ratio = total > 0 ? Math.min(covered / total, 1) : 0;

  const note =
    state === "under"
      ? `${money(total - covered)} still unscheduled.`
      : state === "over"
        ? `${money(covered - total)} more than the total.`
        : (NOTE[state] ?? "");

  return (
    <div className={m.payment}>
      {/* ONE COVERAGE READING, NOT TWO. A "%-filled" chip used to sit on this
          line restating what the meter at the foot of the block already says
          in money — the same fact in two units, eight rows apart, and the one
          in the header was the weaker of the two (a percentage of a figure it
          did not print). The meter keeps the job: it states the shortfall or
          the overage in dollars, which is the unit the shortfall is actually
          settled in. The per-row percentage INPUTS are untouched. */}
      <div className={m.schedHead}>
        <h3 className={m.schedTitle}>Payment schedule</h3>
      </div>

      {installments.map((inst, i) => (
        <div key={inst.id} className={cx(m.instRow, i === 0 && m.instFirst)}>
          <input
            type="text"
            className={styles.input}
            value={inst.label}
            placeholder="When is this due?"
            aria-label="Payment stage"
            onChange={(e) => onPatch(inst.id, { label: e.target.value })}
          />
          {isLockedInstallment(inst) ? (
            <>
              {/* Paid (or being paid): the amount is frozen at what landed. */}
              <span className={m.amtField} aria-label="Locked stage">
                <span className={styles.input} style={{ opacity: 0.7 }}>
                  {inst.status === "PAID" && inst.paidAmount != null
                    ? `$${inst.paidAmount.toFixed(2)}`
                    : `${inst.amount}${inst.isPercent ? "%" : ""}`}
                </span>
              </span>
              <span className={m.del} aria-hidden="true" style={{ visibility: "hidden" }} />
              <span className={m.instValue}>
                {inst.status === "PAID" ? "Paid" : inst.status === "WAIVED" ? "Closed" : "Paying"}
              </span>
            </>
          ) : (
          <>
          {/* ONE CONTROL, TWO UNITS, and the unit now lives INSIDE the field as
              an affix — the treatment the discount and tax fields already use.
              It was a ~100px bordered box holding a single static character,
              which reads as a field somebody forgot to fill in. */}
          <span className={m.amtField}>
            <NumField
              value={inst.amount}
              onChange={(n) => onPatch(inst.id, { amount: n })}
              ariaLabel={inst.isPercent ? "Stage percentage" : "Stage amount"}
            />
            <button
              type="button"
              className={m.unitBtn}
              aria-label={inst.isPercent ? "Switch to dollars" : "Switch to percent"}
              onClick={() => {
                // The unit and the VALUE move together — the conversion lives in
                // manual-focus-math (applyUnitToggle) so all six skins share it.
                //
                // It converts against the PERCENT BASE, not the contract. On a
                // proposal with an approved change order the two differ, and the
                // contract is the wrong one: a "100%" stage is 100% of the
                // proposal ($45,368), not of the proposal plus the order
                // ($47,488) — that is the rule resolveSchedule resolves the
                // column by, and the same `pctBase` the meter above measures
                // with. Handing `total` here made the toggle print the change
                // order twice and the card read "over by the change order".
                for (const p of unitTogglePatches(installments, inst.id, !inst.isPercent, pctBase ?? total)) {
                  onPatch(p.id, p.patch);
                }
              }}
            >
              {inst.isPercent ? "%" : "$"}
            </button>
          </span>
          {/* Left of the figure, not right of it. The money column is the last
              thing in the row so it lands on the same axis as the ledger's. */}
          <button
            type="button"
            className={m.del}
            aria-label={inst.label.trim() ? `Remove ${inst.label.trim()}` : "Remove payment stage"}
            onClick={() => onRemove(inst.id)}
          >
            <Ic name="trash" />
          </button>
          <span className={m.instValue}>{money(values[i] ?? 0)}</span>
          </>
          )}
        </div>
      ))}

      {installments.length === 0 ? (
        <div className={styles.empty}>No stages — the balance is due on completion.</div>
      ) : null}

      {/* DIRECTLY UNDER THE ROWS IT ADDS TO. Parked below the coverage meter it
          read as a footer on the block, and the review concluded a fourth
          payment stage was not possible at all. */}
      <div className={m.addWrap}>
        <Btn tone="add" icon="plus" onClick={onAdd}>
          Add a payment stage
        </Btn>
      </div>

      <div className={m.meter}>
        {/* "scheduled $X of $Y" — the one place this card repeats the grand
            total, because a coverage reading with one figure in it says
            nothing. The joining word is a real gap, not a space: two tabular
            money figures butted against a two-letter word read as one long
            string of digits, and the eye needs the seam to find the second
            figure. */}
        <div className={m.meterTop}>
          <span className={m.meterLabel}>Scheduled</span>
          <span className={m.meterFig}>
            {money(covered)}
            <span className={m.meterOf}>of</span>
            {money(total)}
          </span>
        </div>
        <div
          className={styles.meterTrack}
          role="meter"
          aria-label="Payment coverage"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={covered}
        >
          <div
            className={cx(
              styles.meterFill,
              state === "under" && styles.fillUnder,
              state === "exact" && styles.fillExact,
              state === "over" && styles.fillOver,
            )}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
        <div
          className={cx(
            m.meterNote,
            state === "under" && m.noteUnder,
            state === "exact" && m.noteExact,
            state === "over" && m.noteOver,
          )}
        >
          {note}
        </div>
      </div>
      {/* Wisetack financing (2026-10-28): offer monthly payments on this proposal, or not. */}
      <FinancingRow total={total} />
    </div>
  );
}
