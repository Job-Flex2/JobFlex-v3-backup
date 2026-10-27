# Home portal "Price my project" — phase 1 (roof) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A homeowner gets a roof price range for their address at `/price/roof` with no account, and "Get quotes" turns it into a Lead Center lead that carries the estimate; the contractor who buys it opens it in their roof estimator.

**Architecture:** A pure range engine (`lib/publicEstimate/roof.ts`) turns Google Solar's roof read plus three picture answers into `RoofFacts` and prices them with the existing roof package builder times the city index. Two org-less server actions (`actions/publicEstimate.ts`) do the Solar read (cached per address) and the lead/email-only submits; the lead goes through the existing `createHomeownerLead`, and the estimate lives beside it in `SyncState` (`leadestimate:<leadId>`). The Lead Center, the contractor's offer and the roof estimator hand-off read that one record.

**Tech Stack:** Next.js 16 app router, React, server actions, Prisma (no schema change), `SyncState` key/value rows, Google Solar + Places (existing keys), zod, the repo's `qa/tests/logic/*.check.ts` pure checks run with `NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json <file>`, Playwright-core stand walks.

**Spec:** `docs/superpowers/specs/2026-10-27-home-portal-price-my-project-design.md`

## Global Constraints

- No Prisma schema change in this phase; new state goes in `SyncState` (`db.syncState.upsert` with `key`/`cursor`, as `lib/leadCenter/routingMode.ts` does) or in existing models (`HomePlan`).
- The public path never imports `requireEstimatorOrManager`/`requirePage`; it has its own limits: per IP 10 Solar reads an hour, 600 an hour globally (`enforceRateLimit` from `lib/rateLimit`), a honeypot field, and the intake's own 3-per-IP-per-10-min on submit.
- Homeowner-facing words: the number is always "an estimate range … not a quote"; "a local pro confirms on site"; the basis is "read from aerial data" or "from your home's size"; never "EagleView", never "verified", never a per-line price or unit rate, never "Smart Proposal".
- Range rule: `mid` = the roof package total × the city factor; `low = mid × 0.90`, `high = mid × 1.15`; whole dollars, rounded to the nearest $100.
- EagleView is never ordered in this phase. The cost table's EagleView placeholder becomes `{ roof: 240 }` cents.
- Consent: every lead carries `LEAD_CONSENT_TEXT` (`lib/leadConsent`) with `at`, `ip`, `page`; "Email me this range" creates no lead and asks for no consent box.
- Every new homeowner page works at 390 px wide with a 16 px gutter and no horizontal scroll; the look uses the home dashboard's tokens (`src/app/(portal)/home/[key]/home.module.css`: `--h-ink`, `--h-panel`, `--h-line`, `--h-r`, the serif welcome).
- Commit after every task; `git add` exact files; the full `tsc --noEmit -p tsconfig.json` (8 GB heap) before the push.

## Review Focus

- An address that geocodes but Solar answers "no building" or `imageryQuality` ≠ HIGH → the fallback screen (home size + floors), never an error page or a blank range. (Task 1 `roofFactsFromSize`, Task 5 fallback, Task 6 test.)
- A visitor who scripts `/price/roof`: the 11th Solar read in an hour from one IP is refused with words, and the honeypot field filled refuses before any Solar call. (Task 2 tests.)
- The same address twice within 30 days costs one Solar call: the second answer comes from `pubroof:<addressKey>`. (Task 2 test.)
- A lead submitted without the consent box ticked is refused with the intake's own words and no `PlatformLead` is written. (Task 3 behaviour, Task 7 walk.)
- A contractor who accepts a priced lead sees the range and the summary on the offer card and in the lead's description; opening the roof estimator lands on the right building (lat/lng in the seed). (Tasks 10–11.)

---

### Task 0: The cost table — EagleView at the contract price

**Files:**
- Modify: `src/lib/paidApiCosts.ts:71-72`
- Test: `qa/tests/logic/paid-api-costs.check.ts` (create if absent; else add)

**Interfaces:**
- Produces: `PAID_API_COSTS.eagleview = { roof: 240 }` (cents per whole roof measured).

- [ ] **Step 1: Write the failing check**

```ts
check("EagleView is priced per whole roof at the contract price", PAID_API_COSTS.eagleview.roof === 240 && !("pack" in PAID_API_COSTS.eagleview));
```

- [ ] **Step 2: Run it — expect FAIL** (`pack`/`report` present, no `roof`).
- [ ] **Step 3: Replace the placeholder line with `eagleview: { roof: 240 }` and update the comment to "owner's contract, 2026-10-26: $2.40 a roof"; fix every reader of `eagleview.pack`/`.report`** (`grep -rn "eagleview\.\(pack\|report\)" src` — `trialCaps.ts:26-28` worst-case note and any spend recorder) to use `roof`.
- [ ] **Step 4: Run the check and the full tsc — expect PASS, 0 errors.**
- [ ] **Step 5: Commit** `fix(costs): EagleView at $2.40 a roof, the contract price`

---

### Task 1: The pure roof range engine

**Files:**
- Create: `src/lib/publicEstimate/roof.ts`
- Test: `qa/tests/logic/public-roof-range.check.ts`

