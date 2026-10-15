// Trade-detection harness: the owner's acceptance set through the REAL
// detector + the REAL routing rule (lib/ai/detectTrade). Live OpenAI calls —
// pennies. Junk and mixed descriptions MUST land in MANUAL_QUEUE.
//   npx tsx qa/tools/legacy/trade-detect-check.ts
import { readFileSync } from "node:fs";

// tsx does not load .env.local; hydrate just what the detector needs.
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)="?([^"\r\n]*)"?/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const CASES: Array<[string, string]> = [
  ["roof", "My roof is 15 years old and leaking around the chimney after storms, need it replaced"],
  ["fence", "Build a 6 ft cedar privacy fence around the backyard, about 180 feet with one gate"],
  ["flooring", "Replace the carpet in three bedrooms with luxury vinyl plank flooring"],
  ["tile", "Retile the shower walls and floor in the master bathroom"],
  ["plumbing", "Water heater is dead and the kitchen sink drains slowly, need both fixed"],
  ["electrical", "Add outlets in the garage and replace the old breaker panel"],
  ["painting", "Paint the whole interior, walls and ceilings, about 1800 sq ft"],
  ["hvac", "Central AC stopped cooling, probably needs a new condenser unit"],
  ["landscaping", "Regrade the front yard, new sod and a paver walkway to the door"],
  ["concrete", "Pour a new concrete driveway, the old one is cracked through"],
  ["junk-1", "помогите"],
  ["junk-2", "hi"],
  ["mixed", "I need a new fence and also paint the house exterior and maybe look at the deck"],
];

async function main() {
  const { detectTrade, routeDecision } = await import("@/lib/ai/detectTrade");
  for (const [tag, text] of CASES) {
    const det = await detectTrade(text);
    const dec = routeDecision(det);
    const where = dec.route === "CASCADE" ? `CASCADE → ${dec.trade}` : `MANUAL_QUEUE (${dec.queueReason})`;
    console.log(
      `${tag.padEnd(12)} | ${det ? det.trade.padEnd(18) : "NULL (ai down)".padEnd(18)} | ${det ? det.confidence.toFixed(2) : "  — "} | ${where}`,
    );
    if (det) console.log(`${"".padEnd(12)} |   reason: ${det.reason}`);
  }
}
void main();
