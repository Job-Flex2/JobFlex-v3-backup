# Home portal · the house estimators — design

**Date:** 2026-10-28
**Status:** approved by the owner in chat (2026-10-28): "let people get preliminary estimates for HVAC, fence, roof, Deck Studio and the smart estimator (bath, kitchen) using our models; when they like it they submit, we give it to the contractor, and it opens already priced in the same estimator."
**Surfaces:** `/estimate/jobflex/<trade>` (the website estimators in house mode) · the `/price` cards · the Lead Center · the contractor's offer, lead page and estimators
**Builds on:** phase 1 (`docs/superpowers/specs/2026-10-27-home-portal-price-my-project-design.md`, live) and the website estimators (`lib/webEstimator*.ts`, `actions/webEstimator.ts`, `components/v3/web-estimate/*`, live 2026-10-27).

## Problem

The home portal's row has five cards, but only the roof prices itself; deck, fence, heating & cooling and "any project" send the homeowner to describe the job. The owner wants every card to run JobFlex's own estimator — the whole thing, a rough price — and the lead to arrive in the Lead Center with the estimate, so the contractor who buys it opens it priced in the same tool.

The website estimators already run every one of those estimators for the public — on a contractor's site, for that contractor. Everything in them keys off one shop (`WebShop` from the slug): its price book, its spend, its caps, its brand, and the lead's `organizationId`. The home portal needs the same pages with **JobFlex as the shop** and **the Lead Center as the destination**.

## Decisions

| Question | Decision |
| --- | --- |
| Rebuild each trade on the `/price` shell, or reuse the website estimators? | **Reuse, in a "house mode".** One engine per trade; nothing duplicated. |
| Which trades | **Deck, fence, heating & cooling, any project (smart).** The roof keeps `/price/roof` (its range carries the city index, the budget check, the dashboard resume); the house roof trade stays off so there is one roof flow. |
| Who is the house | **An internal JobFlex organization the admin picks once** on the Lead Center's settings (`SyncState leadCenter:houseOrgId`, the key phase 1 reserved). Until one is picked the house pages are closed (404), never half-open. The org must not be on a card-less trial (`takeTrialCap` would refuse its lookups). Its price books are the defaults; its spend and counters file under it. |
| The price shown | **A range**, the website estimator's own ±12% band of the full package (`priceBand`), never line items. "Rough" is the band and the words, not a second engine. |
| Where the lead goes | **The Lead Center** (`createHomeownerLead`), like the roof: consent recorded with the words shown, source `price:<trade>`, the trade taken as given, the pin kept, and the whole estimate attached beside the lead. Never an org `Lead` on the house org. |
| What the buyer gets | On Accept, the lead's website-estimate record is copied onto the buyer's new org lead (`webLead:<leadId>`), so the lead page's **Open in the estimator** button opens it **priced** in their own Deck Studio / fence / HVAC / smart estimator. The deck already opens priced (the design becomes the buyer's draft); the roof has phase 1's path. Fence, HVAC and smart open today with the address and the words only — this round the seed carries the facts and each of those three estimators opens from them (the drawn fence on the lot, the house facts with the tier picked, the generated lines) — see **Opening priced**. |
| Brand and words | The house pages say **JobFlex** where a shop's name stood: the head, the consent (the Lead Center's own `LEAD_CONSENT_TEXT`, since up to three contractors may call), the fine print ("a local pro confirms on site"), the footer, the homeowner's email ("JobFlex sends it to a local pro"). |
| Caps | The house has its own ceilings: 2,000 estimates a month, 600 estimates an hour and 120 leads an hour, set in code; the per-IP brakes (and the 8 new deck designs an hour per IP) stay as they are. The paid parcel lookups (fence lot, HVAC house) are bounded by those same ceilings — the house org is on no card-less trial, so `takeTrialCap` passes. |

## Goals

- Every `/price` card runs the real estimator and ends on a range.
- A homeowner's submit is a Lead Center lead that carries the whole estimate.
- The contractor who buys it opens the estimate in their own estimator for that trade, with nothing retyped.
- The website estimators keep working for contractors exactly as they do; their checks stay green.

## Non-goals

