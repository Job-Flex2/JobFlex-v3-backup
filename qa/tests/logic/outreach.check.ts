// JobFlex's outreach calls (2026-10-23, lib/outreach): the list in (a CSV with a header, a pasted list without one,
// quotes, state names, trades, the same contractor twice); who gets what — the AI calls a landline or whoever asked,
// everyone else gets the email, "don't call" ends it; calling hours on their clock (a split state, an unknown one,
// Sunday); two calls at most, not twice a day, the finished ones never again, the one who just asked at once; the
// script — the greeting says virtual assistant and recorded, the thank-you, the live prices, the stop rule; the tools;
// the voicemail says who and how to stop; the letter carries the call-me link, the unsubscribe and the postal address,
// and its subject passes the spam words; the call token's kind. Pure.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/outreach.check.ts
process.env.VOICE_SERVER_SECRET = process.env.VOICE_SERVER_SECRET || "qa-secret";
import { ALL_ZONES, MAX_CALLS, OUTREACH_CONSENT_TEXT, callableNow, funnel, parseProspectList, routeFor, stateCode, tradeKey, withinCallingHours, type Prospect } from "@/lib/outreach/rules";
import { outreachGreeting, outreachInstructions, outreachTools, outreachVoicemail, tradeWords } from "@/lib/outreach/script";
import { outreachLetter } from "@/lib/outreach/letter";
import { spammySubject } from "@/lib/adminMail/compose";
import { signCallToken, verifyCallToken } from "@/lib/aiDesk/voiceToken";

