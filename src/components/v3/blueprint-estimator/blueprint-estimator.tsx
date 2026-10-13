"use client";
// BLUEPRINT ESTIMATOR — upload the plans, ask for the job, get it measured and priced.
// Route: /dashboard/blueprint-estimator (owner, 2026-10-13: "upload it and don't wait…
// then you type in or use the voice what you want from this blueprint… and only after
// the request look into the pages, find it, and put it in an estimate").
//
//   1 · Upload   the plan set opens in the browser (pdf.js) and goes straight to the
//                question; every sheet is read in the background meanwhile (lib/plans/sheet
//                → takeoff → build list), with no page-by-page show
//   2 · Ask      typed or spoken: "granite countertops", "drywall with texture and primer"
//   3 · Work     the request made into a job (askPlan), the sheets that show it looked at
//                again for exactly those things (measurePlanSheet), the job's trades priced
//                (pricePlanTrade) — one calm progress, four steps
//   4 · Result   what was found on the plans, page by page, beside the priced lines;
//                Create proposal, or Edit in Smart Proposal (lib/plans/handoff)
//
// A tool of its own in the sidebar, apart from Smart Proposal (owner, 2026-10-13).
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import s from "./blueprint-estimator.module.css";
import { clientErrorText } from "@/lib/staleDeploy";
import { askPlan, getPlanPriceChecks, measurePlanSheet, readPlanSheet, startPlanSession } from "@/actions/planEstimator";
import { convertEstimateToProposal, pricePlanTrade, saveEstimate } from "@/actions/advancedEstimator";
import { MAX_PLAN_PAGES, openPlanFiles, type PlanPage } from "@/lib/plans/pdfClient";
import { formatTextLayer, pageWorthReading } from "@/lib/plans/readPrompt";
import { SHEET_KINDS, type SheetRead } from "@/lib/plans/sheet";
import { computeTakeoff, PLAN_TRADES, TRADE_LABEL, type PlanTrade, type Takeoff, type TakeoffItem } from "@/lib/plans/takeoff";
import { houseBriefOf, type HouseBrief } from "@/lib/plans/tradeBrief";
import { mergePlanEstimate, type PlanEstimate, type TradeResult } from "@/lib/plans/merge";
import { applyFocus, jobItems, partialTrades, sheetLite, withFinish, type FocusRead, type FoundRow, type JobScope, type SheetLite } from "@/lib/plans/ask";
import { MAX_SHEET_IMAGE_CHARS } from "@/lib/plans/wire";
import { buildListCsv, downloadText, SOURCE_LABEL } from "@/lib/plans/csv";
import { handPlanEstimate } from "@/lib/plans/handoff";
import { estimateFromLines, isBilled, lineTotal, type ConsoleLine } from "@/lib/estimate/console-model";
import { DictateButton } from "@/components/estimator/DictateButton";
import { toast } from "@/components/ui/Toast";
import { ensureWithinLimit, reportPlanLimit, reportPlanLimitResult } from "@/stores/usePlanLimitStore";

type Stage = "upload" | "ask" | "work" | "result";
type ReadState = { status: "run" | "ok" | "fail"; sheet?: SheetRead };
type Failure = { ok: false; error: string; code?: string; resource?: string };

type Result = {
  request: string;
  scope: JobScope;
  rows: FoundRow[];
  /** The job's lines, as priced (measurements in them). */
  items: TakeoffItem[];
  takeoff: Takeoff;
  house: HouseBrief;
  results: TradeResult[];
  failed: Array<{ trade: PlanTrade; error: string }>;
  merged: PlanEstimate;
  location: string;
};

/** Sheets read at once, sheets measured at once, trades priced at once. */
const READ_AT_ONCE = 3;
const MEASURE_AT_ONCE = 3;
const PRICE_AT_ONCE = 3;

