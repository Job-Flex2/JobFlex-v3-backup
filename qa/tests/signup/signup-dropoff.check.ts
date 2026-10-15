// WHERE SIGN-UPS STOP (2026-10-14): the report under the live map, read from rows shaped as PostHog answers them —
// how far each screen gets them, where they stop, the problems with their side, finished-later, still-on-the-form,
// the devices and the three verdicts; then the alarm's rule, its six-hour quiet, and the office screen's line.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/signup/signup-dropoff.check.ts
import { ALERT_REPEAT_MS, alertLine, alertsToSend, buildAlertQuery, buildDropoffQuery, buildDropoffReport, deviceLabel, dropoffVisitFromRow, problemGroupFromRow, signupAlertsOf, stopPlaceOf, type DropoffVisit } from "../../../src/lib/signup-dropoff";
import { buildAttention, type AttentionFacts } from "../../../src/lib/officeScreen";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const NOW = Date.UTC(2026, 9, 14, 22, 0, 0);
const S = (minAgo: number) => Math.round((NOW - minAgo * 60_000) / 1000);

interface RowIn {
  id: string; person?: string; start: number; end: number; device?: string; browser?: string; os?: string; inApp?: boolean; flow?: string;
  steps?: Partial<Record<"1" | "code" | "2" | "3", number>>; done?: number; opened?: number;
  boxes?: string[]; problems?: string[]; leave?: string; away?: string; watched?: number; awayCount?: number; views?: number; lastScreen?: string;
}
/** A row in the query's column order (lib/signup-dropoff buildDropoffQuery). Times are minutes ago. */
const row = (r: RowIn): unknown[] => [
  r.id, r.person ?? r.id, S(r.start) * 1000, S(r.end) * 1000, r.device ?? "Mobile", r.browser ?? "Mobile Safari", r.os ?? "iOS", r.inApp ? 1 : 0, r.flow ?? "standard",
  r.steps?.["1"] != null ? S(r.steps["1"]) : 0, r.steps?.code != null ? S(r.steps.code) : 0, r.steps?.["2"] != null ? S(r.steps["2"]) : 0, r.steps?.["3"] != null ? S(r.steps["3"]) : 0,
  r.done != null ? S(r.done) : 0, r.opened ?? 0,
  r.boxes ?? [], r.problems ?? [], r.leave ?? "", r.away ?? "", r.watched ?? ((r.boxes?.length ?? 0) + (r.problems?.length ?? 0) + (r.leave ? 1 : 0)), r.awayCount ?? 0, r.views ?? 1, r.lastScreen ?? "",
];
const box = (field: string, ms: number, filled: boolean, valid: boolean, screen: string, minAgo: number) => `${field}|${ms}|${filled}|${valid}|${screen}|${S(minAgo)}`;
const prob = (reason: string, side: string, screen: string, field: string, minAgo: number, message = "") => `${reason}|${side}|${screen}|${field}|${S(minAgo)}|${message}`;