let bad = 0;
const check = (name: string, ok: boolean, info = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !info ? "" : `  — ${info}`}`);
};

console.log("— the list —");
const csv = `Business,Owner,Phone,Email,Trade,State
"Summit Roofing, LLC",Dana Lee,(206) 555-0142,dana@summitroof.com,Roofing,Washington
Cascade Air,Sam Ortiz,206.555.0199,,HVAC & Heating,wa
Summit dup,Dana,206-555-0142,,,
No Contact Co,Jo,,,,`;
const a = parseProspectList(csv);
check("a CSV with a header: quotes kept together, phones to E.164, state names to codes, trades to keys", a.rows.length === 2 && a.rows[0].business === "Summit Roofing, LLC" && a.rows[0].phone === "+12065550142" && a.rows[0].state === "WA" && a.rows[0].trade === "roofing" && a.rows[1].trade === "hvac" && a.rows[1].state === "WA", JSON.stringify(a.rows));
check("the same phone twice is one contractor; a row with neither phone nor email is left out", a.skipped === 2, String(a.skipped));
const b = parseProspectList("Ridge Fence Co\tPat Kim\t(503) 555-0110\tpat@ridgefence.com\tOR\nBlue Deck\t+1 512 555 0123\tTX");
check("a pasted list without a header: each cell known by what it looks like", b.rows.length === 2 && b.rows[0].business === "Ridge Fence Co" && b.rows[0].name === "Pat Kim" && b.rows[0].email === "pat@ridgefence.com" && b.rows[0].state === "OR" && b.rows[0].trade === "fencing" && b.rows[1].phone === "+15125550123" && b.rows[1].trade === "decks", JSON.stringify(b.rows));
check("state words and trade words", stateCode("New York") === "NY" && stateCode("tx") === "TX" && stateCode("Narnia") === null && tradeKey("Kitchen & Bath Remodeling") === "remodeling" && tradeKey("Furnace repair") === "hvac");

console.log("— who gets what —");
const at = "2026-10-26T17:00:00.000Z"; // a Monday, 10 am in Seattle
const P = (o: Partial<Prospect> = {}): Prospect => ({ id: "aaaaaaaaaaaaaaaaaa", name: "Dana Lee", business: "Summit Roofing", phone: "+12065550142", email: "dana@summitroof.com", trade: "roofing", state: "WA", city: "Seattle", source: "list", line: null, consent: null, dnc: null, calls: [], emailedAt: null, interest: null, linkSentAt: null, linkSentTo: null, createdAt: at, updatedAt: at, ...o });
const line = (type: NonNullable<Prospect["line"]>["type"]) => ({ type, carrier: null, at });
check("a landline: the AI calls it", routeFor(P({ line: line("landline") })).kind === "ai-call");
check("a cell phone with an email: the email with the call-me link, not the AI", routeFor(P({ line: line("mobile") })).kind === "email" && /cell phone/.test(routeFor(P({ line: line("mobile") })).why));
check("an internet line or a toll-free number: the email too", routeFor(P({ line: line("nonFixedVoip") })).kind === "email" && routeFor(P({ line: line("tollFree") })).kind === "email" && routeFor(P({ line: line("fixedVoip") })).kind === "email");
check("a cell phone and no email: nothing", routeFor(P({ line: line("mobile"), email: null })).kind === "none");
check("not checked yet: the line check first", routeFor(P()).kind === "check");
check("whoever asked for the call: the AI calls, any kind of phone", routeFor(P({ line: line("mobile"), consent: { text: OUTREACH_CONSENT_TEXT, at, ip: null, ua: null, page: "call-me" } })).kind === "ai-call");
check("'don't call': nothing, whatever else is true", routeFor(P({ line: line("landline"), dnc: { at, via: "call" } })).kind === "none");
check("a number outside the US and Canada: the email", routeFor(P({ phone: "+442071234567", line: line("landline") })).kind === "email");

console.log("— calling hours —");
const mon10 = new Date("2026-10-26T17:00:00Z"); // 10 am Pacific, 1 pm Eastern
const mon8am = new Date("2026-10-26T15:00:00Z"); // 8 am Pacific, 11 am Eastern
const mon930pm = new Date("2026-10-27T01:30:00Z"); // 9:30 pm Eastern, 6:30 pm Pacific
const sun = new Date("2026-10-25T18:00:00Z");
check("10 am in Washington: yes", withinCallingHours("WA", mon10));
check("8 am in Washington: not yet; 11 am in New York: yes", !withinCallingHours("WA", mon8am) && withinCallingHours("NY", mon8am));
check("9:30 pm in New York: no; 6:30 pm in Washington: yes", !withinCallingHours("NY", mon930pm) && withinCallingHours("WA", mon930pm));
check("a state on two clocks: both must agree (Texas at 8:30 am Central is 7:30 in El Paso)", !withinCallingHours("TX", new Date("2026-10-26T14:30:00Z")) && withinCallingHours("TX", new Date("2026-10-26T16:30:00Z")));
check("no state: only when it holds across the country", !withinCallingHours(null, mon8am) && withinCallingHours(null, mon10) && !withinCallingHours(null, mon930pm) && ALL_ZONES.length === 5);
check("Sunday: no", !withinCallingHours("WA", sun));

console.log("— when the AI may call —");
const ll = P({ line: line("landline") });
const call = (o: Partial<Prospect["calls"][number]> = {}): Prospect["calls"][number] => ({ sid: "CA1", at: "2026-10-26T16:00:00.000Z", status: "done", seconds: 30, answeredBy: "human", outcome: "no-answer", summary: null, transcript: null, error: null, ...o });
check("a landline in calling hours: yes", callableNow(ll, mon10).ok);
check("…not at 8 am their time", !callableNow(ll, mon8am).ok);
check("…not twice the same day", !callableNow({ ...ll, calls: [call({ at: "2026-10-26T16:30:00.000Z" })] }, mon10).ok);
check("…again the next day, and at most twice", callableNow({ ...ll, calls: [call({ at: "2026-10-23T17:00:00.000Z" })] }, mon10).ok && !callableNow({ ...ll, calls: [call({ at: "2026-10-22T17:00:00.000Z" }), call({ at: "2026-10-23T17:00:00.000Z" })] }, mon10).ok && MAX_CALLS === 2);
check("…never again once they said no, took the link, or asked not to be called", ["not-interested", "link-sent", "do-not-call", "interested"].every((o) => !callableNow({ ...ll, calls: [call({ at: "2026-10-20T17:00:00.000Z", outcome: o as never })] }, mon10).ok));
check("…not while a call is going", !callableNow({ ...ll, calls: [call({ status: "calling", outcome: null, at: "2026-10-20T17:00:00.000Z" })] }, mon10).ok);
const justAsked = P({ line: line("mobile"), consent: { text: OUTREACH_CONSENT_TEXT, at: "2026-10-26T15:55:00.000Z", ip: "1.2.3.4", ua: null, page: "call-me" } });
check("who just asked is called at once, even before 9 their time", callableNow(justAsked, new Date("2026-10-26T15:56:00Z")).ok && !withinCallingHours("WA", new Date("2026-10-26T15:56:00Z")));
check("…their earlier list calls don't count against the ask", callableNow({ ...justAsked, calls: [call({ at: "2026-10-20T17:00:00.000Z", outcome: "not-interested" }), call({ at: "2026-10-21T17:00:00.000Z" })] }, new Date("2026-10-26T15:56:00Z")).ok);

console.log("— the script —");
const facts = { plans: [{ name: "Starter", price: "$45" }, { name: "Professional", price: "$95" }, { name: "Advanced", price: "$199" }], trialDays: 7, canTransfer: false, site: "jobflex.app" };
const ins = outreachInstructions(ll, facts, mon10);
check("the greeting: JobFlex's virtual assistant, the call recorded, asks for the owner by name", /virtual assistant/.test(outreachGreeting(ll)) && /recorded/.test(outreachGreeting(ll)) && /Is this Dana at Summit Roofing\?/.test(outreachGreeting(ll)), outreachGreeting(ll));
check("…and for one who asked: says they asked", /you asked on our website/.test(outreachGreeting(justAsked)));
check("the thank-you, in the trade's words", ins.includes("Thank them") && ins.includes(tradeWords("roofing").help));
check("the prices are the live plans, the lowest first said; the trial's days", ins.includes("Starter $45 a month, Professional $95 a month, Advanced $199 a month") && ins.includes("starting at $45 a month") && ins.includes("7-day free trial"));
check("without the plans in hand it sends them to the pricing page, inventing nothing", /jobflex\.app\/pricing/.test(outreachInstructions(ll, { ...facts, plans: [] }, mon10)) && !/\$\d/.test(outreachInstructions(ll, { ...facts, plans: [] }, mon10)));
check("the stop rule, the machine rule, the no-invention rule", /do_not_call at once/.test(ins) && /voicemail greeting or a recording answers: call end_call at once/.test(ins) && /Never invent a feature, a price/.test(ins));
check("a list contractor is told apart from one who asked (take no the first time)", /did not ask for this call/.test(ins) && /asked for this call/.test(outreachInstructions(justAsked, facts, mon10)));
check("the tools: email, note, don't call, end — and a transfer only when a person can take it", outreachTools(false).map((t) => t.name).join() === "email_trial_link,note_interest,do_not_call,end_call" && outreachTools(true).some((t) => t.name === "transfer_call") && /transfer_call/.test(outreachInstructions(ll, { ...facts, canTransfer: true }, mon10)));
const vm = outreachVoicemail(ll, "+12065550100", "jobflex.app");
check("the voicemail: who called, the number back, how to stop", /virtual assistant from JobFlex/.test(vm) && /206-555-0100/.test(vm) && /take you off our list/.test(vm) && /jobflex dot app/.test(vm), vm);

console.log("— the letter —");
const L = outreachLetter({ p: ll, sender: "Dmitriy", callMeUrl: "https://jobflex.app/call-me/abc.def", siteUrl: "https://jobflex.app/", unsubscribeUrl: "https://jobflex.app/api/email/unsubscribe?o=prospect_x&t=y", postal: "PO Box 1, Seattle, WA 98101" });
check("the call-me link, the unsubscribe and the postal address, in the HTML and the text", [L.html, L.text].every((x) => x.includes("https://jobflex.app/call-me/abc.def") && x.includes("unsubscribe?o=prospect_x") && x.includes("PO Box 1, Seattle")));
check("it thanks them and says it is a one-time introduction", /thank you for what you do/.test(L.text) && /one-time note/.test(L.text));
check("the subject has no spam words", spammySubject(L.subject) === null, `${L.subject} → ${spammySubject(L.subject)}`);
check("a business name with < > & is escaped in the HTML", !outreachLetter({ ...{ p: { ...ll, business: "A<b>&C" } }, sender: "D", callMeUrl: "u", siteUrl: "s", unsubscribeUrl: "x", postal: "p" }).html.includes("A<b>"));

console.log("— the call token —");
const tok = signCallToken({ callSid: "CA9", organizationId: "jobflex-outreach", from: "+12065550142", kind: "outreach", ref: "aaaaaaaaaaaaaaaaaa" });
const back = verifyCallToken(tok);
check("an outreach call's token carries its kind and the contractor", back?.kind === "outreach" && back.ref === "aaaaaaaaaaaaaaaaaa");
check("a desk call's token has no kind (it stays the company's desk)", verifyCallToken(signCallToken({ callSid: "CA8", organizationId: "org1", from: "+1" }))?.kind === undefined);

console.log("— the figures —");
const f = funnel([ll, P({ id: "b", line: line("mobile") }), P({ id: "c" }), justAsked, P({ id: "d", dnc: { at, via: "email" } })]);
check("landlines, email-only, unchecked, asked, don't call", f.total === 5 && f.landlines === 1 && f.emailOnly === 1 && f.unchecked === 1 && f.asked === 1 && f.dnc === 1, JSON.stringify(f));

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
