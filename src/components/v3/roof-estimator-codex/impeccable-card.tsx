"use client";

import * as React from "react";
import { ArrowRight, Check, ChevronDown, Lightbulb, Plus, Settings2, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { getRoofCatalog, saveRoofCatalog } from "@/actions/roofCatalog";
import {
  BUILTIN_LISTS, CHIMNEY_SIZES, DRIP_EDGE_PROFILES, DRIP_EDGE_SIZES, ICE_WATER,
  PIPE_BOOT_SIZES, PKG_UNITS, ROOF_FAMILIES, STEP_FLASHING_SIZES, VALLEY_TYPES,
  VENT_TYPES, WASTE_OPTIONS,
  type CatalogLists, type IceWaterCoverage, type PkgUnit, type RoofFamily,
  type RoofSystem, type Underlayment,
} from "@/lib/roofPackage/catalog";
import {
  buildRoofPackage, checkVentilation, defaultSpec, estimateEdges,
  type RoofFacts, type RoofPackageSpec,
} from "@/lib/roofPackage/takeoff";
import type { BuildEstimateCardProps } from "../roof-estimator-blueprint/build-estimate-card";
import {
  applyPrefs, factsKey, LISTS_KEY, money, PREFS_KEY, prefsOf, readLocal,
  reconcile, saneLists, writeLocal, type Prefs,
} from "../roof-estimator-blueprint/roof-package-builder";
import styles from "./impeccable-card.module.css";

type NumericKey = { [K in keyof RoofPackageSpec]-?: RoofPackageSpec[K] extends number ? K : never }[keyof RoofPackageSpec];
type RateField = readonly [NumericKey, string, string];
type WorkTab = "roofing" | "details" | "site";
const WORK_TABS: Array<{ id: WorkTab; label: string }> = [
  { id: "roofing", label: "Roofing" }, { id: "details", label: "Roof details" }, { id: "site", label: "Site & extras" },
];
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });

function NumberField({ label, value, unit, onChange }: { label: string; value: number; unit?: string; onChange: (n: number) => void }) {
  const [draft, setDraft] = React.useState(String(value));
  const [seen, setSeen] = React.useState(value);
  if (seen !== value) {
    setSeen(value);
    if (Number(draft.replace(/,/g, "")) !== value) setDraft(String(value));
  }
  return <label className={styles.field}>
    <span>{label}</span>
    <span className={styles.numberInput}>
      <input inputMode="decimal" value={draft} aria-label={label} onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        const n = Number(text.replace(/,/g, ""));
        if (text.trim() && Number.isFinite(n) && n >= 0) onChange(n);
      }} onBlur={() => setDraft(String(value))} />
      {unit && <span className={styles.unit}>{unit}</span>}
    </span>
  </label>;
}

function SelectField({ label, value, options, onChange }: {
  label: string; value: string; options: ReadonlyArray<{ id: string; label: string }>; onChange: (v: string) => void;
}) {
  return <label className={styles.field}><span>{label}</span>
    <span className={styles.selectInput}>
      <select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
      <ChevronDown size={16} aria-hidden="true" />
    </span>
  </label>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className={styles.toggle}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}

function Fold({ title, summary, children, badge, initialOpen = false }: {
  title: string; summary?: string; children: React.ReactNode; badge?: React.ReactNode; initialOpen?: boolean;
}) {
  return <details className={styles.fold} open={initialOpen || undefined}>
    <summary><span className={styles.foldText}><strong>{title}</strong>{summary && <span>{summary}</span>}</span>{badge}<ChevronDown size={18} aria-hidden="true" /></summary>
    <div className={styles.foldBody}>{children}</div>
  </details>;
}

function Group({ title, children }: { title?: string; children: React.ReactNode }) {
  return <div className={styles.group}>{title && <h4>{title}</h4>}<div className={styles.fields}>{children}</div></div>;
}

