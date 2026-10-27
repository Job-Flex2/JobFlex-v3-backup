// /price — "See what your project should cost, for your house" (owner, 2026-10-27). The homeowner's front door to
// JobFlex's own estimators: the roof prices itself from the address (/price/roof); the other trades are described and
// matched. No account, no sign-in. Design: docs/superpowers/specs/2026-10-27-home-portal-price-my-project-design.md.
import type { Metadata } from "next";
import { PriceChrome, PriceRow } from "@/components/v3/price-my-project/price-row";
import s from "@/components/v3/price-my-project/price.module.css";

export const metadata: Metadata = {
  title: "See what your project should cost — JobFlex",
  description: "Type your address, pick what you want, and see a price range for your house in about a minute. Roofs are measured from the sky; a local pro confirms on site.",
};

export default function PricePage() {
  return (
    <PriceChrome>
      <div style={{ display: "grid", gap: 10 }}>
        <p className={s.kicker}>Price my project</p>
        <h1 className={s.h1}>See what your project should cost, for your house.</h1>
        <p className={s.lede}>Type your address, pick what you want, answer three questions. A range in about a minute — no account, nothing to download.</p>
      </div>
      <PriceRow />
      <p className={s.small}>An estimate range from aerial data and local prices, not a quote. A local pro confirms on site.</p>
    </PriceChrome>
  );
}
