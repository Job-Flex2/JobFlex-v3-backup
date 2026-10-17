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

The app loads the `.woff2` files (2026-10-16): each is the `.ttf` beside it
recompressed with fontTools (`flavor = "woff2"`), lossless — same glyph count,
axes and character map. Regenerate after replacing a `.ttf`:
`python -c "from fontTools.ttLib import TTFont; f=TTFont('X.ttf'); f.flavor='woff2'; f.save('X.woff2')"`
(needs `fonttools` and `brotli`).
