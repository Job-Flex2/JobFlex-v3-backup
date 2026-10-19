# Service plans (memberships)

*2026-09-22.* What a maintenance plan is in JobFlex, how it runs itself,
and where each piece lives. Built after the owner's Housecall Pro
comparison ("we need that too — make it smart and easy").

## What a plan is

- **A template** is what the shop sells (`ServicePlanTemplate`): visits a
  year, term, price, monthly or yearly billing, discount on repairs,
  benefits, priority scheduling, waived diagnostic. Three starter plans are
  one click away on the Service plans page (`STARTER_PLANS` in
  `lib/servicePlans`): Comfort $21/mo · 2 visits · 15%, Essential $149/yr ·
  1 visit · 10%, Premium $29/mo · 2 visits · 20%.
- **A plan** is one client's membership (`ServicePlan`): a snapshot of the
  terms at signing, `DRAFT → SENT → ACTIVE → EXPIRED | CANCELED`, with its
  visits (`ServicePlanVisit`, each tied to a calendar `Appointment`) and the
  invoices that bill it (`Invoice.servicePlanId`).

## What it does on its own

- **Enroll** from the Service plans page or the client page: "send to sign"
  emails the client the plan card with an accept link (`/plan/[token]`,
  public); "start today" activates it when it was signed with the office.
- **Activation** (`lib/servicePlanBook` `activatePlan`): term set; the visits
  land on the calendar — seasonal for HVAC (spring cooling tune-up ≈ Apr 15,
  fall heating tune-up ≈ Oct 1; one a year = the next season; otherwise
  spread through the term) at 9:00 in the shop's time zone, two hours, the
  crew's tune-up checklist in the appointment notes; the first invoice is
  written (MANUAL provider, due in 7 days); the client gets a welcome email.
- **Daily** (`/api/cron/service-plans`, 14:00 UTC): bills due go out (invoice
  + email + bell); visits two weeks out are announced (bell to the office,
  email to the client); plans ending within 30 days get one warning (bell +
  email); at the end a plan renews on its own (new term, new visits, new
  invoice) or, with auto-renew off, expires (bell: call to renew).
- **Member discount**: every new proposal for a client with an active plan
  gets the plan's discount line (`applyMemberDiscount`, hooked into every
  proposal creation: saveProposal and the five estimator converts), priced
  the way proposals price a discount (off before tax). A proposal that
  already has a discount keeps the contractor's own.
- **Paid by hand**: "Mark paid" closes the invoice and writes a MANUAL
  payment, so Financials counts it.

## The HVAC services desk (2026-10-18)

Owner: "make the service a sub-row under the inventory … make it more
understandable — where you set up the service, what client is it, where to
see the services schedule, who's the clients, do they belong to any project
or proposal — and set the reminders for the contractor."

- **Where**: `/dashboard/hvac-estimator/service-desk`, the "HVAC services"
  sub-row under the HVAC estimator, beside "HVAC inventory". It replaces the
  Money section's Service plans row; `/dashboard/service-plans` forwards here.
  Office roles only (owner, admin, manager); open to every company — it left
  early access the same day (owner: "for everybody").
- **The four steps** at the top say how the service side runs and where it
  stands — the plans you sell · clients on a plan · visits on the schedule ·
  reminders to you — each one a door to its tab.
- **Today**: the numbers, then "Needs you" (`lib/serviceDesk` `needsYou`): a
  visit overdue (report or mark done), today's visits, visits inside the
  heads-up window (confirm the time; no tech on it), your reminders due, late
  plan bills, a plan run out or ending without auto-renew (or ended in the last
  45 days), a plan unsigned after N days, a draft — then the ideas: R-22 or an
  old system at a member's home (quote the replacement) and an HVAC install
  from the last 18 months with no plan on it (offer one). Each line has the
  button that clears it.
- **Schedule**: the season (plan visits a month, twelve months) and every plan
  visit by month — client, address, phone, plan, tech (staff it here), state;
  Report, Done, Move (day and time; the calendar appointment moves and the
  visit's own day follows, so the plans' reminders read the new date).
- **Clients**: one line per plan — client, plan and its state, next visit,
  visits done, bills, and what it **belongs to**; a line opens to the plan's
  terms and buttons, its visits and bills, the equipment at the home with its
  age read, the proposal or project to tie it to, and the client's other work.
- **Plans**: enroll (pick the client, the plan, and what it belongs to — the
  client's latest accepted HVAC proposal is picked on its own, else their
  newest project), what happens when a plan starts, the plans you sell.
- **Reminders**: when JobFlex reminds you — a heads-up 1/2/3/7/14 days before a
  plan visit, unsigned plans after 2–14 days, a daily digest on/off — where
  they show up (the bell for the office; texts to whoever has "Service
  reminders" on in Texting, the digest only, one text a day at most), today's
  digest as it would read, and your own reminders (a day, a note, a client):
  rung on their day, on Today until done, +1 day / +1 week / done / remove.

**Stored without new tables** (ActivityEvent rows, `lib/activityLog`
TRAIL_KINDS — the trail, never the bell): `SERVICE_REMINDER` →
`SERVICE_REMINDER_DONE` (meta dueOn, note, planId, firedAt, doneAt),
`SERVICE_LINK` (proposalId column + meta planId/projectId; latest wins),
`SERVICE_PREFS` (meta = the settings; latest wins). The daily run
(`/api/cron/service-plans` → `runServiceDeskReminders`) writes bell rows
`PLAN_REMINDER` (each reminder on its day, once), `PLAN_HEADS_UP` (each visit
entering the window, once; skipped at 14 days, where `PLAN_VISIT_DUE` says it)
and `PLAN_DIGEST` (once a day, only when there is something to say) and texts
the digest through `textOffice(…, "service-reminder")`. The bell files every
`PLAN_*` notice under that key (Settings → Notifications). Rules:
`qa/tests/logic/service-desk.check.ts`.

## Where

- Page `/dashboard/service-plans` (blueprint shell; Money in the sidebar) —
  since 2026-10-18 the HVAC services desk above; the old address forwards.
  What it held:
  KPIs (active, expiring in 30 days, monthly recurring, due for billing),
  enroll, members with actions (send / start / renew / auto-renew / cancel),
  visits in the next 30 days (Done), due for billing (Mark paid), the plans
  you sell (edit / retire / new).
- Client page: a "Service plan" panel — the membership with next visit and
  billing, or the enroll form.
- Public `/plan/[token]`: the card, a typed-name acceptance, then the
  membership view.
- Bell notices: kinds `PLAN_*` with `meta.href`.

## Checks

- `scripts/qa/service-plans.check.ts` — the rules (schedule, billing, MRR,
  phases, the calendar hour, the checklist).
- Stand walk `plans.js` (scratchpad): starter plans → enroll → public accept
  → member numbers, calendar, client page → mark paid → the cron's report.

## Not done

- Card pay links for plan invoices (the payment rails are proposal-bound
  today); the invoice email asks the client to pay the shop's usual way.
- SMS reminders (email + bell only).
- A member badge on leads (leads have no client link).
