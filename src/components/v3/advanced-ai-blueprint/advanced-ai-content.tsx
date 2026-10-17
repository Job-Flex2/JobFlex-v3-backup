"use client";
import { clientErrorText } from "@/lib/staleDeploy";

// SMART PROPOSAL · ESTIMATE / BLUEPRINT — the page.
// Route: /dashboard/advanced-ai.
//
// ── THIS IS NOW A LIVE CONSOLE ─────────────────────────────────────
// It was a static port: `generate()` was a 1500ms setTimeout that swapped a
// panel, the estimate was the donor's cedar-fence fixture, the refine "diff" was
// two constant rows, "Send to proposal" had no handler, and the Materials
// request's buy control was a handler-less <button>. Every one of those is gone.
//
// The page now calls the real actions in `@/actions/advancedEstimator`:
//   Generate  → analyzeEstimatePrompt() then generateAdvancedEstimate()
//   (the written change request and its Apply were removed 2026-09-18:
//    the sheet's cells and the proposal's sliders cover price changes)
//   Save      → saveEstimate() then convertEstimateToProposal() then router.push
//
// The donor's LOOK is untouched — same cards, same grid, same type, same
// motion. What changed is that the numbers on it are real, and every control
// that appeared to do something now does it.
//
// ── ONE LINE SHAPE, NO SECOND COPIES ───────────────────────────────
// Line items are held as `ConsoleLine[]` from `@/lib/estimate/console-model` —
// the shape shared with the handheld studio. Totals come from `computeTotals`
// (cost → margin → discount → tax), derived rather than mirrored, so deleting
// a line takes its money with it — there is no second array to forget.
// There is no Materials request card any more (owner, 2026-10-09): a list of
// store products, some of them wrong, has no place on an estimate.
//
// ── CONTROLLED INPUTS, AND WHY THE `rev` TRICK WENT ────────────────
// The port kept the donor's uncontrolled `defaultValue` inputs plus a `rev`
// counter that remounted every row, because the donor re-rendered its table
// with innerHTML and the DOM fields had to pick up new values. Both are gone.
// A refine, an Undo and a delete now rewrite the same `lines` state the inputs
// render from, so there is nothing to force. The one thing uncontrolled inputs
// bought — clearing a cell leaves the box empty instead of slamming a "0" into
// it — is kept by `field`, a single-cell edit buffer: while a numeric cell is
// being typed in, the field shows the raw text and the model holds the parsed
// number. It costs eight lines and it makes remount-on-every-keystroke
// unnecessary.

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import s from "./advanced-ai.module.css";
import { useSmartProposalMotion } from "./advanced-ai-motion";
import { BlueprintSelect } from "./blueprint-select";
import { toast } from "@/components/ui/Toast";
import {
  reportPlanLimit,
  reportPlanLimitResult,
  ensureWithinLimit,
} from "@/stores/usePlanLimitStore";
import { attachPlacesSuggest } from "@/components/v3/blueprint-shell/places-suggest";
import { MDL_EXIT_MS } from "@/components/v3/blueprint-shell/mdl-motion";
import { stateTaxPct } from "@/app/(mobile)/mobile-advanced-ai-v2/state-tax";
import { stateFromAddress } from "@/lib/pricing/salesTax";
import { DictateButton } from "@/components/estimator/DictateButton";
import {
  analyzeEstimatePrompt,
  generateAdvancedEstimate,
  saveEstimate,
  convertEstimateToProposal,
} from "@/actions/advancedEstimator";
import type { ClarifyQuestion, PricingSnapshotWire } from "@/lib/estimatorSchema";
import {
  briefWithAnswers,
  computeTotals,
  discountToSchema,
  estimateFromLines,
  lineTotal,
  linesFromEstimate,
  newLineId,
  blankLine,
  unitSelectOptions,
  NO_DISCOUNT,
  type ClarifyAnswer,
  type ConsoleLine,
  type DiscountState,
} from "@/lib/estimate/console-model";
import { HoverTitle } from "./hover-title";
import { lockScroll } from "@/lib/scrollLock";
import {
  GEN_DONE,
  GEN_STAGES,
  INTAKE,
  LIVE,
  MAX_MONEY,
  MAX_QTY,
  PHOTO_MAX_COUNT,
  PHOTO_MAX_TOTAL_BYTES,
  SAMPLES,
  STATES,
  money,
  moneySigned,
} from "./advanced-ai-data";
import { InventoryLinkChoice } from "@/components/v3/inventory-link/inventory-link-choice";
import { isTradeId } from "@/lib/inventory";
import { takePlanEstimate, type PlanEstimateDone } from "@/lib/plans/handoff";

/** Hashed module class, or the literal name when the module has none — which is
 *  how the fleet's global `rv` / `rv-in` / `pressed` pass through. */
function cx(...names: Array<string | false | null | undefined>): string {
  return names
    .filter(Boolean)
    .map((n) => (s as Record<string, string>)[n as string] ?? (n as string))
    .join(" ");
}

/**
 * Where a hand-rolled dialog is portalled.
 *
 * NOT `.content`: the shell transforms the content column, and a transformed
 * ancestor becomes the containing block for `position: fixed` — an "inset: 0"
 * overlay hosted there covers only the column, sliding under the topbar and
 * leaving the chrome undimmed.
 *
 * NOT `<body>` either, which is what it was and what broke the plates: every
 * design token (`--ink`, `--blueprint`, `--border`, `--radius`, `--paper-deep`,
 * `--font-mono`, `--ease`) is declared on the shell's `.bp` root, so a dialog
 * outside it resolves each `var()` to nothing. The frame and the 5px hard
 * shadow silently vanished, the intake footer lost its plate, and the active
 * step's travelling line kept animating a stroke that was never painted — the
 * dashed square still drew, which is what made it read as "the animation
 * stopped" rather than "the colour is gone".
 *
 * The shell root carries `jf-blueprint`, is untransformed, and is the token
 * host, so it is the one place that satisfies both constraints.
 */
function dialogHost(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(".jf-blueprint") ?? document.body;
}

/** The overlay's exit is skipped, not merely un-animated, when motion is off. */
function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Which of the page's panels is on screen: the brief or the estimate. */
type Panel = "intake" | "estimate";
type Photo = { id: string; name: string; size: number; dataUrl: string };

const STATE_OPTIONS = STATES.map(([value, label]) => ({ value, label }));

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** Clamp anything a paste can produce into a number the money cells can paint. */
function clampNum(raw: string, max: number): number {
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(n, 0), max);
}

