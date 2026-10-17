// THE DESK, PRESET FOR THE TRADE (2026-10-14): what the contractor types → the trades; the preset profile from the
// trades and the company's details; the sensitive parts marked with why and their one-click fixes; presets that
// never state a price; the marks after an edit, a removed question and an AI rewrite; a model-written preset for a
// business with none; the settings round trip.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/ai-desk-presets.check.ts
import { BASIC_INTAKE, briefCoverage, cleanKnowledge, cleanProfile, composePrompt, deskInstructions, EMPTY_PROFILE, factsFor, gapQuestions, MAX_FAQS, MAX_INTAKE, type DeskProfile } from "../../../src/lib/aiDesk/profile";
import { businessFromTrades, cleanPack, cleanReview, faqKey, matchBusiness, presetProfile, pruneReview, reviewAfterCompose, TRADE_PACKS, URGENT_ACTIONS } from "../../../src/lib/aiDesk/tradePresets";
import { matchBusinessLabels, TRADES } from "../../../src/lib/aiDesk/tradeCore";
import { emailFromNotes } from "../../../src/lib/aiDesk/intakeNotes";
import { parseDeskSettings } from "../../../src/lib/aiDesk/shared";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const keys = (text: string) => matchBusiness(text).packs.map((p) => p.key).join(",");

// ── what they typed ──
check("roofing, gutters → both", keys("Roofing, gutters") === "roofing,gutters");
check("Kitchen & Bath is one trade, once", keys("Kitchen & Bath") === "remodeling");
check("bath remodels and tile → remodeling, tile", keys("bath remodels and tile") === "remodeling,tile");
check("HVAC, heat pumps → heating and cooling once", keys("HVAC, heat pumps") === "hvac");
check("outdoor lighting is electrical (and landscape lighting), not doors", keys("outdoor lighting").split(",").includes("electrical") && !keys("outdoor lighting").includes("windows"), keys("outdoor lighting"));
check("tree trimming is tree service, not trim carpentry", keys("tree trimming") === "tree-service", keys("tree trimming"));
// 2026-10-16: 44 trades. The words that used to land in the wrong one.
check("window cleaning is exterior cleaning, not windows & doors", keys("window cleaning") === "pressure-washing", keys("window cleaning"));
check("garage doors are their own trade, not windows & doors", keys("garage door repair") === "garage-doors", keys("garage door repair"));
check("carpet cleaning is cleaning, not flooring", keys("carpet cleaning") === "cleaning", keys("carpet cleaning"));
check("duct cleaning is heating and cooling, not house cleaning", keys("duct cleaning") === "hvac", keys("duct cleaning"));
check("sealcoating is paving; stone patios are masonry; mold is restoration", keys("asphalt sealcoating") === "paving" && keys("stone patios") === "masonry" && keys("mold remediation") === "restoration");
check("every trade has a pack, in the chips' order", TRADE_PACKS.length === TRADES.length && TRADE_PACKS.every((p, i) => p.key === TRADES[i].key && p.label === TRADES[i].label), `${TRADE_PACKS.length} packs, ${TRADES.length} trades`);
check("every trade's own label finds it", TRADES.every((t) => matchBusiness(t.label).packs.some((p) => p.key === t.key)), TRADES.filter((t) => !matchBusiness(t.label).packs.some((p) => p.key === t.key)).map((t) => t.label).join(", "));
check("the screen's light match agrees with the server's", ["Roofing, gutters", "tile and bath", "window cleaning", "piano moving, decks"].every((t) => matchBusinessLabels(t).packs.map((p) => p.key).join() === matchBusiness(t).packs.map((p) => p.key).join()));
check("fiberglass is not windows", !keys("fiberglass pools").includes("windows"));
const pool = matchBusiness("piano moving, decks");
check("a business with no preset is kept for the model", pool.unknown.join("|") === "piano moving" && pool.packs.map((p) => p.key).join() === "decking", JSON.stringify(pool.unknown));
check("empty or filler words → nothing", matchBusiness("").packs.length === 0 && matchBusiness("we do, and, services").unknown.length === 0);
check("the trades on file start the field, Other left out", businessFromTrades(["Roofing", "Other", "Siding"]) === "Roofing, Siding");

