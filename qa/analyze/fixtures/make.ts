// Writes the analyser's three self-test runs (npx tsx qa/analyze/fixtures/make.ts):
//   green/         — every test passes
//   signup-code/   — the sign-up breaks at the code step: the server action answers 500
//   api-cascade/   — one API (500) brings down twelve dashboard pages; plus one a11y warning
// Each folder: raw.json (the reporter's format, lib/raw.ts) and expected.json (what
// npm run qa:selftest asserts). Edit this file, not the JSON.
import fs from "node:fs";
import path from "node:path";
import { SCHEMA, type RawRun, type RawTest } from "../../lib/raw";
import { emptyCollected } from "../../lib/collect";

const T0 = Date.parse("2026-10-14T20:00:00Z");
let n = 0;
function test(p: Partial<RawTest> & { title: string; suite: string; file: string }): RawTest {
  n++;
  return {
    id: `fixture-${String(n).padStart(3, "0")}`, titlePath: ["chromium", p.file, p.title], line: 10 + n, project: "chromium", tags: [`@${p.suite}`],
    status: "passed", expectedStatus: "passed", outcome: "passed", durationMs: 1500, retry: 0, startedAt: new Date(T0 + n * 2000).toISOString(),
    annotations: [], errors: [], steps: [{ title: "open", category: "test.step", startMs: 0, durationMs: 1200 }],
    collected: { ...emptyCollected(), navigations: [{ t: T0 + n * 2000 + 300, url: "http://localhost:3005/", ttfbMs: 80, domContentLoadedMs: 300, loadMs: 600, transferKb: 40, status: 200, step: "open" }] },
    artifacts: {}, meta: {},
    ...p,
  } as RawTest;
}
function run(id: string, tests: RawTest[]): RawRun {
  const c = (l: RawTest[]) => ({ total: l.length, passed: l.filter((t) => t.outcome === "passed").length, failed: l.filter((t) => t.outcome === "failed").length, skipped: l.filter((t) => t.outcome === "skipped").length, flaky: 0 });
  const bySuite: RawRun["stats"]["bySuite"] = {};
  for (const s of [...new Set(tests.map((t) => t.suite))]) bySuite[s] = c(tests.filter((t) => t.suite === s));
  return {
    schema: SCHEMA,
    run: { id, startedAt: new Date(T0).toISOString(), finishedAt: new Date(T0 + 600_000).toISOString(), durationMs: 600_000, baseUrl: "http://localhost:3005", target: "local", suites: ["all"], grep: null, projects: ["chromium", "webkit"], git: { commit: "fixture", branch: "main", dirty: false }, playwright: "1.64.1", node: "v24", status: tests.some((t) => t.outcome === "failed") ? "failed" : "passed", setup: [{ role: "owner", ok: true, note: "fixture" }], notes: [] },
    stats: { ...c(tests), bySuite },
    tests,
  };
}
const fail = (message: string, file: string, line = 40): Partial<RawTest> => ({ status: "failed", outcome: "failed", errors: [{ message, stack: `Error: ${message}\n    at ${file}:${line}:9`, location: { file, line, column: 9 } }] });

// ── green ──────────────────────────────────────────────────────────────────
n = 0;
const green = run("2026-10-14T20-00-00", [
  ...["/", "/pricing", "/auth/login", "/auth/register"].map((r) => test({ title: `${r} opens @smoke`, suite: "smoke", file: "qa/tests/smoke/smoke.spec.ts", meta: { route: r, role: "guest" } })),
  ...["/dashboard", "/dashboard/proposals", "/dashboard/projects", "/dashboard/financials"].map((r) => test({ title: `${r} as owner @pages`, suite: "pages", file: "qa/tests/pages/pages.spec.ts", meta: { kind: "page", route: r, role: "owner", coldMs: 2100, warmMs: 900, layout: { scrollX: false, docWidth: 390, outside: [] }, brokenLinks: [], axe: [] } })),
  test({ title: "access /dashboard @roles", suite: "roles", file: "qa/tests/roles/access.spec.ts", meta: { kind: "access", route: "/dashboard", cells: { guest: "login", owner: "open" }, expected: { guest: "login", owner: "open" }, review: [] } }),
  test({ title: "legacy logic/deck-engine.check.ts @logic @legacy", suite: "logic", file: "qa/tests/legacy.spec.ts" }),
]);