- No change to the contractor-side website estimators' behaviour, prices or embed.
- No new engine, no new pricing, no city index on the house pages (the shops' pages have none either).
- No EagleView, no Cool Calc for the public.
- The roof stays on `/price/roof`.

## Anti-goals

- A house page that works when no house org is set, filing spend and leads nowhere.
- A homeowner's lead landing on the house org as a contractor lead, invisible to the Lead Center.
- Line items or unit prices on a homeowner's screen.
- A copy change that breaks the contractor-facing pages' words or the checks that pin them.

## Constraints

- No Prisma schema change: the estimate rides in `SyncState` (`leadestimate:<platformLeadId>`), as phase 1 did; the buyer's copy is `webLead:<orgLeadId>`, as the website estimators already store it.
- The house slug is reserved: `jobflex`. `webShopBySlug` answers it from `houseOrgId()`, never from an organization that happens to have the slug.
- Every house action reuses the website estimators' brakes (per-IP) and honeypot; the per-shop ceilings become the house ceilings.
- The repo is public: no customer data in fixtures; the stand uses the synthetic house and the fake Solar.

## The house shop

`webShopBySlug("jobflex")` returns a `WebShop` built from the house org: `id = houseOrgId()`, `name = "JobFlex"`, `slug = "jobflex"`, no logo (the product mark), the platform's blue, no phone or website, `state = null`, and settings with every trade `on`, `show: "range"`, the default spread, `askEmail: true`, no domains, `monthlyCap: 2000`. `isHouse(shop)` is `shop.slug === "jobflex"`.

Gates: `liveShop`, `webPageModel`, `webSmartGate`, `webDeckStart`/`webDeckResume` treat a house shop as live for every trade except roof (off: one roof flow). The add-on billing (`webTradeLive`) is not consulted for the house.

Spend and caps: unchanged code — `noteRequestOrg(shop.id)` files Solar, Regrid, ReportAll and OpenAI under the house org; `takeTrialCap` passes because the house org is not on a card-less trial; `webCapReached` reads the house settings' 2,000; the per-shop hourly brake is 600 for the house.

## The lead

`webLead` and `webDeckSend`, when the shop is the house, call `createHomeownerLead` instead of `createWebLead`:

- `name`, `email` (required for the house: the dashboard and the request page hang off it), `phone`, the estimate's `address/city/state/zip`;
- `projectType` per trade (`PROJECT_TYPE[trade]`), `description` and `scope` = `estimateWords` of the widened estimate (below) — the house's own words ("Priced on JobFlex: …"), since `leadDescription` names "your website" and takes no shop;
- `source: "price:<trade>"`, `consent: { text: LEAD_CONSENT_TEXT, at, ip, page }`;
- `known`: the trade is the homeowner's own for deck, fence and HVAC (`Decking`, `Fencing`, `HVAC`, confidence 1) — `IntakeOptions.known` is widened so the pin is optional: the fence and HVAC pins go with it, a deck without a pin is geocoded as any request is, and the trade still stands. "Any project" (smart) names no trade — the detector reads the brief as for any described request, and parks it for the admin when it cannot;
- `estimate: LeadEstimate` widened (below).

The homeowner lands on `/request/<token>` as the roof does (the house actions hand back `next`, the request page's path, and the pages go there instead of the "Sent to the shop" screen); the request page shows the range; the home dashboard shows the project. The email is required on the house pages (the request page and the dashboard hang off it). The website estimator's own homeowner email goes out in the house's words: a local pro, not JobFlex, will be in touch, with the request page's link.

## The estimate beside the lead

`LeadEstimate` becomes a union: the roof record as it is (`trade: "roof"`), and a web record (`trade: "deck" | "fence" | "hvac" | "smart"`) with the same `range` (dollars: the band's low and high, the mid from the cents), `at`, `budgetCents: null`, no `measurementId`, the homeowner's `note`, and `web: WebEstimateRecord` (the record the website estimators keep: summary, choice, cents, band, show, facts) in place of the roof's `hidden`. The pure readers take both: `estimateShort` prints the band, the choice and the trade; `estimateWords` prints "Priced on JobFlex: {summary} Chose: {choice}. Shown $low–$high (before tax). Note: …"; `suggestedLeadPriceCents` stays $35 (none of these is "measured"); `planNotesFor`/`parsePlanEstimate`/`planRangeWords` and `reopenFromEstimate` are roof-only (no "email me" on the house pages this round) — every reader that touches a roof field narrows on `trade` first: the Lead Center's Priced block, the request page's range box (`lib/requestPortal`), the home dashboard and its reminders (`lib/home/portal`, `lib/home/reminders`), `/price/roof`'s resume, `actions/publicEstimate`'s email, and `openRoofLeadEstimate` (`actions/roofEstimator`), which must refuse a web estimate ("This lead's estimate opens in the fence estimator") rather than read `hidden`.

The Lead Center's Priced block prints the four trades from `web` (the choice, the summary, the band); the offer popup's line is `estimateShort`; `cascade`'s auto price reads the trade's own switch (`leadCenter:autoPrice:<trade>`, each off by default; the settings row gains the four switches).

## The buyer's hand-off

`acceptOfferTx`, inside the same transaction that makes the buyer's lead, when the platform lead carries an estimate with `web`, writes `webLead:<orgLeadId>` = `{ leadId, trade, estimate: web, contact, at }` for the buyer's org — the record the website estimators write — with `estimate.organizationId` set to the buyer and, for the deck, `facts.draftId` and `facts.token` left out: the house's send made a draft in the **house** org's Deck Studio (`sendDeckClientDesign` keeps it there, where the admins can see it); the buyer's copy carries the design only, and `openWebLeadInEstimator`'s second deck branch makes the buyer's own draft from it.

The lead page (`dashboard/leads/[id]`) reads the record for a `WEBSITE` lead **or a `LEAD_CENTER` lead** (today it reads it for a website lead only); for a Lead Center lead the card says "Priced by the homeowner on JobFlex" instead of "From your website estimator". The button is `openWebLeadInEstimator` as it is.

## Opening priced

`startEstimateFromLead` already writes the seed with the lead's id; `openWebLeadInEstimator` already makes the deck draft and the roof's measurement row. The seed itself is one ~4 KB cookie (`lib/estimateSeed`) and cannot carry a drawn fence, a house's footprint or a generated estimate — so nothing is added to it. For the three estimators that open with words only, **the estimator's own page reads the lead's `webLead:<leadId>` record by `seed.leadId`** (the buyer's copy, its `organizationId` the buyer's — checked, with the trade), turns the facts into one typed prop, and the form applies it at open and lands on the priced step:

- **fence** — the record's `points` (local feet from the `pin`), `runsFt`, `type`, `heightFt`, `gates`, `doubles`: the Fence Studio sets the site from the pin (so the points line up), the style and the height, places the gates, traces the path and prices in the buyer's book. The website's style ids are the estimator's own (`FENCE_TYPES`); the double gate is 10 ft on the website and 8 ft in the studio — the buyer's number stands.
- **hvac** — the tier's facts gain, at the website's side, the `site` the homeowner confirmed and the chosen unit's catalog `itemId` (today only the words are kept): the HVAC estimator opens as its own `reopen` does — the site, the job "replace the system", what is there and the gas, the outdoor kind — on the design step with that unit picked and priced in the buyer's book. A lead from before this change (no `site`) is rebuilt from the address, the pin and the square feet.
- **smart** — the record's `facts.estimate` (the `GeneratedEstimate` the price came from, re-validated with `estimateSchema`) and `facts.brief`: Smart Proposal opens at the result with those lines and that brief — no second model call, the same numbers the homeowner saw — in the buyer's method and book once re-priced.

`HANDOFF_WORDS` for those trades say what now happens.

## The `/price` cards

Deck → `/estimate/jobflex/deck`, Fence → `/estimate/jobflex/fence`, Heating & cooling → `/estimate/jobflex/hvac`, Any project → `/estimate/jobflex/smart`. Each card's blurb says what the homeowner does ("Draw your fence on your lot — a range in a minute"). The cards are live only when the house is set; otherwise they keep today's describe links. The house pages get a "← Price another project" link back to `/price`.

## Left to the builder

- The exact words on the house pages (the head says "JobFlex · Price my project"; the fine print "A range from JobFlex's own estimator, not a quote. A local pro confirms on site.").
- Where the settings row's house-org picker (internal organizations only) and the four auto-price switches sit on the Lead Center page.
- The synthetic fixtures for fence (a lot) and HVAC (a parcel) on the stand, and whether the fake servers for Regrid/ReportAll are worth building or the walk types the feet / confirms the house by hand.
- The seams inside the fence, HVAC and smart estimators that take the seed's facts (**Opening priced**).

## Calls made after the builder check (2026-10-28)

- The lead page's card condition and heading (above) — the check found the button renders for `WEBSITE` leads only.
- The deck draft stays in the house org; the buyer's copy drops `draftId`/`token`.
- `known` without a pin (deck) — widened, not dropped; smart goes to the detector.
- House ceilings: leads 120/h; the deck's per-IP start brake unchanged.
- Fence/HVAC/smart open priced through the seed — the owner's words ("it will open already priced out, in the same estimator"); it is the largest part of the build and is planned as three separate tasks so any one can be cut.

## Changed after launch (owner, 2026-10-28)

- **On by default.** The owner found the cards still describing and asked for the estimators to simply be there. The house org now defaults to JobFlex's own oldest internal organization (`resolveHouseOrg`); the Lead Center's box picks another or turns them **off** (stored as `off`). A pick that is deleted or stops being internal falls back to the default.
- **The roof reads MEDIUM imagery for homeowners.** Production showed "We couldn't read your roof from the sky": the public read asked Google for HIGH imagery only, which many US homes lack. It now asks HIGH, then MEDIUM on no coverage (`estimateSolarRoof(..., { minQuality: "MEDIUM" })`); the contractor's measurement stays HIGH-only. Cached reads are versioned (v 2) so earlier empty reads are read again; an empty read logs its reason.
