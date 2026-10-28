// THE ROW (owner, 2026-10-27: "roof first; the other estimators visible in a row and very attractive"). Five picture
// cards (./cards): the roof prices itself at /price/roof; the other four run JobFlex's own estimators once the Lead
// Center names the house org (2026-10-28), and open the describe-and-match intake until then. No "coming soon".
// Server-safe: plain anchors, no state.
import Link from "next/link";
import { ProductMark } from "@/components/brand/ProductMark";
import { priceCards, type PriceCardKey } from "./cards";
import s from "./price.module.css";

export type { PriceCardKey } from "./cards";

function Pic({ k }: { k: PriceCardKey }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (k) {
    case "roof":
      return (
        <svg viewBox="0 0 32 32" {...common}>
          <path d="M4 17 16 6l12 11" />
          <path d="M8 15v11h16V15" />
          <path d="M13 26v-7h6v7" />
        </svg>
      );
    case "deck":
      return (
        <svg viewBox="0 0 32 32" {...common}>
          <path d="M4 14h24" />
          <path d="M4 20h24" />
          <path d="M8 14v12M16 14v12M24 14v12" />
          <path d="M6 14V8h20v6" />
          <path d="M11 8V5M21 8V5" />
        </svg>
      );
    case "fence":
      return (
        <svg viewBox="0 0 32 32" {...common}>
          <path d="M6 10l3-4 3 4v16H6zM14 10l3-4 3 4v16h-6zM22 10l3-4 3 4v16h-6z" />
          <path d="M4 15h24M4 22h24" />
        </svg>
      );
    case "hvac":
      return (
        <svg viewBox="0 0 32 32" {...common}>
          <rect x="5" y="9" width="22" height="14" rx="2" />
          <path d="M9 13h14M9 17h14M12 23v4M20 23v4" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 32 32" {...common}>
          <rect x="5" y="7" width="22" height="18" rx="2" />
          <path d="m5 21 7-7 5 5 4-4 6 6" />
          <circle cx="21" cy="12" r="2" />
        </svg>
      );
  }
}

export function PriceChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className={s.page}>
      <header className={s.top}>
        <div className={s.topIn}>
          <Link className={s.brand} href="/" prefetch={false} aria-label="JobFlex home">
            <ProductMark />
            JobFlex
          </Link>
          <Link className={s.topLink} href="/homeowner" prefetch={false}>
            Homeowners
          </Link>
        </div>
      </header>
      <main className={s.main}>{children}</main>
    </div>
  );
}

export function PriceRow({ trade, house = false }: { trade?: string | null; house?: boolean }) {
  return (
    <div className={s.row} data-price-row data-price-house={house ? "1" : "0"}>
      {priceCards(house).map((c) => (
        <a key={c.key} className={`${s.card}${c.live ? ` ${s.cardLive}` : ""}`} href={c.href} data-price-card={c.key} data-price-live={c.live ? "1" : "0"} aria-current={trade && c.key === trade ? "true" : undefined}>
          {c.live ? <span className={s.tag}>Priced here</span> : null}
          <span className={s.pic}>
            <Pic k={c.key} />
          </span>
          <span className={s.cardT}>{c.title}</span>
          <span className={s.cardB}>{c.blurb}</span>
          <span className={s.cardGo}>{c.go} →</span>
        </a>
      ))}
    </div>
  );
}
