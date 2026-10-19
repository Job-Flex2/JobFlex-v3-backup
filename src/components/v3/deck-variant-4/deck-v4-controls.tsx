"use client";
// DECK ESTIMATOR — VARIANT 4 ("the price is the point"), small controls.
// Copied from deck-studio.tsx (2026-10-18) and restyled for the variant's own plain stylesheet: the field lights
// (a field knows where it sits and lights its part in the 3D, lib/deck/fieldParts), the free-typed numbers and names,
// the segmented choices, the shop's own product box and the tick. Behaviour is the studio's; only the classes differ.

import * as React from "react";
import { CUSTOM_LIMITS, type CustomProduct } from "@/lib/deck/design";
import type { FieldFocus } from "@/lib/deck/fieldParts";

export const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");
export const money = (n: number, cents = false) => `$${n.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`;
/** A price change, signed: "+$2,140", "−$310", "No change". */
export const delta = (n: number) => {
  const r = Math.round(n);
  if (Math.abs(r) < 1) return "No change";
  return `${r > 0 ? "+" : "−"}$${Math.abs(r).toLocaleString("en-US")}`;
};

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

/* ── the field lights (copied from deck-studio.tsx) ── */

export interface FieldScopeValue {
  where: Omit<FieldFocus, "label">;
  light: ((f: FieldFocus, how: "focus" | "hover") => void) | null;
  unlight: ((f: FieldFocus, how: "focus" | "hover") => void) | null;
}
export const FieldScope = React.createContext<FieldScopeValue>({ where: {}, light: null, unlight: null });
/** Where the fields inside sit: the studio's step ids, so lib/deck/fieldParts lights the same parts. */
export function Scope({ step, stair, fixture, level, children }: { step?: string; stair?: string; fixture?: string; level?: "lower"; children: React.ReactNode }) {
  const parent = React.useContext(FieldScope);
  const value = React.useMemo<FieldScopeValue>(
    () => ({ ...parent, where: { ...parent.where, ...(step ? { step } : {}), ...(stair ? { stair } : {}), ...(fixture ? { fixture } : {}), ...(level ? { level } : {}) } }),
    [parent, step, stair, fixture, level],
  );
  return <FieldScope.Provider value={value}>{children}</FieldScope.Provider>;
}

export type Lights = { on: (how: "focus" | "hover") => void; off: (how: "focus" | "hover") => void };
export function useFieldLights(label: string, own?: Lights): Lights | undefined {
  const scope = React.useContext(FieldScope);
  const { light: lightOn, unlight } = scope;
  if (own) return own;
  if (!lightOn || !unlight || !label) return undefined;
  return { on: (how) => lightOn({ ...scope.where, label }, how), off: (how) => unlight({ ...scope.where, label }, how) };
}
const wordsOf = (n: React.ReactNode): string => (typeof n === "string" || typeof n === "number" ? String(n) : Array.isArray(n) ? n.map(wordsOf).join("") : "");

/** A labelled field. `lights={null}`: lights nothing in the 3D. A pointer crossing with a button held is a drag, not a look. */
export function Field({ label, aside, children, wide, lights: own }: { label: string; aside?: React.ReactNode; children: React.ReactNode; wide?: boolean; lights?: Lights | null }) {
  const lit = useFieldLights(label, own ?? undefined);
  const lights = own === null ? undefined : lit;
  return (
    <label
      className={cx("v4-field", wide && "v4-field--wide")}
      // A label around a row of buttons (choices, cards) would hand a click on its gaps to the first button: only a
      // label around a typed field passes its clicks on.
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (!t.closest("input, select, textarea, button, a") && !e.currentTarget.querySelector("input, select, textarea")) e.preventDefault();
      }}
      onFocus={lights ? () => lights.on("focus") : undefined}
      onBlur={lights ? () => lights.off("focus") : undefined}
      onMouseEnter={lights ? (e) => { if (!e.buttons) lights.on("hover"); } : undefined}
      onMouseLeave={lights ? () => lights.off("hover") : undefined}
    >
      <span className="v4-lbl">
        <span>{label}</span>
        {aside ? <span className="v4-lbl-aside">{aside}</span> : null}
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
      className="v4-in v4-num"
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

export function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: ReadonlyArray<{ value: T; label: string; title?: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="v4-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} title={o.title} className={cx("v4-seg-btn", o.value === value && "is-on")} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A name typed freely; `focusNow` puts the cursor in it, text selected, so a product picked a moment ago is typed over. */
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
      className="v4-in"
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

/** The last choice on every material list. */
export const CUSTOM = "__custom";
export const CUSTOM_LABEL = "Custom — type your own…";

/** A product the list doesn't carry: its name and the shop's price, in the list's unit; `children` say what it is built like. */
export function CustomBox({ slot, title, product, unit, onChange, onBack, children, note, fresh, onDone }: { slot: string; title: string; product: CustomProduct; unit: string | null; onChange: (p: CustomProduct) => void; onBack: () => void; children?: React.ReactNode; note?: React.ReactNode; fresh?: boolean; onDone?: () => void }) {
  return (
    <div className="v4-custom" data-deck-custom={slot}>
      <div className="v4-custom-head">
        <span className="v4-custom-tag">Your own · {title}</span>
        <button type="button" className="v4-btn v4-btn--sm v4-btn--quiet" onClick={onBack} data-deck-custom-back={slot}>
          Back to the list
        </button>
      </div>
      <div className="v4-grid2">
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
      {note ? <p className="v4-hint">{note}</p> : null}
    </div>
  );
}

export function Toggle({ checked, onChange, children, price }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; price?: string | null }) {
  const lights = useFieldLights(wordsOf(children).trim());
  return (
    <label
      className="v4-toggle"
      onFocus={lights ? () => lights.on("focus") : undefined}
      onBlur={lights ? () => lights.off("focus") : undefined}
      onMouseEnter={lights ? (e) => { if (!e.buttons) lights.on("hover"); } : undefined}
      onMouseLeave={lights ? () => lights.off("hover") : undefined}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="v4-toggle-box" aria-hidden="true" />
      <span className="v4-toggle-text">{children}</span>
      {price ? <span className="v4-toggle-price">{price}</span> : null}
    </label>
  );
}

/**
 * A PRICED CHOICE — the variant's own control (2026-10-18): every option names what it does to the price of the job on
 * screen, figured by the engine on the design with that option in it. The one in use says so instead.
 */
export function PriceOptions<T extends string | number>({ label, value, options, onPick, cols = 1 }: { label: string; value: T | null; options: ReadonlyArray<{ value: T; name: string; sub?: string; change: number | null; disabled?: boolean; title?: string }>; onPick: (v: T) => void; cols?: 1 | 2 | 3 }) {
  return (
    <div className={cx("v4-opts", cols === 2 && "v4-opts--2", cols === 3 && "v4-opts--3")} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={String(o.value)} type="button" role="radio" aria-checked={on} disabled={o.disabled} title={o.title} className={cx("v4-opt", on && "is-on")} onClick={() => !on && onPick(o.value)} data-v4-opt={String(o.value)}>
            <span className="v4-opt-name">{o.name}</span>
            <span className={cx("v4-opt-price", on && "is-on", o.change !== null && !on && Math.round(o.change) < 0 && "is-less")}>{on ? "In use" : o.change === null ? "…" : delta(o.change)}</span>
            {o.sub ? <span className="v4-opt-sub">{o.sub}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
