// Minutes and packs — data-level check of lib/aiDesk/minutes and the voice routing (2026-10-13).
//
//   DATABASE_URL=file:/path/to/a/COPY.db npx tsx --tsconfig tsconfig.json scripts/qa/ai-desk-minutes.check.ts
//
// Against a throwaway company (no subscription → no included minutes), removed at the end.
// No network: no Stripe, so auto top-up fails the honest way; no mail; the voice server's
// variables are set so the live desk's TwiML can be told from a recording. Covered:
//   1. out of minutes: the company phone rings, or a message is taken; the brief is refused
//   2. a pack: the desk answers; the brief is capped at what is left
//   3. a call's seconds come off the pack once, however often the settle runs
//   4. the same payment never lands twice
//   5. out again: the owner is told once; auto top-up without a card fails and waits a day
//   6. a missed call after the phone rang goes to the live desk — not after the desk's own transfer
import "./_server-only";
for (const k of ["SMTP_HOST", "SMTP_USER", "RESEND_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "OPENAI_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_SECRET_KEY_TEST", "STRIPE_MOCK_FILE"]) process.env[k] = "";
process.env.VOICE_SERVER_URL = "wss://voice.test";
process.env.VOICE_SERVER_SECRET = "qa-secret";

import { PrismaClient } from "@prisma/client";
import { forgetVoiceNumber, indexVoiceNumber, saveDeskSettings } from "../../src/lib/aiDesk/numbers";
import { afterDialTwiml, inboundTwiml } from "../../src/lib/aiDesk/calls";
import { addPackSeconds, deskBalanceFor, includedDeskMinutes, readDeskPacks, setAutoTopUp, settleDeskUse } from "../../src/lib/aiDesk/minutes";
import { callBrief } from "../../src/lib/aiDesk/liveCall";
import { noteDeskUse, readDeskUse } from "../../src/lib/aiDesk/usage";

const db = new PrismaClient();
const TAG = "qa-aidesk-min";
const NUMBER = "+18665550198";
let failures = 0;
const check = (label: string, ok: boolean, detail = ""): void => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ": " + detail : ""}`);
};
const flat = (s: string) => s.replace(/\s+/g, " ");

async function main() {
  await db.organization.deleteMany({ where: { slug: { startsWith: TAG } } });
  await db.syncState.deleteMany({ where: { key: `voicenum:${NUMBER}` } });
  const org = await db.organization.create({ data: { name: "QA Minutes Roofing", slug: `${TAG}-${Date.now()}`, phone: "(425) 555-0100" } });
  const base = "https://www.jobflex.app";
  const call = { to: NUMBER, from: "+12065550123", base };
  const cleanup = async () => {
    await db.syncState.deleteMany({ where: { OR: [{ key: `voicenum:${NUMBER}` }, { key: `aidesk:${org.id}` }, { key: `deskpacks:${org.id}` }, { key: { startsWith: `deskuse:${org.id}:` } }, { key: { startsWith: `callout:CA${TAG}` } }] } });
    await db.aiPhoneCall.deleteMany({ where: { callSid: { startsWith: `CA${TAG}` } } });
  };
  try {
    await indexVoiceNumber(org.id, NUMBER);
    await saveDeskSettings(org.id, { mode: "ANSWER" });
    check("a company without a plan has no included minutes", (await includedDeskMinutes(org.id)) === 0);

    // 1. out of minutes
    let b = await deskBalanceFor(org.id);
    check("…so it is out before its first call", b.out && b.remainingSeconds === 0);
    const out1 = flat(await inboundTwiml({ ...call, callSid: `CA${TAG}1` }));
    check("out of minutes: the company phone rings, never the live desk", /<Dial /.test(out1) && !/<Connect>/.test(out1), out1.slice(0, 120));
    await db.organization.update({ where: { id: org.id }, data: { phone: null } });
    const out2 = flat(await inboundTwiml({ ...call, callSid: `CA${TAG}2` }));
    check("…with no company phone, a message is taken", /<Record[\s>]/.test(out2) && !/<Connect>/.test(out2) && /QA Minutes Roofing/.test(out2), out2.slice(0, 120));
    await db.organization.update({ where: { id: org.id }, data: { phone: "(425) 555-0100" } });
    const brief0 = await callBrief({ callSid: `CA${TAG}2`, organizationId: org.id, from: call.from });
    check("…and the voice server's brief is refused", !brief0.ok && /out of minutes/.test(brief0.ok ? "" : brief0.error));

    // 2. a pack
    const added = await addPackSeconds(org.id, { minutes: 300, cents: 2900, via: "card-on-file", ref: "pi_qa_1" });
    b = await deskBalanceFor(org.id);
    check("a pack: 300 minutes on the balance, the desk answers again", added.added && b.remainingSeconds === 18000 && !b.out);
    const live = flat(await inboundTwiml({ ...call, callSid: `CA${TAG}3` }));
    check("…the live desk takes the call", /<Connect> <Stream url="wss:\/\/voice\.test\/twilio\/stream">/.test(live), live.slice(0, 120));
    const brief1 = await callBrief({ callSid: `CA${TAG}3`, organizationId: org.id, from: call.from });
    check("…the brief is capped at ten minutes while the balance allows", brief1.ok && brief1.maxSeconds === 600);

    // 3. the settle
    await noteDeskUse(org.id, { callSeconds: 400, calls: 1 });
    let s = await settleDeskUse(org.id);
    let packs = await readDeskPacks(org.id);
    let use = await readDeskUse(org.id);
    check("a 400-second call comes off the pack", !!s && s.remainingSeconds === 17600 && packs.seconds === 17600 && use.packSeconds === 400);
    s = await settleDeskUse(org.id);
    packs = await readDeskPacks(org.id);
    check("…once, however often the settle runs", !!s && s.remainingSeconds === 17600 && packs.seconds === 17600);
    await noteDeskUse(org.id, { callSeconds: 100, calls: 1 });
    s = await settleDeskUse(org.id);
    packs = await readDeskPacks(org.id);
    check("…and the next call takes only its own seconds", !!s && s.remainingSeconds === 17500 && packs.seconds === 17500 && (await readDeskUse(org.id)).packSeconds === 500);
    const brief2 = await callBrief({ callSid: `CA${TAG}4`, organizationId: org.id, from: call.from });
    check("the brief is capped at what is left when that is under ten minutes", brief2.ok && brief2.maxSeconds === 600 && (await (async () => { await addPackSeconds(org.id, { minutes: -290, cents: 0, via: "admin", ref: null }); return true; })()));
    const brief3 = await callBrief({ callSid: `CA${TAG}4`, organizationId: org.id, from: call.from });
    const left = (await deskBalanceFor(org.id)).remainingSeconds;
    check("…" + left + " seconds left → the cap", brief3.ok && brief3.maxSeconds === Math.max(60, Math.min(600, left)), String(brief3.ok ? brief3.maxSeconds : brief3.error));

    // 4. the same payment never lands twice
    const again = await addPackSeconds(org.id, { minutes: 300, cents: 2900, via: "checkout", ref: "pi_qa_1" });
    check("the same Stripe payment never lands twice", !again.added && again.packs.history.length === 2);

    // 5. out again: the notice once; auto top-up without a card
    await addPackSeconds(org.id, { minutes: -10, cents: 0, via: "admin", ref: null });
    await noteDeskUse(org.id, { callSeconds: 20000, calls: 1 });
    await setAutoTopUp(org.id, true);
    s = await settleDeskUse(org.id);
    use = await readDeskUse(org.id);
    packs = await readDeskPacks(org.id);
    check("everything used: out, the owner told once (dated), auto top-up tried and failed without a card", !!s && s.out && !!use.outNoticeAt && !!packs.autoFailedAt, JSON.stringify({ out: s?.out, notice: use.outNoticeAt, failed: packs.autoFailedAt }));
    const notice = use.outNoticeAt;
    const failed = packs.autoFailedAt;
    s = await settleDeskUse(org.id);
    check("…and a second settle neither tells again nor retries the card the same day", (await readDeskUse(org.id)).outNoticeAt === notice && (await readDeskPacks(org.id)).autoFailedAt === failed);
    const out3 = flat(await inboundTwiml({ ...call, callSid: `CA${TAG}5` }));
    check("…calls ring the company phone again", /<Dial /.test(out3) && !/<Connect>/.test(out3));

    // 6. the missed call after the phone rang
    await addPackSeconds(org.id, { minutes: 300, cents: 2900, via: "admin", ref: "pi_qa_2" });
    await saveDeskSettings(org.id, { mode: "FORWARD" });
    const missed = flat(await afterDialTwiml({ ...call, callSid: `CA${TAG}6`, dialStatus: "no-answer" }));
    check("FORWARD: a call the company phone did not pick up goes to the live desk", /<Connect> <Stream/.test(missed), missed.slice(0, 120));
    await db.syncState.create({ data: { key: `callout:CA${TAG}7`, cursor: JSON.stringify({ outcome: "transfer", appointmentId: null, seconds: 30, messageTaken: false, at: new Date().toISOString() }) } });
    const afterTransfer = flat(await afterDialTwiml({ ...call, callSid: `CA${TAG}7`, dialStatus: "no-answer" }));
    check("…but after the desk's own transfer nobody answered, a message — the desk never loops back to itself", /<Record[\s>]/.test(afterTransfer) && !/<Connect>/.test(afterTransfer), afterTransfer.slice(0, 120));
    await forgetVoiceNumber(NUMBER);
  } finally {
    await cleanup();
    await db.organization.delete({ where: { id: org.id } }).catch(() => null);
    await db.$disconnect();
  }
}

main()
  .then(() => {
    console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
    process.exit(failures ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(2);
  });
