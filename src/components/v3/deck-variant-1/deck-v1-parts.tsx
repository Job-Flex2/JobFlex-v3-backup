"use client";
// Small controls of the Variant 1 deck studio. The field, number, name, custom-product and toggle controls and the
// field-to-3D lighting scope are COPIED FROM deck-studio.tsx (private there) and restyled for this variant's plain
// stylesheet; their behaviour is unchanged. The answer tiles and the stepper are this variant's own.

import * as React from "react";
import { Check, Minus, Plus } from "lucide-react";
import { CUSTOM_LIMITS, type CustomProduct } from "@/lib/deck/design";
import type { FieldFocus } from "@/lib/deck/fieldParts";

export const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");
// The two formats, made once (toLocaleString with options builds a formatter on every call; the output is the same).
const DOLLARS = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const CENTS = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n: number, cents = false) => `$${(cents ? CENTS : DOLLARS).format(n)}`;

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

/* ── What every field is, in 3D (copied from deck-studio.tsx) ─────────────────────────────────────────────────────
   A field knows where it sits — its step, the stair or fixture it belongs to, the lower level — and, focused or under
   the pointer, lights what it sets in the 3D (lib/deck/fieldParts). The studio holds the light; a Scope adds where. */
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
export function useFieldLights(label: string, own?: Lights): Lights | undefined {
  const scope = React.useContext(FieldScope);
  const { light: lightOn, unlight } = scope;
  if (own) return own;
  if (!lightOn || !unlight || !label) return undefined;
  return { on: (how) => lightOn({ ...scope.where, label }, how), off: (how) => unlight({ ...scope.where, label }, how) };
}
const wordsOf = (n: React.ReactNode): string => (typeof n === "string" || typeof n === "number" ? String(n) : Array.isArray(n) ? n.map(wordsOf).join("") : "");
const lightProps = (lights: Lights | undefined) =>
  lights
    ? {
        onFocus: () => lights.on("focus"),
        onBlur: () => lights.off("focus"),
        onMouseEnter: (e: React.MouseEvent) => {
          if (!e.buttons) lights.on("hover");
        },
        onMouseLeave: () => lights.off("hover"),
      }
    : {};

/** A labelled field. `lights={null}`: it lights nothing in the 3D. */
export function Field({ label, aside, children, wide, lights: own }: { label: string; aside?: React.ReactNode; children: React.ReactNode; wide?: boolean; lights?: Lights | null }) {
  const lit = useFieldLights(label, own ?? undefined);
  const lights = own === null ? undefined : lit;
  return (
    <label className={cx("v1-field", wide && "v1-field-wide")} {...lightProps(lights)}>
      <span className="v1-lbl">
        <span>{label}</span>
        {aside ? <span className="v1-lbl-aside">{aside}</span> : null}
      </span>
      {children}
    </label>
  );
}

