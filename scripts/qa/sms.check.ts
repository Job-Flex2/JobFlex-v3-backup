// Text messages (2026-09-24): the words, the rules, the preference cell.
// Pure, no Twilio, no DB.
//   npx --no-install tsx --tsconfig tsconfig.json scripts/qa/sms.check.ts
import * as P from "../../src/lib/notificationPrefsShared";
import * as F from "../../src/lib/sms/format";
import * as R from "../../src/lib/sms/textRules";
import * as G from "../../src/lib/sms/registrationShared";
import * as D from "../../src/lib/aiDesk/shared";
import * as V from "../../src/lib/sdk/twilioVoice";
import * as A from "../../src/lib/sms/actionGuard";
import {
  acceptedLine,
  brand,
  changeOrderLine,
  clip,
  crewAssignedText,
  crewCancelledText,
  crewDigestText,
  crewMovedText,
  heldDigestText,
  isStartWord,
  isStopWord,
  leadLine,
  money,
  paymentLine,
  redactLinks,
  SMS_MAX,
  spanLabel,
  unbrand,
  verifyText,
  welcomeText,
  workerRespondedLine,
} from "../../src/lib/sms/format";
import {
  allowsSms,
  defaultNotificationPrefs,
  mergeMatrixSave,
  nextLocalTime,
  nextQuietEnd,
  parseNotificationPrefs,
  PREF_EVENTS,
  smsDecision,
} from "../../src/lib/notificationPrefsShared";
import { toE164 } from "../../src/lib/phone";
import { clientProposalText, clientReminderText } from "../../src/lib/sms/clients";
import { smsAllowanceFor } from "../../src/lib/entitlements";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const TZ = "America/Los_Angeles";
const oct7 = new Date("2026-10-07T15:00:00Z"); // 8:00 AM Pacific
const oct7end = new Date("2026-10-07T23:00:00Z"); // 4:00 PM Pacific

/* ── words ── */
const assigned = crewAssignedText("Ridgeline Roofing", { title: "Roof replacement — Stevens", startsAt: oct7, endsAt: oct7end, address: "4567 Rainier Ave S, Seattle, WA 98118" }, "https://www.jobflex.app/w/abc123", TZ);
console.log("\n" + assigned + "\n");
check("the crew's assignment text: company first, the day and hours, the street, the link",
  assigned === "Ridgeline Roofing: you're on \"Roof replacement — Stevens\" Wed Oct 7, 8 AM–4 PM at 4567 Rainier Ave S. Details + confirm: https://www.jobflex.app/w/abc123", assigned);
check("a move and a cancellation say so",
  crewMovedText("Ridgeline Roofing", { title: "Roof replacement", startsAt: oct7, endsAt: oct7end, address: null }, null, TZ) === "Ridgeline Roofing: \"Roof replacement\" moved to Wed Oct 7, 8 AM–4 PM." &&
  crewCancelledText("Ridgeline Roofing", { title: "Roof replacement", startsAt: oct7 }, TZ) === "Ridgeline Roofing: \"Roof replacement\" on Wed Oct 7 is cancelled — you're not needed for it.");
const digest = crewDigestText("Ridgeline Roofing", "tomorrow", [
  { title: "Gutter repair", startsAt: new Date("2026-10-07T20:00:00Z"), endsAt: null, address: "12 Main St, Everett" },
  { title: "Roof replacement", startsAt: oct7, endsAt: oct7end, address: "4567 Rainier Ave S" },
], "https://www.jobflex.app/w/abc123", TZ);
console.log(digest + "\n");
check("the evening list is sorted by start with street lines and one link",
  digest === "Ridgeline Roofing — tomorrow (Wed Oct 7): 8 AM Roof replacement, 4567 Rainier Ave S · 1 PM Gutter repair, 12 Main St. Details: https://www.jobflex.app/w/abc123", digest);
check("five stops read as three and a count", /· \+2 more\./.test(crewDigestText("R", "today", Array.from({ length: 5 }, (_, i) => ({ title: `Stop ${i + 1}`, startsAt: new Date(oct7.getTime() + i * 3_600_000), endsAt: null, address: null })), null, TZ)));
check("no stops, no text", crewDigestText("R", "today", [], null, TZ) === "");
check("times: whole hours drop the minutes, an end that matches the start is not read",
  spanLabel(oct7, oct7end, TZ) === "Wed Oct 7, 8 AM–4 PM" && spanLabel(new Date("2026-10-07T15:30:00Z"), null, TZ) === "Wed Oct 7, 8:30 AM" && spanLabel(oct7, oct7, TZ) === "Wed Oct 7, 8 AM");

