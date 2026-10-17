"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight, Check, ChevronRight, FileText, Layers3, Lightbulb, Plus, Save, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { getRoofCatalog, saveRoofCatalog } from "@/actions/roofCatalog";
import {
  BUILTIN_LISTS, CHIMNEY_SIZES, DRIP_EDGE_PROFILES, DRIP_EDGE_SIZES, ICE_WATER,
  PIPE_BOOT_SIZES, PKG_UNITS, ROOF_FAMILIES, STEP_FLASHING_SIZES, VALLEY_TYPES,
  VENT_TYPES, WASTE_OPTIONS, type CatalogLists, type IceWaterCoverage,
  type PkgUnit, type RoofFamily, type RoofSystem, type Underlayment,
} from "@/lib/roofPackage/catalog";
import {
  buildRoofPackage, checkVentilation, defaultSpec, estimateEdges,
  type RoofFacts, type RoofPackageSpec,
} from "@/lib/roofPackage/takeoff";
import {
  applyPrefs, factsKey, LISTS_KEY, PREFS_KEY, prefsOf, readLocal, reconcile, saneLists, writeLocal, type Prefs,
} from "../roof-estimator-blueprint/roof-package-builder";
import type { BuildEstimateCardProps } from "../roof-estimator-blueprint/build-estimate-card";
import s from "./independent-card.module.css";

const dollars = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const number = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
type Step = "materials" | "scope" | "review";
type Scope = "edges" | "flashing" | "penetrations" | "vents" | "tearoff" | "extras";
type Catalog = "systems" | "underlayments";
type NumericKey = { [K in keyof RoofPackageSpec]-?: RoofPackageSpec[K] extends number ? K : never }[keyof RoofPackageSpec];

function initialSpec(facts: RoofFacts, lists: CatalogLists, preferences: Prefs | Record<string, unknown> | null = null) {
  const base = defaultSpec(facts, lists);
  // Keep rates for every vent, including types with no quantity on this roof.
  // applyPrefs overlays prices only on vent rows present in the base spec.
  base.vents = VENT_TYPES.map((vent) => base.vents.find((row) => row.id === vent.id) ?? { id: vent.id, qty: 0, each: vent.each, labor: vent.labor });
  return reconcile(applyPrefs(base, preferences), lists);
}

function NumberField({ label, value, onChange, unit, disabled }: {
  label: string; value: number; onChange: (n: number) => void; unit?: string; disabled?: boolean;
}) {
  const [draft, setDraft] = React.useState(String(value));
  const [seen, setSeen] = React.useState(value);
  if (value !== seen) {
    setSeen(value);
    if (Number(draft.replace(/,/g, "")) !== value) setDraft(String(value));
  }
  return <label className={s.field}>
    <span>{label}</span>
    <span className={s.numberInput}>
      <input inputMode="decimal" aria-label={label} disabled={disabled} value={draft}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          const next = Number(text.replace(/,/g, ""));
          if (text.trim() && Number.isFinite(next) && next >= 0) onChange(next);
        }}
        onBlur={() => setDraft(String(value))} />
      {unit && <span>{unit}</span>}
    </span>
  </label>;
}

function SelectField({ label, value, options, onChange, disabled }: {
  label: string; value: string; options: readonly { id: string; label: string }[];
  onChange: (v: string) => void; disabled?: boolean;
}) {
  return <label className={s.field}>
    <span>{label}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  </label>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className={s.toggle}>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span>{label}</span>
  </label>;
}

function Group({ title, children, note }: { title: string; children: React.ReactNode; note?: React.ReactNode }) {
  return <section className={s.group}>
    <h4>{title}</h4>
    <div className={s.fields}>{children}</div>
    {note && <div className={s.note}>{note}</div>}
  </section>;
}

function Rates({ children, label = "Edit rates" }: { children: React.ReactNode; label?: string }) {
  return <details className={s.rates}>
    <summary>{label}<Plus size={15} aria-hidden="true" /></summary>
    <div className={s.fields}>{children}</div>
  </details>;
}

function RoofDrawing() {
  return <svg viewBox="0 0 180 110" className={s.drawing} aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="miter">
      <path d="m26 53 65-37 64 37-65 37Z M26 64l64 37 65-37 M26 75l64 37 65-37" />
      <path d="m26 53 43-1 22-36 22 36 42 1 M69 52l21 38 23-38 M69 52h44" />
      <path d="M8 50v29m-4-26 8-6m-8 35 8-6M90 1v8m-5-4h10" />
    </g>
    <path d="m69 52 22-36 22 36Z" fill="currentColor" opacity=".1" />
  </svg>;
}

