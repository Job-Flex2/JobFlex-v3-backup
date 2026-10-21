"use client";

// ORDER MATERIALS — the shoppable list behind the proposals row menu.
//
// Hand-rolled dialog in the blueprint vocabulary, not the shared `Sheet`
// primitive: this is opened from the proposals blueprint page (as a React
// island) and the generic right-hand drawer read as a component-library panel
// arriving over a hand-drawn page. House rule — modals here are hand-rolled.
// Styling lives in ./materials-sheet.css under a `.jf-mat` root; see the note
// at the top of that file for why it is plain CSS rather than a module.
//
// Behaviour is unchanged from the drawer it replaces: same props, same lines,
// same merchantUrl() link fix, same clipboard payload. What is new is Escape,
// a scroll lock, a focus trap and a backdrop click — the drawer only had
// Escape.
import * as React from "react";
import { createPortal } from "react-dom";
import { Copy, Package, ExternalLink, X } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { money } from "@/lib/format";
import { MaterialThumb } from "@/components/materials/MaterialThumb";
import { merchantUrl } from "@/lib/merchantLinks";
import { lockScroll } from "@/lib/scrollLock";
import "./materials-sheet.css";

export interface MaterialLine {
  id: string;
  name: string;
  description?: string | null;
  measurementType: string;
  quantity: number;
  materialCost: number;
  // Live-pricing product data, present on AI-estimated materials. Optional so
  // non-estimate callers (e.g. a single editor line) still type-check and just
  // render without a thumbnail or buy link.
  store?: string | null;
  productUrl?: string | null;
  imageUrl?: string | null;
  dimensions?: string | null;
}

const UNIT_LABEL: Record<string, string> = {
  SQFT: "sq ft",
  SQUARE: "square",
  LINEAR_FT: "linear ft",
  CUBIC_FT: "cu ft",
  UNIT: "unit",
  HOUR: "hour",
  LUMP_SUM: "lump sum",
  EACH: "each",
  SHEET: "sheet",
  BUNDLE: "bundle",
  ROLL: "roll",
  BOX: "box",
  BAG: "bag",
  PIECE: "piece",
  GALLON: "gallon",
  TON: "ton",
  SET: "set",
  BUCKET: "bucket",
  TUBE: "tube",
  CU_YARD: "cu yd",
  SQ_YARD: "sq yd",
};

/** Whole number when it is one, else trimmed to 2 decimals. */
function formatQty(q: number): string {
  return Number.isInteger(q) ? String(q) : q.toFixed(2).replace(/\.?0+$/, "");
}

interface MaterialsSheetProps {
  open: boolean;
  onClose: () => void;
  proposalTitle: string;
  clientName: string;
  items: MaterialLine[];
}

