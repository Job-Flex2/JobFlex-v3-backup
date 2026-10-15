# Text messages (2026-09-24)

JobFlex owns the Twilio account. A contractor never sees a key: they verify a
mobile, tick which events reach it, add their crew's numbers, and the texts
flow. The office gets one line per event; the crew gets the things that
change their day.

## Setup, once, on the platform

- **/admin/integrations/twilio** (2026-09-24): the platform admin pastes the
  Account SID, the Auth Token (stored encrypted with `TOKEN_ENCRYPTION_KEY`,
  never shown back), the Messaging Service SID (preferred) or a sending
  number, and a switch. "Check with Twilio" is a real round trip; "Send test"
  texts a number; the page lists the webhook URLs to paste and the last texts
  with Twilio's delivery status. Every contractor runs on these settings
  within a minute of a save (a one-minute cache per process).
- The env keys stay the fallback when the admin row is empty:
  `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and either `TWILIO_MESSAGING_SERVICE_SID`
  (preferred) or `TWILIO_PHONE_NUMBER`. US carriers only honor an A2P
  registration for traffic sent through a Messaging Service — a bare number
  reads as unregistered and comes back undelivered (error 30034). Register a
  toll-free number (toll-free verification) or a 10DLC campaign
  ("account notifications and reminders") under a Messaging Service.
- Twilio console → the Messaging Service → Integration: inbound webhook
  `https://www.jobflex.app/api/twilio/sms` (POST), and turn on Advanced
  Opt-Out so STOP / START / HELP are handled by Twilio too. Delivery
  status arrives at `/api/twilio/sms/status` (set per message). Both verify
  the Twilio signature; set `TWILIO_APP_URL` when the public URL differs.
- Vercel cron `/api/cron/sms-crew` runs hourly (`15 * * * *`).

Without the keys the app works the same: every text is a `SKIPPED` row in
`SmsMessage`, which is how the local stand shows what would have gone.

## Production record (2026-09-29)

- Twilio account **Jobflex LLC**, ISV Reseller compliance profile
  `BUb28368a569264579990ef6a0a5de1279` (approved 2026-09-29).
- Platform number **+1 866 897 5760** (`PNbb44dd70d0f505e1c88ae59eef4c1254`,
  toll-free, SMS + Voice; voice webhook → `/api/twilio/voice`).
- Messaging Service **JobFlex** `MG837450cfa0296fc503c810b0699dfa69`:
  inbound webhook `/api/twilio/sms` (POST), sticky sender, use case
  notifications, the number in its pool. Set in /admin/integrations/twilio
  with the Account SID and Auth Token.
