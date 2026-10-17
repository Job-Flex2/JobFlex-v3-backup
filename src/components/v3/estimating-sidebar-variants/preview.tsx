"use client";

import { useEffect, useRef, useState } from "react";
import { Sidebar } from "../blueprint-shell/sidebar";
import { Sprite } from "../blueprint-shell/sprite";
import { BlueprintLoadingCard } from "../blueprint-estimator/blueprint-loading-card";
import dashboard from "../dashboard-blueprint/blueprint.module.css";
import blueprint from "../blueprint-estimator/blueprint-estimator.module.css";
import "../dashboard-blueprint/blueprint-global.css";
import s from "./preview.module.css";
import Variant1 from "./variant-1";
import Variant2 from "./variant-2";
import Variant3 from "./variant-3";
import Variant4 from "./variant-4";
import Variant5 from "./variant-5";

const VARIANTS = [Variant1, Variant2, Variant3, Variant4, Variant5];
const NAMES = ["Native list", "Directory", "Ruled list", "Collapsible section", "Tool disclosures"];

export function EstimatingToolsPreview() {
  const [variant, setVariant] = useState(0);
  const [active, setActive] = useState("/dashboard/roof-estimator");
  const [step, setStep] = useState(0);
  const [cancelled, setCancelled] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);
  const Variant = VARIANTS[variant];
  useEffect(() => {
    const scroll = toolsRef.current?.closest(".sb-scroll");
    if (scroll && toolsRef.current) scroll.scrollTop = toolsRef.current.offsetTop - 20;
  }, [variant]);
  return (
    <div className={`${dashboard.bp} jf-blueprint ${s.preview}`} data-page="dashboard">
      <Sprite />
      <header className={s.header} data-nest>
        <p>DESIGN PREVIEW</p>
        <h1>Estimating tools</h1>
        <p>Five simple treatments inside the existing JobFlex sidebar. Select a tool or expand its inventory.</p>
        <div className={s.choices} role="group" aria-label="Sidebar variants">
          {NAMES.map((name, i) => <button key={name} type="button" aria-pressed={variant === i} onClick={() => setVariant(i)}>{i + 1}. {name}</button>)}
        </div>
      </header>
      <div className={s.layout}>
        <div className={s.sidebarFrame} onClickCapture={(event) => {
          const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("[data-variant-tools] a");
          if (link) { event.preventDefault(); setActive(link.getAttribute("href") ?? active); }
        }}>
          <Sidebar user={{ name: "Design preview", role: "Owner" }} renderEstimatingTools={(items) => (
            <div ref={toolsRef} data-variant-tools><Variant key={variant} items={items} activeHref={active} /></div>
          )} />
        </div>
        <main className={s.main} data-nest>
          <h2>{variant + 1}. {NAMES[variant]}</h2>
          <p>The sidebar remains one navigation surface. These are review options; the live sidebar has not been replaced.</p>
          <h2>Blueprint loading card</h2>
          <p>The same compact frame, spacing, progress bar and square step markers as roof estimating.</p>
          <div className={s.choices} role="group" aria-label="Preview loading stages">
            {["Reading", "Scoping", "Measuring", "Pricing"].map((name, i) => <button key={name} type="button" aria-pressed={!cancelled && step === i} onClick={() => { setStep(i); setCancelled(false); }}>{name}</button>)}
          </div>
          <div className={blueprint.be}>
            {cancelled ? <p role="status">Preview cancelled. Choose a stage to show the card again.</p> : <BlueprintLoadingCard request="House" step={step} readDone={2} readTotal={8} hint={step === 0 ? "2 of 8 sheets read. Floor plans and schedules first." : "The estimate opens as soon as the measurements and pricing are ready."} onCancel={() => setCancelled(true)} />}
          </div>
        </main>
      </div>
    </div>
  );
}
