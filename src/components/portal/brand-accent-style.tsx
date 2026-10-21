/**
 * The shop's brand colour as the accent of a client page (lib/brandColor) — SWITCHED OFF (owner, 2026-10-20).
 *
 * From 2026-10-12 this printed a style that swapped JobFlex's blue for the colour picked in Company → Branding, so a
 * shop that had chosen violet saw a purple Accept button, purple totals and purple links on the client's proposal
 * page. The owner asked for the buttons "back to blue": the client pages keep JobFlex's blue whatever Branding holds.
 * The logo still shows. To bring the shop's colour back, print the style again:
 *   const css = brandAccentCss(color); return css ? <style data-brand-accent="">{css}</style> : null;
 */
export function BrandAccentStyle(props: { color: string | null | undefined }) {
  void props.color;
  return null;
}
