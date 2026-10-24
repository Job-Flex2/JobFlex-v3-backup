# Sentry — error stacks for production

Added 2026-10-22. PostHog already gets a `server_error` event for every server
error, with the route, the kind and the organization. That event carries no
message and no stack. Sentry is where the stack goes, so an error can be traced
to a line of code.

## What is wired

| Where | File | What it does |
| --- | --- | --- |
| Node server | `src/sentry.server.config.ts` | `Sentry.init`, loaded by `src/instrumentation.ts` `register()` |
| Edge runtime | `src/sentry.edge.config.ts` | the same, for edge code |
| Browser | `src/instrumentation-client.ts` → `src/lib/sentryClient.ts` | starts the SDK after the page has loaded (idle, or 3 s at most) and passes App Router navigations to Sentry; only the calls named in `src/lib/sentryBrowser.ts` are bundled — no replay, no feedback widget |
| Server errors | `src/instrumentation.ts` `onRequestError` | `Sentry.captureRequestError`, next to the existing PostHog event |
| Client errors | `src/app/error.tsx`, `src/app/global-error.tsx` | `captureException` through `captureClientException` |
| Privacy | `src/lib/sentryScrub.ts` | `beforeSend`, `beforeSendSpan` and `beforeBreadcrumb` for all three runtimes |
| Source maps | `next.config.ts` | `withSentryConfig`, only when `SENTRY_AUTH_TOKEN` is set |

**Without a DSN nothing starts.** `register()` returns early, the browser
never downloads the SDK, `onRequestError` sends only the PostHog event, and
the build is the same as before.

**What is never sent.** SDK 11 has no `sendDefaultPii`. It was replaced by
`dataCollection`, whose defaults collect everything. `SENTRY_DATA_COLLECTION`
in `lib/sentryScrub` turns all of it off: user fields, cookies, headers except
the user agent, bodies, query strings, GraphQL and AI payloads, database values
and local variables. On top of that, `beforeSend` removes:

- request bodies, query strings and cookies;
- every header except the user agent;
- the user and the server name;
- query strings and fragments from every URL, in breadcrumbs and spans too;
- the logged arguments from console breadcrumbs;
- email addresses and US-format phone numbers in messages, exception text and
  breadcrumbs. They are replaced with `[email]` and `[phone]`.

**Tags.** Server errors are tagged with:

- `route`: the file path, such as `/dashboard/proposals/[id]`;
- `route_type`;
- `organizationId`;
- `vercel_env`.

Browser errors are tagged with `boundary`, `route` (the page path, without the
query) and `vercel_env`. The environment is `VERCEL_ENV`, or `local` when it is
unset.

**Tracing.** 5% of requests are traced on production, none on preview. There
is no Session Replay.

## Vercel environment variables

Set these in Vercel → Project → Settings → Environment Variables. Tick both
**Production** and **Preview** unless the table says otherwise.

| Variable | Value | Notes |
| --- | --- | --- |
| `SENTRY_DSN` | the project's DSN | read by the server and edge |
| `NEXT_PUBLIC_SENTRY_DSN` | the same DSN | built into the browser bundle, so redeploy after changing it |
| `SENTRY_AUTH_TOKEN` | an organization auth token | build only, for the source-map upload. Mark it **Sensitive**. Never give it a `NEXT_PUBLIC_` name |
| `SENTRY_ORG` | the organization slug | from the Sentry URL: `sentry.io/organizations/<slug>/` |
| `SENTRY_PROJECT` | the project slug | for example `jobflex` |

The browser reads `NEXT_PUBLIC_VERCEL_ENV` to name the environment. Vercel
provides it when "Automatically expose System Environment Variables" is on,
which is the default.

To keep preview errors out of Sentry, set the two DSNs for Production only.
Preview then sends nothing.

## Where to get them

1. Sign up at sentry.io and create a project with the **Next.js** platform.
   Skip the wizard's code: everything is already in the repo, so do not run
   `npx @sentry/wizard`.
2. **DSN:** Project → Settings → Client Keys (DSN). The DSN is public by design
   and can appear in the browser bundle.
3. **Auth token:** Settings → Developer Settings → Organization Tokens →
   Create. The default scopes are enough to upload source maps.
4. Redeploy. The build log shows the source-map upload only when the token is
   set.

To check it works, use a preview deployment with the DSN set. A thrown server
action, or `/dev/throw` and `/dev/throw?server=1` in local dev, should appear in Sentry within a
minute. Its stack should be readable, with no cookie, body or query in it.

## Cost and limits

These figures are from third-party summaries of Sentry's pricing, read
2026-10-22. Confirm them at <https://sentry.io/pricing/> before choosing a
plan.

- **Developer (free):** 1 user, 5,000 errors a month, about 5M spans of
  tracing and 50 replays (we use none), and email alerts.
- **Team:** about $26 a month, billed yearly, with 50,000 errors and more
  users. Pay-as-you-go budget on top.
- **Counting:** every captured event counts, including repeats of the same
  issue. When the month's quota runs out, events are dropped until the next
  month. Nothing else breaks.

Limits to watch, under Stats in Sentry:

- **Errors per day against the monthly quota.** One error in a render loop can
  use the free month in an hour. Set **Settings → Spike Protection** (on by
  default) and, if needed, a rate limit per DSN under Client Keys → Rate
  limits, for example 500 per hour.
- **Spans.** At 5% of production, normal traffic stays well inside 5M. If it
  gets close, lower `tracesSampleRate` in `lib/sentryScrub`
  (`sentryTracesSampleRate`).
- **Seats.** The free plan has one user. Add the team on the Team plan.

## Alerts — the proposed rule

**A new error on production → email the team.**

Set it up under Alerts → Create Alert → Issues:

- **When:** "A new issue is created". Optionally add "The issue changes state
  from resolved to unresolved" to catch regressions.
- **If:** `environment` equals `production`.
- **Then:** send a notification to the team, or to member emails on the free
  plan.
- **Action interval:** 30 minutes. A burst of one issue then sends one email.

The email has the issue title, for example `TypeError: Cannot read properties
of undefined (reading 'lat')`. It also has the culprit (file and function), the
route tag, the organization tag, the first time seen and a link to the issue
with its full stack. Repeats of a known issue send nothing until it is
resolved and comes back.

Optional second rule: "Number of events in an issue > 100 in 1 hour" on
production, to catch an old issue that suddenly floods.
