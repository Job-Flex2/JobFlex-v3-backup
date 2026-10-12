import Image from "next/image";
import "./product-mark.css";

/* THE PRODUCT MARK ON THE SIGN-IN PAGES (owner, 2026-10-12): the real mark —
   /jobflex-mark.png, the asset the dashboard sidebar (blueprint-shell/sidebar,
   "The real product mark") and the landing (landing-e/logo) draw — in place of
   the drawn "J" square the auth pages carried. One component for register,
   login, forgot, reset, invite, worker invite and the phone login.

   The asset is mostly transparent margin, so the box clips it and the image is
   pulled up by the asset's own top inset — the sidebar's and the landing's
   geometry (ink box = 0.3462 × 0.4253 of the image). Sized by its INK HEIGHT,
   `--pmark-h` (product-mark.css), so a page sets the same number it gave the
   old square. `tone="paper"` is for a dark band (the phone login's hero). */
export function ProductMark({ tone = "ink", className = "" }: { tone?: "ink" | "paper"; className?: string }) {
  return (
    <span className={"jf-pmark" + (tone === "paper" ? " jf-pmark--paper" : "") + (className ? ` ${className}` : "")} aria-hidden="true">
      <Image className="jf-pmark-img" src="/jobflex-mark.png" alt="" width={108} height={108} priority />
    </span>
  );
}
