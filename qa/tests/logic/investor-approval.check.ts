// THE INVESTOR LINK WAITS FOR OUR YES (owner, 2026-10-20: "don't open the link till we approve it … send SMS to us …
// we will review their info, who they are, and approve it, and they will get it"). The pure half: where a reader
// stands, who may read, the requests in the order they asked, what a reviewer can tell from a request, the look-up
// links, the team's alert key and the office board's line.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/investor-approval.check.ts
import { lookupLinks, mayRead, pendingOf, readersOf, reviewHints, statusOf } from "../../../src/lib/investorGate";
import { ALERT_KEYS, ALERT_WORDS } from "../../../src/lib/adminTasks/teamShared";
import { buildAttention } from "../../../src/lib/officeScreen";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

console.log("── where a reader stands");
check("an entry from before approvals (no status) reads as let in — they saw the figures already", statusOf({}) === "approved" && mayRead({}, true));
check("a request waits while approvals are on", statusOf({ status: "pending" }) === "pending" && !mayRead({ status: "pending" }, true));
check("…and opens when approvals are switched off", mayRead({ status: "pending" }, false));
check("a declined reader stays out either way", !mayRead({ status: "declined" }, true) && !mayRead({ status: "declined" }, false));
check("an admin's own walk-through is never kept waiting", statusOf({ status: "pending", admin: true }) === "approved" && mayRead({ status: "pending", admin: true }, true));
const list = [
  { id: "c", at: "2026-10-20T10:05:00Z", status: "pending" as const },
  { id: "a", at: "2026-10-20T09:00:00Z", status: "pending" as const },
  { id: "x", at: "2026-10-20T08:00:00Z", status: "approved" as const },
  { id: "t", at: "2026-10-20T07:00:00Z", status: "pending" as const, admin: true },
];
check("the requests waiting, oldest first — an admin's test and anyone let in left out", pendingOf(list).map((v) => v.id).join(",") === "a,c");
check("the admins' own entries are still not readers", readersOf(list).length === 3);

console.log("── what a reviewer can tell from the request");
const vc = { name: "Jane Doe", company: "Acme Ventures", kind: "VC fund", email: "jane@acmevc.com", phone: "+1 206 555 0100" };
const hv = reviewHints(vc);
check("a company email that matches the fund's name says so", hv.some((h) => h.tone === "good" && /acmevc\.com — matches Acme Ventures/.test(h.text)), hv.map((h) => h.text).join(" | "));
check("an investor kind is good news", hv.some((h) => h.tone === "good" && /Invests — vc fund/.test(h.text)));
check("a phone left: no 'no phone' note", !hv.some((h) => /No phone/.test(h.text)));
const gmail = reviewHints({ ...vc, email: "jane.doe1987@gmail.com", phone: null });
check("a free mailbox is a warning — nothing ties it to the fund", gmail.some((h) => h.tone === "warn" && /personal mailbox \(gmail\.com\)/i.test(h.text)) && gmail.some((h) => /No phone/.test(h.text)));
const other = reviewHints({ ...vc, email: "j@randomco.io" });
check("a company email that is not the named company is a warning", other.some((h) => h.tone === "warn" && /randomco\.io — not the name Acme Ventures/.test(h.text)));
const squashed = reviewHints({ ...vc, company: "Blue Ridge Capital", email: "jd@blueridge.com" });
check("'Blue Ridge Capital' at blueridge.com matches (words joined, 'capital' ignored)", squashed.some((h) => h.tone === "good" && /matches/.test(h.text)), squashed.map((h) => h.text).join(" | "));
const roofer = reviewHints({ ...vc, kind: "Contractor or trade business" });
check("not an investor is said plainly, not as a warning", roofer.some((h) => h.tone === "info" && /Not an investor/.test(h.text)));
const hist = reviewHints(vc, { earlierApproved: 1, earlierDeclined: 1 });
check("a yes or a no given to the same email before is shown", hist.some((h) => /let this email in on an earlier link/.test(h.text)) && hist.some((h) => /declined this email before/.test(h.text)));
const links = lookupLinks(vc);
check("look-ups: LinkedIn and Google searches by name and company, and the company's own site", links.length === 3 && links[0].href.includes("linkedin.com") && links[0].href.includes(encodeURIComponent("Jane Doe Acme Ventures")) && links[2].href === "https://acmevc.com");
check("…no 'site' for a free mailbox", lookupLinks({ ...vc, email: "j@gmail.com" }).length === 2);

console.log("── the team's text and the office board");
check("'Investor link requests' is an alert the team can tick", (ALERT_KEYS as readonly string[]).includes("investor") && /Investor link requests/.test(ALERT_WORDS.investor.label));
const base = { failedPayments: [], trialsEndingToday: [], setToCancel: [], setToCancelCard: [], signupsToday: [], supportUnread: 0, supportOldest: null, leadQueue: 0, health: [], visitors: null, sentToday: 0, sentYesterday: 0 };
const att = buildAttention({ ...base, investorRequests: [{ name: "Jane Doe", company: "Acme Ventures" }, { name: "Sam Lee", company: "Lee Family Office" }] } as Parameters<typeof buildAttention>[0]);
const line = att.find((a) => /investor request/.test(a.text));
check("the office board: '2 investor requests to review', with who", !!line && /2 investor requests to review/.test(line.text) && (line.who ?? []).join("|") === "Jane Doe · Acme Ventures|Sam Lee · Lee Family Office", line?.text ?? "none");
check("…and nothing when no one is waiting", !buildAttention(base as Parameters<typeof buildAttention>[0]).some((a) => /investor request/.test(a.text)));

console.log(bad ? `${bad} FAILED` : "ALL PASS");
process.exit(bad ? 1 : 0);
