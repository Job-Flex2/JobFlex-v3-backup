"use client";
import { clientErrorText } from "@/lib/staleDeploy";

// VIDEO ESTIMATOR — the one state machine behind both surfaces.
//
// The desktop blueprint page (video-estimator-content.tsx) and the handheld
// build (components/v3/mobile-video-estimator) render this hook; neither owns
// a line of flow logic. Same reasoning as lib/estimate/console-model.ts for the
// Smart Proposal: two renderers of one contract cannot drift, and the contract
// is where the data layer is wired.
//
// THE FLOW
//   pickFile     → openClip (reject > 5 min / undecodable) → its still pass
//                  in the background; the intake strip fills as stills land.
//   retryFrames  → the still pass again, from a tap — iOS decodes for a user
//                  gesture where it would not for a script.
//   A pull the browser refused for want of a gesture (iOS in Low Power Mode:
//   NotAllowedError, nothing else wrong) is not an error: the stills are
//   DEFERRED to the Analyze tap, and analyze() opens the clip synchronously
//   inside that tap before anything else.
//   analyze      → extractAudioChunks → transcribe (route, chunked)
//                → analyzeWalkthrough (the reading)
//                → [clarify dialog, when the reading says the clip is thin]
//                → generateAdvancedEstimate (the Smart Proposal's planner +
//                  live pricing + matcher, fed briefFromAnalysis)
//                → result.
//   applyRefine  → refineAdvancedEstimate, parked on a review gate; nothing
//                  lands until confirmRefine.
//   save         → saveEstimate (one AiEstimate row, once).
//   convert      → save if needed, convertEstimateToProposal, navigate to the
//                  manual builder with the proposal open — the Smart Proposal's
//                  own hand-off.
//
// Every server result goes through one failure funnel: a plan-limit refusal is
// handed to the app's upgrade dialog, everything else becomes the inline error
// line plus a toast. The hook never leaves a blank panel behind.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/ui/Toast";
import {
  ensureWithinLimit,
  reportPlanLimit,
  reportPlanLimitResult,
} from "@/stores/usePlanLimitStore";
import { analyzeWalkthrough } from "@/actions/videoEstimator";
import {
  convertEstimateToProposal,
  generateAdvancedEstimate,
  refineAdvancedEstimate,
  saveEstimate,
} from "@/actions/advancedEstimator";
import type { ClarifyQuestion, GeneratedEstimate, PricingSnapshotWire } from "@/lib/estimatorSchema";
import {
  briefFromAnalysis,
  openQuestionsAsAssumptions,
  type VideoProjectType,
  type WalkthroughAnalysis,
} from "@/lib/estimate/video-schema";
import {
  NO_DISCOUNT,
  blankLine,
  briefWithAnswers,
  computeTotals,
  discountFromSchema,
  discountToSchema,
  estimateFromLines,
  lineTotal,
  linesFromEstimate,
  mergeRefined,
  type ClarifyAnswer,
  unitPriceOf,
  type ConsoleLine,
  type DiscountState,
} from "@/lib/estimate/console-model";
import {
  TranscribeError,
  extractAudioChunks,
  fmtBytes,
  fmtClock,
  fmtRes,
  frameCountFor,
  frameFailureReason,
  openClip,
  pullNeedsTap,
  stripFrames,
  transcribeChunks,
  transcriptText,
  type ClipReader,
  type VideoFrame,
  type VideoProbe,
} from "./video-ingest";

// ── Stages ──────────────────────────────────────────────────────────────────
// The ticket foot's progress line. `frames` runs at pick time; the rest run
// under Analyze. `audio` / `read` are real boundaries (a promise settles);
// `plan` → `price` → `build` are dwells inside one pricing call that reports
// nothing, at the Smart Proposal's own numbers, and `build` holds until the
// estimate lands rather than pretending to finish.

