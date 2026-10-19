import type { ReactNode } from "react";
import { Reveal } from "../reveal";
import { btu, hvac2Example, TIER_NAME, usd } from "./hvac2-example";
import "./hvac2.css";

/* HVAC v2 — RIGHT UNDER THE HERO (2026-10-19; the audit: "the visitor does
   not believe an address is enough — show where every number comes from").

   1. "How can you estimate HVAC from just an address?" — three cards, each
      with the example house's own figures and where each one came from:
      the property record and the building outline, the inputs the
      contractor reviews, and the Manual J-based load with the sizing, the
      equipment and the code checks.
   2. The four steps as one strip — ENTER PROPERTY → REVIEW INPUTS → CHECK
      RESULTS → CREATE PROPOSAL — each with a small frame of that step drawn
      from the same run, then the button ("after-demo").

   Every figure is the real engine's on the demo's house (hvac2-example.ts)
   and every claim stays inside the HVAC claims review (landing-variants.ts,
   hvac2): Manual J-based, the county's design day, six states' code rules
   plus the federal floors, sources named, no duct design. Static — the only
   motion is the page's Reveal. */

type Tag = "record" | "read" | "default" | "stated" | "result";
const TAG_WORD: Record<Tag, string> = { record: "Record", read: "Read", default: "Default", stated: "Stated", result: "Result" };

function Stamp({ tag }: { tag: Tag }) {
  return <span className={`lp-h2-stamp lp-h2-stamp--${tag}`}>{TAG_WORD[tag]}</span>;
}

function Row({ k, v, src, tag }: { k: string; v: string; src: string; tag?: Tag }) {
  return (
    <li className="lp-h2-row">
      <span className="lp-h2-row-k">{k}</span>
      <span className="lp-h2-row-v">{v}</span>
      <span className="lp-h2-row-src">
        {tag ? <Stamp tag={tag} /> : null}
        <span>{src}</span>
      </span>
    </li>
  );
}

function Card({ n, title, body, children }: { n: string; title: string; body: string; children: ReactNode }) {
  return (
    <article className="lp-h2-card">
      <div className="lp-h2-card-top">
        <div className="lp-h2-eyebrow">{n}</div>
        <h3 className="lp-h2-card-title">{title}</h3>
        <p className="lp-h2-card-body">{body}</p>
      </div>
      <div className="lp-h2-card-mock">{children}</div>
    </article>
  );
}

export function Hvac2How() {
  const x = hvac2Example();
  return (
    <section id="how" className="lp-h2-sec">
      <div className="mx-auto lp-wrap">
        <Reveal>
          <h2 className="lp-sec-title">How can you estimate HVAC from just an address?</h2>
          <p className="lp-sec-lede">The address opens the house&apos;s public record. You check what the record can&apos;t know. The load, the sizing and the price follow — and every number says where it came from.</p>
        </Reveal>
        <Reveal delay={120} className="lp-h2-cards">
          <Card n="01 · The house" title="Property record & building outline" body="One address pulls the county parcel record, the building outline the pin sits in and the ground elevation. Each fact shows its source.">
            <div className="lp-h2-mock-head">
              <span>{x.address}</span>
              <span>example house</span>
            </div>
            <ul className="lp-h2-rows">
              <Row k="Living area" v={`${x.livingSqft.toLocaleString("en-US")} sq ft`} src="county parcel record" tag="record" />
              <Row k="Year built" v={String(x.yearBuilt)} src="county parcel record" tag="record" />
              <Row k="Storeys" v={String(x.storeys)} src="county parcel record" tag="record" />
              <Row k="Building outline" v="footprint & wall bearings" src="outline at the pin" tag="record" />
              <Row k="Ground elevation" v={`${x.elevationFt} ft`} src="USGS 3DEP lidar" tag="record" />
              <Row k="Design day" v={`${x.designCoolF} °F / ${x.designHeatF} °F`} src={`${x.county} County, ${x.state}`} tag="record" />
            </ul>
          </Card>
          <Card n="02 · You" title="You review every input" body="Insulation, glass, ducts and the nameplates of what is there now. A photo of a plate is read for you; type over anything and it is yours.">
            <ul className="lp-h2-rows">
              <Row k="Attic insulation" v={x.ceilingInsulation} src={`${x.yearBuilt} era`} tag="default" />
              <Row k="Wall insulation" v={x.wallInsulation} src={`${x.yearBuilt} era`} tag="default" />
              <Row k="Windows" v={x.windowType} src={`${x.yearBuilt} era`} tag="default" />
              <Row k="Outdoor unit" v={x.outdoor} src="nameplate photo" tag="read" />
              <Row k="Furnace" v={x.indoor} src="nameplate photo" tag="read" />
              <Row k="Ducts" v="crawlspace · fair" src="typed on the walk" tag="stated" />
            </ul>
            <p className="lp-h2-mock-note">Any value can be overridden — the estimate re-runs as you type.</p>
          </Card>
          <Card n="03 · The math" title="Manual J-based load → sizing, equipment, code checks" body={`A Manual J-based block load on ${x.county} County's design day, the unit from your catalog that fits it, and the code checks behind it — state rules for CA, WA, OR, FL, TX and NY, federal floors everywhere.`}>
            <ul className="lp-h2-rows">
              <Row k="Heating load" v={btu(x.heatingBtuh)} src="block load" tag="result" />
              <Row k="Cooling load" v={`${btu(x.coolingBtuh)} · ${x.coolingTons.toFixed(1)} t`} src="block load" tag="result" />
              <Row k="Sized" v={x.chosen} src="your catalog" tag="result" />
            </ul>
            <div className="lp-h2-checks-tally" aria-label={`${x.checks.pass} checks pass, ${x.checks.fix} to fix, ${x.checks.verify} to verify`}>
              <span><b>{x.checks.pass}</b> pass</span>
              <span><b>{x.checks.fix}</b> to fix</span>
              <span><b>{x.checks.verify}</b> to verify</span>
            </div>
          </Card>
        </Reveal>
      </div>
    </section>
  );
}

