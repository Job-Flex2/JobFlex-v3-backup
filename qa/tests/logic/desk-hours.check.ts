// Reserved hours for the AI desk (2026-10-16, lib/deskHours): what a reservation is, how it reads, the days it lands
// on in the shop's time zone, and the times the desk offers inside it — a person's hours skip their own visits, the
// company's follow the crew count, two people free at once are one time. Pure: no database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/desk-hours.check.ts
import { parseBookingSettings, type BookingService } from "../../../src/lib/booking";
import {
  cleanDeskHours,
  cleanWindow,
  expandWindows,
  overlapsExisting,
  parseDeskHours,
  reservedSlots,
  shopToday,
  spanWords,
  upcomingWindows,
  windowProblem,
  windowWords,
  zonedHhmm,
  zonedYmd,
  type DeskWindow,
} from "../../../src/lib/deskHours";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const TZ = "America/New_York";
const w = (o: Partial<DeskWindow>): DeskWindow => ({ id: o.id ?? "w1", userId: o.userId ?? null, date: o.date ?? null, dow: o.dow ?? null, from: o.from ?? "09:00", to: o.to ?? "12:00", note: "", by: null, at: "" });

// ── a reservation ──
check("one day or every week — exactly one", !!cleanWindow(w({ date: "2026-10-20" })) && !!cleanWindow(w({ dow: 2 })) && cleanWindow({ ...w({ date: "2026-10-20" }), dow: 2 }) === null && cleanWindow(w({})) === null);
check("hours, not whole days: down to the minute, at least 30 minutes, end after start", !!cleanWindow(w({ dow: 1, from: "13:15", to: "13:45" })) && cleanWindow(w({ dow: 1, from: "13:00", to: "13:20" })) === null && cleanWindow(w({ dow: 1, from: "14:00", to: "13:00" })) === null && cleanWindow(w({ dow: 1, from: "25:00", to: "26:00" })) === null);
check("junk is not a reservation", cleanWindow(null) === null && cleanWindow({ id: "", dow: 1, from: "09:00", to: "10:00" }) === null && cleanWindow({ id: "x", date: "Tuesday", from: "09:00", to: "10:00" }) === null);
check("stored hours read back; anything else is open hours with none", parseDeskHours(JSON.stringify({ mode: "reserved", windows: [w({ dow: 2 }), { junk: 1 }] })).windows.length === 1 && parseDeskHours("nope").mode === "open-hours" && parseDeskHours(null).windows.length === 0 && cleanDeskHours({ mode: "whatever" }).mode === "open-hours");
check("why it can't be reserved, in words", windowProblem({ date: "2026-10-01", dow: null, from: "09:00", to: "10:00" }, "2026-10-16") === "That day has passed." && windowProblem({ date: null, dow: 2, from: "10:00", to: "09:00" }, "2026-10-16") === "The end has to be after the start." && windowProblem({ date: null, dow: null, from: "09:00", to: "10:00" }, "2026-10-16") === "Pick a day, or a day of the week." && windowProblem({ date: "2026-10-16", dow: null, from: "09:00", to: "09:15" }, "2026-10-16") === "Reserve at least 30 minutes." && windowProblem({ date: "2026-10-16", dow: null, from: "09:00", to: "11:30" }, "2026-10-16") === null);
check("a person's overlapping hours are refused; another person's or the company's are not", !!overlapsExisting(w({ dow: 2, from: "10:00", to: "13:00", userId: "u1" }), [w({ dow: 2, userId: "u1" })]) && !overlapsExisting(w({ dow: 2, from: "10:00", to: "13:00", userId: "u2" }), [w({ dow: 2, userId: "u1" })]) && !overlapsExisting(w({ dow: 2, from: "12:00", to: "13:00", userId: "u1" }), [w({ dow: 2, userId: "u1" })]));
check("…a day that falls on a weekly reservation's weekday overlaps it too", !!overlapsExisting(w({ date: "2026-10-20", from: "11:00", to: "14:00", userId: "u1" }), [w({ dow: 2, userId: "u1" })]));
check("how it reads", windowWords(w({ dow: 2, from: "13:00", to: "16:00" })) === "Every Tuesday · 1–4 PM" && windowWords(w({ date: "2026-10-20", from: "09:00", to: "12:30" })) === "Tue, Oct 20 · 9 AM–12:30 PM" && spanWords("11:30", "13:00") === "11:30 AM–1 PM", windowWords(w({ date: "2026-10-20", from: "09:00", to: "12:30" })));
check("the ones still ahead, weekly first", upcomingWindows([w({ id: "a", date: "2026-10-01" }), w({ id: "b", date: "2026-10-21" }), w({ id: "c", dow: 3 })], "2026-10-16").map((x) => x.id).join() === "c,b");

