import { brandAccentCss } from "@/lib/brandColor";

/**
 * The shop's brand colour as the accent of a client page (lib/brandColor).
 * Rendered OUTSIDE the page's viewport switch, so it applies to whichever of
 * the desktop / handheld trees is mounted, and to their portalled sheets.
 * Nothing is printed when the shop has no colour set — the page keeps JobFlex's blue.
 */
export function BrandAccentStyle({ color }: { color: string | null | undefined }) {
  const css = brandAccentCss(color);
  return css ? <style data-brand-accent="">{css}</style> : null;
}