check("the office lines read as one glance each",
  acceptedLine("Rick Stevens", "Roof replacement — architectural shingles", 11306.52, "https://www.jobflex.app/dashboard/proposals/p1") === "Rick Stevens accepted \"Roof replacement — architectural shingles\" — $11,306.52. Schedule it: https://www.jobflex.app/dashboard/proposals/p1" &&
  paymentLine("Rick Stevens", "Roof replacement", 3391.96, 7914.56) === "Rick Stevens paid $3,391.96 on \"Roof replacement\" — $7,914.56 still due." &&
  paymentLine("Rick Stevens", "Roof replacement", 7914.56, 0) === "Rick Stevens paid $7,914.56 on \"Roof replacement\" — paid in full." &&
  leadLine("Pat Homeowner", "Roofing", "Seattle, WA", "(206) 555-0100", null) === "New lead: Pat Homeowner, Roofing in Seattle, WA ((206) 555-0100)." &&
  changeOrderLine("Rick", true, 2, "Plywood", 850, "Roof replacement") === "Rick approved change order #2 \"Plywood\" ($850) on \"Roof replacement\"." &&
  workerRespondedLine("Marcus Bell", false, "Roof replacement", "Wed Oct 7") === "Marcus Bell declined \"Roof replacement\" on Wed Oct 7.",
  acceptedLine("Rick Stevens", "Roof replacement — architectural shingles", 11306.52, "https://www.jobflex.app/dashboard/proposals/p1"));
check("the company leads every text and comes back off for folding",
  brand("Ridgeline Roofing", "hello") === "Ridgeline Roofing: hello" && unbrand("Ridgeline Roofing", "Ridgeline Roofing: hello") === "hello" && brand(null, "hello") === "hello");
check("held texts fold into one overnight line",
  heldDigestText("Ridgeline Roofing", ["Rick accepted \"Roof\" — $11,307.", "Rick paid $3,392 on \"Roof\" — $7,915 still due."]) === "Ridgeline Roofing: overnight — Rick accepted \"Roof\" — $11,307 · Rick paid $3,392 on \"Roof\" — $7,915 still due." &&
  heldDigestText("Ridgeline Roofing", ["one thing."]) === "Ridgeline Roofing: one thing.");
check("welcome, code and STOP words", welcomeText("Ridgeline Roofing").includes("Reply STOP to opt out") && /^JobFlex code: 482913\./.test(verifyText("482913")) &&
  isStopWord("STOP") && isStopWord("  unsubscribe please") && !isStopWord("stopping by at 3") && isStartWord("Start") && !isStartWord("no"));
check("HELP on JobFlex's number names the lead alerts and the support address", /lead alerts you turned on/.test(F.helpText()) && F.helpText().includes("support@jobflex.app"));
check("turning lead texts on is confirmed with the STOP and HELP words", /lead texts are on for Ridgeline Roofing/.test(F.leadTextsOnText("Ridgeline Roofing")) && /STOP/.test(F.leadTextsOnText(null)) && /HELP/.test(F.leadTextsOnText(null)));
check("stop words match the keyword, not a sentence that begins with it", isStopWord("stop") && !isStopWord("stopped by the shop") && isStopWord("STOPALL"));
check("nothing longer than two segments; links are redacted for logs; money reads plainly",
  clip("x".repeat(500)).length <= SMS_MAX && clip("a word ".repeat(80)).endsWith("…") && redactLinks("see https://www.jobflex.app/w/abc now") === "see <link> now" && money(12000) === "$12,000" && money(1234.5) === "$1,234.50");
check("phones normalise to E.164", toE164("(206) 555-0100") === "+12065550100" && toE164("1 206 555 0100") === "+12065550100" && toE164("555-0100") === null);

/* ── the preference cell ── */
const d = defaultNotificationPrefs();
check("the Text cell seeds on for the money events and off for the rest",
  d.matrix["lead-assigned"][2] && d.matrix["proposal-accepted"][2] && d.matrix["payment-received"][2] && d.matrix["change-order"][2] && !d.matrix["proposal-declined"][2] && !d.matrix["proposal-viewed"][2] && PREF_EVENTS.every((e) => e.smsAvailable || !d.matrix[e.key][2]));