**Interfaces:**
- Consumes: `SolarRoofEstimate` (`lib/roofSolarEstimate`), `RoofFacts`, `defaultSpecWith`, `buildRoofPackage` (`lib/roofPackage/takeoff`), `BUILTIN_LISTS`, `ROOF_SYSTEMS` (`lib/roofPackage/catalog`), `calibration`/`seoTrade`/`seoCityByPlace` (`lib/seo/*`).
- Produces (all exported, pure, client-safe — no `db`, no `fs`):

```ts
export type ExistingKey = "asphalt" | "metal" | "tile" | "shake" | "flat" | "unsure";
export type MaterialId = "architectural" | "standing_seam" | "impact_resistant" | "designer" | "three_tab";
export const MATERIALS: ReadonlyArray<{ id: MaterialId; label: string; blurb: string }>; // five, architectural first ("most homes")
export const EXISTING: ReadonlyArray<{ id: ExistingKey; label: string }>;
export type RoofAnswers = { existing: ExistingKey; storeys: 1 | 2 | 3; material: MaterialId; tearOffLayers: 0 | 1 | 2; leaks: boolean; skylights: boolean; solarPanels: boolean };
export function roofFactsFromSolar(solar: SolarRoofEstimate, answers: RoofAnswers, state: string | null): RoofFacts;
export function roofFactsFromSize(homeSqft: number, answers: RoofAnswers, state: string | null): RoofFacts;
export type RoofRange = { low: number; mid: number; high: number; squares: number; pitchLabel: string; basis: "solar" | "size"; scope: string[]; cityFactor: number; cityWords: string | null };
export function roofRange(facts: RoofFacts, answers: RoofAnswers, city: { factor: number; words: string } | null, basis: "solar" | "size"): RoofRange;
export function roofGuideRange(place: string | null, material: MaterialId): { low: number; high: number; cityWords: string } | null;
export const DEFAULT_ANSWERS: RoofAnswers; // asphalt, 2 storeys, architectural, 1 layer, no notes
```

Rules the implementer follows: `roofFactsFromSolar` sets `squares = areaSqft / 100`, `squaresBasis: "estimated"`, `pitchFamilies` weighted by `surfaceSqft` share (as `roof-estimator-data-form.tsx:483-486` does), `pitchBasis: "estimated"`, `footprintSqft`, `perimeterFt: null`, `facetCount: null`, `facetCountEstimated: segmentCount`, `storeys`, `existingMaterial` from the answer's label (`unsure` → null), `chimney: null`, `rooftopAcCount: null`, `shape: null`, `buildingUse: "residential"`. `roofFactsFromSize`: footprint = `homeSqft / storeys`, squares = footprint × 1.15 (a 6/12 average slope factor) / 100, `pitchFamilies: [{ pitch12: 6, share: 1 }]`, basis "estimated". `roofRange`: `defaultSpecWith(facts, BUILTIN_LISTS, system)` with `tearOffLayers` set from the answer; `buildRoofPackage`; `mid = round100(total × factor)`; low/high per the global rule; `scope` = the package's `scope` lines with any line containing a `$` dropped; `basis` is the fourth parameter, passed by the caller (`RoofFacts` gains nothing). `roofGuideRange` returns a value only when `material === "architectural"` and `seoCityByPlace(place)` finds the city and `calibration(seoTrade("roof-replacement"), "architectural")` has a cited range; it scales nothing.

- [ ] **Step 1: Write the failing check file** with these checks (fixture: a `SolarRoofEstimate` literal with `areaSqft: 2100`, `footprintSqft: 1800`, `predominantPitch12: 6`, `pitchLabel: "6/12"`, `segmentCount: 8`, `pitchFamilies: [{ pitch12: 6, planSqft: 1500, surfaceSqft: 1680 }, { pitch12: 9, planSqft: 300, surfaceSqft: 420 }]`, `imageryQuality: "HIGH"`, the rest nulls/zeros):

```ts
check("solar → facts: 21 squares, pitch shares by surface area, 2 storeys, no perimeter, estimated", f.squares === 21 && f.squaresBasis === "estimated" && Math.abs(f.pitchFamilies[0].share - 0.8) < 1e-9 && f.perimeterFt === null && f.footprintSqft === 1800 && f.storeys === 2 && f.facetCountEstimated === 8);
check("size → facts: 2,400 sq ft home on 2 floors ≈ 13.8 squares at 6/12", Math.abs(sizeFacts.squares - 13.8) < 0.05 && sizeFacts.pitchFamilies[0].pitch12 === 6);
check("the range: mid is the package total × the city factor, rounded to $100; low 90%, high 115%", r.mid % 100 === 0 && r.low === Math.round(r.mid * 0.9 / 100) * 100 && r.high === Math.round(r.mid * 1.15 / 100) * 100 && r.mid > 0);
check("the city factor moves the number", roofRange(f, a, { factor: 1.2, words: "Bellevue, WA" }, "solar").mid > roofRange(f, a, null, "solar").mid);
check("metal costs more than architectural; 2 layers of tear-off more than 1; 3 storeys more than 1", metal.mid > arch.mid && two.mid > one.mid && three.mid > oneStorey.mid);
check("no tear-off: no tear-off line in the scope", !roofRange(f, { ...a, tearOffLayers: 0 }, null, "solar").scope.some((s) => /tear-off|tear off/i.test(s)));
check("the scope never shows a price", r.scope.length >= 4 && !r.scope.some((s) => /\$/.test(s)));
check("basis travels", roofRange(sizeFacts, a, null, "size").basis === "size" && r.basis === "solar");
check("the guide range: only the architectural shingle, only a known city", roofGuideRange("Bellevue, WA", "architectural") !== null && roofGuideRange("Bellevue, WA", "standing_seam") === null && roofGuideRange("Nowhere, ZZ", "architectural") === null);
check("the five materials, architectural first", MATERIALS.length === 5 && MATERIALS[0].id === "architectural");
```

