# Admin API health monitoring

Local implementation, October 19, 2026. No deployment or scheduler activation is part of this change.

## What the page proves

`/admin/integrations` retains the admin guard, Blueprint shell, provider links and Stripe mode control. It reads the stored report on render, then invokes the existing platform-admin-only server action while visible/online. No page-load Stripe balance or PostHog HogQL query remains on this page.

Each integration separates authentication, quota/trial entitlement, provider availability, and actual feature evidence. Each dimension shows its source, observation time and last successful observation when recorded. An accepted HTTP response is not proof that a stream completed, email delivered, every address is covered, or every multipack works. Credentials alone never produce a healthy label. Public endpoints and per-organization credentials are listed as available integration paths, not verified configured customer accounts.

Evidence expires after 10 minutes, including failures. Expired observations remain visible as historical details but their current status becomes Unknown. Unsupported means this monitor has no verified free probe for that dimension, not that the provider necessarily offers none. Account billing/credits/trial access usually requires the provider's dashboard. This panel cannot promise complete account health without spending credits, and intentionally does not try.

## Safe sources

Only these outbound monitoring GETs are allowed (6-second timeout, no redirects, no SDK retries):

- SerpAPI `https://serpapi.com/account.json`: the [official Account API documentation](https://serpapi.com/account-api) explicitly says it is free and does not count toward monthly quota. Only numeric balance, HTTP status and an allowlisted account state are interpreted. Account emails, API keys and response/error bodies never enter the report. A zero balance is an issue; fewer than 100 searches is limited. A 429 does not by itself prove exhausted credits.
- Twilio `https://status.twilio.com/api/v2/status.json`: [documented public status API](https://status.twilio.com/api). No credentials or SMS/voice operations. Aggregate incidents are labeled as provider-wide with unverified JobFlex impact.
- Vercel `https://www.vercel-status.com/api/v2/status.json`: [documented public status API](https://www.vercel-status.com/api), used as provider-wide evidence beside Blob. No Blob read/write/list transaction or account quota claim.

Documentation verified October 19, 2026. These are free provider probes, not a promise that hosting/database traffic has no infrastructure cost.

Existing ReportAll quota headers, Regrid response status, shared email success, SMS success and EagleView entitlement rows are read without repeating their customer operations. Email history cannot distinguish Resend from SMTP, and send history alone cannot prove current delivery health. ReportAll's below-100 reserve is shown as a paused-lookup issue only while the observation is fresh.

Passive telemetry now records numeric HTTP outcomes from normal OpenAI feature requests and the existing `externalFetch` wrapper. It stores no URLs, tokens, customer identifiers, response bodies or arbitrary exception messages. OpenAI distinguishes explicit `insufficient_quota` from generic 429 rate limiting. It cannot supply a current balance. Successful streaming response headers do not prove complete output.

For EagleView, only existing `property request`, `property result`, and `property image` traffic feeds the Property Data observation. Legacy OAuth/catalog calls are excluded. The monitor never orders multipacks or invokes diagnostics. Historical live/denied pack counts remain historical; an optional pack denial does not establish a platform-wide outage. A last-request limitation can coexist with other working packs. No pre-existing entitlement observation is relabeled as a new successful feature request.

## Inventory

The shared registry now includes the original Stripe, Stripe webhooks/Connect, Square and webhooks, Resend, SMTP, Twilio, Gmail, Google Maps/server/browser, Regrid, ReportAll, EagleView, OpenAI, SerpAPI, FAL, Blob and PostHog, plus PayPal, Stax (per-organization credentials), Meta lead import/ad-spend, Google sign-in/Solar, CoolCalc, Overpass, USGS elevation, Census/FCC geography, Nominatim, assessor ArcGIS sources, NAIP/Planetary Computer and USA Structures. Grouped public geospatial endpoints are explicitly not all probed. Static vendor catalog/document URLs are not API integrations. The payout queue warning is retained on the overview separately from provider health.

Providers without a verified safe endpoint or recent passive observation remain Unknown/Unsupported. New integrations should be added to the registry; do not add arbitrary probe URLs, OAuth refreshes, synthetic customer writes, generation, searches or report purchases.

## Scheduling and concurrency

- Browser checks: approximately five minutes while visible and online; 30-second local timer updates freshness and checks eligibility. Hidden/offline tabs do not issue checks. An in-flight guard prevents overlapping requests within a tab.
- Server: shared five-minute cooldown stored in the existing SyncState table, process-local single-flight/cache, and an atomic compare-and-set lease across instances. No provider request occurs if the shared lease cannot be acquired. A crash leaves a minimum five-minute cooldown. No force-refresh bypass is exposed.
- Failed probes: exponential backoff from 10 up to 80 minutes; visible results still expire after ten minutes. Report timestamps and next eligible time survive cold starts. A local storage failure also imposes a five-minute local retry delay; it does not trigger provider traffic.
- Existing Vercel schedule: the unchanged repository expression is `40 4 * * *`, daily at 04:40 UTC. The page says deployment execution is unverified. Cron auth still fails closed through `isCronAuthorized`; monitoring failures return a sanitized 503 with Retry-After.
- Existing nightly alert email behavior is retained. Manual/browser checks do not send alerts. No live email or cron was invoked during implementation.

For continuous monitoring when no browser is open, an owner must approve a more frequent scheduler and deployment. A possible future cadence is `*/5 * * * *` on the existing route, subject to hosting plan limits, an existing valid CRON_SECRET and shared database availability. This change does not modify vercel.json, generate credentials, or activate that cadence. Vercel deployment access was not attempted.

No schema migration is required: the versioned report, lease and passive observations use SyncState. Old reports are ignored rather than trusted. Secrets stay server-side. Session authorization runs before the shared cached result is returned.

## Validation and limits

- Targeted ESLint across changed TS/TSX files: passed.
- Strict standalone TypeScript check of the browser-safe health model: passed.
- Isolated VM checks in `/tmp/jobflex-health-check.cjs`: mocked fetch and storage only; 41 assertions cover freshness/future dates, unknown-vs-metadata, zero quota, historical EagleView, single flight, cold-start caching, active lease, storage failure, redaction, backoff, last-success retention, allowlisted telemetry, exclusion of legacy EagleView calls, and denied admin/cron auth. No provider/customer/database actions.
- Mocked React server render: 16 assertions passed for evidence disclosures, all four dimensions, quota error/unknown labels and retained sandbox controls. This is not browser/layout verification.
- `git diff --check`: passed.
- Dependencies installed with lifecycle scripts disabled and cache under `/tmp`. The initial default-cache installation failed; no cleanup commands were run.
- Prisma client generation blocked by HTTP 403 fetching the official engine checksum. No checksum bypass attempted. Full `tsc --noEmit` failed with missing generated Prisma types and cascading repository errors; it is not a passing full typecheck.
- No DATABASE_URL, local env file, authenticated admin session or browser tool was available. The actual desktop and 390×844 admin shell could not be visually verified. A real database/authenticated preview and generated Prisma client are required before deployment validation. No database setup, migration, seed, destructive QA, live credentials, payment or report operation was performed.

## Independent review and deployed writes

A separate native review agent inspected auth, free probes, redaction, freshness, polling, telemetry and concurrency. Fixed findings include overview expiry, Regrid 403 scope classification, preservation of explicit SerpAPI zero balance, swallowed payout-query failures, informational notes triggering backoff, and verified-state aggregation. Added transactional fencing so a superseded sweep cannot overwrite a newer report. Passive writes use compare-and-set and add at most 250 ms of awaited storage latency; best-effort writes may finish later or be interrupted by serverless shutdown.

When eventually deployed, this feature **does write the deployment's database**: `integrations:health`, `integrations:health-lease:v2`, and `integrations:observed:<allowlisted service>` in SyncState. The existing nightly alert can also update `integrations:health-alerted` and send its pre-existing alert email. These are monitoring metadata writes, not customer/provider transactions. No production or local database writes were executed in this task; all validation storage was mocked. Existing credential values and permissions are unchanged.

Visible-tab refresh is not ongoing background execution. Daily background checking remains the existing declared Vercel cron; deployment execution is unverified. To run every five minutes without an open page, the owner must authorize deployment and a cron cadence change, confirm plan support and existing cron authorization/database configuration. No new schedule or secret was activated.
