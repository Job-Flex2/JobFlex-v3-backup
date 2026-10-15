"use client";

// Settings blueprint — shared UI primitives.
//
// Every pane (account / payments / billing / integrations / notifications)
// codes against exactly these seven exports, so the API cannot drift.
//
// Class names are plain strings, never CSS-module identifiers: the settings
// stylesheet declares every rule as `.bp :global(.content SEL)`, so the markup
// here must carry the donor's literal class names (`fld`, `fin`, `tg`, `cb`,
// `mono-box`, `copy`, `sactions`, `saved`, `mask`, `modal`, …).
//
// Owner fixes baked in here:
//   F10 — `Sel` is the custom dropdown that replaces every native <select>.
//   F12 — `Toggle` renders NO child svg; the .tg colour states carry the state.
//   F11 — `Modal` is the hand-rolled animated pop-up form (no Radix).
//
// Icons come from the shared shell sprite plus this page's local sprite.tsx.

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

import { MDL_EXIT_MS } from "@/components/v3/blueprint-shell/mdl-motion";
import { OverlayPortal } from "@/components/v3/blueprint-shell/overlay-layer";
import { lockScroll } from "@/lib/scrollLock";

/* ─────────────────────────────── Field ─────────────────────────────── */

export interface FieldProps {
  /** Uppercased by CSS; pass it in sentence case exactly as the donor writes it. */
  label: string;
  /** Uncontrolled initial value, or the controlled value when `onChange` is given. */
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Supply this for any input whose value is saved. The field then runs
   * CONTROLLED — the pane owns the string and can hand it to a server action.
   * Omit it and the field stays uncontrolled, exactly as the donor's inert
   * inputs were (the Add-payout modal still uses that mode).
   */
  onChange?: (next: string) => void;
}

/** `<label class="fld"><span>LABEL</span><input class="fin" …></label>` */
export function Field({ label, value, placeholder, disabled, onChange }: FieldProps) {
  return (
    <label className="fld">
      <span>{label}</span>
      <input
        className="fin"
        {...(onChange
          ? { value: value ?? "", onChange: (e) => onChange(e.target.value) }
          : { defaultValue: value })}
        placeholder={placeholder}
        disabled={disabled}
      />
    </label>
  );
}

/* ────────────────────────────── TextArea ───────────────────────────── */

export interface TextAreaProps {
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  maxLength?: number;
  onChange: (next: string) => void;
}

/** `<label class="fld"><span>LABEL</span><textarea class="fin fin--area">` —
 *  the donor's field, taller. Bank-transfer instructions use it. */
export function TextArea({ label, value, placeholder, disabled, rows = 4, maxLength, onChange }: TextAreaProps) {
  return (
    <label className="fld">
      <span>{label}</span>
      <textarea
        className="fin fin--area"
        value={value}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/* ──────────────────────────────── Sel ──────────────────────────────── */

export interface SelProps {
  /** When given, the control is wrapped in `<div class="fld"><span>LABEL</span>…</div>`. */
  label?: string;
  /** Currently selected option. `Sel` is fully controlled — the parent owns this. */
  value: string;
  options: readonly string[];
  /**
   * Required: `Sel` keeps no internal copy of `value`, so a dropdown without an
   * `onChange` would be inert. Mirroring the prop into local state instead would
   * mean a setState-in-effect cascade (`react-hooks/set-state-in-effect`).
   */
  onChange: (next: string) => void;
}

/**
 * Custom styled dropdown — the F10 replacement for every native `<select class="fin">`.
 * Closes on outside pointerdown and on Escape; full keyboard support.
 */
export function Sel({ label, value, options, onChange }: SelProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // The selected option is read straight off the `value` prop. Every pane already
  // holds it in `useState`, so a local mirror would only add a render cascade.
  const current = value;

  // Outside click closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const wrap = wrapRef.current;
      if (wrap && !wrap.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Escape closes and returns focus to the trigger.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Move focus into the menu, onto the selected option.
  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const target =
      menu.querySelector<HTMLButtonElement>(".is-sel") ??
      menu.querySelector<HTMLButtonElement>(".sel-opt");
    target?.focus();
  }, [open]);

  const pick = useCallback(
    (next: string) => {
      onChange(next);
      setOpen(false);
      btnRef.current?.focus();
    },
    [onChange],
  );

  const onBtnKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const menu = menuRef.current;
    if (!menu) return;
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>(".sel-opt"));
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    const next = items[(at + step + items.length) % items.length];
    next?.focus();
  };

  const control = (
    <div className={open ? "sel on" : "sel"} ref={wrapRef}>
      <button
        className="sel-btn"
        type="button"
        ref={btnRef}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onBtnKeyDown}
      >
        <span className="sel-val">{current}</span>
        <svg className="ic sel-chev">
          <use href="#i-chev" />
        </svg>
      </button>
      <div className="sel-menu" role="listbox" ref={menuRef} onKeyDown={onMenuKeyDown}>
        {options.map((o) => (
          <button
            key={o}
            className={o === current ? "sel-opt is-sel" : "sel-opt"}
            type="button"
            role="option"
            aria-selected={o === current}
            onClick={() => pick(o)}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );

  if (label === undefined) return control;

  return (
    <div className="fld">
      <span>{label}</span>
      {control}
    </div>
  );
}

/* ────────────────────────────── Toggle ─────────────────────────────── */

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
}

