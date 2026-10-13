"use client";

// THE SIX-DIGIT CODE FIELD (owner, 2026-10-12): the passwordless sign-up's code
// screen and the sign-in page's "Email me a code" (login-form).
//
// SIX SQUARES, ONE INPUT. The real <input> lies transparent over the row and
// the squares draw its value, so everything a phone does with a code field
// stays the browser's own: the one-time-code fill (iOS over the keyboard,
// Android's autofill), the numeric keypad, pasting the whole code, Backspace,
// select-and-replace. Only digits get in — "123 456" and "Code: 123456" paste
// as 123456. The caret is kept at the end, so the square that lights up is
// where the next digit lands. A screen reader meets one field, named by its
// label, its message read out by aria-live.
//
// KeyboardBridge and useKeepInView are the phone's half: the keyboard that
// opens by itself, and the heading, squares and button kept above it.
import * as React from "react";
import s from "./otp-code-field.module.css";

export const OTP_LENGTH = 6;
export const otpDigits = (v: string) => v.replace(/\D/g, "").slice(0, OTP_LENGTH);

export function OtpCodeField({
  id,
  ref,
  value,
  onChange,
  message = null,
  invalid = false,
  disabled = false,
  autoFocus = false,
  label = "Enter 6-digit code",
  labelClassName,
  messageId = `${id}Msg`,
}: {
  id: string;
  ref?: React.Ref<HTMLInputElement>;
  value: string;
  /** The digits only, at most six. */
  onChange: (digits: string) => void;
  /** The line under the squares — an error when `invalid`; nothing otherwise. */
  message?: string | null;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  label?: string;
  /** The page's own field-label class, so the label reads like its neighbours. */
  labelClassName?: string;
  messageId?: string;
}) {
  const [focused, setFocused] = React.useState(false);
  const [range, setRange] = React.useState<[number, number] | null>(null);

  /* A collapsed caret goes to the end; a selection (select-all, a drag) stays
     and is drawn, so typing or pasting replaces it. */
  function onSelect(e: React.SyntheticEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    const len = el.value.length;
    const a = el.selectionStart ?? len;
    const b = el.selectionEnd ?? len;
    if (a === b) {
      setRange(null);
      if (a !== len) el.setSelectionRange(len, len);
    } else setRange([a, b]);
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (!text) return;
    e.preventDefault();
    if (disabled) return;
    const pasted = text.replace(/\D/g, "");
    if (!pasted) return;
    const el = e.currentTarget;
    const a = el.selectionStart ?? value.length;
    const b = el.selectionEnd ?? value.length;
    onChange(pasted.length >= OTP_LENGTH ? pasted.slice(0, OTP_LENGTH) : otpDigits(value.slice(0, a) + pasted + value.slice(b)));
  }

  const sel = range && range[1] <= value.length ? range : null;
  const current = focused && !disabled && !sel && value.length < OTP_LENGTH ? value.length : -1;

  return (
    <div className={s.f} data-otp-field data-invalid={invalid || undefined} data-disabled={disabled || undefined}>
      <label className={labelClassName ?? s.lbl} htmlFor={id}>
        {label}
      </label>
      <div className={s.row}>
        <input
          ref={ref}
          className={s.in}
          id={id}
          name="otp"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          enterKeyHint="go"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          // Password managers: not a password, no badge over the squares.
          data-1p-ignore=""
          data-lpignore="true"
          data-form-type="other"
          aria-invalid={invalid || undefined}
          aria-describedby={messageId}
          value={value}
          // Locked while the code is checked, but read-only rather than
          // disabled: the field keeps the focus (and a phone its keyboard),
          // so a wrong code is retyped at once.
          readOnly={disabled}
          aria-busy={disabled || undefined}
          autoFocus={autoFocus}
          onChange={(e) => onChange(otpDigits(e.target.value))}
          onPaste={onPaste}
          onSelect={onSelect}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setRange(null);
          }}
        />
        {Array.from({ length: OTP_LENGTH }, (_, i) => (
          <span
            key={i}
            className={s.cell}
            aria-hidden="true"
            data-cell={i}
            data-filled={value[i] ? true : undefined}
            data-current={i === current || undefined}
            data-selected={sel && i >= sel[0] && i < sel[1] ? true : undefined}
          >
            {value[i] ?? ""}
          </span>
        ))}
      </div>
      <p className={s.msg} id={messageId} aria-live="polite">
        {message ?? ""}
      </p>
    </div>
  );
}

/** iOS opens the keyboard only for a focus() inside a tap, and the code field
 *  appears after a server round trip. The tap that asks for the code focuses
 *  this stand-in (a numeric field) at once; the code field takes the focus from
 *  it when it mounts, and the keyboard stays up in between. */
export function KeyboardBridge({ ref }: { ref: React.Ref<HTMLInputElement> }) {
  return <input ref={ref} className={s.bridge} type="text" inputMode="numeric" tabIndex={-1} aria-hidden="true" autoComplete="off" />;
}

/** While `on` and a code field has the focus, the keyboard's arrival (the
 *  visual viewport shrinking) marks the page (`html[data-otp-keyboard]`, so a
 *  stylesheet can close up the space over the block) and scrolls it just enough
 *  to bring `bottom` above the keyboard — never past `top` when that is
 *  enough, else never past the field itself: on 390×844 the heading, the boxes
 *  and Continue stay in sight; on 360×640 at least the boxes and Continue. */
export function useKeepInView(top: React.RefObject<HTMLElement | null>, bottom: React.RefObject<HTMLElement | null>, on: boolean) {
  React.useEffect(() => {
    const vv = window.visualViewport;
    if (!on || !vv) return;
    const root = document.documentElement;
    let raf = 0;
    const fit = () => {
      cancelAnimationFrame(raf);
      const active = document.activeElement;
      const typing = active?.getAttribute("autocomplete") === "one-time-code";
      // A keyboard: the visual viewport well short of the layout one.
      if (typing && vv.height < window.innerHeight - 120) root.setAttribute("data-otp-keyboard", "");
      else root.removeAttribute("data-otp-keyboard");
      // Measured a frame later, once the space over the block has closed.
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
          const t = top.current?.getBoundingClientRect();
          const b = bottom.current?.getBoundingClientRect();
          const f = active?.closest("[data-otp-field]")?.getBoundingClientRect();
          if (!t || !b || !typing) return;
          const shown = vv.offsetTop + vv.height - 12;
          const need = b.bottom - shown;
          if (need <= 0) return;
          const headRoom = t.top - vv.offsetTop - 8;
          const fieldRoom = f ? f.top - vv.offsetTop - 8 : headRoom;
          const by = need <= headRoom ? need : Math.min(need, Math.max(headRoom, fieldRoom));
          if (by > 0) window.scrollBy({ top: by });
        });
      });
    };
    fit();
    vv.addEventListener("resize", fit);
    document.addEventListener("focusin", fit);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", fit);
      document.removeEventListener("focusin", fit);
      root.removeAttribute("data-otp-keyboard");
    };
  }, [top, bottom, on]);
}