const legacy = parseNotificationPrefs(JSON.stringify({ matrix: { "proposal-accepted": [true, false], "lead-assigned": [false, false, false], "proposal-viewed": [true, true, true] }, quietFrom: "21:00", quietTo: "06:30" }));
check("a stored pair reads its Text cell as the seed; a triple is kept; an unavailable channel is off",
  legacy.matrix["proposal-accepted"][2] === true && legacy.matrix["lead-assigned"][2] === false && legacy.matrix["proposal-viewed"][1] === false && legacy.matrix["proposal-viewed"][2] === false && legacy.quietFrom === "21:00");
const merged = mergeMatrixSave({ "proposal-accepted": [true, true], "lead-assigned": [true, true, true], "trade-reply": [true, true, true] }, legacy);
check("a save from the handheld page (pairs) keeps the Text cell; the desk page's triple wins; unavailable stays off",
  merged["proposal-accepted"][2] === true && merged["lead-assigned"][2] === true && merged["trade-reply"][2] === false && merged["payment-received"][2] === legacy.matrix["payment-received"][2]);

const night = new Date("2026-10-07T05:30:00Z"); // 10:30 PM Pacific, Oct 6
const day = new Date("2026-10-07T17:00:00Z"); // 10 AM Pacific
check("a text sends by day, waits by night, and a new lead never waits",
  smsDecision(d, "proposal-accepted", day, TZ) === "send" && smsDecision(d, "proposal-accepted", night, TZ) === "hold" && smsDecision(d, "lead-assigned", night, TZ) === "send" && smsDecision(d, "proposal-declined", day, TZ) === "skip" && allowsSms(d, "payment-received"));
const end = nextQuietEnd(d, night, TZ);
check("a held text goes out at 7 AM company time", end.toISOString() === "2026-10-07T14:00:00.000Z", end.toISOString());
check("the next local time rolls to tomorrow once passed", nextLocalTime("07:00", day, TZ).toISOString() === "2026-10-08T14:00:00.000Z" && nextLocalTime("20:00", day, TZ).toISOString() === "2026-10-08T03:00:00.000Z");

/* ── the client's texts, the allowance ── */
check("the client gets the proposal link with the company name and the STOP line",
  clientProposalText("Ridgeline Roofing", "Roof replacement — architectural shingles", 11306.52, "https://www.jobflex.app/portal/q/abc") === "Ridgeline Roofing: your proposal \"Roof replacement — architectural shingles\" ($11,306.52) is ready — review it here: https://www.jobflex.app/portal/q/abc Reply STOP to opt out.",
  clientProposalText("Ridgeline Roofing", "Roof replacement — architectural shingles", 11306.52, "https://www.jobflex.app/portal/q/abc"));
check("the evening-before reminder names the street and the hours",
  clientReminderText("Ridgeline Roofing", { title: "Roof tear-off", startsAt: oct7, endsAt: oct7end, address: "4567 Rainier Ave S, Seattle, WA" }, TZ) === "Ridgeline Roofing: reminder — we're scheduled at 4567 Rainier Ave S tomorrow, Wed Oct 7, 8 AM–4 PM (Roof tear-off). Reply here with any questions.",
  clientReminderText("Ridgeline Roofing", { title: "Roof tear-off", startsAt: oct7, endsAt: oct7end, address: "4567 Rainier Ave S, Seattle, WA" }, TZ));
check("the monthly allowance grows with the plan and defaults to the free tier",
  smsAllowanceFor("FREE") === 50 && smsAllowanceFor("PROFESSIONAL") === 1000 && smsAllowanceFor(null) === 50 && smsAllowanceFor("weird") === 50);

