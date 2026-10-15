// THE EDITIONS (2026-10-11, lib/editions): the doors of one platform. The
// cookie's values, which plans ARE the Deck Studio, who holds it (its own
// plan, a plan whose features name it, the custom plan's page), who may
// switch, where a sign-in lands, what the deck workspace's sidebar keeps and
// drops, and the sign-up link each door writes. Pure.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/billing/editions.check.ts
import { EDITIONS, EDITION_OPEN, canSwitch, editionOnly, featureLineForSale, hasEdition, homeFor, isEditionPlan, navAllowed, parseDoor, planComingSoon, registerHref, unlockedByEdition, upgradeTargetFrom, workspaceFor, type AccessFacts } from "../../../src/lib/editions";
import { annualDeal, dealWords, savedWords } from "../../../src/lib/planDeal";
import { NAV_SECTIONS, navSectionsFor, flattenNavItems } from "../../../src/components/v3/blueprint-shell/nav-map";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const facts = (over: Partial<AccessFacts>): AccessFacts => ({ planSlug: "PROFESSIONAL", lapsed: false, features: [], customPages: null, ...over });

console.log("── the door cookie");
// Since 2026-10-11 the Deck Studio is COMING SOON (EDITION_OPEN.deck false): the checks of an OPEN
// edition pass the flag; the "as shipped" block at the end holds what is live today.
check("deck, platform and jobflex parse; junk does not (once open)", parseDoor("deck", true) === "deck" && parseDoor(" DECK ", true) === "deck" && parseDoor("platform") === "platform" && parseDoor("jobflex") === "platform" && parseDoor("roof") === null && parseDoor(null) === null);

console.log("── which plans are the edition");
check("deck-studio and any deck- plan are the Deck Studio; the others are not", isEditionPlan("deck-studio") && isEditionPlan("DECK-STUDIO") && isEditionPlan("deck-studio-yearly") && isEditionPlan("deck") && !isEditionPlan("PROFESSIONAL") && !isEditionPlan("custom") && !isEditionPlan(null));

console.log("── who holds it");
const deckPlan = facts({ planSlug: "deck-studio" });
const proWithDeck = facts({ features: ["Everything in Starter", "Deck Studio — 3D design, code checks, permit set"] });
const customWithPage = facts({ planSlug: "custom", customPages: ["proposals", "deck-estimator"] });
check("the Deck Studio plan holds it", hasEdition(deckPlan));
check("a plan whose features name it holds it (once open)", hasEdition(proWithDeck, "deck", true) && hasEdition(facts({ features: ["the deck estimator"] }), "deck", true));
check("the custom plan with the deck page holds it (once open)", hasEdition(customWithPage, "deck", true));
check("a plain Professional does not; neither does a lapsed Deck Studio; neither does no plan", !hasEdition(facts({})) && !hasEdition(facts({ planSlug: "deck-studio", lapsed: true })) && !hasEdition(facts({ planSlug: null })));
check("the platform edition is open to everyone", hasEdition(facts({ planSlug: null }), "platform"));
check("the Deck Studio plan is the edition alone; the add-ons are not", editionOnly(deckPlan) && !editionOnly(proWithDeck) && !editionOnly(customWithPage) && !editionOnly(facts({ planSlug: "deck-studio", lapsed: true })));
check("only an account with both workspaces may switch (once open)", !canSwitch(deckPlan, true) && canSwitch(proWithDeck, true) && canSwitch(customWithPage, true) && !canSwitch(facts({}), true));

console.log("── the workspace and the home");
check("the Deck Studio plan works in the studio whatever the door", workspaceFor(deckPlan, "platform") === "deck" && workspaceFor(deckPlan, null) === "deck");
check("an add-on account follows the door (once open)", workspaceFor(proWithDeck, "deck", true) === "deck" && workspaceFor(proWithDeck, "platform", true) === "platform" && workspaceFor(proWithDeck, null, true) === "platform");
check("without the edition the deck door still works on the platform", workspaceFor(facts({}), "deck") === "platform");
check("a sign-in lands: the studio for the deck plan, the door's home otherwise, the studio page even without the plan", homeFor(deckPlan, "platform") === "/dashboard/deck-estimator" && homeFor(proWithDeck, "deck") === "/dashboard/deck-estimator" && homeFor(proWithDeck, "platform") === "/dashboard" && homeFor(facts({}), "deck") === "/dashboard/deck-estimator" && homeFor(null, null) === "/dashboard");

