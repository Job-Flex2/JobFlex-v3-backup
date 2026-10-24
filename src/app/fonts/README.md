# Bundled application fonts

These are the official variable fonts from the Google Fonts repository,
downloaded September 23, 2026. Keeping them in source makes Next.js font
generation independent of Google's availability during builds.

- Inter: `https://github.com/google/fonts/tree/main/ofl/inter` — weight 100–900,
  optical size 14–32. Original file: `Inter[opsz,wght].ttf`.
- JetBrains Mono: `https://github.com/google/fonts/tree/main/ofl/jetbrainsmono`
  — weight 100–800. Original file: `JetBrainsMono[wght].ttf`.

Both use the SIL Open Font License 1.1. Their original license notices are
included in this directory. Root layout retains the existing CSS variables.

The app loads `Inter-variable-latin.woff2` and `JetBrainsMono-variable-latin.woff2`
(2026-10-23, owner: latin only): the `.ttf` beside each, cut to Google Fonts'
latin + latin-ext ranges plus the symbols the source uses that the font draws
(arrows, ≤ ≥ ≈, ✓ ★, ▲ ▼ ▶, fractions), every axis and OpenType feature kept,
saved as WOFF2 — 213 KB + 48 KB, was 351 KB + 72 KB for the whole fonts.
Cyrillic and Greek fall to the system font. Regenerate after replacing a
`.ttf`, or when the interface starts using a new symbol:
`python scripts/font-subset.py` (needs `fonttools` and `brotli`).