/** One tap fills the question. */
const ASKS: Array<{ label: string; ask: string }> = [
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

const KIND_WORD: Partial<Record<SheetRead["kind"], string>> = {
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

const UNIT_SHORT: Record<TakeoffItem["unit"], string> = {
  "sq ft": "SF", "linear ft": "LF", each: "EA", "cu yards": "CY", squares: "SQ", sheets: "SHT", tons: "TON", boxes: "BOX", bundles: "BDL",
  rolls: "ROLL", gallons: "GAL", bags: "BAG", pieces: "PC", "sq yd": "SY", sets: "SET", buckets: "BKT", tubes: "TUBE", lot: "LOT",
};

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const qtyText = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : (Math.round(n * 10) / 10).toLocaleString("en-US"));

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, lane));
}

/** The whole sheet always; close-ups while the request stays under Vercel's size. */
function fitImages(overview: string, tiles: string[]): string[] {
  const out = [overview];
  let total = overview.length;
  for (const t of tiles) {
    if (total + t.length > MAX_SHEET_IMAGE_CHARS - 40_000) break;
    out.push(t);
    total += t.length;
  }
  return out;
}

/** A sheet not read (a details sheet): what its title block calls it. */
function guessKind(p: PlanPage): SheetRead["kind"] {
  const g = pageWorthReading(p.text, p.titleText).guess;
  return (SHEET_KINDS as readonly string[]).includes(g) ? (g as SheetRead["kind"]) : "other";
}