// ── the days they land on, on the shop's clock ──
const now = new Date("2026-10-16T16:00:00Z"); // Fri Oct 16, noon in New York
const spans = expandWindows([w({ id: "tue", dow: 2, from: "13:00", to: "16:00" }), w({ id: "one", date: "2026-10-19", from: "09:00", to: "11:00" })], now, 14, TZ);
check("every Tuesday in two weeks, and the one Monday", spans.filter((x) => x.windowId === "tue").length === 2 && spans.filter((x) => x.windowId === "one").length === 1);
check("on the shop's clock: 1 PM in New York is 17:00 UTC in October", spans.find((x) => x.windowId === "tue")!.startsAt.toISOString() === "2026-10-20T17:00:00.000Z");
check("…and after the clocks change, 1 PM is 18:00 UTC", expandWindows([w({ dow: 2, from: "13:00", to: "16:00" })], new Date("2026-11-02T12:00:00Z"), 7, TZ)[0].startsAt.toISOString() === "2026-11-03T18:00:00.000Z");
check("the shop's day and clock of an instant", shopToday(now, TZ) === "2026-10-16" && zonedYmd(new Date("2026-10-17T02:00:00Z"), TZ) === "2026-10-16" && zonedHhmm(new Date("2026-10-20T17:30:00Z"), TZ) === "13:30");

// ── the times the desk offers ──
const settings = { ...parseBookingSettings(null, ["Roofing"]), slotMinutes: 60, leadHours: 2, horizonDays: 14, crews: 2 };
const service: BookingService = { key: "estimate", label: "Free estimate", kind: "estimate", minutes: 60, priceText: "Free", trade: "roofing" };
const base = { settings, service, timeZone: TZ, now, orgBusy: [] as Array<{ startsAt: Date; endsAt: Date }>, busyOf: () => [] as Array<{ startsAt: Date; endsAt: Date }> };
const dana = [w({ id: "d", userId: "dana", date: "2026-10-19", from: "09:00", to: "12:00" })];
const plain = reservedSlots({ ...base, windows: dana });
check("inside the reservation, on the slot grid, long enough for the visit", plain.length === 1 && plain[0].slots.map((x) => zonedHhmm(x.startsAt, TZ)).join() === "09:00,10:00,11:00" && plain[0].slots.every((x) => x.userId === "dana" && x.windowId === "d"));
const busyDana = reservedSlots({ ...base, windows: dana, busyOf: (u) => (u === "dana" ? [{ startsAt: new Date("2026-10-19T14:00:00Z"), endsAt: new Date("2026-10-19T15:00:00Z") }] : []) });
check("a person's own visit takes that hour out of their reservation", busyDana[0].slots.map((x) => zonedHhmm(x.startsAt, TZ)).join() === "09:00,11:00");
const company = [w({ id: "c", userId: null, date: "2026-10-19", from: "09:00", to: "11:00" })];
const oneCrewOut = reservedSlots({ ...base, windows: company, orgBusy: [{ startsAt: new Date("2026-10-19T13:00:00Z"), endsAt: new Date("2026-10-19T14:00:00Z") }] });
const twoCrewOut = reservedSlots({ ...base, windows: company, orgBusy: [{ startsAt: new Date("2026-10-19T13:00:00Z"), endsAt: new Date("2026-10-19T14:00:00Z") }, { startsAt: new Date("2026-10-19T13:00:00Z"), endsAt: new Date("2026-10-19T14:00:00Z") }] });
check("the company's reservation follows the crew count", oneCrewOut[0].slots.length === 2 && twoCrewOut[0].slots.map((x) => zonedHhmm(x.startsAt, TZ)).join() === "10:00");
const both = reservedSlots({ ...base, windows: [...dana, w({ id: "s", userId: "sam", date: "2026-10-19", from: "09:00", to: "12:00" })] });
check("two people free at the same hour are one time to the caller", both[0].slots.length === 3 && both[0].slots.every((x) => x.userId === "dana"));
const danaBusyAll = reservedSlots({ ...base, windows: [...dana, w({ id: "s", userId: "sam", date: "2026-10-19", from: "09:00", to: "12:00" })], busyOf: (u) => (u === "dana" ? [{ startsAt: new Date("2026-10-19T13:00:00Z"), endsAt: new Date("2026-10-19T16:00:00Z") }] : []) });
check("…and when one is booked up, the other takes the hour", danaBusyAll[0].slots.length === 3 && danaBusyAll[0].slots.every((x) => x.userId === "sam"));
const soon = reservedSlots({ ...base, windows: [w({ date: "2026-10-16", from: "12:00", to: "17:00" })] });
check("the notice time applies — nothing before two hours from now", soon[0].slots.map((x) => zonedHhmm(x.startsAt, TZ)).join() === "14:00,15:00,16:00");
const short = reservedSlots({ ...base, windows: [w({ date: "2026-10-19", from: "09:00", to: "09:45" })] });
check("a reservation shorter than the visit offers nothing", short.length === 0);
const far = reservedSlots({ ...base, windows: [w({ dow: 2, from: "09:00", to: "10:00" })], days: 7 });
check("the horizon applies", far.length === 1 && far[0].day === "2026-10-20");
check("no reservations, no times", reservedSlots({ ...base, windows: [] }).length === 0);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
