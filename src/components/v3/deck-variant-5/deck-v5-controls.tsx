"use client";
// DECK ESTIMATOR — VARIANT 5 ("start from the deck people ask for"), its small controls.
//
// Copied from deck-studio.tsx (2026-10-18): the field scope that lights in the 3D what a field sets (lib/deck/fieldParts),
// the free-typed number and name inputs, the segmented switch, the tick, the box for a product of the shop's own. Their
// behaviour is the live studio's, word for word; only the classes are this variant's (deck-variant-5.css, all under
// `.jf-deck-v5`). Two are new here: the Stepper (a big number with − and + for the few sizes that usually change) and
// More (a named disclosure that says what is set inside it while closed).

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

/* ── what every field is, in 3D (copied from deck-studio.tsx) ── */
export interface FieldScopeValue {
  where: Omit<FieldFocus, "label">;
  light: ((f: FieldFocus, how: "focus" | "hover") => void) | null;
  unlight: ((f: FieldFocus, how: "focus" | "hover") => void) | null;
}
export const FieldScope = React.createContext<FieldScopeValue>({ where: {}, light: null, unlight: null });
/** Where the fields inside sit: the step id the 3D's lights know (lib/deck/fieldParts), a stair, a fixture, the lower level. */
export function Scope({ step, stair, fixture, level, children }: { step?: string; stair?: string; fixture?: string; level?: "lower"; children: React.ReactNode }) {
  const parent = React.useContext(FieldScope);
  const value = React.useMemo<FieldScopeValue>(
    () => ({ ...parent, where: { ...parent.where, ...(step ? { step } : {}), ...(stair ? { stair } : {}), ...(fixture ? { fixture } : {}), ...(level ? { level } : {}) } }),
    [parent, step, stair, fixture, level],
  );
  return <FieldScope.Provider value={value}>{children}</FieldScope.Provider>;
}

export type Lights = { on: (how: "focus" | "hover") => void; off: (how: "focus" | "hover") => void };
function useFieldLights(label: string, own?: Lights): Lights | undefined {
  const scope = React.useContext(FieldScope);
  const { light: lightOn, unlight } = scope;
  if (own) return own;
  if (!lightOn || !unlight || !label) return undefined;
  return { on: (how) => lightOn({ ...scope.where, label }, how), off: (how) => unlight({ ...scope.where, label }, how) };
}
const wordsOf = (n: React.ReactNode): string => (typeof n === "string" || typeof n === "number" ? String(n) : Array.isArray(n) ? n.map(wordsOf).join("") : "");

/** A labelled field. `lights={null}`: it lights nothing in the 3D. A pointer crossing it with a button held lights nothing. */
/**
 * `group`: the field holds several controls (a switch, a stepper, chips) — it is a named group, not a <label>, so a click
 * on its words never presses the first of them.
 */
export function Field({ label, aside, children, wide, big, group, lights: own }: { label: string; aside?: React.ReactNode; children: React.ReactNode; wide?: boolean; big?: boolean; group?: boolean; lights?: Lights | null }) {
  const lit = useFieldLights(label, own ?? undefined);
  const lights = own === null ? undefined : lit;
  const Tag = group ? "div" : "label";
  return (
    <Tag
      className={cx("v5-field", wide && "v5-field--wide", big && "v5-field--big")}
      role={group ? "group" : undefined}
      aria-label={group ? label : undefined}
      onFocus={lights ? () => lights.on("focus") : undefined}
      onBlur={lights ? () => lights.off("focus") : undefined}
      onMouseEnter={lights ? (e: React.MouseEvent) => { if (!e.buttons) lights.on("hover"); } : undefined}
      onMouseLeave={lights ? () => lights.off("hover") : undefined}
    >
      <span className="v5-lbl">
        <span>{label}</span>
        {aside ? <span className="v5-lbl-aside">{aside}</span> : null}
      </span>
      {children}
    </Tag>
  );
}

