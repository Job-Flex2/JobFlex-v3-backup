// Equipment on file, the visit report, and online booking — the plain rules
// (2026-09-23). Pure, no database.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/equipment-booking.check.ts
import { equipmentAdvice, equipmentAge, equipmentFromNameplate, equipmentLine, readingFieldsFor, readingFindings, reportSummary, visitKindFromTitle } from "../../../src/lib/equipment";
import { availableSlots, bookingScope, defaultServicesFor, parseBookingSettings, slotLabel, zonedInstant, zonedParts } from "../../../src/lib/booking";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const now = new Date("2026-09-23T15:00:00Z");

// ── equipment
const unit = { kind: "split-ac-furnace", brand: "Carrier", model: "24ACC636", tons: 3, refrigerant: "R-410A", yearMade: 2014 };
check("a unit reads as one line with its age", equipmentLine(unit, now) === "AC + gas furnace · Carrier 24ACC636 · 3 ton · R-410A · 2014 (12 years)", equipmentLine(unit, now));
check("age from the year made, or the install date, or unknown", equipmentAge({ yearMade: 2014 }, now) === 12 && equipmentAge({ installedAt: new Date("2020-06-01") }, now) === 6 && equipmentAge({}) === null);
check("advice: 12 years → a replacement conversation at the next big failure; 16 → quote the replacement next to a big repair; 19 → plan it; R-22 → the refrigerant line; 4 years → nothing", /replacement conversation/.test(equipmentAdvice(unit, now) ?? "") && /quote the replacement/.test(equipmentAdvice({ kind: "split-ac-furnace", yearMade: 2010 }, now) ?? "") && /past the usual life/.test(equipmentAdvice({ kind: "furnace-only", yearMade: 2007 }, now) ?? "") && /R-22/.test(equipmentAdvice({ kind: "split-ac-furnace", refrigerant: "R-22", yearMade: 2018 }, now) ?? "") && equipmentAdvice({ kind: "ductless", yearMade: 2022 }, now) === null, equipmentAdvice(unit, now) ?? "");
const np = equipmentFromNameplate({ kind: "outdoor", brand: "Trane", model: "4TTR6036", serial: "1912ABCD", tons: 3, refrigerant: "R-410A", yearMade: 2019 });
check("a nameplate read files as the right kind with its numbers", np.kind === "split-ac-furnace" && np.brand === "Trane" && np.tons === 3 && np.yearMade === 2019 && equipmentFromNameplate({ kind: "furnace" }).kind === "furnace-only" && equipmentFromNameplate({ kind: "water-heater" }).kind === "water-heater");

// ── the report
check("a spring tune-up is the cooling side, fall the heating side, a plain tune-up both, a repair call other", visitKindFromTitle("Spring cooling tune-up · Comfort Plan") === "cooling" && visitKindFromTitle("Fall heating tune-up") === "heating" && visitKindFromTitle("Tune-up visit 1") === "both" && visitKindFromTitle("Repair / diagnostic visit — Sam") === "other");
check("the cooling checklist has the split, superheat and capacitor; the heating one gas pressure, flame sensor and CO; both have static pressure", readingFieldsFor("cooling").some((f) => f.key === "superheat") && !readingFieldsFor("cooling").some((f) => f.key === "gasPressure") && readingFieldsFor("heating").some((f) => f.key === "flameSensorUa") && readingFieldsFor("heating").some((f) => f.key === "staticPressure") && readingFieldsFor("both").length > readingFieldsFor("cooling").length);
const f1 = readingFindings({ staticPressure: "0.95", deltaT: "12", capacitorUf: 38, capacitorRatedUf: 45, superheat: "10" }, "cooling");
check("high static, a low split and a weak capacitor become findings; a normal superheat does not", f1.length === 3 && f1.some((f) => /Static pressure/.test(f.text) && f.severity === "fix") && f1.some((f) => /capacitor/.test(f.text) && /84%/.test(f.text)) && f1.some((f) => /split/.test(f.text) && f.severity === "watch"), f1.map((f) => f.text.slice(0, 40)).join(" | "));
const f2 = readingFindings({ coRegister: "12", flameSensorUa: "0.6" }, "heating");
check("CO at the register is urgent; a weak flame sensor is a fix", f2.some((f) => f.severity === "urgent" && /monoxide/.test(f.text)) && f2.some((f) => /Flame sensor/.test(f.text) && f.severity === "fix"));
check("nothing off the range, no findings", readingFindings({ staticPressure: "0.5", deltaT: "18", flameSensorUa: "3", coRegister: "0" }, "both").length === 0);
const sum = reportSummary({ kind: "cooling", findings: f1, equipmentLine: equipmentLine(unit, now), advice: equipmentAdvice(unit, now) });
check("the summary names the tune-up, the unit, the repairs and the age advice", /cooling tune-up on the AC \+ gas furnace/.test(sum) && /2 repairs soon/.test(sum) && /replacement conversation/.test(sum), sum.slice(0, 160));
check("a clean visit says so", /inside the normal range/.test(reportSummary({ kind: "heating", findings: [] })));
check("an urgent finding leads the summary", /needs attention now/.test(reportSummary({ kind: "heating", findings: f2 })));

