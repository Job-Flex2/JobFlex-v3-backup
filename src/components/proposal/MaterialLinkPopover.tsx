"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink, X } from "lucide-react";
import { money } from "@/lib/format";
import { MaterialThumb } from "@/components/materials/MaterialThumb";
import { merchantUrl } from "@/lib/merchantLinks";
import type { MaterialLine } from "./MaterialsSheet";

const UNIT_LABEL: Record<string, string> = {
  SQFT: "sq ft",
  SQUARE: "square",
  LINEAR_FT: "linear ft",
  CUBIC_FT: "cu ft",
  UNIT: "unit",
  HOUR: "hour",
  LUMP_SUM: "lump sum",
  CU_YARD: "cu yd",
  SQ_YARD: "sq yd",
};

function formatQty(q: number): string {
  return Number.isInteger(q) ? String(q) : q.toFixed(2).replace(/\.?0+$/, "");
}

interface MaterialLinkPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorEl: HTMLElement | null;
  item: MaterialLine;
}

/**
 * A single material line doesn't earn the full "Order materials" sheet — this
 * is a small anchored popover with just that line and its buy link.
 */
export function MaterialLinkPopover({ open, onClose, anchorEl, item }: MaterialLinkPopoverProps) {
  const [coords, setCoords] = React.useState<{ top: number; right: number } | null>(null);

  React.useEffect(() => {
    if (!open || !anchorEl) return;
    const place = () => {
      const r = anchorEl.getBoundingClientRect();
      setCoords({ top: r.bottom + 6, right: window.innerWidth - r.right });
    };
    place();
    const onScroll = () => onClose();
    const onResize = () => place();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-material-popover]")) return;
      if (anchorEl.contains(target)) return;
      onClose();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open, anchorEl, onClose]);

  if (typeof document === "undefined") return null;

  const unit = UNIT_LABEL[item.measurementType] ?? item.measurementType.toLowerCase();
  const lineTotal = item.materialCost * item.quantity;
  const buyHref = merchantUrl(item.store, item.name, item.productUrl);

  return createPortal(
    <AnimatePresence>
      {open && coords && (
        <motion.div
          data-material-popover
          role="dialog"
          initial={{ opacity: 0, scale: 0.96, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -4 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          style={{ top: coords.top, right: coords.right }}
          className="fixed z-50 w-[300px] rounded-[var(--r-md)] bg-white/85 dark:bg-[#1a1a1d]/85 backdrop-blur-xl border border-[color:var(--ink-line)] shadow-[0_24px_48px_-20px_rgba(17,17,19,0.30),0_2px_8px_-2px_rgba(17,17,19,0.10)] p-3"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute right-2 top-2 h-6 w-6 grid place-items-center rounded-[var(--r-sm)] text-[color:var(--ink-muted)] hover:bg-black/[0.05] hover:text-[color:var(--ink)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>

          <div className="flex items-start gap-3 pr-6">
            <MaterialThumb src={item.imageUrl ?? null} alt={item.name} />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[13px] leading-snug text-[color:var(--ink)] truncate">
                {item.name}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-[color:var(--ink-muted)]">
                <span className="tabular">
                  Qty {formatQty(item.quantity)} {unit}
                </span>
                <span className="text-[color:var(--ink-faint)]">·</span>
                <span className="tabular">{money(lineTotal)}</span>
              </div>
            </div>
          </div>

          {buyHref ? (
            <a
              href={buyHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 flex h-9 items-center justify-center gap-1.5 rounded-[var(--r-md)] bg-[color:var(--accent)] px-3 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90"
            >
              {item.store ? `Buy at ${item.store}` : "View product"}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : (
            <p className="mt-3 text-[11px] text-[color:var(--ink-muted)]">
              No supplier link on this line.
            </p>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