export const VIDEO_STAGES = [
  { id: "frames", label: "Pulling frames", dwellMs: 0 },
  { id: "audio", label: "Listening to the audio", dwellMs: 0 },
  { id: "read", label: "Reading the walkthrough", dwellMs: 0 },
  { id: "plan", label: "Planning materials", dwellMs: 7000 },
  { id: "price", label: "Pricing the work", dwellMs: 14000 },
  { id: "build", label: "Building the estimate", dwellMs: 0 },
] as const;
export type StageId = (typeof VIDEO_STAGES)[number]["id"];

function stageLabel(id: StageId): string {
  return VIDEO_STAGES.find((s) => s.id === id)?.label ?? "";
}

// ── Money ───────────────────────────────────────────────────────────────────

/** Whole dollars when the figure is whole, cents otherwise — a ledger, not a
 *  fixture, so $1.10 drip edge cannot print as $1. */
export function money(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  const whole = Math.abs(v - Math.round(v)) < 0.005;
  return (
    (v < 0 ? "-$" : "$") +
    Math.abs(v).toLocaleString("en-US", {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    })
  );
}

export type AudioState = "pending" | "ok" | "partial" | "none" | "failed";
export type SaveState = "idle" | "saving" | "saved" | "opening";

export type DiffRow = { kind: "Added" | "Changed" | "Removed"; name: string; detail: string };

export type PendingRefine = {
  data: GeneratedEstimate;
  rows: DiffRow[];
  warnings: string[];
  reshopFailed: boolean;
  instructions: string;
  totalBefore: number;
  totalAfter: number;
};

export type FrameRead = { frame: VideoFrame; label: string };

