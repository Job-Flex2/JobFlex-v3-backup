"use client";

// MOBILE SMART PROPOSAL (mobile-advanced-ai-v2) — Blueprint system, handheld build.
//
// This is the phone experience of the REAL /dashboard/advanced-ai route: the
// responsive shell swaps the desktop console for this component at ≤768px. It
// was a fixture until 2026-08-13; it now runs the same server actions the
// desktop does (analyze → generate → refine → save → convert) and holds its
// line items in the SHARED console model (lib/estimate/console-model), so the
// two surfaces cannot disagree about the money chain or the materials list.
//
// Archetype C: a COMPOSER / WIZARD. The desktop surface is a tall intake console
// (three numbered steps stacked in one card) that swaps itself for a two-column
// estimate studio once a job has been priced. Neither half survives 320px as
// drawn, so both are re-cut:
//
//   INTAKE — one step visible at a time, full width. Progress is a mono
//   "STEP 2 / 4" plate over a drawn rule filled to the fraction; a sticky commit
//   foot outside the scroller holds Back (ghost) and Next / Generate (primary).
//   Steps validate on Next and nothing is lost going backwards. The desktop's
//   three steps gain a fourth — Review — because on a phone you cannot see what
//   you are about to price, and each recap row jumps back to the step that owns
//   it. Step 3 also carries the photo dropzone: a phone is the only device that
//   has the job in its hand, so pictures are cheaper to give here than anywhere.
//
//   GENERATION — the donor's one-line status ticker becomes the peak moment of
//   the flow: four stages drawn as a checklist. The narration is driven by the
//   REAL request, not a timer that pretends: the intake gate resolving raises
//   the floor, a slow dwell creeps up to the last stage and HOLDS there, and
//   only the estimate actually arriving lands the studio. It can never finish
//   ahead of the work or outlive it.
//
//   STUDIO — the desktop's `st-grid` (main column + 330px sidebar) unstacks into
//   one column: masthead, identity, scope, materials, labor, materials request,
//   totals, refine. The 6-column line-item tables cannot be shown at 320px and
//   columns are NOT hidden: every line becomes a three-line row card, and
//   editing moves into a form sheet with real 15px inputs instead of 32px
//   inline cells.
//
// Every component / region / behaviour of the desktop sheet is covered:
//  · project types, the "Other work" free-text field (which IS the projectType
//    the actions price), location + State select, site photos
//  · the brief textarea and all four sample briefs
//  · the narrated generation
//  · scope, materials, labor, assumptions,
//    totals, margin, discount, tax, client price
//  · add / edit / duplicate / move / remove line, with a row-level ✕ as well
//  · refine → real computed diff → Discard or Apply, and Undo after Apply
//  · Start over (two-tap confirm) and Save as proposal
//
// What changes versus the desktop, and why:
//  · The location field runs REAL Google Places suggestions, through the same
//    blueprint-shell/places-suggest module the desktop pages use, wrapped for
//    React by mobile-shell/address-field. cityOnly, because this field prices a
//    region rather than locating a roof.
//  · The state <select> is a bottom-sheet picker (mobile-shell/state-picker),
//    and the state it returns seeds the tax rate through ./state-tax.
//  · The "⋮" affordances become bottom sheets — no hover on touch, and
//    CLAUDE.md prefers sheets over modals.
//  · The margin / discount / tax numbers gain ± steppers: a 44px target beats a
//    spinner.
//  · Failures are a BANNER on the page, not a toast: this surface is pinned
//    (position:fixed, its own z-layer) and a phone user who just waited 40
//    seconds for a price must never be shown an empty studio with no reason.

import { DictateButton } from "@/components/estimator/DictateButton";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./mobile-advanced-ai.module.css";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { useSheetDrag } from "@/components/v3/mobile-shell/use-sheet-drag";
import { AddressField } from "@/components/v3/mobile-shell/address-field";
import { StatePicker } from "@/components/v3/mobile-shell/state-picker";
import { stateTaxPct } from "./state-tax";
import { stateFromAddress } from "@/lib/pricing/salesTax";
import { lockScroll } from "@/lib/scrollLock";
import { SAMPLES, STAGES, STATES } from "./advanced-ai-data";
import {
  blankLine,
  briefWithAnswers,
  computeTotals,
  discountFromSchema,
  discountToSchema,
  estimateFromLines,
  lineTotal,
  linesFromEstimate,
  newLineId,
  NO_DISCOUNT,
  unitSelectOptions,
  type ClarifyAnswer,
  type ConsoleLine,
  type DiscountState,
} from "@/lib/estimate/console-model";
import { isPlanLimitError } from "@/lib/planLimits";
import { clientErrorText, isStaleDeployError } from "@/lib/staleDeploy";
import {
  analyzeEstimatePrompt,
  convertEstimateToProposal,
  generateAdvancedEstimate,
  saveEstimate,
} from "@/actions/advancedEstimator";
import type { ClarifyQuestion, GeneratedEstimate, PricingSnapshotWire } from "@/lib/estimatorSchema";
import { InventoryLinkChoice } from "@/components/v3/inventory-link/inventory-link-choice";
import { isTradeId } from "@/lib/inventory";
import { takePlanEstimate, type PlanEstimateDone } from "@/lib/plans/handoff";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
/** Unit prices keep their cents — rounding them would misquote the line. */
const cash = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const STEP_COUNT = 3;
// The brief first, then where it is, then the review — the project type is no
// longer asked (owner, 2026-09-02); the planner names the work from the brief.
const STEP_NAMES = ["The brief", "Location", "Review"];

/** A hand-typed figure has to be absurd before it is refused, but it does have a ceiling. */
const MAX_MONEY = 9_999_999;
const MAX_QTY = 999_999;

// ── Site photos ─────────────────────────────────────────────────────────────
// Read in the browser, sent as base64 data URLs on the request that prices the
// job, and never uploaded or persisted anywhere. The server caps at 6 photos
// and ~8M characters each (advancedEstimator.safePhotos), so anything over that
// would be silently DROPPED — we downscale first rather than let a 12MP phone
// frame disappear without the contractor knowing it was ignored.
const MAX_PHOTOS = 6;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_EDGE = 1600;
const MAX_URL_CHARS = 7_500_000;

type Photo = { id: string; name: string; url: string; bytes: number };

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result ?? ""));
    fr.onerror = () => reject(new Error("Could not read that file"));
    fr.readAsDataURL(file);
  });
}

/**
 * Downscale to a 1600px long edge and re-encode as JPEG. Keeps a whole camera
 * roll comfortably under the server's per-photo ceiling and cuts the token cost
 * of the vision call by an order of magnitude. Formats the canvas cannot decode
 * (HEIC on most browsers) fall through to the raw data URL.
 */
async function readPhoto(file: File): Promise<string> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const url = canvas.toDataURL("image/jpeg", 0.82);
    if (!url.startsWith("data:image/jpeg;base64,")) throw new Error("encode failed");
    return url;
  } catch {
    return fileToDataUrl(file);
  }
}

