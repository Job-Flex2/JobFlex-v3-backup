// Gmail grants at rest (2026-09-20): sealed with the secret box, legacy plain
// JSON still readable, an unreadable blob reads as null; the error text
// keeps status and message and drops the request config; a dead grant is
// recognised. No network, no database.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/gmail-tokens.check.ts
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import "../_lib/_server-only";
import { gmailErrorText, isGmailGrantDead, isLegacyPlainTokens, openGmailTokens, sealGmailTokens } from "../../../src/lib/sdk/gmail";

let failures = 0;
let passes = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : " — " + JSON.stringify(detail)}`);
};

const tokens = { accessToken: "ya29.access", refreshToken: "1//refresh", expiryDate: 1700000000000, email: "owner@example.com" };
const sealed = sealGmailTokens(tokens);
check("a sealed grant is not JSON and carries no token text", !sealed.includes("{") && !sealed.includes("refresh") && sealed.startsWith("v1."), sealed.slice(0, 12));
check("a sealed grant opens to the same tokens", JSON.stringify(openGmailTokens(sealed)) === JSON.stringify(tokens));
const legacy = JSON.stringify(tokens);
check("a legacy plain row is recognised as plain", isLegacyPlainTokens(legacy) && !isLegacyPlainTokens(sealed));
check("a legacy plain row still opens", openGmailTokens(legacy)?.email === "owner@example.com");
check("garbage reads as null", openGmailTokens("v1.not.a.box") === null && openGmailTokens("{bad json") === null && openGmailTokens(null) === null);

const gaxiosLike = Object.assign(new Error("invalid_grant"), {
  code: "400",
  response: { status: 400, data: { error: "invalid_grant", error_description: "Token has been expired or revoked." } },
  config: { headers: { Authorization: "Bearer SECRET-ACCESS-TOKEN" } },
});
const text = gmailErrorText(gaxiosLike);
check("error text keeps status and message", /status 400/.test(text) && /invalid_grant/.test(text), text);
check("error text never carries the Authorization header", !/SECRET-ACCESS-TOKEN|Bearer/.test(text), text);
check("invalid_grant is a dead grant", isGmailGrantDead(gaxiosLike));
check("a 401 on send is a dead grant", isGmailGrantDead(Object.assign(new Error("Request had invalid authentication credentials."), { response: { status: 401 } })));
check("a 429 is not", !isGmailGrantDead(Object.assign(new Error("Quota exceeded"), { response: { status: 429 } })));
check("a network error is not", !isGmailGrantDead(new Error("ECONNRESET")));

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
