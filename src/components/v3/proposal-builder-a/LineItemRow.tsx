"use client";
import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Trash2, GripVertical, ChevronDown, Package } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  useProposalDraftStore,
  type DraftLineItem,
} from "@/stores/useProposalDraftStore";
import { money } from "@/lib/format";
import { sellUnitPrice } from "@/lib/pricing/markup";
import { cn } from "@/lib/cn";
import { RatioSlider } from "@/components/proposal/RatioSlider";
import { MaterialLinkPopover } from "@/components/proposal/MaterialLinkPopover";
import { OverflowTooltip } from "./OverflowTooltip";

// Units mirror the live builder one-for-one — only presentation changes.
const MEASUREMENT_OPTIONS: {
  value: DraftLineItem["measurementType"];
  label: string;
}[] = [
  { value: "SQFT", label: "Sq ft" },
  { value: "SQUARE", label: "Square" },
  { value: "LINEAR_FT", label: "Linear ft" },
  { value: "CUBIC_FT", label: "Cubic ft" },
  { value: "UNIT", label: "Unit" },
  { value: "EACH", label: "Each" },
  { value: "HOUR", label: "Hour" },
  { value: "LUMP_SUM", label: "Lump sum" },
  // What a material is bought in (2026-10-21).
  { value: "SHEET", label: "Sheets" },
  { value: "BUNDLE", label: "Bundles" },
  { value: "ROLL", label: "Rolls" },
  { value: "BOX", label: "Boxes" },
  { value: "BAG", label: "Bags" },
  { value: "PIECE", label: "Pieces" },
  { value: "GALLON", label: "Gallons" },
  { value: "BUCKET", label: "Buckets" },
  { value: "TUBE", label: "Tubes" },
  { value: "SET", label: "Sets" },
  { value: "TON", label: "Tons" },
  { value: "CU_YARD", label: "Cubic yd" },
  { value: "SQ_YARD", label: "Sq yd" },
];

const cents = (n: number) => Math.round(n * 100);