/* ── who gets texted, person by person (2026-09-29) ── */
{
  const keys = (a: "office" | "sales" | "crew") => P.textEventsFor(a).map((e) => e.key);
  check("each role sits on its roster; a plain member on none",
    P.audienceForRole("OWNER") === "office" && P.audienceForRole("MANAGER") === "office" && P.audienceForRole("ACCOUNTANT") === "office" && P.audienceForRole("SALES") === "sales" && P.audienceForRole("ESTIMATOR") === "sales" && P.audienceForRole("INSTALLER") === "crew" && P.audienceForRole("USER") === null);
  check("the office list: leads, deals, money, visits, install dates, the crew on site",
    ["lead-assigned", "proposal-accepted", "payment-received", "change-order", "appointment-booked", "appointment-moved", "job-scheduled", "job-started", "job-completed", "job-photos"].every((k) => keys("office").includes(k as never)), keys("office"));
  check("the sales list: their leads, deals, visits and install dates — not the crew's day",
    ["lead-assigned", "proposal-accepted", "proposal-declined", "appointment-booked", "appointment-moved", "job-scheduled"].every((k) => keys("sales").includes(k as never)) && !keys("sales").includes("job-started" as never) && !keys("sales").includes("job-photos" as never), keys("sales"));
  check("the crew list is the crew's four texts and nothing else",
    JSON.stringify(keys("crew")) === JSON.stringify(["crew-assigned", "crew-moved", "crew-tomorrow", "crew-today"]), keys("crew"));
  check("every switch on the page shows the text as it will read",
    (["office", "sales", "crew"] as const).every((a) => P.textEventsFor(a).every((e) => typeof e.example === "string" && e.example.length > 20)));
  check("seeds follow the role: a rep hears declines, the office does not",
    P.parseNotificationPrefs(null, "SALES").matrix["proposal-declined"][2] === true && P.parseNotificationPrefs(null, "OWNER").matrix["proposal-declined"][2] === false && P.parseNotificationPrefs(null, "SALES").matrix["payment-received"][2] === false);
  check("the crew is seeded onto all four of its texts",
    ["crew-assigned", "crew-moved", "crew-tomorrow", "crew-today"].every((k) => P.parseNotificationPrefs(null, "INSTALLER").matrix[k as never][2] === true));
  check("the crew's texts stay out of the Notifications matrix",
    !P.PREF_EVENTS.some((e) => e.key.startsWith("crew-")) && P.ALL_PREF_EVENTS.filter((e) => e.key.startsWith("crew-")).length === 4);
  const stored = P.parseNotificationPrefs(JSON.stringify({ matrix: { "crew-tomorrow": [true, false, false] } }), "INSTALLER");
  const merged = P.mergeMatrixSave({ "lead-assigned": [true, true] }, stored);
  check("a save from the Notifications page keeps a crew switch it cannot see", merged["crew-tomorrow"][2] === false && merged["crew-today"][2] === true);
  check("who typed a mobile in survives a round trip", P.parseNotificationPrefs(JSON.stringify({ smsAddedBy: "u_1" })).smsAddedBy === "u_1" && P.parseNotificationPrefs(null).smsAddedBy === null);
  check("an online booking, a move and a cancel map to the visit switches",
    P.prefKeyForEvent({ kind: "BOOKING_NEW" }) === "appointment-booked" && P.prefKeyForEvent({ kind: "BOOKING_MOVED" }) === "appointment-moved" && P.prefKeyForEvent({ kind: "BOOKING_CANCELED" }) === "appointment-moved");
  const booked = F.appointmentBookedLine("Roof inspection", "Sarah Mitchell", F.spanLabel(oct7, oct7end, TZ), "18412 92nd Ave NE, Bothell, WA", "online");
  check("a booked visit: what, who, when, the street, and how", booked === "Booked: Roof inspection · Sarah Mitchell · Wed Oct 7, 8 AM–4 PM · 18412 92nd Ave NE · online.", booked);
  const moved = F.appointmentMovedLine("Roof inspection", "Sarah Mitchell", "Wed Oct 7, 8 AM", "Fri Oct 9, 1 PM–2 PM");
  check("a moved visit says from and to", moved === "Moved: Roof inspection · Sarah Mitchell — was Wed Oct 7, 8 AM, now Fri Oct 9, 1 PM–2 PM.", moved);
  check("a cancelled visit says when, and who cancelled it online",
    F.appointmentCancelledLine("Roof inspection", "Sarah Mitchell", "Wed Oct 7, 8 AM–4 PM", "online") === "Cancelled: Roof inspection · Sarah Mitchell — Wed Oct 7, 8 AM–4 PM, by the client.");
  const sched = F.jobScheduledLine("Standing-seam metal · 18412 92nd Ave NE", "Tue Oct 13, 8 AM–4 PM", "18412 92nd Ave NE, Bothell, WA", null);
  check("an install date: the job, the day and hours, the street", sched === 'Scheduled: "Standing-seam metal · 18412 92nd Ave NE" — Tue Oct 13, 8 AM–4 PM at 18412 92nd Ave NE.', sched);
}

