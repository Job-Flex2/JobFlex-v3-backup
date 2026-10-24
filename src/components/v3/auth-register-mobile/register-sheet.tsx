"use client";

// THE PHONE SIGN-UP (2026-10-23, the trial's variant D, made the real /auth/register at ≤768px).
//
// WHAT IS OURS AND WHAT IS NOT. The form inside is the register page's own (RegisterContent): Google, the email, the
// code, the draft restore, the plan step, the attribution — every step, check and redirect is the page's. This file
// draws the frame around it on a phone: a bottom sheet holding the form over the live Overview (./phone-backdrop,
// loaded by the viewport switch in app/(auth)/auth/register/register-responsive.tsx), with an ink film between them.
//
// ONE TREE AT EVERY WIDTH. The frame's boxes are always in the page, so the form under them is never re-mounted when
// the switch flips: above 768px every box is `display: contents`, the handle is hidden, and the register page draws
// itself exactly as it does without the frame. Re-mounting would drop what was typed before the script arrived and
// send the form's once-per-load events twice.
//
// BEFORE THE SCRIPT (`live` false: the server's answer, and the moment before hydration). The sheet stands open with
// the whole form in it, the name included, so step 1 posts to ./checkout without JavaScript (app/(auth)/auth/register/
// page.tsx STEP1_PRELUDE). Once live it settles to rest — unless something was typed or a field holds the focus.
//
// AT REST about 45% of the screen: the handle, "7-day free trial", Google, the email and Start, measured to the
// bottom of Start. It rests only while step 1's form is on screen with no refusal showing: the code screen, a
// restored draft, the plan step or an error open it, because what matters would be under the fold. It opens on a tap
// into a field, the keyboard's focus, a swipe up anywhere on it, or the handle; it closes with a swipe down on the
// handle, the handle, or Escape.
//
// MOTION. The sheet moves by transform only (300ms); `prefers-reduced-motion` snaps it.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import css from "./register-sheet.module.css";

/** Travel before a finger is taken from the page and given to the sheet. */
const SLOP = 8;
/** Pull that changes the sheet's state, as a share of the travel between its two heights (capped). */
const SWITCH_RATIO = 0.25;
const SWITCH_MAX = 110;
/** px/ms that switches regardless of distance — the flick. */
const FLICK = 0.5;
/** The stylesheet's travel is 0.3s; inline styles are handed back a frame after that. */
const SETTLE_MS = 340;

