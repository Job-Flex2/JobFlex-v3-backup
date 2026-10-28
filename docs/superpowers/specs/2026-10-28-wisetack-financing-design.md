# Wisetack financing for contractors — design

Date: 2026-10-28 · Owner approved the plan in chat the same day ("yes").

## Why

The owner wants JobFlex contractors to offer their clients monthly payments for the whole project, through Wisetack —
the lender Jobber and Housecall Pro use — set up and approved from inside JobFlex, "super smart". JobFlex earns from
it through Wisetack's partner revenue share (owner: "we want to make money on like 3% because we're offering them
that"). Financed jobs are bigger and close more often; the contractor is paid in full in 1–3 business days and carries
no credit risk.

Owner's words (2026-10-28): "make it super smart where they can set it up and get the approval. Somewhere in
settings … we can share the link for clients to get the financing … each proposal can have the button that apply for
financing and in the proposal you should have a switch in the contractor side to offer them that button or not."

## What is true about Wisetack (researched 2026-10-28)

- Wisetack's partner API is **private**: docs, sandbox keys and integration review come with a partner agreement
  (wisetack.com/partnerships — "go live in as little as three weeks", "shared revenue model", "webhook reporting").
  Nothing public tells us endpoint names or payloads. **Our side is built against a pretend Wisetack until the owner
  has the agreement.**
- Wisetack approves **each contractor** (merchant) once: business + owner details + bank; 1–3 business days; some
  are declined. Partner platforms start that application inside their own settings.
- Wisetack's lending partners approve **each client**: a phone application, a decision in seconds, checking does not
  affect the credit score. An approval is held for a limited time (Wisetack's help center says 90 days; partner pages
  say less) — the time comes from Wisetack, never hard-coded.
- The contractor is paid after the client confirms the job is done (some merchants qualify for progress payments
  earlier), 1–3 business days. Merchant fee 3.9%; jobs $500 up to $65,000 (raised from $25,000 in June 2026) —
  limits come from Wisetack per merchant, never hard-coded.
- Wording: merchants may not use their own financing language unless Wisetack approved it. Standard disclosure
  (wisetack.com): "All financing is subject to credit approval. Your terms may vary. Payment options through Wisetack
  are provided by our lending partners." Monthly amounts / APRs are lending "trigger terms" — shown only as Wisetack
  supplies them for that amount.

## Goals

1. **Settings → Payments → Financing** (desk and phone): a readiness check, an application pre-filled with what
   JobFlex knows, a live status card with the next step, and once approved: the default switch, the contractor's own
   "check your rate" link.
2. **A switch on every proposal** (contractor side, desk and phone): offer monthly payments or not; it starts from
   the Settings default and locks itself with the reason when financing cannot work for this proposal.
3. **"Pay over time" on the client's proposal page** (both portal trees, desk and phone), opening Wisetack with the
   client and the amount pre-filled, and bringing the client back to a status line.
4. **Sharing:** "Send financing link" from the proposals row (text or email), and the contractor's general link.
5. **After the client says yes:** a status line on the proposal row, texts/bell to the office at the big steps, the
   crew's Complete asking Wisetack to get the client's "job done" confirmation, the payout recorded as a payment that
   marks the proposal paid, reminders when an approval sits or runs out.
6. **JobFlex side:** an admin switch (off / pilot list / everyone, OFF by default), an admin board, a measured line on
   the investor page.
7. **The AI desk** answers "Do you offer financing?" truthfully for contractors who are approved.

## Non-goals (now)

- JobFlex does not lend, decide or hold client credit data; it never sees the client's income/credit — only status and
  amounts.
- No JobFlex fee on top of Wisetack's 3.9% (earning is Wisetack's partner share). No JobFlex 1% card fee on financed
  money (it never passes through Stripe).