// ── signup breaks at the code step ─────────────────────────────────────────
n = 0;
const actionFail = (t: number) => ({ t, status: 500, method: "POST", url: "http://localhost:3005/auth/register?flow=otp", resourceType: "fetch", sameOrigin: true, page: "http://localhost:3005/auth/register?flow=otp&d=•••", body: "Internal Server Error", step: "the emailed code" });
const signupTests = [
  test({ title: "code → plan step: the address is proven and the intent kept @signup @webkit", suite: "signup", file: "qa/tests/signup/signup.spec.ts" }),
  test({ title: "code → plan step: the address is proven and the intent kept @signup @webkit", suite: "signup", file: "qa/tests/signup/signup.spec.ts", project: "webkit" }),
  test({ title: "plan → test card 4242 → dashboard: company, owner seat and trial are right @signup @writes", suite: "signup", file: "qa/tests/signup/signup.spec.ts" }),
];
for (const t of signupTests) {
  Object.assign(t, fail("Error: expect(locator).toBeVisible() failed\nLocator: locator('section.plan-sheet.is-in')\nExpected: visible\nTimeout: 60000ms", "qa/lib/signup.ts", 37));
  t.collected.httpErrors.push(actionFail(T0 + 5000));
  t.collected.console.push({ t: T0 + 5100, type: "error", text: "Failed to load resource: the server responded with a status of 500 (Internal Server Error)", url: "http://localhost:3005/auth/register?flow=otp", step: "the emailed code" });
  t.steps = [{ title: "name and email", category: "test.step", startMs: 0, durationMs: 3000 }, { title: "the emailed code", category: "test.step", startMs: 3000, durationMs: 61000, error: "expect(locator).toBeVisible() failed" }];
}
const signup = run("2026-10-14T20-10-00", [
  ...signupTests,
  test({ title: "a wrong code is refused and says how many tries are left @signup", suite: "signup", file: "qa/tests/signup/signup.spec.ts" }),
  test({ title: "Google is offered on sign-up and sign-in, and goes to Google @signup", suite: "signup", file: "qa/tests/signup/signup.spec.ts" }),
  test({ title: "home page opens with its headline @smoke @webkit", suite: "smoke", file: "qa/tests/smoke/smoke.spec.ts" }),
]);

// ── one API error, twelve pages down ───────────────────────────────────────
n = 0;
const routes = ["/dashboard", "/dashboard/proposals", "/dashboard/projects", "/dashboard/financials", "/dashboard/clients", "/dashboard/leads", "/dashboard/jobs", "/dashboard/calendar", "/dashboard/messages", "/dashboard/reports", "/dashboard/reviews", "/dashboard/referrals"];
const cascade = routes.map((r) => {
  const t = test({ title: `${r} as owner @pages`, suite: "pages", file: "qa/tests/pages/pages.spec.ts", meta: { kind: "page", route: r, role: "owner", path: r, realParams: true, coldMs: 2600, warmMs: 1100, layout: { scrollX: false, docWidth: 390, outside: [] }, brokenLinks: [], axe: [] } });
  Object.assign(t, fail(`Error: 4xx/5xx from this server\n\nexpect(received).toEqual(expected)\n- []\n+ ["500 GET http://localhost:3005/api/notifications/summary?org=cmv5jpweq006fyu23ed0f0hip"]`, "qa/tests/pages/pages.spec.ts", 58));
  t.collected.httpErrors.push({ t: T0 + 4000, status: 500, method: "GET", url: "http://localhost:3005/api/notifications/summary?org=cmv5jpweq006fyu23ed0f0hip", resourceType: "fetch", sameOrigin: true, page: `http://localhost:3005${r}`, body: '{"error":"PrismaClientKnownRequestError: column does not exist"}', step: `open ${r}` });
  t.collected.console.push({ t: T0 + 4100, type: "error", text: "Failed to load resource: the server responded with a status of 500 (Internal Server Error)", url: `http://localhost:3005${r}`, step: `open ${r}` });
  return t;
});
const a11y = test({ title: "/pricing as guest @pages", suite: "pages", file: "qa/tests/pages/pages.spec.ts", meta: { kind: "page", route: "/pricing", role: "guest", coldMs: 1500, warmMs: 700, layout: { scrollX: false, docWidth: 390, outside: [] }, brokenLinks: [], axe: [{ id: "color-contrast", impact: "serious", help: "Elements must meet minimum color contrast ratio thresholds", nodes: 3, sample: [".plan small"] }] } });
const api = run("2026-10-14T20-20-00", [...cascade, a11y, test({ title: "home page opens with its headline @smoke @webkit", suite: "smoke", file: "qa/tests/smoke/smoke.spec.ts" })]);

