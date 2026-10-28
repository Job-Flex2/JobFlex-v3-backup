# Wisetack Financing (step 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Contractors apply for Wisetack inside Settings, switch "Offer monthly payments" per proposal, and their
clients press "Pay over time" on the proposal page — the whole loop built OFF behind an admin switch and walked
against a pretend Wisetack.

**Architecture:** One `src/lib/financing/` module: pure rules + words (client-safe), a provider interface with one
HTTP implementation (`wisetack.ts`, shape ASSUMED until Wisetack's partner docs), SyncState-backed storage, and a
service layer the actions, routes, webhook and cron call. UI hooks into the existing Payments pane, the editor's
"Payment & deposits" block, both client portal trees, the proposals rows, and the admin console.

**Tech Stack:** Next.js App Router (server components + server actions), TypeScript, Prisma (`SyncState`, `Payment`
— no schema change), the repo's tsx checks (`qa/tests/logic/*.check.ts`), Playwright-core stand walk, a node http
pretend server.

**Spec:** `docs/superpowers/specs/2026-10-28-wisetack-financing-design.md`

## Global Constraints

- No Prisma schema change. State: SyncState keys `financing:<orgId>`, `financingOffer:<proposalId>`,
  `financingLoan:<proposalId>`, `financingLoanRef:<loanRef>`, `financingSwitch`; payouts are `Payment` rows with
  `provider: "WISETACK"`, `method: "financing"`, `feeAmount: 0`.
- OFF by default: `financingSwitch` absent = `{ mode: "off", pilot: [] }`. No env (`WISETACK_API_BASE`,
  `WISETACK_API_KEY`, `WISETACK_WEBHOOK_SECRET`) → `getProvider()` returns null → financing hidden everywhere, no
  errors.
- Disclosure, verbatim: "All financing is subject to credit approval. Your terms may vary. Payment options through
  Wisetack are provided by our lending partners."
- No JobFlex-made rate, APR, "as low as" or monthly figure; a monthly line appears only as Wisetack's own text.
- Client data JobFlex keeps: name/phone/email it already has, loan state, amounts. Nothing about credit or income.
- Only `requireManager` applies, links, sets the default, sends links; `requireProposalStaff` may flip a proposal's
  switch. Card-less trial write lock (`assertWriteAllowed`) and `planEnded` stop new applications / loans.
- Light theme, blueprint shell, desk + phone parity; plain words; all copy in `src/lib/financing/words.ts`.
- Repo is public: no keys, no customer data in code, checks or docs.
- Checks run: `export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"; NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/<name>.check.ts`
  — each check prints `ok`/`FAIL` lines and ends with `all passed` (exit 0) or `N FAILED` (exit 1), like
  `web-house.check.ts`.
- Before the hand-over: full `NODE_OPTIONS=--max-old-space-size=8192 npx --no-install tsc --noEmit -p tsconfig.json`
  (read every error minus the known noise listed in memory) and `npx --no-install eslint` on touched files.
- Commit per task on branch `financing` in the worktree, `git add` exact paths only. No push until the owner says
  "push".

## Review Focus

- Webhooks out of order or repeated (paid before accepted, the same funding twice) → state never goes backwards, a
  funding settles once. Pinned in Task 1 (`nextLoanState`) and Task 7 (externalId `<ref>:<fundingId>`).
- The total changes after a loan is accepted (change order, price edit, a stage paid by card) → covered stages
  shrink/grow by rule, "The rest" shows, nothing crashes. Pinned in Task 1 (`coveredStageIds`, `restMinor`).
- The client presses Pay over time twice / in two tabs → the live loan is reused, never two loans. Pinned in Task 1
  (`reuseLoan`) and walked in Task 12.
- The admin switch is turned off while loans are open → webhooks and payouts still land; only new offers stop.
  Pinned in Task 1 (`offerFor`) and Task 7 (`applyEvent` ignores the switch).
- Production without Wisetack env → every surface hides, no 500. Pinned in Task 2 (`getProvider` null) and Task 6
  (route answers 404 "not available").

---

### Task 1: Pure rules and words

**Files:**
- Create: `src/lib/financing/state.ts`, `src/lib/financing/words.ts`
- Test: `qa/tests/logic/financing-rules.check.ts`, `qa/tests/logic/financing-words.check.ts`

**Interfaces:**
- Produces (state.ts, pure, client-safe):
  - `type MerchantState = "none" | "started" | "review" | "needs_info" | "approved" | "declined" | "paused"`
  - `type LoanState = "sent" | "started" | "needs_action" | "approved" | "accepted" | "done_asked" | "paid" | "declined" | "expired" | "canceled" | "refunded"`
  - `type OrgFinancing = { merchantRef: string | null; state: MerchantState; appliedAt: string | null; decidedAt: string | null; needs: string[]; note: string | null; minMinor: number | null; maxMinor: number | null; feeBps: number | null; prequalUrl: string | null; offerByDefault: boolean; yearStarted: number | null; checkedAt: string | null }`
  - `EMPTY_ORG_FINANCING: OrgFinancing` (state "none", offerByDefault true); `parseOrgFinancing(raw: string | null | undefined): OrgFinancing`
  - `type Funding = { id: string; amountMinor: number; at: string }`
  - `type Loan = { ref: string; state: LoanState; amountMinor: number; approvedMinor: number | null; fundings: Funding[]; url: string; createdAt: string; expiresAt: string | null; history: { state: LoanState; at: string }[]; nudgedAt: string | null }`
  - `parseLoan(raw): Loan | null`; `fundedMinor(l: Loan): number`; `coverMinor(l: Loan): number` (approved ?? amount once approved or later, else 0)
  - `type FinancingSwitch = { mode: "off" | "pilot" | "all"; pilot: string[] }`; `parseSwitch(raw): FinancingSwitch`; `orgLetIn(sw, orgId): boolean`
  - `type LockReason = "not_open" | "not_set_up" | "waiting" | "declined" | "paused" | "off" | "under_min" | "over_max" | "paid" | "nothing_owed" | "plan_ended"`
  - `offerFor(i: { letIn: boolean; org: OrgFinancing; proposalOn: boolean | null; owedMinor: number; status: string; planEnded: boolean }): { offered: true } | { offered: false; why: LockReason }`
  - `type ReadinessItem = { key: "name" | "phone" | "email" | "address" | "website" | "trade" | "year"; ok: boolean }`; `readiness(f: { name: string | null; phone: string | null; email: string | null; address: string | null; website: string | null; trade: string | null; yearStarted: number | null }): { items: ReadinessItem[]; ready: number; total: number }`
  - `type LoanSnapshot = { state: LoanState; approvedMinor: number | null; fundings: Funding[]; expiresAt: string | null }`
  - `nextLoanState(l: Loan, s: LoanSnapshot, at: string): Loan`
  - `coveredStageIds(stages: { id: string; amountMinor: number; status: string }[], coverLeftMinor: number): string[]`
  - `restMinor(owedMinor: number, l: Loan | null): number`
  - `reuseLoan(l: Loan | null, owedMinor: number, now: Date): boolean`
  - `reminderDue(l: Loan, now: Date): "accept_nudge" | "expiring" | null`
- Produces (words.ts): `FIN` const object — `button: "Pay over time"`, `buttonSub: "Check your rate — it won't affect your credit score."`, `disclosure` (verbatim, Global Constraints), `prequalLine: "Monthly payments are available."`, `prequalButton: "See what you qualify for"`, `restLabel: (money: string) => \`The rest: ${money}\``, `coveredLine: (money: string) => \`Paying ${money} with monthly payments through Wisetack\``, `deskQ: "Do you offer financing?"`, `deskA: "Yes — monthly payments through Wisetack, subject to credit approval. The team can send you a link to check your rate."`; `merchantWords(s: MerchantState): { title: string; sub: string; tone: "ok" | "wait" | "warn" | "off" }`; `loanLine(l: Loan, money: (minor: number) => string): string`; `clientLoanWords(l: Loan, money): { title: string; sub: string }`; `lockWords(why: LockReason, money): string`; `readinessLabel(key): string`.

- [ ] **Step 1: Write the failing checks.** `financing-rules.check.ts` asserts:
  - `parseOrgFinancing(null)` deep-equals `EMPTY_ORG_FINANCING`; junk JSON → empty; `offerByDefault` defaults true.
  - `parseSwitch(undefined)` → `{mode:"off",pilot:[]}`; `orgLetIn({mode:"pilot",pilot:["o1"]},"o1")` true, `"o2"` false; `"all"` true; `"off"` false.
  - `offerFor` with an approved org, limits 50000–6500000 minor, `proposalOn: null`, owed 1200000, status "SENT" → offered; each lock: letIn false → `not_open`; state none → `not_set_up`; started/review/needs_info → `waiting`; declined → `declined`; paused → `paused`; `proposalOn:false` → `off`; `offerByDefault:false` + `proposalOn:null` → `off`; owed 49999 → `under_min`; owed 6500001 → `over_max`; status "PAID" → `paid`; owed 0 → `nothing_owed`; planEnded → `plan_ended`. Order: not_open, not_set_up/waiting/declined/paused, plan_ended, paid, nothing_owed, off, under_min/over_max.
  - `readiness` all filled → ready 7/7; website null + yearStarted null → 5/7 with those two `ok:false`.
  - `nextLoanState`: sent→approved sets approvedMinor and appends history; accepted then snapshot "approved" stays accepted (no regress); a snapshot with fundings `[f1]` twice keeps one funding; fundings summing to coverMinor → state "paid"; part funding → stays accepted/done_asked; "declined" after "paid" ignored; "refunded" after paid accepted.
  - `coveredStageIds([{id:"a",amountMinor:600000,status:"UNPAID"},{id:"b",amountMinor:1400000,status:"UNPAID"}], 1400000)` → `["b"]`; with 2000000 → `["a","b"]`; with 1500000 → `["b"]`; PAID stages skipped.
  - `restMinor(2000000, loan approved 1400000 accepted)` → 600000; loan null → 2000000; declined loan → 2000000.
  - `reuseLoan`: null → false; state sent/started/approved and amount === owed and not expired → true; amount ≠ owed and state before accepted → false; accepted → true; declined/expired/canceled → false.
  - `reminderDue`: approved 3 days ago, no nudge → "accept_nudge"; nudged → null; accepted with expiresAt in 6 days → "expiring"; paid → null.
  `financing-words.check.ts` asserts the disclosure string verbatim; no word in `FIN`, `merchantWords(*)`, `lockWords(*)`, `loanLine`/`clientLoanWords` outputs (every state) contains `APR`, `as low as`, `%`, `/mo`; every MerchantState and LockReason has non-empty words; `loanLine` for paid with two fundings reads "Paid $X of $Y" until full.
- [ ] **Step 2: Run both checks.** Expected: FAIL — module not found.
- [ ] **Step 3: Implement `state.ts` and `words.ts`** to the interfaces above (pure: no db, no env, no `server-only`).
- [ ] **Step 4: Run both checks.** Expected: `all passed`.
- [ ] **Step 5: Commit** `git add src/lib/financing/state.ts src/lib/financing/words.ts qa/tests/logic/financing-rules.check.ts qa/tests/logic/financing-words.check.ts && git commit -m "feat(financing): the rules and words for Wisetack financing"`

### Task 2: The provider and the pretend Wisetack

**Files:**
- Create: `src/lib/financing/provider.ts`, `src/lib/financing/wisetack.ts`, `qa/stand/fake-wisetack.mjs`
- Test: `qa/tests/logic/financing-wisetack.check.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces (provider.ts):
  - `type MerchantSnapshot = { state: MerchantState; needs: string[]; note: string | null; minMinor: number | null; maxMinor: number | null; feeBps: number | null; prequalUrl: string | null }`
  - `type MerchantPrefill = { reference: string; businessName: string; phone: string | null; email: string | null; website: string | null; address: { line1: string | null; city: string | null; state: string | null; zip: string | null }; trade: string | null; ownerName: string | null; ownerEmail: string | null; yearStarted: number | null; returnUrl: string }`
  - `type ProviderEvent = { id: string; kind: "merchant"; merchantRef: string; snapshot: MerchantSnapshot } | { id: string; kind: "loan"; loanRef: string; snapshot: LoanSnapshot } | { id: string; kind: "prequal"; merchantRef: string; person: { name: string; phone: string | null; email: string | null }; amountMinor: number }`
  - `interface FinancingProvider { startMerchant(p: MerchantPrefill): Promise<{ merchantRef: string; url: string }>; linkMerchant(p: { email: string; reference: string; returnUrl: string }): Promise<{ merchantRef: string; url: string | null } | { error: "not_found" }>; merchant(ref: string): Promise<MerchantSnapshot>; createLoan(i: { merchantRef: string; amountMinor: number; purpose: string; reference: string; client: { name: string; phone: string | null; email: string | null }; returnUrl: string }): Promise<{ loanRef: string; url: string; expiresAt: string | null }>; loan(ref: string): Promise<LoanSnapshot>; askDone(ref: string): Promise<"asked" | "unsupported">; cancelLoan(ref: string): Promise<void>; monthly(merchantRef: string, amountMinor: number): Promise<string | null>; parseWebhook(raw: string, headers: Headers): ProviderEvent[] | null }`
  - `getProvider(env?: NodeJS.ProcessEnv): FinancingProvider | null` — null unless all three env values are set.
- Produces (wisetack.ts): `wisetackProvider(cfg: { base: string; key: string; secret: string }): FinancingProvider`; `MERCHANT_STATUS: Record<string, MerchantState>` and `LOAN_STATUS: Record<string, LoanState>` (ASSUMED names: merchant `APPLICATION_STARTED|UNDER_REVIEW|ACTION_REQUIRED|APPROVED|DECLINED|SUSPENDED`; loan `INITIATED|STARTED|ACTIONS_REQUIRED|AUTHORIZED|LOAN_TERMS_ACCEPTED|COMPLETION_REQUESTED|SETTLED|DECLINED|EXPIRED|CANCELED|REFUNDED`); `signBody(raw: string, secret: string): string` (`sha256=<hex HMAC>`). Assumed HTTP: `POST /v1/merchants`, `POST /v1/merchants/link`, `GET /v1/merchants/:ref`, `GET /v1/merchants/:ref/monthly?amount=`, `POST /v1/transactions`, `GET /v1/transactions/:id`, `POST /v1/transactions/:id/completion-request` (404/501 → "unsupported"), `POST /v1/transactions/:id/cancel`; bearer key; webhook header `x-wisetack-signature`; body `{id, type: "merchant.updated" | "transaction.updated" | "prequal.completed", data}`. File header says: ASSUMED SHAPE — rewrite against the partner docs.
- Produces (fake-wisetack.mjs): `node qa/stand/fake-wisetack.mjs --port 3620 --hook http://localhost:3540/api/webhooks/wisetack --secret stand-wisetack` — in-memory merchants/transactions implementing the assumed HTTP; pages `/apply/merchant/:ref` (buttons: Approve, Needs info, Decline) and `/apply/loan/:ref` (Approve $amount, Approve less, Accept terms, Decline, Fund all, Fund half) and `/prequal/:merchantRef` (Pre-qualify a person) that update state and POST signed webhooks; `returnUrl` link back on every page.

- [ ] **Step 1: Write the failing check** `financing-wisetack.check.ts`: `getProvider({})` → null; with only base+key → null; all three → object. Every value of `MERCHANT_STATUS`/`LOAN_STATUS` is a valid state and every Task 1 state except `none`/`sent` has a source name. `parseWebhook` on a body signed with `signBody(raw, "s")` → one event of the right kind with mapped state; wrong signature → null; missing header → null; unknown `type` → `[]`; a `transaction.updated` with `fundings:[{id:"f1",amount:500000,at}]` → snapshot fundings `[{id:"f1",amountMinor:500000,…}]`.
- [ ] **Step 2: Run it.** Expected: FAIL — module not found.
- [ ] **Step 3: Implement** `provider.ts`, `wisetack.ts` (fetch with 15 s timeout, throws `Error("Wisetack: <status>")` on non-2xx except the unsupported case), and `fake-wisetack.mjs` (plain node `http`, `crypto`; no dependencies).
- [ ] **Step 4: Run the check** → `all passed`; start the fake (`node qa/stand/fake-wisetack.mjs --port 3620 …`) and `curl -s -XPOST localhost:3620/v1/merchants -H 'authorization: Bearer k' -d '{}'` → JSON with `merchantRef` and `applicationUrl`.
- [ ] **Step 5: Commit** the four files: `feat(financing): one provider module for Wisetack (assumed shape) + a pretend Wisetack for the stand`.

### Task 3: Storage, the merchant side of the service, Settings actions

**Files:**
- Create: `src/lib/financing/store.ts`, `src/lib/financing/service.ts`, `src/actions/financing.ts`
- Modify: `src/lib/notificationPrefsShared.ts` (add `PrefKey` `"financing"` + a `PREF_EVENTS` entry: name "Financing", sub "A client approved, a loan accepted, Wisetack paid you, your application decided", email false, sms true, seed `[true,false,true]`, audience office)
- Test: `qa/tests/logic/financing-prefill.check.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces (store.ts, server): `readOrgFinancing(orgId): Promise<OrgFinancing>`, `writeOrgFinancing(orgId, rec: OrgFinancing)`, `readSwitch(): Promise<FinancingSwitch>`, `writeSwitch(sw)`, `readOffer(proposalId): Promise<boolean | null>`, `writeOffer(proposalId, on: boolean | null)` (null deletes the row), `readLoan(proposalId): Promise<Loan | null>`, `writeLoan(proposalId, l: Loan)` (also writes `financingLoanRef:<ref>` → proposalId), `proposalForLoanRef(ref): Promise<string | null>`, `readLoans(ids: string[]): Promise<Map<string, Loan>>`, `readOffers(ids: string[]): Promise<Map<string, boolean>>`, `listOrgFinancing(): Promise<Array<{ orgId: string; rec: OrgFinancing }>>`, `listLoans(): Promise<Array<{ proposalId: string; loan: Loan }>>` (key prefix scans, `take` 2000).
- Produces (service.ts, server): `merchantPrefill(org, owner, rec, returnUrl): MerchantPrefill` (pure, exported for the check); `orgFinancingView(orgId): Promise<{ letIn: boolean; available: boolean; rec: OrgFinancing }>` (`available` = provider present); `startApplication(orgId, actorId): Promise<{ url: string } | { error: string }>`; `linkExisting(orgId, email, actorId)`; `refreshMerchant(orgId): Promise<OrgFinancing>`; `applyMerchantSnapshot(orgId, s: MerchantSnapshot): Promise<OrgFinancing>` (decided transitions → `notifyFinancing`); `notifyFinancing(orgId, line: string, opts: { proposalId?: string; kind: string })` (logActivity bell row + `textOffice(orgId, "financing", line)` via `afterResponse`).
- Produces (actions/financing.ts, `"use server"`): `applyForFinancing()`, `linkWisetackAccount(email: string)`, `checkFinancingStatus()`, `setFinancingDefault(on: boolean)`, `setFinancingYearStarted(year: number)` — each `requireManager` + `assertWriteAllowed` (apply/link) and refuses when `!letIn || !available` with `{ ok:false, error }`.

- [ ] **Step 1: Write the failing check** `financing-prefill.check.ts`: `merchantPrefill` from an org `{name:"Summit Ridge Roofing", phone:"+15551230000", email, website:"summitridge.example", address:"12 Main St", city, state:"UT", zip, tradeTypesJson:'["roofing"]'}` + owner `{name, email}` + rec yearStarted 2015 → the matching fields, `reference` = org id, website gets `https://` when bare, trade "roofing"; missing website → null (never ""). Also `PREF_EVENTS` has exactly one `"financing"` entry with `smsAvailable` true.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** store, service (merchant half), actions, the pref key. Org fields are read with the same select `loadSettingsData` uses for the Account pane (name, phone, email, website, address parts, `tradeTypesJson`).
- [ ] **Step 4: Run** `financing-prefill`, `financing-rules`, `financing-wisetack`, and the existing notification-prefs check if one exists (`ls qa/tests/logic | grep -i pref`). Expected: all `all passed`.
- [ ] **Step 5: Commit** the five files: `feat(financing): storage, the contractor's application and status`.

### Task 4: Settings → Payments → Financing (desk and phone)

**Files:**
- Create: `src/components/v3/settings-blueprint/panes/financing-subpane.tsx`
- Modify: `src/components/v3/settings-blueprint/settings-data.ts` (SubTabKey gains `'financing'`; `paymentSubTabs(show: { financing: boolean }): readonly SubTab[]` = Stripe/Square/Stax + Financing when shown; `PAYMENT_SUBTABS` callers switch to it; a `FinancingSettingsData` type), `panes/payments-pane.tsx` (render the sub-pane), `src/lib/settings/loadSettingsData.ts` (`payments.financing: FinancingSettingsData | null` — null when not let in or no provider), `src/components/v3/mobile-settings/mobile-settings.tsx` (a Financing row in its `PaymentsPane` opening `FinancingSubpane`), `src/app/dashboard/settings/page.tsx` (accept `?sub=financing` and the `?financing=back` return note)
- Test: stand walk in Task 12 (UI); `financing-rules` covers the words.

**Interfaces:**
- Consumes: Task 3 actions and `orgFinancingView`; Task 1 `readiness`, `merchantWords`, `FIN`.
- Produces: `type FinancingSettingsData = { rec: OrgFinancing; readiness: ReturnType<typeof readiness>; canManage: boolean; deskAnswer: "ours" | "theirs" | "none" }` (deskAnswer filled in Task 11; "none" until then).
- Behavior: state none → readiness list ("What lenders usually look at", each ✓ or "Add it" → `/dashboard/settings?pane=account`; year started inline number input saving via `setFinancingYearStarted`), primary **Apply with Wisetack** (opens the returned url), secondary **I already use Wisetack** (email field → `linkWisetackAccount`). Other states: the `merchantWords` card + **Check again**; needs_info lists `rec.needs` + **Finish on Wisetack**. Approved: limits ("Jobs from $500 to $65,000" from rec), fee ("Wisetack's fee: 3.9% of each financed job" from `feeBps`), the default switch, the general link with **Copy**, the disclosure. Non-managers see the card read-only.

- [ ] **Step 1:** Add `paymentSubTabs` and the type; run the full tsc on the touched files' importers (`npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "settings-blueprint|mobile-settings|loadSettingsData"`). Expected: errors only where callers still use `PAYMENT_SUBTABS` → fix them.
- [ ] **Step 2:** Build `FinancingSubpane` (same note/card classes as `processor-subpane.tsx`), wire desk + phone + loader.
- [ ] **Step 3:** Typecheck the same grep. Expected: no lines.
- [ ] **Step 4: Commit** the touched files: `feat(financing): the Financing tab in Settings → Payments`.

### Task 5: The proposal's switch in the editor

**Files:**
- Create: `src/components/v3/manual-card-lab/manual-blueprint/bp-financing.tsx`
- Modify: `bp-money.tsx` (PaymentBlock gains `financing?: EditorFinancing | null`, renders `<FinancingRow>` at the end of "Payment & deposits"), `manual-blueprint-content.tsx` (passes it), the editor's loader/bridge (`manual-blueprint-bridge.ts` + its page) to fetch it, `src/actions/financing.ts` (+ `setProposalFinancing(proposalId: string, on: boolean | null)` with `requireProposalStaff` + proposal scope + org match)
- Test: `qa/tests/logic/financing-rules.check.ts` (add `editorFinancing` cases)

**Interfaces:**
- Consumes: Task 1 `offerFor`, `lockWords`; Task 3 store.
- Produces: `type EditorFinancing = { proposalId: string; on: boolean; followsDefault: boolean; offer: ReturnType<typeof offerFor>; preview: string; loanLine: string | null; notice: string | null }`; `editorFinancing(i: { proposalId; letIn; org: OrgFinancing; proposalOn: boolean | null; owedMinor; status; planEnded; loan: Loan | null; money }): EditorFinancing | null` (pure, in state.ts — null when not let in and no loan, so the row does not exist for orgs outside the switch); `notice` = "The client's loan is for $X; the new total is $Y — the difference is paid another way, or send a new financing link." when a loan is accepted or later and `owedMinor + fundedMinor ≠ coverMinor`; server `loadEditorFinancing(orgId, proposalId)` in service.ts.
- Behavior: a switch "Offer monthly payments" with the preview "Clients see: Pay over time — check your rate"; when `offer.offered` is false and the reason is not `off`, the switch is disabled and `lockWords(why)` shows with a link (`not_set_up` → Settings Financing). Saves at once through the action; a new proposal (no id yet) shows the default and saves after the first save.

- [ ] **Step 1: Add failing cases** to `financing-rules.check.ts`: `editorFinancing` with letIn false → null; approved + proposalOn null + default on → `{on:true, followsDefault:true, offer:{offered:true}}`; proposalOn false → `{on:false, followsDefault:false}` and offer `off`; under_min → `on:true` but offer locked `under_min`; an accepted loan of 1400000 with owed now 2000000 → `notice` names $14,000 and $20,000; the same loan with owed 1400000 → `notice` null.
- [ ] **Step 2: Run.** Expected: FAIL on `editorFinancing`.
- [ ] **Step 3: Implement** the pure function, the loader, the row, the action.
- [ ] **Step 4: Run the check** → `all passed`; tsc grep for `manual-blueprint|financing` → no lines.
- [ ] **Step 5: Commit**: `feat(financing): Offer monthly payments on each proposal`.

### Task 6: Pay over time on the client's page

**Files:**
- Create: `src/components/v3/financing/pay-over-time.tsx` (client component shared by both trees), `src/app/api/pay/wisetack/route.ts`
- Modify: `src/lib/payments/portalModel.ts` (ProposalLike gains optional `id`, OrgLike gains optional `id`; PortalPayModel gains `financing: PortalFinancing | null`), `src/app/(portal)/portal/q/[publicId]/page.tsx` and `src/app/(mobile)/mobile-proposal-client-v2/[publicId]/page.tsx` and `src/app/api/public-quote/[publicId]/accept/route.ts` (pass ids; on `?financing=back` call `syncLoanForPublicId` before building), `src/app/(portal)/portal/q/[publicId]/portal-payment.tsx` and `src/components/v3/mobile-proposal-client/payment-center.tsx` (render `<PayOverTime>`; stage buttons skip `financing.coveredIds`)
- Modify: `src/lib/financing/service.ts` (+ `portalFinancing(...)`, `openLoanForClient(publicId)`, `syncLoanForPublicId(publicId)`)
- Test: `qa/tests/logic/financing-rules.check.ts` (add `portalFinancing` pure cases)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `type PortalFinancing = { mode: "prequal" | "apply" | "status"; prequalUrl: string | null; loan: { state: LoanState; title: string; sub: string } | null; coveredIds: string[]; rest: string | null; monthly: string | null; disclosure: string }`; pure `portalFinancingFrom(i: { offered: boolean; signed: boolean; org: OrgFinancing; loan: Loan | null; stages: { id: string; amountMinor: number; status: string }[]; owedMinor: number; monthly: string | null; money }): PortalFinancing | null` in state.ts — null when not offered and no loan; `prequal` when not signed (needs `prequalUrl`, else null); `apply` when signed and no live loan (or the loan is declined/expired/canceled); `status` otherwise with `coveredIds = coveredStageIds(stages, coverMinor − fundedMinor)` for accepted+.
- Route: `POST /api/pay/wisetack {publicId}` → rate limits like `/api/pay/stripe` (`pay:<ip>` 10/h, `pay:p:<publicId>` 20/h); 404 `{error:"Monthly payments are not available."}` when no provider / not offered; 409 when unsigned; reuses the live loan by `reuseLoan`, else cancels a stale one and `createLoan` for owed now with purpose = proposal title, client = proposal's client, `returnUrl = <app>/portal/q/<publicId>?financing=back`; `{ url }`.

- [ ] **Step 1: Add failing cases**: `portalFinancingFrom` unsigned + prequalUrl → mode prequal; unsigned without prequalUrl → null; signed + no loan → apply; signed + accepted loan covering 1400000 of stages [600000, 1400000] → status with `coveredIds:["b"]`, `rest` = money(600000); declined loan → apply; not offered but a live accepted loan → status (a loan survives the switch going off).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** pure function, service functions, route, the component (button posts, then `location.href = url`; status card; small-print disclosure; `id="pay-over-time"` anchor), both trees' rendering.
- [ ] **Step 4: Run the check** → `all passed`; tsc grep `portal|mobile-proposal-client|financing|api/pay` → no lines.
- [ ] **Step 5: Commit**: `feat(financing): Pay over time on the client's proposal page`.

### Task 7: The webhook, payouts and the bell

**Files:**
- Create: `src/app/api/webhooks/wisetack/route.ts`
- Modify: `src/lib/webhookEnvelope.ts` (provider union + `"WISETACK"`, its credential name "Wisetack"), `src/lib/payments/settle.ts` (SettleInput provider union + `"WISETACK"`), `src/lib/financing/service.ts` (+ `applyEvent(ev: ProviderEvent): Promise<void>`, `settleFunding(proposalId, loan, funding)`, `prequalLead(orgId, person, amountMinor)`)
- Test: `qa/tests/logic/financing-events.check.ts`

**Interfaces:**
- Consumes: Tasks 1–3, `settleInstallmentPayment`, `runWebhookEnvelope`, `db.lead.create` (as `webEstimatorServer.ts:206` does — source `"wisetack"`, description "Pre-approved for $X through Wisetack").
- Produces: pure `loanSideEffects(before: Loan, after: Loan): Array<{ kind: "approved" | "accepted" | "declined" | "expired" | "paid_part" | "paid" ; fundings: Funding[] }>` (state.ts) — which bells/texts and which new fundings to settle.
- Route: `runtime = "nodejs"`; raw `req.text()`; `getProvider()` null → 404; `parseWebhook` null → 401; each event through `runWebhookEnvelope({ provider: "WISETACK", eventId: ev.id, type: ev.kind }, () => applyEvent(ev))`; any failed → 500 (Wisetack retries).
- applyEvent: merchant → `orgIdForMerchantRef` (scan `financing:` rows by merchantRef) → `applyMerchantSnapshot`; loan → `proposalForLoanRef` → `nextLoanState` → `writeLoan` → side effects: bell + text (`notifyFinancing`) and, per new funding, `settleInstallmentPayment({ provider: "WISETACK", externalId: \`${ref}:${f.id}\`, externalPaymentId: null, organizationId, proposalId, installmentIds: coveredStageIds(open stages, f.amountMinor), amountMinor: f.amountMinor, feeMinor: 0, feeBilling: "in_payment", currency: "USD", livemode: true, method: "financing", scheduleVersion: null, note: "Wisetack" })`; prequal → a lead on the merchant's org + bell. The admin switch is NOT consulted here.

- [ ] **Step 1: Write the failing check** `financing-events.check.ts`: `loanSideEffects` sent→approved → `[approved]`; approved→accepted → `[accepted]`; accepted + fundings [f1 half] → `[paid_part with f1]`; then + [f1,f2] reaching cover → `[paid with f2]` only (f1 not repeated); the same snapshot again → `[]`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** pure function, applyEvent, route, the two unions.
- [ ] **Step 4: Run** `financing-events` + all financing checks → `all passed`; tsc grep `webhook|settle|financing` → no lines.
- [ ] **Step 5: Commit**: `feat(financing): Wisetack's webhook — approvals, payouts recorded as payments, pre-approved leads`.

### Task 8: Job done, reconcile and reminders

**Files:**
- Modify: `src/lib/jobProgress.ts` (after a COMPLETED write with `job.proposalId`: `afterResponse(() => askClientDone(organizationId, job.proposalId))`), `src/lib/financing/service.ts` (+ `askClientDone(orgId, proposalId)`, `reconcileFinancing(now: Date): Promise<{ merchants: number; loans: number; nudges: number }>`), `src/app/api/cron/payments-reconcile/route.ts` (call `reconcileFinancing` last inside try/catch, add its tally to the JSON)
- Test: `qa/tests/logic/financing-rules.check.ts` (`reminderDue` from Task 1 already) + walk

**Interfaces:**
- askClientDone: loan state `accepted` → `provider.askDone(ref)`; "asked" → state `done_asked` + bell "Asked <client> to confirm the job is done"; "unsupported" → bell "Mark the job done in Wisetack so you get paid" (once). No loan / other state → nothing.
- reconcileFinancing: orgs in `started|review|needs_info` with `checkedAt` older than 30 min → `refreshMerchant`; loans not in a final state (`paid|declined|expired|canceled|refunded`) → `provider.loan` → the same path as a webhook loan event (shared function `applyLoanSnapshot(proposalId, snapshot)` extracted in this task); `reminderDue` → `notifyFinancing` + `nudgedAt` / expiring once (store `nudgedAt`, and for expiring reuse `nudgedAt` with a history marker).

- [ ] **Step 1:** Extract `applyLoanSnapshot` from Task 7's loan branch; run `financing-events` → still `all passed`.
- [ ] **Step 2:** Implement askClientDone + the jobProgress hook + reconcile + the cron call.
- [ ] **Step 3:** tsc grep `jobProgress|payments-reconcile|financing` → no lines; `qa/tests/logic/crew-onsite.check.ts` and `crew-days.check.ts` → `all passed`.
- [ ] **Step 4: Commit**: `feat(financing): the crew's Complete asks the client to confirm; reconcile and reminders`.

### Task 9: The proposals row — status line and Send financing link

**Files:**
- Modify: `src/components/v3/proposals-blueprint/proposals-data.ts` (ProposalRow gains `fin?: { line: string | null; canSend: boolean } | null`), `src/app/dashboard/proposals/page.tsx` (fill `fin` via `readLoans`/`readOffers`/`readOrgFinancing` for the listed ids), `proposals-behavior.ts` (`payRowHtml` appends the line and a "Send financing link" button `data-act="fin-send"` → a small prompt Text / Email), `src/app/(mobile)/mobile-proposals-v2/page.tsx` + `proposals-data.ts` + `mobile-proposals.tsx` (`RowPay` shows the line + the button), `src/actions/financing.ts` (+ `sendFinancingLink(proposalId: string, via: "text" | "email")`)
- Test: `qa/tests/logic/financing-rules.check.ts` (add `rowFinancing` pure cases)

**Interfaces:**
- Produces: pure `rowFinancing(i: { offered: boolean; loan: Loan | null; canBill: boolean; money }): { line: string | null; canSend: boolean } | null` (state.ts) — null when not offered and no loan; `canSend` = offered ∧ canBill ∧ (no loan ∨ loan declined/expired/canceled).
- sendFinancingLink: `requireManager`; refuses unless offered; link `<app>/portal/q/<publicId>#pay-over-time`; text through the same client-text path `sendProposal` uses (quiet hours, guards); email through `sendOrgEmail` with subject "Monthly payments for <title>" and the disclosure; logActivity kind "FINANCING_LINK"; returns `{ ok: true, via } | { ok: false, error }`.

- [ ] **Step 1: Add failing cases**: `rowFinancing` not offered + no loan → null; offered + no loan + canBill → `{line:null, canSend:true}`; accepted loan → line from `loanLine`, canSend false; declined → canSend true; canBill false → canSend false.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**; keep the `payRowHtml` change to one appended block (another session redrew this section today — rebase before starting this task: `git fetch https://github.com/Job-Flex2/JobFlex-v3-backup.git main && git rebase FETCH_HEAD`).
- [ ] **Step 4: Run** → `all passed`; tsc grep `proposals|financing` → no lines.
- [ ] **Step 5: Commit**: `feat(financing): financing on the proposals row — where the loan stands, Send financing link`.

### Task 10: Admin switch, board and the investor line

**Files:**
- Create: `src/app/(admin)/admin/financing/page.tsx`, `src/components/v3/admin-financing/admin-financing.tsx`, `src/actions/adminFinancing.ts`
- Modify: `src/components/v3/admin-shell/admin-nav.ts` (Manage: `{ label: "Financing", icon: "i-bank", href: "/admin/financing" }`), `src/lib/investors.ts` (InvestorReport + `financed: { jobs: number; cents: number }` from `Payment` where `provider: "WISETACK", status: "PAID"`), `src/components/v3/admin-investors/investor-report.tsx` (a "Jobs paid with financing" row only when `jobs > 0`)
- Test: `qa/tests/logic/financing-admin.check.ts`

**Interfaces:**
- Produces: `setFinancingSwitch(mode: "off" | "pilot" | "all", pilotEmails: string[])` (`requirePlatformAdmin`; emails → org ids of their owners' orgs; unknown emails returned as `missing`); pure `boardSummary(orgs: Array<{ rec: OrgFinancing }>, loans: Loan[], paidCents: number, shareBps: number | null): { byState: Record<MerchantState, number>; loansByState: Record<LoanState, number>; paidCents: number; shareCents: number | null }` (state.ts).
- Page: the switch (three buttons + pilot emails textarea), env status ("Wisetack connected: yes/no" — never the values), counts, a table of contractors (name, state, applied, decided), a table of open loans (proposal, state, amount), paid total, share ("rate from your Wisetack agreement" when `WISETACK_PARTNER_SHARE_BPS` unset).

- [ ] **Step 1: Write the failing check**: `boardSummary` counts states, `shareCents` = round(paidCents × bps / 10000), null bps → null.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** page, component, action, nav, investor field + row.
- [ ] **Step 4: Run** → `all passed`; tsc grep `admin|investors|financing` → no lines.
- [ ] **Step 5: Commit**: `feat(financing): the admin switch and board; financed jobs on the investor page`.

### Task 11: The AI desk answer

**Files:**
- Modify: `src/lib/aiDesk/profile.ts` (+ pure `withFinancingAnswer(p: DeskProfile, approved: boolean): DeskProfile` and `financingAnswerOf(p: DeskProfile): "ours" | "theirs" | "none"`), the place the live desk profile is assembled for calls and the "try it" box (find with `grep -rn "cleanProfile(" src/lib src/app`), `src/lib/settings/loadSettingsData.ts` (`deskAnswer`), `financing-subpane.tsx` (approved card: "Your AI desk tells callers you offer monthly payments" or, for "theirs", **Use the Wisetack answer**), `src/actions/financing.ts` (+ `useWisetackDeskAnswer()`)
- Test: `qa/tests/logic/financing-desk.check.ts`

**Interfaces:**
- `withFinancingAnswer`: approved false → p unchanged; no FAQ whose q matches /financ|monthly payment|payment plan/i → append `{ q: FIN.deskQ, a: FIN.deskA }` (respect `MAX_FAQS`); a FAQ equal to a preset text from `tradePresets.ts` (the stock "The team can go over payment options…" answer) → replaced by `FIN.deskA`; a FAQ the owner wrote → unchanged.

- [ ] **Step 1: Write the failing check** with the four cases above + `financingAnswerOf` for each.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** + wire the call-time profile through `withFinancingAnswer(profile, letIn && approved)`.
- [ ] **Step 4: Run** `financing-desk`, `ai-desk-profile`, `ai-desk-presets` → `all passed`.
- [ ] **Step 5: Commit**: `feat(financing): the AI desk says yes to financing for approved contractors`.

### Task 12: The stand walk, docs, full checks

**Files:**
- Create: `docs/financing.md` (how it works, the env values, the pretend Wisetack, what changes when the real docs arrive), the support handbook entry (find with `grep -rln "handbook" src/lib/support*`)
- Scratch (not committed): `$SP/finw/stand.sh` (dev server on :3540 from the worktree with a copy of `$SP/roofw/roof.db`, `WISETACK_API_BASE=http://127.0.0.1:3620`, `WISETACK_API_KEY=stand`, `WISETACK_WEBHOOK_SECRET=stand-wisetack`, `EMAIL_DEV_OUTBOX`), `$SP/finw/walk.js` (playwright-core, local Chrome, http://localhost:3540)

- [ ] **Step 1:** Start the fake (`--hook http://localhost:3540/api/webhooks/wisetack`) and the stand; set the switch to pilot for the seeded org (admin page).
- [ ] **Step 2: Walk** (desk 1440 and phone 390), each a check line:
  1. Settings → Payments shows Financing; readiness lists 7 items; Apply opens the fake page; Approve → back, card reads approved with limits and the default switch; the office got a bell row.
  2. A second org uses "I already use Wisetack" with an email the fake knows → linked.
  3. Editor: "Offer monthly payments" on by default; turn off → client page has no button; on again.
  4. Client page unsigned → "See what you qualify for" (no loan made); sign → Pay over time; press twice → one loan in the fake.
  5. Fake: Approve less ($14,000 of $20,000) → client page "approved" text; Accept terms → the deposit stage shows "The rest" with card buttons, the covered stage reads "Paying … through Wisetack"; the proposals row line reads "Loan accepted".
  6. Crew marks the job Complete → the fake shows a completion request; Fund all → Payment row WISETACK PAID, the covered stage PAID, the row line "Paid $14,000"; repeat the same webhook → no second Payment.
  7. Fake prequal → a lead "Pre-approved for $X through Wisetack" in My leads.
  8. Switch off → Settings tab and client buttons gone; a funding webhook for the open loan still records.
  9. Without the env (restart the stand without `WISETACK_*`) → no Financing tab, `/api/pay/wisetack` 404, webhook 404, no 500 anywhere visited.
  10. The AI desk "try it" box answers the financing question with the Wisetack line for the approved org.
- [ ] **Step 3:** All financing checks + `crew-onsite`, `ai-desk-*`, the proposals/payments checks (`ls qa/tests/logic | grep -iE "pay|proposal|settle"`) → `all passed`.
- [ ] **Step 4:** Full tsc (8 GB) and eslint on every touched file — no new errors.
- [ ] **Step 5: Commit** docs + handbook: `docs(financing): how Wisetack financing works and how to switch it on`.
