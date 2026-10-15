// The ceiling on a partner's share: a percentage code at most 50%, a flat code
// at most the cheapest paid plan; above it a refusal in words; codes written
// before the rule are pointed out, not changed. No Stripe call, nothing written.
//
//   npx tsx --tsconfig tsconfig.json qa/tests/billing/influencer-limits.check.ts

delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_SECRET_KEY_TEST;

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PERCENT_MAX, cheapestPaidPlanCents, commissionRefusal, promoAboveLimit } from "../../../src/lib/commissionLimits";

const db = new PrismaClient();
let passes = 0;
let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

async function main() {
  const cheapest = await cheapestPaidPlanCents();
  const rows = await db.pricingPlan.findMany({ where: { active: true, priceCents: { gt: 0 } }, select: { priceCents: true } });
  const min = rows.length ? Math.min(...rows.map((r) => r.priceCents)) : null;
  ok("the flat ceiling is the cheapest ACTIVE PAID plan's monthly price", cheapest === min, `${cheapest}¢ · ${rows.length} paid plan(s)`);

  ok(`a percentage code at ${PERCENT_MAX}% is accepted, ${PERCENT_MAX + 1}% refused in words`,
    commissionRefusal({ commissionType: "PERCENT", commissionValue: PERCENT_MAX }, cheapest) === null &&
      /at most 50%/.test(commissionRefusal({ commissionType: "PERCENT", commissionValue: PERCENT_MAX + 1 }, cheapest) ?? ""),
    commissionRefusal({ commissionType: "PERCENT", commissionValue: 51 }, cheapest) ?? "");
  ok("…on either basis (gross is more, not less)", /at most 50%/.test(commissionRefusal({ commissionType: "PERCENT", commissionValue: 60 }, cheapest) ?? ""));
  const flatAt = (cheapest ?? 2900) / 100;
  ok("a flat code at the cheapest plan's price is accepted, a dollar more refused, naming the plan's price",
    commissionRefusal({ commissionType: "FLAT", commissionValue: flatAt }, cheapest) === null &&
      /cheapest plan/.test(commissionRefusal({ commissionType: "FLAT", commissionValue: flatAt + 1 }, cheapest) ?? ""),
    commissionRefusal({ commissionType: "FLAT", commissionValue: flatAt + 1 }, cheapest) ?? "");
  ok("with no paid plan to bound by, a flat code is not refused", commissionRefusal({ commissionType: "FLAT", commissionValue: 500 }, null) === null);

  ok("a stored code above the limit is flagged; one inside it is not",
    promoAboveLimit({ commissionType: "PERCENT", commissionRateBps: 6000, commissionFlatCents: null }, cheapest) &&
      !promoAboveLimit({ commissionType: "PERCENT", commissionRateBps: 5000, commissionFlatCents: null }, cheapest) &&
      promoAboveLimit({ commissionType: "FLAT", commissionRateBps: null, commissionFlatCents: (cheapest ?? 2900) + 1 }, cheapest) &&
      !promoAboveLimit({ commissionType: "FLAT", commissionRateBps: null, commissionFlatCents: cheapest ?? 2900 }, cheapest));

  const actions = readFileSync("src/actions/influencers.ts", "utf8");
  ok("createInfluencer, createPromoCode and updatePromoCommission all ask commissionRefusal before writing",
    (actions.match(/commissionRefusal\(/g) ?? []).length === 3 && /await cheapestPaidPlanCents\(\)/.test(actions));
  const page = readFileSync("src/app/(admin)/admin/influencers/page.tsx", "utf8");
  const ui = readFileSync("src/components/v3/admin-influencers/influencers-content.tsx", "utf8");
  ok("/admin/influencers flags stored codes above the limit (aboveLimit on the DTO, a tag and a chip on the page)",
    /aboveLimit: promoAboveLimit\(p, cheapestPlanCents\)/.test(page) && /p\.aboveLimit && styles\.tagOver/.test(ui) && /Above limit/.test(ui));
  const existing = await db.promoCode.findMany({ select: { code: true, commissionType: true, commissionRateBps: true, commissionFlatCents: true } });
  const flagged = existing.filter((p) => promoAboveLimit(p, cheapest)).map((p) => p.code);
  ok("existing codes are left as they are (nothing here writes)", true, flagged.length ? `above the limit today: ${flagged.join(", ")}` : "none above the limit");

  console.log(`\n${passes} passed, ${failures} failed`);
  await db.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\ncheck crashed:", err);
  await db.$disconnect();
  process.exit(2);
});
