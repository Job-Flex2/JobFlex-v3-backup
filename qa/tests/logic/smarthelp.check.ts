// SmartHelp pure core: guide order, step gating, page registry vs real routes; the AI answer contract, the prompts and
// the person-topic guard (Task 4). Pure: no model, no database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/smarthelp.check.ts
import { createHash } from "node:crypto";
import { HELP_PAGES, isHelpPage, pathOf } from "../../../src/lib/smarthelp/pages";
import { guideCards, stepView } from "../../../src/lib/smarthelp/view";
import type { Guide, HelpContext, SetupState } from "../../../src/lib/smarthelp/types";
import {
  PERSON_REPLY,
  cleanAnswer,
  helpTargets,
  personTopic,
  smartHelpAnswerSchema,
  smartHelpSystemPrompt,
  smartHelpUserPrompt,
  type SmartHelpAnswer,
} from "../../../src/lib/smarthelp/answer";
import { GUIDES, GUIDE_TARGETS } from "../../../src/lib/smarthelp/guides";
import { customerHandbook } from "../../../src/lib/smarthelp/knowledge";
import { PERSON_ONLY_TOPICS, SUPPORT_AI_RULES } from "../../../src/lib/support/aiReply";
import { NAV_SECTIONS, flattenNavItems } from "../../../src/components/v3/blueprint-shell/nav-map";
import { appRoutes, isRealRoute } from "../../lib/appRoutes";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}

const setup: SetupState = {
  profile: false, aiDesk: false, texting: false, payments: false,
  booking: false, website: false, team: false, proposalSent: false,
};
const ctx: HelpContext = {
  role: "OWNER", plan: null, lockedHrefs: [], setup,
  features: { booking: true, website: true }, page: "/dashboard",
};
const g = (id: string, group: "setup" | "how", extra: Partial<Guide> = {}): Guide =>
  ({ id, title: id, group, icon: "Sparkles", steps: [], ...extra });

const guides: Guide[] = [
  g("s-done", "setup", { needs: "profile" }),
  g("s-todo1", "setup", { needs: "aiDesk" }),
  g("s-none", "setup"),
  g("s-todo2", "setup", { needs: "texting" }),
  g("h1", "how"),
  g("s-book", "setup", { needs: "booking", feature: "booking" }),
  g("h2", "how"),
];
const c1 = { ...ctx, setup: { ...setup, profile: true } };
const ids = guideCards(guides, c1).map((c) => `${c.id}:${c.state}`);
check("guideCards order", ids.join() === "s-todo1:todo,s-todo2:todo,s-book:todo,s-none:none,s-done:done,h1:none,h2:none", ids);
const off = guideCards(guides, { ...c1, features: { booking: false, website: true } }).map((c) => c.id);
check("feature guide absent when off", !off.includes("s-book"), off);

const open = "/dashboard/phone?tab=settings";
check("INSTALLER blocked by role", stepView({ text: "x", open }, { ...ctx, role: "INSTALLER" }).blocked === "role");
check("OWNER not blocked", stepView({ text: "x", open }, ctx).blocked === undefined);
check("plan-locked page", stepView({ text: "x", open }, { ...ctx, lockedHrefs: ["/dashboard/phone"] }).blocked === "plan");
check("step without open untouched", stepView({ text: "x", show: "a" }, { ...ctx, role: "INSTALLER" }).blocked === undefined);

const routes = appRoutes();
const unreal = HELP_PAGES.filter((p) => !isRealRoute(pathOf(p.path), routes)).map((p) => p.path);
check("every HELP_PAGES path is a real route", unreal.length === 0, unreal);
check("HELP_PAGES paths unique", new Set(HELP_PAGES.map((p) => p.path)).size === HELP_PAGES.length);
check("isRealRoute [id] wildcard", isRealRoute("/dashboard/clients/abc", routes));
check("isRealRoute rejects invented", !isRealRoute("/dashboard/ai-desk", routes));
check("isHelpPage settings pane", isHelpPage("/dashboard/settings?pane=payments"));
check("isHelpPage invented", !isHelpPage("/dashboard/ai-desk"));
check("isHelpPage unlisted pane", !isHelpPage("/dashboard/settings?pane=nope"));
check("pathOf strips query+hash", pathOf("/a/b?x=1#h") === "/a/b");

