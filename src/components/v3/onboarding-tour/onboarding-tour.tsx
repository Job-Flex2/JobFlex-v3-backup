"use client";

// THE FIRST-ESTIMATE TOUR (2026-10-26). Mounted once by the dashboard layout,
// outside the responsive shell, so the desk and the handheld trees both carry
// it; everything it draws is portalled to <body>.
//
//   · The welcome card — "Create your first roof estimate", Start / Not now —
//     for a new company with no estimate (lib/onboarding/progress decides).
//   · The run: one step at a time, the step's element lit (a dimmed page with a
//     Blueprint frame round the element) and a card beside it on the desk, a
//     bottom sheet on a phone. A step passes when the page shows it was done
//     (lib/onboarding/tour-paths), checked on a short tick and on every click,
//     change or keystroke inside the lit element.
//   · Away and back: leaving the step's page keeps the step; coming back asks
//     "Pick up where you left off?". Not now / Escape / ✕ pause the tour and
//     the sidebar keeps a chip that resumes it.
//   · After the Send screen: "Next steps · 1/3" behind the same chip.
//
// No library. Positions come from getBoundingClientRect, kept fresh by a
// ResizeObserver, scroll and resize; the dim never takes a click, so the page
// works exactly as it does without the tour.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";
import { saveTourProgress, type TourWrite } from "@/actions/onboarding";
import {
  NEXT_STEPS,
  TOUR_PATHS,
  isShown,
  tourCount,
  tourTitle,
  type TourPathId,
  type TourStep,
} from "@/lib/onboarding/tour-paths";
import type { TourView } from "@/lib/onboarding/progress";
import { HANDHELD, useIsHandheld } from "@/components/v3/responsive-shell/use-handheld";
import { publishTour } from "./tour-store";
import styles from "./onboarding-tour.module.css";

type Mode = "welcome" | "resume" | "run" | "idle";
type Box = { top: number; left: number; width: number; height: number };

const TICK_MS = 350;
/** A conditional step whose element has not appeared by then is not this page's. */
const WHEN_GRACE_MS = 2000;
const FRAME_PAD = 6;

const PATH_LINE: Record<TourPathId, string> = {
  roof: "Type an address and the roof is measured from the aerial — squares, pitch and a priced proposal in about two minutes.",
  fence: "Find the property, draw the fence on the map — footage, posts, gates and a priced proposal in about two minutes.",
  hvac: "Type an address — the house, the load, the unit that fits and a priced proposal in about two minutes.",
  smart: "Type the job the way you'd say it to a customer — the estimate writes itself in about two minutes.",
  deck: "Pick the structure, set the size and the boards — a 3D deck and a priced proposal in a few minutes.",
  manual: "Name the job, add the lines and save — your first proposal in a few minutes.",
};

const subscribeNever = () => () => {};

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function onRoute(step: TourStep, pathname: string): boolean {
  return !step.route || pathname === step.route || pathname.startsWith(step.route + "/");
}

/** The first target on the page and on screen sideways (a closed drawer's link sits off the left edge). */
function findTarget(step: TourStep): { el: HTMLElement; name: string } | null {
  const names = step.handheldTargets && window.matchMedia(HANDHELD).matches ? step.handheldTargets : step.targets;
  for (const name of names) {
    let first: HTMLElement | null = null;
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
      if (!isShown(el) || el.closest('[aria-hidden="true"]')) continue;
      // A closed drawer that is only made invisible (visibility, opacity) still has a box.
      if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.right <= 0 || r.left >= window.innerWidth) continue;
      // Two of the same (HVAC's Convert in the summary and under the lines): the one on screen.
      if (r.bottom > 0 && r.top < window.innerHeight) return { el, name };
      first ??= el;
    }
    if (first) return { el: first, name };
  }
  return null;
}

/** Another surface's modal is open (the estimator's question, the email panel, the plan-limit dialog): stand aside. */
function foreignModal(root: HTMLElement | null): boolean {
  for (const el of document.querySelectorAll<HTMLElement>('[aria-modal="true"]')) {
    if (root?.contains(el) || !isShown(el) || el.closest('[aria-hidden="true"]')) continue;
    // Mounted but parked (a closed sheet slid off the screen, a faded-out dialog) is not open.
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || Number(cs.opacity) < 0.05) continue;
    return true;
  }
  return false;
}

