// The contractor email composer (2026-10-08, lib/adminMail/compose): every
// topic proved on made-up accounts — when it is offered, what it says, that
// it says nothing the account does not bear out — and the AI's prompt, its
// answer's reading, and the email the contractor gets.
//   npx --no-install tsx --tsconfig tsconfig.json scripts/qa/admin-mail.check.ts
import { TOPICS, START_HERE, accountWords, ageWords, contractorLetter, firstNameOf, offerSentence, paragraphsOf, parseWritten, spammySubject, suggestedTopics, topicAvailability, topicDraft, tradeWord, writePrompt, type ContractorProfile, type TopicKey } from "../../src/lib/adminMail/compose";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };

const NOW = Date.parse("2026-10-08T15:00:00-07:00");
const DAY = 86_400_000;
const base = (p: Partial<ContractorProfile> = {}): ContractorProfile => ({
  orgId: "org_1", business: "Summit Roofing", owner: { name: "mike carter", firstName: "Mike", email: "mike@summit.test" },
  trade: { key: "roofing", name: "Roofing" }, trades: ["Roofing"], joinedAt: new Date(NOW - 2 * DAY).toISOString(),
  account: { kind: "trialing", status: "TRIALING", plan: "Professional", price: "$95/mo", daysLeft: 5, endsAt: new Date(NOW + 5 * DAY).toISOString(), hasCard: false },
  built: { clients: 2, proposals: 1, jobs: 0 }, lastSeenAt: null,
  offer: { can: true, how: "subscription", pct: 10, months: 3, yearly: false }, history: [], internal: false, optedOut: null, ...p,
});
const trial = base();
const paying = base({ business: "Lehi Fence Co.", owner: { name: "Ana Ruiz", firstName: "Ana", email: "ana@lehi.test" }, trade: { key: "fencing", name: "Fencing" }, joinedAt: new Date(NOW - 40 * DAY).toISOString(), account: { kind: "paying", status: "ACTIVE", plan: "Professional", price: "$95/mo" } });
const ended = base({ business: "Northpeak Heating & Air", owner: { name: null, firstName: "there", email: "office@northpeak.test" }, trade: { key: "hvac", name: "HVAC" }, joinedAt: new Date(NOW - 12 * DAY).toISOString(), account: { kind: "trial-ended", status: "TRIAL_ENDED", plan: "Professional", price: "$95/mo", endedAt: new Date(NOW - 4 * DAY).toISOString() }, offer: { can: true, how: "winback", pct: 10, months: 3, until: new Date(NOW + 14 * DAY).toISOString(), existing: false } });
const remodel = base({ business: "Bright Kitchens", owner: { name: "Jo", firstName: "Jo", email: "jo@bright.test" }, trade: { key: "general", name: "Kitchen & Bath" }, account: { kind: "trialing", status: "TRIALING", plan: "Starter", price: "$45/mo", daysLeft: 1, endsAt: new Date(NOW + DAY).toISOString(), hasCard: true }, offer: { can: false, reason: "Their subscription already has a discount" } });
const canceled = base({ business: "Old Deck Co.", trade: { key: "general", name: "Decking" }, joinedAt: new Date(NOW - 90 * DAY).toISOString(), account: { kind: "canceled", status: "CANCELED", plan: "Starter", price: "$45/mo" }, offer: { can: false, reason: "No subscription to take it off" } });
const ALL = { trial, paying, ended, remodel, canceled };

// ── words
check("first names: capitalised, 'there' without one, never an email", firstNameOf("mike carter") === "Mike" && firstNameOf(null) === "there" && firstNameOf("  ") === "there" && firstNameOf("jo@x.com") === "there");
check("trade words read inside a sentence", tradeWord(trial) === "roofing" && tradeWord(ended) === "HVAC" && tradeWord(remodel) === "kitchen & bath" && tradeWord(base({ trade: { key: "general", name: "" } })) === "contracting");
check("how long they have had it", ageWords(new Date(NOW - 0.4 * DAY).toISOString(), NOW) === "a day" && ageWords(new Date(NOW - 5 * DAY).toISOString(), NOW) === "5 days" && ageWords(new Date(NOW - 21 * DAY).toISOString(), NOW) === "3 weeks" && ageWords(new Date(NOW - 100 * DAY).toISOString(), NOW) === "3 months");

