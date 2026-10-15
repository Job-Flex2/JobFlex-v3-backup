// THE AI DESK AT A GLANCE (2026-10-14 redesign): the overview's status, the setup progress, each tab's state, and the
// tab it opens on (the address, a minutes purchase, the first thing not done).
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json scripts/qa/ai-desk-overview.check.ts
import { deskOverview, firstTab } from "../../src/components/v3/ai-desk/desk-overview";
import type { DeskSettingsData } from "../../src/components/v3/settings-blueprint/settings-data";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const balance = { includedMinutes: 150, usedSeconds: 0, includedLeftSeconds: 9000, packSeconds: 0, remainingSeconds: 9000, out: false, low: false, autoTopUp: false };
const base = {
  assistantOnPlan: true, mode: "ANSWER", forwarding: "none", businessPhone: "(425) 555-0100", forwardCheck: null,
  steps: { number: true, profile: true, booking: true, tested: false },
  minutes: { balance }, use: { calls: 3 }, voice: "marin",
} as unknown as DeskSettingsData;
const with_ = (p: Partial<Record<string, unknown>>) => ({ ...base, ...p }) as unknown as DeskSettingsData;

let o = deskOverview(base, "(866) 897-5760", 0, true);
check("all set but the test: live, 3 of 4, next is voice", o.status.tone === "live" && /answering every call/.test(o.status.words) && o.count === 3 && o.next === "voice", JSON.stringify(o.status));
check("tab states: done, done, booking on, not tested, minutes left", o.tabs.numbers.tone === "done" && o.tabs.business.tone === "done" && o.tabs.booking.words === "Booking on" && o.tabs.voice.words === "Not tested" && o.tabs.minutes.words === "150 min left");
o = deskOverview(base, null, 0, true);
check("no number: warn, phone to do, next is the phone", o.status.tone === "warn" && /No number/.test(o.status.words) && o.tabs.numbers.tone === "todo" && o.next === "numbers");
o = deskOverview(with_({ forwarding: "all" }), "(866) 897-5760", 0, true);
check("forwarding not confirmed: warn, 'Forwarding to check', pending", o.forwardingPending && o.status.tone === "warn" && o.tabs.numbers.words === "Forwarding to check" && !o.done.numbers);
o = deskOverview(with_({ forwarding: "all", forwardCheck: { status: "works" } }), "(866) 897-5760", 0, true);
check("forwarding seen working: done, live", !o.forwardingPending && o.done.numbers && o.status.tone === "live");
o = deskOverview(base, "(866) 897-5760", 4, true);
check("parts to check: the business tab says how many, and is not done", o.tabs.business.words === "4 to check" && o.tabs.business.tone === "check" && !o.done.business);
o = deskOverview(base, "(866) 897-5760", 0, false);
check("nothing described yet: answering with company details only", o.status.tone === "warn" && /company details only/.test(o.status.words));
o = deskOverview(with_({ assistantOnPlan: false }), "(866) 897-5760", 0, true);
check("not on the plan: off", o.status.tone === "off");
o = deskOverview(with_({ minutes: { balance: { ...balance, out: true, remainingSeconds: 0 } } }), "(866) 897-5760", 0, true);
check("out of minutes: warn, the minutes tab says Out", o.status.tone === "warn" && /Out of minutes/.test(o.status.words) && o.tabs.minutes.words === "Out" && o.tabs.minutes.tone === "warn");
o = deskOverview(with_({ mode: "FORWARD" }), "(866) 897-5760", 0, true);
check("ring my phone first: live, taking the calls you miss", /taking the calls you miss/.test(o.status.words));

const seven = deskOverview(base, "(866) 897-5760", 0, true);
check("opens on the address's tab", firstTab(seven, "?pane=desk&step=minutes") === "minutes" && firstTab(seven, "?step=booking&pane=desk") === "booking");
check("a junk step is ignored", firstTab(seven, "?step=nope") === "voice");
check("back from buying minutes → minutes", firstTab(seven, "?pane=desk&pack_paid=1&session_id=x") === "minutes");
check("else the first thing not done; all done → your business", firstTab(seven, "") === "voice" && firstTab(deskOverview(with_({ steps: { number: true, profile: true, booking: true, tested: true } }), "(866) 897-5760", 0, true), "") === "business");

if (bad) {
  console.log(`\n${bad} FAILED`);
  process.exit(1);
}
console.log("\nall passed");
