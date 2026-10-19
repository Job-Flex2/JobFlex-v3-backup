// The ad landing's first screen (2026-10-04, roofing): the section order the
// page, the tracker and the analyst share (lib/landing-sections), the ads'
// opening lines behind `?hook=` (landing-variants LANDING_HOOKS) and the
// price the hero reads from the plan catalogue (landing-e/hero-price).
// Pure functions only. Static imports (tsx has no top-level await).
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/landing-ad-screen.check.ts
import { LANDING_SECTIONS, LANDING_SECTION_KEYS, OWN_ORDER_LANDINGS, hasOwnSectionOrder, landingSectionOrder, landingSectionsFor } from "../../../src/lib/landing-sections";
import { DEFAULT_LANDING, LANDING_HOOKS, LANDING_VARIANTS, baseVariant, hookContent, hooksOf, landingVersion, resolveLandingHook, resolveLandingVariant, signupHref, variantContent, withHook, type LandingVariantKey } from "../../../src/components/v3/landing-e/landing-variants";
import { cheapestPlanWith, heroPriceLine, type PricedPlan } from "../../../src/components/v3/landing-e/hero-price";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };

// ── the order
const roof = landingSectionOrder("roofing");
check("every landing but roofing, HVAC and fencing is laid out in the list's own order", landingSectionOrder(undefined) === LANDING_SECTION_KEYS && landingSectionOrder("default") === LANDING_SECTION_KEYS && landingSectionOrder("decking") === LANDING_SECTION_KEYS && landingSectionOrder("painting") === LANDING_SECTION_KEYS && !hasOwnSectionOrder("decking") && !hasOwnSectionOrder("") && !hasOwnSectionOrder(null));
const fe = landingSectionOrder("fencing");
check("fencing: the estimators under the hero, the comparison right before the pricing", fe[0] === "hero" && fe[1] === "showcase" && fe.indexOf("compare") === fe.indexOf("pricing") - 1 && fe.length === LANDING_SECTION_KEYS.length && LANDING_SECTION_KEYS.every((k) => fe.filter((x) => x === k).length === 1), fe.join(" → "));
const hv = landingSectionOrder("hvac");
check("HVAC: the estimators under the hero, then its service book, the comparison right before the pricing", hv[0] === "hero" && hv[1] === "showcase" && hv[2] === "hvac" && hv.indexOf("compare") === hv.indexOf("pricing") - 1 && hv.length === LANDING_SECTION_KEYS.length && LANDING_SECTION_KEYS.every((k) => hv.filter((x) => x === k).length === 1), hv.join(" → "));
check("roofing puts the estimators directly under the hero and the comparison right before the pricing", roof[0] === "hero" && roof[1] === "showcase" && roof.indexOf("compare") === roof.indexOf("pricing") - 1 && roof.indexOf("compare") > roof.indexOf("stats") && roof.indexOf("compare") > roof.indexOf("built") && roof[roof.length - 1] === "final", roof.join(" → "));
check("roofing's order is the same sections, each once", roof.length === LANDING_SECTION_KEYS.length && LANDING_SECTION_KEYS.every((k) => roof.filter((x) => x === k).length === 1));
check("the sections come back whole in that order, for the tracker and the analyst", landingSectionsFor("roofing").map((s) => s.key).join() === roof.join() && landingSectionsFor("roofing")[1].label === "Estimators" && landingSectionsFor("painting") === LANDING_SECTIONS);
check("a visit from before the order went live is read in the usual order; one after it, in roofing's", hasOwnSectionOrder("roofing") && !hasOwnSectionOrder("roofing", Date.parse("2026-10-04T12:00:00Z")) && hasOwnSectionOrder("roofing", Date.parse("2026-10-06T00:00:00Z")) && !hasOwnSectionOrder("painting", Date.parse("2026-10-06T00:00:00Z")));
check("the comparison is found by its content-visibility box when a landing moves it down, else by its id", LANDING_SECTIONS.find((s) => s.key === "compare")!.selector.join() === ".lp-cv--compare,#compare");
check("an inherited name is not a landing", !hasOwnSectionOrder("constructor") && !hasOwnSectionOrder("__proto__") && !hasOwnSectionOrder("toString") && landingSectionOrder("constructor") === LANDING_SECTION_KEYS);

