// THE STUDIO'S INVENTORY (Home Design Studio, 2026-10-18 — owner: "inventory should be real"; the first ask was
// "doors, windows, appliances from inventory"). The shop's own products — the toilet, the vanity, the range, the
// sofa it actually sells: brand, model, its real size, its price and how many are on the shelf. A piece in a design
// can BE one of them: it takes the product's size (3D and plan follow), and the estimate supplies it at the shop's
// price, saying whether it's in stock or to order. The library piece stays the shape; the product is what's bought.
// Stored as the studio stores its other things (one SyncState row a shop), so no table. Pure.
import type { DesignItem } from "./model";
import { lib, LIBRARY, type LibEntry } from "./library";

export type DesignProduct = {
  id: string;
  /** The library piece it is: VAN, WC, REF, SOFA… */
  lib: string;
  brand: string;
  /** The maker's model or the supplier's SKU, as the shop writes it. */
  model: string;
  /** Its line or name ("Highline Classic"), optional. */
  name?: string;
  /** Inches: wide (along its front), deep, high. */
  w: number;
  d: number;
  h: number;
  /** Its finish, shown in 3D on the pieces that take a colour. */
  color?: string;
  /** What the shop charges for it, each (the product itself; setting it is the estimate's own line). */
  price: number | null;
  /** On the shelf now. */
  onHand: number;
  /** The supplier's page for it. */
  url?: string;
};

export const PRODUCTS_MAX = 300;

/** The pieces a shop can stock as products: everything but cabinets, which are built to size from the line. */
export const PRODUCT_PIECES: LibEntry[] = LIBRARY.filter((e) => e.cat !== "base" && e.cat !== "wall" && e.cat !== "tall" && e.cat !== "island");

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const num = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

/** One product from anything (a form, a stored row): what's usable kept, the rest dropped. Null when it can't be one. */
export function sanitizeProduct(raw: unknown, fallbackId?: string): DesignProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const e = typeof r.lib === "string" ? lib(r.lib) : undefined;
  if (!e || !PRODUCT_PIECES.includes(e)) return null;
  const brand = str(r.brand, 40);
  const model = str(r.model, 40);
  if (!brand && !model) return null;
  const id = typeof r.id === "string" && /^[\w-]{4,30}$/.test(r.id) ? r.id : fallbackId;
  if (!id || !/^[\w-]{4,30}$/.test(id)) return null;
  const price = r.price == null || r.price === "" ? null : num(r.price, 0, 1_000_000, NaN);
  const url = str(r.url, 300);
  const color = typeof r.color === "string" && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color.toLowerCase() : undefined;
  return {
    id,
    lib: e.id,
    brand,
    model,
    ...(str(r.name, 60) ? { name: str(r.name, 60) } : {}),
    w: Math.round(num(r.w, 1, 240, e.w) * 4) / 4,
    d: Math.round(num(r.d, 0.25, 120, e.d) * 4) / 4,
    h: Math.round(num(r.h, 0.25, 144, e.h) * 4) / 4,
    ...(color ? { color } : {}),
    price: price == null || Number.isNaN(price) ? null : Math.round(price * 100) / 100,
    onHand: Math.round(num(r.onHand, 0, 100000, 0)),
    ...(/^https?:\/\/\S+$/i.test(url) ? { url } : {}),
  };
}

export function sanitizeProducts(raw: unknown): DesignProduct[] {
  const seen = new Set<string>();
  const out: DesignProduct[] = [];
  for (const r of Array.isArray(raw) ? raw.slice(0, PRODUCTS_MAX) : []) {
    const p = sanitizeProduct(r);
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

/** The product as a person says it: "Kohler Highline · K-3999". */
export const productName = (p: Pick<DesignProduct, "brand" | "name" | "model">) => [[p.brand, p.name].filter(Boolean).join(" "), p.model].filter(Boolean).join(" · ");

/** The shop's products that are this piece. */
export const productsFor = (list: readonly DesignProduct[], libId: string) => list.filter((p) => p.lib === libId);

/** Whether the shelf covers what a design uses. */
export function stockWords(p: DesignProduct, need: number): string {
  if (p.onHand >= need) return p.onHand === need ? "in stock" : `in stock (${p.onHand} on the shelf)`;
  if (p.onHand > 0) return `${p.onHand} in stock, order ${need - p.onHand}`;
  return need === 1 ? "to order" : `order ${need}`;
}

/** A piece becomes the product: its size and finish, and which product it is (opts.product). */
export function applyProduct(it: DesignItem, p: DesignProduct | null): DesignItem {
  const opts = { ...(it.opts ?? {}) };
  if (!p) {
    delete opts.product;
    return { ...it, opts };
  }
  opts.product = p.id;
  if (p.color) opts.color = p.color;
  return { ...it, lib: p.lib, w: p.w, d: p.d, h: p.h, opts };
}

/** The product a piece is, if it's one of the shop's. */
export const productOf = (it: Pick<DesignItem, "opts">, list: readonly DesignProduct[]) => (typeof it.opts?.product === "string" ? list.find((p) => p.id === it.opts!.product) ?? null : null);
