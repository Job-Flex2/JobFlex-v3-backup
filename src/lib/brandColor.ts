// The shop's brand colour (Company → Branding, Organization.primaryColor) as the
// accent of the pages its client opens — the proposal page and its phone build.
//
// Whatever the shop picked, the accent has to stay readable: it colours text on
// the paper and on white sheets, and it is the background of the white-lettered
// Accept / Pay buttons. So a colour lighter than WCAG AA (4.5:1 against the
// paper, the darker of the two backgrounds) is darkened toward black just until
// it passes — a yellow becomes a deep gold, a navy is left exactly as it is.
// No colour set (or an unreadable value) = the page keeps JobFlex's blue.
//
// Pure — every output is rebuilt from parsed numbers, so it is safe to print
// into a <style> rule.

type Rgb = { r: number; g: number; b: number };

const PAPER: Rgb = { r: 0xf2, g: 0xf0, b: 0xeb };
const MIN_CONTRAST = 4.5;

export function parseHexColor(value: string | null | undefined): Rgb | null {
  const v = (value ?? "").trim();
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function luminance({ r, g, b }: Rgb): number {
  const ch = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function toward(c: Rgb, t: Rgb, k: number): Rgb {
  return { r: Math.round(c.r + (t.r - c.r) * k), g: Math.round(c.g + (t.g - c.g) * k), b: Math.round(c.b + (t.b - c.b) * k) };
}

const hex = ({ r, g, b }: Rgb) => "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
const rgba = ({ r, g, b }: Rgb, a: number) => `rgba(${r}, ${g}, ${b}, ${a})`;

export type BrandAccent = {
  /** Text, rules, and the primary buttons' background. */
  accent: string;
  /** Hover / pressed shade of the accent. */
  ink: string;
  /** 8% wash, 10% tint and 25% focus ring of the accent. */
  soft: string;
  tint: string;
  ring: string;
  /** True when the picked colour had to be darkened to stay readable. */
  adjusted: boolean;
};

export function brandAccent(primaryColor: string | null | undefined): BrandAccent | null {
  const picked = parseHexColor(primaryColor);
  if (!picked) return null;
  let c = picked;
  let step = 0;
  while (contrastRatio(c, PAPER) < MIN_CONTRAST && step < 20) {
    step += 1;
    c = toward(picked, { r: 0, g: 0, b: 0 }, step * 0.05);
  }
  return {
    accent: hex(c),
    ink: hex(toward(c, { r: 0, g: 0, b: 0 }, 0.28)),
    soft: rgba(c, 0.08),
    tint: rgba(c, 0.1),
    ring: rgba(c, 0.25),
    adjusted: step > 0,
  };
}

/**
 * The CSS that swaps JobFlex's blue for the shop's colour on a client page.
 * Set on :root because the phone build's payment sheet and accept bar are
 * portalled to <body>, outside the page's own wrapper.
 */
export function brandAccentCss(primaryColor: string | null | undefined): string | null {
  const a = brandAccent(primaryColor);
  if (!a) return null;
  return (
    // One notch more specific than the rules they override (globals' :root,
    // the pages' own `.jf-proposal-portal { --blueprint }`), whatever order
    // the stylesheets load in.
    `html:root{--accent:${a.accent};--accent-ink:${a.ink};--accent-soft:${a.soft};}` +
    `:root .jf-proposal-portal,:root .jf-mobile-proposal-client{--blueprint:${a.accent};--blueprint-dark:${a.ink};--blueprint-tint:${a.tint};--blueprint-ring:${a.ring};}`
  );
}
