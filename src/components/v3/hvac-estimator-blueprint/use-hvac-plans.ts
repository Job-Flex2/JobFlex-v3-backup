"use client";

// THE HVAC ESTIMATOR'S "FROM THE PLANS" (owner, 2026-10-18: "add this option to estimate blueprints in the HVAC
// estimator"): a plan set read in this browser the way the blueprint estimator reads one (lib/plans — the PDF opened
// here, each sheet's first look, then a close read), but only the sheets a heating & cooling load rests on: the floor
// plans, the schedules and the energy table, the cover, the site plan, the elevations, the sections, the foundation,
// the roof and the mechanical sheet. Structural sheets and details are left alone. When the set is read, the takeoff
// merges the house and lib/plans/hvacEnvelope takes out what the load needs; the form lays it over its model
// (lib/plans/hvacLoad applyPlansToModel) and the engine prices on it as on any other house.

import { useCallback, useRef, useState } from "react";
import { readPlanSheet, skimPlanSheet, startPlanSession } from "@/actions/planEstimator";
import { MAX_PLAN_PAGES, openPlanFiles, type PlanPage } from "@/lib/plans/pdfClient";
import { formatTextLayer } from "@/lib/plans/readPrompt";
import { readRank, readsLight } from "@/lib/plans/readOrder";
import { fitImages, pool, textKind } from "@/lib/plans/readClient";
import { computeTakeoff, type House } from "@/lib/plans/takeoff";
import { planEnvelopeOf, type PlanEnvelope } from "@/lib/plans/hvacEnvelope";
import { planGlass } from "@/lib/plans/hvacLoad";
import { isCivilSet, noFloorPlanText, type PageSeen } from "@/lib/plans/noFloorPlan";
import type { SheetKind, SheetRead } from "@/lib/plans/sheet";
import { clientErrorText } from "@/lib/staleDeploy";
import { reportPlanLimitResult } from "@/stores/usePlanLimitStore";

/** The sheets a heating & cooling load rests on. */
const LOAD_KINDS: ReadonlySet<SheetKind> = new Set<SheetKind>(["floor", "schedule", "cover", "site", "elevation", "section", "mechanical", "foundation", "roof", "other"]);
const SKIM_AT_ONCE = 6;
const READ_AT_ONCE = 3;

export type PlanReadStatus = "idle" | "opening" | "reading" | "done" | "failed";

export type HvacPlans = {
  status: PlanReadStatus;
  fileName: string | null;
  pages: number;
  /** Sheets to read for the load, and how many are read so far. */
  total: number;
  done: number;
  error: string;
  /** Pages that could not be opened, or were left out. */
  skipped: string[];
  sheets: SheetRead[];
  house: House | null;
  envelope: PlanEnvelope | null;
};

const EMPTY: HvacPlans = { status: "idle", fileName: null, pages: 0, total: 0, done: 0, error: "", skipped: [], sheets: [], house: null, envelope: null };

/** How a read ended — what the caller acts on once `pick` resolves (step 1 fills the address from it). null = a newer
 *  pick or a remove took over. */
export type PlanReadOutcome = { status: "done" | "failed"; house: House | null; envelope: PlanEnvelope | null } | null;