/**
 * F12: no child svg. The donor's `.tg` rules (green on / red off) carry the
 * whole state read-out; the check/cross icons are gone for good.
 */
export function Toggle({ checked, onChange, ariaLabel }: ToggleProps) {
  return (
    <button
      className="tg"
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
    />
  );
}

/* ──────────────────────────────── Cbx ──────────────────────────────── */

export interface CbxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
}

/**
 * Notifications-matrix checkbox. Keeps its inline check mark exactly as the
 * donor writes it (line 2109) — it is a checkbox, not a toggle.
 */
export function Cbx({ checked, onChange, ariaLabel }: CbxProps) {
  return (
    <button
      className="cb"
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
    >
      <svg className="cb-ic" viewBox="0 0 24 24">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </button>
  );
}

/* ────────────────────────────── CopyBox ────────────────────────────── */

export interface CopyBoxProps {
  value: string;
}

/** `.mono-box` + `.copy`; click copies and flashes "Copied" for 1600ms. */
export function CopyBox({ value }: CopyBoxProps) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(value).catch(() => {
      /* clipboard blocked (insecure origin / denied permission) — still flash */
    });
    setDone(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 1600);
  }, [value]);

  return (
    <div className="mono-box">
      <code>{value}</code>
      <button className={done ? "copy done" : "copy"} type="button" onClick={copy}>
        {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/* ────────────────────────────── SaveBar ────────────────────────────── */

export interface SaveBarProps {
  /** Extra buttons rendered before the save status. */
  extra?: ReactNode;
  /**
   * The card's real write. Resolves → "Saved"; rejects → the status slot
   * carries the server action's own message, verbatim.
   */
  onSave?: () => Promise<unknown>;
  /** Read-only role: nothing saves, and the status says so. */
  disabled?: boolean;
  /**
   * AUTOSAVE (owner, 2026-09-26: no Save changes buttons in Settings). The
   * card's current values; any change schedules `onSave` AUTOSAVE_MS after
   * the last edit. Without it the card keeps the old Save changes button.
   */
  watch?: unknown;
}

const AUTOSAVE_MS = 900;

/** Server actions reject with a message written for the user. Show that text;
 *  fall back to a generic line for anything unrecognisable. */
export function actionError(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : "";
  // The action never answered as one — the sign-in redirected it (a run-out session) or a deploy landed in
  // between. A production build words this "Minified React error #441" (the owner's screenshot, 2026-10-14).
  if (/unexpected response|server components render|minified react error|next_redirect/i.test(msg)) {
    return "JobFlex couldn't reach your sign-in. Refresh the page — sign in again if it asks — then try once more. Nothing was changed.";
  }
  if (!msg || msg.toLowerCase().includes("fetch failed")) {
    return "Something went wrong. Check your connection and try again.";
  }
  return msg;
}

/** A card's save footer: autosave when the card passes `watch`, else the
 *  donor's Save changes button. */
export function SaveBar(props: SaveBarProps) {
  return props.watch !== undefined ? <AutoSave {...props} /> : <ManualSave {...props} />;
}

type AutoState = "idle" | "saving" | "saved" | "error";

/**
 * Saves AUTOSAVE_MS after the last edit, never on mount, and once more when
 * the page is hidden or the card unmounts with an edit still pending. One
 * write at a time: an edit that lands mid-write queues exactly one more. A
 * failure shows the action's own message and the next edit tries again.
 */
function AutoSave({ extra, onSave, disabled, watch }: SaveBarProps) {
  const key = JSON.stringify(watch ?? null);
  const [state, setState] = useState<AutoState>("idle");
  const [error, setError] = useState("");
  const saved = useRef(key); // the values last known to be on the server
  const latest = useRef(key); // the values on screen
  const write = useRef<SaveBarProps["onSave"]>(undefined); // the newest closure over them
  const inFlight = useRef(false);
  const again = useRef(false);
  const flush = useRef<() => Promise<void>>(async () => {});

  // Declared first, so the debounce below always sees this render's values.
  useEffect(() => {
    write.current = disabled ? undefined : onSave;
    latest.current = key;
  });

  useEffect(() => {
    flush.current = async () => {
      if (inFlight.current) {
        again.current = true;
        return;
      }
      const target = latest.current;
      const run = write.current;
      if (!run || target === saved.current) return;
      inFlight.current = true;
      setState("saving");
      setError("");
      try {
        await run();
        saved.current = target;
        setState("saved");
      } catch (err) {
        setState("error");
        setError(actionError(err));
      } finally {
        inFlight.current = false;
        if (again.current) {
          again.current = false;
          void flush.current();
        }
      }
    };
  }, []);

  useEffect(() => {
    if (disabled || key === saved.current) return;
    const t = window.setTimeout(() => void flush.current(), AUTOSAVE_MS);
    return () => window.clearTimeout(t);
  }, [key, disabled]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush.current();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void flush.current();
    };
  }, []);

  const label = disabled
    ? "View only"
    : state === "saving"
      ? "Saving…"
      : state === "saved"
        ? "Saved"
        : state === "error"
          ? error
          : "Saves automatically";

  return (
    <div className="sactions sactions--auto">
      {extra}
      <span className="autosave" data-state={disabled ? "off" : state} role="status" aria-live="polite">
        {state === "saved" || state === "error" ? (
          <svg className="ic" aria-hidden="true">
            <use href={state === "saved" ? "#i-check" : "#i-x"} />
          </svg>
        ) : null}
        {label}
      </span>
    </div>
  );
}