- Toll-free verification `HH46f4f5318f2309024fd8c84e8db70819`, submitted
  through the API (`Tollfree/Verifications`): categories account
  notifications + customer care, opt-in type web form, 10,000/month, the
  opt-in pictures at `/twilio/opt-in-settings.png` and
  `/twilio/opt-in-worker.png` (public/twilio — a real capture of the
  Settings → Texting consent card and the worker sheet's checkbox).
  Twilio caps the summary, sample and additional-information fields at
  500 characters and wants `BusinessType=PRIVATE_PROFIT` plus the EIN as
  registration number/authority. Until it is approved US carriers return
  undelivered (30034); the admin page shows those rows.
- The number was bought in the console by the owner (a purchase is not
  something an assistant session may make); everything after it was done
  with the REST API.

## Rejected, and what the shared number may say (2026-10-02)

Twilio rejected the verification with two reasons:

- **30482, business email must use an official domain.** The contact email
  was a Gmail address. It is now `support@jobflex.app`, the address the
  Terms and Privacy pages already list (jobflex.app mail is Google).
- **30474, end business details.** Twilio verifies a toll-free number for
  the one business the person being texted signed up with. The submission
  named Jobflex LLC while its samples spoke as each contractor ("Ridgeline
  Roofing: …") and texted the contractors' clients and crews, so the
  reviewers read the contractors as the senders.

What changed so the number is truthfully JobFlex's own:

- `send.ts` `dispatch`: on the shared number (no `Organization.smsFromNumber`)
  a text goes out only as a code someone asked for, or to a member who set
  their own mobile (`smsAddedBy` empty). A mobile the office typed in, crew
  phones, clients, extra numbers and every company text rule (`rule:*`)
  become SKIPPED rows with error `shared-number`. They wait for each
  company's own registered number.
- `format.ts` `asSharedSender`: the shared number names JobFlex first,
  "JobFlex (Ridgeline Roofing): New lead: …". The row keeps the company's
  words, so the duplicate rule and the overnight fold are unchanged.
- The Your mobile card carries the consent line under Text me a code, with
  links to Terms and Privacy. Terms has a "Text messages from JobFlex"
  paragraph, Privacy the mobile-number sentence, and both now name
  Jobflex LLC as the operator. The opt-in picture
  `public/twilio/opt-in-settings.png` was re-captured with the consent line.
- The resubmission names the categories two-factor + account notifications,
  the new samples (made by the templates themselves), the HELP reply, the
  Terms and Privacy URLs and "JobFlex" as the trade name. Edits were allowed
  until 2026-10-16. Resubmit only after this is deployed: the reviewers
  compare the registration with the live site.

## A company's own texting number (2026-10-02)

Owner: "we need to set the Twilio number in JobFlex admin and contractors can
use it for their own SMS … JobFlex will pay it." Twilio allows one business
per toll-free number (errors 30474, 30478), so each company gets its own,
bought on JobFlex's account and registered in the company's name. Paid plans
only (an ACTIVE or PAST_DUE subscription on a plan other than FREE).

- **Settings → Texting → The company → Your texting number** (desk) and the
  same card on the phone settings page (`components/v3/texting-people/own-number.tsx`):
  Get your texting number → the business form (legal name, trade name, kind
  of business, EIN, address, website, contact; prefilled from the company,
  a missing website becomes its `/r/<slug>` page) → Register my number.
  States: waiting for Twilio (Check now), approved (sending), sent back
  (Twilio's reasons, the form again while the edit window is open), failed
  (our own step, in Twilio's words). Release asks twice.
- **`lib/sms/registration.ts`** buys a toll-free number once (kept across a
  resubmission), adds it to the platform Messaging Service, and creates — or,
  after a rejection, updates — the toll-free verification with
  `verificationFields` (`lib/sms/registrationShared.ts`: the contractor's
  details, its own three sample texts made by the templates, the booking-page
  opt-in picture `public/twilio/opt-in-booking.png`, its live booking link).
  State is SyncState `smsreg:<orgId>`; no schema change. The number is put on
  `Organization.smsFromNumber` only when Twilio approves: the settings page
  asks at most every 10 minutes, the hourly `/api/cron/sms-crew` asks for
  every pending company. The old instant local-number purchase
  (`lib/sms/numbers.ts`, unregistered numbers) is gone.
- **Consent (`lib/sms/consent.ts`).** The booking page has "Text me about my
  visit and estimate from <company>" (unticked, with frequency, rates,
  STOP/HELP, not a condition of booking). A tick keeps SyncState
  `smsok:<orgId>:<E.164>` and a trail row. `send.ts` lets a company's own
  number text its team (members' mobiles, crew phones, extra numbers,
  compared as E.164) and anyone else only with that yes; otherwise a SKIPPED
  row `no-consent`. Codes and HELP answers always go.
- **HELP** on a company's own number is answered by the company, from that
  number (`companyHelpText`).
- Checks: `scripts/qa/sms.check.ts` (registration words, prefill, fields,
  limits, HELP); stand walk recipe in the session notes (`own-walk.js`).

## No JobFlex number (2026-10-02, the owner's "option 2")

Twilio rejected the JobFlex number a second time for 30474 alone, eleven
minutes after the resubmission. The account's primary business profile is an
**ISV reseller** (`isv_reseller_or_partner`), and Twilio attached an
auto-created starter customer profile named Jobflex LLC to the verification:
a reseller listed as its own customer is exactly what 30474 describes. So
JobFlex stopped needing a number of its own:

- **Sign-in codes go through Twilio Verify** (`lib/sms/verify.ts`), which
  sends from Twilio's pre-registered senders and needs no registration (5¢ per
  approved code plus the text). The service named "JobFlex" is found or made
  on first use and remembered in SyncState `twilio:verify-service`
  (`TWILIO_VERIFY_SERVICE_SID` overrides). `PhoneVerification.codeHash` is
  `"verify"` when Twilio holds the code; without Twilio (the stand) the old
  own-code path prints the code to the server log. The admin page's "Send
  test" now sends a Verify code.
- **Every other text leaves from the company's own registered number.**
  `send.ts` has no fallback: no number → SKIPPED `no-number`; the result
  carries `why` (`no-number`, `no-consent`, `not-configured`).
  `sdk/twilio.sendSMS` refuses a text without `from` — with only contractor
  numbers in the Messaging Service pool, a pool pick would send one company's
  text from another company's number.
- **Six senders that went straight to Twilio now go through `sendText`:**
  the client message action, change orders, proposal follow-ups (a text that
  cannot leave falls back to the email), invoices, payment reminders, and the
  lead center's texts (`notify.ts sendLeadSms`). The lead center's texts are
  JobFlex's own (to homeowners and to shops' business phones) and stay
  SKIPPED `no-number`; their emails carry them. A JobFlex number would need a
  separate Twilio account registered as a direct business.
- The shared-number helpers (`asSharedSender`, `sharedNumberMay`) are gone.
  The JobFlex toll-free number (+1 866 897 5760) is still on the account (its
  voice webhook points at /api/twilio/voice); releasing it is the owner's call.

## The JobFlex number's one job: lead alerts to shops that opt in (2026-10-02)

The owner wanted the JobFlex number approved anyway. Its honest job is JobFlex's
OWN messages to its OWN subscribers: lead-center alerts to a shop's business
phone (offer reserved, offer expiring, new lead). Homeowners are not texted
(the homeowner request form does not ask them yet; their emails carry it).

- **Opt-in:** Settings → Texting → The company → "Lead texts from JobFlex"
  (desk + phone): On/Off, the company phone, the consent words with Terms and
  Privacy. Stored as `leadsSettingsJson.instantSms` (the old classic-form key,
  never read before); default is now **off**. Turning it on sends the
  confirmation `leadTextsOnText` with STOP/HELP.
- **`notify.ts sendLeadSms`:** homeowner texts skipped; shop texts only when
  `instantSms === true`; sent as kind `jobflex-…` with no organization.
- **`send.ts`:** kind `jobflex-…` without an organization leaves from
  `jobflexSender()` (`lib/sms/jobflexSender.ts`: the number of the platform
  verification with external reference `jobflex-platform-tollfree`, once
  TWILIO_APPROVED, asked hourly, SyncState `twilio:jobflex-sender`;
  `TWILIO_JOBFLEX_FROM` overrides). Until then `no-number`. HELP on the
  JobFlex number is kind `jobflex-help`.
- **Resubmission:** ACCOUNT_NOTIFICATIONS only, the four real lead texts as
  samples, opt-in picture `public/twilio/opt-in-lead-texts.png`, a statement
  that subscribers' own texts use their own separately verified numbers.
  Send it only after the deploy. If Twilio still answers 30474 because the
  account is an ISV reseller, the remaining route is a separate Twilio account
  registered as a direct business for JobFlex's own texts.

## What the contractor does

- Settings → Notifications: the matrix has a third column, **Text**. The
  **Text messages** card below it: type a mobile, "Text me a code", enter
  the six digits. The code is the consent. "Stop texting me" drops it.
- **Also text**: extra office numbers (the dispatcher, whoever runs the
  books) get every office event; each gets a welcome text with the STOP line
  and can be paused or removed. Up to ten.
- **Quiet hours** (default 8 PM–7 AM): a text that lands in the window waits
  and goes out at the end, folded with anything else that waited into one
  "overnight" message. A new lead never waits.
- Workers → edit a worker: phone + "Text their schedule to this phone". The
  worker gets the welcome text; a STOP reply wins over the switch.

## Clients, a company's own number, the allowance (2026-09-24)

- **Text clients** (switch in the card, default on): the proposal link the
  moment a proposal is sent (`Ridgeline Roofing: your proposal "…" ($11,306.52)
  is ready — see it and accept here: <link> Reply STOP to opt out.`) and a
  reminder at 6 PM the evening before a visit (`reminder — we're scheduled at
  4567 Rainier Ave S tomorrow, Fri Sep 25, 9 AM–4 PM (Roof tear-off). Reply
  here with any questions.`). Both need a phone on the client (or the lead).
- **Your own number**: one click buys a local number in the company's area
  code on the platform's Twilio account, points its inbound webhook at
  `/api/twilio/sms`, adds it to the platform's Messaging Service (so the A2P
  registration still covers it) and keeps it on the organization
  (`smsFromNumber`, `smsNumberSid`). That company's texts then show that
  number and replies to it route straight to the company. "Release it" puts
  it back. Billed through at cost.
