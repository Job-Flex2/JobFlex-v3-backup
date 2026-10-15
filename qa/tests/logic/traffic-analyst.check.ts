// The analyst (2026-10-02, lib/traffic-analyst): a week of landing sessions
// → findings with evidence and one thing to try. Every rule proved on
// made-up sessions. Static imports only (tsx has no top-level await).
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/traffic-analyst.check.ts
import { ANALYST_MIN_AD_VISITS, adNameOf, analyse, analystSessionFromRow, analystWindowFrom, buildAnalystQuery, periodWords, type LandingSession } from "../../../src/lib/traffic-analyst";
import { SESSION_COLUMNS, SESSION_EXTRA_COLUMNS, TONE_WORD, analystToMarkdown, clicksDifference, sessionsToCsv } from "../../../src/lib/traffic-export";
import { adMoney } from "../../../src/lib/traffic-money";
import { parseSnapshot, snapshotKey, trendDays, trendOf, type AnalystSnapshot } from "../../../src/lib/traffic-history";
import { buildTrafficDigest } from "../../../src/lib/email/build/traffic";
import { renderEmail } from "../../../src/lib/email/renderEmail";
import { TRAFFIC_SINCE_MS } from "../../../src/lib/traffic-visitor";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };

const NOW = Date.parse("2026-10-02T18:00:00-07:00");
let seq = 0;
const sess = (p: Partial<LandingSession> = {}): LandingSession => {
  seq++;
  const ad = p.utmSource !== "";
  return {
    id: `s${seq}`, person: `p${seq}`, startedAt: NOW - 3_600_000 * ((seq % 100) + 1), endedAt: NOW - 3_600_000 * ((seq % 100) + 1) + 60_000,
    industry: "roofing", utmSource: ad ? "fb" : "", utmMedium: ad ? "paid" : "", utmCampaign: ad ? "C1" : "", utmContent: ad ? "A1" : "", referrer: ad ? "l.facebook.com" : "google.com", fbclid: ad,
    device: "Mobile", browser: "Mobile Safari", os: "iOS", inApp: false, views: 1, landingViews: 1, dwell: 40, scroll: 0.6, sections: ["hero", "compare", "showcase"],
    cta: 0, placements: [], registerViews: 0, step: 0, flow: "", attempts: 0, cardless: 0, opened: 0, errors: [], completed: false, outcome: "", plan: "",
    heroMs: null, paintMs: null, readyMs: null, trackedMs: null, kb: null, connection: "", leftUnshown: 0, formReadyMs: null, typedEarly: 0, submittedEarly: 0, step1Errors: [], step1Passed: 0,
    lcpMs: null, leftMs: null, downlink: null, rttMs: null, typedMs: null, submitMs: null, sectionAfter: [], ctaLabels: [], ctaHrefs: [], ctaSpots: [],
    hvacSteps: 0, hvacStepKeys: [], hvacTaps: 0, hvacTierPicks: 0, hvacTiers: [], country: "", region: "", city: "", ...p,
  };
};
const many = (n: number, p: Partial<LandingSession> | ((i: number) => Partial<LandingSession>) = {}) => Array.from({ length: n }, (_, i) => sess(typeof p === "function" ? p(i) : p));
const ids = (r: ReturnType<typeof analyse>) => r.findings.map((f) => f.id);
const find = (r: ReturnType<typeof analyse>, id: string) => r.findings.find((f) => f.id === id);

// ── the query and the row
const sql = buildAnalystQuery();
check("the query reads a week, one row per session, with the landing's leave numbers and the sections", /INTERVAL 7 DAY/.test(sql) && /GROUP BY sid/.test(sql) && /\$pageleave/.test(sql) && /\$prev_pageview_max_scroll_percentage/.test(sql) && /landing_section/.test(sql) && /jf_signup_completed/.test(sql) && /www\.jobflex\.app/.test(sql) && /LIMIT 6000/.test(sql));
check("the query keeps the admin out and needs a session id", /NOT startsWith\(.*'\/admin\/'\)/.test(sql) && /\$session_id\), ''\) != ''/.test(sql));
const row = ["sess-1", "person-1", 1_700_000_000_000, 1_700_000_060_000, "", "https://www.jobflex.app/?industry=fencing&utm_source=fb", "fb", "paid", "C9", "A9", "l.facebook.com", 1, "Mobile", "Mobile Safari", "iOS", 1, 2, 1, 42.5, 0.73, "hero,compare,showcase", 1, "hero", 1, 2, "standard", 1, 1, 0, "trial_rejected", 1, "trial_started", "starter"];
const parsed = analystSessionFromRow(row)!;
check("a row parses: trade from the URL when landing_view is missing, numbers, lists", !!parsed && parsed.industry === "fencing" && parsed.inApp && parsed.fbclid && parsed.dwell === 42.5 && parsed.scroll === 0.73 && parsed.sections.join() === "hero,compare,showcase" && parsed.placements[0] === "hero" && parsed.step === 2 && parsed.cardless === 1 && parsed.errors[0] === "trial_rejected" && parsed.completed && parsed.plan === "starter");
check("a short row is refused; nulls stay null", analystSessionFromRow(row.slice(0, 20)) === null && analystSessionFromRow([...row.slice(0, 18), null, null, ...row.slice(20)])!.dwell === null);
check("a landing seen only by its pageview counts as the general landing", analystSessionFromRow([...row.slice(0, 4), "", "https://www.jobflex.app/", ...row.slice(6)])!.industry === "default");