- Financing for contractors themselves (materials) — later, through Stripe Capital or Parafin; not Wisetack.
- Financing on invoices, service plans, the homeowner house estimators (/price — no contractor chosen yet) — later.
- A QR code (needs a new library) — later; the contractor gets a copyable link now, and Wisetack's print shop has
  handouts.

## Anti-goals (a failure even if it works)

- A monthly figure, rate or "as low as" that JobFlex made up.
- A "Pay over time" button a client can press for a contractor who is not approved, or for an amount Wisetack will
  refuse.
- A financed job also asking the client for a card deposit as if nothing happened.
- Turned on in production before the partner agreement, Wisetack's review of our screens and wording, and a lending
  lawyer's check of state broker rules.
- Keys or client data in the public repo.

## Constraints

- **No Prisma schema change.** State lives in `SyncState` rows (JSON in `cursor`) and the existing `Payment` row
  (`provider` is a plain string → `"WISETACK"`, `method` `"financing"`). The webhook dedupe union widens in TypeScript
  only.
- Everything OFF until the admin switch turns it on; the switch's default is off; production also needs the Wisetack
  env values (`WISETACK_API_BASE`, `WISETACK_API_KEY`, `WISETACK_WEBHOOK_SECRET`) — absent → financing is unavailable
  everywhere, quietly.
- The code that talks to Wisetack sits in **one module** behind an interface, so the real API (when its docs arrive)
  changes one file plus a status mapping table.
- v3 blueprint shell, light theme, desk and phone parity, the house's wording rules (plain words, no jargon).
- Only owner/manager apply, change the default, or send a financing link (the pay-row actions are `requireManager`
  today); whoever edits a proposal may flip its switch.
- A card-less trial that is write-locked cannot apply or send links (`assertWriteAllowed`); a lapsed plan
  (`planEnded`) offers no new financing.
- Wisetack's approved wording and disclosure everywhere money terms appear; all words in one module.

## How it works

### States (ours — Wisetack's names map onto these in the one module)

- Contractor (merchant): `none` → `started` (application opened, not finished) → `review` → `needs_info` →
  `approved` | `declined`; `paused` (Wisetack turned it off later).
- Client loan (one live loan per proposal): `sent` (link made) → `started` → `needs_action` → `approved`
  (an approved amount) → `accepted` (loan terms accepted) → `done_asked` (we asked the client to confirm the job is
  done) → `paid` (Wisetack funded the contractor) | `declined` | `expired` | `canceled` | `refunded`.

### Storage (SyncState keys)

- `financing:<orgId>` — the contractor's record: Wisetack merchant reference, state, dates, what Wisetack asked for,
  limits (min/max), fee, the contractor's general link, the "offer on every new proposal" default (on), the year the
  business started (asked once in the readiness check).
- `financingOffer:<proposalId>` — the proposal's switch when it differs from the default.
- `financingLoan:<proposalId>` — the live loan: reference, state, amount, approved amount, link, expiry, history,
  the Payment id once paid.
- `financingLoanRef:<loanRef>` → proposal id (webhook lookup).
- `financingSwitch` — the admin switch: `off | pilot | all` + pilot org ids.

### Settings → Payments → Financing

- A fourth sub-tab beside Stripe / Square / Stax (desk `PAYMENT_SUBTABS`; phone `PaymentsPane` row). Shown only when
  the admin switch lets this org in.
- **Readiness check** (pure rule): business name, phone, email, business address, website, trade, year started —
  each ✓ or "Add it" (links to the Account pane; year started asked inline). Headed "What lenders usually look at" —
  guidance, never a promise.
