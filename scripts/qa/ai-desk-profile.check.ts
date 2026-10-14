// The AI desk's profile — pure checks, no network, no database (2026-10-13).
//   npx tsx --tsconfig tsconfig.json scripts/qa/ai-desk-profile.check.ts
// What JobFlex knows → the starting profile; the model's answer checked; the questions the
// desk still has; the working instructions the live desk runs on; the stored settings.
import { ASK_FORMAT, cleanCompose, cleanProfile, composePrompt, deskInstructions, EMPTY_PROFILE, factsFor, gapQuestions, hoursWords, profileFromFacts } from "../../src/lib/aiDesk/profile";
import { parseDeskSettings } from "../../src/lib/aiDesk/shared";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const WD = { open: "08:00", close: "17:00" };
check("hours in words: weekdays grouped, the weekend closed", hoursWords([null, WD, WD, WD, WD, WD, null]) === "Mon–Fri 8 AM–5 PM · Sat–Sun closed", hoursWords([null, WD, WD, WD, WD, WD, null]));
check("…a Saturday morning on its own; nothing known reads as empty", hoursWords([null, WD, WD, WD, WD, WD, { open: "09:00", close: "12:30" }]) === "Mon–Fri 8 AM–5 PM · Sat 9 AM–12:30 PM · Sun closed" && hoursWords([null, null, null, null, null, null, null]) === "");

const facts = factsFor({
  name: "Ridgeline Roofing Co.",
  phone: "(425) 555-0100",
  address: "13620 NE 20th St, Ste L, Bellevue, WA 98005",
  website: null,
  trades: ["Roofing", "Gutters"],
  hours: [null, WD, WD, WD, WD, WD, null],
  services: [{ label: "Roof inspection and estimate", priceText: "Free" }, { label: "Leak call", priceText: "$149 leak diagnosis" }],
  bookingUrl: "https://www.jobflex.app/book/ridgeline",
  timezone: null,
});
check("the facts: city from the address, services with their prices, a default timezone", facts.city === "Bellevue" && facts.services[1] === "Leak call — $149 leak diagnosis" && facts.timezone === "America/Los_Angeles", JSON.stringify(facts));

const base = profileFromFacts(facts);
check("the starting profile greets by name, says it is a virtual assistant and that the call is recorded", /^Thanks for calling Ridgeline Roofing Co\. This is/.test(base.greeting) && /virtual assistant/.test(base.greeting) && /recorded/.test(base.greeting), base.greeting);
check("…knows the trades, the city, the hours and the booked services; never quotes a price", /Roofing, Gutters/.test(base.about) && base.serviceArea === "Bellevue and nearby" && base.hours === facts.hoursWords && base.services.length === 2 && /never quotes a price/.test(base.pricing) && base.neverSay.length === 3);
check("what it still needs: credentials only (the rest is on file)", JSON.stringify(gapQuestions(base)) === JSON.stringify(["Are you licensed and insured, and do you offer a warranty?"]), JSON.stringify(gapQuestions(base)));
check("an empty profile asks about everything", gapQuestions(EMPTY_PROFILE).length === 6);

const prompt = composePrompt("We do roofs and gutters in Bellevue and the Eastside. Licensed and insured, 10 year workmanship warranty. Free estimates, leak calls are $149. Open 7 to 5 weekdays. Emergencies: a leak during rain is urgent, book the first slot. We speak English and Spanish.", facts);
check("the prompt carries the facts and the owner's words, and asks for the profile, questions and samples", /Company: Ridgeline Roofing Co\./.test(prompt) && /«We do roofs and gutters/.test(prompt) && /"questions"/.test(prompt) && /"samples"/.test(prompt) && /virtual assistant and that the call is recorded/.test(prompt));

const composed = cleanCompose(
  {
    profile: { greeting: "Thanks for calling Ridgeline Roofing — this is our virtual assistant, and this call is recorded. How can I help?", services: ["Roof replacement", "Gutters", ""], hours: "Mon–Fri 7 AM–5 PM", pricing: "Free estimates; leak calls are $149.", credentials: "Licensed and insured; 10-year workmanship warranty.", faqs: [{ q: "Do you do free estimates?", a: "Yes — want me to book one?" }, { q: "junk" }], neverSay: ["Never quote a roof price over the phone"], languages: ["English", "Spanish"] },
    questions: ["Do you serve Seattle too?", "", 42],
    samples: [{ q: "How much is a new roof?", a: "It depends on the roof — I can book a free estimate." }],
  },
  base,
);
check("the model's answer is checked: lists tidied, a half-written FAQ dropped, the base kept where it said nothing", composed.profile.services.length === 2 && composed.profile.faqs.length === 1 && composed.profile.serviceArea === base.serviceArea && composed.profile.emergencies === base.emergencies && composed.profile.languages.join() === "English,Spanish");
check("…questions and samples tidied", composed.questions.length === 1 && composed.samples.length === 1);
check("junk from the model is the base profile and nothing else", JSON.stringify(cleanCompose("nope", base)) === JSON.stringify({ profile: base, questions: [], samples: [] }) && cleanCompose(null, base).profile.greeting === base.greeting);
check("a profile at the top level (no 'profile' key) still reads", cleanCompose({ greeting: "Hi there, virtual assistant here; recorded.", faqs: [] }, base).profile.greeting.startsWith("Hi there"));
const edited = cleanProfile({ ...composed.profile, greeting: "  Thanks for   calling.  ", services: "Roofs\nGutters\n\nSiding", neverSay: "a; b" }, EMPTY_PROFILE);
check("the form's text reads as lists, spaces tidied", edited.greeting === "Thanks for calling." && edited.services.join("|") === "Roofs|Gutters|Siding" && edited.neverSay.join("|") === "a|b");

const instr = deskInstructions(composed.profile, facts, "ANSWER");
check("the working instructions: the company, the recording, every section, the never list, booking from the calendar only", /phone assistant for Ridgeline Roofing Co\., a Roofing, Gutters company/.test(instr) && /Every call is recorded/.test(instr) && /PRICES:\nFree estimates; leak calls are \$149\./.test(instr) && /NEVER:\n- Never quote a roof price/.test(instr) && /never invent one/.test(instr) && /Speak English, Spanish/.test(instr) && /books online at https:\/\/www\.jobflex\.app\/book\/ridgeline/.test(instr));
check("…in FORWARD mode it knows the phone rang first", /nobody picked up/.test(deskInstructions({ ...composed.profile, transfer: "" }, facts, "FORWARD")));
check("the try-it box asks for JSON", /"answer"/.test(ASK_FORMAT));

const stored = parseDeskSettings(JSON.stringify({ mode: "FORWARD", brief: "We do roofs.", profile: composed.profile, profileUpdatedAt: "2026-10-13T00:00:00Z", questions: ["Do you serve Seattle too?"] }));
check("the settings keep the mode, the brief, the profile and the questions", stored.mode === "FORWARD" && stored.brief === "We do roofs." && stored.profile?.credentials === composed.profile.credentials && stored.questions.length === 1);
check("…and older settings (mode only) still read", parseDeskSettings('{"mode":"ANSWER"}').profile === null && parseDeskSettings("x").brief === "");

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
