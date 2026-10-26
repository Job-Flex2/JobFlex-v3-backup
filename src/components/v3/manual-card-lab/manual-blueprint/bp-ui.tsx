"use client";

// MANUAL PROPOSAL / BLUEPRINT — the primitive layer.
//
// Ported from the "Quiet" variant (/dashboard/manual-quiet) and re-skinned into
// the house system. The COMPONENT SHAPES are unchanged on purpose: they are
// what made that build calm, and none of them is a styling decision. What
// changed is which controls are borrowed rather than drawn — see `Select`.
//
// Everything in this file exists to make de-emphasis the DEFAULT. A label that
// is hard to make loud, a card head with nowhere to hang a badge, and a button
// whose base weight is "quiet" are cheaper guarantees than a review checklist.
//
// Three decisions worth stating:
//
// 1. `Card` takes a number and a title and NOTHING else — no description slot,
//    no badge slot, no trailing chip. The rejected build wore a status pill on
//    every card head ("Titled", "On file", "Balanced") and the sum of ten of
//    them was noise, so the shape of this component simply cannot express one.
//
// 2. `NumField` keeps a local string buffer while it is focused. Committing
//    Number(e.target.value) straight to state re-renders "0." as "0" and makes
//    it literally impossible to type "0.62" — the buffer is what makes a
//    controlled numeric input behave like an uncontrolled one for the duration
//    of a keystroke run, and it is dropped on blur so the formatter wins again.
//
// 3. `Select` renders the SHARED `.bp-sel` / `.bp-sel-in` control, not a local
//    one. The donor variant hand-rolled `appearance: none` plus its own chevron
//    span; decisions.md names that as drift — there is exactly one styled
//    select in this codebase and the wrapper owns the caret, because a
//    `<select>` cannot carry a pseudo-element.

import { useId, useState } from "react";
import styles from "./manual-blueprint.module.css";

/** Local class joiner. Deliberately NOT `@/lib/cn`: that runs twMerge, which
 *  has opinions about Tailwind utilities and no business near a hashed
 *  CSS-module name. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** One symbol from the shell's sprite (mounted once by blueprint-shell).
 *  `.ic` is the shell's global icon class — 24x24 grid, stroke 2,
 *  currentColor. Size overrides live in the module, written with enough
 *  classes to beat `.bp :global(svg.ic)`. */
export function Ic({ name }: { name: string }) {
  return (
    <svg className="ic" aria-hidden="true" focusable="false">
      <use href={`#i-${name}`} />
    </svg>
  );
}

/* ============================================================
   CARD
   ============================================================ */

// The surface trial (white / light beige / deep beige, cycled down the column)
// is finished — white won everywhere, so it is a plain `.card` background now
// and this component is back to knowing nothing about colour.

export function Card({
  num,
  title,
  id,
  sheet,
  wide,
  children,
}: {
  num: string;
  title: string;
  id: string;
  /** Card 10 only: the printed document reads as a sheet, not as a form. */
  sheet?: boolean;
  /**
   * Card 03 only: the body holds something that is legitimately wider than a
   * phone (the seven-column priced table) and must scroll INSIDE the card at
   * handheld width instead of taking the whole column sideways with it.
   *
   * A flag rather than a blanket rule on every body, because a scroll container
   * clips — the two pickers in cards 01 and 02 hang their popovers outside the
   * body, and those cards must not get one. See the handheld block in the
   * stylesheet.
   */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      data-tour={`proposal-card-${num}`}
      // The reveal cascade collects `[data-rv]` rather than walking
      // `.content.children`: this page renders ONE wrapper element, so a
      // children-walk would animate the whole column as a single block and
      // there would be no cascade at all. See ./use-reveal.ts.
      data-rv=""
      className={cx(styles.card, sheet && styles.cardSheet)}
      aria-labelledby={`${id}-t`}
    >
      <header className={styles.cardHead}>
        <span className={styles.num}>{num}</span>
        <h2 id={`${id}-t`} className={styles.cardTitle}>
          {title}
        </h2>
      </header>
      <div className={cx(styles.body, wide && styles.bodyWide)}>{children}</div>
    </section>
  );
}