console.log("── the deck workspace's sidebar");
const all = flattenNavItems(NAV_SECTIONS.flatMap((s) => s.items)).map((i) => i.href).filter((h) => h !== "#");
const kept = all.filter((h) => navAllowed("deck", h));
const dropped = all.filter((h) => !navAllowed("deck", h));
check("the studio keeps the office: proposals, clients, calendar, jobs, workers, financials, the deck estimator and its inventory", ["/dashboard/proposals", "/dashboard/clients", "/dashboard/calendar", "/dashboard/jobs", "/dashboard/workers", "/dashboard/financials", "/dashboard/deck-estimator", "/dashboard/deck-estimator/inventory", "/dashboard/subscription"].every((h) => kept.includes(h)), kept.join(" "));
check("and drops the other trades' tools: Smart Proposal, roof, fence, HVAC, video, the trade board", ["/dashboard/advanced-ai", "/dashboard/roof-estimator", "/dashboard/roof-estimator/inventory", "/dashboard/fence-estimator", "/dashboard/video-estimator", "/dashboard/hvac-estimator", "/dashboard/trade"].every((h) => dropped.includes(h)), dropped.join(" "));
check("a child route of a kept row is kept; the overview matches only itself", navAllowed("deck", "/dashboard/jobs/abc") && navAllowed("deck", "/dashboard/deck-estimator/inventory?tab=stock") && !navAllowed("deck", "/dashboard/roof-estimator/inventory") && navAllowed("platform", "/dashboard/roof-estimator"));
const ownerDeck = navSectionsFor("OWNER", [], [], { workspace: "deck", unlocked: [...unlockedByEdition("deck")] });
const ownerAll = navSectionsFor("OWNER", [], [], { workspace: "platform", unlocked: [...unlockedByEdition("deck")] });
const deckRow = (sections: typeof ownerDeck) => flattenNavItems(sections.flatMap((s) => s.items)).find((i) => i.href === "/dashboard/deck-estimator");
check("an owner's deck workspace has no roof row and the deck row no longer says Soon", !flattenNavItems(ownerDeck.flatMap((s) => s.items)).some((i) => i.href === "/dashboard/roof-estimator") && deckRow(ownerDeck)?.soon === false && deckRow(ownerDeck)?.children?.every((c) => c.soon === false) === true);
check("on the platform with the add-on the whole map stays and the deck row stops saying Soon", flattenNavItems(ownerAll.flatMap((s) => s.items)).some((i) => i.href === "/dashboard/roof-estimator") && deckRow(ownerAll)?.soon === false);
check("without a view the map is as it was: the deck row says Soon", deckRow(navSectionsFor("OWNER"))?.soon === true);
check("an estimator's deck workspace keeps proposals and the deck estimator only among the engines", (() => { const items = flattenNavItems(navSectionsFor("ESTIMATOR", [], [], { workspace: "deck" }).flatMap((s) => s.items)).map((i) => i.href); return items.includes("/dashboard/proposals") && items.includes("/dashboard/deck-estimator") && !items.includes("/dashboard/roof-estimator") && !items.includes("/dashboard/advanced-ai"); })());

console.log("── the doors' sign-up links");
check("the deck door's link carries the trade and the edition", registerHref("deck") === "/auth/register?industry=decking&edition=deck" && registerHref("deck", { utm_source: "fb" }) === "/auth/register?industry=decking&edition=deck&utm_source=fb");
check("the platform door's link is plain", registerHref("platform") === "/auth/register");
check("the editions name their homes and landings", EDITIONS.deck.homeHref === "/dashboard/deck-estimator" && EDITIONS.deck.landingPath === "/deck" && EDITIONS.platform.homeHref === "/dashboard");


