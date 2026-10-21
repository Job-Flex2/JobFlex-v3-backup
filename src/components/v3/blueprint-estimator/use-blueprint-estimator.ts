"use client";
// THE BLUEPRINT ESTIMATOR'S STATE (2026-10-20): the plans, the reading, the ask, the work, the result and the
// proposal, lifted out of blueprint-estimator.tsx so the desk page and the phone page (mobile-blueprint-estimator)
// run the same estimator — the same actions, the same route, the same handoff. Nothing here draws.
// The stages and their steps are described at the head of blueprint-estimator.tsx.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clientErrorText } from "@/lib/staleDeploy";
import { askPlan, getPlanPriceChecks, measurePlanSheet, planHvacLoadAction, readPlanSheet, skimPlanSheet, startPlanSession } from "@/actions/planEstimator";
import { planEnvelopeOf } from "@/lib/plans/hvacEnvelope";
import { convertEstimateToProposal, saveEstimate } from "@/actions/advancedEstimator";
import type { pricePlanTrade } from "@/actions/advancedEstimator";
import { MAX_PLAN_PAGES, openPlanFiles, type PlanPage } from "@/lib/plans/pdfClient";
import { formatTextLayer } from "@/lib/plans/readPrompt";
import type { SheetRead } from "@/lib/plans/sheet";
import { computeTakeoff, PLAN_TRADES, TRADE_LABEL, type PlanTrade, type Takeoff, type TakeoffItem } from "@/lib/plans/takeoff";
import { houseBriefOf, type HouseBrief } from "@/lib/plans/tradeBrief";
import { mergePlanEstimate, type PlanEstimate, type TradeResult } from "@/lib/plans/merge";
import { applyFocus, jobItems, partialTrades, scopeByRules, sheetLite, withFinish, type FocusRead, type FoundRow, type JobScope, type JobSpec, type SheetLite } from "@/lib/plans/ask";
import { BASE_KINDS, kindsFor, readRank, readsAtAll, readsLight, type SheetSkim } from "@/lib/plans/readOrder";
import { fitImages, guessKind, pool, textKind } from "@/lib/plans/readClient";
import { handPlanEstimate } from "@/lib/plans/handoff";
import { measureReport, type MeasureReport, type SectionKey } from "@/lib/plans/measureReport";
import { estimateFromLines, isBilled, lineTotal, type ConsoleLine } from "@/lib/estimate/console-model";
import { toast } from "@/components/ui/Toast";
import { ensureWithinLimit, reportPlanLimit, reportPlanLimitResult } from "@/stores/usePlanLimitStore";

export type Stage = "upload" | "ask" | "work" | "result" | "sizes";
/** What the plans are wanted for: a priced job, or the sizes and measurements alone (2026-10-21). */
export type Mode = "estimate" | "sizes";
/** The sizes and measurements, as last read (lib/plans/measureReport). */
export type Sizes = { report: MeasureReport; request: string; focus: SectionKey | null };
type ReadState = { status: "run" | "ok" | "fail"; sheet?: SheetRead; error?: string };
type Failure = { ok: false; error: string; code?: string; resource?: string };

export type Result = {
  request: string;
  scope: JobScope;
  rows: FoundRow[];
  /** What the plans' notes, schedules and details specify for the job. */
  specs: JobSpec[];
  /** The job's lines, as priced (measurements in them). */
  items: TakeoffItem[];
  takeoff: Takeoff;
  house: HouseBrief;
  results: TradeResult[];
  failed: Array<{ trade: PlanTrade; error: string }>;
  merged: PlanEstimate;
  location: string;
  /** How long each step took, for the line under the answer. */
  timing: Array<[string, number]>;
};

/** First looks at once (tiny calls), sheets read at once, sheets measured at once, trades priced at once. */
const SKIM_AT_ONCE = 6;
const READ_AT_ONCE = 3;
const MEASURE_AT_ONCE = 3;
// Trades are priced through /api/estimator/plan-price (2026-10-17): fetch calls run side by side, where the page's
// server actions had been sent one at a time — so these lanes are real now.
const PRICE_AT_ONCE = 6;
/** A trade that has not come back in this long is marked failed (it joins "Try again") instead of holding the
 *  whole estimate at "Pricing" forever (owner, 2026-10-17: stuck at 88% for minutes). */
const PRICE_TRADE_LIMIT_MS = 240_000;