/** A number typed freely: committed while it is inside its rails, and on leaving the field (held to them). */
export function NumberInput({ value, onCommit, parse, format, min, max, label, big }: { value: number; onCommit: (n: number) => void; parse: (t: string) => number | null; format: (n: number) => string; min: number; max: number; label: string; big?: boolean }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  return (
    <input
      className={cx("v1-in", "v1-num", big && "v1-in-big")}
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

/** A big number with − and + on either side: the size answers, tapped or typed. */
export function Stepper({ label, unit, value, onCommit, step, min, max, parse, format, aside }: { label: string; unit: string; value: number; onCommit: (n: number) => void; step: number; min: number; max: number; parse: (t: string) => number | null; format: (n: number) => string; aside?: React.ReactNode }) {
  const lights = useFieldLights(label);
  // A step to the next whole step either way: 16'6" goes down to 16 and up to 17, never skipping one.
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const less = () => clamp(Math.ceil(value / step - 1e-9) * step - step);
  const more = () => clamp(Math.floor(value / step + 1e-9) * step + step);
  return (
    <div className="v1-stepper" role="group" aria-label={label} {...lightProps(lights)}>
      <span className="v1-lbl">
        <span>{label}</span>
        {aside ? <span className="v1-lbl-aside">{aside}</span> : null}
      </span>
      <div className="v1-stepper-row">
        <button type="button" className="v1-step-btn" aria-label={`${label}: less`} disabled={value <= min} onClick={() => onCommit(less())}>
          <Minus size={18} strokeWidth={2.5} aria-hidden="true" />
        </button>
        <div className="v1-stepper-val">
          <NumberInput big label={`${label}, ${unit}`} value={value} parse={parse} format={format} min={min} max={max} onCommit={onCommit} />
          <span className="v1-stepper-unit">{unit}</span>
        </div>
        <button type="button" className="v1-step-btn" aria-label={`${label}: more`} disabled={value >= max} onClick={() => onCommit(more())}>
          <Plus size={18} strokeWidth={2.5} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** A segmented choice (small answers inside a step). */
export function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: ReadonlyArray<{ value: T; label: string; title?: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="v1-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} title={o.title} className={cx("v1-seg-btn", o.value === value && "is-on")} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The large answer you tap: one decision, a few of these. */
export function Answers<T extends string | number>({ value, options, onChange, label, cols = 2 }: { value: T; options: ReadonlyArray<{ value: T; label: string; sub?: string; disabled?: boolean }>; onChange: (v: T) => void; label: string; cols?: 1 | 2 | 3 }) {
  const lights = useFieldLights(label);
  return (
    <div className={cx("v1-answers", `v1-answers-${cols}`)} role="radiogroup" aria-label={label} {...lightProps(lights)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={String(o.value)} type="button" role="radio" aria-checked={on} disabled={o.disabled} className={cx("v1-answer", on && "is-on")} onClick={() => onChange(o.value)}>
            <span className="v1-answer-text">
              <span className="v1-answer-name">{o.label}</span>
              {o.sub ? <span className="v1-answer-sub">{o.sub}</span> : null}
            </span>
            <span className="v1-answer-tick" aria-hidden="true">{on ? <Check size={14} strokeWidth={3} /> : null}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A name typed freely (copied from deck-studio.tsx): committed while it has letters in it. */
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
      className="v1-in"
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

/** The last choice on every material list (owner, 2026-10-12: "always an option custom"). */
export const CUSTOM = "__custom";
export const CUSTOM_LABEL = "Custom — type your own…";

/** A product the list doesn't carry (copied from deck-studio.tsx): its name and the shop's price, in the list's unit. */
export function CustomBox({ slot, title, product, unit, onChange, onBack, children, note, fresh, onDone }: { slot: string; title: string; product: CustomProduct; unit: string | null; onChange: (p: CustomProduct) => void; onBack: () => void; children?: React.ReactNode; note?: React.ReactNode; fresh?: boolean; onDone?: () => void }) {
  return (
    <div className="v1-custom" data-deck-custom={slot}>
      <div className="v1-custom-head">
        <span className="v1-custom-tag">Your own · {title}</span>
        <button type="button" className="v1-btn v1-btn-sm" onClick={onBack} data-deck-custom-back={slot}>
          Back to the list
        </button>
      </div>
      <div className="v1-grid2">
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
      {note ? <p className="v1-hint">{note}</p> : null}
    </div>
  );
}

/** A checkbox row (copied from deck-studio.tsx), lit in the 3D by its words. */
export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  const lights = useFieldLights(wordsOf(children).trim());
  return (
    <label className="v1-toggle" {...lightProps(lights)}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="v1-toggle-box" aria-hidden="true">
        <Check size={14} strokeWidth={3} />
      </span>
      <span>{children}</span>
    </label>
  );
}

/** A fold for the rarer choices of a step: its title and, beside it, what they are now. */
export function More({ title, now, children, open, id }: { title: string; now?: string; children: React.ReactNode; open?: boolean; id?: string }) {
  return (
    <details className="v1-more" open={open} data-v1-more={id}>
      <summary>
        <span className="v1-more-title">{title}</span>
        {now ? <span className="v1-more-now">{now}</span> : null}
      </summary>
      <div className="v1-more-body">{children}</div>
    </details>
  );
}
