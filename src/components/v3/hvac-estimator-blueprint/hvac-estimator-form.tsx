"use client";

// HVAC estimator — the page's one flow, as five STEPS in one stepper
// (2026-09-20, the owner's rework of the layout — the engine, the ledger and
// the actions are untouched; only the markup and the styles moved):
//
//   1 JOB      what is being priced, grouped REPLACE · ADD · FIX
//   2 HOUSE    address → county design day, footprint, storeys, elevation,
//              with a list of what each source found and what defaulted
//   3 INTAKE   the video walk (with the filming guide), nameplate photos,
//              and the typed confirmations — each fact badged by its source
//   4 DESIGN   block load, the unit the catalog fits, the capacity chart,
//              the code / duct / electrical / gas checks, every assumption
//   5 ESTIMATE priced lines from the shop's rate card, editable, then
//              Save / Convert to proposal
//   + RECENT   the org's last estimates, to reopen (after the stepper)
//
// One step is open at a time under a sticky rail of all five (the owner's
// pick of two layouts, second pass 2026-09-20): a finished step shows its
// one-line summary in the rail, the next stays locked, with its reason, until
// the current one is filled. A summary of job · house · size · price sits
// beside the steps (a bar under them on a phone).
//
// The building model is DERIVED, never stored as state: site facts → era
// defaults → the walk's reading → each plate → the typed answers, in that
// order, every render. So a typed answer always wins, a re-read walk never
// clobbers a photo, and the engine (pure, src/lib/hvac) re-runs as you type.

import * as React from "react";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import { toast } from "@/components/ui/Toast";
import { attachPlacesSuggest, type PickedPlace } from "@/components/v3/blueprint-shell/places-suggest";
import { ensureWithinLimit, reportPlanLimit, reportPlanLimitResult } from "@/stores/usePlanLimitStore";
import { VIDEO_ACCEPT, fmtClock, stripFrames } from "@/components/v3/video-estimator-blueprint/video-ingest";
import type { WalkthroughAnalysis } from "@/lib/estimate/video-schema";
import type { BuildingModel, CatalogItem, EngineResult, Provenance } from "@/lib/hvac/types";
import { runEngine } from "@/lib/hvac/engine";
import { nextSteps, planFor, type FixAction } from "@/lib/hvac/fixes";
import { countiesFor } from "@/lib/hvac/designConditions";
import { CATALOG_CSV_COLUMNS, DEFAULT_RATE_CARD, buildLedger, normalizeRateCard, tiersFor, waterHeaterOptions, type HvacRateCard, type LedgerLine } from "@/lib/hvac/ledger";
import { offForState, stateName } from "@/lib/hvac/catalogView";
import { fixFieldSpec } from "@/lib/hvac/fieldSpecs";
import { addMissingUsRows } from "@/actions/hvacCatalog";
import { DEFAULT_JOB, JOBS, jobDef, type JobInput, type JobKind , type OutdoorKind } from "@/lib/hvac/jobs";
import { applyNameplate, applyStated, applyStatedNested, applyTypedModelNumber, applyWalkthrough, modelFromSite, type NameplateRead, type SiteFacts } from "@/lib/hvac/intake";
import { designConditionsFor } from "@/lib/hvac/designConditions";
import {
  attachHvacPermitReport,
  clearHvacCatalog,
  convertHvacEstimateToProposal,
  getHvacEstimate,
  getHvacRateCard,
  hvacCalibration,
  hvacPermitStatus,
  hvacSiteFacts,
  importHvacCatalogCsv,
  listHvacCatalog,
  listHvacEstimates,
  loadUsCatalog,
  readHvacNameplate,
  saveHvacCatalogItem,
  saveHvacServiceTask,
  recordHvacActual,
  requestHvacPermitReport,
  saveHvacEstimate,
  saveHvacRateCard,
  type HvacEstimateSummary,
  type HvacPermit,
} from "@/actions/hvacEstimator";
import { calibrationLine, type CalibrationStats } from "@/lib/hvac/calibration";
import { startEstimateFromLead } from "@/actions/leadEstimate";
import type { WaitingLead } from "@/lib/leadRules";
import Link from "next/link";
import type { Route } from "next";
import { useHvacWalk } from "./use-hvac-walk";
import { SHOTS, TIPS, coverageFor } from "./filming-guide";
import { indexedLabor, repairAdvice, serviceLaborIndex, serviceMenuFor } from "@/lib/hvac/serviceMenu";
import { setHvacServiceOverride } from "@/actions/hvacServices";
import { US_CATALOG } from "@/lib/hvac/data/usCatalog";
import { ultraLowNoxNeeded } from "@/lib/hvac/data/rules";
import { CapacityChart } from "./capacity-chart";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import s from "./hvac-estimator.module.css";
// The estimate rows ride on the manual builder's line block — its grid, its
// 36px fields, its column heads, its kill and add controls — so the two
// sheets read as one. Only the column set (no material/labor split here) and
// the text-at-rest cells are this page's own.
import lv from "@/components/v3/manual-card-lab/lines-v2/lines-v2.module.css";
import { InventoryLinkChoice } from "@/components/v3/inventory-link/inventory-link-choice";

function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).map((n) => (s as Record<string, string>)[n as string] ?? (n as string)).join(" ");
}

const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];
const num = (n: number, d = 0) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
/** The estimate's own format: two places and separators, everywhere on the sheet. */
const money2 = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const dateShort = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const RATE_CARD_KEY = "jf.hvac.rateCard.v1";

/** The two-letter state an address ends with ("…, TX 75034" / "…, WA"), or "". */
function stateOfAddress(addr: string): string {
  return ((addr.match(/\b([A-Z]{2})\b(?=\s*\d{5}|\s*$)/) ?? [])[1] ?? "").toUpperCase();
}

type SlotKey = "outdoor" | "indoor" | "panel";
interface Slot { thumb: string; read?: NameplateRead; busy?: boolean; error?: string }
const SLOTS: Array<{ key: SlotKey; title: string; sub: string; hint: "outdoor" | "indoor" | "panel" }> = [
  { key: "outdoor", title: "Outdoor plate", sub: "Condenser or heat pump nameplate, straight on", hint: "outdoor" },
  { key: "indoor", title: "Indoor plate", sub: "Furnace or air handler nameplate", hint: "indoor" },
  { key: "panel", title: "Panel", sub: "Door open, main breaker in frame", hint: "panel" },
];

const getPath = (m: BuildingModel, path: string): unknown => {
  const [g, f] = path.split(".");
  if (!f) return (m as unknown as Record<string, unknown>)[g];
  return ((m as unknown as Record<string, Record<string, unknown>>)[g] ?? {})[f];
};

async function fileToJpegDataUrl(file: File, max = 1600): Promise<string> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * scale));
    c.height = Math.max(1, Math.round(bmp.height * scale));
    c.getContext("2d")?.drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } catch {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(new Error("Couldn't read that photo."));
      r.readAsDataURL(file);
    });
  }
}

// ── the phone ───────────────────────────────────────────────────────────────

/** True at the handheld width (the stylesheet's own 860px break). A media
 *  query, not the user agent; false on the server and until the client is up. */
function usePhone(): boolean {
  return React.useSyncExternalStore(
    (cb) => { const m = window.matchMedia("(max-width: 860px)"); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia("(max-width: 860px)").matches,
    () => false,
  );
}

/* A Recent row on a phone is two lines, so both are cut to what a line can
   hold: the title loses the address it repeats ("… — 4518 Bluestem Hollow
   Dr"), and the meta says the town, not the street, the day without the
   year, the status and the size — the job is already in the title. */
const shortTitle = (r: HvacEstimateSummary) => (r.title || r.address).split(" — ")[0];
function shortMeta(r: HvacEstimateSummary): string {
  const parts = r.address.split(",").map((x) => x.trim()).filter((x) => x && !/^(usa|united states)$/i.test(x));
  const town = parts.length >= 3 ? `${parts[parts.length - 2]}, ${(parts[parts.length - 1] ?? "").split(" ")[0]}` : parts[0];
  const day = new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const status = r.status ? r.status.charAt(0).toUpperCase() + r.status.slice(1).toLowerCase() : "";
  return [town, day, status, r.sizedTons ? `${r.sizedTons} T` : ""].filter(Boolean).join(" · ");
}

/* The estimate line, edited in the sheet Financials uses for its forms — the
   phone's way; the desktop keeps the inline row. The draft is the sheet's
   own: Cancel leaves the estimate exactly as it was, Done writes it once. */
function LineSheet({ line, isNew, onDone, onRemove, onClose }: { line: LedgerLine; isNew?: boolean; onDone: (p: Pick<LedgerLine, "name" | "quantity" | "unit" | "unitPrice">) => void; onRemove?: () => void; onClose: () => void }) {
  const [name, setName] = React.useState(line.name);
  const [qty, setQty] = React.useState(isNew ? "1" : String(line.quantity));
  const [unit, setUnit] = React.useState(line.unit);
  const [price, setPrice] = React.useState(isNew ? "" : line.unitPrice.toFixed(2));
  const q = Number(qty.replace(/,/g, ""));
  const p = Number(price.replace(/[$,]/g, ""));
  const ok = name.trim() !== "" && qty.trim() !== "" && Number.isFinite(q) && q >= 0 && Number.isFinite(p) && p >= 0;
  return (
    <BlueprintSheet
      open
      onClose={onClose}
      title={isNew ? "Add line" : "Edit line"}
      footer={
        <div className={cx("ls-foot")}>
          {onRemove ? <button type="button" className={cx("ls-remove")} onClick={onRemove}>Remove line</button> : <span />}
          <span className={cx("ls-foot-r")}>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="bps-btn bps-btn--primary" disabled={!ok} onClick={() => onDone({ name: name.trim(), quantity: q, unit: unit.trim() || "each", unitPrice: Math.round(p * 100) / 100 })}>Done</button>
          </span>
        </div>
      }
    >
      <div className="bps-form">
        <label className="bps-fld bps-fld--wide"><span>Item</span><textarea className={`bps-in ${cx("ls-ta")}`} rows={3} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className={`bps-fld ${cx("ls-half")}`}><span>Qty</span><input className={`bps-in ${cx("ls-num")}`} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <label className={`bps-fld ${cx("ls-half")}`}><span>Unit</span><input className="bps-in" value={unit} onChange={(e) => setUnit(e.target.value)} /></label>
        <label className="bps-fld bps-fld--wide"><span>Unit price</span><input className={`bps-in ${cx("ls-num")}`} inputMode="decimal" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} onBlur={() => { if (price.trim() !== "" && Number.isFinite(p)) setPrice(p.toFixed(2)); }} /></label>
        <div className={cx("ls-total")}><span>Line total</span><b>{money2(Number.isFinite(q) && Number.isFinite(p) ? q * p : 0)}</b></div>
      </div>
    </BlueprintSheet>
  );
}

// ── the stepper ─────────────────────────────────────────────────────────────

type StepKey = "job" | "house" | "intake" | "design" | "estimate";
type IntakeMode = "walk" | "plates" | "type";
/** The quickest way in for a job: the walk where the whole house has to be
 *  read, the plates where only the equipment does, typing where the job asks
 *  for two or three facts. */
function defaultModeFor(def: ReturnType<typeof jobDef>): IntakeMode {
  if (def.needs.load && def.shots.length >= 4) return "walk";
  if (def.needs.existing) return "plates";
  return "type";
}
const STEP_IDS: Record<StepKey, string> = { job: "hv-job", house: "hv-site", intake: "hv-intake", design: "hv-design", estimate: "hv-ledger" };
interface StepMeta { n: number; title: string; lead: string; summary: string; done: boolean; locked: boolean; reason: string }

/* The job tiles, grouped by what the visit does. Icons are the shell sprite's
   own symbols — the page adds none of its own. */
const JOB_GROUPS: Array<{ k: string; ids: JobKind[] }> = [
  { k: "Replace", ids: ["replace-system", "replace-outdoor", "replace-furnace", "heat-pump-conversion", "water-heater"] },
  { k: "Add", ids: ["add-ac", "ductless"] },
  { k: "Fix", ids: ["ducts", "service"] },
];
const JOB_ICONS: Record<JobKind, string> = {
  "replace-system": "i-heatpump", "replace-outdoor": "i-box", "replace-furnace": "i-target", "heat-pump-conversion": "i-heatpump", "water-heater": "i-hourglass",
  "add-ac": "i-plus", ductless: "i-grid", ducts: "i-link", service: "i-gear",
};

/* One step of the stepper: only the open one is on the page; the rail above
   carries the rest. The body stays mounted — the address field's suggestions
   and the walk's clip live in it — and is hidden, not removed. */
function Step({ k, meta, open, children }: { k: StepKey; meta: StepMeta; open: boolean; children: React.ReactNode }) {
  return (
    <section className={cx("st", open && "st-open")} id={STEP_IDS[k]} hidden={!open} aria-current={open ? "step" : undefined}>
      <div className={cx("st-h")}>
        <span className={cx("st-n")} aria-hidden="true">{meta.n}</span>
        <span className={cx("st-t")}>
          <span className={cx("st-title")}>{meta.title}</span>
          <span className={cx("st-lead")}>{meta.lead}</span>
        </span>
      </div>
      <div className={cx("st-b")}>{children}</div>
    </section>
  );
}

/* The rail: all five steps in one sticky strip, the open one marked, finished
   ones with their summary, locked ones greyed with the reason. */
