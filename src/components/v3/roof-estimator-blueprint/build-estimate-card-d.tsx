"use client";

// VARIANT D of the "Build an estimate" card — the 2026-09-26 high-contrast
// round, reached at /dashboard/roof-estimator?builder=d (and on the sample
// house at /dashboard/roof-estimator/card-preview?builder=d).
//
// THE HVAC MIRROR. The owner's brief: minimal, high contrast, every field name
// big and in full ink, well structured, nothing busy for the eye — the way the
// HVAC estimator reads. So the card borrows that page's composition:
//
//   HEAD      the title, and the two ways to build as one framed switch.
//   SECTIONS  one titled section per part of the roof. Closed, a section is
//             its name in bold caps over a plain sentence of what is picked;
//             open, it shows its fields under bold ink labels, with the
//             contractor's own prices gathered at its foot under YOUR RATES,
//             on the paper tone. The roof type is a set of framed tiles — the
//             HVAC job picker's selection language (blue frame, check stamp).
//   ESTIMATE  the HVAC summary rail: the total, materials and labor, Review
//             lines and Convert to proposal. Beside the sections on a wide
//             card; on a narrow one the same block rides the bottom edge of
//             the screen while the card is in view, so the total stays in
//             sight while a rate is typed.
//
// Everything variant C does survives: the same helpers, the same state block
// (roof-package-builder.tsx's, by way of C — spliced in verbatim), the same
// localStorage keys, the same saveRoofCatalog write, every row. Only markup,
// copy and CSS are new.

import * as React from "react";
import { nanoid } from "nanoid";
import { toast } from "@/components/ui/Toast";
import { getRoofCatalog, saveRoofCatalog } from "@/actions/roofCatalog";
import {
  BUILTIN_LISTS,
  CHIMNEY_SIZES,
  DRIP_EDGE_PROFILES,
  DRIP_EDGE_SIZES,
  familyLabel,
  ICE_WATER,
  likeForLikeSystem,
  PIPE_BOOT_SIZES,
  PKG_UNITS,
  ROOF_FAMILIES,
  STEP_FLASHING_SIZES,
  VALLEY_TYPES,
  VENT_TYPES,
  WASTE_OPTIONS,
  type CatalogLists,
  type IceWaterCoverage,
  type PkgUnit,
  type RoofFamily,
  type RoofSystem,
  type Underlayment,
  displayPitch12,
  FASCIA_OPTIONS,
  GUTTER_PLANS,
  type FasciaRun,
  type GutterPlan,
} from "@/lib/roofPackage/catalog";
import {
  buildRoofPackage,
  checkVentilation,
  defaultSpec,
  estimateEdges,
  fasciaFeet,
  gutterFeet,
  likeForLikeFamily,
  plywoodCount,
  plywoodLines,
  plywoodRate,
  plywoodScope,
  PLYWOOD_SHEET_SQFT,
  withJobClass,
  withMeasured,
  withSystem,
  type RoofFacts,
  type RoofPackage,
  type RoofPackageSpec,
} from "@/lib/roofPackage/takeoff";
import { isFlatRoof } from "@/lib/roofPackage/flatRule";
import {
  COVER_BOARDS,
  DRAIN_WORK,
  EXISTING_LOW_SLOPE,
  FLAT_RATE_DEFS,
  INSULATION_OPTIONS,
  SECONDARY_DRAINAGE,
  WARRANTIES,
  isSurfaceApplied,
  lowSlopeRule,
  rate as flatRate,
  takesBoards,
  type DrainWork,
  type ExistingLowSlope,
  type FlatRateKey,
  type FlatSpec,
  type SecondaryDrainage,
} from "@/lib/roofPackage/lowSlope";
import {
  COMMERCIAL_RATE_DEFS,
  SHIFTS,
  WAGE_REGIMES,
  cRate,
  productivityFactor,
  type CommercialRateKey,
  type CommercialSpec,
  type Shift,
  type WageRegime,
} from "@/lib/roofPackage/commercial";
import {
  LISTS_KEY,
  PREFS_KEY,
  applyPrefs,
  factsKey,
  fmt,
  money,
  prefsOf,
  readLocal,
  reconcile,
  saneLists,
  writeLocal,
  type Prefs,
  applyPickedPrices,
  familyFit,
  pickSystemOn,
} from "./roof-package-builder";
import type { BuildEstimateCardProps, ReportProp } from "./build-estimate-card";
import { BlueprintSelect, type SelectStyles } from "@/components/v3/advanced-ai-blueprint/blueprint-select";
import "./build-estimate-card-d.css";

// ── Icons: the shell sprite for file / board / bulb; the small ones inline ──
const IcChev = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 9l6 6 6-6" />
  </svg>
);
const IcPlus = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const IcX = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);
const IcCheck = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
);

/** The house dropdown (advanced-ai-blueprint/blueprint-select) drawn by this
 *  card's stylesheet. Its option list is portalled into `.content`, so the
 *  list's rules live outside `.rbd` in build-estimate-card-d.css. */
const SEL_STYLES: SelectStyles = {
  bsel: "rbd-sel",
  "bsel-btn": "rbd-sel-btn",
  "bsel-val": "rbd-sel-val",
  "bsel-caret": "rbd-sel-caret",
  "bsel-list": "rbd-sel-list",
  "bsel-opt": "rbd-sel-opt",
};

/** Arrow keys walk a radiogroup (the mode switch, the roof-type tiles): focus
 *  moves and the pick follows, as a native radio set does. */
function radioKeys(e: React.KeyboardEvent<HTMLElement>) {
  const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
  const fwd = e.key === "ArrowRight" || e.key === "ArrowDown";
  if (!back && !fwd && e.key !== "Home" && e.key !== "End") return;
  const radios = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'));
  const i = radios.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0 || radios.length < 2) return;
  e.preventDefault();
  const n = radios.length;
  const next = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : fwd ? (i + 1) % n : (i - 1 + n) % n;
  radios[next].focus();
  radios[next].click();
}

// ── Field primitives ──

/** No rate, count or length on a roof is over a billion: a slipped key
 *  (1252222…) used to turn the total into a 39-digit number. */
const MAX_ENTRY = 1e9;
function Num({
  label,
  value,
  onChange,
  unit,
  disabled,
  min = 0,
  aria,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  unit?: string;
  disabled?: boolean;
  min?: number;
  /** Accessible name when the visible label is not enough (a rate, a table cell). */
  aria?: string;
}) {
  const [txt, setTxt] = React.useState(String(value));
  // The prop moved away from what is typed (a pick reset the price, another
  // roof opened): adopt it. Done during render, not in an effect.
  const [seen, setSeen] = React.useState(value);
  if (value !== seen) {
    setSeen(value);
    if (Number(txt) !== value) setTxt(String(value));
  }
  return (
    <label className={"rbd-f" + (label ? "" : " rbd-f--bare")}>
      {label && <span className="rbd-lbl">{label}</span>}
      <span className={"rbd-box" + (unit ? " has-unit" : "")}>
        <input
          className="rbd-in"
          inputMode="decimal"
          value={txt}
          disabled={disabled}
          aria-label={aria || undefined}
          onChange={(e) => {
            const v = e.target.value;
            setTxt(v);
            const n = Number(v.replace(/,/g, ""));
            if (v.trim() !== "" && Number.isFinite(n) && n >= min && n <= MAX_ENTRY) onChange(n);
          }}
          onBlur={() => {
            setTxt(String(value));
          }}
        />
        {unit && <span className="rbd-unit">{unit}</span>}
      </span>
    </label>
  );
}

function Sel<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  wide,
  short,
  aria,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ id: T; label: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
  /** Two field widths: a roof type or a board name reads whole. */
  wide?: boolean;
  /** Only short values (12%, 2 in face): keeps a half-width cell on a phone,
   *  where every other dropdown takes the full line so its value reads whole. */
  short?: boolean;
  aria?: string;
}) {
  return (
    <div className={"rbd-f rbd-f--sel" + (label ? "" : " rbd-f--bare") + (wide ? " rbd-f--wide" : "") + (short ? " rbd-f--short" : "")}>
      {label && <span className="rbd-lbl">{label}</span>}
      <BlueprintSelect
        value={value}
        onChange={(v) => onChange(v as T)}
        options={options.map((o) => ({ value: o.id, label: o.label }))}
        placeholder=""
        ariaLabel={label || aria || ""}
        disabled={disabled}
        styles={SEL_STYLES}
      />
    </div>
  );
}

/** A small pick shown whole, as framed tiles — the HVAC job picker's
 *  selection language: ink frame at rest, blue frame and check stamp picked. */
