// STRAIGHT TO PROFESSIONAL (2026-10-15) — the pure rule (lib/signupAutoPlan): which plan the short sign-up opens the
// card page for, and the database pieces around it (the admin switch, the account that waits for a sign-in to prove
// its address, the welcome card). The DB part runs on a COPY of a local database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json scripts/qa/signup-auto-plan.check.ts
//   DATABASE_URL=file:<copy> NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json scripts/qa/signup-auto-plan.check.ts --db
import { AUTO_PLAN_SLUG, autoPlanFor, autoPlanPrice, includedFeatures } from "../../src/lib/signupAutoPlan";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

// The real catalogue's three sold plans (prisma/seed.ts), and a Deck Studio edition plan beside them.
const starter = { slug: "starter", priceCents: 2900, features: ["Proposal management", "Client management", "Free leads", "CRM", "1 user"] };
const pro = { slug: "professional", priceCents: 7900, highlight: true, features: ["Everything in Starter", "Smart proposal generation", "Roof estimator", "Fence estimator", "Up to 3 users"] };
const ent = { slug: "enterprise", priceCents: 19900, features: ["Everything in Professional", "Video estimator", "AI phone answering", "Custom branding & domain", "Unlimited users"] };
const deck = { slug: "deck-studio", priceCents: 8900, features: ["Deck Studio", "Proposal management"] };
const plans = [starter, pro, ent];
const pick = (o: Partial<Parameters<typeof autoPlanFor>[0]> = {}) => autoPlanFor({ plans, ...o });

check("the rule's plan is Professional", AUTO_PLAN_SLUG === "professional");
check("no ad, no choice: Professional", JSON.stringify(pick()) === JSON.stringify({ slug: "professional", why: "default" }));
check("a roofing ad: Professional has the Roof estimator — Professional", pick({ tool: "roof" })?.slug === "professional");
check("an AI desk ad: Professional hasn't got it — Enterprise, the cheapest that has", JSON.stringify(pick({ tool: "aidesk" })) === JSON.stringify({ slug: "enterprise", why: "tool" }));
check("an ad for a tool no plan lists: Professional anyway", pick({ tool: "blueprint" })?.slug === "professional");
check("chosen on the pricing page (?plan=starter): theirs wins", JSON.stringify(pick({ asked: "starter", tool: "aidesk" })) === JSON.stringify({ slug: "starter", why: "asked" }));
check("a ?plan= that isn't sold is ignored", pick({ asked: "platinum" })?.slug === "professional");
check("the Deck Studio door: its own plan", JSON.stringify(autoPlanFor({ plans: [...plans, deck], editionSlug: "deck-studio" })) === JSON.stringify({ slug: "deck-studio", why: "edition" }));
check("no Professional in the catalogue: the highlighted plan, else the first", autoPlanFor({ plans: [starter, { ...ent, highlight: true }] })?.slug === "enterprise" && autoPlanFor({ plans: [starter, ent] })?.why === "fallback" && autoPlanFor({ plans: [starter, ent] })?.slug === "starter");
check("an empty catalogue: nothing (the plan cards, as built)", autoPlanFor({ plans: [] }) === null);
const inc = includedFeatures(plans);
check("'Everything in Starter' rolls up the way the cards read it", (inc.get("professional") ?? []).includes("Free leads") && (inc.get("enterprise") ?? []).includes("Roof estimator") && !(inc.get("starter") ?? []).includes("Roof estimator"));
check("the price as step 1 says it", autoPlanPrice({ priceCents: 7900 }) === "$79/mo" && autoPlanPrice({ priceCents: 7950 }) === "$79.50/mo");