console.log("── the annual deal in words (owner, 2026-10-11: months free, never a percentage; 2026-10-12: whole months or no stamp)");
check("$890 a year on $89 a month is 2 months free", dealWords(annualDeal(8900, 89000)) === "2 months free" && annualDeal(8900, 89000)?.monthsFree === 2);
check("$1,000 a year on $100 a month is 2 months free; $1,100 is one month", dealWords(annualDeal(10000, 100000)) === "2 months free" && dealWords(annualDeal(10000, 110000)) === "1 month free");
check("a year that is not a whole number of months off gets no stamp, not a percentage — only the dollars", annualDeal(8900, 95000)?.monthsFree === null && dealWords(annualDeal(8900, 95000)) === "" && savedWords(annualDeal(8900, 95000)) === "You save $118");
check("no yearly price, a dearer year, or a free plan: no deal", annualDeal(8900, null) === null && annualDeal(8900, 106800) === null && annualDeal(8900, 120000) === null && annualDeal(0, 1000) === null);

console.log("── the plan an existing customer upgrades to (no separate add-on)");
const catalog = [
  { slug: "starter", name: "Starter", priceCents: 4900, features: ["Proposals"], active: true },
  { slug: "professional", name: "Professional", priceCents: 14900, features: ["Everything in Starter", "Deck Studio — 3D design on the house photo"], active: true },
  { slug: "enterprise-old", name: "Old", priceCents: 29900, features: ["Deck Studio"], active: false },
  { slug: "deck-studio", name: "Deck Studio", priceCents: 8900, features: ["Deck Studio"], active: true },
];
check("the dearest plan on sale that names Deck Studio wins, never the deck plan itself or a retired plan (once open)", upgradeTargetFrom(catalog, "deck", true)?.slug === "professional");
check("with no such plan, the Deck Studio plan itself (once open)", upgradeTargetFrom(catalog.filter((p) => p.slug !== "professional"), "deck", true)?.slug === "deck-studio");
check("with nothing on sale that carries it, nothing", upgradeTargetFrom(catalog.filter((p) => p.slug === "starter"), "deck", true) === null);

console.log("── AS SHIPPED: the Deck Studio is coming soon (owner, 2026-10-11)");
check("the edition is closed and the platform open", EDITION_OPEN.deck === false && EDITION_OPEN.platform === true);
check("no door to it: a 'deck' cookie or link reads as no door", parseDoor("deck") === null && parseDoor("platform") === "platform");
check("a feature line or the custom page opens nothing yet", !hasEdition(proWithDeck) && !hasEdition(customWithPage) && !canSwitch(proWithDeck) && workspaceFor(proWithDeck, "deck") === "platform");
check("an account already ON the Deck Studio plan keeps it — that was bought", hasEdition(deckPlan) && editionOnly(deckPlan) && workspaceFor(deckPlan, null) === "deck" && !hasEdition(facts({ planSlug: "deck-studio", lapsed: true })));
check("no plan is the way to it, so the upgrade page points at none", upgradeTargetFrom(catalog) === null);
check("its own plans are not on sale; the others are", planComingSoon("deck-studio") && planComingSoon("DECK") && planComingSoon("deck-studio-yearly") && !planComingSoon("professional") && !planComingSoon(null) && !planComingSoon("deck-studio", true));
check("a feature line naming it says coming soon, once; the others are untouched; nothing when open", featureLineForSale("Deck Studio — 3D design") === "Deck Studio — 3D design — coming soon" && featureLineForSale("Includes the deck estimator") === "Includes the deck estimator — coming soon" && featureLineForSale("Deck Studio (coming soon)") === "Deck Studio (coming soon)" && featureLineForSale("Unlimited proposals") === "Unlimited proposals" && featureLineForSale("Deck Studio", true) === "Deck Studio");

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
