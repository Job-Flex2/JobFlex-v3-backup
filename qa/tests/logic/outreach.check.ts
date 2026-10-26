// JobFlex's outreach calls (2026-10-23, lib/outreach): the list in (a CSV with a header, a pasted list without one,
// quotes, state names, trades, the same contractor twice); who gets what — the AI calls a landline or whoever asked,
// everyone else gets the email, "don't call" ends it; calling hours on their clock (a split state, an unknown one,
// Sunday); two calls at most, not twice a day, the finished ones never again, the one who just asked at once; the
// script — the greeting says virtual assistant and recorded, the thank-you, the live prices, the stop rule; the tools;
// the voicemail says who and how to stop; the letter carries the call-me link, the unsubscribe and the postal address,
// and its subject passes the spam words; the call token's kind. Pure.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/outreach.check.ts
process.env.VOICE_SERVER_SECRET = process.env.VOICE_SERVER_SECRET || "qa-secret";
import { ALL_ZONES, EMAIL_LEAD_MS, MAX_CALLS, OUTREACH_CONSENT_TEXT, callableNow, consentCoversTexts, emailDue, emailFirst, funnel, parseProspectList, routeFor, scheduleWords, stateCode, textDue, textableNow, tradeKey, twilioWords, withinCallingHours, type Prospect } from "@/lib/outreach/rules";
import { outreachGreeting, outreachInstructions, outreachText, outreachTools, outreachVoicemail, tradePitch, tradeWords } from "@/lib/outreach/script";
import { OUTREACH_SENDER, outreachLetter } from "@/lib/outreach/letter";
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

const refused = call({ sid: null, status: "failed", outcome: "failed", at: "2026-10-26T15:55:30.000Z", error: "Twilio: Account not authorized to call" });
check("a call Twilio refused to place (it never rang) neither counts nor makes them wait", callableNow({ ...justAsked, calls: [refused] }, new Date("2026-10-26T15:56:00Z")).ok && callableNow({ ...ll, calls: [refused, refused] }, mon10).ok);
check("…a call that was placed and then failed still counts", !callableNow({ ...ll, calls: [call({ sid: "CA2", status: "failed", outcome: "failed", at: "2026-10-26T16:30:00.000Z" })] }, mon10).ok);

check("Twilio's geo-permission refusal is said as the setting to turn on", /Geo permissions → tick United States & Canada/.test(twilioWords("Twilio: Account not authorized to call +14257726587. Perhaps you need to enable some international permissions: https://www.twilio.com/console/voice/calls/geo-permissions/low-risk")) && twilioWords("Twilio: busy") === "Twilio: busy");

