// THE OFFICE SCREEN's pure rules (2026-10-13): the feed's order, the comparison under a number, and the "needs you"
// lines — what is said, in what order, and what is never said on a quiet day.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/office-screen.check.ts
import { buildAttention, deltaWords, orderFeed, type AttentionFacts, type OfficeFeedItem } from "../../../src/lib/officeScreen";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const H = 3_600_000;
const dayStart = Date.UTC(2026, 9, 13, 7); // midnight in Los Angeles
const now = dayStart + 15 * H; // 3 pm
const base: AttentionFacts = {
  now, dayStart, trialsEndingToday: [], trialsEndingTomorrow: 0, failedPayments: [], setToCancelCard: [], signupsToday: [],
  supportUnread: 0, supportOldest: null, leadQueue: 0, health: [], visitors: null, sentToday: 0, sentYesterday: 0,
};

// ── deltas ──
check("+3 vs yesterday, up", JSON.stringify(deltaWords(5, 2)) === JSON.stringify({ text: "+3 vs yesterday", dir: "up" }));
check("−2 vs yesterday, down", deltaWords(1, 3)?.text === "−2 vs yesterday" && deltaWords(1, 3)?.dir === "down");
check("same as yesterday", deltaWords(4, 4)?.text === "same as yesterday");
check("no comparison → nothing", deltaWords(4, null) === null);
check("money says dollars", deltaWords(1500, 1000, true)?.text === "+$500 vs yesterday");

// ── feed ──
const f = (at: number, kind: OfficeFeedItem["kind"], who = "Acme"): OfficeFeedItem => ({ at, kind, who, text: kind });
const ordered = orderFeed([f(now - 5 * H, "signup"), f(now - H, "sent"), f(now - 2 * H, "accepted", "Bolt")]);
check("newest first", ordered.map((x) => x.kind).join(",") === "sent,accepted,signup");
const twin = orderFeed([f(now - H, "proposal"), f(now - H, "first")]);
check("a first proposal and the same proposal at the same minute: the first one stays", twin.length === 1 && twin[0].kind === "first");
check("a limit is a limit", orderFeed(Array.from({ length: 50 }, (_, i) => f(now - i * 60_000, "signup", `Co ${i}`)), 30).length === 30);

// ── needs you ──
check("a quiet, healthy day says nothing", buildAttention(base).length === 0);
const health = [
  { name: "Stripe", level: "down" as const, reason: "rejected the key", optional: false },
  { name: "Twilio", level: "degraded" as const, reason: "toll-free still in review", optional: false },
  { name: "Regrid", level: "down" as const, reason: "token expired", optional: true },
];
const a = buildAttention({ ...base, health, failedPayments: ["Ridge Co"], trialsEndingToday: [{ name: "Acme", proposals: 0, card: true }, { name: "Bolt", proposals: 3, card: false }], supportUnread: 2, supportOldest: now - 6 * H, leadQueue: 1, trialsEndingTomorrow: 2 });
check("worst first: a system down, then a failed payment", a[0].tone === "bad" && /Stripe is down/.test(a[0].text) && a[1].tone === "bad" && /payment failed/.test(a[1].text), a.map((x) => x.text).join(" | "));
check("an OPTIONAL service down is not an alarm", !a.some((x) => /Regrid/.test(x.text)));
check("trials ending today, the one without a proposal named", a.some((x) => x.text === "2 trials end today — 1 without a proposal" && x.who?.includes("Acme · card") === true));
check("support six hours old warns, with its age", a.some((x) => x.tone === "warn" && x.text === "2 support messages unread — oldest 6 hours ago"));
check("the hand-match queue and tomorrow's trials", a.some((x) => /1 homeowner request waiting/.test(x.text)) && a.some((x) => x.text === "2 trials end tomorrow"));
check("a degraded system is a warning with its reason", a.some((x) => x.tone === "warn" && x.text === "Twilio: toll-free still in review"));
const gone = buildAttention({ ...base, signupsToday: [{ name: "Quiet Co", at: now - 3 * H, lastSeen: now - 3 * H + 2 * 60_000, views: 3 }, { name: "Busy Co", at: now - 3 * H, lastSeen: now - 10 * 60_000, views: 40 }, { name: "New Co", at: now - 20 * 60_000, lastSeen: null, views: 1 }] });
check("a signup that never came back (2 h on) is named; a busy one and a 20-minute-old one are not", gone.length === 1 && gone[0].who?.join() === "Quiet Co", JSON.stringify(gone));
check("visitors well behind yesterday warn; a small day does not", buildAttention({ ...base, visitors: { today: 30, yesterday: 100 } }).some((x) => /70% behind yesterday/.test(x.text)) && buildAttention({ ...base, visitors: { today: 2, yesterday: 10 } }).length === 0);
check("no proposals sent by afternoon when yesterday had some", buildAttention({ ...base, sentToday: 0, sentYesterday: 4 }).some((x) => /No proposals sent yet today — 4 by now yesterday/.test(x.text)));
check("…but not in the morning", buildAttention({ ...base, now: dayStart + 9 * H, sentToday: 0, sentYesterday: 4 }).length === 0);

// ── the investor link (2026-10-13) ──
const offers = buildAttention({ ...base, recentOffers: [{ company: "Cascade Ventures", amount: "$500K–$1M", at: now - H }] });
check("a VC offer from the investor link is a good line to answer, naming the fund", offers.length === 1 && offers[0].tone === "good" && /1 VC offer to answer/.test(offers[0].text) && offers[0].who?.[0] === "Cascade Ventures · $500K–$1M", JSON.stringify(offers));
check("…and sits after the alarms", buildAttention({ ...base, failedPayments: ["X"], recentOffers: [{ company: "A", amount: "Open", at: now }] })[0].tone === "bad");

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
