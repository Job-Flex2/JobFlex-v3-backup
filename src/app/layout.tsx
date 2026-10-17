import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import localFont from "next/font/local";
import "./globals.css";
import { ToastHostLazy } from "@/components/ui/toast-host-lazy";
import { AttributionCapture } from "@/components/attribution-capture";
import { PostHogCapture } from "@/components/providers/posthog-capture";
import { MetaPixel } from "@/components/providers/meta-pixel";
import { CookieBanner } from "@/components/consent/cookie-banner";

/* Bundle the official variable fonts so local and production builds never
   depend on a Google Fonts request. Keep the complete weight ranges and
   character sets; licenses and sources live alongside the font files.
   Served as WOFF2 (2026-10-16): the same fonts losslessly recompressed —
   every glyph, axis and character kept — 351 KB + 72 KB on the wire instead
   of 448 KB + 92 KB of TTF. Both are preloaded on every page, so on a phone
   they shared the line with the sign-up form's script. The .ttf originals
   stay beside them (README). */
const inter = localFont({
  src: "./fonts/Inter-variable.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-inter",
  display: "swap",
});

const jbMono = localFont({
  src: "./fonts/JetBrainsMono-variable.woff2",
  weight: "100 800",
  style: "normal",
  adjustFontFallback: false,
  variable: "--font-jbmono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "JobFlex — CRM · AI Estimating · Proposals for contractors",
  description:
    "The modern operating system for contractors. AI-powered proposals, lead pipelines, scheduling, and client portals.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  // The icons are files (2026-10-01, scripts/brand-icons.mjs): app/favicon.ico,
  // app/icon.png 512², app/icon1.png 192², app/apple-icon.png 180² — Next writes their <link>s
  // with type and sizes; app/manifest.ts lists the home-screen set.
};

export const viewport: Viewport = {
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the landing hero's inline prelude sets
    // data-lp-entrance on <html> before React hydrates (landing-e/hero.tsx
    // ENTRANCE_PRELUDE) — on purpose, desk-width only. Covers <html>'s own
    // attributes, nothing below it.
    <html lang="en" className={`${inter.variable} ${jbMono.variable}`} suppressHydrationWarning>
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
          data-gr-* attributes on <body> before React hydrates — benign mismatch. */}
      {/* No `antialiased`: default subpixel rendering keeps text crisper
          (sharpness pass, owner 2026-08-18). Smoothing is set once, in
          globals.css (html, body). */}
      <body className="min-h-dvh" suppressHydrationWarning>
        <div className="relative z-10">{children}</div>
        {/* Root layout is the one shell every public entry page shares — the
            ?promo/?ref capture must live here to cover them all. Renders null. */}
        <Suspense fallback={null}>
          <AttributionCapture />
        </Suspense>
        {/* Sends the $pageview events that /admin/traffic reads back. Renders
            null and no-ops entirely when NEXT_PUBLIC_POSTHOG_KEY is unset. */}
        <Suspense fallback={null}>
          <PostHogCapture />
        </Suspense>
        {/* Meta Pixel: only with NEXT_PUBLIC_META_PIXEL_ID, and only while
            marketing is allowed (lib/consent: the record, else the country);
            the standard PageView on the landing, /pricing and register. */}
        <Suspense fallback={null}>
          <MetaPixel />
        </Suspense>
        {/* Opens by itself only in the opt-in countries while no choice is
            recorded; the footer's "Cookie settings" opens it for everyone. */}
        <CookieBanner />
        <ToastHostLazy />
      </body>
    </html>
  );
}