export function AdvancedAiContent({ seed }: { seed?: { brief: string; address: string; state: string } } = {}) {
  const router = useRouter();

  // ── Panel 1: the intake console ──────────────────────────────────
  const [panel, setPanel] = useState<Panel>("intake");
  // A lead's hand-off (lib/estimateSeed) fills the brief and the location.
  const [addr, setAddr] = useState(seed?.address ?? "");
  const [usState, setUsState] = useState(seed?.state ?? "");
  const [brief, setBrief] = useState(seed?.brief ?? "");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoErr, setPhotoErr] = useState("");
  const [dragOver, setDragOver] = useState(false);

  // ── The run ──────────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);
  const [genDone, setGenDone] = useState(false);
  const [genError, setGenError] = useState("");

  // ── Panel 2: the estimate ────────────────────────────────────────
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState("");
  const [assumptions, setAssumptions] = useState<string[]>([]);
  /** What the post-generation validation changed, in the contractor's words
   *  (lib/estimate/validate-estimate). Contractor-facing only. */
  const [checkNotes, setCheckNotes] = useState<string[]>([]);
  const [timelineDays, setTimelineDays] = useState<number | null>(null);
  const [discount, setDiscount] = useState<DiscountState>(NO_DISCOUNT);
  // Rate and pin live in ONE state object so the Places pick handler — which is
  // a DOM listener bound once per panel — can read the current pin through a
  // functional update instead of closing over a stale boolean. A typed rate
  // pins itself: picking a state afterwards must not silently overwrite a
  // number the contractor deliberately entered.
  const [tax, setTax] = useState<{ pct: number; pinned: boolean }>({ pct: 0, pinned: false });
  /** Priced the company's way (Settings → Estimating): its tax rule, and how the proposal is to be priced. */
  const [pricing, setPricing] = useState<PricingSnapshotWire | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  // The overlay is held mounted through its exit keyframes; `genExit` is what
  // plays them. Without it the box is cut out of the frame instantly while the
  // arrival got a full 240ms, and the hard cut is the half you notice.
  const [genExit, setGenExit] = useState(false);
  // The intake gate's questions, and the promise `generate()` is parked on
  // while they are on screen. Keeping the resolver in a ref (not state) means
  // answering does not race a re-render: the awaiting call is resumed exactly
  // once, by whichever button was pressed.
  const [clarify, setClarify] = useState<ClarifyQuestion[] | null>(null);
  const clarifyResolve = useRef<((v: ClarifyAnswer[] | null) => void) | null>(null);
  const [briefUsed, setBriefUsed] = useState("");
  const [typeUsed, setTypeUsed] = useState("");
  /** The pricing MARKET ("City, ST") the estimate was costed against. */
  const [locationUsed, setLocationUsed] = useState("");
  /** The full job ADDRESS as typed. Saved onto the proposal; never a market. */
  const [addrUsed, setAddrUsed] = useState("");
  // Three-valued, not a boolean. `router.push` resolves immediately and the
  // navigation continues afterwards, so clearing the flag in a `finally` put the
  // button back to "Save as proposal" while the app was still loading the
  // builder — on a cold route that reads as "the click did nothing", which is
  // exactly how it was reported. "opening" holds until the new page takes over
  // and unmounts this one.
  const [saveBusy, setSaveBusy] = useState<null | "saving" | "opening">(null);
  // Connected to the warehouse or an estimate only — null until the choice decides its default (2026-09-20).
  const [invLink, setInvLink] = useState<boolean | null>(null);
  // Plan sets have their own tool, kept apart from this page (owner, 2026-10-13:
  // /dashboard/blueprint-estimator). Its "Edit in Smart Proposal" hands an estimate here
  // to be edited (lib/plans/handoff) — the only thing that crosses.

  /** The one cell currently being typed into — see the header note. */
  const [field, setField] = useState<{ key: string; text: string } | null>(null);

  const briefId = useId();
  const addrId = useId();
  const stateId = useId();
  const photoInput = useRef<HTMLInputElement>(null);
  const addrRef = useRef<HTMLInputElement>(null);

  useSmartProposalMotion(s.btn, panel);

  // ── Address autocomplete ─────────────────────────────────────────
  // The field promised "Search address or city…" and was a bare input. This is
  // the same module the Fence studio uses; with no browser key it degrades to a
  // plain input that simply reports what was typed, which is why the `typed`
  // branch still has to write `addr`.
  useEffect(() => {
    if (panel !== "intake") return;
    const input = addrRef.current;
    if (!input) return;
    // NOT cityOnly. The field asks for "address or city", and restricting the
    // query to `locality` meant a typed street address could only ever come back
    // as some unrelated town that fuzzy-matched the string — type "6232 97th Dr
    // NE" and Google answers with Naivasha. Unrestricted suggestions resolve the
    // address itself, and the addressComponents parse below still lifts the city
    // and state out of it, so regional pricing is unaffected.
    return attachPlacesSuggest(input, {
      onPick(p) {
        setAddr(p.typed ? p.address : p.formatted || p.address);
        if (p.typed || !p.state) return;
        setUsState(p.state);
        setTax((t) => (t.pinned ? t : { pct: stateTaxPct(p.state), pinned: false }));
      },
    });
  }, [panel]);

  // Picking a state seeds the tax rate until the contractor types their own.
  function pickState(code: string) {
    setUsState(code);
    setTax((t) => (t.pinned ? t : { pct: stateTaxPct(code), pinned: false }));
  }

  // ── The generation overlay's clock ───────────────────────────────
  // Stage 0 → 1 is a REAL boundary (analyzeEstimatePrompt resolved). 1 → 2 → 3
  // are dwells inside one server call that reports nothing, and stage 3 is the
  // terminus: it holds until the promise settles rather than pretending to
  // finish. The effect is gated on `generating`, so the overlay's clock cannot
  // outlive the request that started it.
  useEffect(() => {
    if (!generating || genDone) return;
    const last = GEN_STAGES.length - 1;
    if (stageIdx < 1 || stageIdx >= last) return;
    const dwell = GEN_STAGES[stageIdx].dwellMs;
    if (!dwell) return;
    const t = setTimeout(() => setStageIdx((i) => Math.min(i + 1, last)), dwell);
    return () => clearTimeout(t);
  }, [generating, genDone, stageIdx]);

  // The builder this page hands off to lives at a top-level /dashboard route of
  // its own, so it is never warmed by the shell's nav. Prefetch it the moment an
  // estimate exists — by the time Save is pressed the route is compiled and the
  // hand-off is a render, not a build.
  useEffect(() => {
    if (lines.length === 0) return;
    router.prefetch("/dashboard/manual-blueprint" as never);
  }, [lines.length, router]);

  // ── Derived money ────────────────────────────────────────────────
  const totals = useMemo(
    () => computeTotals({ lines, discount, taxPct: tax.pct, taxOn: pricing?.taxMode === "materials" ? "materials" : "all" }),
    [lines, discount, tax.pct, pricing],
  );

  // The intake no longer asks for a project type (owner, 2026-09-02): the
  // planner names the kind of work from the brief itself. Kept as an empty
  // string so every action's contract is untouched.
  const projectType = "";

  // "City, ST" is what the actions localize prices against. The state is only
  // appended when the typed text does not already carry it.
  const location = useMemo(() => {
    const a = addr.trim();
    if (!a) return usState;
    if (!usState) return a;
    return new RegExp(`(^|[,\\s])${usState}$`, "i").test(a) ? a : `${a}, ${usState}`;
  }, [addr, usState]);

  const cleanAssumptions = assumptions.map((a) => a.trim()).filter(Boolean);

  const canGenerate = brief.trim().length > 0 && !generating;

  // ── Failure funnel ───────────────────────────────────────────────
  // Every action returns the same three shapes: a plan-limit refusal (handed to
  // the app's own upgrade dialog), a plain { ok:false, error } and a thrown
  // error. None of them may leave a blank panel behind, so they all land here.
  const fail = useCallback((res: { error: string; code?: string }, where: string) => {
    if (reportPlanLimitResult(res)) return "You have used this month's estimator runs.";
    toast.error(where, res.error);
    return res.error;
  }, []);

  // ══════════════ GENERATE ══════════════

  /** Take the overlay down THROUGH its exit animation, not by cutting it out. */
  const closeOverlay = useCallback(async () => {
    if (reducedMotion()) {
      setGenerating(false);
      return;
    }
    setGenExit(true);
    await new Promise((r) => setTimeout(r, MDL_EXIT_MS));
    setGenExit(false);
    setGenerating(false);
  }, []);

  /**
   * Park generation on the questions dialog.
   *
   * Resolves with the answered pairs (possibly empty — "Generate anyway"), or
   * null when the contractor backed out entirely.
   */
  function askClarify(questions: ClarifyQuestion[]): Promise<ClarifyAnswer[] | null> {
    return new Promise((resolve) => {
      clarifyResolve.current = resolve;
      setClarify(questions);
    });
  }
  const settleClarify = useCallback((value: ClarifyAnswer[] | null) => {
    const resolve = clarifyResolve.current;
    clarifyResolve.current = null;
    setClarify(null);
    resolve?.(value);
  }, []);

  async function generate() {
    if (!canGenerate) return;
    // Each photo in its own object — see SitePhoto in actions/advancedEstimator.
    const photoUrls = photos.map((p) => ({ url: p.dataUrl }));
    const typedBrief = brief.trim();
    setGenError("");
    setStageIdx(0);
    setGenDone(false);
    setGenExit(false);
    setGenerating(true);
    try {
      const gate = await analyzeEstimatePrompt({
        projectType,
        description: typedBrief,
        location: location || undefined,
        photos: photoUrls,
      });
      if (!gate.ok) {
        await closeOverlay();
        setGenError(fail(gate, "Couldn't start"));
        return;
      }
      // The gate normalizes "bothel wa" to "Bothell, WA" before anything is
      // priced against it. That string is a MARKET, not an address — its
      // contract is literally "City, ST" — so it drives SerpAPI localization
      // and nothing else. It used to be written back over the address field,
      // which silently destroyed the street line the contractor typed: enter
      // "13520 Bothell-Everett Hwy, Bothell, WA" and the proposal saved a job
      // address of "Bothell, WA". The two are now kept apart.
      const fixed = gate.data.correctedLocation?.trim() || "";
      const useLocation = fixed || location;
      // The full address as typed, at the moment of generation — this is what
      // the proposal's job address is built from.
      const useAddress = location;

      // ── The thin-brief gate ────────────────────────────────────────
      // The gate has already decided; asking here costs no extra model call.
      // The overlay steps aside for the dialog rather than stacking behind it,
      // because the checklist would be narrating work that is not happening.
      let description = typedBrief;
      const thin = !gate.data.enoughDetail && gate.data.questions.length > 0;
      if (thin) {
        await closeOverlay();
        const answers = await askClarify(gate.data.questions);
        // Backed out — nothing is priced, and the brief is untouched.
        if (answers === null) return;
        description = briefWithAnswers(typedBrief, answers);
        setGenError("");
        setGenDone(false);
        setGenExit(false);
        setGenerating(true);
      }
      // The brief has been read — the one boundary the client can observe.
      setStageIdx(1);

      const res = await generateAdvancedEstimate({
        projectType,
        description,
        location: useLocation || undefined,
        photos: photoUrls,
      });
      if (!res.ok) {
        await closeOverlay();
        setGenError(fail(res, "Generation failed"));
        return;
      }

      const est = res.data;
      setLines(linesFromEstimate(est));
      // The company's own method: its tax rule and rate go on the sheet, and on to the proposal.
      const pr = est.pricing ?? null;
      setPricing(pr);
      if (pr) {
        setTax((t) => {
          if (pr.taxMode === "none") return { pct: 0, pinned: true };
          if (pr.taxRatePct != null) return { pct: pr.taxRatePct, pinned: true };
          // The job state's rate: the state picked, else the one in the address the estimate was priced at.
          if (t.pinned || t.pct > 0) return t;
          const st = stateFromAddress(useLocation);
          return st ? { pct: stateTaxPct(st), pinned: false } : t;
        });
      }
      setCheckNotes(est.notes ?? []);
      setTitle(est.title);
      setScope(est.scope || description);
      setAssumptions(est.assumptions);
      setTimelineDays(est.estimatedTimelineDays ?? null);
      setDiscount(NO_DISCOUNT);
      setDemoMode(Boolean(res.disabled));
      setBriefUsed(description);
      setTypeUsed(projectType);
      setLocationUsed(useLocation);
      setAddrUsed(useAddress);
      setStageIdx(GEN_STAGES.length);
      setGenDone(true);
      // Land on "generated" for a beat so the checklist reads as finished
      // rather than vanishing mid-tick.
      await new Promise((r) => setTimeout(r, 620));
      await closeOverlay();
      setPanel("estimate");
      if (res.disabled) {
        toast.info("Demo estimate", "No estimator key configured — this is placeholder pricing.");
      }
    } catch (err) {
      await closeOverlay();
      const msg = clientErrorText(err, "Something went wrong.");
      setGenError(msg);
      toast.error("Generation failed", msg);
    }
  }


  /** The plan set's trades, merged, land in the same ledger a brief's estimate does. */
  function landPlanEstimate(r: PlanEstimateDone) {
    setPricing(null);
    setLines(r.lines);
    setCheckNotes(r.notes);
    setTitle(r.title);
    setScope(r.scope);
    setAssumptions(r.assumptions);
    setTimelineDays(r.timelineDays);
    setDiscount(NO_DISCOUNT);
    setDemoMode(false);
    setBriefUsed(r.scope);
    setTypeUsed("");
    setLocationUsed(r.location);
    // The job address: the one typed on the intake, else the plans' title block.
    setAddrUsed(addr.trim() ? location : r.address || r.location);
    setPanel("estimate");
  }

  // An estimate handed back from the blueprint estimator ("Edit in Smart Proposal")
  // lands in the ledger on the first tick — the effect itself sets nothing.
  useEffect(() => {
    const t = setTimeout(() => {
      const handed = takePlanEstimate();
      if (handed) landPlanEstimate(handed);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Back to the console, with the estimate discarded. */
  function startOver() {
    setPanel("intake");
    setLines([]);
    setPricing(null);
    setAssumptions([]);
    setCheckNotes([]);
    setTitle("");
    setScope("");
    setTimelineDays(null);
    setDiscount(NO_DISCOUNT);
    setDemoMode(false);
    setGenError("");
  }

  // ══════════════ LEDGER ══════════════
  function patch(id: string, next: Partial<ConsoleLine>) {
    setLines((rows) => rows.map((r) => (r.id === id ? { ...r, ...next } : r)));
  }
  function removeLine(id: string) {
    setLines((rows) => rows.filter((r) => r.id !== id));
  }
  function addLine() {
    setLines((rows) => [...rows, blankLine()]);
  }

  /** The edit buffer: raw text while a cell has focus, the model otherwise. */
  function cellValue(key: string, n: number): string {
    return field?.key === key ? field.text : String(n);
  }

  // ══════════════ SAVE AS PROPOSAL ══════════════
  async function saveAsProposal() {
    if (lines.length === 0) return;
    setSaveBusy("saving");
    try {
      if (!(await ensureWithinLimit("proposalsCreated"))) {
        setSaveBusy(null);
        return;
      }
      // A suggestion counts in no total until it is added, so it never reaches the proposal.
      // An estimate priced the company's way keeps saying so — saved, and handed to the proposal.
      const built = estimateFromLines(lines.filter((l) => l.flag !== "suggested"), {
        title: title || projectType || "Estimate",
        scope: scope || briefUsed,
        assumptions: cleanAssumptions,
        estimatedTimelineDays: timelineDays ?? undefined,
        discount: discountToSchema(discount),
      });
      const data = pricing ? { ...built, pricing } : built;
      await saveEstimate({
        projectType: typeUsed || projectType,
        location: addrUsed || location || null,
        data,
      });
      const res = await convertEstimateToProposal({
        projectType: typeUsed || projectType,
        inventoryLinked: invLink,
        title: data.title,
        scope: data.scope,
        materials: data.materials,
        labor: data.labor,
        assumptions: data.assumptions,
        // The site, not the pricing market — this becomes `Proposal.address`.
        location: addrUsed || location || undefined,
        discount: data.discount ?? undefined,
        // The company's way: final prices, and the tax at the rate on this sheet.
        ...(pricing ? { pricing, taxPct: tax.pct } : {}),
      });
      toast.success("Proposal created", "Opening it now.");
      // The record is written; everything from here is navigation. Hold the
      // button in its "opening" state — do NOT release it in a `finally`, which
      // would fire before the route has even started rendering.
      setSaveBusy("opening");
      // Straight into the BLUEPRINT manual builder. This used to push
      // /dashboard/proposals/<id>, which is the legacy builder-a editor — the
      // one that greets a fresh save with its own corner transfer modal and a
      // five-second auto-redirect. The estimate is already persisted at this
      // point, so ?proposal=<id> reopens it with every line, assumption and
      // discount in place.
      // router.push, never location.assign — a hard nav replays the blueprint
      // entrance and the page visibly double-takes.
      router.push(`/dashboard/manual-blueprint?proposal=${res.id}` as never);
    } catch (err) {
      // Every failure path releases the button; the success path deliberately
      // does not, so there is no `finally` here.
      setSaveBusy(null);
      if (reportPlanLimit(err)) return;
      const msg = clientErrorText(err, "Couldn't save the proposal.");
      toast.error("Couldn't save", msg);
    }
  }

  // ══════════════ PHOTOS ══════════════
  async function takeFiles(files: FileList | null) {
    if (!files?.length) return;
    setPhotoErr("");
    const picked = Array.from(files).filter((f) => f.type.startsWith("image/"));
    // A plan set is the blueprint estimator's, a tool of its own.
    const pdfs = Array.from(files).some((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (picked.length !== files.length) setPhotoErr(pdfs ? "Photos only here — plan sets (PDF) go in the Blueprint estimator." : "Images only — other files were skipped.");
    const next: Photo[] = [];
    let bytes = photos.reduce((n, p) => n + p.size, 0);
    for (const f of picked) {
      if (photos.length + next.length >= PHOTO_MAX_COUNT) {
        setPhotoErr(`Up to ${PHOTO_MAX_COUNT} photos.`);
        break;
      }
      if (bytes + f.size > PHOTO_MAX_TOTAL_BYTES) {
        setPhotoErr("That is more than the estimator can read in one run — drop a few.");
        break;
      }
      bytes += f.size;
      next.push({
        id: newLineId("p"),
        name: f.name,
        size: f.size,
        dataUrl: await fileToDataUrl(f),
      });
    }
    if (next.length) setPhotos((p) => [...p, ...next]);
  }

  // ══════════════ ROW ══════════════
  // ONE ROW PER TASK: name · qty · unit · material $/unit · labor $/unit ·
  // total. Material and labor are columns of every row (owner, 2026-09-02).
  // The three numeric fields are inputMode=decimal TEXT fields, not number
  // inputs: the OS spinner appeared on hover and ate the right edge of a 62px
  // quantity cell. `cellValue` keeps the half-typed text ("1." / "") while the
  // model holds the parsed number.
  const numField = (
    r: ConsoleLine,
    key: "q" | "m" | "l",
    field: "qty" | "materialPrice" | "laborPrice",
    max: number,
    label: string,
    extraClass?: string,
  ) => {
    const k = `${r.id}:${key}`;
    return (
      <input
        className={cx("sp-in", extraClass)}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={cellValue(k, r[field])}
        aria-label={`${r.name || "Line item"} — ${label}`}
        onChange={(e) => {
          const text = e.target.value.replace(/[^0-9.]/g, "");
          setField({ key: k, text });
          patch(r.id, { [field]: clampNum(text, max) } as Partial<ConsoleLine>);
        }}
        onBlur={() => setField((f) => (f?.key === k ? null : f))}
      />
    );
  };

  const row = (r: ConsoleLine) => (
    <div className={cx("sp-row")} key={r.id}>
      <span className={cx("sp-row-n")}>
        {/* Real product names run past the column ("BEHR Premium 1 gal.
            #ST-533 Cedar Naturaltone Semi-Transparent…"); the field clips
            them, so the full string rides on the cursor while it rests here. */}
        <HoverTitle text={r.name}>
          <input
            className={cx("sp-name")}
            value={r.name}
            placeholder="Line item"
            aria-label="Item name"
            onChange={(e) => patch(r.id, { name: e.target.value })}
          />
        </HoverTitle>
        {r.badge && <em>{r.badge}</em>}
        {/* What the post-generation check did to this line: a line the app
            added from the trade's standard scope, or a price it pulled to the
            catalogue anchor. Same 9px mono chip as the refine badge. */}
        {r.flag === "auto" && <em className={cx("sp-flag")} title={r.flagNote}>added</em>}
        {r.flag === "adjusted" && <em className={cx("sp-flag")} title={r.flagNote}>adjusted</em>}
        {/* Measured out of the customer's own words and priced from the merchant
            path or the trade anchor — not the model's opinion. The hover names
            which of the three the material price came from. */}
        {r.flag === "computed" && <em className={cx("sp-flag")} title={r.flagNote}>computed</em>}
      </span>

      {numField(r, "q", "qty", MAX_QTY, "quantity", "sp-in--qty")}

      <BlueprintSelect
        value={r.unit}
        onChange={(unit) => patch(r.id, { unit })}
        options={unitSelectOptions(r.unit)}
        placeholder="unit"
        ariaLabel={`${r.name || "Line item"} — unit`}
        triggerClass="sp-unit"
      />

      {numField(r, "m", "materialPrice", MAX_MONEY, "material price per unit")}
      {numField(r, "l", "laborPrice", MAX_MONEY, "labor price per unit")}

      <span className={cx("sp-row-t")}>{money(lineTotal(r))}</span>

      <button
        className={cx("sp-row-x")}
        type="button"
        aria-label={`Remove ${r.name || "line item"}`}
        onClick={() => removeLine(r.id)}
      >
        <svg className={cx("ic")}>
          <use href="#i-x" />
        </svg>
      </button>
    </div>
  );

  /** An estimate from blueprints heads each trade's lines with the trade and its total. */
  const groupedRows = (rows: ConsoleLine[]) => {
    if (!rows.some((r) => r.group)) return rows.map(row);
    const out: ReactNode[] = [];
    let at: string | undefined;
    for (const r of rows) {
      if (r.group !== at) {
        at = r.group;
        const g = at;
        const sum = rows.filter((x) => x.group === g).reduce((n, x) => n + lineTotal(x), 0);
        out.push(
          <div className={cx("sp-group")} key={`g:${g ?? "other"}`}>
            <span>{g ?? "Other"}</span>
            <span>{money(sum)}</span>
          </div>,
        );
      }
      out.push(row(r));
    }
    return out;
  };

  const ledger = (
    <section className={cx("card")}>
      <div className={cx("sp-h")}>
        <div className={cx("sp-h-txt")}>
          <h2 className={cx("sp-t")}>Line items</h2>
        </div>
        <div className={cx("sp-cardtotal")}>{money(totals.subtotal)}</div>
      </div>
      <div className={cx("sp-thead")}>
        <span>Item</span>
        <span>Qty</span>
        <span>Unit</span>
        <span>Material</span>
        <span>Labor</span>
        <span>Total</span>
        <span className={cx("sp-th-x")} aria-hidden="true" />
      </div>
      <div>{groupedRows(lines.filter((l) => l.flag !== "suggested"))}</div>
      {lines.length === 0 && <div className={cx("sp-empty")}>Nothing here yet.</div>}
      <button className={cx("sp-add")} type="button" onClick={addLine}>
        <svg className={cx("ic")}>
          <use href="#i-plus" />
        </svg>
        Add line item
      </button>
      {/* Work the description never asked for. Priced, shown, and in no
          total until it is ticked (audit 2026-09-17). */}
      {lines.some((l) => l.flag === "suggested") && (
        <div className={cx("sp-sugg")}>
          <div className={cx("sp-sugg-h")}>Not in your description</div>
          {lines
            .filter((l) => l.flag === "suggested")
            .map((s) => (
              <label className={cx("sp-sugg-row")} key={s.id}>
                <input
                  type="checkbox"
                  checked={false}
                  // `uiLocked` was the written change-request's busy flag and
                  // went with it (origin/main, 2026-09-18). The row is still
                  // held while a save is in flight, which is the only write
                  // this card has left.
                  disabled={Boolean(saveBusy)}
                  aria-label={`Add ${s.name} to the estimate`}
                  onChange={() => patch(s.id, { flag: undefined, flagNote: undefined })}
                />
                <span className={cx("sp-sugg-n")}>{s.name}</span>
                <span className={cx("sp-sugg-t")}>{money(lineTotal(s))}</span>
                <em>add</em>
              </label>
            ))}
        </div>
      )}
      {checkNotes.length > 0 && (
        <ul className={cx("sp-checks")}>
          {checkNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );

  // ══════════════ PANEL 1 — INTAKE CONSOLE ══════════════
  if (panel === "intake") {
    const totalPhotoMb = photos.reduce((n, p) => n + p.size, 0) / (1024 * 1024);
    return (
      <>
        <div className={cx("page-head")}>
          <div>
            <div className={cx("kicker")}>{INTAKE.kicker}</div>
            <h1 className={cx("page-title")}>{INTAKE.title}</h1>
          </div>
        </div>

        <section className={cx("card", "est-console")}>
          <div className={cx("est-mast")}>
            <span className={cx("est-mark")}>
              <svg className={cx("ic")}>
                <use href="#i-bulb" />
              </svg>
            </span>
            <div>
              <h2 className={cx("est-title")}>{INTAKE.consoleTitle}</h2>
              <p className={cx("est-lede")}>{INTAKE.lede}</p>
            </div>
          </div>

          <div className={cx("est-rail")}>
            {/* 1 — THE BRIEF — first, so the job is described before it is placed (owner, 2026-09-02) */}
            <div className={cx("est-step", brief.trim() && "done")}>
              <span className={cx("est-n")}>1</span>
              <div className={cx("est-body")}>
                <div className={cx("est-h")}>{INTAKE.steps.brief.h}</div>
                <div className={cx("est-hint")}>{INTAKE.steps.brief.hint}</div>
                <textarea
                  id={briefId}
                  className={cx("est-area")}
                  aria-label={INTAKE.steps.brief.h}
                  placeholder={INTAKE.briefPlaceholder}
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                />
                {/* Press and speak — the words land in the field as they are
                    recognised (owner, 2026-09-18). Hidden where the browser
                    cannot listen. */}
                <DictateButton
                  id="briefDictate"
                  value={brief}
                  onChange={setBrief}
                  wrapClassName={cx("est-dictate")}
                  buttonClassName={cx("btn", "btn-ghost", "btn-sm", "est-mic")}
                  onClassName={cx("on")}
                  noteClassName={cx("est-dictate-note")}
                  iconClassName={cx("ic")}
                />
                <div className={cx("samples")}>
                  {SAMPLES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={cx("sample")}
                      onClick={() => setBrief(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {/* PHOTOS — read in the browser, sent as data URLs, never stored. */}
                <div className={cx("ph")}>
                  <div className={cx("ph-l")}>
                    {LIVE.photos.h}
                    <span>{LIVE.photos.hint}</span>
                  </div>
                  <div
                    className={cx("ph-drop", dragOver && "on")}
                    role="button"
                    tabIndex={0}
                    aria-label={LIVE.photos.cta}
                    onClick={() => photoInput.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        photoInput.current?.click();
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      void takeFiles(e.dataTransfer.files);
                    }}
                  >
                    <svg className={cx("ic", "ph-ic")}>
                      <use href="#i-imgadd" />
                    </svg>
                    <span className={cx("ph-cta")}>{LIVE.photos.cta}</span>
                    <span className={cx("ph-note")}>{LIVE.photos.privacy}</span>
                  </div>
                  <input
                    ref={photoInput}
                    className={cx("ph-file")}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                      void takeFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  {photoErr && <div className={cx("est-err")}>{photoErr}</div>}
                  {photos.length > 0 && (
                    <>
                      <div className={cx("ph-strip")}>
                        {photos.map((p) => (
                          <span className={cx("ph-thumb")} key={p.id}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.dataUrl} alt={p.name} />
                            <button
                              type="button"
                              className={cx("ph-x")}
                              aria-label={`Remove ${p.name}`}
                              onClick={() => setPhotos((f) => f.filter((x) => x.id !== p.id))}
                            >
                              <svg className={cx("ic")}>
                                <use href="#i-x" />
                              </svg>
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className={cx("ph-count")}>
                        {photos.length} of {PHOTO_MAX_COUNT} · {totalPhotoMb.toFixed(1)} MB
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
            {/* 2 — LOCATION */}
            <div className={cx("est-step", (addr.trim() || usState) && "done")}>
              <span className={cx("est-n")}>2</span>
              <div className={cx("est-body")}>
                <div className={cx("est-h")}>{INTAKE.steps.location.h}</div>
                <div className={cx("est-hint")}>{INTAKE.steps.location.hint}</div>
                <div className={cx("loc-row")}>
                  <label className={cx("est-field")} htmlFor={addrId}>
                    <span className={cx("est-lbl")}>Address or city</span>
                    <input
                      ref={addrRef}
                      id={addrId}
                      className={cx("est-in")}
                      placeholder={INTAKE.addressPlaceholder}
                      defaultValue={addr}
                      // Uncontrolled ON PURPOSE: attachPlacesSuggest writes the
                      // picked address straight into input.value, and a
                      // controlled value would fight it on the next render.
                    />
                  </label>
                  <div className={cx("est-field")}>
                    <span className={cx("est-lbl")} id={`${stateId}-l`}>
                      State
                    </span>
                    <BlueprintSelect
                      id={stateId}
                      value={usState}
                      onChange={pickState}
                      options={STATE_OPTIONS}
                      placeholder="State"
                      ariaLabel="State"
                      triggerClass="est-in"
                    />
                  </div>
                </div>
              </div>
            </div>

          </div>

          <div className={cx("est-bar")}>
            {/* The console's feedback channel. A live region because the run
                takes seconds and the Generate button is disabled throughout —
                without it a screen-reader user hears nothing at all. */}
            <span
              className={cx("est-status", generating && "run", genError && "bad")}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {genError || (generating ? INTAKE.running : "")}
            </span>
            <button
              className={cx("btn", "btn-primary")}
              type="button"
              disabled={!canGenerate}
              onClick={generate}
            >
              <svg className={cx("ic")}>
                <use href="#i-bulb" />
              </svg>
              <span>{generating ? "Generating…" : INTAKE.cta}</span>
            </button>
          </div>
        </section>

        {generating && (
          <GenerateOverlay stageIdx={stageIdx} done={genDone} exiting={genExit} />
        )}
        {clarify && <ClarifyDialog questions={clarify} onSettle={settleClarify} />}
      </>
    );
  }

  // ══════════════ PANEL 2 — THE ESTIMATE ══════════════
  return (
    <>
      {/* PAGE HEAD */}
      <div className={cx("page-head")}>
        <div className={cx("page-head-txt")}>
          <div className={cx("kicker")}>{LIVE.kicker}</div>
          <h1 className={cx("page-title")}>{title || "Estimate"}</h1>
          <div className={cx("sp-brief")}>
            {[typeUsed, locationUsed, timelineDays ? `${timelineDays} days` : ""]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <div className={cx("sp-head-btns")}>
          <button
            className={cx("btn", "btn-danger")}
            type="button"
            disabled={Boolean(saveBusy)}
            onClick={startOver}
          >
            <svg className={cx("ic")}>
              <use href="#i-undo" />
            </svg>
            Start over
          </button>
          <button
            className={cx("btn", "btn-primary")}
            type="button"
            disabled={Boolean(saveBusy) || lines.length === 0}
            onClick={saveAsProposal}
          >
            <svg className={cx("ic")}>
              <use href="#i-file" />
            </svg>
            {saveBusy === "opening" ? "Opening…" : saveBusy ? "Saving…" : "Save as proposal"}
          </button>
        </div>
      </div>

      {/* A roofing, fence or HVAC job can draw on that trade's warehouse (2026-09-20). */}
      {isTradeId(typeUsed || projectType) && <InventoryLinkChoice trade={typeUsed || projectType} value={invLink} onChange={setInvLink} compact />}

      {demoMode && (
        <div className={cx("sp-flag")} role="status">
          Placeholder pricing — no estimator key is configured on this environment.
        </div>
      )}

      <div className={cx("sp-grid")}>
        <div className={cx("sp-main")}>
          {ledger}

          {/* SCOPE */}
          <section className={cx("card")}>
            <div className={cx("sp-h")}>
              <div className={cx("sp-h-txt")}>
                <h2 className={cx("sp-t")}>Scope of work</h2>
              </div>
            </div>
            <textarea
              className={cx("sp-scope")}
              spellCheck={false}
              aria-label="Scope of work"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            />
          </section>
        </div>

        <div className={cx("sp-rail")}>
          {/* SUMMARY */}
          <section className={cx("card")}>
            <div className={cx("sp-h")}>
              <div className={cx("sp-h-txt")}>
                <h2 className={cx("sp-t")}>Summary</h2>
              </div>
            </div>
            <div className={cx("sp-sumrow")}>
              <span>Materials</span>
              <b>{money(totals.materials)}</b>
            </div>
            <div className={cx("sp-sumrow")}>
              <span>Labor</span>
              <b>{money(totals.labor)}</b>
            </div>
            {totals.discountCash > 0 && (
              <div className={cx("sp-sumrow", "sp-sumrow--disc")}>
                <span>Discount{discount.mode === "pct" ? ` · ${discount.value}%` : ""}</span>
                <b>{moneySigned(totals.discountCash)}</b>
              </div>
            )}
            <div className={cx("sp-sumrow")}>
              <span>Tax{tax.pct ? ` · ${tax.pct}%` : ""}</span>
              <b>{money(totals.taxCash)}</b>
            </div>
            <div className={cx("sp-sumtotal")}>
              <span>Total</span>
              <b>{money(totals.total)}</b>
            </div>

            {/* The two fields that move that total. The old −$150 constant was a
                label with no input behind it. */}
            <div className={cx("sp-adj")}>
              <label className={cx("sp-adj-f")}>
                <span className={cx("sp-adj-l")}>Discount</span>
                <span className={cx("sp-adj-in")}>
                  <input
                    className={cx("sp-in")}
                    type="number"
                    min="0"
                    max={discount.mode === "pct" ? 100 : MAX_MONEY}
                    step={discount.mode === "pct" ? 1 : 10}
                    inputMode="decimal"
                    value={cellValue("disc", discount.value)}
                    aria-label="Discount amount"
                    onChange={(e) => {
                      setField({ key: "disc", text: e.target.value });
                      setDiscount((d) => ({
                        ...d,
                        value: clampNum(e.target.value, d.mode === "pct" ? 100 : MAX_MONEY),
                      }));
                    }}
                    onBlur={() => setField((f) => (f?.key === "disc" ? null : f))}
                  />
                  <span className={cx("sp-tog")} role="group" aria-label="Discount unit">
                    <button
                      type="button"
                      className={cx("sp-tog-b", discount.mode === "pct" && "on")}
                      aria-pressed={discount.mode === "pct"}
                      onClick={() =>
                        setDiscount((d) => ({ mode: "pct", value: Math.min(d.value, 100) }))
                      }
                    >
                      %
                    </button>
                    <button
                      type="button"
                      className={cx("sp-tog-b", discount.mode === "amt" && "on")}
                      aria-pressed={discount.mode === "amt"}
                      onClick={() => setDiscount((d) => ({ ...d, mode: "amt" }))}
                    >
                      $
                    </button>
                  </span>
                </span>
              </label>

              <label className={cx("sp-adj-f")}>
                <span className={cx("sp-adj-l")}>Tax %</span>
                <span className={cx("sp-adj-in")}>
                  <input
                    className={cx("sp-in")}
                    type="number"
                    min="0"
                    max="30"
                    step="0.1"
                    inputMode="decimal"
                    value={cellValue("tax", tax.pct)}
                    aria-label="Tax percent"
                    onChange={(e) => {
                      setField({ key: "tax", text: e.target.value });
                      setTax({ pct: clampNum(e.target.value, 30), pinned: true });
                    }}
                    onBlur={() => setField((f) => (f?.key === "tax" ? null : f))}
                  />
                </span>
              </label>
            </div>
            {pricing?.taxMode === "materials" ? (
              <div className={cx("sp-adj-note")} data-sp-tax-materials>
                Tax on materials only — your company&apos;s rule (Settings → Estimating).
              </div>
            ) : null}
            {tax.pinned && !pricing && (
              // Honest caveat: convertEstimateToProposal derives the proposal's
              // tax from the job's state (lib/pricing/salesTax — the same table
              // this field seeds from), so a manual rate moves this sheet but
              // not the saved proposal. Changing that is a data-layer change.
              <div className={cx("sp-adj-note")}>
                Manual rate. The saved proposal taxes at the job state&apos;s rate.
              </div>
            )}
          </section>

          {/* The second way out — the same action as the page-head button, placed
              where the eye lands after reading the total (owner, 2026-09-02). */}
          <button
            className={cx("btn", "btn-primary", "sp-convert")}
            type="button"
            disabled={Boolean(saveBusy) || lines.length === 0}
            onClick={saveAsProposal}
          >
            <svg className={cx("ic")}>
              <use href="#i-file" />
            </svg>
            {saveBusy === "opening" ? "Opening…" : saveBusy ? "Saving…" : "Convert to proposal"}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * The generation overlay.
 *
 * Hand-rolled, like every other dialog here (no Radix). It is mounted only
 * while a request is in flight, so it cannot outlive one; `stageIdx` is driven
 * by the caller's real promise state. Portalled into `.content` because every
 * rule in the module is scoped under it.
 */
function GenerateOverlay({
  stageIdx,
  done,
  exiting,
}: {
  stageIdx: number;
  done: boolean;
  exiting: boolean;
}) {
  // Resolved lazily rather than in an effect: this component only ever mounts
  // in response to a click, so `document` is always there and there is no
  // hydration pass to disagree with. See `dialogHost` for why it is the shell
  // root and not `.content` or `<body>`.
  const [host] = useState<HTMLElement | null>(dialogHost);
  if (!host) return null;
  return createPortal(
    <div
      className={cx("gen")}
      data-exit={exiting ? "1" : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Building the estimate"
    >
      <div className={cx("gen-box")}>
        <div className={cx("gen-kicker")}>Smart Proposal</div>
        <div className={cx("gen-h")}>{done ? GEN_DONE : "Building the estimate"}</div>
        <ul className={cx("gen-list")}>
          {GEN_STAGES.map((st, i) => {
            const state = done || i < stageIdx ? "done" : i === stageIdx ? "now" : "wait";
            return (
              <li className={cx("gen-row")} data-state={state} key={st.id}>
                {/* The square's outline is SVG, not a CSS border, because the
                    ACTIVE state draws a line travelling around that outline —
                    a dash walking a rect's perimeter, which `border` cannot do.
                    Both rects are always present so the state change is a paint,
                    never a remount that would restart the walk mid-step. */}
                <span className={cx("gen-mark")} aria-hidden="true">
                  <svg className={cx("gen-ring")} viewBox="0 0 20 20">
                    <rect className={cx("gen-ring-track")} x="1" y="1" width="18" height="18" />
                    <rect className={cx("gen-ring-run")} x="1" y="1" width="18" height="18" />
                  </svg>
                  <svg className={cx("ic")}>
                    <use href="#i-check" />
                  </svg>
                </span>
                <span className={cx("gen-txt")}>{st.label}</span>
              </li>
            );
          })}
        </ul>
        <div className={cx("gen-foot")} role="status" aria-live="polite">
          {done ? GEN_DONE : (GEN_STAGES[Math.min(stageIdx, GEN_STAGES.length - 1)]?.label ?? "")}
        </div>
      </div>
    </div>,
    host,
  );
}

/**
 * The intake gate's questions — shown BEFORE anything is priced.
 *
 * `analyzeEstimatePrompt` already ran and already decided the brief was thin;
 * this dialog spends that decision instead of discarding it into a post-hoc
 * "the AI had to assume" note. Every question takes a custom answer, so the
 * options can never trap a contractor whose job does not fit them, and
 * "Generate anyway" is always one press away — the gate advises, it never
 * blocks. Since 2026-09-17 the gate asks only what moves the price (a cracked
 * slab, an old coating, a second roof layer), each with its reason, and never
 * a preference — the owner's word: a contractor's question, not a homeowner's
 * intake form.
 *
 * Settling is deliberately three-valued: answers (some or none) resume
 * generation, `null` abandons it. Escape and the scrim mean abandon, not
 * "generate anyway", because a stray keystroke must not spend a model call.
 */
function ClarifyDialog({
  questions,
  onSettle,
}: {
  questions: ClarifyQuestion[];
  onSettle: (value: ClarifyAnswer[] | null) => void;
}) {
  // Portalled into the shell root — see `dialogHost`. The footer's `.btn` rules
  // carry a `.clq-acts` selector for exactly this reason: they are otherwise
  // scoped under `.content`, which is not an ancestor here.
  const [host] = useState<HTMLElement | null>(dialogHost);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, boolean>>({});
  const [exiting, setExiting] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // The dialog settles exactly once. Escape during the exit window, or a second
  // click on a button that is still painted, must not resume generation twice.
  const settled = useRef(false);

  const settle = useCallback(
    (value: ClarifyAnswer[] | null) => {
      if (settled.current) return;
      settled.current = true;
      if (reducedMotion()) {
        onSettle(value);
        return;
      }
      setExiting(true);
      setTimeout(() => onSettle(value), MDL_EXIT_MS);
    },
    [onSettle],
  );

  // Scroll lock, focus in, Tab trap, Escape. Reference-counted lock — never a
  // hand-rolled body.style.overflow, which poisons any sheet opened over it.
  useEffect(() => {
    const release = lockScroll();
    const restore = document.activeElement as HTMLElement | null;
    boxRef.current?.focus();
    const SELECTOR =
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        settle(null);
        return;
      }
      if (e.key !== "Tab") return;
      const node = boxRef.current;
      if (!node) return;
      const list = Array.from(node.querySelectorAll<HTMLElement>(SELECTOR));
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      release();
      restore?.focus?.();
    };
  }, [settle]);

  if (!host) return null;

  const pairs = (): ClarifyAnswer[] =>
    questions
      .filter((q) => (answers[q.id] ?? "").trim())
      .map((q) => ({ question: q.question, answer: (answers[q.id] ?? "").trim() }));
  const answered = pairs().length;

  return createPortal(
    <div
      className={cx("clq")}
      data-exit={exiting ? "1" : undefined}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) settle(null);
      }}
    >
      <div
        ref={boxRef}
        className={cx("clq-box")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="clq-title"
        tabIndex={-1}
      >
        <div className={cx("clq-head")}>
          <div className={cx("clq-kicker")}>Smart Proposal · Intake</div>
          <div className={cx("clq-h")} id="clq-title">
            {questions.length === 1 ? "One thing moves this price" : "What moves this price"}
          </div>
          <p className={cx("clq-sub")}>
            Only what changes the cost of this job — the brief covers the rest. Tap what you
            know, or generate anyway and the estimate assumes the standard case and says so.
          </p>
        </div>

        <div className={cx("clq-body")}>
          {questions.map((q, i) => {
            const value = answers[q.id] ?? "";
            const isCustom = Boolean(custom[q.id]);
            // An option-less "select" is unanswerable; the server already
            // downgrades those, and this is the second belt.
            const kind =
              q.kind === "select" && q.options && q.options.length > 0
                ? "select"
                : q.kind === "number"
                  ? "number"
                  : "text";
            return (
              <div className={cx("clq-q")} key={q.id}>
                <span className={cx("clq-n")} aria-hidden="true">
                  {i + 1}
                </span>
                <div className={cx("clq-qt")}>
                  <label htmlFor={`clq-in-${q.id}`}>{q.question}</label>
                  {q.why && <div className={cx("clq-why")}>{q.why}</div>}

                  {kind === "select" && q.options ? (
                    <div className={cx("clq-opts")}>
                      {q.options.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          className={cx("clq-opt")}
                          data-on={!isCustom && value === opt ? "1" : undefined}
                          aria-pressed={!isCustom && value === opt}
                          onClick={() => {
                            setCustom((c) => ({ ...c, [q.id]: false }));
                            setAnswers((a) => ({ ...a, [q.id]: opt }));
                          }}
                        >
                          {opt}
                        </button>
                      ))}
                      <button
                        type="button"
                        className={cx("clq-opt", "clq-opt--other")}
                        data-on={isCustom ? "1" : undefined}
                        aria-pressed={isCustom}
                        onClick={() => {
                          setCustom((c) => ({ ...c, [q.id]: true }));
                          setAnswers((a) => ({ ...a, [q.id]: "" }));
                        }}
                      >
                        Something else
                      </button>
                    </div>
                  ) : null}

                  {kind === "number" && !isCustom ? (
                    <div className={cx("clq-numrow")}>
                      <input
                        id={`clq-in-${q.id}`}
                        type="number"
                        inputMode="decimal"
                        className={cx("clq-in", "clq-num")}
                        value={value}
                        placeholder={q.placeholder ?? "0"}
                        onChange={(e) =>
                          setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                        }
                      />
                      {q.unit ? <span className={cx("clq-unit")}>{q.unit}</span> : null}
                    </div>
                  ) : null}

                  {kind === "text" || isCustom ? (
                    <textarea
                      id={`clq-in-${q.id}`}
                      className={cx("clq-in")}
                      rows={2}
                      value={value}
                      placeholder={q.placeholder ?? "Type your answer…"}
                      onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className={cx("clq-foot")}>
          <span className={cx("clq-count")} role="status" aria-live="polite">
            {answered} of {questions.length} answered
          </span>
          <div className={cx("clq-acts")}>
            <button type="button" className={cx("btn", "btn-ghost")} onClick={() => settle([])}>
              Generate anyway
            </button>
            <button
              type="button"
              className={cx("btn", "btn-primary")}
              disabled={answered === 0}
              onClick={() => settle(pairs())}
            >
              Use answers
            </button>
          </div>
        </div>
      </div>
    </div>,
    host,
  );
}