/** `.sactions` footer; a successful save flashes the `.saved.on` tag for 2200ms. */
function ManualSave({ extra, onSave, disabled }: SaveBarProps) {
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // `disabled={busy}` alone leaves a gap: two clicks landing in the same tick
  // both run before React re-renders the disabled state (the button audit's
  // double-click sent two POSTs through it). The ref closes that gap — the
  // second click returns before the action fires, no render required.
  const inFlight = useRef(false);

  const save = useCallback(async () => {
    if (inFlight.current) return;
    if (timer.current) clearTimeout(timer.current);
    setError("");
    if (!onSave) {
      // No write wired to this card yet — keep the donor's optimistic flash.
      setSaved(true);
      timer.current = setTimeout(() => setSaved(false), 2200);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      await onSave();
      setSaved(true);
      timer.current = setTimeout(() => setSaved(false), 2200);
    } catch (err) {
      setSaved(false);
      setError(actionError(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [onSave]);

  return (
    <div className="sactions">
      <button
        className="btn btn-primary"
        type="button"
        disabled={busy || disabled}
        onClick={() => void save()}
      >
        <svg className="ic">
          <use href="#i-check" />
        </svg>
        {busy ? "Saving…" : "Save changes"}
      </button>
      {extra}
      {/* One tag slot, two states: the donor's green "Saved", or the action's
          own failure message in the danger tone. No new CSS — the `.saved`
          rules carry both, only the colour token differs. */}
      {error ? (
        <span className="saved on" style={{ color: "var(--danger)" }} role="status">
          <svg className="ic" style={{ width: "13px", height: "13px" }}>
            <use href="#i-x" />
          </svg>
          {error}
        </span>
      ) : (
        <span className={saved ? "saved on" : "saved"} role="status">
          <svg className="ic" style={{ width: "13px", height: "13px" }}>
            <use href="#i-check" />
          </svg>
          Saved
        </span>
      )}
    </div>
  );
}

/* ─────────────────────────────── Modal ─────────────────────────────── */

export interface ModalProps {
  /** Shown while true. When it turns false the form plays its exit, then unmounts. */
  open: boolean;
  title: string;
  sub?: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * F11: hand-rolled animated pop-up form. No Radix.
 *
 * Rendered through <OverlayPortal> into the shell's overlay layer, never
 * inside `.content`: there its mask was painted under the sidebar and the
 * topbar, which stayed bright while the page dimmed (owner, 2026-09-26;
 * blueprint-shell/overlay-layer.tsx has the why). `.set-layer` is the wrapper
 * settings.module.css re-roots the form's rules and tokens on.
 *
 * Enters and exits animated — the exit on mdl-motion's MDL_EXIT_MS, after
 * which it unmounts. Closes on Escape and on a mask click, locks page scroll
 * through lib/scrollLock, takes focus on open and hands it back to whatever
 * opened it as the close starts.
 */
export function Modal({ open, ...box }: ModalProps) {
  // Presence outlives `open` by the exit. The flip is caught while rendering
  // (the "previous prop" pattern), so no effect has to set state to notice it.
  const [wasOpen, setWasOpen] = useState(open);
  const [exiting, setExiting] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    setExiting(!open);
  }

  useEffect(() => {
    if (!exiting) return;
    const t = window.setTimeout(() => setExiting(false), reducedMotion() ? 0 : MDL_EXIT_MS);
    return () => window.clearTimeout(t);
  }, [exiting]);

  if (!open && !exiting) return null;
  return (
    <OverlayPortal>
      <ModalBox {...box} closing={!open} />
    </OverlayPortal>
  );
}

function ModalBox({
  title,
  sub,
  onClose,
  children,
  footer,
  closing,
}: Omit<ModalProps, "open"> & { closing: boolean }) {
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Escape closes. Disarmed during the exit — the form is already going.
  useEffect(() => {
    if (closing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closing, onClose]);

  // The page must not scroll under the form. Reference-counted, so it cannot
  // strand the page locked when it overlaps another lock.
  useEffect(() => lockScroll(), []);

  // Focus moves in on open, and back to the opener the moment the close starts
  // — not after the exit, while it would sit on a fading, unclickable form.
  useEffect(() => {
    if (closing) return;
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : null;
    const node = boxRef.current;
    node?.focus();
    return () => {
      const now = document.activeElement;
      // Unless the user has already put focus somewhere else.
      if (opener?.isConnected && (!now || now === document.body || node?.contains(now))) opener.focus();
    };
  }, [closing]);

  return (
    <div className="set-layer">
      <div
        className="mask"
        data-closing={closing ? "" : undefined}
        onClick={(e) => {
          if (!closing && e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
          ref={boxRef}
        >
          <div className="modal-h">
            <div>
              <div className="sc-t">{title}</div>
              {sub ? <div className="sc-s">{sub}</div> : null}
            </div>
            <button className="modal-x" type="button" aria-label="Close" onClick={onClose}>
              <svg className="ic">
                <use href="#i-x" />
              </svg>
            </button>
          </div>
          <div className="modal-b">{children}</div>
          <div className="modal-f">{footer}</div>
        </div>
      </div>
    </div>
  );
}
