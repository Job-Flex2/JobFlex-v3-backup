// The quick links beside each API in the admin (2026-09-24): every service
// the console lists has its doors, each an https URL with a label, no
// duplicates, and the aliases the health card uses resolve. Pure.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/integration-links.check.ts
import { integrationLinks, linkedIntegrationKeys } from "../../../src/lib/integrationLinks";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// The keys lib/sdk/integrations lists on /admin/integrations, and the health card's.
const PAGE_KEYS = ["stripe", "stripe-webhook", "stripe-connect", "square", "square-webhook", "resend", "twilio", "gmail", "maps", "maps-browser", "regrid", "reportall", "eagleview", "openai", "serpapi", "fal", "blob", "posthog"];
const HEALTH_KEYS = ["openai", "serpapi", "reportall", "eagleview", "regrid", "overpass", "email", "twilio", "stripe-connect", "square-app", "gmail-oauth"];

check("every service on the integrations page has at least one door", PAGE_KEYS.every((k) => integrationLinks(k).length >= 1), PAGE_KEYS.filter((k) => !integrationLinks(k).length).join(","));
check("every service on the health card has at least one door", HEALTH_KEYS.every((k) => integrationLinks(k).length >= 1), HEALTH_KEYS.filter((k) => !integrationLinks(k).length).join(","));
check("the internal checks and SMTP have none", integrationLinks("payment-connections").length === 0 && integrationLinks("influencer-payouts").length === 0 && integrationLinks("smtp").length === 0 && integrationLinks("").length === 0);
const all = linkedIntegrationKeys().flatMap((k) => integrationLinks(k));
check("every door is an https URL with a label", all.every((l) => /^https:\/\/[a-z0-9.-]+\//.test(l.href) && l.label.length >= 3 && l.label.length <= 24));
check("no service lists the same door twice, and none lists more than three", linkedIntegrationKeys().every((k) => { const ls = integrationLinks(k); return new Set(ls.map((l) => l.href)).size === ls.length && ls.length <= 3; }));
check("the doors an operator asked for are there: a place to change the plan or add credits", /billing/i.test(integrationLinks("openai")[1].label) && /billing/i.test(integrationLinks("twilio")[1].label) && /plan/i.test(integrationLinks("serpapi")[1].label) && /billing/i.test(integrationLinks("resend")[1].label) && /billing/i.test(integrationLinks("fal")[1].label));
check("the health card's names resolve to the same doors", integrationLinks("email")[0].href === integrationLinks("resend")[0].href && integrationLinks("square-app")[0].href === integrationLinks("square")[0].href && integrationLinks("gmail-oauth")[0].href === integrationLinks("gmail")[0].href);

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
