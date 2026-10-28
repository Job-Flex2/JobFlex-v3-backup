# Wisetack financing

Contractors offer their clients monthly payments through Wisetack, set up and approved from inside JobFlex.
Design: `docs/superpowers/specs/2026-10-28-wisetack-financing-design.md`. Built 2026-10-28, **off** everywhere.

## Who approves what

- **Wisetack approves JobFlex** as a software partner (partner agreement, revenue share, API docs, sandbox keys,
  a review of our screens and wording). JobFlex earns its share from Wisetack — no fee on top of Wisetack's 3.9%.
- **Wisetack approves each contractor** once (Settings → Payments → Financing): 1–3 business days.
- **Wisetack's lending partners approve each client** per job, on Wisetack's page. JobFlex never sees credit or
  income — only the loan's state and amounts.

## What is built

| Where | What |
| --- | --- |
| Settings → Payments → Financing (desk sub-tab; phone card) | readiness list, Apply (prefilled), link an existing account, live status, default switch, the contractor's "check your rate" link, the AI desk note / one-tap fix |
| Builder → Payment & deposits | "Offer monthly payments" per proposal, locked with its reason |
| Client page (`/portal/q/<publicId>`, both trees) | before signing: See what you qualify for; after: Pay over time → `/api/pay/wisetack`; status after Wisetack; an accepted loan pays the last stages, the rest is paid as usual |
| Proposals list (desk + phone) | the loan's line, Send financing link |
| `/api/webhooks/wisetack` | signed events → contractor state, loan state, payouts as `Payment` rows (`WISETACK`, `financing`, fee 0), pre-qualified people → leads |
| Crew Complete (`lib/jobProgress`) | asks Wisetack to have the client confirm the job is done |
| `/api/cron/payments-reconcile` | the backstop: applications in review, open loans, two office reminders |
| `/admin/financing` | the switch (Off / Pilot by owners' emails / Everyone), companies, loans, paid out, JobFlex's share |
| `/admin/investors` | "Jobs paid with financing", measured, only once there is one |
| AI desk | an approved company's desk says yes to financing (never over the owner's own answer) |

Storage is SyncState only (`financing:<orgId>`, `financingOffer:<proposalId>`, `financingLoan:<proposalId>`,
`financingLoanRef:<ref>`, `financingSwitch`) — no schema change.

## Switching it on

1. Production env (Vercel): `WISETACK_API_BASE`, `WISETACK_API_KEY`, `WISETACK_WEBHOOK_SECRET`, and
   `WISETACK_PARTNER_SHARE_BPS` (the agreement's rate in basis points, for the admin board only). Without the first
   three, financing is hidden everywhere and the routes answer 404.
2. Give Wisetack the webhook URL: `https://www.jobflex.app/api/webhooks/wisetack`.
3. `/admin/financing` → Pilot → the pilot companies' owner emails → Save. Later: Everyone.

## When Wisetack's partner docs arrive

`src/lib/financing/wisetack.ts` is the only file that talks to Wisetack, and its shape is **assumed** (paths, field
names, status names, the `x-wisetack-signature` HMAC). Rewrite the calls and the two status tables
(`MERCHANT_STATUS`, `LOAN_STATUS`) to the real API, keep the `FinancingProvider` interface, run
`qa/tests/logic/financing-*.check.ts`, then walk one job in Wisetack's sandbox. Also confirm with Wisetack: the
approved button/disclosure wording (`src/lib/financing/words.ts`), whether a partner may show Wisetack's monthly
wording (the client page passes `monthly: null` today), how linking an existing merchant works, the completion
request, progress payments.

## The pretend Wisetack (stand only)

`node qa/tools/fake-wisetack.mjs --port 3620 --hook http://localhost:<stand>/api/webhooks/wisetack --secret <secret>`
answers to the assumed shape and has pages with buttons (approve, needs info, approve less, accept, fund…) that send
signed webhooks. Point the stand's `WISETACK_API_BASE` at it and `WISETACK_WEBHOOK_SECRET` at the same secret.

## Before launch

Wisetack reviews our screens and wording; a lending lawyer checks state broker rules (California first) for the
revenue share.