const STEP1_FORM = "#step1:not(.is-hidden) #step1Form";
const PEEK_TRANSFORM = "translateY(calc(100% - var(--peek-h) - var(--msheet-foot-pad-y) - var(--msheet-safe-b)))";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Typed into step 1 before the script arrived (the page's prelude notes it), or a field of it holds the focus. */
function startedBeforeLive(): boolean {
  if (typeof window === "undefined") return false;
  const pre = (window as Window & { __jfStep1?: { typedAt: number } }).__jfStep1;
  const active = document.activeElement;
  return Boolean(pre?.typedAt) || Boolean(active instanceof HTMLElement && active.closest("#step1Form"));
}

type Drag = { id: number; startY: number; lastY: number; lastT: number; velocity: number; from: "peek" | "open"; active: boolean; travel: number };

export function RegisterSheet({ live, backdrop, children }: { live: boolean; backdrop: ReactNode; children: ReactNode }) {
  const sheetRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const dragged = useRef(false);
  const settle = useRef<number | null>(null);
  const [state, setState] = useState<"peek" | "open">(() => (startedBeforeLive() ? "open" : "peek"));
  /* Whether the sheet may rest: step 1's form on screen, no refusal showing, not the plan step. */
  const [canPeek, setCanPeek] = useState(true);
  const shown = live && canPeek ? state : "open";

  /* ── may it rest? and how tall is it at rest? ────────────────────────────────────────────────────────────── */
  const measure = useCallback(() => {
    const body = bodyRef.current;
    const sheet = sheetRef.current;
    if (!body || !sheet) return;
    const form = body.querySelector<HTMLElement>(STEP1_FORM);
    const refused = body.querySelector("#err1:not(.is-hidden)");
    const plan = body.querySelector(".auth.is-gone");
    setCanPeek(Boolean(form) && !refused && !plan);
    const submit = form?.querySelector<HTMLElement>('[type="submit"]');
    if (!submit || sheet.dataset.state !== "peek") return;
    const top = sheet.getBoundingClientRect().top - body.scrollTop;
    sheet.style.setProperty("--peek-h", `${Math.ceil(submit.getBoundingClientRect().bottom - top)}px`);
  }, []);

  useEffect(() => {
    const body = bodyRef.current;
    if (!live || !body) return;
    let raf = 0;
    const soon = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    soon();
    const mo = new MutationObserver(soon);
    mo.observe(body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    const ro = new ResizeObserver(soon);
    ro.observe(body);
    window.addEventListener("resize", soon);
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      ro.disconnect();
      window.removeEventListener("resize", soon);
    };
  }, [live, measure]);

  // Entering rest: measured in the resting layout, from the top of the form, before the frame is painted.
  useLayoutEffect(() => {
    if (shown !== "peek") return;
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    measure();
  }, [shown, measure]);

  useEffect(() => () => {
    if (settle.current !== null) window.clearTimeout(settle.current);
  }, []);

  const open = useCallback(() => setState("open"), []);
  const rest = useCallback(() => {
    const active = document.activeElement;
    // The keyboard goes with it: a focused field would hold the keyboard up over a resting sheet.
    if (active instanceof HTMLElement && sheetRef.current?.contains(active)) active.blur();
    setState("peek");
  }, []);

  /* ── a tap into a field, the keyboard's focus, the handle, Escape, an early Start ────────────────────────── */
  const onFocusCapture = useCallback(
    (e: React.FocusEvent) => {
      if (!live || shown !== "peek") return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) open();
    },
    [live, shown, open],
  );

  const onClickCapture = useCallback(
    (e: React.MouseEvent) => {
      if (dragged.current) {
        // A pull that ended over a button is not a press of it.
        dragged.current = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (!live || shown !== "peek") return;
      const t = e.target instanceof Element ? e.target : null;
      const submit = t?.closest<HTMLElement>(`${STEP1_FORM} [type="submit"]`);
      if (!submit) return;
      /* Start before the name (it is hidden at rest): open — now, so the field is drawn — and put the caret where
         the form would have asked for it, inside the tap so a phone raises its keyboard. Anything else goes through
         to the form as pressed. */
      flushSync(open);
      const name = bodyRef.current?.querySelector<HTMLInputElement>(`${STEP1_FORM} #name`);
      if (name && !name.value.trim()) {
        e.preventDefault();
        e.stopPropagation();
        name.focus({ preventScroll: true });
      }
    },
    [live, shown, open],
  );

  useEffect(() => {
    if (!live || shown !== "open" || !canPeek) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") rest();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [live, shown, canPeek, rest]);

  /* ── the pull: up from rest anywhere on the sheet, down from open on the handle ──────────────────────────── */
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      dragged.current = false;
      if (!live || !canPeek) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const fromHandle = e.target instanceof Element && Boolean(e.target.closest("[data-sheet-handle]"));
      if (shown === "open" && !fromHandle) return;
      const sheet = sheetRef.current;
      if (!sheet) return;
      const h = sheet.getBoundingClientRect().height;
      const peekShift = h - (parseFloat(sheet.style.getPropertyValue("--peek-h")) || h * 0.45);
      drag.current = { id: e.pointerId, startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, velocity: 0, from: shown, active: false, travel: Math.max(1, peekShift) };
    },
    [live, canPeek, shown],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const g = drag.current;
    const sheet = sheetRef.current;
    if (!g || !sheet || g.id !== e.pointerId) return;
    const dy = e.clientY - g.startY;
    const dt = e.timeStamp - g.lastT;
    if (dt > 0) g.velocity = (e.clientY - g.lastY) / dt;
    g.lastY = e.clientY;
    g.lastT = e.timeStamp;
    if (!g.active) {
      // Resting: only up is the sheet's. Open: only down.
      if (g.from === "peek" ? dy > SLOP : dy < -SLOP) {
        drag.current = null;
        return;
      }
      if (Math.abs(dy) <= SLOP) return;
      g.active = true;
      try {
        sheet.setPointerCapture(e.pointerId);
      } catch {
        /* released already */
      }
      sheet.style.transition = "none";
    }
    const y = g.from === "peek" ? Math.min(g.travel, Math.max(0, g.travel + dy)) : Math.min(g.travel, Math.max(0, dy));
    sheet.style.transform = `translateY(${y}px)`;
  }, []);

  const finish = useCallback((e: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
    const g = drag.current;
    const sheet = sheetRef.current;
    if (!g || g.id !== e.pointerId) return;
    drag.current = null;
    if (!sheet || !g.active) return;
    try {
      sheet.releasePointerCapture(e.pointerId);
    } catch {
      /* released already */
    }
    dragged.current = true;
    const dy = e.clientY - g.startY;
    const far = Math.abs(dy) > Math.min(SWITCH_MAX, g.travel * SWITCH_RATIO);
    const flicked = g.from === "peek" ? g.velocity < -FLICK : g.velocity > FLICK;
    const go = !cancelled && (far || flicked) ? (g.from === "peek" ? "open" : "peek") : g.from;
    if (go === "peek" && g.from === "open") {
      const active = document.activeElement;
      if (active instanceof HTMLElement && sheet.contains(active)) active.blur();
    }
    if (reducedMotion()) {
      sheet.style.transition = "";
      sheet.style.transform = "";
      setState(go);
      return;
    }
    // Travel runs from where the finger left it to where it is going; the class takes over once it has arrived.
    sheet.style.transition = "";
    sheet.style.transform = go === "open" ? "translateY(0px)" : PEEK_TRANSFORM;
    setState(go);
    if (settle.current !== null) window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      settle.current = null;
      sheet.style.transform = "";
    }, SETTLE_MS);
  }, []);

  return (
    <div className={css.root} data-sheet={shown} data-live={live ? "" : undefined}>
      {backdrop}
      <div className={css.film} />
      <div className={css.layer}>
        <section
          ref={sheetRef}
          className={css.sheet}
          data-state={shown}
          aria-label="Create your JobFlex account"
          onFocusCapture={onFocusCapture}
          onClickCapture={onClickCapture}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => finish(e, false)}
          onPointerCancel={(e) => finish(e, true)}
        >
          <button
            type="button"
            className={css.grab}
            data-sheet-handle=""
            aria-expanded={shown === "open"}
            aria-label={shown === "open" ? "Show less of the form" : "Show the whole form"}
            disabled={!live || !canPeek}
            onClick={() => (shown === "open" ? rest() : open())}
          />
          <div ref={bodyRef} className={css.body}>
            {children}
          </div>
        </section>
      </div>
    </div>
  );
}
