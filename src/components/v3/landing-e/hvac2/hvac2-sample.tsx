import { Reveal } from "../reveal";
import { Hvac2Cta } from "./hvac2-hero";
import { btu, hvac2Example } from "./hvac2-example";
import { Hvac2SampleTracker } from "./hvac2-sample-tracker";
import "./hvac2.css";

/* HVAC v2 — A FINISHED ESTIMATE, WITHOUT AN ACCOUNT (#sample, 2026-10-19; the
   audit: "let them see what the customer gets"). What the client receives
   for the demo's own house, drawn on the server from the real engine's
   Better-tier estimate (hvac2-example.ts): the address, the load, the unit,
   the lines grouped the way a homeowner reads a bid, the total — and a
   "Send proposal" that only shows where the button is. One column of rows,
   so a phone reads it without sideways scroll. The page's one button and
   its terms follow. */

const usd2 = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function Hvac2Sample({ registerHref, trialCta, terms, hook }: { registerHref: string; trialCta: string; terms: [string, string]; hook?: string }) {
  const x = hvac2Example();
  const s = x.sample;
  return (
    <section id="sample" className="lp-h2-sec lp-h2-sec--sample">
      <Hvac2SampleTracker hook={hook} />
      <div className="mx-auto lp-wrap">
        <Reveal>
          <h2 className="lp-sec-title">See a finished HVAC estimate</h2>
          <p className="lp-sec-lede">What your client opens — no sign-up needed to look. The example house from the demo above, priced at the starter rates you replace with your own.</p>
        </Reveal>
        <article className="lp-h2-doc" aria-label="Sample HVAC proposal">
          <header className="lp-h2-doc-head">
            <div className="lp-h2-doc-kicker">Proposal · example</div>
            <h3 className="lp-h2-doc-title">{s.title.replace(/ — .*/, "")}</h3>
            <div className="lp-h2-doc-addr">{x.address}</div>
          </header>
          <dl className="lp-h2-doc-facts">
            <div><dt>Design load</dt><dd>{btu(x.heatingBtuh)} heating · {btu(x.coolingBtuh)} cooling</dd></div>
            <div><dt>Design day</dt><dd>{x.designCoolF} °F / {x.designHeatF} °F · {x.county} County, {x.state}</dd></div>
            <div><dt>Equipment</dt><dd>{s.unit}, matched air handler, backup heat</dd></div>
          </dl>
          <ul className="lp-h2-doc-lines">
            {s.lines.map((l) => (
              <li key={l.name}><span>{l.name}</span><b>{usd2(l.amount)}</b></li>
            ))}
            <li className="lp-h2-doc-sum"><span>Total</span><b>{usd2(s.total)}</b></li>
          </ul>
          <footer className="lp-h2-doc-foot">
            <button type="button" className="lp-h2-doc-send" disabled aria-disabled="true">Send proposal</button>
            <span>Demonstration — on your account this sends the proposal to your client.</span>
          </footer>
        </article>
        <div className="lp-h2-sample-act">
          <Hvac2Cta href={registerHref} label={trialCta} terms={terms} cta="sample" />
        </div>
      </div>
    </section>
  );
}
