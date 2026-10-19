// The sheet's class names (variant 3). The studio copied from deck-studio.tsx names its parts `s.field`, `s.btn`, …;
// here every such name becomes the plain class `d3-field`, `d3-btn`, … that deck-variant-3.css styles under its one
// root, `.jf-deck-v3` — no CSS module, so nothing is hashed and the rules stay addressable (DESIGN.md, the
// "css-modules-break-blueprint-ports" lesson).
export const d3: Readonly<Record<string, string>> = new Proxy({} as Record<string, string>, {
  get: (_t, key) => (typeof key === "string" ? `d3-${key}` : undefined),
});
