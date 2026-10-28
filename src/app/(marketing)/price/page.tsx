// /price — "See what your project should cost, for your house" (owner, 2026-10-27). The homeowner's front door to
// JobFlex's own estimators: the roof prices itself from the address (/price/roof); deck, fence, heating & cooling and
// any project run the house estimators (/estimate/jobflex/<trade>) once the Lead Center names the house org, and are
// described and matched until then. No account, no sign-in. Designs:
// docs/superpowers/specs/2026-10-27-home-portal-price-my-project-design.md,
// docs/superpowers/specs/2026-10-28-home-portal-house-estimators-design.md.
import type { Metadata } from "next";
import { PriceChrome, PriceRow } from "@/components/v3/price-my-project/price-row";
import s from "@/components/v3/price-my-project/price.module.css";
import { houseOrgId } from "@/lib/publicEstimate/store";
import { PRO_CAP, PRO_IS } from "@/lib/home/jobflexPro";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "See what your project should cost — JobFlex",
  description: "Type your address, pick what you want, and see a price range for your house in about a minute. Roofs are measured from the sky; a local JobFlex pro confirms on site.",
};

export default async function PricePage() {
  const house = !!(await houseOrgId());
  return (
    <PriceChrome>
      <div style={{ display: "grid", gap: 10 }}>
        <p className={s.kicker}>Price my project</p>
        <h1 className={s.h1}>See what your project should cost, for your house.</h1>
        <p className={s.lede}>Type your address, pick what you want, answer three questions. A range in about a minute — no account, nothing to download.</p>
      </div>
      <PriceRow house={house} />
      <p className={s.small}>{house ? "Estimate ranges from JobFlex’s own estimators, aerial data and local prices — not quotes." : "An estimate range from aerial data and local prices, not a quote."} {PRO_CAP} confirms on site. {PRO_IS}</p>
    </PriceChrome>
  );
}
