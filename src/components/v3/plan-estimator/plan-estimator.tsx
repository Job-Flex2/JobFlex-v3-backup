"use client";
// SMART PROPOSAL · FROM BLUEPRINTS — a plan set in, one estimate out.
//
// The contractor drops the plans (a PDF set, or photos of the sheets). Four steps, all
// on this one surface, so the desktop console and the handheld studio host the same
// flow:
//   1. SHEETS   every page as a thumbnail; the plan sheets are picked (floor plans,
//               elevations, schedules…), the notes and details are not
//   2. READING  each picked sheet is rendered here in the browser and read on the
//               server, one sheet a request (lib/plans/pdfClient, actions/planEstimator)
//   3. TAKEOFF  the sheets merged into one house and its quantities, trade by trade
//               (lib/plans/takeoff) — every number says where it came from, every
//               number can be corrected, and a corrected house fact (a pitch, a plate
//               height, the foundation) flows into everything that rests on it
//   4. PRICING  each chosen trade priced by the Smart estimate's own pipeline, held to
//               the takeoff (advancedEstimator.pricePlanTrade), then merged into one
//               ledger with the builder price book's checks (lib/plans/merge)
// The host gets the merged estimate and shows it in its own ledger.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import s from "./plan-estimator.module.css";
import { clientErrorText } from "@/lib/staleDeploy";
import { getPlanPriceChecks, readPlanSheet, startPlanSession } from "@/actions/planEstimator";
import { pricePlanTrade } from "@/actions/advancedEstimator";
import { MAX_PLAN_PAGES, openPlanFiles, type PlanPage } from "@/lib/plans/pdfClient";
import { formatTextLayer, pageWorthReading } from "@/lib/plans/readPrompt";
import type { SheetRead } from "@/lib/plans/sheet";
import { computeTakeoff, PLAN_TRADES, TRADE_LABEL, type HouseEdits, type PlanTrade, type TakeoffItem, type TakeoffSource } from "@/lib/plans/takeoff";
import { houseBriefOf } from "@/lib/plans/tradeBrief";
import { mergePlanEstimate, type PlanEstimate, type TradeResult } from "@/lib/plans/merge";
import { MAX_SHEET_IMAGE_CHARS } from "@/lib/plans/wire";
import { isBilled, lineTotal, linesFromEstimate } from "@/lib/estimate/console-model";
import type { GeneratedEstimate } from "@/lib/estimatorSchema";

export type PlanEstimateDone = PlanEstimate & {
  /** The market the trades were priced in ("City, ST"). */
  location: string;
  /** The job address from the plans' title block, when they carry one. */
  address: string | null;
  wholeHouse: boolean;
};

type Failure = { error: string; code?: string; resource?: string };

type Props = {
  /** The intake's address or city — the plans' own address fills it when it is empty. */
  location: string;
  /** Files dropped on the intake that opened this (a PDF dropped with the photos). */
  initialFiles?: File[] | null;
  variant?: "desk" | "phone";
  /** Kept mounted (its state alive) while the host shows the estimate. */
  hidden?: boolean;
  onCancel: () => void;
  onEstimate: (result: PlanEstimateDone) => void;
  /** Set when an estimate from these plans is already open: the takeoff offers the way back to it. */
  onReturn?: (() => void) | null;
  /** The host's failure funnel (the plan-limit dialog, a toast); returns the words to show. */
  onFail?: (res: Failure, where: string) => string;
};

type Stage = "open" | "pick" | "read" | "takeoff" | "price";
type ReadState = { status: "wait" | "run" | "ok" | "fail"; sheet?: SheetRead; error?: string };
type PriceState = { status: "wait" | "run" | "ok" | "fail"; est?: GeneratedEstimate; error?: string };

/** Sheets read at once, trades priced at once — enough to go fast, few enough to stay polite. */
const READ_AT_ONCE = 3;
const PRICE_AT_ONCE = 3;

const KIND_LABEL: Record<string, string> = {
  cover: "Cover sheet",
  site: "Site plan",
  foundation: "Foundation plan",
  floor: "Floor plan",
  roof: "Roof plan",
  elevation: "Elevations",
  section: "Sections",
  structural: "Structural",
  electrical: "Electrical plan",
  plumbing: "Plumbing plan",
  mechanical: "Mechanical plan",
  schedule: "Schedules",
  detail: "Details & notes",
  scan: "Drawing (to be read)",
  other: "Other",
};

const SOURCE_LABEL: Record<TakeoffSource, string> = {
  plan: "on the plans",
  derived: "computed",
  rule: "assumed",
  entered: "entered",
};

const ROLE_LABEL: Record<NonNullable<TakeoffItem["role"]>, string> = {
  labor: "Work",
  material: "Material",
  both: "Supply + install",
};

/** The codes an estimator writes on a takeoff sheet. */
const UNIT_SHORT: Record<TakeoffItem["unit"], string> = {
  "sq ft": "SF",
  "linear ft": "LF",
  each: "EA",
  "cu yards": "CY",
  squares: "SQ",
  sheets: "SHT",
  tons: "TON",
  boxes: "BOX",
  bundles: "BDL",
  rolls: "ROLL",
  gallons: "GAL",
  bags: "BAG",
  pieces: "PC",
  "sq yd": "SY",
  sets: "SET",
  buckets: "BKT",
  tubes: "TUBE",
  lot: "LOT",
};

