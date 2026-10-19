"use client";
// DECK ESTIMATOR — VARIANT 2 ("the deck is the interface"), the small controls.
// Copied from deck-studio.tsx (2026-10-18) — Field, NumberInput, Seg, NameInput, CustomBox, Toggle, the field-lights
// scope and the text parsers — with the same behaviour, restyled for the inspector (plain classes under .jf-deck-v2).
//
// WHAT EVERY FIELD IS, IN 3D (owner, 2026-10-12: "highlight all fields to show on 3D what it is — make it smart"): a
// field knows where it sits — its part, the stair or fixture it is in, the lower level — and, in or over it, lights
// what it sets in the 3D (lib/deck/fieldParts). The studio holds the light; a Scope adds where.

import * as React from "react";
import { CUSTOM_LIMITS, type CustomProduct } from "@/lib/deck/design";
import type { FieldFocus } from "@/lib/deck/fieldParts";

export const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");
export const money = (n: number, cents = false) => `$${n.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`;

/** "16", "16.5", "16'6", 16' 6"" → feet. */
export function parseFeet(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const m = /^(-?\d+(?:\.\d+)?)\s*(?:'|ft|feet)?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/i.exec(t);
  if (!m) return null;
  return Number(m[1]) + (m[2] ? Number(m[2]) / 12 : 0);
}
/** Inches; a foot mark reads as feet ("3'" = 36, "3'6" = 42). */
export function parseInches(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (/['f]/i.test(t)) {
    const ft = parseFeet(t);
    return ft === null ? null : ft * 12;
  }
  const n = Number(t.replace(/("|in)$/i, ""));
  return Number.isFinite(n) ? n : null;
}
export const feetText = (ft: number) => {
  const inches = Math.round(ft * 12);
  return inches % 12 === 0 ? String(inches / 12) : `${Math.floor(inches / 12)}'${inches % 12}"`;
};
export const intText = (t: string) => (t.trim() === "" ? null : Number(t));
export const ago = (iso: string) => {
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
/** A price typed with or without the dollar sign and the commas. */
export const priceText = (t: string) => {
  const c = t.replace(/[$,\s]/g, "");
  if (c === "") return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
};
export const priceShow = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/* ── the field lights ─────────────────────────────────────────────── */

export interface FieldScopeValue {
  where: Omit<FieldFocus, "label">;
  light: ((f: FieldFocus, how: "focus" | "hover") => void) | null;
  unlight: ((f: FieldFocus, how: "focus" | "hover") => void) | null;
}
export const FieldScope = React.createContext<FieldScopeValue>({ where: {}, light: null, unlight: null });
export function Scope({ step, stair, fixture, level, children }: { step?: string; stair?: string; fixture?: string; level?: "lower"; children: React.ReactNode }) {
  const parent = React.useContext(FieldScope);
  const value = React.useMemo<FieldScopeValue>(
    () => ({ ...parent, where: { ...parent.where, ...(step ? { step } : {}), ...(stair ? { stair } : {}), ...(fixture ? { fixture } : {}), ...(level ? { level } : {}) } }),
    [parent, step, stair, fixture, level],
  );
  return <FieldScope.Provider value={value}>{children}</FieldScope.Provider>;
}

export type Lights = { on: (how: "focus" | "hover") => void; off: (how: "focus" | "hover") => void };
/** A field's (or a tick's) lights: its own, or lit by its label where it sits. */
function useFieldLights(label: string, own?: Lights): Lights | undefined {
  const scope = React.useContext(FieldScope);
  const { light: lightOn, unlight } = scope;
  if (own) return own;
  if (!lightOn || !unlight || !label) return undefined;
  return { on: (how) => lightOn({ ...scope.where, label }, how), off: (how) => unlight({ ...scope.where, label }, how) };
}
/** A label's words, from children that mix words and numbers ("Fascia on the eaves (", 42, " ft)"). */
const wordsOf = (n: React.ReactNode): string => (typeof n === "string" || typeof n === "number" ? String(n) : Array.isArray(n) ? n.map(wordsOf).join("") : "");

/* ── the controls ─────────────────────────────────────────────────── */

/** `lights={null}`: the field lights nothing. A pointer that crosses a field with a button held is a drag, not a look. */
export function Field({ label, aside, children, wide, lights: own }: { label: string; aside?: React.ReactNode; children: React.ReactNode; wide?: boolean; lights?: Lights | null }) {
  const lit = useFieldLights(label, own ?? undefined);
  const lights = own === null ? undefined : lit;
  return (
    <label
      className={cx("v2-field", wide && "v2-field-wide")}
      onFocus={lights ? () => lights.on("focus") : undefined}
      onBlur={lights ? () => lights.off("focus") : undefined}
      onMouseEnter={lights ? (e) => { if (!e.buttons) lights.on("hover"); } : undefined}
      onMouseLeave={lights ? () => lights.off("hover") : undefined}
    >
      <span className="v2-lbl">
        <span>{label}</span>
        {aside ? <span className="v2-lbl-aside">{aside}</span> : null}
      </span>
      {children}
    </label>
  );
}

/** A number typed freely: committed while it is inside its rails, and on leaving the field (held to them). */
export function NumberInput({ value, onCommit, parse, format, min, max, label }: { value: number; onCommit: (n: number) => void; parse: (t: string) => number | null; format: (n: number) => string; min: number; max: number; label: string }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  return (
    <input
      className="v2-in v2-num"
      inputMode="decimal"
      aria-label={label}
      value={draft ?? format(value)}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        const n = parse(text);
        if (n !== null && n >= min && n <= max) onCommit(n);
      }}
      onBlur={() => {
        if (draft === null) return;
        const n = parse(draft);
        if (n !== null) onCommit(Math.min(max, Math.max(min, n)));
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: ReadonlyArray<{ value: T; label: string; title?: string }>; onChange: (v: T) => void; label: string; small?: boolean }) {
  return (
    <div className="v2-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} title={o.title} className={cx("v2-seg-btn", o.value === value && "is-on")} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A name typed freely: committed while it has letters in it, the draft shown until the field is left (so the spaces
 * survive the typing). An emptied field keeps the last name unless `allowEmpty`. `focusNow` puts the cursor in it.
 */
export function NameInput({ value, onCommit, label, placeholder, allowEmpty, focusNow, onDone }: { value: string; onCommit: (v: string) => void; label: string; placeholder?: string; allowEmpty?: boolean; focusNow?: boolean; onDone?: () => void }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (!focusNow || !ref.current) return;
    ref.current.focus({ preventScroll: true });
    ref.current.select();
  }, [focusNow]);
  return (
    <input
      ref={ref}
      className="v2-in"
      aria-label={label}
      placeholder={placeholder}
      maxLength={CUSTOM_LIMITS.name}
      value={draft ?? value}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        const clean = text.replace(/\s+/g, " ").trim();
        if (clean || allowEmpty) onCommit(clean);
      }}
      onBlur={() => {
        setDraft(null);
        onDone?.();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** The last choice on every material list (owner, 2026-10-12: "always an option custom in case the contractor didn't find it"). */
export const CUSTOM = "__custom";
export const CUSTOM_LABEL = "Custom — type your own…";

/** A product the list doesn't carry: its name and the shop's price for it, in the list's unit. */
export function CustomBox({ slot, title, product, unit, onChange, onBack, children, note, fresh, onDone }: { slot: string; title: string; product: CustomProduct; unit: string | null; onChange: (p: CustomProduct) => void; onBack: () => void; children?: React.ReactNode; note?: React.ReactNode; fresh?: boolean; onDone?: () => void }) {
  return (
    <div className="v2-custom" data-deck-custom={slot}>
      <div className="v2-custom-head">
        <span className="v2-custom-tag">Your own · {title}</span>
        <button type="button" className="v2-btn v2-btn-sm" onClick={onBack} data-deck-custom-back={slot}>
          Back to the list
        </button>
      </div>
      <div className="v2-grid2">
        <Field label="Product" wide={!unit}>
          <NameInput label={`${title}: your product's name`} value={product.name} placeholder="Brand, line, size" focusNow={fresh} onDone={onDone} onCommit={(name) => onChange({ ...product, name })} />
        </Field>
        {unit ? (
          <Field label="Your price" aside={`$ per ${unit}`}>
            <NumberInput label={`${title}: your price per ${unit}`} value={product.price} parse={priceText} format={priceShow} min={CUSTOM_LIMITS.price.min} max={CUSTOM_LIMITS.price.max} onCommit={(price) => onChange({ ...product, price })} />
          </Field>
        ) : null}
        {children}
      </div>
      {note ? <p className="v2-hint">{note}</p> : null}
    </div>
  );
}

export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  const lights = useFieldLights(wordsOf(children).trim());
  return (
    <label
      className="v2-toggle"
      onFocus={lights ? () => lights.on("focus") : undefined}
      onBlur={lights ? () => lights.off("focus") : undefined}
      onMouseEnter={lights ? (e) => { if (!e.buttons) lights.on("hover"); } : undefined}
      onMouseLeave={lights ? () => lights.off("hover") : undefined}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="v2-toggle-box" aria-hidden="true" />
      <span>{children}</span>
    </label>
  );
}

/** A folded group inside a part's settings: its name and, folded, what it is set to now. */
export function Fold({ title, sub, children, open, id }: { title: string; sub?: string; children: React.ReactNode; open?: boolean; id?: string }) {
  return (
    <details className="v2-fold" open={open} data-v2-fold={id}>
      <summary>
        <span className="v2-fold-title">{title}</span>
        {sub ? <span className="v2-fold-sub">{sub}</span> : null}
      </summary>
      <div className="v2-fold-body">{children}</div>
    </details>
  );
}
