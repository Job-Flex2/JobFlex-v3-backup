// The home dashboard's rules (2026-10-03, lib/home/dates): when a plan is,
// when its reminder lands, how it reads, and who may see the dashboard key
// right after a submission. Pure functions, no database.
//   npx --no-install tsx --tsconfig tsconfig.json scripts/qa/home-portal.check.ts
import { localHourAt, mayShowHomeKey, planDate, planWhen, reminderFor, remindModeOf, validTimeZone } from "../../src/lib/home/dates";
import { guessTrade } from "../../src/lib/tradeGuess";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!bad && !ok) console.log("");
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const iso = (d: Date | null) => d?.toISOString() ?? "null";

// ── when a plan is
check("a month plan is its first day", iso(planDate("2026-11", true)) === "2026-11-01T00:00:00.000Z");
check("a day plan is that day", iso(planDate("2026-11-14", false)) === "2026-11-14T00:00:00.000Z");
check("a day in a month plan folds to the first", iso(planDate("2026-11-14", true)) === "2026-11-01T00:00:00.000Z");
check("a nonsense month is refused", planDate("2026-13", true) === null && planDate("next spring", true) === null);
check("the 31st of a short month is refused", planDate("2026-11-31", false) === null);

// ── when the reminder lands: 9 AM in the home's zone
const la = (ymd: string) => localHourAt(planDate(ymd, false)!, 9, "America/Los_Angeles");
check("9 AM Pacific in November is 17:00 UTC (standard time)", iso(la("2026-11-14")) === "2026-11-14T17:00:00.000Z", iso(la("2026-11-14")));
check("9 AM Pacific in July is 16:00 UTC (daylight time)", iso(la("2026-07-14")) === "2026-07-14T16:00:00.000Z", iso(la("2026-07-14")));
check("9 AM in New York is 13:00 UTC in July", iso(localHourAt(planDate("2026-07-01", true)!, 9, "America/New_York")) === "2026-07-01T13:00:00.000Z");
const now = new Date("2026-10-03T20:00:00Z");
// Nov 1, 2026 is the day daylight time ends — 9 AM that morning is already 17:00 UTC.
check("a plan for next month is reminded about on its first day at 9 AM", iso(reminderFor(planDate("2026-11", true)!, "America/Los_Angeles", now)) === "2026-11-01T17:00:00.000Z", iso(reminderFor(planDate("2026-11", true)!, "America/Los_Angeles", now)));
check("a plan for a later month too", iso(reminderFor(planDate("2027-03", true)!, "America/Los_Angeles", now)) === "2027-03-01T17:00:00.000Z");
check("a plan whose month has begun is reminded about a week from now", iso(reminderFor(planDate("2026-10", true)!, "America/Los_Angeles", now)) === "2026-10-10T20:00:00.000Z");
// the form's choice (2026-10-04): two weeks or a week ahead, or none
const nov = planDate("2026-11", true)!;
check("'two weeks before' November lands Oct 18 at 9 AM Pacific (daylight time: 16:00 UTC)", iso(reminderFor(nov, "America/Los_Angeles", now, "2w")) === "2026-10-18T16:00:00.000Z", iso(reminderFor(nov, "America/Los_Angeles", now, "2w")));
check("'a week before' November lands Oct 25", iso(reminderFor(nov, "America/Los_Angeles", now, "1w")) === "2026-10-25T16:00:00.000Z");
check("'don't remind me' is no reminder", reminderFor(nov, "America/Los_Angeles", now, "none") === null);
check("a lead time already passed falls back to the month's start", iso(reminderFor(nov, "America/Los_Angeles", new Date("2026-10-20T00:00:00Z"), "2w")) === "2026-11-01T17:00:00.000Z");
check("the stored time reads back as the choice", remindModeOf(nov, reminderFor(nov, "America/Los_Angeles", now, "2w")) === "2w" && remindModeOf(nov, reminderFor(nov, "America/Los_Angeles", now, "1w")) === "1w" && remindModeOf(nov, reminderFor(nov, "America/Los_Angeles", now, "start")) === "start" && remindModeOf(nov, null) === "none");

// ── how it reads
check("a month plan reads as the month", planWhen(planDate("2026-11", true)!, true) === "November 2026");
check("a day plan reads as the day", planWhen(planDate("2026-11-14", false)!, false) === "Nov 14, 2026");
check("a real zone is accepted, a made-up one is not", validTimeZone("America/Denver") && !validTimeZone("Mars/Olympus") && !validTimeZone(""));

// ── who sees the key on screen right after submitting (lib/home/portal header)
check("a first-timer sees their dashboard at once", mayShowHomeKey({ isNew: true, older: 0, fromDashboard: false }));
check("a returning email does NOT see it on screen (it goes by email)", !mayShowHomeKey({ isNew: false, older: 0, fromDashboard: false }));
check("a new home with older requests under that email does NOT see it on screen", !mayShowHomeKey({ isNew: true, older: 2, fromDashboard: false }));
check("a request made from the dashboard itself sees it", mayShowHomeKey({ isNew: false, older: 3, fromDashboard: true }));

// ── a trade word from the homeowner's words (lib/tradeGuess, 2026-10-14)
check("kitchen words read as a kitchen remodel", guessTrade("I want to remodel my 12x14 kitchen with white shaker cabinets") === "Kitchen remodel");
check("a leaking roof reads as roofing, a bathroom as a bathroom remodel", guessTrade("My roof is 15 years old and leaking around the chimney") === "Roofing" && guessTrade("Hall bathroom: walk-in shower instead of the tub") === "Bathroom remodel");
check("epoxy beats flooring, gutters beat roofing, a deck is a deck", guessTrade("epoxy my garage floor") === "Epoxy floor" && guessTrade("new gutters on the roof line") === "Gutters" && guessTrade("rebuild the back deck") === "Deck");
check("heat pump → HVAC, water heater → Plumbing, repaint → Painting", guessTrade("replace the furnace with a heat pump") === "HVAC" && guessTrade("the water heater is leaking") === "Plumbing" && guessTrade("repaint the living room") === "Painting");
check("nothing to go on → null, never a made-up word", guessTrade("") === null && guessTrade("something for the house") === null);

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