// ── booking services
const hvacRoof = defaultServicesFor(["HVAC", "Roofing"]);
check("an HVAC + roofing shop offers diagnostic, same-day, tune-up, replacement estimate, roof estimate, leak call and something else", ["hvac-diagnostic", "hvac-emergency", "hvac-tuneup", "hvac-estimate", "roof-estimate", "roof-leak", "other"].every((k) => hvacRoof.some((s) => s.key === k)) && hvacRoof.every((s) => s.minutes > 0 && s.priceText), hvacRoof.map((s) => s.key).join(","));
check("members read a different price on the HVAC visits", hvacRoof.find((s) => s.key === "hvac-diagnostic")?.memberPriceText === "Diagnostic waived for members" && hvacRoof.find((s) => s.key === "hvac-tuneup")?.memberPriceText === "Included in your plan");
check("a fence shop gets a fence estimate visit, a remodeler a consultation, an unknown trade a plain estimate visit, no trades at all just the estimate visit and something else", defaultServicesFor(["Fencing"]).some((s) => s.key === "fence-estimate") && defaultServicesFor(["Kitchen & Bath"]).some((s) => s.key === "remodel-consult") && defaultServicesFor(["Landscaping"]).some((s) => s.key === "estimate") && defaultServicesFor([]).map((s) => s.key).join(",") === "estimate,other");
check("the diagnostic asks what it is doing, the system and the age", (hvacRoof.find((s) => s.key === "hvac-diagnostic")?.questions ?? []).map((q) => q.key).join(",") === "symptom,system,age");
const healed = parseBookingSettings('{"slotMinutes": 30, "crews": 2, "hours": "bad"}', ["HVAC"]);
check("saved settings heal: bad hours fall back, numbers are clamped, services default", healed.slotMinutes === 30 && healed.crews === 2 && healed.hours.length === 7 && healed.hours[1] !== null && healed.services.length > 0);

// ── slots
const tz = "America/Los_Angeles";
const settings = parseBookingSettings(null, ["HVAC"]);
const svc = settings.services.find((s) => s.key === "hvac-diagnostic")!;
const busy = [{ startsAt: zonedInstant(2026, 9, 25, 8, 0, tz), endsAt: zonedInstant(2026, 9, 25, 12, 0, tz) }];
const days = availableSlots({ settings, service: svc, busy, timeZone: tz, now, days: 5 });
check("no weekend days; Thursday and Friday are offered (24-hour lead time from Wednesday 8am PT)", days.every((d) => d.weekday !== "Saturday" && d.weekday !== "Sunday") && days.some((d) => d.day === "2026-09-24") && days.some((d) => d.day === "2026-09-25"), days.map((d) => `${d.day} ${d.weekday} ×${d.slots.length}`).join(" | "));
const fri = days.find((d) => d.day === "2026-09-25")!;
const friFirst = zonedParts(fri.slots[0].startsAt, tz);
check("Friday morning is taken by the visit already there: the first free slot is at noon, the last starts by 3:30", friFirst.h === 12 && fri.slots.every((s) => zonedParts(s.endsAt, tz).h <= 17), fri.slots.map((s) => zonedParts(s.startsAt, tz).h).join(","));
const thu = days.find((d) => d.day === "2026-09-24")!;
check("Thursday starts at the shop's 8:00 and a 90-minute visit fits until 15:30", zonedParts(thu.slots[0].startsAt, tz).h === 8 && thu.slots.length === 8, String(thu.slots.length));
const urgent = settings.services.find((s) => s.key === "hvac-emergency")!;
const urgentDays = availableSlots({ settings, service: urgent, busy: [], timeZone: tz, now, days: 2 });
check("an urgent service can start today, two hours out", urgentDays[0]?.day === "2026-09-23" && zonedParts(urgentDays[0].slots[0].startsAt, tz).h >= 10, urgentDays.map((d) => d.day).join(","));
const twoCrews = availableSlots({ settings: { ...settings, crews: 2 }, service: svc, busy, timeZone: tz, now, days: 5 }).find((d) => d.day === "2026-09-25")!;
check("with two crews the taken morning is still bookable", zonedParts(twoCrews.slots[0].startsAt, tz).h === 8);
check("a slot reads as an arrival window on the shop's clock", slotLabel(thu.slots[0], tz, 120) === "Thu, Sep 24 · 8:00 AM–10:00 AM arrival", slotLabel(thu.slots[0], tz, 120));
check("the booking's scope carries the service, the answers and the customer's words", bookingScope(svc, [{ label: "What is it doing?", value: "No cooling" }, { label: "About how old is the system?", value: "10–15" }], "Upstairs is 85 degrees") === "Repair / diagnostic visit booked online.\nWhat is it doing? No cooling\nAbout how old is the system? 10–15\nIn their words: Upstairs is 85 degrees");

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