// ── the rules of 2026-10-15: one root = one finding, expected statuses, test-side timeouts ──
n = 0;
const noOrgBody = '0:{"a":"$@1","f":"","q":"","i":true,"b":"development"}\n1:D"$2"\n1:E{"digest":"848584365","name":"NoOrgError","message":"No active organization","stack":[["resolveOrg","C:\\\\Projects\\\\x\\\\.next\\\\server.js",138,19]]}';
const admin = ["/dashboard", "/dashboard/jobs/new", "/dashboard/settings"].map((r) => {
  const t = test({ title: `${r} as admin @pages`, suite: "pages", file: "qa/tests/pages/pages.spec.ts", meta: { kind: "page", route: r, role: "admin", path: r, realParams: true, coldMs: 1200, warmMs: 800, layout: { scrollX: false, docWidth: 390, outside: [] }, brokenLinks: [], axe: [] } });
  Object.assign(t, fail("Error: 4xx/5xx from this server", "qa/tests/pages/pages.spec.ts", 72));
  t.collected.httpErrors.push({ t: T0 + 3000, status: 500, method: "POST", url: `http://localhost:3005${r}`, resourceType: "fetch", sameOrigin: true, page: `http://localhost:3005${r}`, body: noOrgBody });
  t.collected.console.push({ t: T0 + 3100, type: "error", text: "Failed to load resource: the server responded with a status of 500 (Internal Server Error)", url: `http://localhost:3005${r}` });
  t.collected.console.push({ t: T0 + 3200, type: "error", text: "[route-error] 946371773 NoOrgError: No active organization\n    at resolveOrg (about://React/Server/C:%5CProjects%5Cx%5C.next/server.js:138:19)", url: `http://localhost:3005${r}` });
  return t;
});
// a passing visual test that only SAW the same error: no finding of its own
const seenOnly = test({ title: "/dashboard/clients at 390 as admin @visual", suite: "visual", file: "qa/tests/visual/visual.spec.ts", meta: { kind: "visual", route: "/dashboard/clients", role: "admin" } });
seenOnly.collected.console.push({ t: T0 + 3300, type: "error", text: "%o %s NoOrgError: No active organization at resolveOrg (about://React/Server/C:%5CProjects%5Cx)", url: "http://localhost:3005/dashboard/clients" });
// the smoke check that visits an unknown address on purpose
const four04 = test({ title: "an unknown address answers 404 @smoke @expects-404", suite: "smoke", file: "qa/tests/smoke/smoke.spec.ts", tags: ["@smoke", "@expects-404"], meta: { expectStatus: [404] } });
four04.collected.httpErrors.push({ t: T0 + 4000, status: 404, method: "GET", url: "http://localhost:3005/qa-no-such-page-1", resourceType: "document", sameOrigin: true, page: "http://localhost:3005/qa-no-such-page-1" });
four04.collected.console.push({ t: T0 + 4001, type: "error", text: "Failed to load resource: the server responded with a status of 404 (Not Found)", url: "http://localhost:3005/qa-no-such-page-1" });
// a signup test that could not find the card field: the test's selector — P2, not P0
const cardMiss = test({ title: "plan → test card 4242 → dashboard: company, owner seat and trial are right @signup @writes", suite: "signup", file: "qa/tests/signup/signup.spec.ts" });
Object.assign(cardMiss, fail("TimeoutError: locator.fill: Timeout 60000ms exceeded.\nCall log:\n  - waiting for locator('#cardNumber')", "qa/lib/signup.ts", 61));
cardMiss.errors[0].stack = "TimeoutError: locator.fill: Timeout 60000ms exceeded.\n    at payWithTestCard (C:\\Projects\\JobFlex-v3-copy\\qa\\lib\\signup.ts:61:40)";
// a hydration error on /auth/register that failed nothing: P2
const hydr = test({ title: "leaving the code screen and coming back keeps the address @signup @webkit", suite: "signup", file: "qa/tests/signup/signup.spec.ts", project: "webkit" });
hydr.collected.pageErrors.push({ t: T0 + 5000, message: "Hydration failed because the server rendered text didn't match the client.\n  <RegisterContent>\n    <ReferralBanner>", url: "http://localhost:3005/auth/register?flow=otp" });
const rules = run("2026-10-15T09-00-00", [...admin, seenOnly, four04, cardMiss, hydr]);

const EXPECTED = {
  green: { failedTests: 0, findings: [] as unknown[] },
  rules: {
    failedTests: 4,
    findings: [
      { kind: "api-error", severity: "P1", tests: 4, signature: "root NoOrgError @ resolveOrg", location: "src/lib/orgContext.ts" },
      { kind: "timeout", severity: "P2", tests: 1, signature: "timeout qa/tests/signup/signup.spec.ts", location: "qa/lib/signup.ts" },
      { kind: "page-error", severity: "P2", tests: 1, signature: "page-error Hydration failed" },
    ],
  },
  "signup-code": { failedTests: 3, findings: [{ kind: "api-error", severity: "P0", tests: 3, signature: "server-action 500" }] },
  "api-cascade": { failedTests: 12, findings: [{ kind: "api-error", severity: "P1", tests: 12, signature: "api 500 GET /api/notifications/summary" }, { kind: "a11y", severity: "P3", tests: 1, signature: "a11y color-contrast" }] },
};

for (const [name, raw] of [["green", green], ["signup-code", signup], ["api-cascade", api], ["rules", rules]] as const) {
  const dir = path.join(__dirname, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "raw.json"), JSON.stringify(raw, null, 1));
  fs.writeFileSync(path.join(dir, "expected.json"), JSON.stringify(EXPECTED[name], null, 1));
  console.log(`${name}: ${raw.tests.length} tests`);
}
