"use client";

// THE WEBSITE ESTIMATORS ON THE SUBSCRIPTION PAGE (2026-10-27): the lines the shop holds — each trade at the price
// it was bought at, since when — and the way to the switches (Settings → Website estimators). Drawn only when a line
// is held: the Subscription page sells nothing. Same cloth as the Deck Studio card (deck-addon.module.css).
import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { getWebAddonLines } from "@/actions/webEstimator";
import { webAddonPriceWords } from "@/lib/webAddon";
import s from "@/components/v3/deck-addon/deck-addon.module.css";

type Lines = Extract<Awaited<ReturnType<typeof getWebAddonLines>>, { ok: true }>["lines"];
const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "");

export function WebAddonCard() {
  const [lines, setLines] = React.useState<Lines | null>(null);
  React.useEffect(() => {
    let alive = true;
    void getWebAddonLines().then((r) => { if (alive && r.ok) setLines(r.lines); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!lines || !lines.length) return null;
  const total = lines.reduce((n, l) => n + l.cents, 0);
  return (
    <section className={`${s.da} ${s.card}`} aria-label="Website estimators" data-web-addon-card>
      <div className={s.cardHead}>
        <h3 className={s.cardTitle}>Website estimators</h3>
        <span className={`${s.cardState} ${s.cardOn}`} data-web-addon-state>
          On your plan · {webAddonPriceWords(total, lines[0].interval, true)}
        </span>
      </div>
      <ul className={s.note} style={{ margin: 0, paddingLeft: 18 }} data-web-addon-lines>
        {lines.map((l) => (
          <li key={l.trade}>
            {l.name} — {webAddonPriceWords(l.cents, l.interval)}{l.since ? ` since ${day(l.since)}` : ""}
          </li>
        ))}
      </ul>
      <p className={s.note}>Each one is a line on this subscription: one bill, one card. Turn a trade off under Settings → Website estimators and its line comes off, the unused days a credit on your next bill.</p>
      <div className={s.acts}>
        <Link className={`${s.btn} ${s.btnQuiet}`} href={"/dashboard/settings?pane=website" as Route}>Manage website estimators</Link>
      </div>
    </section>
  );
}