export function BlueprintEstimator() {
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
  const [working, setWorking] = useState<{ title?: string; measuring?: string[] }>({});
  const [result, setResult] = useState<Result | null>(null);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [saving, setSaving] = useState<null | "saving" | "opening">(null);
  const [retrying, setRetrying] = useState<PlanTrade | null>(null);
  const [viewer, setViewer] = useState<{ page: number; url: string | null } | null>(null);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const pagesRef = useRef<PlanPage[]>([]);
  const readsRef = useRef<Record<number, ReadState>>({});
  const tokenRef = useRef<string | null>(null);
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
      tokenRef.current = null;
      setPages(kept);
      setReads({});
      setResult(null);
      setSkipped([...why, ...(opened.length > MAX_PLAN_PAGES ? [`Only the first ${MAX_PLAN_PAGES} pages are kept.`] : [])]);
      setStage("ask");
      readingRef.current = readAll(kept, run);
    } catch (e) {
      setErr(clientErrorText(e, "The files could not be opened."));
    } finally {
      setOpening(null);
    }
  }

  async function ensureToken(): Promise<string | null> {
    if (tokenRef.current) return tokenRef.current;
    const res = await startPlanSession();
    if (!res.ok) {
      setErr(failText(res));
      return null;
    }
    tokenRef.current = res.token;
    return res.token;
  }

  async function readOne(p: PlanPage, tok: string, total: number, run: number) {
    const mark = (state: ReadState) => {
      if (run !== setRun.current) return;
      readsRef.current = { ...readsRef.current, [p.page]: state };
      setReads(readsRef.current);
    };
    mark({ status: "run" });
    // One quiet second try — the contractor never sees a sheet's hiccup.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { overview, tiles, grid } = await p.render();
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
        if (res.ok) return mark({ status: "ok", sheet: res.sheet });
      } catch {
        // tried again below
      }
    }
    mark({ status: "fail" });
  }

  async function readAll(list: PlanPage[], run: number) {
    const tok = await ensureToken();
    if (!tok || run !== setRun.current) return;
    const todo = list.filter((p) => pageWorthReading(p.text, p.titleText).read);
    setReadTotal(todo.length);
    await pool(todo, READ_AT_ONCE, (p) => readOne(p, tok, list.length, run));
  }

  const readDone = Object.values(reads).filter((r) => r.status === "ok" || r.status === "fail").length;
  const ready = stage !== "upload" && readTotal > 0 && readDone >= readTotal;
  const sheetsRead = useMemo(() => Object.values(reads).filter((r) => r.status === "ok" && r.sheet).map((r) => r.sheet!), [reads]);
  const planName = useMemo(() => sheetsRead.map((x) => x.project.name).find(Boolean) ?? null, [sheetsRead]);
  const planAddress = useMemo(() => sheetsRead.map((x) => x.project.address).find(Boolean) ?? null, [sheetsRead]);
  const loc = (locEdit ?? planAddress ?? "").trim();

  // ── 2 · the ask → 3 · the work ─────────────────────────────────────────
  async function runAsk(asked?: string) {
    const req = (asked ?? request).trim();
    if (req.length < 2) {
      setErr("Say what you want estimated from these plans.");
      return;
    }
    if (asked) setRequest(asked);
    setErr("");
    setStage("work");
    setStep(0);
    setWorking({});
    const run = ++askRun.current;
    const alive = () => run === askRun.current;
    try {
      // 1. the plans, read in the background since they were opened
      await readingRef.current;
      const tok = tokenRef.current ?? (await ensureToken());
      if (!alive()) return;
      if (!tok) throw new Error("The plans could not be opened for reading.");
      const sheets = Object.values(readsRef.current).filter((r) => r.status === "ok" && r.sheet).map((r) => r.sheet!);
      const base = computeTakeoff(sheets);
      if (!base.house.levels.length) throw new Error("No floor plan could be read from these sheets. Add the floor plans and ask again.");
      const house = houseBriefOf(base.house);
      const readPages = new Set(sheets.map((x) => x.page));
      const lite: SheetLite[] = [
        ...sheets.map(sheetLite),
        ...pagesRef.current.filter((p) => !readPages.has(p.page)).map((p) => ({ page: p.page, kind: guessKind(p), title: p.titleText.split("\n")[0]?.slice(0, 120) || null, level: null, rooms: [] })),
      ].sort((a, b) => a.page - b.page);

      // 2. the job
      setStep(1);
      const job = await askPlan({ token: tok, request: req, house, sheets: lite, items: base.items });
      if (!alive()) return;
      if (!job.ok) throw new Error(failText(job));
      const scope = job.scope;
      setWorking({ title: scope.title, measuring: scope.measure.map((m) => m.label) });

      // 3. measured on the sheets that show it
      setStep(2);
      const asks = new Map<number, Array<{ n: number; label: string; unit: string; how: string }>>();
      scope.measure.forEach((m, k) => m.pages.forEach((pg) => asks.set(pg, [...(asks.get(pg) ?? []), { n: k + 1, label: m.label, unit: m.unit, how: m.how }])));
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
      if (!alive()) return;
      const found = applyFocus(scope, focus, base.items);
      const takeoff = Object.keys(found.measured).length ? computeTakeoff(sheets, {}, {}, found.measured) : base;
      const items = withFinish(scope.wholeHouse ? takeoff.items : jobItems(scope, takeoff.items, [...job.extra, ...found.added]), req);
      if (!items.length) throw new Error("Nothing on these plans matches that job. Try naming the trade or the finish.");

      // 4. priced, trade by trade
      setStep(3);
      const trades = PLAN_TRADES.filter((t) => items.some((i) => i.trade === t));
      const partial = partialTrades(scope, takeoff.items);
      const results: TradeResult[] = [];
      const failed: Result["failed"] = [];
      await pool(trades, PRICE_AT_ONCE, async (trade) => {
        const out = await priceTrade({ tok, trade, house, items, trades, scope, req, partial: partial.has(trade), location: loc });
        if (out.ok) results.push({ trade, est: out.est });
        else failed.push({ trade, error: out.error });
      });
      if (!alive()) return;
      if (!results.length) throw new Error(failed[0]?.error ?? "The job could not be priced.");
      const checks = scope.wholeHouse ? await getPlanPriceChecks({ house, items: takeoff.items, location: loc || null }).catch(() => null) : null;
      const merged = mergeJob({ house, results, takeoff, scope, rows: found.rows, priceChecks: checks && checks.ok ? checks.data : null });
      setResult({ request: req, scope, rows: found.rows, items, takeoff, house, results, failed, merged, location: loc });
      setLines(merged.lines);
      setStage("result");
    } catch (e) {
      if (!alive()) return;
      setErr(clientErrorText(e, "Something went wrong."));
      setStage("ask");
    }
  }

  async function priceTrade(a: { tok: string; trade: PlanTrade; house: HouseBrief; items: TakeoffItem[]; trades: PlanTrade[]; scope: JobScope; req: string; partial: boolean; location: string }) {
    try {
      const res = await pricePlanTrade({
        token: a.tok,
        trade: a.trade,
        location: a.location || null,
        house: a.house,
        items: a.items.filter((i) => i.trade === a.trade),
        alsoPriced: a.trades,
        ask: a.scope.wholeHouse ? null : { request: a.req, title: a.scope.title, partial: a.partial, specialtyId: a.scope.specialties[a.trade] ?? null, label: a.scope.labels?.[a.trade] ?? null },
      });
      if (res.ok) return { ok: true as const, est: res.data };
      return { ok: false as const, error: res.code === "PLAN_LIMIT_REACHED" ? failText(res as Failure) : res.error };
    } catch (e) {
      return { ok: false as const, error: clientErrorText(e, `${TRADE_LABEL[a.trade]} could not be priced.`) };
    }
  }

  function mergeJob(a: { house: HouseBrief; results: TradeResult[]; takeoff: Takeoff; scope: JobScope; rows: FoundRow[]; priceChecks: Parameters<typeof mergePlanEstimate>[0]["priceChecks"] }) {
    return mergePlanEstimate({
      house: a.house,
      results: a.results,
      checks: a.takeoff.checks,
      priceChecks: a.priceChecks,
      wholeHouse: a.scope.wholeHouse,
      labels: a.scope.labels,
      job: a.scope.wholeHouse ? null : { title: a.scope.title, notIncluded: a.scope.notIncluded, unmeasured: a.rows.filter((r) => r.status !== "measured").map((r) => `${r.label} — ${r.asWritten}`) },
    });
  }

  async function retryTrade(trade: PlanTrade) {
    if (!result || !tokenRef.current) return;
    setRetrying(trade);
    const trades = PLAN_TRADES.filter((t) => result.items.some((i) => i.trade === t));
    const out = await priceTrade({ tok: tokenRef.current, trade, house: result.house, items: result.items, trades, scope: result.scope, req: result.request, partial: partialTrades(result.scope, result.takeoff.items).has(trade), location: result.location });
    setRetrying(null);
    if (!out.ok) {
      toast.error(`${TRADE_LABEL[trade]} could not be priced`, out.error);
      return;
    }
    const results = [...result.results, { trade, est: out.est }];
    const merged = mergeJob({ house: result.house, results, takeoff: result.takeoff, scope: result.scope, rows: result.rows, priceChecks: null });
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
    router.push("/dashboard/advanced-ai" as never);
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
    readingRef.current = null;
    setPages([]);
    setReads({});
    setReadTotal(0);
    setResult(null);
    setLines([]);
    setRequest("");
    setErr("");
    setStage("upload");
  }

  // ══════════════ RENDER ══════════════
  const chooser = (
    <input
      ref={fileInput}
      type="file"
      accept="application/pdf,.pdf,image/*"
      multiple
      hidden
      onChange={(e) => {
        const list = Array.from(e.target.files ?? []);
        e.target.value = "";
        void openFiles(list);
      }}
    />
  );

  const head = (title: string, sub?: string | null) => (
    <div className={s.head}>
      <div className={s.kicker}>Blueprint estimator</div>
      <h1 className={s.title}>{title}</h1>
      {sub ? <p className={s.sub}>{sub}</p> : null}
    </div>
  );

  const viewerEl = viewer && (
    <div className={s.viewer} role="dialog" aria-modal="true" aria-label={`Sheet ${viewer.page}`} onClick={() => setViewer(null)}>
      <div className={s.viewerSheet} onClick={(e) => e.stopPropagation()}>
        <div className={s.viewerBar}>
          <span>
            Sheet {viewer.page} · {kindOf(viewer.page)}
          </span>
          <button type="button" className={s.btnGhost} onClick={() => setViewer(null)}>
            Close
          </button>
        </div>
        {viewer.url ? (
          // eslint-disable-next-line @next/next/no-img-element -- a page drawn in the browser, a data URL
          <img className={s.viewerImg} src={viewer.url} alt={`Sheet ${viewer.page}`} />
        ) : (
          <div className={s.viewerWait}>Opening the sheet…</div>
        )}
      </div>
    </div>
  );

  function kindOf(page: number): string {
    const r = reads[page]?.sheet;
    if (r) return r.title || KIND_WORD[r.kind] || "Sheet";
    const p = pages.find((x) => x.page === page);
    return (p && KIND_WORD[guessKind(p)]) || "Drawing";
  }

  // 1 · upload
  if (stage === "upload") {
    return (
      <div className={s.be}>
        {chooser}
        {head("Blueprint estimator", "Upload the plans. Ask for the job. Get it measured and priced.")}
        <section
          className={`${s.card} ${s.drop} ${drag ? s.dropOn : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void openFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <svg className={s.dropIcon} aria-hidden="true">
            <use href="#i-plans" />
          </svg>
          <h2 className={s.h2}>{opening != null ? `Opening the plans · ${opening} page${opening === 1 ? "" : "s"}` : "Drop the plan set here"}</h2>
          <p className={s.p}>A PDF of the plans, or photos of the sheets — up to {MAX_PLAN_PAGES} pages.</p>
          <button type="button" className={s.btnPrimary} disabled={opening != null} onClick={() => fileInput.current?.click()}>
            {opening != null ? "Opening…" : "Choose the plans"}
          </button>
          {err && <div className={s.err}>{err}</div>}
        </section>
        <ol className={s.how}>
          <li>
            <span className={s.howN}>1</span>
            <b>Upload the plans</b>
            <span>They open in seconds — no waiting on the reading.</span>
          </li>
          <li>
            <span className={s.howN}>2</span>
            <b>Ask for the job</b>
            <span>Type it or say it: &ldquo;granite countertops&rdquo;, &ldquo;drywall with texture and paint&rdquo;.</span>
          </li>
          <li>
            <span className={s.howN}>3</span>
            <b>Get it measured and priced</b>
            <span>Every number from the sheets, with its page — then one tap to a proposal.</span>
          </li>
        </ol>
      </div>
    );
  }

  // 3 · working
  if (stage === "work") {
    const STEPS = ["Reading your plans", "Working out the job", "Measuring it on the sheets", "Pricing"];
    const pct = Math.round(((step + (step === 0 && readTotal ? readDone / readTotal : 0.5)) / STEPS.length) * 100);
    return (
      <div className={s.be}>
        {head(working.title ?? "Working on it", `“${request.trim()}”`)}
        <section className={`${s.card} ${s.work}`} aria-live="polite">
          <ol className={s.steps}>
            {STEPS.map((label, i) => (
              <li key={label} className={i < step ? s.stepDone : i === step ? s.stepNow : undefined}>
                <span className={s.stepMark} aria-hidden="true" />
                <span className={s.stepLabel}>
                  {label}
                  {i === 0 && i === step && readTotal ? <span className={s.stepNote}> · {Math.round((readDone / readTotal) * 100)}%</span> : null}
                  {i === 2 && working.measuring?.length ? <span className={s.stepNote}> · {working.measuring.slice(0, 4).join(", ").toLowerCase()}</span> : null}
                </span>
              </li>
            ))}
          </ol>
          <div className={s.meter} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <button
            type="button"
            className={s.btnGhost}
            onClick={() => {
              askRun.current++;
              setStage("ask");
            }}
          >
            Cancel
          </button>
        </section>
      </div>
    );
  }

  // 2 · ask
  if (stage === "ask") {
    const fileName = pages[0]?.fileName ?? "Plans";
    return (
      <div className={s.be}>
        {chooser}
        {viewerEl}
        {head(planName || "What do you want from these plans?", planAddress)}
        <div className={s.askGrid}>
          <section className={`${s.card} ${s.ask}`}>
            <h2 className={s.h2}>What do you want estimated?</h2>
            <p className={s.p}>Say the job the way you would to your estimator — the plans are measured for it, then priced.</p>
            <textarea
              className={s.area}
              aria-label="What do you want estimated from these plans?"
              placeholder="e.g. Granite countertops for the kitchen, the island and the bathroom vanities"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void runAsk();
              }}
            />
            <DictateButton
              id="blueprintAskDictate"
              label="Speak the job"
              value={request}
              onChange={setRequest}
              wrapClassName={s.dictate}
              buttonClassName={s.btnGhost}
              onClassName={s.dictateOn}
              noteClassName={s.dictateNote}
              iconClassName={s.ic}
            />
            <div className={s.chips} role="group" aria-label="Common jobs">
              {ASKS.map((a) => (
                <button key={a.label} type="button" className={s.chip} onClick={() => setRequest(a.ask)}>
                  {a.label}
                </button>
              ))}
            </div>
            <label className={s.loc}>
              <span>Price it for</span>
              <input value={locEdit ?? planAddress ?? ""} onChange={(e) => setLocEdit(e.target.value)} placeholder="City, ST — regional prices" />
            </label>
            {err && <div className={s.err}>{err}</div>}
            <div className={s.bar}>
              <button type="button" className={s.btnPrimary} disabled={request.trim().length < 2} onClick={() => void runAsk()}>
                Estimate it
              </button>
            </div>
          </section>

          <section className={`${s.card} ${s.set}`} aria-label="The plan set">
            <div className={s.setHead}>
              <div className={s.setName}>
                <b>{fileName}</b>
                <span>
                  {pages.length} sheet{pages.length === 1 ? "" : "s"}
                </span>
              </div>
              <span className={`${s.stamp} ${ready ? s.stampOk : ""}`}>{ready ? "Ready" : "Getting ready"}</span>
            </div>
            {!ready && <p className={s.setNote}>The plans are being read in the background — you can ask now.</p>}
            {skipped.length > 0 && <p className={s.setNote}>{skipped.join(" ")}</p>}
            <ul className={s.thumbs}>
              {pages.map((p) => (
                <li key={p.page}>
                  <button type="button" className={s.thumb} onClick={() => void openViewer(p.page)} aria-label={`Open sheet ${p.page}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a page drawn in the browser, a data URL */}
                    <img src={p.thumb} alt="" />
                    <span className={s.thumbCap}>
                      <b>{p.page}</b> {kindOf(p.page)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className={s.bar}>
              <button type="button" className={s.btnGhost} onClick={startOver}>
                Other plans
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  // 4 · result
  if (!result) return null;
  const m = result.merged;
  const groups = Array.from(new Set(lines.map((l) => l.group ?? ""))).map((g) => ({ g, rows: lines.filter((l) => (l.group ?? "") === g) }));
  const showGroups = groups.length > 1;
  const measuredRows = result.rows;
  const site = [planName, planAddress].filter(Boolean).join(" · ");
  return (
    <div className={s.be}>
      {viewerEl}
      <div className={s.resultHead}>
        {head(result.scope.title, `${site ? `${site} — ` : ""}“${result.request}”`)}
        <div className={s.headTotal}>
          <span>Estimate</span>
          <b>{money(total)}</b>
        </div>
      </div>
      <div className={s.resGrid}>
        <section className={`${s.card} ${s.found}`}>
          <h2 className={s.h2}>Found on your plans</h2>
          {result.scope.summary && <p className={s.p}>{result.scope.summary}</p>}
          {measuredRows.length > 0 ? (
            <ul className={s.rows}>
              {measuredRows.map((r, i) => (
                <li key={`${r.label}-${i}`} className={s.foundRow}>
                  <div className={s.foundMain}>
                    <b>{r.label}</b>
                    <span className={s.foundQty}>{r.qty != null ? `${qtyText(r.qty)} ${UNIT_SHORT[r.unit]}` : "—"}</span>
                  </div>
                  <div className={s.foundMeta}>
                    <span className={`${s.stamp} ${r.status === "measured" ? s.stampOk : s.stampWarn}`}>{r.status === "measured" ? "Measured" : r.status === "kept" ? "Estimated" : "Not drawn"}</span>
                    {r.pages.map((pg) => (
                      <button key={pg} type="button" className={s.pageLink} onClick={() => void openViewer(pg)}>
                        p. {pg}
                      </button>
                    ))}
                  </div>
                  {r.asWritten && <p className={s.asWritten}>{r.asWritten}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className={s.p}>Every quantity of this job comes straight from the plans&apos; build list below.</p>
          )}
          <details className={s.more}>
            <summary>
              Every quantity of this job · {result.items.length} line{result.items.length === 1 ? "" : "s"}
            </summary>
            <ul className={s.items}>
              {result.items.map((i) => (
                <li key={i.id}>
                  <span className={s.itemName}>{i.label}</span>
                  <span className={s.itemQty}>
                    {qtyText(i.qty)} {UNIT_SHORT[i.unit]}
                  </span>
                  <span className={`${s.src} ${i.measured ? s.srcMeasured : i.source === "rule" ? s.srcRule : ""}`}>{i.measured ? "measured" : SOURCE_LABEL[i.source]}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className={s.btnGhost}
              onClick={() => downloadText(`${(planName ?? "Plans").replace(/[^\w .-]+/g, "").trim() || "Plans"} — ${result.scope.title.replace(/[^\w .-]+/g, "")}.csv`, buildListCsv(result.items), "text/csv;charset=utf-8")}
            >
              Download CSV
            </button>
          </details>
          {result.scope.notIncluded.length > 0 && (
            <p className={s.notIn}>
              <b>Not in this estimate:</b> {result.scope.notIncluded.join(" ")}
            </p>
          )}
        </section>

        <section className={`${s.card} ${s.est}`}>
          <h2 className={s.h2}>Estimate</h2>
          {result.failed.map((f) => (
            <div key={f.trade} className={s.failRow}>
              <span>
                <b>{TRADE_LABEL[f.trade]}</b> could not be priced — {f.error}
              </span>
              <button type="button" className={s.btnGhost} disabled={retrying != null} onClick={() => void retryTrade(f.trade)}>
                {retrying === f.trade ? "Pricing…" : "Try again"}
              </button>
            </div>
          ))}
          <div className={s.lines}>
            {groups.map(({ g, rows }) => (
              <div key={g || "-"} className={s.lineGroup}>
                {showGroups && <div className={s.groupHead}>{g}</div>}
                {rows.map((l) => {
                  const suggested = !isBilled(l);
                  return (
                    <div key={l.id} className={`${s.line} ${suggested ? s.lineSuggested : ""}`}>
                      <span className={s.lineName}>
                        {l.name}
                        {suggested && <span className={s.lineNote}>Suggested — not in the total</span>}
                      </span>
                      <input className={s.lineQty} key={`${l.id}:${l.qty}`} defaultValue={qtyText(l.qty)} inputMode="decimal" aria-label={`${l.name} — quantity`} onBlur={(e) => setQty(l.id, e.target.value)} />
                      <span className={s.lineUnit}>{l.unit}</span>
                      <span className={s.lineTotal}>{money(lineTotal(l))}</span>
                      {suggested ? (
                        <button type="button" className={s.lineAct} onClick={() => acceptLine(l.id)} aria-label={`Add ${l.name}`}>
                          Add
                        </button>
                      ) : (
                        <button type="button" className={s.lineAct} onClick={() => removeLine(l.id)} aria-label={`Remove ${l.name}`}>
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className={s.totalRow}>
            <span>Total</span>
            <b>{money(total)}</b>
          </div>
          {m.notes.length > 0 && (
            <details className={s.more}>
              <summary>Notes and checks · {m.notes.length}</summary>
              <ul className={s.notes}>
                {m.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </details>
          )}
          <div className={s.actions}>
            <button type="button" className={s.btnPrimary} disabled={!billed.length || saving != null} onClick={() => void createProposal()}>
              {saving === "saving" ? "Creating…" : saving === "opening" ? "Opening…" : "Create proposal"}
            </button>
            <button type="button" className={s.btnGhost} disabled={saving != null} onClick={editInSmartProposal}>
              Edit in Smart Proposal
            </button>
            <button
              type="button"
              className={s.btnGhost}
              disabled={saving != null}
              onClick={() => {
                setErr("");
                setStage("ask");
              }}
            >
              Ask for another job
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