export function useHvacPlans() {
  const [state, setState] = useState<HvacPlans>(EMPTY);
  const run = useRef(0);

  const remove = useCallback(() => {
    run.current += 1;
    setState(EMPTY);
  }, []);

  const pick = useCallback(async (files: File[]): Promise<PlanReadOutcome> => {
    if (!files.length) return null;
    const mine = ++run.current;
    const alive = () => mine === run.current;
    setState({ ...EMPTY, status: "opening", fileName: files.length === 1 ? files[0].name : `${files.length} files` });
    try {
      const { pages: opened, skipped } = await openPlanFiles(files);
      if (!alive()) return null;
      const pages: PlanPage[] = opened.slice(0, MAX_PLAN_PAGES).map((p, i) => ({ ...p, page: i + 1 }));
      const left = [...skipped, ...(opened.length > MAX_PLAN_PAGES ? [`Only the first ${MAX_PLAN_PAGES} pages are kept.`] : [])];
      if (!pages.length) {
        setState((s) => ({ ...s, status: "failed", error: skipped[0] ?? "No pages could be opened from these files.", skipped: left }));
        return { status: "failed", house: null, envelope: null };
      }
      // A civil set (erosion control, grading, drainage) names itself on every sheet and draws no house: said at once,
      // before a run is spent on it.
      const byText: PageSeen[] = pages.map((p) => ({ text: p.text, title: p.titleText, kind: textKind(p) }));
      if (isCivilSet(byText)) {
        setState((s) => ({ ...s, status: "failed", pages: pages.length, skipped: left, error: noFloorPlanText(byText, true) }));
        return { status: "failed", house: null, envelope: null };
      }
      setState((s) => ({ ...s, status: "reading", pages: pages.length, skipped: left }));
      const session = await startPlanSession();
      if (!alive()) return null;
      if (!session.ok) {
        const msg = reportPlanLimitResult(session) ? "You have used this month's estimator runs." : session.error;
        setState((s) => ({ ...s, status: "failed", error: msg }));
        return { status: "failed", house: null, envelope: null };
      }
      const tok = session.token;

      // What each sheet is: its own words when they name it, else a first look.
      const kinds = new Map<number, SheetKind | null>();
      const unknown: PlanPage[] = [];
      for (const p of pages) {
        const k = textKind(p);
        if (k) kinds.set(p.page, k);
        else unknown.push(p);
      }
      await pool(unknown, SKIM_AT_ONCE, async (p) => {
        try {
          const images = await p.glance();
          const res = await skimPlanSheet({ token: tok, page: p.page, pages: pages.length, images: images.map((url) => ({ url })) });
          kinds.set(p.page, res.ok && !(res.skim.kind === "other" && !res.skim.contents.length && !res.skim.title) ? res.skim.kind : null);
        } catch {
          kinds.set(p.page, null); // read in full: better a sheet too many than the energy table missed
        }
      });
      if (!alive()) return null;

      // The sheets the load rests on, the most useful first; elevations, sections, foundation and roof read light.
      const queue = pages.filter((p) => {
        const k = kinds.get(p.page) ?? null;
        return k === null || LOAD_KINDS.has(k);
      });
      queue.sort((a, b) => readRank(kinds.get(a.page)) - readRank(kinds.get(b.page)) || a.page - b.page);
      setState((s) => ({ ...s, total: queue.length }));
      const sheets: SheetRead[] = [];
      let failed = 0;
      await pool(queue, READ_AT_ONCE, async (p) => {
        let light = readsLight(kinds.get(p.page) ?? null);
        for (let attempt = 0; attempt < 3; attempt++) {
          if (!alive()) return;
          try {
            const { overview, tiles, grid } = await p.render({ light });
            const images = fitImages(overview, tiles);
            const res = await readPlanSheet({
              token: tok,
              page: p.page,
              pages: pages.length,
              fileName: p.fileName,
              textLayer: formatTextLayer(p.textItems),
              images: images.map((url) => ({ url })),
              grid: grid && images.length === tiles.length + 1 ? grid : null,
            });
            // A sheet read light that turns out to be a floor plan or a schedule is read again, close.
            if (res.ok && light && !readsLight(res.sheet.kind) && res.sheet.kind !== "detail") {
              light = false;
              continue;
            }
            if (res.ok) {
              sheets.push(res.sheet);
              break;
            }
          } catch {
            // one quiet retry, then the sheet is left out
          }
          if (attempt === 2) failed++;
        }
        if (alive()) setState((s) => ({ ...s, done: s.done + 1 }));
      });
      if (!alive()) return null;
      sheets.sort((a, b) => a.page - b.page);
      const takeoff = computeTakeoff(sheets);
      if (!takeoff.house.levels.length) {
        const readAs = new Map(sheets.map((x) => [x.page, x]));
        const why = noFloorPlanText(pages.map((p) => {
          const r = readAs.get(p.page);
          return { text: p.text, title: r?.title || p.titleText, kind: r?.kind ?? kinds.get(p.page) ?? null };
        }));
        setState((s) => ({ ...s, status: "failed", sheets, error: why }));
        return { status: "failed", house: takeoff.house, envelope: null };
      }
      const envelope = planEnvelopeOf(takeoff.house, sheets);
      setState((s) => ({ ...s, status: "done", sheets, house: takeoff.house, envelope, skipped: failed ? [...s.skipped, `${failed} sheet${failed === 1 ? "" : "s"} could not be read.`] : s.skipped }));
      return { status: "done", house: takeoff.house, envelope };
    } catch (e) {
      if (!alive()) return null;
      setState((s) => ({ ...s, status: "failed", error: clientErrorText(e, "The plans could not be read.") }));
      return { status: "failed", house: null, envelope: null };
    }
  }, []);

  return { ...state, pick, remove };
}

/** What the plans gave the load, in the panel's words — the house's own figures carry the "plan" chip below. */
export function planFacts(env: PlanEnvelope): string[] {
  const n = (v: number) => Math.round(v).toLocaleString("en-US");
  // The same count the model takes (lib/plans/hvacLoad planGlass): glass doors in, skylights apart.
  const g = planGlass(env);
  const e = env.energy;
  const doors = g.glassDoorCount + g.opaqueDoorCount;
  return [
    env.livingSqFt ? `${n(env.livingSqFt)} sq ft conditioned` : "",
    env.levels.length ? `${env.levels.length} floor${env.levels.length === 1 ? "" : "s"}` : "",
    g.windowCount ? `${g.windowCount} window${g.windowCount === 1 ? "" : "s"}` : "",
    g.totalSqft ? `${n(g.totalSqft)} sq ft of glass${g.glassDoorCount ? " with the glass doors" : ""}` : "",
    g.skylightSqft ? `${n(g.skylightSqft)} sq ft of skylight` : "",
    env.facades.length ? "glass by elevation" : "",
    env.frontFaces ? `front faces ${env.frontFaces}` : "",
    doors ? `${doors} exterior door${doors === 1 ? "" : "s"}` : "",
    e?.wallR ? `R-${e.wallR} walls` : "",
    e?.ceilingR ? `R-${e.ceilingR} ceiling` : "",
    e?.windowU ? `U-${e.windowU} glass` : "",
    e?.ach50 ? `${e.ach50} ACH50` : "",
    e?.ductLocation ? `ducts in the ${e.ductLocation === "conditioned" ? "conditioned space" : e.ductLocation}` : "",
    env.foundation,
    env.heatPump ? "heat pump house" : "gas heat",
    env.stated.tons ? `plans show ${env.stated.tons} t` : "",
  ].filter(Boolean);
}