async function db() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/^file:/.test(url)) throw new Error("Refusing: DATABASE_URL is not a local SQLite copy.");
  const { db } = await import("../../src/lib/db");
  const { readSignupPlan, setSignupPlan } = await import("../../src/lib/trialPolicyServer");
  const { markUnclaimed, claimIfUnclaimed, isUnclaimed } = await import("../../src/lib/accountClaim");
  const { autoPlanWelcomeView, dismissAutoPlanWelcomeFor, autoPlanWelcomeKey, areaFromAddress } = await import("../../src/lib/autoPlanWelcome");
  check(
    "the town from an address: 'Bellevue, WA'; nothing when it doesn't say",
    areaFromAddress("123 Main St, Bellevue, WA 98004, USA") === "Bellevue, WA" &&
      areaFromAddress("Bellevue, WA 98004") === "Bellevue, WA" &&
      areaFromAddress("500 Pine St, Seattle, WA") === "Seattle, WA" &&
      areaFromAddress("123 Main St") === null &&
      areaFromAddress("") === null &&
      areaFromAddress(null) === null &&
      areaFromAddress("12 Oak Ave, 98004") === null,
  );
  const before = await db.syncState.findUnique({ where: { key: "signupPlan" } });
  await db.syncState.deleteMany({ where: { key: "signupPlan" } });
  check("the switch: no row = the plan cards", (await readSignupPlan({ fresh: true })).mode === "pick");
  const set = await setSignupPlan("auto", "QA");
  check("the switch: set to straight-to-Professional, who and when kept", set.mode === "auto" && set.source === "admin" && set.by === "QA" && !!set.at && (await readSignupPlan()).mode === "auto");
  await db.syncState.deleteMany({ where: { key: "signupPlan" } });
  if (before) await db.syncState.create({ data: { key: before.key, cursor: before.cursor } });

  const stamp = Date.now();
  const u = await db.user.create({ data: { email: `qa-auto-${stamp}@auto.test`, name: "QA Auto" } });
  const org = await db.organization.create({ data: { name: "QA Auto", slug: `qa-auto-${stamp}`, billingEmail: u.email } });
  try {
    await markUnclaimed(db, u.id);
    check("an account from the short sign-up waits for its address to be proven", await isUnclaimed(u.id));
    const cv = (await db.user.findUnique({ where: { id: u.id }, select: { credentialVersion: true } }))?.credentialVersion ?? 0;
    check("the first proving sign-in claims it: other sessions end, the address is confirmed", (await claimIfUnclaimed(u.id)) === true);
    const after = await db.user.findUnique({ where: { id: u.id }, select: { credentialVersion: true, emailVerified: true } });
    check("…credentialVersion bumped, emailVerified set, no longer waiting", (after?.credentialVersion ?? 0) === cv + 1 && !!after?.emailVerified && !(await isUnclaimed(u.id)));
    check("…and only once: the next sign-in signs nobody out", (await claimIfUnclaimed(u.id)) === false && (await db.user.findUnique({ where: { id: u.id }, select: { credentialVersion: true } }))?.credentialVersion === cv + 1);

    check("no mark: no welcome card", (await autoPlanWelcomeView(org.id)) === null);
    await db.syncState.create({ data: { key: autoPlanWelcomeKey(org.id), cursor: JSON.stringify({ at: new Date().toISOString() }) } });
    check("marked but no plan yet: no card", (await autoPlanWelcomeView(org.id)) === null);
    const ends = new Date(Date.now() + 7 * 86_400_000);
    await db.subscription.create({ data: { organizationId: org.id, plan: "PROFESSIONAL", status: "TRIALING", trialEndsAt: ends } });
    const v = await autoPlanWelcomeView(org.id);
    const catalogPro = await db.pricingPlan.findUnique({ where: { slug: "professional" }, select: { name: true, priceCents: true } });
    check("the card says the plan it really is, the free days, the price after, where receipts go", !!v && v.trial && v.trialEndsAt === ends.toISOString() && v.interval === "MONTH" && v.billingEmail === u.email && (catalogPro ? v.planName === catalogPro.name && v.priceCents === catalogPro.priceCents : v.planName === "Professional"), JSON.stringify(v));
    await db.subscription.update({ where: { organizationId: org.id }, data: { plan: "STARTER" } });
    check("homeowner leads, nothing set up yet: no town, no trades, not ready", !!v && v.leads.area === null && v.leads.trades.length === 0 && v.leads.ready === false);
    await db.organization.update({ where: { id: org.id }, data: { address: "500 Pine St, Seattle, WA 98101", lat: 47.61, lng: -122.33, tradeTypesJson: JSON.stringify(["Roofing", "Siding"]) } });
    const lv = await autoPlanWelcomeView(org.id);
    check("…address and specialties set: 'Seattle, WA', the trades, ready", !!lv && lv.leads.area === "Seattle, WA" && lv.leads.trades.join() === "Roofing,Siding" && lv.leads.ready === true, JSON.stringify(lv?.leads));
    check("backed out of the card page and picked Starter: the card says Starter", /starter/i.test((await autoPlanWelcomeView(org.id))?.planName ?? ""));
    check("ten days on, the card is gone by itself", (await autoPlanWelcomeView(org.id, new Date(Date.now() + 11 * 86_400_000))) === null);
    await dismissAutoPlanWelcomeFor(org.id);
    check("'Got it': gone for good", (await autoPlanWelcomeView(org.id)) === null);
  } finally {
    await db.syncState.deleteMany({ where: { key: { in: [autoPlanWelcomeKey(org.id), `quickUnclaimed:${u.id}`] } } });
    await db.subscription.deleteMany({ where: { organizationId: org.id } });
    await db.organization.delete({ where: { id: org.id } });
    await db.user.delete({ where: { id: u.id } });
    await db.$disconnect();
  }
}

(async () => {
  if (process.argv.includes("--db")) await db();
  if (bad) {
    console.log(`\n${bad} FAILED`);
    process.exit(1);
  }
  console.log("\nall passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
