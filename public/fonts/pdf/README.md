# Proposal PDF fonts

Static cuts of the two app fonts in `src/app/fonts/`, for the proposal file
that card 11 (The PDF) builds in the browser with `@react-pdf/renderer`, which
cannot choose a weight on a variable font. Fetched only when Download PDF is
pressed.

- `Inter-400/600/800.ttf` — wght 400/600/800 at opsz 14. The digits 0–9 are
  mapped to Inter's tabular figures in the cmap, so every amount lines up in a
  column (react-pdf does not switch on OpenType features).
- `JetBrainsMono-600.ttf` — wght 600, for the small uppercase labels.

Subset to Latin, Latin Extended, Vietnamese, Greek, Cyrillic, punctuation,
currency, arrows and math symbols; hinting dropped. SIL Open Font License 1.1
(notices beside them). Regenerate from the `.ttf` originals with fontTools:
instantiate the axes (`fontTools.varLib.instancer`), remap the digits through
the `tnum` lookup, subset (`fontTools.subset`, `hinting = False`).
