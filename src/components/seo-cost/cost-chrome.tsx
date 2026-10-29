import Link from "next/link";
import type { ReactNode } from "react";
import { ProductMark } from "@/components/brand/ProductMark";
import { CookieSettingsLink } from "@/components/consent/cookie-settings-link";
import s from "./cost.module.css";

// The cost guides' frame (2026-10-26): the product mark, a way back to the
// guides, and a footer that may carry the contractor's line. A homeowner page,
// so no sign-in, pricing or sign-up in the bar.
export function CostChrome({ children, footPro }: { children: ReactNode; footPro?: ReactNode }) {
  return (
    <div className={s.page}>
      <header className={s.top}>
        <div className={s.topIn}>
          <Link className={s.brand} href="/" prefetch={false} aria-label="JobFlex home">
            <ProductMark />
            JobFlex
          </Link>
          <span style={{ display: "inline-flex", gap: 16 }}>
            <Link className={s.topLink} href="/homeowner" prefetch={false}>
              Price my project
            </Link>
            <Link className={s.topLink} href="/cost" prefetch={false}>
              Cost guides
            </Link>
          </span>
        </div>
      </header>
      <main className={s.main}>{children}</main>
      <footer className={s.foot}>
        <div className={s.footIn}>
          {footPro ? <p className={s.footPro}>{footPro}</p> : null}
          <nav className={s.footLinks} aria-label="Footer">
            <Link href="/cost" prefetch={false}>All cost guides</Link>
            <Link href="/homeowner" prefetch={false}>Price my project · get quotes</Link>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <CookieSettingsLink />
          </nav>
          <p className={s.small}>Prices are estimates from JobFlex&apos;s contractor price book, before sales tax. A licensed contractor&apos;s quote for your home is the number to plan with.</p>
        </div>
      </footer>
    </div>
  );
}
