// The homeowner's request on its way to a contractor (2026-09-21): which
// jobs need a street address, which estimator a lead opens, what counts as a
// street address, and the hand-off seed. Pure, no model call.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/lead-scope.check.ts
import { ESTIMATOR_PATH, estimatorFor, looksLikeStreetAddress, needsAddressFor } from "../../../src/lib/leadRules";
import { decodeSeed, encodeSeed } from "../../../src/lib/estimateSeed";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

check("a roof, a fence, siding, gutters, a driveway or a deck needs the address",
  needsAddressFor("my roof is leaking, 20 years old, want it replaced") && needsAddressFor("replace the rotted cedar fence along the back line") && needsAddressFor("new vinyl siding on the whole house") && needsAddressFor("gutters and downspouts") && needsAddressFor("pour a new concrete driveway") && needsAddressFor("build a 12x16 composite deck"));
check("a bath, a kitchen, a water heater or paint does not",
  !needsAddressFor("remodel the hall bathroom, new tile and vanity") && !needsAddressFor("replace the water heater, 50 gal gas") && !needsAddressFor("paint the living room and hallway") && !needsAddressFor("kitchen cabinets and countertops"));
check("the detected trade decides when the words are vague", needsAddressFor("need a quote", "Roofing") && needsAddressFor("looking for help", "Fencing") && !needsAddressFor("need a quote", "Painting"));

check("a lead opens the estimator its trade calls for",
  estimatorFor("Roofing") === "roof" && estimatorFor("Fencing") === "fence" && estimatorFor("HVAC") === "hvac" && estimatorFor("Kitchen & Bath") === "smart" && estimatorFor("Painting") === "smart" && estimatorFor(null, "the shingles are curling") === "roof" && estimatorFor(null, "a heat pump for the house") === "hvac" && estimatorFor(null, "finish the basement") === "smart");
check("every estimator has a page", Object.values(ESTIMATOR_PATH).every((p) => p.startsWith("/dashboard/")));
check("the manual proposal is offered but never recommended (2026-09-22)",
  ESTIMATOR_PATH.manual === "/dashboard/manual-blueprint" && ["Roofing", "Fencing", "HVAC", "Kitchen & Bath", null].every((t) => estimatorFor(t, "a job") !== "manual"));

check("a street address has a number and a street word; a city or a ZIP alone is not one",
  looksLikeStreetAddress("4567 Rainier Ave S, Seattle, WA 98118") && looksLikeStreetAddress("13520 Bothell-Everett Hwy") && !looksLikeStreetAddress("Seattle, WA") && !looksLikeStreetAddress("98118") && !looksLikeStreetAddress(""));

const seed = { leadId: "l1", organizationId: "o1", estimator: "roof" as const, name: "Pat Homeowner", address: "4567 Rainier Ave S, Seattle, WA 98118", state: "WA", brief: "Replace the roof: 2,400 sq ft of 20-year architectural shingles, two layers to tear off.", email: "pat@example.test", phone: "(206) 555-0100", projectType: "Roofing", words: "my roof is 20 years old and leaking", clientId: "c1" };
check("the hand-off seed survives the cookie round trip", JSON.stringify(decodeSeed(encodeSeed(seed))) === JSON.stringify(seed));
const manual = { ...seed, estimator: "manual" as const, email: null, phone: null, projectType: null, words: null, clientId: null };
check("a manual-proposal seed round-trips, and a seed from before the contact fields still reads (they come back null)",
  JSON.stringify(decodeSeed(encodeSeed(manual))) === JSON.stringify(manual) && decodeSeed(Buffer.from(JSON.stringify({ leadId: "l1", organizationId: "o1", estimator: "smart", name: "Pat", brief: "b" })).toString("base64url"))?.email === null);
check("a broken or foreign seed is nothing", decodeSeed("not-a-seed") === null && decodeSeed(null) === null && decodeSeed(Buffer.from(JSON.stringify({ leadId: "x", organizationId: "o", estimator: "bogus", brief: "b" })).toString("base64url")) === null);

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
