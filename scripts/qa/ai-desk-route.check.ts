// A call to a company's number — data-level check of lib/aiDesk (2026-10-13).
//
//   DATABASE_URL=file:/path/to/a/COPY.db npx tsx --tsconfig tsconfig.json scripts/qa/ai-desk-route.check.ts
//
// Against a throwaway company in the given database, removed at the end, pass or fail.
// No network: no Twilio env, so nothing is bought and the webhook's signature check is
// the dev one. Covered:
//   1. the number index: a dialed number (in any writing) finds its company; a released one does not
//   2. a number nobody registered is answered for the first company, as before
//   3. the desk's mode: ANSWER → the assistant's greeting names the company and a call row is written;
//      FORWARD → the company phone rings, and the dial result hangs up a finished call or takes the message
//   4. the settings round-trip
import "./_server-only";
for (const k of ["SMTP_HOST", "SMTP_USER", "RESEND_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "OPENAI_API_KEY"]) process.env[k] = "";

import { PrismaClient } from "@prisma/client";
import { forgetVoiceNumber, indexVoiceNumber, organizationForCall, readDeskSettings, saveDeskSettings } from "../../src/lib/aiDesk/numbers";
import { afterDialTwiml, companyForCall, inboundTwiml } from "../../src/lib/aiDesk/calls";

const db = new PrismaClient();
const TAG = "qa-aidesk";
const NUMBER = "+18665550199";
let failures = 0;
const check = (label: string, ok: boolean, detail = ""): void => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ": " + detail : ""}`);
};

async function main() {
  await db.organization.deleteMany({ where: { slug: { startsWith: TAG } } });
  await db.syncState.deleteMany({ where: { key: { in: [`voicenum:${NUMBER}`] } } });
  const org = await db.organization.create({ data: { name: "QA Desk Roofing", slug: `${TAG}-${Date.now()}`, phone: "(425) 555-0100" } });
  await db.syncState.deleteMany({ where: { key: `aidesk:${org.id}` } });
  const base = "https://www.jobflex.app";
  try {
    // 1. the index
    await indexVoiceNumber(org.id, NUMBER);
    check("a dialed number finds its company, however it is written", (await organizationForCall(NUMBER)) === org.id && (await organizationForCall("(866) 555-0199")) === org.id && (await organizationForCall("8665550199")) === org.id);
    check("a number nobody registered finds no company", (await organizationForCall("+18665550100")) === null && (await organizationForCall("")) === null);
    // 2. the fallback
    const first = await companyForCall("+18665550100");
    check("…but is answered for the first company, as before", !!first && first.id !== org.id);
    // 3. ANSWER
    const a = await inboundTwiml({ to: NUMBER, from: "+12065550123", callSid: `CA${TAG}1`, base });
    const dial = /<Dial /.test(a);
    const record = /<Record[\s>]/.test(a) && a.includes("Thanks for calling QA Desk Roofing.");
    check("ANSWER (or a plan without the assistant): the assistant greets by the company's name, or the company phone rings", record || dial, a.replace(/\s+/g, " ").slice(0, 160));
    if (record) {
      const row = await db.aiPhoneCall.findUnique({ where: { callSid: `CA${TAG}1` } });
      check("…and the call is on the company's Phone page", row?.organizationId === org.id && row.fromNumber === "+12065550123");
    }
    // FORWARD
    await saveDeskSettings(org.id, { mode: "FORWARD" });
    const f = await inboundTwiml({ to: NUMBER, from: "+12065550123", callSid: `CA${TAG}2`, base });
    check("FORWARD: the company phone rings, the caller's number as caller ID, back to the dial result", /<Dial action="https:\/\/www\.jobflex\.app\/api\/twilio\/voice\/dial" method="POST" timeout="25">\+14255550100<\/Dial>/.test(f), f.replace(/\s+/g, " ").slice(0, 160));
    const done = await afterDialTwiml({ to: NUMBER, from: "+12065550123", callSid: `CA${TAG}2`, base, dialStatus: "completed" });
    check("a conversation that ended hangs up — no voicemail after it", /<Hangup\/>/.test(done) && !/<Record/.test(done));
    const missed = await afterDialTwiml({ to: NUMBER, from: "+12065550123", callSid: `CA${TAG}3`, base, dialStatus: "no-answer" });
    check("no answer: the assistant takes the message, or the caller is told to try again", (/<Record[\s>]/.test(missed) && missed.includes("QA Desk Roofing")) || /try again later/.test(missed), missed.replace(/\s+/g, " ").slice(0, 120));
    // 4. settings
    check("the desk settings round-trip", (await readDeskSettings(org.id)).mode === "FORWARD");
    // released
    await forgetVoiceNumber(NUMBER);
    check("a released number finds no company", (await organizationForCall(NUMBER)) === null);
  } finally {
    await db.aiPhoneCall.deleteMany({ where: { callSid: { startsWith: `CA${TAG}` } } });
    await db.syncState.deleteMany({ where: { key: { in: [`voicenum:${NUMBER}`, `aidesk:${org.id}`] } } });
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
