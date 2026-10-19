"use client";

/* HVAC v2 — A FINISHED ESTIMATE, BEFORE SIGNING UP (#sample, 2026-10-19; the
   audit: "let them see what the customer gets"). The HVAC page's own example
   proposal (landing-groups HVAC_PROPOSAL — the job the proposal and portal
   sections carry), inline as the document it is: the head, the lines, the
   total, the option the client can add. Closed it shows the head, the short
   lines and the total; "See every line" opens the rest in place — no modal,
   so a phone keeps its scroll and its back button.

   `sample_open` (traffic-contract) once per load: from the hero's or the
   steps' link to #sample (which also opens it) or from the button here. */

import { useCallback, useEffect, useRef, useState } from "react";
import { trackTraffic } from "@/lib/traffic-client";
import { TRAFFIC_EVENTS } from "@/lib/traffic-contract";
import type { ProposalContent } from "../landing-groups";
import { Reveal } from "../reveal";
import { HVAC2_EVENT } from "./demo-media";

export function Hvac2Sample({ proposal, registerHref }: { proposal: ProposalContent; registerHref: string }) {
  const [open, setOpen] = useState(false);
  const sent = useRef(false);
  const reveal = useCallback((from: "hero-link" | "steps-link" | "button") => {
    setOpen(true);
    if (sent.current) return;
    sent.current = true;
    trackTraffic(TRAFFIC_EVENTS.sampleOpen, { from, ...HVAC2_EVENT });
  }, []);

  // The links to #sample elsewhere on the page open it as they take the visitor here.
  useEffect(() => {
    const onClick = (ev: MouseEvent) => {
      const a = ev.target instanceof Element ? ev.target.closest<HTMLElement>("[data-sample-link]") : null;
      if (!a) return;
      reveal(a.closest("#hero") ? "hero-link" : "steps-link");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [reveal]);

  const p = proposal;
  return (
    <section id="sample" className="lp-h2-sec lp-h2-sec--sample">
      <div className="mx-auto lp-wrap">
        <Reveal>
          <h2 className="lp-sec-title">See a finished HVAC estimate</h2>
          <p className="lp-sec-lede">What your customer opens: the system, every line priced, the total and the upgrade they can add themselves.</p>
        </Reveal>
        <div className="lp-h2-doc" data-open={open ? "1" : undefined}>
          <div className="lp-h2-doc-head">
            <div>
              <div className="lp-h2-eyebrow">Proposal #{p.number} · example</div>
              <h3 className="lp-h2-doc-title">{p.title}</h3>
              <div className="lp-h2-doc-client">Prepared for {p.client}</div>
            </div>
            <div className="lp-h2-doc-total">
              <span>Total</span>
              <b>{p.total}</b>
            </div>
          </div>
          <ul className="lp-h2-doc-lines lp-h2-doc-lines--short">
            {p.linesMobile.map(([k, v]) => (
              <li key={k}><span>{k}</span><b>{v}</b></li>
            ))}
          </ul>
          <div className="lp-h2-doc-more" id="hvac2-sample-more" hidden={!open}>
            <p className="lp-h2-doc-scope">{p.blurb}</p>
            <ul className="lp-h2-doc-lines">
              {p.linesDesktop.map(([k, v]) => (
                <li key={k}><span>{k}</span><b>{v}</b></li>
              ))}
              <li className="lp-h2-doc-sum"><span>Total</span><b>{p.total}</b></li>
            </ul>
            <div className="lp-h2-doc-option">
              <div>
                <b>{p.option.name}</b>
                <span>{p.option.note}</span>
              </div>
              <b>{p.option.price}</b>
            </div>
          </div>
          {!open ? (
            <button type="button" className="lp-h2-doc-toggle" aria-expanded={false} aria-controls="hvac2-sample-more" onClick={() => reveal("button")}>
              See every line <span aria-hidden>↓</span>
            </button>
          ) : null}
        </div>
        <div className="lp-h2-after">
          <a href={registerHref} className="lp-btn-lime" data-cta="sample">
            Build one for your next job → Start free trial
          </a>
        </div>
      </div>
    </section>
  );
}
