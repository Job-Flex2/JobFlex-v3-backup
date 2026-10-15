// The honest Gmail status (2026-09-20): when Google refuses the grant, the
// send still goes out from the platform, the org's row is marked revoked
// (tokens dropped, revokedAt set, connected off) and the proposal's activity
// gets one line saying so; a passing Gmail error keeps the grant. The Gmail
// and platform transports are stubbed — no network, but a throwaway org in
// the local dev database, removed at the end.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/gmail-fallback.check.ts
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.GMAIL_OAUTH_CLIENT_ID = "test";
process.env.GMAIL_OAUTH_CLIENT_SECRET = "test";
process.env.GMAIL_OAUTH_REDIRECT_URI = "http://localhost/cb";

import "../_lib/_server-only";
import { db } from "../../../src/lib/db";
import { sealGmailTokens } from "../../../src/lib/sdk/gmail";
import { noteGmailFallback, sendOrgEmail } from "../../../src/lib/email/orgSend";
import { parseGmailSettings } from "../../../src/lib/settings";

let failures = 0;
let passes = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : " — " + JSON.stringify(detail)}`);
};

// Stub transports, handed to sendOrgEmail in place of Gmail and Resend.
let gmailBehaviour: "ok" | "dead" | "flaky" = "ok";
let platformSends = 0;
const transports = {
  gmail: async () => {
    if (gmailBehaviour === "ok") return;
    if (gmailBehaviour === "dead") {
      throw Object.assign(new Error("invalid_grant"), { response: { status: 400, data: { error: "invalid_grant" } } });
    }
    throw Object.assign(new Error("Backend Error"), { response: { status: 503 } });
  },
  platform: async () => {
    platformSends++;
  },
};

async function main() {
  const tag = `qa-gmail-${Date.now()}`;
  const tokens = { accessToken: "a", refreshToken: "r", expiryDate: null, email: "owner@example.com" };
  const org = await db.organization.create({
    data: {
      name: tag,
      slug: tag,
      gmailTokensJson: sealGmailTokens(tokens),
      gmailSettingsJson: JSON.stringify({ connected: true, connectedEmail: tokens.email, sendFromUser: true }),
    },
  });
  const sender = () => db.organization.findUniqueOrThrow({ where: { id: org.id }, select: { id: true, name: true, billingEmail: true, gmailSettingsJson: true, gmailTokensJson: true } });
  try {
    const mail = { to: "client@example.com", subject: "Hi", html: "<p>Hi</p>" };

    gmailBehaviour = "ok";
    const r1 = await sendOrgEmail(await sender(), mail, transports);
    check("a working grant sends from Gmail", r1.via === "gmail" && !r1.gmailFallback && platformSends === 0, r1);

    gmailBehaviour = "flaky";
    const r2 = await sendOrgEmail(await sender(), mail, transports);
    const after2 = await sender();
    check("a passing error falls back to the platform and keeps the grant", r2.via === "resend" && r2.gmailFallback === "failed" && platformSends === 1 && after2.gmailTokensJson !== null, r2);

    gmailBehaviour = "dead";
    const r3 = await sendOrgEmail(await sender(), mail, transports);
    const after3 = await sender();
    const s3 = parseGmailSettings(after3.gmailSettingsJson);
    check("invalid_grant falls back to the platform", r3.via === "resend" && r3.gmailFallback === "revoked" && platformSends === 2, r3);
    check("…drops the tokens and marks the org revoked", after3.gmailTokensJson === null && s3.connected === false && s3.revokedAt !== "" && /invalid_grant/.test(s3.revokedReason), s3);

    gmailBehaviour = "ok";
    const r4 = await sendOrgEmail(await sender(), mail, transports);
    check("after revocation the platform sends without trying Gmail", r4.via === "resend" && !r4.gmailFallback && platformSends === 3, r4);

    await noteGmailFallback(r3, { organizationId: org.id, what: "The proposal email" });
    const notes = await db.activityEvent.findMany({ where: { organizationId: org.id } });
    check("the revoked send leaves one activity line naming Settings", notes.length === 1 && /JobFlex address/.test(notes[0].summary) && /Reconnect/.test(notes[0].summary), notes.map((n) => n.summary));
    await noteGmailFallback(r1, { organizationId: org.id, what: "The proposal email" });
    check("a Gmail send leaves no line", (await db.activityEvent.count({ where: { organizationId: org.id } })) === 1);
  } finally {
    await db.activityEvent.deleteMany({ where: { organizationId: org.id } });
    await db.organization.delete({ where: { id: org.id } });
    await db.$disconnect();
  }
  console.log(`${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

void main();
