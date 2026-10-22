// WHAT LEAVES FOR SENTRY (2026-10-22) — one rule for the server, edge and
// browser SDKs (src/sentry.server.config, src/sentry.edge.config,
// src/instrumentation-client): what the SDK may collect at all
// (SENTRY_DATA_COLLECTION, SDK 11's successor to `sendDefaultPii`), and what
// beforeSend strips on top — request bodies, query strings, cookies, every
// header but the user agent, the user, and any email address or US-shaped
// phone number in a message, an exception's text or a breadcrumb. URLs keep
// their path only. Client-safe: no server imports.
import type { Breadcrumb, Event, init } from "@sentry/nextjs";

type DataCollection = NonNullable<NonNullable<Parameters<typeof init>[0]>["dataCollection"]>;

const EMAIL = /[^\s@"'<>()/:,;]+@[^\s@"'<>()/,;]+\.[a-z]{2,}/gi;
/* 10 digits in the usual groupings, an optional +1 before them. It also takes
   a bare ten-digit number (an epoch second), which a message can do without. */
const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

/**
 * What the SDK may collect at all. SDK 11 replaced `sendDefaultPii` with this
 * table, and its defaults collect everything — user fields, cookies, every
 * header, bodies, query strings, local variables. Here: none of it, except the
 * user agent and five lines of source around a frame. `beforeSend` below is
 * the second net.
 */
export const SENTRY_DATA_COLLECTION: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { allow: ["user-agent"] }, response: false },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  frameContextLines: 5,
};

export function scrubText(text: string): string {
  return text.replace(EMAIL, "[email]").replace(PHONE, "[phone]");
}

/** The path of a URL, without its query string or fragment. */
export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut < 0 ? url : url.slice(0, cut);
}

function scrubUrlFields(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  for (const key of ["url", "from", "to", "http.url"]) {
    const v = data[key];
    if (typeof v === "string") data[key] = scrubText(stripQuery(v));
  }
  delete data["http.query"];
  delete data["http.fragment"];
}

export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  if (crumb.message) crumb.message = scrubText(crumb.message);
  scrubUrlFields(crumb.data);
  // A console breadcrumb carries the logged arguments themselves.
  if (crumb.category === "console" && crumb.data) delete crumb.data.arguments;
  return crumb;
}

export function scrubEvent<E extends Event>(event: E): E {
  const req = event.request;
  if (req) {
    delete req.data;
    delete req.query_string;
    delete req.cookies;
    delete req.env;
    if (req.url) req.url = stripQuery(req.url);
    const ua = req.headers?.["user-agent"] ?? req.headers?.["User-Agent"];
    req.headers = ua ? { "user-agent": ua } : {};
  }
  delete event.user;
  delete event.server_name;
  if (event.message) event.message = scrubText(event.message);
  if (event.transaction) event.transaction = stripQuery(event.transaction);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value);
    // The source lines around a frame (contextLinesIntegration) are code, but code can quote an address too.
    for (const f of ex.stacktrace?.frames ?? []) {
      if (f.context_line) f.context_line = scrubText(f.context_line);
      if (f.pre_context) f.pre_context = f.pre_context.map(scrubText);
      if (f.post_context) f.post_context = f.post_context.map(scrubText);
    }
  }
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  const nextCtx = event.contexts?.nextjs as Record<string, unknown> | undefined;
  if (nextCtx && typeof nextCtx.request_path === "string") nextCtx.request_path = stripQuery(nextCtx.request_path);
  for (const span of event.spans ?? []) scrubUrlFields(span.data as Record<string, unknown> | undefined);
  return event;
}

const URLISH = /(^|\.)(url|full|target|route|path|query|fragment)$|^http\.|^url\./;

/** A streamed span (the SDK's default trace lifecycle — `beforeSendSpan`): its
 *  name and URL attributes keep their path only; query and fragment go. */
export function scrubSpan<S extends { name: string; attributes?: Record<string, unknown> }>(span: S): S {
  span.name = scrubText(stripQuery(span.name));
  const attrs = span.attributes;
  if (!attrs) return span;
  for (const key of Object.keys(attrs)) {
    if (/(^|\.)(query|fragment)$/.test(key)) {
      delete attrs[key];
      continue;
    }
    if (!URLISH.test(key)) continue;
    const v = attrs[key];
    if (typeof v === "string") attrs[key] = scrubText(stripQuery(v));
    else if (v && typeof v === "object" && typeof (v as { value?: unknown }).value === "string") {
      (v as { value: string }).value = scrubText(stripQuery((v as { value: string }).value));
    }
  }
  return span;
}

/** Where the event came from: "production", "preview", "development" (Vercel), else "local". */
export function sentryEnvironment(vercelEnv: string | undefined): string {
  return vercelEnv || "local";
}

/** 5% of production traces, none anywhere else. */
export function sentryTracesSampleRate(vercelEnv: string | undefined): number {
  return vercelEnv === "production" ? 0.05 : 0;
}