/** Confidence stamp tone, by the reading's own figure. */
export function confidenceTone(n: number): "high" | "mid" | "low" {
  return n >= 75 ? "high" : n >= 50 ? "mid" : "low";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The six stills the pricing call sees: the captioned evidence first, then
 *  an even spread of the rest. generateAdvancedEstimate caps photos at six. */
function pickPhotos(frames: VideoFrame[], read: WalkthroughAnalysis["frames"]): string[] {
  const chosen: VideoFrame[] = [];
  for (const r of read) {
    const f = frames[r.index];
    if (f && !chosen.includes(f)) chosen.push(f);
    if (chosen.length === 6) break;
  }
  if (chosen.length < 6) {
    for (const f of stripFrames(frames, 6)) {
      if (!chosen.includes(f)) chosen.push(f);
      if (chosen.length === 6) break;
    }
  }
  return chosen.map((f) => f.dataUrl);
}

export function useVideoEstimator(opts: {
  /** The router's push, handed in — the hook has no React tree of its own. */
  navigate: (href: string) => void;
  /** OPENAI_API_KEY present, read on the server. Without it Analyze explains
   *  itself instead of failing three stages in. */
  aiEnabled: boolean;
}) {
  const { navigate, aiEnabled } = opts;

  // ── Intake ──────────────────────────────────────────────────────────────
  const [file, setFile] = useState<File | null>(null);
  const [probe, setProbe] = useState<VideoProbe | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [frames, setFrames] = useState<VideoFrame[]>([]);
  const [framesProgress, setFramesProgress] = useState<{ done: number; total: number } | null>(null);
  /** The still pass came back empty — the error line says why and offers Retry. */
  const [framesFailed, setFramesFailed] = useState(false);
  /** The browser wants a tap before it reads the clip (iOS, Low Power Mode):
   *  the stills are pulled inside the Analyze tap instead. */
  const [framesDeferred, setFramesDeferred] = useState(false);
  const [job, setJob] = useState("");
  const [addr, setAddr] = useState("");
  const [notes, setNotes] = useState("");
  const [today, setToday] = useState("");

  // ── Flow ────────────────────────────────────────────────────────────────
  const [step, setStep] = useState<"intake" | "result">("intake");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<StageId | null>(null);
  const [stageNote, setStageNote] = useState("");
  const [error, setError] = useState("");
  const [audioState, setAudioState] = useState<AudioState>("pending");
  const [clarify, setClarify] = useState<ClarifyQuestion[] | null>(null);
  const clarifyResolve = useRef<((v: ClarifyAnswer[] | null) => void) | null>(null);

  // ── Result ──────────────────────────────────────────────────────────────
  const [analysis, setAnalysis] = useState<WalkthroughAnalysis | null>(null);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState("");
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [openQuestions, setOpenQuestions] = useState<string[]>([]);
  const [timelineDays, setTimelineDays] = useState<number | null>(null);
  const [discount, setDiscount] = useState<DiscountState>(NO_DISCOUNT);
  /** The company's own pricing (Settings → Estimating) the estimate was built
   *  with, when its switch is on — kept through refine, save and convert so the
   *  proposal keeps the company's prices and sales-tax rule. */
  const [pricing, setPricing] = useState<PricingSnapshotWire | null>(null);
  const [projectType, setProjectType] = useState<VideoProjectType>("other");
  /** The pricing market ("City, ST"), from the reading. Not the site address. */
  const [locationUsed, setLocationUsed] = useState("");
  const [briefUsed, setBriefUsed] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [refineText, setRefineText] = useState("");
  const [refineBusy, setRefineBusy] = useState(false);
  const [pending, setPending] = useState<PendingRefine | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // A pick that is superseded (a second file while the first is still being
  // read) must not land its frames on top of the new file's.
  const pickSeq = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const after = useCallback((ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  }, []);
  const previewRef = useRef<string | null>(null);
  /** The clip open for the still pass; closed on a new pick, on remove and on unmount. */
  const readerRef = useRef<ClipReader | null>(null);

  useEffect(() => {
    // Set after mount — a server-rendered date can straddle midnight against the
    // browser's clock and hydrate as a mismatch.
    const raf = requestAnimationFrame(() =>
      setToday(new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })),
    );
    const t = timers.current;
    return () => {
      cancelAnimationFrame(raf);
      t.forEach(clearTimeout);
      t.clear();
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      readerRef.current?.close();
    };
  }, []);

  // The dwell clock for the pricing call's three stages.
  useEffect(() => {
    if (!busy || !stage) return;
    const i = VIDEO_STAGES.findIndex((s) => s.id === stage);
    const dwell = VIDEO_STAGES[i]?.dwellMs ?? 0;
    if (!dwell || i < 0 || i >= VIDEO_STAGES.length - 1) return;
    const t = setTimeout(() => setStage(VIDEO_STAGES[i + 1].id), dwell);
    return () => clearTimeout(t);
  }, [busy, stage]);

  // ── Failure funnel ──────────────────────────────────────────────────────
  const fail = useCallback((res: { error: string; code?: string; resource?: string; trialCap?: string }, where: string) => {
    if (reportPlanLimitResult(res)) {
      // The card-less trial's ceiling says its own sentence (lib/trialCaps).
      setError(res.trialCap ? res.error : "You have used this month's estimator runs.");
      return;
    }
    setError(res.error);
    toast.error(where, res.error);
  }, []);

  // ── Pick / remove ───────────────────────────────────────────────────────
  const clearResult = useCallback(() => {
    setAnalysis(null);
    setLines([]);
    setTitle("");
    setScope("");
    setAssumptions([]);
    setOpenQuestions([]);
    setTimelineDays(null);
    setDiscount(NO_DISCOUNT);
    setPricing(null);
    setHistory([]);
    setPending(null);
    setRefineText("");
    setSavedId(null);
    setSaveState("idle");
    setAudioState("pending");
  }, []);

  const removeFile = useCallback(() => {
    pickSeq.current += 1;
    readerRef.current?.close();
    readerRef.current = null;
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPreviewUrl(null);
    setFile(null);
    setProbe(null);
    setFrames([]);
    setFramesProgress(null);
    setFramesFailed(false);
    setFramesDeferred(false);
    setError("");
    setStep("intake");
    clearResult();
  }, [clearResult]);

  /** The still pass on an open clip, under the "frames" stage. An empty pull
   *  says WHY on the error line (the pull's own report) and offers Retry —
   *  a tap is a user gesture, which is what iOS wants before it decodes —
   *  unless a missing gesture was the ONLY fault: then the stills are deferred
   *  to the Analyze tap (`fromTap` false) or, already from a tap, it is an
   *  error after all. Resolves to the stills pulled, [] when none. */
  const pullFrames = useCallback(
    async (reader: ClipReader, token: number, duration: number, fromTap: boolean): Promise<VideoFrame[]> => {
      setFramesFailed(false);
      setFramesDeferred(false);
      setStage("frames");
      setFramesProgress({ done: 0, total: frameCountFor(duration) });
      try {
        const { frames: out, report } = await reader.frames((done, total) => {
          if (pickSeq.current === token) setFramesProgress({ done, total });
        });
        if (pickSeq.current !== token) return [];
        if (out.length === 0) {
          console.warn("[videoEstimator] no frames pulled", report);
          if (pullNeedsTap(report) && !fromTap) {
            setFramesDeferred(true);
          } else {
            setError(
              pullNeedsTap(report)
                ? "Couldn't pull any frames — the browser refused to play this clip even from a tap (NotAllowedError). Export it as MP4 (1080p) and add that."
                : `Couldn't pull any frames — ${frameFailureReason(report)}. Tap Retry, or export the clip as MP4 (1080p) and add that.`,
            );
            setFramesFailed(true);
            toast.error("Can't read the video", "No frames could be decoded.");
          }
        }
        setFrames(out);
        return out;
      } catch (err) {
        if (pickSeq.current !== token) return [];
        setError(err instanceof Error ? err.message : "Could not read the video.");
        setFramesFailed(true);
        return [];
      } finally {
      reader.close();
      if (readerRef.current === reader) readerRef.current = null;
      if (pickSeq.current === token) {
        setFramesProgress(null);
        setStage(null);
      }
    }
  }, []);

  const pickFile = useCallback(
    async (f: File) => {
      setError("");
      // Opened before the first await: openClip starts the clip (muted) inside
      // the gesture that picked it — see video-ingest's header on iOS.
      readerRef.current?.close();
      const reader = openClip(f);
      readerRef.current = reader;
      const token = ++pickSeq.current;
      let p: VideoProbe;
      try {
        p = await reader.ready;
      } catch (err) {
        reader.close();
        if (readerRef.current === reader) readerRef.current = null;
        if (pickSeq.current !== token) return;
        const msg = err instanceof Error ? err.message : "Could not read that file.";
        setError(msg);
        toast.error("Can't use that video", msg);
        return;
      }
      if (pickSeq.current !== token) {
        reader.close();
        return;
      }
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      const url = URL.createObjectURL(f);
      previewRef.current = url;
      setPreviewUrl(url);
      setFile(f);
      setProbe(p);
      setFrames([]);
      setStep("intake");
      clearResult();
      await pullFrames(reader, token, p.duration, false);
    },
    [clearResult, pullFrames],
  );

  /** The still pass again, from a tap. */
  const retryFrames = useCallback(() => {
    if (!file || !probe || busy) return;
    setError("");
    readerRef.current?.close();
    const reader = openClip(file);
    readerRef.current = reader;
    const token = ++pickSeq.current;
    setFrames([]);
    void reader.ready.then(
      () => pullFrames(reader, token, probe.duration, true),
      (err: unknown) => {
        reader.close();
        if (readerRef.current === reader) readerRef.current = null;
        if (pickSeq.current !== token) return;
        setError(err instanceof Error ? err.message : "Could not read the video.");
        setFramesFailed(true);
      },
    );
  }, [file, probe, busy, pullFrames]);

  // ── Clarify gate ────────────────────────────────────────────────────────
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

  // ── Analyze ─────────────────────────────────────────────────────────────
  const framesReady = frames.length > 0 && framesProgress === null;
  const canAnalyze = !!file && !!probe && (framesReady || (framesDeferred && framesProgress === null)) && !busy;

  const analyze = useCallback(async () => {
    if (!canAnalyze || !file || !probe) return;
    if (!aiEnabled) {
      const msg = "Video analysis needs OPENAI_API_KEY — add it to enable this estimator.";
      setError(msg);
      toast.error("Estimator not configured", msg);
      return;
    }
    // Stills deferred to this tap: the clip is opened HERE, before the first
    // await, so the tap that pressed Analyze still covers its play().
    let deferredClip: ClipReader | null = null;
    if (frames.length === 0 && framesDeferred) {
      readerRef.current?.close();
      deferredClip = openClip(file);
      readerRef.current = deferredClip;
    }
    setError("");
    setBusy(true);
    setStage("audio");
    setStageNote("");
    try {
      // 0 · the stills, when the browser held them for a tap
      let stills = frames;
      if (deferredClip) {
        const token = ++pickSeq.current;
        try {
          await deferredClip.ready;
        } catch (err) {
          deferredClip.close();
          if (readerRef.current === deferredClip) readerRef.current = null;
          const msg = err instanceof Error ? err.message : "Could not read the video.";
          setError(msg);
          toast.error("Can't read the video", msg);
          return;
        }
        stills = await pullFrames(deferredClip, token, probe.duration, true);
        if (stills.length === 0) return;
        setStage("audio");
      }
      // 1 · the audio track
      let transcript = "";
      let audio: "ok" | "none" | "failed" = "none";
      let partial = false;
      const chunks = await extractAudioChunks(file, (d, t) => setStageNote(`decoding ${d} / ${t}`));
      if (chunks) {
        try {
          const { segments, failed } = await transcribeChunks(chunks, (d, t) =>
            setStageNote(`${d} / ${t}`),
          );
          if (segments.length) {
            transcript = transcriptText(segments);
            audio = "ok";
            partial = failed > 0;
          } else {
            audio = failed > 0 ? "failed" : "none";
          }
        } catch (err) {
          if (err instanceof TranscribeError && err.code === "PLAN_LIMIT_REACHED") {
            fail({ error: err.message, code: err.code, resource: err.resource, trialCap: err.trialCap }, "Couldn't start");
            return;
          }
          // Auth / key refusals surface on the reading call in a moment; a
          // transient failure here just means frames only.
          audio = "failed";
        }
      }
      setAudioState(partial ? "partial" : audio);

      // 2 · the reading
      setStage("read");
      setStageNote("");
      const read = await analyzeWalkthrough({
        frames: stills,
        transcript,
        audioState: audio,
        duration: probe.duration,
        project: job,
        address: addr,
        notes,
      });
      if (!read.ok) {
        fail(read, "Couldn't read the walkthrough");
        return;
      }
      const a = read.data;
      setAnalysis(a);

      // 3 · the gate, when the clip is thin
      let brief = briefFromAnalysis(a, notes);
      let open: ClarifyQuestion[] = [];
      if (!a.enoughDetail && a.questions.length > 0) {
        setStage(null);
        setBusy(false);
        const answers = await askClarify(a.questions);
        if (answers === null) return;
        brief = briefWithAnswers(brief, answers);
        const answered = new Set(answers.map((x) => x.question));
        open = a.questions.filter((q) => !answered.has(q.question));
        setBusy(true);
      }

      // 4 · pricing — the Smart Proposal's own engine
      setStage("plan");
      const market = a.location ?? undefined;
      const res = await generateAdvancedEstimate({
        projectType: a.projectType,
        description: brief,
        location: market,
        photos: pickPhotos(stills, a.frames),
      });
      if (!res.ok) {
        fail(res, "Pricing failed");
        return;
      }
      if (res.disabled) {
        const msg = "No estimator key configured — nothing was priced.";
        setError(msg);
        toast.error("Estimator not configured", msg);
        return;
      }
      const est = res.data;
      setLines(linesFromEstimate(est));
      setTitle(est.title || a.title);
      setScope(est.scope || a.scope);
      setAssumptions([...est.assumptions, ...openQuestionsAsAssumptions(open)]);
      setOpenQuestions(open.map((q) => q.question));
      setTimelineDays(est.estimatedTimelineDays ?? null);
      setDiscount(NO_DISCOUNT);
      setPricing(est.pricing ?? null);
      setProjectType(a.projectType);
      setLocationUsed(market ?? "");
      setBriefUsed(brief);
      setHistory([]);
      setPending(null);
      setRefineText("");
      setSavedId(null);
      setSaveState("idle");
      setStage("build");
      // A beat on "Building the estimate" so the line reads as finished rather
      // than vanishing mid-tick.
      await sleep(420);
      setStep("result");
    } catch (err) {
      const msg = clientErrorText(err, "Something went wrong.");
      setError(msg);
      toast.error("Analysis failed", msg);
    } finally {
      setBusy(false);
      setStage(null);
      setStageNote("");
    }
  }, [canAnalyze, file, probe, aiEnabled, frames, framesDeferred, pullFrames, job, addr, notes, fail]);

  // ── The estimate as the actions want it ─────────────────────────────────
  const cleanAssumptions = useMemo(
    () => assumptions.map((a) => a.trim()).filter(Boolean),
    [assumptions],
  );
  const currentEstimate = useCallback(
    (): GeneratedEstimate => {
      const built = estimateFromLines(lines, {
        title: title || analysis?.title || "Video estimate",
        scope: scope || briefUsed,
        assumptions: cleanAssumptions,
        estimatedTimelineDays: timelineDays ?? undefined,
        discount: discountToSchema(discount),
      });
      return pricing ? { ...built, pricing } : built;
    },
    [lines, title, analysis, scope, briefUsed, cleanAssumptions, timelineDays, discount, pricing],
  );

  const totals = useMemo(() => computeTotals({ lines, discount }), [lines, discount]);
  /** The shoppable list, DERIVED from the ledger rather than stored beside it —
   *  editing a quantity moves its buy quantity, deleting a line removes its row,
   *  and there is no second copy to keep in sync. */

  // ── Editing the ledger by hand ──────────────────────────────────────────
  // The Smart Proposal console's own affordances: every field a contractor most
  // wants to fix is editable in place, and a hand edit invalidates the saved
  // AiEstimate row so Convert writes what is on screen.
  const touch = useCallback(() => {
    setSavedId(null);
    setSaveState("idle");
  }, []);

  const setLine = useCallback(
    (
      id: string,
      patch: Partial<Pick<ConsoleLine, "name" | "qty" | "unit" | "materialPrice" | "laborPrice">>,
    ) => {
      setLines((rows) => rows.map((l) => (l.id === id ? { ...l, ...patch } : l)));
      touch();
    },
    [touch],
  );

  const removeLine = useCallback(
    (id: string) => {
      setLines((rows) => rows.filter((l) => l.id !== id));
      touch();
    },
    [touch],
  );

  /** A blank fused row for the contractor to fill in. */
  const addLine = useCallback(() => {
    setLines((rows) => [...rows, blankLine()]);
    touch();
  }, [touch]);

  // ── Refine, gated ───────────────────────────────────────────────────────
  // ONE change box for the one ledger (the fused model has no sections to fence
  // an instruction to). The result is parked on a review gate — a diff of what
  // the AI would change — and nothing lands until confirmRefine.
  const canRefine = refineText.trim().length > 0 && !refineBusy && lines.length > 0 && !pending;

  const applyRefine = useCallback(
    async () => {
      if (!canRefine) return;
      const instructions = refineText.trim();
      setError("");
      setRefineBusy(true);
      try {
        const res = await refineAdvancedEstimate({
          projectType,
          location: locationUsed || undefined,
          instructions,
          history: history.slice(-5),
          assumptions: cleanAssumptions,
          current: currentEstimate(),
        });
        if (!res.ok) {
          fail(res, "Couldn't apply");
          return;
        }
        if (res.disabled) {
          toast.info("Estimator not configured", "Nothing was re-priced.");
          return;
        }
        const before = new Map(lines.map((l) => [l.id, l]));
        const afterLines = linesFromEstimate(res.data);
        const rows: DiffRow[] = [];
        for (const n of afterLines) {
          const o = before.get(n.id);
          if (!o) {
            rows.push({
              kind: "Added",
              name: n.name,
              detail: `${n.qty} × ${money(unitPriceOf(n))} · ${money(lineTotal(n))}`,
            });
            continue;
          }
          const bits: string[] = [];
          if (o.name !== n.name) bits.push(`“${o.name}” → “${n.name}”`);
          if (o.qty !== n.qty) bits.push(`${o.qty} → ${n.qty} ${n.unit}`);
          if (o.materialPrice !== n.materialPrice)
            bits.push(`material ${money(o.materialPrice)} → ${money(n.materialPrice)}`);
          if (o.laborPrice !== n.laborPrice)
            bits.push(`labor ${money(o.laborPrice)} → ${money(n.laborPrice)}`);
          if (bits.length) rows.push({ kind: "Changed", name: o.name, detail: bits.join(" · ") });
        }
        const kept = new Set(afterLines.map((l) => l.id));
        for (const o of lines) {
          if (!kept.has(o.id)) rows.push({ kind: "Removed", name: o.name, detail: `was ${money(lineTotal(o))}` });
        }
        const nextDiscount = discountFromSchema(res.data.discount);
        if (JSON.stringify(nextDiscount) !== JSON.stringify(discount)) {
          const d = res.data.discount;
          rows.push({
            kind: d ? "Changed" : "Removed",
            name: "Discount",
            detail: d ? (d.isPercent ? `${d.amount}% off` : `${money(d.amount)} off`) : "cleared",
          });
        }
        if (rows.length === 0 && res.warnings.length === 0) {
          toast.info("No changes", "Nothing came back different — try being more specific.");
          return;
        }
        setPending({
          data: res.data,
          rows,
          warnings: res.warnings,
          reshopFailed: res.reshopFailed,
          instructions,
          totalBefore: totals.total,
          totalAfter: computeTotals({ lines: afterLines, discount: nextDiscount }).total,
        });
      } catch (err) {
        if (reportPlanLimit(err)) return;
        const msg = err instanceof Error ? err.message : "Couldn't apply the change.";
        toast.error("Couldn't apply", msg);
      } finally {
        setRefineBusy(false);
      }
    },
    [canRefine, refineText, projectType, locationUsed, history, cleanAssumptions, currentEstimate, lines, discount, totals.total, fail],
  );

  const confirmRefine = useCallback(() => {
    if (!pending) return;
    setLines(mergeRefined(lines, pending.data));
    if (pending.data.assumptions.length) setAssumptions(pending.data.assumptions);
    if (pending.data.title) setTitle(pending.data.title);
    if (pending.data.scope) setScope(pending.data.scope);
    setDiscount(discountFromSchema(pending.data.discount));
    setHistory((h) => [...h, pending.instructions].slice(-10));
    // The saved row is now behind the ledger; Save writes a fresh one.
    setSavedId(null);
    setPending(null);
    setRefineText("");
  }, [pending, lines]);

  const discardRefine = useCallback(() => setPending(null), []);

  // ── Save / convert ──────────────────────────────────────────────────────
  const flashSaved = useCallback(() => {
    setSaveState("saved");
    after(1600, () => setSaveState((s) => (s === "saved" ? "idle" : s)));
  }, [after]);

  const save = useCallback(async () => {
    if (lines.length === 0 || saveState === "saving" || saveState === "opening") return;
    if (savedId) {
      flashSaved();
      return;
    }
    setError("");
    setSaveState("saving");
    try {
      const r = await saveEstimate({
        projectType,
        location: addr.trim() || locationUsed || null,
        data: currentEstimate(),
      });
      setSavedId(r.id);
      flashSaved();
    } catch (err) {
      setSaveState("idle");
      if (reportPlanLimit(err)) return;
      const msg = err instanceof Error ? err.message : "Couldn't save the estimate.";
      toast.error("Couldn't save", msg);
    }
  }, [lines.length, saveState, savedId, flashSaved, projectType, addr, locationUsed, currentEstimate]);

  const convert = useCallback(async () => {
    if (lines.length === 0 || saveState === "saving" || saveState === "opening") return;
    setError("");
    setSaveState("saving");
    try {
      if (!(await ensureWithinLimit("proposalsCreated"))) {
        setSaveState("idle");
        return;
      }
      const data = currentEstimate();
      if (!savedId) {
        const r = await saveEstimate({
          projectType,
          location: addr.trim() || locationUsed || null,
          data,
        });
        setSavedId(r.id);
      }
      const res = await convertEstimateToProposal({
        projectType,
        title: data.title,
        scope: data.scope,
        materials: data.materials,
        labor: data.labor,
        assumptions: data.assumptions,
        // The site, not the pricing market — this becomes Proposal.address.
        location: addr.trim() || locationUsed || undefined,
        discount: data.discount ?? undefined,
        // The company's rule picks the tax (its rate, else the site's state rate).
        ...(data.pricing ? { pricing: data.pricing } : {}),
      });
      toast.success("Proposal created", "Opening it now.");
      // Held in "opening" on purpose — releasing it in a finally would fire
      // before the route has started rendering.
      setSaveState("opening");
      navigate(`/dashboard/manual-blueprint?proposal=${res.id}`);
    } catch (err) {
      setSaveState("idle");
      if (reportPlanLimit(err)) return;
      const msg = err instanceof Error ? err.message : "Couldn't create the proposal.";
      toast.error("Couldn't convert", msg);
    }
  }, [lines.length, saveState, savedId, currentEstimate, projectType, addr, locationUsed, navigate]);

  /** The phone's one thumb bar shows `error` in both steps, so a refine failure
   *  needs a way off the screen that is not Start over. */
  const dismissError = useCallback(() => setError(""), []);

  /** Back to the intake with the clip still loaded; the estimate is dropped. */
  const startOver = useCallback(() => {
    setStep("intake");
    setError("");
    clearResult();
  }, [clearResult]);

  // ── Derived, for the renderers ──────────────────────────────────────────
  const framesRead: FrameRead[] = useMemo(() => {
    if (!analysis) return [];
    const out = analysis.frames
      .map((f) => ({ frame: frames[f.index], label: f.label }))
      .filter((x): x is FrameRead => Boolean(x.frame));
    if (out.length) return out;
    return stripFrames(frames, 4).map((frame) => ({ frame, label: fmtClock(frame.t) }));
  }, [analysis, frames]);

  /** The look-ahead part of the reading — the work, what it brings with it,
   *  the procedure — or null for a reading in the old shape, so the cards
   *  hide the section whole rather than show three empty faces. */
  const deep = useMemo(
    () =>
      analysis && (analysis.work.length || analysis.behind.length || analysis.steps.length) ? analysis : null,
    [analysis],
  );

  const sourceLabel = probe ? `Walkthrough · ${fmtClock(probe.duration)}` : "—";
  const fileMeta =
    file && probe ? [fmtClock(probe.duration), fmtBytes(file.size), fmtRes(probe)].filter(Boolean).join(" · ") : "";
  const stageText = stage
    ? `${stageLabel(stage)}${
        stage === "frames" && framesProgress
          ? ` · ${framesProgress.done} / ${framesProgress.total}`
          : stageNote
            ? ` · ${stageNote}`
            : ""
      }…`
    : "";

  return {
    // intake
    file,
    probe,
    previewUrl,
    frames,
    stripFrames: stripFrames(frames, 4),
    framesProgress,
    framesReady,
    framesFailed,
    framesDeferred,
    retryFrames,
    job,
    setJob,
    addr,
    setAddr,
    notes,
    setNotes,
    today,
    sourceLabel,
    fileMeta,
    pickFile,
    removeFile,
    canAnalyze,
    analyze,
    // flow
    step,
    busy,
    stage,
    stageText,
    error,
    dismissError,
    audioState,
    clarify,
    settleClarify,
    aiEnabled,
    // result
    analysis,
    deep,
    title,
    scope,
    assumptions,
    openQuestions,
    timelineDays,
    locationUsed,
    lines,
    setLine,
    removeLine,
    addLine,
    totals,
    pricing,
    framesRead,
    refineText,
    setRefineText,
    refineBusy,
    canRefine,
    applyRefine,
    pending,
    confirmRefine,
    discardRefine,
    saveState,
    savedId,
    save,
    convert,
    startOver,
  };
}

export type VideoEstimator = ReturnType<typeof useVideoEstimator>;
