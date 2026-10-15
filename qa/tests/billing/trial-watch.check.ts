// Trial watch (2026-09-24): the route pattern, the sittings, the signals and
// the score that tell a tour from a company, and the watermark text. Pure,
// no database.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/billing/trial-watch.check.ts
import { domainOf, isCompetitorDomain, routePattern, scoreTrial, sessionsOf, sortAssessments, watermarkDataUri, watermarkText, type TrialIn, type ViewIn } from "../../../src/lib/trialWatch";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

check("a page view is filed under its route pattern: ids collapsed, the query dropped",
  routePattern("/dashboard/jobs/cmu7xi0z70005wlenw5bsbp6v?tab=money") === "/dashboard/jobs/*" && routePattern("/dashboard/proposals") === "/dashboard/proposals" && routePattern("/dashboard/clients/8f3b2c1d-1111-4222-8333-444455556666/edit") === "/dashboard/clients/*/edit" && routePattern("/mobile-proposals-v2/") === "/mobile-proposals-v2",
  [routePattern("/dashboard/jobs/cmu7xi0z70005wlenw5bsbp6v?tab=money"), routePattern("/dashboard/clients/8f3b2c1d-1111-4222-8333-444455556666/edit")].join(" "));
check("the public pages are not the trial's business", routePattern("/portal/q/abc") === null && routePattern("/homeowner") === null && routePattern("") === null);

const at = (min: number) => new Date(Date.UTC(2026, 8, 24, 12, min)).toISOString();
const views = (n: number, startMin = 0, step = 1): ViewIn[] => Array.from({ length: n }, (_, i) => ({ route: `/dashboard/screen-${i}`, at: at(startMin + i * step) }));
const s = sessionsOf([...views(4, 0, 3), { route: "/dashboard/jobs", at: at(200) }, { route: "/dashboard/jobs", at: at(204) }]);
check("views split into sittings at a thirty-minute gap, each with its minutes and its screens", s.length === 2 && s[0].routes.length === 4 && s[0].minutes === 9 && s[1].routes.length === 1 && s[1].minutes === 4 && s[1].views === 2, JSON.stringify(s.map((x) => [x.routes.length, x.minutes])));

const base: TrialIn = { id: "a", name: "Northwind Roofing", createdAt: at(-1000), plan: "FREE", status: "TRIALING", trialEndsAt: null, ownerEmail: "pat@northwindroofing.com", emails: ["pat@northwindroofing.com"], views: [], records: { clients: 0, proposals: 0, sent: 0, jobs: 0, leads: 0 }, sharedDeviceTrials: 0 };
const tourist = scoreTrial({ ...base, views: views(16, 0, 1) });
check("a tour — sixteen screens in sixteen minutes, nothing created — reads as toured and raced: suspicious",
  tourist.signals.some((x) => x.code === "toured") && tourist.signals.some((x) => x.code === "raced") && tourist.score === 60 && tourist.level === "suspicious", `${tourist.score} ${tourist.signals.map((x) => x.code).join(",")}`);
const competitor = scoreTrial({ ...base, emails: ["sam@jobber.com"], ownerEmail: "sam@jobber.com", views: views(5, 0, 10) });
check("a competitor's domain is a signal on its own", competitor.signals.some((x) => x.code === "competitor" && /jobber\.com/.test(x.text)) && competitor.score === 45 && competitor.level === "watch" && isCompetitorDomain("mail.servicetitan.com") && !isCompetitorDomain("gmail.com") && domainOf("A@B.co") === "b.co");
const worker = scoreTrial({ ...base, views: views(20, 0, 5), records: { clients: 3, proposals: 2, sent: 1, jobs: 0, leads: 0 } });
check("a company at work — twenty screens over a morning, clients and a proposal sent — is clear", worker.level === "clear" && worker.score === 0 && worker.signals.some((x) => x.code === "working" && x.weight < 0) && !worker.signals.some((x) => x.code === "toured" || x.code === "wide"), `${worker.score} ${worker.signals.map((x) => x.code).join(",")}`);
const shared = scoreTrial({ ...base, name: "Test Demo", sharedDeviceTrials: 2, views: views(3, 0, 2) });
check("a shared device and a test name add up to a watch", shared.signals.some((x) => x.code === "shared-device" && /2 other trials/.test(x.text)) && shared.signals.some((x) => x.code === "test-name") && shared.score === 35 && shared.level === "watch");
const wide = scoreTrial({ ...base, views: views(14, 0, 40), records: { clients: 1, proposals: 0, sent: 0, jobs: 0, leads: 0 } });
check("fourteen screens for one record is wide, not toured; no race across a slow afternoon", wide.signals.some((x) => x.code === "wide") && !wide.signals.some((x) => x.code === "toured" || x.code === "raced") && wide.score === 25);
check("the list is highest score first", sortAssessments([worker, tourist, competitor]).map((x) => x.score).join(",") === "60,45,0");
check("the facts ride along: screens, views, sittings, first and last seen", tourist.distinctRoutes === 16 && tourist.views === 16 && tourist.sessions === 1 && tourist.firstSeen === at(0) && tourist.lastSeen === at(15));

const mark = watermarkText({ status: "TRIALING", org: "Ridgeline Roofing Co.", email: "alex@ridgeline.test", date: new Date(Date.UTC(2026, 8, 24)) });
check("the watermark names the plan, the company, the email and the day", mark === "Trial · Ridgeline Roofing Co. · alex@ridgeline.test · Sep 24, 2026" && watermarkText({ status: "FREE", org: "X", email: "y@z" }).startsWith("Free plan · X · y@z"), mark);
const uri = watermarkDataUri('Free plan · A & B <"Roofing"> · a@b.c');
check("the watermark tile is a data URI with the text escaped for SVG and the URL", uri.startsWith("data:image/svg+xml,") && !/[<>"]/.test(uri.slice(19)) && decodeURIComponent(uri).includes("A &amp; B &lt;&quot;Roofing&quot;&gt;"));

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