// ── Task 4: the answer contract, the prompts, the person-topic guard ─────────
const expectTopic = (topic: ReturnType<typeof personTopic>, qs: string[]) => {
  const wrong = qs.filter((q) => personTopic(q) !== topic).map((q) => `${q} → ${personTopic(q)}`);
  check(`personTopic → ${topic}`, wrong.length === 0, wrong);
};
expectTopic("leaving", [
  "how do I cancel", "stop charging my card", "downgrade my plan", "cancelar mi suscripción", "close my account",
  "How do I cancel my subscription?", "I want to cancel.", "cancel my JobFlex account", "pause my subscription",
  "switch me to the free plan", "quiero darme de baja", "Cancelar mi suscripcion por favor", "how do I stop paying for this",
  "turn off auto-renew", "отменить подписку", "cancel the Deck Studio add-on", "Quiero cancelar",
]);
expectTopic("money", [
  "I want my money back", "can I get a discount on my bill", "refund please", "I was charged twice",
  "quiero un reembolso", "can you give me a credit on my account", "I'll file a chargeback", "devuélvanme mi dinero",
]);
expectTopic("data", ["delete everything", "delete my account", "borrar mi cuenta", "erase all my data", "удалить мой аккаунт"]);
expectTopic("security", ["someone logged into my account", "I think I was hacked", "my password is hunter22", "alguien entró a mi cuenta", "here is my card 4242 4242 4242 4242"]);
expectTopic("person", [
  "let me talk to a human", "can I speak to a real person", "quiero hablar con una persona", "transfer ownership to my partner",
  "make Maria the owner", "my lawyer will hear about this", "this is a scam", "this app is a rip off", "add another owner",
  "Хочу поговорить с человеком",
]);
expectTopic(null, [
  "how do I send a proposal by text", "add a discount line to a proposal", "change my credit card",
  "delete a line item", "how do I cancel a job", "cancel an appointment", "how do I cancel a visit on the calendar",
  "cancelar una cita", "how do clients cancel their booking", "how do I cancel a client's service plan",
  "how do I change my password", "upgrade my plan", "switch to annual", "delete a proposal", "my card was declined",
  "how do I get paid by credit card", "add a discount to the invoice", "unsubscribe a client from reminders",
  "how do I talk to my team", "how do I use a referral code", "make Maria a manager", "someone on my team can't log into my account",
  "delete everything on this proposal", "how do I set up the AI desk", "Cancel my plan set download", "How do I cancel an invoice I sent?",
  "¿Cómo cancelo una visita?", "my phone number is 801 555 1234", "how do my clients talk to someone after hours", "how do I pause a job",
  "¿Cómo devuelvo una llamada?", "Sue from my team can't log in", "make sure the owner gets the texts", "go to the free roof estimator",
  "I don't need the plan set", "can my clients get credit through financing", "call 801 555 1234 or 801 555 4321",
  "change the owner's phone number", "how do I talk to people who visit my website", "how do I stop taking card payments",
]);
check("PERSON_REPLY has a line for every topic, each pointing at Ask a person",
  (["leaving", "money", "data", "security", "person"] as const).every((t) => PERSON_REPLY[t].includes("Ask a person")));

// The NEVER topics moved out of SUPPORT_AI_RULES and back in: the support rules must read exactly as before. Pinned at
// the extraction (2026-10-29) to the text at origin/main 646ab9eb — length + sha256 computed before the edit. A
// deliberate change to the support rules updates this pin.
check("SUPPORT_AI_RULES byte-identical after the extraction",
  SUPPORT_AI_RULES.length === 6809 && createHash("sha256").update(SUPPORT_AI_RULES, "utf8").digest("hex") === "0014eadd6ebcbfc8bcd117c130a30e3c455e8843b87f0fd89743661ff61e135a",
  SUPPORT_AI_RULES.length);
check("SUPPORT_AI_RULES carries PERSON_ONLY_TOPICS under NEVER",
  PERSON_ONLY_TOPICS.length > 100 && SUPPORT_AI_RULES.indexOf(PERSON_ONLY_TOPICS) > SUPPORT_AI_RULES.indexOf("NEVER ("));