function Tiles<T extends string>({
  label,
  value,
  options,
  onPick,
  disabled,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ id: T; label: string }>;
  onPick: (v: T) => void;
  disabled?: boolean;
}) {
  const labelId = React.useId();
  const anyOn = options.some((o) => o.id === value);
  return (
    <div className="rbd-f rbd-f--full">
      <span className="rbd-lbl" id={labelId}>
        {label}
      </span>
      <div className="rbd-tiles" role="radiogroup" aria-labelledby={labelId} onKeyDown={radioKeys}>
        {options.map((o, i) => {
          const on = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on || (!anyOn && i === 0) ? 0 : -1}
              className={"rbd-tile" + (on ? " is-on" : "")}
              disabled={disabled}
              onClick={() => onPick(o.id)}
            >
              <span className="rbd-tile-t">{o.label}</span>
              <span className="rbd-tile-mark" aria-hidden="true">
                <IcCheck />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Where the fascia runs. Gutters hang on the eaves, so that is the default. */
const FASCIA_RUNS = [
  { id: "eaves" as const, label: "Eaves" },
  { id: "eaves_rakes" as const, label: "Eaves + rakes" },
  { id: "custom" as const, label: "A length I enter" },
];

/** A drawn checkbox: a square ink box that fills blue with the tick; the
 *  native input stays for the keyboard and screen readers. */
function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={"rbd-check" + (checked ? " is-on" : "") + (disabled ? " is-off" : "")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="rbd-check-box" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M5 12.5l4.5 4.5L19 7" />
        </svg>
      </span>
      <span className="rbd-check-t">{label}</span>
    </label>
  );
}

/* ── PLYWOOD REPLACEMENT (owner, 2026-10-13: "what means deck sheet? … if it's the plywood replacement say it
   clearly … per square foot and per sheet … if they don't know how many, a note to the client: during the job any
   plywood replacement will be charged this … real fast, click click click"). Three picks; the installed price both
   ways, linked; a count in a tap, by the sheet or the square foot; and the very words the client will read. ── */
const PLY_CHIPS = { sheet: [1, 2, 3, 4, 6, 8, 10], sqft: [32, 64, 96, 128, 160, 256] } as const;
const PLY_MODES = [
  { id: "quote" as const, label: "Not known yet — quote the rate" },
  { id: "count" as const, label: "I know how much" },
  { id: "none" as const, label: "Leave it out" },
];
const money2 = (n: number) => (Math.abs(n - Math.round(n)) < 0.005 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toFixed(2)}`);

function PlywoodBlock({
  spec,
  set,
  disabled,
  deckExposed,
}: {
  spec: RoofPackageSpec;
  set: <K extends keyof RoofPackageSpec>(k: K, v: RoofPackageSpec[K]) => void;
  disabled?: boolean;
  /** A tear-off opens the deck; an overlay keeps it covered, so no rate is quoted. */
  deckExposed: boolean;
}) {
  const count = plywoodCount(spec);
  const [picked, setPicked] = React.useState<"count" | null>(null);
  const mode = count || picked === "count" ? "count" : spec.plywoodQuote ? "quote" : "none";
  const rate = plywoodRate(spec);
  const bySqft = spec.plywoodUnit === "sqft";
  const qty = bySqft ? spec.plywoodSqft : spec.plywoodSheets;
  // One installed price, typed either way: the plywood and the fitting keep their split.
  const setRate = (sheet: number) => {
    const sum = spec.plywoodEach + spec.plywoodLabor;
    const share = sum > 0 ? spec.plywoodEach / sum : 0.55;
    const each = Math.round(sheet * share * 100) / 100;
    set("plywoodEach", each);
    set("plywoodLabor", Math.round((sheet - each) * 100) / 100);
  };
  const setCount = (n: number) => (bySqft ? set("plywoodSqft", n) : set("plywoodSheets", n));
  const pick = (m: (typeof PLY_MODES)[number]["id"]) => {
    if (m === "count") {
      setPicked("count");
      return;
    }
    setPicked(null);
    set("plywoodSheets", 0);
    set("plywoodSqft", 0);
    set("plywoodQuote", m === "quote");
  };
  const toUnit = (u: "sheet" | "sqft") => {
    if (u === spec.plywoodUnit) return;
    if (u === "sqft") set("plywoodSqft", spec.plywoodSheets * PLYWOOD_SHEET_SQFT);
    else set("plywoodSheets", Math.ceil(spec.plywoodSqft / PLYWOOD_SHEET_SQFT));
    set("plywoodUnit", u);
  };
  const says = plywoodScope(spec, deckExposed);
  // What the estimate's own lines come to — by the sq ft the cents are rounded per line, so this is the figure.
  const lines = plywoodLines(spec);
  const inEstimate = lines ? lines.material.quantity * lines.material.unitPrice + lines.labor.quantity * lines.labor.unitPrice : 0;
  return (
    <div className="rbd-f rbd-f--full rbd-ply" data-plywood={mode}>
      <div className="rbd-ply-h">
        <span className="rbd-ply-t">Plywood replacement</span>
        <span className="rbd-ply-sub">The damaged roof deck under the old roof · ½ in plywood · a 4 × 8 sheet is 32 sq ft</span>
      </div>
      <Tiles label="How much plywood?" value={mode} options={PLY_MODES} onPick={pick} disabled={disabled} />
      {mode !== "none" ? (
        <div className="rbd-ply-rate">
          <Num label="Installed, per sheet" unit="$/sheet" value={rate.sheet} onChange={setRate} disabled={disabled} />
          <Num label="Installed, per sq ft" unit="$/sq ft" value={rate.sqft} onChange={(v) => setRate(v * PLYWOOD_SHEET_SQFT)} disabled={disabled} />
          <p className="rbd-ply-split">
            {money2(spec.plywoodEach)} plywood + {money2(spec.plywoodLabor)} to fit, per sheet — split under Your rates.
          </p>
        </div>
      ) : null}
      {mode === "count" ? (
        <div className="rbd-ply-count" data-plywood-count>
          <div className="rbd-ply-row">
            <div className="rbd-seg" role="radiogroup" aria-label="Count plywood in">
              {(["sheet", "sqft"] as const).map((u) => (
                <button key={u} type="button" role="radio" aria-checked={spec.plywoodUnit === u} className={"rbd-seg-b" + (spec.plywoodUnit === u ? " is-on" : "")} disabled={disabled} onClick={() => toUnit(u)}>
                  {u === "sheet" ? "Sheets" : "Sq ft"}
                </button>
              ))}
            </div>
            <div className="rbd-chips" role="group" aria-label={bySqft ? "Square feet of plywood" : "Sheets of plywood"}>
              {PLY_CHIPS[bySqft ? "sqft" : "sheet"].map((n) => (
                <button key={n} type="button" className={"rbd-chip" + (qty === n ? " is-on" : "")} aria-pressed={qty === n} disabled={disabled} onClick={() => setCount(n)}>
                  {n}
                </button>
              ))}
            </div>
            <Num label="" aria={bySqft ? "Square feet of plywood" : "Sheets of plywood"} unit={bySqft ? "sq ft" : "sheets"} value={qty} onChange={setCount} disabled={disabled} />
          </div>
          <p className="rbd-ply-sum" data-plywood-sum>
            {count
              ? `${count.unit === "each" ? `${count.sheets} sheet${count.sheets === 1 ? "" : "s"} · ${fmt(count.sqft)} sq ft` : `${fmt(count.sqft)} sq ft · about ${count.sheets} sheets`} · ${money2(inEstimate)} in the estimate`
              : "Tap how much — or type it."}
          </p>
          {deckExposed ? <Check label="Also quote the rate for any more found at tear-off" checked={spec.plywoodQuote} onChange={(v) => set("plywoodQuote", v)} disabled={disabled} /> : null}
        </div>
      ) : null}
      {says.length ? (
        <div className="rbd-ply-says" data-plywood-says>
          <span>The client&apos;s proposal says</span>
          {says.map((s) => (
            <p key={s}>{s}</p>
          ))}
        </div>
      ) : mode === "quote" && !deckExposed ? (
        <p className="rbd-note">No tear-off — the deck stays covered, so there is no plywood rate to quote.</p>
      ) : null}
    </div>
  );
}

/** One of the contractor's own prices: a field like any other, gathered with
 *  its siblings under YOUR RATES at the foot of the open section. */
function Rate({ label, unit, value, onChange, disabled }: { label: string; unit: string; value: number; onChange: (n: number) => void; disabled?: boolean }) {
  return <Num label={label} aria={`${label} rate, ${unit}`} unit={unit} value={value} onChange={onChange} disabled={disabled} />;
}

/** A named cluster of this roof's entries: a bold heading over its fields. */
function Group({ label, children, note }: { label?: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="rbd-g">
      {label && <h4 className="rbd-g-h">{label}</h4>}
      <div className="rbd-fields">{children}</div>
      {note}
    </div>
  );
}

/** A status stamp: near-square frame, a semantic tone, readable words. */
function Stamp({ tone, children }: { tone?: "ok" | "warn" | "bad"; children: React.ReactNode }) {
  return <span className={"rbd-stamp" + (tone ? ` is-${tone}` : "")}>{children}</span>;
}

/** A quiet action in words (Add roof type, Price it flat, Restore built-in list). */
function TextBtn({ children, onClick, disabled, plus }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; plus?: boolean }) {
  return (
    <button type="button" className="rbd-text-btn" disabled={disabled} onClick={onClick}>
      {plus && <IcPlus />}
      {children}
    </button>
  );
}

/** One section of the roof: a heading button (name, status, what is picked)
 *  that opens the section's fields, and — when the section has any — the
 *  contractor's rates at its foot. */
function Section({
  id,
  title,
  summary,
  chip,
  open,
  onToggle,
  children,
  rates,
}: {
  id: string;
  title: string;
  summary: string;
  chip?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  rates?: React.ReactNode;
}) {
  const bodyId = `rbd-body-${id}`;
  return (
    <section className={`rbd-sec rbd-sec--${id}` + (open ? " is-open" : "")}>
      <h3 className="rbd-sec-h">
        <button type="button" className="rbd-sec-btn" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={onToggle}>
          <span className="rbd-sec-txt">
            <span className="rbd-sec-top">
              <span className="rbd-sec-t">{title}</span>
              {chip}
            </span>
            <span className="rbd-sec-s">{summary}</span>
          </span>
          <span className="rbd-sec-go" aria-hidden="true">
            <IcChev />
          </span>
        </button>
      </h3>
      {open && (
        <div className="rbd-sec-body" id={bodyId}>
          {children}
          {rates && (
            <div className="rbd-g rbd-g--rates">
              <h4 className="rbd-g-h">Your rates</h4>
              <div className="rbd-fields">{rates}</div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// THE PACKAGE BUILDER — the sections and the ESTIMATE rail. Owns the builder
// state. From here down to `lineCount` the text is variant C's, unchanged.
// ═══════════════════════════════════════════════════════════════════════════
function PackageLedger({
  facts,
  onBuild,
  onConvert,
  report,
  disabled: incomingDisabled,
  converting,
  lead,
  needsPitch = false,
  blockedReason = "Enter pitch to price.",
  onBuildingUse,
  seedSpec = null,
  convertLabel,
}: {
  facts: RoofFacts;
  seedSpec?: { spec: RoofPackageSpec; key: string } | null;
  convertLabel?: string;
  onBuildingUse?: (use: "residential" | "commercial") => void;
  onBuild: (pkg: RoofPackage, spec: RoofPackageSpec) => void;
  onConvert: (pkg: RoofPackage, spec: RoofPackageSpec) => void;
  report?: ReportProp | null;
  disabled?: boolean;
  converting?: boolean;
  /** The pitch picker, when the aerial data carried no pitch: it leads the title block. */
  lead?: React.ReactNode;
  needsPitch?: boolean;
  /** Why nothing is priced while `needsPitch`: the pitch, or packs still on the way. */
  blockedReason?: string;
}) {
  // ── State, effects, handlers and derived values: verbatim from
  //    roof-package-builder.tsx (the functionality). ──
  const key = factsKey(facts);
  // The builder only mounts on the report panel, after a measurement is
  // opened client-side, so the browser's copy can be read at first render;
  // the window guard keeps a stray server render from throwing.
  const [lists, setLists] = React.useState<CatalogLists>(() =>
    (typeof window === "undefined" ? null : saneLists(readLocal<CatalogLists>(LISTS_KEY))) ?? BUILTIN_LISTS,
  );
  const [spec, setSpec] = React.useState<RoofPackageSpec>(() => {
    const l = (typeof window === "undefined" ? null : saneLists(readLocal<CatalogLists>(LISTS_KEY))) ?? BUILTIN_LISTS;
    // A saved proposal opened again (2026-10-13): its own choices, on the roof they were made for.
    if (seedSpec && seedSpec.key === key) return reconcile({ ...defaultSpec(facts, l), ...seedSpec.spec }, l);
    const saved = typeof window === "undefined" ? null : readLocal<Prefs>(PREFS_KEY);
    return familyFit(reconcile(applyPrefs(defaultSpec(facts, l, saved?.lowSlopeSystemId), saved), l), facts, l, saved);
  });
  // A different roof opened: the per-roof entries start over from its facts,
  // the preferences stay. Adjusted during render, not in an effect. The
  // proposal's own choices come back when its roof is the one now open, or
  // when they arrive after the roof did.
  const [seenKey, setSeenKey] = React.useState(key);
  const [seenSeed, setSeenSeed] = React.useState(seedSpec);
  if (key !== seenKey || seedSpec !== seenSeed) {
    setSeenKey(key);
    setSeenSeed(seedSpec);
    if (seedSpec && seedSpec.key === key) setSpec(reconcile({ ...defaultSpec(facts, lists), ...seedSpec.spec }, lists));
    else if (key !== seenKey) {
      const saved = readLocal<Prefs>(PREFS_KEY);
      setSpec(familyFit(reconcile(applyPrefs(defaultSpec(facts, lists, saved?.lowSlopeSystemId), saved), lists), facts, lists, saved));
    }
  }
  // The contractor answered residential or commercial (the report panel asks
  // when the roof reads commercial). Applied IN PLACE: the job-class defaults
  // follow the answer, nothing else they entered is lost.
  const use = facts.buildingUse ?? null;
  const [seenUse, setSeenUse] = React.useState(use);
  if (use !== seenUse) {
    setSeenUse(use);
    setSpec((s) => applyPickedPrices(withJobClass(s, facts, lists, use === "commercial"), readLocal<Prefs>(PREFS_KEY)));
  }
  // A full measurement report landed for this roof: its lengths replace the
  // estimates in place — nothing the contractor entered is wiped.
  const reportId = facts.measured?.reportId ?? null;
  const [seenReport, setSeenReport] = React.useState(reportId);
  if (reportId !== seenReport) {
    setSeenReport(reportId);
    if (reportId != null) {
      setSpec((s) => {
        const merged = withMeasured(s, facts, lists);
        const flatNow = isFlatRoof(facts);
        return flatNow !== (merged.systemFamily === "low-slope") ? familyFit(merged, facts, lists, readLocal<Prefs>(PREFS_KEY)) : merged;
      });
    }
  }
  // The latest facts, for the one effect that runs once (the org catalog load).
  const factsRef = React.useRef(facts);
  React.useEffect(() => {
    factsRef.current = facts;
  });

  const seedRef = React.useRef(seedSpec);
  React.useEffect(() => {
    seedRef.current = seedSpec;
  });

  // The org's saved catalog, when the table exists and a save has happened:
  // its lists and prices win over the browser's copy.
  const [source, setSource] = React.useState<"loading" | "org" | "browser">("loading");
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  // Wait for the company defaults before accepting edits; a late response
  // must never overwrite a rate the contractor has just entered.
  const disabled = incomingDisabled || source === "loading" || saving;
  React.useEffect(() => {
    let cancelled = false;
    getRoofCatalog()
      .then((doc) => {
        if (cancelled) return;
        if (doc) {
          const l = saneLists({ systems: doc.systems, underlayments: doc.underlayments }) ?? BUILTIN_LISTS;
          setLists(l);
          // A proposal's own choices (seedSpec) stay what they were: the company's usual ones are for a new roof.
          const seed = seedRef.current;
          setSpec((s) =>
            seed && seed.key === factsKey(factsRef.current)
              ? reconcile({ ...defaultSpec(factsRef.current, l), ...seed.spec }, l)
              : familyFit(reconcile(applyPrefs(s, doc.prefs), l), factsRef.current, l, doc.prefs as Prefs),
          );
          writeLocal(LISTS_KEY, l);
          writeLocal(PREFS_KEY, doc.prefs);
          setSource("org");
        } else {
          setSource("browser");
        }
      })
      .catch(() => {
        if (!cancelled) setSource("browser");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const set = React.useCallback(<K extends keyof RoofPackageSpec>(k: K, v: RoofPackageSpec[K]) => {
    setSpec((s) => {
      const next = { ...s, [k]: v };
      writeLocal(PREFS_KEY, prefsOf(next));
      return next;
    });
    setDirty(true);
  }, []);
  const setEdge = (k: "eaveFt" | "rakeFt" | "ridgeFt" | "hipFt", v: number) => setSpec((s) => ({ ...s, [k]: v, edgesBasis: "entered" }));
  const setValleyField = (k: "valleyCount" | "valleyFtEach", v: number) => setSpec((s) => ({ ...s, [k]: v, valleyBasis: "entered" }));
  const setStepField = (k: "stepWallCount" | "stepWallFtEach", v: number) => setSpec((s) => ({ ...s, [k]: v, stepBasis: "entered" }));
  /** A fascia board carries its own two rates; picking one seeds both. */
  const pickFascia = (id: string) => {
    const f = FASCIA_OPTIONS.find((x) => x.id === id);
    if (!f) return;
    set("fasciaOptionId", f.id);
    set("fasciaPerFt", f.perFt);
    set("fasciaLaborPerFt", f.laborPerFt);
  };
  const resetEdges = () => {
    const e = estimateEdges(facts);
    if (e) setSpec((s) => ({ ...s, ...e, edgesBasis: "estimated" }));
  };
  const updateLists = (next: CatalogLists) => {
    setLists(next);
    setSpec((s) => {
      const r = reconcile(s, next);
      if (r.systemFamily === s.systemFamily) return r;
      // The family ran out of rows: cross to the new family properly.
      const target = next.systems.find((x) => x.id === r.systemId);
      return target ? withSystem(s, target, facts, next) : r;
    });
    writeLocal(LISTS_KEY, next);
    setDirty(true);
  };

  async function saveDefaults() {
    if (saving || source === "loading") return;
    setSaving(true);
    setSaveError(null);
    const prefs = prefsOf(spec);
    try {
      const res = await saveRoofCatalog({ version: 1, systems: lists.systems, underlayments: lists.underlayments, prefs });
      if (res.ok) {
        writeLocal(LISTS_KEY, lists);
        writeLocal(PREFS_KEY, prefs);
        setSource("org");
        setDirty(false);
        toast.success("Defaults saved", "Your roof types, underlayments and rates now load for everyone in your company.");
      } else {
        setSaveError(res.error);
        toast.error("Couldn't save", res.error);
      }
    } catch {
      const message = "Company defaults could not be saved. Check your connection and try again.";
      setSaveError(message);
      toast.error("Couldn't save", message);
    } finally {
      setSaving(false);
    }
  }

  const pkg = React.useMemo(() => buildRoofPackage(spec, facts), [spec, facts]);
  const vent = React.useMemo(() => checkVentilation(spec, facts), [spec, facts]);
  const total = [...pkg.materials, ...pkg.labor].reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  const materialsTotal = pkg.materials.reduce((a, l) => a + l.quantity * l.unitPrice, 0);

  // ── Picks copy the catalog row's prices into the spec ──
  // withSystem does the work (the underlayment and valley follow a steep
  // family; a flat system follows its method; crossing between steep and flat
  // rebuilds the roof-shaped part), and after a crossing the saved rates for
  // the new side are laid back on.
  const pickSystem = (id: string, from: CatalogLists = lists, opts: { auto?: boolean; force?: boolean } = {}) => {
    const s = from.systems.find((x) => x.id === id);
    if (!s) return;
    if (id === spec.systemId && !opts.force) return;
    setSpec((prev) => {
      const next = pickSystemOn(prev, s, facts, from, { auto: opts.auto });
      writeLocal(PREFS_KEY, prefsOf(next));
      return next;
    });
    setDirty(true);
  };
  /** A row-01 rate edit is a catalog edit: it lands on the system's row, so
   *  Manage roof types, the next roof and "Save as defaults" all see it. */
  const setSystemRate = (field: "matPerSq" | "laborPerSq" | "capPerFt", v: number) => {
    // A system with no row (never after reconcile, but never assume) keeps
    // the edit on this estimate only, rather than letting reconcile swap it.
    if (lists.systems.some((x) => x.id === spec.systemId)) {
      updateLists({ ...lists, systems: lists.systems.map((x) => (x.id === spec.systemId ? { ...x, [field]: v } : x)) });
    }
    const key = field === "matPerSq" ? "systemMatPerSq" : field === "laborPerSq" ? "systemLaborPerSq" : "capPerFt";
    setSpec((prev) => ({ ...prev, [key]: v }));
  };
  /** Roof type first, then the system within it: the contractor's usual flat
   *  system for "Flat / low slope", like-for-like for the family otherwise. */
  const pickFamily = (fam: RoofFamily) => {
    if (fam === spec.systemFamily) return;
    const usual = fam === "low-slope" ? readLocal<Prefs>(PREFS_KEY)?.lowSlopeSystemId : null;
    const s = (usual ? lists.systems.find((x) => x.id === usual && x.family === fam) : null) ?? likeForLikeSystem(fam, lists);
    if (s) pickSystem(s.id);
    else toast.info(`No ${familyLabel(fam).toLowerCase()} systems in your list`, "Add one with Add roof type.");
  };
  const setFlat = <K extends keyof FlatSpec>(k: K, v: FlatSpec[K]) => {
    setSpec((prev) => {
      const next = { ...prev, flat: { ...prev.flat, [k]: v } };
      writeLocal(PREFS_KEY, prefsOf(next));
      return next;
    });
    setDirty(true);
  };
  const setFlatRate = (k: FlatRateKey, v: number) => {
    setSpec((prev) => {
      const next = { ...prev, flat: { ...prev.flat, rates: { ...prev.flat.rates, [k]: v } } };
      writeLocal(PREFS_KEY, prefsOf(next));
      return next;
    });
    setDirty(true);
  };
  // Option picks copy the catalog price, then the price this contractor last
  // set for that same option, if any.
  const pickBoard = (kind: "insulation" | "cover", id: string) => {
    const o = (kind === "insulation" ? INSULATION_OPTIONS : COVER_BOARDS).find((x) => x.id === id);
    if (!o) return;
    setSpec((prev) =>
      applyPickedPrices(
        {
          ...prev,
          flat:
            kind === "insulation"
              ? { ...prev.flat, insulationId: o.id, insulationMatPerSq: o.matPerSq, insulationLaborPerSq: o.laborPerSq, insulationThicknessIn: o.thicknessIn }
              : { ...prev.flat, coverBoardId: o.id, coverBoardMatPerSq: o.matPerSq, coverBoardLaborPerSq: o.laborPerSq, coverBoardThicknessIn: o.thicknessIn },
        },
        readLocal<Prefs>(PREFS_KEY),
      ),
    );
    setDirty(true);
  };
  const pickWarranty = (id: string) => {
    const w = WARRANTIES.find((x) => x.id === id);
    if (w) setSpec((prev) => applyPickedPrices({ ...prev, flat: { ...prev.flat, warrantyId: w.id, warrantyPerSq: w.perSq } }, readLocal<Prefs>(PREFS_KEY)));
    setDirty(true);
  };
  const pickExisting = (id: string) => {
    const e = EXISTING_LOW_SLOPE.find((x) => x.id === id);
    if (e) setSpec((prev) => applyPickedPrices({ ...prev, flat: { ...prev.flat, existing: e.id }, tearOffPerSqLayer: e.tearOffPerSqLayer, disposalPerSqLayer: e.disposalPerSqLayer }, readLocal<Prefs>(PREFS_KEY)));
    setDirty(true);
  };
  const setCommercial = <K extends keyof CommercialSpec>(k: K, v: CommercialSpec[K]) => {
    setSpec((prev) => {
      const next = { ...prev, commercial: { ...prev.commercial, [k]: v } };
      if (k === "wage") writeLocal(PREFS_KEY, prefsOf(next));
      return next;
    });
    setDirty(true);
  };
  const setCommercialRate = (k: CommercialRateKey, v: number) => {
    setSpec((prev) => {
      const next = { ...prev, commercial: { ...prev.commercial, rates: { ...prev.commercial.rates, [k]: v } } };
      writeLocal(PREFS_KEY, prefsOf(next));
      return next;
    });
    setDirty(true);
  };
  /** Commercial on or off from the builder. On a measured roof it is the
   *  page's one answer (the seenUse block applies it here); on a hand-entered
   *  takeoff it stays local. */
  const toggleCommercial = (on: boolean) => {
    if (onBuildingUse) onBuildingUse(on ? "commercial" : "residential");
    else setSpec((prev) => applyPickedPrices(withJobClass(prev, facts, lists, on), readLocal<Prefs>(PREFS_KEY)));
    setDirty(true);
  };
  /** The select's last option: a new row of the contractor's own, picked and opened for editing. */
  const CUSTOM_SYSTEM = "__custom";
  /** What a replacement is like-for-like with, when that is true (likeForLikeFamily). */
  const existingFam = likeForLikeFamily(facts);
  const pickUnderlayment = (id: string, from: CatalogLists = lists) => {
    const u = from.underlayments.find((x) => x.id === id);
    if (!u) return;
    set("underlaymentId", id);
    set("underlaymentName", u.label);
    set("underlaymentPerSq", u.perSq);
  };
  const pickDrip = (id: string) => {
    const d = DRIP_EDGE_PROFILES.find((x) => x.id === id);
    if (!d) return;
    set("dripProfileId", id);
    if (id !== "custom") set("dripPerFt", d.perFt);
  };
  const pickValley = (id: string) => {
    const v = VALLEY_TYPES.find((x) => x.id === id);
    if (!v) return;
    set("valleyTypeId", id);
    if (id !== "custom") {
      set("valleyMatPerFt", v.matPerFt);
      set("valleyLaborPerFt", v.laborPerFt);
    }
  };
  const pickStep = (id: string) => {
    const s = STEP_FLASHING_SIZES.find((x) => x.id === id);
    if (!s) return;
    set("stepSizeId", id);
    if (id !== "custom") set("stepPerPiece", s.perPiece);
  };
  const pickChimney = (id: string) => {
    const c = CHIMNEY_SIZES.find((x) => x.id === id);
    if (!c) return;
    set("chimneySizeId", id);
    set("chimneyEach", c.each);
    set("chimneyLabor", c.labor);
  };
  const setVent = (id: string, patch: Partial<{ qty: number; each: number; labor: number }>) => {
    setSpec((s) => {
      const t = VENT_TYPES.find((x) => x.id === id)!;
      const saved = readLocal<Prefs>(PREFS_KEY)?.ventPrices?.[id];
      const each = saved && Number.isFinite(saved.each) && saved.each >= 0 ? saved.each : t.each;
      const labor = saved && Number.isFinite(saved.labor) && saved.labor >= 0 ? saved.labor : t.labor;
      const has = s.vents.some((v) => v.id === id);
      const vents = has ? s.vents.map((v) => (v.id === id ? { ...v, ...patch } : v)) : [...s.vents, { id, qty: 0, each, labor, ...patch }];
      const next = { ...s, vents };
      writeLocal(PREFS_KEY, prefsOf(next));
      return next;
    });
    setDirty(true);
  };
  const ventOf = (id: string) => spec.vents.find((v) => v.id === id) ?? { id, qty: 0, each: VENT_TYPES.find((x) => x.id === id)!.each, labor: VENT_TYPES.find((x) => x.id === id)!.labor };
  const setCustom = (id: string, patch: Partial<RoofPackageSpec["custom"][number]>) => setSpec((s) => ({ ...s, custom: s.custom.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const addCustom = (kind: "material" | "labor") => setSpec((s) => ({ ...s, custom: [...s.custom, { id: nanoid(6), name: "", qty: 1, unit: "each", unitPrice: 0, kind }] }));
  const removeCustom = (id: string) => setSpec((s) => ({ ...s, custom: s.custom.filter((c) => c.id !== id) }));

  // ── Manage the contractor's lists ──
  const [manage, setManage] = React.useState<null | "systems" | "underlayments">(null);
  const patchSystem = (id: string, patch: Partial<RoofSystem>) => {
    const next = { ...lists, systems: lists.systems.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
    updateLists(next);
    if (id !== spec.systemId) return;
    const row = next.systems.find((s) => s.id === id)!;
    if (row.family !== spec.systemFamily) {
      pickSystem(id, next, { force: true });
      return;
    }
    // Same system, same family: take the edited label and prices only — the
    // flat-roof choices that follow a system's method stay as they are.
    setSpec((prev) => ({ ...prev, systemName: row.label, systemMatPerSq: row.matPerSq, systemLaborPerSq: row.laborPerSq, wastePct: row.wastePct, capPerFt: prev.systemFamily === "low-slope" ? 0 : row.capPerFt }));
  };
  const addSystem = () => {
    const s: RoofSystem = { id: "s_" + nanoid(6), label: spec.systemFamily === "low-slope" ? "Custom flat system" : "Custom roof type", family: spec.systemFamily, matPerSq: 0, laborPerSq: 0, wastePct: spec.systemFamily === "low-slope" ? 8 : 10, capPerFt: 0 };
    const next = { ...lists, systems: [...lists.systems, s] };
    updateLists(next);
    pickSystem(s.id, next);
    setManage("systems");
  };
  const removeSystem = (id: string) => {
    if (lists.systems.length <= 1) return;
    updateLists({ ...lists, systems: lists.systems.filter((s) => s.id !== id) });
  };
  const patchUnderlayment = (id: string, patch: Partial<Underlayment>) => {
    const next = { ...lists, underlayments: lists.underlayments.map((u) => (u.id === id ? { ...u, ...patch } : u)) };
    updateLists(next);
    if (id === spec.underlaymentId) pickUnderlayment(id, next);
  };
  const addUnderlayment = () => {
    updateLists({ ...lists, underlayments: [...lists.underlayments, { id: "u_" + nanoid(6), label: "New underlayment", perSq: 0 }] });
  };
  const removeUnderlayment = (id: string) => {
    if (lists.underlayments.length <= 1) return;
    updateLists({ ...lists, underlayments: lists.underlayments.filter((u) => u.id !== id) });
  };
  const resetLists = () => {
    updateLists(BUILTIN_LISTS);
    toast.info("Built-in roof types restored — save to keep them.");
  };

  // ── Which rows are open. The first one opens by default; the rest read
  //    from their summary line until the contractor needs them. ──
  const [open, setOpen] = React.useState<Record<string, boolean>>({ system: true });
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  // ── end of the verbatim block ──

  // ── Summaries: what is picked, in one breath. Rates stay inside the row. ──
  // The DISPLAYED pitch, the same number the package prices on
  // (catalog.displayPitch12) — a roof this card calls 8/12 is charged as 8/12.
  const steepest = facts.pitchFamilies.reduce((m, f) => Math.max(m, displayPitch12(f.pitch12)), 0);
  const lowSlope = spec.systemFamily === "low-slope";
  const noStarter = lowSlope || spec.systemFamily === "metal";
  const sumSystem = `${spec.systemName} · ${spec.wastePct}% waste`;
  const iceLabel = ICE_WATER.find((i) => i.id === spec.iceWater)?.label ?? spec.iceWater;
  const sumUnder = `${spec.underlaymentName} · ${spec.iceWater === "none" ? "no ice & water" : `ice & water ${iceLabel.split(" (")[0].toLowerCase()}`}`;
  const noEdges = spec.eaveFt + spec.rakeFt + spec.ridgeFt + spec.hipFt <= 0;
  const sumEdges = [
    noEdges
      ? "No lengths yet — enter eave, rake and ridge"
      : `Eave ${fmt(spec.eaveFt)} · rake ${fmt(spec.rakeFt)} · ridge ${fmt(spec.ridgeFt)}${spec.hipFt > 0 ? ` · hip ${fmt(spec.hipFt)}` : ""} ft`,
    spec.dripEdgeOn ? "drip edge" : null,
    !noStarter && spec.starterOn ? "starter" : null,
    spec.fasciaOn ? `fascia ${fmt(fasciaFeet(spec))} ft` : null,
    spec.fasciaOn && spec.gutterPlan !== "none" ? (spec.gutterPlan === "replace" ? "new gutters" : "gutters reset") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const pipeTotal = PIPE_BOOT_SIZES.reduce((a, s) => a + (spec.pipeBoots[s.id] ?? 0), 0);
  const flashBits = [
    spec.valleyCount > 0 ? `${spec.valleyCount} valley${spec.valleyCount === 1 ? "" : "s"}` : null,
    spec.stepWallCount > 0 ? `${spec.stepWallCount} sidewall${spec.stepWallCount === 1 ? "" : "s"}` : null,
    spec.apronFt > 0 ? `apron ${fmt(spec.apronFt)} ft` : null,
    spec.counterFt > 0 ? `counter ${fmt(spec.counterFt)} ft` : null,
    pipeTotal > 0 ? `${pipeTotal} pipe boot${pipeTotal === 1 ? "" : "s"}` : null,
    spec.chimneyCount > 0 ? `${spec.chimneyCount} chimney${spec.chimneyCount === 1 ? "" : "s"}` : null,
    spec.curbCount > 0 ? `${spec.curbCount} curb${spec.curbCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  const sumFlash = flashBits.length ? flashBits.join(" · ") : "Nothing counted yet — valleys, walls, pipes, chimney";
  const ventsOn = VENT_TYPES.filter((t) => ventOf(t.id).qty > 0);
  const sumVents = ventsOn.length
    ? ventsOn.map((t) => `${fmt(ventOf(t.id).qty)}${t.unit === "linear ft" ? " ft" : " ×"} ${t.label.split(" · ")[0].toLowerCase()}`).join(" · ")
    : "No vents yet";
  // The plywood in the section's one line: what is counted, or the rate the client is quoted.
  const plyNow = plywoodCount(spec);
  const plywoodSummary = plyNow
    ? `plywood ${plyNow.unit === "each" ? `${plyNow.sheets} sheet${plyNow.sheets === 1 ? "" : "s"}` : `${fmt(plyNow.sqft)} sq ft`}`
    : spec.plywoodQuote && spec.tearOffLayers > 0 && plywoodRate(spec).sheet > 0
      ? `plywood ${money2(plywoodRate(spec).sheet)}/sheet quoted`
      : null;
  const sumTear = [
    spec.tearOffLayers === 0 ? "Overlay, no tear-off" : `Tear-off ${spec.tearOffLayers} layer${spec.tearOffLayers === 1 ? "" : "s"}`,
    plywoodSummary,
    spec.cleanupLump > 0 ? `cleanup ${money(spec.cleanupLump)}` : null,
    steepest >= 8 && spec.safetyLump > 0 ? `steep safety ${money(spec.safetyLump)}` : null,
    !spec.commercial.on && spec.permitLump > 0 ? `permit ${money(spec.permitLump)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const sumCustom = spec.custom.length ? `${spec.custom.length} line${spec.custom.length === 1 ? "" : "s"}` : "None";

  // ── The flat roof's rows ──
  const F = spec.flat;
  const rule = lowSlope ? lowSlopeRule(spec.systemId, spec.systemName) : null;
  const boards = rule ? takesBoards(rule) : false;
  const surface = rule ? isSurfaceApplied(rule) : false;
  const perimeterFt = Math.max(0, spec.eaveFt + spec.rakeFt);
  const splitOff = perimeterFt > 0 && Math.abs(F.parapetFt + F.edgeMetalFt - perimeterFt) > 0.1 * perimeterFt;
  const insLabel = INSULATION_OPTIONS.find((o) => o.id === F.insulationId)?.label ?? "Insulation";
  const coverLabel = COVER_BOARDS.find((o) => o.id === F.coverBoardId)?.label ?? "Cover board";
  const plural = (n: number, one: string, many = one + "s") => `${fmt(n)} ${n === 1 ? one : many}`;
  const sumBoards = surface
    ? ["Wash, repair & fabric", F.primerOn ? "primer" : null, F.wetInsulationSqft > 0 ? `${fmt(F.wetInsulationSqft)} sq ft wet insulation` : null, F.coreCuts > 0 ? plural(F.coreCuts, "core cut") : null].filter(Boolean).join(" · ")
    : !boards
      ? "Straight on the deck — no insulation or cover board"
      : [F.insulationId !== "none" ? insLabel : "No insulation", F.coverBoardId !== "none" ? coverLabel : null, F.taperedSqft > 0 ? `${fmt(F.taperedSqft)} sq ft tapered` : null].filter(Boolean).join(" · ");
  const sumWalls =
    F.parapetFt + F.edgeMetalFt + F.wallFt <= 0
      ? "No perimeter yet — enter the parapet and open-edge lengths"
      : [F.parapetFt > 0 ? `${fmt(F.parapetFt)} ft parapet` : null, F.edgeMetalFt > 0 ? `${fmt(F.edgeMetalFt)} ft open edge` : null, F.wallFt > 0 ? `${fmt(F.wallFt)} ft wall` : null].filter(Boolean).join(" · ");
  const sumDrains =
    [
      !surface && F.drains > 0 ? `${plural(F.drains, "drain")}${F.secondary !== "none" ? " + overflow" : ""}` : null,
      F.scuppers > 0 ? plural(F.scuppers, "scupper") : null,
      F.gutterFt > 0 ? `${fmt(F.gutterFt)} ft gutter` : null,
      F.pipeBoots > 0 ? plural(F.pipeBoots, "boot") : null,
      F.pitchPockets > 0 ? plural(F.pitchPockets, "pitch pocket") : null,
      !surface && F.rtuCount > 0 ? plural(F.rtuCount, "rooftop unit") : null,
      !surface && F.curbs > 0 ? plural(F.curbs, "curb") : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Nothing counted yet — drains, boots, units, curbs";
  const warrantyLabel = WARRANTIES.find((w) => w.id === F.warrantyId)?.label ?? "Workmanship only";
  const sumRooftop = [
    F.walkwayFt > 0 ? `${fmt(F.walkwayFt)} ft walkway` : null,
    F.craneHours > 0 ? `crane ${fmt(F.craneHours)} h` : F.hoistOn ? "ladder hoist" : null,
    !surface && F.coreCuts > 0 ? plural(F.coreCuts, "core cut") : null,
    warrantyLabel,
  ]
    .filter(Boolean)
    .join(" · ");
  const existingLabel = EXISTING_LOW_SLOPE.find((e) => e.id === F.existing)?.label ?? "Existing roof";
  const sumFlatTear = [
    surface ? "Over the existing roof, no tear-off" : spec.tearOffLayers === 0 ? "Recover, no tear-off" : `Tear-off ${existingLabel.toLowerCase()} · ${plural(spec.tearOffLayers, "layer")}`,
    plywoodSummary,
    spec.cleanupLump > 0 ? `cleanup ${money(spec.cleanupLump)}` : null,
    !spec.commercial.on && spec.permitLump > 0 ? `permit ${money(spec.permitLump)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const attachRates: FlatRateKey[] = !rule
    ? []
    : [
        ...(rule.method === "mech" ? (["mechFasteners"] as const) : []),
        ...(rule.method === "induction" ? (["inductionPlates"] as const) : []),
        ...(rule.method === "adhered" ? ([rule.fleece ? "foamAdhesive" : "bondingAdhesive"] as const) : []),
        ...(rule.method === "ballasted" ? (["ballastMat", "ballastLabor"] as const) : []),
        ...(rule.method === "torch" ? (["primerTorch"] as const) : []),
        ...(rule.method === "self_adhered" ? (["primerSa"] as const) : []),
        ...(rule.method === "nailed" ? (["capNails"] as const) : []),
        ...(rule.membrane === "tpo" || rule.membrane === "pvc" || rule.membrane === "kee" ? (["seamSingle"] as const) : []),
        ...(rule.membrane === "epdm" ? (["seamEpdm"] as const) : []),
      ];
  const flatRates = (keys: ReadonlyArray<FlatRateKey | false | null>) =>
    keys.filter((k): k is FlatRateKey => !!k).map((k) => (
      <Rate key={k} label={FLAT_RATE_DEFS[k].label} unit={FLAT_RATE_DEFS[k].unit} value={flatRate(F, k)} onChange={(v) => setFlatRate(k, v)} disabled={disabled} />
    ));

  // ── Commercial ──
  const C = spec.commercial;
  const prod = productivityFactor(facts.squares);
  const wageLabel = WAGE_REGIMES.find((w) => w.id === C.wage)?.label ?? "Open shop";
  const shiftLabel = SHIFTS.find((x) => x.id === C.shift)?.label ?? "Day shift";
  const sumCommercial = C.on
    ? [`Commercial · ${wageLabel.toLowerCase()}`, shiftLabel.toLowerCase(), C.occupied ? "occupied" : null, C.stories > 2 ? `${C.stories} stories` : null, `GC ${cRate(C, "gcPct") + cRate(C, "insurancePct")}%`].filter(Boolean).join(" · ")
    : "Residential pricing";
  const commercialRates = (keys: CommercialRateKey[]) =>
    keys.map((k) => (
      <Rate key={k} label={COMMERCIAL_RATE_DEFS[k].label} unit={COMMERCIAL_RATE_DEFS[k].unit} value={cRate(C, k)} onChange={(v) => setCommercialRate(k, v)} disabled={disabled} />
    ));
  const roofIsFlat = isFlatRoof(facts);

  const ventsToAdd = VENT_TYPES.filter((t) => ventOf(t.id).qty <= 0);
  const edgeEstimated = spec.edgesBasis === "estimated";
  const edgeMeasured = spec.edgesBasis === "measured";
  const lineCount = pkg.materials.length + pkg.labor.length;

  const convertBtn = (
    <button
      type="button"
      className="rbd-btn rbd-btn--primary"
      disabled={disabled || converting || needsPitch}
      aria-busy={converting || undefined}
      onClick={() => onConvert(pkg, spec)}
      title={needsPitch ? blockedReason : "Straight to a proposal with these lines — lines you already edited below are what gets converted"}
    >
      <svg className="ic" aria-hidden="true"><use href="#i-file" /></svg>
      {converting ? (convertLabel ? "Updating…" : "Creating…") : (convertLabel ?? "Convert to proposal")}
    </button>
  );

  // The roof-type tiles offer the families the contractor's list has a system
  // for, and always the one in use (C's filter on its select, unchanged).
  const families = ROOF_FAMILIES.filter((f) => f.id === spec.systemFamily || lists.systems.some((x) => x.family === f.id));
  // Under the tiles: what a flat roof is priced as, or the way to price it flat.
  const familyNote = lowSlope ? (
    <p className="rbd-note">
      {roofIsFlat
        ? `Flat roof${facts.existingMaterial ? ` · existing ${facts.existingMaterial.toLowerCase()}` : ""} · priced as a full assembly`
        : "Priced as a full flat-roof assembly"}
    </p>
  ) : roofIsFlat && spec.systemId !== "standing_seam_low" ? (
    <p className="rbd-note is-diff">
      This roof reads flat — a steep system here prices a conversion.{" "}
      <TextBtn disabled={disabled} onClick={() => pickFamily("low-slope")}>
        Price it flat
      </TextBtn>
    </p>
  ) : undefined;
  // Under the system: like-for-like with what is on the roof now, and the
  // list editor's way in.
  const systemNote = (
    <div className="rbd-g-foot">
      {existingFam && !lowSlope && (
        <p className={"rbd-note" + (spec.systemFamily === existingFam ? "" : " is-diff")}>
          {spec.systemFamily === existingFam ? (
            `Existing roof: ${facts.existingMaterial} · priced like-for-like`
          ) : (
            <>
              {`Existing roof: ${facts.existingMaterial} — this prices a change to ${familyLabel(spec.systemFamily).toLowerCase()}.`}{" "}
              {likeForLikeSystem(existingFam, lists) && (
                <TextBtn
                  disabled={disabled}
                  onClick={() => {
                    const s = likeForLikeSystem(existingFam, lists);
                    if (s) pickSystem(s.id, lists, { auto: true });
                  }}
                >
                  {`Back to ${familyLabel(existingFam).toLowerCase()}`}
                </TextBtn>
              )}
            </>
          )}
        </p>
      )}
      <a className="rbd-text-btn" href="/dashboard/roof-estimator/inventory#book">
        Manage roof types
      </a>
    </div>
  );

  return (
    <div className="rbd-body">
      <div className="rbd-main">
        {lead && <div className={"rbd-lead" + (needsPitch ? " is-needed" : "")}>{lead}</div>}

        <div className="rbd-secs">
          {/* ROOF SYSTEM */}
          <Section
            id="system"
            title="Roof system"
            summary={sumSystem}
            open={!!open.system}
            onToggle={() => toggle("system")}
            rates={
              manage === "systems" ? undefined : (
                <>
                  <Rate label="Material" unit="$/sq" value={spec.systemMatPerSq} onChange={(v) => setSystemRate("matPerSq", v)} disabled={disabled} />
                  <Rate label="Install labor" unit="$/sq" value={spec.systemLaborPerSq} onChange={(v) => setSystemRate("laborPerSq", v)} disabled={disabled} />
                  {!lowSlope && <Rate label="Hip & ridge cap" unit="$/ft" value={spec.capPerFt} onChange={(v) => setSystemRate("capPerFt", v)} disabled={disabled} />}
                </>
              )
            }
          >
            {manage === "systems" ? (
              <div className="rbd-g">
                <h4 className="rbd-g-h">Your roof types · {familyLabel(spec.systemFamily)}</h4>
                <div className="rbd-tbl">
                  <div className="rbd-tr rbd-tr--sys rbd-th" aria-hidden="true">
                    <span>Roof type</span><span>Family</span><span>Material</span><span>Labor</span><span>Waste</span><span>Cap</span><span />
                  </div>
                  {lists.systems.filter((x) => x.family === spec.systemFamily).map((s) => (
                    <div className="rbd-tr rbd-tr--sys" key={s.id}>
                      <label className="rbd-f rbd-tn">
                        <span className="rbd-lbl">Roof type</span>
                        <input className="rbd-in" value={s.label} disabled={disabled} aria-label="Roof type name" onChange={(e) => patchSystem(s.id, { label: e.target.value })} />
                      </label>
                      <Sel label="Family" value={s.family} options={ROOF_FAMILIES} onChange={(v) => patchSystem(s.id, { family: v as RoofFamily })} disabled={disabled} />
                      <Num label="Material" aria="Material $/sq" unit="$/sq" value={s.matPerSq} onChange={(n) => patchSystem(s.id, { matPerSq: n })} disabled={disabled} />
                      <Num label="Labor" aria="Labor $/sq" unit="$/sq" value={s.laborPerSq} onChange={(n) => patchSystem(s.id, { laborPerSq: n })} disabled={disabled} />
                      <Num label="Waste" aria="Waste %" unit="%" value={s.wastePct} onChange={(n) => patchSystem(s.id, { wastePct: n })} disabled={disabled} />
                      <Num label="Cap" aria="Cap $/ft" unit="$/ft" value={s.capPerFt} onChange={(n) => patchSystem(s.id, { capPerFt: n })} disabled={disabled} />
                      <button
                        type="button"
                        className="rbd-x"
                        disabled={disabled || lists.systems.length <= 1 || s.id === spec.systemId}
                        aria-label={`Remove ${s.label}`}
                        title={s.id === spec.systemId ? "In use on this estimate — pick another system first" : "Remove"}
                        onClick={() => removeSystem(s.id)}
                      >
                        <IcX />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="rbd-add">
                  <button type="button" className="rbd-btn rbd-btn--ghost rbd-btn--sm" disabled={disabled} onClick={addSystem}>
                    <IcPlus />
                    Roof type
                  </button>
                  <TextBtn disabled={disabled} onClick={resetLists}>
                    Restore built-in list
                  </TextBtn>
                  <button type="button" className="rbd-btn rbd-btn--ink rbd-btn--sm rbd-add-done" onClick={() => setManage(null)}>
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <>
                <Group note={familyNote}>
                  <Tiles label="Roof type" value={spec.systemFamily} options={families} onPick={pickFamily} disabled={disabled} />
                </Group>
                <Group note={systemNote}>
                  <Sel
                    label="System"
                    value={spec.systemId}
                    options={[...lists.systems.filter((x) => x.family === spec.systemFamily || x.id === spec.systemId), { id: CUSTOM_SYSTEM, label: lowSlope ? "＋ Custom flat system…" : "＋ Custom roof type…" }]}
                    onChange={(id) => (id === CUSTOM_SYSTEM ? addSystem() : pickSystem(id))}
                    disabled={disabled}
                    wide
                  />
                  <Sel label="Waste" value={String(spec.wastePct)} options={WASTE_OPTIONS.map((w) => ({ id: String(w), label: `${w}%` }))} onChange={(v) => set("wastePct", Number(v))} disabled={disabled} short />
                </Group>
              </>
            )}
          </Section>

          {!lowSlope ? (
            <>
              {/* UNDERLAYMENT */}
              <Section
                id="under"
                title="Underlayment"
                summary={sumUnder}
                open={!!open.under}
                onToggle={() => toggle("under")}
                rates={
                  manage === "underlayments" ? undefined : (
                    <>
                      <Rate label="Underlayment" unit="$/sq" value={spec.underlaymentPerSq} onChange={(v) => set("underlaymentPerSq", v)} disabled={disabled} />
                      {spec.iceWater !== "none" && <Rate label="Ice & water" unit="$/sq ft" value={spec.iceWaterPerSqft} onChange={(v) => set("iceWaterPerSqft", v)} disabled={disabled} />}
                    </>
                  )
                }
              >
                {manage === "underlayments" ? (
                  <div className="rbd-g">
                    <h4 className="rbd-g-h">Your underlayments</h4>
                    <div className="rbd-tbl">
                      <div className="rbd-tr rbd-tr--und rbd-th" aria-hidden="true">
                        <span>Underlayment</span><span>Rate</span><span />
                      </div>
                      {lists.underlayments.map((u) => (
                        <div className="rbd-tr rbd-tr--und" key={u.id}>
                          <label className="rbd-f rbd-tn">
                            <span className="rbd-lbl">Underlayment</span>
                            <input className="rbd-in" value={u.label} disabled={disabled} aria-label="Underlayment name" onChange={(e) => patchUnderlayment(u.id, { label: e.target.value })} />
                          </label>
                          <Num label="Rate" aria="Underlayment $/sq" unit="$/sq" value={u.perSq} onChange={(n) => patchUnderlayment(u.id, { perSq: n })} disabled={disabled} />
                          <button type="button" className="rbd-x" disabled={disabled || lists.underlayments.length <= 1} aria-label={`Remove ${u.label}`} title="Remove" onClick={() => removeUnderlayment(u.id)}>
                            <IcX />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="rbd-add">
                      <button type="button" className="rbd-btn rbd-btn--ghost rbd-btn--sm" disabled={disabled} onClick={addUnderlayment}>
                        <IcPlus />
                        Underlayment
                      </button>
                      <button type="button" className="rbd-btn rbd-btn--ink rbd-btn--sm rbd-add-done" onClick={() => setManage(null)}>
                        Done
                      </button>
                    </div>
                  </div>
                ) : (
                  <Group
                    note={
                      <div className="rbd-g-foot">
                        <a className="rbd-text-btn" href="/dashboard/roof-estimator/inventory#book">
                          Manage underlayments
                        </a>
                      </div>
                    }
                  >
                    <Sel label="Underlayment" value={spec.underlaymentId} options={lists.underlayments} onChange={(id) => pickUnderlayment(id)} disabled={disabled} wide />
                    <Sel label="Ice & water" value={spec.iceWater} options={ICE_WATER} onChange={(v) => set("iceWater", v as IceWaterCoverage)} disabled={disabled} wide />
                  </Group>
                )}
              </Section>

              {/* EDGES */}
              <Section
                id="edges"
                title="Edges"
                summary={sumEdges}
                chip={<Stamp tone={edgeMeasured ? "ok" : edgeEstimated ? "warn" : undefined}>{edgeMeasured ? "measured" : edgeEstimated ? "estimated" : "entered"}</Stamp>}
                open={!!open.edges}
                onToggle={() => toggle("edges")}
              >
                <Group label="Lengths">
                  <Num label="Eave" unit="ft" value={spec.eaveFt} onChange={(v) => setEdge("eaveFt", v)} disabled={disabled} />
                  <Num label="Rake" unit="ft" value={spec.rakeFt} onChange={(v) => setEdge("rakeFt", v)} disabled={disabled} />
                  <Num label="Ridge" unit="ft" value={spec.ridgeFt} onChange={(v) => setEdge("ridgeFt", v)} disabled={disabled} />
                  <Num label="Hip" unit="ft" value={spec.hipFt} onChange={(v) => setEdge("hipFt", v)} disabled={disabled} />
                </Group>
                <div className="rbd-g">
                  <h4 className="rbd-g-h">Edge metal & trim</h4>
                  <div className="rbd-opts">
                    <div className="rbd-opt">
                      <Check label="Drip edge" checked={spec.dripEdgeOn} onChange={(v) => set("dripEdgeOn", v)} disabled={disabled} />
                      {spec.dripEdgeOn && (
                        <div className="rbd-fields">
                          <Sel label="Profile" value={spec.dripProfileId} options={DRIP_EDGE_PROFILES} onChange={pickDrip} disabled={disabled} />
                          <Sel label="Size" value={spec.dripSizeId} options={DRIP_EDGE_SIZES} onChange={(v) => set("dripSizeId", v)} disabled={disabled} short />
                          <Num label="Rate" aria="Drip edge rate" unit="$/ft" value={spec.dripPerFt} onChange={(v) => set("dripPerFt", v)} disabled={disabled} />
                        </div>
                      )}
                    </div>
                    {!noStarter && (
                      <div className="rbd-opt">
                        <Check label="Starter strip" checked={spec.starterOn} onChange={(v) => set("starterOn", v)} disabled={disabled} />
                        {spec.starterOn && (
                          <div className="rbd-fields">
                            <Num label="Rate" aria="Starter rate" unit="$/ft" value={spec.starterPerFt} onChange={(v) => set("starterPerFt", v)} disabled={disabled} />
                          </div>
                        )}
                      </div>
                    )}
                    {/* FASCIA (owner, 2026-09-19) — the board the gutter hangs on,
                        open only while the roof is off, so a tear-off opens with it
                        in. The gutters have to come down either way, which is what
                        the gutter controls are about. */}
                    <div className="rbd-opt">
                      <Check label="Replace fascia" checked={spec.fasciaOn} onChange={(v) => set("fasciaOn", v)} disabled={disabled} />
                      {spec.fasciaOn && (
                        <div className="rbd-opt-rows">
                          <div className="rbd-fields">
                            <Sel label="Board" value={spec.fasciaOptionId} options={FASCIA_OPTIONS} onChange={pickFascia} disabled={disabled} wide />
                            <Sel label="Runs" value={spec.fasciaRun} options={FASCIA_RUNS} onChange={(v) => set("fasciaRun", v as FasciaRun)} disabled={disabled} />
                            {spec.fasciaRun === "custom" && (
                              <Num label="Length" aria="Fascia length" unit="ft" value={spec.fasciaFt} onChange={(v) => set("fasciaFt", v)} disabled={disabled} />
                            )}
                          </div>
                          <div className="rbd-fields">
                            <Num label="Board rate" aria="Fascia rate" unit="$/ft" value={spec.fasciaPerFt} onChange={(v) => set("fasciaPerFt", v)} disabled={disabled} />
                            <Num label="Labor rate" aria="Fascia labor rate" unit="$/ft" value={spec.fasciaLaborPerFt} onChange={(v) => set("fasciaLaborPerFt", v)} disabled={disabled} />
                          </div>
                          <div className="rbd-fields">
                            <Sel label="Gutters" value={spec.gutterPlan} options={GUTTER_PLANS} onChange={(v) => set("gutterPlan", v as GutterPlan)} disabled={disabled} wide />
                            {spec.gutterPlan !== "none" && (
                              <>
                                <Num
                                  label="Gutter length"
                                  aria="Gutter length"
                                  unit="ft"
                                  value={spec.gutterFt > 0 ? spec.gutterFt : Math.round(gutterFeet(spec))}
                                  onChange={(v) => set("gutterFt", v)}
                                  disabled={disabled}
                                />
                                <Num
                                  label={spec.gutterPlan === "replace" ? "New gutter rate" : "Reset rate"}
                                  aria="Gutter rate"
                                  unit="$/ft"
                                  value={spec.gutterPlan === "replace" ? spec.gutterPerFt : spec.gutterResetPerFt}
                                  onChange={(v) => set(spec.gutterPlan === "replace" ? "gutterPerFt" : "gutterResetPerFt", v)}
                                  disabled={disabled}
                                />
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  {spec.fasciaOn && fasciaFeet(spec) <= 0 && (
                    <p className="rbd-note is-diff">Fascia is on, but there is no length to price it — enter the eave, or set the run to a figure of your own.</p>
                  )}
                  {!spec.fasciaOn && spec.tearOffLayers > 0 && (
                    <p className="rbd-note">The fascia stays. It is only reachable while the roof is off, so it is worth a look before the tear-off.</p>
                  )}
                </div>
                <details className="rbd-details">
                  <summary>Measurement source & report</summary>
                  <div className="rbd-details-b">
                    {edgeMeasured ? (
                      <p className="rbd-note">Lengths from aerial report{report?.reportId ? ` #${report.reportId}` : ""}.</p>
                    ) : edgeEstimated ? (
                      <p className="rbd-note">Estimated from the building outline. Check lengths against the roof.</p>
                    ) : estimateEdges(facts) ? (
                      <div className="rbd-g-foot">
                        <TextBtn onClick={resetEdges} disabled={disabled}>
                          Reset to outline estimate
                        </TextBtn>
                      </div>
                    ) : (
                      <p className="rbd-note">Lengths entered for this roof.</p>
                    )}
                    {report && report.state === "none" && !edgeMeasured && (
                      <div className="rbd-offer">
                        <button type="button" className="rbd-btn rbd-btn--ghost rbd-btn--sm" onClick={report.onOrder} disabled={disabled || report.busy} aria-busy={report.busy || undefined}>
                          {report.busy ? "Pricing…" : "Order measurement report"}
                        </button>
                        <span className="rbd-note">Paid report · usually within 48 hours · lengths update automatically.</span>
                      </div>
                    )}
                    {report && report.state === "pending" && (
                      <div className="rbd-offer">
                        <span className="rbd-note">
                          Report #{report.reportId} · {report.status ?? "in process"}
                        </span>
                        <button type="button" className="rbd-btn rbd-btn--ghost rbd-btn--sm" onClick={report.onCheck} disabled={disabled || report.busy} aria-busy={report.busy || undefined}>
                          {report.busy ? "Checking…" : "Check report status"}
                        </button>
                      </div>
                    )}
                  </div>
                </details>
              </Section>

              {/* FLASHING */}
              <Section
                id="flash"
                title="Flashing"
                summary={sumFlash}
                open={!!open.flash}
                onToggle={() => toggle("flash")}
                rates={
                  <>
                    <Rate label="Valley metal" unit="$/ft" value={spec.valleyMatPerFt} onChange={(v) => set("valleyMatPerFt", v)} disabled={disabled} />
                    <Rate label="Valley labor" unit="$/ft" value={spec.valleyLaborPerFt} onChange={(v) => set("valleyLaborPerFt", v)} disabled={disabled} />
                    <Rate label="Step piece" unit="$/ea" value={spec.stepPerPiece} onChange={(v) => set("stepPerPiece", v)} disabled={disabled} />
                    <Rate label="Step labor" unit="$/ft" value={spec.stepLaborPerFt} onChange={(v) => set("stepLaborPerFt", v)} disabled={disabled} />
                    <Rate label="Apron" unit="$/ft" value={spec.apronPerFt} onChange={(v) => set("apronPerFt", v)} disabled={disabled} />
                    <Rate label="Apron labor" unit="$/ft" value={spec.apronLaborPerFt} onChange={(v) => set("apronLaborPerFt", v)} disabled={disabled} />
                    <Rate label="Counter" unit="$/ft" value={spec.counterPerFt} onChange={(v) => set("counterPerFt", v)} disabled={disabled} />
                    <Rate label="Counter labor" unit="$/ft" value={spec.counterLaborPerFt} onChange={(v) => set("counterLaborPerFt", v)} disabled={disabled} />
                    <Rate label="Chimney kit" unit="$/ea" value={spec.chimneyEach} onChange={(v) => set("chimneyEach", v)} disabled={disabled} />
                    <Rate label="Chimney labor" unit="$/ea" value={spec.chimneyLabor} onChange={(v) => set("chimneyLabor", v)} disabled={disabled} />
                    <Rate label="Curb kit" unit="$/ea" value={spec.curbEach} onChange={(v) => set("curbEach", v)} disabled={disabled} />
                    <Rate label="Curb labor" unit="$/ea" value={spec.curbLabor} onChange={(v) => set("curbLabor", v)} disabled={disabled} />
                  </>
                }
              >
                <Group label="Valleys">
                  <Num label="Count" unit="each" value={spec.valleyCount} onChange={(v) => setValleyField("valleyCount", v)} disabled={disabled} />
                  <Num label="Length each" unit="ft" value={spec.valleyFtEach} onChange={(v) => setValleyField("valleyFtEach", v)} disabled={disabled} />
                  <Sel label="Type" value={spec.valleyTypeId} options={VALLEY_TYPES} onChange={pickValley} disabled={disabled} wide />
                </Group>
                <Group label="Sidewalls · step flashing">
                  <Num label="Walls" unit="each" value={spec.stepWallCount} onChange={(v) => setStepField("stepWallCount", v)} disabled={disabled} />
                  <Num label="Length each" unit="ft" value={spec.stepWallFtEach} onChange={(v) => setStepField("stepWallFtEach", v)} disabled={disabled} />
                  <Sel label="Step size" value={spec.stepSizeId} options={STEP_FLASHING_SIZES} onChange={pickStep} disabled={disabled} wide />
                </Group>
                <Group label="Apron & counter">
                  <Num label="Apron / headwall" unit="ft" value={spec.apronFt} onChange={(v) => set("apronFt", v)} disabled={disabled} />
                  <Num label="Counter flashing" unit="ft" value={spec.counterFt} onChange={(v) => set("counterFt", v)} disabled={disabled} />
                </Group>
                <Group label="Pipe boots">
                  {PIPE_BOOT_SIZES.map((s) => (
                    <Num key={s.id} label={s.label} unit="each" value={spec.pipeBoots[s.id] ?? 0} onChange={(v) => set("pipeBoots", { ...spec.pipeBoots, [s.id]: v })} disabled={disabled} />
                  ))}
                </Group>
                <Group label="Chimneys & curbs">
                  <Num label="Chimneys" unit="each" value={spec.chimneyCount} onChange={(v) => set("chimneyCount", v)} disabled={disabled} />
                  <Sel label="Chimney size" value={spec.chimneySizeId} options={CHIMNEY_SIZES} onChange={pickChimney} disabled={disabled} wide />
                  <Num label="Curbs" unit="each" value={spec.curbCount} onChange={(v) => set("curbCount", v)} disabled={disabled} />
                </Group>
              </Section>

              {/* VENTS */}
              <Section
                id="vents"
                title="Vents"
                summary={sumVents}
                chip={vent ? <Stamp tone={vent.ok ? "ok" : "bad"}>{vent.ok ? "balanced" : "short"}</Stamp> : undefined}
                open={!!open.vents}
                onToggle={() => toggle("vents")}
              >
                {vent ? (
                  /* The attic check as four figures, label over value. */
                  <div className="rbd-figs" role="group" aria-label="Attic ventilation check">
                    <div className="rbd-fig">
                      <span className="rbd-fig-l">Attic</span>
                      <span className="rbd-fig-v">
                        {fmt(facts.footprintSqft ?? 0)}
                        <small>sq ft</small>
                      </span>
                    </div>
                    <div className="rbd-fig">
                      <span className="rbd-fig-l">Needs</span>
                      <span className="rbd-fig-v">
                        {fmt(vent.requiredSqIn)}
                        <small>sq in net free area</small>
                      </span>
                    </div>
                    <div className="rbd-fig">
                      <span className="rbd-fig-l">Exhaust</span>
                      <span className="rbd-fig-v">
                        {fmt(vent.exhaustSqIn)}
                        <small>sq in{vent.poweredExhaust ? ` + ${vent.poweredExhaust} powered` : ""}</small>
                      </span>
                    </div>
                    <div className="rbd-fig">
                      <span className="rbd-fig-l">Intake</span>
                      <span className="rbd-fig-v">
                        {fmt(vent.intakeSqIn)}
                        <small>sq in</small>
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="rbd-note">No footprint on this measurement, so the attic check is off — add what the roof needs.</p>
                )}
                {ventsOn.length > 0 && (
                  <div className="rbd-g">
                    <h4 className="rbd-g-h">On this roof</h4>
                    <div className="rbd-tbl">
                      <div className="rbd-tr rbd-tr--vent rbd-th" aria-hidden="true">
                        <span>Vent</span><span>Qty</span><span>Material rate</span><span>Labor rate</span><span className="rbd-th-r">Total</span><span />
                      </div>
                      {ventsOn.map((t) => {
                        const v = ventOf(t.id);
                        const each = t.unit === "each";
                        return (
                          <div className="rbd-tr rbd-tr--vent" key={t.id}>
                            <span className="rbd-vname rbd-tn">
                              {t.label}
                              <em>{t.role}{t.nfaSqIn ? ` · ${t.nfaSqIn} sq in${each ? "" : "/ft"}` : " · powered"}</em>
                            </span>
                            <Num label="Qty" aria={`${t.label} quantity`} unit={each ? "each" : "ft"} value={v.qty} onChange={(n) => setVent(t.id, { qty: n })} disabled={disabled} />
                            <Num label="Material rate" aria={`${t.label} material`} unit={each ? "$/ea" : "$/ft"} value={v.each} onChange={(n) => setVent(t.id, { each: n })} disabled={disabled} />
                            <Num label="Labor rate" aria={`${t.label} labor`} unit={each ? "$/ea" : "$/ft"} value={v.labor} onChange={(n) => setVent(t.id, { labor: n })} disabled={disabled} />
                            <span className="rbd-vent-total">
                              <span>Total</span>
                              {money(v.qty * (v.each + v.labor))}
                            </span>
                            <button type="button" className="rbd-x" disabled={disabled} aria-label={`Remove ${t.label}`} title="Remove" onClick={() => setVent(t.id, { qty: 0 })}>
                              <IcX />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="rbd-add rbd-add--vents">
                  <Check label="Balanced system · 1/300 rule" checked={spec.ventBalanced} onChange={(v) => set("ventBalanced", v)} disabled={disabled} />
                  {ventsToAdd.length > 0 && (
                    <div className="rbd-f rbd-f--add">
                      <BlueprintSelect
                        value=""
                        onChange={(id) => {
                          if (id) setVent(id, { qty: 1 });
                        }}
                        options={ventsToAdd.map((t) => ({ value: t.id, label: t.label }))}
                        placeholder="+ Add vent…"
                        ariaLabel="Add a vent"
                        disabled={disabled}
                        styles={SEL_STYLES}
                      />
                    </div>
                  )}
                </div>
              </Section>

              {/* TEAR-OFF & EXTRAS */}
              <Section
                id="tear"
                title="Tear-off & extras"
                summary={sumTear}
                open={!!open.tear}
                onToggle={() => toggle("tear")}
                rates={
                  <>
                    <Rate label="Tear-off labor" unit="$/sq·layer" value={spec.tearOffPerSqLayer} onChange={(v) => set("tearOffPerSqLayer", v)} disabled={disabled} />
                    <Rate label="Disposal" unit="$/sq·layer" value={spec.disposalPerSqLayer} onChange={(v) => set("disposalPerSqLayer", v)} disabled={disabled} />
                    <Rate label="Plywood sheet" unit="$/sheet" value={spec.plywoodEach} onChange={(v) => set("plywoodEach", v)} disabled={disabled} />
                    <Rate label="Plywood fitting" unit="$/sheet" value={spec.plywoodLabor} onChange={(v) => set("plywoodLabor", v)} disabled={disabled} />
                    <Rate label="Nails & fasteners" unit="$/sq" value={spec.nailsPerSq} onChange={(v) => set("nailsPerSq", v)} disabled={disabled} />
                    <Rate label="Sealant & collars" unit="$/sq" value={spec.sealantPerSq} onChange={(v) => set("sealantPerSq", v)} disabled={disabled} />
                  </>
                }
              >
                <Group
                  note={
                    steepest < 8 ? (
                      <p className="rbd-note">Steep safety applies from 8/12 — this roof is {steepest > 0 ? `${steepest}/12` : "flatter"}, so it stays off.</p>
                    ) : null
                  }
                >
                  <Sel
                    label="Tear-off"
                    value={String(spec.tearOffLayers)}
                    options={[
                      { id: "0", label: "None · overlay" },
                      { id: "1", label: "1 layer" },
                      { id: "2", label: "2 layers" },
                      { id: "3", label: "3 layers" },
                    ]}
                    onChange={(v) => set("tearOffLayers", Number(v) as 0 | 1 | 2 | 3)}
                    disabled={disabled}
                  />
                  <Num label="Cleanup" unit="$" value={spec.cleanupLump} onChange={(v) => set("cleanupLump", v)} disabled={disabled} />
                  <Num label="Steep safety" unit="$" value={spec.safetyLump} onChange={(v) => set("safetyLump", v)} disabled={disabled} />
                  {!spec.commercial.on && <Num label="Permit" unit="$" value={spec.permitLump} onChange={(v) => set("permitLump", v)} disabled={disabled} />}
                  <Num label="Delivery" unit="$" value={spec.deliveryLump ?? 0} onChange={(v) => set("deliveryLump", v)} disabled={disabled} />
                  <PlywoodBlock spec={spec} set={set} disabled={disabled} deckExposed={spec.tearOffLayers > 0} />
                </Group>
              </Section>
            </>
          ) : (
            <>
              {/* INSULATION & COVER BOARD — or the prep a coating needs */}
              <Section
                id="boards"
                title={surface ? "Surface prep" : "Insulation"}
                summary={sumBoards}
                open={!!open.boards}
                onToggle={() => toggle("boards")}
                rates={
                  surface ? (
                    <>{flatRates(["washMat", "washLabor", "repairMat", "repairLabor", F.primerOn && "primerCoatMat", F.primerOn && "primerCoatLabor", "wetIns", "coreEach"])}</>
                  ) : (
                    <>
                      {boards && F.insulationId !== "none" && (
                        <>
                          <Rate label="Insulation" unit="$/sq" value={F.insulationMatPerSq} onChange={(v) => setFlat("insulationMatPerSq", v)} disabled={disabled} />
                          <Rate label="Insulation labor" unit="$/sq" value={F.insulationLaborPerSq} onChange={(v) => setFlat("insulationLaborPerSq", v)} disabled={disabled} />
                        </>
                      )}
                      {boards && F.coverBoardId !== "none" && (
                        <>
                          <Rate label="Cover board" unit="$/sq" value={F.coverBoardMatPerSq} onChange={(v) => setFlat("coverBoardMatPerSq", v)} disabled={disabled} />
                          <Rate label="Cover labor" unit="$/sq" value={F.coverBoardLaborPerSq} onChange={(v) => setFlat("coverBoardLaborPerSq", v)} disabled={disabled} />
                        </>
                      )}
                      {flatRates([
                        ...attachRates,
                        ...(rule?.method === "overburden" ? (["waterproofMat", "waterproofLabor"] as const) : []),
                        boards && (F.insulationId !== "none" || F.coverBoardId !== "none") && rule?.method !== "ballasted" && rule?.method !== "overburden" && rule?.method !== "induction" && "insFasteners",
                        boards && F.taperedSqft > 0 && "taperedMat",
                        boards && F.taperedSqft > 0 && "taperedLabor",
                        F.wetInsulationSqft > 0 && "wetIns",
                      ])}
                    </>
                  )
                }
              >
                {surface ? (
                  <Group note={<p className="rbd-note">Goes over the existing roof — no tear-off, insulation or new edge metal. Core cuts confirm the roof underneath is dry; wet areas are cut out and replaced first.</p>}>
                    <Check label="Primer" checked={F.primerOn} onChange={(v) => setFlat("primerOn", v)} disabled={disabled} />
                    <Num label="Wet insulation" unit="sq ft" value={F.wetInsulationSqft} onChange={(v) => setFlat("wetInsulationSqft", v)} disabled={disabled} />
                    <Num label="Core cuts" unit="each" value={F.coreCuts} onChange={(v) => setFlat("coreCuts", v)} disabled={disabled} />
                  </Group>
                ) : boards ? (
                  <>
                    <Group
                      note={
                        spec.commercial.on && F.insulationId === "none" ? (
                          <p className="rbd-note is-diff">A tear-off to the deck on a commercial building usually has to meet the energy code — about R-25 to R-30 of insulation.</p>
                        ) : null
                      }
                    >
                      <Sel label="Insulation" value={F.insulationId} options={INSULATION_OPTIONS} onChange={(v) => pickBoard("insulation", v)} disabled={disabled} wide />
                      <Sel label="Cover board" value={F.coverBoardId} options={COVER_BOARDS} onChange={(v) => pickBoard("cover", v)} disabled={disabled} wide />
                      <Num label="Tapered & crickets" unit="sq ft" value={F.taperedSqft} onChange={(v) => setFlat("taperedSqft", v)} disabled={disabled} />
                    </Group>
                    <Group label="Wet areas">
                      <Num label="Wet insulation" unit="sq ft" value={F.wetInsulationSqft} onChange={(v) => setFlat("wetInsulationSqft", v)} disabled={disabled} />
                    </Group>
                  </>
                ) : (
                  <Group note={<p className="rbd-note">{rule?.method === "nailed" ? "Rolled roofing is nailed to the deck" : "A liquid-applied membrane goes on the prepared deck"} — no insulation or cover board.</p>}>
                    <Num label="Wet insulation" unit="sq ft" value={F.wetInsulationSqft} onChange={(v) => setFlat("wetInsulationSqft", v)} disabled={disabled} />
                  </Group>
                )}
              </Section>

              {/* EDGES & WALLS */}
              <Section
                id="walls"
                title="Edges & walls"
                summary={sumWalls}
                chip={splitOff ? <Stamp tone="bad">check split</Stamp> : undefined}
                open={!!open.walls}
                onToggle={() => toggle("walls")}
                rates={
                  surface ? (
                    <>{flatRates(["warningLine"])}</>
                  ) : (
                    <>{flatRates(["edgeMat", "edgeLabor", "copingMat", "copingLabor", "baseFlashMat", "baseFlashLabor", F.wallFt > 0 && "termBarMat", F.wallFt > 0 && "termBarLabor", F.wallFt > 0 && "counterMat", F.wallFt > 0 && "counterLabor", boards && F.nailersOn && "nailerMat", boards && F.nailersOn && "nailerLabor", "warningLine"])}</>
                  )
                }
              >
                <Group
                  note={
                    <p className="rbd-note">
                      {perimeterFt > 0 ? `Outline perimeter ${fmt(perimeterFt)} ft — parapet plus open edge should add up to it. ` : "No outline perimeter — enter the lengths from the photo. "}
                      {surface ? "A coating keeps the existing edge metal and coping; these lengths still size the fall protection." : "Coping caps the parapets; ES-1 edge metal finishes the open edges; wall flashing is wherever the roof meets a taller wall."}
                    </p>
                  }
                >
                  <Num label="Perimeter" unit="ft" value={perimeterFt} onChange={(v) => setSpec((prev) => ({ ...prev, eaveFt: v, rakeFt: 0, edgesBasis: "entered" }))} disabled={disabled} />
                  <Num label="Parapet" unit="ft" value={F.parapetFt} onChange={(v) => setFlat("parapetFt", v)} disabled={disabled} />
                  <Num label="Parapet height" unit="in" value={F.parapetHeightIn} onChange={(v) => setFlat("parapetHeightIn", v)} disabled={disabled} />
                  <Num label="Open edge" unit="ft" value={F.edgeMetalFt} onChange={(v) => setFlat("edgeMetalFt", v)} disabled={disabled} />
                  {!surface && <Num label="Wall flashing" unit="ft" value={F.wallFt} onChange={(v) => setFlat("wallFt", v)} disabled={disabled} />}
                  {boards && !surface && <Check label="Wood nailers to insulation height" checked={F.nailersOn} onChange={(v) => setFlat("nailersOn", v)} disabled={disabled} />}
                </Group>
              </Section>

              {/* DRAINS & PENETRATIONS */}
              <Section
                id="drains"
                title="Drains & curbs"
                summary={sumDrains}
                open={!!open.drains}
                onToggle={() => toggle("drains")}
                rates={
                  <>
                    {flatRates([
                      !surface && F.drains > 0 && (F.drainWork === "new" ? "drainNewMat" : F.drainWork === "ring" ? "drainRingMat" : "drainInsertMat"),
                      !surface && F.drains > 0 && (F.drainWork === "new" ? "drainNewLabor" : F.drainWork === "ring" ? "drainRingLabor" : "drainInsertLabor"),
                      !surface && F.drains > 0 && F.secondary === "scupper" && "overflowScupperMat",
                      !surface && F.drains > 0 && F.secondary === "scupper" && "overflowScupperLabor",
                      !surface && F.drains > 0 && F.secondary === "drain" && "overflowDrainMat",
                      !surface && F.drains > 0 && F.secondary === "drain" && "overflowDrainLabor",
                      F.scuppers > 0 && "scupperMat",
                      F.scuppers > 0 && "scupperLabor",
                      F.gutterFt > 0 && "gutterMat",
                      F.gutterFt > 0 && "gutterLabor",
                      "bootMat",
                      "bootLabor",
                      F.pitchPockets > 0 && "pocketMat",
                      F.pitchPockets > 0 && "pocketLabor",
                      !surface && F.rtuCount > 0 && "rtuMat",
                      !surface && F.rtuCount > 0 && "rtuLabor",
                      F.rtuResetCount > 0 && "rtuReset",
                      !surface && F.curbs > 0 && "curbMat",
                      !surface && F.curbs > 0 && "curbLabor",
                    ])}
                  </>
                }
              >
                {!surface && (
                  <Group label="Drains">
                    <Num label="Roof drains" unit="each" value={F.drains} onChange={(v) => setFlat("drains", Math.round(v))} disabled={disabled} />
                    <Sel label="Drain work" value={F.drainWork} options={DRAIN_WORK} onChange={(v) => setFlat("drainWork", v as DrainWork)} disabled={disabled} wide />
                    <Sel label="Overflow" value={F.secondary} options={SECONDARY_DRAINAGE} onChange={(v) => setFlat("secondary", v as SecondaryDrainage)} disabled={disabled} />
                  </Group>
                )}
                <Group label="Scuppers & gutters">
                  <Num label="Thru-wall scuppers" unit="each" value={F.scuppers} onChange={(v) => setFlat("scuppers", Math.round(v))} disabled={disabled} />
                  <Num label="Gutter" unit="ft" value={F.gutterFt} onChange={(v) => setFlat("gutterFt", v)} disabled={disabled} />
                </Group>
                <Group
                  label="Penetrations & curbs"
                  note={surface ? <p className="rbd-note">A coating details drains and curbs with fabric and coating — no new drains or curb flashing are priced.</p> : null}
                >
                  <Num label="Pipe boots" unit="each" value={F.pipeBoots} onChange={(v) => setFlat("pipeBoots", Math.round(v))} disabled={disabled} />
                  <Num label="Pitch pockets" unit="each" value={F.pitchPockets} onChange={(v) => setFlat("pitchPockets", Math.round(v))} disabled={disabled} />
                  {!surface && <Num label="Rooftop units" unit="each" value={F.rtuCount} onChange={(v) => setFlat("rtuCount", Math.round(v))} disabled={disabled} />}
                  <Num label="Units raised & reset" unit="each" value={F.rtuResetCount} onChange={(v) => setFlat("rtuResetCount", Math.round(v))} disabled={disabled} />
                  {!surface && <Num label="Skylights, hatches, curbs" unit="each" value={F.curbs} onChange={(v) => setFlat("curbs", Math.round(v))} disabled={disabled} />}
                </Group>
              </Section>

              {/* ROOFTOP, ACCESS & WARRANTY */}
              <Section
                id="rooftop"
                title="Access & warranty"
                summary={sumRooftop}
                open={!!open.rooftop}
                onToggle={() => toggle("rooftop")}
                rates={
                  <>
                    {flatRates([
                      F.walkwayFt > 0 && "walkwayMat",
                      F.walkwayFt > 0 && "walkwayLabor",
                      F.craneHours > 0 && "craneRate",
                      F.craneHours > 0 && "craneMob",
                      F.craneHours <= 0 && F.hoistOn && "hoist",
                      !surface && F.coreCuts > 0 && "coreEach",
                      rule?.method === "torch" && "fireWatch",
                      rule?.method === "hot" && "kettle",
                      !surface && spec.tearOffLayers > 0 && "nightSeal",
                    ])}
                    {F.warrantyId !== "none" && (
                      <>
                        <Rate label="Warranty fee" unit="$/sq" value={F.warrantyPerSq} onChange={(v) => setFlat("warrantyPerSq", v)} disabled={disabled} />
                        {flatRates(["warrantyInspection"])}
                      </>
                    )}
                  </>
                }
              >
                <Group label="Access">
                  <Num label="Walkway pads" unit="ft" value={F.walkwayFt} onChange={(v) => setFlat("walkwayFt", v)} disabled={disabled} />
                  <Num label="Crane" unit="hours" value={F.craneHours} onChange={(v) => setFlat("craneHours", v)} disabled={disabled} />
                  {F.craneHours <= 0 && <Check label="Ladder hoist / conveyor" checked={F.hoistOn} onChange={(v) => setFlat("hoistOn", v)} disabled={disabled} />}
                  {!surface && <Num label="Core cuts" unit="each" value={F.coreCuts} onChange={(v) => setFlat("coreCuts", Math.round(v))} disabled={disabled} />}
                </Group>
                <Group label="Warranty & pace">
                  <Sel label="Warranty" value={F.warrantyId} options={WARRANTIES} onChange={pickWarranty} disabled={disabled} wide />
                  <Num label="Squares per day" unit="sq" value={F.productionSqPerDay} onChange={(v) => setFlat("productionSqPerDay", Math.max(1, v))} disabled={disabled} />
                </Group>
              </Section>

              {/* TEAR-OFF & EXTRAS */}
              <Section
                id="flatTear"
                title="Tear-off & extras"
                summary={sumFlatTear}
                open={!!open.flatTear}
                onToggle={() => toggle("flatTear")}
                rates={
                  <>
                    {!surface && spec.tearOffLayers > 0 && (
                      <>
                        <Rate label="Tear-off labor" unit="$/sq·layer" value={spec.tearOffPerSqLayer} onChange={(v) => set("tearOffPerSqLayer", v)} disabled={disabled} />
                        <Rate label="Disposal" unit="$/sq·layer" value={spec.disposalPerSqLayer} onChange={(v) => set("disposalPerSqLayer", v)} disabled={disabled} />
                        {F.existing === "bur_gravel" && flatRates(["gravelVac"])}
                      </>
                    )}
                    <Rate label="Plywood sheet" unit="$/sheet" value={spec.plywoodEach} onChange={(v) => set("plywoodEach", v)} disabled={disabled} />
                    <Rate label="Plywood fitting" unit="$/sheet" value={spec.plywoodLabor} onChange={(v) => set("plywoodLabor", v)} disabled={disabled} />
                  </>
                }
              >
                <Group note={spec.commercial.on ? <p className="rbd-note">The permit is priced on the job value under Commercial job.</p> : null}>
                  {!surface && (
                    <>
                      <Sel label="Existing roof" value={F.existing} options={EXISTING_LOW_SLOPE} onChange={(v) => pickExisting(v as ExistingLowSlope)} disabled={disabled} wide />
                      <Sel
                        label="Layers"
                        value={String(spec.tearOffLayers)}
                        options={[
                          { id: "0", label: "Recover (none)" },
                          { id: "1", label: "1 layer" },
                          { id: "2", label: "2 layers" },
                          { id: "3", label: "3 layers" },
                        ]}
                        onChange={(v) => set("tearOffLayers", Number(v) as 0 | 1 | 2 | 3)}
                        disabled={disabled}
                      />
                    </>
                  )}
                  <Num label="Cleanup" unit="$" value={spec.cleanupLump} onChange={(v) => set("cleanupLump", v)} disabled={disabled} />
                  {!spec.commercial.on && <Num label="Permit" unit="$" value={spec.permitLump} onChange={(v) => set("permitLump", v)} disabled={disabled} />}
                  {!surface ? <PlywoodBlock spec={spec} set={set} disabled={disabled} deckExposed={spec.tearOffLayers > 0} /> : null}
                </Group>
              </Section>
            </>
          )}

          {/* COMMERCIAL JOB — either kind of roof */}
          <Section
            id="commercial"
            title="Commercial job"
            summary={sumCommercial}
            chip={C.on ? <Stamp>commercial</Stamp> : undefined}
            open={!!open.commercial}
            onToggle={() => toggle("commercial")}
            rates={
              C.on ? (
                <>
                  {commercialRates([
                    "gcPct",
                    "insurancePct",
                    facts.squares < 30 ? "mobSmall" : "mob",
                    "safetyPlan",
                    "asbestos",
                    "superRate",
                    ...(C.occupied ? (["interior"] as const) : []),
                    ...(C.shift === "night" ? (["lightTower"] as const) : []),
                    ...(C.wage === "prevailing" ? (["payroll"] as const) : []),
                    "permitBase",
                    "permitPct",
                    "permitMin",
                  ])}
                </>
              ) : undefined
            }
          >
            <Group
              note={
                <p className="rbd-note">
                  {C.on
                    ? `${prod < 1 ? `Field install labor ×${prod} at ${fmt(facts.squares)} squares — a big deck goes down faster per square. ` : ""}Adds mobilization, a safety plan${spec.tearOffLayers > 0 ? ", the asbestos survey before tear-off" : ""}${facts.squares >= 50 ? ", a superintendent" : ""}, a permit on the job value, and general conditions & insurance on everything except the at-cost fees.`
                    : "Priced as residential. Turn this on for a store, warehouse, school or apartment building."}
                </p>
              }
            >
              <Check label="Price as a commercial job" checked={C.on} onChange={toggleCommercial} disabled={disabled} />
              {C.on && (
                <>
                  <Sel label="Labor" value={C.wage} options={WAGE_REGIMES} onChange={(v) => setCommercial("wage", v as WageRegime)} disabled={disabled} />
                  <Sel label="Schedule" value={C.shift} options={SHIFTS} onChange={(v) => setCommercial("shift", v as Shift)} disabled={disabled} wide />
                  <Num label="Stories" unit="floors" value={C.stories} onChange={(v) => setCommercial("stories", Math.max(1, Math.round(v)))} disabled={disabled} />
                  <Check label="Occupied during work" checked={C.occupied} onChange={(v) => setCommercial("occupied", v)} disabled={disabled} />
                  <Check label="Payment & performance bond" checked={C.bondOn} onChange={(v) => setCommercial("bondOn", v)} disabled={disabled} />
                </>
              )}
            </Group>
          </Section>

          {/* CUSTOM LINES */}
          <Section id="custom" title="Custom lines" summary={sumCustom} open={!!open.custom} onToggle={() => toggle("custom")}>
            {spec.custom.length > 0 && (
              <div className="rbd-tbl">
                <div className="rbd-tr rbd-tr--custom rbd-th" aria-hidden="true">
                  <span>Item</span><span>Qty</span><span>Unit</span><span>Price</span><span>Material or labor</span><span />
                </div>
                {spec.custom.map((c) => (
                  <div className="rbd-tr rbd-tr--custom" key={c.id}>
                    <label className="rbd-f rbd-tn">
                      <span className="rbd-lbl">Item</span>
                      <input className="rbd-in" placeholder="A skylight, gutters, a fascia repair" value={c.name} disabled={disabled} onChange={(e) => setCustom(c.id, { name: e.target.value })} aria-label="Custom item" />
                    </label>
                    <Num label="Qty" aria="Quantity" value={c.qty} onChange={(n) => setCustom(c.id, { qty: n })} disabled={disabled} />
                    <Sel label="Unit" aria="Unit" value={c.unit} options={PKG_UNITS.map((u) => ({ id: u, label: u }))} onChange={(v) => setCustom(c.id, { unit: v as PkgUnit })} disabled={disabled} />
                    <Num label="Price" aria="Unit price" unit="$" value={c.unitPrice} onChange={(n) => setCustom(c.id, { unitPrice: n })} disabled={disabled} />
                    <Sel
                      label="Material or labor"
                      aria="Material or labor"
                      value={c.kind}
                      options={[
                        { id: "material", label: "Material" },
                        { id: "labor", label: "Labor" },
                      ]}
                      onChange={(v) => setCustom(c.id, { kind: v as "material" | "labor" })}
                      disabled={disabled}
                    />
                    <button type="button" className="rbd-x" disabled={disabled} aria-label="Remove custom line" title="Remove" onClick={() => removeCustom(c.id)}>
                      <IcX />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="rbd-add">
              <button type="button" className="rbd-btn rbd-btn--ghost rbd-btn--sm" disabled={disabled} onClick={() => addCustom("material")}>
                <IcPlus />
                Material line
              </button>
              <button type="button" className="rbd-btn rbd-btn--ghost rbd-btn--sm" disabled={disabled} onClick={() => addCustom("labor")}>
                <IcPlus />
                Labor line
              </button>
            </div>
          </Section>
        </div>

        {/* Whose rates these are, and the save that makes them the company's. */}
        <div className="rbd-defaults">
          <div className="rbd-defaults-t">
            <span className="rbd-defaults-k">Your rates</span>
            <span className="rbd-defaults-v">{source === "loading" ? "Loading company defaults…" : source === "org" ? "Company defaults" : "This browser only"}</span>
            {dirty && source !== "loading" ? <Stamp tone="warn">unsaved</Stamp> : null}
          </div>
          <button
            type="button"
            className={"rbd-btn rbd-btn--sm " + (dirty ? "rbd-btn--ink" : "rbd-btn--ghost")}
            disabled={disabled}
            aria-busy={saving || undefined}
            onClick={() => void saveDefaults()}
          >
            {saving ? "Saving…" : "Save as defaults"}
          </button>
          <a className="rbd-btn rbd-btn--sm rbd-btn--ghost" href="/dashboard/roof-estimator/inventory#book">
            Price book
          </a>
        </div>
        {saveError && (
          <p className="rbd-save-error" role="alert">
            {saveError}
          </p>
        )}
      </div>

      {/* ESTIMATE — the HVAC summary rail: the answer and the two ways out. */}
      <div className="rbd-side">
        <aside className="rbd-sum" aria-label="Estimate">
          <h3 className="rbd-sum-k">Estimate</h3>
          <div className="rbd-sum-total">
            <span className="rbd-sum-l">{spec.commercial.on ? "Total · commercial" : "Total"}</span>
            {needsPitch ? (
              <span className="rbd-sum-v is-blank">Not priced yet</span>
            ) : (
              <span className="rbd-sum-v" key={total}>
                {money(total)}
              </span>
            )}
          </div>
          {needsPitch ? (
            /* Nothing is priced, so no split to show: say why instead. */
            <p className="rbd-sum-why">{blockedReason}</p>
          ) : (
            <dl className="rbd-sum-split">
              <div className="rbd-sum-r">
                <dt>Materials</dt>
                <dd>{money(materialsTotal)}</dd>
              </div>
              <div className="rbd-sum-r">
                <dt>Labor</dt>
                <dd>{money(total - materialsTotal)}</dd>
              </div>
            </dl>
          )}
          <div className="rbd-sum-acts">
            <button
              type="button"
              className="rbd-btn rbd-btn--ghost"
              disabled={disabled || needsPitch}
              data-blocked={needsPitch ? blockedReason : undefined}
              onClick={() => onBuild(pkg, spec)}
              title={needsPitch ? "Enter pitch to price." : "Fill the estimate tables below to review and adjust before converting"}
            >
              <svg className="ic" aria-hidden="true"><use href="#i-board" /></svg>
              Review {lineCount} lines
            </button>
            {convertBtn}
          </div>
        </aside>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// THE CARD
// ═══════════════════════════════════════════════════════════════════════════
export default function BuildEstimateCardD({
  isRecon,
  buildMode,
  onBuildMode,
  waste,
  onWaste,
  wasteOptions,
  caution,
  pitchEntry,
  generate,
  facts,
  builderDisabled,
  converting,
  onBuild,
  onConvert,
  report,
  output,
  onBuildingUse,
  aiEnabled = true,
  waiting = null,
  seedSpec = null,
  convertLabel,
}: BuildEstimateCardProps) {
  // Nothing is priced while the aerial provider is still delivering the
  // packs pricing needs, nor on a pitch nobody stated.
  const needsPitch = !!waiting || (!!pitchEntry && !pitchEntry.value);
  const blockedReason = waiting ?? "Enter pitch to price.";
  // EagleView supplied no pitch (pack 002 not bought): the contractor states
  // one before anything is priced, in either mode.
  const pitchSel = waiting ? (
    <div className="rbd-pitch" data-waiting="1">
      <span className="rbd-lbl">Pitch</span>
      <p className="rbd-pitch-msg">
        <Stamp tone="warn">waiting</Stamp>
        <span>{waiting}</span>
      </p>
    </div>
  ) : pitchEntry ? (
    <div className="rbd-pitch">
      <span className="rbd-lbl">Pitch</span>
      <div className="rbd-pitch-row">
        <div className="rbd-pitch-sel">
          <BlueprintSelect
            id="pitchEntered"
            value={pitchEntry.value ?? ""}
            onChange={(p) => pitchEntry.onChange(p || null)}
            options={pitchEntry.options.map((p) => ({ value: p, label: p }))}
            placeholder="Enter pitch…"
            ariaLabel="Pitch"
            styles={SEL_STYLES}
          />
        </div>
        {needsPitch && <p className="rbd-pitch-msg">Enter pitch to price.</p>}
      </div>
    </div>
  ) : null;

  const reason = generate.disabled && generate.reason ? generate.reason : null;
  const modes = aiEnabled ? (["package", "ai"] as const) : (["package"] as const);

  return (
    <div className="card rbd" data-build-card="d" data-mode={buildMode}>
      <div className="rbd-head">
        <h2 className="rbd-title">Build an estimate</h2>
        <div className="rbd-mode" role="radiogroup" aria-label="How to build the estimate" onKeyDown={radioKeys}>
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={buildMode === m}
              tabIndex={buildMode === m ? 0 : -1}
              className={"rbd-mode-btn" + (buildMode === m ? " is-on" : "")}
              onClick={() => onBuildMode(m)}
            >
              {m === "package" ? "Roof package" : "Smart estimate"}
            </button>
          ))}
        </div>
      </div>

      {caution && (
        <div className="rbd-caution" role="note">
          <Stamp tone="warn">{caution.stamp}</Stamp>
          <p className="rbd-caution-t">{caution.text}</p>
          {caution.action && (
            <button type="button" className="rbd-btn rbd-btn--ghost rbd-btn--sm rbd-caution-act" onClick={caution.action.onClick}>
              {caution.action.label}
            </button>
          )}
        </div>
      )}
      {isRecon && (
        <div className="rbd-recon">
          <Stamp>aerial estimate</Stamp>
          <p>
            These figures are estimated from aerial imagery, so they can’t be priced. Use <b>Measure this roof</b> on this address to build a quote.
          </p>
        </div>
      )}

      {buildMode === "package" ? (
        !isRecon && facts ? (
          <PackageLedger
            facts={facts}
            disabled={builderDisabled}
            converting={converting}
            onBuild={onBuild}
            onConvert={onConvert}
            seedSpec={seedSpec}
            convertLabel={convertLabel}
            lead={pitchSel}
            needsPitch={needsPitch}
            blockedReason={blockedReason}
            report={report}
            onBuildingUse={onBuildingUse}
          />
        ) : pitchSel ? (
          <div className={"rbd-lead rbd-lead--solo" + (needsPitch ? " is-needed" : "")}>{pitchSel}</div>
        ) : null
      ) : (
        <div className="rbd-smart">
          {pitchSel && <div className={"rbd-lead" + (needsPitch ? " is-needed" : "")}>{pitchSel}</div>}
          <div className="rbd-smart-b">
            <div className="rbd-fields">
              <div className="rbd-f">
                <span className="rbd-lbl">Waste</span>
                <BlueprintSelect
                  id="waste"
                  value={String(waste)}
                  onChange={(w) => onWaste(Number(w))}
                  options={wasteOptions.map((w) => ({ value: String(w), label: `${w}%` }))}
                  placeholder=""
                  ariaLabel="Waste"
                  styles={SEL_STYLES}
                />
              </div>
            </div>
            <div className="rbd-next">
              <button
                className="rbd-btn rbd-btn--primary"
                type="button"
                id="buildBtn"
                disabled={generate.disabled}
                aria-busy={generate.busy || undefined}
                title={generate.reason}
                onClick={generate.onClick}
              >
                <svg className="ic" aria-hidden="true"><use href="#i-bulb" /></svg>
                {generate.busy ? "Generating…" : "Generate estimate"}
              </button>
              <p className={"rbd-next-note" + (reason ? " is-reason" : "")}>
                {reason ??
                  (facts?.existingMaterial && likeForLikeFamily(facts)
                    ? `Existing roof: ${facts.existingMaterial}. Drafts a like-for-like package from the measured figures — every line stays editable below.`
                    : "Drafts the full package from the measured figures — every line stays editable below.")}
              </p>
            </div>
          </div>
        </div>
      )}

      {output}
    </div>
  );
}