// ── the scope: roofing only
const adScreens = (Object.keys(LANDING_VARIANTS) as LandingVariantKey[]).filter((k) => { const v = LANDING_VARIANTS[k]; return !!v && (v.shotCta || v.playOnPhone || v.priceFeature || v.priceNote); });
const AD_LANDINGS = "fencing,hvac,roofing";
// The Deck Studio's page took the price line and the button under its shot on 2026-10-11 (lib/editions, owner);
// HVAC v2 (2026-10-19) is HVAC's page — its first screen, its order — and reads hvac's hooks.
check("the roofing, HVAC (and HVAC v2) and fence landings (and the Deck Studio's) take the ad's first screen; roofing, HVAC and fencing have the hooks; they and HVAC v2 an order of their own", [...adScreens].sort().join() === "decking,fencing,hvac,hvac2,roofing" && Object.keys(LANDING_HOOKS).sort().join() === AD_LANDINGS && [...OWN_ORDER_LANDINGS].sort().join() === "fencing,hvac,hvac2,roofing", adScreens.join());
check("the default hero and every other trade's are as they were", DEFAULT_LANDING.h1.join(" ") === "Turn your trade into a business." && !("shotCta" in DEFAULT_LANDING) && !variantContent("siding").shotCta && !variantContent("painting").priceFeature && !variantContent("kitchen-bath").playOnPhone);
check("fencing keeps the owner's own headline, line and button when the link carries no hook", variantContent("fencing").h1.join(" ") === "Still Driving to the Job Site Just to Measure a Fence?" && variantContent("fencing").heroCta === "Create My Free Estimate →" && variantContent("fencing").shotCta === true && variantContent("fencing").playOnPhone === true);
check("HVAC keeps the owner's own headline, line and button when the link carries no hook", variantContent("hvac").h1.join(" ") === "Turn an Address Into a Complete HVAC Estimate — in Seconds." && variantContent("hvac").subStrong === "No unnecessary drive. No hours of calculations." && variantContent("hvac").heroCta === "Build My First Estimate →" && variantContent("hvac").shotCta === true);
check("roofing keeps the owner's own headline and button when the link carries no hook", variantContent("roofing").h1.join(" ") === "Complete Roof Report & Proposal — in Seconds." && variantContent("roofing").heroCta === "Get My First Roofing Report & Proposal →" && variantContent("roofing").priceFeature === "Roof estimator");

