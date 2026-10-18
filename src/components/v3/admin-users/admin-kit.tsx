"use client";

// ADMIN — the shared React kit over admin-shared.module.css.
//
// Both admin blueprint pages (/admin/users, /admin/plans) draw their controls
// from here so a sheet, a field, a toggle or a status badge is one treatment
// published once (decisions.md: "never create parallel style sets for identical
// blocks"). Page-specific layout stays in each page's own module.
//
// The sheet is the house `.mdl` dialog driven through blueprint-shell/mdl-motion
// (enter AND exit animated) with the reference-counted lib/scrollLock — the two
// shared modules decisions.md says must never be re-derived.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { Check, X, AlertTriangle } from "lucide-react";
import { openMdl, closeMdl, MDL_EXIT_MS } from "@/components/v3/blueprint-shell/mdl-motion";
import { lockScroll } from "@/lib/scrollLock";
import shared from "./admin-shared.module.css";

type ClassName = string | false | null | undefined;

/** useLayoutEffect warns during SSR; useEffect is inert there, so it stands in. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Build a class mapper over one or more CSS modules. A name found in a module
 * becomes its hashed class; a name in none of them passes through literally —
 * which is how the fleet's global `mdl`, `open`, `rv`, `card`,
 * `page-head` … reach the markup.
 */
export function makeCx(...modules: Array<Record<string, string>>) {
  return (...names: ClassName[]): string =>
    names
      .filter((n): n is string => !!n)
      .map((n) => {
        for (const m of modules) if (m[n]) return m[n];
        return n;
      })
      .join(" ");
}

/** The kit's own mapper — shared module only. */
export const kx = makeCx(shared);
/** The kit's hashed `.btn`, for pages that delegate press feedback. */
export const KIT_BTN_CLASS = shared.btn;

export function Ic({ as: Cmp }: { as: typeof Check }) {
  return <Cmp className={kx("ic")} aria-hidden="true" />;
}

// ── Sheet ──────────────────────────────────────────────────────────

export interface SheetHandle {
  ref: RefObject<HTMLDivElement | null>;
  /** Callback ref for the `.mdl` node — `<Sheet>` wires it; pages never touch it. */
  attach: (el: HTMLDivElement | null) => void;
  /** Whether the sheet is currently shown (reads the DOM class, not state). */
  isOpen: () => boolean;
  /** Show the sheet (enter animation + scroll lock). */
  open: () => void;
  /** Hide it through the exit animation; `then` runs once it is off screen. */
  close: (then?: () => void) => void;
}

/**
 * Imperative open/close for one `<Sheet>`. The element stays mounted (it is
 * `display: none` until `.open`), so React never unmounts a box mid-exit and
 * a form inside keeps its fields until the 190ms close has played — defer any
 * state reset into `close(then)`.
 */
export function useSheet(): SheetHandle {
  const ref = useRef<HTMLDivElement | null>(null);
  const timers = useRef<number[]>([]);
  const release = useRef<(() => void) | null>(null);

  const after = useCallback((ms: number, fn: () => void) => {
    const t = window.setTimeout(() => {
      timers.current = timers.current.filter((x) => x !== t);
      fn();
    }, ms);
    timers.current.push(t);
  }, []);

  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      release.current?.();
      release.current = null;
    },
    [],
  );

  const attach = useCallback((el: HTMLDivElement | null) => {
    ref.current = el;
  }, []);

  const isOpen = useCallback(() => !!ref.current?.classList.contains("open"), []);

  const open = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (!release.current) release.current = lockScroll();
    openMdl(el);
  }, []);

  const close = useCallback(
    (then?: () => void) => {
      const el = ref.current;
      if (!el) return;
      if (!closeMdl(el, after)) return;
      after(MDL_EXIT_MS, () => {
        release.current?.();
        release.current = null;
        then?.();
      });
    },
    [after],
  );

  return useMemo(() => ({ ref, attach, isOpen, open, close }), [attach, isOpen, open, close]);
}

/**
 * The frame: head with kicker/title/close, then `children` — which should be a
 * `<SheetBody>` (scrolls) followed by a `<SheetFoot>` (pinned). The slots are
 * separate components so a form can own both its fields and its buttons.
 */