export function MaterialsSheet({
  open,
  onClose,
  proposalTitle,
  clientName,
  items,
}: MaterialsSheetProps) {
  const lines = items
    .filter((i) => (i.materialCost ?? 0) > 0 && i.quantity > 0)
    .map((i) => ({
      ...i,
      lineTotal: i.materialCost * i.quantity,
      unit: UNIT_LABEL[i.measurementType] ?? i.measurementType.toLowerCase(),
      // Render-time link fix: a real merchant link is kept, a Google/empty one
      // is swapped for a direct on-site search at the named store.
      buyHref: merchantUrl(i.store, i.name, i.productUrl),
    }));
  const grandTotal = lines.reduce((a, l) => a + l.lineTotal, 0);
  const shoppable = lines.filter((l) => l.buyHref).length;

  const plainText = React.useMemo(() => {
    const header = `Materials list — ${proposalTitle} (${clientName})\n${"".padEnd(60, "─")}\n`;
    const body = lines
      .map(
        (l) =>
          `${l.name.padEnd(36)} ${String(l.quantity).padStart(6)} × ${l.unit.padEnd(10)}  ${money(l.materialCost).padStart(8)}/u  ${money(l.lineTotal).padStart(10)}`,
      )
      .join("\n");
    const footer = `\n${"".padEnd(60, "─")}\nMaterials total: ${money(grandTotal)}`;
    return header + body + footer;
  }, [lines, grandTotal, proposalTitle, clientName]);

  function copyList() {
    navigator.clipboard?.writeText(plainText);
    toast.success("Copied to clipboard", "Paste into Slack, an email, or a supplier portal.");
  }

  // Escape, scroll lock, focus in, Tab trap. Reference-counted lock so a sheet
  // opened over another surface cannot leave the page unscrollable.
  const boxRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const release = lockScroll();
    const restore = document.activeElement as HTMLElement | null;
    boxRef.current?.focus();
    const SELECTOR =
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const node = boxRef.current;
      if (!node) return;
      const list = Array.from(node.querySelectorAll<HTMLElement>(SELECTOR));
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      release();
      restore?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    // Portalled to <body>: the blueprint shell transforms its content column,
    // and a transformed ancestor becomes the containing block for
    // `position: fixed` — hosted inside it, the backdrop would cover the column
    // and slide under the topbar.
    <div
      className="jf-mat"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="jf-mat-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="jfMatTitle"
        tabIndex={-1}
        ref={boxRef}
      >
        <div className="jf-mat-head">
          <div className="min-w-0">
            <div className="jf-mat-kicker">Order materials</div>
            <div className="jf-mat-h" id="jfMatTitle">
              {proposalTitle}
            </div>
            <div className="jf-mat-sub">{clientName}</div>
          </div>
          <button className="jf-mat-x" type="button" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="jf-mat-body">
          {lines.length === 0 ? (
            <div className="jf-mat-empty">
              <Package className="h-5 w-5 shrink-0" aria-hidden="true" />
              <div>
                <div className="jf-mat-empty-t">No materials on this proposal</div>
                <p className="jf-mat-empty-p">
                  Add Material $/unit values to line items in the editor. Lines with $0 material
                  cost are excluded automatically.
                </p>
              </div>
            </div>
          ) : (
            <>
              <ul className="jf-mat-list">
                {lines.map((l) => (
                  <li className="jf-mat-row" key={l.id}>
                    <MaterialThumb src={l.imageUrl ?? null} alt={l.name} />

                    <div className="min-w-0">
                      <div className="jf-mat-n">{l.name}</div>
                      <div className="jf-mat-meta">
                        {(l.dimensions || l.description) && (
                          <span className="jf-mat-dim">{l.dimensions || l.description}</span>
                        )}
                        <span>
                          Qty {formatQty(l.quantity)} {l.unit}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{money(l.materialCost)}/unit</span>
                        {l.store ? (
                          <span className="jf-mat-store">{l.store}</span>
                        ) : (
                          <span className="jf-mat-nolink">no retail source</span>
                        )}
                      </div>
                    </div>

                    <div className="jf-mat-v">{money(l.lineTotal)}</div>

                    {l.buyHref && (
                      <a
                        className="jf-mat-buy"
                        href={l.buyHref}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        {l.store ? `Buy at ${l.store}` : "View product"}
                      </a>
                    )}
                  </li>
                ))}
              </ul>

              <p className="jf-mat-note">
                Totals reflect <em>base</em> material costs only — markups, overhead and profit
                live in the proposal&apos;s Estimate breakdown. Each store link jumps straight to
                the item at that retailer.
              </p>
            </>
          )}
        </div>

        <div className="jf-mat-foot">
          <div className="min-w-0">
            <div className="jf-mat-kicker">Materials total</div>
            <div className="jf-mat-total">{money(grandTotal)}</div>
            <div className="jf-mat-count">
              {lines.length} item{lines.length === 1 ? "" : "s"}
              {shoppable > 0 ? ` · ${shoppable} shoppable` : ""}
            </div>
          </div>
          <button
            className="jf-mat-copy"
            type="button"
            onClick={copyList}
            disabled={lines.length === 0}
          >
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            Copy list
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