/* ── your own texts (2026-09-29) ── */
{
  check("every ready-made idea only uses fields its moment can fill, and reaches someone it can",
    R.RULE_PRESETS.every((p) => R.unknownFields(p.body, p.trigger).length === 0 && p.to.every((x) => R.triggerOf(p.trigger)!.recipients.includes(x)) && p.body.length <= R.RULE_BODY_MAX),
    R.RULE_PRESETS.filter((p) => R.unknownFields(p.body, p.trigger).length).map((p) => p.id));
  check("every timed moment has a sane default inside its range",
    R.RULE_TRIGGERS.filter((t) => t.timed).every((t) => t.timed!.default >= t.timed!.min && t.timed!.default <= t.timed!.max));
  const filled = R.renderRuleText("Hi {first}, thank you for choosing {company}! Questions: {phone}.", { first: "Sarah", company: "Ridgeline Roofing Co.", phone: "(206) 555-0100" });
  check("the fields fill in", filled === "Hi Sarah, thank you for choosing Ridgeline Roofing Co.! Questions: (206) 555-0100.", filled);
  const tidy = R.renderRuleText("Hi {first}, your job {job} ({total}) is set.", { first: "Sarah", job: "Roof" });
  check("an empty field leaves no double space or empty brackets", tidy === "Hi Sarah, your job Roof is set.", tidy);
  check("a field the moment cannot fill is caught before saving", JSON.stringify(R.unknownFields("{client} paid {amount} on {when}", "proposal.accepted")) === JSON.stringify(["amount", "when"]));
  check("client texts carry the STOP line once", R.withStopLine("Hi Sarah.") === "Hi Sarah. Reply STOP to opt out." && R.withStopLine("Reply STOP to stop.") === "Reply STOP to stop.");
  check("the list says when, with the hours or days", R.whenText("appointment.before", 24) === "Before an appointment — 24 hours before" && R.whenText("job.after", 1) === "After a job is completed — 1 day after" && R.whenText("proposal.accepted", null) === "A proposal is accepted");
  check("the company name leads once, never twice", R.signed("Ridgeline Roofing Co.", "Hi Sarah, a reminder from Ridgeline Roofing Co.") === "Hi Sarah, a reminder from Ridgeline Roofing Co." && R.signed("Ridgeline Roofing Co.", "Hi Sarah.") === "Ridgeline Roofing Co.: Hi Sarah.");
  check("the crew can only be reached where there is a crew", !R.triggerOf("proposal.accepted")!.recipients.includes("crew") && R.triggerOf("job.before")!.recipients.includes("crew"));
}