export default function IndependentCard(props: BuildEstimateCardProps) {
  const headingId = React.useId();
  const { isRecon, squares, manual, buildMode, onBuildMode, pitchEntry, facts, generate } = props;
  const invalidArea = squares != null && (!Number.isFinite(squares) || squares <= 0);
  const missingArea = !facts || squares == null;
  const missingPitch = !!pitchEntry && !pitchEntry.value;
  const blocked = isRecon || missingArea || invalidArea || missingPitch;
  const gate = isRecon
    ? "Run Instant measure to price this roof. Aerial estimates cannot be used for a quote."
    : invalidArea ? "Enter a roof area greater than zero to build an estimate."
      : missingArea ? "Measure the roof or enter your own takeoff to start."
        : missingPitch ? "Select the roof pitch to calculate installation labor." : null;
  const basis = isRecon ? "Aerial estimate" : missingArea ? "Roof size required" : manual ? "Your takeoff" : facts?.squaresBasis === "entered" ? "Entered takeoff" : "Measured roof";

  return <section className={s.card} aria-labelledby={headingId} data-build-card="codex-independent">
    <header className={s.masthead}>
      <div className={s.heading}>
        <span className={s.kicker}>Roof estimator</span>
        <h2 id={headingId}>Build an estimate</h2>
        <div className={s.basis}>
          {squares != null && Number.isFinite(squares) && <strong>{number(squares)} squares</strong>}
          <span>{basis}</span>
          {manual?.pitchLabel && <span>{manual.pitchLabel}</span>}
        </div>
      </div>
      <div className={s.mode} aria-label="Estimate method">
        <button type="button" aria-pressed={buildMode === "package"} onClick={() => onBuildMode("package")}>
          <Layers3 size={17} aria-hidden="true" />Roof package
        </button>
        <button type="button" aria-pressed={buildMode === "ai"} onClick={() => onBuildMode("ai")}>
          <Lightbulb size={17} aria-hidden="true" />Smart estimate
        </button>
      </div>
    </header>

    {gate && <div className={s.gate} role="status"><span className={s.stamp}>Before you price</span><p>{gate}</p></div>}
    {pitchEntry && !isRecon && <div className={s.pitch}>
      <SelectField label="Roof pitch" value={pitchEntry.value ?? ""}
        options={[{ id: "", label: "Select pitch…" }, ...pitchEntry.options.map((p) => ({ id: p, label: p }))]}
        onChange={(v) => pitchEntry.onChange(v || null)} />
      <span className={s.note}>Used to price installation labor.</span>
    </div>}

    {buildMode === "package" && facts && !isRecon && !invalidArea && !missingArea && <PackageWorkbench
      key={factsKey(facts)} {...props} facts={facts} blocked={blocked || props.builderDisabled} />}

    {buildMode === "ai" && <>
      <div className={s.smart}>
        <div className={s.smartIntro}><Lightbulb size={28} aria-hidden="true" /><div><h3>Start with a draft.</h3><p>Materials and labor, ready to edit.</p></div></div>
        <SelectField label="Waste allowance" value={String(props.waste)}
          options={props.wasteOptions.map((w) => ({ id: String(w), label: `${w}%` }))}
          onChange={(v) => props.onWaste(Number(v))} disabled={isRecon} />
        <button type="button" className={s.primary} disabled={blocked || generate.disabled || generate.busy}
          title={gate ?? generate.reason} onClick={generate.onClick}>
          {generate.busy ? "Generating…" : "Generate estimate"}<ArrowRight size={18} aria-hidden="true" />
        </button>
        {generate.reason && !gate && <p className={s.note}>{generate.reason}</p>}
      </div>
      <div className={s.output}>{props.output}</div>
    </>}
    {buildMode === "package" && (!facts || isRecon || invalidArea || missingArea) && props.hasEstimate && <div className={s.output}>{props.output}</div>}
  </section>;
}