/** The whole build list as a spreadsheet: one row per line, trade by trade. */
function buildListCsv(items: TakeoffItem[]): string {
  const cell = (v: string | number) => {
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const head = ["Trade", "Phase", "Line", "Work / material", "Quantity", "Unit", "Source", "How it was measured", "Plan pages"];
  const rows = PLAN_TRADES.flatMap((t) =>
    items
      .filter((i) => i.trade === t)
      .map((i) => [TRADE_LABEL[t], i.phase ?? "", i.label, ROLE_LABEL[i.role ?? "both"], i.qty, i.unit, SOURCE_LABEL[i.source], i.basis, i.pages.join(" ")]),
  );
  // A byte-order mark so Excel opens the inch and foot marks as written.
  return "\ufeff" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

function downloadText(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** A trade's lines grouped by the step they belong to, in the order the steps first appear. */
function byPhase(list: TakeoffItem[]): Array<[string, TakeoffItem[]]> {
  const groups = new Map<string, TakeoffItem[]>();
  for (const i of list) {
    const k = i.phase ?? "";
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  return Array.from(groups.entries());
}

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : (Math.round(n * 10) / 10).toLocaleString("en-US"));
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Run `fn` over `items`, `n` at a time. */
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

const parseNum = (raw: string): number | null => {
  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function PlanEstimator({ location, initialFiles, variant = "desk", hidden, onCancel, onEstimate, onReturn, onFail }: Props) {
  const [stage, setStage] = useState<Stage>(initialFiles?.length ? "pick" : "open");
  const [opening, setOpening] = useState<number | null>(null);
  const [pages, setPages] = useState<PlanPage[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [picked, setPicked] = useState<Record<number, boolean>>({});
  const [token, setToken] = useState<string | null>(null);
  const [reads, setReads] = useState<Record<number, ReadState>>({});
  const [edits, setEdits] = useState<HouseEdits>({});
  const [qtyEdits, setQtyEdits] = useState<Record<string, number>>({});
  const [chosen, setChosen] = useState<Partial<Record<PlanTrade, boolean>>>({});
  const [open, setOpen] = useState<Partial<Record<PlanTrade, boolean>>>({});
  const [factsOpen, setFactsOpen] = useState(false);
  const [prices, setPrices] = useState<Partial<Record<PlanTrade, PriceState>>>({});
  /** The market as typed on the takeoff screen; until then the intake's, or the plans' own address. */
  const [locEdit, setLocEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  /** Bumped on every new run; a late answer from an abandoned run is dropped. */
  const runId = useRef(0);
  const started = useRef(false);
  const pagesRef = useRef<PlanPage[]>([]);

  const fail = (res: Failure, where: string) => (onFail ? onFail(res, where) : res.error);

  // ── 1. opening the files ─────────────────────────────────────────────
  async function addFiles(list: File[]) {
    if (!list.length) return;
    setErr("");
    setOpening(0);
    try {
      const { pages: more, skipped: why } = await openPlanFiles(list, () => setOpening((n) => (n ?? 0) + 1));
      const base = pagesRef.current.length;
      const room = Math.max(0, MAX_PLAN_PAGES - base);
      const kept = more.slice(0, room).map((p, i) => ({ ...p, page: base + i + 1 }));
      pagesRef.current = [...pagesRef.current, ...kept];
      setPages(pagesRef.current);
      setPicked((pk) => {
        const next = { ...pk };
        for (const p of kept) next[p.page] = pageWorthReading(p.text, p.titleText).read;
        return next;
      });
      setSkipped((s0) => [...s0, ...why, ...(more.length > room ? [`Only the first ${MAX_PLAN_PAGES} pages are kept.`] : [])]);
      if (pagesRef.current.length) setStage("pick");
    } catch (e) {
      setErr(clientErrorText(e, "The files could not be opened."));
    } finally {
      setOpening(null);
    }
  }

  // Files handed over by the host (a PDF dropped on the intake) open once, on the
  // next tick — the effect itself sets nothing.
  useEffect(() => {
    if (!initialFiles?.length) return;
    const t = setTimeout(() => {
      if (started.current) return;
      started.current = true;
      void addFiles(initialFiles);
    }, 0);
    return () => clearTimeout(t);
  }, [initialFiles]);

  const pickedPages = pages.filter((p) => picked[p.page]);

  // ── 2. reading the sheets ────────────────────────────────────────────
  async function ensureToken(): Promise<string | null> {
    if (token) return token;
    const res = await startPlanSession();
    if (!res.ok) {
      setErr(fail(res, "Couldn't open the plans"));
      return null;
    }
    setToken(res.token);
    return res.token;
  }

  async function readOne(p: PlanPage, tok: string, total: number, run: number): Promise<boolean> {
    setReads((r) => ({ ...r, [p.page]: { status: "run" } }));
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
        // The grid only describes the close-ups when every one of them fitted.
        grid: grid && images.length === tiles.length + 1 ? grid : null,
      });
      if (run !== runId.current) return false;
      setReads((r) => ({ ...r, [p.page]: res.ok ? { status: "ok", sheet: res.sheet } : { status: "fail", error: res.error } }));
      return res.ok;
    } catch (e) {
      if (run !== runId.current) return false;
      setReads((r) => ({ ...r, [p.page]: { status: "fail", error: clientErrorText(e, "This sheet could not be read.") } }));
      return false;
    }
  }

  async function readSheets(only?: PlanPage[]) {
    const list = only ?? pickedPages;
    if (!list.length) return;
    setErr("");
    setBusy(true);
    const run = ++runId.current;
    try {
      const tok = await ensureToken();
      if (!tok) return;
      setStage("read");
      setReads((r) => {
        const next = only ? { ...r } : {};
        for (const p of list) next[p.page] = { status: "wait" };
        return next;
      });
      let failed = 0;
      await pool(list, READ_AT_ONCE, async (p) => {
        if (!(await readOne(p, tok, pages.length, run))) failed++;
      });
      // Every sheet read and none failed: straight on to the takeoff.
      const stillFailing = !!only && Object.entries(reads).some(([pg, r]) => r.status === "fail" && !list.some((p) => p.page === Number(pg)));
      if (run === runId.current && !failed && !stillFailing) setStage("takeoff");
    } finally {
      if (run === runId.current) setBusy(false);
    }
  }

  const sheets = useMemo(
    () =>
      Object.values(reads)
        .filter((r) => r.status === "ok" && r.sheet)
        .map((r) => r.sheet!)
        .sort((a, b) => a.page - b.page),
    [reads],
  );
  const readCount = Object.values(reads).filter((r) => r.status === "ok" || r.status === "fail").length;
  const readTotal = Object.keys(reads).length;
  const readFailed = Object.entries(reads).filter(([, r]) => r.status === "fail");

  // ── 3. the takeoff ───────────────────────────────────────────────────
  // What the plans say (with the house corrections), and the same with the contractor's
  // own quantities — a corrected wall area carries its drywall sheets, mud and paint along.
  const planned = useMemo(() => (sheets.length ? computeTakeoff(sheets, edits) : null), [sheets, edits]);
  const takeoff = useMemo(() => (sheets.length && Object.keys(qtyEdits).length ? computeTakeoff(sheets, edits, qtyEdits) : planned), [sheets, edits, qtyEdits, planned]);
  const items: TakeoffItem[] = useMemo(() => takeoff?.items ?? [], [takeoff]);
  const tradesWithItems = useMemo(() => PLAN_TRADES.filter((t) => items.some((i) => i.trade === t)), [items]);
  const chosenTrades = tradesWithItems.filter((t) => chosen[t] !== false);
  const wholeHouse = chosenTrades.length === tradesWithItems.length && tradesWithItems.length > 0;

  // The plans' own address prices the job when the intake had none.
  const locShown = locEdit ?? (location.trim() || takeoff?.house.address || "");
  const priceLoc = locShown.trim();

  function goTakeoff() {
    if (!sheets.length) return;
    setStage("takeoff");
  }

  function editLevel(name: string, key: "areaSqFt" | "plateFt", raw: string) {
    const n = parseNum(raw);
    setEdits((e) => {
      const levels = { ...(e.levels ?? {}) };
      levels[name] = { ...(levels[name] ?? {}), [key]: n ?? undefined };
      return { ...e, levels };
    });
  }
  function editFact<K extends keyof HouseEdits>(key: K, value: HouseEdits[K] | undefined) {
    setEdits((e) => {
      const next = { ...e };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  }
  function editQty(id: string, raw: string, planQty: number) {
    const n = parseNum(raw);
    setQtyEdits((q) => {
      const next = { ...q };
      if (n == null || n === planQty) delete next[id];
      else next[id] = n;
      return next;
    });
  }

  // ── 4. pricing ───────────────────────────────────────────────────────
  async function priceOne(trade: PlanTrade, tok: string, run: number, alsoPriced: PlanTrade[]): Promise<GeneratedEstimate | null> {
    if (!takeoff) return null;
    setPrices((p) => ({ ...p, [trade]: { status: "run" } }));
    try {
      const res = await pricePlanTrade({
        token: tok,
        trade,
        location: priceLoc || null,
        house: houseBriefOf(takeoff.house),
        items: items.filter((i) => i.trade === trade),
        alsoPriced,
      });
      if (run !== runId.current) return null;
      if (res.ok) {
        setPrices((p) => ({ ...p, [trade]: { status: "ok", est: res.data } }));
        return res.data;
      }
      // Only a plan limit goes to the host (its upgrade dialog); a trade that failed
      // says so on its own row instead of eighteen toasts.
      const why = res.code === "PLAN_LIMIT_REACHED" ? fail(res, "Couldn't price the plans") : res.error;
      setPrices((p) => ({ ...p, [trade]: { status: "fail", error: why } }));
      return null;
    } catch (e) {
      if (run !== runId.current) return null;
      setPrices((p) => ({ ...p, [trade]: { status: "fail", error: clientErrorText(e, "This trade could not be priced.") } }));
      return null;
    }
  }

  async function priceTrades(only?: PlanTrade[]) {
    const list = only ?? chosenTrades;
    if (!list.length || !takeoff) return;
    setErr("");
    setBusy(true);
    const run = ++runId.current;
    try {
      const tok = await ensureToken();
      if (!tok) return;
      setStage("price");
      setPrices((p) => {
        const next: Partial<Record<PlanTrade, PriceState>> = only ? { ...p } : {};
        for (const t of list) next[t] = { status: "wait" };
        return next;
      });
      // What is priced so far, this run's answers over the earlier ones.
      const got: Partial<Record<PlanTrade, GeneratedEstimate>> = {};
      for (const t of chosenTrades) if (!list.includes(t) && prices[t]?.status === "ok" && prices[t]?.est) got[t] = prices[t]!.est!;
      await pool(list, PRICE_AT_ONCE, async (t) => {
        const est = await priceOne(t, tok, run, chosenTrades);
        if (est) got[t] = est;
      });
      // Every chosen trade back: the estimate opens by itself.
      if (run === runId.current && chosenTrades.every((t) => got[t])) await finish(got);
    } finally {
      if (run === runId.current) setBusy(false);
    }
  }

  const priced = chosenTrades.filter((t) => prices[t]?.status === "ok");
  const priceFailed = chosenTrades.filter((t) => prices[t]?.status === "fail");
  const priceDone = chosenTrades.filter((t) => prices[t]?.status === "ok" || prices[t]?.status === "fail").length;

  /** Merge what was priced into one estimate and hand it to the host. */
  async function finish(got?: Partial<Record<PlanTrade, GeneratedEstimate>>) {
    if (!takeoff) return;
    const ests: Partial<Record<PlanTrade, GeneratedEstimate>> = got ?? Object.fromEntries(priced.map((t) => [t, prices[t]!.est!]));
    const results: TradeResult[] = chosenTrades.filter((t) => ests[t]).map((t) => ({ trade: t, est: ests[t]! }));
    if (!results.length) return;
    setBusy(true);
    try {
      const house = houseBriefOf(takeoff.house);
      const checks = await getPlanPriceChecks({ house, items, location: priceLoc || null }).catch(() => null);
      const all = results.length === chosenTrades.length;
      const merged = mergePlanEstimate({
        house,
        results,
        checks: takeoff.checks,
        priceChecks: checks && checks.ok ? checks.data : null,
        wholeHouse: wholeHouse && all,
      });
      onEstimate({ ...merged, location: priceLoc, address: takeoff.house.address, wholeHouse: wholeHouse && all });
      // Coming back from the estimate lands on the takeoff, ready to change and re-price.
      setStage("takeoff");
    } finally {
      setBusy(false);
    }
  }

  const tradeTotal = (est: GeneratedEstimate) => linesFromEstimate(est).filter(isBilled).reduce((a, l) => a + lineTotal(l), 0);

  // ══════════════ RENDER ══════════════
  const root = `${s.pe} ${variant === "phone" ? s.phone : s.desk}`;
  const steps: Array<{ id: Stage[]; label: string }> = [
    { id: ["open", "pick"], label: "Sheets" },
    { id: ["read"], label: "Reading" },
    { id: ["takeoff"], label: "Takeoff" },
    { id: ["price"], label: "Pricing" },
  ];
  const stepIdx = steps.findIndex((x) => x.id.includes(stage));

  const head = (
    <div className={s.head}>
      <div className={s.headTxt}>
        <div className={s.kicker}>Smart Proposal · from blueprints</div>
        <h1 className={s.title}>{takeoff?.house.name || "Estimate from the plans"}</h1>
        {takeoff?.house.address && <div className={s.sub}>{takeoff.house.address}</div>}
      </div>
      <ol className={s.steps} aria-label="Progress">
        {steps.map((x, i) => (
          <li key={x.label} className={i < stepIdx ? s.stepDone : i === stepIdx ? s.stepNow : undefined}>
            <span className={s.stepN}>{i + 1}</span>
            {x.label}
          </li>
        ))}
      </ol>
    </div>
  );

  const fileChooser = (
    <input
      ref={fileInput}
      className={s.file}
      type="file"
      accept="application/pdf,.pdf,image/*"
      multiple
      onChange={(e) => {
        const list = Array.from(e.target.files ?? []);
        e.target.value = "";
        void addFiles(list);
      }}
    />
  );

  let body: ReactNode = null;

  if (stage === "open") {
    body = (
      <section className={s.card}>
        <div
          className={`${s.drop} ${drag ? s.dropOn : ""}`}
          role="button"
          tabIndex={0}
          aria-label="Add the plan set"
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInput.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void addFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <svg className={s.dropIc} viewBox="0 0 48 48" aria-hidden="true">
            <path d="M8 6h22l10 10v26H8z" fill="none" stroke="currentColor" strokeWidth="2.5" />
            <path d="M30 6v10h10M15 26h18M15 32h18M15 38h11" fill="none" stroke="currentColor" strokeWidth="2.5" />
          </svg>
          <div className={s.dropH}>{opening != null ? `Opening the plan set… ${opening} page${opening === 1 ? "" : "s"}` : "Drop the plan set here"}</div>
          <div className={s.dropP}>A PDF from the architect or the drafter, or photos of each sheet. Up to {MAX_PLAN_PAGES} pages.</div>
          <span className={s.btnPrimary}>Choose files</span>
        </div>
        <ol className={s.how}>
          <li>
            <b>Read</b> — floor plans, elevations, schedules and the cover&apos;s area summary: rooms and sizes, windows and doors, pitch, foundation, fixtures.
          </li>
          <li>
            <b>Check the takeoff</b> — every quantity shows where it came from. Correct any of them; a corrected pitch or wall height carries through.
          </li>
          <li>
            <b>Price</b> — the whole house or only your trades, each held to the plan&apos;s quantities, in one estimate.
          </li>
        </ol>
        {err && <div className={s.err}>{err}</div>}
        <div className={s.bar}>
          <button type="button" className={s.btnGhost} onClick={onCancel}>
            Back
          </button>
        </div>
      </section>
    );
  }

  if (stage === "pick") {
    const n = pickedPages.length;
    body = (
      <section className={s.card}>
        <div className={s.cardHead}>
          <div>
            <h2 className={s.h2}>{pages.length} page{pages.length === 1 ? "" : "s"} · pick the sheets to read</h2>
            <p className={s.p}>Plan sheets are picked for you; notes, details and specifications are left out. Tap a page to change it.</p>
          </div>
          <div className={s.quick}>
            <button type="button" className={s.btnSmall} onClick={() => setPicked(Object.fromEntries(pages.map((p) => [p.page, pageWorthReading(p.text, p.titleText).read])))}>
              Plan sheets
            </button>
            <button type="button" className={s.btnSmall} onClick={() => setPicked(Object.fromEntries(pages.map((p) => [p.page, true])))}>
              All
            </button>
            <button type="button" className={s.btnSmall} onClick={() => setPicked({})}>
              None
            </button>
          </div>
        </div>
        {opening != null && <div className={s.note}>Opening… {opening} pages</div>}
        {skipped.length > 0 && (
          <ul className={s.warnList}>
            {skipped.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        <div className={s.grid}>
          {pages.map((p) => {
            const guess = pageWorthReading(p.text, p.titleText).guess;
            const on = !!picked[p.page];
            return (
              <button
                type="button"
                key={p.page}
                className={`${s.page} ${on ? s.pageOn : ""}`}
                aria-pressed={on}
                onClick={() => setPicked((pk) => ({ ...pk, [p.page]: !pk[p.page] }))}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.thumb} alt="" className={s.thumb} />
                <span className={s.pageMeta}>
                  <span className={s.pageN}>{p.page}</span>
                  <span className={s.pageKind}>{KIND_LABEL[guess] ?? guess}</span>
                </span>
                <span className={s.tick} aria-hidden="true">
                  {on ? "✓" : ""}
                </span>
              </button>
            );
          })}
        </div>
        {err && <div className={s.err}>{err}</div>}
        <div className={s.bar}>
          <button type="button" className={s.btnGhost} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={s.btnGhost} onClick={() => fileInput.current?.click()} disabled={opening != null}>
            Add files
          </button>
          <span className={s.barNote}>{n > 24 ? `About ${Math.ceil((n / READ_AT_ONCE) * 0.4)} min to read ${n} sheets` : ""}</span>
          <button type="button" className={s.btnPrimary} disabled={!n || busy || opening != null} onClick={() => void readSheets()}>
            {busy ? "Starting…" : `Read ${n} sheet${n === 1 ? "" : "s"}`}
          </button>
        </div>
      </section>
    );
  }

  if (stage === "read") {
    const pct = readTotal ? Math.round((readCount / readTotal) * 100) : 0;
    body = (
      <section className={s.card}>
        <div className={s.cardHead}>
          <div>
            <h2 className={s.h2}>
              Reading {readTotal} sheet{readTotal === 1 ? "" : "s"} — {readCount} done
            </h2>
            <p className={s.p}>Each sheet is read for its rooms and sizes, openings, roof, foundation and fixtures. A big set takes a few minutes.</p>
          </div>
        </div>
        <div className={s.meter} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <ul className={s.rows}>
          {pages
            .filter((p) => reads[p.page])
            .map((p) => {
              const r = reads[p.page];
              const sh = r.sheet;
              return (
                <li key={p.page} className={`${s.row} ${r.status === "fail" ? s.rowBad : ""}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumb} alt="" className={s.rowThumb} />
                  <span className={s.rowMain}>
                    <span className={s.rowTitle}>
                      Page {p.page}
                      {sh ? ` · ${KIND_LABEL[sh.kind] ?? sh.kind}${sh.level && sh.kind === "floor" ? ` — ${sh.level}` : ""}` : ""}
                      {sh?.title ? <em> {sh.title}</em> : null}
                    </span>
                    <span className={s.rowSub}>
                      {r.status === "wait" && "Waiting"}
                      {r.status === "run" && <span className={s.live}>Reading…</span>}
                      {r.status === "fail" && r.error}
                      {r.status === "ok" && sh && summary(sh)}
                    </span>
                  </span>
                  {r.status === "fail" && (
                    <button type="button" className={s.btnSmall} disabled={busy} onClick={() => void readSheets([p])}>
                      Retry
                    </button>
                  )}
                  {r.status === "ok" && sh?.confidence === "low" && <span className={s.chipWarn}>hard to read</span>}
                </li>
              );
            })}
        </ul>
        {err && <div className={s.err}>{err}</div>}
        <div className={s.bar}>
          <button type="button" className={s.btnGhost} disabled={busy} onClick={() => setStage("pick")}>
            Back to sheets
          </button>
          <span className={s.barNote}>{readFailed.length ? `${readFailed.length} sheet${readFailed.length === 1 ? "" : "s"} not read` : ""}</span>
          <button type="button" className={s.btnPrimary} disabled={busy || !sheets.length} onClick={goTakeoff}>
            {readFailed.length ? `Continue with ${sheets.length} sheet${sheets.length === 1 ? "" : "s"}` : "See the takeoff"}
          </button>
        </div>
      </section>
    );
  }

  if (stage === "takeoff" && takeoff) {
    const h = takeoff.house;
    const levelEdits = edits.levels ?? {};
    body = (
      <>
        <section className={s.card}>
          <div className={s.cardHead}>
            <div>
              <h2 className={s.h2}>The house</h2>
              <p className={s.p}>
                Read from {sheets.length} sheet{sheets.length === 1 ? "" : "s"}. Correct a fact and every quantity that rests on it follows.
              </p>
            </div>
            <button type="button" className={s.btnSmall} aria-expanded={factsOpen} onClick={() => setFactsOpen((o) => !o)}>
              {factsOpen ? "Done" : "Correct the house"}
            </button>
          </div>
          <div className={s.facts}>
            <Fact label="Living area" value={`${fmt(h.livingSqFt)} sq ft`} from={h.livingFrom} />
            {h.levels.map((l) => (
              <Fact key={l.name} label={`${l.name} floor`} value={`${fmt(l.areaSqFt)} sq ft · ${fmt(l.plateFt)}' walls`} from={l.areaFrom} />
            ))}
            <Fact label="Garage" value={h.garage ? `${fmt(h.garage.areaSqFt)} sq ft` : "none"} />
            <Fact label="Roof" value={`${h.roof.rise}:12 ${h.roof.style ?? "gable"} · ${h.roof.overhangIn}" overhang`} from={h.roof.pitchFrom === "rule" ? "pitch assumed" : undefined} />
            <Fact label="Foundation" value={h.foundation.type} from={h.foundation.from === "rule" ? "assumed" : undefined} />
            <Fact
              label="Openings"
              value={`${fmt(h.windows.reduce((a, w) => a + w.count, 0))} windows · ${fmt(h.doors.filter((d) => d.exterior).reduce((a, d) => a + d.count, 0))} exterior · ${fmt(h.doors.filter((d) => !d.exterior).reduce((a, d) => a + d.count, 0))} interior doors`}
            />
          </div>
          {factsOpen && (
            <div className={s.edit}>
              <label className={s.fld}>
                <span>Living area, sq ft</span>
                <input key={`liv-${h.livingSqFt}`} defaultValue={h.livingSqFt} inputMode="decimal" onBlur={(e) => editFact("livingSqFt", parseNum(e.target.value) ?? undefined)} />
              </label>
              {h.levels.map((l) => (
                <div className={s.fldPair} key={l.name}>
                  <label className={s.fld}>
                    <span>{l.name} floor, sq ft</span>
                    <input key={`a-${l.name}-${l.areaSqFt}`} defaultValue={levelEdits[l.name]?.areaSqFt ?? l.areaSqFt} inputMode="decimal" onBlur={(e) => editLevel(l.name, "areaSqFt", e.target.value)} />
                  </label>
                  <label className={s.fld}>
                    <span>{l.name} wall height, ft</span>
                    <input key={`p-${l.name}-${l.plateFt}`} defaultValue={l.plateFt} inputMode="decimal" onBlur={(e) => editLevel(l.name, "plateFt", e.target.value)} />
                  </label>
                </div>
              ))}
              <label className={s.fld}>
                <span>Garage, sq ft (0 = none)</span>
                <input
                  key={`g-${h.garage?.areaSqFt ?? 0}`}
                  defaultValue={h.garage?.areaSqFt ?? 0}
                  inputMode="decimal"
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    editFact("garageSqFt", raw === "" ? undefined : Math.max(0, parseFloat(raw) || 0));
                  }}
                />
              </label>
              <label className={s.fld}>
                <span>Roof pitch, inches per foot</span>
                <input key={`r-${h.roof.rise}`} defaultValue={h.roof.rise} inputMode="decimal" onBlur={(e) => editFact("roofRise", parseNum(e.target.value) ?? undefined)} />
              </label>
              <label className={s.fld}>
                <span>Roof style</span>
                <select value={/hip/i.test(h.roof.style ?? "") ? "hip" : "gable"} onChange={(e) => editFact("roofStyle", e.target.value as "gable" | "hip")}>
                  <option value="gable">Gable</option>
                  <option value="hip">Hip</option>
                </select>
              </label>
              <label className={s.fld}>
                <span>Overhang, inches</span>
                <input
                  key={`o-${h.roof.overhangIn}`}
                  defaultValue={h.roof.overhangIn}
                  inputMode="decimal"
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    editFact("overhangIn", raw === "" ? undefined : Math.max(0, parseFloat(raw) || 0));
                  }}
                />
              </label>
              <label className={s.fld}>
                <span>Foundation</span>
                <select value={h.foundation.type} onChange={(e) => editFact("foundation", e.target.value as HouseEdits["foundation"])}>
                  <option value="crawlspace">Crawlspace</option>
                  <option value="slab">Slab on grade</option>
                  <option value="basement">Full basement</option>
                  <option value="piers">Pier and beam</option>
                </select>
              </label>
              <label className={s.fld}>
                <span>Siding</span>
                <input key={`s-${h.siding ?? ""}`} defaultValue={h.siding ?? ""} placeholder="fiber cement lap" onBlur={(e) => editFact("siding", e.target.value.trim() || undefined)} />
              </label>
              <div className={s.editBar}>
                <button
                  type="button"
                  className={s.btnSmall}
                  onClick={() => {
                    setEdits({});
                    setQtyEdits({});
                  }}
                >
                  Back to what the plans say
                </button>
              </div>
            </div>
          )}
          {takeoff.checks.length > 0 && (
            <ul className={s.checks}>
              {takeoff.checks.map((c) => (
                <li key={c.text} className={c.level === "warn" ? s.checkWarn : s.checkInfo}>
                  {c.text}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={s.card}>
          <div className={s.cardHead}>
            <div>
              <h2 className={s.h2}>Build list · {items.length} lines</h2>
              <p className={s.p}>
                Every step of the work and every material in the units it is bought in, waste counted. What the plans do not show is assumed and marked. Tick the trades to price — the whole house, or only yours — and open one to check or change its lines.
              </p>
            </div>
            <div className={s.quick}>
              <button type="button" className={s.btnSmall} onClick={() => downloadText(`${(h.name ?? "Plans").replace(/[^\w .-]+/g, "").trim() || "Plans"} — build list.csv`, buildListCsv(items), "text/csv;charset=utf-8")}>
                Download CSV
              </button>
              <button type="button" className={s.btnSmall} onClick={() => setChosen({})}>
                Whole house
              </button>
              <button type="button" className={s.btnSmall} onClick={() => setChosen(Object.fromEntries(tradesWithItems.map((t) => [t, false])))}>
                None
              </button>
            </div>
          </div>
          <div className={s.trades}>
            {tradesWithItems.map((t) => {
              const mine = items.filter((i) => i.trade === t);
              const on = chosen[t] !== false;
              const isOpen = !!open[t];
              const rules = mine.filter((i) => i.source === "rule").length;
              const work = mine.filter((i) => i.role !== "material").length;
              return (
                <div key={t} className={`${s.trade} ${on ? "" : s.tradeOff}`}>
                  <div className={s.tradeHead}>
                    <label className={s.tradeTick}>
                      <input type="checkbox" checked={on} onChange={() => setChosen((c) => ({ ...c, [t]: !on }))} aria-label={`Price ${TRADE_LABEL[t]}`} />
                      <span className={s.tradeName}>{TRADE_LABEL[t]}</span>
                    </label>
                    <span className={s.tradeMeta}>
                      {work} work · {mine.length - work} material
                      {rules ? <span className={s.chipRule}>{rules} assumed</span> : null}
                    </span>
                    <button type="button" className={s.btnSmall} aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [t]: !isOpen }))}>
                      {isOpen ? "Close" : "Quantities"}
                    </button>
                  </div>
                  {isOpen && (
                    <div className={s.items}>
                      {byPhase(mine).map(([phase, list]) => (
                        <div key={phase || "-"} className={s.phase}>
                          {phase ? <div className={s.phaseHead}>{phase}</div> : null}
                      {list.map((i) => {
                        const planQty = planned?.items.find((x) => x.id === i.id)?.qty ?? i.qty;
                        return (
                          <div key={i.id} className={s.item}>
                            <span className={s.itemName}>
                              <span className={`${s.role} ${s[`role_${i.role ?? "both"}`] ?? ""}`}>{ROLE_LABEL[i.role ?? "both"]}</span>
                              {i.label}
                              <span className={s.itemBasis}>
                                {i.basis}
                                {i.pages.length ? ` · p. ${i.pages.slice(0, 6).join(", ")}` : ""}
                              </span>
                            </span>
                            <input
                              className={s.itemQty}
                              key={`${i.id}:${i.qty}`}
                              defaultValue={fmt(i.qty)}
                              inputMode="decimal"
                              aria-label={`${i.label} — quantity`}
                              onBlur={(e) => editQty(i.id, e.target.value, planQty)}
                            />
                            <span className={s.itemUnit}>{UNIT_SHORT[i.unit]}</span>
                            <span className={`${s.src} ${s[`src_${i.source}`] ?? ""}`}>{SOURCE_LABEL[i.source]}</span>
                          </div>
                        );
                      })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <label className={s.loc}>
            <span>Price it for</span>
            <input value={locShown} onChange={(e) => setLocEdit(e.target.value)} placeholder="City, ST — regional prices" />
          </label>
          {err && <div className={s.err}>{err}</div>}
          <div className={s.bar}>
            <button type="button" className={s.btnGhost} onClick={() => setStage("pick")}>
              Back to sheets
            </button>
            {onReturn ? (
              <button type="button" className={s.btnGhost} onClick={onReturn}>
                Back to the estimate
              </button>
            ) : null}
            <span className={s.barNote}>{chosenTrades.length > 6 ? `About ${Math.max(2, Math.ceil(chosenTrades.length / PRICE_AT_ONCE))} min` : ""}</span>
            <button type="button" className={s.btnPrimary} disabled={!chosenTrades.length || busy} onClick={() => void priceTrades()}>
              {wholeHouse ? `Price the whole house · ${chosenTrades.length} trades` : `Price ${chosenTrades.length} trade${chosenTrades.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </section>
      </>
    );
  }

  if (stage === "price") {
    const pct = chosenTrades.length ? Math.round((priceDone / chosenTrades.length) * 100) : 0;
    body = (
      <section className={s.card}>
        <div className={s.cardHead}>
          <div>
            <h2 className={s.h2}>
              Pricing {chosenTrades.length} trade{chosenTrades.length === 1 ? "" : "s"} — {priceDone} done
            </h2>
            <p className={s.p}>Each trade is priced on its own procedure and price book, held to the takeoff&apos;s quantities, with nothing priced twice between trades.</p>
          </div>
        </div>
        <div className={s.meter} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <ul className={s.rows}>
          {chosenTrades.map((t) => {
            const p = prices[t];
            return (
              <li key={t} className={`${s.row} ${p?.status === "fail" ? s.rowBad : ""}`}>
                <span className={s.rowMain}>
                  <span className={s.rowTitle}>{TRADE_LABEL[t]}</span>
                  <span className={s.rowSub}>
                    {(!p || p.status === "wait") && "Waiting"}
                    {p?.status === "run" && <span className={s.live}>Pricing…</span>}
                    {p?.status === "fail" && p.error}
                    {p?.status === "ok" && p.est && `${linesFromEstimate(p.est).length} lines`}
                  </span>
                </span>
                {p?.status === "ok" && p.est && <span className={s.rowMoney}>{money(tradeTotal(p.est))}</span>}
                {p?.status === "fail" && (
                  <button type="button" className={s.btnSmall} disabled={busy} onClick={() => void priceTrades([t])}>
                    Retry
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {err && <div className={s.err}>{err}</div>}
        <div className={s.bar}>
          <button
            type="button"
            className={s.btnGhost}
            disabled={busy}
            onClick={() => {
              runId.current++;
              setStage("takeoff");
            }}
          >
            Back to the takeoff
          </button>
          <span className={s.barNote}>{priceFailed.length ? `${priceFailed.length} not priced` : ""}</span>
          <button type="button" className={s.btnPrimary} disabled={busy || !priced.length} onClick={() => void finish()}>
            {priceFailed.length ? `Continue with ${priced.length} trade${priced.length === 1 ? "" : "s"}` : busy ? "Pricing…" : "Open the estimate"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className={root} hidden={hidden}>
      {fileChooser}
      {head}
      {body}
    </div>
  );
}

function Fact({ label, value, from }: { label: string; value: string; from?: string }) {
  return (
    <div className={s.fact}>
      <span className={s.factL}>{label}</span>
      <span className={s.factV}>{value}</span>
      {from ? <span className={s.factF}>{from}</span> : null}
    </div>
  );
}

/** What a sheet gave, in a line. */
function summary(sh: SheetRead): string {
  const bits: string[] = [];
  if (sh.rooms.length) bits.push(`${sh.rooms.length} room${sh.rooms.length === 1 ? "" : "s"}`);
  const w = sh.windows.reduce((a, o) => a + o.count, 0);
  const d = sh.doors.reduce((a, o) => a + o.count, 0);
  if (w) bits.push(`${w} window${w === 1 ? "" : "s"}`);
  if (d) bits.push(`${d} door${d === 1 ? "" : "s"}`);
  if (sh.roof.pitch) bits.push(`roof ${sh.roof.pitch}`);
  if (sh.stated.livingSqFt) bits.push(`${sh.stated.livingSqFt.toLocaleString("en-US")} sq ft living`);
  if (sh.foundation.type) bits.push(sh.foundation.type);
  const fx = Object.values(sh.fixtures).reduce((a: number, n) => a + (n ?? 0), 0);
  if (fx) bits.push(`${fx} fixtures`);
  const dev = Object.entries(sh.electrical).filter(([k]) => k !== "panelAmps").reduce((a, [, n]) => a + (typeof n === "number" ? n : 0), 0);
  if (dev) bits.push(`${dev} electrical points`);
  return bits.length ? bits.join(" · ") : "Nothing to measure on this sheet";
}
