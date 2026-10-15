// The tool the visitor came for (lib/planSpotlight, 2026-10-14): which tool a
// link or a trade means, which feature line it marks, and how the rows reorder.
//   npx --no-install tsx --tsconfig tsconfig.json scripts/qa/plan-spotlight.check.ts
import { SPOTLIGHT, SPOTLIGHT_TOOLS, parseSpotlightTool, spotlightFor, spotlightFromTrade, spotlightLine, spotlightRow, withSpotlightFirst } from "../../src/lib/planSpotlight";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log("── the seven tools");
check("seven tools, each with a label, a match and a who", SPOTLIGHT_TOOLS.length === 7 && SPOTLIGHT_TOOLS.every((k) => SPOTLIGHT[k].label && SPOTLIGHT[k].match instanceof RegExp && SPOTLIGHT[k].who));

console.log("── the link's own word");
check("keys and spellings read; case and spaces do not matter", parseSpotlightTool("roof") === "roof" && parseSpotlightTool(" Roofing ") === "roof" && parseSpotlightTool("ai-desk") === "aidesk" && parseSpotlightTool("blueprints") === "blueprint" && parseSpotlightTool("deck-studio") === "deck" && parseSpotlightTool("smart-proposal") === "smart" && parseSpotlightTool(["hvac"]) === "hvac");
check("anything else is nothing", parseSpotlightTool("plumbing") === undefined && parseSpotlightTool("") === undefined && parseSpotlightTool(undefined) === undefined && parseSpotlightTool("<script>") === undefined);

console.log("── the trade's own estimator");
check("roofing → roof, hvac → hvac, fencing → fence, decking → deck; by key or by name", spotlightFromTrade("roofing") === "roof" && spotlightFromTrade("Roofing") === "roof" && spotlightFromTrade("hvac") === "hvac" && spotlightFromTrade("HVAC") === "hvac" && spotlightFromTrade("fencing") === "fence" && spotlightFromTrade("Fencing") === "fence" && spotlightFromTrade("decking") === "deck" && spotlightFromTrade("Decking") === "deck");
check("a trade without an ad tool marks nothing", spotlightFromTrade("plumbing") === undefined && spotlightFromTrade("General Contractor") === undefined && spotlightFromTrade(null) === undefined);
check("the tool on the link wins over the trade; no link, the trade; neither, nothing", spotlightFor({ tool: "aidesk", industry: "roofing" }) === "aidesk" && spotlightFor({ industry: "roofing" }) === "roof" && spotlightFor({ tool: "nope", industry: "plumbing" }) === null && spotlightFor({}) === null);

console.log("── the row it marks");
const rows = ["Proposal management", "Client management", "Smart proposal generation", "Roof estimator", "Fence estimator", "HVAC estimator", "Blueprint estimator", "Deck Studio", "AI phone answering", "Unlimited users"];
check("each tool finds its line however the catalog words it", spotlightRow(rows, "roof") === "Roof estimator" && spotlightRow(rows, "fence") === "Fence estimator" && spotlightRow(rows, "hvac") === "HVAC estimator" && spotlightRow(rows, "smart") === "Smart proposal generation" && spotlightRow(rows, "blueprint") === "Blueprint estimator" && spotlightRow(rows, "deck") === "Deck Studio" && spotlightRow(rows, "aidesk") === "AI phone answering");
check("'AI desk' and 'receptionist' wordings also read as the desk", spotlightRow(["AI desk"], "aidesk") === "AI desk" && spotlightRow(["Phone receptionist"], "aidesk") === "Phone receptionist");
check("a catalog without the line marks nothing", spotlightRow(["Proposal management", "CRM"], "roof") === null && spotlightRow(rows, null) === null);
const first = withSpotlightFirst(rows, "deck");
check("the marked line goes first; the rest keep their order; nothing is lost", first[0] === "Deck Studio" && first.length === rows.length && first.slice(1).join("|") === rows.filter((r) => r !== "Deck Studio").join("|"));
check("no tool, or no line: the rows as they were", withSpotlightFirst(rows, null).join("|") === rows.join("|") && withSpotlightFirst(["CRM"], "roof").join("|") === "CRM");
check("the line over the cards", /You came for the Roof estimator — it's marked on every plan below\./.test(spotlightLine("roof", true)) && /ask us which plan carries it/.test(spotlightLine("roof", false)) && /You came for Deck Studio/.test(spotlightLine("deck", true)));

console.log(bad ? `\n${bad} FAILED` : "\nall good");
process.exit(bad ? 1 : 0);
