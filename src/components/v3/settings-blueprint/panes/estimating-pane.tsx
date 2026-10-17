"use client";

// Settings blueprint — Estimating pane (2026-10-16).
//
// A trial contractor asked for Smart Proposal and the video estimator to price the way the company does — a 2-person
// crew at $220 per crew-hour, 30% on materials, no overhead or profit, its own sales-tax rule — without fixing every
// proposal by hand. Owner: an option for every company, per crew-hour or per person-hour, OFF by default. The form
// loads and saves itself (actions/companyPricing); the phone pane mounts the same piece.

import { CompanyPricingForm } from "@/components/v3/company-pricing/company-pricing-form";

export function EstimatingPane() {
  return (
    <section className="sc" id="estimating">
      <div className="sc-h">
        <div>
          <div className="sc-t">Your estimating method</div>
          <div className="sc-s">Turn it on and every new Smart Proposal and video estimate is priced with your numbers.</div>
        </div>
      </div>
      <div className="sc-b">
        <CompanyPricingForm />
      </div>
    </section>
  );
}
