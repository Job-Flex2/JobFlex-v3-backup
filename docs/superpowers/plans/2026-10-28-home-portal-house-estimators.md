# Home portal · the house estimators — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `/price` card runs JobFlex's own estimator for the homeowner (deck, fence, heating & cooling, any project) and the lead arrives in the Lead Center with the whole estimate, so the contractor who buys it opens it priced in their own estimator.

**Architecture:** The website estimators (`/estimate/<slug>/<trade>`) run in a "house mode" behind the reserved slug `jobflex`, answered from the internal organization the admin picks (`leadCenter:houseOrgId`). A house send becomes a Lead Center lead (`createHomeownerLead`) carrying a widened `LeadEstimate` with the website's `WebEstimateRecord`; Accept copies that record onto the buyer's org lead as `webLead:<leadId>`, which the lead page and the estimators already read. The fence, HVAC and Smart Proposal estimators learn to open from that record (their pages read it by `seed.leadId`).

**Tech Stack:** Next.js 16 server actions, Prisma (SyncState key/value rows, no schema change), pure `qa/tests/logic/*.check.ts` checks run with `NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json <file>`, playwright-core walks on the `:3530` stand.

**Spec:** `docs/superpowers/specs/2026-10-28-home-portal-house-estimators-design.md`

## Global Constraints

- No Prisma schema change. The estimate rides in `SyncState` (`leadestimate:<platformLeadId>`), the buyer's copy in `webLead:<orgLeadId>`.
- The house slug is `jobflex`; `webShopBySlug("jobflex")` answers from `houseOrgId()` only, never from an organization that has that slug. No house org set → the house pages 404 and the `/price` cards keep today's describe links.
- The roof stays on `/price/roof`; the house roof trade is off.
- The house shows a range only (`show: "range"`, the ±12 % band). Never a line item on a homeowner's screen.
- The house's ceilings: 2,000 estimates a month, 600 estimates an hour, 120 leads an hour; every per-IP brake unchanged.
- The house lead's source is `price:<trade>`, its consent `LEAD_CONSENT_TEXT`; email required on the house pages.
- The contractor-facing website estimators keep their behaviour, prices and words; `web-estimator.check.ts` and `web-addon.check.ts` stay green.
- The repo is public: no customer data in fixtures. Stand files live in the scratchpad, never committed.
- Commit per task with `git add <exact files>`; run the full tsc (`NODE_OPTIONS=--max-old-space-size=8192 npx --no-install tsc --noEmit -p tsconfig.json`) before the end; push only on the owner's "push".

## Review Focus

1. A homeowner on `/estimate/jobflex/fence` who typed the feet (no map, no pin): the lead must still route as a fence lead (the trade is known; the address is geocoded) — Task 3's intake change (walked in Task 10, step 2: the stand's fence send types the feet) and Task 7's `fenceSeedFromWebLead` with no points (checked).
2. A buyer who presses the generic **Roof estimator** card on a fence lead's page: `openRoofLeadEstimate` must refuse politely, never read `hidden` — Task 2's guard (a server action; walked in Task 10, step 4).
3. A deck lead bought by a shop: the buyer's copy must not point at the house org's draft — Task 2's `buyerWebLeadRecord` check (no `draftId`, no `token`, `organizationId` the buyer's).
4. An HVAC lead made before this change (no `site` in the facts): the buyer's HVAC estimator must still open on the design step from the address, the pin and the square feet — Task 8's fallback check.
5. A smart record whose `facts.estimate` does not parse (an older or truncated row): Smart Proposal opens as before, with the brief, never crashes — Task 9's `smartSeedFromWebLead` null check.

---

### Task 1: The house shop and its gates

**Files:**
- Modify: `src/lib/webEstimator.ts` (the pure module — `WebShop`, `WebEstimateRecord`, `WebLeadContact`, `WebLeadRecord` move here from the server module; the house constants and builders are added)
- Modify: `src/lib/webEstimatorServer.ts:72-94` (`webShopBySlug`), re-export the moved types, add `webShopServes`
- Modify: `src/actions/webEstimator.ts:246-251` (`liveShop`), `:519` (`web-lead-shop`), the `web-est-shop` brakes (`webHvacLookup` ~374, `webFenceLot` ~461, `webFencePrice` ~479, `webEstimate`/`webRoofMeasure` where present), `:574` (`webDeckStart`), `:605` (`webDeckResume`), `:702` (`webPageModel`)
- Modify: `src/actions/advancedEstimator.ts:1311-1325` (`webSmartGate`)
- Test: `qa/tests/logic/web-house.check.ts` (new)

**Interfaces:**
- Consumes: `houseOrgId()` from `src/lib/publicEstimate/store.ts`; `webTradeLive` from `src/lib/webAddonBilling.ts`.
- Produces (in `src/lib/webEstimator.ts`): `HOUSE_SLUG = "jobflex"`, `HOUSE_NAME = "JobFlex"`, `HOUSE_MONTHLY_CAP = 2000`, `HOUSE_HOURLY = { estimates: 600, leads: 120 }`, `SHOP_HOURLY = { estimates: 120, leads: 60 }`, `houseSettings(): WebEstimatorSettings`, `houseShop(orgId: string): WebShop`, `isHouse(shop: { slug: string }): boolean`, `shopHourly(shop: { slug: string }): { estimates: number; leads: number }`. In `src/lib/webEstimatorServer.ts`: `webShopServes(shop: WebShop, trade: WebTrade): Promise<boolean>`.

- [ ] **Step 1: Write the failing check**