// A company's own texting number, registered in its name (2026-10-02).
{
  const good: G.SmsRegistrationDetails = {
    legalName: "Ridgeline Roofing LLC", dba: "Ridgeline Roofing", businessType: "PRIVATE_PROFIT", ein: "123456789",
    street: "4567 Rainier Ave S", street2: "", city: "Seattle", state: "wa", zip: "98118", website: "https://ridgelineroofing.com",
    contactFirst: "Rick", contactLast: "Stevens", contactEmail: "rick@ridgelineroofing.com", contactPhone: "(206) 555-0100", social: "", showEmail: false,
  };
  check("a complete business form has no problems", Object.keys(G.registrationProblems(good)).length === 0, JSON.stringify(G.registrationProblems(good)));
  const p = G.registrationProblems({ ...good, ein: "", state: "Washington", zip: "981", website: "ridgeline.com", contactPhone: "555" });
  check("an LLC needs its EIN; the state, ZIP, website and phone are checked", Boolean(p.ein && p.state && p.zip && p.website && p.contactPhone), JSON.stringify(p));
  check("a sole proprietor may leave the EIN empty", !G.registrationProblems({ ...good, businessType: "SOLE_PROPRIETOR", ein: "" }).ein);
  const t = G.tidyDetails(good);
  check("the EIN reads 12-3456789 and the state is upper-cased", t.ein === "12-3456789" && t.state === "WA");
  check("Twilio's statuses map to ours", G.stageFor("PENDING_REVIEW") === "pending" && G.stageFor("IN_REVIEW") === "pending" && G.stageFor("TWILIO_APPROVED") === "approved" && G.stageFor("TWILIO_REJECTED") === "rejected" && G.stageFor(undefined) === "failed");
  check("free mailboxes are told apart from a business domain", G.isFreeMailbox("rick@gmail.com") && G.isFreeMailbox("x@Outlook.com") && !G.isFreeMailbox("rick@ridgelineroofing.com"));
  const pre = G.prefillDetails({ name: "Ridgeline Roofing", website: null, address: "13620 NE 20th St, Suite I, Bellevue, WA 98005", phone: "+14255550100", slug: "ridgeline" }, { name: "Rick Stevens", email: "rick@ridgelineroofing.com" });
  check("the form starts from the company's address, a JobFlex page for a missing website, and the person's name",
    pre.street === "13620 NE 20th St" && pre.street2 === "Suite I" && pre.city === "Bellevue" && pre.state === "WA" && pre.zip === "98005" &&
    pre.website === "https://www.jobflex.app/book/ridgeline" && pre.contactFirst === "Rick" && pre.contactLast === "Stevens", JSON.stringify(pre));
  const samples = ["Ridgeline Roofing: your proposal is ready.", "Ridgeline Roofing: reminder — tomorrow 9 AM."];
  const help = F.companyHelpText("Ridgeline Roofing", "+12065550100");
  const f = G.verificationFields({ details: t, companyName: "Ridgeline Roofing", samples, bookingUrl: "https://www.jobflex.app/book/ridgeline-roofing-and-exteriors", slug: "ridgeline-roofing-and-exteriors", helpText: help });
  check("the registration names the contractor, not JobFlex, and stays inside Twilio's limits",
    f.businessName === "Ridgeline Roofing LLC" && f.doingBusinessAs === "Ridgeline Roofing" && f.businessContactEmail === "rick@ridgelineroofing.com" &&
    f.businessContactPhone === "+12065550100" && f.businessRegistrationNumber === "12-3456789" && f.optInImageUrls[0] === "https://www.jobflex.app/book/ridgeline-roofing-and-exteriors/opt-in.png" &&
    f.useCaseSummary.length <= 500 && f.additionalInformation.length <= 500 && f.productionMessageSample.length <= 500 && f.useCaseSummary.includes("used by Ridgeline Roofing only") && f.additionalInformation.includes("/book/ridgeline-roofing-and-exteriors") && !f.additionalInformation.endsWith("…"));
  // WHAT TWILIO CHECKS (2026-10-12): the company's own terms and privacy pages (30493, 30519), its HELP reply (30531),
  // its own opt-in picture (30506) — never the demo company's.
  check("the registration carries the company's own texting terms, privacy policy and HELP reply",
    f.termsAndConditionsUrl === "https://www.jobflex.app/book/ridgeline-roofing-and-exteriors/texting" &&
    f.privacyPolicyUrl === "https://www.jobflex.app/book/ridgeline-roofing-and-exteriors/privacy" &&
    f.helpMessageSample === help && !f.optInImageUrls.includes(G.BOOKING_OPT_IN_IMAGE), JSON.stringify({ t: f.termsAndConditionsUrl, p: f.privacyPolicyUrl, i: f.optInImageUrls }));
  check("the booking checkbox's words name the company and say it is optional, with frequency, rates, STOP and HELP",
    G.bookingConsentText("Cedar Line Fence").lead === "Text me about my visit and estimate from Cedar Line Fence." &&
    /Message frequency varies\. Msg & data rates may apply\. Reply STOP to opt out, HELP for help\. Agreeing is not a condition of booking\./.test(G.bookingConsentText("x").rest));
  check("sample texts talk about the company's own trade", G.sampleJobsFor(["Fencing"]).job === "Fence installation" && G.sampleJobsFor(["Other", "HVAC"]).job === "Heat pump installation" && G.sampleJobsFor([]).job === "Home repair");
  // NO WEBSITE, A GMAIL (2026-10-13): the booking page lists the email (30482), a social page goes along as proof.
  const noSite = G.prefillDetails({ name: "Cedar Line Fence", website: null, address: null, phone: null, slug: "cedar" }, { name: "Ana Ruiz", email: "ana.cedarfence@gmail.com" });
  check("no website and a Gmail: the form starts with the email shown on the booking page", noSite.showEmail === true && noSite.website === "https://www.jobflex.app/book/cedar");
  check("…an own website: nothing is shown unless asked", G.prefillDetails({ name: "R", website: "https://ridgeline.com", address: null, phone: null, slug: "r" }, { name: "R", email: "r@gmail.com" }).showEmail === false);
  check("a social page is optional, but must be a link", !G.registrationProblems({ ...good, social: "" }).social && Boolean(G.registrationProblems({ ...good, social: "facebook" }).social) && !G.registrationProblems({ ...good, social: "https://facebook.com/cedarlinefence" }).social);
  const withSocial = G.verificationFields({ details: G.tidyDetails({ ...good, showEmail: true, social: "https://facebook.com/ridgelineroofing" }), companyName: "Ridgeline Roofing", samples, bookingUrl: "https://www.jobflex.app/book/ridgeline-roofing-and-exteriors", slug: "ridgeline-roofing-and-exteriors", helpText: help });
  check("…and Twilio is told the email is listed and where the business is online, inside 500 characters",
    withSocial.additionalInformation.includes("contact email is listed on that page") && withSocial.additionalInformation.endsWith("https://facebook.com/ridgelineroofing") && withSocial.additionalInformation.length <= 500, `${withSocial.additionalInformation.length}: ${withSocial.additionalInformation}`);
  check("details saved before these fields read as their empty values", G.parseRegistration(JSON.stringify({ stage: "pending", details: { legalName: "X" } })).details?.showEmail === false && G.parseRegistration(JSON.stringify({ stage: "pending", details: { legalName: "X" } })).details?.social === "");
  const sole = G.verificationFields({ details: { ...t, businessType: "SOLE_PROPRIETOR", ein: "", dba: "" }, companyName: "Ridgeline Roofing", samples, bookingUrl: "https://www.jobflex.app/book/ridgeline", slug: "ridgeline", helpText: help });
  check("a sole proprietor without an EIN sends no registration number, and no trade name equal to the legal one", !("businessRegistrationNumber" in sole) && !("doingBusinessAs" in sole));
  check("HELP on a company's number names the company and how to reach it",
    F.companyHelpText("Ridgeline Roofing", "+12065550100") === "Ridgeline Roofing: texts about your visits and estimates. Reply STOP to opt out. Questions: (206) 555-0100" &&
    F.companyHelpText("Ridgeline Roofing", null).endsWith("Questions: support@jobflex.app"));
}