// The schema mends junk instead of refusing it.
const junk = smartHelpAnswerSchema.parse({ kind: "nonsense", steps: "x", confidence: 140 });
check("junk mended: kind unknown, steps [], confidence 100", junk.kind === "unknown" && junk.steps.length === 0 && junk.confidence === 100, junk);
check("junk mended: language en, title empty, note null", junk.language === "en" && junk.title === "" && junk.note === null, junk);
const mended = smartHelpAnswerSchema.parse({
  language: " es ", kind: "steps", title: "t".repeat(200), note: "n".repeat(900), confidence: 87.4,
  steps: [{ text: " Open Proposals ", open: " /dashboard/proposals ", show: "" }, "Press New proposal", { text: "" }, 7, ...Array(9).fill({ text: "s".repeat(500) })],
});
check("clean answer keeps its fields (trimmed, rounded)", mended.language === "es" && mended.kind === "steps" && mended.confidence === 87, mended.language);
check("title ≤120, note ≤600", mended.title.length === 120 && mended.note?.length === 600);
check("steps: ≤8, text ≤400, a string step mended, empty/junk steps dropped",
  mended.steps.length === 8 && mended.steps[0].text === "Open Proposals" && mended.steps[1].text === "Press New proposal" && mended.steps[2].text.length === 400,
  mended.steps.map((s) => s.text.slice(0, 20)));
check("a step's open trimmed, an empty show left out",
  mended.steps[0].open === "/dashboard/proposals" && !("show" in mended.steps[0]) && !("open" in mended.steps[1]), mended.steps[0]);

// cleanAnswer: only real pages, only known targets, nothing below 60% sure, no money or data said, roles respected.
const targets = helpTargets();
const ans = (a: Partial<SmartHelpAnswer>): SmartHelpAnswer =>
  ({ language: "en", kind: "steps", title: "Set up the AI desk", steps: [], note: null, confidence: 90, ...a });
const business = "/dashboard/phone?tab=settings&step=business";
const clean = cleanAnswer(ans({
  steps: [
    { text: "Open the AI desk", open: "/dashboard/ai-desk" },
    { text: "Press Preset the desk", open: business, show: "not-a-target" },
    { text: "Type your trade", open: business, show: "ai-desk:kind" },
    { text: "Press Proposals in the sidebar", show: "nav:/dashboard/proposals" },
    { text: "Press Nowhere", show: "nav:/dashboard/nowhere" },
  ],
}), ctx, targets);
check("an invented page: text kept, open dropped", clean.steps[0].text === "Open the AI desk" && !("open" in clean.steps[0]), clean.steps[0]);
check("an invented target: show dropped, open kept", clean.steps[1].open === business && !("show" in clean.steps[1]), clean.steps[1]);
check("a real page + target kept", clean.steps[2].open === business && clean.steps[2].show === "ai-desk:kind", clean.steps[2]);
check("a sidebar row target kept; an invented one dropped", clean.steps[3].show === "nav:/dashboard/proposals" && !("show" in clean.steps[4]));
check("kind and title kept on a sure answer", clean.kind === "steps" && clean.title === "Set up the AI desk" && clean.steps.length === 5);
const unsure = cleanAnswer(ans({ confidence: 55, steps: [{ text: "x", open: "/dashboard" }] }), ctx, targets);
check("confidence 55 → unknown, no steps", unsure.kind === "unknown" && unsure.steps.length === 0 && unsure.title.length > 0, unsure);
const money = cleanAnswer(ans({ steps: [{ text: "We'll refund last month to your card." }] }), ctx, targets);
check("a step that commits money → person, no steps", money.kind === "person" && money.steps.length === 0 && !/refund/i.test(`${money.title}${money.note}`), money);
const dataNote = cleanAnswer(ans({ kind: "explain", note: "We will delete your account today.", steps: [] }), ctx, targets);
check("a note that commits data → person", dataNote.kind === "person" && !/delete/i.test(`${dataNote.title}${dataNote.note}`), dataNote);
const cancelSteps = cleanAnswer(ans({ steps: [{ text: "Open Settings → Billing" }, { text: "Press Manage subscription, then Cancel subscription." }] }), ctx, targets);
check("steps that name the cancel button → person", cancelSteps.kind === "person" && cancelSteps.steps.length === 0, cancelSteps);
const modelPerson = cleanAnswer(ans({ kind: "person", title: "Una persona te ayudará", note: "Pulsa Ask a person.", steps: [{ text: "x" }] }), ctx, targets);
check("the model's own person reply: its words kept, never steps", modelPerson.kind === "person" && modelPerson.steps.length === 0 && modelPerson.title === "Una persona te ayudará", modelPerson);
const modelUnknown = cleanAnswer(ans({ kind: "unknown", steps: [{ text: "x" }] }), ctx, targets);
check("unknown never carries steps", modelUnknown.kind === "unknown" && modelUnknown.steps.length === 0);
const emptySteps = cleanAnswer(ans({ steps: [], note: "It works on phones too." }), ctx, targets);
check("steps with none left and a note → explain", emptySteps.kind === "explain" && emptySteps.note === "It works on phones too.", emptySteps);
const nothing = cleanAnswer(ans({ steps: [], note: null }), ctx, targets);
check("steps with nothing at all → unknown", nothing.kind === "unknown", nothing);
const installer = { ...ctx, role: "INSTALLER" };
const crew = cleanAnswer(ans({
  steps: [
    { text: "Open the AI desk", open: "/dashboard/phone", show: "nav:/dashboard/phone" },
    { text: "Open Jobs", open: "/dashboard/jobs", show: "nav:/dashboard/jobs" },
    { text: "Press AI desk in the sidebar", show: "nav:/dashboard/phone" },
  ],
}), installer, targets);
check("INSTALLER: /dashboard/phone step blocked by role, no open/show, text kept",
  crew.steps[0].blocked === "role" && !("open" in crew.steps[0]) && !("show" in crew.steps[0]) && crew.steps[0].text === "Open the AI desk", crew.steps[0]);