- [ ] **Step 2: Run it — expect FAIL** (module not found).
- [ ] **Step 3: Implement `src/lib/publicEstimate/roof.ts`** per the Interfaces block. Header comment: what it is, who calls it (the home portal and the contractor-website embed), the range rule and why.
- [ ] **Step 4: Run the check — expect `all passed`.**
- [ ] **Step 5: Commit** `feat(price): pure roof range engine from a Solar read or a home size`

---

### Task 2: The org-less Solar read action, cached and limited

**Files:**
- Create: `src/actions/publicEstimate.ts` (`"use server"`)
- Create: `src/lib/publicEstimate/store.ts` (server: the cache + the house org)
- Modify: `src/lib/solar.ts:29` (`SOLAR_BASE` reads `process.env.SOLAR_API_BASE ?? "https://solar.googleapis.com/v1"` — for the stand's fake Solar)
- Test: `qa/tests/logic/public-estimate-store.check.ts` (pure parts) + Task 13's walk for the action

**Interfaces:**
- Consumes: `getBuildingInsights(lat, lng)`, `isSolarEnabled` (`lib/solar`), `estimateSolarRoof(insights, pin)` (`lib/roofSolarEstimate`), `instantAddressKey` (`lib/eagleview`), `enforceRateLimit`, `clientIp`, `MINUTE` (`lib/rateLimit`), `recordApiSpend` (`lib/apiSpend`), `locationIndex` (`lib/estimate/location-index`), `seoCityByPlace`.
- Produces:

```ts
// store.ts
export const PUBROOF_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export type PubRoofCache = { v: 1; at: string; solar: SolarRoofEstimate | null; error: string | null };
export function pubRoofKey(input: { address: string; city?: string; state?: string; zip?: string }): string; // "pubroof:" + instantAddressKey(input)
export function cacheFresh(row: PubRoofCache | null, now: Date): boolean;
export async function readPubRoof(key: string): Promise<PubRoofCache | null>;
export async function writePubRoof(key: string, row: PubRoofCache): Promise<void>;
export async function houseOrgId(): Promise<string | null>; // SyncState "leadCenter:houseOrgId", null when unset

// publicEstimate.ts
export type PublicCaller = { kind: "home" } | { kind: "site"; orgSlug: string };
export type PublicRoofReadInput = { address: string; city: string; state: string; zip: string; lat: number; lng: number; website?: string /* honeypot, must be empty */ };
export type PublicRoofReadResult =
  | { ok: true; solar: SolarRoofEstimate | null; noRoofReason: string | null; cityFactor: number; cityWords: string | null; cached: boolean }
  | { ok: false; error: string };
export async function publicRoofRead(raw: unknown, caller: PublicCaller): Promise<PublicRoofReadResult>;
```

Rules: zod-validate `raw` (address ≤ 200, US state code, lat/lng finite, `website` must be `""`); a filled honeypot returns `{ ok: false, error: "Something went wrong — try again." }` before any limit or call; `enforceRateLimit(\`pubroof:${ip}\`, 10, 60 * MINUTE, "reads")` and `enforceRateLimit("pubroof:global", 600, 60 * MINUTE, "reads")` — a `RateLimitError` becomes words ("We've priced a lot of roofs from this connection — try again in N minutes."); a fresh cache row answers without Solar; otherwise `getBuildingInsights` → `estimateSolarRoof`; a Solar failure (any `SolarUnavailableError` or `ok: false`) is cached too (`solar: null, error`) so a bad address is not retried for 30 days by every visitor; `cityFactor` from `locationIndex(\`${city}, ${state}\`).factor`, `cityWords` = the index's place when `level !== "national"`; spend: `recordApiSpend(houseOrgId, [{ service: "google-solar", op: "buildingInsights", calls: 1, cents: 1 }])` only when a house org is set and Solar was called. `caller.kind === "site"` is accepted and ignored in this phase except that it is logged on the cache row's write (`console.info("[price] site read", slug)`).

- [ ] **Step 1: Write the failing check** for the pure parts:

```ts
check("the cache key is the EagleView address key under pubroof:", pubRoofKey({ address: " 418 Linden Ave ", city: "buffalo", state: "NY", zip: "14216" }) === "pubroof:418 LINDEN AVE|BUFFALO|NY|14216");
check("a row is fresh for 30 days, stale after", cacheFresh({ v: 1, at: d(-29), solar: null, error: "x" }, now) && !cacheFresh({ v: 1, at: d(-31), solar: null, error: "x" }, now) && !cacheFresh(null, now));
```

- [ ] **Step 2: Run it — expect FAIL.**
- [ ] **Step 3: Implement `store.ts` and `publicEstimate.ts` (the read action only), and the `SOLAR_BASE` env read.**
- [ ] **Step 4: Run the check — expect `all passed`; run the full tsc — expect 0 errors.**
- [ ] **Step 5: Commit** `feat(price): org-less Solar roof read, cached per address, rate-limited`

---

### Task 3: The lead with the estimate, and the email-only saved project

**Files:**
- Create: `src/lib/leadCenter/estimate.ts`
- Modify: `src/actions/publicEstimate.ts` (two more actions)
- Modify: `src/lib/leadCenter/intake.ts:91` (accept `opts.estimate`; write it after the lead is created)
- Test: `qa/tests/logic/lead-estimate.check.ts`

**Interfaces:**
- Consumes: `createHomeownerLead(data, opts)`, `findOrCreateHome` (`lib/home/portal`), `db.homePlan.create`, `LEAD_CONSENT_TEXT`, `RoofRange`, `RoofAnswers`, `MATERIALS`.
- Produces:

```ts
// lib/leadCenter/estimate.ts (pure parts first, then the two db helpers)
export type LeadEstimate = { v: 1; trade: "roof"; range: { low: number; mid: number; high: number }; material: MaterialId; materialLabel: string; tearOffLayers: 0 | 1 | 2; storeys: 1 | 2 | 3; squares: number; pitchLabel: string; basis: "solar" | "size"; budgetCents: number | null; answers: RoofAnswers; cityFactor: number; guideRange: { low: number; high: number } | null; at: string; measurementId?: string | null };
export const LEAD_ESTIMATE_KEY = (leadId: string) => `leadestimate:${leadId}`;
export const PRICE_PLAN_TAG = "price:roof"; // the first line of a HomePlan.notes that holds a saved range
export function estimateWords(e: LeadEstimate): string; // one paragraph: "Roof replacement, architectural shingle, tear-off 1 layer, about 2,100 sq ft of roof at 6/12, 2 floors; leaks noted. Range shown: $14,200–$19,800 (read from aerial data). Budget: about $18,000."
export function estimateShort(e: LeadEstimate): string; // "$14,200–$19,800 · architectural shingle · 21 sq · aerial read"
export function suggestedLeadPriceCents(e: LeadEstimate, exclusive: boolean): number; // priced 3500; measured (measurementId) 6000; measured + budget 7500; ×2 exclusive
export function parsePlanEstimate(notes: string | null): LeadEstimate | null; // notes = PRICE_PLAN_TAG + "\n" + JSON
export async function writeLeadEstimate(leadId: string, e: LeadEstimate): Promise<void>;
export async function readLeadEstimates(leadIds: string[]): Promise<Map<string, LeadEstimate>>; // one findMany on key IN (...)

// actions/publicEstimate.ts
export type PublicRoofLeadInput = { name: string; email: string; phone: string; consent: true; page?: string; website?: string; address: string; city: string; state: string; zip: string; lat: number; lng: number; estimate: LeadEstimate; timezone?: string };
export async function publicRoofLead(raw: unknown): Promise<{ ok: true; statusPath: string; homePath: string | null } | { ok: false; error: string }>;
export type PublicRoofEmailInput = { email: string; name?: string; website?: string; address: string; city: string; state: string; zip: string; estimate: LeadEstimate };
export async function publicRoofEmail(raw: unknown): Promise<{ ok: true; homePath: string } | { ok: false; error: string }>;
```

Rules: `publicRoofLead` refuses `consent !== true` with the intake's words (`"Please tick the box to agree to be contacted about your request, then send again."`), runs the intake's own limits (`homeowner:${ip}` 3/10 min, global 60/min), builds `description = estimateWords(estimate)`, `scope = description` (≥ 20 chars, so the scope writer is skipped), `projectType: "roofing"`, and calls `createHomeownerLead(data, { isTest: false, source: "price:roof", consent: { text: LEAD_CONSENT_TEXT, at: new Date(), ip, page }, estimate })`; `createHomeownerLead` writes `writeLeadEstimate(platformLead.id, opts.estimate)` right after the `leadSource` write (best-effort, logged). `publicRoofEmail`: `findOrCreateHome({ name: name ?? "Homeowner", email, address, city, state, zip })`, then `db.homePlan.create({ homeId, title: "Roof · <address>", notes: PRICE_PLAN_TAG + "\n" + JSON.stringify(estimate), plannedFor: first day of next month, wholeMonth: true, remindAt: now + 2 days })` — the existing plan reminder (`lib/home/reminders`, cron `/api/cron/home-plans`) sends the nudge; then the range email (Task 7) and `homePath = await homeUrl(key)`. Limit: `enforceRateLimit(\`pubemail:${ip}\`, 5, 10 * MINUTE, "emails")`.

- [ ] **Step 1: Write the failing check** (pure parts):

```ts
check("the words a contractor reads", estimateWords(e) === "Roof replacement, architectural shingle, tear-off 1 layer, about 2,100 sq ft of roof at 6/12, 2 floors; leaks noted. Range shown: $14,200–$19,800 (read from aerial data). Budget: about $18,000.");
check("…with no budget and no notes", !/Budget/.test(estimateWords({ ...e, budgetCents: null, answers: { ...e.answers, leaks: false } })) && !/noted/.test(estimateWords({ ...e, answers: { ...e.answers, leaks: false } })));
check("the short line", estimateShort(e) === "$14,200–$19,800 · architectural shingle · 21 sq · aerial read");
check("suggested price: priced $35, measured $60, measured + budget $75, exclusive doubles", suggestedLeadPriceCents({ ...e, budgetCents: null }, false) === 3500 && suggestedLeadPriceCents({ ...e, budgetCents: null, measurementId: "m" }, false) === 6000 && suggestedLeadPriceCents({ ...e, measurementId: "m" }, false) === 7500 && suggestedLeadPriceCents(e, true) === 7000);
check("a saved range reads back from a plan's notes; other notes do not", parsePlanEstimate(PRICE_PLAN_TAG + "\n" + JSON.stringify(e))?.range.mid === e.range.mid && parsePlanEstimate("Paint the fence") === null && parsePlanEstimate(null) === null);
```

- [ ] **Step 2: Run it — expect FAIL.**
- [ ] **Step 3: Implement `estimate.ts`, the two actions, and the `intake.ts` hook (`IntakeOptions.estimate?: LeadEstimate | null`).**
- [ ] **Step 4: Run the check and the full tsc — expect PASS, 0 errors.**
- [ ] **Step 5: Commit** `feat(price): the lead carries the estimate; an emailed range is a saved project`

---

### Task 4: `/price` — the row

**Files:**
- Create: `src/app/(marketing)/price/page.tsx`
- Create: `src/components/v3/price-my-project/price-row.tsx`
- Create: `src/components/v3/price-my-project/price.module.css`
- Modify: `src/components/v3/landing-e/nav.tsx` (one link, "Price my project")

**Interfaces:**
- Consumes: `homeownerDoorFor` (`lib/home/homeownerDoor`) for the three describe cards' hrefs.
- Produces: `PriceRow({ trade?: string | null })` — four cards with `data-price-card="roof|fence|hvac|any"`; the roof card links `/price/roof`, the others `homeownerDoorFor("fencing"|"hvac"|"remodel").href` (check `homeTradeKey` accepts these; add keys there if a word is missing). Page `metadata.title` "See what your project should cost — JobFlex"; `robots` index allowed.

- [ ] **Step 1: Write the page and the row.** Headline "See what your project should cost, for your house." Card copy from the spec: Roof "Measured from the sky · a range in a minute"; Fence "Pick the sides, pick a style"; Heating & cooling "Replace or add a system"; Any project "Send a photo, get a range"; the three describe cards carry "Describe it — a local pro prices it." No "coming soon". Two by two under 600 px.
- [ ] **Step 2: Verify** `curl -s localhost:3530/price | grep -c 'data-price-card'` → `4` on the stand (Task 13's stand).
- [ ] **Step 3: Commit** `feat(price): the /price row — roof priced here, the rest described`

---

### Task 5: `/price/roof` — address and the three questions

**Files:**
- Create: `src/app/(marketing)/price/roof/page.tsx` (server: reads `?address=&city=&state=&zip=` prefill, renders the flow)
- Create: `src/components/v3/price-my-project/roof-flow.tsx` (client; owns the step state: `address → questions → range → quotes`)
- Create: `src/components/v3/price-my-project/place-field.tsx` (client; Places autocomplete on the Maps browser key, same loader as `roof-estimator-blueprint/address-pin-preview.tsx`; US only; emits `{ address, city, state, zip, lat, lng }`)
- Create: `src/components/v3/price-my-project/question-cards.tsx` (client; picture-answer rows for `EXISTING`, floors 1/2/3, `MATERIALS`, the three note checkboxes)
- Modify: `src/lib/traffic-contract.ts` (add `priceStart`, `priceAddress`, `priceRange`, `priceLead`, `priceEmailOnly` to `EventName` with values `price_start` … `price_email_only`)

**Interfaces:**
- Consumes: `publicRoofRead`, `AddressPinPreview({ lat, lng, label })`, `trackTraffic(event)` (`lib/traffic-client`), `DEFAULT_ANSWERS`, `RoofAnswers`.
- Produces: `RoofFlow({ prefill }: { prefill: Partial<PublicRoofReadInput> | null })`; `QuestionCards({ answers, onChange })`; `PlaceField({ onPick, initial })`. After the pick: the pin preview with "Yes, that's it" (`data-price-confirm`); after "Yes": the questions; "See my range" (`data-price-go`) calls `publicRoofRead` and moves to Task 6's view, or to the fallback (Task 6) when `solar` is null.

- [ ] **Step 1: Write the three components and the page.** The honeypot `website` input is visually hidden and labelled "Leave this empty". Each step fires its event once.
- [ ] **Step 2: Verify on the stand**: `node roofw/price-walk.js` steps 1–3 (Task 13) pass — the pick shows the pin, the questions render five materials, "See my range" reaches the range view.
- [ ] **Step 3: Commit** `feat(price): /price/roof — address, the pin, three picture questions`

---

### Task 6: The range view — chips, budget, compare, fallback

**Files:**
- Create: `src/components/v3/price-my-project/range-view.tsx` (client)
- Modify: `src/components/v3/price-my-project/roof-flow.tsx` (wire it)
- Test: `qa/tests/logic/public-roof-range.check.ts` (extend: the budget sentence and the compare pair are pure helpers in `lib/publicEstimate/roof.ts`)

**Interfaces:**
- Consumes: `roofFactsFromSolar`, `roofFactsFromSize`, `roofRange`, `roofGuideRange`, `MATERIALS`.
- Produces in `lib/publicEstimate/roof.ts`:

```ts
export function budgetWords(budgetCents: number, current: RoofRange, alternatives: Array<{ material: MaterialId; range: RoofRange }>): string; // "That covers the architectural shingle. Metal would need about $8,000 more." / "That's under the range for the architectural shingle by about $2,000; the 3-tab shingle fits."
export function moneyRange(r: RoofRange): string; // "$14,200–$19,800"
```
- `RangeView({ solar, cityFactor, cityWords, answers, onAnswers, onQuotes, onEmail })`: the number (`data-price-number`), the basis line, the "Typical in <city>" line only when `roofGuideRange` returns one, the included lines, three chips (material / tear-off / floors) that re-run `roofRange` in the browser, the budget field (`data-price-budget`), a compare switch (two materials side by side), the two buttons (`data-price-quotes`, `data-price-email`), the disclaimer line verbatim: "An estimate range from aerial data and local prices, not a quote. A local pro confirms on site." The fallback (`solar === null`): "We couldn't read your roof from the sky." + home sq ft + floors → `roofFactsFromSize`, basis line "from your home's size".

- [ ] **Step 1: Add the failing checks** for `budgetWords` (the two sentences above with the fixture's numbers) and `moneyRange` (`"$14,200–$19,800"`).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement the helpers and the view.**
- [ ] **Step 4: Run the check — PASS; stand walk steps 4–6 (number shown, a chip changes the number without a network call — assert the Solar stand-in's hit count stays 1 — the fallback renders for the stand-in's "no roof" address).**
- [ ] **Step 5: Commit** `feat(price): the range view — chips, budget, compare, the size fallback`

---

### Task 7: Get quotes, Email me this range, and the range on the request page

**Files:**
- Create: `src/components/v3/price-my-project/quotes-form.tsx` (client: name, email, phone, consent box with `LEAD_CONSENT_TEXT`, "Send me the range by email" ticked; or the email-only variant)
- Create: `src/lib/email/build/priceRange.ts` (the range email: the number, the material, the included lines, a "Get quotes" button to `/price/roof?…` prefilled with `plan=<id>`, and the dashboard link)
- Modify: `src/actions/publicEstimate.ts` (send the email from both actions)
- Modify: `src/lib/requestPortal.ts:177` (`loadRequestPortal` reads `readLeadEstimates([pl.id])` → `estimate: LeadEstimate | null` on the view)
- Modify: `src/app/(portal)/request/[token]/page.tsx` (a "Your range" box above "What you asked for" when `estimate` is set: `moneyRange`, the material, the basis line, the disclaimer)
- Modify: `src/app/(portal)/home/[key]/page.tsx` + `src/lib/home/portal.ts` (a plan whose notes parse as an estimate renders as "Your roof range" with `moneyRange` and a **Get quotes** link `/homeowner?home=<key>&plan=<id>`; a "Price a project" link to `/price` in the quick row)

**Interfaces:**
- Consumes: `publicRoofLead`, `publicRoofEmail`, `renderEmail`/`sendEmail` as `lib/home/reminders.ts` uses them, `parsePlanEstimate`, `moneyRange`, `consentPageFromLocation`.
- Produces: `QuotesForm({ mode: "quotes" | "email", estimate, site, onDone })`; `buildPriceRangeEmail({ name, estimate, address, quotesUrl, homeUrl })`.

- [ ] **Step 1: Write the form, the email builder, and the three page changes.** On a quotes success: an "Add photos" step (optional, up to 6, the intake's own upload through the request token — `lib/home/freshRequest.ts`), then `router.push(statusPath)`; on an email success: an inline "Sent — check your inbox" with the dashboard link.
- [ ] **Step 2: Verify on the stand** (Task 13 walk steps 7–10): submit without the box → the exact refusal words and no new `PlatformLead` row; submit with the box → a `PlatformLead` with a `LeadSource.source = "price:roof"` and consent text, a `SyncState` row `leadestimate:<id>`, the request page shows the range; email-only → a `HomePlan` whose notes start with `price:roof`, `remindAt` ≈ now + 2 days, one email in the dev outbox with the range, the dashboard shows "Your roof range" + Get quotes.
- [ ] **Step 3: Commit** `feat(price): get quotes → a priced lead; email me → a saved project with a nudge`

---

### Task 8: The Lead Center — the Priced block, the suggestion, the auto-price switch

**Files:**
- Modify: `src/app/(admin)/admin/lead-center/page.tsx:73` (after the leads load: `readLeadEstimates(ids)`; `estimate` and `source` on each DTO)
- Modify: `src/components/v3/admin-lead-center/lead-center-content.tsx:100` (`PlatformLeadDTO.estimate: LeadEstimate | null`; a `PricedBlock` above `PriceBlock`; the suggestion inside `PriceBlock`; a filter chip "Priced by the homeowner")
- Modify: `src/lib/leadCenter/cascade.ts:188` (when `pl.priceCents` is null and the lead has an estimate and `autoPriceOn(trade)` → `priceCents = suggestedLeadPriceCents(estimate, exclusive)` on the offer **and** on the `PlatformLead`)
- Create: `src/lib/leadCenter/autoPrice.ts` (`autoPriceOn(trade: "roof"): Promise<boolean>`, `setAutoPrice(trade, on)`; `SyncState` `leadCenter:autoPrice:<trade>` = "on"/"off", default off)
- Modify: `src/actions/adminLeadCenter.ts` (`setLeadAutoPrice(trade, on)` behind `requirePlatformAdmin`)
- Modify: the Lead Center settings area in `lead-center-content.tsx` (a switch per trade, roof only in this phase: "Charge the suggested price on automatic routing")
- Test: `qa/tests/logic/lead-estimate.check.ts` (extend: `suggestedLeadPriceCents` already; add `exclusiveOf` below)

**Interfaces:**
- Consumes: `readLeadEstimates`, `estimateShort`, `estimateWords`, `suggestedLeadPriceCents`, `getRoutingMode` pattern.
- Produces: `PricedBlock({ estimate })` rendering: the range (big), material · tear-off · floors, squares and pitch with the basis words ("aerial read" / "from home size" / "measured"), the budget line, the guide range line when present, all with `data-lead-priced`; `PriceBlock` shows "Suggested: $35 — priced by the homeowner" (`data-lead-suggested`) and a "Use it" button that fills the box. Exclusive this phase: a checkbox in `PriceBlock` (`data-lead-exclusive`) stored at `SyncState` `leadexclusive:<leadId>` ("1"), read by `exclusiveOf(leadId)`; the offer card (Task 10) prints "Exclusive — nobody else gets this lead" when set; the suggestion doubles.

- [ ] **Step 1: Write the failing check**: `check("auto price: off by default; the key names the trade", AUTO_PRICE_KEY("roof") === "leadCenter:autoPrice:roof")` plus the cascade's pure decision `check("an unpriced lead with an estimate gets the suggestion only with the switch on", offerPriceFor({ priceCents: null, estimate: e, exclusive: false, autoOn: true }) === 3500 && offerPriceFor({ priceCents: null, estimate: e, exclusive: false, autoOn: false }) === null && offerPriceFor({ priceCents: 5000, estimate: e, exclusive: true, autoOn: true }) === 5000)` — `offerPriceFor` is a pure export of `lib/leadCenter/autoPrice.ts` the cascade calls.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.** The DTO's `source` comes from the `LeadSource` row (include it in the `findMany`).
- [ ] **Step 4: Run the check, the full tsc, and the stand: the Lead Center shows the Priced block and the suggestion for the walk's lead; with the switch on and routing AUTO, a new priced lead's offer carries `priceCents = 3500`.**
- [ ] **Step 5: Commit** `feat(lead-center): the homeowner's estimate on the lead, a suggested price, auto-price per trade (off)`

---

### Task 9: "Priced, not asking yet"

**Files:**
- Modify: `src/app/(admin)/admin/lead-center/page.tsx` (load `db.homePlan.findMany({ where: { status: "PLANNED", notes: { startsWith: PRICE_PLAN_TAG } }, orderBy: { createdAt: "desc" }, take: 200, include: { home: { select: { city: true, state: true } } } })` → `savedRanges: Array<{ id; createdAt; city; state; estimate: LeadEstimate }>`)
- Modify: `src/components/v3/admin-lead-center/lead-center-content.tsx` (a section under the leads list: heading "Priced, not asking yet · N", rows city/state · `estimateShort` · when; **no names, emails or phones**, nothing clickable to route or price; `data-lead-saved-ranges`)

**Interfaces:**
- Consumes: `parsePlanEstimate`, `estimateShort`.

- [ ] **Step 1: Implement the load and the section.**
- [ ] **Step 2: Verify on the stand**: after the walk's email-only submit, the section shows 1 row with the range and the city and no email anywhere in its HTML (`!/sarah@|@example/.test(sectionHtml)`).
- [ ] **Step 3: Commit** `feat(lead-center): the ranges people saved but did not ask for — counted, never sold`

---

### Task 10: The contractor's offer and the accepted lead

**Files:**
- Modify: `src/actions/leadOffers.ts:18` (`pendingLeadOffers` adds `estimateShort: string | null` and `exclusive: boolean`)
- Modify: `src/components/leads/LeadOfferPopup.tsx` (the range line under the trade, the "Exclusive — nobody else gets this lead" line)
- Modify: `src/lib/leadCenter/accept.ts:57` (the org `Lead.description` = `pl.description` already carries `estimateWords`; nothing more — assert in the walk)

**Interfaces:**
- Consumes: `readLeadEstimates`, `estimateShort`, `exclusiveOf`.

- [ ] **Step 1: Implement.** One `readLeadEstimates` for all open offers.
- [ ] **Step 2: Verify on the stand**: the contractor's popup shows "$14,200–$19,800 · architectural shingle · 21 sq · aerial read" and, when exclusive, the exclusive line; after Accept the org lead's description starts with "Roof replacement, architectural shingle".
- [ ] **Step 3: Commit** `feat(leads): the offer shows the homeowner's range; exclusive said on the card`

---

### Task 11: Open in the roof estimator on the right building

**Files:**
- Modify: `src/lib/estimateSeed.ts:17` (`EstimateSeed.lat?: number | null; lng?: number | null`)
- Modify: `src/actions/leadEstimate.ts:23` (`startEstimateFromLead`: `db.platformLead.findFirst({ where: { matchedLeadId: lead.id }, select: { lat: true, lng: true } })` → the seed's `lat`/`lng`)
- Modify: `src/app/dashboard/roof-estimator/page.tsx:32` and the data form's seed consumer (`roof-estimator-data-form.tsx`, where the seed's `address` prefills the intake): when the seed has `lat`/`lng`, set `picked = { address, lat, lng }` so `orderInput()` sends the pin and the 2026-10-26 at-pin rule picks the building

**Interfaces:**
- Consumes: `PlatformLead.matchedLeadId` (schema:591).

- [ ] **Step 1: Implement the three changes.**
- [ ] **Step 2: Verify**: `qa/tests/logic/roof-structures.check.ts` and `roof-mansard.check.ts` still pass; on the stand, "Roof estimator — start estimate" from the accepted lead lands on the form with the address filled and, in the console's `[roof:debug]` line, `lat/lng` present in the measure input.
- [ ] **Step 3: Commit** `feat(roof): a Lead Center lead opens the estimator on its own pin`

---

### Task 12: Entry points

**Files:**
- Modify: `src/components/v3/landing-e/hero.tsx:162` (beside `HomeownerDoor`, a second homeowner button "See your price first" → `/price/roof` when `variantKey` is roofing, else `/price`; its own tracked spot `price`)
- Modify: `src/app/(marketing)/cost/[trade]/[city]/page.tsx:122` (above the calculator card: "See the price for your address" → `/price/roof?city=<city>&state=<state>` for `roof-replacement`, `/price` for other trades; `data-seo-cta="price"`)
- Modify: `src/components/v3/homeowner-landing/wizard/homeowner-wizard.tsx` and `mobile-homeowner/mobile-homeowner-wizard.tsx` (on the describe step, a quiet line: "Want a price first? Price it in a minute." → `/price`)
- `/home/[key]` link: done in Task 7; nav: done in Task 4.

- [ ] **Step 1: Implement the three links.** The roofing landing's hero keeps every other variant's server markup byte-identical (the 2026-10-04 rule): render the button only for `adScreen` homeowner door cases, same guard as `HomeownerDoor`.
- [ ] **Step 2: Verify**: `curl -s 'localhost:3530/?industry=roofing' | grep -c '/price/roof'` ≥ 1; `curl -s localhost:3530/cost/roof-replacement/bellevue-wa | grep -c 'data-seo-cta="price"'` → 1; the describe step shows the line at 390 px.
- [ ] **Step 3: Commit** `feat(price): doors from the ads, the cost guides and the describe intake`

---

### Task 13: The stand and the walk

**Files:**
- Create (scratchpad, not the repo): `$SP/roofw/fake-solar.js` (an HTTP server on :3610 answering `/v1/buildingInsights:findClosest?location.latitude=…`: a synthetic HIGH-quality insights JSON for lat within 0.01 of 42.948, a 404 `NOT_FOUND` for anything else; counts hits at `/hits`)
- Create: `$SP/roofw/dev-price.sh` (the Task-2 worktree's stand on :3530 with `SOLAR_API_BASE=http://127.0.0.1:3610/v1`, `GOOGLE_MAPS_API_KEY=stand`, `EMAIL_DEV_OUTBOX`, the roof stand's DB copy)
- Create: `$SP/roofw/price-walk.js` (playwright-core, `NODE_PATH=$SP/walk/node_modules`): desk 1440 + phone 390: steps 1–10 named in Tasks 5–7, then the Lead Center (admin `state.json`), the offer popup for the seeded contractor, Accept, the lead page, the estimator hand-off; prints PASS/FAIL per step and `N/N passed`
- Modify (repo): `qa/tests/_lib/fixtures/solar-insights.json` (the synthetic insights the fake server and Task 1's check share)

- [ ] **Step 1: Write the fake Solar server and the stand script; start the stand.**
- [ ] **Step 2: Write the walk; run it: `cd $SP && NODE_PATH=$SP/walk/node_modules node roofw/price-walk.js` — expect every step PASS and `hits` = 1 after the chips, 1 after a second visitor on the same address.**
- [ ] **Step 3: Phone pass**: no horizontal scroll on `/price`, `/price/roof` and the range view (`document.scrollingElement.scrollWidth <= innerWidth`).
- [ ] **Step 4: Commit the fixture** `chore(qa): synthetic Solar insights fixture for the price walk`

---

### Task 14: Full type-check, lint, PR

- [ ] **Step 1:** `NODE_OPTIONS=--max-old-space-size=8192 npx --no-install tsc --noEmit -p tsconfig.json` → 0 errors; `npx eslint` on every changed file → clean.
- [ ] **Step 2:** Run every roof check and the three new checks → all pass.
- [ ] **Step 3:** Re-read the homeowner-facing copy against the Global Constraints (no "quote", "verified", "EagleView", "Smart Proposal"; the disclaimer on the range view and the request page).
- [ ] **Step 4:** Push the branch, open the PR (`gh pr create --base main --head home-price`), body per the repo's attribution rule; the owner merges (the classifier refuses `gh pr merge`).
