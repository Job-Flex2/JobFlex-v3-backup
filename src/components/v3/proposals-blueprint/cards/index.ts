// Registry of the All-list card variants (see card-kit.ts). Each variant owns its .ts and its .css, scoped
// under `.content[data-card="<letter>"]`, which the behavior stamps when the URL asks for that letter.
// a–c: first round (2026-10-30); d–f: from-scratch round, same day.

import type { CardRenderer } from "./card-kit";
import { renderCardA } from "./card-a";
import { renderCardB } from "./card-b";
import { renderCardC } from "./card-c";
import { renderCardD } from "./card-d";
import { renderCardE } from "./card-e";
import { renderCardF } from "./card-f";
import "./card-a.css";
import "./card-b.css";
import "./card-c.css";
import "./card-d.css";
import "./card-e.css";
import "./card-f.css";

export const CARD_RENDERERS: Record<string, CardRenderer> = {
  a: renderCardA,
  b: renderCardB,
  c: renderCardC,
  d: renderCardD,
  e: renderCardE,
  f: renderCardF,
};

export type { CardKit, CardRenderer } from "./card-kit";