// ONE NUMBER FOR CALLS AND TEXTS (2026-10-13, lib/aiDesk): calls the day it is bought, texts once approved.
{
  check("a saved registration keeps when calls were wired", G.parseRegistration(JSON.stringify({ stage: "pending", voiceOnAt: "2026-10-13T00:00:00Z" })).voiceOnAt === "2026-10-13T00:00:00Z");
  check("the card says calls work at once and texts wait for the approval",
    /takes calls right away/i.test(G.REGISTRATION_COPY.done.join(" ")) && /answers calls/i.test(G.REGISTRATION_COPY.pending) && /approval/i.test(G.REGISTRATION_COPY.textsPending) && G.REGISTRATION_COPY.title === "Your number");
  const d = D.parseDeskSettings;
  check("desk settings: the assistant answers unless told to forward; junk reads as the default", d(null).mode === "ANSWER" && d('{"mode":"FORWARD"}').mode === "FORWARD" && d('{"mode":"ROCKET"}').mode === "ANSWER" && d("nope").mode === "ANSWER");
  check("where calls go: the assistant on the plan, else the company phone, else nowhere",
    D.callsGo({ mode: "ANSWER", assistantOnPlan: true, companyPhone: "+14255550100" }) === "assistant" &&
    D.callsGo({ mode: "FORWARD", assistantOnPlan: true, companyPhone: "+14255550100" }) === "phone" &&
    D.callsGo({ mode: "ANSWER", assistantOnPlan: false, companyPhone: "+14255550100" }) === "phone" &&
    D.callsGo({ mode: "FORWARD", assistantOnPlan: true, companyPhone: null }) === "assistant" &&
    D.callsGo({ mode: "ANSWER", assistantOnPlan: false, companyPhone: null }) === "none");
  const fwd = V.forwardTwiml({ baseUrl: "https://www.jobflex.app", number: "+14255550100" });
  check("forwarding rings the company phone and comes back to the dial result", /<Dial action="https:\/\/www\.jobflex\.app\/api\/twilio\/voice\/dial" method="POST" timeout="25">\+14255550100<\/Dial>/.test(fwd));
  check("the assistant's greeting names the company", D.greetingFor("Ridgeline Roofing").startsWith("Thanks for calling Ridgeline Roofing.") && /<Say voice="alice">Thanks for calling Ridgeline Roofing\./.test(V.recordingTwiml({ baseUrl: "https://x", greeting: D.greetingFor("Ridgeline Roofing") })));
}

