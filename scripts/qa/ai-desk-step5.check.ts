// The AI desk, step 5 — pure checks, no network, no database (2026-10-13).
//   npx tsx --tsconfig tsconfig.json scripts/qa/ai-desk-step5.check.ts
// Minutes and packs: the stored rows read tolerantly, the balance (included minutes first,
// then packs; overage not yet settled never counted twice), the words on the pages.
import { DESK_MINUTES_DEFAULT, DESK_PACK, deskBalance, dollars, EMPTY_PACKS, EMPTY_USE, LOW_MINUTES_SECONDS, minutesLeftWords, parseDeskPacks, parseDeskUse, unsettledPackSeconds, type DeskPacks, type DeskUse } from "../../src/lib/aiDesk/shared";
import { deskStripWords, type PhoneDeskStrip } from "../../src/components/v3/phone-blueprint/phone-data";
import { DEFAULT_FREE_LIMITS, LIMIT_DEFS } from "../../src/lib/planLimits";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

// ── the rows
const packs = parseDeskPacks('{"seconds":18000,"autoTopUp":true,"autoFailedAt":null,"history":[{"at":"2026-10-13T10:00:00.000Z","minutes":300,"cents":2900,"via":"card-on-file","ref":"pi_1"},{"bad":true},{"at":"2026-10-01T10:00:00.000Z","minutes":300,"cents":2900,"via":"nope","ref":null}]}');
check("the packs row, read tolerantly: a bad entry dropped, an unknown way becomes the card", packs.seconds === 18000 && packs.autoTopUp && packs.history.length === 2 && packs.history[1].via === "card-on-file" && packs.history[0].ref === "pi_1");
check("…nothing stored reads as no packs, auto top-up off", JSON.stringify(parseDeskPacks(null)) === JSON.stringify(EMPTY_PACKS) && parseDeskPacks("{{").autoTopUp === false && parseDeskPacks('{"seconds":-5}').seconds === 0);
const use = parseDeskUse('{"callSeconds":9100,"calls":40,"packSeconds":100,"outNoticeAt":"2026-10-13T11:00:00.000Z"}');
check("the use row carries the settled pack seconds and the out notice; older rows read as none", use.packSeconds === 100 && use.outNoticeAt === "2026-10-13T11:00:00.000Z" && parseDeskUse('{"callSeconds":5}').packSeconds === 0 && parseDeskUse('{"callSeconds":5}').outNoticeAt === null);

// ── the balance
const u = (callSeconds: number, packSeconds = 0): DeskUse => ({ ...EMPTY_USE, callSeconds, packSeconds });
const p = (seconds: number, autoTopUp = false): DeskPacks => ({ ...EMPTY_PACKS, seconds, autoTopUp, history: [] });
let b = deskBalance(150, u(0), p(0));
check("a fresh month: the included minutes are what is left", b.includedLeftSeconds === 9000 && b.remainingSeconds === 9000 && !b.out && !b.low);
b = deskBalance(150, u(240), p(18000));
check("included minutes go first; the packs wait", b.includedLeftSeconds === 8760 && b.packSeconds === 18000 && b.remainingSeconds === 26760);
b = deskBalance(150, u(9100), p(18000));
check("past the included minutes, the overage comes off the packs — before it is settled", b.includedLeftSeconds === 0 && b.packSeconds === 17900 && b.remainingSeconds === 17900 && unsettledPackSeconds(150, u(9100)) === 100);
b = deskBalance(150, u(9100, 100), p(17900));
check("…and after the settle the figure is the same, not counted twice", b.packSeconds === 17900 && b.remainingSeconds === 17900 && unsettledPackSeconds(150, u(9100, 100)) === 0);
b = deskBalance(150, u(9000 + 18000), p(18000));
check("everything used: out", b.out && b.remainingSeconds === 0 && minutesLeftWords(b) === "Out of minutes");
b = deskBalance(150, u(9000 - 600), p(0));
check("ten minutes left: running low", b.low && !b.out && minutesLeftWords(b) === "10 min left — running low" && LOW_MINUTES_SECONDS === 900);
check("under a minute, in words", minutesLeftWords(deskBalance(150, u(8970), p(0))) === "Under a minute left — running low");
check("a company with no included minutes and no packs is out; with a pack it is not", deskBalance(0, u(0), p(0)).out && !deskBalance(0, u(0), p(18000)).out && deskBalance(0, u(0), p(18000)).remainingSeconds === 18000);
check("auto top-up rides on the balance", deskBalance(150, u(0), p(0, true)).autoTopUp);

// ── the plan's limit and the defaults
const def = LIMIT_DEFS.find((d) => d.key === "deskMinutes");
check("\"AI desk minutes\" is a plan limit the admin edits, monthly, free plans get none", !!def && def.scope === "monthly" && /calendar month/.test(def.hint) && DEFAULT_FREE_LIMITS.deskMinutes === 0);
check("tier defaults when a plan row sets nothing: Professional 150, Advanced 500, Starter 0", DESK_MINUTES_DEFAULT.PROFESSIONAL === 150 && DESK_MINUTES_DEFAULT.ENTERPRISE === 500 && DESK_MINUTES_DEFAULT.STARTER === 0 && DESK_MINUTES_DEFAULT.FREE === 0);
check("the pack: 300 minutes for $29", DESK_PACK.minutes === 300 && DESK_PACK.cents === 2900 && dollars(2900) === "$29" && dollars(2950) === "$29.50");

// ── the Phone page's line
const strip: PhoneDeskStrip = { number: "(866) 555-0199", on: true, go: "assistant", mode: "ANSWER", companyPhone: "(425) 555-0100", voice: "marin", minutes: 151, calls: 40, tests: 0, live: true, left: "Out of minutes", out: true, low: false };
check("out of minutes, on the Phone page: calls ring the company phone until minutes are added", deskStripWords(strip) === "(866) 555-0199 — out of minutes: calls ring (425) 555-0100 until you add minutes.", deskStripWords(strip));
check("…or take a message when there is no company phone", /take a message until you add minutes/.test(deskStripWords({ ...strip, companyPhone: null })));
check("…and with minutes the line is as before", /the desk answers every call/.test(deskStripWords({ ...strip, out: false, left: "146 min left" })));

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