// ── not enough yet
const few = analyse([...many(10), ...many(5, { utmSource: "" })], { now: NOW });
check("under 20 ad visits the analyst only says so", ids(few)[0] === "sample" && !few.sample.enough && few.sample.fromAds === 10 && few.sample.landed === 15 && /starts reading at 20/.test(few.headline), few.headline);
check("with nobody landed it says that", /Nobody has landed/.test(analyse([], { now: NOW }).headline));

// ── bouncing fast, no signups
const bouncy = analyse([...many(30, (i) => ({ views: 1, dwell: 2 + (i % 3), scroll: 0.02, sections: i % 2 ? ["hero"] : [], inApp: i % 3 !== 0 })), ...many(10, { views: 2, dwell: 50, cta: 1, placements: ["hero"], registerViews: 1, step: 1 })], { now: NOW });
const b = find(bouncy, "bounce")!;
check("75% bouncing is a bad finding, with the in-app split, and the quick-leave reading when most were gone in 5 s", !!b && b.tone === "bad" && /75% of ad clicks leave/.test(b.title) && /in-app browser bounces/.test(b.evidence) && /landing-page views/.test(b.action), b?.evidence);
check("no signups from 40 ad visits is its own bad finding, pointing at the biggest leak", !!find(bouncy, "no-signups") && /Fix the biggest leak first/.test(find(bouncy, "no-signups")!.action));
check("the headline says what is going on and what to fix", /Since Sep 30 \(2\.\d days\), 40 people landed from ads: 75% left without pressing anything, 25% pressed a button, 25% opened the form, 0 signed up\. The thing to fix: no signups/.test(bouncy.headline), bouncy.headline);
check("bad findings come first", bouncy.findings[0].tone === "bad" && bouncy.findings.findIndex((f) => f.tone === "info") > bouncy.findings.findIndex((f) => f.tone === "bad"));
check("the funnel counts people and shares", bouncy.funnel[0].n === 40 && bouncy.funnel[1].n === 10 && bouncy.funnel[1].pct === 0.25 && bouncy.funnel[6].n === 0);

// ── they leave at a section, and they read without pressing
const cliff = analyse([...many(36, { dwell: 60, scroll: 0.6, sections: ["hero", "compare", "showcase"] }), ...many(4, (i) => ({ dwell: 90, scroll: 0.9, sections: ["hero", "compare", "showcase", "proposals", "portal"], cta: i < 2 ? 1 : 0, placements: i < 2 ? ["footer"] : [] }))], { now: NOW });
const c = find(cliff, "cliff")!;
check("the section after which they leave is named, with the reach on both sides", !!c && /They leave at «Estimators»/.test(c.title) && /100% of 40 measured visits reach «Estimators», 10% reach the next section \(«Proposals»\)/.test(c.evidence), c?.evidence);
check("reading without pressing is called, with where the presses went", !!find(cliff, "reading") && /100% stay 30 s/.test(find(cliff, "reading")!.evidence) && /only 5% press any button — the presses: footer \(2\)/.test(find(cliff, "reading")!.evidence), find(cliff, "reading")?.evidence);
check("section reach is over the measured visits only", cliff.sections.find((x) => x.key === "proposals")!.reach === 0.1 && cliff.sample.measured === 40);

// ── where the sign-up leaks
const leaky = analyse([...many(20, (i) => ({ cta: 1, placements: ["hero"], registerViews: 1, step: i < 4 ? 3 : i < 16 ? 2 : 1 })), ...many(10, { cta: 1, placements: ["hero"] }), ...many(5)], { now: NOW });
const st = find(leaky, "step")!;
check("step 2 (company) losing 75% is the step finding, with the company advice", !!st && /step 2 \(company\) loses 75%/.test(st.title) && /16 reached step 2 \(company\), 4 went on/.test(st.evidence) && /company step optional/.test(st.action), st?.evidence);
check("a third pressing a button but never seeing the form is the leak finding", !!find(leaky, "leak") && /33% press a button but never see the form/.test(find(leaky, "leak")!.title));
const confirm = analyse([...many(12, (i) => ({ registerViews: 1, step: 3, attempts: 1, cardless: 1, completed: i < 4 })), ...many(10)], { now: NOW });
check("trials started but not confirmed is the confirm finding, naming the e-mail", !!find(confirm, "confirm") && /8 of 12 who started a trial never finished/.test(find(confirm, "confirm")!.title) && /confirmation e-mail is the leak/.test(find(confirm, "confirm")!.action));
const errs = analyse(many(20, (i) => ({ registerViews: 1, step: 3, errors: i < 4 ? ["checkout_rejected"] : [] })), { now: NOW });
check("repeated plan-step errors are a finding", !!find(errs, "errors") && /failed 4 times/.test(find(errs, "errors")!.title) && /checkout rejected × 4/.test(find(errs, "errors")!.evidence));

