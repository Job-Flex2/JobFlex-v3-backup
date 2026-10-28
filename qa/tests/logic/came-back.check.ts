// WHO CAME BACK (lib/cameBack, 2026-10-28): card-less trials that ended and later paid, cancellations whose
// company pays again, the 10% offer's part, and every cancellation's state today.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/came-back.check.ts
import { isBack, nowOf, shapeCameBack, type CameBackCancel, type CameBackCardless, type CameBackOrg, type CameBackWinback } from "../../../src/lib/cameBack";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const DAY = 86_400_000;
const NOW = Date.parse("2026-10-28T20:00:00Z");
const d = (daysAgo: number) => NOW - daysAgo * DAY;

check("what the row says today", nowOf("ACTIVE") === "paying" && nowOf("TRIALING") === "trial" && nowOf("PAST_DUE") === "failing" && nowOf("UNPAID") === "failing" && nowOf("CANCELED") === "gone" && nowOf("TRIAL_ENDED") === "gone" && nowOf("") === "gone");
check("back = anything but gone", isBack("paying") && isBack("trial") && isBack("failing") && !isBack("gone"));

const org = (id: string, status: string, extra: Partial<CameBackOrg> = {}): CameBackOrg => ({ id, name: id.toUpperCase(), email: `${id}@x.test`, createdAt: d(40), plan: "professional", status, trialEndsAt: null, currentPeriodEnd: null, ...extra });
const orgs: CameBackOrg[] = [
  org("r1", "ACTIVE", { currentPeriodEnd: NOW + 20 * DAY }), // card-less trial ran out, paid 9 days later, after the offer
  org("r2", "ACTIVE"), // ran out, paid the next day, before any offer
  org("r3", "CANCELED"), // restarted, then cancelled again: listed as restarted, not counted as back
  org("c1", "ACTIVE", { trialEndsAt: d(25), currentPeriodEnd: NOW + 12 * DAY }), // cancelled during the trial, pays now
  org("c2", "ACTIVE", { trialEndsAt: d(60) }), // cancelled after the trial, pays now
  org("c3", "CANCELED", { trialEndsAt: d(10) }), // cancelled during the trial, still gone
  org("c4", "TRIALING", { trialEndsAt: NOW + 5 * DAY }), // cancelled, now on a trial again (the row holds only the new trial, so the cancel reads as inside one)
  org("t1", "TRIAL_ENDED"), // ran out, never came back
];
const cardless: CameBackCardless[] = [
  { orgId: "r1", startedAt: d(40), endsAt: d(33), endedAt: d(33), cardAt: null, restartedAt: d(24), test: false },
  { orgId: "r2", startedAt: d(30), endsAt: d(23), endedAt: d(23), cardAt: null, restartedAt: d(22), test: false },
  { orgId: "r3", startedAt: d(50), endsAt: d(43), endedAt: d(43), cardAt: null, restartedAt: d(40), test: false },
  { orgId: "t1", startedAt: d(20), endsAt: d(13), endedAt: d(13), cardAt: null, restartedAt: null, test: false },
  { orgId: "r1", startedAt: d(5), endsAt: d(1), endedAt: d(1), cardAt: null, restartedAt: d(0), test: true }, // a test-mode record is ignored
  { orgId: "ghost", startedAt: d(5), endsAt: d(1), endedAt: d(1), cardAt: null, restartedAt: d(0), test: false }, // a deleted company
];
const cancels: CameBackCancel[] = [
  { id: "k1", orgId: "c1", createdAt: d(28), periodEnd: d(25) },
  { id: "k2", orgId: "c2", createdAt: d(30), periodEnd: d(29) },
  { id: "k3", orgId: "c3", createdAt: d(12), periodEnd: d(10) },
  { id: "k4", orgId: "c4", createdAt: d(9), periodEnd: null },
  { id: "k5", orgId: "ghost", createdAt: d(3), periodEnd: null },
];
const winbacks: CameBackWinback[] = [
  { orgId: "r1", mails: 3, offerSentAt: d(28) },
  { orgId: "r2", mails: 1, offerSentAt: null },
  { orgId: "r3", mails: 4, offerSentAt: d(30) }, // the offer went out AFTER the restart — not its doing
];
const r = shapeCameBack({ now: NOW, orgs, cardless, cancels, winbacks });

check("restarted: three card-less trials paid after they ran out, newest first, test and deleted ones out", r.restarted.map((x) => x.orgId).join(",") === "r2,r1,r3", r.restarted.map((x) => x.orgId).join(","));
check("…each with the day it ended, the day it paid and the days between", r.restarted[1].daysAfter === 9 && r.restarted[0].daysAfter === 1 && r.restarted[1].trialEnded === d(33) && r.restarted[1].paidOn === d(24));
check("…the offer counts only when it went out before the restart", r.restarted[1].afterOffer === true && r.restarted[1].mailsBefore === 3 && r.restarted[0].afterOffer === false && r.restarted[2].afterOffer === false);
check("…a restarted company that cancelled again reads as gone now", r.restarted[2].now === "gone" && r.restarted[1].now === "paying");

check("cancelled, then paying again: c1 (during the trial), c2 (after it), c4 (on a trial again) — not c3", r.cancelledBack.map((x) => `${x.id}:${x.duringTrial ? "trial" : "after"}:${x.now}`).join(" ") === "k4:trial:trial k1:trial:paying k2:after:paying", r.cancelledBack.map((x) => `${x.id}:${x.duringTrial}:${x.now}`).join(" "));
check("…the next invoice date stands in for the day they came back", r.cancelledBack.find((x) => x.id === "k1")?.nextInvoice === NOW + 12 * DAY);
check("every cancellation's state today, for the table", r.nowByCancel.k1.now === "paying" && r.nowByCancel.k3.now === "gone" && r.nowByCancel.k3.duringTrial === true && r.nowByCancel.k4.now === "trial" && !("k5" in r.nowByCancel));
check("counts: 5 companies back in all (r1, r2, c1, c2, c4; r3 is gone), 3 restarts, 1 after the offer, 3 cancelled-back, 2 of them inside a trial, 4 card-less trials ended (a deleted company's not among them)", JSON.stringify(r.counts) === JSON.stringify({ back: 5, restarted: 3, afterOffer: 1, cancelledBack: 3, cancelledDuringTrialBack: 2, cardlessEnded: 4, cancels: 5 }), JSON.stringify(r.counts));

const twice = shapeCameBack({ now: NOW, orgs, cardless, cancels: [...cancels, { id: "k6", orgId: "r1", createdAt: d(30), periodEnd: d(33) }], winbacks });
check("a company that cancelled AND restarted is one company in the total", twice.counts.back === 5 && twice.counts.cancelledBack === 4 && twice.cancelledBack.find((x) => x.id === "k6")?.duringTrial === true);
check("nothing recorded: empty, zero", JSON.stringify(shapeCameBack({ now: NOW, orgs: [], cardless: [], cancels: [], winbacks: [] }).counts) === JSON.stringify({ back: 0, restarted: 0, afterOffer: 0, cancelledBack: 0, cancelledDuringTrialBack: 0, cardlessEnded: 0, cancels: 0 }));

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