const rows = [
  // finished: account → company → plan → done
  row({ id: "v1", start: 300, end: 290, steps: { "1": 300, "2": 298, "3": 295 }, done: 293, boxes: [box("Email", 9000, true, true, "account", 299), box("Business name", 4000, true, true, "company", 297)] }),
  // refused: email already has an account, closed in the Email box — Facebook's browser on an iPhone
  row({ id: "v2", start: 280, end: 279, inApp: true, browser: "Facebook Mobile", steps: { "1": 280 }, boxes: [box("Email", 12000, true, true, "account", 279.5)], problems: [prob("email_taken", "theirs", "account", "Email", 279.4, "That email is already registered. Try signing in instead.")], leave: "closed|account|Email|email_taken", lastScreen: "account" }),
  // ours: the code email did not go out, closed on the code screen — desktop Chrome
  row({ id: "v3", start: 260, end: 255, device: "Desktop", browser: "Chrome", os: "Mac OS X", flow: "otp", steps: { "1": 260, code: 259 }, boxes: [box("Code", 30000, false, true, "code", 256)], problems: [prob("email_send_failed", "ours", "code", "", 258, "Couldn't send the email. Check the address and try again.")], leave: "closed|code|Code|email_send_failed", lastScreen: "code" }),
  // a choice: no error, closed in the Business name box on the company screen
  row({ id: "v4", start: 240, end: 236, steps: { "1": 240, "2": 238 }, boxes: [box("Email", 5000, true, true, "account", 239), box("Business name", 20000, false, true, "company", 236.5)], leave: "closed|company|Business name|", lastScreen: "company" }),
  // the same person stops once (wrong code) and finishes on a later visit
  row({ id: "v5", person: "pp", start: 200, end: 199, flow: "otp", steps: { "1": 200, code: 199.5 }, problems: [prob("wrong", "theirs", "code", "Code", 199.2)], leave: "closed|code|Code|wrong", lastScreen: "code" }),
  row({ id: "v6", person: "pp", start: 150, end: 140, flow: "otp", steps: { "1": 150, code: 149, "2": 147 }, done: 141 }),
  // still typing: ten minutes ago, no leave
  row({ id: "v7", start: 12, end: 10, steps: { "1": 12 }, boxes: [box("Name", 3000, true, true, "account", 11)] }),
  // went to Google and never came back
  row({ id: "v8", start: 120, end: 119, steps: { "1": 120 }, leave: "google|account||", lastScreen: "account" }),
  // before the watcher: screens only
  row({ id: "v9", start: 5000, end: 4999, steps: { "1": 5000 }, watched: 0 }),
  // a choice on the plan screen
  row({ id: "v10", start: 100, end: 95, device: "Desktop", browser: "Chrome", os: "Windows", steps: { "1": 100, "2": 99, "3": 97 }, leave: "closed|plan||", lastScreen: "plan" }),
  // junk
  [], ["", 1],
];
const visits = rows.map(dropoffVisitFromRow).filter((v): v is DropoffVisit => !!v);
check("rows read; empty or short rows dropped", visits.length === 10, String(visits.length));
const v2 = visits.find((v) => v.id === "v2")!;
check("a row's boxes, problems and leave read back", v2.boxes[0]?.field === "Email" && v2.boxes[0].ms === 12000 && v2.problems[0]?.reason === "email_taken" && v2.problems[0].side === "theirs" && v2.problems[0].message.startsWith("That email") && v2.leave?.kind === "closed" && v2.leave.field === "Email" && v2.inApp);
check("arrays sent as JSON text read too", dropoffVisitFromRow(row({ id: "j", start: 5, end: 4, boxes: [] }).map((c, i) => (i === 15 ? JSON.stringify([box("Phone", 2000, true, true, "company", 4)]) : c)))?.boxes[0]?.field === "Phone");
check("a message with a bar in it survives", dropoffVisitFromRow(row({ id: "m", start: 5, end: 4, problems: [prob("refused", "theirs", "account", "", 4, "a | b")] }))?.problems[0]?.message === "a | b");
check("where a visit stopped: the leave's screen and box", JSON.stringify(stopPlaceOf(v2)) === JSON.stringify({ screen: "account", field: "Email" }));
check("no leave → the furthest screen and the last box there", JSON.stringify(stopPlaceOf(visits.find((v) => v.id === "v9")!)) === JSON.stringify({ screen: "account", field: "" }));
check("devices in the admin's words", deviceLabel(v2) === "iPhone · Facebook / Instagram app" && deviceLabel({ device: "Desktop", browser: "Chrome", os: "Windows", inApp: false }) === "Desktop · Chrome" && deviceLabel({ device: "Mobile", browser: "Chrome", os: "Android", inApp: false }) === "Android · Chrome");