// ── when a topic is offered
const ok = (k: TopicKey, p: ContractorProfile) => topicAvailability(k, p, NOW).ok;
check("a new trial gets the welcome, the first estimate, the setup call, the reminder, the offer — not the win-back topics", ok("welcome", trial) && ok("first-estimate", trial) && ok("setup-call", trial) && ok("trial-ending", trial) && ok("offer", trial) && !ok("come-back", trial) && !ok("why-left", trial) && !ok("thanks", trial));
check("a paying shop gets the thank-you, not the trial reminder or the win-back", ok("thanks", paying) && !ok("trial-ending", paying) && !ok("come-back", paying) && !ok("welcome", paying));
check("an ended trial gets come-back, why-left and the offer — not the setup call or the first estimate", ok("come-back", ended) && ok("why-left", ended) && ok("offer", ended) && !ok("setup-call", ended) && !ok("first-estimate", ended) && !ok("trial-ending", ended));
check("a trial with its card on file: thank-you yes, the add-a-card reminder no", ok("thanks", remodel) && !ok("trial-ending", remodel) && (topicAvailability("trial-ending", remodel, NOW) as { reason: string }).reason === "Their card is already on file");
check("the offer topic carries the offer's own reason when it cannot be made", !ok("offer", remodel) && (topicAvailability("offer", remodel, NOW) as { reason: string }).reason === "Their subscription already has a discount" && !ok("offer", canceled));
check("the welcome is for live accounts in their first three weeks — never to a trial that ended", ok("welcome", trial) && ok("welcome", remodel) && !ok("welcome", ended) && !ok("welcome", canceled) && !ok("welcome", paying) && (topicAvailability("welcome", ended, NOW) as { reason: string }).reason === "Their trial or plan has ended");
check("suggested topics put the right one first for each account, and only ones that fit", suggestedTopics(trial, NOW)[0] === "welcome" && suggestedTopics(paying, NOW)[0] === "thanks" && suggestedTopics(ended, NOW)[0] === "come-back" && suggestedTopics(canceled, NOW)[0] === "why-left" && Object.values(ALL).every((p) => suggestedTopics(p, NOW).every((k) => ok(k, p))));