// ── Facebook's browser, ad against ad, the good news
const names = { A1: "Roof · 40 s v1", A2: "Fence · 40 s v1", C1: "Roofing campaign" };
const mixed = analyse([
  ...many(30, (i) => ({ inApp: true, utmContent: "A2", registerViews: i === 0 ? 1 : 0, step: i === 0 ? 1 : 0 })),
  ...many(30, (i) => ({ cta: 1, placements: ["hero"], registerViews: i < 20 ? 1 : 0, step: i < 20 ? 1 : 0, completed: i < 3 })),
], { now: NOW, adNames: names });
check("the in-app browser converting half as well is called", !!find(mixed, "in-app") && /3% of 30 in-app visits open the form vs 67% of 30/.test(find(mixed, "in-app")!.evidence), find(mixed, "in-app")?.evidence);
const ads = find(mixed, "ads")!;
check("ad against ad, by the owner's names, with where to move the budget", !!ads && /«Roof · 40 s v1» gets people to the form; «Fence · 40 s v1» does not/.test(ads.title) && /Move budget to «Roof · 40 s v1»/.test(ads.action) && ads.about === "Fence · 40 s v1", ads?.title);
check("three signups out of sixty is good news, crediting the ad", !!find(mixed, "good") && /3 signed up — 5\.0% of ad visits/.test(find(mixed, "good")!.title) && /«Roof · 40 s v1» brought 3/.test(find(mixed, "good")!.evidence));
check("the ads table names, counts and rates each ad", mixed.ads.length === 2 && mixed.ads[0].n === 30 && mixed.ads.some((a) => a.name === "Fence · 40 s v1" && a.form !== null && Math.abs(a.form - 1 / 30) < 1e-9));
check("an unnamed ad under a named campaign is told apart by its id", adNameOf({ utmCampaign: "C1", utmContent: "A7" }, names) === "Roofing campaign · ad A7" && adNameOf({ utmCampaign: "C1", utmContent: "" }, names) === "Roofing campaign" && adNameOf({ utmCampaign: "", utmContent: "" }, names) === "untagged");
const readers = analyse([...many(20, { utmContent: "A2", dwell: 80, scroll: 0.8 }), ...many(12, { utmContent: "A1", registerViews: 1, step: 1 })], { now: NOW, adNames: names });
check("an ad whose people read but never open the form is called out", !!find(readers, "readers-A2") && /brings readers, not sign-ups/.test(find(readers, "readers-A2")!.title));

// ── trades, devices, hours
const trades = analyse([...many(20, (i) => ({ industry: "roofing", registerViews: i < 8 ? 1 : 0, step: i < 8 ? 1 : 0 })), ...many(20, (i) => ({ industry: "fencing", registerViews: i < 1 ? 1 : 0, step: i < 1 ? 1 : 0 }))], { now: NOW });
check("trade landing against trade landing", !!find(trades, "trades") && /The roofing landing converts, the fencing landing does not/.test(find(trades, "trades")!.title), find(trades, "trades")?.title);
const devices = analyse([...many(20, (i) => ({ device: "Desktop", registerViews: i < 10 ? 1 : 0, step: i < 10 ? 1 : 0 })), ...many(20, (i) => ({ device: "Mobile", registerViews: i < 2 ? 1 : 0, step: i < 2 ? 1 : 0 }))], { now: NOW });
check("desktops signing up while phones do not is called", !!find(devices, "device") && /50% of 20 desktop visits open the form vs 10% of 20 on phones/.test(find(devices, "device")!.evidence));
const at = (h: number, day = 1) => Date.parse(`2026-10-0${day}T${String(h).padStart(2, "0")}:30:00-07:00`);
const hours = analyse([...many(40, (i) => ({ startedAt: at(20, 1 + (i % 2)), views: 1, dwell: 3, scroll: 0.02, cta: i < 8 ? 1 : 0 })), ...many(40, (i) => ({ startedAt: at(9, 1 + (i % 2)), views: 1, cta: i < 30 ? 1 : 0 }))], { now: NOW, timezone: "America/Los_Angeles" });
check("evening clicks bouncing more than morning ones is called, in the page's timezone", !!find(hours, "hours") && /Evening clicks bounce more/.test(find(hours, "hours")!.title) && /80% bounce in the evening \(40 visits\) vs 25% in the morning/.test(find(hours, "hours")!.evidence), find(hours, "hours")?.evidence);

// ── shallow scrolling
const shallow = analyse(many(30, (i) => ({ views: i % 3 ? 2 : 1, dwell: 20, scroll: 0.2, sections: ["hero"] })), { now: NOW });
check("half stopping early on the page is a finding that names the pricing's reach", !!find(shallow, "scroll") && /stop before 20% of the page/.test(find(shallow, "scroll")!.title) && /only 0% reach the pricing/.test(find(shallow, "scroll")!.evidence));
check("every finding carries a sample and a confidence", shallow.findings.every((f) => f.n > 0 && ["low", "medium", "high"].includes(f.confidence)) && find(shallow, "scroll")!.confidence === "low");
check("the minimum is the exported constant", ANALYST_MIN_AD_VISITS === 20 && few.sample.needed === 20);