export default function ImpeccableCard(props: BuildEstimateCardProps) {
  const titleId = React.useId();
  const pitchMissing = Boolean(props.pitchEntry && !props.pitchEntry.value);
  const hasArea = props.squares != null && Number.isFinite(props.squares) && props.squares > 0;
  const factsReady = Boolean(props.facts && Number.isFinite(props.facts.squares) && props.facts.squares > 0);
  const blocked = props.isRecon || !hasArea || !factsReady || pitchMissing;
  const reason = props.isRecon
    ? "Aerial preview only. Run Instant measure to price this roof."
    : !hasArea || !factsReady
      ? "Measure the roof or enter a takeoff to start."
      : pitchMissing ? "Select a pitch to price installation." : null;
  return <section className={styles.card} data-build-card="codex-impeccable" aria-labelledby={titleId}>
    <header className={styles.header}>
      <div><h2 id={titleId}>Build estimate</h2><p>{props.isRecon ? "Aerial preview" : hasArea ? `${fmt(props.squares!)} squares · ${props.manual ? `Your takeoff · ${props.manual.pitchLabel}` : "Measured roof"}` : "Roof size required"}</p></div>
      <div className={styles.modeSwitch} aria-label="Estimate method">
        <button type="button" aria-pressed={props.buildMode === "package"} onClick={() => props.onBuildMode("package")}>Roof package</button>
        <button type="button" aria-pressed={props.buildMode === "ai"} onClick={() => props.onBuildMode("ai")}><Lightbulb size={16} aria-hidden="true" />Smart estimate</button>
      </div>
    </header>
    {props.pitchEntry && !props.isRecon && <div className={styles.pitchEntry}>
      <SelectField label="Roof pitch" value={props.pitchEntry.value ?? ""} options={[{ id: "", label: "Select pitch" }, ...props.pitchEntry.options.map((p) => ({ id: p, label: p }))]} onChange={(v) => props.pitchEntry?.onChange(v || null)} />
      <p>Used to price installation labor.</p>
    </div>}
    {reason && <div className={styles.empty} role="status">{reason}</div>}
    {props.buildMode === "package" && props.facts && !props.isRecon && factsReady && <PackageWorksheet
      key={factsKey(props.facts)} facts={props.facts} disabled={props.builderDisabled || blocked} converting={props.converting}
      onBuild={props.onBuild} onConvert={props.onConvert} hasEstimate={props.hasEstimate}
    />}
    {props.buildMode === "ai" && !props.isRecon && <div className={styles.smart}>
      <div><h3>Draft the full package.</h3><p>Materials and labor, ready to review and edit.</p></div>
      <div className={styles.smartControls}>
        <SelectField label="Waste" value={String(props.waste)} options={props.wasteOptions.map((w) => ({ id: String(w), label: `${w}%` }))} onChange={(v) => props.onWaste(Number(v))} />
        <button type="button" className={styles.primary} disabled={blocked || props.generate.disabled || props.generate.busy} aria-busy={props.generate.busy} onClick={props.generate.onClick} title={props.generate.reason}>
          {props.generate.busy ? "Generating…" : "Generate estimate"}<ArrowRight size={18} aria-hidden="true" />
        </button>
      </div>
      {props.generate.reason && !reason && <p className={styles.note} role="status">{props.generate.reason}</p>}
    </div>}
    <div className={styles.output} data-estimate-output="impeccable">{props.output}</div>
  </section>;
}