function Rail({ steps, cur, onGo }: { steps: Array<[StepKey, StepMeta]>; cur: StepKey; onGo: (k: StepKey) => void }) {
  return (
    <ol className={cx("rail")} aria-label="Steps">
      {steps.map(([k, m]) => (
        <li key={k} className={cx("rail-i", cur === k && "on", m.done && "done", m.locked && "locked")}>
          <button type="button" className={cx("rail-b")} disabled={m.locked} onClick={() => onGo(k)} aria-current={cur === k ? "step" : undefined} title={m.locked ? m.reason : undefined}>
            <span className={cx("st-n")} aria-hidden="true">{m.done && cur !== k ? <svg className={cx("ic")}><use href="#i-check" /></svg> : m.n}</span>
            <span className={cx("rail-t")}>
              <span className={cx("rail-title")}>{m.title}</span>
              <span className={cx("rail-s")}>{cur === k ? "Now" : m.locked ? m.reason : m.done ? m.summary : "Next"}</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

// ── small parts ─────────────────────────────────────────────────────────────

function Chip({ p }: { p?: Provenance }) {
  if (!p) return null;
  return <span className={cx("chip", `chip-${p.source}`)} title={p.note}>{p.source}</span>;
}

type FieldKind = "num" | "text" | "select" | "bool";
function Field({ label, path, model, kind, options, onChange, placeholder, step, area, idPrefix = "hv-" }: {
  label: string; path: string; model: BuildingModel; kind: FieldKind;
  options?: Array<[string, string]>; onChange: (path: string, v: unknown) => void; placeholder?: string; step?: string;
  /** An area in square inches: "20x25" / "20 × 25" typed here is multiplied out (2026-10-08 — it used to be dropped as not a number). */
  area?: boolean;
  /** The same field drawn inside a check row (2026-10-10) carries its own id — the hidden intake step keeps the "hv-" one. */
  idPrefix?: string;
}) {
  const raw = getPath(model, path);
  const p = model.provenance[path];
  const id = `${idPrefix}${path.replace(/\./g, "-")}`;
  if (kind === "bool") {
    return (
      <label className={cx("field")} htmlFor={id}>
        <span className={cx("lbl")}><span>{label}</span><Chip p={p} /></span>
        <span className={cx("bp-sel", "hvsel")}><select id={id} className={cx("bp-sel-in", "sel")} value={raw === true ? "yes" : raw === false ? "no" : ""} onChange={(e) => onChange(path, e.target.value === "yes" ? true : e.target.value === "no" ? false : undefined)}>
          <option value="">not seen</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select></span>
      </label>
    );
  }
  return (
    <label className={cx("field")} htmlFor={id}>
      <span className={cx("lbl")}><span>{label}</span><Chip p={p} /></span>
      {kind === "select" ? (
        <span className={cx("bp-sel", "hvsel")}><select id={id} className={cx("bp-sel-in", "sel")} value={raw === undefined || raw === null ? "" : String(raw)} onChange={(e) => onChange(path, e.target.value === "" ? undefined : options?.find(([v]) => v === e.target.value)?.[0] ?? e.target.value)}>
          <option value="">—</option>
          {options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select></span>
      ) : (
        <input
          id={id}
          className={cx("in", kind === "num" && "num")}
          inputMode={kind === "num" ? "decimal" : undefined}
          step={step}
          placeholder={placeholder}
          defaultValue={raw === undefined || raw === null || raw === 0 ? "" : String(raw)}
          key={`${id}:${String(raw ?? "")}:${p?.source ?? ""}`}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (kind === "num") {
              const wh = area ? v.match(/^(\d+(?:\.\d+)?)\s*(?:x|×|\*|by)\s*(\d+(?:\.\d+)?)$/i) : null;
              const n = wh ? Math.round(Number(wh[1]) * Number(wh[2])) : Number(v.replace(/,/g, ""));
              // Blank clears a typed answer (the plate or the record shows again); a
              // negative count, size or amperage is a typo, not a fact.
              if (v === "") { if (raw !== undefined && raw !== null) onChange(path, undefined); return; }
              if (Number.isFinite(n) && n >= 0 && n !== raw) onChange(path, n);
            } else if (v !== (raw ?? "")) onChange(path, v || undefined);
          }}
        />
      )}
    </label>
  );
}

/* The estimate's rows, on the manual builder's line block. At rest every row
   is TEXT — name, qty · unit, unit price and total in mono on the right, a
   hairline between rows. A click puts that one row into the builder's 36px
   fields; the kill sits at the row's end and shows on hover or in edit. One
   legend per section says where the prices came from; the row-by-row basis
   notes moved to "How this is priced". */
function LinesBlock({ title, rows, editing, onEdit, onChange, phone, onAddPhone }: { title: string; rows: LedgerLine[]; editing: string | null; onEdit: (id: string | null) => void; onChange: (rows: LedgerLine[]) => void; phone?: boolean; onAddPhone?: () => void }) {
  const sum = rows.reduce((a, r) => a + r.quantity * r.unitPrice, 0);
  const estimated = rows.some((r) => r.basis === "estimated");
  const patch = (id: string, p: Partial<LedgerLine>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  return (
    <div className={`${lv.block} ${cx("lines")}`}>
      <div className={cx("lines-h")}><span className={cx("kpi-lbl")}>{title}</span><span className={cx("lines-hint")}><svg className={cx("ic")}><use href="#i-pen" /></svg>{phone ? "Tap a line to edit it" : "Click a line to edit it"}</span><span className={cx("lines-sum")}>{money2(sum)}</span></div>
      <div className={`${lv.head} ${cx("lines-grid")}`} aria-hidden="true">
        <span className={lv.colHead}><span className={lv.colName}>Item</span></span>
        <span className={`${lv.colHead} ${lv.colHeadEnd}`}><span className={lv.colName}>Qty</span></span>
        <span className={lv.colHead}><span className={lv.colName}>Unit</span></span>
        <span className={`${lv.colHead} ${lv.colHeadEnd}`}><span className={lv.colName}>Unit price</span></span>
        <span className={`${lv.colHead} ${lv.colHeadEnd}`}><span className={lv.colName}>Total</span></span>
        <span />
      </div>
      {rows.map((r) => {
        const on = !phone && editing === r.id;
        const kill = <button type="button" className={`${lv.kill} ${cx("line-kill")}`} aria-label={`Remove ${r.name || "line"}`} onClick={(e) => { e.stopPropagation(); onChange(rows.filter((x) => x.id !== r.id)); if (on) onEdit(null); }}>×</button>;
        if (on) {
          return (
            <div key={r.id} className={`${lv.line} ${cx("lines-grid", "line-edit")}`} role="group" aria-label={r.name || "Line"} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onEdit(null); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") onEdit(null); }}>
              <input className={`${lv.f} ${lv.fText}`} value={r.name} aria-label="Item" autoFocus onChange={(e) => patch(r.id, { name: e.target.value })} />
              <NumCell className={`${lv.f} ${lv.fNum}`} value={r.quantity} ariaLabel="Quantity" onCommit={(n) => patch(r.id, { quantity: n })} />
              <input className={`${lv.f} ${lv.fText}`} value={r.unit} aria-label="Unit" onChange={(e) => patch(r.id, { unit: e.target.value })} />
              <NumCell className={`${lv.f} ${lv.fNum}`} value={r.unitPrice} ariaLabel="Unit price" onCommit={(n) => patch(r.id, { unitPrice: n })} />
              <span className={cx("line-total")}>{money2(r.quantity * r.unitPrice)}</span>
              <span className={cx("line-acts")}><button type="button" className={cx("line-done")} onClick={() => onEdit(null)}>Done</button>{kill}</span>
            </div>
          );
        }
        return (
          <div key={r.id} className={cx("lines-grid", "line-txt")} role="button" tabIndex={0} title={r.note ?? undefined} onClick={() => onEdit(r.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEdit(r.id); } }}>
            <span className={cx("line-name")}>{r.name || <i>Unnamed line</i>}</span>
            <span className={cx("line-num")}>{r.quantity.toLocaleString("en-US")}</span>
            <span className={cx("line-unit")}>{r.unit}</span>
            <span className={cx("line-num")}>{money2(r.unitPrice)}</span>
            <span className={cx("line-total")}>{money2(r.quantity * r.unitPrice)}</span>
            <span className={cx("line-acts")}><span className={cx("line-pen")} aria-hidden="true"><svg className={cx("ic")}><use href="#i-pen" /></svg></span>{kill}</span>
          </div>
        );
      })}
      <button type="button" className={`${lv.add} ${cx("line-add")}`} onClick={() => { if (phone) { onAddPhone?.(); return; } const id = nanoid(6); onChange([...rows, { id, name: "", quantity: 1, unitPrice: 0, unit: "each", basis: "entered" }]); onEdit(id); }}><span className={lv.addMark} aria-hidden="true">+</span>Add line</button>
      {estimated && <div className={cx("lines-legend")}>Prices estimated from the rate card — import your catalog for shop costs.</div>}
    </div>
  );
}

function NumCell({ value, onCommit, ariaLabel, className }: { value: number; onCommit: (n: number) => void; ariaLabel: string; className?: string }) {
  const [txt, setTxt] = React.useState(String(value));
  const [seen, setSeen] = React.useState(value);
  if (value !== seen) {
    setSeen(value);
    if (Number(txt) !== value) setTxt(String(value));
  }
  return (
    <input
      className={className ?? cx("bo-in", "num")}
      inputMode="decimal"
      value={txt}
      aria-label={ariaLabel}
      onChange={(e) => {
        const v = e.target.value;
        setTxt(v);
        const n = Number(v.replace(/,/g, ""));
        if (v.trim() !== "" && Number.isFinite(n) && n >= 0) onCommit(n);
      }}
      onBlur={() => { if (txt.trim() === "" || !Number.isFinite(Number(txt))) setTxt(String(value)); }}
    />
  );
}

// ── the form ────────────────────────────────────────────────────────────────

export function HvacEstimatorForm({ aiEnabled, initialAddress, leads = [] }: { aiEnabled: boolean; initialAddress?: string; leads?: WaitingLead[] }) {
  const router = useRouter();

  // The stepper: which step is open. A client's record hands the page an
  // address, so it opens on the house with the address already in the field.
  const [cur, setCur] = React.useState<StepKey>(initialAddress ? "house" : "job");
  // Step 3's way in: one of three at a time. Picked by the job when the job
  // changes — the walk where the house must be read, the plates where the
  // equipment must be, typing where there is little to catch.
  const [mode, setMode] = React.useState<IntakeMode>("walk");
  // One check open at a time in the design step, one estimate row in edit.
  const [openCheck, setOpenCheck] = React.useState<string | null>(null);
  const [editLine, setEditLine] = React.useState<string | null>(null);
  const [svcQ, setSvcQ] = React.useState("");
  // The phone: three Recent rows until asked for all, a row's action sheet,
  // and the estimate line's sheet (an id, or a new line for one section).
  const phone = usePhone();
  const [recentAll, setRecentAll] = React.useState(false);
  // The recent list is folded until asked for (owner, 2026-09-22: "why do we
  // need recent estimates there"); recording an actual from the phone sheet
  // unfolds it so the fields are on screen.
  const [recentOpen, setRecentOpen] = React.useState(false);
  const [rowSheet, setRowSheet] = React.useState<string | null>(null);
  const [newLineFor, setNewLineFor] = React.useState<"materials" | "labor" | null>(null);
  const go = React.useCallback((k: StepKey) => {
    setCur(k);
    setTimeout(() => document.getElementById(STEP_IDS[k])?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }, []);

  // 0 · the job
  const [job, setJob] = React.useState<JobKind>(DEFAULT_JOB);
  const [jobInput, setJobInput] = React.useState<JobInput>({});
  const def = jobDef(job);
  React.useEffect(() => { setMode(defaultModeFor(def)); }, [def]);
  const setWh = (patch: Partial<NonNullable<JobInput["wh"]>>) => {
    setJobInput((j) => ({ ...j, wh: { ...(j.wh ?? {}), ...patch } }));
    // A new fuel or type is a different appliance: the maker is picked again.
    if ("fuel" in patch || "type" in patch) { setPickId(null); setCustom(null); }
  };
  const setSvc = (patch: Partial<NonNullable<JobInput["service"]>>) => setJobInput((j) => ({ ...j, service: { ...(j.service ?? {}), ...patch } }));
  const toggleTask = (id: string) => setJobInput((j) => {
    const cur = j.service?.tasks ?? [];
    const on = cur.includes(id);
    const tasks = on ? cur.filter((x) => x !== id) : [...cur, id];
    // Turning the recharge off clears its pounds.
    return { ...j, service: { ...(j.service ?? {}), tasks, ...(id === "recharge" && on ? { refrigerantLb: undefined } : {}) } };
  });
  const [svcDraft, setSvcDraft] = React.useState<Record<string, string>>({});
  const [svcMsg, setSvcMsg] = React.useState("");
  const svcDraftTask = () => {
    const name = (svcDraft.name ?? "").trim();
    const labor = Number(svcDraft.labor);
    if (!name || !Number.isFinite(labor) || labor < 0) return null;
    const partCost = Number(svcDraft.partCost);
    return { name, laborUsd: Math.round(labor), partName: (svcDraft.partName ?? "").trim() || undefined, partCost: Number.isFinite(partCost) && partCost > 0 ? Math.round(partCost) : undefined };
  };
  const addCustomTask = () => {
    const t = svcDraftTask();
    if (!t) { setSvcMsg("A name and a labor price, at least."); return; }
    setSvc({ custom: [...(jobInput.service?.custom ?? []), t] });
    setSvcDraft({});
    setSvcMsg(`${t.name} is on this estimate.`);
  };
  const saveCustomTask = async () => {
    const t = svcDraftTask();
    if (!t) { setSvcMsg("A name and a labor price, at least."); return; }
    setSvcMsg("Saving…");
    const res = await saveHvacServiceTask({ title: t.name, laborUsd: t.laborUsd, partName: t.partName, partCost: t.partCost });
    if (!res.ok) { setSvcMsg(res.error); return; }
    setCard({ card: res.card, own: true });
    setSvc({ tasks: [...(jobInput.service?.tasks ?? []).filter((x) => x !== res.id), res.id] });
    setSvcDraft({});
    setSvcMsg(`${t.name} is on your menu now, and on this estimate.`);
  };

  // 1 · site
  const addrRef = React.useRef<HTMLInputElement | null>(null);
  const [picked, setPicked] = React.useState<PickedPlace | null>(null);
  /** The ledger lines of a reopened estimate, adopted on the first render that has a design. */
  const savedLinesRef = React.useRef<{ materials: LedgerLine[]; labor: LedgerLine[] } | null>(null);
  /** The design (target tons, systems, kind) a hand pick was made against; a different design clears the pick. */
  const pickDesignRef = React.useRef<string>("");
  const [stateCode, setStateCode] = React.useState("");
  // True once the contractor picked the state by hand for the address in the box;
  // typing another address clears it, so a house in Texas is never judged under
  // the Washington rules the last address left in the select.
  const [statePicked, setStatePicked] = React.useState(false);
  const [county, setCounty] = React.useState("");
  const [countyPicked, setCountyPicked] = React.useState(false);
  const [site, setSite] = React.useState<SiteFacts | null>(null);
  /** True when the site was set from the typed address alone (no lookup). */
  const [siteLocal, setSiteLocal] = React.useState(false);
  const [siteWarnings, setSiteWarnings] = React.useState<string[]>([]);
  const [siteBusy, setSiteBusy] = React.useState(false);
  const [siteError, setSiteError] = React.useState("");

  // 2 · intake
  const walk = useHvacWalk(aiEnabled);
  const [analysis, setAnalysis] = React.useState<WalkthroughAnalysis | null>(null);
  const [plates, setPlates] = React.useState<Partial<Record<SlotKey, Slot>>>({});
  const [typed, setTyped] = React.useState<Record<string, unknown>>({});
  const [restored, setRestored] = React.useState<BuildingModel | null>(null);
  const [linesetFt, setLinesetFt] = React.useState<number | undefined>(undefined);
  // The filming guide folds away: it is a reference, not a step, and it sits
  // between the clip and the plates. It reopens on a tap and remembers.
  const [guideOpen, setGuideOpen] = React.useState(false);
  React.useEffect(() => {
    try { if (window.localStorage.getItem("jf.hvac.guideOpen") === "1") setGuideOpen(true); } catch { /* blocked storage */ }
  }, []);
  /** A unit the contractor picked over the engine's first choice (catalog id). */
  const [pickId, setPickId] = React.useState<string | null>(null);
  // Full system / outdoor unit: AC or heat pump outside. null = the engine's pick.
  const [outdoorKind, setOutdoorKind] = React.useState<OutdoorKind | null>(null);
  /** A unit the contractor typed because the catalog has nothing like it. */
  const [custom, setCustom] = React.useState<CatalogItem | null>(null);
  const [swapOpen, setSwapOpen] = React.useState(false);
  const [swapQ, setSwapQ] = React.useState("");
  const [swapMsg, setSwapMsg] = React.useState("");
  const [unitDraft, setUnitDraft] = React.useState<Record<string, string>>({});

  // shop data
  const [catalog, setCatalog] = React.useState<{ items: CatalogItem[]; own: boolean; source?: "shop" | "us" | "starter"; state?: string } | null>(null);
  const [card, setCard] = React.useState<{ card: HvacRateCard; own: boolean }>({ card: DEFAULT_RATE_CARD, own: false });
  const [cardDraft, setCardDraft] = React.useState<HvacRateCard | null>(null);
  const [cardMsg, setCardMsg] = React.useState("");
  const [catMsg, setCatMsg] = React.useState("");
  const [replaceCat, setReplaceCat] = React.useState(true);

  // 4 · ledger
  const [title, setTitle] = React.useState<string | null>(null);
  const [lines, setLines] = React.useState<{ key: string; materials: LedgerLine[]; labor: LedgerLine[] } | null>(null);
  const [savedId, setSavedId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [converting, setConverting] = React.useState(false);
  // Connected to the warehouse or an estimate only — null until the choice decides its default (2026-09-20).
  const [invLink, setInvLink] = React.useState<boolean | null>(null);
  const [recent, setRecent] = React.useState<HvacEstimateSummary[]>([]);
  const [calib, setCalib] = React.useState<CalibrationStats | null>(null);
  const [actualFor, setActualFor] = React.useState<string | null>(null);
  const [actualDraft, setActualDraft] = React.useState<{ tons: string; price: string; notes: string }>({ tons: "", price: "", notes: "" });
  // permit-grade report
  const [permitEnabled, setPermitEnabled] = React.useState(false);
  const [permit, setPermit] = React.useState<HvacPermit | null>(null);
  const [reportUrl, setReportUrl] = React.useState<string | null>(null);
  const [permitBusy, setPermitBusy] = React.useState(false);
  const [permitMsg, setPermitMsg] = React.useState("");
  const [linkDraft, setLinkDraft] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    void listHvacCatalog().then((c) => { if (alive) setCatalog(c); }).catch(() => { if (alive) setCatalog({ items: [], own: false, source: "starter" }); });
    void getHvacRateCard().then((c) => {
      if (!alive) return;
      if (c.own) setCard(c);
      else {
        try {
          const local = window.localStorage.getItem(RATE_CARD_KEY);
          if (local) setCard({ card: normalizeRateCard(JSON.parse(local)), own: false });
        } catch { /* keep defaults */ }
      }
    }).catch(() => undefined);
    void listHvacEstimates().then((r) => { if (alive) setRecent(r); }).catch(() => undefined);
    void hvacCalibration().then((c) => { if (alive) setCalib(c); }).catch(() => undefined);
    void hvacPermitStatus().then((p) => { if (alive) setPermitEnabled(p.enabled); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  const refreshRecent = React.useCallback(() => {
    void listHvacEstimates().then(setRecent).catch(() => undefined);
    void hvacCalibration().then(setCalib).catch(() => undefined);
  }, []);

  React.useEffect(() => {
    const el = addrRef.current;
    if (!el) return;
    return attachPlacesSuggest(el, {
      onPick: (p) => {
        setPicked(p);
        if (p.state) setStateCode(p.state.toUpperCase());
      },
      onError: (msg) => toast.error("Address lookup", msg),
    });
  }, []);

  // ── derived model, engine, ledger ─────────────────────────────────────────
  const model = React.useMemo<BuildingModel | null>(() => {
    if (!site) return null;
    const m = restored ? (structuredClone(restored) as BuildingModel) : modelFromSite(site);
    // The state and county selects correct what the lookup guessed, and the
    // state decides which code rules the job answers to — not just the design day.
    if (stateCode && stateCode !== m.state) { m.state = stateCode; m.county = county || ""; }
    if (county && county !== m.county) m.county = county;
    if (analysis) applyWalkthrough(m, analysis);
    for (const k of ["outdoor", "indoor", "panel"] as SlotKey[]) {
      const r = plates[k]?.read;
      if (!r) continue;
      if (k === "panel") {
        if (r.mcaAmps && [60, 100, 125, 150, 200, 225, 400].includes(r.mcaAmps)) applyStatedNested(m, "electrical.mainAmps", r.mcaAmps);
        const slots = r.notes?.match(/(\d+)\s*(free|open|spare)/i);
        if (slots) applyStatedNested(m, "electrical.freeSlots", Number(slots[1]));
        if (m.provenance["electrical.mainAmps"]) m.provenance["electrical.mainAmps"] = { source: "read", confidence: r.confidence, note: "panel photo" };
        if (m.provenance["electrical.freeSlots"] && slots) m.provenance["electrical.freeSlots"] = { source: "read", confidence: r.confidence, note: "panel photo" };
      } else applyNameplate(m, r);
    }
    // The typed model number decodes first, so a typed tonnage still wins.
    if (typeof typed["existing.model"] === "string" && typed["existing.model"]) applyTypedModelNumber(m, typed["existing.model"]);
    for (const [path, v] of Object.entries(typed)) {
      if (v === undefined) continue;
      if (path.includes(".")) applyStatedNested(m, path, v);
      else applyStated(m, path as keyof BuildingModel, v as never);
    }
    return m;
  }, [site, restored, stateCode, county, analysis, plates, typed]);

  const conditions = React.useMemo(() => (model ? designConditionsFor(model.state, model.county, model.elevationFt ?? 0) : null), [model]);
  const ready = !!model && (!def.needs.load || (def.needs.zone ? (jobInput.zoneSqft ?? 0) > 0 : model.conditionedSqft > 0));
  // Everything downstream reads one list: the shop's rows plus the unit the
  // contractor typed for this estimate.
  // Rows the shop turned off on the catalog page (offList) never reach the engine; a typed unit always does.
  const catalogItems = React.useMemo(() => { const live = (catalog?.items ?? []).filter((c) => !c.offList); return custom ? [...live.filter((c) => c.id !== custom.id), custom] : live; }, [catalog, custom]);
  const engineRaw = React.useMemo<EngineResult | null>(() => (model && catalog && ready ? runEngine(model, { catalog: catalogItems, job, input: jobInput, outdoorKind: outdoorKind ?? undefined }) : null), [model, catalog, catalogItems, ready, job, jobInput, outdoorKind]);
  // AC or heat pump outside, each priced as the whole job at its Better tier,
  // when the job allows both and the catalog fits both.
  const kindQuotes = React.useMemo(() => {
    if (!model || !catalog || !ready || !(def.id === "replace-outdoor" || def.id === "replace-system") || model.existing.kind === "package-unit") return [];
    return (["air-conditioner", "heat-pump"] as const).flatMap((kind) => {
      const r0 = runEngine(model, { catalog: catalogItems, job, input: jobInput, outdoorKind: kind });
      // The engine fell back to the other kind: this one is not on offer.
      if (!r0.selection.chosen || r0.selection.chosen.item.kind !== kind) return [];
      const fits = r0.selection.candidates.filter((c) => !c.disqualified && c.item.kind === kind);
      const base = fits.filter((c) => c.item.tier === "mid").sort((a, b) => b.score - a.score)[0] ?? r0.selection.chosen;
      const r = base.item.id === r0.selection.chosen.item.id ? r0 : runEngine(model, { catalog: catalogItems, job, input: jobInput, outdoorKind: kind, pick: base.item.id });
      const l = buildLedger(r, model, card.card, catalogItems, { job, input: jobInput, linesetFt });
      const furnace = l.materials.some((x) => x.id === "eq-furnace");
      const airHandler = l.materials.some((x) => x.id === "eq-ah");
      const hpHouse = model.existing.kind === "split-heat-pump";
      const sub = kind === "air-conditioner"
        ? (def.id === "replace-outdoor" ? (hpHouse ? "in place of the heat pump — heating falls to the backup heat" : "like for like — the indoor unit stays") : furnace ? "AC + gas furnace" : "AC + air handler, electric heat")
        : def.id === "replace-outdoor" && hpHouse ? (r.dualFuel ? "like for like — dual fuel, the furnace stays as backup" : "like for like — the air handler stays")
        : r.dualFuel ? "dual fuel — the furnace stays as backup" : airHandler ? "heat pump + air handler, all-electric" : "on the existing air handler";
      return [{ kind, subtotal: l.subtotal, sub, unit: base.item }];
    });
  }, [model, catalog, catalogItems, ready, def.id, job, jobInput, card, linesetFt]);
  // The unit on the estimate: the contractor's pick (a unit the engine ruled
  // out included), else the Better tier as the base quote when the catalog has
  // tiers, else the engine's own first choice. The run is repeated for that
  // unit so the checks and the notes describe what is being sold.
  // The design a pick belongs to: when the load re-sizes the job (a new square
  // footage, a second system), a Good/Better/Best or swap pick made against
  // the old design is dropped, and the panel says so, rather than the old unit
  // quietly staying on the estimate as the "Best" it no longer is.
  const pickDesign = engineRaw ? `${engineRaw.selection.targetTons}|${engineRaw.selection.systems}|${engineRaw.selection.chosen?.item.kind ?? ""}` : "";
  if (def.needs.load && pickId && pickDesignRef.current && pickDesignRef.current !== pickDesign) {
    pickDesignRef.current = "";
    setPickId(null);
    setSwapMsg("The load changed, so the unit you had picked was let go — the engine's pick is back on the estimate; pick again if you want another.");
  }
  if (pickId && !pickDesignRef.current) pickDesignRef.current = pickDesign;
  const engine = React.useMemo<EngineResult | null>(() => {
    if (!engineRaw || !model) return engineRaw;
    const rerun = (id: string) => runEngine(model, { catalog: catalogItems, job, input: jobInput, outdoorKind: outdoorKind ?? undefined, custom: custom ?? undefined, pick: id });
    if (pickId) {
      if (engineRaw.selection.chosen?.item.id === pickId) return engineRaw;
      return engineRaw.selection.candidates.some((c) => c.item.id === pickId) ? rerun(pickId) : engineRaw;
    }
    const chosen = engineRaw.selection.chosen;
    if (!chosen) return engineRaw;
    const mid = engineRaw.selection.candidates.filter((c) => !c.disqualified && c.item.kind === chosen.item.kind && c.item.tier === "mid").sort((a, b) => b.score - a.score)[0];
    return mid && mid.item.id !== chosen.item.id ? rerun(mid.item.id) : engineRaw;
  }, [engineRaw, pickId, model, catalogItems, custom, job, jobInput, outdoorKind]);
  const ledger = React.useMemo(() => (engine && model && catalog ? buildLedger(engine, model, card.card, catalogItems, { job, input: jobInput, linesetFt, pick: pickId ?? undefined }) : null), [engine, model, catalog, catalogItems, card, job, jobInput, linesetFt, pickId]);
  // The service lines priced away from the menu on THIS estimate: a labor line
  // (l-svc-<task>) or a part line (m-svc-<task>) whose price is not what the
  // ledger wrote. Saving one puts the number on the shop's menu (the part as
  // a cost, the markup taken back off) and the ledger repeats it from then on.
  const [learnBusy, setLearnBusy] = React.useState<string | null>(null);
  const [learnMsg, setLearnMsg] = React.useState("");
  const menuDiffs = React.useMemo(() => {
    if (job !== "service" || !lines || !ledger) return [] as Array<{ lineId: string; kind: "l" | "m"; taskId: string; name: string; price: number }>;
    const base = new Map([...ledger.labor, ...ledger.materials].map((b) => [b.id, b.unitPrice]));
    return [...lines.labor, ...lines.materials].flatMap((l) => {
      const m = /^([lm])-svc-(.+)$/.exec(l.id);
      const b = base.get(l.id);
      if (!m || b === undefined || Math.abs(b - l.unitPrice) < 0.5 || !(l.unitPrice >= 0)) return [];
      return [{ lineId: l.id, kind: m[1] as "l" | "m", taskId: m[2], name: l.name, price: l.unitPrice }];
    });
  }, [job, lines, ledger]);
  const learnPrice = async (d: { lineId: string; kind: "l" | "m"; taskId: string; name: string; price: number }) => {
    setLearnBusy(d.lineId);
    setLearnMsg("");
    const res = await setHvacServiceOverride(d.kind === "l" ? { id: d.taskId, laborUsd: Math.round(d.price) } : { id: d.taskId, partCostUsd: Math.round(d.price / (1 + card.card.materialsMarkupPct / 100)) });
    setLearnBusy(null);
    if (!res.ok) { setLearnMsg(res.error); return; }
    setCard({ card: res.card, own: true });
    setLearnMsg(`${d.name} is ${money(d.price)} on your menu now.`);
  };

  // A service visit's other number (2026-09-22): what replacing the system
  // would cost here, from the same house, so the repair can be weighed.
  const replaceQuote = React.useMemo<number | null>(() => {
    if (job !== "service" || !model || !catalog || !(model.conditionedSqft > 0)) return null;
    try {
      const r = runEngine(model, { catalog: catalogItems, job: "replace-system", input: jobInput });
      return buildLedger(r, model, card.card, catalogItems, { job: "replace-system", input: jobInput }).subtotal;
    } catch {
      return null;
    }
  }, [job, model, catalog, catalogItems, jobInput, card]);
  // Good · Better · Best: the best fitting unit of each tier, priced as a whole job.
  const tiers = React.useMemo(() => (engineRaw && model && catalog ? tiersFor(engineRaw, model, card.card, catalogItems, { job, input: jobInput, linesetFt }, (id) => runEngine(model, { catalog: catalogItems, job, input: jobInput, outdoorKind: outdoorKind ?? undefined, custom: custom ?? undefined, pick: id })) : []), [engineRaw, model, catalog, catalogItems, custom, card, job, jobInput, linesetFt, outdoorKind]);

  // Every unit the contractor could put on this estimate: what the engine
  // ranked for a sized job, the catalog's tanks for a water-heater job. Rows
  // the engine ruled out stay on the list with their reason.
  const swapRows = React.useMemo(() => {
    const q = swapQ.trim().toLowerCase();
    const hit = (i: CatalogItem) => !q || `${i.brand} ${i.model}`.toLowerCase().includes(q);
    if (def.id === "water-heater") {
      const plan = engine?.waterHeater;
      // Only this job's kind of appliance is on the list: a gas tank is not an
      // option on a heat-pump job — the Type select is.
      const rows = catalogItems.filter((c) => c.kind === "water-heater" && hit(c) && (!plan || ((c.fuel ?? "gas") === plan.fuel && (c.whType ?? "tank") === plan.type)));
      return rows.map((item) => {
        const small = plan && plan.type !== "tankless" ? (item.gallons ?? 0) < plan.gallons : plan?.btuInput ? (item.btuInput ?? 0) < plan.btuInput : false;
        const out = small ? `Smaller than the ${plan && plan.type !== "tankless" ? `${plan.gallons} gal` : `${Math.round((plan?.btuInput ?? 0) / 1000)}k BTU/h`} the household sizes to.` : undefined;
        const why = [item.gallons ? `${item.gallons} gal` : "", item.btuInput ? `${Math.round(item.btuInput / 1000)}k BTU/h` : "", item.uef ? `${item.uef} UEF` : "", item.vent && item.vent !== "none" ? `${item.vent} vent` : ""].filter(Boolean).join(" · ");
        return { item, out, why, score: (item.gallons ?? item.btuInput ?? 0), miss: 0 };
      }).sort((a, b) => (a.out ? 1 : 0) - (b.out ? 1 : 0) || a.score - b.score);
    }
    const kind = engine?.selection.chosen?.item.kind;
    return (engine?.selection.candidates ?? [])
      .filter((c) => (!kind || c.item.kind === kind) && hit(c.item))
      .map((c) => ({
        item: c.item,
        out: c.disqualified,
        why: c.coolingRatio !== undefined ? `Cooling ${Math.round(c.coolingRatio * 100)}% of the load` : c.outputRatio !== undefined ? `Output ${Math.round(c.outputRatio * 100)}% of the load` : c.reasons[0] ?? "",
        score: c.score,
        // Ruled-out rows are ordered by how near they came, so the 4½-ton that
        // just missed is at the top and the 1½-ton is not.
        miss: Math.abs((c.coolingRatio ?? c.outputRatio ?? 0) - 1),
      }))
      .sort((a, b) => (a.out ? 1 : 0) - (b.out ? 1 : 0) || (a.out ? a.miss - b.miss : b.score - a.score));
  }, [engine, catalogItems, def.id, swapQ]);
  const swapFits = swapRows.filter((r) => !r.out);
  const swapOut = swapRows.filter((r) => r.out);
  const swapShown = [...swapFits.slice(0, 10), ...swapOut.slice(0, 6)];
  const chosenId = def.id === "water-heater" ? pickId : engine?.selection.chosen?.item.id ?? null;
  // "no cost" is worth saying only when the shop has priced some of its rows.
  const someCost = swapRows.some((r) => r.item.cost);

  /** The unit the contractor typed, as a catalog row. */
  const buildTypedUnit = (): CatalogItem | null => {
    const brand = (unitDraft.brand ?? "").trim();
    const modelNo = (unitDraft.model ?? "").trim();
    if (!brand || !modelNo) return null;
    const kind = (unitDraft.kind || engine?.selection.chosen?.item.kind || (def.id === "water-heater" ? "water-heater" : def.kinds[0]) || "air-conditioner") as CatalogItem["kind"];
    const n = (k: string) => { const v = Number(unitDraft[k]); return Number.isFinite(v) && v > 0 ? v : undefined; };
    const tons = n("tons");
    const kbtu = n("kbtu");
    const afue = n("afue");
    const cold = unitDraft.coldClimate === "yes";
    const item: CatalogItem = {
      id: `custom-${kind}-${brand}-${modelNo}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, ""),
      kind, brand, model: modelNo, typed: true, source: "shop",
      tons: kind === "furnace" || kind === "water-heater" ? undefined : tons,
      coolingBtuh: tons && !["furnace", "water-heater", "air-handler", "coil"].includes(kind) ? Math.round(tons * 12000) : undefined,
      btuInput: kbtu ? Math.round(kbtu * 1000) : undefined,
      afue: afue ? (afue > 1 ? afue / 100 : afue) : undefined,
      seer2: n("seer2"), hspf2: n("hspf2"), eer2: n("eer2"),
      refrigerant: (unitDraft.refrigerant || undefined) as CatalogItem["refrigerant"],
      staging: (unitDraft.staging || undefined) as CatalogItem["staging"],
      mcaAmps: n("mca"),
      cost: n("cost"),
      ahriRef: (unitDraft.ahri ?? "").trim() || undefined,
      ratedStaticInWc: kind === "furnace" || kind === "air-handler" || kind === "coil" ? 0.5 : undefined,
      maxTons: kind === "furnace" || kind === "air-handler" ? n("maxTons") ?? (kbtu ? (kbtu <= 45 ? 3 : kbtu <= 70 ? 4 : 5) : tons) : undefined,
      noxNgJ: kind === "furnace" || kind === "package" ? (unitDraft.nox === "14" ? 14 : 40) : undefined,
      gallons: kind === "water-heater" ? n("gallons") : undefined,
      whType: kind === "water-heater" ? ((unitDraft.whType || "tank") as CatalogItem["whType"]) : undefined,
      fuel: kind === "water-heater" ? ((unitDraft.fuel || "gas") as CatalogItem["fuel"]) : undefined,
      uef: kind === "water-heater" ? n("uef") : undefined,
      vent: kind === "water-heater" ? ((unitDraft.vent || undefined) as CatalogItem["vent"]) : undefined,
    };
    if ((kind === "heat-pump" || kind === "ductless") && tons) {
      const rated = Math.round(tons * 12000);
      item.coldClimate = cold || undefined;
      item.heat47Btuh = n("h47") ? Math.round((n("h47") ?? 0) * 1000) : rated;
      item.heat17Btuh = n("h17") ? Math.round((n("h17") ?? 0) * 1000) : Math.round(rated * (cold ? 0.85 : 0.62));
      item.heat5Btuh = n("h5") ? Math.round((n("h5") ?? 0) * 1000) : Math.round(rated * (cold ? 0.7 : 0.48));
    }
    return item;
  };
  const useTypedUnit = () => {
    const item = buildTypedUnit();
    if (!item) { setSwapMsg("Brand and model, at least — the rest can follow from the submittal."); return; }
    setCustom(item);
    setPickId(item.id);
    setSwapMsg(`${item.brand} ${item.model} is on the estimate. It is typed in, not a catalog row, so the checks say to confirm it against the submittal${item.cost ? "" : " and the price is a rate-card default until you add the cost"}.`);
  };
  const saveTypedUnit = async () => {
    const item = buildTypedUnit();
    if (!item) { setSwapMsg("Brand and model, at least — the rest can follow from the submittal."); return; }
    setSwapMsg("Saving…");
    const res = await saveHvacCatalogItem({ ...item, typed: undefined });
    if (!res.ok) { setSwapMsg(res.error); return; }
    setCatalog(await listHvacCatalog());
    setCustom(null);
    setPickId(res.item.id);
    setSwapMsg(`${res.item.brand} ${res.item.model} is in your catalog now, and on this estimate.`);
  };

  // Water heater: one tank per maker that fits the sized plan, each priced as
  // the whole job; the first is the engine's own pick unless one is chosen.
  const whOptions = React.useMemo(() => {
    if (def.id !== "water-heater" || !engine?.waterHeater || !model || !catalog) return [];
    return waterHeaterOptions(catalogItems, engine.waterHeater).slice(0, 4).map((item) => ({ item, subtotal: buildLedger(engine, model, card.card, catalogItems, { job, input: jobInput, linesetFt, pick: item.id }).subtotal }));
  }, [def.id, engine, model, catalog, catalogItems, card, job, jobInput, linesetFt]);
  // The shop's catalog came from an older build of the US list: rows it lacks,
  // and whether the NOx class is on its gas rows at all.
  const usStale = React.useMemo(() => {
    if (!catalog?.own) return null;
    const have = new Set(catalog.items.map((c) => c.id));
    const fromUs = catalog.items.filter((c) => c.id.startsWith("us-"));
    if (!fromUs.length) return null;
    const missing = US_CATALOG.filter((c) => !have.has(c.id));
    const noNox = fromUs.some((c) => (c.kind === "furnace" || (c.kind === "package" && c.heatKind === "gas")) && c.noxNgJ === undefined);
    return missing.length || noNox ? { missing: missing.length, noNox, uln: missing.filter((c) => (c.noxNgJ ?? 40) <= 14).length } : null;
  }, [catalog]);
  // No fit because every gas unit on the list is the 40 ng/J class in a
  // district that takes only 14: the catalog, not the house, is the wall.
  const noxWall = !!engine && !!model && !engine.selection.chosen && ultraLowNoxNeeded(model.state, model.county) === "required" && engine.selection.candidates.length > 0 && engine.selection.candidates.every((x) => (x.item.kind === "furnace" || (x.item.kind === "package" && x.item.heatKind === "gas")) && (x.item.noxNgJ ?? 40) > 14);
  const whChosen = def.id === "water-heater" ? (whOptions.find((o) => o.item.id === pickId)?.item ?? catalogItems.find((c) => c.id === pickId && c.kind === "water-heater") ?? whOptions[0]?.item ?? null) : null;

  // The editable lines follow the ledger until the contractor edits them, and
  // reset when the design behind them changes. Derived state, adopted in render.
  // The names are part of the key: a catalog swap that keeps the size and
  // the price still renames the unit, and the lines must follow.
  const ledgerKey = ledger ? `${ledger.subtotal}|${ledger.materials.map((l) => l.id + l.name + l.quantity).join(",")}|${ledger.labor.map((l) => l.id + l.name + l.quantity).join(",")}` : "";
  if (ledger && lines?.key !== ledgerKey) {
    const saved = savedLinesRef.current;
    savedLinesRef.current = null;
    setLines(saved ? { key: ledgerKey, materials: saved.materials, labor: saved.labor } : { key: ledgerKey, materials: ledger.materials, labor: ledger.labor });
  }

  const onTyped = React.useCallback((path: string, v: unknown) => setTyped((t) => ({ ...t, [path]: v })), []);
  /** A check's fix, done (2026-10-08): the field opened and focused (or set),
   *  the unit picked, the job switched, or the permit panel shown. */
  const runFix = React.useCallback((a: FixAction) => {
    if (a.kind === "field") {
      if (a.value !== undefined) onTyped(a.path, a.value);
      go("intake");
      window.setTimeout(() => {
        const el = document.getElementById(`hv-${a.path.replace(/\./g, "-")}`);
        if (!el) return;
        let d: HTMLElement | null = el.parentElement;
        while (d) { if (d instanceof HTMLDetailsElement) d.open = true; d = d.parentElement; }
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        if (a.value === undefined) el.focus();
      }, 120);
    } else if (a.kind === "pick") { setPickId(a.candidateId); setSwapMsg(""); }
    else if (a.kind === "job") { setJob(a.job); setPickId(null); setOutdoorKind(null); setCustom(null); setSwapMsg(""); setTitle(null); }
    else if (a.kind === "permit") { go("design"); window.setTimeout(() => document.getElementById("hv-permit")?.scrollIntoView({ behavior: "smooth", block: "center" }), 120); }
  }, [onTyped, go]);
  /** Arrow keys walk a radio strip and pick as they go (the APG radiogroup pattern). */
  const radioKeys = (e: React.KeyboardEvent<HTMLElement>) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const step = keys[e.key];
    if (!step) return;
    const radios = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const i = radios.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0 || radios.length < 2) return;
    e.preventDefault();
    const next = radios[(i + step + radios.length) % radios.length];
    next.focus();
    next.click();
  };

  // ── 1 · site lookup ───────────────────────────────────────────────────────
  /** The state a job runs under: the one picked for this address, else the
   *  one the address carries ("…, Frisco, TX 75034"), else the select. */
  const stateFor = (addr: string) => (statePicked && stateCode ? stateCode : stateOfAddress(addr) || stateCode);
  const lookupSite = async () => {
    const text = (addrRef.current?.value ?? "").trim();
    const full = picked?.formatted && picked.typed !== true ? picked.formatted : text;
    if (!full) { setSiteError("Enter the address first."); return; }
    if (!def.needs.load) {
      // A tank swap or a service call does not wait for the parcel: the form
      // is up at once on the address and the state, and the house record
      // (county, year built, area) fills in behind it when the lookup lands.
      const st = stateFor(full);
      if (!st) { setSiteError("Add the state to the address (e.g. WA)."); return; }
      const sameState = st === stateCode;
      const hadIntake = analysis || Object.keys(plates).length > 0 || Object.keys(typed).length > 0 || restored || pickId || Object.keys(jobInput).length > 0;
      const isSameHouse = site?.address === full;
      if (hadIntake && !isSameHouse && !window.confirm("Start over? The answers, plates and service picks for this house will be cleared.")) return;
      setSiteError("");
      setRestored(null); setPickId(null); setOutdoorKind(null); setCustom(null); setSwapMsg(""); setSavedId(null); setPermit(null); setReportUrl(null); setPermitMsg(""); setTitle(null);
      if (!isSameHouse) { setTyped({}); setAnalysis(null); setPlates({}); setJobInput({}); setLinesetFt(undefined); }
      setSite({ address: full, state: st, county: sameState && countyPicked && county ? county : undefined, sources: {} });
      setSiteLocal(true);
      setStateCode(st);
      if (!sameState) { setCounty(""); setCountyPicked(false); }
      setSiteWarnings([]);
      setTimeout(() => go("intake"), 60);
      setSiteBusy(true);
      try {
        const res = await hvacSiteFacts({ address: full, state: st, county: sameState && countyPicked && county ? county : undefined, lat: picked?.lat, lng: picked?.lng });
        // The contractor may have moved on to another address meanwhile.
        if ((addrRef.current?.value ?? "").trim() !== text) return;
        if (!res.ok) {
          // The card-less trial's ceiling says its own sentence and opens the dialog.
          if (reportPlanLimitResult(res)) { setSiteWarnings([res.error]); return; }
          setSiteWarnings([`House record not found for this address (${res.error}) — the job runs on the address and the state.`]);
          return;
        }
        setSite(res.facts);
        setSiteLocal(false);
        setStateCode(res.facts.state);
        setStatePicked(false);
        if (res.facts.county) {
          const hit = designConditionsFor(res.facts.state, res.facts.county);
          setCounty(hit.match === "county" || hit.match === "fuzzy" ? hit.conditions.county : res.facts.county);
        }
        setCountyPicked(false);
        setSiteWarnings(res.warnings);
      } catch (err) {
        setSiteWarnings([`House record not reached (${errMsg(err)}) — the job runs on the address and the state.`]);
      } finally {
        setSiteBusy(false);
      }
      return;
    }
    // A reopened estimate, a hand pick or a typed unit is as much work as a walk.
    const hasIntake = analysis || Object.keys(plates).length > 0 || Object.keys(typed).length > 0 || !!restored || !!pickId || !!custom || outdoorKind !== null;
    const sameHouse = site?.address === full;
    if (hasIntake && !sameHouse && !window.confirm("Start over? The walk, plates and typed answers for this house will be cleared.")) return;
    setSiteBusy(true);
    setSiteError("");
    try {
      const st = stateFor(full);
      const res = await hvacSiteFacts({ address: full, state: st || undefined, county: st === stateCode && countyPicked && county ? county : undefined, lat: picked?.lat, lng: picked?.lng });
      if (!res.ok) { setSiteError(res.error); reportPlanLimitResult(res); return; }
      setRestored(null);
      setPickId(null); setOutdoorKind(null); setCustom(null); setSwapMsg("");
      setSavedId(null);
      setPermit(null);
      setReportUrl(null);
      setPermitMsg("");
      setTitle(null);
      if (!sameHouse) { setTyped({}); setAnalysis(null); setPlates({}); setJobInput({}); setLinesetFt(undefined); }
      setSite(res.facts);
      setSiteLocal(false);
      setStateCode(res.facts.state);
      if (res.facts.county) {
        const hit = designConditionsFor(res.facts.state, res.facts.county);
        setCounty(hit.match === "county" || hit.match === "fuzzy" ? hit.conditions.county : res.facts.county);
      } else setCounty("");
      setCountyPicked(false);
      setSiteWarnings(res.warnings);
      setTimeout(() => go("intake"), 60);
    } catch (err) {
      setSiteError(errMsg(err));
    } finally {
      setSiteBusy(false);
    }
  };

  /** The house entered by hand (2026-10-08, owner: "make an option to enter
   *  the address manually if the map does not find it"): no lookup, no
   *  record — the address and the state start the job at once, the county
   *  is picked, and the intake takes the square footage, the year built and
   *  the rest. The era table fills what is not typed, badged as a default. */
  const startByHand = () => {
    const text = (addrRef.current?.value ?? "").trim();
    if (!text) { setSiteError("Type the address first — street, city, state."); return; }
    const st = stateFor(text);
    if (!st) { setSiteError("Pick the state (or end the address with it, e.g. WA) — the design day and the code rules come from it."); return; }
    const hadIntake = analysis || Object.keys(plates).length > 0 || Object.keys(typed).length > 0 || !!restored || !!pickId || !!custom || outdoorKind !== null;
    const sameHouse = site?.address === text;
    if (hadIntake && !sameHouse && !window.confirm("Start over? The answers, plates and picks for this house will be cleared.")) return;
    const sameState = st === stateCode;
    const hasCounty = sameState && countyPicked && !!county;
    setSiteError("");
    setRestored(null); setPickId(null); setOutdoorKind(null); setCustom(null); setSwapMsg(""); setSavedId(null); setPermit(null); setReportUrl(null); setPermitMsg(""); setTitle(null);
    if (!sameHouse) { setTyped({}); setAnalysis(null); setPlates({}); setJobInput({}); setLinesetFt(undefined); }
    setSite({ address: text, state: st, county: hasCounty ? county : undefined, sources: {} });
    setSiteLocal(true);
    setStateCode(st);
    if (!sameState) { setCounty(""); setCountyPicked(false); }
    const rest = def.needs.load ? " The next step takes the square footage and the year built; the era table fills the rest until you say otherwise." : "";
    if (def.needs.load && !hasCounty) {
      // No record means no county: it is picked here, where the select is,
      // and the step waits — a note on a step the contractor has left is no note.
      setSiteWarnings([`Entered by hand — no house record. Pick the county for the design day, then Continue.${rest}`]);
      window.setTimeout(() => document.getElementById("hv-county")?.focus(), 60);
      return;
    }
    setSiteWarnings([`Entered by hand — no house record.${rest}`]);
    setTimeout(() => go("intake"), 60);
  };

  // ── 2 · the walk + plates ────────────────────────────────────────────────
  const onWalkFile = (f: File | undefined) => { if (f) void walk.pickFile(f); };
  const readWalk = async () => {
    const a = await walk.read(site?.address ?? "");
    if (a) {
      setAnalysis(a);
      const probe = model ? structuredClone(model) : null;
      const read = probe ? applyWalkthrough(probe, a) : { applied: [], conflicts: [] };
      const applied = read.applied;
      const kept = read.conflicts.length ? ` Kept the record on ${read.conflicts.map((c) => `${c.path.replace(/^existing\./, "")} (the walk said ${c.walk})`).join(", ")} — confirm on the card.` : "";
      toast.success("Walk read", (applied.length ? `Filled: ${applied.slice(0, 6).join(", ")}${applied.length > 6 ? ` +${applied.length - 6}` : ""}.` : `${a.measurements.length} figures, ${a.observations.length} observations — nothing new for the model.`) + kept);
    }
  };
  const onPlateFile = async (key: SlotKey, hint: "outdoor" | "indoor" | "panel", f: File | undefined) => {
    if (!f) return;
    let dataUrl = "";
    try { dataUrl = await fileToJpegDataUrl(f); } catch (err) { toast.error("Photo", errMsg(err)); return; }
    setPlates((p) => ({ ...p, [key]: { thumb: dataUrl, busy: true } }));
    if (!(await ensureWithinLimit("hvacEstimates")) || !(await ensureWithinLimit("estimatorUses"))) { setPlates((p) => ({ ...p, [key]: { thumb: dataUrl, error: "Plan limit reached" } })); return; }
    try {
      const res = await readHvacNameplate({ dataUrl, hint });
      if (!res.ok) {
        reportPlanLimitResult(res);
        setPlates((p) => ({ ...p, [key]: { thumb: dataUrl, error: res.error } }));
        return;
      }
      setPlates((p) => ({ ...p, [key]: { thumb: dataUrl, read: res.read } }));
      const probe = model ? structuredClone(model) : null;
      const applied = probe ? (key === "panel" ? (res.read.mcaAmps ? ["main breaker"] : []) : applyNameplate(probe, res.read).applied.map((x) => x.replace(/^existing\./, ""))) : [];
      toast.success(`${SLOTS.find((s) => s.key === key)?.title ?? "Plate"} read`, applied.length ? `Filled: ${applied.join(", ")}` : "Nothing readable — type the figures.");
    } catch (err) {
      setPlates((p) => ({ ...p, [key]: { thumb: dataUrl, error: errMsg(err) } }));
    }
  };

  // ── shop data ────────────────────────────────────────────────────────────
  const onCsv = async (f: File | undefined) => {
    if (!f) return;
    setCatMsg("Importing…");
    try {
      const csv = await f.text();
      const res = await importHvacCatalogCsv({ csv, replace: replaceCat });
      if (!res.ok) { setCatMsg(res.error); return; }
      setCatMsg(`${res.imported} rows imported${res.errors.length ? ` · ${res.errors.length} not: ${res.errors[0]}` : ""}.${res.note ? ` ${res.note}.` : ""}`);
      setCatalog(await listHvacCatalog());
    } catch (err) { setCatMsg(errMsg(err)); }
  };
  // The rows are the shop's: a newer US list adds only what is missing (Load would rewrite the US rows and drop costs and switches).
  const onAddUsRows = async () => {
    setCatMsg("Adding…");
    const res = await addMissingUsRows();
    setCatMsg(res.ok ? `${res.added} row${res.added === 1 ? "" : "s"} added from the current US list — your rows, costs and switches untouched.` : res.error);
    setCatalog(await listHvacCatalog());
  };
  const onLoadUs = async () => {
    setCatMsg("Loading the US catalog…");
    const res = await loadUsCatalog({ replace: replaceCat });
    if (!res.ok) { setCatMsg(res.error); return; }
    setCatMsg(`${res.imported} rows loaded — the popular US families, ratings as published ${res.verifiedOn}. Add your costs to price from them.`);
    setCatalog(await listHvacCatalog());
  };
  // The current catalog as the import sheet: add costs in a spreadsheet, import it back.
  const onDownloadCatalog = () => {
    if (!catalog) return;
    // Lists ride as "CA|WA"; AFUE as the percent the makers print, to a tenth.
    const esc = (v: unknown) => { const s = v === undefined || v === null ? "" : Array.isArray(v) ? v.join("|") : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = catalog.items.map((c) => CATALOG_CSV_COLUMNS.map((k) => esc(k === "afue" && c.afue ? Math.round(c.afue * 1000) / 10 : (c as unknown as Record<string, unknown>)[k])).join(","));
    const blob = new Blob([[CATALOG_CSV_COLUMNS.join(","), ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `hvac-catalog-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const onClearCatalog = async () => {
    const res = await clearHvacCatalog();
    setCatMsg(res.ok ? "Catalog cleared — the built-in US list is back." : res.error);
    setCatalog(await listHvacCatalog());
  };
  const saveCard = async () => {
    if (!cardDraft) return;
    setCardMsg("Saving…");
    const res = await saveHvacRateCard(cardDraft);
    try { window.localStorage.setItem(RATE_CARD_KEY, JSON.stringify(cardDraft)); } catch { /* blocked storage */ }
    setCard({ card: cardDraft, own: res.ok });
    setCardMsg(res.ok ? "Rate card saved for the whole shop." : res.error);
  };
  const templateHref = React.useMemo(() => {
    const rows = [CATALOG_CSV_COLUMNS.join(","), "heat pump,Brand,MODEL-036,3,36000,38000,30000,25000,,,18,12.5,10,R-454B,variable,yes,,25,,3450", "AC,Brand,MODEL-036,3,36000,,,,,,14.3,11.7,,R-454B,single,,,20,,1150", "furnace,Brand,MODEL-080,,,,,,80000,96,,,,,,,,,0.5,1290", "coil,Brand,MODEL-C36,3,,,,,,,,,,,,,,,,310", "air handler,Brand,MODEL-AH36,3,,,,,,,,,,,,,,,0.5,890"];
    return "data:text/csv;charset=utf-8," + encodeURIComponent(rows.join("\n"));
  }, []);

  // ── 4 · save / convert / reopen ──────────────────────────────────────────
  const draft = () => ({
    job,
    input: jobInput,
    outdoorKind: kindQuotes.length === 2 ? outdoorKind ?? undefined : undefined,
    // The pick as made (a tank on the strip, a unit in the swap panel) — the
    // engine's chosen unit stands in for a sized job with no pick.
    pick: pickId ?? engine?.selection.chosen?.item.id,
    linesetFt,
    custom: custom ?? undefined,
    title: (title ?? "").trim() || ledger?.title || "HVAC replacement",
    scope: ledger?.scope ?? "",
    materials: lines?.materials ?? [],
    labor: lines?.labor ?? [],
    assumptions: ledger?.assumptions ?? [],
  });
  const save = async (): Promise<string | null> => {
    if (!site || !model || !engine) return null;
    setSaving(true);
    try {
      const res = await saveHvacEstimate({ id: savedId ?? undefined, address: site.address, siteFacts: site, model, engine, draft: draft() });
      // A spent HVAC meter raises the upgrade dialog on its own; any other failure is a toast.
      if (!res.ok) { if (!reportPlanLimitResult(res)) toast.error("Couldn't save", res.error); return null; }
      setSavedId(res.id);
      toast.success("Estimate saved");
      refreshRecent();
      return res.id;
    } finally { setSaving(false); }
  };
  const convert = async () => {
    if (!lines || !ledger) return;
    if (!(await ensureWithinLimit("proposalsCreated"))) return;
    // Converting an unsaved estimate saves it first — a new estimate on the HVAC meter.
    if (!savedId && !(await ensureWithinLimit("hvacEstimates"))) return;
    setConverting(true);
    try {
      const id = savedId ?? (await save());
      const d = draft();
      const res = await convertHvacEstimateToProposal({ estimateId: id, title: d.title, scope: d.scope, materials: d.materials, labor: d.labor, inventoryLinked: invLink, permitNote: reportUrl && def.needs.load ? `Manual J load calculation: ACCA-approved report attached (Cool Calc${permit ? ` project ${permit.projectId}` : ""}).` : undefined });
      router.push(`/dashboard/manual-blueprint?proposal=${res.id}`);
    } catch (err) {
      if (!reportPlanLimit(err)) toast.error("Couldn't convert", errMsg(err));
    } finally { setConverting(false); }
  };
  const reopen = async (id: string) => {
    const res = await getHvacEstimate(id);
    if (!res.ok) { toast.error("Couldn't open", res.error); return; }
    const facts = res.row.siteFacts as SiteFacts;
    const m = res.row.model as BuildingModel;
    if (!facts?.address || !m?.provenance) { toast.error("Couldn't open", "That estimate is missing its site facts."); return; }
    setAnalysis(null);
    setPlates({});
    setTyped({});
    setSite(facts);
    setStateCode(facts.state);
    {
      const raw = m.county ?? facts.county ?? "";
      const hit = raw ? designConditionsFor(facts.state, raw) : null;
      setCounty(hit && (hit.match === "county" || hit.match === "fuzzy") ? hit.conditions.county : raw);
    }
    setRestored(m);
    const savedJob = (res.row.draft as { job?: string; input?: JobInput }).job;
    setJob(JOBS.some((j) => j.id === savedJob) ? (savedJob as JobKind) : DEFAULT_JOB);
    setJobInput((res.row.draft as { input?: JobInput }).input ?? {});
    setOutdoorKind((res.row.draft as { outdoorKind?: OutdoorKind }).outdoorKind ?? null);
    const d = res.row.draft as { pick?: string; custom?: CatalogItem };
    setCustom(d.custom ?? null);
    setPickId(d.pick ?? null);
    setLinesetFt((res.row.draft as { linesetFt?: number }).linesetFt);
    // The ledger the contractor edited and saved is what reopens — not a
    // fresh rebuild that forgets the price they typed and the line they cut.
    type SavedLine = { id?: string; name: string; quantity: number; unitPrice: number; unit?: string; basis?: string; note?: string };
    const dl = res.row.draft as unknown as { materials?: SavedLine[]; labor?: SavedLine[] };
    const asLines = (rows: SavedLine[] | undefined, prefix: string): LedgerLine[] =>
      (rows ?? []).map((l, i) => ({ id: l.id ?? `${prefix}-saved-${i}`, name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, unit: l.unit ?? "each", basis: (l.basis === "measured" || l.basis === "estimated" || l.basis === "entered" ? l.basis : "entered"), note: l.note }));
    savedLinesRef.current = dl.materials?.length || dl.labor?.length ? { materials: asLines(dl.materials, "m"), labor: asLines(dl.labor, "l") } : null;
    setPicked(null);
    setSavedId(res.row.id);
    setPermit(res.row.permit);
    setReportUrl(res.row.approvedReportUrl);
    setPermitMsg("");
    setTitle(res.row.draft.title);
    setSiteWarnings([]);
    if (addrRef.current) addrRef.current.value = facts.address;
    setTimeout(() => go("design"), 60);
  };

  // ── permit-grade report ──────────────────────────────────────────────────
  const requestPermit = async () => {
    const id = savedId ?? (await save());
    if (!id) return;
    setPermitBusy(true);
    setPermitMsg("");
    try {
      const res = await requestHvacPermitReport({ estimateId: id });
      if (!res.ok) { setPermitMsg(res.error); return; }
      setPermit(res.permit);
      setPermitMsg(`Project ${res.permit.projectId} created in Cool Calc — finish the envelope there, then pull the report.`);
      window.open(res.appUrl, "_blank", "noopener");
    } finally { setPermitBusy(false); }
  };
  const attachPermit = async (url?: string) => {
    const id = savedId ?? (await save());
    if (!id) return;
    setPermitBusy(true);
    setPermitMsg("");
    try {
      const res = await attachHvacPermitReport({ estimateId: id, url });
      if (!res.ok) { setPermitMsg(res.error); return; }
      setReportUrl(res.url);
      setLinkDraft("");
      setPermitMsg("Report attached — the proposal will say so.");
      refreshRecent();
    } finally { setPermitBusy(false); }
  };
  const saveActual = async (id: string) => {
    const tons = Number(actualDraft.tons);
    const price = Number(actualDraft.price.replace(/[$,]/g, ""));
    const res = await recordHvacActual({ estimateId: id, actual: { tons: actualDraft.tons.trim() && Number.isFinite(tons) ? tons : undefined, price: actualDraft.price.trim() && Number.isFinite(price) ? price : undefined, notes: actualDraft.notes.trim() || undefined } });
    if (!res.ok) { toast.error("Couldn't record", res.error); return; }
    setActualFor(null);
    setActualDraft({ tons: "", price: "", notes: "" });
    refreshRecent();
  };

  // ── render ────────────────────────────────────────────────────────────────
  const cov = coverageFor(model);
  // What a folded group already knows, so the contractor does not have to open
  // it to see whether it is filled in.
  const EXISTING_WORDS: Record<string, string> = { "split-ac-furnace": "AC + furnace", "split-heat-pump": "heat pump", "furnace-only": "furnace only", "package-unit": "package unit", ductless: "ductless", boiler: "boiler", none: "nothing there" };
  const sumExisting = model ? [EXISTING_WORDS[model.existing.kind] ?? model.existing.kind.replace(/-/g, " "), model.existing.tons ? `${model.existing.tons} t` : "", model.existing.btuInput ? `${Math.round(model.existing.btuInput / 1000)}k BTU` : "", model.existing.fuel ?? "", model.existing.refrigerant ?? "", model.existing.yearMade ? String(model.existing.yearMade) : ""].filter(Boolean).join(" · ") : "";
  const sumPanel = model ? [model.electrical.mainAmps ? `${model.electrical.mainAmps} A main` : "panel not read", model.electrical.freeSlots !== undefined ? `${model.electrical.freeSlots} free slots` : ""].filter(Boolean).join(" · ") : "";
  const sumDucts = model ? [
    ...(def.needs.ducts ? [model.ducts.location !== "none" ? `in the ${model.ducts.location}` : "no ducts", model.ducts.condition !== "unknown" ? model.ducts.condition : "", model.ducts.returnGrilleSqIn ? `${model.ducts.returnGrilleSqIn} sq in return` : "return not measured", model.ducts.supplyTrunk ? `${model.ducts.supplyTrunk} in trunk` : "", typeof model.ducts.measuredTespInWc === "number" ? `static ${model.ducts.measuredTespInWc}` : model.ducts.location !== "none" && !model.ducts.supplyTrunk && !model.ducts.returnDuct ? "airflow not verified" : ""] : []),
    ...(def.needs.gas ? [model.gas.available === false ? "no gas at the house" : model.gas.pipeIn ? `${model.gas.pipeIn === 0.5 ? "½" : model.gas.pipeIn === 0.75 ? "¾" : model.gas.pipeIn} in gas${model.gas.longestRunFt ? ` · ${model.gas.longestRunFt} ft run` : ""}` : model.gas.available ? "gas at the house · pipe not measured" : "gas not confirmed"] : []),
  ].filter(Boolean).join(" · ") : "";
  const chosen = engine?.selection.chosen ?? null;
  const counties = stateCode ? countiesFor(stateCode) : [];
  const subtotal = lines ? [...lines.materials, ...lines.labor].reduce((a, l) => a + l.quantity * l.unitPrice, 0) : 0;
  const defaultedCount = engine ? engine.notes.filter((n) => n.kind === "assumption").length : 0;

  // ── the stepper's state, derived every render ─────────────────────────
  const sizeText = !engine ? "—"
    : engine.waterHeater ? (engine.waterHeater.type === "tankless" ? "tankless" : `${engine.waterHeater.gallons} gal`)
    : !def.needs.load ? `${(jobInput.service?.tasks?.length ?? 0) + (jobInput.service?.custom?.length ?? 0)} task${((jobInput.service?.tasks?.length ?? 0) + (jobInput.service?.custom?.length ?? 0)) === 1 ? "" : "s"}`
    : def.selection === "furnace" ? (chosen?.item.btuInput ? `${Math.round(chosen.item.btuInput / 1000)}k BTU in` : "—")
    : def.selection === "none" ? `${num(engine.load.coolingCfm)} CFM`
    : `${engine.selection.systems > 1 ? `${engine.selection.systems} × ` : ""}${chosen?.item.tons ?? engine.selection.targetTons} ton`;
  const sqftText = model?.conditionedSqft ? `${num(model.conditionedSqft)} sq ft` : def.needs.zone && jobInput.zoneSqft ? `${num(jobInput.zoneSqft)} sq ft zone` : "";
  const addrShort = site ? site.address.split(",")[0] : "";
  const needSqft = !!(site && model) && !ready;
  const S: Record<StepKey, StepMeta> = {
    job: { n: 1, title: "The job", lead: "Pick the job. It sets what we ask for and what goes on the estimate.", summary: def.title, done: true, locked: false, reason: "" },
    house: { n: 2, title: "The house", lead: "Tell us the address — we'll pull the house size and the local climate.", summary: site ? [addrShort, sqftText].filter(Boolean).join(" · ") : "", done: !!site, locked: false, reason: "" },
    intake: { n: 3, title: "What is there", lead: "Walk it on video, photograph the plates, or type what you know — every figure shows where it came from.", summary: site && model ? [analysis ? "walk read" : "no walk", `${Object.keys(plates).length} plate${Object.keys(plates).length === 1 ? "" : "s"}`, `${Object.keys(typed).length} typed`, sqftText].filter(Boolean).join(" · ") : "", done: !!(site && model && ready), locked: !site, reason: "Look up the house first" },
    design: { n: 4, title: def.needs.load ? "The design" : "The checks", lead: def.needs.load ? "The load on the design day, the unit that fits it, and the checks an inspector would ask about." : engine?.waterHeater ? "The tank sized from the household, and the checks an inspector would ask about." : "What the visit needs, and the rule that applies.", summary: engine ? [def.selection !== "none" ? (chosen ? `${chosen.item.brand} ${chosen.item.model}` : "no catalog fit") : "", sizeText, defaultedCount ? `${defaultedCount} assumption${defaultedCount === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ") : "", done: !!engine, locked: !site || needSqft, reason: !site ? "Look up the house first" : def.needs.zone ? "Type the zone's square footage" : "Type the conditioned square footage" },
    estimate: { n: 5, title: "The estimate", lead: "Every line is editable. Convert when it reads right.", summary: lines ? money(subtotal) : "", done: !!(engine && ledger && lines), locked: !engine, reason: !site ? "Look up the house first" : needSqft ? (def.needs.zone ? "Type the zone's square footage" : "Type the conditioned square footage") : "Finish the design first" },
  };
  const STEP_ORDER: StepKey[] = ["job", "house", "intake", "design", "estimate"];
  // A link can name a step (#hv-job, #hv-site, #hv-intake, #hv-design,
  // #hv-ledger): it opens once, as soon as that step is unlocked — at once for
  // the first two, after a lookup or a reopened estimate for the rest.
  const hashDone = React.useRef(false);
  const hashLockKey = STEP_ORDER.map((k) => (S[k].locked ? "1" : "0")).join("");
  React.useEffect(() => {
    if (hashDone.current) return;
    const k = STEP_ORDER.find((x) => "#" + STEP_IDS[x] === window.location.hash);
    if (!k) { hashDone.current = true; return; }
    if (S[k].locked) return;
    hashDone.current = true;
    setCur(k);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when a lock opens
  }, [hashLockKey]);
  const sourceRows: Array<{ k: string; v: string; state: "busy" | "found" | "default" }> = site || siteBusy ? [
    { k: "Parcel", state: siteBusy && (siteLocal || !site) ? "busy" : site && (site.sources.living || site.sources.yearBuilt || site.sources.storeys) ? "found" : "default", v: siteBusy && (siteLocal || !site) ? "looking up the record…" : site && (site.sources.living || site.sources.yearBuilt || site.sources.storeys) ? `${[site.sources.living && "area", site.sources.yearBuilt && "year built", site.sources.storeys && "storeys"].filter(Boolean).join(", ")} — ${site.sources.living ?? site.sources.yearBuilt ?? site.sources.storeys}` : "not on record — era defaults, type over them" },
    ...(def.needs.load ? [
      { k: "Footprint", state: siteBusy && !site ? "busy" as const : site?.sources.footprint ? "found" as const : "default" as const, v: siteBusy && !site ? "measuring…" : site?.sources.footprint ? `${site.footprintSqft ? num(site.footprintSqft) + " sq ft — " : ""}${site.sources.footprint}` : "none — the area comes from the record or what you type" },
      { k: "Elevation", state: siteBusy && !site ? "busy" as const : site?.sources.elevation ? "found" as const : "default" as const, v: siteBusy && !site ? "sampling…" : site?.sources.elevation ? `${site.elevationFt !== undefined ? num(site.elevationFt) + " ft — " : ""}${site.sources.elevation}` : "not sampled — sea level assumed" },
    ] : []),
    { k: "County design day", state: siteBusy && !site ? "busy" : conditions && (conditions.match === "county" || conditions.match === "fuzzy") ? "found" : "default", v: siteBusy && !site ? "finding the county…" : conditions && (conditions.match === "county" || conditions.match === "fuzzy") ? `${conditions.conditions.county} County — ${jobInput.designCoolingF ?? conditions.conditions.coolingF}° / ${jobInput.designHeatingF ?? conditions.conditions.heatingF}°` : conditions?.match === "state" ? "state median — pick the county above" : "no table — pick the state and county" },
  ] : [];

  const summary = (
    <aside className={cx("sum")} aria-label="Estimate summary">
      <div className={cx("sum-k")}>Estimate</div>
      <dl className={cx("sum-l")}>
        <div className={cx("sum-r")}><dt>Job</dt><dd>{def.title}</dd></div>
        <div className={cx("sum-r")}><dt>House</dt><dd>{site ? [addrShort, sqftText].filter(Boolean).join(" · ") : "—"}</dd></div>
        <div className={cx("sum-r")}><dt>{engine?.waterHeater ? "Tank" : !def.needs.load ? "Visit" : "Sized"}</dt><dd>{sizeText}</dd></div>
        <div className={cx("sum-r", "sum-p")}><dt>Price</dt><dd>{lines ? money(subtotal) : "—"}</dd></div>
      </dl>
      <div className={cx("sum-a")}>
        <button type="button" className={cx("btn", "btn-ghost", "btn-sm")} disabled={!S.estimate.done || saving} onClick={() => void save()}>{saving ? "Saving…" : savedId ? "Saved" : "Save"}</button>
        <button type="button" className={cx("btn", "btn-primary", "btn-sm")} disabled={!S.estimate.done || converting || !(lines && (lines.materials.length || lines.labor.length))} onClick={() => void convert()}><svg className={cx("ic")}><use href="#i-doc" /></svg>{converting ? "Converting…" : "Convert to proposal"}</button>
      </div>
    </aside>
  );

  return (
    <>
      <div className={cx("hv")}>
      <Rail steps={STEP_ORDER.map((k) => [k, S[k]] as [StepKey, StepMeta])} cur={cur} onGo={go} />
      <div className={cx("hv-main")}>
      {/* ── 1 · THE JOB ──────────────────────────────────────────────────── */}
      <Step k="job" meta={S.job} open={cur === "job"}>
        <div className={cx("body")}>
          <div className={cx("jgs")}>
            {JOB_GROUPS.map((g) => (
              <div key={g.k} className={cx("jg")}>
                <div className={cx("jg-k")}>{g.k}</div>
                <div className={cx("jobs")} role="radiogroup" aria-label={g.k} onKeyDown={radioKeys}>
                  {g.ids.map((id) => { const j = jobDef(id); return (
                    <button key={j.id} type="button" role="radio" aria-checked={job === j.id} className={cx("job", job === j.id && "on")} title={j.sub} onClick={() => { setJob(j.id); setTitle(null); setSavedId(null); setPermit(null); setReportUrl(null); setPermitMsg(""); setPickId(null); setOutdoorKind(null); setCustom(null); setSwapMsg(""); if (!site) setTimeout(() => { go("house"); addrRef.current?.focus(); }, 30); else if (siteLocal && j.needs.load) { setSite(null); setSiteLocal(false); setTimeout(() => { go("house"); addrRef.current?.focus(); }, 30); } }}>
                      <span className={cx("job-ic")} aria-hidden="true"><svg className={cx("ic")}><use href={`#${JOB_ICONS[j.id]}`} /></svg></span>
                      <span className={cx("job-t")}>{j.title}</span>
                      <span className={cx("job-stamp")} aria-hidden="true"><svg className={cx("ic")}><use href="#i-check" /></svg></span>
                    </button>
                  ); })}
                </div>
              </div>
            ))}
          </div>
          <div className={cx("st-next")}>
            <button type="button" className={cx("btn", "btn-primary")} onClick={() => go("house")}>Continue<svg className={cx("ic")}><use href="#i-arrow" /></svg></button>
            <span className={cx("acts-note")}>{def.title} · {def.sub}</span>
          </div>
        </div>
      </Step>

      {/* ── 2 · THE HOUSE ────────────────────────────────────────────────── */}
      <Step k="house" meta={S.house} open={cur === "house"}>
        <div className={cx("body")}>
          <div className={cx("grid", site ? "grid-addr" : "grid-1")}>
            <label className={cx("field")} htmlFor="hv-addr">
              <span className={cx("lbl")}>Address{initialAddress && <span className={cx("chip", "chip-stated")}>from the client</span>}</span>
              <span className={cx("addr")}>
                <svg className={cx("ic")}><use href="#i-pin" /></svg>
                <input ref={addrRef} id="hv-addr" className={cx("addr-in")} placeholder="e.g. 4518 Bluestem Hollow Dr, Frisco, TX 75034" defaultValue={initialAddress ?? ""} autoComplete="off" onChange={() => { setPicked(null); setStatePicked(false); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void lookupSite(); } }} />
              </span>
            </label>
            {<label className={cx("field")} htmlFor="hv-state">
              <span className={cx("lbl")}>State</span>
              <span className={cx("bp-sel", "hvsel")}><select id="hv-state" className={cx("bp-sel-in", "sel")} value={stateCode} onChange={(e) => { setStateCode(e.target.value); setStatePicked(!!e.target.value); setCounty(""); setCountyPicked(false); }}>
                <option value="">auto</option>
                {STATES.map((st) => <option key={st} value={st}>{st}</option>)}
              </select></span>
            </label>}
            {site && def.needs.load && <label className={cx("field")} htmlFor="hv-county">
              <span className={cx("lbl")}>County <span className={cx("mono")} style={{ textTransform: "none", letterSpacing: 0 }}>{site?.sources.county ?? "auto"}</span></span>
              <span className={cx("bp-sel", "hvsel")}><select id="hv-county" className={cx("bp-sel-in", "sel")} value={county} onChange={(e) => { setCounty(e.target.value); setCountyPicked(true); }} disabled={!stateCode}>
                <option value="">{stateCode ? "auto from the address" : "pick the state first"}</option>
                {counties.map((c) => <option key={c} value={c}>{c}</option>)}
              </select></span>
            </label>}
            {site && def.needs.load && <label className={cx("field")} htmlFor="hv-design-cool">
              <span className={cx("lbl")}>Design °F cooling <span className={cx("mono")} style={{ textTransform: "none", letterSpacing: 0 }}>1% · county {conditions?.conditions.coolingF ?? "—"}</span></span>
              <input id="hv-design-cool" className={cx("in", "num")} inputMode="numeric" placeholder={conditions ? String(conditions.conditions.coolingF) : ""} defaultValue={jobInput.designCoolingF ?? ""} key={`dc-${jobInput.designCoolingF ?? ""}`} onBlur={(e) => { const v = e.target.value.trim(); const n = Number(v); setJobInput((i) => ({ ...i, designCoolingF: v && Number.isFinite(n) && n >= 60 && n <= 125 ? n : undefined })); }} />
            </label>}
            {site && def.needs.load && <label className={cx("field")} htmlFor="hv-design-heat">
              <span className={cx("lbl")}>Design °F heating <span className={cx("mono")} style={{ textTransform: "none", letterSpacing: 0 }}>99% · county {conditions?.conditions.heatingF ?? "—"}</span></span>
              <input id="hv-design-heat" className={cx("in", "num")} inputMode="numeric" placeholder={conditions ? String(conditions.conditions.heatingF) : ""} defaultValue={jobInput.designHeatingF ?? ""} key={`dh-${jobInput.designHeatingF ?? ""}`} onBlur={(e) => { const v = e.target.value.trim(); const n = Number(v); setJobInput((i) => ({ ...i, designHeatingF: v && Number.isFinite(n) && n >= -60 && n <= 70 ? n : undefined })); }} />
            </label>}
          </div>
          {site && def.needs.load && conditions && /metro station|ENERGY STAR/.test(conditions.conditions.source) && <div className={cx("note")} style={{ marginTop: 8 }}>{/metro station/.test(conditions.conditions.source) ? "The county's figure is the most extreme station within 40 miles; the design runs on the metro station instead. " : "The county's figure is the most extreme station within 40 miles of the county centre — conservative for a house in the valley. "}Set the address&apos;s own Manual J design temperatures above if your permit office or your Manual J table gives different ones.</div>}
          {siteError && <div className={cx("call", "bad")} style={{ marginTop: 12 }}>{siteError}{!/address first|Pick the state|Add the state/.test(siteError) && <> Not on the map? <b>Enter it by hand</b> — the form takes the square footage, the year built and the rest.</>}</div>}
          <div className={cx("acts")}>
            {site && siteLocal && !siteBusy && (
              <button type="button" id="hv-hand-continue" className={cx("btn", "btn-primary")} disabled={S.intake.locked} title={S.intake.locked ? S.intake.reason : undefined} onClick={() => go("intake")}>Continue<svg className={cx("ic")}><use href="#i-arrow" /></svg></button>
            )}
            <button type="button" className={cx("btn", site && siteLocal ? "btn-ghost" : "btn-primary")} disabled={siteBusy} onClick={() => void lookupSite()}>
              <svg className={cx("ic")}><use href="#i-pin" /></svg>{siteBusy ? "Looking up…" : site ? "Look up another" : "Look up the house"}
            </button>
            <button type="button" id="hv-by-hand" className={cx("btn", "btn-ghost")} disabled={siteBusy} onClick={startByHand} title="No lookup: the address and the state start the job; you type the house">Enter it by hand</button>
            <span className={cx("acts-note")}>{siteBusy ? "Looking up the record" : site ? (siteLocal ? "Running on the address and the state" : sourceRows.some((r) => r.state === "found") ? `${sourceRows.filter((r) => r.state === "found").length} of ${sourceRows.length} sources found` : "Nothing on record — running on defaults") : def.needs.load ? "Parcel · footprint · elevation · county design day" : "Parcel · county · year built"}</span>
          </div>
          {sourceRows.length > 0 && (
            <ul className={cx("src")} aria-label="What the lookup found">
              {sourceRows.map((r) => (
                <li key={r.k} className={cx("src-r", `src-${r.state}`)}>
                  <span className={cx("src-i")} aria-hidden="true">{r.state === "found" ? <svg className={cx("ic")}><use href="#i-check" /></svg> : r.state === "busy" ? "" : "—"}</span>
                  <span className={cx("src-k")}>{r.k}</span>
                  <span className={cx("src-v")}>{r.v}</span>
                  <span className={cx("src-s")}>{r.state === "found" ? "found" : r.state === "busy" ? "looking" : "default"}</span>
                </li>
              ))}
            </ul>
          )}
          <details className={cx("how")}>
            <summary>How this is calculated</summary>
            <div className={cx("how-b")}>The county sets the design day (the ENERGY STAR 2019 design-temperature table, 1% cooling / 99% heating), the building footprint or the assessor&rsquo;s record sets the area, and the records fill storeys and year built where they can. Everything they cannot fill starts as an era default for that year of construction — each figure carries a badge saying which, and anything you type wins.</div>
          </details>
        </div>
        {site && model && !def.needs.load && (
          <div className={cx("hero")}>
            <div className={cx("hero-cell")}>
              <div className={cx("kpi-lbl")}>The house</div>
              <div className={cx("hero-v")}>{siteLocal ? (siteBusy ? "…" : "—") : model.conditionedSqft ? num(model.conditionedSqft) : "—"}<small>{siteLocal ? "" : "sq ft"}</small></div>
              <div className={cx("hero-h")}>{siteLocal ? (siteBusy ? "looking up the record — the form below is already live" : "no house record found — running on the address and the state") : [model.yearBuilt ? `built ${model.yearBuilt}` : "", model.county ? `${model.county} County` : ""].filter(Boolean).join(" · ") || "record found"}</div>
            </div>
            <div className={cx("hero-cell")}>
              <div className={cx("kpi-lbl")}>Existing</div>
              <div className={cx("hero-v")}>{model.existing.tons ? `${model.existing.tons}` : "—"}<small>ton</small></div>
              <div className={cx("hero-h")}>{model.existing.kind.replace(/-/g, " ")}{model.existing.yearMade ? ` · ${model.existing.yearMade}` : ""}{model.existing.refrigerant ? ` · ${model.existing.refrigerant}` : ""}</div>
            </div>
            <div className={cx("hero-cell")}>
              <div className={cx("kpi-lbl")}>State</div>
              <div className={cx("hero-v")}>{model.state}</div>
              <div className={cx("hero-h")}>code and strapping rules by state</div>
            </div>
          </div>
        )}
        {site && model && def.needs.load && (
          <>
            <div className={cx("hero")}>
              <div className={cx("hero-cell")}>
                <div className={cx("kpi-lbl")}>Design day</div>
                <div className={cx("hero-v", "accent")}>{conditions ? `${jobInput.designCoolingF ?? conditions.conditions.coolingF}° / ${jobInput.designHeatingF ?? conditions.conditions.heatingF}°` : "—"}</div>
                <div className={cx("hero-h")} title={conditions?.conditions.source}>{conditions?.match === "county" || conditions?.match === "fuzzy" ? `${conditions.conditions.county} County` : conditions?.match === "state" ? "state median — pick the county" : "no table"} · {conditions?.conditions.state}{conditions?.approx ? " · approx" : ""}</div>
              </div>
              <div className={cx("hero-cell")}>
                <div className={cx("kpi-lbl")}>Conditioned area</div>
                <div className={cx("hero-v")}>{model.conditionedSqft ? num(model.conditionedSqft) : "—"}<small>sq ft</small></div>
                <div className={cx("hero-h")} title={model.provenance.conditionedSqft?.note}>{model.conditionedSqft ? <><Chip p={model.provenance.conditionedSqft} /> {model.provenance.conditionedSqft?.note}</> : <button type="button" className={cx("link")} onClick={() => document.getElementById("hv-conditionedSqft")?.focus()}>not on record — type it below</button>}</div>
              </div>
              <div className={cx("hero-cell")}>
                <div className={cx("kpi-lbl")}>Storeys · built</div>
                <div className={cx("hero-v")}>{model.storeys}<small>·</small>{model.yearBuilt ?? "—"}</div>
                <div className={cx("hero-h")} title={`${model.provenance.storeys?.note ?? ""} · ${model.provenance.yearBuilt?.note ?? ""}`}><Chip p={model.provenance.storeys} /> <Chip p={model.provenance.yearBuilt} /></div>
              </div>
              <div className={cx("hero-cell")}>
                <div className={cx("kpi-lbl")}>Elevation</div>
                <div className={cx("hero-v")}>{site.elevationFt !== undefined ? num(site.elevationFt) : "—"}<small>ft</small></div>
                <div className={cx("hero-h")}>{site.sources.elevation ?? "not sampled"}</div>
              </div>
              <div className={cx("hero-cell")}>
                <div className={cx("kpi-lbl")}>Existing</div>
                <div className={cx("hero-v")}>{model.existing.tons ? `${model.existing.tons}` : "—"}<small>ton</small></div>
                <div className={cx("hero-h")}>{model.existing.kind.replace(/-/g, " ")}{model.existing.yearMade ? ` · ${model.existing.yearMade}` : ""}{model.existing.refrigerant ? ` · ${model.existing.refrigerant}` : ""}</div>
              </div>
            </div>
            {siteWarnings.length > 0 && (
              <div className={cx("body")} style={{ paddingTop: 12 }}>
                {siteWarnings.map((w) => <div key={w} className={cx("call", "warn")}><span className={cx("stamp")}>note</span><span>{w}</span></div>)}
              </div>
            )}
          </>
        )}
      </Step>

      {/* ── 3 · WHAT IS THERE ────────────────────────────────────────────── */}
      <Step k="intake" meta={S.intake} open={cur === "intake"}>
      {site && model && (
        <>
          {!aiEnabled && <div className={cx("body")} style={{ paddingBottom: 0 }}><div className={cx("call", "warn")}><span className={cx("stamp")}>off</span><span>Plate and video reading need OPENAI_API_KEY on the server — type the facts in Confirm below; a typed model number still decodes.</span></div></div>}
          <div className={cx("body")}>
            <div className={cx("seg")} role="tablist" aria-label="How to tell us about the house">
              {([["walk", "Walk", "video", "i-video"], ["plates", "Plate", "photos", "i-imgadd"], ["type", "Type", "it in", "i-pen"]] as Array<[IntakeMode, string, string, string]>).map(([m, l1, l2, ic]) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} className={cx("seg-btn", mode === m && "on")} onClick={() => setMode(m)}>
                  <span className={cx("seg-stamp")} aria-hidden="true"><svg className={cx("ic")}><use href="#i-check" /></svg></span>
                  <svg className={cx("ic", "seg-ic")}><use href={`#${ic}`} /></svg><span className={cx("seg-l")}><span>{l1}</span> <span>{l2}</span></span>
                </button>
              ))}
            </div>

            {mode === "walk" && (
              <div className={cx("mode")}>
                {!walk.file ? (
                  <label className={cx("zone")} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onWalkFile(e.dataTransfer.files?.[0]); }}>
                    <input type="file" accept={VIDEO_ACCEPT} onChange={(e) => onWalkFile(e.target.files?.[0])} />
                    <svg className={cx("ic")}><use href="#i-video" /></svg>
                    <span className={cx("zone-t")}>Record or choose the walk</span>
                    <span className={cx("zone-h")}>MP4 · MOV · WEBM · up to 5 min · only stills and audio upload</span>
                  </label>
                ) : (
                  <div className={cx("clip")}>
                    {walk.previewUrl && <video src={walk.previewUrl} muted playsInline preload="metadata" />}
                    <div style={{ minWidth: 0 }}>
                      <div className={cx("clip-t")}>{walk.file.name}</div>
                      <div className={cx("mono", "clip-m")}>{walk.probe ? `${fmtClock(walk.probe.duration)} · ${walk.probe.width}×${walk.probe.height}` : ""} · {walk.frames.length} stills{walk.audioState !== "pending" ? ` · audio ${walk.audioState}` : ""}</div>
                    </div>
                    <button type="button" className={cx("link")} onClick={() => { walk.removeFile(); setAnalysis(null); }}>Remove</button>
                  </div>
                )}
                {walk.stage && (
                  <div className={cx("stage")}><div className={cx("stage-bar")}><div className={cx("stage-fill")} style={{ width: `${walk.stagePct}%` }} /></div><span className={cx("stage-t")}>{walk.stageText}</span></div>
                )}
                {walk.error && <div className={cx("call", "bad")} style={{ marginTop: 10 }}>{walk.error}</div>}
                {walk.framesDeferred && !analysis && (
                  <div className={cx("call")} style={{ marginTop: 10 }} data-video-deferred>This browser reads a clip from a tap only — the stills are pulled when you tap Read the walk.</div>
                )}
                {walk.frames.length > 0 && !analysis && (
                  <div className={cx("frames")}>
                    {/* Data URLs pulled from the clip in this browser — nothing for next/image to optimise. */}
                    {stripFrames(walk.frames, 6).map((f) => (
                      <div key={f.t} className={cx("frame")}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={f.dataUrl} alt="" />
                        <span>{fmtClock(f.t)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {walk.file && !analysis && (
                  <div className={cx("acts")}>
                    <button type="button" className={cx("btn", "btn-primary")} disabled={!walk.canRead} onClick={() => void readWalk()}>
                      <svg className={cx("ic")}><use href="#i-eye" /></svg>{walk.busy ? "Reading…" : "Read the walk"}
                    </button>
                    <span className={cx("acts-note")}>One estimator run · frames + audio only</span>
                  </div>
                )}
                {analysis && (
                  <div className={cx("call", "info")} style={{ marginTop: 12 }}>
                    <span className={cx("stamp")}>read</span>
                    <span><b>{analysis.measurements.length} figures, {analysis.observations.length} observations</b> — {analysis.measurements.slice(0, 6).map((m) => `${m.label} ${m.value}${m.unit ? " " + m.unit : ""}`).join(" · ")}{analysis.measurements.length > 6 ? " · …" : ""}{analysis.questions.length ? ` Still asks: ${analysis.questions.map((q) => q.question).join(" ")}` : ""}</span>
                  </div>
                )}
                <details className={cx("guide")} open={guideOpen} onToggle={(e) => { const o = (e.target as HTMLDetailsElement).open; setGuideOpen(o); try { window.localStorage.setItem("jf.hvac.guideOpen", o ? "1" : "0"); } catch { /* blocked storage */ } }}>
                  <summary><svg className={cx("ic")}><use href="#i-video" /></svg>How to shoot the walk<span className={cx("mono")}>{def.shots.length} shots · {def.shots.length >= 6 ? "2–4" : "1–2"} min · {guideOpen ? "hide" : "show"}</span></summary>
                  <div className={cx("guide-body")}>
                    <div className={cx("shots")}>
                      {SHOTS.filter((sh) => def.shots.includes(sh.n)).map((sh) => (
                        <div key={sh.n} className={cx("shot")}>
                          <div className={cx("shot-n")}>{sh.n}</div>
                          <div>
                            <div className={cx("shot-t")}>{sh.title}</div>
                            <div className={cx("shot-d")}>{sh.detail}</div>
                            <div className={cx("shot-say")}>say: {sh.say}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className={cx("tips")}>{TIPS.map((t) => <span key={t} className={cx("tip")}>{t}</span>)}</div>
                  </div>
                </details>
              </div>
            )}

            {mode === "plates" && (
              <div className={cx("mode")}>
                <div className={cx("zones")}>
                  {SLOTS.map((sl) => {
                    const p = plates[sl.key];
                    const r = p?.read;
                    return (
                      <label key={sl.key} className={cx("zone", "zone-plate", p && "has")}>
                        <input type="file" accept="image/*" onChange={(e) => void onPlateFile(sl.key, sl.hint, e.target.files?.[0])} />
                        {/* eslint-disable-next-line @next/next/no-img-element -- a data URL the browser just rendered */}
                        {p?.thumb ? <img src={p.thumb} alt={sl.title} /> : <svg className={cx("ic")}><use href="#i-imgadd" /></svg>}
                        <span className={cx("zone-t")}>{sl.title}{r && <span className={cx("chip", r.confidence === "high" ? "chip-pass" : r.confidence === "medium" ? "chip-verify" : "chip-fix")}>{r.confidence}</span>}</span>
                        <span className={cx("zone-h")}>{p?.busy ? "Reading…" : p?.error ? p.error : r ? (sl.key === "panel" ? `${r.mcaAmps ? `${r.mcaAmps} A main` : "main not read"}${r.notes ? ` · ${r.notes}` : ""}` : [[r.brand, r.model].filter(Boolean).join(" ") || "model not read", r.tons ? `${r.tons} t` : "", r.btuInput ? `${num(r.btuInput / 1000)}k BTU` : "", r.refrigerant ?? "", r.seer ? `${r.seer} SEER` : ""].filter(Boolean).join(" · ")) : `${sl.sub} · JPG · PNG · HEIC`}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {mode === "type" && <div className={cx("mode", "mode-type")}><span className={cx("mono")}>Type the facts below — what you type wins over the record and the defaults.</span></div>}

            {(def.needs.load || def.needs.existing) && (() => {
              const rows = cov.filter((c) => (def.needs.load || !["sqft", "year", "windows"].includes(c.key)) && (def.needs.existing || !["outdoor", "indoor"].includes(c.key)) && (def.needs.electrical || c.key !== "panel") && (def.needs.ducts || c.key !== "ducts") && (def.needs.gas || c.key !== "fuel"));
              const got = rows.filter((c) => c.got).length;
              return (
                <details className={cx("cov")}>
                  <summary>
                    <span className={cx("cov-bar")} aria-hidden="true"><i style={{ width: `${rows.length ? Math.round((got / rows.length) * 100) : 0}%` }} /></span>
                    <span className={cx("cov-t")}>{got} of {rows.length} caught</span>
                    <span className={cx("mono", "cov-x")}>show</span>
                  </summary>
                  <ul className={cx("cov-l")}>
                    {rows.map((c) => (
                      <li key={c.key} className={cx("cov-r", c.got && "got")}>
                        <button type="button" onClick={() => { const el = document.getElementById(({ outdoor: "hv-existing-model", indoor: "hv-existing-btuInput", panel: "hv-electrical-mainAmps", ducts: "hv-ducts-location", fuel: "hv-gas-available", sqft: "hv-conditionedSqft", year: "hv-yearBuilt", windows: "hv-windowType" } as Record<string, string>)[c.key] ?? ""); el?.closest("details")?.setAttribute("open", "true"); el?.focus(); el?.scrollIntoView({ block: "center", behavior: "smooth" }); }}>
                          <span className={cx("cov-i")} aria-hidden="true">{c.got && <svg className={cx("ic")}><use href="#i-check" /></svg>}</span>
                          <span className={cx("cov-n")}>{c.title}</span>
                          <span className={cx("mono", "cov-s")}>{c.got ? "caught" : c.fix}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })()}
          </div>

          <div className={cx("confirm")}>
            <div className={cx("sec-title")}>Confirm</div>
            <div className={cx("sec-sub")}>What we are using — type over anything. <b>stated</b> is yours, <b>read</b> came off a plate or the walk, <b>measured</b> from the records, <b>default</b> is the era&rsquo;s until you say otherwise.</div>
            {def.needs.load && !def.needs.zone && !model.conditionedSqft && <div className={cx("call", "warn")} style={{ marginBottom: 12 }}><span className={cx("stamp")}>needed</span><span>The conditioned square footage — nothing else can stand in for it. <button type="button" className={cx("link")} onClick={() => document.getElementById("hv-conditionedSqft")?.focus()}>Type it</button> or say it on the walk.</span></div>}
            {def.needs.zone && !jobInput.zoneSqft && <div className={cx("call", "warn")} style={{ marginBottom: 12 }}><span className={cx("stamp")}>needed</span><span>The zone’s square footage — the rooms the heads will serve. <button type="button" className={cx("link")} onClick={() => document.getElementById("hv-zone-sqft")?.focus()}>Type it</button>.</span></div>}

            {def.needs.load && !def.needs.zone && <div className={cx("fs")}>
              <div className={cx("fs-t")}><span className={cx("kpi-lbl")}>The house</span><span className={cx("mono")}>{model.yearBuilt ? `era defaults from ${model.yearBuilt}` : "era defaults from 1985 until the year is known"}</span></div>
              <div className={cx("grid-f")}>
                <Field label="Conditioned sq ft" path="conditionedSqft" model={model} kind="num" onChange={onTyped} placeholder="2,400" />
                <Field label="Storeys" path="storeys" model={model} kind="num" onChange={onTyped} />
                <Field label="Year built" path="yearBuilt" model={model} kind="num" onChange={onTyped} placeholder="1998" />
                <Field label="Windows" path="windowType" model={model} kind="select" onChange={onTyped} options={[["single", "Single pane"], ["double", "Double pane"], ["double-lowe", "Double, low-E"], ["triple", "Triple pane"]]} />
                <Field label="Window area sq ft" path="windowSqft" model={model} kind="num" onChange={onTyped} placeholder={`${Math.round((model.conditionedSqft || 0) * model.windowToFloor) || 280} assumed`} />
                <Field label="Foundation" path="foundation" model={model} kind="select" onChange={onTyped} options={[["slab", "Slab"], ["crawl-vented", "Crawlspace, vented"], ["crawl-sealed", "Crawlspace, sealed"], ["basement-unconditioned", "Basement, unconditioned"], ["basement-conditioned", "Basement, conditioned"]]} />
              </div>
            </div>}
            {def.needs.zone && <div className={cx("fs")}>
              <div className={cx("fs-t")}><span className={cx("kpi-lbl")}>The envelope</span><span className={cx("mono")}>{model.yearBuilt ? `era defaults from ${model.yearBuilt}` : "era defaults from 1985 until the year is known"}</span></div>
              <div className={cx("grid-f")}>
                <Field label="Year built" path="yearBuilt" model={model} kind="num" onChange={onTyped} placeholder="1998" />
                <Field label="Ceiling ft" path="ceilingHeightFt" model={model} kind="num" onChange={onTyped} />
                <Field label="Windows" path="windowType" model={model} kind="select" onChange={onTyped} options={[["single", "Single pane"], ["double", "Double pane"], ["double-lowe", "Double, low-E"], ["triple", "Triple pane"]]} />
                <Field label="Window area sq ft" path="windowSqft" model={model} kind="num" onChange={onTyped} placeholder="assumed" />
                <Field label="Wall insulation" path="wallInsulation" model={model} kind="select" onChange={onTyped} options={[["none", "None"], ["r11", "R-11"], ["r13", "R-13"], ["r19", "R-19"], ["r21", "R-21"]]} />
                <Field label="Attic insulation" path="ceilingInsulation" model={model} kind="select" onChange={onTyped} options={[["none", "None"], ["r11", "R-11"], ["r19", "R-19"], ["r30", "R-30"], ["r38", "R-38"], ["r49", "R-49"]]} />
                <Field label="Shading" path="shading" model={model} kind="select" onChange={onTyped} options={[["none", "None — full sun"], ["some", "Some"], ["heavy", "Heavy trees"]]} />
              </div>
            </div>}

            <div className={cx("folds")}>
              {def.needs.load && !def.needs.zone && <details className={cx("fold2")}>
                <summary><span className={cx("fold2-t")}>More about the house</span><span className={cx("fold2-s")}>ceiling · insulation · tightness · ventilation fan · roof · shade · occupants</span><svg className={cx("ic", "fold2-c")}><use href="#i-chev" /></svg></summary>
                <div className={cx("fold2-b")}>
                  <div className={cx("grid-f")}>
                    <Field label="Ceiling ft" path="ceilingHeightFt" model={model} kind="num" onChange={onTyped} />
                    <Field label="Occupants" path="occupants" model={model} kind="num" onChange={onTyped} />
                    <Field label="Wall insulation" path="wallInsulation" model={model} kind="select" onChange={onTyped} options={[["none", "None"], ["r11", "R-11"], ["r13", "R-13"], ["r19", "R-19"], ["r21", "R-21"]]} />
                    <Field label="Attic insulation" path="ceilingInsulation" model={model} kind="select" onChange={onTyped} options={[["none", "None"], ["r11", "R-11"], ["r19", "R-19"], ["r30", "R-30"], ["r38", "R-38"], ["r49", "R-49"]]} />
                    <Field label="Whole-house ventilation fan" path="ventilationFan" model={model} kind="bool" onChange={onTyped} />
                    <Field label="Air tightness" path="tightness" model={model} kind="select" onChange={onTyped} options={[["leaky", "Leaky"], ["average", "Average"], ["tight", "Tight"], ["very-tight", "Very tight"]]} />
                    <Field label="Roof colour" path="roofColor" model={model} kind="select" onChange={onTyped} options={[["light", "Light"], ["medium", "Medium"], ["dark", "Dark"]]} />
                    <Field label="Shading" path="shading" model={model} kind="select" onChange={onTyped} options={[["none", "None — full sun"], ["some", "Some"], ["heavy", "Heavy trees"]]} />
                  </div>
                </div>
              </details>}
              {def.needs.existing && <details className={cx("fold2")}>
                <summary><span className={cx("fold2-t")}>Existing system</span><span className={cx("fold2-s")}>{sumExisting}</span><svg className={cx("ic", "fold2-c")}><use href="#i-chev" /></svg></summary>
                <div className={cx("fold2-b")}><div className={cx("grid-f")}>
                  <Field label="Kind" path="existing.kind" model={model} kind="select" onChange={onTyped} options={[["split-ac-furnace", "AC + furnace"], ["split-heat-pump", "Heat pump"], ["furnace-only", "Furnace only"], ["package-unit", "Package / rooftop"], ["ductless", "Ductless"], ["none", "None"]]} />
                  <Field label="Tons" path="existing.tons" model={model} kind="num" onChange={onTyped} step="0.5" />
                  <Field label="On the hottest days it" path="existing.keptUp" model={model} kind="select" onChange={onTyped} options={[["yes", "Kept up"], ["no", "Couldn't keep up"]]} />
                  <Field label="Furnace BTU input" path="existing.btuInput" model={model} kind="num" onChange={onTyped} placeholder="80,000" />
                  <Field label="Fuel" path="existing.fuel" model={model} kind="select" onChange={onTyped} options={[["gas", "Natural gas"], ["propane", "Propane"], ["electric", "Electric"], ["oil", "Oil"], ["none", "None"]]} />
                  <Field label="Refrigerant" path="existing.refrigerant" model={model} kind="select" onChange={onTyped} options={[["R-22", "R-22"], ["R-410A", "R-410A"], ["R-454B", "R-454B"], ["R-32", "R-32"]]} />
                  <Field label="Year made" path="existing.yearMade" model={model} kind="num" onChange={onTyped} />
                  <Field label="Brand" path="existing.brand" model={model} kind="text" onChange={onTyped} />
                  <Field label="Model number" path="existing.model" model={model} kind="text" onChange={onTyped} placeholder="24ACC636A003" />
                </div></div>
              </details>}
              {def.needs.electrical && <details className={cx("fold2")}>
                <summary><span className={cx("fold2-t")} title="The panel count the checks run: NEC 220.83(B)">Electrical</span><span className={cx("fold2-s")}>{sumPanel}</span><svg className={cx("ic", "fold2-c")}><use href="#i-chev" /></svg></summary>
                <div className={cx("fold2-b")}><div className={cx("grid-f")}>
                  <Field label="Main breaker" path="electrical.mainAmps" model={model} kind="select" onChange={(p, v) => onTyped(p, v === undefined ? undefined : Number(v))} options={[["60", "60 A"], ["100", "100 A"], ["125", "125 A"], ["150", "150 A"], ["200", "200 A"], ["400", "400 A"]]} />
                  <Field label="Open breaker slots" path="electrical.freeSlots" model={model} kind="num" onChange={onTyped} />
                  {job !== "water-heater" && <>
                    <Field label="Electric range" path="electrical.electricRange" model={model} kind="bool" onChange={onTyped} />
                    <Field label="Electric dryer" path="electrical.electricDryer" model={model} kind="bool" onChange={onTyped} />
                    <Field label="Electric water heater" path="electrical.electricWaterHeater" model={model} kind="bool" onChange={onTyped} />
                    <Field label="EV charger" path="electrical.evCharger" model={model} kind="bool" onChange={onTyped} />
                  </>}
                </div></div>
              </details>}
              {(def.needs.ducts || def.needs.gas) && <details className={cx("fold2")}>
                <summary><span className={cx("fold2-t")}>{def.needs.ducts && def.needs.gas ? "Ducts · gas" : def.needs.ducts ? "Ducts" : "Gas supply"}</span><span className={cx("fold2-s")}>{sumDucts}</span><svg className={cx("ic", "fold2-c")}><use href="#i-chev" /></svg></summary>
                <div className={cx("fold2-b")}><div className={cx("grid-f")}>
                  {def.needs.ducts && <>
                    <Field label="Ducts are in" path="ducts.location" model={model} kind="select" onChange={onTyped} options={[["conditioned", "Conditioned space"], ["attic", "Attic"], ["crawl", "Crawlspace"], ["basement", "Basement"], ["none", "No ducts"]]} />
                    <Field label="Duct condition" path="ducts.condition" model={model} kind="select" onChange={onTyped} options={[["good", "Good"], ["fair", "Fair"], ["poor", "Poor"], ["unknown", "Not seen"]]} />
                    <Field label="Ducts insulated" path="ducts.insulated" model={model} kind="bool" onChange={onTyped} />
                    <Field label="Supply registers" path="ducts.supplyRegisters" model={model} kind="num" onChange={onTyped} placeholder="8" />
                    <Field label="Return grille (sq in, W×H)" path="ducts.returnGrilleSqIn" model={model} kind="num" onChange={onTyped} placeholder="20×25 = 500" area />
                    <Field label="Static pressure (in. w.c.)" path="ducts.measuredTespInWc" model={model} kind="num" onChange={onTyped} step="0.05" />
                    {/* The duct calculator's inputs (lib/hvac/ductCalc, 2026-10-08): the sizes a tech reads at the plenum. */}
                    <Field label="Supply trunk (Ø or W×H, in)" path="ducts.supplyTrunk" model={model} kind="text" onChange={onTyped} placeholder="16 or 20×8" />
                    <Field label="Return duct (Ø or W×H, in)" path="ducts.returnDuct" model={model} kind="text" onChange={onTyped} placeholder="16 or 20×10" />
                    <Field label="Branch runs Ø (in)" path="ducts.branchIn" model={model} kind="num" onChange={onTyped} placeholder="6" step="1" />
                  </>}
                  {def.needs.gas && <>
                    <Field label="Gas at the house" path="gas.available" model={model} kind="bool" onChange={onTyped} />
                    <Field label="Gas pipe" path="gas.pipeIn" model={model} kind="select" onChange={(p, v) => onTyped(p, v === undefined ? undefined : Number(v))} options={[["0.5", "½ in"], ["0.75", "¾ in"], ["1", "1 in"], ["1.25", "1¼ in"]]} />
                    <Field label="Gas run ft" path="gas.longestRunFt" model={model} kind="num" onChange={onTyped} />
                  </>}
                </div></div>
              </details>}
              {def.needs.waterHeater && (
                <div className={cx("fs")}>
                  <div className={cx("fs-t")}><span className={cx("kpi-lbl")}>The water heater that is there</span></div>
                  <div className={cx("grid-f")}>
                    <label className={cx("field")} htmlFor="hv-wh-old"><span className={cx("lbl")}>Existing tank</span><span className={cx("bp-sel", "hvsel")}><select id="hv-wh-old" className={cx("bp-sel-in", "sel")} value={jobInput.wh?.existingFuel ?? ""} onChange={(e) => setWh({ existingFuel: (e.target.value || undefined) as NonNullable<JobInput["wh"]>["existingFuel"] })}><option value="">not seen</option><option value="gas">Gas</option><option value="electric">Electric</option><option value="propane">Propane</option></select></span></label>
                    <Field label="Occupants" path="occupants" model={model} kind="num" onChange={onTyped} />
                  </div>
                </div>
              )}
            </div>

            <div className={cx("putin")}>
              <div className={cx("sec-title")}>What we&rsquo;re putting in</div>
              <div className={cx("sec-sub")}>The calls for this job — they set the size, the parts and the price.</div>
            {def.needs.zone && (
              <div className={cx("fs")}>
                <div className={cx("fs-t")}><span className={cx("kpi-lbl")}>The zone</span><span className={cx("mono")}>the rooms the heads will serve</span></div>
                <div className={cx("grid-f")}>
                  <label className={cx("field")} htmlFor="hv-zone-sqft"><span className={cx("lbl")}><span>Zone sq ft</span>{jobInput.zoneSqft ? <span className={cx("chip", "chip-stated")}>stated</span> : <span className={cx("chip", "chip-default")}>needed</span>}</span><input id="hv-zone-sqft" className={cx("in", "num")} inputMode="decimal" placeholder="420" defaultValue={jobInput.zoneSqft ?? ""} onBlur={(e) => { const n = Number(e.target.value.replace(/,/g, "")); setJobInput((j) => ({ ...j, zoneSqft: e.target.value.trim() && Number.isFinite(n) && n > 0 ? n : undefined })); }} /></label>
                  <label className={cx("field")} htmlFor="hv-heads"><span className={cx("lbl")}>Indoor heads</span><span className={cx("bp-sel", "hvsel")}><select id="hv-heads" className={cx("bp-sel-in", "sel")} value={String(jobInput.heads ?? 1)} onChange={(e) => setJobInput((j) => ({ ...j, heads: Number(e.target.value) }))}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></span></label>
                </div>
              </div>
            )}
            {def.needs.waterHeater && (
              <div className={cx("fs")}>
                <div className={cx("fs-t")}><span className={cx("kpi-lbl")}>The new water heater</span><span className={cx("mono")}>{jobInput.wh?.gallons ? "size entered" : `sized from ${model.occupants} occupants`}</span></div>
                <div className={cx("grid-f")}>
                  <label className={cx("field")} htmlFor="hv-wh-fuel"><span className={cx("lbl")}>New fuel</span><span className={cx("bp-sel", "hvsel")}><select id="hv-wh-fuel" className={cx("bp-sel-in", "sel")} value={jobInput.wh?.fuel ?? ""} onChange={(e) => setWh({ fuel: (e.target.value || undefined) as NonNullable<JobInput["wh"]>["fuel"] })}><option value="">as the house ({model.gas.available === false ? "electric" : "gas"})</option><option value="gas">Natural gas</option><option value="propane">Propane</option><option value="electric">Electric</option></select></span></label>
                  <label className={cx("field")} htmlFor="hv-wh-type"><span className={cx("lbl")}>Type</span><span className={cx("bp-sel", "hvsel")}><select id="hv-wh-type" className={cx("bp-sel-in", "sel")} value={jobInput.wh?.type ?? "tank"} onChange={(e) => { const type = e.target.value as NonNullable<JobInput["wh"]>["type"]; setWh(type === "heat-pump" ? { type, fuel: "electric" } : { type }); }}><option value="tank">Tank</option><option value="heat-pump">Heat-pump tank</option><option value="tankless">Tankless</option></select></span></label>
                  <label className={cx("field")} htmlFor="hv-wh-gal"><span className={cx("lbl")}>Gallons</span><input id="hv-wh-gal" className={cx("in", "num")} inputMode="decimal" placeholder="auto" defaultValue={jobInput.wh?.gallons ?? ""} onBlur={(e) => { const n = Number(e.target.value); setWh({ gallons: e.target.value.trim() && Number.isFinite(n) && n > 0 ? n : undefined }); }} /></label>
                  <label className={cx("field")} htmlFor="hv-wh-vent"><span className={cx("lbl")}>Venting</span><span className={cx("bp-sel", "hvsel")}><select id="hv-wh-vent" className={cx("bp-sel-in", "sel")} value={jobInput.wh?.vent ?? ""} onChange={(e) => setWh({ vent: (e.target.value || undefined) as NonNullable<JobInput["wh"]>["vent"] })}><option value="">as existing</option><option value="atmospheric">Atmospheric (B-vent)</option><option value="power">Power vent</option><option value="direct">Direct vent</option><option value="none">None (electric)</option></select></span></label>
                  <label className={cx("field")} htmlFor="hv-wh-loc"><span className={cx("lbl")}>Location</span><span className={cx("bp-sel", "hvsel")}><select id="hv-wh-loc" className={cx("bp-sel-in", "sel")} value={jobInput.wh?.location ?? "garage"} onChange={(e) => setWh({ location: e.target.value as NonNullable<JobInput["wh"]>["location"] })}><option value="garage">Garage</option><option value="closet">Closet</option><option value="basement">Basement</option><option value="utility">Utility room</option><option value="attic">Attic</option><option value="outdoor">Outdoor</option></select></span></label>
                </div>
              </div>
            )}
            {job === "service" && model && (() => {
              const menu = serviceMenuFor(model, card.card.serviceMenu, card.card.serviceOverrides);
              const adj = card.card.serviceLaborAdjustPct ?? 0;
              const sel = new Set(jobInput.service?.tasks ?? []);
              // Labor in this market, and the repair-or-replace read on what is picked.
              const idx = serviceLaborIndex(model);
              const advice = sel.size ? repairAdvice({ model, taskIds: [...sel], repairSubtotal: ledger?.subtotal ?? 0, replaceSubtotal: replaceQuote }) : null;
              const customOn = jobInput.service?.custom ?? [];
              const rechargeOn = sel.has("recharge");
              const q = svcQ.trim().toLowerCase();
              const picked = sel.size + customOn.length;
              return (
                <div className={cx("fs")}>
                  <div className={cx("fs-t")}><span className={cx("kpi-lbl")}>The visit</span><span className={cx("mono")}>{picked ? `${picked} task${picked === 1 ? "" : "s"} on the estimate` : "pick what the visit does — the diagnostic is on until a tune-up covers it"}</span></div>
                  {menu.notes.map((n) => <div key={n} className={cx("call", "info")} style={{ marginBottom: 10 }}><span className={cx("stamp")}>say</span><span>{n}</span></div>)}
                  <div className={cx("svc-top")}>
                    <span className={cx("addr", "addr-sm")}><svg className={cx("ic")}><use href="#i-search" /></svg><input className={cx("addr-in")} placeholder="Filter the tasks" value={svcQ} onChange={(e) => setSvcQ(e.target.value)} aria-label="Filter the tasks" /></span>
                  </div>
                  {menu.groups.map((g) => {
                    const tasks = g.tasks.filter((t) => !q || t.title.toLowerCase().includes(q) || (t.includes ?? "").toLowerCase().includes(q));
                    if (!tasks.length) return null;
                    const openGroup = !!q || tasks.some((t) => sel.has(t.id) || menu.recommended.includes(t.id));
                    const pickedHere = tasks.filter((t) => sel.has(t.id)).length;
                    return (
                      <details key={g.group} className={cx("svc-g", "fold2")} open={openGroup}>
                        <summary><span className={cx("fold2-t")}>{g.title}</span><span className={cx("fold2-s")}>{pickedHere ? `${pickedHere} picked · ` : ""}{tasks.length} task{tasks.length === 1 ? "" : "s"}</span><svg className={cx("ic", "fold2-c")}><use href="#i-chev" /></svg></summary>
                        <ul className={cx("svc-rows")}>
                          {tasks.map((t) => {
                            const on = sel.has(t.id);
                            const rec = menu.recommended.includes(t.id);
                            return (
                              <li key={t.id} className={cx("svc-r", on && "on")}>
                                <button type="button" role="checkbox" aria-checked={on} className={cx("svc-rb")} onClick={() => toggleTask(t.id)}>
                                  <span className={cx("svc-box")} aria-hidden="true">{on && <svg className={cx("ic")}><use href="#i-check" /></svg>}</span>
                                  <span className={cx("svc-n")}>{t.title}{rec && !on ? <span className={cx("svc-tag")}>suggested</span> : null}{t.custom || t.ownLabor ? <span className={cx("svc-tag")}>yours</span> : null}</span>
                                                  <span className={cx("mono", "svc-p")}>{t.unit === "lb" ? `$${card.card.labor.refrigerantPerLb}/lb + refrigerant` : `$${indexedLabor(t, idx.factor, adj).toLocaleString("en-US")}${t.part ? ` + $${t.part.costUsd.toLocaleString("en-US")} part` : ""}`}</span>
                                </button>
                                {on && (
                                  <div className={cx("svc-x")}>
                                    <span>{t.includes}{t.part?.brands?.length ? ` · ${t.part.brands.join(" / ")}` : ""}</span>
                                    {t.id === "recharge" && rechargeOn && (
                                      <label className={cx("field")} htmlFor="hv-svc-lb" style={{ maxWidth: 200 }}><span className={cx("lbl")}>Refrigerant, lb</span><input id="hv-svc-lb" className={cx("in", "num")} inputMode="decimal" placeholder="3" defaultValue={jobInput.service?.refrigerantLb ?? ""} onBlur={(e) => { const n = Number(e.target.value); setSvc({ refrigerantLb: e.target.value.trim() && Number.isFinite(n) && n > 0 ? n : undefined }); }} /></label>
                                    )}
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </details>
                    );
                  })}
                  {customOn.length > 0 && (
                    <ul className={cx("svc-list")}>
                      {customOn.map((c, i) => <li key={`${c.name}-${i}`}><span>{c.name} — ${c.laborUsd.toLocaleString("en-US")} labor{c.partName ? ` · ${c.partName}${c.partCost ? ` $${c.partCost.toLocaleString("en-US")}` : ""}` : ""}</span><button type="button" className={cx("link")} onClick={() => setSvc({ custom: customOn.filter((_, k) => k !== i) })}>Remove</button></li>)}
                    </ul>
                  )}
                  {advice && advice.verdict !== "repair" && (
                    <div className={cx("call", advice.verdict === "replace" ? "warn" : "info")} style={{ marginTop: 10 }} data-repair-advice={advice.verdict}>
                      <span className={cx("stamp")}>{advice.verdict === "replace" ? "replace" : "weigh it"}</span>
                      <span>
                        {advice.why.join("; ")}
                        {replaceQuote ? ` — a replacement here runs about $${Math.round(replaceQuote).toLocaleString("en-US")} against $${Math.round(ledger?.subtotal ?? 0).toLocaleString("en-US")} of repairs.` : "."}{" "}
                        <button type="button" className={cx("btn", "btn-ghost", "btn-sm")} style={{ marginLeft: 6 }} onClick={() => setJob("replace-system")}>Quote the replacement</button>
                      </span>
                    </div>
                  )}
                  <details className={cx("how")}>
                    <summary>Not listed? Add it</summary>
                    <div className={cx("how-b")}>
                      <div className={cx("grid", "grid-rc")}>
                        <label className={cx("field")} htmlFor="hv-cust-name"><span className={cx("lbl")}>Task</span><input id="hv-cust-name" className={cx("in")} placeholder="Replace the zone damper actuator" value={svcDraft.name ?? ""} onChange={(e) => setSvcDraft((d) => ({ ...d, name: e.target.value }))} /></label>
                        <label className={cx("field")} htmlFor="hv-cust-labor"><span className={cx("lbl")}>Labor $</span><input id="hv-cust-labor" className={cx("in", "num")} inputMode="decimal" placeholder="180" value={svcDraft.labor ?? ""} onChange={(e) => setSvcDraft((d) => ({ ...d, labor: e.target.value }))} /></label>
                        <label className={cx("field")} htmlFor="hv-cust-part"><span className={cx("lbl")}>Part (optional)</span><input id="hv-cust-part" className={cx("in")} placeholder="Damper actuator" value={svcDraft.partName ?? ""} onChange={(e) => setSvcDraft((d) => ({ ...d, partName: e.target.value }))} /></label>
                        <label className={cx("field")} htmlFor="hv-cust-cost"><span className={cx("lbl")}>Part cost $</span><input id="hv-cust-cost" className={cx("in", "num")} inputMode="decimal" placeholder="85" value={svcDraft.partCost ?? ""} onChange={(e) => setSvcDraft((d) => ({ ...d, partCost: e.target.value }))} /></label>
                      </div>
                      <div className={cx("acts")}>
                        <button type="button" className={cx("btn", "btn-primary", "btn-sm")} onClick={addCustomTask}>Add to this estimate</button>
                        <button type="button" className={cx("btn", "btn-ghost", "btn-sm")} onClick={() => void saveCustomTask()}>Save to my menu</button>
                        <span className={cx("acts-note")}>{svcMsg}</span>
                      </div>
                    </div>
                  </details>
                </div>
              );
            })()}
            {(def.selection !== "none" || def.needs.ducts) && <div className={cx("fs")}>
              <div className={cx("fs-t")}><span className={cx("kpi-lbl")}>How you want it done</span><span className={cx("mono")}>the calls that are yours, not the house&rsquo;s</span></div>
              <div className={cx("grid-f")}>
                {(job === "replace-system" || job === "heat-pump-conversion") && (
                  <label className={cx("field")} htmlFor="hv-heatpref">
                    <span className={cx("lbl")}><span>Heat preference</span>{(model.provenance["preferences.keepGas"] || model.provenance["preferences.allElectric"]) && <Chip p={model.provenance["preferences.keepGas"] ?? model.provenance["preferences.allElectric"]} />}</span>
                    <span className={cx("bp-sel", "hvsel")}><select id="hv-heatpref" className={cx("bp-sel-in", "sel")} value={model.preferences.allElectric ? "electric" : model.preferences.keepGas ? "gas" : ""} onChange={(e) => { const v = e.target.value; onTyped("preferences.keepGas", v === "gas" ? true : v === "electric" ? false : undefined); onTyped("preferences.allElectric", v === "electric" ? true : v === "gas" ? false : undefined); }}>
                      <option value="">no preference</option>
                      <option value="gas">Keep gas heat</option>
                      <option value="electric">Go all-electric</option>
                    </select></span>
                  </label>
                )}
                {def.selection !== "none" && <Field label="Noise sensitive" path="preferences.noiseSensitive" model={model} kind="bool" onChange={onTyped} />}
                {def.selection !== "none" && def.selection !== "furnace" && <label className={cx("field")} htmlFor="hv-lineset">
                  <span className={cx("lbl")}><span>Line set ft</span>{linesetFt !== undefined && <span className={cx("chip", "chip-stated")}>stated</span>}</span>
                  <input id="hv-lineset" className={cx("in", "num")} inputMode="decimal" placeholder={String(card.card.linesetFtDefault)} defaultValue={linesetFt ?? ""} onBlur={(e) => { const n = Number(e.target.value); setLinesetFt(e.target.value.trim() && Number.isFinite(n) && n > 0 ? n : undefined); }} />
                </label>}
              </div>
            </div>}
            </div>

            <div className={cx("st-next")}>
              <button type="button" className={cx("btn", "btn-primary")} disabled={S.design.locked} onClick={() => go("design")}>Continue to {def.needs.load ? "the design" : "the checks"}<svg className={cx("ic")}><use href="#i-arrow" /></svg></button>
              <span className={cx("acts-note")}>{S.design.locked ? S.design.reason : engine ? `${sizeText}${lines ? " · " + money(subtotal) : ""}` : ""}</span>
            </div>
          </div>
        </>
      )}
      </Step>

      {/* ── 4 · THE DESIGN ───────────────────────────────────────────────── */}
      <Step k="design" meta={S.design} open={cur === "design"}>
      {engine && model ? (
        <>
          {engine.waterHeater && (
            <div className={cx("hero", "hero-d")}>
              <div className={cx("hero-cell")}><div className={cx("kpi-lbl")}>Tank</div><div className={cx("hero-v", "accent")}>{engine.waterHeater.type === "tankless" ? "tankless" : engine.waterHeater.gallons}<small>{engine.waterHeater.type === "tankless" ? "" : "gal"}</small></div><div className={cx("hero-h")}>{engine.waterHeater.sizedFrom}</div></div>
              <div className={cx("hero-cell")}><div className={cx("kpi-lbl")}>Fuel · type</div><div className={cx("hero-v")}>{engine.waterHeater.fuel}</div><div className={cx("hero-h")}>{engine.waterHeater.type === "heat-pump" ? "heat-pump tank" : engine.waterHeater.type} · {engine.waterHeater.vent === "none" ? "no vent" : `${engine.waterHeater.vent} vent`}</div></div>
              <div className={cx("hero-cell")}><div className={cx("kpi-lbl")}>{engine.waterHeater.btuInput ? "Gas input" : "Circuit"}</div><div className={cx("hero-v")}>{engine.waterHeater.btuInput ? num(engine.waterHeater.btuInput) : engine.waterHeater.circuitAmps ? `${engine.waterHeater.circuitAmps}` : "—"}<small>{engine.waterHeater.btuInput ? "BTU/h" : "A · 240 V"}</small></div><div className={cx("hero-h")}>{engine.waterHeater.location}</div></div>
            </div>
          )}
          {def.needs.load && <div className={cx("hero", "hero-d")}>
            <div className={cx("hero-cell")}>
              <div className={cx("kpi-lbl")}>Cooling load</div>
              <div className={cx("hero-v", "accent")}>{num(engine.load.coolingTotalBtuh)}</div>
              <div className={cx("hero-h")}>BTU/h · {engine.load.coolingTons.toFixed(1)} tons · SHR {engine.load.sensibleHeatRatio.toFixed(2)}</div>
            </div>
            <div className={cx("hero-cell")}>
              <div className={cx("kpi-lbl")}>Heating load</div>
              <div className={cx("hero-v")}>{num(engine.load.heatingBtuh)}</div>
              <div className={cx("hero-h")}>BTU/h at {engine.conditions.heatingF}° outdoor</div>
            </div>
            <div className={cx("hero-cell")}>
              <div className={cx("kpi-lbl")}>Size</div>
              <div className={cx("hero-v")}>{def.selection === "furnace" ? (chosen?.item.btuInput ? `${Math.round(chosen.item.btuInput / 1000)}k` : "—") : engine.selection.systems > 1 ? `${engine.selection.systems} × ${chosen?.item.tons ?? "?"}` : chosen?.item.tons ?? engine.selection.targetTons}<small>{def.selection === "furnace" ? "BTU in" : "ton"}</small></div>
              <div className={cx("hero-h")}>{def.selection === "furnace" ? `output ${chosen?.furnaceOutputBtuh ? num(chosen.furnaceOutputBtuh) : "—"} BTU/h` : engine.selection.systems > 1 ? "two zones, one system each" : `target ${engine.selection.targetTons} t`}</div>
            </div>
            {engine.zone ? (
              <div className={cx("hero-cell")}>
                <div className={cx("kpi-lbl")}>Zone</div>
                <div className={cx("hero-v")}>{num(engine.zone.sqft)}<small>sq ft</small></div>
                <div className={cx("hero-h")}>{engine.zone.heads} head{engine.zone.heads === 1 ? "" : "s"} · no ducts</div>
              </div>
            ) : (
              <div className={cx("hero-cell")}>
                <div className={cx("kpi-lbl")}>Airflow</div>
                <div className={cx("hero-v")}>{num(engine.load.coolingCfm)}<small>CFM</small></div>
                {/* Whether the ducts were held against this airflow (2026-10-08): nothing measured is said in red, not left among the checks. */}
                <div className={cx("hero-h", def.needs.ducts && engine.airflow?.verifiedBy === "none" && "hero-warn")}>
                  {def.needs.ducts && engine.airflow
                    ? engine.airflow.verifiedBy === "none" ? "not verified — measure static or the trunk"
                      : engine.airflow.verifiedBy === "sizes" ? `ducts carry ~${num(engine.airflow.capacityCfm ?? 0)} CFM${engine.airflow.sizedToDucts ? " · sized to them" : ""}`
                      : `static measured · ${engine.load.cfmPerTon} CFM/ton`
                    : `${engine.load.cfmPerTon} CFM/ton · ducts ${Math.round(engine.load.ductGainCooling * 100)}% gain`}
                </div>
              </div>
            )}
          </div>}
          {kindQuotes.length === 2 && (
            <div className={cx("dsec")}>
            <div className={cx("kpi-lbl", "dsec-k")}>{def.id === "replace-outdoor" ? "What goes outside" : "System"}</div>
            <div className={cx("kinds")} role="radiogroup" aria-label={def.id === "replace-outdoor" ? "What goes outside" : "System type"} onKeyDown={radioKeys}>
              {kindQuotes.map((q) => {
                const on = engineRaw?.selection.chosen?.item.kind === q.kind;
                return (
                  <button key={q.kind} type="button" role="radio" aria-checked={on} className={cx("kind", on && "on")} onClick={() => { setOutdoorKind(q.kind); setPickId(null); }}>
                    <span className={cx("kind-t")}>{q.kind === "air-conditioner" ? "Air conditioner" : "Heat pump"}<span className={cx("kind-v")}>{money(on && ledger ? ledger.subtotal : q.subtotal)}</span></span>
                    <span className={cx("kind-s")}>{q.sub}</span><span className={cx("job-stamp")} aria-hidden="true"><svg className={cx("ic")}><use href="#i-check" /></svg></span>
                  </button>
                );
              })}
            </div>
            </div>
          )}
          {whOptions.length > 0 && (
            <div className={cx("dsec")}>
            <div className={cx("kpi-lbl", "dsec-k")}>Equipment</div>
            <div className={cx("tiers", "tiers-wh")} role="radiogroup" aria-label="Which tank" onKeyDown={radioKeys}>
              {whOptions.map((o, i) => {
                const on = (whChosen?.id ?? "") === o.item.id;
                return (
                  <button key={o.item.id} type="button" role="radio" aria-checked={on} className={cx("tier", on && "on")} onClick={() => { setPickId(o.item.id); setSwapMsg(""); }}>
                    <span className={cx("tier-k")}>{i === 0 && !pickId ? "Engine's pick" : o.item.brand}</span>
                    <span className={cx("tier-t")}>{o.item.brand} {o.item.model}</span>
                    <span className={cx("tier-m")}>{[o.item.gallons ? `${o.item.gallons} gal` : o.item.btuInput ? `${Math.round(o.item.btuInput / 1000)}k BTU/h` : "", o.item.uef ? `${o.item.uef} UEF` : "", o.item.vent && o.item.vent !== "none" ? `${o.item.vent} vent` : "", o.item.typed ? "typed in" : ""].filter(Boolean).join(" · ")}</span>
                    <span className={cx("tier-v")}>{money(o.subtotal)}{!o.item.cost && <small className={cx("tier-m")}> · rate-card price, no cost on the row</small>}</span><span className={cx("job-stamp")} aria-hidden="true"><svg className={cx("ic")}><use href="#i-check" /></svg></span>
                  </button>
                );
              })}
            </div>
            </div>
          )}
          {tiers.length > 1 && (
            <div className={cx("dsec")}>
            <div className={cx("kpi-lbl", "dsec-k")}>Equipment</div>
            <div className={cx("tiers")} role="radiogroup" aria-label="Good, better, best" onKeyDown={radioKeys}>
              {tiers.map((t) => {
                const on = (engine?.selection.chosen?.item.id ?? "") === t.candidate.item.id;
                return (
                  <button key={t.tier} type="button" role="radio" aria-checked={on} className={cx("tier", on && "on")} onClick={() => setPickId(t.candidate.item.id)}>
                    <span className={cx("tier-k")}>{t.tier === "value" ? "Good" : t.tier === "mid" ? "Better" : "Best"}</span>
                    <span className={cx("tier-t")}>{t.candidate.item.brand} {t.candidate.item.model}</span>
                    <span className={cx("tier-m")}>{t.candidate.item.seer2 ? `${t.candidate.item.seer2} SEER2` : ""}{t.candidate.item.hspf2 ? ` · ${t.candidate.item.hspf2} HSPF2` : ""}{t.candidate.item.afue ? `${Math.round(t.candidate.item.afue * 100)}% AFUE` : ""}{t.candidate.item.staging ? ` · ${t.candidate.item.staging}` : ""}</span>
                    <span className={cx("tier-v")}>{money(t.subtotal)}</span><span className={cx("job-stamp")} aria-hidden="true"><svg className={cx("ic")}><use href="#i-check" /></svg></span>
                  </button>
                );
              })}
            </div>
            </div>
          )}
          <div className={cx("design")}>
            <div>
              {def.selection === "none" ? (
                <>
                  {def.id === "water-heater" && engine.waterHeater && (
                    <div className={cx("unit")}>
                      <div className={cx("unit-t")}>{whChosen ? `${whChosen.brand} ${whChosen.model}` : `${engine.waterHeater.gallons ? `${engine.waterHeater.gallons} gal ` : ""}${engine.waterHeater.fuel} ${engine.waterHeater.type === "heat-pump" ? "heat-pump tank" : engine.waterHeater.type} — no catalog row fits`}</div>
                      <div className={cx("mono", "unit-m")}>{whChosen ? [whChosen.gallons ? `${whChosen.gallons} gal` : "", whChosen.btuInput ? `${Math.round(whChosen.btuInput / 1000)}k BTU/h` : "", whChosen.uef ? `${whChosen.uef} UEF` : "", whChosen.vent && whChosen.vent !== "none" ? `${whChosen.vent} vent` : "", whChosen.typed ? "typed in" : whChosen.source === "shop" ? "your catalog" : "US catalog"].filter(Boolean).join(" · ") : "priced from the rate card until a row fits — pick or type one below"}</div>
                      <ul>
                        <li>{engine.waterHeater.sizedFrom}{whChosen && engine.waterHeater.type !== "tankless" && whChosen.gallons && whChosen.gallons > engine.waterHeater.gallons ? ` — the catalog's next size up is ${whChosen.gallons} gal` : ""}.</li>
                        {whOptions.length > 1 && <li>{whOptions.length} makers fit this tank: {whOptions.map((o) => o.item.brand).join(", ")}. Tap one above to price it.</li>}
                        {whChosen && whChosen.typed && <li>Typed in for this estimate — confirm it against the submittal.</li>}
                      </ul>
                    </div>
                  )}
                  {(() => {
                    // The engine's water-heater job note is the tank and its sizing again — the
                    // same two values the card above already prints — so it is not listed twice.
                    const wh = def.id === "water-heater" ? engine.waterHeater : undefined;
                    const jobNotes = engine.notes.filter((n) => n.kind === "contractor" && !(wh && n.text.includes(wh.sizedFrom)));
                    return jobNotes.length ? <ul className={cx("notes")}>{jobNotes.map((n) => <li key={n.text}><span className={cx("chip", "chip-read")}>job</span><span>{n.text}</span></li>)}</ul> : null;
                  })()}
                </>
              ) : chosen ? (
                <div className={cx("unit")}>
                  <div className={cx("unit-t")}>{engine.selection.systems > 1 ? `${engine.selection.systems} × ` : ""}{chosen.item.brand} {chosen.item.model}</div>
                  <div className={cx("mono", "unit-m")}>{chosen.item.kind.replace(/-/g, " ")}{chosen.item.tons ? ` · ${chosen.item.tons} t` : ""}{chosen.item.seer2 ? ` · ${chosen.item.seer2} SEER2` : ""}{chosen.item.hspf2 ? ` · ${chosen.item.hspf2} HSPF2` : ""}{chosen.item.refrigerant ? ` · ${chosen.item.refrigerant}` : ""}{chosen.item.staging ? ` · ${chosen.item.staging}` : ""}{chosen.item.coldClimate ? " · cold climate" : ""}</div>
                  {chosen.overridden && <div className={cx("call", "warn")} style={{ margin: "8px 0" }}><span className={cx("stamp")}>your pick</span><span>The engine ruled this unit out: {chosen.overridden} It is on the estimate because you chose it.</span></div>}
                  {chosen.item.typed && <div className={cx("call")} style={{ margin: "8px 0" }}><span className={cx("stamp")}>typed in</span><span>Typed in for this estimate, not a catalog row. Save it to the catalog below and it is there next time.</span></div>}
                  <ul>{chosen.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                  {!catalog?.own && <div className={cx("runner")}>{catalog?.source === "us" ? "Built-in US list — real brands and model numbers, priced from the rate card until your costs are in. Import the shop catalog below, or load the US list and add costs, and the same engine picks from it." : "Starter ladder — no shop costs on these rows. Import the shop catalog below and the same engine picks from it."}</div>}
                  {engine.selection.runnerUp && <div className={cx("runner")}><b>Runner-up:</b> {engine.selection.runnerUp.item.brand} {engine.selection.runnerUp.item.model} — {engine.selection.runnerUp.reasons[0]}</div>}
                </div>
              ) : (
                <div className={cx("call", "warn")}><span className={cx("stamp")}>no fit</span><span>{noxWall ? <>Every gas unit on your list is the 40 ng/J class, and {model?.county ?? "this"} County sits in a district that takes only ultra-low-NOx (14 ng/J) gas heat. {usStale ? <>Your catalog came from an older build of the US list, before the California families (Lennox NV/NE, Carrier 59SU5/59CU5, Goodman -U) were on it. <span className={cx("call-act")}><button type="button" className={cx("btn", "btn-primary")} onClick={onLoadUs} disabled={/^Loading/.test(catMsg)}>{/^Loading/.test(catMsg) ? "Updating…" : "Update the US catalog"}</button><span className={cx("mono")}>your own rows and costs stay</span></span></> : <>Add the ultra-low-NOx model you buy under <b>Change the unit</b> (set its NOx class to 14), or put 14 in the noxNgJ column of your CSV row.</>} A 40 ng/J unit can still go on with <i>Use anyway</i> under Change the unit when the job sits outside the district.</> : model?.existing.kind === "package-unit" && engine.selection.candidates.length === 0 ? (usStale ? <>No package rows in the catalog yet — your catalog came from an older build of the US list, before the package families were on it. <span className={cx("call-act")}><button type="button" className={cx("btn", "btn-primary")} onClick={onLoadUs} disabled={/^Loading/.test(catMsg)}>{/^Loading/.test(catMsg) ? "Updating…" : "Update the US catalog"}</button><span className={cx("mono")}>your own rows and costs stay</span></span> Until then the estimate prices a package unit from the rate card.</> : "No package rows in the catalog — the estimate prices a package unit from the rate card. Add your package rows (kind: package) to pick a model.") : <>No catalog unit lands within Manual S limits for a {num(engine.load.coolingTotalBtuh)} BTU/h load. Target {engine.selection.targetTons} t — import the shop catalog or check the disqualifiers: {engine.selection.candidates.filter((c) => c.disqualified).slice(0, 3).map((c) => `${c.item.model}: ${c.disqualified}`).join(" · ")}</>}</span></div>
              )}
              {chosen?.curve && chosen.item.kind === "heat-pump" && (
                <>
                  <CapacityChart curve={chosen.curve} designF={engine.conditions.heatingF} balanceF={chosen.balancePointF} cx={cx} />
                  <div className={cx("legend")}><span><i />capacity</span><span><i className={cx("d")} />heating load</span>{chosen.backupKw ? (engine.dualFuel ? <span>furnace carries {num(Math.max(0, engine.load.heatingBtuh - (chosen.heatAtDesignBtuh ?? 0)))} BTU/h at design</span> : <span>backup {chosen.backupKw} kW at design</span>) : <span>no backup at design</span>}</div>
                </>
              )}
              {chosen && chosen.item.kind !== "heat-pump" && chosen.coolingRatio !== undefined && (
                <div className={cx("fit")}>
                  <div className={cx("mono")}>Cooling fit · Manual S 90–{chosen.item.staging === "variable" ? 125 : 115}%</div>
                  <div className={cx("fit-bar")} style={{ marginTop: 6 }}>
                    <div className={cx("fit-band")} style={{ left: `${((0.9 - 0.7) / 0.7) * 100}%`, width: `${(((chosen.item.staging === "variable" ? 1.25 : 1.15) - 0.9) / 0.7) * 100}%` }} />
                    <div className={cx("fit-mark")} style={{ left: `calc(${Math.min(1, Math.max(0, (chosen.coolingRatio - 0.7) / 0.7)) * 100}% - 1px)` }} />
                  </div>
                  <div className={cx("fit-ax")}><span className={cx("mono")}>70%</span><span className={cx("mono")}>{Math.round(chosen.coolingRatio * 100)}% of load</span><span className={cx("mono")}>140%</span></div>
                </div>
              )}
            </div>
            <div>
              {(() => {
                /* Every check comes with its way to a pass (lib/hvac/fixes,
                   2026-10-08): what to type, what to pick, what is priced
                   already. The rows are grouped by what the contractor can do
                   — fix now, measure, or read for the install — and a strip
                   on top names the few clicks that get the estimate to pass. */
                const ctx = { model: model!, engine, job };
                const planned = engine.checks.map((c) => ({ c, plan: planFor(c, ctx) }));
                const pass = planned.filter((x) => x.c.status === "pass");
                const fix = planned.filter((x) => x.c.status !== "pass" && x.plan.group === "fix");
                const measure = planned.filter((x) => x.c.status !== "pass" && x.plan.group === "measure");
                const notes = planned.filter((x) => x.c.status !== "pass" && x.plan.group === "code");
                const steps = nextSteps(engine.checks, ctx);
                const rowIdOf = (c: { id: string; title: string }) => `hv-chk-${`${c.id}-${c.title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
                /** The strip's field action opens the row that carries the field — the fix is typed right there (2026-10-10,
                 *  owner: "offer to fix it right here"); anything else runs as before. */
                const openRowFor = (a: FixAction) => {
                  if (a.kind === "field") {
                    const hit = planned.find((x) => x.c.status !== "pass" && x.plan.actions.some((b) => b.kind === "field" && b.path === a.path));
                    if (hit) {
                      setOpenCheck(hit.c.id + hit.c.title);
                      window.setTimeout(() => { const el = document.getElementById(rowIdOf(hit.c)); el?.scrollIntoView({ behavior: "smooth", block: "center" }); (el?.querySelector("input, select") as HTMLElement | null)?.focus(); }, 60);
                      return;
                    }
                  }
                  runFix(a);
                };
                const actionButton = (a: FixAction, i: number, inRow = false) => {
                  if (a.kind === "ledger" || a.kind === "note") return <span key={i} className={cx("fix-note", a.kind === "ledger" && "fix-priced")} data-fix-kind={a.kind}>{a.kind === "ledger" && <svg className={cx("ic")}><use href="#i-check" /></svg>}{a.label}</span>;
                  if (a.kind === "field" && inRow) {
                    // A value the plan already knows is set right here; a figure to type is typed right here, prefilled from the model.
                    if (a.value !== undefined) return <button key={i} type="button" className={cx("fix-btn")} data-fix-kind="set" onClick={() => onTyped(a.path, a.value)}>{a.label}</button>;
                    const spec = fixFieldSpec(a.path);
                    if (spec) {
                      const onField = spec.numeric ? (pth: string, v: unknown) => onTyped(pth, v === undefined ? undefined : Number(v)) : onTyped;
                      return (
                        <div key={i} className={cx("chk-field")} data-fix-field={a.path}>
                          <Field label={spec.label} path={a.path} model={ctx.model} kind={spec.kind} options={spec.options} placeholder={spec.placeholder} step={spec.step} area={spec.area} onChange={onField} idPrefix="hvfix-" />
                        </div>
                      );
                    }
                  }
                  return <button key={i} type="button" className={cx("fix-btn")} data-fix-kind={a.kind} onClick={() => (inRow ? runFix(a) : openRowFor(a))}>{a.label}</button>;
                };
                // The row that was open has just passed: say so where it stood (it has moved into the passed fold).
                const passedNow = openCheck ? pass.find((x) => x.c.id + x.c.title === openCheck) : undefined;
                const row = ({ c, plan }: (typeof planned)[number]) => {
                  const id = c.id + c.title;
                  const open = openCheck === id;
                  return (
                    <li key={id} id={rowIdOf(c)} className={cx("chk-r", open && "open")}>
                      <button type="button" className={cx("chk-b")} aria-expanded={open} onClick={() => setOpenCheck(open ? null : id)}>
                        <span className={cx("chip", `chip-${c.status}`)}>{c.status}</span>
                        <span className={cx("chk-t")}>{c.title}</span>
                        <svg className={cx("ic", "chk-c")}><use href="#i-chev" /></svg>
                      </button>
                      {open && (
                        <div className={cx("chk-d")}>
                          {c.detail}{c.rule && <div className={cx("check-r")}>{c.rule}</div>}
                          {c.status !== "pass" && plan.actions.length > 0 && (
                            <div className={cx("chk-plan")} data-check-plan={plan.group}>
                              <div className={cx("chk-lead")}>{plan.lead}</div>
                              <div className={cx("chk-acts")}>{plan.actions.map((a, i) => actionButton(a, i, true))}</div>
                              {(() => { const f = plan.actions.find((a) => a.kind === "field" && a.value === undefined && fixFieldSpec(a.path)); return f ? <button type="button" className={cx("fix-link")} onClick={() => runFix(f)}>open in What is there</button> : null; })()}
                            </div>
                          )}
                          {c.status !== "pass" && plan.actions.length === 0 && <div className={cx("chk-lead")}>{plan.lead}</div>}
                        </div>
                      )}
                    </li>
                  );
                };
                return (
                  <>
                    <div className={cx("chk-sum")}>
                      <span className={cx("kpi-lbl")}>Checks</span>
                      <span className={cx("mono", "chk-n")}>{fix.length} to fix · {measure.length} to measure · {notes.length} for the install · {pass.length} pass</span>
                    </div>
                    {steps.length > 0 && (
                      <div className={cx("chk-next")} data-next-steps>
                        <span className={cx("kpi-lbl")}>To pass</span>
                        <div className={cx("chk-acts")}>{steps.map((a, i) => actionButton(a, i, false))}</div>
                      </div>
                    )}
                    {passedNow && <div className={cx("chk-clear")} data-just-passed>✓ {passedNow.c.title} — passed.</div>}
                    {fix.length + measure.length === 0 && notes.length + pass.length > 0 && <div className={cx("chk-clear")} data-all-clear>Nothing left to fix or measure on the design.</div>}
                    <ul className={cx("chk-l")}>{[...fix, ...measure].map(row)}</ul>
                    {notes.length > 0 && (
                      <details className={cx("chk-pass")} data-code-notes>
                        <summary><span className={cx("chip", "chip-verify")}>note</span><span className={cx("chk-t")}>{notes.length} for the install and the permit</span><span className={cx("mono")}>show</span></summary>
                        <ul className={cx("chk-l")}>{notes.map(row)}</ul>
                      </details>
                    )}
                    {pass.length > 0 && (
                      <details className={cx("chk-pass")}>
                        <summary><span className={cx("chip", "chip-pass")}>pass</span><span className={cx("chk-t")}>{pass.length} passed</span><span className={cx("mono")}>show</span></summary>
                        <ul className={cx("chk-l")}>{pass.map(row)}</ul>
                      </details>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
          <details className={cx("how", "how-wide")}>
            <summary>How this is calculated</summary>
            <div className={cx("how-b")}>
              <p>{def.needs.load ? `${def.needs.zone ? "Zone load" : "Block load"} at the county's design day, ${def.selection === "none" ? "the airflow the ducts must carry" : "the unit the catalog fits within Manual S limits"}, and the checks a permit desk or a customer would ask about.` : engine.waterHeater ? "The tank sized from the household, and the gas, circuit and venting checks an inspector asks about." : "What the visit needs, and the rule that applies."} Engine {engine.engineVersion}{def.needs.load ? ` · ${engine.conditions.source}${engine.conditions.verifiedOn ? ` · verified ${engine.conditions.verifiedOn}` : ""}` : ""}.</p>
              {def.needs.load && <table className={cx("comp")}>
                <thead><tr><th>Component</th><th>Heating</th><th>Cooling sens.</th><th>Latent</th></tr></thead>
                <tbody>{engine.load.components.map((c) => <tr key={c.name}><td>{c.name}</td><td>{num(c.heatingBtuh)}</td><td>{num(c.coolingSensibleBtuh)}</td><td>{num(c.coolingLatentBtuh)}</td></tr>)}</tbody>
              </table>}
              {/* Assumptions and incentives only: the engine's "code" notes repeat the checks above word for word, so they are not shown twice. */}
              <div className={cx("kpi-lbl")} style={{ margin: "14px 0 8px" }}>Assumptions · incentives</div>
              <ul className={cx("notes")}>
                {engine.notes.filter((n) => n.kind === "assumption" || n.kind === "incentive").map((n) => (
                  <li key={n.kind + n.text}><span className={cx("chip", n.kind === "assumption" ? "chip-default" : "chip-measured")}>{n.kind}</span><span>{n.text}</span></li>
                ))}
              </ul>
            </div>
          </details>
          {(def.selection !== "none" || def.id === "water-heater") && swapRows.length > 0 && (
            <details className={cx("panel")} open={swapOpen} onToggle={(e) => setSwapOpen(e.currentTarget.open)}>
              <summary><svg className={cx("ic")}><use href="#i-box" /></svg>Change the unit<span className={cx("mono")}>{swapFits.length} fit{swapOut.length ? ` · ${swapOut.length} ruled out` : ""} · or type your own</span><span className={cx("panel-go")}><span className={cx("st-edit", "go-open")}>Change</span><span className={cx("st-edit", "go-close")}>Close</span><svg className={cx("ic", "fold2-c")}><use href="#i-chev" /></svg></span></summary>
              <div className={cx("panel-body")}>
                <div className={cx("note")}>Pick another unit and the whole estimate re-prices.</div>
                <details className={cx("how")}>
                  <summary>How the ranking works</summary>
                  <div className={cx("how-b")}>The engine ranks what the catalog has and puts the best fit on the estimate. Pick another and the whole estimate re-prices. A unit the engine ruled out can still go on the job — the reason follows it onto the estimate as a check, so the customer and the permit desk see it. Nothing like it in the catalog? Type the unit at the bottom.</div>
                </details>
                <input id="hv-swap-q" className={cx("in")} placeholder="Filter by brand or model" value={swapQ} onChange={(e) => setSwapQ(e.target.value)} style={{ maxWidth: 320 }} />
                <div className={cx("swap")}>
                  {swapShown.map((r) => {
                    const on = chosenId === r.item.id;
                    return (
                      <button key={r.item.id} type="button" className={cx("swap-row", on && "on", r.out && "out")} onClick={() => { setPickId(r.item.id); setSwapMsg(on ? "" : `${r.item.brand} ${r.item.model} is on the estimate.${r.out ? " The engine ruled it out — the reason is on the checks." : ""}`); }}>
                        <span className={cx("swap-t")}>{r.item.brand} {r.item.model}{r.item.typed ? " · typed in" : ""}{!r.item.cost && someCost ? " · no cost" : ""}{r.out && <span className={cx("chip", "chip-verify")}>ruled out</span>}</span>
                        <span className={cx("mono", "swap-m")}>{[r.item.tons ? `${r.item.tons} t` : "", r.item.btuInput && r.item.kind !== "water-heater" ? `${Math.round(r.item.btuInput / 1000)}k BTU` : "", r.item.seer2 ? `${r.item.seer2} SEER2` : "", r.item.hspf2 ? `${r.item.hspf2} HSPF2` : "", r.item.afue ? `${Math.round(r.item.afue * 100)}% AFUE` : "", r.item.staging ?? "", r.item.refrigerant ?? "", r.item.coldClimate ? "cold climate" : "", r.item.tier ?? ""].filter(Boolean).join(" · ")}</span>
                        <span className={cx("swap-w")}>{r.out ?? r.why}</span>
                        <span className={cx("swap-a")}>{on && <span className={cx("swap-stamp")} aria-hidden="true"><svg className={cx("ic")}><use href="#i-check" /></svg></span>}{on ? "On the estimate" : r.out ? "Use anyway" : "Use this"}</span>
                      </button>
                    );
                  })}
                </div>
                {swapRows.length > swapShown.length && <div className={cx("note")}>Showing {swapShown.length} of {swapRows.length} — type a brand or a model to narrow it.</div>}
                {swapMsg && <div className={cx("swap-msg")}>{swapMsg}</div>}
                <details className={cx("fold2", "fold2-in")}>
                  <summary><span className={cx("fold2-t")}>Not in the catalog? Type the unit</span><span className={cx("fold2-s")}>brand · model · size · ratings · your cost</span><svg className={cx("ic", "fold2-c")}><use href="#i-chev" /></svg></summary>
                  <div className={cx("fold2-b")}>
                <div className={cx("grid", "grid-rc")}>
                  <label className={cx("field")} htmlFor="hv-u-brand"><span className={cx("lbl")}>Brand</span><input id="hv-u-brand" className={cx("in")} placeholder="Trane" value={unitDraft.brand ?? ""} onChange={(e) => setUnitDraft((u) => ({ ...u, brand: e.target.value }))} /></label>
                  <label className={cx("field")} htmlFor="hv-u-model"><span className={cx("lbl")}>Model</span><input id="hv-u-model" className={cx("in")} placeholder="4TWR7048N1000A" value={unitDraft.model ?? ""} onChange={(e) => setUnitDraft((u) => ({ ...u, model: e.target.value }))} /></label>
                  <label className={cx("field")} htmlFor="hv-u-kind"><span className={cx("lbl")}>What it is</span><span className={cx("bp-sel", "hvsel")}><select id="hv-u-kind" className={cx("bp-sel-in", "sel")} value={unitDraft.kind ?? (engine?.selection.chosen?.item.kind ?? (def.id === "water-heater" ? "water-heater" : def.kinds[0] ?? "air-conditioner"))} onChange={(e) => setUnitDraft((u) => ({ ...u, kind: e.target.value }))}><option value="air-conditioner">Condenser (AC)</option><option value="heat-pump">Heat pump</option><option value="furnace">Furnace</option><option value="air-handler">Air handler</option><option value="coil">Coil</option><option value="ductless">Ductless</option><option value="package">Package unit</option><option value="water-heater">Water heater</option></select></span></label>
                  <label className={cx("field")} htmlFor="hv-u-tons"><span className={cx("lbl")}>Tons</span><input id="hv-u-tons" className={cx("in", "num")} inputMode="decimal" placeholder="4" value={unitDraft.tons ?? ""} onChange={(e) => setUnitDraft((u) => ({ ...u, tons: e.target.value }))} /></label>
                  <label className={cx("field")} htmlFor="hv-u-kbtu"><span className={cx("lbl")}>BTU input, thousands</span><input id="hv-u-kbtu" className={cx("in", "num")} inputMode="decimal" placeholder="80" value={unitDraft.kbtu ?? ""} onChange={(e) => setUnitDraft((u) => ({ ...u, kbtu: e.target.value }))} /></label>
                  <label className={cx("field")} htmlFor="hv-u-seer2"><span className={cx("lbl")}>SEER2</span><input id="hv-u-seer2" className={cx("in", "num")} inputMode="decimal" placeholder="17.2" value={unitDraft.seer2 ?? ""} onChange={(e) => setUnitDraft((u) => ({ ...u, seer2: e.target.value }))} /></label>
                  <label className={cx("field")} htmlFor="hv-u-hspf2"><span className={cx("lbl")}>HSPF2</span><input id="hv-u-hspf2" className={cx("in", "num")} inputMode="decimal" placeholder="8.5" value={unitDraft.hspf2 ?? ""} onChange={(e) => setUnitDraft((u) => ({ ...u, hspf2: e.target.value }))} /></label>
                  <label className={cx("field")} htmlFor="hv-u-afue"><span className={cx("lbl")}>AFUE %</span><input id="hv-u-afue" className={cx("in", "num")} inputMode="decimal" placeholder="96" value={unitDraft.afue ?? ""} onChange={(e) => setUnitDraft((u) => ({ ...u, afue: e.target.value }))} /></label>
                  <label className={cx("field")} htmlFor="hv-u-h17"><span className={cx("lbl")}>Heat at 17 °F, thousands</span><input id="hv-u-h17" className={cx("in", "num")} inputMode="decimal" placeholder="34" value={unitDraft.h17 ?? ""} onChange={(e) => setUnitDraft((u) => ({ ...u, h17: e.target.value }))} /></label>
                  <label className={cx("field")} htmlFor="hv-u-h5"><span className={cx("lbl")}>Heat at 5 °F, thousands</span><input id="hv-u-h5" className={cx("in", "num")} inputMode="decimal" placeholder="27" value={unitDraft.h5 ?? ""} onChange={(e) => setUnitDraft((u) => ({ ...u, h5: e.target.value }))} /></label>
                  <label className={cx("field")} htmlFor="hv-u-refr"><span className={cx("lbl")}>Refrigerant</span><span className={cx("bp-sel", "hvsel")}><select id="hv-u-refr" className={cx("bp-sel-in", "sel")} value={unitDraft.refrigerant ?? ""} onChange={(e) => setUnitDraft((u) => ({ ...u, refrigerant: e.target.value }))}><option value="">not seen</option><option value="R-454B">R-454B</option><option value="R-32">R-32</option><option value="R-410A">R-410A</option><option value="R-22">R-22</option></select></span></label>
                  <label className={cx("field")} htmlFor="hv-u-stg"><span className={cx("lbl")}>Staging</span><span className={cx("bp-sel", "hvsel")}><select id="hv-u-stg" className={cx("bp-sel-in", "sel")} value={unitDraft.staging ?? ""} onChange={(e) => setUnitDraft((u) => ({ ...u, staging: e.target.value }))}><option value="">not seen</option><option value="single">single stage</option><option value="two-stage">two stage</option><option value="variable">variable</option></select></span></label>
                  <label className={cx("field")} htmlFor="hv-u-nox"><span className={cx("lbl")}>NOx class (gas heat)</span><span className={cx("bp-sel", "hvsel")}><select id="hv-u-nox" className={cx("bp-sel-in", "sel")} value={unitDraft.nox ?? ""} onChange={(e) => setUnitDraft((u) => ({ ...u, nox: e.target.value }))}><option value="">standard, 40 ng/J</option><option value="14">ultra-low, 14 ng/J (California districts)</option></select></span></label>
                  <label className={cx("field")} htmlFor="hv-u-cold"><span className={cx("lbl")}>Cold-climate rated</span><span className={cx("bp-sel", "hvsel")}><select id="hv-u-cold" className={cx("bp-sel-in", "sel")} value={unitDraft.coldClimate ?? ""} onChange={(e) => setUnitDraft((u) => ({ ...u, coldClimate: e.target.value }))}><option value="">no</option><option value="yes">yes</option></select></span></label>
                  <label className={cx("field")} htmlFor="hv-u-gal"><span className={cx("lbl")}>Gallons (water heater)</span><input id="hv-u-gal" className={cx("in", "num")} inputMode="decimal" placeholder="50" value={unitDraft.gallons ?? ""} onChange={(e) => setUnitDraft((u) => ({ ...u, gallons: e.target.value }))} /></label>
                  <label className={cx("field")} htmlFor="hv-u-cost"><span className={cx("lbl")}>Your cost $</span><input id="hv-u-cost" className={cx("in", "num")} inputMode="decimal" placeholder="3200" value={unitDraft.cost ?? ""} onChange={(e) => setUnitDraft((u) => ({ ...u, cost: e.target.value }))} /></label>
                </div>
                <div className={cx("acts")}>
                  <button type="button" className={cx("btn", "btn-primary")} onClick={useTypedUnit}>Use this unit</button>
                  <button type="button" className={cx("btn", "btn-ghost")} onClick={() => void saveTypedUnit()}>Save it to my catalog</button>
                  {(custom || pickId) && <button type="button" className={cx("btn", "btn-ghost")} onClick={() => { setCustom(null); setPickId(null); setSwapMsg("Back to the engine's pick."); }}>Back to the engine&rsquo;s pick</button>}
                </div>
                  </div>
                </details>
              </div>
            </details>
          )}
          <div className={cx("st-next", "st-next--pad")}>
            <button type="button" className={cx("btn", "btn-primary")} disabled={S.estimate.locked || !lines} onClick={() => go("estimate")}>Continue to the estimate<svg className={cx("ic")}><use href="#i-arrow" /></svg></button>
            <span className={cx("acts-note")}>{lines ? money(subtotal) : S.estimate.reason}</span>
          </div>
        </>
      ) : (
        <div className={cx("body")}>
          <div className={cx("call", "info")}><span className={cx("stamp")}>waiting</span><span>{S.design.locked ? S.design.reason : "The load, the unit and the price follow the moment the square footage is in."}</span></div>
        </div>
      )}
      </Step>

      {/* ── 5 · THE ESTIMATE ─────────────────────────────────────────────── */}
      <Step k="estimate" meta={S.estimate} open={cur === "estimate"}>
      {engine && ledger && lines && (
        <>
          <details className={cx("fold2", "fold2-title")}>
            <summary><span className={cx("fold2-t")}>{title ?? ledger.title}</span><span className={cx("fold2-s")}>title · scope</span><span className={cx("st-edit")}>Edit</span></summary>
            <div className={cx("fold2-b")}>
              <label className={cx("field")} htmlFor="hv-title">
                <span className={cx("lbl")}>Title</span>
                <input id="hv-title" className={cx("in")} value={title ?? ledger.title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <div className={cx("note")} style={{ marginTop: 10 }}>{ledger.scope}</div>
            </div>
          </details>
          <LinesBlock title="Equipment & materials" rows={lines.materials} editing={editLine} onEdit={setEditLine} onChange={(rows) => setLines({ ...lines, materials: rows })} phone={phone} onAddPhone={() => setNewLineFor("materials")} />
          <LinesBlock title="Labor · permit · disposal" rows={lines.labor} editing={editLine} onEdit={setEditLine} onChange={(rows) => setLines({ ...lines, labor: rows })} phone={phone} onAddPhone={() => setNewLineFor("labor")} />
          {/* THE MENU LEARNS (2026-09-23): a service line priced away from the
              menu can become the shop's price for that task, once, here. */}
          {menuDiffs.length > 0 && (
            <div className={cx("call", "info")} style={{ marginTop: 10 }} data-menu-learn>
              <span className={cx("stamp")}>menu</span>
              <span>
                {menuDiffs.length === 1 ? "One menu price changed on this estimate" : `${menuDiffs.length} menu prices changed on this estimate`} — keep it for next time?{" "}
                {menuDiffs.map((d) => (
                  <button key={d.lineId} type="button" className={cx("btn", "btn-ghost", "btn-sm")} style={{ margin: "4px 6px 0 0" }} disabled={learnBusy === d.lineId} onClick={() => void learnPrice(d)}>
                    {learnBusy === d.lineId ? "Saving…" : `Save ${money(d.price)} for ${d.name}${d.kind === "m" ? " (part)" : ""}`}
                  </button>
                ))}
                {learnMsg ? <span className={cx("acts-note")}>{learnMsg}</span> : null}
              </span>
            </div>
          )}
          {phone && (() => {
            if (newLineFor) {
              const sec = newLineFor;
              return <LineSheet key={`new-${sec}`} isNew line={{ id: "", name: "", quantity: 1, unitPrice: 0, unit: "each", basis: "entered" }} onClose={() => setNewLineFor(null)} onDone={(p) => { setLines({ ...lines, [sec]: [...lines[sec], { id: nanoid(6), basis: "entered", ...p }] }); setNewLineFor(null); }} />;
            }
            const sec = lines.materials.some((l) => l.id === editLine) ? "materials" : lines.labor.some((l) => l.id === editLine) ? "labor" : null;
            const line = sec ? lines[sec].find((l) => l.id === editLine) : undefined;
            if (!sec || !line) return null;
            return <LineSheet key={line.id} line={line} onClose={() => setEditLine(null)} onDone={(p) => { setLines({ ...lines, [sec]: lines[sec].map((r) => (r.id === line.id ? { ...r, ...p } : r)) }); setEditLine(null); }} onRemove={() => { setLines({ ...lines, [sec]: lines[sec].filter((r) => r.id !== line.id) }); setEditLine(null); }} />;
          })()}
          <div className={cx("body")} style={{ paddingTop: 0 }}>
            <InventoryLinkChoice trade="hvac" value={invLink} onChange={setInvLink} />
          </div>
          <div className={cx("bo-total", "bo-total--acts")}>
            <span><span className={cx("kpi-lbl")}>Subtotal</span><span className={cx("bo-total-v")} style={{ marginLeft: 12 }}>{money2(subtotal)}</span></span>
            <span className={cx("head-acts")}>
              <button type="button" className={cx("btn", "btn-ghost", "btn-sm")} disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : savedId ? "Saved · save again" : "Save"}</button>
              <button type="button" className={cx("btn", "btn-primary", "btn-sm")} disabled={converting || !(lines.materials.length || lines.labor.length)} onClick={() => void convert()}>{converting ? "Converting…" : "Convert to proposal"}</button>
            </span>
          </div>
          <details className={cx("how", "how-wide")}>
            <summary>How this is priced</summary>
            <div className={cx("how-b")}>
              <p>From the shop&rsquo;s rate card: {catalog?.own ? "your catalog rows" : "rate-card defaults"} plus stock, labor by the task against its measure (per unit, per ln ft, per register), permit and disposal. A row with no shop cost is priced from the rate card&rsquo;s per-ton or per-BTU default at the tier&rsquo;s markup. The assumptions stay on the estimate and never print on the proposal.</p>
              <div className={cx("kpi-lbl")} style={{ margin: "12px 0 6px" }}>Assumptions on this estimate</div>
              <ul className={cx("assump-l")}>{ledger.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
            </div>
          </details>

          <div id="hv-permit" className={cx("permit")} style={def.needs.load ? undefined : { display: "none" }}>
            <div className={cx("permit-txt")}>
              <span className={cx("kpi-lbl")}>Permit-grade report</span>
              <div className={cx("note")} style={{ marginTop: 6 }}>
                {reportUrl
                  ? <>ACCA-approved Manual J attached — <a className={cx("link")} href={reportUrl} target="_blank" rel="noreferrer">view the report</a>. The proposal carries one sentence saying so.</>
                  : permit
                    ? <>Cool Calc project <b>{permit.projectId}</b> created {dateShort(permit.requestedAt)}. Finish the envelope in Cool Calc, then pull the report here.</>
                    : <>The load above is Manual J-based, estimating grade. For a permit that wants an ACCA-approved calc, {permitEnabled ? "request the Cool Calc report" : "paste the report link from the approved tool you use"}.</>}
              </div>
              {permitMsg && <div className={cx("mono")} style={{ marginTop: 6, textTransform: "none", letterSpacing: 0 }}>{permitMsg}</div>}
            </div>
            <div className={cx("permit-acts")}>
              {!reportUrl && permitEnabled && !permit && <button type="button" className={cx("btn", "btn-primary", "btn-sm")} disabled={permitBusy} onClick={() => void requestPermit()}>{permitBusy ? "Requesting…" : "Request Cool Calc report"}</button>}
              {!reportUrl && permit && <button type="button" className={cx("btn", "btn-primary", "btn-sm")} disabled={permitBusy} onClick={() => void attachPermit()}>{permitBusy ? "Attaching…" : "Pull the report"}</button>}
              {!reportUrl && (
                <span className={cx("permit-link")}>
                  <input className={cx("in")} placeholder="https://… report link" value={linkDraft} onChange={(e) => setLinkDraft(e.target.value)} aria-label="Report link" />
                  <button type="button" className={cx("btn", "btn-ghost", "btn-sm")} disabled={permitBusy || !/^https:\/\//i.test(linkDraft)} onClick={() => void attachPermit(linkDraft)}>Attach link</button>
                </span>
              )}
            </div>
          </div>

          <details className={cx("panel")} onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !cardDraft) setCardDraft(card.card); }}>
            <summary><svg className={cx("ic")}><use href="#i-gear" /></svg>Rate card<span className={cx("mono")}>{card.own ? "the shop's" : "defaults — edit once, it sticks"}</span><span className={cx("panel-go")}><span className={cx("st-edit", "go-open")}>Edit rates</span><span className={cx("st-edit", "go-close")}>Close</span><svg className={cx("ic", "fold2-c")}><use href="#i-chev" /></svg></span></summary>
            <div className={cx("panel-body")}>
              {cardDraft && (
                <>
                  <div className={cx("grid-rc")}>
                    {([
                      ["equipmentMarkupPct", "Equipment markup %"], ["materialsMarkupPct", "Materials markup %"], ["permitFee", "Permit $"], ["disposalFee", "Disposal $"], ["craneFee", "Crane $"], ["linesetFtDefault", "Line set ft default"],
                    ] as Array<[keyof HvacRateCard, string]>).map(([k, l]) => (
                      <label key={k} className={cx("field")} htmlFor={`rc-${k}`}><span className={cx("lbl")}>{l}</span><input id={`rc-${k}`} className={cx("in", "num")} inputMode="decimal" value={String(cardDraft[k] as number)} onChange={(e) => setCardDraft({ ...cardDraft, [k]: Number(e.target.value) || 0 })} /></label>
                    ))}
                  </div>
                  <div className={cx("fs-t")} style={{ marginTop: 14 }}><span className={cx("kpi-lbl")}>Equipment defaults</span><span className={cx("mono")}>used when a catalog row has no cost</span></div>
                  <div className={cx("grid-rc")}>
                    {(Object.keys(cardDraft.equipmentDefaults) as Array<keyof HvacRateCard["equipmentDefaults"]>).map((k) => (
                      <label key={k} className={cx("field")} htmlFor={`rc-eq-${k}`}><span className={cx("lbl")}>{k.replace(/([A-Z])/g, " $1").replace(/Per/, "/").toLowerCase()}</span><input id={`rc-eq-${k}`} className={cx("in", "num")} inputMode="decimal" value={String(cardDraft.equipmentDefaults[k])} onChange={(e) => setCardDraft({ ...cardDraft, equipmentDefaults: { ...cardDraft.equipmentDefaults, [k]: Number(e.target.value) || 0 } })} /></label>
                    ))}
                  </div>
                  <div className={cx("fs-t")} style={{ marginTop: 14 }}><span className={cx("kpi-lbl")}>Labor by the task</span><span className={cx("mono")}>$ per each · per ln ft · per register · per lb</span></div>
                  <div className={cx("grid-rc")}>
                    {(Object.keys(cardDraft.labor) as Array<keyof HvacRateCard["labor"]>).map((k) => (
                      <label key={k} className={cx("field")} htmlFor={`rc-l-${k}`}><span className={cx("lbl")}>{k.replace(/([A-Z])/g, " $1").replace(/Per Ft/, "/ ft").replace(/Per Register/, "/ register").replace(/Per Lb/, "/ lb").replace(/Each$/, "").toLowerCase()}</span><input id={`rc-l-${k}`} className={cx("in", "num")} inputMode="decimal" value={String(cardDraft.labor[k])} onChange={(e) => setCardDraft({ ...cardDraft, labor: { ...cardDraft.labor, [k]: Number(e.target.value) || 0 } })} /></label>
                    ))}
                  </div>
                  <div className={cx("fs-t")} style={{ marginTop: 14 }}><span className={cx("kpi-lbl")}>Stock prices</span><span className={cx("mono")}>shop cost, before markup</span></div>
                  <div className={cx("grid-rc")}>
                    {(Object.keys(cardDraft.materials) as Array<keyof HvacRateCard["materials"]>).map((k) => (
                      <label key={k} className={cx("field")} htmlFor={`rc-m-${k}`}><span className={cx("lbl")}>{k.replace(/([A-Z])/g, " $1").replace(/Per/, "/").toLowerCase()}</span><input id={`rc-m-${k}`} className={cx("in", "num")} inputMode="decimal" value={String(cardDraft.materials[k])} onChange={(e) => setCardDraft({ ...cardDraft, materials: { ...cardDraft.materials, [k]: Number(e.target.value) || 0 } })} /></label>
                    ))}
                  </div>
                  <div className={cx("acts")}>
                    <button type="button" className={cx("btn", "btn-primary")} onClick={() => void saveCard()}>Save rate card</button>
                    <button type="button" className={cx("btn", "btn-ghost")} onClick={() => setCardDraft(DEFAULT_RATE_CARD)}>Reset to defaults</button>
                    <span className={cx("acts-note")}>{cardMsg || "Saved for everyone in the shop"}</span>
                  </div>
                </>
              )}
            </div>
          </details>

          <details className={cx("panel")}>
            <summary><svg className={cx("ic")}><use href="#i-file" /></svg>Catalog<span className={cx("mono")}>{catalog?.own ? `${catalog.items.filter((c) => !c.offList).length} of ${catalog.items.length} rows on the pick list${catalog.state ? ` · checked for ${catalog.state}` : ""}${usStale ? " · update available" : ""}` : catalog?.source === "us" ? `built-in US list · ${catalog.items.length} models · import your CSV for your costs` : "starter ladder · import your CSV"}</span><span className={cx("panel-go")}><span className={cx("st-edit", "go-open")}>Manage</span><span className={cx("st-edit", "go-close")}>Close</span><svg className={cx("ic", "fold2-c")}><use href="#i-chev" /></svg></span></summary>
            <div className={cx("panel-body")}>
              {usStale && <div className={cx("call", "warn")} style={{ marginBottom: 10 }}><span className={cx("stamp")}>update</span><span>Your catalog came from an older build of the US list: it is missing {usStale.missing} row{usStale.missing === 1 ? "" : "s"}{usStale.uln ? `, ${usStale.uln} of them ultra-low-NOx gas heat for California` : ""}{usStale.noNox ? ", and its gas rows carry no NOx class, so California districts rule them all out" : ""}. Press <b>Load the US catalog</b> to bring it up to date — your own rows and costs on other ids stay.</span></div>}
              <div className={cx("note")}>Load the US list or import your own CSV — the engine picks from what is here, and your costs price the estimate.</div>
              <details className={cx("how")}>
                <summary>How the catalog works</summary>
                <div className={cx("how-b")}><b>Load the US catalog</b> puts the most-sold American families on the pick list — Goodman, Carrier, Trane, Lennox, Rheem, Mitsubishi and the water-heater makers — as Good · Better · Best ladders with their published ratings. Download the CSV, put your costs in the <b>cost</b> column, delete what you don’t sell, and import it back with “Replace”. A hyphenated size (GLXT7C-036) is the family plus the nominal size — swap in your distributor’s exact model there. Or bring your own: one row per unit the shop installs. Columns: <b>{CATALOG_CSV_COLUMNS.join(", ")}</b> — kind, brand and model are required; a <b>cost</b> lets the ledger price from your number instead of the rate-card default; heat-pump rows want heat47/17/5 for the capacity curve. <a className={cx("link")} href={templateHref} download="jobflex-hvac-catalog-template.csv">Download the template</a>. An <b>AHRI</b> subscriber export or the <b>NEEP</b> cold-climate list (saved as CSV) imports as is — the columns are read by meaning and the import says which it used.</div>
              </details>
              <div className={cx("acts")}>
                <a className={cx("btn", "btn-primary")} href="/dashboard/hvac-estimator/catalog"><svg className={cx("ic")}><use href="#i-box" /></svg>Manage catalog</a>
                {catalog?.own
                  ? (usStale ? <button type="button" className={cx("btn", "btn-ghost")} onClick={() => void onAddUsRows()}>Add {usStale.missing} new US rows</button> : null)
                  : <button type="button" className={cx("btn", "btn-ghost")} onClick={() => void onLoadUs()}>Load the US catalog</button>}
                <label className={cx("btn", "btn-ghost")} htmlFor="hv-csv"><svg className={cx("ic")}><use href="#i-download" /></svg>Import CSV<input id="hv-csv" type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => void onCsv(e.target.files?.[0])} /></label>
                <label className={cx("chk")} htmlFor="hv-replace" style={{ height: 38 }}><input id="hv-replace" type="checkbox" checked={replaceCat} onChange={(e) => setReplaceCat(e.target.checked)} /><span>Replace the current catalog</span></label>
                <button type="button" className={cx("btn", "btn-ghost")} onClick={onDownloadCatalog} disabled={!catalog}>Download CSV</button>
                {catalog?.own && <button type="button" className={cx("btn", "btn-ghost")} onClick={() => void onClearCatalog()}>Clear</button>}
                <span className={cx("acts-note")}>{catMsg}</span>
              </div>
              {catalog && catalog.items.length > 0 && (() => {
                const on = catalog.items.filter((c) => !c.offList).length;
                const ruledOut = catalog.state ? offForState(catalog.items, catalog.state).length : 0;
                return (
                  <div className={cx("note")} data-catalog-state>
                    <b>{on} of {catalog.items.length}</b> on the pick list{on < catalog.items.length ? ` · ${catalog.items.length - on} turned off` : ""}.{" "}
                    {catalog.state
                      ? <>Code check for <b>{stateName(catalog.state)}</b>: {ruledOut ? <>{ruledOut} row{ruledOut === 1 ? "" : "s"} the state rules out {ruledOut === 1 ? "is" : "are"} still on — <a className={cx("link")} href="/dashboard/hvac-estimator/catalog">set the list up</a>.</> : "nothing on the list is ruled out there."}</>
                      : <>No state picked yet — <a className={cx("link")} href="/dashboard/hvac-estimator/catalog">open the catalog</a> to pick it and check every row against its code.</>}
                  </div>
                );
              })()}
              {catalog?.own && catalog.items.length > 0 && (
                <div className={cx("note", "mono")}>
                  {(["air-conditioner", "heat-pump", "furnace", "air-handler", "coil", "ductless", "package", "water-heater"] as const)
                    .map((k) => ({ k, n: catalog.items.filter((c) => c.kind === k).length }))
                    .filter((x) => x.n)
                    .map((x) => `${x.n} ${({ "air-conditioner": "AC", "heat-pump": "heat pump", furnace: "furnace", "air-handler": "air handler", coil: "coil", ductless: "ductless", package: "package", "water-heater": "water heater" } as const)[x.k]}`)
                    .join(" · ")}
                  {" — "}
                  {Array.from(new Set(catalog.items.map((c) => c.brand))).sort().join(", ")}
                  {catalog.items.some((c) => c.cost) ? "" : " · no shop costs yet: priced by tier"}
                </div>
              )}
            </div>
          </details>
        </>
      )}
      </Step>
      </div>
      {summary}
      </div>

      {/* ── LEADS WAITING (2026-09-22) ─────────────────────────────────────
          The work this page is for: the shop's leads that still want an HVAC
          estimate (lib/leadQueue). Estimate is the lead page's own hand-off —
          the address and the client arrive with the reload. Nothing when
          there are none. */}
      {leads.length > 0 && (
        <section className={cx("card", "lead-card")} data-hvac-leads>
          <div className={cx("head")}>
            <div className={cx("head-txt")}>
              <div className={cx("card-title")}>Leads waiting for an HVAC estimate</div>
              <div className={cx("card-sub")}>From the Leads page. One click opens this estimator with the address and the client filled in.</div>
            </div>
          </div>
          <div className={cx("lead-rows")}>
            {leads.map((l) => (
              <div key={l.id} className={cx("lead-row")}>
                <Link href={`/dashboard/leads/${l.id}` as Route} className={cx("lead-main")}>
                  <span className={cx("lead-name")}>{l.name}</span>
                  <span className={cx("mono", "lead-meta")}>{[l.place, l.projectType, l.ago].filter(Boolean).join(" · ")}</span>
                </Link>
                <form action={startEstimateFromLead.bind(null, l.id, "hvac")}>
                  <button type="submit" className={cx("btn", "btn-primary", "btn-sm")} data-lead-estimate={l.id}>Estimate</button>
                </form>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── RECENT, folded (owner, 2026-09-22) ─────────────────────────────
          One line — the count and the fit — until it is asked for; the list
          and "record actual" are behind it. Nothing when nothing is saved. */}
      {recent.length > 0 && (
      <section className={cx("card", "recent-card")} data-hvac-recent>
        <button type="button" className={cx("rec-fold")} aria-expanded={recentOpen} onClick={() => setRecentOpen((v) => !v)}>
          <span className={cx("rec-fold-t")}>Recent estimates · {recent.length}</span>
          <span className={cx("mono", "rec-fold-s")}>{calib && calib.n ? calibrationLine(calib) : "reopen one, or record what you quoted"}</span>
          <span className={cx("rec-fold-chev")} aria-hidden="true">{recentOpen ? "▴" : "▾"}</span>
        </button>
        {recentOpen && calib && !calib.n ? <div className={cx("rec-fit", "rec-fit--open")}>{calibrationLine(calib)}</div> : null}
        {recentOpen ? (
          <div className={cx("recent")}>
            {(phone && !recentAll ? recent.slice(0, 3) : recent).map((r) => (
              <div key={r.id} className={cx("rrow-wrap")}>
                <div className={cx("rrow")}>
                  <button type="button" className={cx("rrow-open")} onClick={() => (phone ? setRowSheet(r.id) : void reopen(r.id))} aria-label={`Open ${r.title || r.address}`}>
                    <span className={cx("rrow-a")}>{phone ? shortTitle(r) : r.title || r.address}</span>
                    <span className={cx("mono", "rrow-m")}>{phone ? shortMeta(r) : <>{r.address} · {dateShort(r.createdAt)} · {r.status}{r.jobKind ? ` · ${jobDef(r.jobKind).title.toLowerCase()}` : ""}{r.sizedTons ? ` · sized ${r.sizedTons} t` : ""}{r.permit === "attached" ? " · report attached" : r.permit === "requested" ? " · Cool Calc requested" : ""}</>}</span>
                    {r.actual && <span className={cx("mono", "rrow-m")}>actual: {r.actual.tons ? `${r.actual.tons} t` : "—"} · {r.actual.price ? money(r.actual.price) : "—"}{r.actual.notes ? ` · ${r.actual.notes}` : ""}</span>}
                    <span className={cx("rrow-v")}>{money(r.subtotal)}</span>
                  </button>
                  <button type="button" className={cx("link", "rrow-act")} onClick={() => { setActualFor(actualFor === r.id ? null : r.id); setActualDraft({ tons: r.actual?.tons ? String(r.actual.tons) : "", price: r.actual?.price ? String(r.actual.price) : "", notes: r.actual?.notes ?? "" }); }}>{r.actual ? "Edit actual" : "Record actual"}</button>
                </div>
                {actualFor === r.id && (
                  <div className={cx("actual")}>
                    <label className={cx("field")} htmlFor={`act-t-${r.id}`}><span className={cx("lbl")}>Quoted / installed tons (total across all systems)</span><input id={`act-t-${r.id}`} className={cx("in", "num")} inputMode="decimal" value={actualDraft.tons} onChange={(e) => setActualDraft({ ...actualDraft, tons: e.target.value })} /></label>
                    <label className={cx("field")} htmlFor={`act-p-${r.id}`}><span className={cx("lbl")}>Quoted price $</span><input id={`act-p-${r.id}`} className={cx("in", "num")} inputMode="decimal" value={actualDraft.price} onChange={(e) => setActualDraft({ ...actualDraft, price: e.target.value })} /></label>
                    <label className={cx("field")} htmlFor={`act-n-${r.id}`}><span className={cx("lbl")}>Notes</span><input id={`act-n-${r.id}`} className={cx("in")} value={actualDraft.notes} placeholder="what changed and why" onChange={(e) => setActualDraft({ ...actualDraft, notes: e.target.value })} /></label>
                    <button type="button" className={cx("btn", "btn-primary", "btn-sm")} onClick={() => void saveActual(r.id)}>Save actual</button>
                  </div>
                )}
              </div>
            ))}
            {phone && !recentAll && recent.length > 3 && <button type="button" className={cx("rrow-more")} onClick={() => setRecentAll(true)}>Show all {recent.length}</button>}
          </div>
        ) : null}
      </section>
      )}
      {phone && rowSheet && (() => {
        const r = recent.find((x) => x.id === rowSheet);
        if (!r) return null;
        return (
          <BlueprintSheet open onClose={() => setRowSheet(null)} title={shortTitle(r)} description={`${shortMeta(r)} · ${money(r.subtotal)}`}>
            <div className={cx("rs-acts")}>
              <button type="button" className="bps-btn bps-btn--primary" onClick={() => { setRowSheet(null); void reopen(r.id); }}>Reopen</button>
              <button type="button" className="bps-btn bps-btn--ghost" onClick={() => { setRowSheet(null); setRecentOpen(true); setActualFor(r.id); setActualDraft({ tons: r.actual?.tons ? String(r.actual.tons) : "", price: r.actual?.price ? String(r.actual.price) : "", notes: r.actual?.notes ?? "" }); }}>{r.actual ? "Edit actual" : "Record actual"}</button>
            </div>
          </BlueprintSheet>
        );
      })()}
    </>
  );
}
