# Home portal · "Price my project" — design

**Date:** 2026-10-27
**Status:** approved by the owner (2026-10-27) — next: the build plan
**Surfaces:** `/price` and `/price/roof` (public, no login) · the Lead Center lead card · the contractor's lead page and roof estimator hand-off · `/home/[key]` · links from the ad landings, the cost guides and `/homeowner`

## Problem

A homeowner who lands on JobFlex today can describe a project (`/homeowner`) and be matched, or read a city average on a cost guide (`/cost/<trade>/<city>`). Nobody can get a price for *their own house*. The ads bring people who want a number, and a lead that carries a measured, priced estimate is worth more to the contractor who buys it than "I need a roof".

The owner wants JobFlex's own estimators in the home portal: the homeowner types the address, picks what they want, sees a range, and submits it. The lead goes to the Lead Center, where JobFlex prices it and routes it (by hand or automatically) to a contractor who pays for it. Roof first; the other estimators visible in a row from day one, and attractive.

## Decisions taken during brainstorming

| Question | Decision |
| --- | --- |
| Which trade first? | **Roof.** Fence, heating & cooling and "any project" are visible as cards in the same row from day one (owner). |
| Does the homeowner see the range before giving contact details? | **Yes** — the range is the hook; contact comes with "Get quotes". "Email me this range" takes an email only and saves a planned project, not a lead; the Lead Center lists those apart as "Priced, not asking yet" — counts and ranges, no contacts, not sellable (owner). |
| Which measurement makes the range? | **Google Solar's roof read (about 1¢)** for the range. **EagleView ($2.40 a roof) only once it is a lead**, attached for the buyer (my call, to confirm). |
| How is a lead priced? | **In the Lead Center, as today** — the admin's "Lead price" box. The estimate gives a suggested price. When routing is automatic, the cascade charges the suggested price only where a **per-trade switch** is on — off until the owner turns it on (owner). |
| How many contractors get a lead? | **One at a time** (today's cascade: the first who accepts gets it, the next is offered when one passes). **Exclusive** is an option on the lead: sold once, never re-offered (owner). |
| Where does it live? | **`/price`**, apart from `/homeowner`, which stays for people who would rather describe than price. It never says "Smart Proposal"; the fourth card is "Any project" (owner, my naming). |
| Relation to the contractor-website estimators (the other session) | **One engine, two front doors.** The org-less range engine and its server actions are shared; the home portal sends the lead to the Lead Center, a contractor's site sends it to that contractor. |

## Goals

- A homeowner gets a roof price range for their address in about a minute, on a phone, without an account.
- Every range becomes a lead only when the homeowner asks for quotes, and that lead carries the estimate.
- The contractor who buys the lead opens it already measured and priced in their own roof estimator.
- Each range costs JobFlex a few cents; a roof lead about $2.50 all in (EagleView is $2.40 a roof on the owner's contract — the app's cost table still holds a $5-a-pack placeholder and is corrected as part of this work).

## Non-goals

- No homeowner accounts or logins (the portal stays token-based).
- No fence, HVAC or any-project *pricing* in this round — their cards open the existing describe-and-match intake, prefilled.
- No Cool Calc Manual J for homeowners, ever (the contractor's report).
- No change to how contractors pay for leads (Stripe off-session on Accept; no refunds by policy, duplicates refunded automatically, an admin can refund from the Lead Center).
- No new "verified pros", "3–5 quotes in 4 hours" or similar claims.

## Anti-goals (a failure even if it works)

- A number that reads as a quote. It is a range, "a local pro confirms on site", everywhere.
- Anything contractor-facing leaking to the homeowner: unit prices, the EagleView ortho, line items with labor rates, company pricing.
- A page that can be scripted to burn Solar, EagleView or OpenAI money.
- A homeowner typed into the Lead Center with no consent record.

## Constraints

- **The production schema is not pushed by the build.** Any new column goes in by hand first (`prisma/sql/prod-<date>-*.sql`, `prisma db execute`, confirmed with the owner), exactly as `prod-2026-10-26-lead-source.sql` did yesterday. Prefer additive columns with defaults; prefer `SyncState` for anything the Lead Center does not need to filter on.
- The repo is public: no keys, no customer data, no fixtures from real addresses.
- TCPA consent (`lib/leadConsent`; the `LeadSource` row the intake writes beside each `PlatformLead`, with `source` and the consent columns) is recorded on every lead, with the words shown.
- The intake's rate limits stay (3 submissions per IP per 10 min, 60 a minute globally); the range step gets its own.
- Google imagery is display only; the measurement is Solar's `buildingInsights` numbers, never traced from tiles.
- Every entry point today requires an org (`requireEstimatorOrManager` + `requirePage`); the public path must not weaken those — it is a separate, org-less set of actions.

## The homeowner's flow

One shell at `/price`, phone first, the home dashboard's own look (`home.module.css` tokens: warm paper, white panels, serif welcome), not the contractor app's.

**Screen 1 · `/price` — the row.** Headline "See what your project should cost, for your house." Four picture cards in a row (two by two on a phone): **Roof** ("Measured from the sky · a range in a minute"), **Fence** ("Pick the sides, pick a style"), **Heating & cooling** ("Replace or add a system"), **Any project** ("Send a photo, get a range"). Roof opens `/price/roof`. The other three open `/homeowner?project=<trade>` prefilled, with a short line on the card: "Describe it — a local pro prices it." No "coming soon".

**Screen 2 · Address.** "Where's the roof?" One Places field (the roof estimator's own autocomplete, US only). On a pick we show the house on a small map with the pin (Google map, display only) and "Yes, that's it". The pin's lat/lng is kept — the main-building rule from 2026-10-26 applies: the pin says which building.

**Screen 3 · Three questions, picture answers.**
1. *What's on the roof now?* Asphalt shingle · Metal · Tile · Wood shake · Flat / rubber · Not sure.
2. *How many floors?* 1 · 2 · 3+ (Solar does not give storeys).
3. *What would you like?* Architectural shingle (default, "most homes") · Metal standing seam · Impact-resistant shingle · Designer shingle · Keep it simple, 3-tab. Tile and shake only where the catalog prices them.

A fourth, optional: *Anything we should know?* — leaks, skylights, solar panels (checkboxes). No free text on this path.

**Screen 4 · Your range.** The number first: **$14,200–$19,800**, under it "architectural shingle · about 2,100 sq ft of roof · 6/12 pitch · read from aerial data". Then:
- "Typical in Bellevue, WA: $13,000–$21,000" — the cost guide's cited range for the same material and city, when the city has a guide.
- *What's included*, five to seven plain lines from the package's scope (tear-off, underlayment, the shingle, flashing, ridge vent, cleanup, permit) — no quantities, no prices per line.
- *What moves the price*: three chips that re-price live — material (the five above), tear-off (none · 1 layer · 2 layers), floors. Changing one updates the range without a server call (the package builder is pure and client-safe).
- *Is it in my budget?* A single field "I have about $___" → "That covers the architectural shingle. Metal would need about $8,000 more." Stored with the lead when they submit.
- *Compare*: a switch that shows two materials side by side.
- Two buttons: **Get quotes from local pros** (primary) and **Email me this range** (secondary).
- A line under the number: "An estimate range from aerial data and local prices, not a quote. A local pro confirms on site."

When Solar finds no roof (rural, new build, bad geocode): "We couldn't read your roof from the sky." → two fields, *home square footage* and *floors* → the range is built from a footprint estimate and labelled "from your home's size".

**Screen 5 · Get quotes.** Name, email, phone, the consent line with its box (`lib/leadConsent` words), "Send me the range by email" ticked. Submit creates the lead (below) and lands on the request page `/request/<token>` with the range on it, and the home dashboard key in the email, as today.

**"Email me this range"** asks for the email only (name optional). It is **not a lead**: nobody consented to being contacted by contractors. It finds or creates the `Home` by email and saves the range as a **planned project** (`HomePlan`, status PLANNED — the dashboard's own "a project not yet sent"), emails the range with a "Get quotes" button, and sends one reminder two days later. The Lead Center lists these under a separate **Priced, not asking yet** heading — counts and the ranges, no contacts, nothing to route or price — so the team can see demand. "Get quotes" from the email or the dashboard runs Screen 5 and turns the plan into a lead (`HomePlan` → SUBMITTED with `platformLeadId`, as the dashboard already does).

**The home dashboard.** The project card shows the range, the material chosen, and "Price another project" → `/price`. A roof range saved but not submitted shows as "Your roof range" with "Get quotes".

## The range engine (shared with the contractor-website estimators)

`src/lib/publicEstimate/roof.ts` — pure, client-safe:
- `roofFactsFromSolar(solar: SolarRoofEstimate, answers)` → `RoofFacts` (the roof package's type). `estimateSolarRoof` (`lib/roofSolarEstimate`) already turns Solar's insights into `areaSqft`, `footprintSqft`, `pitchFamilies` and `predominantPitch12`; the facts assembly that today lives in the contractor page (`roof-estimator-data-form.tsx`: squares, pitch shares, perimeter, storeys) moves into this pure function so both paths share it. Solar gives no outline, so `perimeterFt` is null and the package builder's footprint approximation applies. `storeys` and `existingMaterial` come from the answers; `squaresBasis: "estimated"`.
- `roofFactsFromSize(sqft, storeys, answers)` — the fallback.
- `roofRange(facts, choice, cityIndex)` → `{ low, mid, high, scope: string[], squares, pitch }`: `defaultSpecWith(facts, BUILTIN_LISTS, system)` with the chosen system and tear-off layers, `buildRoofPackage`, the total times the city's construction index (`lib/estimate/location-index-data`, as the cost guides use it), then **low = mid × 0.90, high = mid × 1.15** — Solar's area is a read, not a measurement, and the catalog's own waste and material spread sits inside that. The builder may tune the two factors; they stay printed in one place with the reason.
- `roofGuideRange(city, material)` → the cost guide's cited range for "typical in <city>", or null. Only the architectural shingle has a cited range today (`seo/trades.ts`), so the line shows for that material and is left out for the others — never the architectural figure under a metal range.

`src/actions/publicEstimate.ts` — server, org-less, `"use server"`:
- `publicRoofRead(input: { address, city, state, zip, lat, lng }, caller: { kind: "home" } | { kind: "site"; orgToken: string })` → Solar `getBuildingInsights` (`lib/solar`) → the insights needed by the pure builder. Cached by address key in `SyncState` `pubroof:<addressKey>` for 30 days, so a repeat (or the contractor-site twin on the same house) costs nothing. Rate-limited per IP (10 reads an hour) and globally (600 an hour) with the same limiter the homeowner actions use; a honeypot field; the address must geocode inside the US. Spend is recorded with `recordApiSpend` (`lib/apiSpend`, unit prices from `lib/paidApiCosts`) against the house org (below), so `/admin/usage` sees it.
- `publicRoofLead(...)` — Screen 5: see "The lead".

The `caller` decides nothing about the price and everything about where the lead goes. **This session lands the engine and the two actions first** (phase 1); the contractor-website session builds its embed on them with `caller.kind = "site"` and must not fork the engine. For `site`, `orgToken` is the organization's public booking slug (the one `/book/[slug]` already resolves), looked up server-side; a slug that resolves to no org, or to one whose plan has lapsed, is refused. The cache key `pubroof:<addressKey>` is shared by both callers on purpose.

## The lead

`publicRoofLead` calls `createHomeownerLead` (`lib/leadCenter/intake.ts`) with:
- `source: "price-roof"` (the `source` column added 2026-10-26), the consent columns filled;
- `projectType: "roofing"`, `description` written from the answers so trade detection and the scope read it: "Roof replacement, architectural shingle, tear-off 1 layer, about 2,100 sq ft of roof at 6/12, 2 floors; leaks noted. Range shown: $14,200–$19,800. Budget: about $18,000.";
- the address and the pin.

**The estimate on the lead.** `SyncState` key `leadestimate:<leadId>` holding `{ v: 1, trade: "roof", range: { low, mid, high }, material, tearOffLayers, storeys, squares, pitch, basis: "solar" | "size", budgetCents, answers, cityIndex, guideRange, at, measurementId? }`. No schema change this round: the Lead Center loads its leads and joins these in memory (volumes are small), and its filters work on that. The same JSON is what the saved project (`HomePlan`) keeps for a range that was only emailed. (My call: `SyncState` over a column, so phase 1 needs no hand-applied production SQL; a column can replace it later if filtering ever needs the database.)

**EagleView once it is a lead (phase 1b).** After the lead is created and routed, a job orders the EagleView measurement for the address under the **house org**: an admin picks one of the internal organizations (`Organization.isInternal`) on the Lead Center's settings — stored as `SyncState` `leadCenter:houseOrgId`; orders are placed as that org's owner user — so the order ledger, the daily caps and reuse all work unchanged. Conditions: consent given, no measurement for that address key in the last 30 days, and a house counter under 100 orders a day ($240 a day at $2.40; alert the admins at 80). The resulting `RoofMeasurement` id is written into `estimateJson.measurementId`, and the lead's range is re-stated from the measured facts (the homeowner is not re-notified; the Lead Center shows "measured").

**Photos.** Screen 5 offers the same upload the intake has (`HomeFile` through the request token). Not on the range screens.

## The Lead Center

- The lead card and the detail pane show a **Priced** block: the range, material, tear-off, floors, squares and pitch with their basis ("aerial read" / "from home size" / "measured"), the budget answer, and "range only — not asking for quotes yet" when that is the state.
- **Suggested price** beside the "Lead price, $" box: a small table in code, roof: priced $35, measured $60, measured + budget $75; exclusive doubles it. The admin types what they like. **Automatic routing:** a per-trade switch on the Lead Center's settings, **"Charge the suggested price on automatic routing"**, off by default (`SyncState` `leadCenter:autoPrice:<trade>`). On, the cascade sets the suggested price on the offer before it goes out; off, auto-routed leads stay as today (priced only when an admin typed a price, else free).
- **Exclusive**: a checkbox on the lead (`SyncState` `leadexclusive:<leadId>` in this round). Today's cascade already offers a lead to one shop at a time and sells it once; "exclusive" this round is the promise on the offer card ("Exclusive — nobody else gets this lead"), the doubled suggested price, and no re-offer after it is sold. Selling one lead to several shops (the consent text allows up to three) is a possible later phase, not this one.
- Filters: source "Priced by the homeowner" and basis; the **Priced, not asking yet** list apart.

## The contractor's side

- The offer card (`pendingLeadOffers`) shows the range and the priced summary with the scope, still without contacts.
- On Accept (`acceptOfferTx`): the org `Lead` keeps `source: "LEAD_CENTER"`; its description carries the priced summary; the lead page gets **Open in the roof estimator** → `startEstimateFromLead(leadId, "roof")` (exists) with the seed's brief = the summary and the address. The seed (`lib/estimateSeed`) gains optional `lat`/`lng`, read from the `PlatformLead` the org lead came from, so the estimator opens on the right building.
- When the lead has a `measurementId`, Accept **copies the `RoofMeasurement` row into the buyer's org** (same `instantJson`, `provenanceJson`, address, pin; `createdById` the buyer's owner). Their roof estimator then finds it as a stored answer for that address and opens it free (the 2b path in `obtainInstant` reads prior `RoofMeasurement` rows by address key).

## Entry points

- Ad landings with `?industry=roofing`: a second button under the hero, "See your price first", → `/price/roof`. Other landings link `/price`.
- Cost guides: beside the calculator, "See the price for your address" → `/price/roof?address=…&city=…&state=…` prefilled when the guide's city is known.
- `/homeowner` describe step: a quiet link, "Want a price first? Price it in a minute."
- `/home/[key]`: "Price a project".
- The marketing nav: "Price my project".

## Cost, abuse and honesty — the rules

- Per range: Solar 1¢ + geocode 0.5¢; the chips re-price in the browser; no OpenAI call for a range. A lead still costs the intake's cents of OpenAI (trade detection; the scope is passed in pre-written so the scope writer is skipped).
- EagleView: only on a consented lead, once per address per 30 days, ≤100 a day.
- Rate limits as above; the Places key is the browser key with HTTP referrer restrictions (already the case for the roof estimator).
- A homeowner sees: the range, "estimate, not a quote", "a local pro confirms on site", the aerial basis, the map. They never see EagleView's name (the 2026-10-12 rule), unit prices, or the contractor catalog.
- Events for the traffic analyst (`PageView` beacon): `price_start`, `price_address`, `price_range`, `price_lead`, `price_email_only`.

## Phases

1. **Roof + the shell + the lead with the estimate + the Lead Center "Priced" block + Open in the roof estimator.** The other three cards route to the prefilled intake. QA: a pure check for the range builder (fixture insights → facts → range, the fallback, the chips) and a stand walk with a fake Solar server (desk + 390 px); the Lead Center shows the block; the request page shows the range.
2. **1b: EagleView on the lead** under the house org, the measurement copy on Accept, "measured" in the Lead Center.
3. **Fence and heating & cooling** on the same shell: fence from lot lines (Regrid/ReportAll) and tapped sides; HVAC from the parcel's size and the job-kind cards, priced by the engine's Good·Better·Best — no Cool Calc.
4. **Any project**: a photo and a sentence, two AI follow-ups, the Smart engine's benchmark range with the local index.
5. **Lead grades and suggested prices on an admin page, exclusive on the offer flow, the cost-guide calculators replaced by "price your address".**

## Settled with the owner after the review

1. **Automatic routing and money:** a per-trade switch, off until the owner turns it on; on, the cascade charges the suggested price.
2. **"Email me this range" people:** a saved project in the dashboard with "Get quotes", one reminder two days later, and a separate "Priced, not asking yet" list in the Lead Center — counts and ranges, no contacts, not sellable.

## Left to the builder

- The exact look of the cards and the range screen, within the home dashboard's tokens; the copy, kept to the honesty rules above.
- Which Solar fields make the facts (segment areas and pitches are the floor; `roofSolarEstimate.ts` already does most of it for the contractor path and should be reused, not copied).
- The two range factors, the suggested-price table's numbers, the limiter's exact windows.
- Whether the Places autocomplete component is shared with the roof estimator or a lighter copy.
- QA fixtures (synthetic house, never a real address).