export function LineItemRow({ item }: { item: DraftLineItem }) {
  const update = useProposalDraftStore((s) => s.updateLine);
  const remove = useProposalDraftStore((s) => s.removeLine);
  const draft = useProposalDraftStore((s) => s.draft);
  const [expanded, setExpanded] = React.useState(false);
  const [materialsOpen, setMaterialsOpen] = React.useState(false);
  const materialsBtnRef = React.useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();

  // perUnit = raw cost (drives the material/labor ratio %). `unit` is the
  // client-facing SELL price (cost + hidden markup; equals cost at 0%).
  const perUnit = (item.materialCost ?? 0) + (item.laborCost ?? 0);
  const unit = sellUnitPrice(item, {
    materialMarkupPct: draft.materialMarkupPct ?? 0,
    laborMarkupPct: draft.laborMarkupPct ?? 0,
  });
  const total = item.quantity * unit;

  const handleMaterial = (v: number) => {
    const mat = isNaN(v) ? 0 : v;
    update(item.id, {
      materialCost: mat,
      unitPrice: mat + (item.laborCost ?? 0),
    });
  };
  const handleLabor = (v: number) => {
    const lab = isNaN(v) ? 0 : v;
    update(item.id, {
      laborCost: lab,
      unitPrice: (item.materialCost ?? 0) + lab,
    });
  };
  const handleRatio = ({
    materialCost,
    laborCost,
  }: {
    materialCost: number;
    laborCost: number;
  }) => {
    update(item.id, {
      materialCost,
      laborCost,
      unitPrice: materialCost + laborCost,
    });
  };
  const materialPct =
    perUnit > 0 ? ((item.materialCost ?? 0) / perUnit) * 100 : 50;

  // Collapse duplicate price: only show the per-unit figure when it differs
  // from the row total (i.e. quantity ≠ 1). Identical → show once.
  const showUnitLine = cents(total) !== cents(unit);

  return (
    <div
      className={cn(
        "rounded-[var(--r-md)] bg-white/50 hairline transition-shadow",
        "focus-within:shadow-[0_0_0_3px_rgba(31,122,82,0.18)]",
      )}
    >
      <div className="flex items-center gap-2.5 p-3">
        <GripVertical className="h-4 w-4 shrink-0 text-[color:var(--ink-faint)]" />

        <OverflowTooltip text={item.name} className="flex-1">
          <Input
            placeholder="Line item name"
            value={item.name}
            onChange={(e) => update(item.id, { name: e.target.value })}
          />
        </OverflowTooltip>

        <div className="w-[116px] shrink-0">
          <Select
            value={item.measurementType}
            onChange={(e) =>
              update(item.id, {
                measurementType: e.target
                  .value as DraftLineItem["measurementType"],
              })
            }
          >
            {MEASUREMENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-[96px] shrink-0">
          <Input
            type="number"
            step="0.01"
            aria-label="Quantity"
            value={item.quantity}
            onChange={(e) =>
              update(item.id, { quantity: Number(e.target.value) })
            }
          />
        </div>

        <div className="w-[124px] shrink-0 text-right leading-tight">
          <div className="font-display text-[15px] tabular tracking-[-0.01em] text-[color:var(--ink)]">
            {money(total)}
          </div>
          {showUnitLine && (
            <div className="mt-0.5 text-[11px] tabular text-[color:var(--ink-faint)]">
              {money(unit)} / ea
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            ref={materialsBtnRef}
            type="button"
            onClick={() => setMaterialsOpen((v) => !v)}
            aria-label="View materials for this line"
            title="Materials for this line"
            className="grid h-8 w-8 place-items-center rounded-[var(--r-sm)] text-[color:var(--ink-muted)] transition-colors hover:bg-black/[0.04] hover:text-[color:var(--ink)] focus-ring"
          >
            <Package className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setExpanded((x) => !x)}
            aria-label={expanded ? "Hide cost breakdown" : "Show cost breakdown"}
            aria-expanded={expanded}
            className={cn(
              "grid h-8 w-8 place-items-center rounded-[var(--r-sm)] text-[color:var(--ink-muted)] transition-all hover:bg-black/[0.04]",
              expanded && "rotate-180 bg-black/[0.04]",
            )}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => remove(item.id)}
            aria-label="Remove line item"
            className="grid h-8 w-8 place-items-center rounded-[var(--r-sm)] text-[color:var(--ink-muted)] transition-colors hover:bg-rose-50 hover:text-[color:var(--rose)] focus-ring"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              duration: reduceMotion ? 0 : 0.26,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="overflow-hidden border-t border-[color:var(--ink-line)]"
          >
            <div className="px-3 pb-4 pt-3.5">
              <div className="mb-3.5">
                <Input
                  label="Description"
                  placeholder="Optional — appears under the name on the proposal"
                  value={item.description ?? ""}
                  onChange={(e) =>
                    update(item.id, { description: e.target.value })
                  }
                />
              </div>

              <div className="quiet-caps mb-2">Cost breakdown · per unit</div>
              <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
                <Input
                  label="Material $/unit"
                  type="number"
                  step="0.01"
                  prefix={<span className="text-[11px]">$</span>}
                  value={item.materialCost ?? 0}
                  onChange={(e) => handleMaterial(Number(e.target.value))}
                />
                <Input
                  label="Labor $/unit"
                  type="number"
                  step="0.01"
                  prefix={<span className="text-[11px]">$</span>}
                  value={item.laborCost ?? 0}
                  onChange={(e) => handleLabor(Number(e.target.value))}
                />
                <div className="w-[132px] rounded-[var(--r-md)] bg-[color:var(--paper-deep)] px-3 py-2 hairline">
                  <div className="quiet-caps">Per unit</div>
                  <div className="mt-0.5 font-display text-[19px] tabular tracking-[-0.01em]">
                    {money(perUnit)}
                  </div>
                </div>
              </div>

              <div className="mt-4 border-t border-[color:var(--ink-line)] pt-3">
                <div className="quiet-caps mb-2">Material / labor ratio</div>
                <RatioSlider
                  total={perUnit}
                  materialPct={materialPct}
                  onChange={handleRatio}
                />
              </div>

              <div className="mt-3.5 flex items-start gap-2 border-t border-[color:var(--ink-line)] pt-3">
                <Package className="mt-[2px] h-3.5 w-3.5 shrink-0 text-[color:var(--ink-faint)]" />
                <p className="text-[10.5px] leading-relaxed text-[color:var(--ink-muted)]">
                  The Materials view for this line shows its base material cost
                  only — JobFlex doesn&apos;t store itemized material records
                  per line yet. Markups, overhead, and profit live in the
                  Estimate breakdown below.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* A single line doesn't earn the full Order-materials sheet — a small
          anchored popover with the line + its buy link (when one resolves). */}
      <MaterialLinkPopover
        open={materialsOpen}
        onClose={() => setMaterialsOpen(false)}
        anchorEl={materialsBtnRef.current}
        item={{
          id: item.id,
          name: item.name || "Unnamed line",
          description: item.description ?? null,
          measurementType: item.measurementType,
          quantity: item.quantity,
          materialCost: item.materialCost ?? 0,
          store: item.store ?? null,
          productUrl: item.productUrl ?? null,
          imageUrl: item.imageUrl ?? null,
          dimensions: item.dimensions ?? null,
        }}
      />
    </div>
  );
}