const STEPS = ["Enter property", "Review inputs", "Check results", "Create proposal"] as const;

export function Hvac2Steps({ registerHref, trialCta }: { registerHref: string; trialCta: string }) {
  const x = hvac2Example();
  const better = x.tiers.find((t) => t.tier === "mid");
  const frames: ReactNode[] = [
    <div key="1" className="lp-h2-mini">
      <div className="lp-h2-mini-field">
        <svg viewBox="0 0 16 16" aria-hidden><path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 1 0-9 0C3.5 9.8 8 14 8 14z" /><circle cx="8" cy="6.5" r="1.6" /></svg>
        <span>{x.address}</span>
      </div>
      <div className="lp-h2-mini-chips">
        <span>{x.livingSqft.toLocaleString("en-US")} sq ft</span>
        <span>built {x.yearBuilt}</span>
        <span>{x.county} Co. · {x.designCoolF}/{x.designHeatF} °F</span>
      </div>
    </div>,
    <div key="2" className="lp-h2-mini">
      <ul className="lp-h2-mini-rows">
        <li><span>{x.outdoor.split(" · ")[0]}</span><Stamp tag="read" /></li>
        <li><span>Attic {x.ceilingInsulation}</span><Stamp tag="default" /></li>
        <li><span>Ducts · crawlspace</span><Stamp tag="stated" /></li>
      </ul>
    </div>,
    <div key="3" className="lp-h2-mini">
      <div className="lp-h2-mini-load">
        <div><b>{Math.round(x.heatingBtuh / 100) / 10}k</b><span>heat BTU/h</span></div>
        <div><b>{x.coolingTons.toFixed(1)} t</b><span>cooling</span></div>
        <div><b>{x.chosenTons}</b><span>{x.chosen.replace(/^\S+\s/, "")}</span></div>
      </div>
      <div className="lp-h2-mini-tally"><span>{x.checks.pass} pass</span><span>{x.checks.fix} fix</span><span>{x.checks.verify} verify</span></div>
    </div>,
    <div key="4" className="lp-h2-mini">
      <div className="lp-h2-mini-tiers">
        {x.tiers.map((t) => (
          <div key={t.tier} className={t.tier === "mid" ? "is-picked" : undefined}>
            <span>{TIER_NAME[t.tier] ?? t.tier}</span>
            <b>{usd(t.subtotal)}</b>
          </div>
        ))}
      </div>
      <div className="lp-h2-mini-btn">Convert to proposal{better ? ` · ${usd(better.subtotal)}` : ""}</div>
    </div>,
  ];
  return (
    <section id="steps" className="lp-h2-sec lp-h2-sec--steps">
      <div className="mx-auto lp-wrap">
        <Reveal>
          <h2 className="lp-h2-sec-title">Address to proposal, in four steps</h2>
        </Reveal>
        <Reveal delay={100}>
          <ol className="lp-h2-steps">
            {STEPS.map((s, i) => (
              <li key={s} className="lp-h2-step">
                <div className="lp-h2-step-head">
                  <span className="lp-h2-step-n">{i + 1}</span>
                  <span className="lp-h2-step-name">{s}</span>
                </div>
                {frames[i]}
              </li>
            ))}
          </ol>
        </Reveal>
        <div className="lp-h2-after">
          <a href={registerHref} className="lp-btn-lime lp-trial-cta" data-cta="after-demo">
            {trialCta}
            <span aria-hidden>→</span>
          </a>
          <a href="#sample" className="lp-h2-after-link" data-sample-link>See a finished estimate first</a>
        </div>
      </div>
    </section>
  );
}