// ── the preset ──
const facts = factsFor({
  name: "Ridgeline Roofing Co.",
  phone: "(425) 555-0100",
  address: "13620 NE 20th St, Ste L, Bellevue, WA 98005",
  website: null,
  trades: ["Roofing"],
  hours: [null, { open: "08:00", close: "17:00" }, { open: "08:00", close: "17:00" }, { open: "08:00", close: "17:00" }, { open: "08:00", close: "17:00" }, { open: "08:00", close: "17:00" }, null],
  services: [{ label: "Roof inspection and estimate", priceText: "Free" }],
  bookingUrl: null,
  timezone: "America/Los_Angeles",
});
const { packs } = matchBusiness("roofing, gutters");
const pr = presetProfile(packs, facts);
const p = pr.profile;
const rk = pr.review.map((r) => r.key);
check("greeting: the company, a virtual assistant, recorded", /^Thanks for calling Ridgeline Roofing Co\. This is the company's virtual assistant, and this call is recorded\./.test(p.greeting), p.greeting);
const roof = TRADE_PACKS.find((t) => t.key === "roofing")!;
const gut = TRADE_PACKS.find((t) => t.key === "gutters")!;
check("about: the trades and the city on file, then what each trade does", p.about.startsWith("Ridgeline Roofing Co. is a roofing and gutter company serving Bellevue and the area around it. It ") && p.about.includes(roof.does) && p.about.includes(gut.does), p.about);
check("services from both trades, each its fair share, at most 30", p.services.includes(roof.services[0]) && p.services.includes(gut.services[0]) && p.services.length <= 30 && p.services.filter((x) => roof.services.includes(x)).length >= 10 && p.services.filter((x) => gut.services.includes(x)).length >= 10, `${p.services.length}`);
check("hours and area from the company", p.hours.startsWith("Mon–Fri 8 AM–5 PM") && p.serviceArea === "Bellevue and nearby");
check("prices: the booking page's own visit, nothing invented", /Roof inspection and estimate — Free/.test(p.pricing) && /never quotes any other price/.test(p.pricing));
check("credentials left empty — a claim only the owner makes", p.credentials === "");
check("the trade's questions, the next-times one first, financing for a big-ticket trade", p.faqs[0].q === "How soon can someone come out?" && p.faqs.some((f) => f.q === "Do you work with insurance claims?") && p.faqs.some((f) => f.q === "Do you offer financing?") && p.faqs.length <= MAX_FAQS, `${p.faqs.length}`);
check("…and what every trade's callers ask: a price on the phone, payment, a deposit, commercial work", ["Can you give me a price over the phone?", "What forms of payment do you take?", "Do you need a deposit?", "Do you do commercial work?", "Can I reschedule or cancel?"].every((q) => p.faqs.some((f) => f.q === q)));
check("emergencies: the trade's urgent calls, the action, and safety first", p.emergencies.includes(roof.urgent) && p.emergencies.includes(URGENT_ACTIONS.book.text) && /call 911/.test(p.emergencies));
check("marked to check: prices, credentials, services, area, emergencies, the claims question", ["pricing", "credentials", "services", "serviceArea", "emergencies", faqKey("Do you work with insurance claims?"), faqKey("Do you offer financing?")].every((k) => rk.includes(k)), rk.join(" | "));
check("hours on file are not marked; the plain questions are not marked", !rk.includes("hours") && !rk.includes(faqKey("How soon can someone come out?")));
check("each mark says why; prices, credentials and urgent calls have three fixes", pr.review.every((r) => r.why.length > 10) && ["pricing", "credentials", "emergencies"].every((k) => pr.review.find((r) => r.key === k)?.fixes?.length === 3));
check("the claims question's fixes: we help / we don't", pr.review.find((r) => r.key === faqKey("Do you work with insurance claims?"))?.fixes?.map((f) => f.label).join("|") === "We help with claims|We don't handle claims");
check("every urgent-call fix keeps the safety line", pr.review.find((r) => r.key === "emergencies")!.fixes!.every((f) => /call 911/.test(f.text) && f.text.includes(roof.urgent)));
check("the about line and the intake are marked to look at", rk.includes("about") && rk.includes("intake"));

// ── the intake: what the desk finds out on a call (2026-10-16) ──
check("intake: the caller's own words first, the trades' questions labelled, the facts every lead needs last", p.intake[0].startsWith("What would you like done") && p.intake.some((q) => q.startsWith("Roofing: ")) && p.intake.some((q) => q.startsWith("Gutters: ")) && /address of the job/.test(p.intake.join("\n")) && /How did you hear about us/.test(p.intake.join("\n")) && p.intake.length <= MAX_INTAKE, `${p.intake.length}`);
check("…a budget and who decides for a big-ticket trade", /budget range/.test(p.intake.join("\n")) && /part of the decision/.test(p.intake.join("\n")));
const lock = presetProfile(matchBusiness("locksmith").packs, facts).profile;
check("…no budget question for a small-ticket trade, and one trade's questions carry no label", !/budget/i.test(lock.intake.join("\n")) && !lock.intake.some((q) => q.startsWith("Locksmith: ")) && lock.intake.length > 8);
check("no intake question names a price", !TRADE_PACKS.some((t) => t.intake.some((q) => /\$\s?\d|\d+\s?dollars/i.test(q))));
const liveI = deskInstructions(p, facts, "ANSWER");
check("the live desk is told what to find out, and to put it in the notes for the team", liveI.includes("WHAT TO FIND OUT ON THE CALL") && liveI.includes("Roofing: ") && /NOTES FOR THE TEAM/.test(liveI) && /Budget/.test(liveI) && /Never ask for card or bank details/.test(liveI));
check("an older profile without an intake still asks the basics", deskInstructions({ ...p, intake: [] }, facts, "ANSWER").includes(BASIC_INTAKE[0]));
check("the intake round-trips through the form and storage", cleanProfile({ ...p, intake: ["  Is it leaking now?  ", ""] }, EMPTY_PROFILE).intake.join("|") === "Is it leaking now?" && cleanProfile({ greeting: "Hi" }, EMPTY_PROFILE).intake.length === 0);
check("the rewrite keeps the intake", composePrompt("we do roofs", facts, p).includes('"intake": [""]') && /intake: keep the current questions/.test(composePrompt("we do roofs", facts, p)));
check("an email heard on the call is read from the notes", emailFromNotes("Job: deck repair\nEmail: Dana.K@Example.com\nBudget: not sure") === "dana.k@example.com" && emailFromNotes("Job: roof; Email - sam@mail.co.") === "sam@mail.co" && emailFromNotes("Email: not given") === null && emailFromNotes(null) === null);

const bare = presetProfile(matchBusiness("electrical").packs, factsFor({ name: "Volt", phone: null, address: null, website: null, trades: [], hours: [], services: [], bookingUrl: null, timezone: null }));
check("an/a: an electrical company; no city → no area, marked as missing", bare.profile.about.startsWith("Volt is an electrical company. It ") && bare.profile.serviceArea === "" && /Not on file/.test(bare.review.find((r) => r.key === "serviceArea")!.why), bare.profile.about);
check("no hours on file → hours marked", bare.review.some((r) => r.key === "hours"));
check("no financing question for a small-ticket trade", !bare.profile.faqs.some((f) => /financing/.test(f.q)));
const typedOnly = presetProfile([], facts, ["pool resurfacing"]);
check("a business with no preset and no AI: its own words in the about line and services", /a pool resurfacing company/.test(typedOnly.profile.about) && typedOnly.profile.services.includes("Pool resurfacing"));

check("a part highlighted to check is not asked again as a question", !gapQuestions(p, new Set(rk)).some((q) => /licensed/.test(q)) && gapQuestions(p).some((q) => /licensed/.test(q)));

// Truth: presets never put a price in a caller's ear, and every fix belongs to a marked question.
const allFaqs = TRADE_PACKS.flatMap((t) => t.faqs);
check("no preset answer, fix or urgent line states a price", ![...allFaqs.map((f) => f.a), ...allFaqs.flatMap((f) => (f.fixes ?? []).map((x) => x.text)), ...TRADE_PACKS.map((t) => t.urgent)].some((t) => /\$\s?\d|\d+\s?dollars/i.test(t)));
check("every question with fixes is marked to check", allFaqs.every((f) => !f.fixes || !!f.check));
check("every trade has 12+ services, 5+ intake questions, 10+ answers, 3+ to check, and urgent words", TRADE_PACKS.every((t) => t.services.length >= 12 && t.intake.length >= 5 && t.faqs.length >= 10 && t.faqs.filter((f) => f.check).length >= 3 && t.urgent.length > 10 && t.does.length > 20), TRADE_PACKS.filter((t) => !(t.services.length >= 12 && t.intake.length >= 5 && t.faqs.length >= 10)).map((t) => t.key).join(", "));
check("no trade repeats a service or a question", TRADE_PACKS.every((t) => new Set(t.services.map((x) => x.toLowerCase())).size === t.services.length && new Set(t.faqs.map((f) => f.q.toLowerCase())).size === t.faqs.length));
check("answers are short enough to say on the phone", allFaqs.every((f) => f.a.length <= 300), allFaqs.filter((f) => f.a.length > 300).map((f) => f.q).join(" | "));
check("no preset answer claims the company is licensed, insured or the best", !allFaqs.some((f) => /\b(we are|we're) (licensed|insured|bonded|the best)\b/i.test(f.a)));
check("questions are questions", allFaqs.every((f) => f.q.trim().endsWith("?")) && TRADE_PACKS.every((t) => t.intake.every((q) => q.trim().endsWith("?"))));
for (const t of TRADE_PACKS) {
  const one = presetProfile([t], facts);
  if (one.profile.faqs.length > MAX_FAQS || !one.profile.services.length || one.profile.intake.length > MAX_INTAKE || one.profile.about.length > 800) check(`preset for ${t.label}`, false);
}
const three = presetProfile(matchBusiness("flooring, kitchen and bath, electrical").packs, facts).profile;
check("three trades fit the limits and keep every trade", three.faqs.length <= MAX_FAQS && three.services.length <= 30 && three.intake.length <= MAX_INTAKE && three.about.length <= 800 && ["Flooring: ", "Kitchen & bath: ", "Electrical: "].every((l) => three.intake.some((q) => q.startsWith(l))), `${three.faqs.length} faqs, ${three.intake.length} intake, about ${three.about.length}`);
check("every trade presets within the limits", true);

// The live desk reads the preset as its instructions.
const live = deskInstructions(p, facts, "ANSWER");
check("the desk's instructions carry the preset", /SERVICES:\n- Roof replacement/.test(live) && /QUESTIONS CALLERS ASK:/.test(live) && /PRICES:/.test(live) && !/\[|\]/.test(live));

// ── the marks over time ──
const fewer: DeskProfile = { ...p, faqs: p.faqs.filter((f) => f.q !== "Do you work with insurance claims?") };
check("a removed question takes its mark with it", !pruneReview(pr.review, fewer).some((r) => r.key === faqKey("Do you work with insurance claims?")) && pruneReview(pr.review, fewer).length === pr.review.length - 1);
check("junk marks are dropped, good ones kept with their fixes", cleanReview([{ key: "pricing", why: "Prices matter.", fixes: [{ label: "Free", text: "Free." }, { label: "", text: "x" }] }, { key: "", why: "x" }, 7, null]).length === 1 && cleanReview([{ key: "pricing", why: "Prices matter.", fixes: [{ label: "Free", text: "Free." }] }])[0].fixes?.length === 1);
const after: DeskProfile = { ...p, credentials: "Licensed, bonded and insured. 10-year workmanship warranty.", faqs: [...p.faqs, { q: "Do you do metal roofs?", a: "Yes, we install standing-seam metal roofs." }] };
const re = reviewAfterCompose(p, after, pr.review);
check("after an AI rewrite: an untouched mark stays as it was", re.find((r) => r.key === "pricing")?.why === pr.review.find((r) => r.key === "pricing")?.why);
check("…a sensitive part the AI changed is marked as its writing, fixes kept", /Written by AI/.test(re.find((r) => r.key === "credentials")?.why ?? "") && re.find((r) => r.key === "credentials")?.fixes?.length === 3);
check("…a question the AI added is marked", re.some((r) => r.key === faqKey("Do you do metal roofs?") && /Written by AI/.test(r.why)));
check("…an unchanged plain question stays unmarked", !re.some((r) => r.key === faqKey("How soon can someone come out?")));

// ── the model's preset for a business with none ──
const made = cleanPack({ noun: "Pool Service", services: ["Pool resurfacing", "Tile and coping", ""], faqs: [{ q: "How long does resurfacing take?", a: "The team gives you the timeline at the estimate.", check: "A timeline", yes: "", no: "" }, { q: "Do you drain the pool?", a: "The team goes over it at the estimate.", check: "", yes: "Yes — we drain and refill it.", no: "You drain it before we arrive." }, { q: "", a: "x" }], urgent: "A crack leaking water fast — shut the pump off.", bigTicket: true }, "pool resurfacing");
check("model preset: cleaned, every answer marked, yes/no become fixes", !!made && made.services.length === 2 && made.faqs.length === 2 && made.faqs.every((f) => !!f.check) && made.faqs[1].fixes?.length === 2 && made.noun === "pool service" && made.bigTicket === true);
check("model preset: junk → none", cleanPack({}, "x") === null && cleanPack("nope", "x") === null);
const madeI = cleanPack({ noun: "piano moving", does: "moves pianos in and out of homes.", services: ["Upright pianos"], intake: ["Upright or grand?", "Any stairs?"], faqs: [] }, "piano moving");
check("model preset: what it does and its own intake questions", madeI?.does === "moves pianos in and out of homes" && madeI.intake.join("|") === "Upright or grand?|Any stairs?");
const withModel = presetProfile([made!], facts);
check("model preset makes a profile with its questions marked", withModel.review.some((r) => r.key === faqKey("Do you drain the pool?") && r.fixes?.length === 2) && /a pool service company/.test(withModel.profile.about));

// ── the owner's words start from the preset ──
check("the rewrite prompt starts from the preset when there is one", composePrompt("We are licensed.", facts, p).includes("START FROM THESE") && composePrompt("We are licensed.", facts, p).includes("Roof replacement") && !composePrompt("We are licensed.", facts).includes("START FROM THESE"));

// ── stored ──
const round = parseDeskSettings(JSON.stringify({ mode: "ANSWER", business: "  roofing,   gutters ", review: pr.review, profile: p }));
check("settings keep the business and the marks", round.business === "roofing, gutters" && round.review.length === pr.review.length && round.review.find((r) => r.key === "pricing")?.fixes?.length === 3 && round.profile?.intake.length === p.intake.length);
check("old settings without them read as empty", parseDeskSettings(JSON.stringify({ mode: "ANSWER" })).business === "" && parseDeskSettings(JSON.stringify({ mode: "ANSWER" })).review.length === 0);

// ── the business, described → the professional write-up ──
const written = cleanKnowledge("What we do:\r\n  Ridgeline   replaces roofs.  \n\n\n\nWarranty:\n10-year workmanship warranty.");
check("the write-up keeps its paragraphs and lines, tidies the rest", written === "What we do:\nRidgeline replaces roofs.\n\nWarranty:\n10-year workmanship warranty.", JSON.stringify(written));
check("…and is capped", cleanKnowledge("x".repeat(9000)).length === 6000 && cleanKnowledge(42) === "");
check("a profile carries it; an old one without it reads as empty", cleanProfile({ ...p, knowledge: written }, EMPTY_PROFILE).knowledge === written && cleanProfile({ greeting: "Hi" }, EMPTY_PROFILE).knowledge === "");
const cov = Object.fromEntries(briefCoverage("We replace roofs in Bellevue and Kirkland, open 7am to 5pm weekdays. Free estimates. GAF shingles, 10 year warranty, licensed and insured.").map((c) => [c.key, c.covered]));
check("covered so far: what they said ticks, what they didn't doesn't", cov.services && cov.area && cov.hours && cov.prices && cov.warranty && cov.credentials && cov.materials && !cov.payment && !cov.emergencies, JSON.stringify(cov));
check("an empty description covers nothing", briefCoverage("").every((c) => !c.covered));
const withKnow = deskInstructions({ ...p, knowledge: written }, facts, "ANSWER");
check("the live desk answers from the write-up", withKnow.includes("WHAT THE COMPANY TOLD YOU ABOUT ITSELF") && withKnow.includes("10-year workmanship warranty") && withKnow.indexOf("WHAT THE COMPANY TOLD YOU") < withKnow.indexOf("SERVICES:"));
check("no write-up, no empty section", !deskInstructions(p, facts, "ANSWER").includes("WHAT THE COMPANY TOLD YOU"));
const cp = composePrompt("we do roofs, 10 yr warranty", facts, p);
check("the AI is asked to correct the owner's words into the write-up, inventing nothing", /knowledge: the owner's words, corrected and written up professionally/.test(cp) && /never invent a fact or a price/.test(cp) && cp.includes('"knowledge": ""'));
const reK = reviewAfterCompose(p, { ...p, knowledge: written }, pr.review);
check("an AI-written write-up is highlighted to read once", /read it through once/.test(reK.find((r) => r.key === "knowledge")?.why ?? ""));
check("…an unchanged one is not", !reviewAfterCompose({ ...p, knowledge: written }, { ...p, knowledge: written }, []).some((r) => r.key === "knowledge"));

if (bad) {
  console.log(`\n${bad} FAILED`);
  process.exit(1);
}
console.log("\nall passed");