function Icon({ id, className }: { id: string; className?: string }) {
  return (
    <svg className={className ?? styles.ic} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

/**
 * 750ms easeOutCubic, counting from the PREVIOUS displayed value rather than
 * from zero. On mount that is the usual 0 → total sweep; when the margin moves
 * by a point the numeral travels only the few dollars it actually changed, so
 * the headline stays legible while it is being tuned. tabular-nums keep the
 * digit columns from jumping.
 */
function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = prev.current;
    prev.current = value;
    if (prefersReducedMotion() || from === value) {
      el.textContent = money(value);
      return;
    }
    let raf = 0;
    let t0: number | null = null;
    const frame = (t: number) => {
      if (t0 === null) t0 = t;
      const pr = Math.min(1, (t - t0) / 750);
      const e = 1 - Math.pow(1 - pr, 3);
      el.textContent = money(from + (value - from) * e);
      if (pr < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <div ref={ref} className={className}>
      {money(value)}
    </div>
  );
}

type Banner = {
  tone: "danger" | "warning" | "info";
  title: string;
  body: string;
  list?: string[];
  href?: string;
  cta?: string;
};

type MenuRow = {
  act: string;
  icon: string;
  tone?: string;
  title: string;
  sub: string;
  disabled?: boolean;
  danger?: boolean;
};

/** A labor-only task (demolition, haul-away) bills no material $. */
const laborOnly = (l: ConsoleLine) => !((Number(l.materialPrice) || 0) > 0);
/** Clamp a typed figure onto [0, cap]; garbage reads as 0. */
const clampNum = (raw: string, cap: number) =>
  Math.min(cap, Math.max(0, parseFloat(raw) || 0));

const errText = (err: unknown) => clientErrorText(err);

/** The page outlived a deploy: say so, and put Reload where the eye already is. */
const STALE_BANNER = (title: string): Banner => ({
  tone: "danger",
  title,
  body: errText({ message: "Minified React error #441" }),
  href: "/mobile-advanced-ai-v2",
  cta: "Reload",
});

const PLAN_LIMIT_BANNER = (body: string): Banner => ({
  tone: "danger",
  title: "You've reached your plan limit",
  body,
  href: "/dashboard/subscription",
  cta: "See plans",
});

export function MobileSmartProposal() {
  const router = useRouter();
  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  /* ---------- flow ------------------------------------------------------ */
  const [phase, setPhase] = useState<"intake" | "busy" | "studio">("intake");
  const [step, setStep] = useState(1);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [stageIdx, setStageIdx] = useState(0);
  /* The last square has to FILL before the narration is replaced by the studio.
     Without a beat that says "finished", the checklist simply vanishes on the
     step it was still working — which reads as the run being cancelled. */
  const [genDone, setGenDone] = useState(false);
  /* Every generate gets a ticket. A response holding a stale ticket — the user
     unmounted, or started over and fired a second run — is dropped rather than
     landing an estimate nobody is waiting for. */
  const runSeq = useRef(0);
  /* The intake gate's questions, and the promise `generate()` parks on while
     the sheet is open. The resolver lives in a ref so answering cannot race a
     re-render — the awaiting call resumes exactly once. */
  const [clarify, setClarify] = useState<ClarifyQuestion[] | null>(null);
  const clarifyResolve = useRef<((v: ClarifyAnswer[] | null) => void) | null>(null);
  const [clarifyAns, setClarifyAns] = useState<Record<string, string>>({});
  const [clarifyCustom, setClarifyCustom] = useState<Record<string, boolean>>({});
  /* The Escape ladder is bound above where `settleClarify` is declared, so it
     reaches it through a ref rather than forcing the pipeline's functions to
     move up here away from the code they belong with. */
  const settleClarifyRef = useRef<(v: ClarifyAnswer[] | null) => void>(() => {});

  /* ---------- intake input (never cleared by going back) ---------------- */
  const [locText, setLocText] = useState("");
  const [locState, setLocState] = useState("");
  const [brief, setBrief] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoErr, setPhotoErr] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [errBrief, setErrBrief] = useState(false);
  const libRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  /* ---------- estimate -------------------------------------------------- */
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  /** What the post-generation check changed (lib/estimate/validate-estimate). */
  const [checkNotes, setCheckNotes] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState("");
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [timelineDays, setTimelineDays] = useState<number | null>(null);
  const [margin, setMargin] = useState(18);
  const [discount, setDiscount] = useState<DiscountState>(NO_DISCOUNT);
  /* Tax is DERIVED, not synced: `null` means "follow the state picked in
     intake", any number means the contractor has overridden it. Deriving it
     rather than mirroring the state into an effect is what keeps the two from
     fighting — an effect that re-set the rate on every `locState` change would
     also clobber a hand-typed rate, and costs a render besides. */
  const [taxOverride, setTaxOverride] = useState<number | null>(null);
  /* The company's own pricing (Settings → Estimating) the estimate was built
     with, when its switch is on. It rides with the save and the convert, so the
     proposal keeps the company's prices and its sales-tax rule. */
  const [pricing, setPricing] = useState<PricingSnapshotWire | null>(null);
  /* The location string the estimate was actually priced against — the intake
     gate normalizes "bothel wa" to "Bothell, WA", and refine / save must use
     what was priced, not what was typed. */
  const [locUsed, setLocUsed] = useState("");

  /* ---------- request state --------------------------------------------- */
  const [saveBusy, setSaveBusy] = useState(false);
  // Connected to the warehouse or an estimate only — null until the choice decides its default (2026-09-20).
  const [invLink, setInvLink] = useState<boolean | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);

  /* ---------- transient confirmations ----------------------------------- */
  const [confirmReset, setConfirmReset] = useState(false);
  const [armedDel, setArmedDel] = useState<string | null>(null);
  const [landedId, setLandedId] = useState<string | null>(null);

  /* ---------- sheets ---------------------------------------------------- */
  const [sheetRef2, setSheetRef2] = useState<string | null>(null);
  const [editRef, setEditRef] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", qty: "1", unit: "unit", material: "0", labor: "0" });
  const [nameErr, setNameErr] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  /* ---------- viewport height -------------------------------------------
     Mandatory rule: viewport heights only via var(--app-h). A phone's URL bar
     changes innerHeight mid-scroll, so the real value is republished rather
     than trusting a bare 100vh/100dvh. It also keeps the sticky commit foot
     above the software keyboard, which every step of this wizard raises. */
  useEffect(() => {
    const apply = () => {
      const h = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--app-h", `${h}px`);
    };
    apply();
    window.addEventListener("resize", apply);
    window.visualViewport?.addEventListener("resize", apply);
    const releaseScroll = lockScroll();
    return () => {
      window.removeEventListener("resize", apply);
      window.visualViewport?.removeEventListener("resize", apply);
      document.documentElement.style.removeProperty("--app-h");
      releaseScroll();
    };
  }, []);

  /* A response that arrives after this component is gone must not set state. */
  useEffect(() => () => { runSeq.current += 1; }, []);

  /* ---------- Motion: reveal on load + adaptive reveal on scroll --------- */
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const host = scrollRef.current;
    const content = contentRef.current;
    if (!host || !content) return;

    let velLastY = host.scrollTop;
    let velLastT = performance.now();
    let vel = 0;
    const onScroll = () => {
      const now = performance.now();
      vel = Math.abs(host.scrollTop - velLastY) / Math.max(1, now - velLastT);
      velLastY = host.scrollTop;
      velLastT = now;
    };
    host.addEventListener("scroll", onScroll, { passive: true });

    const vpH = window.innerHeight;
    const blocks = Array.from(content.children) as HTMLElement[];
    blocks.forEach((el, i) => {
      el.classList.add(styles.rv);
      const initial = el.getBoundingClientRect().top < vpH;
      if (!initial) el.dataset.rvScroll = "1";
      el.style.transitionDelay = initial ? `${i * 60}ms` : "200ms";
    });
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const t = en.target as HTMLElement;
          // Below the fold: duration follows scroll speed — slow ≈ 900ms,
          // fast never shorter than 550ms.
          if (t.dataset.rvScroll) {
            t.style.transitionDuration = `${Math.round(Math.max(550, 900 - vel * 160))}ms`;
          }
          t.classList.add(styles.rvIn);
          io.unobserve(t);
          const done = () => {
            t.style.transitionDelay = "";
            t.style.transitionDuration = "";
            t.removeEventListener("transitionend", done);
          };
          t.addEventListener("transitionend", done);
        });
      },
      { threshold: 0, rootMargin: "0px 0px 60px 0px" },
    );
    blocks.forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      host.removeEventListener("scroll", onScroll);
    };
  }, []);

  /* ---------- Motion: graph-paper parallax ------------------------------ */
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const host = scrollRef.current;
    if (!host) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        host.style.setProperty("--gy", `${(-(host.scrollTop * 0.06)).toFixed(1)}px`);
        ticking = false;
      });
    };
    host.addEventListener("scroll", onScroll, { passive: true });
    return () => host.removeEventListener("scroll", onScroll);
  }, []);

  /* ---------- Motion: press stamp (delegated, covers late rows) --------- */
  const onRootClick = useCallback((e: React.MouseEvent) => {
    if (prefersReducedMotion()) return;
    const sel = [
      styles.btn, styles.ptype, styles.sample, styles.revEdit,
      styles.addLine, styles.lrowOpen, styles.lrowDel, styles.marginBtn,
      styles.rfBtn, styles.menuItem, styles.sheetCancel, styles.lemptyA,
      styles.dzBtn, styles.thumbX, styles.unitChip, styles.discBtn,
      styles.mbuy, styles.bBtn, styles.asmX, styles.llinkBtn,
    ].map((c) => `.${c}`).join(", ");
    const el = (e.target as HTMLElement).closest<HTMLElement>(sel);
    if (!el) return;
    el.classList.remove(styles.pressed);
    void el.offsetWidth;
    el.classList.add(styles.pressed);
    el.addEventListener("animationend", () => el.classList.remove(styles.pressed), { once: true });
  }, []);

  /* ---------- Esc closes what the PAGE owns -----------------------------
     The drawer is not listed: MobileNav binds its own Escape while open, so the
     two listeners cannot both claim one key press. */
  useEffect(() => {
    if (!sheetRef2 && !editRef && !clarify) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (editRef) setEditRef(null);
      else if (sheetRef2) setSheetRef2(null);
      // Escape on the questions is backing OUT of the run, not "generate
      // anyway" — a stray key press must never spend a model call.
      else settleClarifyRef.current(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheetRef2, editRef, clarify]);

  /* ---------- generation narration --------------------------------------
     Driven by the real request, not by a script. Two things move the checklist:
     an observable checkpoint (the intake gate returning raises the floor to
     stage 2), and a slow dwell that creeps forward and then HOLDS on the last
     stage for as long as the model takes. Nothing here can tick past the end,
     and nothing here lands the studio — only the estimate arriving does that,
     so the narration can neither finish early nor outlive the work.

     THE BUG THIS FIXES: stage 0 used to creep on a 2400ms timer that raced the
     gate. `analyzeEstimatePrompt` takes several seconds, so "Reading the brief"
     reliably ticked itself done — and the SECOND square lit — while the brief
     was still being read. Every mark after that was narrating a phase that had
     not started. Stage 0 now carries dwellMs: 0 and has no timer at all: it
     ends when the gate actually returns, which is the one boundary this client
     can observe. */
  useEffect(() => {
    if (phase !== "busy" || genDone) return;
    const last = STAGES.length - 1;
    if (stageIdx >= last) return;
    const dwell = STAGES[stageIdx]?.dwellMs ?? 0;
    if (!dwell) return;
    const id = window.setTimeout(() => setStageIdx((i) => Math.min(last, i + 1)), dwell);
    return () => window.clearTimeout(id);
  }, [phase, stageIdx, genDone]);

  /* Landing on the studio starts at the top of the document. */
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [phase]);

  /* The two-tap confirm windows. */
  useEffect(() => {
    if (!confirmReset) return;
    const t = window.setTimeout(() => setConfirmReset(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirmReset]);
  useEffect(() => {
    if (!armedDel) return;
    const t = window.setTimeout(() => setArmedDel(null), 3000);
    return () => window.clearTimeout(t);
  }, [armedDel]);
  useEffect(() => {
    if (!landedId) return;
    const t = window.setTimeout(() => setLandedId(null), 700);
    return () => window.clearTimeout(t);
  }, [landedId]);

  /* ---------- derived ----------------------------------------------------
     Every figure on this page comes out of computeTotals, so the handheld and
     the desktop console cannot drift on the cost → margin → discount → tax
     chain. Nothing below re-does that arithmetic locally. */
  /* 0 until a state is picked — the counter's documented resting value. Base
     state rate only; county and city are excluded. See ./state-tax.ts. */
  const taxAuto = stateTaxPct(locState);
  const taxPct = taxOverride ?? taxAuto;
  const taxTouched = taxOverride !== null;
  const totals = useMemo(
    () =>
      computeTotals({
        lines,
        discount,
        taxPct,
        marginPct: margin,
        taxOn: pricing?.taxMode === "materials" ? "materials" : "all",
      }),
    [lines, discount, taxPct, margin, pricing],
  );

  // No project type is asked any more; the actions still take the field, so it
  // rides through empty and the planner names the work from the brief.
  const typeLabel = "";
  const where = locText.trim()
    ? `${locText.trim()}${locState ? `, ${locState}` : ""}`
    : "";
  const estTitle = title.trim() || brief.trim().split("\n")[0].slice(0, 90) || "New estimate";

  const findLine = (id: string | null) => (id ? lines.find((l) => l.id === id) ?? null : null);

  /* ---------- wizard ---------------------------------------------------- */
  const validate = (n: number) => {
    // Step 1 is the brief, and it is the only required field. Step 2 (location)
    // has none: the estimator prices without a location too, it just skips the
    // regional adjustment. Review says so out loud.
    if (n === 1) {
      if (!brief.trim()) {
        setErrBrief(true);
        return false;
      }
    }
    return true;
  };

  const goStep = (n: number) => {
    setDir(n > step ? "fwd" : "back");
    setStep(Math.min(STEP_COUNT, Math.max(1, n)));
    scrollRef.current?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };
  const next = () => {
    if (!validate(step)) return;
    if (step < STEP_COUNT) goStep(step + 1);
    else void generate();
  };

  /* ---------- photos ----------------------------------------------------- */
  const photoBytes = photos.reduce((n, p) => n + p.bytes, 0);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      setPhotoErr("");
      const picked = Array.from(files);
      if (!picked.length) return;
      const images = picked.filter((f) => f.type.startsWith("image/"));
      if (images.length !== picked.length) {
        setPhotoErr("Images only — the rest of what you picked was skipped.");
      }
      const accepted: Photo[] = [];
      let room = MAX_PHOTOS - photos.length;
      for (const file of images) {
        if (room <= 0) {
          setPhotoErr(`Up to ${MAX_PHOTOS} photos — the extras were skipped.`);
          break;
        }
        if (file.size > MAX_FILE_BYTES) {
          setPhotoErr(`“${file.name}” is over ${mb(MAX_FILE_BYTES)} and was skipped.`);
          continue;
        }
        try {
          const url = await readPhoto(file);
          if (url.length > MAX_URL_CHARS) {
            setPhotoErr(`“${file.name}” is too large to send and was skipped.`);
            continue;
          }
          accepted.push({
            id: newLineId("ph"),
            name: file.name || "Photo",
            url,
            // The data URL is what actually travels, so that is what is counted.
            bytes: Math.round((url.length * 3) / 4),
          });
          room -= 1;
        } catch {
          setPhotoErr(`Couldn't read “${file.name}”.`);
        }
      }
      if (accepted.length) setPhotos((prev) => prev.concat(accepted));
    },
    [photos.length],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) void addFiles(e.dataTransfer.files);
  };
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) void addFiles(e.target.files);
    // Same file twice in a row must still fire a change event.
    e.target.value = "";
  };

  /* ---------- an estimate from the blueprint estimator --------------------- */
  // Plan sets have their own tool, kept apart from this page (2026-10-13). Its "Edit in
  // Smart Proposal" hands an estimate here to be edited (lib/plans/handoff).
  const landPlans = (r: PlanEstimateDone) => {
    setLines(r.lines);
    setCheckNotes(r.notes);
    setTitle(r.title);
    setScope(r.scope);
    setAssumptions(r.assumptions);
    setTimelineDays(r.timelineDays);
    setDiscount(NO_DISCOUNT);
    setLocUsed(r.location);
    setPricing(null);
    setBanner(null);
    setPhase("studio");
  };
  useEffect(() => {
    const t = setTimeout(() => {
      const handed = takePlanEstimate();
      if (handed) landPlans(handed);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  /* ---------- the real pipeline ------------------------------------------ */

  /** Bounce back to Review with a readable reason. Never a blank studio. */
  const failTo = (b: Banner) => {
    setPhase("intake");
    setDir("back");
    setStep(STEP_COUNT);
    setBanner(b);
  };

  const landEstimate = (
    est: GeneratedEstimate,
    opts: { disabled: boolean; location: string; hints: string[] },
  ) => {
    setLines(linesFromEstimate(est));
    setCheckNotes(est.notes ?? []);
    setTitle(est.title || estTitle);
    setScope(est.scope || brief.trim());
    setAssumptions(est.assumptions);
    setTimelineDays(est.estimatedTimelineDays ?? null);
    setDiscount(discountFromSchema(est.discount));
    setLocUsed(opts.location);
    // Priced the company's way: its prices already carry the markup and any
    // overhead/profit, so no margin goes on top; its tax rule seeds the rate
    // (none → 0, its own rate → that rate, else the job state's rate).
    const company = est.pricing ?? null;
    setPricing(company);
    if (company) {
      setMargin(0);
      // The job state's rate when none was picked: the state in the address the estimate was priced at.
      const priced = stateFromAddress(opts.location);
      setTaxOverride(
        company.taxMode === "none"
          ? 0
          : company.taxRatePct != null
            ? company.taxRatePct
            : taxAuto === 0 && priced
              ? stateTaxPct(priced)
              : null,
      );
    }
    setBanner(
      opts.disabled
        ? {
            tone: "warning",
            title: "AI is switched off — this is a sample",
            body:
              "No OPENAI_API_KEY is configured, so the estimator returned placeholder lines instead of pricing your brief. Everything below still edits and converts, but the numbers are not real.",
          }
        : opts.hints.length
          ? {
              tone: "info",
              title: "The brief was thin — the AI had to assume",
              body:
                "It priced the job anyway. Answering any of these in “Change the estimate” will tighten it:",
              list: opts.hints,
            }
          : null,
    );
    setPhase("studio");
  };

  /**
   * Park generation on the questions sheet.
   *
   * Resolves with the answered pairs (possibly empty — "Generate anyway"), or
   * null when the contractor backed out of the run entirely.
   */
  const askClarify = (questions: ClarifyQuestion[]): Promise<ClarifyAnswer[] | null> =>
    new Promise((resolve) => {
      clarifyResolve.current = resolve;
      setClarifyAns({});
      setClarifyCustom({});
      setClarify(questions);
    });

  /** Settle the sheet exactly once — a second press cannot resume the run twice. */
  const settleClarify = (value: ClarifyAnswer[] | null) => {
    const resolve = clarifyResolve.current;
    if (!resolve) return;
    clarifyResolve.current = null;
    setClarify(null);
    resolve(value);
  };
  // Published for the Escape ladder, which is bound above this declaration.
  // In an effect, not during render — a ref written while rendering is the
  // "cannot update ref during render" trap.
  useEffect(() => {
    settleClarifyRef.current = settleClarify;
  });

  const generate = async () => {
    if (!validate(1)) {
      goStep(1);
      return;
    }
    const ticket = (runSeq.current += 1);
    const stale = () => runSeq.current !== ticket;

    const projectType = typeLabel;
    const typedBrief = brief.trim();
    // Each photo in its own object — see SitePhoto in actions/advancedEstimator.
    const photoUrls = photos.map((p) => ({ url: p.url }));

    setBanner(null);
    setStageIdx(0);
    setGenDone(false);
    setPhase("busy");

    try {
      // Intake gate: corrects the location and tells us whether the brief was
      // thin enough that the estimate rests on assumptions.
      let location = where;
      let hints: string[] = [];
      const gate = await analyzeEstimatePrompt({
        projectType,
        description: typedBrief,
        location: where || undefined,
        photos: photoUrls,
      });
      if (stale()) return;
      if (!gate.ok) {
        // The gate is the ONLY place a plan limit or an entitlement failure is
        // cheap to catch — it runs before the expensive call. Anything else it
        // reports is non-fatal: generation is still worth attempting.
        if (gate.code === "PLAN_LIMIT_REACHED") {
          failTo(PLAN_LIMIT_BANNER(gate.error));
          return;
        }
        failTo({ tone: "danger", title: "Couldn't start the estimate", body: gate.error });
        return;
      }
      if (gate.data.correctedLocation) location = gate.data.correctedLocation;

      // ── The thin-brief gate ────────────────────────────────────────
      // The gate already decided; asking here spends that decision instead of
      // discarding it into a post-hoc "the AI had to assume" note, and costs no
      // extra model call. The narration steps back to Review while the sheet is
      // up, because the checklist would be narrating work that is paused.
      let description = typedBrief;
      if (!gate.data.enoughDetail && gate.data.questions.length > 0) {
        setPhase("intake");
        setDir("back");
        setStep(STEP_COUNT);
        const answers = await askClarify(gate.data.questions);
        if (stale()) return;
        // Backed out — nothing is priced and the brief is untouched.
        if (answers === null) return;
        description = briefWithAnswers(typedBrief, answers);
        // Whatever they left blank still rides along to the studio banner, so
        // "Generate anyway" surfaces exactly the gaps it always did.
        const answered = new Set(answers.map((a) => a.question));
        hints = gate.data.questions
          .filter((q) => !answered.has(q.question))
          .map((q) => q.question);
        setBanner(null);
        setStageIdx(0);
        setGenDone(false);
        setPhase("busy");
      }

      // Observable progress: the brief has been read.
      setStageIdx((i) => Math.max(i, 1));

      const res = await generateAdvancedEstimate({
        projectType,
        description,
        location: location || undefined,
        photos: photoUrls,
      });
      if (stale()) return;
      if (!res.ok) {
        failTo(
          res.code === "PLAN_LIMIT_REACHED"
            ? PLAN_LIMIT_BANNER(res.error)
            : { tone: "danger", title: "Couldn't price the job", body: res.error },
        );
        return;
      }
      // Fill the last square and hold it for a beat, so the checklist reads as
      // finished rather than vanishing on the step it was still working.
      setStageIdx(STAGES.length - 1);
      setGenDone(true);
      await new Promise((r) => setTimeout(r, prefersReducedMotion() ? 0 : 620));
      if (stale()) return;
      landEstimate(res.data, { disabled: Boolean(res.disabled), location, hints });
    } catch (err) {
      if (stale()) return;
      failTo(isStaleDeployError(err) ? STALE_BANNER("Couldn't price the job") : { tone: "danger", title: "Couldn't price the job", body: errText(err) });
    }
  };

  const startOver = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    // Any request still in flight loses its ticket, so it cannot land on top
    // of a fresh intake. A run parked on the questions sheet is resolved too —
    // otherwise its `await` never returns and the closure is held forever.
    runSeq.current += 1;
    settleClarify(null);
    setConfirmReset(false);
    setLines([]);
    setTitle("");
    setScope("");
    setAssumptions([]);
    setTimelineDays(null);
    setDiscount(NO_DISCOUNT);
    if (pricing) {
      setMargin(18);
      setTaxOverride(null);
    }
    setPricing(null);
    setBanner(null);
    setPhase("intake");
    setDir("back");
    setStep(1);
  };

  /* ---------- line editing ---------------------------------------------- */
  /** One line, changed in place — the desktop console's `patch`. */
  const patch = (id: string, next: Partial<ConsoleLine>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...next } : l)));
  };

  const addLine = () => {
    const line: ConsoleLine = { ...blankLine(), name: "New line" };
    setLines((prev) => prev.concat(line));
    setLandedId(line.id);
    openEdit(line);
  };

  const openEdit = (line: ConsoleLine) => {
    setSheetRef2(null);
    setForm({
      name: line.name,
      qty: String(line.qty),
      unit: line.unit,
      material: String(line.materialPrice ?? 0),
      labor: String(line.laborPrice ?? 0),
    });
    setNameErr(false);
    setEditRef(line.id);
    window.setTimeout(() => nameRef.current?.focus(), prefersReducedMotion() ? 0 : 320);
  };

  const submitEdit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setNameErr(true);
      nameRef.current?.focus();
      return;
    }
    const id = editRef;
    if (!id) return;
    setLines((prev) =>
      prev.map((l) =>
        l.id === id
          ? {
              ...l,
              name,
              qty: clampNum(form.qty, MAX_QTY),
              unit: form.unit.trim() || "unit",
              materialPrice: clampNum(form.material, MAX_MONEY),
              laborPrice: clampNum(form.labor, MAX_MONEY),
            }
          : l,
      ),
    );
    setLandedId(id);
    setEditRef(null);
  };

  /** Two-tap, like Start over: a mis-tap on a 30px control must not destroy a line. */
  const removeLine = (id: string) => {
    if (armedDel !== id) {
      setArmedDel(id);
      return;
    }
    setArmedDel(null);
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  /* ---------- save → proposal -------------------------------------------- */
  const saveAsProposal = async () => {
    if (saveBusy || !lines.length) return;
    setSaveBusy(true);
    setBanner(null);
    // A suggestion counts in no total until it is added, so it never reaches the proposal.
    const built = estimateFromLines(lines.filter((l) => l.flag !== "suggested"), {
      title: estTitle,
      scope,
      assumptions,
      estimatedTimelineDays: timelineDays ?? undefined,
      discount: discountToSchema(discount),
    });
    const payload = pricing ? { ...built, pricing } : built;
    try {
      await saveEstimate({
        projectType: typeLabel,
        location: locUsed || null,
        data: payload,
      });
      const res = await convertEstimateToProposal({
        projectType: typeLabel,
        inventoryLinked: invLink,
        title: payload.title,
        scope: payload.scope,
        materials: payload.materials,
        labor: payload.labor,
        assumptions,
        location: locUsed || undefined,
        discount: payload.discount ?? null,
        ...(pricing ? { pricing, taxPct } : {}),
      });
      // router.push, never location.assign — a hard nav replays the blueprint
      // entrance and the user sees the page build itself twice.
      // The BLUEPRINT manual builder, not the legacy /dashboard/proposals/<id>
      // editor — same reasoning as the desktop console; ?proposal=<id> reopens
      // the estimate that was just persisted.
      router.push(`/dashboard/manual-blueprint?proposal=${res.id}`);
    } catch (err) {
      setSaveBusy(false);
      setBanner(
        isPlanLimitError(err)
          ? PLAN_LIMIT_BANNER(errText(err))
          : isStaleDeployError(err)
            ? STALE_BANNER("Couldn't create the proposal")
            : { tone: "danger", title: "Couldn't create the proposal", body: errText(err) },
      );
    }
  };

  /* ---------- row actions sheet ----------------------------------------- */
  const sheetLine = findLine(sheetRef2);
  const editLine = findLine(editRef);

  const menuRows = useMemo<MenuRow[]>(() => {
    if (!sheetLine) return [];
    return [
      { act: "edit", icon: "i-file", tone: styles.miBp, title: "Edit line",
        sub: "Description, quantity, material and labor" },
      { act: "dup", icon: "i-copy", title: "Duplicate line", sub: "Copies it in below" },
      { act: "del", icon: "i-trash", tone: styles.miDanger, title: "Remove line",
        sub: "Deletes it from the estimate", danger: true },
    ];
  }, [sheetLine]);

  const runMenu = (act: string) => {
    if (!sheetLine) return;
    const id = sheetLine.id;
    if (act === "edit") {
      openEdit(sheetLine);
      return;
    }
    setSheetRef2(null);
    if (act === "dup") {
      const copy: ConsoleLine = { ...sheetLine, id: newLineId("d"), badge: undefined };
      setLines((prev) => {
        const at = prev.findIndex((l) => l.id === id);
        return prev.slice(0, at + 1).concat(copy, prev.slice(at + 1));
      });
      setLandedId(copy.id);
    } else if (act === "del") {
      setLines((prev) => prev.filter((l) => l.id !== id));
    }
  };

  const anyOverlay = Boolean(sheetLine) || Boolean(editLine) || Boolean(clarify);

  // Swipe-down dismissal, one gesture per sheet, on the same setters the
  // Escape ladder uses.
  const actionsDrag = useSheetDrag(Boolean(sheetLine), () => setSheetRef2(null));
  const editDrag = useSheetDrag(Boolean(editLine), () => setEditRef(null));
  // Swiping the questions away is backing out of the run, the same as the
  // scrim and Escape — never a silent "generate anyway", which would spend a
  // model call on a gesture.
  const clarifyDrag = useSheetDrag(Boolean(clarify), () => settleClarify(null));

  /** The answered pairs, in question order, blanks dropped. */
  const clarifyPairs = (): ClarifyAnswer[] =>
    (clarify ?? [])
      .filter((q) => (clarifyAns[q.id] ?? "").trim())
      .map((q) => ({ question: q.question, answer: (clarifyAns[q.id] ?? "").trim() }));
  const stepCls = `${styles.step} ${dir === "fwd" ? styles.stepFwd : styles.stepBack}`;
  // The ten house units, with whatever the AI actually returned kept at the
  // head when it is off-list ("square", "lot") — dropping it would silently
  // retype the line. Full labels, never truncated.
  const editUnits = useMemo(
    () => (editLine ? unitSelectOptions(editLine.unit) : []),
    [editLine],
  );

  /* ---------- ONE ledger, drawn as row cards ----------------------------
     One line per task, two prices per line: material $/unit and labor $/unit
     are columns of every row, never row types. The line total is
     qty × (material + labor). */
  const renderLines = () => {
    // A suggestion is work the description never asked for: shown apart,
    // in no total until it is added (audit 2026-09-17).
    const list = lines.filter((l) => l.flag !== "suggested");
    const suggestions = lines.filter((l) => l.flag === "suggested");
    const total = totals.subtotal;
    return (
      <section className={styles.card} key="lines">
        <div className={styles.cardHead}>
          <span className={styles.cardLbl}>Line items</span>
          <span className={`${styles.cardSum} ${total ? "" : styles.isZero}`}>
            {total ? money(total) : "—"}
          </span>
        </div>
        {list.length === 0 ? (
          <div className={styles.lempty}>
            <div className={styles.lemptyT}>Nothing costed yet</div>
            <div className={styles.lemptyS}>
              Every line was removed. Add one back, or start over and generate again.
            </div>
            <button className={styles.lemptyA} type="button" onClick={addLine}>
              <Icon id="i-plus" />Add line
            </button>
          </div>
        ) : (
          <div className={styles.lines}>
            {list.map((l, i) => {
              const t = lineTotal(l);
              const armed = armedDel === l.id;
              // An estimate from blueprints heads each trade's lines with the trade.
              const head = l.group && l.group !== list[i - 1]?.group ? (
                <div className={styles.lgroup} key={`g:${l.group}`}>
                  <span>{l.group}</span>
                  <span>{money(list.filter((x) => x.group === l.group).reduce((n, x) => n + lineTotal(x), 0))}</span>
                </div>
              ) : null;
              return [
                head,
                <div
                  key={l.id}
                  className={`${styles.lrow} ${styles.rowIn} ${landedId === l.id ? styles.landed : ""}`}
                  style={{ animationDelay: `${i * 45}ms` }}
                >
                  {/* Title and the mono quantity annotation are ONE target:
                      a 19px text button is under the 44px floor, and tapping
                      either is the same intent — edit this line. */}
                  <button
                    className={styles.lname}
                    type="button"
                    onClick={() => openEdit(l)}
                  >
                    <span className={styles.lnameT}>
                      {l.name}
                      {l.badge ? <span className={styles.lbadge}>{l.badge}</span> : null}
                      {l.flag === "auto" ? <span className={`${styles.lbadge} ${styles.lflag}`}>added</span> : null}
                      {l.flag === "adjusted" ? <span className={`${styles.lbadge} ${styles.lflag}`}>adjusted</span> : null}
                      {/* The measured-from-your-description note rides in
                          title= for a long-press. */}
                      {l.flag === "computed" ? <span className={`${styles.lbadge} ${styles.lflag}`} title={l.flagNote ?? undefined}>computed</span> : null}
                    </span>
                    <span className={styles.lmeta}>
                      {l.qty} {l.unit} × {cash(l.materialPrice + l.laborPrice)}
                    </span>
                  </button>
                  <div className={styles.lrowActs}>
                    {/* Removal used to be three taps deep in the ⋮ sheet. It is
                        one tap here — and two to commit, like Start over. */}
                    <button
                      className={`${styles.lrowDel} ${armed ? styles.isArmed : ""}`}
                      type="button"
                      aria-label={armed ? `Tap again to remove ${l.name}` : `Remove ${l.name}`}
                      title={armed ? "Tap again to remove" : "Remove line"}
                      onClick={() => removeLine(l.id)}
                    >
                      <Icon id={armed ? "i-trash" : "i-x"} />
                    </button>
                    <button
                      className={styles.lrowOpen}
                      type="button"
                      aria-label={`Actions for ${l.name}`}
                      onClick={() => setSheetRef2(l.id)}
                    >
                      <Icon id="i-dots" />
                    </button>
                  </div>
                  {/* The two prices, as two cells: what the client is billed
                      per unit for the supply and for the work. A zero cell
                      reads as "—", so a labor-only task is obviously so. */}
                  <div className={styles.lsplit}>
                    <span className={styles.lcell}>
                      <span className={styles.lcellL}>Material</span>
                      <span className={`${styles.lcellV} ${l.materialPrice ? "" : styles.isZero}`}>
                        {l.materialPrice ? cash(l.materialPrice) : "—"}
                        {l.materialPrice ? <em className={styles.lper}>/{l.unit}</em> : null}
                      </span>
                    </span>
                    <span className={styles.lcell}>
                      <span className={styles.lcellL}>Labor</span>
                      <span className={`${styles.lcellV} ${l.laborPrice ? "" : styles.isZero}`}>
                        {l.laborPrice ? cash(l.laborPrice) : "—"}
                        {l.laborPrice ? <em className={styles.lper}>/{l.unit}</em> : null}
                      </span>
                    </span>
                  </div>
                  <div className={styles.lfoot}>
                    {/* No store link on a line (owner, 2026-10-09): the
                        estimate is not a shop list. A labor-only task still
                        says so — that is about the job, not a store. */}
                    {laborOnly(l) ? <span className={styles.lown}>Labor only</span> : null}
                    <span className={`${styles.ltotal} ${t ? "" : styles.isZero}`}>
                      {t ? money(t) : "—"}
                    </span>
                  </div>
                </div>,
              ];
            })}
          </div>
        )}
        {/* Work the description never asked for: priced, shown, and in no
            total until the contractor taps it in. */}
        {suggestions.length > 0 && (
          <div className={styles.suggBlock}>
            <div className={styles.suggHead}>Not in your description</div>
            {suggestions.map((sg) => (
              <button
                key={sg.id}
                type="button"
                className={styles.suggRow}
                onClick={() => patch(sg.id, { flag: undefined, flagNote: undefined })}
              >
                <span className={styles.suggName}>{sg.name}</span>
                <span className={styles.suggCash}>{cash(lineTotal(sg))}</span>
                <span className={`${styles.lbadge} ${styles.lflag}`}>add</span>
              </button>
            ))}
          </div>
        )}
        {checkNotes.length > 0 && (
          <ul className={styles.checkNotes}>
            {checkNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        {/* The empty state already carries the Add-line CTA — one per card. */}
        {list.length === 0 ? null : (
          <div className={styles.cardFoot}>
            <button className={styles.addLine} type="button" onClick={addLine}>
              <Icon id="i-plus" />Add line
            </button>
          </div>
        )}
      </section>
    );
  };

  return (
    <div className={styles.app} onClick={onRootClick}>
      {/* Three symbols the shared 48-icon sprite does not carry, prefixed so they
          can never collide with it or with another page. Original lucide paths
          (package, pen-line), 24×24, stroke 2, currentColor. */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs>
          <symbol id="i-advanced-ai-box" viewBox="0 0 24 24">
            <path d="m7.5 4.27 9 5.15" />
            <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
            <path d="m3.3 7 8.7 5 8.7-5" />
            <path d="M12 22V12" />
          </symbol>
          <symbol id="i-advanced-ai-mic" viewBox="0 0 24 24">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <path d="M12 18v3" />
            <path d="M8 21h8" />
          </symbol>
          <symbol id="i-advanced-ai-pen" viewBox="0 0 24 24">
            <path d="M12 20h9" />
            <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
          </symbol>
        </defs>
      </svg>

      {/* Shared handheld nav: topbar + drawer + sprite. Owns its own open
          state, so the page holds none. */}
      <MobileNav />

      {/* ============ SCROLLER ============ */}
      <main className={styles.scroll} ref={scrollRef}>
        <div className={styles.content} ref={contentRef}>
          {/* PAGE HEAD — no action buttons: the wizard's commit pair lives in
              the sticky foot, in the thumb zone, where it belongs. */}
          <div className={styles.pageHead}>
            <h1 className={styles.pageTitle}>Smart Proposal</h1>
          </div>

          {/* THE ONE PLACE A FAILURE IS REPORTED. A toast cannot be trusted on a
              surface that pins itself over the app, and "nothing happened" is
              never an acceptable answer to a 40-second wait. */}
          {banner ? (
            <div
              className={`${styles.banner} ${
                banner.tone === "danger"
                  ? styles.bDanger
                  : banner.tone === "warning"
                    ? styles.bWarn
                    : styles.bInfo
              }`}
              role="status"
            >
              <div className={styles.bTitle}>{banner.title}</div>
              <div className={styles.bBody}>{banner.body}</div>
              {banner.list?.length ? (
                <ul className={styles.bList}>
                  {banner.list.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              ) : null}
              <div className={styles.bActs}>
                {banner.href ? (
                  <a className={styles.bBtn} href={banner.href}>
                    {banner.cta ?? "Open"}
                  </a>
                ) : null}
                <button className={styles.bBtn} type="button" onClick={() => setBanner(null)}>
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}

          {phase !== "studio" ? (
            <>
              {/* PROGRESS — a mono plate over a rule filled to the fraction.
                  A horizontal stepper rail cannot label four steps at 320px. */}
              <div className={styles.wiz} key="wiz">
                <div className={styles.wizTop}>
                  <span className={styles.wizPlate}>
                    Step {step} / {STEP_COUNT}
                  </span>
                  <span className={styles.wizNow}>{STEP_NAMES[step - 1]}</span>
                </div>
                <div className={styles.wizRule} role="progressbar" aria-valuenow={step}
                  aria-valuemin={1} aria-valuemax={STEP_COUNT}
                  aria-label={`Step ${step} of ${STEP_COUNT}`}>
                  <span className={styles.wizFill}
                    style={{ transform: `scaleX(${step / STEP_COUNT})` }} />
                </div>
              </div>

              {/* ONE STEP, FULL WIDTH */}
              <section className={stepCls} key={`step-${step}-${phase}`}>
                {/* ---------- STEP 2 — location ---------- */}
                {phase === "intake" && step === 2 && (
                  <>
                    <div className={styles.stepHead}>
                      <span className={styles.stepMark}><Icon id="i-pin" /></span>
                      <div>
                        <h2 className={styles.stepH}>Location</h2>
                        <p className={styles.stepHint}>
                          Regional pricing and the sales-tax rate. Pick a town and the state fills
                          itself in. Optional — skip it and the estimate is priced without a
                          regional adjustment.
                        </p>
                      </div>
                    </div>
                    <div className={styles.stepBody}>
                      <div className={styles.fld}>
                        <label className={styles.fldLbl} htmlFor="maLoc">Address or city</label>
                        {/* Real Google Places suggestions, through the same module the
                            desktop blueprint pages use. NOT cityOnly: the label offers
                            "address or city", and a locality-restricted query answers a
                            typed street address with whatever town fuzzy-matches the
                            string. Unrestricted suggestions resolve the address itself
                            and still carry the components that fill the state below. */}
                        <AddressField
                          id="maLoc"
                          placeholder="Bothell"
                          value={locText}
                          onPick={(p) => {
                            setLocText(p.typed ? p.address : p.formatted || p.address);
                            // Only a real pick carries parts. A half-typed street must
                            // not blank a state the user already chose.
                            if (!p.typed && p.state) setLocState(p.state);
                          }}
                        />
                      </div>

                      <div className={styles.fld}>
                        <label className={styles.fldLbl} htmlFor="maState">State</label>
                        <StatePicker
                          id="maState"
                          value={locState}
                          onChange={setLocState}
                          options={STATES}
                        />
                        <span className={styles.fldHint}>
                          {locState
                            ? `Seeds the tax rate at ${stateTaxPct(locState)}% — the ${locState} base rate, editable in Totals.`
                            : "Seeds the sales-tax rate in the estimate's Totals."}
                        </span>
                      </div>
                    </div>
                  </>
                )}

                {/* ---------- STEP 1 — the brief ---------- */}
                {phase === "intake" && step === 1 && (
                  <>
                    <div className={styles.stepHead}>
                      <span className={styles.stepMark}><Icon id="i-file" /></span>
                      <div>
                        <h2 className={styles.stepH}>The brief</h2>
                        <p className={styles.stepHint}>
                          Materials, finishes, conditions, access, square footage. The more specific,
                          the tighter the estimate.
                        </p>
                      </div>
                    </div>
                    <div className={styles.stepBody}>
                      <div className={`${styles.fld} ${errBrief ? styles.invalid : ""}`}>
                        <label className={styles.fldLbl} htmlFor="maBrief">
                          Describe the job<span className={styles.req}>*</span>
                        </label>
                        <textarea
                          className={styles.area}
                          id="maBrief"
                          placeholder="Materials, finishes, conditions, access, square footage if you have it…"
                          value={brief}
                          aria-invalid={errBrief}
                          onChange={(e) => {
                            setBrief(e.target.value);
                            if (e.target.value.trim()) setErrBrief(false);
                          }}
                        />
                        {errBrief ? (
                          <span className={styles.fldErr}>Describe the job before pricing it</span>
                        ) : null}
                        {/* Press and speak — the phone's own recognition types
                            the brief (owner, 2026-09-18). Hidden where the
                            browser cannot listen. */}
                        <DictateButton
                          id="maBriefDictate"
                          value={brief}
                          onChange={(next) => {
                            setBrief(next);
                            if (next.trim()) setErrBrief(false);
                          }}
                          wrapClassName={styles.dictate}
                          buttonClassName={`${styles.btn} ${styles.btnGhost} ${styles.mic}`}
                          onClassName={styles.micOn}
                          noteClassName={styles.dictateNote}
                          iconId="i-advanced-ai-mic"
                          iconClassName={styles.ic}
                        />
                      </div>

                      {/* PHOTOS — the phone is the only device holding the job.
                          Tap to choose or shoot, drop on a tablet, read to data
                          URLs here and sent on the request that prices the work. */}
                      <div className={styles.fld}>
                        <span className={styles.fldLbl}>Site photos</span>
                        <div
                          className={`${styles.dz} ${dragOver ? styles.dzOver : ""}`}
                          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                          onDragLeave={() => setDragOver(false)}
                          onDrop={onDrop}
                        >
                          <Icon id="i-imgplus" className={styles.dzIc} />
                          <div className={styles.dzT}>Show it the job</div>
                          <div className={styles.dzS}>
                            Up to {MAX_PHOTOS} photos. The AI reads them for materials, condition
                            and access — they are never uploaded or stored.
                          </div>
                          <div className={styles.dzActs}>
                            <button
                              className={styles.dzBtn}
                              type="button"
                              onClick={() => camRef.current?.click()}
                            >
                              <Icon id="i-imgplus" />Take a photo
                            </button>
                            <button
                              className={styles.dzBtn}
                              type="button"
                              onClick={() => libRef.current?.click()}
                            >
                              <Icon id="i-folder" />Choose photos
                            </button>
                          </div>
                        </div>
                        <input
                          ref={camRef}
                          className={styles.fileIn}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={onPick}
                        />
                        <input
                          ref={libRef}
                          className={styles.fileIn}
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={onPick}
                        />

                        {photos.length ? (
                          <>
                            <div className={styles.thumbs}>
                              {photos.map((p) => (
                                <div className={styles.thumb} key={p.id}>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img className={styles.thumbImg} src={p.url} alt={p.name} />
                                  <button
                                    className={styles.thumbX}
                                    type="button"
                                    aria-label={`Remove ${p.name}`}
                                    onClick={() =>
                                      setPhotos((prev) => prev.filter((q) => q.id !== p.id))
                                    }
                                  >
                                    <Icon id="i-x" />
                                  </button>
                                </div>
                              ))}
                            </div>
                            <span className={styles.fldHint}>
                              {photos.length} of {MAX_PHOTOS} · {mb(photoBytes)} sent with the brief
                            </span>
                          </>
                        ) : null}
                        {photoErr ? <span className={styles.fldErr}>{photoErr}</span> : null}
                      </div>

                      <div className={styles.fld}>
                        <span className={styles.fldLbl}>Start from an example</span>
                        <div className={styles.samples}>
                          {SAMPLES.map((s) => (
                            <button key={s} className={styles.sample} type="button"
                              onClick={() => {
                                setBrief(s);
                                setErrBrief(false);
                              }}>
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* ---------- STEP 3 — review, then the narration ---------- */}
                {step === 3 && (
                  <>
                    <div className={styles.stepHead}>
                      <span className={styles.stepMark}><Icon id="i-check" /></span>
                      <div>
                        <h2 className={styles.stepH}>
                          {phase === "busy" ? "Pricing the job" : "Review"}
                        </h2>
                        <p className={styles.stepHint}>
                          {phase === "busy"
                            ? "Materials and labor are costed per unit from the trade price book, and the scope is written last."
                            : "This is what gets priced. Tap any line to go back and change it."}
                        </p>
                      </div>
                    </div>
                    <div className={styles.stepBody}>
                      {phase === "busy" ? (
                        <ul className={styles.stages}>
                          {STAGES.map((s, i) => {
                            const done = genDone || i < stageIdx;
                            const now = !genDone && i === stageIdx;
                            return (
                              <li
                                key={s.label}
                                className={`${styles.stage} ${done ? styles.isDone : ""} ${now ? styles.isNow : ""}`}
                              >
                                {/* The square's outline is SVG, not a CSS border:
                                    the ACTIVE state walks a dash around that
                                    outline, which `border` cannot do. Both rects
                                    are always mounted so advancing a step is a
                                    paint, never a remount that restarts the walk
                                    on the square that is already running. */}
                                <span className={styles.stageIc} aria-hidden="true">
                                  <svg className={styles.stageRing} viewBox="0 0 26 26">
                                    <rect
                                      className={styles.stageRingTrack}
                                      x="1" y="1" width="24" height="24"
                                    />
                                    <rect
                                      className={styles.stageRingRun}
                                      x="1" y="1" width="24" height="24"
                                    />
                                  </svg>
                                  <Icon id="i-check" />
                                </span>
                                {s.label}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        /* Rows sit directly in the step card — a bordered recap
                           box inside a bordered step card was a card in a card. */
                        <div className={styles.revList}>
                          {[
                            { n: 1, l: "The brief", v: brief.trim(), miss: "Empty" },
                            { n: 2, l: "Location", v: where, miss: "Not set — priced without a regional adjustment" },
                            {
                              n: 1,
                              l: "Photos",
                              v: photos.length
                                ? `${photos.length} attached · read by the AI, not stored`
                                : "",
                              miss: "None — the AI prices from the words alone",
                            },
                          ].map((r) => (
                            <div className={styles.revRow} key={r.l}>
                              <div className={styles.revLbl}>{r.l}</div>
                              <div className={`${styles.revVal} ${r.v ? "" : styles.isMissing}`}>
                                {r.v || r.miss}
                              </div>
                              <button className={styles.revEdit} type="button"
                                aria-label={`Edit ${r.l}`} onClick={() => goStep(r.n)}>
                                Edit
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </section>
            </>
          ) : (
            <>
              {/* ============ STUDIO ============ */}
              {/* Identity first: the masthead numeral below is meaningless
                  without knowing which job it belongs to. */}
              <section className={styles.sthead} key="sthead">
                <div className={styles.stKicker}>
                  {typeLabel || "Estimate"}{locUsed ? ` · ${locUsed}` : ""}
                  {timelineDays ? ` · ${timelineDays} day${timelineDays === 1 ? "" : "s"}` : ""}
                </div>
                <h2 className={styles.stTitle}>{estTitle}</h2>
              </section>

              {/* MASTHEAD — one numeral, mono kicker, EXACTLY two annotations.
                  All three are computed, so editing a line moves them. */}
              <div className={styles.smast} key="smast">
                <div className={styles.smastTop}>
                  <div className={styles.smastLbl}>
                    Client price
                    <span className={styles.smastRule} />
                  </div>
                  {totals.clientPrice ? (
                    <CountUp value={totals.clientPrice} className={styles.smastVal} />
                  ) : (
                    <div className={`${styles.smastVal} ${styles.isZero}`}>—</div>
                  )}
                </div>
                <div className={styles.smastCnt}>
                  <div className={styles.smastSub}>
                    <div className={styles.smastSubL}>Materials</div>
                    <div className={`${styles.smastSubV} ${totals.materials ? "" : styles.isZero}`}>
                      {totals.materials ? money(totals.materials) : "—"}
                    </div>
                  </div>
                  <div className={styles.smastSub}>
                    <div className={styles.smastSubL}>Labor</div>
                    <div className={`${styles.smastSubV} ${totals.labor ? "" : styles.isZero}`}>
                      {totals.labor ? money(totals.labor) : "—"}
                    </div>
                  </div>
                </div>
              </div>

              {/* SCOPE */}
              <section className={styles.card} key="scope">
                <div className={styles.cardHead}>
                  <span className={styles.cardLbl}>Scope of work</span>
                </div>
                <div className={styles.cardPad}>
                  <textarea
                    className={styles.area}
                    aria-label="Scope of work"
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                  />
                </div>
              </section>

              {renderLines()}

              {/* TOTALS — an estimate sheet: right-aligned tabular numerals and
                  a ruled total row. Every figure is computeTotals'. */}
              <section className={styles.card} key="totals">
                <div className={styles.cardHead}>
                  <span className={styles.cardLbl}>Totals</span>
                </div>
                <div className={styles.cardPad}>
                  <div className={styles.totRow}>
                    <span className={styles.totLbl}>Subtotal</span>
                    <span className={`${styles.totVal} ${totals.subtotal ? "" : styles.isZero}`}>
                      {totals.subtotal ? money(totals.subtotal) : "—"}
                    </span>
                  </div>
                  <div className={styles.marginBox}>
                    <div className={styles.marginRow}>
                      <span className={styles.fldLbl}>Margin</span>
                      <span className={styles.marginCtl}>
                        <button className={styles.marginBtn} type="button" aria-label="Lower the margin"
                          onClick={() => setMargin((m) => Math.max(0, m - 1))}>−</button>
                        <input
                          className={styles.marginIn}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={60}
                          step={1}
                          aria-label="Margin percent"
                          value={margin}
                          onChange={(e) =>
                            setMargin(Math.max(0, Math.min(60, Number(e.target.value) || 0)))
                          }
                        />
                        <button className={styles.marginBtn} type="button" aria-label="Raise the margin"
                          onClick={() => setMargin((m) => Math.min(60, m + 1))}>+</button>
                      </span>
                    </div>
                    <div className={styles.marginRow}>
                      <span className={styles.marginAdd}>
                        {pricing ? "Your prices already carry your markup" : "Added to the client price"}
                      </span>
                      <span className={`${styles.totVal} ${totals.marginCash ? "" : styles.isZero}`}>
                        {totals.marginCash ? money(totals.marginCash) : "—"}
                      </span>
                    </div>
                  </div>
                  <div className={styles.totRow}>
                    <span className={styles.totLbl}>Client price</span>
                    <span className={`${styles.totVal} ${totals.clientPrice ? "" : styles.isZero}`}>
                      {totals.clientPrice ? money(totals.clientPrice) : "—"}
                    </span>
                  </div>

                  {/* DISCOUNT — order-level, exactly as the schema holds it, so
                      it converts 1:1 into the proposal's Discount row instead of
                      being smeared across line prices. The %/$ pair is the unit
                      the counter is counting in. */}
                  <div className={styles.marginBox}>
                    <div className={styles.marginRow}>
                      <span className={styles.fldLbl}>Discount</span>
                      <span className={styles.marginCtl}>
                        <button
                          className={styles.marginBtn}
                          type="button"
                          aria-label="Lower the discount"
                          onClick={() =>
                            setDiscount((d) => ({
                              ...d,
                              value: Math.max(0, Math.round((d.value - (d.mode === "pct" ? 1 : 25)) * 100) / 100),
                            }))
                          }
                        >
                          −
                        </button>
                        <input
                          className={styles.marginIn}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={discount.mode === "pct" ? 100 : MAX_MONEY}
                          step={discount.mode === "pct" ? 1 : 25}
                          aria-label={discount.mode === "pct" ? "Discount percent" : "Discount amount in dollars"}
                          value={discount.value}
                          onChange={(e) =>
                            setDiscount((d) => ({
                              ...d,
                              value: Math.max(
                                0,
                                Math.min(d.mode === "pct" ? 100 : MAX_MONEY, Number(e.target.value) || 0),
                              ),
                            }))
                          }
                        />
                        <button
                          className={styles.marginBtn}
                          type="button"
                          aria-label="Raise the discount"
                          onClick={() =>
                            setDiscount((d) => ({
                              ...d,
                              value: Math.min(
                                d.mode === "pct" ? 100 : MAX_MONEY,
                                Math.round((d.value + (d.mode === "pct" ? 1 : 25)) * 100) / 100,
                              ),
                            }))
                          }
                        >
                          +
                        </button>
                      </span>
                    </div>
                    <div className={styles.marginRow}>
                      <span className={styles.discToggle} role="group" aria-label="Discount unit">
                        <button
                          className={`${styles.discBtn} ${discount.mode === "pct" ? styles.on : ""}`}
                          type="button"
                          aria-pressed={discount.mode === "pct"}
                          onClick={() => setDiscount((d) => ({ ...d, mode: "pct" }))}
                        >
                          %
                        </button>
                        <button
                          className={`${styles.discBtn} ${discount.mode === "amt" ? styles.on : ""}`}
                          type="button"
                          aria-pressed={discount.mode === "amt"}
                          onClick={() => setDiscount((d) => ({ ...d, mode: "amt" }))}
                        >
                          $
                        </button>
                      </span>
                      <span className={`${styles.totVal} ${totals.discountCash ? styles.isCredit : styles.isZero}`}>
                        {totals.discountCash ? `−${money(totals.discountCash)}` : "—"}
                      </span>
                    </div>
                  </div>

                  {/* TAX — rests at 0 and fills from the state picked in
                      intake; the % is drawn INSIDE the field so the number
                      always reads as a rate and never as an amount. Editable,
                      because the auto-fill is a base state rate and excludes
                      county/city — see ./state-tax.ts. Charged on the
                      DISCOUNTED price, which is what the customer pays for. */}
                  <div className={styles.marginBox}>
                    <div className={styles.marginRow}>
                      <span className={styles.fldLbl}>Tax</span>
                      <span className={styles.marginCtl}>
                        <button
                          className={styles.marginBtn}
                          type="button"
                          aria-label="Lower the tax rate"
                          onClick={() =>
                            setTaxOverride(Math.max(0, Math.round((taxPct - 0.5) * 1000) / 1000))
                          }
                        >
                          −
                        </button>
                        <span className={styles.taxField}>
                          <input
                            className={`${styles.marginIn} ${styles.taxIn}`}
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={20}
                            step={0.25}
                            aria-label="Tax rate percent"
                            value={taxPct}
                            onChange={(e) =>
                              setTaxOverride(Math.max(0, Math.min(20, Number(e.target.value) || 0)))
                            }
                          />
                          <span className={styles.taxPct} aria-hidden="true">%</span>
                        </span>
                        <button
                          className={styles.marginBtn}
                          type="button"
                          aria-label="Raise the tax rate"
                          onClick={() =>
                            setTaxOverride(Math.min(20, Math.round((taxPct + 0.5) * 1000) / 1000))
                          }
                        >
                          +
                        </button>
                      </span>
                    </div>
                    <div className={styles.marginRow}>
                      <span className={styles.marginAdd}>
                        {pricing?.taxMode === "materials"
                          ? "On materials only · your company's rule"
                          : pricing?.taxMode === "none"
                            ? "No sales tax · your company's rule"
                            : locState && !taxTouched
                              ? `${locState} base rate · excludes county and city`
                              : "Charged on the discounted price"}
                      </span>
                      <span className={`${styles.totVal} ${totals.taxCash ? "" : styles.isZero}`}>
                        {totals.taxCash ? money(totals.taxCash) : "—"}
                      </span>
                    </div>
                  </div>

                  <div className={`${styles.totRow} ${styles.totGrand}`}>
                    <span className={styles.totLbl}>Total due</span>
                    <span className={`${styles.totGrandVal} ${totals.total ? "" : styles.isZero}`}>
                      {totals.total ? money(totals.total) : "—"}
                    </span>
                  </div>
                </div>
              </section>

            </>
          )}
        </div>
      </main>

      {/* ============ STICKY COMMIT FOOT ============
          Outside the scroller, pinned to the bottom, paying out --safe-b. This
          is the wizard's commit bar, not a tab bar: no page in this family has
          one of those. */}
      <div className={styles.wfoot}>
        {phase === "studio" ? (
          <>
            {isTradeId(typeLabel) && (
              <div style={{ flexBasis: "100%", width: "100%" }}>
                <InventoryLinkChoice trade={typeLabel} value={invLink} onChange={setInvLink} />
              </div>
            )}
            <button
              className={`${styles.btn} ${styles.btnDanger} ${confirmReset ? styles.isArmed : ""}`}
              type="button"
              disabled={saveBusy}
              onClick={startOver}
            >
              <Icon id="i-x" />{confirmReset ? "Really?" : "Start over"}
            </button>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              type="button"
              disabled={saveBusy || lines.length === 0}
              onClick={() => void saveAsProposal()}
            >
              <Icon id={saveBusy ? "i-rotate" : "i-file"} />
              {saveBusy ? "Creating…" : "Save as proposal"}
            </button>
          </>
        ) : (
          <>
            <button className={`${styles.btn} ${styles.btnGhost}`} type="button"
              disabled={step === 1 || phase === "busy"} onClick={() => goStep(step - 1)}>
              <Icon id="i-chevl" />Back
            </button>
            <button className={`${styles.btn} ${styles.btnPrimary}`} type="button"
              disabled={phase === "busy"} onClick={next}>
              {step === STEP_COUNT ? (
                <>
                  <Icon id="i-bulb" />{phase === "busy" ? "Working…" : "Generate estimate"}
                </>
              ) : (
                <>
                  Next<Icon id="i-chevr" />
                </>
              )}
            </button>
          </>
        )}
      </div>

      {/* ============ SHEET SCRIM (shared by both sheets) ============ */}
      <div
        className={`${styles.scrim} ${anyOverlay ? styles.on : ""}`}
        onClick={() => { setSheetRef2(null); setEditRef(null); settleClarify(null); }}
        aria-hidden="true"
      />

      {/* ============ LINE ACTIONS SHEET ============ */}
      {/* `inert`, not aria-hidden: a closed sheet still holds real focusable
          controls, and aria-hidden over a focused input is a console warning
          and a genuine screen-reader trap. inert hides it from AT, takes it out
          of the tab order, AND blows away any focus left inside it. */}
      <div className={`${styles.sheet} ${sheetLine ? styles.on : ""}`} role="dialog" aria-modal="true"
        aria-label="Line actions" inert={!sheetLine} {...actionsDrag.sheetProps}>
        <div className={styles.sheetGrab} {...actionsDrag.handleProps} />
        <div className={styles.sheetHead} {...actionsDrag.handleProps}>
          <div className={styles.sheetKicker}>
            {sheetLine
              ? `Line · ${sheetLine.qty} ${sheetLine.unit} · ${money(lineTotal(sheetLine))}`
              : "Line · —"}
          </div>
          <div className={styles.sheetTitle}>{sheetLine?.name ?? "Actions"}</div>
        </div>
        <div className={styles.sheetBody}>
          {menuRows.map((r) => (
            <button key={r.act} type="button" disabled={r.disabled}
              className={`${styles.menuItem} ${r.danger ? styles.menuItemDanger : ""}`}
              onClick={() => runMenu(r.act)}>
              <span className={`${styles.miIc} ${r.tone ?? ""}`}><Icon id={r.icon} /></span>
              <span>
                <span className={styles.menuItemT}>{r.title}</span>
                <span className={styles.menuItemS}>{r.sub}</span>
              </span>
            </button>
          ))}
        </div>
        <button className={styles.sheetCancel} type="button" onClick={() => setSheetRef2(null)}>
          Cancel
        </button>
      </div>

      {/* ============ LINE EDIT SHEET ============
          The desktop edits in place through 32px table cells. At 320px those
          cells are unusable, so the same fields move into a form sheet with the
          house 15px inputs and the submit pair in a beige foot. Quantity is
          unit-bearing: "8" alone could be eight hours or eight square feet. */}
      <div className={`${styles.sheet} ${editLine ? styles.on : ""}`} role="dialog" aria-modal="true"
        aria-labelledby="maEditTitle" inert={!editLine} {...editDrag.sheetProps}>
        <div className={styles.sheetGrab} {...editDrag.handleProps} />
        <div className={styles.sheetHead} {...editDrag.handleProps}>
          <div className={styles.sheetKicker}>
            {editLine ? `Line item · ${editLine.qty} ${editLine.unit}` : "Line item"}
          </div>
          <div className={styles.sheetTitle} id="maEditTitle">Edit line</div>
        </div>
        <form className={`${styles.sheetBody} ${styles.formBody}`} id="maEditForm" noValidate
          onSubmit={submitEdit}>
          <div className={`${styles.fld} ${nameErr ? styles.invalid : ""}`}>
            <label className={styles.fldLbl} htmlFor="maName">
              Description<span className={styles.req}>*</span>
            </label>
            <input ref={nameRef} className={styles.pinput} id="maName" type="text"
              placeholder="Architectural shingles — 30 yr" autoComplete="off" value={form.name}
              aria-invalid={nameErr} aria-describedby={nameErr ? "maNameErr" : undefined}
              onChange={(e) => {
                setForm((f) => ({ ...f, name: e.target.value }));
                if (e.target.value.trim()) setNameErr(false);
              }} />
            {nameErr ? <span className={styles.fldErr} id="maNameErr">Give the line a description</span> : null}
          </div>

          <div className={styles.fld}>
            <label className={styles.fldLbl} htmlFor="maQty">Quantity</label>
            {/* No native spinner anywhere on this page: a text field with a
                decimal keypad, clamped on save. */}
            <input className={`${styles.pinput} ${styles.isNum}`} id="maQty" type="text"
              inputMode="decimal" pattern="[0-9]*[.]?[0-9]*" autoComplete="off"
              value={form.qty}
              onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))} />
            <div className={styles.unitChips} role="group" aria-label="Unit">
              {editUnits.map((u) => (
                <button
                  key={u.value}
                  type="button"
                  className={`${styles.unitChip} ${form.unit === u.value ? styles.on : ""}`}
                  aria-pressed={form.unit === u.value}
                  onClick={() => setForm((f) => ({ ...f, unit: u.value }))}
                >
                  per {u.label}
                </button>
              ))}
            </div>
          </div>

          {/* ONE line, TWO prices: material and labor are columns of every
              row, not row types, so both are edited here side by side. */}
          <div className={styles.fld}>
            <div className={styles.fldPair}>
              <div className={styles.fld}>
                <label className={styles.fldLbl} htmlFor="maMaterial">Material $ / unit</label>
                <div className={styles.moneyWrap}>
                  <span className={styles.moneySign} aria-hidden="true">$</span>
                  <input className={`${styles.pinput} ${styles.isNum} ${styles.moneyIn}`} id="maMaterial"
                    type="text" inputMode="decimal" pattern="[0-9]*[.]?[0-9]*" autoComplete="off"
                    value={form.material}
                    onChange={(e) => setForm((f) => ({ ...f, material: e.target.value }))} />
                </div>
              </div>
              <div className={styles.fld}>
                <label className={styles.fldLbl} htmlFor="maLabor">Labor $ / unit</label>
                <div className={styles.moneyWrap}>
                  <span className={styles.moneySign} aria-hidden="true">$</span>
                  <input className={`${styles.pinput} ${styles.isNum} ${styles.moneyIn}`} id="maLabor"
                    type="text" inputMode="decimal" pattern="[0-9]*[.]?[0-9]*" autoComplete="off"
                    value={form.labor}
                    onChange={(e) => setForm((f) => ({ ...f, labor: e.target.value }))} />
                </div>
              </div>
            </div>
            <span className={styles.fldHint}>
              Line total {money(
                clampNum(form.qty, MAX_QTY) *
                  (clampNum(form.material, MAX_MONEY) + clampNum(form.labor, MAX_MONEY)),
              )}
            </span>
          </div>
        </form>
        <div className={styles.formFoot}>
          <button className={`${styles.btn} ${styles.btnGhost}`} type="button"
            onClick={() => setEditRef(null)}>
            Cancel
          </button>
          <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit" form="maEditForm">
            <Icon id="i-check" />Save line
          </button>
        </div>
      </div>

      {/* ============ INTAKE QUESTIONS SHEET ============
          Shown BEFORE anything is priced, when the intake gate judged the brief
          too thin. `analyzeEstimatePrompt` already ran and already decided, so
          asking here spends that decision rather than discarding it into a
          post-hoc "the AI had to assume" banner — and costs no extra model
          call. Every question takes a custom answer, so the options can never
          trap a job that does not fit them, and "Generate anyway" is always one
          tap away: the gate advises, it never blocks. */}
      <div className={`${styles.sheet} ${clarify ? styles.on : ""}`} role="dialog" aria-modal="true"
        aria-labelledby="maClarifyTitle" inert={!clarify} {...clarifyDrag.sheetProps}>
        <div className={styles.sheetGrab} {...clarifyDrag.handleProps} />
        <div className={styles.sheetHead} {...clarifyDrag.handleProps}>
          <div className={styles.sheetKicker}>Smart Proposal · Intake</div>
          <div className={styles.sheetTitle} id="maClarifyTitle">A few quick questions</div>
          <p className={styles.clqSub}>
            The brief is thin for this kind of job. Answer what you can and it gets priced
            against real numbers instead of assumptions.
          </p>
        </div>
        <div className={`${styles.sheetBody} ${styles.clqBody}`}>
          {(clarify ?? []).map((q, i) => {
            const value = clarifyAns[q.id] ?? "";
            const isCustom = Boolean(clarifyCustom[q.id]);
            // An option-less "select" is unanswerable; the server already
            // downgrades those, and this is the second belt.
            const kind =
              q.kind === "select" && q.options && q.options.length > 0
                ? "select"
                : q.kind === "number"
                  ? "number"
                  : "text";
            return (
              <div className={styles.clqQ} key={q.id}>
                <span className={styles.clqN} aria-hidden="true">{i + 1}</span>
                <div className={styles.clqBd}>
                  <label className={styles.clqLbl} htmlFor={`maClq-${q.id}`}>{q.question}</label>

                  {kind === "select" && q.options ? (
                    <div className={styles.clqOpts}>
                      {q.options.map((opt) => (
                        <button key={opt} type="button"
                          className={`${styles.clqOpt} ${!isCustom && value === opt ? styles.on : ""}`}
                          aria-pressed={!isCustom && value === opt}
                          onClick={() => {
                            setClarifyCustom((c) => ({ ...c, [q.id]: false }));
                            setClarifyAns((a) => ({ ...a, [q.id]: opt }));
                          }}>
                          {opt}
                        </button>
                      ))}
                      <button type="button"
                        className={`${styles.clqOpt} ${styles.clqOptOther} ${isCustom ? styles.on : ""}`}
                        aria-pressed={isCustom}
                        onClick={() => {
                          setClarifyCustom((c) => ({ ...c, [q.id]: true }));
                          setClarifyAns((a) => ({ ...a, [q.id]: "" }));
                        }}>
                        Something else
                      </button>
                    </div>
                  ) : null}

                  {kind === "number" && !isCustom ? (
                    <div className={styles.clqNumRow}>
                      <input id={`maClq-${q.id}`} type="number" inputMode="decimal"
                        className={`${styles.pinput} ${styles.isNum} ${styles.clqNum}`}
                        value={value} placeholder={q.placeholder ?? "0"}
                        onChange={(e) => setClarifyAns((a) => ({ ...a, [q.id]: e.target.value }))} />
                      {q.unit ? <span className={styles.clqUnit}>{q.unit}</span> : null}
                    </div>
                  ) : null}

                  {kind === "text" || isCustom ? (
                    <textarea id={`maClq-${q.id}`} className={styles.clqTa} rows={2}
                      value={value} placeholder={q.placeholder ?? "Type your answer…"}
                      onChange={(e) => setClarifyAns((a) => ({ ...a, [q.id]: e.target.value }))} />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        <div className={styles.clqFoot}>
          <span className={styles.clqCount} role="status" aria-live="polite">
            {clarifyPairs().length} of {(clarify ?? []).length} answered
          </span>
          <div className={styles.clqActs}>
            <button className={`${styles.btn} ${styles.btnGhost}`} type="button"
              onClick={() => settleClarify([])}>
              Generate anyway
            </button>
            <button className={`${styles.btn} ${styles.btnPrimary}`} type="button"
              disabled={clarifyPairs().length === 0}
              onClick={() => settleClarify(clarifyPairs())}>
              <Icon id="i-check" />Use answers
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