// ── the hooks
check("a hook key resolves whatever its case, spaces or underscores", resolveLandingHook("roofing", "no-report") === "no-report" && resolveLandingHook("roofing", " No_Report ") === "no-report" && resolveLandingHook("roofing", "NO REPORT") === "no-report" && resolveLandingHook("roofing", ["two-prices", "hours"]) === "two-prices");
check("an unknown key, free text, or a hook on a trade without a table is the trade's own hero", resolveLandingHook("roofing", "free-money") === undefined && resolveLandingHook("roofing", "Call 1-800 now for a refund") === undefined && resolveLandingHook("roofing", "") === undefined && resolveLandingHook("roofing", undefined) === undefined && resolveLandingHook("fencing", "no-report") === undefined && resolveLandingHook(undefined, "no-report") === undefined);
check("an inherited name is not a hook", resolveLandingHook("roofing", "constructor") === undefined && resolveLandingHook("roofing", "__proto__") === undefined && resolveLandingHook("roofing", "toString") === undefined && hookContent("roofing", "constructor") === undefined && hookContent("roofing", "hasOwnProperty") === undefined);
const hooked = withHook(variantContent("roofing"), hookContent("roofing", "no-report"));
check("a hook changes the two headline lines and the line under them, nothing else", hooked.h1.join(" | ") === "Stop Buying Roof Reports. | Stop Retyping Them." && /no PDF to order, no hours to wait\.$/.test(hooked.sub ?? "") && hooked.h1Break === true && hooked.h1Long === true && hooked.heroCta === "Get My First Roofing Report & Proposal →" && hooked.visual === "roof" && hooked.showcaseSlide === "roof" && hooked.priceFeature === "Roof estimator" && hooked.playOnPhone === true && hooked.shotCta === true && hooked.primaryCta === variantContent("roofing").primaryCta);
check("no hook, no change: the very same hero", withHook(variantContent("roofing"), undefined) === variantContent("roofing") && withHook(variantContent("roofing"), hookContent("roofing", "nope")) === variantContent("roofing"));
check("a trade's bold third line belongs to its own copy and goes when a hook takes the headline", withHook(variantContent("hvac"), { h1: ["A.", "B."], sub: "C.", ad: "x" }).subStrong === undefined);
const all = hooksOf("roofing");
check("every roofing ad has its opening line: twelve hooks, slug keys, two lines, a line under them, the ad named", all.length === 12 && all.every((h) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(h.key) && h.h1.length === 2 && h.h1.every((l) => l.trim().length >= 6 && /[.?]$/.test(l)) && h.sub.length >= 40 && h.sub.length <= 170 && /[.]$/.test(h.sub) && h.ad.length > 4), all.filter((h) => h.sub.length > 170 || h.sub.length < 40).map((h) => `${h.key}:${h.sub.length}`).join());
check("the headline lines are distinct, so two ads never share a first screen", new Set(all.map((h) => h.h1.join(" "))).size === all.length);
// The trial's terms and the price are the page's own lines, decided by the flag and the catalogue — a hook never states them.
const TERMS = /credit card|no card|free trial|\$\s?\d|per month|\/mo\b|instant|guarantee|#1|best/i;
check("no hook states the trial's terms, a price or a superlative — those lines are the page's own", all.every((h) => !TERMS.test(`${h.h1.join(" ")} ${h.sub}`)), all.filter((h) => TERMS.test(`${h.h1.join(" ")} ${h.sub}`)).map((h) => h.key).join());
check("hooksOf is empty for a trade without a table and for no trade", hooksOf("painting").length === 0 && hooksOf(undefined).length === 0);

// ── the fence hooks: each fence ad's on-screen opening line
const feAll = hooksOf("fencing");
check("every fence ad has its opening line: three hooks, slug keys, two lines, a line under them", feAll.length === 3 && feAll.every((h) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(h.key) && h.h1.length === 2 && h.h1.every((l) => l.trim().length >= 6) && /[.?]$/.test(h.h1[1]) && h.sub.length >= 40 && h.sub.length <= 170 && /[.]$/.test(h.sub)), feAll.map((h) => `${h.key}:${h.sub.length}`).join());
check("no fence hook states the trial's terms, a price or a superlative, or promises texting", feAll.every((h) => !TERMS.test(`${h.h1.join(" ")} ${h.sub}`) && !/\btext/i.test(h.sub)), feAll.filter((h) => TERMS.test(`${h.h1.join(" ")} ${h.sub}`)).map((h) => h.key).join());
check("the three tables never share a key", resolveLandingHook("fencing", "slope") === "slope" && resolveLandingHook("roofing", "slope") === undefined && resolveLandingHook("hvac", "slope") === undefined && resolveLandingHook("fencing", "no-report") === undefined && resolveLandingHook("fencing", "tonnage") === undefined);
const feHooked = withHook(variantContent("fencing"), hookContent("fencing", "slope"));
check("a fence hook replaces the two lines, keeps the button, the shot and the price row", feHooked.h1.join(" | ") === "Yards Aren't Flat. | Your Bids Shouldn't Be." && feHooked.heroCta === "Create My Free Estimate →" && feHooked.visual === "fence" && feHooked.priceFeature === "Fence estimator");