/** A block of related fields. 16px inside, 32px between blocks — the two
 *  distances that do all the grouping this page has. */
export function Group({ children }: { children: React.ReactNode }) {
  return <div className={styles.group}>{children}</div>;
}

export function Pair({ children }: { children: React.ReactNode }) {
  return <div className={styles.grid2}>{children}</div>;
}

export function SubHead({ children }: { children: React.ReactNode }) {
  return <div className={styles.subHead}>{children}</div>;
}

/* ============================================================
   FIELDS
   ============================================================ */

/**
 * Label + control + optional ≤6-word hint.
 *
 * The label is a real `<label for>` when there is a control id to point at and
 * a plain span otherwise — a `<label>` wrapping a popover trigger is associated
 * with nothing, and the screen reader just orphans the word.
 */
export function Field({
  label,
  hint,
  htmlFor,
  small,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  small?: boolean;
  children: React.ReactNode;
}) {
  const cls = small ? styles.labelSm : styles.label;
  return (
    <div className={styles.field}>
      {htmlFor ? (
        <label className={cls} htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className={cls}>{label}</span>
      )}
      {children}
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </div>
  );
}

export function TextField({
  id,
  value,
  onChange,
  placeholder,
  ariaLabel,
  inputRef,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  /** For the one field that has to be focused by hand — the client name in
   *  free-text mode, which REPLACES the picker trigger that opened it. Moving
   *  focus into a control that supplants its own trigger is the only way a
   *  keyboard user does not land on <body>. */
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <input
      id={id}
      ref={inputRef}
      type="text"
      className={styles.input}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function TextArea({
  id,
  value,
  onChange,
  rows = 4,
  placeholder,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <textarea
      id={id}
      className={styles.textarea}
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function Select<T extends string>({
  id,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  id?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    // Both class names are global strings on purpose — they are published by
    // blueprint-global.css and must NOT be hashed through the module.
    <span className={cx("bp-sel", styles.selWrap)}>
      <select
        id={id}
        className="bp-sel-in"
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

/** Numeric entry with an optional in-box affix. See the buffer note at the top
 *  of this file for why `buf` exists. */
export function NumField({
  id,
  value,
  onChange,
  prefix,
  suffix,
  ariaLabel,
  max,
}: {
  id?: string;
  value: number;
  onChange: (n: number) => void;
  prefix?: string;
  suffix?: string;
  ariaLabel?: string;
  max?: number;
}) {
  const [buf, setBuf] = useState<string | null>(null);
  const shown = buf ?? String(value);

  return (
    <span className={cx(styles.numWrap, prefix && styles.hasPre, suffix && styles.hasSuf)}>
      {prefix ? <span className={cx(styles.affix, styles.affixPre)}>{prefix}</span> : null}
      <input
        id={id}
        type="text"
        inputMode="decimal"
        className={styles.input}
        value={shown}
        aria-label={ariaLabel}
        onChange={(e) => {
          const raw = e.target.value;
          setBuf(raw);
          if (raw.trim() === "") {
            onChange(0);
            return;
          }
          const n = Number(raw);
          if (Number.isFinite(n) && n >= 0) onChange(max != null ? Math.min(n, max) : n);
        }}
        onBlur={() => setBuf(null)}
      />
      {suffix ? <span className={cx(styles.affix, styles.affixSuf)}>{suffix}</span> : null}
    </span>
  );
}

/* ============================================================
   BUTTONS
   ============================================================ */

export function Btn({
  children,
  onClick,
  tone = "plain",
  icon,
  type = "button",
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tone?: "plain" | "primary" | "quiet" | "add" | "danger";
  icon?: string;
  type?: "button" | "submit";
  /** Set while a write is in flight, and while the sheet is not savable. The
   *  page never hides an action it cannot run — a button that vanishes mid-form
   *  is harder to reason about than one that is visibly unavailable. */
  disabled?: boolean;
  /** The reason it is unavailable, when it is. */
  title?: string;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      title={title}
      className={cx(
        styles.btn,
        tone === "primary" && styles.btnPrimary,
        tone === "quiet" && styles.btnQuiet,
        tone === "add" && styles.btnAdd,
        tone === "danger" && styles.btnDanger,
      )}
      onClick={onClick}
    >
      {icon ? <Ic name={icon} /> : null}
      {children}
    </button>
  );
}

export function IconBtn({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={styles.iconBtn} aria-label={label} onClick={onClick}>
      <Ic name={icon} />
    </button>
  );
}

/* ============================================================
   TOGGLES
   The whole row is the control — that is how a 22px plate gets a
   56px target without drawing a 56px plate.

   `switch` / `knob` keep their names, but the module draws them as
   a square CHECK PLATE, not a pill: a 22px ink box that fills
   blueprint and takes a drawn check. A 13px-radius capsule is the
   soft-SaaS shape this aesthetic is defined against, and `knob` is
   the checkmark itself — two borders of a box, rotated 45° — not a
   sliding dot.
   ============================================================ */

export function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={styles.toggleRow}
      onClick={() => onChange(!on)}
    >
      <span className={styles.toggleText}>{label}</span>
      <span className={cx(styles.switch, on && styles.switchOn)} aria-hidden="true">
        <span className={styles.knob} />
      </span>
    </button>
  );
}

/**
 * The same switch, laid out for a COLUMN instead of a full-width row.
 *
 * `Toggle` puts the label and the switch at opposite ends of the measure, which
 * is right when a row spans the card and wrong the moment three of them sit
 * side by side: at a third of the width the label and the switch collide, and
 * the eye has to travel a different distance in each column to connect them.
 * Stacked — switch first, label under it — the pairing is vertical, identical in
 * all three cells, and the label gets the full cell width to wrap into.
 *
 * Switch ABOVE label, not below: the switch is the thing being scanned (three
 * on/off states read as one row of plates), and the label is what you drop to
 * once a plate has caught your eye.
 */
export function ToggleCell({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={styles.toggleCell}
      onClick={() => onChange(!on)}
    >
      <span className={cx(styles.switch, on && styles.switchOn)} aria-hidden="true">
        <span className={styles.knob} />
      </span>
      <span className={styles.cellText}>{label}</span>
    </button>
  );
}

export function Segmented<T extends string>({
  label,
  hideLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  /**
   * Drop the visible label and let the control take the full measure — for the
   * case where a card heading directly above it already names the thing (the
   * Discount card's Dollar / Percent switch).
   *
   * The label is NOT dropped, only hidden: the `radiogroup` still needs an
   * accessible name, and "two unnamed radios" is a materially worse control for
   * a screen reader than a slightly redundant one. This is why the prop is
   * `hideLabel` and not an optional `label` — a required label that can be
   * hidden cannot be forgotten.
   */
  hideLabel?: boolean;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const groupId = useId();
  return (
    <div className={cx(styles.segRow, hideLabel && styles.segRowBare)}>
      <span className={cx(hideLabel ? styles.srOnly : styles.toggleText)} id={groupId}>
        {label}
      </span>
      <div
        className={cx(styles.seg, hideLabel && styles.segFull)}
        role="radiogroup"
        aria-labelledby={groupId}
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className={cx(styles.segBtn, value === o.value && styles.segBtnOn)}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   DERIVED FIGURE ROWS
   ============================================================ */

export function DRow({
  label,
  value,
  lead,
}: {
  label: string;
  value: string;
  /** The one figure in the block that is allowed to be bigger. */
  lead?: boolean;
}) {
  return (
    <div className={cx(styles.dRow, lead && styles.dRowLead)}>
      <span className={styles.dLabel}>{label}</span>
      <span className={cx(styles.dValue, lead && styles.dValueLead)}>{value}</span>
    </div>
  );
}