const r = buildDropoffReport(visits, 7, NOW);
check("counts: opened, finished, finished later, still on the form, stopped", r.visits === 10 && r.finished === 2 && r.finishedLater === 1 && r.stillOnForm === 1 && r.stopped === 6, JSON.stringify({ v: r.visits, f: r.finished, l: r.finishedLater, s: r.stillOnForm, st: r.stopped }));
check("Google leave counted apart", r.wentToGoogle === 1 && r.wentToCheckout === 0);
check("the code screen shows when the email-code flow ran", r.screens.map((s) => s.key).join(",") === "account,code,company,plan");
const sc = Object.fromEntries(r.screens.map((s) => [s.key, s]));
check("reach per screen", sc.account.reached === 10 && sc.code.reached === 3 && sc.company.reached === 4 && sc.plan.reached === 2, r.screens.map((s) => `${s.key}:${s.reached}`).join(" "));
check("stopped here per screen", sc.account.stoppedHere === 3 && sc.code.stoppedHere === 1 && sc.company.stoppedHere === 1 && sc.plan.stoppedHere === 1, r.screens.map((s) => `${s.key}:${s.stoppedHere}`).join(" "));
check("median time to the next screen (the finish counts as next; one sample is no median)", sc.account.medianSecs === 60 && sc.company.medianSecs === 180 && sc.plan.medianSecs === null, `account ${sc.account.medianSecs} company ${sc.company.medianSecs} plan ${sc.plan.medianSecs}`);
const email = r.boxes.find((b) => b.field === "Email")!;
const biz = r.boxes.find((b) => b.field === "Business name")!;
check("boxes: visitors, median, left empty, last box before leaving", email.visits === 3 && email.lastBox === 1 && biz.visits === 2 && biz.leftEmpty === 1 && biz.lastBox === 1 && r.boxes.find((b) => b.field === "Code")?.leftEmpty === 1);
check("problems: ours first, with who finished anyway", r.problems[0].reason === "email_send_failed" && r.problems[0].side === "ours" && r.problems.find((p) => p.reason === "wrong")?.finishedAnyway === 1 && r.problems.find((p) => p.reason === "email_taken")?.finishedAnyway === 0);
check("where they stopped, by place", r.stopPlaces.some((p) => p.place === "Account · Email" && p.visits === 1) && r.stopPlaces.some((p) => p.place === "Account — went to Google") && r.stopPlaces.some((p) => p.place === "Company · Business name"));
check("devices: the in-app browser has its own row", r.devices.some((d) => d.label === "iPhone · Facebook / Instagram app" && d.visits === 1 && d.finished === 0));
check("verdict: mostly a choice (1 ours, 1 refused, 3 quiet of 5)", r.verdict.counted === 5 && r.verdict.ours === 1 && r.verdict.theirs === 1 && r.verdict.choice === 3 && /^Mostly a choice/.test(r.verdict.headline) && r.verdict.tone === "warn", r.verdict.headline);
check("the unwatched visits count in screens, not in the verdict", r.watched === 8 && !visits.find((v) => v.id === "v9")!.watched);

