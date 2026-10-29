"use client";

// A read-only value with a Copy button beside it (the booking link, the website button's code). The field stays a
// real input or textarea, so selecting it by hand still works where the clipboard is refused.

import * as React from "react";

export function CopyField({ value, label, multiline = false, copyLabel = "Copy" }: { value: string; label: string; multiline?: boolean; copyLabel?: string }) {
  const [done, setDone] = React.useState(false);
  const ref = React.useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      ref.current?.select();
      document.execCommand?.("copy");
    }
    setDone(true);
    window.setTimeout(() => setDone(false), 1800);
  };
  return (
    <div className={`bk-copy${multiline ? " bk-copy--code" : ""}`}>
      {multiline ? (
        <textarea ref={ref} className="bk-copy-in" readOnly value={value} aria-label={label} rows={3} onFocus={(e) => e.currentTarget.select()} />
      ) : (
        <input ref={ref} className="bk-copy-in" readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      )}
      <button type="button" className={`bk-btn ${multiline ? "bk-btn--ghost" : "bk-btn--primary"}`} onClick={() => void copy()} data-booking-copy={multiline ? "embed" : "link"}>
        <svg className="bk-ic" viewBox="0 0 24 24" aria-hidden="true">
          {done ? <path d="M20 6 9 17l-5-5" /> : <><rect x="9" y="9" width="11" height="11" rx="1" /><path d="M5 15V5a1 1 0 0 1 1-1h10" /></>}
        </svg>
        <span aria-live="polite">{done ? "Copied" : copyLabel}</span>
      </button>
    </div>
  );
}