function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return document.scrollingElement as HTMLElement | null;
}

/** Bring the lit element into the part of the screen the card does not cover. */
function bringIntoView(el: HTMLElement, bottomInset: number, align?: "end") {
  const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
  const top = 64;
  const bottom = window.innerHeight - bottomInset - 12;
  const r = el.getBoundingClientRect();
  const tall = r.height > bottom - top;
  if (!tall && r.top >= top && r.bottom <= bottom) return;
  if (tall && align !== "end" && r.top >= top && r.top <= bottom - 120) return;
  if (tall && align === "end" && r.bottom <= bottom && r.bottom >= top + 120) return;
  const parent = scrollParentOf(el);
  if (!parent) return;
  const want = !tall ? top + (bottom - top - r.height) / 2 : align === "end" ? bottom - r.height - 8 : top + 8;
  parent.scrollBy({ top: r.top - want, behavior });
}

function framed(r: DOMRect): Box | null {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const top = Math.max(r.top - FRAME_PAD, 4);
  const left = Math.max(r.left - FRAME_PAD, 4);
  const bottom = Math.min(r.bottom + FRAME_PAD, vh - 4);
  const right = Math.min(r.right + FRAME_PAD, vw - 4);
  if (bottom - top < 8 || right - left < 8) return null;
  return { top, left, width: right - left, height: bottom - top };
}

/** Beside the frame on the desk: below, above, right, left — else docked bottom-right. While a field
 *  in the frame is being typed in, its suggestion list opens below it: then right, left, above first. */
function placeCard(frame: Box | null, w: number, h: number, typing = false): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const m = 12;
  const gap = 14;
  const dock = { top: vh - h - 24, left: vw - w - 24 };
  if (!frame) return dock;
  const clampX = (x: number) => Math.min(Math.max(x, m), vw - w - m);
  const clampY = (y: number) => Math.min(Math.max(y, m), vh - h - m);
  const fBottom = frame.top + frame.height;
  const fRight = frame.left + frame.width;
  const below = fBottom + gap + h <= vh - m ? { top: fBottom + gap, left: clampX(frame.left) } : null;
  const above = frame.top - gap - h >= m ? { top: frame.top - gap - h, left: clampX(frame.left) } : null;
  const right = fRight + gap + w <= vw - m ? { top: clampY(frame.top), left: fRight + gap } : null;
  const left = frame.left - gap - w >= m ? { top: clampY(frame.top), left: frame.left - gap - w } : null;
  return (typing ? right ?? left ?? above ?? below : below ?? above ?? right ?? left) ?? dock;
}