- **Apply**: JobFlex starts the Wisetack application with what it knows (name, address, phone, email, website,
  trade, owner's name/email) and opens Wisetack's secure page for the rest (owner identity, tax ID, bank). Coming
  back lands on the Financing tab.
- **Status card** per state with the next step in plain words; a "Check again" button pulls the state; webhooks and
  the 30-minute payments reconcile keep it fresh without it.
- **Already a Wisetack merchant** (many come from Jobber / Housecall Pro): "I already use Wisetack — link my account"
  beside Apply. How linking works depends on Wisetack's answer (asked in the partner email); the pretend Wisetack
  links by the merchant's email so the path is built and walked now.
- **Approved**: limits, fee, the default switch "Offer monthly payments on every new proposal" (on), the general
  link with Copy, the disclosure line. A text + bell to the owner on approval / needs info / declined.

### The proposal switch

- In the editor's "Payment & deposits" block (`bp-money.tsx`, shared by desk and phone): **Offer monthly payments**
  with the client-facing preview line. Saved at once by its own action (not through `saveProposal`).
- Locked, with the reason and a way forward: not set up (→ Settings), waiting on Wisetack, the amount owed is under
  the minimum or over the maximum, already paid, plan ended.
- Offered = admin switch lets the org in ∧ contractor approved ∧ switch on (proposal value, else the default) ∧
  amount owed within limits ∧ proposal not paid/void.

### The client's page

- `buildPortalPayModel` carries a `financing` part: offered or not, the live loan's state, the approved amount, the
  monthly text only if Wisetack supplied one, the disclosure.
- Both portal trees (desk `portal-payment.tsx`; handheld `mobile-proposal-client.tsx` / `payment-center.tsx`) show
  **Pay over time** with "Check your rate — it won't affect your credit score" and the disclosure in small print.
- **Sign first, like card payments.** Before the client signs, the page says monthly payments are available and
  offers "See what you qualify for" (the contractor's general prequal link — no loan, no amount). After signing,
  **Pay over time** appears beside the card/bank buttons. (The card checkout already refuses unsigned proposals;
  a funded loan never exists without a signed contract.)
- Pressing it calls `/api/pay/wisetack` (public, rate-limited, by proposal public id, signed proposals only): makes
  or reuses the live loan for **the amount owed right now** (contract total with approved change orders, minus what is
  paid), with the client's name/phone/email, and sends the browser to Wisetack. Coming back shows the state: approved
  for $X · monthly payments are set · not approved this time (other ways to pay stay).
- **The loan covers its own amount; anything beyond it is paid the usual way.** While a loan is `accepted` or later,
  the stages it covers read "Paying with monthly payments through Wisetack"; whatever the loan does not cover (Wisetack
  approved less, a change order approved later, a price raised) keeps its card/bank buttons as "The rest: $X". A
  declined/expired/canceled loan brings every button back.
- Editing the price or approving a change order on a proposal with an accepted loan is allowed, with a notice to the
  office: "The client's loan is for $X; the new total is $Y — the difference is paid another way, or send a new
  financing link." A payout larger than what is owed goes through settle's existing unapplied/refund path.

### Sharing

- The proposals row (desk pay row, phone `RowPay`) gets **Send financing link** when offered: by text or email, to
  the client, through the existing client-sending rails (quiet hours, guards). The link is the client's proposal
  page opened at the Pay over time button — the loan is made when the client presses it, so the amount is current.
- The contractor's general link (Settings) is for their website, ads, emails.
- **Pre-approved people become leads.** When Wisetack tells us someone pre-qualified through a contractor's general
  link (name, contact, amount), JobFlex adds them to that contractor's leads as "Pre-approved for $X through
  Wisetack" with a bell. If the real Wisetack does not send these, the path stays quiet; the pretend Wisetack sends
  them so it is built and walked.

### After yes

- Row status line (desk + phone): Link sent → Approved $X → Loan accepted → Asked the client to confirm the job →
  Paid $X on <date> (or Declined / Expired).
- Webhook `/api/webhooks/wisetack`: verified by the module, deduped by `runWebhookEnvelope` (provider `WISETACK`),
  updates the contractor or loan record. Approved / accepted / paid → ActivityEvent + bell + the office text,
  like card payments today.
- **Paid** → `settleInstallmentPayment` with provider `WISETACK`, `externalId` = `<loan reference>:<funding id>`
  (a loan can fund more than once — progress payments), method `financing`, JobFlex fee 0, the funded amount
  (Wisetack's 3.9% is noted in the Payment's meta) → the stages are paid → the proposal reads PAID when nothing is
  owed. The loan reads "Paid $X of $Y" until its whole amount has funded, then `paid`.
- **Job done** — the crew's Complete (`recordJobProgress` COMPLETED) or the office marking the job completed, with an
  accepted loan → JobFlex asks Wisetack to send the client the "is the job done?" confirmation (state `done_asked`).
  If Wisetack's API cannot, the office is told to finish it in Wisetack.
- Reminders (in the existing payments reconcile): approved but not accepted for 3 days → the office is told (they
  press Remind; JobFlex does not text the client on its own); approval ending in 7 days with the job not done → the
  office is told.

### JobFlex side

- `/admin/financing`: the switch (Off / Pilot list / Everyone), contractors by state, loans by state, financed money
  paid, JobFlex's share computed from the agreement's rate when set (`WISETACK_PARTNER_SHARE_BPS`; unset → "rate from
  your Wisetack agreement").
- Investor page: "Jobs paid with financing" — count and dollars, **measured** (Payment rows `WISETACK` + `PAID`),
  shown only when there is at least one.

### The AI desk

- For an approved contractor (switch lets them in) whose financing answer is still the preset (they never wrote
  their own), the desk answers "Yes — monthly payments through Wisetack, subject to credit approval. The team can send
  you a link to check your rate." No rates. A contractor who wrote their own answer keeps it; the Financing tab (approved
  card) offers the Wisetack line as a one-tap fix instead.

### The pretend Wisetack (build and test before the agreement)

- A small local server in the repo (`qa/stand/fake-wisetack.mjs`) implements the module's assumed calls and a
  Wisetack-looking page with Approve / Needs info / Decline (merchant) and Approve / Accept / Decline / Fund (loan)
  that fire signed webhooks back — so the whole loop walks on the stand.
- The module's HTTP shape is our assumption, marked as such in the file; when the real docs come, that file and the
  status mapping are rewritten and the checks re-run in Wisetack's sandbox.

## Rollout

1. Build everything above, OFF, against the pretend Wisetack (this round).
2. Owner signs the partner agreement and gets docs + sandbox keys → rewrite the module, walk one full job in Wisetack's
   sandbox.
3. Wisetack reviews our screens and wording; a lending lawyer checks state broker rules (California first) → admin
   switch to Pilot for 3–5 contractors → Everyone.

## Left to the builder

File layout inside `src/lib/financing/`, component structure, exact copy within the rules above (one words module),
test layout, how the pretend server looks.

## Calls I made (owner can overrule)

- Trial accounts may apply (approval takes 1–3 days — a reason to stay); the admin switch limits who sees it at all.
- A financed job hides the card stage buttons while the loan stands.
- JobFlex never texts the client a reminder on its own — the office presses Remind.
- The loan is made when the client presses the button (current amount), not when the link is sent.
- No QR code this round (new library); copy link only.
- The financing reconcile rides the existing 30-minute payments reconcile cron instead of a new cron.
- Sign first: "Pay over time" appears after the client signs (like card payments); before signing they can see what
  they qualify for through the contractor's general link.
- The loan covers its own amount; anything beyond it (less approved, change orders, price raised) is paid by
  card/bank as "The rest"; price edits on a financed proposal are allowed with a notice, not blocked.
- A loan may fund more than once (progress payments); each funding is its own payment.
- Contractors already on Wisetack get "link my account"; how it really links waits on Wisetack's answer.
- People pre-approved through a contractor's general link become that contractor's leads (if Wisetack sends them).
- The AI desk never overwrites a contractor's own financing answer; it suggests the Wisetack line instead.