check("INSTALLER: Jobs step open", crew.steps[1].blocked === undefined && crew.steps[1].open === "/dashboard/jobs" && crew.steps[1].show === "nav:/dashboard/jobs", crew.steps[1]);
check("INSTALLER: a sidebar row they don't have is blocked too", crew.steps[2].blocked === "role" && !("show" in crew.steps[2]), crew.steps[2]);
const locked = cleanAnswer(ans({ steps: [{ text: "Open the AI desk", open: "/dashboard/phone" }] }), { ...ctx, lockedHrefs: ["/dashboard/phone"] }, targets);
check("plan-locked page: blocked plan, no open", locked.steps[0].blocked === "plan" && !("open" in locked.steps[0]), locked.steps[0]);
// The model told to give a guide's steps must not be stopped by the guards: every guide, as an answer, passes whole.
const guideAnswers = GUIDES.map((g) => ({ g, r: cleanAnswer(ans({ title: g.title, steps: g.steps.slice(0, 8) }), ctx, targets) }));
const stopped = guideAnswers
  .filter(({ g, r }) => r.kind !== "steps" || r.steps.some((s, i) => s.open !== g.steps[i].open || s.show !== g.steps[i].show || s.blocked))
  .map(({ g }) => g.id);
check("every guide given as an answer keeps all its Open and Show me", stopped.length === 0, stopped);
const titleTopics = GUIDES.filter((g) => personTopic(g.title) !== null).map((g) => g.title);
check("no guide title reads as a person topic", titleTopics.length === 0, titleTopics);

// helpTargets: the guides' targets plus a nav:<path> for every SmartHelp page drawn as a sidebar row.
const navRows = new Set(NAV_SECTIONS.flatMap((s) => flattenNavItems(s.items)).filter((i) => !i.preview).map((i) => i.href));
check("helpTargets ⊇ GUIDE_TARGETS", [...GUIDE_TARGETS].every((t) => targets.has(t)));
check("helpTargets has the sidebar rows of SmartHelp pages", targets.has("nav:/dashboard/proposals") && targets.has("nav:/dashboard/phone") && targets.has("nav:/dashboard/subscription"));
check("helpTargets: no pane links, no unlisted or preview rows",
  !targets.has("nav:/dashboard/phone?tab=settings") && !targets.has("nav:/dashboard/service-plans") && !targets.has("nav:/dashboard/lawn-estimator") && !targets.has("nav:/dashboard/hire"));