export function OnboardingTour({ view }: { view: TourView }) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const handheld = useIsHandheld();
  const path = TOUR_PATHS[view.path];
  const steps = path.steps;
  const last = steps.length - 1;

  const [status, setStatus] = useState(view.status);
  const [step, setStep] = useState(view.step);
  const [mode, setMode] = useState<Mode>(() =>
    view.status === "offer" ? "welcome" : view.status === "active" ? (view.step === 0 ? "run" : "idle") : "idle",
  );
  const [next, setNext] = useState(view.next);
  const [nextOpen, setNextOpen] = useState(false);
  /** The next steps' "Show me": the Send screen's bar, lit on its own. */
  const [nextSpot, setNextSpot] = useState(false);
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const [blocked, setBlocked] = useState(false);
  const [target, setTarget] = useState<{ el: HTMLElement; name: string } | null>(null);
  const [liveFrame, setFrame] = useState<Box | null>(null);
  const [focusIn, setFocusIn] = useState(false);
  const [cardSize, setCardSize] = useState({ w: 340, h: 200 });

  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  /** Left the step's page mid-run: coming back asks first. A reload mid-run counts as coming back. */
  const awayRef = useRef(view.status === "active" && view.step > 0);
  const interactedRef = useRef(false);
  const seenRef = useRef(false);
  const stepSinceRef = useRef(0);
  const scrolledForRef = useRef("");
  const lastFocusRef = useRef<HTMLElement | null>(null);

  const persist = useCallback(
    (op: TourWrite["op"], at: number, tour: TourWrite["tour"] = "first_estimate") => {
      void saveTourProgress({ tour, op, path: tour === "next_steps" ? "next" : view.path, step: at }).catch(() => false);
    },
    [view.path],
  );

  const goStep = useCallback(
    (to: number) => {
      const at = Math.min(to, last);
      interactedRef.current = false;
      seenRef.current = false;
      stepSinceRef.current = Date.now();
      setStep(at);
      // Reaching the Send screen is the goal: the proposal exists.
      persist(at >= last ? "complete" : "step", at);
    },
    [last, persist],
  );

  // ── Doors ──────────────────────────────────────────────────────────────
  const start = useCallback(() => {
    persist("start", 0);
    awayRef.current = false;
    interactedRef.current = false;
    seenRef.current = false;
    stepSinceRef.current = Date.now();
    setStatus("active");
    setStep(0);
    setNextOpen(false);
    setMode("run");
  }, [persist]);

  const pause = useCallback(() => {
    awayRef.current = false;
    persist("pause", step);
    setStatus("paused");
    setMode("idle");
  }, [persist, step]);

  const skip = useCallback(() => {
    persist("skip", step);
    setStatus("skipped");
    setMode("idle");
  }, [persist, step]);

  const resume = useCallback(() => {
    if (status === "completed" || status === "skipped" || status === "none" || status === "offer") return start();
    if (status === "paused") persist(step === 0 ? "start" : "resume", step);
    awayRef.current = false;
    setStatus("active");
    setMode("run");
    const s = steps[step];
    if (s?.route && !onRoute(s, window.location.pathname)) router.push((s.route) as Route);
  }, [status, step, steps, persist, start, router]);

  const finish = useCallback(() => {
    // The Send screen closed: the tour is done; its next steps take the chip.
    setStatus("completed");
    setMode("idle");
    const draft = new URLSearchParams(window.location.search).get("proposal");
    setNext((n) => n ?? { status: "active", sent: false, draftId: draft });
  }, []);

  const hideNext = useCallback(() => {
    persist("skip", 0, "next_steps");
    setNext(null);
    setNextOpen(false);
  }, [persist]);

  const showMeSend = useCallback(() => {
    setNextOpen(false);
    stepSinceRef.current = Date.now();
    setNextSpot(true);
    const dest = next?.draftId ? `/dashboard/manual-blueprint?proposal=${next.draftId}` : "/dashboard/proposals";
    router.push(dest as Route);
  }, [next, router]);

  // ── The chip and the doors, for the sidebar and the Overview ──────────
  useEffect(() => {
    const live = status === "active" || status === "paused";
    if (live) {
      const c = tourCount(view.path, step);
      publishTour({ kind: "first", path: view.path, done: c.done, total: c.total, active: status === "active" }, { start, resume, openNext: () => setNextOpen(true) });
    } else if (status === "completed" && next) {
      publishTour({ kind: "next", done: next.sent ? 1 : 0, total: NEXT_STEPS.length }, { start, resume, openNext: () => setNextOpen(true) });
    } else {
      publishTour({ kind: "none" }, { start, resume, openNext: () => setNextOpen(true) });
    }
  }, [status, step, next, view.path, start, resume]);
  useEffect(() => () => publishTour({ kind: "none" }, null), []);

  // ── The tick: has the step been done, is its page open ─────────────────
  const runStep: TourStep | null = nextSpot ? steps[last] : status === "active" ? steps[step] ?? null : null;
  useEffect(() => {
    if (!runStep) return;
    let timer = 0;
    const tick = () => {
      const p = window.location.pathname;
      const s = runStep;
      if (!stepSinceRef.current) stepSinceRef.current = Date.now();
      setBlocked(foreignModal(rootRef.current));
      // In transit to the builder: the proposals/<id> page redirects there.
      if (/^\/dashboard\/proposals\/[^/]+$/.test(p)) return;
      const found = onRoute(s, p) ? findTarget(s) : null;
      if (found) seenRef.current = true;
      setTarget((t) => (t?.el === found?.el ? t : found));

      if (nextSpot) {
        if (document.getElementById("mb-done-h")) {
          setNextSpot(false);
          setNext((n) => (n ? { ...n, sent: true } : n));
        }
        // Gone elsewhere (after the push has had time to land): the spot is dropped.
        if (p !== "/dashboard/manual-blueprint" && Date.now() - stepSinceRef.current > 4000) setNextSpot(false);
        return;
      }
      if (mode === "welcome" || mode === "resume") return;

      const ctx = { pathname: p, search: window.location.search, doc: document, interacted: interactedRef.current };
      const guarded = s.when && !seenRef.current;
      if (guarded && onRoute(s, p) && Date.now() - stepSinceRef.current > WHEN_GRACE_MS) {
        // Not this page's step (the roof came with its pitch): passed over.
        goStep(step + 1);
        return;
      }
      if (!guarded && s.done(ctx)) {
        if (step >= last) finish();
        else goStep(step + 1);
        return;
      }
      if (!onRoute(s, p)) {
        if (mode === "run") {
          awayRef.current = true;
          setMode("idle");
        }
        return;
      }
      // The away mark stays until the person answers the offer: a second tick before the
      // re-render must not turn the offer into the step.
      if (mode === "idle") setMode(awayRef.current ? "resume" : "run");
    };
    const onAct = (e: Event) => {
      const t = e.target as Node | null;
      const lit = findTarget(runStep)?.el;
      if (lit && t && lit.contains(t)) interactedRef.current = true;
      window.clearTimeout(timer);
      timer = window.setTimeout(tick, 60);
    };
    tick();
    const id = window.setInterval(tick, TICK_MS);
    document.addEventListener("click", onAct, true);
    document.addEventListener("change", onAct, true);
    document.addEventListener("input", onAct, true);
    document.addEventListener("focusout", onAct, true);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(timer);
      document.removeEventListener("click", onAct, true);
      document.removeEventListener("change", onAct, true);
      document.removeEventListener("input", onAct, true);
      document.removeEventListener("focusout", onAct, true);
    };
  }, [runStep, step, last, mode, nextSpot, goStep, finish, pathname]);

  // A conditional step (the roof's pitch) says nothing until its element is on the page.
  const showing = ((mode === "run" && status === "active") || nextSpot) && !(runStep?.when && !target);
  const sheetInset = handheld ? Math.min(window.innerHeight * 0.46, cardSize.h) : 0;

  // ── Measure the lit element ────────────────────────────────────────────
  useEffect(() => {
    if (!showing || !target) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setFrame(framed(target.el.getBoundingClientRect()));
        setFocusIn(target.el.contains(document.activeElement));
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(target.el);
    ro.observe(document.body);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    document.addEventListener("focusin", measure);
    document.addEventListener("focusout", measure);
    const id = window.setInterval(measure, 500);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      document.removeEventListener("focusin", measure);
      document.removeEventListener("focusout", measure);
      window.clearInterval(id);
    };
  }, [showing, target]);

  // Scroll the lit element into the uncovered part of the screen — once per step and target.
  useEffect(() => {
    if (!showing || !target) return;
    const key = `${step}:${target.name}:${nextSpot}`;
    if (scrolledForRef.current === key) return;
    scrolledForRef.current = key;
    bringIntoView(target.el, sheetInset, runStep?.align);
  }, [showing, target, step, nextSpot, sheetInset, runStep]);

  // The card's own size, for placing it.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const read = () => setCardSize((s) => (s.w === el.offsetWidth && s.h === el.offsetHeight ? s : { w: el.offsetWidth, h: el.offsetHeight }));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
    // Re-attached whenever the card comes or goes; the observer follows its size in between.
  }, [mounted, mode, nextOpen, nextSpot, showing, blocked, handheld, status]);

  // ── Focus and Escape ───────────────────────────────────────────────────
  const modalOpen = mode === "welcome" || nextOpen;
  const anyCard = modalOpen || mode === "resume" || showing;
  useEffect(() => {
    if (!anyCard || blocked) return;
    if (modalOpen && !lastFocusRef.current) lastFocusRef.current = document.activeElement as HTMLElement | null;
    headRef.current?.focus({ preventScroll: true });
  }, [anyCard, modalOpen, mode, step, nextSpot, blocked]);
  useEffect(() => {
    if (modalOpen) return;
    const back = lastFocusRef.current;
    lastFocusRef.current = null;
    if (back && document.contains(back)) back.focus({ preventScroll: true });
  }, [modalOpen]);

  const notNow = useCallback(() => {
    if (nextOpen) return setNextOpen(false);
    if (nextSpot) return setNextSpot(false);
    if (mode === "welcome") {
      persist("pause", 0);
      setStatus("paused");
      setMode("idle");
      return;
    }
    if (step >= last) return finish();
    pause();
  }, [nextOpen, nextSpot, mode, step, last, persist, pause, finish]);

  useEffect(() => {
    if (!anyCard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Another surface's own dialog closes first; so does an address list in a field being typed in.
        if (blocked) return;
        const a = document.activeElement as HTMLElement | null;
        if (a && !rootRef.current?.contains(a) && a.matches("input, textarea, select, [contenteditable='true']")) return;
        e.preventDefault();
        notNow();
        return;
      }
      if (e.key === "Tab" && modalOpen && cardRef.current) {
        const f = cardRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]");
        if (!f.length) return;
        const first = f[0];
        const end = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === headRef.current)) {
          e.preventDefault();
          end.focus();
        } else if (!e.shiftKey && document.activeElement === end) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [anyCard, modalOpen, blocked, notNow]);

  if (!mounted) return null;
  const frame = showing && target ? liveFrame : null;

  // ── What to draw ───────────────────────────────────────────────────────
  const count = tourCount(view.path, step);
  const title = tourTitle(view.path);
  let card: React.ReactNode = null;

  if (mode === "welcome" && status === "offer") {
    const list = steps.slice(0, -1).filter((s) => !s.when || s.counted);
    card = (
      <>
        <div className={styles.kicker}>First estimate</div>
        <h2 className={styles.title} id="tour-h" tabIndex={-1} ref={headRef}>{title}</h2>
        <p className={styles.body}>{PATH_LINE[view.path]}</p>
        <ol className={styles.plan}>
          {list.map((s, i) => (
            <li key={s.id}>
              <span className={styles.sq} aria-hidden="true">{i + 1}</span>
              <span>{s.title}</span>
            </li>
          ))}
        </ol>
        <div className={styles.acts}>
          <button type="button" className={styles.primary} onClick={start}>Start</button>
          <button type="button" className={styles.link} onClick={notNow}>Not now</button>
        </div>
      </>
    );
  } else if (nextOpen && next) {
    const done = next.sent ? 1 : 0;
    card = (
      <>
        <div className={styles.kicker}>Next steps · {done}/{NEXT_STEPS.length} done</div>
        <h2 className={styles.title} id="tour-h" tabIndex={-1} ref={headRef}>Your first estimate is made</h2>
        <ol className={styles.nextList}>
          {NEXT_STEPS.map((n, i) => {
            const isDone = n.id === "send" && next.sent;
            return (
              <li key={n.id} className={isDone ? styles.isDone : undefined}>
                <span className={`${styles.sq} ${isDone ? styles.sqDone : ""}`} aria-hidden="true">{isDone ? "✓" : i + 1}</span>
                <span className={styles.nextTxt}>
                  <span className={styles.nextT}>{n.title}</span>
                  <span className={styles.nextB}>{n.body}</span>
                </span>
                {isDone ? (
                  <span className={`${styles.stamp} ${styles.stampOk}`}>Done</span>
                ) : n.live ? (
                  <button type="button" className={styles.small} onClick={showMeSend}>Show me</button>
                ) : (
                  <span className={styles.stamp}>Coming next</span>
                )}
              </li>
            );
          })}
        </ol>
        <div className={styles.acts}>
          <button type="button" className={styles.primary} onClick={() => setNextOpen(false)}>Close</button>
          <button type="button" className={styles.link} onClick={hideNext}>Hide these</button>
        </div>
      </>
    );
  } else if (mode === "resume" && status === "active") {
    const s = steps[step];
    card = (
      <>
        <div className={styles.kicker}>First estimate · step {Math.min(count.done + 1, count.total)} of {count.total}</div>
        <h2 className={styles.title} id="tour-h" tabIndex={-1} ref={headRef}>Pick up where you left off?</h2>
        <p className={styles.body}>Next: {s?.title}.</p>
        <div className={styles.acts}>
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              awayRef.current = false;
              setMode("run");
            }}
          >
            Continue
          </button>
          <button type="button" className={styles.link} onClick={pause}>Not now</button>
        </div>
      </>
    );
  } else if (showing && runStep) {
    const s = runStep;
    const final = nextSpot || step >= last;
    const text = !target && s.waiting ? s.waiting : target?.name === "nav-menu" && s.menuBody ? s.menuBody : handheld && s.handheldBody ? s.handheldBody : s.body;
    card = (
      <>
        <div className={styles.kicker}>
          {nextSpot ? "Next steps · send it" : final ? "First estimate · done" : `First estimate · step ${count.done + 1} of ${count.total}`}
        </div>
        <button type="button" className={styles.close} onClick={notNow} aria-label={final ? "Close" : "Close the tour for now"}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        <h2 className={styles.title} id="tour-h" tabIndex={-1} ref={headRef}>{s.title}</h2>
        <p className={styles.body}>{text}</p>
        {!target && s.waiting ? <p className={styles.wait} role="status">Working…</p> : null}
        <div className={styles.acts}>
          {final ? (
            <button type="button" className={styles.primary} onClick={nextSpot ? () => setNextSpot(false) : finish}>Got it</button>
          ) : s.next ? (
            <button type="button" className={styles.primary} onClick={() => goStep(step + 1)}>Next</button>
          ) : (
            <span className={styles.hint}>Do this step to go on</span>
          )}
          {!final && (
            <button type="button" className={styles.link} onClick={skip}>Skip tour</button>
          )}
        </div>
      </>
    );
  }

  if (!card || blocked) return null;
  // A phone, a field in the frame being typed in: the keyboard and the field's own list need the screen.
  const stepAside = handheld && showing && focusIn;

  const modal = mode === "welcome" || nextOpen;
  const dim = showing && !!frame && !focusIn;
  const pos = !handheld && !modal ? placeCard(showing ? frame : null, cardSize.w, cardSize.h, focusIn) : null;
  // A phone: the sheet hangs from the top when the lit control is a bar fixed to the foot of the screen.
  // Read against a fixed share of the screen, never the card's own height: the card's height
  // changes with where it hangs, and the two would chase each other.
  const sheetTop = handheld && !modal && !!frame && frame.top > window.innerHeight * 0.55;

  return createPortal(
    <div className={styles.root} ref={rootRef} data-tour-root="">
      {modal && <div className={styles.scrim} onClick={notNow} aria-hidden="true" />}
      {showing && frame && (
        <div
          className={`${styles.frame} ${dim ? styles.frameDim : ""}`}
          style={{ top: frame.top, left: frame.left, width: frame.width, height: frame.height }}
          aria-hidden="true"
        >
          {!nextSpot && step < last && <span className={styles.tag}>{count.done + 1}/{count.total}</span>}
        </div>
      )}
      <div className={handheld ? styles.layer : styles.deskLayer} hidden={stepAside}>
        <div
          ref={cardRef}
          className={`${styles.card} ${handheld ? `${styles.sheet}${sheetTop ? ` ${styles.sheetTop}` : ""}` : modal ? styles.center : styles.pop}`}
          style={pos ? { top: pos.top, left: pos.left } : undefined}
          role="dialog"
          aria-modal={modal ? "true" : "false"}
          aria-labelledby="tour-h"
        >
          {handheld && <span className={styles.grab} aria-hidden="true" />}
          {card}
        </div>
      </div>
    </div>,
    document.body,
  );
}