// ── the first screen, the form before it is ready, the demo's place, the counting (2026-10-04)
const sql2 = buildAnalystQuery();
check("the query reads the two beacons and stays balanced", /landing_timing/.test(sql2) && /signup_step1/.test(sql2) && /hero_ms/.test(sql2) && /typed_before_ready/.test(sql2) && sql2.split("(").length === sql2.split(")").length);
const row45 = [...row, 7600, 2900, 5000, 5200, 1450, "4g", 0, 3300, 1, 0, "email_taken,password_mismatch", 1];
const p45 = analystSessionFromRow(row45)!;
check("a 45-column row carries the timings", p45.heroMs === 7600 && p45.paintMs === 2900 && p45.readyMs === 5000 && p45.trackedMs === 5200 && p45.kb === 1450 && p45.connection === "4g" && p45.leftUnshown === 0 && p45.formReadyMs === 3300 && p45.typedEarly === 1 && p45.submittedEarly === 0 && p45.step1Errors.join() === "email_taken,password_mismatch" && p45.step1Passed === 1);
check("a row from before the beacons parses with nothing known; -1 is not a time", parsed.heroMs === null && parsed.formReadyMs === null && parsed.step1Errors.length === 0 && analystSessionFromRow([...row, -1, -1])!.heroMs === null);
const slowScreen = analyse([...many(30, (i) => ({ views: 1, dwell: 20, scroll: 0, sections: ["hero"], heroMs: 6000 + (i % 5) * 800, paintMs: 2800, readyMs: 5000, trackedMs: 5100, kb: 1400, connection: i % 2 ? "4g" : "3g", inApp: i % 3 !== 0 })), ...many(10, { views: 2, cta: 1, placements: ["hero"], registerViews: 1, step: 1, heroMs: 2000, paintMs: 900, readyMs: 1500, trackedMs: 1600, kb: 1300 })], { now: NOW });
const fs = find(slowScreen, "first-screen")!;
check("a headline arriving seconds after the tap is a bad finding, with the split and the steps", !!fs && fs.tone === "bad" && /On phones the headline shows \d\.\d s after the tap/.test(fs.title) && /Median \d\.\d s over 40 phone visits/.test(fs.evidence) && /in Facebook's browser vs/.test(fs.evidence) && /by connection/.test(fs.evidence) && /JavaScript takes over at 5\.0 s after 1\.4 MB downloaded/.test(fs.evidence) && (fs.steps?.length ?? 0) >= 5 && /lp-enter/.test(fs.steps![0]), fs?.evidence);
check("held back after the first paint: the evidence says by how much, and step 1 is to show the copy", /the headline \d\.\d s after it/.test(fs.evidence) && /held back after the first paint/.test(fs.action) && /Show the hero copy from the first paint/.test(fs.steps![0]));
const latePaint = analyse(many(30, (i) => ({ views: 1, dwell: 20, scroll: 0, sections: ["hero"], heroMs: 3300 + (i % 5) * 300, paintMs: 3250 + (i % 5) * 300, readyMs: 5200, trackedMs: 5300, kb: 1400 })), { now: NOW });
const lp = find(latePaint, "first-screen")!;
check("once the headline comes with the first paint, the advice is the page's weight, not the entrance", !!lp && lp.tone === "warn" && /comes with the first paint/.test(lp.action) && !/lp-enter/.test(lp.steps!.join(" ")) && /WOFF2/.test(lp.steps![0]) && !/after it,/.test(lp.evidence), lp?.action);
check("the bounce finding then points at the first screen, not the words", /first screen is slow/.test(find(slowScreen, "bounce")!.action));
check("the tracking starting late is a note that explains the 5-second number", !!find(slowScreen, "undercount") && /Counting starts 5\.1 s into a phone visit/.test(find(slowScreen, "undercount")!.title));
check("the sample line carries the phone median", slowScreen.stats.heroMedianPhone !== null && slowScreen.stats.heroMedianPhone >= 2000);
const fastScreen = analyse(many(30, { heroMs: 900, paintMs: 600, readyMs: 800, trackedMs: 1000 }), { now: NOW });
check("a fast first screen says nothing", !find(fastScreen, "first-screen") && !find(fastScreen, "undercount"));
const slowForm = analyse([...many(25, (i) => ({ registerViews: 1, step: 1, formReadyMs: 3200, typedEarly: i < 6 ? 1 : 0, submittedEarly: i < 2 ? 1 : 0, step1Errors: i < 3 ? ["email_taken"] : i < 5 ? ["password_mismatch"] : [], step1Passed: i >= 5 ? 1 : 0 })), ...many(5)], { now: NOW });
const fr = find(slowForm, "form-ready")!;
check("a form usable seconds after it appears, with early typing, is a finding with the diet steps", !!fr && /24% start filling the sign-up form before it is ready/.test(fr.title) && /25 form loads on phones/.test(fr.evidence) && /6 had already typed and 2 had already pressed Continue/.test(fr.evidence) && (fr.steps?.length ?? 0) === 4, fr?.title);
const se = find(slowForm, "step1-errors")!;
check("step 1's refusals are counted by reason, the first with its advice, the rest as steps", !!se && /Step 1 refused 5 times/.test(se.title) && /email taken × 3, password mismatch × 2/.test(se.evidence) && /Sign in instead/.test(se.action) && se.steps!.length === 1 && /confirmation field/.test(se.steps![0]), se?.evidence);
const order = analyse([...many(30, { sections: ["hero", "compare"] }), ...many(10, { sections: ["hero", "compare", "showcase", "proposals"] })], { now: NOW });
const od = find(order, "order")!;
check("the demo sitting third behind the comparison is called, with the reorder", !!od && /The demo is the 3rd screen; «JobFlex vs other apps» comes before it/.test(od.title) && /100% of 40 measured visits reach «JobFlex vs other apps», 25% reach the demo/.test(od.evidence) && /Reorder landing-e-page.tsx/.test(od.steps![0]), od?.title);
const adDefault = analyse([...many(20, { utmContent: "A3", industry: "default", views: 1, dwell: 8, scroll: 0.05, sections: ["hero"] }), ...many(12, { utmContent: "A1", registerViews: 1, step: 1 })], { now: NOW, adNames: { A3: "Business · crew" } });
check("an ad whose clicks land on the general hero is told to carry ?industry= and a ?hook=", !!find(adDefault, "bounce-A3") && /100% land on the general hero/.test(find(adDefault, "bounce-A3")!.evidence) && /\?industry=<trade>/.test(find(adDefault, "bounce-A3")!.action), find(adDefault, "bounce-A3")?.evidence);
check("every new finding carries steps the panel can list, or none", slowScreen.findings.every((f) => f.steps === undefined || (Array.isArray(f.steps) && f.steps.every((x) => typeof x === "string" && x.length > 10))));

// ── a landing laid out in an order of its own (roofing: the demo second, the comparison by the pricing) is read apart, in that order
const LATER = Date.parse("2026-10-12T12:00:00-07:00"); // after the roofing order went live
const liveOrder = { startedAt: LATER - 3_600_000, endedAt: LATER - 3_540_000 };
const ownOrder = analyse([
  ...many(30, { ...liveOrder, industry: "roofing", sections: ["hero", "showcase"] }),
  ...many(10, { ...liveOrder, industry: "roofing", sections: ["hero", "showcase", "proposals", "portal"] }),
  ...many(30, { ...liveOrder, industry: "painting", sections: ["hero", "compare"] }),
  ...many(10, { ...liveOrder, industry: "painting", sections: ["hero", "compare", "showcase", "proposals"] }),
], { now: LATER });
const roofLanding = ownOrder.landings?.find((l) => l.key === "roofing");
check("the roofing landing is read apart, its sections in its own order: the demo second, the comparison beside the pricing", !!roofLanding && ownOrder.landings!.length === 1 && roofLanding.measured === 40 && roofLanding.name === "the roofing landing" && roofLanding.sections[0].key === "hero" && roofLanding.sections[1].key === "showcase" && roofLanding.sections.findIndex((x) => x.key === "compare") === roofLanding.sections.findIndex((x) => x.key === "pricing") - 1 && roofLanding.sections[1].reach === 1 && roofLanding.sections.find((x) => x.key === "proposals")!.reach === 0.25, JSON.stringify(roofLanding?.sections.map((x) => x.key)));
check("the usual order's table is over the other landings only, and the sample still counts every measured visit", ownOrder.sample.measured === 80 && ownOrder.sections.find((x) => x.key === "compare")!.reach === 1 && ownOrder.sections.find((x) => x.key === "showcase")!.reach === 0.25);
const oc = find(ownOrder, "cliff-roofing")!;
check("where the roofing landing loses them is named for that landing, with ITS next section", !!oc && /^On the roofing landing they leave at «Estimators»$/.test(oc.title) && /100% of 40 measured visits to the roofing landing reach «Estimators», 25% reach the next section \(«Proposals»\)/.test(oc.evidence) && oc.about === "the roofing landing" && oc.n === 40, oc?.evidence);
check("the demo-is-third finding is about the usual order only: roofing shows the demo second", !!find(ownOrder, "order") && /100% of 40 measured visits reach «JobFlex vs other apps», 25% reach the demo/.test(find(ownOrder, "order")!.evidence) && !find(ownOrder, "order-roofing") && /They leave at «JobFlex vs other apps»/.test(find(ownOrder, "cliff")!.title));
const hvacOrder = analyse([...many(25, { ...liveOrder, industry: "hvac", sections: ["hero", "showcase", "hvac"] }), ...many(5, { ...liveOrder, industry: "hvac", sections: ["hero", "showcase", "hvac", "proposals"] })], { now: LATER });
const hvl = hvacOrder.landings?.find((l) => l.key === "hvac");
check("the HVAC landing is read apart too, named «the HVAC landing», its service book third", !!hvl && hvl.name === "the HVAC landing" && hvl.sections[2].key === "hvac" && hvl.sections[2].reach === 1 && /^On the HVAC landing they leave at «HVAC service book»$/.test(find(hvacOrder, "cliff-hvac")?.title ?? ""), find(hvacOrder, "cliff-hvac")?.title);
const beforeOrder = analyse([...many(30, { industry: "roofing", sections: ["hero", "compare"] }), ...many(10, { industry: "roofing", sections: ["hero", "compare", "showcase"] })], { now: NOW });
check("a roofing visit from before the order went live saw the usual order and is read in it", (beforeOrder.landings ?? []).length === 0 && beforeOrder.sections.find((x) => x.key === "compare")!.reach === 1 && !!find(beforeOrder, "order") && !find(beforeOrder, "cliff-roofing"));
const ownMd = analystToMarkdown({ status: "ok" as const, fetchedAt: new Date(LATER).toISOString(), report: ownOrder }, { timezone: "America/Los_Angeles" });
check("the Markdown carries the roofing landing's own table under the usual one, each with its own count", /## How far down the page they get · 40 measured visits/.test(ownMd) && /### The roofing landing, in its own order · 40 measured visits/.test(ownMd) && ownMd.indexOf("### The roofing landing") > ownMd.indexOf("## How far down the page") && /\| Estimators \| 100% \|\n\| Proposals \| 25% \|/.test(ownMd.slice(ownMd.indexOf("### The roofing landing"))), ownMd.slice(ownMd.indexOf("### The roofing landing"), ownMd.indexOf("### The roofing landing") + 260));

// ── the window, the exports (2026-10-04)
check("the window never reaches before the ad launch (Sep 30, LA midnight), like the rest of the page", /timestamp >= toDateTime\('2026-09-30 00:00:00', 'America\/Los_Angeles'\)/.test(sql2) && /INTERVAL 7 DAY/.test(sql2));
check("the window's start is seven days back, or Sep 30 when that is later", analystWindowFrom(Date.parse("2026-10-04T12:00:00-07:00")) === TRAFFIC_SINCE_MS && analystWindowFrom(Date.parse("2026-10-20T12:00:00-07:00")) === Date.parse("2026-10-13T12:00:00-07:00"));
const manyAds = analyse(many(15 * 8, (i) => ({ utmContent: `AD${Math.floor(i / 8)}` })), { now: NOW });
check("the report carries every ad (the panel shows twelve), and the trades and placements", manyAds.ads.length === 15 && mixed.placements.some((p) => p.placement === "hero") && mixed.trades.length >= 1);
const result = { status: "ok" as const, fetchedAt: new Date(NOW).toISOString(), window: { from: new Date(analystWindowFrom(NOW)).toISOString(), to: new Date(NOW).toISOString() }, report: slowForm };
const allFindings = [slowScreen, slowForm, mixed, leaky, order];
const mdOk = allFindings.every((rep) => {
  const md = analystToMarkdown({ ...result, report: rep }, { timezone: "America/Los_Angeles" });
  return rep.findings.every((f, i) => md.includes(`${i + 1}. ${TONE_WORD[f.tone]} — ${f.title}`) && md.includes(f.evidence) && md.includes(f.action) && (f.steps ?? []).every((s) => md.includes(s)) && (!f.about || md.includes(`**About:** ${f.about}`)) && md.includes(`${f.confidence} confidence · \`${f.id}\``));
});
check("the Markdown carries every finding: its word, title, evidence, action, steps, about, sample and confidence", mdOk && allFindings.reduce((a, r) => a + r.findings.length, 0) >= 15);
const md = analystToMarkdown({ ...result, report: mixed }, { timezone: "America/Los_Angeles" });
check("the Markdown carries the period, the read time, the funnel, sections, every ad, trades, placements, fast and the method", /\*\*Period:\*\* Sep 30, 2026, 12:00 AM → Oct 2, 2026, 6:00 PM/.test(md) && /\*\*PostHog read at:\*\* Oct 2, 2026, 6:00 PM/.test(md) && /## The funnel/.test(md) && /## How far down the page/.test(md) && /## Ads \(2\)/.test(md) && md.includes("| Fence · 40 s v1 | A2 |") && /## Trade landings/.test(md) && /\| hero \| 30 \|/.test(md) && /Gone inside 5 s/.test(md) && /## Method/.test(md), md.slice(0, 300));
const csv = sessionsToCsv(many(3, { sections: ["hero", "compare"], step1Errors: ["email_taken"], utmContent: "A1" }), { A1: "Roof · 40 s v1" });
const lines = csv.split("\r\n");
const head = lines[0].split(",").map((c) => c.replace(/^"|"$/g, ""));
check("the sessions CSV has every session field, then the readable times and the ad's name", head.join() === [...SESSION_COLUMNS, ...SESSION_EXTRA_COLUMNS].join() && Object.keys(sess()).every((k) => head.includes(k)) && lines.length === 4 && lines[1].includes('"hero;compare"') && lines[1].includes('"Roof · 40 s v1"'), head.join());
// ── stage 2: the window in words, the beacons' other fields, ad → money (2026-10-04)
const oct4 = Date.parse("2026-10-04T14:00:00-07:00"), oct20 = Date.parse("2026-10-20T14:00:00-07:00");
check("the period is the window as read: since Sep 30 while the launch is under 7 days back, then the last 7 days", periodWords(analystWindowFrom(oct4), oct4).label === "since Sep 30 (4.6 days)" && periodWords(analystWindowFrom(oct20), oct20).label === "last 7 days" && periodWords(analystWindowFrom(oct20), oct20).inWords === "in the last 7 days" && periodWords(TRAFFIC_SINCE_MS, TRAFFIC_SINCE_MS + 5 * 3_600_000).label === "since Sep 30 (5 h)");
const late = analyse([...many(30, { views: 1, dwell: 3, scroll: 0.02 }), ...many(10, { views: 2, cta: 1, registerViews: 1, step: 1, completed: true })], { now: oct20 });
check("no text says «last 7 days» while the window is shorter; the funnel and the headline name the real window", !JSON.stringify(bouncy).includes("last 7 days") && find(bouncy, "funnel")!.title === `The funnel, ${bouncy.period}` && /^Since Sep 30 \(2\.\d days\), /.test(bouncy.headline) && /^In the last 7 days, /.test(late.headline) && find(late, "funnel")!.title === "The funnel, last 7 days" && /in the last 7 days/.test(find(late, "good")!.evidence), bouncy.period);
check("the sample note and an empty week use the window's words", /landing visits since Sep 30 \(2\.\d days\)/.test(few.findings[0].evidence) && /^Nobody has landed since Sep 30/.test(analyse([], { now: NOW }).headline));
check("the query reads the beacons' other fields, the HVAC demo and the place", ["lcp_ms", "left_ms", "downlink", "rtt", "typed_ms", "submit_ms", "properties.after", "properties.label", "properties.href", "properties.spot", "hvac_demo_step", "hvac_demo_tier", "properties.how", "properties.tier", "$geoip_country_name", "$geoip_subdivision_1_name", "$geoip_city_name"].every((k) => sql2.includes(k)) && sql2.includes("' ¦ '"));
const row63 = [...row45, 3100, -1, 1.45, 0, 2100, -1, "compare:12,hero:0,showcase:31", "Start free, no card ¦ See a sample", "/auth/register ¦ /sample.pdf", "hero", 4, "address,house", 2, 1, "better", "United States", "Texas", "Austin"];
const p63 = analystSessionFromRow(row63)!;
check("a 63-column row carries the new fields: commas inside button words survive, sections in the order reached", p63.lcpMs === 3100 && p63.leftMs === null && p63.downlink === 1.45 && p63.rttMs === 0 && p63.typedMs === 2100 && p63.submitMs === null && p63.sectionAfter.join() === "hero:0,compare:12,showcase:31" && p63.ctaLabels.join("|") === "Start free, no card|See a sample" && p63.ctaHrefs[1] === "/sample.pdf" && p63.ctaSpots[0] === "hero" && p63.hvacSteps === 4 && p63.hvacStepKeys.join() === "address,house" && p63.hvacTaps === 2 && p63.hvacTierPicks === 1 && p63.hvacTiers[0] === "better" && p63.country === "United States" && p63.region === "Texas" && p63.city === "Austin", JSON.stringify(p63).slice(-400));
check("a 45-column row from before stage 2 still parses, the new fields empty", p45.lcpMs === null && p45.sectionAfter.length === 0 && p45.ctaLabels.length === 0 && p45.hvacSteps === 0 && p45.country === "");
const csv63 = sessionsToCsv([p63]);
check("the sessions CSV carries the new columns", ["lcpMs", "downlink", "rttMs", "typedMs", "sectionAfter", "ctaLabels", "ctaHrefs", "ctaSpots", "hvacSteps", "hvacTiers", "country", "region", "city"].every((k) => csv63.split("\r\n")[0].includes(`"${k}"`)) && csv63.includes('"Start free, no card;See a sample"') && csv63.includes('"Austin"'));
const money = adMoney([
  { campaign: "C1", content: "A1", state: "paying" }, { campaign: "C1", content: "A1", state: "trial" }, { campaign: "C1", content: "A2", state: "trial" },
  { campaign: "C1", content: "A2", state: "lapsed" }, { campaign: "C2", content: "", state: "trial" }, { campaign: "", content: "", state: "free" }, { campaign: "", content: "A9", state: "unknown" },
], { since: new Date(TRAFFIC_SINCE_MS).toISOString(), adNames: names, visits: { A1: 30, A2: 30 }, campaignVisits: { C1: 60 } });
check("ad → money counts each ad's and campaign's accounts by state, paying first, named like the ads table", money.total.signups === 7 && money.untagged.signups === 1 && money.ads[0].key === "A1" && money.ads[0].name === "Roof · 40 s v1" && money.ads[0].paying === 1 && money.ads[0].trial === 1 && money.ads[0].visits === 30 && money.ads.find((a) => a.key === "A2")!.lapsed === 1 && money.ads.find((a) => a.key === "C2")!.name === "campaign C2" && money.ads.find((a) => a.key === "A9")!.other === 1 && money.campaigns.find((c) => c.key === "C1")!.signups === 4 && money.campaigns.find((c) => c.key === "C1")!.name === "Roofing campaign" && money.campaigns.find((c) => c.key === "C1")!.visits === 60, JSON.stringify(money.ads.map((a) => [a.key, a.signups])));
const mdMoney = analystToMarkdown({ ...result, report: mixed, money }, { timezone: "America/Los_Angeles" });
check("the Markdown carries ad → money, ads and campaigns", /## Ads → money · accounts since Sep 30, 2026/.test(mdMoney) && mdMoney.includes("| Roof · 40 s v1 | A1 | C1 | 30 | 2 | 1 | 1 | 0 | 0 |") && mdMoney.includes("| Roofing campaign | C1 | 60 | 4 | 2 | 1 | 1 | 0 |") && /7 accounts: 3 on a trial, 1 paying, 1 lapsed, 2 other; 1 carry no ad tag/.test(mdMoney), mdMoney.split("## Ads → money")[1]?.slice(0, 500));
check("ours against Ads Manager is worded as on the page", clicksDifference(88, 100) === "-12%" && clicksDifference(110, 100) === "+10%" && clicksDifference(5, undefined) === "--" && clicksDifference(5, 0) === "--");

// ── stage 3: the history, the trend, the digest email (2026-10-04)
const snap = (day: string, rep: ReturnType<typeof analyse>): AnalystSnapshot => ({ day, savedAt: `${day}T15:00:00.000Z`, fetchedAt: `${day}T15:00:00.000Z`, report: rep });
const days14 = trendDays("2026-10-04");
check("the trend covers fourteen Los Angeles days ending today, oldest first", days14.length === 14 && days14[0] === "2026-09-21" && days14[13] === "2026-10-04");
check("a snapshot row round-trips, and a row that is not one is refused", parseSnapshot(JSON.stringify(snap("2026-10-04", bouncy)))?.report.headline === bouncy.headline && parseSnapshot("{}") === null && parseSnapshot("not json") === null && snapshotKey("2026-10-04") === "analyst:2026-10-04");
const tr = trendOf([snap("2026-10-04", slowScreen), snap("2026-10-02", bouncy), snap("2026-09-01", mixed)], days14);
const tIds = (r: ReturnType<typeof analyse>) => new Set(r.findings.map((f) => f.id));
const appearedIds = slowScreen.findings.filter((f) => !tIds(bouncy).has(f.id)).map((f) => f.id).sort().join();
const goneIds = bouncy.findings.filter((f) => !tIds(slowScreen).has(f.id)).map((f) => f.id).sort().join();
check("the trend keeps the days in range, one row per finding id, tone and sample per day", tr.readings.map((r) => r.day).join() === "2026-10-02,2026-10-04" && tr.rows.length === new Set([...tIds(slowScreen), ...tIds(bouncy)]).size && tr.rows.every((r) => Object.keys(r.cells).length === 14) && tr.rows.find((r) => r.id === "bounce")!.cells["2026-10-02"]!.n === find(bouncy, "bounce")!.n && tr.rows.find((r) => r.id === "bounce")!.cells["2026-10-03"] === null);
check("appeared / gone / changed compare the last reading with the one before it, by id", !!tr.changes && tr.changes.against === "2026-10-02" && tr.changes.appeared.map((c) => c.id).sort().join() === appearedIds && tr.changes.gone.map((c) => c.id).sort().join() === goneIds && tr.changes.toneChanged.every((c) => c.from !== c.tone), JSON.stringify(tr.changes && { a: tr.changes.appeared.map((c) => c.id), g: tr.changes.gone.map((c) => c.id), t: tr.changes.toneChanged.map((c) => c.id) }));
check("rows still found in the latest reading come first, bad before warn", tr.rows.slice(0, slowScreen.findings.length).every((r) => r.cells["2026-10-04"] !== null) && tr.rows[0].tone === "bad");
check("one reading: no comparison yet", trendOf([snap("2026-10-04", bouncy)], days14).changes === null && trendOf([], days14).readings.length === 0);
const digestMd = analystToMarkdown({ ...result, report: slowScreen }, { timezone: "America/Los_Angeles" });
const digest = buildTrafficDigest({ snapshot: snap("2026-10-04", slowScreen), changes: tr.changes, markdown: digestMd, href: "https://www.jobflex.app/admin/traffic", timezone: "America/Los_Angeles" });
const fixN = slowScreen.findings.filter((f) => f.tone === "bad").length;
const html = renderEmail(digest).html;
check("the digest email: subject and kicker count FIX and WATCH, the funnel in the box, since-yesterday in the cond row", new RegExp(`^Traffic 2026-10-04: ${fixN} to fix`).test(digest.subject) && digest.kicker!.tone === "bad" && digest.box!.some((b) => b.type === "field" && b.label === "Opened the form") && digest.box!.at(-1)!.type === "cond" && digest.cta!.href.endsWith("/admin/traffic"), digest.subject);
check("the digest email carries the whole Markdown, every finding's title, evidence and action", digest.after!.join("\n\n") === digestMd.trim().split(/\n{2,}/).map((b) => b.trim()).join("\n\n") && slowScreen.findings.every((f) => html.includes(f.title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")) || html.includes(f.id)));

check("a CSV cell that a spreadsheet would run is neutralised", sessionsToCsv([sess({ utmContent: "=HYPERLINK(1)" })]).includes(`"'=HYPERLINK(1)"`));

console.log(bad ? `\n${bad} FAILED` : "\nall green");
process.exit(bad ? 1 : 0);