const navT = [...targets].filter((t) => t.startsWith("nav:")).map((t) => t.slice(4));
check("every nav target is a SmartHelp page and a drawn row", navT.every((p) => isHelpPage(p) && navRows.has(p)), navT);
check("every SmartHelp page drawn as a row is a target", HELP_PAGES.filter((p) => navRows.has(p.path)).every((p) => targets.has(`nav:${p.path}`)));
check("helpTargets is exactly guides + nav rows", targets.size === GUIDE_TARGETS.size + navT.length);

// The system prompt: the same bytes for everyone, carrying the rules, the lists, the guides and the handbook.
const sys = smartHelpSystemPrompt();
check("system prompt memoised and stable", sys === smartHelpSystemPrompt());
check("system prompt carries PERSON_ONLY_TOPICS", sys.includes(PERSON_ONLY_TOPICS));
check('system prompt says "Manual J-style"', sys.includes("Manual J-style"));
const rulesPart = sys.replace(customerHandbook(), "");
check('no "Manual J" without "-style" outside the handbook', !/Manual J(?!-style)/.test(rulesPart), rulesPart.match(/.{40}Manual J(?!-style).{20}/)?.[0]);
check("system prompt: the language of the question, names exactly as written",
  /language of the question/.test(sys) && /button, tab and page names exactly as written/.test(sys));
const missingPages = HELP_PAGES.filter((p) => !sys.includes(`${p.path} — ${p.name}`)).map((p) => p.path);
check("system prompt lists every HELP_PAGES page", missingPages.length === 0, missingPages);
const missingTargets = [...targets].filter((t) => !sys.includes(`- ${t}`));
check("system prompt lists every allowed target", missingTargets.length === 0, missingTargets);
const missingGuides = GUIDES.filter((g) => !sys.includes(g.title)).map((g) => g.id);
check("system prompt carries every guide title", missingGuides.length === 0, missingGuides);
check("system prompt carries the customer handbook", sys.includes(customerHandbook()));
check('system prompt has no "### Internal —" block', !sys.includes("### Internal —") && !sys.includes("Internal — for the team"));
check("system prompt holds nothing about a person", !/OWNER|INSTALLER|not connected/.test(rulesPart));

// The user prompt: the person and the conversation, nothing else.
const history = Array.from({ length: 8 }, (_, i) => ({ q: `question-${i + 1}`, a: `answer-${i + 1}` }));
const user = smartHelpUserPrompt({ question: "How do I get paid online?", history, ctx: { ...ctx, role: "INSTALLER", plan: "Professional", page: "/dashboard/proposals" } });
check("user prompt: only the last 6 turns", !user.includes("question-1") && !user.includes("question-2") && ["3", "4", "5", "6", "7", "8"].every((n) => user.includes(`question-${n}`) && user.includes(`answer-${n}`)), user);
check("user prompt: turns oldest first", user.indexOf("question-3") < user.indexOf("question-8"));
check("user prompt: page, role, plan", user.includes("/dashboard/proposals") && user.includes("Proposals") && user.includes("Installer") && user.includes("Professional"));
check('user prompt: setup facts in words ("Payments: not connected")', user.includes("Payments: not connected") && user.includes("AI desk: not set up"), user);
check("user prompt: a done setup reads as done", smartHelpUserPrompt({ question: "q", history: [], ctx: { ...ctx, setup: { ...setup, payments: true } } }).includes("Payments: connected"));
check("user prompt: the question last", user.trimEnd().endsWith("How do I get paid online?"));
check("user prompt: an INSTALLER's openable pages are named", /can open: .*Jobs/.test(user), user);
check("user prompt: no history, no conversation block", !smartHelpUserPrompt({ question: "q", history: [], ctx }).includes("EARLIER"));
check("user prompt: a feature off reads as not open", smartHelpUserPrompt({ question: "q", history: [], ctx: { ...ctx, features: { booking: false, website: true } } }).includes("Online booking: not open to this account"));

console.log(bad ? `${bad} FAILED` : "all passed");
process.exit(bad ? 1 : 0);