export function Sheet({
  handle,
  kicker,
  title,
  wide,
  onClose,
  children,
}: {
  handle: SheetHandle;
  kicker?: ReactNode;
  title: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !handle.isOpen()) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handle, onClose]);

  // The node reaches the hook from a layout effect, not through `ref=`: the
  // compiler lint treats anything handed to a JSX ref as a ref and rejects
  // reading it during render, so the handle stays out of the element tree.
  const nodeRef = useRef<HTMLDivElement | null>(null);
  useIsomorphicLayoutEffect(() => {
    handle.attach(nodeRef.current);
    return () => handle.attach(null);
  }, [handle]);

  return (
    <div ref={nodeRef} className={kx("mdl", "sheet")} role="dialog" aria-modal="true" aria-label={title}>
      <div className={kx("mdl-bg", "sheet-bg")} onClick={onClose} />
      <div className={kx("mdl-box", "sheet-box", wide && "sheet-box--wide")}>
        <div className={kx("sheet-head")}>
          <div className={kx("sheet-titles")}>
            {kicker ? <span className={kx("sheet-kick")}>{kicker}</span> : null}
            <div className={kx("sheet-title")}>{title}</div>
          </div>
          <button type="button" className={kx("sheet-x")} onClick={onClose} aria-label="Close">
            <X className={kx("ic")} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SheetBody({ children }: { children: ReactNode }) {
  return <div className={kx("sheet-body")}>{children}</div>;
}

export function SheetFoot({ children }: { children: ReactNode }) {
  return <div className={kx("sheet-foot")}>{children}</div>;
}

// ── Form bits ──────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className={kx("fld")}>
      <label className={kx("fld-lbl")} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <span className={kx("fld-hint")}>{hint}</span> : null}
    </div>
  );
}

export function Select({
  id,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  // The console's one dropdown treatment, published once in
  // blueprint-global.css: `.bp-sel` is the wrapper that draws the caret (a
  // <select> cannot carry a pseudo-element), `.bp-sel-in` the appearance reset,
  // and `.bp-sel--admin` the admin metrics — the 38px axis the `.in` text field
  // beside it sits on. `data-empty` greys an unpicked placeholder.
  return (
    <span className="bp-sel bp-sel--admin">
      <select
        id={id}
        className="bp-sel-in"
        value={value}
        data-empty={value ? undefined : "1"}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export function Toggle({
  on,
  onChange,
  label,
  sub,
  disabled,
  cell,
  ariaLabel,
  title,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  sub?: ReactNode;
  disabled?: boolean;
  /** Compact variant for a table cell. */
  cell?: boolean;
  ariaLabel?: string;
  /** Why a control is disabled belongs on the control, not in a line of copy. */
  title?: string;
}) {
  // A grid, not a flex row: with a sub the box has to sit on the LABEL's line,
  // and flex centring put it in the gutter between the two lines instead.
  return (
    <button
      type="button"
      className={kx("tg", cell && "tg--cell")}
      aria-pressed={on}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className={kx("tg-box")}>
        <Check className={kx("ic")} aria-hidden="true" />
      </span>
      <span className={kx("tg-lbl")}>{label}</span>
      {sub ? <span className={kx("tg-sub")}>{sub}</span> : null}
    </button>
  );
}

export function Note({
  tone = "warn",
  children,
}: {
  tone?: "warn" | "danger" | "ok";
  children: ReactNode;
}) {
  return (
    <div className={kx("note", tone === "danger" && "note--danger", tone === "ok" && "note--ok")} role="alert">
      <AlertTriangle className={kx("ic")} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

// ── Status badges ──────────────────────────────────────────────────

/** Subscription.status → the 3-tone badge class. */
export function subTone(status: string): string | false {
  switch (status) {
    case "ACTIVE":
      return "st--ok";
    case "TRIALING":
      return "st--sky";
    case "PAST_DUE":
      return "st--warn";
    case "UNPAID":
    case "CANCELED":
    case "TRIAL_ENDED":
    case "EXPIRED":
      return "st--danger";
    default:
      return false;
  }
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={kx("st", subTone(status))}>{status.replace("_", " ")}</span>;
}

// ── Small helpers ──────────────────────────────────────────────────

export function errorMessage(err: unknown, fallback = "Something went wrong."): string {
  // A production build withholds a thrown action's message: the page gets
  // React's "Minified React error #441" or Next's render notice, which reads
  // as gibberish in a note. Say that the server gave no reason instead.
  if (err instanceof Error && /minified react error|server components render|unexpected response/i.test(err.message)) {
    return `${fallback} The server gave no reason — refresh the page and try again.`;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** ISO timestamp → local `YYYY-MM-DD` for a text field; empty when null. */
export function toDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * `YYYY-MM-DD` (local noon, so the day survives any timezone) → ISO, "" → null.
 * Anything else throws — the sheet surfaces it before the action is called.
 */
export function fromDay(s: string, label: string): string | null {
  const t = s.trim();
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new Error(`${label}: use YYYY-MM-DD.`);
  const d = new Date(`${t}T12:00:00`);
  if (Number.isNaN(d.getTime())) throw new Error(`${label}: not a real date.`);
  return d.toISOString();
}
