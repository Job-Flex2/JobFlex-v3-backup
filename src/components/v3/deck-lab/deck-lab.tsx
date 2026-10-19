"use client";

// Deck Lab index (2026-10-18): one row per variant — its number, its bet in a
// line, and Open. The old studio is listed last as the baseline. Plain
// stylesheet under one root class (CLAUDE.md / DESIGN.md).
//
// The owner chose Variant 1 the same day: it IS /dashboard/deck-estimator now
// (/dashboard/deck-v1 redirects there), and the old studio is retired — its
// code kept, unmounted (deck-estimator-blueprint/deck-studio.tsx).

import Link from "next/link";
import type { Route } from "next";
import "./deck-lab.css";

type Entry = { href: string | null; tag: string; name: string; bet: string };

const BASELINE: Entry = {
  href: null,
  tag: "Old",
  name: "The old deck studio — retired",
  bet: "Replaced by Variant 1 on 2026-10-18. Its code is kept, no longer on any page.",
};

const VARIANTS: Entry[] = [
  { href: "/dashboard/deck-estimator", tag: "1", name: "One decision at a time — Chosen, now the live deck estimator", bet: "A guided build: one question per screen, Next and Back, the 3D pinned beside it." },
  { href: "/dashboard/deck-v2", tag: "2", name: "The deck is the interface", bet: "Work on the drawing: drag to size, click a part to set it, price bar always at the bottom." },
  { href: "/dashboard/deck-v3", tag: "3", name: "A builder's spec sheet", bet: "One construction sheet: every field in ruled sections, drawing and price in a sticky column." },
  { href: "/dashboard/deck-v4", tag: "4", name: "The price is the point", bet: "Leads with the number and the material package; every choice shows what it adds." },
  { href: "/dashboard/deck-v5", tag: "5", name: "Start from the deck people ask for", bet: "Pick a deck kind from pictures, change the few things that usually change, the rest under More." },
];

function Row({ e, primary }: { e: Entry; primary: boolean }) {
  return (
    <li className="dl-row">
      <span className="dl-tag" aria-hidden="true">{e.tag}</span>
      <div className="dl-text">
        <span className="dl-name">{e.name}</span>
        <span className="dl-bet">{e.bet}</span>
      </div>
      {e.href ? (
        <Link href={e.href as Route} className={`dl-btn${primary ? " dl-btn--primary" : ""}`}>
          Open
        </Link>
      ) : (
        <span className="dl-btn dl-btn--off">Retired</span>
      )}
    </li>
  );
}

export function DeckLab() {
  return (
    <div className="jf-deck-lab" data-nest>
      <header className="dl-head">
        <h1 className="dl-title">Deck Lab</h1>
        <p className="dl-sub">Five designs of the deck estimator. Variant 1 was chosen and is the live deck estimator; the others stay here to look at.</p>
      </header>
      <ul className="dl-list">
        {VARIANTS.map((e) => (
          <Row key={e.tag} e={e} primary />
        ))}
      </ul>
      <ul className="dl-list dl-list--base">
        <Row e={BASELINE} primary={false} />
      </ul>
    </div>
  );
}
