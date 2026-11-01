import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/v3/landing-e/logo";
import { LEGAL_CONTACT_EMAIL } from "@/lib/legal";
import "@/components/v3/landing-e/landing-e.css";
import styles from "./legal-page.module.css";

export function LegalContact() {
  return <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>;
}

export function LegalPage({ title, number, summary, updated, children }: {
  title: string; number: string; summary: string; updated: { iso: string; label: string }; children: ReactNode;
}) {
  return (
    <div className={`jf-lp ${styles.page}`}>
      <header className={styles.topbar}>
        <Link href="/" aria-label="JobFlex home"><Logo /></Link>
        <Link href="/" className={styles.home}>Back to home <span aria-hidden>↗</span></Link>
      </header>
      <main className={styles.main}>
        <header className={styles.masthead}>
          <div className={styles.kicker}>JobFlex / Legal / {number}</div>
          <h1>{title}</h1>
          <p className={styles.summary}>{summary}</p>
          <div className={styles.meta}>Last updated <time dateTime={updated.iso}>{updated.label}</time></div>
        </header>
        <nav className={styles.tabs} aria-label="Legal documents">
          <Link href="/privacy" aria-current={number === "01" ? "page" : undefined}>01 / Privacy policy</Link>
          <Link href="/terms" aria-current={number === "02" ? "page" : undefined}>02 / Terms of service</Link>
          <Link href="/security" aria-current={number === "03" ? "page" : undefined}>03 / Security</Link>
        </nav>
        <article className={styles.article}>{children}</article>
        <footer className={styles.footer}>
          <span className={styles.kicker}>Questions & requests</span>
          <LegalContact />
          <Link href="/">Return to JobFlex <span aria-hidden>↗</span></Link>
        </footer>
      </main>
    </div>
  );
}