/** A number typed freely: committed while it is inside its rails, and on leaving the field (held to them). */
export function NumberInput({ value, onCommit, parse, format, min, max, label, big }: { value: number; onCommit: (n: number) => void; parse: (t: string) => number | null; format: (n: number) => string; min: number; max: number; label: string; big?: boolean }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  return (
    <input
      className={cx("v5-in", "v5-num", big && "v5-in--big")}
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

/**
 * THE BIG NUMBER (variant 5): one of the few sizes that usually change, typed or stepped. − and + move it by `step`
 * inside its rails; the field still takes a typed value (feet and inches, as everywhere).
 */
export function Stepper({ value, onCommit, parse, format, min, max, step, label }: { value: number; onCommit: (n: number) => void; parse: (t: string) => number | null; format: (n: number) => string; min: number; max: number; step: number; label: string; /** The unit, said by the field's label beside it. */ unit?: string }) {
  const by = (d: number) => onCommit(Math.min(max, Math.max(min, Math.round((value + d) / step) * step)));
  return (
    <div className="v5-stepper">
      <button type="button" className="v5-step-btn" onClick={() => by(-step)} disabled={value <= min} aria-label={`${label}: less`}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg>
      </button>
      <span className="v5-step-val">
        <NumberInput big label={label} value={value} parse={parse} format={format} min={min} max={max} onCommit={onCommit} />
      </span>
      <button type="button" className="v5-step-btn" onClick={() => by(step)} disabled={value >= max} aria-label={`${label}: more`}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M8 3v10" /></svg>
      </button>
    </div>
  );
}

export function Seg<T extends string | number>({ value, options, onChange, label, big }: { value: T; options: ReadonlyArray<{ value: T; label: string; title?: string }>; onChange: (v: T) => void; label: string; small?: boolean; big?: boolean }) {
  return (
    <div className={cx("v5-seg", big && "v5-seg--big")} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} title={o.title} className={cx("v5-seg-btn", o.value === value && "is-on")} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A name typed freely (copied from deck-studio.tsx): committed while it has letters in it; `focusNow` selects it. */
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
      className="v5-in"
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

/** A product the list doesn't carry: its name and the shop's price, in the list's unit; `children` say what it is built like. */
export function CustomBox({ slot, title, product, unit, onChange, onBack, children, note, fresh, onDone }: { slot: string; title: string; product: CustomProduct; unit: string | null; onChange: (p: CustomProduct) => void; onBack: () => void; children?: React.ReactNode; note?: React.ReactNode; fresh?: boolean; onDone?: () => void }) {
  return (
    <div className="v5-custom" data-deck-custom={slot}>
      <div className="v5-custom-head">
        <span className="v5-custom-tag">Your own · {title}</span>
        <button type="button" className="v5-btn v5-btn--sm" onClick={onBack} data-deck-custom-back={slot}>
          Back to the list
        </button>
      </div>
      <div className="v5-grid2">
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
      {note ? <p className="v5-hint">{note}</p> : null}
    </div>
  );
}

export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  const lights = useFieldLights(wordsOf(children).trim());
  return (
    <label
      className="v5-toggle"
      onFocus={lights ? () => lights.on("focus") : undefined}
      onBlur={lights ? () => lights.off("focus") : undefined}
      onMouseEnter={lights ? (e) => { if (!e.buttons) lights.on("hover"); } : undefined}
      onMouseLeave={lights ? () => lights.off("hover") : undefined}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="v5-toggle-box" aria-hidden="true">
        <svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg>
      </span>
      <span>{children}</span>
    </label>
  );
}

export function Chevron() {
  return (
    <svg className="v5-chev" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

/**
 * MORE (variant 5): everything rarer sits in a named disclosure. Closed, it still says what is set inside it, so nothing
 * is lost; a `step` puts its fields in the scope the 3D's lights know (lib/deck/fieldParts).
 */
export function More({ title, summary, step, children, id, open, flag }: { title: string; summary: React.ReactNode; step?: string; children: React.ReactNode; id?: string; open?: boolean; flag?: React.ReactNode }) {
  return (
    <details className="v5-more" id={id} open={open} data-v5-more={id ?? title}>
      <summary className="v5-more-head">
        <span className="v5-more-text">
          <span className="v5-more-title">{title}{flag}</span>
          <span className="v5-more-sum">{summary}</span>
        </span>
        <Chevron />
      </summary>
      <div className="v5-more-body">{step ? <Scope step={step}>{children}</Scope> : children}</div>
    </details>
  );
}
