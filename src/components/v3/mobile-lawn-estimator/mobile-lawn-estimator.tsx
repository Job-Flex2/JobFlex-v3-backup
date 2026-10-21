"use client";
// LAWN ESTIMATOR · HANDHELD — /mobile-lawn-estimator-v1 (2026-10-20)
//
// The desk estimator (/dashboard/lawn-estimator, untouched by this route) composed for a phone: the shared MobileNav
// on top, one scrolling column, and on the yard a foot that keeps the season's total and Create proposal in the thumb
// zone. The SAME estimator — state from lawn-estimator/use-lawn-estimator, parts from lawn-estimator/lawn-parts, the
// same server actions — so every function the desk page has is here: the address read, the brushes, count in / leave
// out, undo, as read, view and zoom, the lot line, the reach, the services and what the photo can't see, the client,
// the proposal, the plan, the rates and the saved estimates.
//
// Styles: lawn-estimator.css, the phone section under `.jf-mlawn` (plain stylesheet, not a module).
import * as React from "react";
import { MapPin, Plus, Route as RouteIcon, Save, SlidersHorizontal } from "lucide-react";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { useLawnEstimator, sqft, usd } from "@/components/v3/lawn-estimator/use-lawn-estimator";
import { ErrorNote, MapPanel, Measured, PlanCard, ProposalAction, QuoteCard, RatesCard, ReadingCard, RulesCard, SavedList, SearchForm, SeasonStrip, ServicesCard, SiteFacts, savedWords } from "@/components/v3/lawn-estimator/lawn-parts";
import "@/components/v3/lawn-estimator/lawn-estimator.css";

const BASE = "/mobile-lawn-estimator-v1";

export function MobileLawnEstimator({ initialDraftId }: { initialDraftId?: string | null }) {
  const L = useLawnEstimator({ initialDraftId, basePath: BASE });
  const [showRates, setShowRates] = React.useState(false);
  const scrollRef = React.useRef<HTMLElement>(null);
  // A new phase starts at the top of the page (the read, then the yard).
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [L.phase]);

  const rates = showRates ? (
    <RatesCard
      settings={L.settings}
      own={L.ownRate}
      onSaved={(x) => {
        L.setSettings(x);
        L.setOwnRate(true);
      }}
      onClose={() => setShowRates(false)}
    />
  ) : null;
  const ratesBtn = (
    <button type="button" className={"lw-btn" + (showRates ? " is-on" : "")} onClick={() => setShowRates((v) => !v)} aria-expanded={showRates}>
      <SlidersHorizontal aria-hidden="true" />
      Your rates
    </button>
  );
  const onSite = L.phase === "site" && !!L.site && !!L.labels && !!L.measures && !!L.quote && !!L.lotInfo;

  let body: React.ReactNode;
  if (L.phase === "start") {
    body = (
      <>
        <header className="lw-head">
          <div className="lw-head-text">
            <h1 className="lw-title">Lawn estimator</h1>
            <p className="lw-sub">Measure a yard from its address and price the season.</p>
          </div>
        </header>
        <ErrorNote L={L} />
        <section className="lw-card lw-searchcard" aria-label="Measure a yard" data-lawn-start>
          <SearchForm L={L} />
        </section>
        <div className="lw-head-acts">
          {ratesBtn}
          <a className="lw-btn" href="/dashboard/lawn-estimator/routes" data-lawn-routes-link>
            <RouteIcon aria-hidden="true" />
            Route days
          </a>
        </div>
        {rates}
        <SavedList L={L} />
      </>
    );
  } else if (!onSite) {
    body = (
      <>
        <header className="lw-head">
          <div className="lw-head-text">
            <h1 className="lw-title">Lawn estimator</h1>
            <p className="lw-sub">Reading the property from the air.</p>
          </div>
        </header>
        <div data-lawn-reading>
          <ReadingCard L={L} />
        </div>
      </>
    );
  } else {
    const site = L.site!;
    const m = L.measures!;
    body = (
      <>
        <header className="lw-head" data-lawn-site>
          <div className="lw-head-text">
            <h1 className="lw-title lw-title--entity">
              <MapPin aria-hidden="true" />
              {site.address || site.place}
            </h1>
            <p className="lw-sub">
              {sqft(m.lotSqft)} lot{site.lot.acreage ? ` (${site.lot.acreage.toFixed(2)} acre)` : ""} · {site.place}
              {site.photo ? ` · photo ${new Date(site.photo.date).toLocaleDateString("en-US", { month: "short", year: "numeric" })}` : ""}
            </p>
          </div>
          <div className="lw-head-acts">
            <span className="lw-saved-at" data-lawn-saved>
              {savedWords(L)}
            </span>
            <button type="button" className="lw-btn" onClick={L.startNew}>
              <Plus aria-hidden="true" />
              New
            </button>
            <button type="button" className="lw-btn lw-btn--primary" onClick={() => void L.save()} disabled={!!L.busy} data-lawn-save>
              <Save aria-hidden="true" />
              Save
            </button>
          </div>
        </header>
        <ErrorNote L={L} />
        <MapPanel L={L} compact />
        <Measured L={L} />
        <QuoteCard L={L} noAction />
        <ServicesCard L={L} />
        <PlanCard L={L} />
        <SeasonStrip visits={L.calendar} />
        <SiteFacts L={L} />
        <RulesCard L={L} />
        <div className="lw-head-acts">{ratesBtn}</div>
        {rates}
      </>
    );
  }

  return (
    <div className="jf-mlawn">
      <MobileNav />
      <main className="mlw-scroll" ref={scrollRef}>
        <div className="mlw-content">{body}</div>
      </main>
      {onSite ? (
        <footer className="mlw-foot" aria-label="The season">
          <div className="mlw-foot-sum">
            <span className="mlw-foot-l">The season</span>
            <span className="mlw-foot-v">{usd(L.season)}</span>
            <span className="mlw-foot-m">{usd(L.season / 12)} a month</span>
          </div>
          <ProposalAction L={L} />
        </footer>
      ) : null}
    </div>
  );
}
