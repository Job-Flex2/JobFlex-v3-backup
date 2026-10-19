import type { ReactNode } from "react";
import { Reveal } from "../reveal";
import { btu, hvac2Example } from "./hvac2-example";
import "./hvac2.css";

/* HVAC v2 — THE ANSWER TO THE SKEPTIC, right under the hero (2026-10-19; the
   audit: "the visitor does not believe an address is enough"). "Where do
   the numbers come from?" — three cards, each with the example house's own
   figures and where each one came from — then the four steps as one strip.

   Only what the code does (src/actions/hvacEstimator hvacSiteFacts,
   src/lib/hvac): the county parcel record (with the state assessor or the
   parcel service filling a gap), the building footprint at the pin, the
   ground elevation (USGS 3DEP), the county's ASHRAE design day; every model
   field typed over by hand; a Manual J-based block load at estimating grade,
   the unit picked from the shop's own catalog inside the Manual S window,
   code checks for six states plus the federal floors. No duct design, no
   permits filed. The figures are the real engine's on the demo's house
   (hvac2-example.ts). Static — the only motion is the page's Reveal. */

type Tag = "record" | "read" | "default" | "you" | "result";
const TAG_WORD: Record<Tag, string> = { record: "record", read: "plate photo", default: "era default", you: "you typed it", result: "calculated" };

function Row({ k, v, src, tag }: { k: string; v: string; src?: string; tag: Tag }) {
  return (
    <li className="lp-h2-row">
      <span className="lp-h2-row-k">{k}</span>
      <span className="lp-h2-row-v">{v}</span>
      <span className="lp-h2-row-src">
        <i className={`lp-h2-dot lp-h2-dot--${tag}`} aria-hidden />
        {src ?? TAG_WORD[tag]}
      </span>
    </li>
  );
}

function Card({ title, body, children }: { title: string; body: ReactNode; children: ReactNode }) {
  return (
    <article className="lp-h2-card">
      <div className="lp-h2-card-top">
        <h3 className="lp-h2-card-title">{title}</h3>
        <p className="lp-h2-card-body">{body}</p>
      </div>
      <div className="lp-h2-card-mock">{children}</div>
    </article>
  );
}

const STEPS = ["Enter property", "Review inputs", "Check results", "Create proposal"] as const;

export function Hvac2Skeptic() {
  const x = hvac2Example();
  const better = x.tiers.find((t) => t.tier === "mid");
  const stepNotes = [
    `${x.address.split(",")[0]} → ${x.livingSqft.toLocaleString("en-US")} sq ft, built ${x.yearBuilt}, ${x.county} County`,
    "Plates read, ducts typed, every default visible",
    `${btu(x.heatingBtuh)} heat · ${x.coolingTons.toFixed(1)} t cool → ${x.chosen}`,
    better ? `Good · Better · Best, every line priced — Better at $${better.subtotal.toLocaleString("en-US")}` : "Good · Better · Best, every line priced",
  ];
  return (
    <section id="skeptic" className="lp-h2-sec">
      <div className="mx-auto lp-wrap">
        <Reveal>
          <h2 className="lp-sec-title">Where do the numbers come from?</h2>
          <p className="lp-sec-lede">From the house&apos;s public record, from what you check on site, and from the standard load method — and every figure says which.</p>
        </Reveal>
        <Reveal delay={120} className="lp-h2-cards">
          <Card
            title="Property data"
            body="One address pulls the county parcel record — living area, year built, storeys — the building footprint at the pin, the ground elevation and the county's design temperatures. Each fact shows its source; what no record holds starts at the house era's default."
          >
            <div className="lp-h2-mock-head">
              <span>{x.address}</span>
              <span>example house</span>
            </div>
            <ul className="lp-h2-rows">
              <Row k="Living area" v={`${x.livingSqft.toLocaleString("en-US")} sq ft`} src="county parcel record" tag="record" />
              <Row k="Year built" v={String(x.yearBuilt)} src="county parcel record" tag="record" />
              <Row k="Storeys" v={String(x.storeys)} src="county parcel record" tag="record" />
              <Row k="Footprint" v="outline & wall directions" src="building footprint at the pin" tag="record" />
              <Row k="Ground elevation" v={`${x.elevationFt} ft`} src="USGS 3DEP" tag="record" />
              <Row k="Design day" v={`${x.designCoolF} °F / ${x.designHeatF} °F`} src={`ASHRAE 1% / 99%, ${x.county} County`} tag="record" />
            </ul>
          </Card>
          <Card
            title="Your inputs stay editable"
            body="Every field — conditioned area, storeys, windows, insulation, and the state and county that set the design day — can be changed by hand before the load runs. The estimate re-runs as you type."
          >
            <ul className="lp-h2-rows">
              <Row k="Conditioned area" v={`${x.livingSqft.toLocaleString("en-US")} sq ft`} tag="record" />
              <Row k="Attic insulation" v={x.ceilingInsulation} tag="default" />
              <Row k="Wall insulation" v={x.wallInsulation} tag="default" />
              <Row k="Windows" v={x.windowType} tag="default" />
              <Row k="Outdoor unit" v={x.outdoor} tag="read" />
              <Row k="Ducts" v="crawlspace · fair" tag="you" />
            </ul>
          </Card>
          <Card
            title="Manual J / Manual S"
            body={<>A Manual J-based block load on the county&apos;s design day, then the unit from your own equipment catalog that falls inside the Manual S sizing window, with code checks behind it — state rules for CA, WA, OR, FL, TX and NY, federal efficiency floors everywhere. It is an estimating-grade load for pricing, not a signed Manual J report, and it does not design ducts: they are checked against the airflow and a correction is quoted separately.</>}
          >
            <ul className="lp-h2-rows">
              <Row k="Heating load" v={btu(x.heatingBtuh)} tag="result" />
              <Row k="Cooling load" v={`${btu(x.coolingBtuh)} · ${x.coolingTons.toFixed(1)} t`} tag="result" />
              <Row k="Matched unit" v={x.chosen} src="from the shop's catalog" tag="result" />
            </ul>
            <p className="lp-h2-tally">
              {x.checks.pass} checks pass · {x.checks.fix} to fix · {x.checks.verify} to verify on site
            </p>
          </Card>
        </Reveal>
        <Reveal delay={160}>
          <ol className="lp-h2-steps" aria-label="Four steps from address to proposal">
            {STEPS.map((s, i) => (
              <li key={s} className="lp-h2-step">
                <span className="lp-h2-step-n" aria-hidden>{i + 1}</span>
                <span className="lp-h2-step-text">
                  <b>{s}</b>
                  <span>{stepNotes[i]}</span>
                </span>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}