// ── the HVAC hooks: the ads' own opening lines, inside the claims review
const hvAll = hooksOf("hvac");
check("every HVAC ad on air has its opening line: eight hooks, slug keys, two lines (one sentence may run over both, as the ad sets it), a line under them", hvAll.length === 8 && hvAll.every((h) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(h.key) && h.h1.length === 2 && h.h1.every((l) => l.trim().length >= 6) && /[.?]$/.test(h.h1[1]) && h.sub.length >= 40 && h.sub.length <= 170 && /[.]$/.test(h.sub)), hvAll.filter((h) => h.sub.length > 170 || h.sub.length < 40).map((h) => `${h.key}:${h.sub.length}`).join());
check("no HVAC hook states the trial's terms, a price or a superlative", hvAll.every((h) => !TERMS.test(`${h.h1.join(" ")} ${h.sub}`)), hvAll.filter((h) => TERMS.test(`${h.h1.join(" ")} ${h.sub}`)).map((h) => h.key).join());
// The claims review (advertisement/hvac*/README): no duct or airflow diagram, the load is "Manual J-based", not ACCA-approved,
// code rules only where they exist, no plans while they are early access, emailed not texted.
const HV_FALSE = /diagram|duct design|ACCA|approved|every state|your state's code|service plan|membership|agreement|text(ed|s)? (the|your) (client|homeowner)|automatic(ally)? order/i;
check("no HVAC hook claims what the app does not do", hvAll.every((h) => !HV_FALSE.test(`${h.h1.join(" ")} ${h.sub}`)) && hvAll.filter((h) => /Manual J/.test(h.sub)).every((h) => /Manual J-based/.test(h.sub)), hvAll.filter((h) => HV_FALSE.test(`${h.h1.join(" ")} ${h.sub}`)).map((h) => h.key).join());
check("the HVAC and roofing tables never share a key, and a roofing key is no HVAC hook", resolveLandingHook("hvac", "tonnage") === "tonnage" && resolveLandingHook("hvac", "no-report") === undefined && resolveLandingHook("roofing", "tonnage") === undefined);
const hvHooked = withHook(variantContent("hvac"), hookContent("hvac", "tonnage"));
check("an HVAC hook replaces the two lines and the bold third line, keeps the button and the window", hvHooked.h1.join(" | ") === "Still Sizing by the Square Foot? | Stop Guessing Tonnage." && hvHooked.subStrong === undefined && hvHooked.heroCta === "Build My First Estimate →" && hvHooked.visual === "hvac" && hvHooked.shotCta === true);

// ── HVAC v2 (?industry=hvac2, 2026-10-19): HVAC's page, the film in the shot's place and the trial button's own words
check("hvac2 is reached by its key and by hvac-v2; every HVAC spelling is still the HVAC page", resolveLandingVariant("hvac2") === "hvac2" && resolveLandingVariant("HVAC-V2") === "hvac2" && resolveLandingVariant("hvac") === "hvac" && resolveLandingVariant("HVAC") === "hvac" && resolveLandingVariant("heating") === "hvac" && resolveLandingVariant("hvac-contractor") === "hvac");
check("hvac2 is a version of hvac; no other page is a version", baseVariant("hvac2") === "hvac" && landingVersion("hvac2") === "hvac2" && baseVariant("hvac") === "hvac" && landingVersion("hvac") === undefined && landingVersion(undefined) === undefined && baseVariant(undefined) === undefined);
check("hvac2 signs up as HVAC and names itself; HVAC's link is as it was", signupHref("/auth/register", { industry: "hvac2", utm: { utm_source: "fb" }, fbclid: "Ab_1" }) === "/auth/register?industry=hvac&landing=hvac2&utm_source=fb&fbclid=Ab_1" && signupHref("/auth/register", { industry: "hvac", utm: { utm_source: "fb" }, fbclid: "Ab_1" }) === "/auth/register?industry=hvac&utm_source=fb&fbclid=Ab_1" && signupHref("/auth/register", {}) === "/auth/register");
check("hvac2 opens on hvac's ad hooks", resolveLandingHook("hvac2", "tonnage") === "tonnage" && hookContent("hvac2", "tonnage") === hookContent("hvac", "tonnage") && hooksOf("hvac2").length === hooksOf("hvac").length && resolveLandingHook("hvac2", "no-report") === undefined);
check("hvac2 is HVAC's page in HVAC's order", landingSectionOrder("hvac2").join() === landingSectionOrder("hvac").join() && landingSectionsFor("hvac2").map((x) => x.key).join() === landingSectionOrder("hvac").join() && landingSectionOrder("hvac").join() === "hero,showcase,hvac,montage,proposals,portal,crew,integrations,stats,built,compare,pricing,faq,final");
const h2v = variantContent("hvac2"), hvc = variantContent("hvac");
const { visual: h2Visual, trialCtaTitle: h2Title, ...h2Rest } = h2v;
const { visual: hvVisual, ...hvRest } = hvc;
check("hvac2 is hvac's hero with two changes: the film in the shot's place and the trial button's words", JSON.stringify(h2Rest) === JSON.stringify(hvRest) && h2Visual === "hvac-video" && h2Title === true && hvVisual === "hvac" && hvc.trialCtaTitle === undefined);
const h2Hooked = withHook(h2v, hookContent("hvac2", "tonnage"));
check("an ad hook on hvac2 changes the headline as on hvac and keeps the film and the button's words", h2Hooked.h1.join(" | ") === hvHooked.h1.join(" | ") && h2Hooked.sub === hvHooked.sub && h2Hooked.visual === "hvac-video" && h2Hooked.trialCtaTitle === true);