/** One tap fills the question. */
export const ASKS: Array<{ label: string; ask: string }> = [
  { label: "Countertops", ask: "Granite countertops — kitchen, island and bathroom vanities" },
  { label: "Drywall, texture & paint", ask: "Drywall hang, tape and finish with texture, primer and paint" },
  { label: "Drywall only", ask: "Just the drywall — hang, tape and finish" },
  { label: "Interior paint", ask: "Interior paint — walls and ceilings, primer and two coats" },
  { label: "Flooring", ask: "Flooring — hardwood, carpet and the stair treads" },
  { label: "Tile", ask: "Tile — bathroom floors, shower walls and the kitchen backsplash" },
  { label: "Cabinets", ask: "Kitchen cabinets and bathroom vanities" },
  { label: "Roofing", ask: "Roofing — shingles, underlayment, flashing and vents" },
  { label: "Siding", ask: "Siding, house wrap, trim, soffit and fascia" },
  { label: "Windows & doors", ask: "Windows and exterior doors, supplied and installed" },
  { label: "Plumbing", ask: "Plumbing — rough-in, stub-outs, fixtures and finish" },
  { label: "Electrical", ask: "Electrical — service, rough wiring, devices and light fixtures" },
  { label: "HVAC", ask: "Heating and cooling — equipment, ductwork and venting" },
  { label: "Framing", ask: "Framing package — walls, floors, roof trusses and sheathing" },
  { label: "Concrete", ask: "Foundation and concrete — footings, walls, slabs, driveway and walks" },
  { label: "The whole house", ask: "The whole house — every trade" },
];

export const KIND_WORD: Partial<Record<SheetRead["kind"], string>> = {
  cover: "Cover",
  site: "Site plan",
  foundation: "Foundation",
  floor: "Floor plan",
  roof: "Roof plan",
  elevation: "Elevations",
  section: "Sections",
  structural: "Structural",
  electrical: "Electrical",
  plumbing: "Plumbing",
  mechanical: "Mechanical",
  schedule: "Schedules",
  detail: "Details",
};

export const UNIT_SHORT: Record<TakeoffItem["unit"], string> = {
  "sq ft": "SF", "linear ft": "LF", each: "EA", "cu yards": "CY", squares: "SQ", sheets: "SHT", tons: "TON", boxes: "BOX", bundles: "BDL",
  rolls: "ROLL", gallons: "GAL", bags: "BAG", pieces: "PC", "sq yd": "SY", sets: "SET", buckets: "BKT", tubes: "TUBE", lot: "LOT",
};

export const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
/** The wall clock, read only in handlers and timers (never while rendering). */
const nowMs = () => Date.now();
/** 95 s → "1:35". */
export const clockText = (ms: number) => {
  const sec = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};
export const qtyText = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : (Math.round(n * 10) / 10).toLocaleString("en-US"));

type TradePriceRun = Awaited<ReturnType<typeof pricePlanTrade>>;

