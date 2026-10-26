// Finding contractors online (2026-10-25, lib/outreach/hunt): the form (a trade, an area with its state, how many a
// day); what Google is asked, phrase by phrase; a place into a row of the list (the phone to E.164, the city and state
// off the address, a closed business or a directory page left out, the trade from Google's types for "any"); the
// email out of a website (a mailto, text, "(at)…(dot)", the site's own domain first, no-reply and file names never);
// when a daily hunt is due on its area's clock; what is remembered; the words on the page. Pure.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/outreach-hunt.check.ts
import { HUNT_HOUR, HUNT_TRADES, SEEN_CAP, STATE_CITIES, nextSpot, cityState, contactPages, emailFromHtml, huntDue, huntPhrases, huntQuery, huntStatusWords, huntWords, localClock, newHunt, parseArea, placeToRow, placesErrorWords, rememberSeen, rowsToList, runWords, tidyUrl, type FoundPlace, type Hunt } from "@/lib/outreach/hunt";
import { parseProspectList, tradeKey } from "@/lib/outreach/rules";
import { tradePitch } from "@/lib/outreach/script";

let bad = 0;
const check = (name: string, ok: boolean, info = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !info ? "" : `  — ${info}`}`);
};

console.log("— the form —");
check("every trade a hunt offers is one the list's trade words know, and the pitch has words for it", HUNT_TRADES.every((t) => t.key === "any" || tradeKey(t.label) === t.key || tradeKey(t.phrases[0]) === t.key) && HUNT_TRADES.filter((t) => t.key !== "any").every((t) => !!tradePitch(t.key)) && tradePitch("roofing") !== tradePitch("plumbing"), HUNT_TRADES.map((t) => `${t.key}:${tradeKey(t.phrases[0])}`).join(" "));
check("each trade has more than one phrase (Google gives sixty places a phrase)", HUNT_TRADES.every((t) => t.phrases.length >= 2));
check("'Seattle, WA' → the state; 'Seattle Washington' too; 'Tacoma area' → none", parseArea("Seattle, WA").state === "WA" && parseArea("  Seattle   Washington ").state === "WA" && parseArea("Tacoma area").state === null && parseArea("New York, New York").state === "NY" && parseArea("  Seattle   Washington ").area === "Seattle Washington");
const made = newHunt({ trade: "roofing", area: "Seattle, WA", perDay: 20, daily: true, by: "a@b.c" }, "h1", new Date("2026-10-25T16:00:00Z"));
check("a hunt from the form", made.ok && made.hunt.trade === "roofing" && made.hunt.state === "WA" && made.hunt.perDay === 20 && made.hunt.daily && made.hunt.phraseIndex === 0 && !made.hunt.exhausted && made.hunt.seen.length === 0, JSON.stringify(made));
check("no trade, no area, a silly count: refused with words", !newHunt({ trade: "nope", area: "Seattle", perDay: 10, daily: false }, "x").ok && !newHunt({ trade: "roofing", area: " ", perDay: 10, daily: false }, "x").ok && !newHunt({ trade: "roofing", area: "Seattle", perDay: 0, daily: false }, "x").ok && !newHunt({ trade: "roofing", area: "Seattle", perDay: 500, daily: false }, "x").ok);
const H: Hunt = made.ok ? made.hunt : (null as never);
check("what Google is asked: the phrase the hunt is on, in the area", huntQuery(H) === "roofing contractors in Seattle, WA" && huntQuery({ ...H, phraseIndex: 1 }) === "roofers in Seattle, WA" && huntQuery({ ...H, phraseIndex: 99 }) === `${huntPhrases("roofing").at(-1)} in Seattle, WA`, huntQuery({ ...H, phraseIndex: 1 }));
check("'any contractor' asks for contractors, then the trades in turn", huntQuery({ trade: "any", area: "Boise, ID" }) === "contractors in Boise, ID" && huntPhrases("any").length >= 5);

console.log("— a place into a row —");
const place = (o: Partial<FoundPlace> = {}): FoundPlace => ({ id: "p1", name: "Summit Roofing LLC", address: "4210 Rainier Ave S, Seattle, WA 98118, USA", phone: "(206) 555-0142", website: "http://www.summitroof.com/?utm_source=google", rating: 4.8, ratings: 112, types: ["roofing_contractor", "general_contractor", "point_of_interest"], status: "OPERATIONAL", ...o });
const r1 = placeToRow(place(), H);
check("the phone to E.164, the city and state off the address, the website tidied (its own scheme kept), the hunt's trade", !!r1 && r1.phone === "+12065550142" && r1.city === "Seattle" && r1.state === "WA" && r1.website === "http://www.summitroof.com" && r1.trade === "roofing" && r1.business === "Summit Roofing LLC" && r1.name === "" && r1.placeId === "p1", JSON.stringify(r1));
check("an address without a zip still gives the city and state; none gives the hunt's state", cityState("Pike Pl, Seattle, WA, USA").city === "Seattle" && cityState("somewhere").city === null && placeToRow(place({ address: null }), H)?.state === "WA" && placeToRow(place({ address: null }), H)?.city === null);
check("closed for good: left out; neither phone nor website: left out; no name: left out", placeToRow(place({ status: "CLOSED_PERMANENTLY" }), H) === null && placeToRow(place({ phone: null, website: null }), H) === null && placeToRow(place({ name: "  " }), H) === null);
check("a Facebook or Yelp page is not the business's site; a bad phone leaves the website", placeToRow(place({ website: "https://www.facebook.com/summitroof" }), H)?.website === null && placeToRow(place({ phone: "12", website: "summitroof.com" }), H)?.phone === null && placeToRow(place({ phone: "12", website: "summitroof.com" }), H)?.website === "https://summitroof.com");
check("'any contractor': the trade read off Google's types; none known → no trade", placeToRow(place(), { trade: "any", state: null })?.trade === "roofing" && placeToRow(place({ types: ["electrician"] }), { trade: "any", state: null })?.trade === "electrical" && placeToRow(place({ types: ["point_of_interest"] }), { trade: "any", state: null })?.trade === null);
check("tidyUrl: scheme added, tracking and hash dropped, trailing slash off, junk null", tidyUrl("summitroof.com/contact/#top") === "https://summitroof.com/contact" && tidyUrl("not a url") === null && tidyUrl("") === null && tidyUrl("https://www.yelp.com/biz/summit") === null);

console.log("— the email off a site —");
const html = `<html><body><a href="mailto:Info@SummitRoof.com?subject=Hi">Email us</a> <p>jobs@gmail.com</p><img src="logo@2x.png"><a href="mailto:noreply@summitroof.com">x</a></body></html>`;
check("a mailto first, lower-cased, the subject dropped, the site's own domain before gmail, no-reply and image names never", emailFromHtml(html, "https://www.summitroof.com") === "info@summitroof.com");
check("no mailto: an address in the text; the site's own domain first", emailFromHtml("Call us or write to owner@summitroof.com or sales@otherco.com.", "https://summitroof.com") === "owner@summitroof.com" && emailFromHtml("write sales@otherco.com.", "https://summitroof.com") === "sales@otherco.com");
check("'info (at) summitroof (dot) com' is read", emailFromHtml("info (at) summitroof (dot) com", "https://summitroof.com") === "info@summitroof.com" && emailFromHtml("info [at] summitroof [dot] com", null) === "info@summitroof.com");
check("no address, a no-reply only, a sentry address: null", emailFromHtml("<p>Call us!</p>", "https://x.com") === null && emailFromHtml("noreply@x.com", "https://x.com") === null && emailFromHtml("a1b2c3d4e5f6a1b2c3d4e5f6@sentry.io", null) === null);
check("the pages read for an email, the home page first", contactPages("https://summitroof.com/")[0] === "https://summitroof.com" && contactPages("https://summitroof.com").includes("https://summitroof.com/contact") && contactPages("https://summitroof.com").length === 5);

console.log("— the rows and the list —");
const csv = rowsToList([r1!, { ...r1!, business: 'Ridge "Top" Fence, LLC', phone: null, email: "pat@ridgefence.com", trade: "fencing", state: "OR", city: "Portland" }]);
const back = parseProspectList(csv);
check("found rows written as a list read back by the importer", back.rows.length === 2 && back.rows[0].phone === "+12065550142" && back.rows[0].trade === "roofing" && back.rows[1].business === 'Ridge "Top" Fence, LLC' && back.rows[1].email === "pat@ridgefence.com" && back.rows[1].trade === "fencing" && back.rows[1].state === "OR", JSON.stringify(back.rows));

console.log("— when a daily hunt is due —");
const seattle7 = new Date("2026-10-26T14:30:00Z"); // 7:30 am in Seattle, Monday
check("the local clock in the area's zone", localClock(seattle7, "America/Los_Angeles").hour === 7 && localClock(seattle7, "America/Los_Angeles").day === "2026-10-26" && localClock(seattle7, "America/New_York").hour === 10);
check(`due once the area's morning has come (${HUNT_HOUR} am) and it hasn't run today`, huntDue(H, seattle7) && !huntDue(H, new Date("2026-10-26T13:30:00Z")) && !huntDue({ ...H, lastRunAt: "2026-10-26T14:05:00Z" }, seattle7) && huntDue({ ...H, lastRunAt: "2026-10-25T15:00:00Z" }, seattle7));
check("a hunt that runs only when pressed is never due; one without a state keeps Pacific time", !huntDue({ ...H, daily: false }, seattle7) && huntDue({ ...H, state: null }, seattle7) && !huntDue({ ...H, state: null }, new Date("2026-10-26T13:30:00Z")));
check("a New York hunt is due three hours earlier (UTC)", huntDue({ ...H, state: "NY" }, new Date("2026-10-26T11:30:00Z")) && !huntDue(H, new Date("2026-10-26T11:30:00Z")));

console.log("— what is remembered —");
const seen = rememberSeen(["a", "b"], ["b", "c", "d"]);
check("places remembered once each, newest last", seen.join(",") === "a,b,c,d");
const many = rememberSeen(Array.from({ length: SEEN_CAP }, (_, i) => `p${i}`), ["new1", "new2"]);
check("capped: the oldest fall off, the newest stay", many.length === SEEN_CAP && many.at(-1) === "new2" && many[0] === "p2");

console.log("— the words —");
check("the hunt's line", huntWords(H) === "Roofing · Seattle, WA · 20 a day · every morning" && huntWords({ ...H, daily: false }).endsWith("when pressed"));
check("its state: not run / ran / ran dry / failed", /Runs tomorrow morning/.test(huntStatusWords(H)) && /12 new last time, 40 in all\./.test(huntStatusWords({ ...H, lastRunAt: "2026-10-25T15:00:00Z", lastFound: 12, totalFound: 40 })) && /no more of this trade here/.test(huntStatusWords({ ...H, lastRunAt: "2026-10-25T15:00:00Z", lastFound: 3, totalFound: 58, exhausted: true })) && /Didn't run: Google/.test(huntStatusWords({ ...H, lastError: "Google's search quota is used up for now — try later." })));
const run = { found: 12, added: 10, merged: 1, onJobflex: 1, withEmail: 7, pages: 1, error: null };
check("what a run says", /Added 10 roofing contractors in Seattle, WA, 7 with an email; 1 already on the list filled in; 1 already on JobFlex left out\./.test(runWords(run, H)) && /No new roofing contractors in Seattle, WA/.test(runWords({ ...run, added: 0, merged: 0, onJobflex: 0 }, H)) && runWords({ ...run, error: "Boom" }, H) === "Boom" && /Added 1 roofing contractor in/.test(runWords({ ...run, added: 1 }, H)));
check("Google's refusals in plain words", /Places API \(New\) isn't turned on/.test(placesErrorWords(403, "Places API (New) has not been used in project 123 before or it is disabled.")) && /quota/.test(placesErrorWords(429, null)) && /refused the key/.test(placesErrorWords(403, "The provided API key is invalid.")) && /answered 500/.test(placesErrorWords(500, null)));

// A WHOLE STATE (owner, 2026-10-26: "all contractors related to us, in California").
const ca = parseArea("California");
check("a state on its own is the whole state — 'California', 'CA', 'all of California', 'California state'", ca.wholeState && ca.state === "CA" && ca.area === "California" && ["CA", "all of California", "California state", " california "].every((x) => parseArea(x).wholeState && parseArea(x).state === "CA"));
check("…a city with its state is not ('Fresno, CA', 'Seattle Washington')", !parseArea("Fresno, CA").wholeState && parseArea("Fresno, CA").state === "CA" && !parseArea("Seattle Washington").wholeState);
const whole = newHunt({ trade: "any", area: "California", perDay: 50, daily: true }, "w1", new Date("2026-10-26T16:00:00Z"));
check("a whole-state hunt: California's cities, the biggest first, starting at the first", whole.ok && whole.hunt.state === "CA" && whole.hunt.cities?.[0] === "Los Angeles" && whole.hunt.cities.length === STATE_CITIES.CA.cities.length && whole.hunt.cityIndex === 0, whole.ok ? JSON.stringify(whole.hunt.cities?.slice(0, 3)) : whole.error);
check("…Google is asked city by city: 'contractors in Los Angeles, CA', then 'contractors in San Diego, CA'", whole.ok && huntQuery(whole.hunt) === "contractors in Los Angeles, CA" && huntQuery({ ...whole.hunt, cityIndex: 1 }) === "contractors in San Diego, CA", whole.ok ? huntQuery(whole.hunt) : "");
check("…the same phrase across every city, then the next phrase from the first city, then done", JSON.stringify(nextSpot({ phrase: 0, city: 0 }, 3, 2)) === '{"phrase":0,"city":1}' && JSON.stringify(nextSpot({ phrase: 0, city: 1 }, 3, 2)) === '{"phrase":1,"city":0}' && nextSpot({ phrase: 2, city: 1 }, 3, 2) === null);
check("…an area walks its phrases as before", JSON.stringify(nextSpot({ phrase: 0, city: 0 }, 3, 0)) === '{"phrase":1,"city":0}' && nextSpot({ phrase: 2, city: 0 }, 3, 0) === null);
check("…its line says the whole state and where the next run goes", whole.ok && /California — the whole state, \d+ cities/.test(huntWords(whole.hunt)) && /Next: San Diego \(city 2 of \d+\)/.test(huntStatusWords({ ...whole.hunt, lastRunAt: "2026-10-26T16:00:00Z", lastFound: 50, totalFound: 50, cityIndex: 1 })));
check("every state and DC has its cities, each with a name", ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"].every((c) => STATE_CITIES[c]?.cities.length >= 1 && STATE_CITIES[c].name.length > 1 && new Set(STATE_CITIES[c].cities).size === STATE_CITIES[c].cities.length));
check("'any contractor' asks for every trade JobFlex is for — fences, decks, painting, concrete, siding, gutters, windows, flooring too", ["fence", "deck", "painting", "concrete", "siding", "gutter", "window", "flooring", "roofing", "HVAC", "plumbers", "electricians"].every((w) => huntPhrases("any").some((p) => p.includes(w))));

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