// It's us: two of five stopped on a fault of ours.
const ours = buildDropoffReport([...visits.filter((v) => v.id !== "v10"), dropoffVisitFromRow(row({ id: "o2", start: 90, end: 88, steps: { "1": 90 }, problems: [prob("server_error", "ours", "account", "Email", 89)], leave: "closed|account|Email|server_error" }))!], 7, NOW);
check("verdict: it's us at a quarter or more", ours.verdict.tone === "bad" && /^It's us: 2 of 5/.test(ours.verdict.headline), ours.verdict.headline);
// The form turns them away: refusals outnumber quiet leaves.
const refusals = [0, 1, 2, 3, 4].map((i) => dropoffVisitFromRow(row({ id: `t${i}`, start: 80 - i, end: 79 - i, steps: { "1": 80 - i }, problems: [prob("password_short", "theirs", "account", "Password", 79.5 - i)], leave: "closed|account|Password|password_short" }))!);
const away = buildDropoffReport(refusals, 7, NOW);
check("verdict: the form turns them away", away.verdict.tone === "warn" && /turns them away: 5 of 5/.test(away.verdict.headline) && /Mostly “Password too short”/.test(away.verdict.detail), away.verdict.headline);
check("verdict: too early under five", buildDropoffReport(refusals.slice(0, 2), 7, NOW).verdict.tone === "info");
check("an empty span reads as nothing, not an error", buildDropoffReport([], 30, NOW).visits === 0 && buildDropoffReport([], 30, NOW).verdict.counted === 0);

// ── the queries ──
const q = buildDropoffQuery(7);
check("the report's query: one row per visit, the form only, the visitor rule", /GROUP BY visit/.test(q) && /startsWith\(.*'\/auth\/register'\)/.test(q) && q.includes("signup_problem") && q.includes("www.jobflex.app") && !q.includes("'localhost'"));
check("a stand reads its own host too", buildDropoffQuery(7, "with-local").includes("'localhost'"));
check("the span is held to 1–30 days", buildDropoffQuery(400).includes("INTERVAL 30 DAY") && buildDropoffQuery(0).includes("INTERVAL 1 DAY"));
check("the alarm's query: the last hour by reason", /INTERVAL 60 MINUTE/.test(buildAlertQuery()) && /GROUP BY reason/.test(buildAlertQuery()));

// ── the alarm ──
const groups = [
  ["wrong", "theirs", 3, 5, "That code isn't right.", "code"],
  ["email_send_failed", "ours", 2, 2, "Couldn't send the email.", "code"],
  ["page_error", "ours", 2, 2, "x is undefined", "account"],
  ["email_taken", "theirs", 2, 4, "", "account"],
  ["", "ours", 9, 9, "", ""],
].map(problemGroupFromRow).filter((g) => !!g);
const alerts = signupAlertsOf(groups);
check("three visitors on one reason, or two on a hard fault of ours", alerts.map((a) => a.reason).join(",") === "email_send_failed,wrong", alerts.map((a) => a.reason).join(","));
check("one reason emailed at most every six hours", alertsToSend(alerts, { wrong: NOW - 3_600_000, email_send_failed: NOW - ALERT_REPEAT_MS - 1 }, NOW).map((a) => a.reason).join(",") === "email_send_failed");
check("the alarm's line", alertLine(alerts[1]) === 'three visitors hit "Wrong code" on the Email code screen in the last hour — 5 times'.replace("three", "3") && /our side$/.test(alertLine(alerts[0])), alertLine(alerts[1]));

// ── the office screen ──
const facts: AttentionFacts = {
  now: NOW, dayStart: NOW - 10 * 3_600_000, trialsEndingToday: [], trialsEndingTomorrow: 0, failedPayments: [], setToCancelCard: [], signupsToday: [], supportUnread: 0, supportOldest: null, leadQueue: 0, health: [], visitors: null, sentToday: 0, sentYesterday: 0,
  signupAlerts: alerts.map((a) => ({ words: a.words, side: a.side, visits: a.visits, times: a.times, screen: a.screen })),
};
const lines = buildAttention(facts);
check("office: ours is an alarm, refusals a warning, both name the screen", lines[0]?.tone === "bad" && /^Sign-up: 2 visitors hit "The code email didn't send" in the last hour — on our side$/.test(lines[0].text) && lines[0].who?.[0] === "2 times · Email code screen" && lines.some((l) => l.tone === "warn" && /Wrong code/.test(l.text)), JSON.stringify(lines[0]));
check("office: no alerts, no line", buildAttention({ ...facts, signupAlerts: [] }).length === 0);

if (bad) {
  console.log(`\n${bad} failed`);
  process.exit(1);
}
console.log("\nall passed");