/** One trade priced through the route (the same checks and work as the `pricePlanTrade` action). */
async function postTradePrice(body: Parameters<typeof pricePlanTrade>[0], signal?: AbortSignal): Promise<TradePriceRun> {
  const res = await fetch("/api/estimator/plan-price", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  // A platform timeout or a crash answers with a page, not our JSON.
  const data = (await res.json().catch(() => null)) as TradePriceRun | null;
  if (!data) return { ok: false, error: res.status === 504 ? "This trade took too long to price. Try it again." : "This trade could not be priced. Try it again." };
  return data;
}

/** The working card's four steps, and the meter over them (blueprint-loading-card, and the phone's working card). */
export const WORK_STEPS = ["Reading your plans", "Working out the job", "Measuring it on the sheets", "Pricing"];
export const PRICING_STEP = 3;
/** The same card when only the sizes are wanted — nothing is priced. */
export const MEASURE_STEPS = ["Reading your plans", "Finding what you asked for", "Measuring it on the sheets", "Putting the sizes together"];

/** One tap opens the sizes on that part of the house — no AI beyond the reading (2026-10-21). */
export const SIZE_ASKS: Array<{ label: string; focus: SectionKey | null }> = [
  { label: "Everything", focus: null },
  { label: "Rooms & square feet", focus: "rooms" },
  { label: "Floor areas", focus: "areas" },
  { label: "Windows", focus: "windows" },
  { label: "Doors", focus: "doors" },
  { label: "Roof", focus: "roof" },
  { label: "Walls & siding", focus: "walls" },
  { label: "Foundation & concrete", focus: "foundation" },
  { label: "Drywall, paint & trim", focus: "work" },
];

export function workProgress({ step, readDone, readTotal, priced = 0, priceTotal = 0, steps = WORK_STEPS.length }: { step: number; readDone: number; readTotal: number; priced?: number; priceTotal?: number; steps?: number }) {
  const within = step === 0 && readTotal ? readDone / readTotal : step === PRICING_STEP && priceTotal ? priced / priceTotal : 0.5;
  const progress = Math.min(99, Math.round(((step + within) / steps) * 100));
  const pricingWords = step === PRICING_STEP && priceTotal ? `${priced} of ${priceTotal} trades` : "";
  return { progress, pricingWords };
}

/**
 * The estimator, start to finish. `smartProposalHref` is where "Edit in Smart Proposal" lands — the desk's
 * /dashboard/advanced-ai by default; the phone page passes its own Smart Proposal (the same handoff reads it).
 */
export function useBlueprintEstimator({ smartProposalHref = "/dashboard/advanced-ai" }: { smartProposalHref?: string } = {}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("upload");
  const [opening, setOpening] = useState<number | null>(null);
  const [pages, setPages] = useState<PlanPage[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [reads, setReads] = useState<Record<number, ReadState>>({});
  const [readTotal, setReadTotal] = useState(0);
  const [request, setRequest] = useState("");
  const [locEdit, setLocEdit] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  /** Pricing, as it goes: trades done of all, and the ones being priced now. */
  const [pricing, setPricing] = useState<{ done: number; total: number; now: PlanTrade[] }>({ done: 0, total: 0, now: [] });
  /** What each sheet is, from its text or a first look (lib/plans/readOrder). */
  const [kinds, setKinds] = useState<Record<number, SheetSkim | null>>({});
  /** The sheets every job rests on are read: a job can be asked without waiting on the rest. */
  const [baseReady, setBaseReady] = useState(false);
  const [working, setWorking] = useState<{ title?: string; measuring?: string[]; notes?: number[] }>({});
  const [result, setResult] = useState<Result | null>(null);
  const [mode, setMode] = useState<Mode>("estimate");
  const [sizes, setSizes] = useState<Sizes | null>(null);
  /** The steps the working card shows: the job's, or the sizes'. */
  const [workSteps, setWorkSteps] = useState<string[]>(WORK_STEPS);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [saving, setSaving] = useState<null | "saving" | "opening">(null);
  const [retrying, setRetrying] = useState<PlanTrade | null>(null);
  const [viewer, setViewer] = useState<{ page: number; url: string | null } | null>(null);
  const [err, setErr] = useState("");
  const pagesRef = useRef<PlanPage[]>([]);
  const readsRef = useRef<Record<number, ReadState>>({});
  const tokenRef = useRef<string | null>(null);
  const tokenPendingRef = useRef<Promise<string | null> | null>(null);
  const kindsRef = useRef<Record<number, SheetSkim | null>>({});
  /** Each sheet in the reading queue: settled when it is read (or could not be). */
  const settledRef = useRef<Map<number, Promise<void>>>(new Map());
  /** The first looks, all done. */
  const skimRef = useRef<Promise<void> | null>(null);
  /** The background reading of the set, awaited when a job is asked. */
  const readingRef = useRef<Promise<void> | null>(null);
  /** Bumped by a new plan set or a new ask: a late answer from the old one is dropped. */
  const setRun = useRef(0);
  const askRun = useRef(0);

  const failText = (res: Failure) => (reportPlanLimitResult(res) ? "You have used this month's estimator runs." : res.error);

  // ── 1 · the plans ──────────────────────────────────────────────────────
  async function openFiles(list: File[]) {
    if (!list.length) return;
    setErr("");
    setOpening(0);
    const run = ++setRun.current;
    try {
      const { pages: opened, skipped: why } = await openPlanFiles(list, () => setOpening((n) => (n ?? 0) + 1));
      if (run !== setRun.current) return;
      const kept = opened.slice(0, MAX_PLAN_PAGES).map((p, i) => ({ ...p, page: i + 1 }));
      if (!kept.length) {
        setErr(why[0] ?? "No pages could be opened from these files.");
        return;
      }
      pagesRef.current = kept;
      readsRef.current = {};
      kindsRef.current = {};
      settledRef.current = new Map();
      skimRef.current = null;
      tokenRef.current = null;
      tokenPendingRef.current = null;
      setPages(kept);
      setReads({});
      setKinds({});
      setBaseReady(false);
      setResult(null);
      setSkipped([...why, ...(opened.length > MAX_PLAN_PAGES ? [`Only the first ${MAX_PLAN_PAGES} pages are kept.`] : [])]);
      setStage("ask");
      readingRef.current = readAll(kept, run).catch((e) => {
        if (run === setRun.current) setErr(clientErrorText(e, "The plans could not be read. Open the plans again."));
      });
    } catch (e) {
      setErr(clientErrorText(e, "The files could not be opened."));
    } finally {
      setOpening(null);
    }
  }

  async function ensureToken(): Promise<string | null> {
    if (tokenRef.current) return tokenRef.current;
    // Upload reading and an immediate estimate share one session and trial use.
    if (tokenPendingRef.current) return tokenPendingRef.current;
    const run = setRun.current;
    const pending = (async () => {
      const res = await startPlanSession();
      if (run !== setRun.current) return null;
      if (!res.ok) throw new Error(failText(res));
      tokenRef.current = res.token;
      return res.token;
    })();
    tokenPendingRef.current = pending;
    try {
      return await pending;
    } finally {
      if (tokenPendingRef.current === pending) tokenPendingRef.current = null;
    }
  }

  async function readOne(p: PlanPage, tok: string, total: number, run: number, light: boolean) {
    const mark = (state: ReadState) => {
      if (run !== setRun.current) return;
      readsRef.current = { ...readsRef.current, [p.page]: state };
      setReads(readsRef.current);
    };
    mark({ status: "run" });
    // One quiet second try — the contractor never sees a sheet's hiccup. A sheet read
    // light that turns out to be one jobs measure on (a floor plan the first look took for
    // something else) is read again, close.
    let lightNow = light;
    let error = "This sheet could not be read.";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { overview, tiles, grid } = await p.render({ light: lightNow });
        const images = fitImages(overview, tiles);
        const res = await readPlanSheet({
          token: tok,
          page: p.page,
          pages: total,
          fileName: p.fileName,
          textLayer: formatTextLayer(p.textItems),
          images: images.map((url) => ({ url })),
          grid: grid && images.length === tiles.length + 1 ? grid : null,
        });
        if (res.ok && lightNow && !readsLight(res.sheet.kind) && res.sheet.kind !== "detail") {
          lightNow = false;
          continue;
        }
        if (res.ok) return mark({ status: "ok", sheet: res.sheet });
        error = failText(res);
      } catch (e) {
        error = clientErrorText(e, "The sheet-reading request did not complete.");
      }
    }
    mark({ status: "fail", error });
  }

  /** A first look at one sheet: what kind it is, from its title block. Null when it could not be told. */
  async function skimOne(p: PlanPage, tok: string, total: number, run: number) {
    const known = kindsRef.current[p.page] ?? null;
    let look: SheetSkim | null = null;
    try {
      const images = await p.glance();
      const res = await skimPlanSheet({ token: tok, page: p.page, pages: total, images: images.map((url) => ({ url })) });
      if (res.ok) look = res.skim;
    } catch {
      // the sheet keeps what its text said, or nothing
    }
    if (run !== setRun.current) return;
    // A look that could not tell (no kind, nothing on it) is no look: the sheet is read in full.
    if (look && look.kind === "other" && !look.contents.length && !look.title) look = null;
    // A sheet whose own text named it keeps that kind; the look adds what is on it.
    const next = look ? (known ? { ...look, kind: known.kind, title: known.title ?? look.title } : look) : known;
    kindsRef.current = { ...kindsRef.current, [p.page]: next };
    setKinds(kindsRef.current);
  }

  /**
   * The set, read in the background from the moment it opens. Every sheet gets a first
   * look (lib/plans/readOrder): what kind it is and everything on it — kept in mind, so a
   * job can come back to any sheet that bears on it. As the looks come in, the sheets
   * most jobs rest on are read closely first (floor plans, schedules, the cover, the site
   * plan); elevations, sections and structural notes after, lighter; details are only
   * indexed (a job that needs one looks at it closely then).
   */
  async function readAll(list: PlanPage[], run: number) {
    const tok = await ensureToken();
    if (!tok || run !== setRun.current) return;
    let skimmed: () => void = () => {};
    skimRef.current = new Promise<void>((r) => (skimmed = r));
    const kindOf = (p: PlanPage) => kindsRef.current[p.page]?.kind ?? null;
    const queue: PlanPage[] = [];
    const done = new Map<number, () => void>();
    const enqueue = (p: PlanPage) => {
      if (settledRef.current.has(p.page) || !readsAtAll(kindOf(p))) return;
      settledRef.current.set(p.page, new Promise<void>((r) => done.set(p.page, r)));
      queue.push(p);
      setReadTotal(settledRef.current.size);
    };
    let looking = list.length;
    const wake: Array<() => void> = [];
    const nudge = () => wake.splice(0).forEach((f) => f());
    // A sheet whose own text names it is queued at once.
    for (const p of list) {
      const k = textKind(p);
      if (!k) continue;
      kindsRef.current = { ...kindsRef.current, [p.page]: { kind: k, title: p.titleText.split("\n")[0]?.slice(0, 120) || null, level: null, contents: [] } };
      enqueue(p);
    }
    const looks = pool(list, SKIM_AT_ONCE, async (p) => {
      await skimOne(p, tok, list.length, run);
      looking--;
      enqueue(p);
      nudge();
    }).then(() => {
      if (run !== setRun.current) return;
      skimmed();
      void waitFor(new Set(BASE_KINDS)).then(() => {
        if (run === setRun.current) setBaseReady(true);
      });
    });
    // The most useful sheet looked at so far. While looks are still coming in, only the
    // sheets every job rests on start (floor plans, schedules, the cover); the rest wait
    // their turn in the order.
    const early = (p: PlanPage) => (BASE_KINDS as readonly string[]).includes(kindOf(p) ?? "");
    const reader = async () => {
      for (;;) {
        if (run !== setRun.current) return;
        queue.sort((a, b) => readRank(kindOf(a)) - readRank(kindOf(b)) || a.page - b.page);
        const next = queue[0];
        if (next && (looking === 0 || early(next))) {
          queue.shift();
          await readOne(next, tok, list.length, run, readsLight(kindOf(next)));
          done.get(next.page)?.();
          continue;
        }
        if (!next && looking === 0) return;
        await new Promise<void>((r) => wake.push(r));
      }
    };
    await Promise.all([looks, ...Array.from({ length: READ_AT_ONCE }, reader)]);
  }

  /**
   * Until the sheets of these kinds are read — a sheet the first look could not place
   * counts as any kind. "all": the whole queue.
   */
  async function waitFor(want: Set<SheetRead["kind"]> | "all") {
    await skimRef.current;
    const list = Array.from(settledRef.current.entries())
      .filter(([pg]) => {
        const k = kindsRef.current[pg]?.kind ?? null;
        return want === "all" || k === null || want.has(k);
      })
      .map(([, p]) => p);
    await Promise.all(list);
  }

  const readSheets = () => Object.values(readsRef.current).filter((r) => r.status === "ok" && r.sheet).map((r) => r.sheet!);

  const readDone = Object.values(reads).filter((r) => r.status === "ok" || r.status === "fail").length;
  // A lost response must not strand the estimate on its first step. Keep the
  // existing read queue and files so returning to the question does not rebill them.
  // Time with the tab in the back does not count: the clock stops while it is hidden
  // and starts its three minutes again when the tab is in front.
  useEffect(() => {
    if (stage !== "work" || step !== 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      if (document.visibilityState === "hidden") return;
      timer = setTimeout(() => {
        askRun.current++;
        setErr("No new sheet has finished reading for three minutes. Your plans are still open. Let the reading finish and try the estimate again, or open the plans again if it stays stalled.");
        setStage("ask");
      }, 180_000);
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", arm);
    };
  }, [stage, step, readDone]);
  const ready = stage !== "upload" && (baseReady || (readTotal > 0 && readDone >= readTotal));
  const sheetsRead = useMemo(() => Object.values(reads).filter((r) => r.status === "ok" && r.sheet).map((r) => r.sheet!), [reads]);
  const planName = useMemo(() => sheetsRead.map((x) => x.project.name).find(Boolean) ?? null, [sheetsRead]);
  const planAddress = useMemo(() => sheetsRead.map((x) => x.project.address).find(Boolean) ?? null, [sheetsRead]);
  const loc = (locEdit ?? planAddress ?? "").trim();

  // ── 2 · the ask → 3 · the work ─────────────────────────────────────────
  /** Every sheet as the planner sees it: the ones read, and the rest as the first look found them. */
  function liteOf(sheets: SheetRead[]): SheetLite[] {
    const readPages = new Set(sheets.map((x) => x.page));
    return [
      ...sheets.map((x) => ({ ...sheetLite(x), contents: kindsRef.current[x.page]?.contents ?? [] })),
      // Sheets not read yet (or never: details) — what the first look found them to be.
      ...pagesRef.current
        .filter((p) => !readPages.has(p.page))
        .map((p) => {
          const k = kindsRef.current[p.page];
          return { page: p.page, kind: k?.kind ?? guessKind(p), title: k?.title ?? (p.titleText.split("\n")[0]?.slice(0, 120) || null), level: k?.level ?? null, rooms: [], contents: k?.contents ?? [] };
        }),
    ].sort((a, b) => a.page - b.page);
  }

  /** The sheets that show what the job needs measured, looked at again for exactly those things. */
  async function measureScope(tok: string, req: string, scope: JobScope, lite: SheetLite[]): Promise<FocusRead[]> {
    const asks = new Map<number, Array<{ n: number; label: string; unit: string; how: string }>>();
    scope.measure.forEach((m, k) => m.pages.forEach((pg) => asks.set(pg, [...(asks.get(pg) ?? []), { n: k + 1, label: m.label, unit: m.unit, how: m.how }])));
    // …and the sheets whose notes specify the job, read for what they specify.
    for (const pg of scope.specPages) if (!asks.has(pg)) asks.set(pg, []);
    const focus: FocusRead[] = [];
    await pool(Array.from(asks.entries()), MEASURE_AT_ONCE, async ([pg, list]) => {
      const p = pagesRef.current.find((x) => x.page === pg);
      if (!p) return;
      try {
        const { overview, tiles, grid } = await p.render();
        const images = fitImages(overview, tiles);
        const res = await measurePlanSheet({
          token: tok,
          page: pg,
          pages: pagesRef.current.length,
          request: req,
          title: scope.title,
          sheetTitle: lite.find((x) => x.page === pg)?.title ?? null,
          asks: list,
          textLayer: formatTextLayer(p.textItems),
          images: images.map((url) => ({ url })),
          grid: grid && images.length === tiles.length + 1 ? grid : null,
        });
        if (res.ok) focus.push(res.read);
      } catch {
        // a sheet that could not be measured keeps the build list's number
      }
    });
    return focus;
  }

  async function runAsk(asked?: string) {
    const req = (asked ?? request).trim();
    if (req.length < 2) {
      setErr("Say what you want estimated from these plans.");
      return;
    }
    if (asked) setRequest(asked);
    setErr("");
    setStage("work");
    setWorkSteps(WORK_STEPS);
    setStep(0);
    setPricing({ done: 0, total: 0, now: [] });
    setWorking({});
    const began = nowMs();
    const timing: Array<[string, number]> = [];
    let lapAt = began;
    const lap = (label: string) => {
      const now = nowMs();
      timing.push([label, now - lapAt]);
      lapAt = now;
    };
    const run = ++askRun.current;
    const alive = () => run === askRun.current;
    try {
      // 1. the plans: the sheets every job rests on, and the kinds this job's words point to —
      // not the whole set (a countertop job does not wait for the structural sheets)
      const tok = tokenRef.current ?? (await ensureToken());
      if (!alive()) return;
      if (!tok) throw new Error("The plans could not be opened for reading.");
      await waitFor(new Set(BASE_KINDS));
      let sheets = readSheets();
      let base = computeTakeoff(sheets);
      const liteNow = () => sheets.map(sheetLite);
      const guess = base.house.levels.length ? scopeByRules(req, base.items, liteNow()) : null;
      if (!base.house.levels.length || guess?.wholeHouse) await waitFor("all");
      else if (guess) await waitFor(kindsFor(new Set(base.items.filter((i) => guess.itemIds.includes(i.id)).map((i) => i.trade))));
      if (!alive()) return;
      sheets = readSheets();
      base = computeTakeoff(sheets);
      if (!base.house.levels.length) {
        const failedRead = Object.values(readsRef.current).find((r) => r.status === "fail" && r.error);
        throw new Error(failedRead?.error ?? "No floor plan could be read from these sheets. Add the floor plans and ask again.");
      }
      lap("Reading the plans");
      const house = houseBriefOf(base.house);
      const lite = liteOf(sheets);

      // 2. the job
      setStep(1);
      const job = await askPlan({ token: tok, request: req, house, sheets: lite, items: base.items });
      if (!alive()) return;
      if (!job.ok) throw new Error(failText(job));
      const scope = job.scope;
      setWorking({ title: scope.title, measuring: scope.measure.map((m) => m.label), notes: scope.specPages });
      lap("Working out the job");

      // 3. measured on the sheets that show it
      setStep(2);
      const focus = await measureScope(tok, req, scope, lite);
      if (!alive()) return;
      lap("Measuring on the sheets");
      // Every kind of sheet the job's lines rest on, read before they are priced — usually
      // done by now; the build list is made again from them, with the measurements in it.
      const found = applyFocus(scope, focus, base.items);
      const jobTrades = new Set<PlanTrade>([...base.items.filter((i) => scope.itemIds.includes(i.id)).map((i) => i.trade), ...scope.measure.map((m) => m.trade)]);
      await waitFor(scope.wholeHouse ? "all" : kindsFor(jobTrades));
      if (!alive()) return;
      sheets = readSheets();
      let takeoff = computeTakeoff(sheets, {}, {}, found.measured);
      const houseNow = houseBriefOf(takeoff.house);
      if (nowMs() - lapAt > 1500) lap("Finishing the plans");
      const pick = (t: Takeoff) => withFinish(scope.wholeHouse ? t.items : jobItems(scope, t.items, [...job.extra, ...found.added]), req);
      let items = pick(takeoff);
      // HEATING & COOLING FROM A LOAD (owner, 2026-10-18: "estimate HVAC Manual J based"): when the job prices HVAC,
      // the plans' windows, insulation, floors and the job's climate go through the HVAC engine's Manual J-style load
      // and Manual S size, and the build list is made again on it. A failed load keeps the build list's rule size.
      if (items.some((i) => i.trade === "hvac")) {
        const ran = await planHvacLoadAction({ token: tok, location: loc || null, envelope: planEnvelopeOf(takeoff.house, sheets) }).catch(() => null);
        if (!alive()) return;
        if (ran?.ok) {
          takeoff = computeTakeoff(sheets, {}, {}, found.measured, { hvac: ran.load });
          items = pick(takeoff);
        }
        lap("Heating & cooling load");
      }
      if (!items.length) throw new Error("Nothing on these plans matches that job. Try naming the trade or the finish.");

      // 4. priced, trade by trade
      setStep(3);
      const trades = PLAN_TRADES.filter((t) => items.some((i) => i.trade === t));
      const partial = partialTrades(scope, takeoff.items);
      const results: TradeResult[] = [];
      const failed: Result["failed"] = [];
      setPricing({ done: 0, total: trades.length, now: [] });
      await pool(trades, PRICE_AT_ONCE, async (trade) => {
        if (alive()) setPricing((p) => ({ ...p, now: [...p.now, trade] }));
        // A trade still out after the limit is stopped (the request is aborted) and joins "Try again".
        const stop = new AbortController();
        const timer = setTimeout(() => stop.abort(), PRICE_TRADE_LIMIT_MS);
        const out = await priceTrade({ tok, trade, house: houseNow, items, trades, scope, req, partial: partial.has(trade), location: loc, specs: found.specs, signal: stop.signal });
        clearTimeout(timer);
        if (out.ok) results.push({ trade, est: out.est });
        else failed.push({ trade, error: out.error });
        if (alive()) setPricing((p) => ({ ...p, done: p.done + 1, now: p.now.filter((x) => x !== trade) }));
      });
      if (!alive()) return;
      if (!results.length) throw new Error(failed[0]?.error ?? "The job could not be priced.");
      const checks = scope.wholeHouse ? await getPlanPriceChecks({ house: houseNow, items: takeoff.items, location: loc || null }).catch(() => null) : null;
      const merged = mergeJob({ house: houseNow, results, takeoff, scope, rows: found.rows, specs: found.specs, priceChecks: checks && checks.ok ? checks.data : null });
      lap("Pricing");
      setResult({ request: req, scope, rows: found.rows, specs: found.specs, items, takeoff, house: houseNow, results, failed, merged, location: loc, timing });
      setLines(merged.lines);
      setStage("result");
    } catch (e) {
      if (!alive()) return;
      setErr(clientErrorText(e, "Something went wrong."));
      setStage("ask");
    }
  }

  /**
   * THE SIZES AND MEASUREMENTS ALONE (owner, 2026-10-21: "extract the sizes of anything in the plan — room sizes by
   * name, sq ft, anything — so I need an estimate or the sizes and measurements"). Every sheet read, then the report
   * (lib/plans/measureReport) — nothing priced. A typed request ("the master closet", "baseboard in linear feet") is
   * planned and measured on the sheets that show it, the way a job's measures are; a chip (`focus`) only opens the
   * report on that part of the house. `asked` null: the chip, not the box.
   */
  async function runMeasure(asked: string | null, focus: SectionKey | null = null) {
    const req = (asked ?? "").trim();
    setErr("");
    setStage("work");
    setWorkSteps(MEASURE_STEPS);
    setStep(0);
    setPricing({ done: 0, total: 0, now: [] });
    setWorking({ title: req ? `Measuring · ${req}` : "Sizes & measurements" });
    const run = ++askRun.current;
    const alive = () => run === askRun.current;
    try {
      const tok = tokenRef.current ?? (await ensureToken());
      if (!alive()) return;
      if (!tok) throw new Error("The plans could not be opened for reading.");
      // The whole set: the sizes are every sheet's.
      await waitFor("all");
      if (!alive()) return;
      const sheets = readSheets();
      if (!sheets.length) {
        const failedRead = Object.values(readsRef.current).find((r) => r.status === "fail" && r.error);
        throw new Error(failedRead?.error ?? "No sheet could be read from these plans.");
      }
      let takeoff = computeTakeoff(sheets);
      let measured: { request: string; rows: FoundRow[] } | null = null;
      if (req && takeoff.house.levels.length) {
        setStep(1);
        const lite = liteOf(sheets);
        const job = await askPlan({ token: tok, request: `Measure from the plans (sizes only, nothing priced): ${req}`, house: houseBriefOf(takeoff.house), sheets: lite, items: takeoff.items });
        if (!alive()) return;
        if (!job.ok) throw new Error(failText(job));
        setWorking({ title: `Measuring · ${req}`, measuring: job.scope.measure.map((m) => m.label), notes: job.scope.specPages });
        setStep(2);
        const reads = await measureScope(tok, req, job.scope, lite);
        if (!alive()) return;
        const found = applyFocus(job.scope, reads, takeoff.items);
        takeoff = computeTakeoff(sheets, {}, {}, found.measured);
        measured = { request: req, rows: found.rows };
      }
      setStep(3);
      setSizes({ report: measureReport(takeoff, sheets, measured), request: req, focus });
      setStage("sizes");
    } catch (e) {
      if (!alive()) return;
      setErr(clientErrorText(e, "Something went wrong."));
      setStage("ask");
    }
  }

  async function priceTrade(a: { tok: string; trade: PlanTrade; house: HouseBrief; items: TakeoffItem[]; trades: PlanTrade[]; scope: JobScope; req: string; partial: boolean; location: string; specs: JobSpec[]; signal?: AbortSignal }) {
    try {
      const res = await postTradePrice({
        token: a.tok,
        trade: a.trade,
        location: a.location || null,
        house: a.house,
        items: a.items.filter((i) => i.trade === a.trade),
        alsoPriced: a.trades,
        ask: a.scope.wholeHouse ? null : { request: a.req, title: a.scope.title, partial: a.partial, specialtyId: a.scope.specialties[a.trade] ?? null, label: a.scope.labels?.[a.trade] ?? null, specs: a.specs.map((x) => `${x.text} (p. ${x.page})`) },
      }, a.signal);
      if (res.ok) return { ok: true as const, est: res.data };
      return { ok: false as const, error: res.code === "PLAN_LIMIT_REACHED" ? failText(res as Failure) : res.error };
    } catch (e) {
      if (a.signal?.aborted) return { ok: false as const, error: `${TRADE_LABEL[a.trade]} took too long to price. Try it again.` };
      return { ok: false as const, error: clientErrorText(e, `${TRADE_LABEL[a.trade]} could not be priced.`) };
    }
  }

  function mergeJob(a: { house: HouseBrief; results: TradeResult[]; takeoff: Takeoff; scope: JobScope; rows: FoundRow[]; specs: JobSpec[]; priceChecks: Parameters<typeof mergePlanEstimate>[0]["priceChecks"] }) {
    return mergePlanEstimate({
      house: a.house,
      results: a.results,
      checks: a.takeoff.checks,
      priceChecks: a.priceChecks,
      wholeHouse: a.scope.wholeHouse,
      labels: a.scope.labels,
      job: a.scope.wholeHouse
        ? null
        : { title: a.scope.title, notIncluded: a.scope.notIncluded, unmeasured: a.rows.filter((r) => r.status !== "measured").map((r) => `${r.label} — ${r.asWritten}`), specs: a.specs.map((x) => `${x.text} (p. ${x.page})`) },
    });
  }

  async function retryTrade(trade: PlanTrade) {
    if (!result || !tokenRef.current) return;
    setRetrying(trade);
    const trades = PLAN_TRADES.filter((t) => result.items.some((i) => i.trade === t));
    const out = await priceTrade({ tok: tokenRef.current, trade, house: result.house, items: result.items, trades, scope: result.scope, req: result.request, partial: partialTrades(result.scope, result.takeoff.items).has(trade), location: result.location, specs: result.specs });
    setRetrying(null);
    if (!out.ok) {
      toast.error(`${TRADE_LABEL[trade]} could not be priced`, out.error);
      return;
    }
    const results = [...result.results, { trade, est: out.est }];
    const merged = mergeJob({ house: result.house, results, takeoff: result.takeoff, scope: result.scope, rows: result.rows, specs: result.specs, priceChecks: null });
    setResult({ ...result, results, failed: result.failed.filter((f) => f.trade !== trade), merged });
    // The new trade's lines join the ones already edited.
    setLines((now) => [...now, ...merged.lines.filter((l) => !now.some((x) => x.id === l.id))]);
  }

  // ── 4 · the result → the proposal ──────────────────────────────────────
  const billed = lines.filter(isBilled);
  const total = billed.reduce((a, l) => a + lineTotal(l), 0);
  const setQty = (id: string, raw: string) => {
    const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n) || n < 0) return;
    setLines((rows) => rows.map((l) => (l.id === id ? { ...l, qty: n } : l)));
  };
  const removeLine = (id: string) => setLines((rows) => rows.filter((l) => l.id !== id));
  const acceptLine = (id: string) => setLines((rows) => rows.map((l) => (l.id === id ? { ...l, flag: undefined, flagNote: undefined } : l)));

  async function createProposal() {
    if (!result || !billed.length) return;
    setSaving("saving");
    try {
      if (!(await ensureWithinLimit("proposalsCreated"))) {
        setSaving(null);
        return;
      }
      const m = result.merged;
      const data = estimateFromLines(billed, { title: m.title, scope: m.scope, assumptions: m.assumptions, estimatedTimelineDays: m.timelineDays ?? undefined, discount: null });
      const site = planAddress || result.location || null;
      await saveEstimate({ projectType: result.scope.title, location: site, data });
      const res = await convertEstimateToProposal({
        projectType: result.scope.title,
        source: "blueprint",
        title: data.title,
        scope: data.scope,
        materials: data.materials,
        labor: data.labor,
        assumptions: data.assumptions,
        location: site ?? undefined,
        discount: data.discount ?? undefined,
      });
      toast.success("Proposal created", "Opening it now.");
      // Navigation from here: the button stays in its "opening" state.
      setSaving("opening");
      router.push(`/dashboard/manual-blueprint?proposal=${res.id}` as never);
    } catch (e) {
      setSaving(null);
      if (reportPlanLimit(e)) return;
      toast.error("Couldn't save", clientErrorText(e, "Couldn't create the proposal."));
    }
  }

  function editInSmartProposal() {
    if (!result) return;
    handPlanEstimate({ ...result.merged, lines, location: result.location, address: planAddress, wholeHouse: result.scope.wholeHouse });
    router.push(smartProposalHref as never);
  }

  async function openViewer(page: number) {
    setViewer({ page, url: null });
    const p = pagesRef.current.find((x) => x.page === page);
    if (!p) return;
    try {
      const { overview } = await p.render();
      setViewer((v) => (v && v.page === page ? { page, url: overview } : v));
    } catch {
      setViewer((v) => (v && v.page === page ? { page, url: p.thumb } : v));
    }
  }

  function startOver() {
    setRun.current++;
    askRun.current++;
    pagesRef.current = [];
    readsRef.current = {};
    tokenRef.current = null;
    tokenPendingRef.current = null;
    readingRef.current = null;
    setPages([]);
    setReads({});
    setReadTotal(0);
    setResult(null);
    setSizes(null);
    setLines([]);
    setRequest("");
    setErr("");
    setStage("upload");
  }

  function kindOf(page: number): string {
    const r = reads[page]?.sheet;
    if (r) return r.title || KIND_WORD[r.kind] || "Sheet";
    const k = kinds[page];
    if (k) return k.title || KIND_WORD[k.kind] || "Sheet";
    const p = pages.find((x) => x.page === page);
    return (p && KIND_WORD[guessKind(p)]) || "Drawing";
  }

  /** Leave the working screen: a late answer from this ask is dropped. */
  function cancelWork() {
    askRun.current++;
    setStage("ask");
  }

  return {
    stage, setStage, opening, pages, skipped, reads, readTotal, readDone, ready, request, setRequest, locEdit, setLocEdit,
    step, pricing, working, result, lines, saving, retrying, viewer, setViewer, err, setErr, planName, planAddress, loc,
    billed, total, setQty, removeLine, acceptLine, openFiles, runAsk, retryTrade, createProposal, editInSmartProposal,
    openViewer, startOver, cancelWork, kindOf,
    mode, setMode, sizes, runMeasure, workSteps,
  };
}