- **Allowance per plan** (`SMS_ALLOWANCE` in `src/lib/entitlements.ts`):
  FREE 50, STARTER 250, PROFESSIONAL 1,000, ENTERPRISE 4,000 texts a month;
  the card shows "142 of 1,000 texts this month". Beyond it texts still go
  and are billed through at 3¢ each (`SMS_OVERAGE_CENTS`); the daily caps
  still apply.

## What gets texted

Office (through each member's Text cell, or every event to the extra numbers):

| event | line |
|---|---|
| proposal accepted | `Rick Stevens accepted "Roof replacement" — $11,306.52. Schedule it: <link>` |
| proposal declined / decline taken back | `Rick declined "…": "…"` |
| payment received | `Rick paid $3,391.96 on "…" — $7,914.56 still due.` |
| change order answered | `Rick approved change order #2 "Plywood" ($850) on "…".` |
| worker responded | `Marcus Bell declined "Roof replacement" on Wed Oct 7.` |
| new lead / lead offer | `New lead: Pat, Roofing in Seattle, WA ((206) 555-0100). Open: <link>` |

Crew (phone + switch on):

- put on a job or an appointment: `you're on "Roof replacement" Wed Oct 7, 8 AM–4 PM at 4567 Rainier Ave S. Details + confirm: <link>`
- moved: `"Roof replacement" moved to Thu Oct 8, 8 AM–4 PM at …`
- cancelled: `"Roof replacement" on Wed Oct 7 is cancelled — you're not needed for it.`
- 6 PM: `Ridgeline Roofing — tomorrow (Wed Oct 7): 8 AM Roof replacement, 4567 Rainier Ave S · 1 PM Gutter repair, 12 Main St. Details: <link>`; 7 AM the same for today. Only when there is something on the list; once per day.

Replies from the field or a client come back on the bell ("Marcus texted:
…", kind `SMS_REPLY`) and are forwarded to the office numbers at once.

## Rules in `src/lib/sms/send.ts`

- A number that replied STOP is never texted (`SmsOptOut`); START clears it.
- The same words to the same number within ten minutes go once.
- Caps per day: 25 per number, 500 per company, 5,000 platform-wide;
  fail-closed when the limiter cannot answer.
- Every text is an `SmsMessage` row (direction, status from Twilio's
  callback, kind, the held `sendAfter`), which is the month counter in
  Settings and the answer to any support question.

## Data layer (additive)

`User.smsPhone`, `User.smsVerifiedAt`; `WorkerProfile.smsOptIn`,
`WorkerProfile.smsOptedInAt`; `Organization.smsClientsOn`, `smsFromNumber`,
`smsNumberSid`; tables `NotificationPhone`, `PhoneVerification`,
`SmsMessage`, `SmsOptOut`, `PlatformIntegration` (the admin's encrypted
Twilio settings, key "twilio"). Applied to production by hand before the
deploy.

## Files

`src/lib/sms/format.ts` (pure words), `send.ts` (rules, office, worker,
overnight flush), `crew.ts` (assignment, move, cancel, digests, the hourly
tick); `src/actions/sms.ts` (verify, extras, test); hooks in
`src/lib/notify.ts`, the decline and revert routes,
`src/lib/changeOrders/send.ts`, `src/actions/appointments.ts`,
`src/actions/jobs.ts`, `src/actions/workers.ts`; webhooks under
`src/app/api/twilio/sms`; cron `src/app/api/cron/sms-crew`. QA:
`scripts/qa/sms.check.ts`.

## Open

- Invoice-paid and payment-due texts to clients.
- Billing the overage and the own-number cost through Stripe automatically
  (today: counts in the table, the note in the card).

## The crew on site (2026-09-27)

Work started, a crew back for another day, the job done, and the first
photos or video of a batch text the owner and the manager; the owner sets
who gets which texts on Settings → Texting. See `docs/crew-onsite.md`.

## Who gets texted, person by person (2026-09-29)

Owner: "I just add their name and phone number and the list of what they will receive… for sales most of it is appointments or their proposal sold, for installers when they get the job or we reschedule it." Settings → Texting (desk and handheld, one component: `src/components/v3/texting-people/`) lists every member who can be texted in three rosters, by role (`audienceForRole`):

| Roster | Roles | What they can get (Text seed on unless noted) |
|---|---|---|
| Office | OWNER, ADMIN, MANAGER, ACCOUNTANT | New lead · Proposal accepted · Proposal declined (off) · Payment received · Change order answered · Appointment booked · Appointment moved or cancelled · Job scheduled · Crew on site · Job completed · Photos & videos · Worker responded (off) |
| Sales & estimators | SALES, ESTIMATOR | Only their own: lead assigned to them · their proposal accepted / declined · payment (off) / change order (off) / job completed (off) on their deal · visits they booked or are staffed on (booked, moved, cancelled) · their job scheduled |
| Crew | INSTALLER | Put on a job · Job moved or cancelled · Tomorrow's list 6 PM · Today's list 7 AM |

- Each person: their mobile (verified by them, or **typed in by the office** — `setMemberMobile`, which sends the welcome text with the STOP line and writes a TEAM trail row; `smsAddedBy` in the prefs blob), Change / Stop texts, a number on file with texting off gets "Text this number", and one switch per event (`setMemberTextEvents`, only keys of their roster). Under each roster, "What the texts say" shows every text with sample facts (`PrefEventMeta.example`).
- A crew member's number is `WorkerProfile.phone` + `smsOptIn` (the Workers sheet box and this page write the same fields); their switches live in their own `User.notificationPrefsJson` under `crew-*` keys (`CREW_TEXT_EVENTS`, kept out of the Notifications matrix; `mergeMatrixSave` keeps them).
- Targeting: `textOffice(org, key, line, { alsoUserIds })` texts the office by role plus named members (the proposal's `ownerId`, the lead's `assignedToId`, the appointment's `createdById` and staffed members), each through their own cells, never the actor, and **only for keys on their own roster** (a crew member named on a visit gets the crew's text, not the office's).
- New texts (`src/lib/sms/schedule.ts`, words in `format.ts`): `Booked: Roof inspection · Sarah Mitchell · Wed Oct 7, 9 AM–10 AM · 18412 92nd Ave NE · online.` / `Moved: … — was Wed Oct 7, 9 AM, now Fri Oct 9, 1 PM–2 PM.` / `Cancelled: … — Fri Oct 9, 1 PM–2 PM, by the client.` / `Scheduled: "<job>" — Tue Oct 13, 8 AM–4 PM at 18412 92nd Ave NE. <link>`. Hooks: `createAppointment`, `updateAppointment` (a real move / a cancel), `deleteAppointment`, `rescheduleAppointment`, online `createBooking` / `rescheduleBooking` / `cancelBooking`, `createJob` with a date, `createJobFromProposal`, `scheduleJobFromTray`.
- No schema change.

## Your own texts (2026-09-29)

Owner: "make option for user to create new text situation by themselves." Settings → Texting → **Your own texts** (desk and handheld, `components/v3/texting-people/text-rules.tsx`): a list of the company's texts (on/off switch, Edit, Delete with a second tap), eight ready-made ideas, and an editor — **When** (17 moments; four are timed: hours before an appointment, hours before a crew day, days with no answer on a proposal, days after a job), **Who** (the client, owner & managers, the rep on it, the crew on it, plus named people), **The text** with `{fields}` chips (`{client} {first} {company} {phone} {job} {when} {address} {total} {amount} {rep} {link} {note}` — only the ones the moment can fill), a live "How it reads" preview for the client and for the team, and "Send me a test".

- Catalog, fields, ideas, renderer: `src/lib/sms/textRules.ts` (pure). Sends: `src/lib/sms/rulesEngine.ts` — `fireTextRules(trigger, context)` from the hooks, `runTimedTextRules(now)` from the hourly `/api/cron/sms-crew`. Actions: `src/actions/textRules.ts` (save/switch/delete/test, managers only, trail rows). Table `TextRule` (additive, no relations).
- Rules: clients only when Text clients is on, always signed with the company (once — not when the words already name it) and the STOP line; client texts never 9 PM–8 AM, team texts never 8 PM–7 AM (they wait); a delayed text that would land at night waits for the morning; the person who clicked is not texted; a rule says a thing once per proposal / visit / job day (`SmsMessage.kind = rule:<rule>:<thing>`); held rule texts are never folded into the overnight digest. Up to 30 texts per company, 300 characters each.
- Hooks: new lead, proposal sent / first opened / accepted / declined, payment, change order answered, appointment booked / moved / cancelled, job scheduled / started / completed (+ days after).

## One number for calls and texts (2026-10-13)

Owner: "use the same phone number for SMS and voice … voice gets no approval and they get the number to use right away; for SMS you have to wait for the approval." The number `lib/sms/registration` buys is wired for calls at purchase (`voiceUrl` → `/api/twilio/voice`, `SmsRegistrationState.voiceOnAt`; a number bought earlier is wired on its next status check); texting still waits for the toll-free verification. No schema change:

- `src/lib/aiDesk/numbers.ts` — the index `SyncState voicenum:<E.164>` → organizationId (written at purchase, removed on release) and the desk settings `SyncState aidesk:<orgId>` (`lib/aiDesk/shared.ts`: `mode` ANSWER | FORWARD, default ANSWER).
- `src/lib/aiDesk/calls.ts` — which company a call is for (the number dialed; JobFlex's own line falls back to the first company, as before) and what it gets: the assistant (today's greeting + recording + transcript + summary, the greeting names the company) when the Phone page is on the plan and under its monthly calls; else — and in FORWARD — the company phone rings (`forwardTwiml`, the caller's number as caller ID), and `/api/twilio/voice/dial` hangs up a finished conversation or hands a missed one to the assistant. A plan without the assistant never hears "we can't take your call" while the company has a phone.
- Settings → Texting: the card is "Your number"; under the number two lines say what it does now — Calls (assistant / rings the company phone / nowhere to send them / not wired) and Texts (waiting for approval / on / sent back / not sent). The overview's number step says the same.
- Checks: `scripts/qa/sms.check.ts` (+6), `scripts/qa/ai-desk-route.check.ts` (data-level, against a copy of a stand DB).
- Cost: a forwarded call is two Twilio legs (inbound toll-free ~2.2¢/min + outbound ~1.4¢/min), on JobFlex's account.

## Who activates what — and every failure in words (2026-10-14)

The owner typed his mobile on Settings → Texting in production and got "Minified React error #441" on the roster and "Phone texts are set up in Settings, which your role doesn't open" on the Your-mobile card — as the owner. Both were thrown guard errors reaching the browser: `startPhoneVerification` caught every `UnauthorizedError` (a run-out session included) and blamed the role; `setMemberMobile` let its throw through, and a production build hides the message. Fixed and made one flow:

- **`lib/sms/actionGuard.ts`** — `guardSms(fn)` wraps all 17 actions in `actions/sms.ts` (the exported names are thin wrappers over `…Inner`): a thrown `UnauthorizedError` with no message / "Session expired" → "Your sign-in has run out. Refresh the page and sign in again — nothing was changed."; "Your role doesn't open this page" / "Manager access required" / "Owner access required" → "Only the office — owner, admin or manager — can change texting…"; `NoOrgError` → "Sign in to a company first."; `TrialEndedError` / `RateLimitError` keep their sentence; anything else → "Something failed on our side…" plus a `[sms] action failed:` server log line. The browser's own words for an action that never answered as one — "An unexpected response was received from the server", "Minified React error #441", "Server Components render", a `NEXT_REDIRECT` digest — map to "JobFlex couldn't reach your sign-in. Refresh the page — sign in again if it asks — then try once more." The same sentence now comes out of `settings-blueprint/ui.actionError`, which every settings card uses. Pure, pinned in `scripts/qa/sms.check.ts` (80 checks).
- **One way in for the office's own mobile.** The roster row marked `data-me` (yours) opens a code editor — Your mobile → "Text me a code" → the six digits → Verify, with the consent line and the Terms / Privacy links (`startPhoneVerification` / `confirmPhoneVerification`; the code is the consent). Everyone else's row is typed in by the office (`setMemberMobile` → welcome text with the STOP line; the editor says so). The separate "Your mobile" card (`MobileCard` on the desk, the `mineTitle` card on the handheld page) now shows only to someone who cannot manage texting. A number that is kept but switched off offers a primary "Text this number" (`data-texting-turn-on` → `setMemberTextsOn`) beside the switch.
- **Order and words.** Texting pane: overview → 1 · Your number → 2 · Your team → Also text (extra office numbers, now right under the team) → 3 · Text clients → 4 · Your own texts → Lead texts from JobFlex. Settings renders every pane in one scroll, so the AI desk sits right under Texting — each pane now carries a line under its title (`RailItem.sub` → `.pane-s`): Texting "The texts your company sends — from your own number…", AI desk "Calls to that same number, answered for you. Texts are set up under Texting — the desk does not send any." The desk's step 1 says the same.
- **Walk** `$SP/sms/walk.js` on the :3495 stand: both flows, off → "Text this number" → on, the production failure itself (cookies cleared under the open page → the sign-in sentence, not #441), phone width, the handheld page without the duplicate card.

## The line JobFlex lent for calls, and where the code went (2026-10-14, later)

The owner's next screenshot: Texting still said "Not requested yet — Get your number" while the AI desk already answered on a number, and "Text me a code" showed nothing near the row (the code never arrived; he had typed 424… where the row below carried 425…).

- **One number, two readers.** A company's number comes only from `lib/sms/registration` (bought + registered, voice wired). The AI desk also answers a line the platform admin assigned on /admin/health (`voicenum:<E.164>` in SyncState, `lib/aiDesk/numbers.numbersAssignedTo`) — JobFlex's own line, lent. Texting ignored that line. Now `SmsRegistrationView.assigned` carries it (`number`, `jobflexOwn` = it is JobFlex's approved sender, `registrable` = toll-free and not JobFlex's own), and the number card, the overview's step 1 and the desk's step 1 say the same thing: calls come to it today; texts need a number registered in the company's name. JobFlex's own sender can never carry a company's texts (one verification per number, and `send.ts` blocks the shared number) → "Get your own number for texts". A spare toll-free line → "Register this number for texts": `submitRegistration` takes it as it is (looks the number up on the account, points its sms/voice URLs, files the verification) instead of buying a second one. A local line → get your own (toll-free verification needs a toll-free number). Pure words in `registrationShared.assignedLineWords`, pinned in `scripts/qa/sms.check.ts`.
- **The code's feedback is on the row.** The roster's note/error used to render at the bottom of the roster, out of sight on a long team; now each answer lands on the row that asked (`data-row-message`). At the code stage the editor says "We texted (425) 772-6588." with "Not your number? Change it", a "Send again" button, and the hint that the code comes from a Twilio number, not the company's — check the area code. In production a missing Twilio now answers "JobFlex's texting isn't switched on yet…" instead of inventing a code only a log would hold.
- **Stand:** lend a line with `insert into SyncState(key,cursor,updatedAt) values('voicenum:+18005550123','<orgId>',<ms>)`; make it JobFlex's own with `twilio:jobflex-sender` = the same number (fresh `updatedAt`, read for an hour). The verification limiter (5/hour/user) counts in the dev server's memory as well as SyncState `rl:sms-verify:<userId>` — a restart clears it. Walk `$SP/sms/walk2.js`.

### JobFlex's own company texts from the JobFlex line (2026-10-14, the owner: "the account I am is the admin account — we are testing here")

`lib/sms/houseLine.houseLineFor(orgId)` recognises JobFlex's own company — never configured, always derived: a platform admin owns or administers it (Membership OWNER/ADMIN with `User.isPlatformAdmin`) AND JobFlex's own approved sender (`jobflexSender`) is lent to it on /admin/health (the `voicenum:` index). For that company `send.ts` falls back to the house line when it has no registered number, so its team, client and rule texts really leave from the JobFlex number — it IS the business that number is registered to, so no ISV problem. `SmsRegistrationView.assigned.house` makes the card say "sending — texts to your team and clients go out from it", the overview's step 1 read approved, the desk's step 1 say the line carries calls and texts, and `SmsSettingsData.ownNumber` carry it. Every other company with a lent JobFlex line still reads "Get your own number for texts" and its texts are SKIPPED `no-number`. Walk `$SP/sms/walk3.js` proves both on the stand through the SmsMessage row (`no-number` vs `not-configured`); the stand's owner is a platform admin, so walks that want a plain company flip `User.isPlatformAdmin` off and back.