// ── the price
const plan = (slug: string, priceCents: number, features: string[]): PricedPlan => ({ slug, priceCents, isFree: priceCents === 0, features });
const live = [plan("starter", 4500, ["Proposal management", "CRM", "1 user"]), plan("professional", 9500, ["Everything in Starter", "Smart proposal generation", "Roof estimator", "Fence estimator"]), plan("advanced", 19900, ["Everything in Professional", "Video estimator"])];
check("the hero's price is the cheapest plan that carries the roof estimator — not the cheapest plan", cheapestPlanWith(live, "Roof estimator")?.slug === "professional" && heroPriceLine(variantContent("roofing"), live) === "Then from $95/mo · roof estimator included", String(heroPriceLine(variantContent("roofing"), live)));
check("a plan that rolls the row up from the one under it carries it too, and the cheaper of two carrying it wins", cheapestPlanWith(live, "roof estimator")?.slug === "professional" && cheapestPlanWith([...live].reverse().map((p) => ({ ...p, features: p.slug === "advanced" ? ["Roof estimator"] : p.features })), "Roof estimator")?.priceCents === 9500);
check("a flat list of rows reads the same as a rolled-up one", heroPriceLine(variantContent("roofing"), [plan("starter", 4500, ["CRM"]), plan("professional", 9500, ["CRM", "Roof estimator"]), plan("advanced", 19900, ["CRM", "Roof estimator", "Video estimator"])]) === "Then from $95/mo · roof estimator included");
check("no plan on sale carries the row, an empty catalogue, or a free plan that does: no price line", heroPriceLine(variantContent("roofing"), [plan("starter", 4500, ["CRM"])]) === null && heroPriceLine(variantContent("roofing"), []) === null && heroPriceLine(variantContent("roofing"), [plan("free", 0, ["Roof estimator"])]) === null);
check("a landing that names no plan row shows no price", heroPriceLine(variantContent("painting"), live) === null && heroPriceLine(DEFAULT_LANDING, live) === null);
check("fencing's price is the cheapest plan that carries the fence estimator", heroPriceLine(variantContent("fencing"), live) === "Then from $95/mo · fence estimator included", String(heroPriceLine(variantContent("fencing"), live)));
check("cents show when the price has them", heroPriceLine({ priceFeature: "Roof estimator" }, [plan("pro", 9550, ["Roof estimator"])]) === "Then from $95.50/mo");
check("HVAC prints no price while no plan card names the HVAC estimator (today's catalogue)", heroPriceLine(variantContent("hvac"), live) === null);
check("…and reads it like roofing's once /admin/plans gives the plans that row", heroPriceLine(variantContent("hvac"), [plan("starter", 4500, ["CRM", "HVAC estimator"]), plan("professional", 9500, ["Everything in Starter", "Roof estimator"])]) === "Then from $45/mo · HVAC estimator included" && heroPriceLine(variantContent("hvac"), [plan("starter", 4500, ["CRM"]), plan("professional", 9500, ["Everything in Starter", "HVAC estimator"])]) === "Then from $95/mo · HVAC estimator included");

console.log(bad ? `\n${bad} FAILED` : "\nall green");
process.exit(bad ? 1 : 0);