```ts
// qa/tests/logic/web-house.check.ts — the house shop (lib/webEstimator, 2026-10-28), pure parts
import { HOUSE_HOURLY, HOUSE_MONTHLY_CAP, HOUSE_NAME, HOUSE_SLUG, SHOP_HOURLY, houseSettings, houseShop, isHouse, shopHourly, WEB_TRADES } from "../../../src/lib/webEstimator";
const s = houseSettings();
check("the house slug and name are reserved", HOUSE_SLUG === "jobflex" && HOUSE_NAME === "JobFlex");
check("every trade on but the roof, a range, the default spread, the email asked, no domains, 2,000 a month",
  WEB_TRADES.every((t) => s.trades[t].on === (t !== "roof") && s.trades[t].show === "range" && s.trades[t].spread === 0.12 && s.trades[t].askEmail && s.trades[t].note === "" && s.trades[t].materials.length === 0)
  && s.domains.length === 0 && s.monthlyCap === HOUSE_MONTHLY_CAP && HOUSE_MONTHLY_CAP === 2000);
const h = houseShop("org_house");
check("the house shop is JobFlex on the house org, no logo, no phone, no website, no state, the house settings",
  h.id === "org_house" && h.name === "JobFlex" && h.slug === "jobflex" && h.logoUrl === null && h.primaryColor === null && h.phone === null && h.website === null && h.state === null && JSON.stringify(h.settings) === JSON.stringify(s));
check("isHouse by the slug alone", isHouse(h) && !isHouse({ slug: "ridgeline-roofing" }) && !isHouse({ slug: "jobflex-roofing" }));
check("the house's hourly ceilings are its own; a shop keeps today's", JSON.stringify(shopHourly(h)) === JSON.stringify(HOUSE_HOURLY) && HOUSE_HOURLY.estimates === 600 && HOUSE_HOURLY.leads === 120 && JSON.stringify(shopHourly({ slug: "x" })) === JSON.stringify(SHOP_HOURLY) && SHOP_HOURLY.estimates === 120 && SHOP_HOURLY.leads === 60);
```
(Use the file's `check`/`bad`/exit pattern from `qa/tests/logic/public-estimate-store.check.ts`.)

- [ ] **Step 2: Run it to see it fail**

Run: `cd $WT && NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/web-house.check.ts`
Expected: FAIL — `HOUSE_SLUG` (and the others) are not exported.

- [ ] **Step 3: Move the record types and add the house to `src/lib/webEstimator.ts`**

Move `WebShop` (server :72-83), `WebEstimateRecord` (:125-145), `WebLeadContact` (:199), `WebLeadRecord` (:202) into `src/lib/webEstimator.ts` unchanged; in `webEstimatorServer.ts` replace them with `export type { WebShop, WebEstimateRecord, WebLeadContact, WebLeadRecord } from "./webEstimator";` and import what it uses. Add the constants and functions named in Produces. `houseSettings()` = `defaultWebEstimatorSettings()` with every trade `on: true` except `roof`, `monthlyCap: HOUSE_MONTHLY_CAP`. `shopHourly` = `isHouse(shop) ? HOUSE_HOURLY : SHOP_HOURLY`.

- [ ] **Step 4: Run the check to see it pass; keep the old ones green**

Run: the Task 1 check, then `qa/tests/logic/web-estimator.check.ts` and `qa/tests/logic/web-addon.check.ts`.
Expected: all passed, three times.

- [ ] **Step 5: `webShopBySlug` answers the house; `webShopServes`**

In `src/lib/webEstimatorServer.ts`:

```ts
export async function webShopBySlug(slug: string): Promise<WebShop | null> {
  if (slug === HOUSE_SLUG) {
    // The house (docs/superpowers/specs/2026-10-28-home-portal-house-estimators-design.md): the internal org the admin
    // picked on the Lead Center; none picked, no page — never an organization that happens to carry the slug.
    const id = await houseOrgId();
    if (!id) return null;
    const org = await db.organization.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
    return org && !org.deletedAt ? houseShop(org.id) : null;
  }
  … as today
}
/** Does this shop serve this trade to the public — the house by its own settings, a shop by its add-on (lib/webAddonBilling). */
export async function webShopServes(shop: WebShop, trade: WebTrade): Promise<boolean> {
  return isHouse(shop) ? shop.settings.trades[trade].on : webTradeLive(shop.id, trade, shop.settings.trades[trade].on);
}
```

- [ ] **Step 6: The gates and the brakes use them**

Replace `webTradeLive(shop.id, trade, shop.settings.trades[trade].on)` with `webShopServes(shop, trade)` at the five sites (liveShop, webDeckStart, webDeckResume, webPageModel, webSmartGate). Replace the literal `120` of every `web-est-shop:${shop.id}` brake with `shopHourly(shop).estimates` and the `60` of `web-lead-shop:${shop.id}` with `shopHourly(shop).leads` (in `advancedEstimator.ts:1317` too, where the gate has `shop` in hand).

- [ ] **Step 7: Type-check the touched files and commit**

Run: `cd $WT && NODE_OPTIONS=--max-old-space-size=8192 npx --no-install tsc --noEmit -p tsconfig.json 2>&1 | tail -5`
Expected: no errors (the full tsc takes ~3 minutes; run it in the background and read the tail).

```bash
git add src/lib/webEstimator.ts src/lib/webEstimatorServer.ts src/actions/webEstimator.ts src/actions/advancedEstimator.ts qa/tests/logic/web-house.check.ts
git commit -m "feat(house): the website estimators in house mode — the jobflex slug, JobFlex as the shop, its own ceilings"
```

---

### Task 2: The estimate beside the lead, for every trade

**Files:**
- Modify: `src/lib/leadCenter/estimate.ts` (the union, the readers, the buyer's record)
- Modify: `src/lib/leadCenter/autoPrice.ts:10-11` (`PRICED_TRADES`, `PricedTrade`, `isPricedTrade`)
- Modify: `src/actions/adminLeadCenter.ts:76-82` (`setLeadAutoPrice` validates with `isPricedTrade`)
- Modify (narrow on `trade`): `src/components/v3/admin-lead-center/lead-center-content.tsx:1566-1584` (`PricedBlock`), `src/lib/requestPortal.ts:124,384-386`, `src/app/(portal)/request/[token]/page.tsx:362-366`, `src/lib/home/portal.ts:365`, `src/app/(marketing)/price/roof/page.tsx:28-40`, `src/actions/publicEstimate.ts` (`serverEstimate`/`sendRangeEmail` take `RoofLeadEstimate`), `src/lib/email/build/platform.ts` (`buildPriceRangeEmail` param → `RoofLeadEstimate`), `src/actions/roofEstimator.ts:463-467` (the guard)
- Test: `qa/tests/logic/lead-estimate.check.ts`, `qa/tests/logic/lead-auto-price.check.ts` (extend)

**Interfaces:**
- Consumes: `WebEstimateRecord`, `WebLeadContact`, `WebLeadRecord`, `WebTrade`, `WEB_TRADE` (Task 1's pure module); `TradeType` from `src/lib/tradeTypes.ts`.
- Produces (in `estimate.ts`):
  - `type RoofLeadEstimate` = today's record (`trade: "roof"`); `type WebLeadTrade = Exclude<WebTrade, "roof">`; `type WebLeadEstimate = { v: 1; trade: WebLeadTrade; range: { low: number; mid: number; high: number }; at: string; budgetCents: null; measurementId?: null; note: string | null; web: WebEstimateRecord }`; `type LeadEstimate = RoofLeadEstimate | WebLeadEstimate`.
  - `leadEstimateFromWeb(web: WebEstimateRecord, note: string | null, at?: Date): WebLeadEstimate` — `range.low = web.band.low`, `high = web.band.high`, `mid = Math.round(web.cents / 100)`.
  - `parseLeadEstimate(raw: string | null | undefined): LeadEstimate | null` — the JSON guard `readLeadEstimates` uses, exported for the accept path.
  - `HOUSE_TRADE: Record<"deck" | "fence" | "hvac", TradeType> = { deck: "Decking", fence: "Fencing", hvac: "HVAC" }`; `houseSource(trade: WebLeadTrade): string` → `price:<trade>`; `TRADE_NOUN: Record<WebLeadTrade, string> = { deck: "deck", fence: "fence", hvac: "heating & cooling", smart: "project" }`.
  - `estimateWords(e)`: web → `Priced on JobFlex: ${summary} Chose: ${choice}. Shown $low–$high (before tax).` + ` Homeowner's note: "${note}"` when there is one.
  - `estimateShort(e)`: web → `$low–$high · ${choice} · ${TRADE_NOUN}`.
  - `estimateMaterialWords(e): string` — roof `materialLabel.toLowerCase()`, web `web.choice.toLowerCase()`.
  - `planRangeWords(e)`: web → `${Noun} range $low–$high · ${choice} — priced on JobFlex, not a quote` (noun capitalised).
  - `reopenFromEstimate(e: RoofLeadEstimate, address)` — parameter narrowed.
  - `buyerWebLeadRecord(e: WebLeadEstimate, a: { leadId: string; organizationId: string; contact: WebLeadContact }, at?: Date): WebLeadRecord` — `estimate.organizationId` = the buyer's; the deck's `facts.draftId` and `facts.token` left out; everything else as stored.
  - In `autoPrice.ts`: `PRICED_TRADES = ["roof", "deck", "fence", "hvac", "smart"] as const`, `type PricedTrade = (typeof PRICED_TRADES)[number]`, `isPricedTrade(v: unknown): v is PricedTrade`.

- [ ] **Step 1: Write the failing checks**

Append to `lead-estimate.check.ts` (a synthetic fence record — a Buffalo address, 180 ft of 6-ft cedar privacy, $8,210 → band $7,200–$9,400; and a deck record with `facts: { design: {…}, draftId: "d1", token: "t1", designedOnline: true }`):

```ts
const fence: WebEstimateRecord = { token: "tok", organizationId: "org_house", trade: "fence", at: "2026-10-28T10:00:00Z", address: "418 Linden Ave", city: "Buffalo", state: "NY", zip: "14216", summary: "180 ft of fence in 3 runs, 1 walk gate.", choice: "Cedar privacy, 6 ft", cents: 821000, band: { low: 7200, high: 9400 }, show: "range", facts: { runsFt: [60, 60, 60], type: "cedar-privacy", heightFt: 6, gates: 1, doubles: 0, pin: { lat: 42.948, lng: -78.853 } } };
const w = leadEstimateFromWeb(fence, "Back yard only", new Date("2026-10-28T10:05:00Z"));
check("a web estimate: the band as the range, the mid from the cents, no budget, no measurement, the note", w.trade === "fence" && w.range.low === 7200 && w.range.high === 9400 && w.range.mid === 8210 && w.budgetCents === null && !w.measurementId && w.note === "Back yard only" && w.web === fence && w.at === "2026-10-28T10:05:00.000Z");
check("its words", estimateWords(w) === 'Priced on JobFlex: 180 ft of fence in 3 runs, 1 walk gate. Chose: Cedar privacy, 6 ft. Shown $7,200–$9,400 (before tax). Homeowner\'s note: "Back yard only"');
check("its short line", estimateShort(w) === "$7,200–$9,400 · Cedar privacy, 6 ft · fence");
check("its suggested price is the unmeasured $35, $70 exclusive", suggestedLeadPriceCents(w, false) === 3500 && suggestedLeadPriceCents(w, true) === 7000);
check("its plan words", planRangeWords(w) === "Fence range $7,200–$9,400 · Cedar privacy, 6 ft — priced on JobFlex, not a quote" && estimateMaterialWords(w) === "cedar privacy, 6 ft");
check("the house trade and source", HOUSE_TRADE.fence === "Fencing" && HOUSE_TRADE.deck === "Decking" && HOUSE_TRADE.hvac === "HVAC" && houseSource("hvac") === "price:hvac");
check("the roof's words are untouched", estimateShort(roofEstimate) === <the line the file already pins>);
check("parseLeadEstimate takes a good row and refuses a bad one", parseLeadEstimate(JSON.stringify(w))?.trade === "fence" && parseLeadEstimate("{") === null && parseLeadEstimate(JSON.stringify({ v: 2 })) === null);
const rec = buyerWebLeadRecord(leadEstimateFromWeb(deck, null), { leadId: "lead_buyer", organizationId: "org_buyer", contact: { name: "Sarah Stand", phone: "(716) 555-0100", email: "s@example.com", note: null } }, new Date("2026-10-28T12:00:00Z"));
check("the buyer's record: their lead, their org, the design kept, the house's draft and link token left behind", rec.leadId === "lead_buyer" && rec.trade === "deck" && rec.estimate.organizationId === "org_buyer" && rec.estimate.facts.design && !("draftId" in rec.estimate.facts) && !("token" in rec.estimate.facts) && rec.estimate.facts.designedOnline === true && rec.contact.name === "Sarah Stand" && rec.at === "2026-10-28T12:00:00.000Z");
```

Append to `lead-auto-price.check.ts`:

```ts
check("five priced trades, one key each", PRICED_TRADES.join() === "roof,deck,fence,hvac,smart" && AUTO_PRICE_KEY("fence") === "leadCenter:autoPrice:fence" && isPricedTrade("hvac") && !isPricedTrade("roofing"));
check("a web estimate gets the suggestion with its trade's switch on", offerPriceFor({ priceCents: null, estimate: webEstimate, exclusive: true, autoOn: true }) === 7000 && offerPriceFor({ priceCents: null, estimate: webEstimate, exclusive: false, autoOn: false }) === null);
```

- [ ] **Step 2: Run both to see them fail**

Run: both checks.
Expected: FAIL — `leadEstimateFromWeb`, `PRICED_TRADES` etc. not exported.

- [ ] **Step 3: Implement the union and the readers in `estimate.ts` and `autoPrice.ts`**

Narrow every roof-only reader with `e.trade === "roof"` (or `"trade" in e && e.trade !== "roof"`); `reopenFromEstimate` takes `RoofLeadEstimate`. `parseLeadEstimate` = the parse `readLeadEstimates` does (`v === 1` and a numeric `range.mid`); `readLeadEstimates` in `estimateStore.ts` uses it.

- [ ] **Step 4: Run the two checks to see them pass**

Expected: all passed, twice.

- [ ] **Step 5: Narrow the readers outside the module**

- `PricedBlock` (lead-center-content.tsx:1566): `if (e.trade !== "roof")` render `<b>$low–$high</b> · {e.web.choice} · {TRADE_NOUN}` / `{e.web.summary}` / note when there is one / `<span dim>Opens priced in the buyer's {WEB_TRADE[e.trade].estimator-name}.</span>`; the roof branch as it is. Keep `data-lead-priced`.
- `requestPortal.ts:124,385`: `estimate: { range: string; material: string; basis: string; words: string } | null` — roof as today plus `words` = the sentence the page prints today by basis; web: `material: estimateMaterialWords(est)`, `basis: "priced on JobFlex"`, `words: "An estimate range from JobFlex's own estimator, not a quote. A local pro confirms on site."`. `request/[token]/page.tsx:365` prints `v.estimate.words`.
- `portal.ts:365`: `estimateMaterialWords(…)`.
- `price/roof/page.tsx:28-40`: `const e = parsePlanEstimate(…); if (e?.trade === "roof") {…}`.
- `publicEstimate.ts` + `email/build/platform.ts`: `RoofLeadEstimate` in the signatures (`serverEstimate` already builds a roof record).
- `roofEstimator.ts:464`: after the `!e` check, `if (e.trade !== "roof") return { ok: false, error: \`This lead's estimate opens in the ${WEB_TRADE[e.trade].name.replace(" on your website", "").toLowerCase()} — use that card.\`, none: true };`
- `adminLeadCenter.ts:78`: `if (!isPricedTrade(trade)) throw new Error("Unknown trade");`

- [ ] **Step 6: tsc and commit**

Run: the full tsc (background, read the tail). Expected: no errors.

```bash
git add src/lib/leadCenter/estimate.ts src/lib/leadCenter/estimateStore.ts src/lib/leadCenter/autoPrice.ts src/actions/adminLeadCenter.ts src/components/v3/admin-lead-center/lead-center-content.tsx src/lib/requestPortal.ts "src/app/(portal)/request/[token]/page.tsx" src/lib/home/portal.ts "src/app/(marketing)/price/roof/page.tsx" src/actions/publicEstimate.ts src/lib/email/build/platform.ts src/actions/roofEstimator.ts qa/tests/logic/lead-estimate.check.ts qa/tests/logic/lead-auto-price.check.ts
git commit -m "feat(lead-center): the estimate beside a lead for deck, fence, HVAC and any project — the buyer's record, the switches per trade"
```

---

### Task 3: The house lead — a send on a house page is a Lead Center lead

**Files:**
- Modify: `src/lib/leadCenter/intake.ts:95,114-123` (`known` without a pin)
- Create: `src/lib/publicEstimate/houseLead.ts` (server)
- Modify: `src/lib/webEstimator.ts:200-215` (`homeownerEmail` house words)
- Modify: `src/lib/webEstimatorServer.ts` (export `dropWebEstimate(token: string): Promise<void>` — the `writeKey(webEstimateKey(token), null)` `createWebLead` does)
- Modify: `src/actions/webEstimator.ts:514-539` (`webLead`), `:635-677` (`webDeckSend`)
- Modify: `src/components/v3/deck-client-design/deck-client-designer.tsx:281` (the send result type gains `next?: string`)
- Test: `qa/tests/logic/web-estimator.check.ts` (extend)

**Interfaces:**
- Consumes: Task 1 (`isHouse`, `HOUSE_NAME`, `WebShop`, `WebEstimateRecord`, `WebLeadContact`), Task 2 (`leadEstimateFromWeb`, `estimateWords`, `HOUSE_TRADE`, `houseSource`), `createHomeownerLead` + `IntakeOptions` (`src/lib/leadCenter/intake.ts:80-98`, returns `{ platformLeadId, statusPath, requestToken, homePath }`), `LEAD_CONSENT_TEXT` (`src/lib/leadConsent.ts`), `PROJECT_TYPE` (`src/lib/webEstimator.ts:184`), `sendEmail` (`@/lib/sdk/resend`), `afterResponse`, `appBaseUrl`, `clientIp`.
- Produces: `createHouseLead(shop: WebShop, est: WebEstimateRecord, contact: WebLeadContact & { email: string }, ctx: { ip: string; page: string; timezone?: string | null }): Promise<{ platformLeadId: string; next: string }>`; `webLead` → `{ ok: true; leadId: string; next?: string } | Fail`; `webDeckSend` → `{ ok: true; at: string; leadId: string; next?: string } | Fail`; `homeownerEmail(input & { house?: { url: string } | null })`; `IntakeOptions.known: { trade: DetectedTrade; lat?: number | null; lng?: number | null } | null`.

- [ ] **Step 1: Write the failing check (the house email)**

Append to `web-estimator.check.ts`, beside the existing `homeownerEmail` check (whose text must stay as pinned):

```ts
const hm = homeownerEmail({ shop: "JobFlex", trade: "fence", band: { low: 7200, high: 9400 }, show: "range", summary: "180 ft of fence in 3 runs, 1 walk gate.", choice: "Cedar privacy, 6 ft", phone: "(716) 555-0100", house: { url: "https://www.jobflex.app/request/abc" } });
check("the house's email: JobFlex in the subject, a local pro will call, the request page's link, no 'website'", hm.subject === "Your fence, priced — $7,200 – $9,400 — JobFlex" && /Thanks for pricing your fence on JobFlex\./.test(hm.text) && /JobFlex is sending it to a local pro, who will be in touch to confirm the details at \(716\) 555-0100\./.test(hm.text) && /Follow your request: https:\/\/www\.jobflex\.app\/request\/abc/.test(hm.text) && !/website/.test(hm.text));
```

- [ ] **Step 2: Run it to see it fail**

Expected: FAIL — the subject/text are the shop's words ("…on JobFlex's website", "JobFlex has your request…").

- [ ] **Step 3: `homeownerEmail` house words**

When `input.house`: first line `Thanks for pricing your ${TRADE_NOUN-like word} on JobFlex.` (deck/fence/heating & cooling/project — reuse `WEB_TRADE[t].title` lower-cased minus ", priced"? No: a plain map `{ roof: "roof", hvac: "new system", fence: "fence", deck: "deck", smart: "project" }` local to the function), the price line as today, then `JobFlex is sending it to a local pro, who will be in touch to confirm the details${phone}.` and `Follow your request: ${house.url}`. The shop path unchanged.

- [ ] **Step 4: Run the check to see it pass (whole file green)**

- [ ] **Step 5: `known` without a pin**

`intake.ts:95`: `known?: { trade: DetectedTrade; lat?: number | null; lng?: number | null } | null`. `:116-123`: the geo branch is `opts.known?.lat != null && opts.known?.lng != null ? Promise.resolve({ lat, lng, city, state }) : geocodeOrReuse(…)`; the trade branch stays `opts.known ? opts.known.trade : detectTrade(…)`. Update the comment: a trade the homeowner chose stands with or without a pin.

- [ ] **Step 6: `createHouseLead`**

`src/lib/publicEstimate/houseLead.ts`: build `e = leadEstimateFromWeb(est, contact.note)`, `words = estimateWords(e)`, `pin = est.facts.pin` when it is `{ lat: number; lng: number }`, `known = est.trade === "smart" ? null : { trade: { trade: HOUSE_TRADE[est.trade], confidence: 1, reason: "the homeowner priced it on JobFlex" }, lat: pin?.lat ?? null, lng: pin?.lng ?? null }`; `createHomeownerLead({ name, email, phone, address: est.address, city: est.city ?? undefined, state: est.state ?? undefined, zip: est.zip ?? undefined, projectType: PROJECT_TYPE[est.trade], description: words, scope: words }, { isTest: false, timezone, source: houseSource(est.trade), consent: { text: LEAD_CONSENT_TEXT, at: new Date(), ip: ip === "local" || ip === "unknown" ? null : ip, page }, estimate: e, known })`; then `dropWebEstimate(est.token)`, `bumpWebCount(shop.id, "leads")` (best-effort), and `afterResponse` → `homeownerEmail({ shop: HOUSE_NAME, …, house: { url: \`${await appBaseUrl()}${statusPath}\` } })` → `sendEmail` (the `<pre>` html as `createWebLead` does). Return `{ platformLeadId, next: statusPath }`.

- [ ] **Step 7: `webLead` and `webDeckSend` branch for the house**

`webLead`, after the consent and honeypot checks: `if (isHouse(shop)) { if (!email) return { ok: false, error: "Your email, please — your request page and your dashboard are sent there." }; const r = await createHouseLead(shop, est, { name, phone, email, note }, { ip, page: \`/estimate/jobflex/${trade}\` }); return { ok: true, leadId: r.platformLeadId, next: r.next }; }`. The consent error for the house reads "Tick the box so a local pro may contact you." (shop: unchanged).
`webDeckSend`, after `storeWebEstimate(...)`: the same branch — email required, `createHouseLead(shop, est, …, { ip, page: "/estimate/jobflex/deck" })`, `fileWebClientLink(token, { leadId: platformLeadId, clientEmail: email })`, return `{ ok: true, at: sent.at, leadId: platformLeadId, next }`. The resend branch (`link.web.leadId` set) stays as it is.
`deck-client-designer.tsx:281`: the `send` result type gains `next?: string` (the page uses it in Task 5).

- [ ] **Step 8: tsc and commit**

```bash
git add src/lib/leadCenter/intake.ts src/lib/publicEstimate/houseLead.ts src/lib/webEstimator.ts src/lib/webEstimatorServer.ts src/actions/webEstimator.ts src/components/v3/deck-client-design/deck-client-designer.tsx qa/tests/logic/web-estimator.check.ts
git commit -m "feat(house): a send on a house page is a Lead Center lead with the estimate, the consent and the trade"
```

---

### Task 4: The buyer's hand-off — Accept copies the record; the lead page shows it

**Files:**
- Modify: `src/lib/leadCenter/accept.ts:30-110` (`acceptOfferTx`)
- Modify: `src/app/dashboard/leads/[id]/page.tsx:78-82`
- Modify: `src/components/v3/lead-detail-blueprint/lead-detail-content.tsx:104,250-256`
- Modify: `src/lib/webEstimator.ts:163-169` (`HANDOFF_WORDS` for hvac, fence, smart)
- Test: Task 2's `buyerWebLeadRecord` check covers the record; the walk (Task 10) covers the page. Extend `web-estimator.check.ts` with one line pinning the three new `HANDOFF_WORDS` so a later edit is deliberate.

**Interfaces:**
- Consumes: Task 2 (`parseLeadEstimate`, `buyerWebLeadRecord`, `LEAD_ESTIMATE_KEY`), `webLeadKey` (`src/lib/webEstimator.ts`), `readWebLead`, `WEB_LEAD_SOURCE`.
- Produces: `LeadDetailProps.website` gains `house: boolean`.

- [ ] **Step 1: Write the failing check**

```ts
check("the hand-off words say the estimator opens priced", /priced in your book/.test(HANDOFF_WORDS.fence) && /tier they picked/.test(HANDOFF_WORDS.hvac) && /lines they were priced on/.test(HANDOFF_WORDS.smart));
```

- [ ] **Step 2: Run it to see it fail** — Expected: FAIL on today's words.

- [ ] **Step 3: The words**

`hvac: "Opens with their house looked up and sized, the tier they picked selected and priced in your book — adjust, then send the proposal."`, `fence: "Opens on their lot with the fence as they drew it — the style, the height, the gates — priced in your book."`, `smart: "Opens Smart Proposal at the result with the lines they were priced on — re-price in your own method and send the proposal."`

- [ ] **Step 4: Run it to see it pass**

- [ ] **Step 5: Accept copies the record, in the transaction**

In `acceptOfferTx`, after `tx.lead.create` and before the `platformLead.update`:

```ts
// A lead the homeowner priced in a house estimator (2026-10-28): the website-estimate record goes onto the buyer's
// lead as `webLead:<leadId>` — the record the website estimators write — so the lead page's "Open in the estimator"
// opens it priced. The deck's draft stays in the house org; the buyer's copy carries the design only.
const estRow = await tx.syncState.findUnique({ where: { key: LEAD_ESTIMATE_KEY(pl.id) } });
const est = parseLeadEstimate(estRow?.cursor);
if (est && est.trade !== "roof") {
  const rec = buyerWebLeadRecord(est, { leadId: lead.id, organizationId, contact: { name: pl.name, phone: pl.phone ?? "", email: pl.email ?? null, note: est.note } }, now);
  const cursor = JSON.stringify(rec);
  await tx.syncState.upsert({ where: { key: webLeadKey(lead.id) }, update: { cursor }, create: { key: webLeadKey(lead.id), cursor } });
}
```

- [ ] **Step 6: The lead page reads it for a Lead Center lead too**

`page.tsx:79`: `const web = lead.source === WEB_LEAD_SOURCE || lead.source === "LEAD_CENTER" ? await readWebLead(lead.id).catch(() => null) : null;`; the `website` object gains `house: lead.source !== WEB_LEAD_SOURCE`. `lead-detail-content.tsx:104` type gains `house: boolean`; `:252` heading `website.house ? "Priced by the homeowner on JobFlex" : "From your website estimator"`; `:254` for the house: `They priced it on JobFlex, chose <b>{choice}</b> and saw <b>{price}</b> before tax (a range).`

- [ ] **Step 7: tsc and commit**

```bash
git add src/lib/leadCenter/accept.ts "src/app/dashboard/leads/[id]/page.tsx" src/components/v3/lead-detail-blueprint/lead-detail-content.tsx src/lib/webEstimator.ts qa/tests/logic/web-estimator.check.ts
git commit -m "feat(lead-center): Accept hands the buyer the homeowner's website estimate; the lead page opens it"
```

---

### Task 5: The house pages speak for JobFlex and land on the request page

**Files:**
- Modify: `src/lib/webEstimator.ts` (pure `pageWords`)
- Modify: `src/actions/webEstimator.ts:699-717` (`webPageModel` → `shop.house`, `consentText`)
- Modify: `src/components/v3/web-estimate/web-head.tsx`, `web-estimate.tsx`, `web-fence.tsx`, `web-hvac.tsx`, `web-smart.tsx`, `web-deck.tsx`
- Modify: `src/components/v3/deck-client-design/deck-client-designer.tsx:507-533,922-935` (email required for the house, consent words, `next`)
- Modify: `src/app/(portal)/estimate/[slug]/[trade]/page.tsx` (the house's page background/`<main>` unchanged; passes `shop` through — nothing else)
- Test: `qa/tests/logic/web-estimator.check.ts` (extend: `pageWords`)

**Interfaces:**
- Consumes: Task 1 (`isHouse`, `HOUSE_NAME`), Task 3 (`next` on the send results), `LEAD_CONSENT_TEXT`.
- Produces: `pageWords(shop: { name: string; house?: boolean }, noun: string): { sees: string; quote: string; consent: string; foot: string; call: string }` in `src/lib/webEstimator.ts`; `webPageModel(...).shop.house: boolean`; every web-estimate component's `shop` prop type gains `house?: boolean`; `WebHead` prop `house?: boolean`.

- [ ] **Step 1: Write the failing check**

```ts
const pw = pageWords({ name: "Ridgeline Roofing" }, "fence"), hw = pageWords({ name: "JobFlex", house: true }, "fence");
check("a shop's page words name the shop", pw.sees === "No account, no payment. Ridgeline Roofing sees your request only when you send it." && pw.quote === "The full, line-by-line quote comes from Ridgeline Roofing after they look at it. You pick a time; they confirm the price." && pw.consent === "Ridgeline Roofing may call, text or email me about this fence." && pw.foot === "Estimates by JobFlex for Ridgeline Roofing. No prices are shown to anyone else; the final price follows a visit." && pw.call === "Call Ridgeline Roofing and they will price it in person.");
check("the house's page words: a local pro, the Lead Center's consent, no shop", hw.sees === "No account, no payment. JobFlex sends your request to a local pro only when you send it." && hw.quote === "The full, line-by-line quote comes from a local pro after they look at it. You pick a time; they confirm the price." && hw.consent === LEAD_CONSENT_TEXT && hw.foot === "Estimates by JobFlex. No prices are shown to anyone else; a local pro confirms on site." && hw.call === "Describe it instead and a local pro prices it.");
```

- [ ] **Step 2: Run it to see it fail** — Expected: FAIL — `pageWords` not exported.

- [ ] **Step 3: `pageWords` and `webPageModel`**

Implement `pageWords` exactly as the check says (the shop's strings are the ones the components print today — lift them, do not reword). `webPageModel` returns `shop: { …, house: isHouse(shop) }`.

- [ ] **Step 4: Run it to see it pass**

- [ ] **Step 5: The components**

In `web-estimate.tsx`, `web-fence.tsx`, `web-hvac.tsx`, `web-smart.tsx`, `web-deck.tsx`: `const w = pageWords(p.shop, <noun>)` (fence "fence", hvac "new system", smart "project", deck "deck", generic `p.trade`'s noun) and print `w.sees`, `w.quote`, `w.consent`, `w.foot`, `w.call` where the literal strings stand today (the "Call {shop}…" fallbacks: for the house render `w.call` with a link to `/homeowner`). The email field: for the house the label is "Email" with no "optional" small print and `required`. After a successful send: `if ("next" in r && r.next) { window.location.assign(r.next); return; }` before `setStep("done")`. `WebHead`: `house` → the by-line hidden, a `<a href="/price" className="we-back" data-web-back>← Price another project</a>` in the header (not in embed). `deck-client-designer.tsx`: the consent label prints `w.consent` when `props.website` carries `house` (pass `house` through `website`), the email is required for the house, and `res.next` navigates. Add `.we-back` to `web-estimate.css`.

- [ ] **Step 6: tsc, lint the touched components, commit**

Run: `npx --no-install next lint --file <each touched tsx>` (or the repo's lint script) — Expected: no new errors.

```bash
git add src/lib/webEstimator.ts src/actions/webEstimator.ts src/components/v3/web-estimate/ src/components/v3/deck-client-design/deck-client-designer.tsx qa/tests/logic/web-estimator.check.ts
git commit -m "feat(house): the house pages speak for JobFlex — a local pro, the Lead Center's consent, the request page after a send"
```

---

### Task 6: The `/price` cards and the Lead Center settings

**Files:**
- Create: `src/components/v3/price-my-project/cards.ts` (pure)
- Modify: `src/components/v3/price-my-project/price-row.tsx` (`PriceRow({ trade, house })` reads `priceCards(house)`)
- Modify: `src/app/(marketing)/price/page.tsx`, `src/app/(marketing)/price/roof/page.tsx` (`house = !!(await houseOrgId())`; `export const dynamic = "force-dynamic"` on `/price`)
- Modify: `src/lib/publicEstimate/store.ts` (`setHouseOrgId`)
- Modify: `src/actions/adminLeadCenter.ts` (`setHouseOrg`)
- Modify: `src/app/(admin)/admin/lead-center/page.tsx:137-142,376-388`, `src/components/v3/admin-lead-center/lead-center-content.tsx:388-430,555-563` (+ `admin-lead-center.module.css` for the picker)
- Test: `qa/tests/logic/price-cards.check.ts` (new)

**Interfaces:**
- Consumes: `houseOrgId`/`HOUSE_ORG_KEY` (`src/lib/publicEstimate/store.ts`), Task 2 (`PRICED_TRADES`, `PricedTrade`), `requirePlatformAdmin`, `OrgPickDTO.isInternal`.
- Produces: `priceCards(house: boolean): ReadonlyArray<{ key: PriceCardKey; title: string; blurb: string; go: string; href: string; live: boolean }>`; `setHouseOrgId(id: string | null): Promise<void>`; `setHouseOrg(organizationId: string | null): Promise<{ ok: true }>`; `AdminLeadCenterContent` props `autoPrice: Record<PricedTrade, boolean>`, `houseOrgId: string | null`.

- [ ] **Step 1: Write the failing check**

```ts
import { priceCards } from "../../../src/components/v3/price-my-project/cards";
const off = priceCards(false), on = priceCards(true);
check("five cards, the roof first and live either way", off.length === 5 && off[0].key === "roof" && off[0].href === "/price/roof" && off[0].live && on[0].href === "/price/roof");
check("no house: the four describe themselves", off.slice(1).every((c) => !c.live && /^\/homeowner/.test(c.href)));
check("the house set: deck, fence, heating & cooling and any project run the house estimators", on.map((c) => c.href).slice(1).join() === "/estimate/jobflex/deck,/estimate/jobflex/fence,/estimate/jobflex/hvac,/estimate/jobflex/smart" && on.slice(1).every((c) => c.live) && on[1].go === "Design my deck" && on[2].go === "Price my fence" && on[3].go === "Price my new system" && on[4].go === "Price my project");
```

- [ ] **Step 2: Run it to see it fail** — Expected: FAIL — module not found.

- [ ] **Step 3: `cards.ts`, `price-row.tsx`, the two pages**

Move `CARDS` into `priceCards(house)`: the roof row as is; house rows — deck `{ blurb: "Design it in 3D on your lot — priced as you build it.", go: "Design my deck" }`, fence `{ blurb: "Draw it on your lot from the air — a range in a minute.", go: "Price my fence" }`, hvac `{ blurb: "Your house looked up, the system sized to it — a range in a minute.", go: "Price my new system" }`, any `{ blurb: "Describe it, add a photo — a range in a minute.", go: "Price my project" }`, `live: true`, hrefs as the check; the non-house rows exactly as today. `PriceRow({ trade, house = false })`. Both pages `await houseOrgId()`.

- [ ] **Step 4: Run it to see it pass**

- [ ] **Step 5: The Lead Center settings**

- `store.ts`: `setHouseOrgId(id)` — `upsert` on `HOUSE_ORG_KEY`, `deleteMany` when null.
- `adminLeadCenter.ts`: `setHouseOrg(organizationId)` — `requirePlatformAdmin()`; null → clear; else `db.organization.findUnique({ where: { id }, select: { id, deletedAt, isInternal } })`, throw `"Pick one of JobFlex's own organizations"` unless `isInternal && !deletedAt`; `revalidatePath("/admin/lead-center")` and `revalidatePath("/price")`.
- `page.tsx:137-142`: `Promise.all(PRICED_TRADES.map(autoPriceOn))` → `autoPrice: Record<PricedTrade, boolean>`; `houseOrgId()` → prop.
- `lead-center-content.tsx`: `autoPrice: Record<PricedTrade, boolean>`, `houseOrgId: string | null`; the switch block becomes one `<label data-lead-auto-price={trade}>` per `PRICED_TRADES` entry with the words "Charge the suggested price on automatic routing · {roof | deck | fence | heating & cooling | any project}", one `switchAutoPrice(trade, next)` with the toast naming the trade; a `<label className={styles.houseOrg}>House estimators <select data-lead-house-org …>` listing `— not set —` plus `orgs.filter((o) => o.isInternal)`, saving through `setHouseOrg`, toast "House estimators on" / "House estimators off", `router.refresh()`.

- [ ] **Step 6: tsc and commit**

```bash
git add src/components/v3/price-my-project/cards.ts src/components/v3/price-my-project/price-row.tsx "src/app/(marketing)/price/page.tsx" "src/app/(marketing)/price/roof/page.tsx" src/lib/publicEstimate/store.ts src/actions/adminLeadCenter.ts "src/app/(admin)/admin/lead-center/page.tsx" src/components/v3/admin-lead-center/lead-center-content.tsx src/components/v3/admin-lead-center/admin-lead-center.module.css qa/tests/logic/price-cards.check.ts
git commit -m "feat(price): the row runs the house estimators once the Lead Center names the house; a switch per trade"
```

---

### Task 7: Opening priced — the fence

**Files:**
- Create: `src/lib/webHandoff.ts` (pure: the three `…SeedFromWebLead` readers; this task adds the fence)
- Modify: `src/lib/webEstimatorServer.ts` (`readWebLeadFor`)
- Modify: `src/app/dashboard/fence-estimator/page.tsx:20-27,55-59`, `src/components/v3/fence-estimator-blueprint/fence-estimator-content.tsx:27,46-51` (find the exact file by `grep -rl "initialAddress" src/components/v3 | grep fence`), `src/components/v3/fence-estimator-blueprint/fence-estimator-behavior.ts:136-140,3996-4002` (+ the apply block)
- Test: `qa/tests/logic/web-handoff.check.ts` (new)

**Interfaces:**
- Consumes: Task 1's `WebLeadRecord`; the studio's `setSite` (~4013), `applyTracedPath` (~3446), `pickMaterial` (~969), `fs.height`, `fs.openings`, `renderStudio` (~940), `loadOrgBook` (~504).
- Produces: `readWebLeadFor(leadId: string, organizationId: string, trade: WebTrade): Promise<WebLeadRecord | null>` (null unless the record's `trade` and `estimate.organizationId` match); `type WebFenceSeed = { pin: { lat: number; lng: number } | null; points: Array<{ x: number; y: number; gap?: boolean }>; runsFt: number[]; type: string; heightFt: number; gates: number; doubles: number }`; `fenceSeedFromWebLead(rec: WebLeadRecord): WebFenceSeed | null`; the behavior option `initialFence?: WebFenceSeed | null`.

- [ ] **Step 1: Write the failing check**

```ts
const drawn = fenceSeedFromWebLead({ leadId: "l", trade: "fence", at: "…", contact: {…}, estimate: { …fence record…, facts: { runsFt: [60, 60, 60], type: "cedar-privacy", heightFt: 6, gates: 1, doubles: 0, drawn: true, points: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }, { x: 0, y: 60 }], pin: { lat: 42.948, lng: -78.853 } } } });
check("a drawn fence: the pin, the points, the style, the height, the gates", drawn?.pin?.lat === 42.948 && drawn.points.length === 4 && drawn.type === "cedar-privacy" && drawn.heightFt === 6 && drawn.gates === 1 && drawn.doubles === 0 && drawn.runsFt.join() === "60,60,60");
const typed = fenceSeedFromWebLead({ …facts: { runsFt: [150], type: "vinyl-privacy", heightFt: 6, gates: 2, doubles: 1, drawn: false, points: null, pin: null } });
check("typed feet: no points, no pin, the runs", typed?.points.length === 0 && typed.pin === null && typed.runsFt.join() === "150" && typed.gates === 2 && typed.doubles === 1);
check("not a fence, or no facts: nothing", fenceSeedFromWebLead({ …trade: "hvac" }) === null && fenceSeedFromWebLead({ …facts: {} }) === null);
```

- [ ] **Step 2: Run it to see it fail** — Expected: FAIL — module not found.

- [ ] **Step 3: `webHandoff.ts` fence reader and `readWebLeadFor`**

`fenceSeedFromWebLead`: null unless `rec.trade === "fence"` and `facts.runsFt` is a non-empty number array; `points` = the array when it is one of `{x,y}` objects (cap 200) else `[]`; `pin` when `{lat,lng}` numbers; `type` string; `heightFt` number (default 6); `gates`/`doubles` numbers (default 0).

- [ ] **Step 4: Run it to see it pass**

- [ ] **Step 5: The page and the studio**

`page.tsx`: when the seed exists, `const rec = await readWebLeadFor(seed.leadId, orgId, "fence")`, `webFence = rec ? fenceSeedFromWebLead(rec) : null` → `<FenceEstimatorContent … webFence={webFence} />` → behavior option `initialFence`. In the behavior, at the point `initialAddress` is typed into the search box (~3996): if `initialFence?.pin`, `setSite({ lat, lng, address: initialAddress })` instead of clicking Find; after the org book has loaded (`loadOrgBook` ~504 — do it in its completion, so the material is not reset): set `fs.material = initialFence.type` when the id is in the list, `fs.height = initialFence.heightFt` (then the snapping `renderHeights` does), push `gates` openings `{ id, type: "single", run: 0 }` and `doubles` `{ type: "double", run: 0 }`; then `initialFence.points.length >= 2 ? applyTracedPath(initialFence.points) : (fs.runs = initialFence.runsFt.map((ft, i) => ({ id: \`web-${i}\`, ft })))`; `renderStudio()`. Guard: run once.

- [ ] **Step 6: tsc and commit**

```bash
git add src/lib/webHandoff.ts src/lib/webEstimatorServer.ts src/app/dashboard/fence-estimator/page.tsx <the fence content file> <the fence behavior file> qa/tests/logic/web-handoff.check.ts
git commit -m "feat(fence): a website or house lead opens the studio with the fence as the homeowner drew it"
```

---

### Task 8: Opening priced — HVAC

**Files:**
- Modify: `src/lib/webEstimatorTrades.ts:304` (the tier's `facts` gain `site` and `itemId`)
- Modify: `src/lib/webHandoff.ts` (`hvacSeedFromWebLead`)
- Modify: `src/app/dashboard/hvac-estimator/page.tsx:67-75`, `src/components/v3/hvac-estimator-blueprint/hvac-estimator-content.tsx` (the pass-through), `src/components/v3/hvac-estimator-blueprint/hvac-estimator-form.tsx:441,1219-1261,1461` (a mount effect modelled on `reopen`)
- Test: `qa/tests/logic/web-handoff.check.ts` (extend)

**Interfaces:**
- Consumes: Task 7's `readWebLeadFor`; `SiteFacts` (`src/lib/hvac/siteLookup.ts`); the form's `setSite`, `setStateCode`, `setCounty`, `setJob`, `setTyped`, `setOutdoorKind`, `setPickId`, `go`, `tiers`, `catalog`.
- Produces: `type WebHvacSeed = { site: SiteFacts; existing: string; gas: string; outdoorKind: "heat-pump" | "air-conditioner"; tier: "value" | "mid" | "premium"; itemId: string | null }`; `hvacSeedFromWebLead(rec: WebLeadRecord): WebHvacSeed | null`.

- [ ] **Step 1: Write the failing check**

```ts
const withSite = hvacSeedFromWebLead({ …trade: "hvac", estimate: { …address: "418 Linden Ave", city: "Buffalo", state: "NY", zip: "14216", facts: { site: { address: "418 Linden Ave, Buffalo, NY 14216", state: "NY", lat: 42.948, lng: -78.853, livingSqft: 2100, storeys: 2, yearBuilt: 1962, sources: { living: "assessor" } }, sqft: 2100, storeys: 2, yearBuilt: 1962, existing: "split-ac-furnace", gas: "yes", outdoorKind: "air-conditioner", tier: "mid", itemId: "carrier-24abc636", pin: { lat: 42.948, lng: -78.853 } } } });
check("a record with the site: the site as stored, what is there, the gas, the kind, the tier, the unit", withSite?.site.livingSqft === 2100 && withSite.site.sources.living === "assessor" && withSite.existing === "split-ac-furnace" && withSite.gas === "yes" && withSite.outdoorKind === "air-conditioner" && withSite.tier === "mid" && withSite.itemId === "carrier-24abc636");
const older = hvacSeedFromWebLead({ …facts: { sqft: 1800, storeys: 1, yearBuilt: 1995, existing: "heat-pump", gas: "no", outdoorKind: "heat-pump", tier: "premium", pin: { lat: 42.948, lng: -78.853 } } });
check("an older record (no site): rebuilt from the address, the pin and the square feet; no unit id", older?.site.address === "418 Linden Ave, Buffalo, NY 14216" && older.site.state === "NY" && older.site.lat === 42.948 && older.site.livingSqft === 1800 && older.site.storeys === 1 && older.site.yearBuilt === 1995 && Object.keys(older.site.sources).length === 0 && older.itemId === null && older.tier === "premium");
check("not hvac, or no tier: nothing", hvacSeedFromWebLead({ …trade: "fence" }) === null && hvacSeedFromWebLead({ …facts: {} }) === null);
```

- [ ] **Step 2: Run it to see it fail** — Expected: FAIL — `hvacSeedFromWebLead` not exported.

- [ ] **Step 3: The reader and the richer facts**

`webEstimatorTrades.ts:304` facts gain `site` (the `site` the function received, after the answers were folded in) and `itemId: t.candidate.item.id`. `hvacSeedFromWebLead`: null unless `rec.trade === "hvac"` and `facts.tier` is one of the three; `site` = `facts.site` when it is an object with a string `address`, else `{ address: [est.address, est.city, [est.state, est.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "), state: est.state ?? "", lat/lng from facts.pin, livingSqft: facts.sqft, storeys: facts.storeys, yearBuilt: facts.yearBuilt, sources: {} }` (the `SiteFacts` shape — read `src/lib/hvac/siteLookup.ts` for the required keys); `existing` string (default "split-ac-furnace"), `gas` string (default "yes"), `outdoorKind` one of the two (default "air-conditioner"), `itemId` string or null.

- [ ] **Step 4: Run it to see it pass**

- [ ] **Step 5: The page and the form**

`page.tsx`: with a seed, `readWebLeadFor(seed.leadId, orgId, "hvac")` → `hvacSeedFromWebLead` → `webHvac` prop → content → form. In the form a mount effect (run once, when `webHvac`): `setSite(webHvac.site)`, `setStateCode(site.state)`, `setCounty(site.county ?? null)`, `setJob("replace-system")`, `setTyped({ "existing.kind": webHvac.existing, "gas.available": webHvac.gas !== "no" })`, `setOutdoorKind(webHvac.outdoorKind)`, the address box = `site.address`, `go("design")`; a second effect when `catalog` has loaded: `setPickId(webHvac.itemId ?? tiers.find((t) => t.tier === webHvac.tier)?.candidate.item.id ?? null)` (skip when the id is not in the buyer's list — the tier match then).

- [ ] **Step 6: tsc and commit**

```bash
git add src/lib/webEstimatorTrades.ts src/lib/webHandoff.ts src/app/dashboard/hvac-estimator/page.tsx src/components/v3/hvac-estimator-blueprint/hvac-estimator-content.tsx src/components/v3/hvac-estimator-blueprint/hvac-estimator-form.tsx qa/tests/logic/web-handoff.check.ts
git commit -m "feat(hvac): a website or house lead opens the estimator with the house, the load and the tier they picked"
```

---

### Task 9: Opening priced — Smart Proposal

**Files:**
- Modify: `src/lib/webHandoff.ts` (`smartSeedFromWebLead`)
- Modify: `src/app/dashboard/advanced-ai/page.tsx:41-48,79-80`, `src/components/v3/advanced-ai-blueprint/advanced-ai-content.tsx:166-174,440-465,507-514`
- Test: `qa/tests/logic/web-handoff.check.ts` (extend)

**Interfaces:**
- Consumes: Task 7's `readWebLeadFor`; `estimateSchema`/`GeneratedEstimate` (`src/lib/estimatorSchema.ts:89-109`); `linesFromEstimate` (`src/lib/estimate/console-model.ts:354`), `discountFromSchema` (`:503`), `takePlanEstimate` mount effect.
- Produces: `type WebSmartSeed = { estimate: GeneratedEstimate; brief: string }`; `smartSeedFromWebLead(rec: WebLeadRecord): WebSmartSeed | null`; `AdvancedAiContent` prop `web?: WebSmartSeed | null`; the content's `landEstimate(est: GeneratedEstimate, used: { brief: string; location: string; address: string }): void` helper shared by Generate and the hand-off.

- [ ] **Step 1: Write the failing check**

```ts
const good = { title: "Hall bath remodel", scope: "…", assumptions: [], materials: [{ name: "Tile", quantity: 60, unit: "sq ft", unitPrice: 6.5 }], labor: [{ name: "Tile setter", quantity: 16, unit: "hr", unitPrice: 85 }], … the schema's required fields with plausible values … };
const s = smartSeedFromWebLead({ …trade: "smart", estimate: { …facts: { estimate: good, brief: "Redo the hall bath, keep the tub", qualityTier: "standard", sqft: null, photos: 1 } } });
check("a smart record: the generated estimate re-validated, the brief", s?.estimate.title === "Hall bath remodel" && s.estimate.materials.length === 1 && s.brief === "Redo the hall bath, keep the tub");
check("a record whose estimate does not parse, or no brief: nothing", smartSeedFromWebLead({ …facts: { estimate: { title: 1 }, brief: "x" } }) === null && smartSeedFromWebLead({ …facts: { estimate: good } }) === null && smartSeedFromWebLead({ …trade: "deck" }) === null);
```

- [ ] **Step 2: Run it to see it fail** — Expected: FAIL — `smartSeedFromWebLead` not exported.

- [ ] **Step 3: The reader** — `estimateSchema.safeParse(facts.estimate)`; `brief` a non-empty string.

- [ ] **Step 4: Run it to see it pass**

- [ ] **Step 5: The page and the content**

`page.tsx`: with a seed, `readWebLeadFor(seed.leadId, orgId, "smart")` → `smartSeedFromWebLead` → `web` prop to `AdvancedAiContent`. In the content: lift the setter block at `:440-465` into `landEstimate(est, used)` (use `discountFromSchema(est.discount)`), call it from Generate as before and once from the mount effect (`:507-514`) when `web` is set, with `used.brief = web.brief` (and `briefUsed`), `location`/`address` from the seed; `panel` → "estimate".

- [ ] **Step 6: tsc and commit**

```bash
git add src/lib/webHandoff.ts src/app/dashboard/advanced-ai/page.tsx src/components/v3/advanced-ai-blueprint/advanced-ai-content.tsx qa/tests/logic/web-handoff.check.ts
git commit -m "feat(smart): a website or house lead opens Smart Proposal at the result with the lines it was priced on"
```

---

### Task 10: The stand walk, the whole suite, tsc and lint

**Files:**
- Create (scratchpad, not committed): `$SP/roofw/house-walk.js`
- Modify: `docs/superpowers/plans/2026-10-28-home-portal-house-estimators.md` only if a ruling changed a task (keep the plan honest).

**Interfaces:** consumes everything above.

- [ ] **Step 1: The walk**

On the `:3530` stand (`$SP/roofw/dev-price.sh`, the stand DB `$SP/roofw/roof.db`, admin cookies in `$SP/adsdesk/state.json`, the ads org `cmv6a9or70000xdyxjdet2mrf` marked internal by SQL if it is not):
1. Admin: `/admin/lead-center` → the house picker lists the internal org → pick it → `/price` shows the four house cards live (`[data-price-card=fence][data-price-live="1"]` → `/estimate/jobflex/fence`).
2. Homeowner (own `x-forwarded-for`): `/estimate/jobflex/fence` → the head says JobFlex with "← Price another project"; address typed; "I'll type the feet instead" → 180 ft, 1 gate → a range (`[data-web-step="price"]`); the consent reads `LEAD_CONSENT_TEXT`; email required; send → lands on `/request/<token>` with the range box ("priced on JobFlex").
3. Admin: the lead shows in the "Priced by the homeowner" tab; the Priced block prints the fence words; the suggested price $35; the fence switch; manual-assign the lead to the internal org (or Accept on the contractor side as `contractor-walk.js` does).
4. Contractor: the lead page says "Priced by the homeowner on JobFlex" with the Open-in-the-Fence-Studio card → click → the studio shows 180 ft in the runs and a price > 0; the generic Roof card on this lead toasts the refusal.
5. HVAC: `/estimate/jobflex/hvac` → the house lookup (the stand has no geocoder key: expect the "couldn't find" path, or the Census fallback if it answers) — if the lookup fails on the stand, walk the HVAC hand-off by seeding a `webLead:` record by SQL on a lead of the internal org and opening the lead page.
6. Deck: `/estimate/jobflex/deck` → the address → the designer opens with the JobFlex head; send with email → `/request/<token>`.
7. Smart: the stand has no OpenAI → the page says it is resting; cover the hand-off like HVAC (a seeded `webLead:` record with a `facts.estimate` from `qa/tests/_lib/fixtures`, then the lead page → Smart Proposal lands on the result with the lines).
Shots to `$SP/roofw/shots/house-*.png`; PASS/FAIL lines as the other walks print.

- [ ] **Step 2: Run every check**

Run: `for f in qa/tests/logic/{web-house,web-estimator,web-addon,web-handoff,lead-estimate,lead-auto-price,price-cards,public-roof-range,public-estimate-store,lead-scope,roof-main-structure,roof-mansard}.check.ts; do NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json $f | tail -1; done`
Expected: `all passed` twelve times.

- [ ] **Step 3: The full tsc and lint**

Run: the full tsc (background; read the tail) and `npx --no-install next lint` on the touched files.
Expected: 0 tsc errors; no new lint errors (the 13 pre-existing `no-explicit-any` in `src/lib/eagleview.ts` are not ours).

- [ ] **Step 4: Commit the plan/spec and stop before the push**

```bash
git add docs/superpowers/specs/2026-10-28-home-portal-house-estimators-design.md docs/superpowers/plans/2026-10-28-home-portal-house-estimators.md
git commit -m "docs: the house estimators design and plan"
```
Then the finishing skill: the owner pushes ("push" → PR → the owner merges).