function PackageWorkbench(props: BuildEstimateCardProps & { facts: RoofFacts; blocked: boolean }) {
  const { facts, blocked, converting, onBuild, onConvert, output, hasEstimate } = props;
  const [lists, setLists] = React.useState<CatalogLists>(BUILTIN_LISTS);
  const [spec, setSpec] = React.useState(() => initialSpec(facts, BUILTIN_LISTS));
  // The parent may recreate the facts object while editing output. The keyed
  // workbench remounts for a different roof; those unrelated renders must not
  // load defaults over this roof's in-progress entries.
  const [initialFacts] = React.useState(facts);
  const [step, setStep] = React.useState<Step>("materials");
  const [scope, setScope] = React.useState<Scope | null>(null);
  const [manage, setManage] = React.useState<Catalog | null>(null);
  const [editId, setEditId] = React.useState("");
  const [source, setSource] = React.useState<"loading" | "org" | "browser">("loading");
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const changed = React.useRef(false);
  const specRef = React.useRef(spec);
  const listsRef = React.useRef(lists);
  const reviewRef = React.useRef<HTMLDivElement>(null);
  const tabsId = React.useId();

  React.useEffect(() => {
    let active = true;
    // Read browser storage after hydration, then resolve the company copy.
    // Cancellation also protects the keyed workbench when another roof opens.
    Promise.resolve().then(() => {
      if (!active) return;
      const localLists = saneLists(readLocal(LISTS_KEY)) ?? BUILTIN_LISTS;
      const localSpec = initialSpec(initialFacts, localLists, readLocal<Prefs>(PREFS_KEY));
      listsRef.current = localLists;
      specRef.current = localSpec;
      setLists(localLists);
      setSpec(localSpec);
      return getRoofCatalog().then((doc) => {
        if (!active) return;
        if (doc && !changed.current) {
          const orgLists = saneLists({ systems: doc.systems, underlayments: doc.underlayments }) ?? localLists;
          const orgSpec = initialSpec(initialFacts, orgLists, doc.prefs);
          listsRef.current = orgLists;
          specRef.current = orgSpec;
          setLists(orgLists);
          setSpec(orgSpec);
          writeLocal(LISTS_KEY, orgLists);
          writeLocal(PREFS_KEY, prefsOf(orgSpec));
        }
        setSource(doc ? "org" : "browser");
      });
    }).catch(() => { if (active) setSource("browser"); });
    return () => { active = false; };
  }, [initialFacts]);

  const update = (patch: Partial<RoofPackageSpec>, preference = true) => {
    changed.current = true;
    const next = { ...specRef.current, ...patch };
    specRef.current = next;
    setSpec(next);
    if (preference) {
      writeLocal(PREFS_KEY, prefsOf(next));
      setDirty(true);
    }
  };
  const set = <K extends keyof RoofPackageSpec>(key: K, value: RoofPackageSpec[K], preference = true) => update({ [key]: value }, preference);
  const num = (key: NumericKey, label: string, unit?: string, preference = true) => <NumberField key={key} label={label} unit={unit} value={spec[key]} onChange={(n) => set(key, n, preference)} />;
  const updateLists = (next: CatalogLists) => {
    changed.current = true;
    listsRef.current = next;
    setLists(next);
    const nextSpec = reconcile(specRef.current, next);
    specRef.current = nextSpec;
    setSpec(nextSpec);
    writeLocal(LISTS_KEY, next);
    writeLocal(PREFS_KEY, prefsOf(nextSpec));
    setDirty(true);
  };
  const pickSystem = (id: string, from = listsRef.current) => {
    const system = from.systems.find((item) => item.id === id);
    if (system) update({ systemId: id, systemName: system.label, systemFamily: system.family, systemMatPerSq: system.matPerSq, systemLaborPerSq: system.laborPerSq, capPerFt: system.capPerFt, wastePct: system.wastePct });
  };
  const pickUnderlayment = (id: string, from = listsRef.current) => {
    const item = from.underlayments.find((row) => row.id === id);
    if (item) update({ underlaymentId: id, underlaymentName: item.label, underlaymentPerSq: item.perSq });
  };
  const patchSystem = (id: string, patch: Partial<RoofSystem>) => {
    const next = { ...listsRef.current, systems: listsRef.current.systems.map((row) => row.id === id ? { ...row, ...patch } : row) };
    updateLists(next);
    if (specRef.current.systemId === id) pickSystem(id, next);
  };
  const patchUnderlayment = (id: string, patch: Partial<Underlayment>) => {
    const next = { ...listsRef.current, underlayments: listsRef.current.underlayments.map((row) => row.id === id ? { ...row, ...patch } : row) };
    updateLists(next);
    if (specRef.current.underlaymentId === id) pickUnderlayment(id, next);
  };
  const addCatalogItem = () => {
    const id = `${manage === "systems" ? "s" : "u"}_${nanoid(6)}`;
    if (manage === "systems") updateLists({ ...lists, systems: [...lists.systems, { id, label: "New roof type", family: "asphalt", matPerSq: 0, laborPerSq: 0, wastePct: 10, capPerFt: 0 }] });
    else updateLists({ ...lists, underlayments: [...lists.underlayments, { id, label: "New underlayment", perSq: 0 }] });
    setEditId(id);
  };
  const removeCatalogItem = () => {
    if (!manage || lists[manage].length <= 1) return;
    const next = manage === "systems" ? { ...lists, systems: lists.systems.filter((row) => row.id !== editId) } : { ...lists, underlayments: lists.underlayments.filter((row) => row.id !== editId) };
    updateLists(next);
    setEditId(next[manage][0].id);
  };
  const openCatalog = (which: Catalog) => {
    setManage(which);
    setEditId(which === "systems" ? spec.systemId : spec.underlaymentId);
  };
  async function saveDefaults() {
    setSaving(true);
    setNotice("");
    const snapshot = specRef.current;
    const catalog = listsRef.current;
    writeLocal(LISTS_KEY, catalog);
    writeLocal(PREFS_KEY, prefsOf(snapshot));
    try {
      const result = await saveRoofCatalog({ version: 1, systems: catalog.systems, underlayments: catalog.underlayments, prefs: prefsOf(snapshot) });
      if (result.ok) {
        setSource("org");
        if (specRef.current === snapshot && listsRef.current === catalog) setDirty(false);
        setNotice("Company defaults saved.");
      } else setNotice("Saved in this browser. Company save failed; try again.");
    } catch {
      setNotice("Saved in this browser. Company save is unavailable.");
    } finally {
      setSaving(false);
    }
  }

  const pkg = React.useMemo(() => buildRoofPackage(spec, facts), [spec, facts]);
  const ventilation = React.useMemo(() => checkVentilation(spec, facts), [spec, facts]);
  const materials = pkg.materials.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const labor = pkg.labor.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const total = materials + labor;
  const count = pkg.materials.length + pkg.labor.length;
  const lowSlope = spec.systemFamily === "low-slope";
  const starterApplies = !lowSlope && spec.systemFamily !== "metal";
  const steepest = Math.max(0, ...facts.pitchFamilies.map((p) => p.pitch12));
  const ventOf = (id: string) => spec.vents.find((v) => v.id === id) ?? { id, qty: 0, each: VENT_TYPES.find((v) => v.id === id)!.each, labor: VENT_TYPES.find((v) => v.id === id)!.labor };
  const setVent = (id: string, patch: Partial<{ qty: number; each: number; labor: number }>) => {
    const current = specRef.current.vents;
    set("vents", current.some((v) => v.id === id) ? current.map((v) => v.id === id ? { ...v, ...patch } : v) : [...current, { ...ventOf(id), ...patch }]);
  };
  const patchCustom = (id: string, patch: Partial<RoofPackageSpec["custom"][number]>) => set("custom", specRef.current.custom.map((line) => line.id === id ? { ...line, ...patch } : line), false);
  const review = () => {
    onBuild(pkg, spec);
    setStep("review");
    setManage(null);
    requestAnimationFrame(() => reviewRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" }));
  };
  const changeStep = (next: Step) => { setStep(next); setManage(null); setScope(null); };
  const pipeCount = Object.values(spec.pipeBoots).reduce((sum, n) => sum + n, 0);
  const scopeItems: { id: Scope; title: string; summary: string; annotation?: string }[] = [
    { id: "edges", title: "Edges & trim", summary: `${number(spec.eaveFt + spec.rakeFt)} ft perimeter · ${number(spec.ridgeFt + spec.hipFt)} ft cap`, annotation: spec.edgesBasis === "estimated" ? "Check lengths" : undefined },
    { id: "flashing", title: "Flashing", summary: `${spec.valleyCount} valleys · ${spec.stepWallCount} sidewalls` },
    { id: "penetrations", title: "Pipes, chimneys & curbs", summary: `${pipeCount} boots · ${spec.chimneyCount} chimneys · ${spec.curbCount} curbs` },
    { id: "vents", title: "Ventilation", summary: `${spec.vents.filter((v) => v.qty > 0).length} vent types`, annotation: ventilation ? ventilation.ok ? "Balanced" : "Check airflow" : "No attic check" },
    { id: "tearoff", title: "Tear-off & decking", summary: `${spec.tearOffLayers} layers · ${spec.plywoodSheets} deck sheets` },
    { id: "extras", title: "Extras & custom lines", summary: `${spec.custom.length} custom lines · cleanup ${dollars(spec.cleanupLump)}` },
  ];
  const currentSystem = lists.systems.find((item) => item.id === editId);
  const currentUnder = lists.underlayments.find((item) => item.id === editId);

  return <>
    <div className={s.workbench}>
      <div className={s.workspace}>
        <div className={s.steps} role="tablist" aria-label="Build estimate steps">
          {([['materials', 'Materials'], ['scope', 'Roof details'], ['review', 'Review']] as const).map(([id, title], i) => <button key={id} type="button" role="tab" id={`${tabsId}-${id}`} aria-selected={step === id} aria-controls={`${tabsId}-panel`} tabIndex={step === id ? 0 : -1}
            onClick={() => changeStep(id)} onKeyDown={(e) => {
              const steps: Step[] = ["materials", "scope", "review"];
              if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
              e.preventDefault();
              const next = e.key === "Home" ? 0 : e.key === "End" ? 2 : (i + (e.key === "ArrowRight" ? 1 : 2)) % 3;
              changeStep(steps[next]);
              document.getElementById(`${tabsId}-${steps[next]}`)?.focus();
            }}><span>0{i + 1}</span>{title}</button>)}
        </div>

        <div className={s.panel} id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${step}`} ref={reviewRef}>
          {manage ? <>
            <div className={s.editorHeading}><button type="button" className={s.back} onClick={() => setManage(null)}><ArrowLeft size={17} aria-hidden="true" />Materials</button><span className={s.kicker}>Your catalog</span></div>
            <h3 className={s.panelTitle}>{manage === "systems" ? "Roof types" : "Underlayments"}</h3>
            <fieldset disabled={blocked} className={s.unframed}>
              <SelectField label="Choose an item to edit" value={editId} options={lists[manage]} onChange={setEditId} />
              {manage === "systems" && currentSystem && <div className={s.catalogEditor}>
                <label className={s.field}><span>Roof type name</span><input value={currentSystem.label} onChange={(e) => patchSystem(editId, { label: e.target.value })} /></label>
                <SelectField label="Roof family" value={currentSystem.family} options={ROOF_FAMILIES} onChange={(v) => patchSystem(editId, { family: v as RoofFamily })} />
                <div className={s.fields}>
                  <NumberField label="Material" unit="$/sq" value={currentSystem.matPerSq} onChange={(v) => patchSystem(editId, { matPerSq: v })} />
                  <NumberField label="Install labor" unit="$/sq" value={currentSystem.laborPerSq} onChange={(v) => patchSystem(editId, { laborPerSq: v })} />
                  <NumberField label="Waste" unit="%" value={currentSystem.wastePct} onChange={(v) => patchSystem(editId, { wastePct: v })} />
                  <NumberField label="Hip & ridge cap" unit="$/ft" value={currentSystem.capPerFt} onChange={(v) => patchSystem(editId, { capPerFt: v })} />
                </div>
              </div>}
              {manage === "underlayments" && currentUnder && <div className={s.catalogEditor}>
                <label className={s.field}><span>Underlayment name</span><input value={currentUnder.label} onChange={(e) => patchUnderlayment(editId, { label: e.target.value })} /></label>
                <NumberField label="Material" unit="$/sq" value={currentUnder.perSq} onChange={(v) => patchUnderlayment(editId, { perSq: v })} />
              </div>}
              <div className={s.buttonRow}>
                <button type="button" className={s.secondary} onClick={addCatalogItem}><Plus size={17} aria-hidden="true" />Add {manage === "systems" ? "roof type" : "underlayment"}</button>
                <button type="button" className={s.dangerButton} disabled={lists[manage].length <= 1} onClick={removeCatalogItem}><Trash2 size={16} aria-hidden="true" />Remove item</button>
              </div>
              <button type="button" className={s.textButton} onClick={() => { updateLists(BUILTIN_LISTS); setEditId(BUILTIN_LISTS[manage][0].id); setNotice("Built-in catalog restored in this browser."); }}>Restore built-in catalog</button>
            </fieldset>
          </> : step === "materials" ? <>
            <div className={s.materialHeading}><div><h3>Roof materials</h3></div><RoofDrawing /></div>
            <fieldset disabled={blocked} className={s.unframed}>
              <div className={s.layer}>
                <div className={s.layerTitle}><span className={s.layerNumber}>01</span><h4>Roof covering</h4><button type="button" className={s.textButton} onClick={() => openCatalog("systems")}>Edit list</button></div>
                <SelectField label="Roof type" value={spec.systemId} options={lists.systems} onChange={(v) => pickSystem(v)} />
                <Rates label={`Rates & waste · ${spec.wastePct}% allowance`}>
                  {num("systemMatPerSq", "Material", "$/sq")}{num("systemLaborPerSq", "Install labor", "$/sq")}
                  {!lowSlope && num("capPerFt", "Hip & ridge cap", "$/ft")}
                  <SelectField label="Waste" value={String(spec.wastePct)} options={[...new Set([...WASTE_OPTIONS, spec.wastePct])].sort((a, b) => a - b).map((v) => ({ id: String(v), label: `${v}%` }))} onChange={(v) => set("wastePct", Number(v))} />
                </Rates>
              </div>
              <div className={s.layer}>
                <div className={s.layerTitle}><span className={s.layerNumber}>02</span><h4>Underlayment</h4><button type="button" className={s.textButton} onClick={() => openCatalog("underlayments")}>Edit list</button></div>
                <SelectField label="Underlayment type" value={spec.underlaymentId} options={lists.underlayments} onChange={(v) => pickUnderlayment(v)} />
                <SelectField label="Ice & water coverage" value={spec.iceWater} options={ICE_WATER} onChange={(v) => set("iceWater", v as IceWaterCoverage)} />
                <Rates>{num("underlaymentPerSq", "Underlayment", "$/sq")}{spec.iceWater !== "none" && num("iceWaterPerSqft", "Ice & water", "$/sq ft")}</Rates>
              </div>
            </fieldset>
            <button type="button" className={s.next} onClick={() => changeStep("scope")}><span>Next: roof details</span><ArrowRight size={19} aria-hidden="true" /></button>
          </> : step === "scope" ? <>
            {scope ? <>
              <div className={s.editorHeading}><button type="button" className={s.back} onClick={() => setScope(null)}><ArrowLeft size={17} aria-hidden="true" />All roof details</button><span className={s.kicker}>02 / Scope</span></div>
              <h3 className={s.panelTitle}>{scopeItems.find((item) => item.id === scope)?.title}</h3>
              <fieldset disabled={blocked} className={s.unframed}>
                {scope === "edges" && <>
                  <Group title="Lengths" note={spec.edgesBasis === "estimated" ? "Estimated from the outline. Verify these lengths on site." : "Lengths entered by you."}>
                    {([['eaveFt', 'Eave'], ['rakeFt', 'Rake'], ['ridgeFt', 'Ridge'], ['hipFt', 'Hip']] as const).map(([key, label]) => <NumberField key={key} label={label} unit="ft" value={spec[key]} onChange={(v) => update({ [key]: v, edgesBasis: "entered" }, false)} />)}
                  </Group>
                  {estimateEdges(facts) && <button type="button" className={s.textButton} onClick={() => update({ ...estimateEdges(facts)!, edgesBasis: "estimated" }, false)}>Reset to outline estimate</button>}
                  <Group title="Trim">
                    <Toggle label="Include drip edge" checked={spec.dripEdgeOn} onChange={(v) => set("dripEdgeOn", v)} />
                    {starterApplies && <Toggle label="Include starter strip" checked={spec.starterOn} onChange={(v) => set("starterOn", v)} />}
                  </Group>
                  {spec.dripEdgeOn && <Group title="Drip edge">
                    <SelectField label="Profile" value={spec.dripProfileId} options={DRIP_EDGE_PROFILES} onChange={(id) => { const item = DRIP_EDGE_PROFILES.find((p) => p.id === id)!; update({ dripProfileId: id, ...(id !== "custom" ? { dripPerFt: item.perFt } : {}) }); }} />
                    <SelectField label="Face size" value={spec.dripSizeId} options={DRIP_EDGE_SIZES} onChange={(v) => set("dripSizeId", v)} />
                  </Group>}
                  <Rates>{spec.dripEdgeOn && num("dripPerFt", "Drip edge", "$/ft")}{starterApplies && spec.starterOn && num("starterPerFt", "Starter strip", "$/ft")}</Rates>
                </>}
                {scope === "flashing" && <>
                  <Group title="Valleys">
                    {num("valleyCount", "Valley count", "each", false)}{num("valleyFtEach", "Length per valley", "ft", false)}
                    <SelectField label="Valley type" value={spec.valleyTypeId} options={VALLEY_TYPES} onChange={(id) => { const item = VALLEY_TYPES.find((v) => v.id === id)!; update({ valleyTypeId: id, ...(id !== "custom" ? { valleyMatPerFt: item.matPerFt, valleyLaborPerFt: item.laborPerFt } : {}) }); }} />
                  </Group>
                  <Rates>{num("valleyMatPerFt", "Valley material", "$/ft")}{num("valleyLaborPerFt", "Valley labor", "$/ft")}</Rates>
                  <Group title="Sidewalls">
                    {num("stepWallCount", "Wall count", "each", false)}{num("stepWallFtEach", "Length per wall", "ft", false)}
                    <SelectField label="Step flashing size" value={spec.stepSizeId} options={STEP_FLASHING_SIZES} onChange={(id) => { const item = STEP_FLASHING_SIZES.find((v) => v.id === id)!; update({ stepSizeId: id, ...(id !== "custom" ? { stepPerPiece: item.perPiece } : {}) }); }} />
                  </Group>
                  <Rates>{num("stepPerPiece", "Step material", "$/piece")}{num("stepLaborPerFt", "Step labor", "$/ft")}</Rates>
                  <Group title="Apron & counter flashing">{num("apronFt", "Apron / headwall", "ft", false)}{num("counterFt", "Counter flashing", "ft", false)}</Group>
                  <Rates>{num("apronPerFt", "Apron material", "$/ft")}{num("apronLaborPerFt", "Apron labor", "$/ft")}{num("counterPerFt", "Counter material", "$/ft")}{num("counterLaborPerFt", "Counter labor", "$/ft")}</Rates>
                </>}
                {scope === "penetrations" && <>
                  <Group title="Pipe boots">
                    {PIPE_BOOT_SIZES.map((item) => <NumberField key={item.id} label={`Boots · ${item.label}`} value={spec.pipeBoots[item.id] ?? 0} unit="each" onChange={(v) => set("pipeBoots", { ...spec.pipeBoots, [item.id]: v }, false)} />)}
                  </Group>
                  <Rates label="Pipe boot rates">{PIPE_BOOT_SIZES.map((item) => {
                    const price = spec.pipeBootPrices[item.id] ?? { each: item.each, labor: item.labor };
                    return <React.Fragment key={item.id}>
                      <NumberField label={`${item.label} material`} value={price.each} unit="$/ea" onChange={(v) => set("pipeBootPrices", { ...spec.pipeBootPrices, [item.id]: { ...price, each: v } })} />
                      <NumberField label={`${item.label} labor`} value={price.labor} unit="$/ea" onChange={(v) => set("pipeBootPrices", { ...spec.pipeBootPrices, [item.id]: { ...price, labor: v } })} />
                    </React.Fragment>;
                  })}</Rates>
                  <Group title="Chimneys & curbs">
                    {num("chimneyCount", "Chimney count", "each", false)}{num("curbCount", "Curb count", "each", false)}
                    <SelectField label="Chimney size" value={spec.chimneySizeId} options={CHIMNEY_SIZES} onChange={(id) => { const item = CHIMNEY_SIZES.find((v) => v.id === id)!; update({ chimneySizeId: id, chimneyEach: item.each, chimneyLabor: item.labor }); }} />
                  </Group>
                  <Rates>{num("chimneyEach", "Chimney kit", "$/ea")}{num("chimneyLabor", "Chimney labor", "$/ea")}{num("curbEach", "Curb kit", "$/ea")}{num("curbLabor", "Curb labor", "$/ea")}</Rates>
                </>}
                {scope === "vents" && <>
                  <div className={s.ventCheck} data-status={ventilation?.ok ? "good" : "check"}>
                    <strong>{ventilation ? ventilation.ok ? "Airflow balanced" : "Check airflow" : "No attic check"}</strong>
                    <p>{ventilation ? `Needs ${number(ventilation.requiredSqIn)} sq in. Intake ${number(ventilation.intakeSqIn)} · exhaust ${number(ventilation.exhaustSqIn)}${ventilation.poweredExhaust ? ` + ${ventilation.poweredExhaust} powered` : ""}.` : "No footprint is available. Enter the vents this roof needs."}</p>
                  </div>
                  <Toggle label="Balanced system · 1/300 rule" checked={spec.ventBalanced} onChange={(v) => set("ventBalanced", v)} />
                  {VENT_TYPES.filter((item) => ventOf(item.id).qty > 0).map((item) => {
                    const vent = ventOf(item.id);
                    return <div className={s.itemEditor} key={item.id}>
                      <div className={s.itemHeading}><div><h4>{item.label}</h4><span className={s.note}>{item.role} · {item.nfaSqIn ? `${item.nfaSqIn} sq in${item.unit === "linear ft" ? "/ft" : ""}` : "powered"}</span></div><button type="button" className={s.iconButton} aria-label={`Remove ${item.label}`} onClick={() => setVent(item.id, { qty: 0 })}><Trash2 size={17} aria-hidden="true" /></button></div>
                      <NumberField label={`${item.label} quantity`} value={vent.qty} unit={item.unit === "linear ft" ? "ft" : "each"} onChange={(v) => setVent(item.id, { qty: v })} />
                      <Rates><NumberField label={`${item.label} material`} unit={item.unit === "linear ft" ? "$/ft" : "$/ea"} value={vent.each} onChange={(v) => setVent(item.id, { each: v })} /><NumberField label={`${item.label} labor`} unit={item.unit === "linear ft" ? "$/ft" : "$/ea"} value={vent.labor} onChange={(v) => setVent(item.id, { labor: v })} /></Rates>
                    </div>;
                  })}
                  <SelectField label="Add a vent" value="" options={[{ id: "", label: "+ Select vent type…" }, ...VENT_TYPES.filter((item) => ventOf(item.id).qty <= 0)]} onChange={(id) => { if (id) setVent(id, { qty: 1 }); }} />
                </>}
                {scope === "tearoff" && <>
                  <Group title="Existing roof">
                    <SelectField label="Layers to remove" value={String(spec.tearOffLayers)} options={[{ id: "0", label: "None · overlay" }, { id: "1", label: "1 layer" }, { id: "2", label: "2 layers" }, { id: "3", label: "3 layers" }]} onChange={(v) => set("tearOffLayers", Number(v) as 0 | 1 | 2 | 3, false)} />
                    {num("plywoodSheets", "Replace deck sheets", "each", false)}
                  </Group>
                  <Rates>{num("tearOffPerSqLayer", "Tear-off labor", "$/sq/layer")}{num("disposalPerSqLayer", "Disposal", "$/sq/layer")}{num("plywoodEach", "Deck material", "$/sheet")}{num("plywoodLabor", "Deck labor", "$/sheet")}</Rates>
                </>}
                {scope === "extras" && <>
                  <Group title="Job allowances" note={steepest < 8 ? "Steep safety applies at 8/12 and above; it is not charged on this roof." : "Steep safety is included for this roof."}>
                    {num("cleanupLump", "Cleanup", "$")}{num("safetyLump", "Steep safety", "$")}{num("permitLump", "Permit", "$")}
                  </Group>
                  <Rates label="Consumable rates">{num("nailsPerSq", "Nails & fasteners", "$/sq")}{num("sealantPerSq", "Sealant & collars", "$/sq")}</Rates>
                  <h4 className={s.customTitle}>Custom lines</h4>
                  {spec.custom.length === 0 && <p className={s.empty}>Add repairs, skylights, gutters or other work.</p>}
                  {spec.custom.map((line, i) => <div className={s.itemEditor} key={line.id}>
                    <div className={s.itemHeading}><span className={s.kicker}>Line {i + 1}</span><button type="button" className={s.iconButton} aria-label={`Remove custom line ${i + 1}`} onClick={() => set("custom", spec.custom.filter((c) => c.id !== line.id), false)}><Trash2 size={17} aria-hidden="true" /></button></div>
                    <label className={s.field}><span>Item name</span><input value={line.name} placeholder="Describe the work" onChange={(e) => patchCustom(line.id, { name: e.target.value })} /></label>
                    <div className={s.fields}>
                      <NumberField label="Quantity" value={line.qty} onChange={(v) => patchCustom(line.id, { qty: v })} />
                      <SelectField label="Unit" value={line.unit} options={PKG_UNITS.map((u) => ({ id: u, label: u }))} onChange={(v) => patchCustom(line.id, { unit: v as PkgUnit })} />
                      <NumberField label="Unit price" unit="$" value={line.unitPrice} onChange={(v) => patchCustom(line.id, { unitPrice: v })} />
                      <SelectField label="Type" value={line.kind} options={[{ id: "material", label: "Material" }, { id: "labor", label: "Labor" }]} onChange={(v) => patchCustom(line.id, { kind: v as "material" | "labor" })} />
                    </div>
                  </div>)}
                  <div className={s.buttonRow}>{(["material", "labor"] as const).map((kind) => <button key={kind} type="button" className={s.secondary} onClick={() => set("custom", [...spec.custom, { id: nanoid(6), name: "", qty: 1, unit: "each", unitPrice: 0, kind }], false)}><Plus size={17} aria-hidden="true" />{kind === "material" ? "Material" : "Labor"}</button>)}</div>
                </>}
              </fieldset>
              <button type="button" className={s.next} onClick={() => setScope(null)}><span>Done with {scope === "penetrations" ? "penetrations" : scope === "tearoff" ? "tear-off" : scope}</span><Check size={18} aria-hidden="true" /></button>
            </> : <>
              <div className={s.scopeHeading}><span className={s.kicker}>Confirm the scope</span><h3>Roof details</h3></div>
              <div className={s.scopeIndex}>{scopeItems.map((item, i) => <button type="button" key={item.id} className={s.scopeLink} onClick={() => setScope(item.id)}>
                <span className={s.indexNumber}>{String(i + 1).padStart(2, "0")}</span><span className={s.scopeText}><strong>{item.title}</strong><span>{item.summary}</span>{item.annotation && <em>{item.annotation}</em>}</span><ChevronRight size={19} aria-hidden="true" />
              </button>)}</div>
              <button type="button" className={s.next} onClick={() => changeStep("review")}><span>Next: review estimate</span><ArrowRight size={19} aria-hidden="true" /></button>
            </>}
          </> : <>
            <div className={s.reviewHeading}><span className={s.kicker}>Ready for your review</span><h3>Your roof package.</h3><p>{spec.systemName}</p></div>
            <div className={s.reviewTotals}>
              <div><span>Materials</span><strong>{dollars(materials)}</strong></div>
              <div><span>Labor</span><strong>{dollars(labor)}</strong></div>
              <div><span>Package total</span><strong>{dollars(total)}</strong></div>
            </div>
            <div className={s.reviewNotes}><span>{count} line items</span><span>{spec.wastePct}% material waste</span><span>{number(facts.squares)} roof squares</span></div>
            <details className={s.assumptions}><summary>Takeoff assumptions<Plus size={16} aria-hidden="true" /></summary><ul>{pkg.assumptions.map((assumption, i) => <li key={i}>{assumption}</li>)}</ul></details>
            <button type="button" className={s.reviewButton} disabled={blocked || converting} onClick={review}><FileText size={18} aria-hidden="true" />{hasEstimate ? "Refresh estimate lines" : "Build & review lines"}<ArrowRight size={18} aria-hidden="true" /></button>
            <p className={s.note}>Review and edit each line below before making a proposal.</p>
          </>}
        </div>
      </div>

      <aside className={s.summary} aria-label="Package summary">
        <div className={s.summaryTop}><span className={s.kicker}>Package total</span><span className={s.total}>{dollars(total)}</span><p>{count} lines · {number(facts.squares)} squares</p></div>
        <dl className={s.summaryBreakdown}><div><dt>Materials</dt><dd>{dollars(materials)}</dd></div><div><dt>Labor</dt><dd>{dollars(labor)}</dd></div></dl>
        <div className={s.summaryActions}><button type="button" className={s.primary} disabled={blocked || converting} onClick={review}>Review estimate<ArrowRight size={18} aria-hidden="true" /></button><button type="button" className={s.secondary} disabled={blocked || converting} onClick={() => onConvert(pkg, spec)}>{converting ? "Creating…" : "Convert to proposal"}</button></div>
        <div className={s.summaryFoot}><span>{spec.wastePct}% waste included</span>{spec.edgesBasis === "estimated" && <button type="button" onClick={() => { changeStep("scope"); setScope("edges"); }}>Verify estimated edges<ChevronRight size={14} aria-hidden="true" /></button>}</div>
      </aside>
    </div>
    <footer className={s.defaults}>
      <div><span className={s.defaultsLabel}>{source === "loading" ? "Loading saved rates…" : source === "org" ? "Company defaults" : "Browser defaults"}{dirty && " · changed"}</span>{notice && <p role="status">{notice}</p>}</div>
      <button type="button" className={s.textButton} disabled={saving || blocked || source === "loading"} onClick={() => void saveDefaults()}><Save size={16} aria-hidden="true" />{saving ? "Saving…" : "Save as defaults"}</button>
    </footer>
    <div className={s.output} hidden={!hasEstimate}>{output}</div>
  </>;
}
