"use client";

// Settings blueprint — Website estimators pane (2026-10-27).
//
// Owner: "the roofers, if they have their own website … they will pay us $100 or $150 a month to post our roofing
// estimator on their roofing websites, where the clients can go and estimate their roof; if they like the price they
// contact the contractor and it goes into My leads, and the pricing appears in their set-up pricing" — then the same
// for HVAC, fence and Deck Studio (deck $150, roof $179, HVAC $79, fence — no price named, $99 stands in). The form
// loads and saves itself (actions/webEstimator); the phone pane mounts the same piece. In preview (platform admins
// only, nothing billed) until the owner opens it; never on the pricing page.

import { WebEstimatorForm } from "@/components/v3/web-estimator/web-estimator-form";

export function WebsitePane() {
  return (
    <section className="sc" id="website">
      <div className="sc-h">
        <div>
          <div className="sc-t">Your estimators on your website</div>
          <div className="sc-s">Turn a trade on, set what the homeowner sees, and paste one line on your site. Every request lands on My leads with the price they saw.</div>
        </div>
      </div>
      <div className="sc-b">
        <WebEstimatorForm />
      </div>
    </section>
  );
}