function PackageWorksheet({ facts, disabled, converting, onBuild, onConvert, hasEstimate }: {
  facts: RoofFacts; disabled: boolean; converting: boolean; onBuild: BuildEstimateCardProps["onBuild"];
  onConvert: BuildEstimateCardProps["onConvert"]; hasEstimate: boolean;
}) {
  const [initialFacts] = React.useState(facts);
  const [lists, setLists] = React.useState<CatalogLists>(BUILTIN_LISTS);
  const [spec, setSpec] = React.useState(() => defaultSpec(initialFacts));
  const [tab, setTab] = React.useState<WorkTab>("roofing");
  const [source, setSource] = React.useState<"loading" | "company" | "browser" | "builtin">("loading");
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [message, setMessage] = React.useState<{ error: boolean; text: string } | null>(null);
  const [catalog, setCatalog] = React.useState<"systems" | "underlayments" | null>(null);
  const [catalogRow, setCatalogRow] = React.useState<string | null>(null);
  const revision = React.useRef(0);
  const tabsId = React.useId();
  const tabRefs = React.useRef<Partial<Record<WorkTab, HTMLButtonElement | null>>>({});

  React.useEffect(() => {
    let cancelled = false;
    // Keep the server and first client render identical; storage is a client preference.
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      const localLists = saneLists(readLocal<CatalogLists>(LISTS_KEY));
      const localPrefs = readLocal<Prefs>(PREFS_KEY);
      const initialLists = localLists ?? BUILTIN_LISTS;
      if (revision.current === 0) {
        setLists(initialLists);
        setSpec(reconcile(applyPrefs(defaultSpec(initialFacts, initialLists), localPrefs), initialLists));
      }
      try {
        const doc = await getRoofCatalog();
        if (cancelled) return;
        if (doc) {
          const companyLists = saneLists({ systems: doc.systems, underlayments: doc.underlayments }) ?? initialLists;
          // A late fetch must not replace a contractor's in-progress edit.
          if (revision.current === 0) {
            setLists(companyLists);
            setSpec((current) => reconcile(applyPrefs(current, doc.prefs), companyLists));
            writeLocal(LISTS_KEY, companyLists);
            writeLocal(PREFS_KEY, doc.prefs);
          }
          setSource("company");
        } else setSource(localLists || localPrefs ? "browser" : "builtin");
      } catch {
        if (!cancelled) setSource(localLists || localPrefs ? "browser" : "builtin");
      }
    });
    return () => { cancelled = true; };
  }, [initialFacts]);

  function update(patch: Partial<RoofPackageSpec>) {
    revision.current += 1;
    setSpec((current) => {
      const next = { ...current, ...patch };
      writeLocal(PREFS_KEY, prefsOf(next));
      return next;
    });
    setDirty(true);
    setMessage(null);
  }
  function set<K extends keyof RoofPackageSpec>(key: K, value: RoofPackageSpec[K]) { update({ [key]: value }); }
  function updateLists(next: CatalogLists) {
    revision.current += 1;
    setLists(next);
    setSpec((current) => {
      const result = reconcile(current, next);
      writeLocal(PREFS_KEY, prefsOf(result));
      return result;
    });
    writeLocal(LISTS_KEY, next);
    setDirty(true);
    setMessage(null);
  }
  function pickSystem(id: string, options = lists) {
    const roof = options.systems.find((s) => s.id === id);
    if (roof) update({ systemId: roof.id, systemName: roof.label, systemFamily: roof.family, systemMatPerSq: roof.matPerSq, systemLaborPerSq: roof.laborPerSq, capPerFt: roof.capPerFt, wastePct: roof.wastePct });
  }
  function pickUnderlayment(id: string, options = lists) {
    const under = options.underlayments.find((u) => u.id === id);
    if (under) update({ underlaymentId: under.id, underlaymentName: under.label, underlaymentPerSq: under.perSq });
  }
  function patchSystem(id: string, patch: Partial<RoofSystem>) {
    const next = { ...lists, systems: lists.systems.map((s) => s.id === id ? { ...s, ...patch } : s) };
    updateLists(next);
    if (spec.systemId === id) pickSystem(id, next);
  }
  function patchUnderlayment(id: string, patch: Partial<Underlayment>) {
    const next = { ...lists, underlayments: lists.underlayments.map((u) => u.id === id ? { ...u, ...patch } : u) };
    updateLists(next);
    if (spec.underlaymentId === id) pickUnderlayment(id, next);
  }
  async function saveDefaults() {
    if (saving || disabled) return;
    const savedRevision = revision.current;
    const document = { version: 1 as const, systems: lists.systems, underlayments: lists.underlayments, prefs: prefsOf(spec) };
    writeLocal(LISTS_KEY, lists);
    writeLocal(PREFS_KEY, document.prefs);
    setSaving(true);
    setMessage(null);
    try {
      const result = await saveRoofCatalog(document);
      if (result.ok) {
        setSource("company");
        if (revision.current === savedRevision) setDirty(false);
        setMessage({ error: false, text: "Company defaults saved." });
      } else setMessage({ error: true, text: `${result.error} Browser copy kept. Try saving again.` });
    } catch {
      setMessage({ error: true, text: "Company save failed. Browser copy kept. Try again." });
    } finally { setSaving(false); }
  }
  const pkg = React.useMemo(() => buildRoofPackage(spec, facts), [spec, facts]);
  const ventilation = React.useMemo(() => checkVentilation(spec, facts), [spec, facts]);
  const materialTotal = pkg.materials.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const laborTotal = pkg.labor.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const total = materialTotal + laborTotal;
  const steepest = Math.max(0, ...facts.pitchFamilies.map((p) => p.pitch12));
  const lowSlope = spec.systemFamily === "low-slope";
  const starterAvailable = !lowSlope && spec.systemFamily !== "metal";
  const quoteDisabled = disabled || !Number.isFinite(total) || total <= 0;
  const activeVents = VENT_TYPES.filter((v) => (spec.vents.find((p) => p.id === v.id)?.qty ?? 0) > 0);
  const ventOf = (id: string) => spec.vents.find((v) => v.id === id) ?? { id, qty: 0, each: VENT_TYPES.find((v) => v.id === id)!.each, labor: VENT_TYPES.find((v) => v.id === id)!.labor };
  function setVent(id: string, patch: Partial<{ qty: number; each: number; labor: number }>) {
    const next = { ...ventOf(id), ...patch };
    set("vents", spec.vents.some((v) => v.id === id) ? spec.vents.map((v) => v.id === id ? next : v) : [...spec.vents, next]);
  }
  function setCustom(id: string, patch: Partial<RoofPackageSpec["custom"][number]>) { set("custom", spec.custom.map((c) => c.id === id ? { ...c, ...patch } : c)); }
  function number(key: NumericKey, label: string, unit = "") { return <NumberField key={key} label={label} value={spec[key]} unit={unit} onChange={(n) => update({ [key]: n })} />; }
  function rates(fields: readonly RateField[], title = "Unit rates") {
    return <details className={styles.rates}><summary>{title}<ChevronDown size={15} aria-hidden="true" /></summary><div className={styles.fields}>{fields.map(([key, label, unit]) => number(key, label, unit))}</div></details>;
  }
  function openCatalog(which: "systems" | "underlayments") {
    setCatalog(which);
    setCatalogRow(which === "systems" ? spec.systemId : spec.underlaymentId);
  }
  function showTab(next: WorkTab) { setTab(next); setCatalog(null); }
  function review() {
    if (quoteDisabled || converting) return;
    onBuild(pkg, spec);
  }
  const pipeCount = Object.values(spec.pipeBoots).reduce((a, b) => a + b, 0);
  const edgeEstimate = estimateEdges(facts);
  const selectedCatalogRoof = lists.systems.find((r) => r.id === catalogRow) ?? lists.systems[0];
  const selectedCatalogUnder = lists.underlayments.find((u) => u.id === catalogRow) ?? lists.underlayments[0];

  return <div className={styles.worksheet}>
    <div className={styles.quote}>
      <div className={styles.quoteNumber}><span>Package total</span><strong>{money(total)}</strong></div>
      <div className={styles.quoteBreakdown}><span>Materials <b>{money(materialTotal)}</b></span><span>Labor <b>{money(laborTotal)}</b></span></div>
      <span className={styles.lineCount}>{pkg.materials.length + pkg.labor.length} lines</span>
    </div>
    <div className={styles.workbar}>
      <div className={styles.tabs} role="tablist" aria-label="Roof package sections">
        {WORK_TABS.map((item, index) => <button key={item.id} type="button" role="tab" ref={(node) => { tabRefs.current[item.id] = node; }}
          id={`${tabsId}-${item.id}`} aria-selected={tab === item.id} aria-controls={`${tabsId}-panel`} tabIndex={tab === item.id ? 0 : -1}
          onClick={() => showTab(item.id)} onKeyDown={(event) => {
            const nextIndex = event.key === "ArrowRight" ? (index + 1) % 3 : event.key === "ArrowLeft" ? (index + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : null;
            if (nextIndex !== null) { event.preventDefault(); const next = WORK_TABS[nextIndex].id; showTab(next); tabRefs.current[next]?.focus(); }
          }}>{item.label}</button>)}
      </div>
      <details className={styles.settings}><summary><Settings2 size={17} aria-hidden="true" />Defaults<ChevronDown size={14} aria-hidden="true" /></summary>
        <div className={styles.settingsBody}>
          <p>{source === "loading" ? "Loading rates…" : source === "company" ? "Company rates" : source === "browser" ? "Saved on this browser" : "Built-in starting rates"}{dirty ? " · edited" : ""}</p>
          <div className={styles.buttonRow}><button type="button" className={styles.secondary} disabled={disabled || saving || source === "loading"} onClick={() => void saveDefaults()}>{saving ? "Saving…" : "Save as defaults"}</button>
            <button type="button" className={styles.textButton} disabled={disabled} onClick={() => openCatalog("systems")}>Edit roof types</button>
            <button type="button" className={styles.textButton} disabled={disabled} onClick={() => openCatalog("underlayments")}>Edit underlayments</button></div>
        </div>
      </details>
    </div>
    {message && <p className={message.error ? styles.error : styles.feedback} role={message.error ? "alert" : "status"}>{!message.error && <Check size={16} aria-hidden="true" />}{message.text}</p>}
    <fieldset className={styles.editor} disabled={disabled || converting}>
      <legend className={styles.srOnly}>Configure roof package</legend>
      {catalog ? <div className={styles.catalogEditor}>
        <div className={styles.sectionHeading}><h3>{catalog === "systems" ? "Roof type catalog" : "Underlayment catalog"}</h3><button type="button" className={styles.secondary} onClick={() => setCatalog(null)}>Done</button></div>
        <SelectField label="Edit item" value={catalog === "systems" ? selectedCatalogRoof.id : selectedCatalogUnder.id} options={catalog === "systems" ? lists.systems : lists.underlayments} onChange={setCatalogRow} />
        {catalog === "systems" ? <>
          <label className={styles.field}><span>Roof type name</span><input value={selectedCatalogRoof.label} onChange={(e) => patchSystem(selectedCatalogRoof.id, { label: e.target.value })} /></label>
          <SelectField label="Roof family" value={selectedCatalogRoof.family} options={ROOF_FAMILIES} onChange={(family) => patchSystem(selectedCatalogRoof.id, { family: family as RoofFamily })} />
          <Group>
            <NumberField label="Material" unit="$/sq" value={selectedCatalogRoof.matPerSq} onChange={(matPerSq) => patchSystem(selectedCatalogRoof.id, { matPerSq })} />
            <NumberField label="Install labor" unit="$/sq" value={selectedCatalogRoof.laborPerSq} onChange={(laborPerSq) => patchSystem(selectedCatalogRoof.id, { laborPerSq })} />
            <NumberField label="Waste" unit="%" value={selectedCatalogRoof.wastePct} onChange={(wastePct) => patchSystem(selectedCatalogRoof.id, { wastePct })} />
            <NumberField label="Ridge & hip cap" unit="$/ft" value={selectedCatalogRoof.capPerFt} onChange={(capPerFt) => patchSystem(selectedCatalogRoof.id, { capPerFt })} />
          </Group>
          <div className={styles.buttonRow}>
            <button type="button" className={styles.secondary} onClick={() => { const id = `s_${nanoid(6)}`; updateLists({ ...lists, systems: [...lists.systems, { id, label: "New roof type", family: "asphalt", matPerSq: 0, laborPerSq: 0, capPerFt: 0, wastePct: 10 }] }); setCatalogRow(id); }}><Plus size={16} aria-hidden="true" />Add roof type</button>
            <button type="button" className={styles.dangerButton} disabled={lists.systems.length <= 1} onClick={() => { updateLists({ ...lists, systems: lists.systems.filter((r) => r.id !== selectedCatalogRoof.id) }); setCatalogRow(null); }}><Trash2 size={16} aria-hidden="true" />Remove type</button>
            <button type="button" className={styles.textButton} onClick={() => { updateLists(BUILTIN_LISTS); setCatalogRow(null); }}>Restore built-in lists</button>
          </div>
        </> : <>
          <label className={styles.field}><span>Underlayment name</span><input value={selectedCatalogUnder.label} onChange={(e) => patchUnderlayment(selectedCatalogUnder.id, { label: e.target.value })} /></label>
          <NumberField label="Material" unit="$/sq" value={selectedCatalogUnder.perSq} onChange={(perSq) => patchUnderlayment(selectedCatalogUnder.id, { perSq })} />
          <div className={styles.buttonRow}>
            <button type="button" className={styles.secondary} onClick={() => { const id = `u_${nanoid(6)}`; updateLists({ ...lists, underlayments: [...lists.underlayments, { id, label: "New underlayment", perSq: 0 }] }); setCatalogRow(id); }}><Plus size={16} aria-hidden="true" />Add underlayment</button>
            <button type="button" className={styles.dangerButton} disabled={lists.underlayments.length <= 1} onClick={() => { updateLists({ ...lists, underlayments: lists.underlayments.filter((u) => u.id !== selectedCatalogUnder.id) }); setCatalogRow(null); }}><Trash2 size={16} aria-hidden="true" />Remove item</button>
          </div>
        </>}
        <div className={styles.catalogSave}><span>{dirty ? "Changes kept in this browser." : "Catalog defaults"}</span><button type="button" className={styles.primary} disabled={saving || source === "loading"} onClick={() => void saveDefaults()}>{saving ? "Saving…" : "Save for company"}</button></div>
      </div> : <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`} tabIndex={0} className={styles.panel}>
        {tab === "roofing" && <>
          <div className={styles.roofSystem}>
            <div className={styles.sectionHeading}><h3>Roof system</h3><button type="button" className={styles.textButton} onClick={() => openCatalog("systems")}>Edit types</button></div>
            <SelectField label="Roof type" value={spec.systemId} options={lists.systems} onChange={pickSystem} />
            <div className={styles.mainRates}>
              {number("systemMatPerSq", "Material", "$/sq")}{number("systemLaborPerSq", "Install labor", "$/sq")}
              <SelectField label="Waste" value={String(spec.wastePct)} options={[...new Set([...WASTE_OPTIONS, spec.wastePct])].sort((a, b) => a - b).map((w) => ({ id: String(w), label: `${w}%` }))} onChange={(v) => set("wastePct", Number(v))} />
            </div>
            <p className={styles.measureNote}>{fmt(facts.squares * (1 + spec.wastePct / 100))} squares incl. waste{facts.pitchFamilies.length ? ` · Pitch ${facts.pitchFamilies.map((p) => `${p.pitch12}/12${facts.pitchFamilies.length > 1 ? ` (${Math.round(p.share * 100)}%)` : ""}`).join(" + ")}` : ""}</p>
            {!lowSlope && rates([["capPerFt", "Ridge & hip cap", "$/ft"]], "Cap rate")}
          </div>
          <Fold title="Underlayment" summary={spec.underlaymentName}>
            <SelectField label="Underlayment" value={spec.underlaymentId} options={lists.underlayments} onChange={pickUnderlayment} />
            <button type="button" className={styles.textButton} onClick={() => openCatalog("underlayments")}>Edit underlayments</button>
            <SelectField label="Ice & water shield" value={spec.iceWater} options={ICE_WATER} onChange={(v) => set("iceWater", v as IceWaterCoverage)} />
            {rates([["underlaymentPerSq", "Underlayment", "$/sq"], ...(spec.iceWater !== "none" ? [["iceWaterPerSqft", "Ice & water", "$/sq ft"] as const] : [])])}
          </Fold>
          <button type="button" className={styles.nextStep} onClick={() => showTab("details")}><span>Check edges, flashing & vents</span><ArrowRight size={18} aria-hidden="true" /></button>
        </>}
        {tab === "details" && <>
          <Fold title="Edges" summary={`${fmt(spec.eaveFt + spec.rakeFt)} ft perimeter · ${fmt(spec.ridgeFt + spec.hipFt)} ft cap`} badge={<span className={styles.badge}>{spec.edgesBasis === "estimated" ? "Estimated" : "Entered"}</span>} initialOpen>
            <Group>{(["eaveFt", "rakeFt", "ridgeFt", "hipFt"] as const).map((key, i) => <NumberField key={key} label={["Eave", "Rake", "Ridge", "Hip"][i]} unit="ft" value={spec[key]} onChange={(n) => update({ [key]: n, edgesBasis: "entered" })} />)}</Group>
            {spec.edgesBasis === "estimated" ? <p className={styles.note}>From the building outline. Confirm lengths on the photo.</p> : edgeEstimate && <button type="button" className={styles.textButton} onClick={() => update({ ...edgeEstimate, edgesBasis: "estimated" })}>Use outline estimate</button>}
            <Group><Toggle label="Drip edge" checked={spec.dripEdgeOn} onChange={(v) => set("dripEdgeOn", v)} />{starterAvailable && <Toggle label="Starter strip" checked={spec.starterOn} onChange={(v) => set("starterOn", v)} />}</Group>
            {spec.dripEdgeOn && <Group>
              <SelectField label="Drip profile" value={spec.dripProfileId} options={DRIP_EDGE_PROFILES} onChange={(v) => { const row = DRIP_EDGE_PROFILES.find((p) => p.id === v)!; update({ dripProfileId: v, ...(v !== "custom" ? { dripPerFt: row.perFt } : {}) }); }} />
              <SelectField label="Drip size" value={spec.dripSizeId} options={DRIP_EDGE_SIZES} onChange={(v) => set("dripSizeId", v)} />
            </Group>}
            {(spec.dripEdgeOn || (starterAvailable && spec.starterOn)) && rates([...(spec.dripEdgeOn ? [["dripPerFt", "Drip edge", "$/ft"] as const] : []), ...(starterAvailable && spec.starterOn ? [["starterPerFt", "Starter strip", "$/ft"] as const] : [])])}
          </Fold>
          <Fold title="Flashing" summary={`${spec.valleyCount} valleys · ${spec.stepWallCount} sidewalls`}>
            <Group title="Valleys">{number("valleyCount", "Valleys", "each")}{number("valleyFtEach", "Length each", "ft")}</Group>
            <SelectField label="Valley type" value={spec.valleyTypeId} options={VALLEY_TYPES} onChange={(v) => { const row = VALLEY_TYPES.find((r) => r.id === v)!; update({ valleyTypeId: v, ...(v !== "custom" ? { valleyMatPerFt: row.matPerFt, valleyLaborPerFt: row.laborPerFt } : {}) }); }} />
            <Group title="Sidewalls">{number("stepWallCount", "Walls", "each")}{number("stepWallFtEach", "Wall length each", "ft")}</Group>
            <SelectField label="Step flashing size" value={spec.stepSizeId} options={STEP_FLASHING_SIZES} onChange={(v) => { const row = STEP_FLASHING_SIZES.find((r) => r.id === v)!; update({ stepSizeId: v, ...(v !== "custom" ? { stepPerPiece: row.perPiece } : {}) }); }} />
            <Group title="Other flashing">{number("apronFt", "Apron / headwall", "ft")}{number("counterFt", "Counter flashing", "ft")}</Group>
            {rates([["valleyMatPerFt", "Valley metal", "$/ft"], ["valleyLaborPerFt", "Valley labor", "$/ft"], ["stepPerPiece", "Step piece", "$/ea"], ["stepLaborPerFt", "Step labor", "$/ft"], ["apronPerFt", "Apron", "$/ft"], ["apronLaborPerFt", "Apron labor", "$/ft"], ["counterPerFt", "Counter flashing", "$/ft"], ["counterLaborPerFt", "Counter labor", "$/ft"]])}
          </Fold>
          <Fold title="Pipes, chimneys & curbs" summary={`${pipeCount} pipe boots · ${spec.chimneyCount} chimneys · ${spec.curbCount} curbs`}>
            <Group title="Pipe boots">{PIPE_BOOT_SIZES.map((pipe) => <NumberField key={pipe.id} label={pipe.label} unit="each" value={spec.pipeBoots[pipe.id] ?? 0} onChange={(v) => set("pipeBoots", { ...spec.pipeBoots, [pipe.id]: v })} />)}</Group>
            <details className={styles.rates}><summary>Pipe boot rates<ChevronDown size={15} aria-hidden="true" /></summary>{PIPE_BOOT_SIZES.map((pipe) => <Group key={pipe.id} title={pipe.label}>
              <NumberField label={`${pipe.label} material`} unit="$/ea" value={spec.pipeBootPrices[pipe.id]?.each ?? pipe.each} onChange={(each) => set("pipeBootPrices", { ...spec.pipeBootPrices, [pipe.id]: { each, labor: spec.pipeBootPrices[pipe.id]?.labor ?? pipe.labor } })} />
              <NumberField label={`${pipe.label} labor`} unit="$/ea" value={spec.pipeBootPrices[pipe.id]?.labor ?? pipe.labor} onChange={(labor) => set("pipeBootPrices", { ...spec.pipeBootPrices, [pipe.id]: { each: spec.pipeBootPrices[pipe.id]?.each ?? pipe.each, labor } })} />
            </Group>)}</details>
            <Group title="Chimneys & curbs">{number("chimneyCount", "Chimneys", "each")}{number("curbCount", "Curbs", "each")}</Group>
            <SelectField label="Chimney size" value={spec.chimneySizeId} options={CHIMNEY_SIZES} onChange={(v) => { const row = CHIMNEY_SIZES.find((r) => r.id === v)!; update({ chimneySizeId: v, chimneyEach: row.each, chimneyLabor: row.labor }); }} />
            {rates([["chimneyEach", "Chimney kit", "$/ea"], ["chimneyLabor", "Chimney labor", "$/ea"], ["curbEach", "Curb kit", "$/ea"], ["curbLabor", "Curb labor", "$/ea"]])}
          </Fold>
          <Fold title="Ventilation" summary={`${activeVents.length} vent types${ventilation ? ` · 1/${ventilation.ratio} check` : " · No footprint check"}`} badge={ventilation ? <span className={ventilation.ok ? styles.goodBadge : styles.badge}>{ventilation.ok ? "Balanced" : "Short"}</span> : undefined}>
            {ventilation ? <div className={styles.ventCheck}><strong>{ventilation.ok ? "Ventilation covered" : "Add intake or exhaust"}</strong><p>{fmt(ventilation.requiredSqIn)} sq in needed · {fmt(ventilation.exhaustSqIn)} exhaust{ventilation.poweredExhaust ? ` + ${ventilation.poweredExhaust} powered` : ""} · {fmt(ventilation.intakeSqIn)} intake</p></div> : <p className={styles.note}>No attic footprint supplied. Add the vents this roof needs.</p>}
            {activeVents.map((vent) => { const value = ventOf(vent.id); return <div className={styles.lineEditor} key={vent.id}>
              <div className={styles.sectionHeading}><div><h4>{vent.label}</h4><p>{vent.role}{vent.nfaSqIn ? ` · ${vent.nfaSqIn} sq in${vent.unit === "linear ft" ? "/ft" : ""}` : " · powered"}</p></div><button type="button" className={styles.iconButton} aria-label={`Remove ${vent.label}`} onClick={() => setVent(vent.id, { qty: 0 })}><Trash2 size={17} aria-hidden="true" /></button></div>
              <NumberField label={`${vent.label} quantity`} unit={vent.unit === "each" ? "each" : "ft"} value={value.qty} onChange={(qty) => setVent(vent.id, { qty })} />
              <details className={styles.rates}><summary>Unit rates<ChevronDown size={15} aria-hidden="true" /></summary><div className={styles.fields}><NumberField label={`${vent.label} material`} unit={vent.unit === "each" ? "$/ea" : "$/ft"} value={value.each} onChange={(each) => setVent(vent.id, { each })} /><NumberField label={`${vent.label} labor`} unit={vent.unit === "each" ? "$/ea" : "$/ft"} value={value.labor} onChange={(labor) => setVent(vent.id, { labor })} /></div></details>
            </div>; })}
            {activeVents.length < VENT_TYPES.length && <SelectField label="Add ventilation" value="" options={[{ id: "", label: "Choose a vent to add" }, ...VENT_TYPES.filter((v) => ventOf(v.id).qty <= 0)]} onChange={(id) => { if (id) setVent(id, { qty: 1 }); }} />}
            <Toggle label="Balanced system · 1/300 rule" checked={spec.ventBalanced} onChange={(v) => set("ventBalanced", v)} />
          </Fold>
        </>}
        {tab === "site" && <>
          <Fold title="Tear-off & deck" summary={`${spec.tearOffLayers ? `${spec.tearOffLayers} tear-off layer${spec.tearOffLayers === 1 ? "" : "s"}` : "Overlay"} · ${spec.plywoodSheets} deck sheets`} initialOpen>
            <Group><SelectField label="Tear-off" value={String(spec.tearOffLayers)} options={[{ id: "0", label: "None · overlay" }, { id: "1", label: "1 layer" }, { id: "2", label: "2 layers" }, { id: "3", label: "3 layers" }]} onChange={(v) => set("tearOffLayers", Number(v) as 0 | 1 | 2 | 3)} />{number("plywoodSheets", "Deck sheets", "each")}</Group>
            {rates([["tearOffPerSqLayer", "Tear-off labor", "$/sq/layer"], ["disposalPerSqLayer", "Disposal", "$/sq/layer"], ["plywoodEach", "Deck sheet", "$/ea"], ["plywoodLabor", "Sheet labor", "$/ea"]])}
          </Fold>
          <Fold title="Job extras" summary={`Cleanup ${money(spec.cleanupLump)} · Permit ${money(spec.permitLump)}`}>
            <Group>{number("cleanupLump", "Cleanup", "$")}{number("permitLump", "Permit", "$")}{number("safetyLump", "Steep safety", "$")}</Group>
            <p className={styles.note}>{steepest >= 8 ? "Steep safety included for this roof." : "Steep safety is charged only at 8/12 or above."}</p>
            {rates([["nailsPerSq", "Nails & fasteners", "$/sq"], ["sealantPerSq", "Sealant & collars", "$/sq"]], "Consumables")}
          </Fold>
          <Fold title="Custom items" summary={spec.custom.length ? `${spec.custom.length} added` : "Add material or labor"}>
            {spec.custom.length === 0 && <p className={styles.note}>Add anything else this job needs.</p>}
            {spec.custom.map((item, index) => <div key={item.id} className={styles.lineEditor}>
              <div className={styles.sectionHeading}><h4>Item {index + 1}</h4><button type="button" className={styles.iconButton} aria-label={`Remove ${item.name || `item ${index + 1}`}`} onClick={() => set("custom", spec.custom.filter((c) => c.id !== item.id))}><Trash2 size={17} aria-hidden="true" /></button></div>
              <label className={styles.field}><span>Item name</span><input placeholder="e.g. Skylight flashing" value={item.name} onChange={(e) => setCustom(item.id, { name: e.target.value })} /></label>
              <Group><NumberField label="Quantity" value={item.qty} onChange={(qty) => setCustom(item.id, { qty })} /><SelectField label="Unit" value={item.unit} options={PKG_UNITS.map((unit) => ({ id: unit, label: unit }))} onChange={(unit) => setCustom(item.id, { unit: unit as PkgUnit })} /><NumberField label="Unit price" unit="$" value={item.unitPrice} onChange={(unitPrice) => setCustom(item.id, { unitPrice })} /><SelectField label="Type" value={item.kind} options={[{ id: "material", label: "Material" }, { id: "labor", label: "Labor" }]} onChange={(kind) => setCustom(item.id, { kind: kind as "material" | "labor" })} /></Group>
            </div>)}
            <div className={styles.buttonRow}>{(["material", "labor"] as const).map((kind) => <button type="button" className={styles.secondary} key={kind} onClick={() => set("custom", [...spec.custom, { id: nanoid(6), name: "", qty: 1, unit: "each", unitPrice: 0, kind }])}><Plus size={16} aria-hidden="true" />{kind === "material" ? "Material" : "Labor"}</button>)}</div>
          </Fold>
        </>}
      </div>}
    </fieldset>
    <div className={styles.actionbar}>
      <button type="button" className={styles.secondary} disabled={quoteDisabled || converting} onClick={review}>{hasEstimate ? "Update lines" : "Review lines"}</button>
      <button type="button" className={styles.primary} disabled={quoteDisabled || converting} aria-busy={converting} onClick={() => { if (!quoteDisabled && !converting) onConvert(pkg, spec); }}>{converting ? "Creating…" : "Convert to proposal"}<ArrowRight size={18} aria-hidden="true" /></button>
    </div>
  </div>;
}