// ── what each topic says
const drafts = Object.entries(ALL).flatMap(([name, p]) => TOPICS.filter((t) => ok(t.key, p)).map((t) => ({ name, key: t.key, p, d: topicDraft(t.key, p, NOW) })));
check("every topic that fits writes a whole email: a subject and two or more paragraphs", drafts.length === 23 && drafts.every(({ d }) => d.subject.length > 5 && paragraphsOf(d.body).length >= 2), String(drafts.length));
check("no topic's subject reads as an ad: no price, percentage, 'free', 'discount', 'offer', exclamation or capitals", drafts.every(({ d }) => spammySubject(d.subject) === null), drafts.filter(({ d }) => spammySubject(d.subject)).map((x) => `${x.name}/${x.key}: ${x.d.subject}`).join(" | "));
check("the subject check names what would read as an ad", spammySubject("10% off JobFlex") === "a price or a percentage" && spammySubject("Your free trial") === "the word “free”" && spammySubject("Special OFFER inside") === "the word “OFFER”" && spammySubject("Hello!") === "an exclamation mark" && spammySubject("READ THIS NOW") === "a word in capitals" && spammySubject("Your HVAC estimate in JobFlex") === null && spammySubject("A thank-you for Summit Roofing") === null);
check("no draft carries undefined, NaN, an empty name or a placeholder", drafts.every(({ d }) => !/undefined|NaN|null|\[|\{\{|Hi ,|Hi —/.test(`${d.subject} ${d.body} ${d.cta?.label ?? ""}`)), drafts.filter(({ d }) => /undefined|NaN|null|\[|\{\{|Hi ,/.test(`${d.subject} ${d.body}`)).map((x) => `${x.name}/${x.key}`).join());
check("every draft greets by first name ('there' without one) and names the business", drafts.every(({ d, p }) => d.body.startsWith(`Hi ${p.owner.firstName} —`) && (d.body.includes(p.business) || d.subject.includes(p.business))), drafts.filter(({ d, p }) => !d.body.startsWith(`Hi ${p.owner.firstName} —`)).map((x) => `${x.name}/${x.key}`).join());
check("no topic but the offer mentions money off", drafts.filter(({ key }) => key !== "offer").every(({ d }) => !/%|discount|free month|on us|coupon/i.test(`${d.subject} ${d.body}`)), drafts.filter(({ key, d }) => key !== "offer" && /%|discount|free month/i.test(d.body)).map((x) => `${x.name}/${x.key}`).join());
check("the first-estimate email walks the trade's own estimator", topicDraft("first-estimate", trial, NOW).body.includes(START_HERE.roofing.how) && topicDraft("first-estimate", paying, NOW).body.includes("lot line") && topicDraft("first-estimate", remodel, NOW).body.includes("Smart Proposal") && topicDraft("first-estimate", trial, NOW).cta?.path === "/dashboard/roof-estimator" && topicDraft("first-estimate", remodel, NOW).cta?.path === "/dashboard/advanced-ai");
check("the welcome points an HVAC shop at the HVAC estimator", topicDraft("welcome", ended, NOW).body.includes("the HVAC estimator") && topicDraft("welcome", ended, NOW).subject === "Welcome to JobFlex, Northpeak Heating & Air");
const te = topicDraft("trial-ending", trial, NOW);
check("the trial reminder: the days left, the date, the price, the read-only truth, the card button", te.subject === "Your JobFlex trial ends in 5 days" && /ends on October 13/.test(te.body) && te.body.includes("at $95/mo") && te.body.includes("moves to the Free plan and nothing is charged") && te.cta?.path === "/dashboard/trial" && topicDraft("trial-ending", base({ account: { ...trial.account, daysLeft: 1 } }), NOW).subject === "Your JobFlex trial ends tomorrow" && topicDraft("trial-ending", base({ account: { ...trial.account, daysLeft: 0 } }), NOW).subject === "Your JobFlex trial ends today");
check("the trial reminder names what they made, or stays quiet when they made nothing", te.body.includes("2 clients, 1 proposal") && !topicDraft("trial-ending", base({ built: { clients: 0, proposals: 0, jobs: 0 } }), NOW).body.includes("Everything you set up"));
const ow = topicDraft("offer", ended, NOW), os = topicDraft("offer", trial, NOW);
check("the come-back offer: applied when they add a card, until a date, the trial button", ow.body.includes("10% off Professional for your first 3 months") && ow.body.includes("applied by itself when you add your card, until October 22") && ow.cta?.path === "/dashboard/trial");
check("a no-card trial's offer: on their account, kept by adding a card before the trial ends — with the card button", os.body.includes("10% off Professional for your first 3 monthly charges — already on your account; it applies by itself once you add a card before your trial ends") && !os.body.includes("nothing to do") && os.cta?.path === "/dashboard/trial");
const op = topicDraft("offer", base({ account: paying.account }), NOW);
check("a paying shop's offer: already applied, nothing to do, no button", op.body.includes("10% off Professional for your next 3 monthly charges — already applied to your subscription, nothing to do on your side") && op.cta === null);
const yearly = { can: true as const, how: "subscription" as const, pct: 10, months: 3, yearly: true };
check("a yearly plan's offer is its next yearly charge — its first, on a trial with no card", offerSentence(base({ account: paying.account, offer: yearly }))!.includes("your next yearly charge") && offerSentence(base({ offer: yearly }))!.includes("your first yearly charge") && offerSentence(remodel) === null);
check("after the dash the made-line reads on in lower case; a business name keeps its capital", topicDraft("come-back", ended, NOW).body.startsWith("Hi there — Northpeak Heating & Air is on the Free plan now, and everything you set up for Northpeak") && topicDraft("come-back", base({ built: { clients: 0, proposals: 0, jobs: 0 }, account: ended.account }), NOW).body.startsWith("Hi Mike — Summit Roofing is on the Free plan now, and Summit Roofing's workspace"));
check("come-back to a canceled account, and to a trial that ended, speaks of coming back from the Free plan", topicDraft("come-back", canceled, NOW).body.includes("is on the Free plan now") && topicDraft("come-back", canceled, NOW).body.includes("straight from Free") && topicDraft("come-back", ended, NOW).body.includes("is on the Free plan now"));
check("come-back sends an ended trial to the trial page and a canceled one to choose a plan", topicDraft("come-back", ended, NOW).cta?.path === "/dashboard/trial" && topicDraft("come-back", canceled, NOW).cta?.path === "/dashboard/subscription");
check("every button opens a dashboard page", drafts.every(({ d }) => !d.cta || /^\/dashboard(\/[\w-]+)*$/.test(d.cta.path)));

// ── the AI's prompt and its answer
const wp = writePrompt({ p: trial, notes: "thank him, ask what roofs he does most, offer a call thursday", sender: "Dmitriy", topic: null, offer: false, now: NOW });
check("the prompt carries the account's facts, the sender's words and the no-invention rule", wp.user.includes("Business: Summit Roofing") && wp.user.includes("Owner's first name: Mike") && wp.user.includes("Trade: Roofing") && wp.user.includes("5 days left, no card yet") && wp.user.includes("offer a call thursday") && /Never invent a price, a discount/.test(wp.system) && /No offer is attached: do not mention any discount/.test(wp.user));
const wpo = writePrompt({ p: trial, notes: "give him the discount", sender: "Dmitriy", topic: topicDraft("offer", trial, NOW), offer: true, now: NOW });
check("with the offer on, the exact sentence goes in to be used word for word; with a topic, its draft is the start", wpo.user.includes(`Offer sentence (include word for word): ${offerSentence(trial)}`) && wpo.user.includes("The email starts from this draft"));
check("an unknown name tells the AI to open with 'Hi there'", writePrompt({ p: ended, notes: "x y z", sender: "D", topic: null, offer: false, now: NOW }).user.includes('open with "Hi there"'));
check("the account in words, for the AI", accountWords(paying) === "paying customer on Professional ($95/mo)" && accountWords(ended).startsWith("free trial of Professional ended") && accountWords(canceled) === "on the Free plan since canceling Starter — nothing is billed");
const good = parseWritten('```json\n{"subject":"Quick hello","paragraphs":["Hi Mike — one.","Two."]}\n```');
check("the AI's answer is read, fences and all", good.ok && good.draft.subject === "Quick hello" && good.draft.body === "Hi Mike — one.\n\nTwo.");
check("an answer with a placeholder, nothing in it, or not JSON is refused", !parseWritten('{"subject":"Hi","paragraphs":["Hi [Name] — x"]}').ok && !parseWritten('{"subject":"","paragraphs":[]}').ok && !parseWritten("Sure! Here is your email").ok && !parseWritten('{"subject":"x","paragraphs":["Hi {{first}}"]}').ok);
check("the AI is told plain subjects: no prices, percentages, 'free', 'discount' — they read as ads", writePrompt({ p: trial, notes: "x y z", sender: "D", topic: null, offer: false, now: NOW }).system.includes('no prices, no percentages, no "free", no "discount" or "offer"'));

// ── the letter the contractor gets
const UNSUB = "https://www.jobflex.app/api/email/unsubscribe?o=org_1&t=abc";
const L = contractorLetter({ draft: topicDraft("offer", trial, NOW), p: trial, offer: true, base: "https://www.jobflex.app/", sender: "Dmitriy", unsubscribeUrl: UNSUB });
check("a letter: the paragraphs, the offer as one plain line, a signature — no headline, no images, no boxes", L.html.includes("<p") && L.html.includes("<strong>10% off for 3 months — on your account</strong>") && L.html.includes("Dmitriy<br>") && !/<img|<table|<h1|background:#1854a0/i.test(L.html));
check("its plain-text twin carries the same words, the offer, the signature and the unsubscribe link", L.text.startsWith("Hi Mike — thank you for running Summit Roofing on JobFlex.") && L.text.includes("10% off for 3 months — on your account") && contractorLetter({ draft: topicDraft("offer", base({ account: paying.account }), NOW), p: base({ account: paying.account }), offer: true, base: "x", sender: "D", unsubscribeUrl: UNSUB }).text.includes("10% off for 3 months — applied") && L.text.includes("Dmitriy\nJobFlex · jobflex.app") && L.text.includes(`Unsubscribe: ${UNSUB}`));
check("the foot says why they got it and links Unsubscribe; the postal address joins it when set", L.html.includes("You&#39;re getting this because Summit Roofing has a JobFlex account.") || L.html.includes("You're getting this because Summit Roofing has a JobFlex account."), L.html.slice(L.html.indexOf("getting this") - 20, L.html.indexOf("getting this") + 80));
check("…with the unsubscribe link and, given one, the postal address", L.html.includes(`href="${UNSUB.replace(/&/g, "&amp;")}"`) && contractorLetter({ draft: topicDraft("welcome", trial, NOW), p: trial, offer: false, base: "x", sender: "D", unsubscribeUrl: UNSUB, postal: "JobFlex LLC · 1 Main St, Bothell, WA 98011" }).text.includes("1 Main St, Bothell"));
const W2 = contractorLetter({ draft: topicDraft("offer", ended, NOW), p: ended, offer: true, base: "https://www.jobflex.app", sender: "Dmitriy", unsubscribeUrl: UNSUB });
check("the come-back letter: the offer until a date, the link absolute to the trial page", W2.text.includes("10% off for 3 months — until October 22") && W2.html.includes('href="https://www.jobflex.app/dashboard/trial"') && W2.text.includes("Come back with the discount: https://www.jobflex.app/dashboard/trial"));
check("with the offer off — or not possible — no offer line", !contractorLetter({ draft: topicDraft("offer", trial, NOW), p: trial, offer: false, base: "x", sender: "D", unsubscribeUrl: UNSUB }).html.includes("<strong>") && !contractorLetter({ draft: topicDraft("offer", trial, NOW), p: remodel, offer: true, base: "x", sender: "D", unsubscribeUrl: UNSUB }).html.includes("<strong>"));
check("the team signs as the team", contractorLetter({ draft: topicDraft("check-in", trial, NOW), p: trial, offer: false, base: "x", sender: "The JobFlex team", unsubscribeUrl: UNSUB }).text.includes("The JobFlex team\njobflex.app"));
check("words are escaped: a business name with & and < never breaks the letter", contractorLetter({ draft: { subject: "Hi", body: "Hi Jo — <b>Tom & Sons</b>", cta: null }, p: trial, offer: false, base: "x", sender: "D", unsubscribeUrl: UNSUB }).html.includes("&lt;b&gt;Tom &amp; Sons&lt;/b&gt;"));
check("paragraphs: a blank line splits, a single line break stays in the paragraph", paragraphsOf("a\nb\n\n\nc\r\n\r\nd").join("|") === "a b|c|d");

console.log(bad ? `\n${bad} FAILED` : "\nall green");
process.exit(bad ? 1 : 0);