// ── every texting action answers in words (lib/sms/actionGuard, 2026-10-14) ──
{
  const named = (name: string, message = "") => Object.assign(new Error(message), { name });
  check("a run-out session says sign in again, not 'your role'", A.smsFailureMessage(named("UnauthorizedError")) === A.SIGN_IN_AGAIN && A.smsFailureMessage(named("UnauthorizedError", "Session expired — please sign in again")) === A.SIGN_IN_AGAIN);
  check("a limited role is told who can, and what to do", A.smsFailureMessage(named("UnauthorizedError", "Your role doesn't open this page")) === A.OFFICE_ONLY && A.smsFailureMessage(named("UnauthorizedError", "Manager access required")) === A.OFFICE_ONLY && A.smsFailureMessage(named("UnauthorizedError", "Owner access required")) === A.OFFICE_ONLY);
  check("no company → sign in to one; a trial lock keeps its own sentence", A.smsFailureMessage(named("NoOrgError")) === A.NO_COMPANY && A.smsFailureMessage(named("TrialEndedError", "Your free trial has ended.")) === "Your free trial has ended." && A.smsFailureMessage(named("RateLimitError", "Too many verification texts. Try again in an hour.")).startsWith("Too many"));
  check("the browser's own words for a lost action — #441 included — say refresh and sign in", A.smsFailureMessage(new Error("An unexpected response was received from the server.")) === A.LOST_SESSION && A.smsFailureMessage(new Error("Minified React error #441; visit https://react.dev/errors/441 for the full message")) === A.LOST_SESSION && A.smsFailureMessage(new Error("An error occurred in the Server Components render.")) === A.LOST_SESSION && A.smsFailureMessage(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/auth/login" })) === A.LOST_SESSION);
  check("anything else is 'our side', never the raw stack", A.smsFailureMessage(new TypeError("Cannot read properties of undefined")) === A.OUR_SIDE && A.smsFailureMessage(null) === A.OUR_SIDE && A.smsFailureMessage("boom") === A.OUR_SIDE);
}

// ── the line JobFlex lent for calls, on the texting card (registrationShared, 2026-10-14) ──
{
  check("toll-free is 800/833/844/855/866/877/888 in E.164, nothing else", G.isTollFree("+18005550123") && G.isTollFree("+18885550123") && G.isTollFree("+18335550123") && !G.isTollFree("+14255550123") && !G.isTollFree("8005550123") && !G.isTollFree("+1800555012") && !G.isTollFree(null));
  const jf = G.assignedLineWords({ number: "(800) 555-0123", jobflexOwn: true, registrable: false, house: false });
  check("JobFlex's own line: calls on, texts never from it, get your own number", /AI desk answers it today/.test(jf.calls) && /registered to JobFlex/.test(jf.texts) && jf.button === "Get your own number for texts" && /keep coming to \(800\) 555-0123/.test(jf.keep));
  const spare = G.assignedLineWords({ number: "(888) 555-0199", jobflexOwn: false, registrable: true, house: false });
  check("a spare toll-free line: register this same number, no new one", /register this same number/i.test(spare.texts) && spare.button === "Register this number for texts" && /No new number/.test(spare.keep));
  const local = G.assignedLineWords({ number: "(425) 555-0100", jobflexOwn: false, registrable: false, house: false });
  check("a local line: texts need a toll-free one, get your own", /local number/.test(local.texts) && local.button === "Get your own number for texts");
  const house = G.assignedLineWords({ number: "(800) 555-0123", jobflexOwn: true, registrable: false, house: true });
  check("JobFlex's own company: the JobFlex line is its line — sending, texts on, both go through it", house.tag === "sending" && /this company is JobFlex's/.test(house.texts) && /Calls and texts both go through \(800\) 555-0123/.test(house.keep));
  check("the first set-up line for a registrable lent line is the registration, not a purchase", /^Registers \(888\) 555-0199/.test(G.REGISTRATION_COPY.doneRegisters("(888) 555-0199")));
}

async function guardChecks() {
  const named = (name: string, message = "") => Object.assign(new Error(message), { name });
  const r = await A.guardSms(async () => { throw named("UnauthorizedError"); });
  check("guardSms turns a throw into { ok: false, error }", !r.ok && r.error === A.SIGN_IN_AGAIN);
  const ok = await A.guardSms(async () => ({ ok: true as const, note: "Saved." }));
  check("…and passes a good answer through", ok.ok && ok.note === "Saved.");
  const bad2 = await A.guardSms(async () => ({ ok: false as const, error: "That doesn't look like a US or Canadian mobile number." }));
  check("…and a plain refusal through untouched", !bad2.ok && /US or Canadian/.test(bad2.error));
}

void guardChecks().then(() => {
  console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
  process.exit(bad ? 1 : 0);
});
