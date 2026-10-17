"use client";

import * as React from "react";
import { ArrowRight, Check, ChevronDown, Lightbulb, Plus, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { getRoofCatalog, saveRoofCatalog } from "@/actions/roofCatalog";
import {
  BUILTIN_LISTS, CHIMNEY_SIZES, DRIP_EDGE_PROFILES, DRIP_EDGE_SIZES, ICE_WATER,
  PIPE_BOOT_SIZES, PKG_UNITS, ROOF_FAMILIES, STEP_FLASHING_SIZES, VALLEY_TYPES,
  VENT_TYPES, WASTE_OPTIONS,
  type CatalogLists, type RoofSystem, type Underlayment,
} from "@/lib/roofPackage/catalog";
import {
  buildRoofPackage, checkVentilation, defaultSpec, estimateEdges,
  type RoofFacts, type RoofPackageSpec,
} from "@/lib/roofPackage/takeoff";
import type { BuildEstimateCardProps } from "../roof-estimator-blueprint/build-estimate-card";
import {
  applyPrefs, factsKey, LISTS_KEY, PREFS_KEY, prefsOf, readLocal, reconcile,
  saneLists, writeLocal, type Prefs,
} from "../roof-estimator-blueprint/roof-package-builder";
import styles from "./frontend-card.module.css";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
const count = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
type NumericKey = { [K in keyof RoofPackageSpec]-?: RoofPackageSpec[K] extends number ? K : never }[keyof RoofPackageSpec];
type NumberDefinition = readonly [NumericKey, string, string?];
const PIPE_BOOT_RATES = PIPE_BOOT_SIZES.flatMap((size) => [
  { size, key: "each" as const, label: `Boot ${size.label} material` },
  { size, key: "labor" as const, label: `Boot ${size.label} labor` },
]);

function NumberField({ label, value, onChange, unit, disabled = false }: {
  label: string; value: number; onChange: (value: number) => void; unit?: string; disabled?: boolean;
}) {
  const [text, setText] = React.useState(String(value));
  const [seen, setSeen] = React.useState(value);
  if (value !== seen) {
    setSeen(value);
    if (Number(text.replace(/,/g, "")) !== value) setText(String(value));
  }
  return <label className={styles.field}>
    <span className={styles.label}>{label}{unit && <span className={styles.unit}>{unit}</span>}</span>
    <input className={styles.input} inputMode="decimal" value={text} disabled={disabled} onChange={(event) => {
      const next = event.target.value;
      setText(next);
      const parsed = Number(next.replace(/,/g, ""));
      if (next.trim() && Number.isFinite(parsed) && parsed >= 0) onChange(parsed);
    }} onBlur={() => setText(String(value))} />
  </label>;
}

function SelectField<T extends string>({ label, value, options, onChange, disabled = false }: {
  label: string; value: T; options: ReadonlyArray<{ id: T; label: string }>;
  onChange: (value: T) => void; disabled?: boolean;
}) {
  return <label className={styles.field}>
    <span className={styles.label}>{label}</span>
    <span className={`bp-sel ${styles.selectWrap}`}>
      <select className={`bp-sel-in ${styles.input}`} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </span>
  </label>;
}

function Toggle({ label, checked, onChange, disabled = false }: {
  label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean;
}) {
  return <label className={styles.toggle}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    <span>{label}</span>
  </label>;
}

function Fields({ title, children }: { title?: string; children: React.ReactNode }) {
  return <div className={styles.fieldGroup}>
    {title && <h4 className={styles.groupTitle}>{title}</h4>}
    <div className={styles.fields}>{children}</div>
  </div>;
}

function Detail({ title, summary, annotation, children }: {
  title: string; summary?: string; annotation?: React.ReactNode; children: React.ReactNode;
}) {
  return <details className={styles.detail}>
    <summary className={styles.detailSummary}>
      <span className={styles.detailName}><strong>{title}</strong>{summary && <span>{summary}</span>}</span>
      {annotation && <span className={styles.annotation}>{annotation}</span>}
      <ChevronDown aria-hidden="true" size={18} />
    </summary>
    <div className={styles.detailBody}>{children}</div>
  </details>;
}

function RateFields({ children }: { children: React.ReactNode }) {
  return <details className={styles.rates}>
    <summary>Unit rates <ChevronDown aria-hidden="true" size={16} /></summary>
    <div className={styles.fields}>{children}</div>
  </details>;
}

type PackageProps = Pick<BuildEstimateCardProps, "onBuild" | "onConvert" | "converting" | "builderDisabled"> & {
  facts: RoofFacts; blockReason: string | null;
};

function PackageSheet({ facts, onBuild, onConvert, converting, builderDisabled, blockReason }: PackageProps) {
  const [lists, setLists] = React.useState<CatalogLists>(BUILTIN_LISTS);
  const [spec, setSpec] = React.useState(() => defaultSpec(facts));
  const [source, setSource] = React.useState<"loading" | "org" | "browser">("loading");
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [saveMessage, setSaveMessage] = React.useState("");
  const [manage, setManage] = React.useState<"systems" | "underlayments" | null>(null);
  const [editId, setEditId] = React.useState("");
  const revision = React.useRef(0);
  const disabled = builderDisabled || converting;
  const cannotPrice = disabled || !!blockReason;

  React.useEffect(() => {
    let cancelled = false;
    const initialRevision = revision.current;
    // Start both server and browser on the same markup, then restore this
    // device's defaults before asking for the company's newer version.
    Promise.resolve().then(() => {
      if (cancelled) return null;
      if (revision.current === initialRevision) {
        const localLists = saneLists(readLocal(LISTS_KEY)) ?? BUILTIN_LISTS;
        const localPrefs = readLocal<Prefs>(PREFS_KEY);
        setLists(localLists);
        setSpec((current) => reconcile(applyPrefs(current, localPrefs), localLists));
      }
      return getRoofCatalog();
    }).then((document) => {
      if (cancelled) return;
      if (document && revision.current === initialRevision) {
        const savedLists = saneLists({ systems: document.systems, underlayments: document.underlayments }) ?? BUILTIN_LISTS;
        setLists(savedLists);
        setSpec((current) => reconcile(applyPrefs(current, document.prefs), savedLists));
        writeLocal(LISTS_KEY, savedLists);
        writeLocal(PREFS_KEY, document.prefs);
        setSource("org");
      } else setSource("browser");
    }).catch(() => { if (!cancelled) setSource("browser"); });
    return () => { cancelled = true; };
  }, []);

  const change = (update: (current: RoofPackageSpec) => RoofPackageSpec, preference = true) => {
    revision.current += 1;
    setSpec((current) => {
      const next = update(current);
      if (preference) writeLocal(PREFS_KEY, prefsOf(next));
      return next;
    });
    if (preference) { setDirty(true); setSaveMessage(""); }
  };
  const set = <K extends keyof RoofPackageSpec>(key: K, value: RoofPackageSpec[K], preference = true) => change((current) => ({ ...current, [key]: value }), preference);
  const nums = (definitions: readonly NumberDefinition[], preference = true) => definitions.map(([key, label, unit]) =>
    <NumberField key={key} label={label} unit={unit} value={spec[key]} onChange={(value) => set(key, value as RoofPackageSpec[typeof key], preference)} disabled={disabled} />);
  const updateLists = (next: CatalogLists) => {
    revision.current += 1;
    setLists(next);
    setSpec((current) => {
      const reconciled = reconcile(current, next);
      writeLocal(PREFS_KEY, prefsOf(reconciled));
      return reconciled;
    });
    writeLocal(LISTS_KEY, next);
    setDirty(true);
    setSaveMessage("");
  };
  const pickSystem = (id: string, from = lists) => {
    const row = from.systems.find((system) => system.id === id);
    if (!row) return;
    change((current) => ({ ...current, systemId: row.id, systemName: row.label, systemFamily: row.family,
      systemMatPerSq: row.matPerSq, systemLaborPerSq: row.laborPerSq, wastePct: row.wastePct, capPerFt: row.capPerFt }));
  };
  const pickUnderlayment = (id: string, from = lists) => {
    const row = from.underlayments.find((under) => under.id === id);
    if (row) change((current) => ({ ...current, underlaymentId: row.id, underlaymentName: row.label, underlaymentPerSq: row.perSq }));
  };
  const patchSystem = (id: string, patch: Partial<RoofSystem>) => {
    const next = { ...lists, systems: lists.systems.map((row) => row.id === id ? { ...row, ...patch } : row) };
    updateLists(next);
    if (id === spec.systemId) pickSystem(id, next);
  };
  const patchUnderlayment = (id: string, patch: Partial<Underlayment>) => {
    const next = { ...lists, underlayments: lists.underlayments.map((row) => row.id === id ? { ...row, ...patch } : row) };
    updateLists(next);
    if (id === spec.underlaymentId) pickUnderlayment(id, next);
  };
  const openCatalog = (kind: "systems" | "underlayments") => {
    setManage(manage === kind ? null : kind);
    setEditId(kind === "systems" ? spec.systemId : spec.underlaymentId);
  };
  const addCatalogItem = () => {
    const id = nanoid(8);
    if (manage === "systems") updateLists({ ...lists, systems: [...lists.systems,
      { id, label: "New roof type", family: "asphalt", matPerSq: 0, laborPerSq: 0, wastePct: 10, capPerFt: 0 }] });
    else updateLists({ ...lists, underlayments: [...lists.underlayments, { id, label: "New underlayment", perSq: 0 }] });
    setEditId(id);
  };
  const removeCatalogItem = () => {
    if (manage === "systems" && lists.systems.length > 1) {
      const remaining = lists.systems.filter((row) => row.id !== editId);
      updateLists({ ...lists, systems: remaining }); setEditId(remaining[0].id);
    } else if (manage === "underlayments" && lists.underlayments.length > 1) {
      const remaining = lists.underlayments.filter((row) => row.id !== editId);
      updateLists({ ...lists, underlayments: remaining }); setEditId(remaining[0].id);
    }
  };
  async function saveDefaults() {
    setSaving(true);
    setSaveMessage("");
    const savedRevision = revision.current;
    try {
      const result = await saveRoofCatalog({ version: 1, systems: lists.systems, underlayments: lists.underlayments, prefs: prefsOf(spec) });
      if (result.ok) {
        setSource("org");
        if (savedRevision === revision.current) setDirty(false);
        setSaveMessage("Saved for your company.");
      } else setSaveMessage(`${result.error} Your changes are kept in this browser.`);
    } catch { setSaveMessage("Company save unavailable. Your changes are kept in this browser."); }
    finally { setSaving(false); }
  }

  const pkg = React.useMemo(() => buildRoofPackage(spec, facts), [spec, facts]);
  const vent = React.useMemo(() => checkVentilation(spec, facts), [spec, facts]);
  const materialTotal = pkg.materials.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const laborTotal = pkg.labor.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const total = materialTotal + laborTotal;
  const lowSlope = spec.systemFamily === "low-slope";
  const starterAvailable = !lowSlope && spec.systemFamily !== "metal";
  const steepest = Math.max(0, ...facts.pitchFamilies.map((pitch) => pitch.pitch12));
  const pipeCount = Object.values(spec.pipeBoots).reduce((sum, quantity) => sum + quantity, 0);
  const ventOf = (id: string) => {
    const type = VENT_TYPES.find((row) => row.id === id)!;
    return spec.vents.find((row) => row.id === id) ?? { id, qty: 0, each: type.each, labor: type.labor };
  };
  const setVent = (id: string, patch: Partial<{ qty: number; each: number; labor: number }>) => {
    const next = { ...ventOf(id), ...patch };
    change((current) => ({ ...current, vents: current.vents.some((row) => row.id === id)
      ? current.vents.map((row) => row.id === id ? next : row) : [...current.vents, next] }), patch.each !== undefined || patch.labor !== undefined);
  };
  const setBootPrice = (id: string, key: "each" | "labor", value: number) => {
    const size = PIPE_BOOT_SIZES.find((row) => row.id === id)!;
    change((current) => ({ ...current, pipeBootPrices: {
      ...current.pipeBootPrices,
      [id]: { ...(current.pipeBootPrices[id] ?? { each: size.each, labor: size.labor }), [key]: value },
    } }));
  };
  const activeVents = VENT_TYPES.filter((row) => ventOf(row.id).qty > 0);
  const availableVents = VENT_TYPES.filter((row) => ventOf(row.id).qty <= 0);
  const customPatch = (id: string, patch: Partial<RoofPackageSpec["custom"][number]>) => change((current) => ({
    ...current, custom: current.custom.map((row) => row.id === id ? { ...row, ...patch } : row),
  }), false);
  const editSystem = lists.systems.find((row) => row.id === editId) ?? lists.systems[0];
  const editUnder = lists.underlayments.find((row) => row.id === editId) ?? lists.underlayments[0];
  const wasteOptions = [...new Set([...WASTE_OPTIONS, spec.wastePct])].sort((a, b) => a - b).map((value) => ({ id: String(value), label: `${value}%` }));

  return <>
    <div className={styles.sheet}>
      <aside className={styles.price} aria-label="Package price">
        <span className={styles.kicker}>Package estimate</span>
        <strong className={styles.total} aria-live="polite" aria-atomic="true">{blockReason ? "—" : money(total)}</strong>
        <dl className={styles.costBreakdown}>
          <div><dt>Materials</dt><dd>{blockReason ? "—" : money(materialTotal)}</dd></div>
          <div><dt>Labor</dt><dd>{blockReason ? "—" : money(laborTotal)}</dd></div>
        </dl>
        <span className={styles.priceNote}>{blockReason ?? `${pkg.materials.length + pkg.labor.length} editable lines`}</span>
      </aside>

      <div className={styles.specification}>
        <div className={styles.specHeading}><span className={styles.sectionIndex}>01</span><h3>Choose the roof</h3></div>
        <div className={styles.choices}>
          <div className={styles.mainPick}>
            <SelectField label="Roof system" value={spec.systemId} options={lists.systems} onChange={pickSystem} disabled={disabled} />
            <button type="button" className={styles.textButton} aria-expanded={manage === "systems"} onClick={() => openCatalog("systems")} disabled={disabled}>Edit roof types</button>
          </div>
          <div className={styles.mainPick}>
            <SelectField label="Underlayment" value={spec.underlaymentId} options={lists.underlayments} onChange={pickUnderlayment} disabled={disabled} />
            <button type="button" className={styles.textButton} aria-expanded={manage === "underlayments"} onClick={() => openCatalog("underlayments")} disabled={disabled}>Edit underlayments</button>
          </div>
        </div>
        <div className={styles.materialRates}>
          {nums([["systemMatPerSq", "Material", "$/sq"], ["systemLaborPerSq", "Install labor", "$/sq"]])}
          <SelectField label="Waste" value={String(spec.wastePct)} options={wasteOptions} onChange={(value) => set("wastePct", Number(value))} disabled={disabled} />
        </div>
        {manage && <div className={styles.catalogEditor}>
          <div className={styles.editorHeading}><h4>{manage === "systems" ? "Roof type catalog" : "Underlayment catalog"}</h4>
            <button type="button" className={styles.textButton} onClick={() => setManage(null)}>Done <Check size={16} aria-hidden="true" /></button>
          </div>
          <SelectField label="Edit item" value={manage === "systems" ? editSystem.id : editUnder.id} options={manage === "systems" ? lists.systems : lists.underlayments} onChange={setEditId} disabled={disabled} />
          {manage === "systems" ? <>
            <label className={styles.field}><span className={styles.label}>Roof type name</span><input className={styles.input} value={editSystem.label} disabled={disabled} onChange={(event) => patchSystem(editSystem.id, { label: event.target.value })} /></label>
            <SelectField label="Family" value={editSystem.family} options={ROOF_FAMILIES} onChange={(family) => patchSystem(editSystem.id, { family })} disabled={disabled} />
            <div className={styles.fields}>{([ ["matPerSq", "Material", "$/sq"], ["laborPerSq", "Labor", "$/sq"], ["wastePct", "Waste", "%"], ["capPerFt", "Hip & ridge cap", "$/ft"] ] as const).map(([key, label, unit]) =>
              <NumberField key={key} label={label} unit={unit} value={editSystem[key]} onChange={(value) => patchSystem(editSystem.id, { [key]: value })} disabled={disabled} />)}</div>
          </> : <div className={styles.fields}>
            <label className={styles.field}><span className={styles.label}>Underlayment name</span><input className={styles.input} value={editUnder.label} disabled={disabled} onChange={(event) => patchUnderlayment(editUnder.id, { label: event.target.value })} /></label>
            <NumberField label="Material" unit="$/sq" value={editUnder.perSq} onChange={(perSq) => patchUnderlayment(editUnder.id, { perSq })} disabled={disabled} />
          </div>}
          <div className={styles.editorActions}>
            <button type="button" className={styles.secondaryButton} disabled={disabled} onClick={addCatalogItem}><Plus size={16} aria-hidden="true" /> Add {manage === "systems" ? "roof type" : "underlayment"}</button>
            <button type="button" className={styles.textButton} disabled={disabled || lists[manage].length <= 1} onClick={removeCatalogItem}><Trash2 size={16} aria-hidden="true" /> Remove item</button>
            <button type="button" className={styles.textButton} disabled={disabled} onClick={() => { updateLists(BUILTIN_LISTS); setEditId(manage === "systems" ? BUILTIN_LISTS.systems[0].id : BUILTIN_LISTS.underlayments[0].id); }}>Restore built-in lists</button>
          </div>
        </div>}
      </div>
    </div>

    <div className={styles.takeoff}>
      <div className={styles.takeoffHeading}><span className={styles.sectionIndex}>02</span><h3>Set the scope</h3><span className={styles.subtle}>Open to adjust</span></div>
      <Detail title="Protection & cap" summary={`${spec.underlaymentName} · ${spec.iceWater === "none" ? "no ice & water" : "ice & water included"}`}>
        <SelectField label="Ice & water coverage" value={spec.iceWater} options={ICE_WATER} onChange={(value) => set("iceWater", value)} disabled={disabled} />
        <Fields>{nums([["underlaymentPerSq", "Underlayment", "$/sq"], ...(spec.iceWater !== "none" ? [["iceWaterPerSqft", "Ice & water", "$/sq ft"] as const] : []), ...(!lowSlope ? [["capPerFt", "Hip & ridge cap", "$/ft"] as const] : [])])}</Fields>
      </Detail>
      <Detail title="Edges" summary={`${count(spec.eaveFt)} ft eave · ${count(spec.rakeFt)} ft rake · ${count(spec.ridgeFt)} ft ridge`} annotation={spec.edgesBasis === "estimated" ? "Estimated" : "Entered"}>
        <Fields title="Roof lengths">{([ ["eaveFt", "Eave"], ["rakeFt", "Rake"], ["ridgeFt", "Ridge"], ["hipFt", "Hip"] ] as const).map(([key, label]) =>
          <NumberField key={key} label={label} unit="ft" value={spec[key]} onChange={(value) => change((current) => ({ ...current, [key]: value, edgesBasis: "entered" }), false)} disabled={disabled} />)}</Fields>
        {spec.edgesBasis === "estimated" ? <p className={styles.note}>Lengths estimated from the building outline. Check against the roof.</p> : estimateEdges(facts) &&
          <button type="button" className={styles.textButton} disabled={disabled} onClick={() => { const edges = estimateEdges(facts); if (edges) change((current) => ({ ...current, ...edges, edgesBasis: "estimated" }), false); }}>Use outline estimate</button>}
        <div className={styles.toggles}>
          <Toggle label="Drip edge" checked={spec.dripEdgeOn} onChange={(value) => set("dripEdgeOn", value)} disabled={disabled} />
          {starterAvailable && <Toggle label="Starter strip" checked={spec.starterOn} onChange={(value) => set("starterOn", value)} disabled={disabled} />}
        </div>
        {spec.dripEdgeOn && <Fields>
          <SelectField label="Drip edge profile" value={spec.dripProfileId} options={DRIP_EDGE_PROFILES} onChange={(id) => { const row = DRIP_EDGE_PROFILES.find((item) => item.id === id)!; change((current) => ({ ...current, dripProfileId: id, ...(id !== "custom" ? { dripPerFt: row.perFt } : {}) })); }} disabled={disabled} />
          <SelectField label="Drip edge size" value={spec.dripSizeId} options={DRIP_EDGE_SIZES} onChange={(value) => set("dripSizeId", value)} disabled={disabled} />
        </Fields>}
        <RateFields>{nums([...(spec.dripEdgeOn ? [["dripPerFt", "Drip edge", "$/ft"] as const] : []), ...(starterAvailable && spec.starterOn ? [["starterPerFt", "Starter", "$/ft"] as const] : [])])}</RateFields>
      </Detail>
      <Detail title="Flashing" summary={`${count(spec.valleyCount)} valleys · ${count(spec.stepWallCount)} sidewalls`}>
        <Fields title="Valleys">
          {nums([["valleyCount", "Valleys", "each"], ["valleyFtEach", "Length each", "ft"]], false)}
          <SelectField label="Valley type" value={spec.valleyTypeId} options={VALLEY_TYPES} onChange={(id) => { const row = VALLEY_TYPES.find((item) => item.id === id)!; change((current) => ({ ...current, valleyTypeId: id, ...(id !== "custom" ? { valleyMatPerFt: row.matPerFt, valleyLaborPerFt: row.laborPerFt } : {}) })); }} disabled={disabled} />
        </Fields>
        <Fields title="Sidewalls">
          {nums([["stepWallCount", "Walls", "each"], ["stepWallFtEach", "Length each", "ft"]], false)}
          <SelectField label="Step flashing size" value={spec.stepSizeId} options={STEP_FLASHING_SIZES} onChange={(id) => { const row = STEP_FLASHING_SIZES.find((item) => item.id === id)!; change((current) => ({ ...current, stepSizeId: id, ...(id !== "custom" ? { stepPerPiece: row.perPiece } : {}) })); }} disabled={disabled} />
        </Fields>
        <Fields title="Apron & counter">{nums([["apronFt", "Apron / headwall", "ft"], ["counterFt", "Counter flashing", "ft"]], false)}</Fields>
        <RateFields>{nums([["valleyMatPerFt", "Valley metal", "$/ft"], ["valleyLaborPerFt", "Valley labor", "$/ft"], ["stepPerPiece", "Step piece", "$/ea"], ["stepLaborPerFt", "Step labor", "$/ft"], ["apronPerFt", "Apron", "$/ft"], ["apronLaborPerFt", "Apron labor", "$/ft"], ["counterPerFt", "Counter", "$/ft"], ["counterLaborPerFt", "Counter labor", "$/ft"]])}</RateFields>
      </Detail>
      <Detail title="Pipes, chimneys & curbs" summary={`${count(pipeCount)} pipe boots · ${count(spec.chimneyCount)} chimneys · ${count(spec.curbCount)} curbs`}>
        <Fields title="Pipe boots">{PIPE_BOOT_SIZES.map((row) => <NumberField key={row.id} label={row.label} unit="each" value={spec.pipeBoots[row.id] ?? 0} onChange={(value) => set("pipeBoots", { ...spec.pipeBoots, [row.id]: value }, false)} disabled={disabled} />)}</Fields>
        <Fields title="Chimneys & curbs">
          {nums([["chimneyCount", "Chimneys", "each"], ["curbCount", "Curbs", "each"]], false)}
          <SelectField label="Chimney size" value={spec.chimneySizeId} options={CHIMNEY_SIZES} onChange={(id) => { const row = CHIMNEY_SIZES.find((item) => item.id === id)!; change((current) => ({ ...current, chimneySizeId: id, chimneyEach: row.each, chimneyLabor: row.labor })); }} disabled={disabled} />
        </Fields>
        <RateFields>
          {PIPE_BOOT_RATES.map(({ size, key, label }) => <NumberField key={`${size.id}-${key}`} label={label} unit="$/ea" value={spec.pipeBootPrices[size.id]?.[key] ?? size[key]} disabled={disabled} onChange={(value) => setBootPrice(size.id, key, value)} />)}
          {nums([["chimneyEach", "Chimney kit", "$/ea"], ["chimneyLabor", "Chimney labor", "$/ea"], ["curbEach", "Curb kit", "$/ea"], ["curbLabor", "Curb labor", "$/ea"]])}
        </RateFields>
      </Detail>
      <Detail title="Ventilation" summary={activeVents.length ? activeVents.map((row) => `${count(ventOf(row.id).qty)} ${row.unit === "linear ft" ? "ft" : "×"} ${row.label.split(" · ")[0].toLowerCase()}`).join(" · ") : "No vents added"} annotation={vent ? <span className={vent.ok ? styles.good : styles.attention}>{vent.ok ? "Balanced" : "Check airflow"}</span> : "No footprint"}>
        <p className={styles.note}>{vent ? `${count(vent.requiredSqIn)} sq in required · ${count(vent.exhaustSqIn)} exhaust${vent.poweredExhaust ? ` + ${vent.poweredExhaust} powered` : ""} · ${count(vent.intakeSqIn)} intake.` : "No attic footprint is available for an airflow check."}</p>
        <Toggle label="Balanced system · 1/300 rule" checked={spec.ventBalanced} onChange={(value) => set("ventBalanced", value)} disabled={disabled} />
        {activeVents.map((row) => { const picked = ventOf(row.id); return <div key={row.id} className={styles.itemEditor}>
          <div className={styles.editorHeading}><strong>{row.label}</strong><button type="button" className={styles.iconButton} aria-label={`Remove ${row.label}`} disabled={disabled} onClick={() => setVent(row.id, { qty: 0 })}><Trash2 size={18} aria-hidden="true" /></button></div>
          <span className={styles.note}>{row.role} · {row.nfaSqIn ? `${row.nfaSqIn} sq in${row.unit === "linear ft" ? "/ft" : ""}` : "powered"}</span>
          <Fields><NumberField label="Quantity" unit={row.unit === "linear ft" ? "ft" : "each"} value={picked.qty} onChange={(qty) => setVent(row.id, { qty })} disabled={disabled} />
            <NumberField label="Material" unit={row.unit === "linear ft" ? "$/ft" : "$/ea"} value={picked.each} onChange={(each) => setVent(row.id, { each })} disabled={disabled} />
            <NumberField label="Labor" unit={row.unit === "linear ft" ? "$/ft" : "$/ea"} value={picked.labor} onChange={(labor) => setVent(row.id, { labor })} disabled={disabled} /></Fields>
        </div>; })}
        {availableVents.length > 0 && <SelectField label="Add a vent" value="" options={[{ id: "", label: "Select vent…" }, ...availableVents]} onChange={(id) => { if (id) setVent(id, { qty: 1 }); }} disabled={disabled} />}
      </Detail>
      <Detail title="Tear-off & extras" summary={`${spec.tearOffLayers ? `${spec.tearOffLayers} layer${spec.tearOffLayers === 1 ? "" : "s"} to remove` : "Overlay"} · ${count(spec.plywoodSheets)} deck sheets`}>
        <Fields>
          <SelectField label="Tear-off" value={String(spec.tearOffLayers)} options={[{ id: "0", label: "None · overlay" }, { id: "1", label: "1 layer" }, { id: "2", label: "2 layers" }, { id: "3", label: "3 layers" }]} onChange={(value) => set("tearOffLayers", Number(value) as 0 | 1 | 2 | 3, false)} disabled={disabled} />
          {nums([["plywoodSheets", "Deck sheets", "each"]], false)}
          {nums([["cleanupLump", "Cleanup", "$"], ["safetyLump", "Steep safety", "$"], ["permitLump", "Permit", "$"]])}
        </Fields>
        {steepest < 8 && <p className={styles.note}>Steep safety applies at 8/12 and above. It is excluded from this roof.</p>}
        <RateFields>{nums([["tearOffPerSqLayer", "Tear-off labor", "$/sq/layer"], ["disposalPerSqLayer", "Disposal", "$/sq/layer"], ["plywoodEach", "Deck sheet", "$/ea"], ["plywoodLabor", "Sheet labor", "$/ea"], ["nailsPerSq", "Nails & fasteners", "$/sq"], ["sealantPerSq", "Sealant & collars", "$/sq"]])}</RateFields>
      </Detail>
      <Detail title="Custom items" summary={spec.custom.length ? `${spec.custom.length} custom line${spec.custom.length === 1 ? "" : "s"}` : "Add material or labor"}>
        {spec.custom.map((row, index) => <div className={styles.itemEditor} key={row.id}>
          <div className={styles.editorHeading}><strong>Item {index + 1}</strong><button type="button" className={styles.iconButton} aria-label={`Remove custom item ${index + 1}`} onClick={() => change((current) => ({ ...current, custom: current.custom.filter((item) => item.id !== row.id) }), false)} disabled={disabled}><Trash2 size={18} aria-hidden="true" /></button></div>
          <label className={styles.field}><span className={styles.label}>Item name</span><input className={styles.input} placeholder="e.g. Skylight flashing" value={row.name} disabled={disabled} onChange={(event) => customPatch(row.id, { name: event.target.value })} /></label>
          <Fields>
            <NumberField label="Quantity" value={row.qty} onChange={(qty) => customPatch(row.id, { qty })} disabled={disabled} />
            <SelectField label="Unit" value={row.unit} options={PKG_UNITS.map((unit) => ({ id: unit, label: unit }))} onChange={(unit) => customPatch(row.id, { unit })} disabled={disabled} />
            <NumberField label="Unit price" unit="$" value={row.unitPrice} onChange={(unitPrice) => customPatch(row.id, { unitPrice })} disabled={disabled} />
            <SelectField label="Type" value={row.kind} options={[{ id: "material", label: "Material" }, { id: "labor", label: "Labor" }]} onChange={(kind) => customPatch(row.id, { kind })} disabled={disabled} />
          </Fields>
        </div>)}
        <div className={styles.editorActions}>{(["material", "labor"] as const).map((kind) => <button type="button" key={kind} className={styles.secondaryButton} disabled={disabled} onClick={() => change((current) => ({ ...current, custom: [...current.custom, { id: nanoid(8), name: "", qty: 1, unit: "each", unitPrice: 0, kind }] }), false)}><Plus size={16} aria-hidden="true" /> Add {kind}</button>)}</div>
      </Detail>
    </div>

    <div className={styles.defaults}>
      <span>{source === "loading" ? "Loading rates…" : source === "org" ? "Company rates" : "Browser defaults"}{dirty ? " · changed" : ""}</span>
      <button type="button" className={styles.textButton} disabled={disabled || saving || source === "loading"} onClick={() => void saveDefaults()}>{saving ? "Saving…" : "Save as defaults"}</button>
      {saveMessage && <p className={styles.saveMessage} role="status">{saveMessage}</p>}
    </div>
    <div className={styles.actionBar}>
      <div className={styles.actionAmount}><span>Package total</span><strong>{blockReason ? "—" : money(total)}</strong></div>
      <button type="button" className={styles.secondaryButton} disabled={cannotPrice} onClick={() => onBuild(pkg, spec)}>Review lines</button>
      <button type="button" className={styles.primaryButton} disabled={cannotPrice} onClick={() => onConvert(pkg, spec)}>{converting ? "Creating…" : "Convert to proposal"}<ArrowRight aria-hidden="true" size={18} /></button>
    </div>
  </>;
}

export default function FrontendCard(props: BuildEstimateCardProps) {
  const { isRecon, squares, manual, buildMode, onBuildMode, pitchEntry, facts, output } = props;
  const titleId = React.useId();
  const reasonId = React.useId();
  const validSquares = squares != null && Number.isFinite(squares) && squares > 0;
  const missingPitch = !!pitchEntry && !pitchEntry.value;
  const blockReason = isRecon ? "Aerial preview cannot be priced. Run Instant measure to build an estimate."
    : !validSquares || (facts != null && (!Number.isFinite(facts.squares) || facts.squares <= 0)) ? "Add a roof measurement or enter your takeoff to begin."
      : missingPitch ? "Select the roof pitch to price installation."
        : !facts && buildMode === "package" ? "Roof measurements are needed to build the package."
          : props.builderDisabled && !props.converting ? props.generate.reason ?? "Review the roof measurements before pricing this package." : null;
  const basis = manual ? `${count(manual.squares)} squares · ${manual.pitchLabel} · your takeoff`
    : validSquares ? `${count(squares)} squares${facts?.pitchFamilies.length ? ` · ${facts.pitchFamilies.map((pitch) => `${count(pitch.pitch12)}/12`).join(" + ")}` : ""} · ${facts?.squaresBasis ?? "measured"}` : "Roof measurement required";
  return <section className={styles.card} aria-labelledby={titleId} data-build-card="codex-frontend">
    <header className={styles.header}>
      <div className={styles.heading}><span className={styles.kicker}>Roof estimator</span><h2 id={titleId}>Build an estimate</h2><p className={styles.basis}>{isRecon ? "Aerial preview" : basis}</p></div>
      <div className={styles.modeSwitch} role="group" aria-label="How to build the estimate">
        <button type="button" aria-pressed={buildMode === "package"} onClick={() => onBuildMode("package")}>Roof package</button>
        <button type="button" aria-pressed={buildMode === "ai"} onClick={() => onBuildMode("ai")}><Lightbulb size={16} aria-hidden="true" />Smart estimate</button>
      </div>
    </header>
    {blockReason && <div className={styles.guard} id={reasonId} role="status"><span className={styles.guardMark}>!</span><p>{blockReason}</p>
      {pitchEntry && !isRecon && validSquares && <SelectField label="Roof pitch" value={pitchEntry.value ?? ""} options={[{ id: "", label: "Select pitch…" }, ...pitchEntry.options.map((pitch) => ({ id: pitch, label: pitch }))]} onChange={(pitch) => pitchEntry.onChange(pitch || null)} />}
    </div>}
    {!blockReason && pitchEntry && <div className={styles.pitchStrip}><SelectField label="Entered roof pitch" value={pitchEntry.value ?? ""} options={[{ id: "", label: "Select pitch…" }, ...pitchEntry.options.map((pitch) => ({ id: pitch, label: pitch }))]} onChange={(pitch) => pitchEntry.onChange(pitch || null)} /></div>}
    {buildMode === "package" && facts && !isRecon && validSquares && <PackageSheet key={factsKey(facts)} facts={facts} builderDisabled={props.builderDisabled} converting={props.converting} onBuild={props.onBuild} onConvert={props.onConvert} blockReason={blockReason} />}
    {buildMode === "ai" && !isRecon && <div className={styles.smart}>
      <div><span className={styles.sectionIndex}><Lightbulb size={22} aria-hidden="true" /></span><h3>Start with a draft</h3><p>Materials and labor from your roof measurements. Every line stays editable.</p></div>
      <SelectField label="Waste factor" value={String(props.waste)} options={props.wasteOptions.map((value) => ({ id: String(value), label: `${value}%` }))} onChange={(value) => props.onWaste(Number(value))} disabled={props.generate.busy} />
      <button type="button" className={styles.primaryButton} disabled={props.generate.disabled || props.generate.busy || !!blockReason} aria-describedby={blockReason ? reasonId : undefined} title={props.generate.reason} onClick={props.generate.onClick}>{props.generate.busy ? "Generating…" : "Generate estimate"}<ArrowRight size={18} aria-hidden="true" /></button>
      {props.generate.reason && !blockReason && <p className={styles.note} role="status">{props.generate.reason}</p>}
    </div>}
    <div className={styles.output} data-has-estimate={props.hasEstimate ? "true" : "false"}>{output}</div>
  </section>;
}