console.log("— the script —");
const facts = { plans: [{ name: "Starter", price: "$45" }, { name: "Professional", price: "$95" }, { name: "Advanced", price: "$199" }], trialDays: 7, canTransfer: false, site: "jobflex.app" };
const ins = outreachInstructions(ll, facts, mon10);
check("the greeting opens with JobFlex calling (2026-10-25), says it is JobFlex's AI receptionist heard live, the call recorded, asks for the owner by name", /^Hi, this is JobFlex calling\./.test(outreachGreeting(ll)) && /AI receptionist JobFlex makes for contractors/.test(outreachGreeting(ll)) && /hearing it live/.test(outreachGreeting(ll)) && /recorded/.test(outreachGreeting(ll)) && /Is this Dana at Summit Roofing\?/.test(outreachGreeting(ll)), outreachGreeting(ll));
check("…never 'virtual assistant' — not in the greeting, the voicemail or as what it calls itself", !/virtual assistant/i.test(outreachGreeting(ll) + outreachGreeting(justAsked) + outreachVoicemail(ll, "+12065550100", "jobflex.app")) && /Never call yourself a virtual assistant/.test(outreachInstructions(ll, facts, mon10)) && /never pretend to be a person/.test(outreachInstructions(ll, facts, mon10)));
check("…short enough to say in one breath (under 40 words)", outreachGreeting(ll).split(/\s+/).length < 40 && outreachGreeting(justAsked).split(/\s+/).length < 40, `${outreachGreeting(ll).split(/\s+/).length} / ${outreachGreeting(justAsked).split(/\s+/).length} words`);
check("the first question is the trade's own sharp one, and the pitch comes back in their words", ins.includes(tradeWords("roofing").ask) && /in THEIR words/.test(ins) && Object.values(["roofing", "hvac", "fencing", "decks", null]).every((t) => tradeWords(t as string | null).ask.endsWith("?")));
check("…and for one who asked: JobFlex calling, says they asked to hear the AI receptionist — and that's who is talking", /^Hi Dana, this is JobFlex calling — you asked on our website to hear our AI receptionist, and that's me, live\. This call is recorded\./.test(outreachGreeting(justAsked)), outreachGreeting(justAsked));
check("the thank-you, in the trade's words", ins.includes("Thank them") && ins.includes(tradeWords("roofing").help));
check("the prices are the live plans, the lowest first said; the trial's days", ins.includes("Starter $45 a month, Professional $95 a month, Advanced $199 a month") && ins.includes("starting at $45 a month") && ins.includes("7-day free trial"));
check("without the plans in hand it sends them to the pricing page, inventing nothing", /jobflex\.app\/pricing/.test(outreachInstructions(ll, { ...facts, plans: [] }, mon10)) && !/\$\d/.test(outreachInstructions(ll, { ...facts, plans: [] }, mon10)));
check("the stop rule, the machine rule, the no-invention rule", /do_not_call at once/.test(ins) && /voicemail greeting or a recording answers: call end_call at once/.test(ins) && /Never invent a feature, a price/.test(ins));
check("a list contractor is told apart from one who asked (take no the first time)", /did not ask for this call/.test(ins) && /asked for this call/.test(outreachInstructions(justAsked, facts, mon10)));
check("the tools: email, note, don't call, end — and a transfer only when a person can take it", outreachTools(false).map((t) => t.name).join() === "email_trial_link,note_interest,do_not_call,end_call" && outreachTools(true).some((t) => t.name === "transfer_call") && /transfer_call/.test(outreachInstructions(ll, { ...facts, canTransfer: true }, mon10)));
const vm = outreachVoicemail(ll, "+12065550100", "jobflex.app");
check("the voicemail: JobFlex calling first, from its AI receptionist, the number back, how to stop", /^Hi Dana, this is JobFlex calling for Summit Roofing — JobFlex makes software for contractors, and this message is from our AI receptionist\./.test(vm) && /206-555-0100/.test(vm) && /take you off our list/.test(vm) && /jobflex dot app/.test(vm), vm);

console.log("— the letter —");
const L = outreachLetter({ p: ll, callMeUrl: "https://jobflex.app/call-me/abc.def", siteUrl: "https://jobflex.app/", unsubscribeUrl: "https://jobflex.app/api/email/unsubscribe?o=prospect_x&t=y", postal: "PO Box 1, Seattle, WA 98101" });
check("the call-me link, the unsubscribe and the postal address, in the HTML and the text", [L.html, L.text].every((x) => x.includes("https://jobflex.app/call-me/abc.def") && x.includes("unsubscribe?o=prospect_x") && x.includes("PO Box 1, Seattle")));
check("it is from the JobFlex Team — no person's name: the opening, the signature, in the HTML and the text", OUTREACH_SENDER === "JobFlex Team" && /^Hi .*\n\nWe're the JobFlex team — we make software for contractors\./.test(L.text) && /\n\nJobFlex Team\njobflex\.app\n\n--/.test(L.text) && L.html.includes(">JobFlex Team<br>") && !/Dmitriy|I'm /.test(L.text + L.html), L.text.slice(0, 160));
check("it thanks them and says it is a one-time introduction", /thank you for what you do/.test(L.text) && /one-time note/.test(L.text));
check("the subject has no spam words", spammySubject(L.subject) === null, `${L.subject} → ${spammySubject(L.subject)}`);
check("a business name with < > & is escaped in the HTML", !outreachLetter({ ...{ p: { ...ll, business: "A<b>&C" } }, callMeUrl: "u", siteUrl: "s", unsubscribeUrl: "x", postal: "p" }).html.includes("A<b>"));

console.log("— each trade's own pitch —");
const PITCH: Array<[string, RegExp]> = [["roofing", /aerial imagery/], ["fencing", /on the map/], ["hvac", /Manual J-style/], ["decks", /3D/]];
for (const [trade, word] of PITCH) {
  const pt = tradePitch(trade);
  check(`${trade}: its tool in the call, the email, the text and the voicemail`, [pt.call, pt.email, pt.sms, pt.voicemail].every((x) => word.test(x)), JSON.stringify(pt));
  check(`${trade}: the call's brief leads with it, the email says it, the voicemail too`, outreachInstructions({ ...ll, trade }, facts, mon10).includes(pt.call) && outreachLetter({ p: { ...ll, trade }, callMeUrl: "u", siteUrl: "s", unsubscribeUrl: "x", postal: "p" }).text.includes(pt.email) && outreachVoicemail({ ...ll, trade }, null, "jobflex.app").includes(pt.voicemail));
}
check("a plumber, a remodeler, an unknown trade and none: JobFlex in general (the AI desk, Smart Proposal, the job)", ["plumbing", "remodeling", "underwater welding", null].every((t) => /AI desk/.test(tradePitch(t).email) && /Smart Proposal/.test(tradePitch(t).email)));
const txt = outreachText({ p: ll, answered: true, link: "https://jobflex.app/auth/register?utm_source=jobflex-call&utm_medium=sms&utm_campaign=roofing", trialDays: 7 });
check("the text: names JobFlex, the trade's line, the trial, how to stop — two segments at most", /JobFlex/.test(txt) && txt.includes(tradePitch("roofing").sms) && /Free 7-day trial/.test(txt) && /Reply STOP to opt out\.$/.test(txt) && txt.length <= 306, `${txt.length}: ${txt}`);
check("…and for a call that didn't reach them, it says we tried to call back as they asked", /tried to call you back as you asked/.test(outreachText({ p: ll, answered: false, link: "l", trialDays: 7 })));
const texts = ["roofing", "fencing", "hvac", "decks", "plumbing"].flatMap((t) => [true, false].map((answered) => outreachText({ p: { name: "Christopher-Alexander", trade: t }, answered, link: "https://jobflex.app/auth/register?utm_source=jobflex-call&utm_medium=sms&utm_campaign=landscaping", trialDays: 14 })));
check("every trade's text: two segments at most, in the plain SMS alphabet (no dash that would make it 70-character segments)", texts.every((x) => x.length <= 306 && /^[\x20-\x7E]+$/.test(x) && /Reply STOP to opt out\.$/.test(x)), texts.map((x) => x.length).join(","));
check("a link too long for the trade's line: the line gives way, the brand, the link and STOP stay", (() => { const x = outreachText({ p: ll, answered: true, link: `https://jobflex.app/${"x".repeat(200)}`, trialDays: 7 }); return x.length <= 306 && /JobFlex/.test(x) && x.includes("x".repeat(200)) && /Reply STOP/.test(x); })());

console.log("— the email first, then the call and the text —");
const day = 24 * 60 * 60 * 1000;
const withEmail = P({ line: line("landline") });
check("a landline with an email: the email goes first", emailFirst(withEmail, mon10, true).ok === false && emailDue(withEmail));
check("…called two days after it, not before", !emailFirst({ ...withEmail, emailedAt: new Date(mon10.getTime() - day).toISOString() }, mon10, true).ok && emailFirst({ ...withEmail, emailedAt: new Date(mon10.getTime() - EMAIL_LEAD_MS - 1000).toISOString() }, mon10, true).ok);
check("…no email, or emails can't go out on this server: the call needn't wait", emailFirst({ ...withEmail, email: null }, mon10, true).ok && emailFirst(withEmail, mon10, false).ok);
check("who asked for the call never waits for an email", emailFirst({ ...withEmail, consent: { text: OUTREACH_CONSENT_TEXT, at, ip: null, ua: null, page: "call-me" } }, mon10, true).ok);
check("the email batch: a cell or a landline not yet written to; not twice, not after 'don't call', not one who asked", emailDue(P({ line: line("mobile") })) && !emailDue({ ...withEmail, emailedAt: at }) && !emailDue({ ...withEmail, dnc: { at, via: "admin" } }) && !emailDue({ ...withEmail, consent: { text: OUTREACH_CONSENT_TEXT, at, ip: null, ua: null, page: "call-me" } }) && !emailDue({ ...withEmail, email: null }));
const askedNew = P({ line: line("mobile"), consent: { text: OUTREACH_CONSENT_TEXT, at, ip: null, ua: null, page: "call-me" } });
check("the consent now covers texts, and says how to stop", consentCoversTexts(askedNew.consent) && /reply STOP/i.test(OUTREACH_CONSENT_TEXT) && /Message and data rates/.test(OUTREACH_CONSENT_TEXT));
check("a text goes to one who asked with the new words; not on the old words (calls and email only)", textDue(askedNew) && !textDue({ ...askedNew, consent: { ...askedNew.consent!, text: "I agree that JobFlex may call me at this number — using an AI voice assistant and automated technology — to show me the AI desk and tell me about JobFlex, and may email me." } }));
check("…not to a landline, not twice for one ask, not after 'don't call', not to a list contractor who never asked", !textDue({ ...askedNew, line: line("landline") }) && !textDue({ ...askedNew, textedAt: new Date(Date.parse(at) + 60000).toISOString() }) && textDue({ ...askedNew, textedAt: "2026-01-01T00:00:00.000Z" }) && !textDue({ ...askedNew, dnc: { at, via: "sms" } }) && !textDue(P({ line: line("mobile") })));

console.log("— the call token —");
const tok = signCallToken({ callSid: "CA9", organizationId: "jobflex-outreach", from: "+12065550142", kind: "outreach", ref: "aaaaaaaaaaaaaaaaaa" });
const back = verifyCallToken(tok);
check("an outreach call's token carries its kind and the contractor", back?.kind === "outreach" && back.ref === "aaaaaaaaaaaaaaaaaa");
check("a desk call's token has no kind (it stays the company's desk)", verifyCallToken(signCallToken({ callSid: "CA8", organizationId: "org1", from: "+1" }))?.kind === undefined);

console.log("— the figures —");
const f = funnel([ll, P({ id: "b", line: line("mobile") }), P({ id: "c" }), justAsked, P({ id: "d", dnc: { at, via: "email" } })]);
check("landlines, email-only, unchecked, asked, don't call", f.total === 5 && f.landlines === 1 && f.emailOnly === 1 && f.unchecked === 1 && f.asked === 1 && f.dnc === 1, JSON.stringify(f));

console.log("— the schedule's channels (2026-10-25) —");
const night = new Date("2026-10-27T05:30:00Z"); // 10:30 pm Pacific
const okText = P({ id: "t1", state: "WA", line: line("mobile"), consent: justAsked.consent });
check("a text may go to one who agreed to calls AND texts, on a cell, in their daytime", textableNow(okText, mon10));
check("…not at night on their clock, not to a landline, not without consent, not after STOP, not twice", !textableNow(okText, night) && !textableNow(P({ id: "t2", state: "WA", line: line("landline"), consent: justAsked.consent }), mon10) && !textableNow(P({ id: "t3", state: "WA", line: line("mobile") }), mon10) && !textableNow({ ...okText, dnc: { at, via: "sms" } }, mon10) && !textableNow({ ...okText, textedAt: "2026-10-26T16:00:00.000Z" }, mon10));
const per = { emails: 20, calls: 5, texts: 20 };
check("texts only, emails off: says only the ones who already agreed get texts", /^Texts only\. /.test(scheduleWords({ email: false, calls: false, texts: true }, per)) && /With emails off, only the contractors who already agreed get texts/.test(scheduleWords({ email: false, calls: false, texts: true }, per)), scheduleWords({ email: false, calls: false, texts: true }, per));
check("calls only: no 'two days after their email'; all three: the email first and texts growing as they answer", /^Calls only\. /.test(scheduleWords({ email: false, calls: true, texts: false }, per)) && !/two days after/.test(scheduleWords({ email: false, calls: true, texts: false }, per)) && /two days after their email/.test(scheduleWords({ email: true, calls: true, texts: true }, per)) && /texts grow as they answer/.test(scheduleWords({ email: true, calls: true, texts: true }, per)));
check("nothing on: says so", /^Nothing is sent/.test(scheduleWords({ email: false, calls: false, texts: false }, per)));
check("a calls-only schedule calls a landline with an email at once — no email to wait for", emailFirst(P({ id: "e1", line: line("landline") }), mon10, false).ok && !emailFirst(P({ id: "e2", line: line("landline") }), mon10, true).ok);
const tNo = outreachText({ p: { name: "Dana Lee", trade: "roofing" }, answered: false, noCall: true, link: "https://jobflex.app/t/x", trialDays: 7 });
check("the text with no call before it: JobFlex named, why it comes, the trade's line, the link, STOP — plain letters, two segments at most", /^Hi Dana, JobFlex here, as you asked on our site\./.test(tNo) && tNo.includes(tradePitch("roofing").sms) && /Reply STOP to opt out\./.test(tNo) && tNo.length <= 306 && /^[\x20-\x7E]+$/.test(tNo), tNo);

// THE OFFER (owner, 2026-10-26: "offer them that they need JobFlex to grow the business faster and save time with our tools").
const real = (t: string) => `https://jobflex.app/auth/register?utm_source=jobflex-call&utm_medium=sms&utm_campaign=${t}`;
check("every trade's text makes the offer — grow faster, save time — with its tools, after a call and on the schedule (a short first name, the real link)", ["roofing", "fencing", "hvac", "decks", "plumbing"].every((t) => [true, false].every((noCall) => { const x = outreachText({ p: { name: "Mike Carter", trade: t }, answered: !noCall, noCall, link: real(t), trialDays: 7 }); return /Grow your .*business faster and save time/.test(x) && x.includes(tradePitch(t).sms) && x.length <= 306; })));
check("a name too long for the tools: the bare offer stays", (() => { const x = outreachText({ p: { name: "Christopher-Alexander", trade: "roofing" }, answered: false, noCall: true, link: real("roofing"), trialDays: 7 }); return x.includes(tradePitch("roofing").grow) && x.length <= 306 && /Reply STOP to opt out\.$/.test(x); })());
check("the email makes the offer too, in the business's name", /JobFlex is built to help Acme Roofing grow faster and save time\./.test(outreachLetter({ p: { ...ll, business: "Acme Roofing" }, callMeUrl: "u", siteUrl: "s", unsubscribeUrl: "x", postal: "p" }).text));

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
