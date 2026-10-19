"use client";
// THE STUDIO'S INVENTORY PAGE (Home Design Studio, 2026-10-18 — owner: "inventory should be real"). The products the
// shop actually sells — brand, model, its real size, the shop's price, how many are on the shelf, the supplier's page.
// A piece in a design can be one of them (the Add list and the piece's card offer them); the estimate supplies it at
// this price and says whether it's in stock. Under the studio, as each JobFlex inventory sits under its estimator.
import * as React from "react";
import Link from "next/link";
import s from "./design-studio.module.css";
import { lib, type LibCat } from "@/lib/design/library";
import { PRODUCT_PIECES, productName, type DesignProduct } from "@/lib/design/inventory";
import { deleteDesignProduct, saveDesignProduct } from "@/actions/designStudio";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n >= 1000 ? 0 : 2 });

const GROUPS: Array<{ cat: LibCat; label: string }> = [
  { cat: "fixture", label: "Bath & laundry" },
  { cat: "appliance", label: "Appliances" },
  { cat: "light", label: "Lights" },
  { cat: "furniture", label: "Furniture" },
  { cat: "decor", label: "Decor" },
];

type Draft = { id?: string; lib: string; brand: string; model: string; name: string; w: string; d: string; h: string; color: string; price: string; onHand: string; url: string };

const blank = (libId = "VAN"): Draft => {
  const e = lib(libId);
  return { lib: libId, brand: "", model: "", name: "", w: String(e?.w ?? 24), d: String(e?.d ?? 24), h: String(e?.h ?? 30), color: "", price: "", onHand: "0", url: "" };
};
const draftOf = (p: DesignProduct): Draft => ({ id: p.id, lib: p.lib, brand: p.brand, model: p.model, name: p.name ?? "", w: String(p.w), d: String(p.d), h: String(p.h), color: p.color ?? "", price: p.price == null ? "" : String(p.price), onHand: String(p.onHand), url: p.url ?? "" });

export function DesignInventory({ initial }: { initial: DesignProduct[] }) {
  const [products, setProducts] = React.useState(initial);
  const [draft, setDraft] = React.useState<Draft>(blank());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [find, setFind] = React.useState("");
  const formRef = React.useRef<HTMLFormElement>(null);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const pick = (libId: string) => {
    const e = lib(libId);
    // A new kind of piece starts from that piece's standard size.
    setDraft((d) => ({ ...d, lib: libId, ...(d.id ? {} : { w: String(e?.w ?? d.w), d: String(e?.d ?? d.d), h: String(e?.h ?? d.h) }) }));
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const res = await saveDesignProduct({ ...draft, w: Number(draft.w), d: Number(draft.d), h: Number(draft.h), onHand: Number(draft.onHand || 0), price: draft.price.trim() === "" ? null : Number(draft.price), color: draft.color || undefined });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setProducts(res.products);
    setDraft(blank(draft.lib));
  };
  const remove = async (p: DesignProduct) => {
    if (!window.confirm(`Remove ${productName(p)} from the inventory? Designs that use it keep the piece, without the product.`)) return;
    const res = await deleteDesignProduct(p.id);
    if (res.ok) setProducts(res.products);
    else setError(res.error);
  };
  const stock = async (p: DesignProduct, delta: number) => {
    const res = await saveDesignProduct({ ...p, onHand: Math.max(0, p.onHand + delta) });
    if (res.ok) setProducts(res.products);
    else setError(res.error);
  };

  const q = find.trim().toLowerCase();
  const shown = products.filter((p) => !q || `${productName(p)} ${lib(p.lib)?.name ?? ""}`.toLowerCase().includes(q));
  const e = lib(draft.lib);

  return (
    <div className={s.studio} data-design-inventory>
      <header className={s.pageHead}>
        <div>
          <div className={s.kicker}>
            Home Design Studio · Inventory <span className={s.adminNote}>Admin preview</span>
          </div>
          <h1 className={s.pageTitle}>Your products</h1>
          <p className={s.pageSub}>
            The toilets, vanities, appliances and furniture you actually sell — brand, model, the real size, your price, how many are on the shelf. In a design a piece can be one of them: it takes the product&apos;s size, and the estimate supplies it at your price, in stock or to order.
          </p>
        </div>
        <Link className={`${s.btn} ${s.btnSm}`} href="/dashboard/design-studio">
          ← Back to the studio
        </Link>
      </header>

      <section className={s.card}>
        <div className={s.head}>
          <div>
            <div className={s.cardTitle}>{draft.id ? "Change the product" : "Add a product"}</div>
            <p className={s.cardSub}>Cabinets aren&apos;t here: the studio builds them to size from your line. Everything else you place can be a product of yours.</p>
          </div>
        </div>
        <form ref={formRef} className={s.body} onSubmit={submit} data-design-product-form>
          <div className={s.fields} style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <label className={s.field}>
              <span className={s.lbl}>What it is</span>
              <select className={s.in} value={draft.lib} onChange={(ev) => pick(ev.target.value)} data-design-product-lib>
                {GROUPS.map((g) => (
                  <optgroup key={g.cat} label={g.label}>
                    {PRODUCT_PIECES.filter((x) => x.cat === g.cat).map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className={s.field}>
              <span className={s.lbl}>Brand</span>
              <input className={s.in} value={draft.brand} onChange={(ev) => set({ brand: ev.target.value })} placeholder="Kohler" maxLength={40} data-design-product-brand />
            </label>
            <label className={s.field}>
              <span className={s.lbl}>Model or SKU</span>
              <input className={s.in} value={draft.model} onChange={(ev) => set({ model: ev.target.value })} placeholder="K-3999" maxLength={40} data-design-product-model />
            </label>
            <label className={s.field}>
              <span className={s.lbl}>Name (optional)</span>
              <input className={s.in} value={draft.name} onChange={(ev) => set({ name: ev.target.value })} placeholder="Highline Classic" maxLength={60} />
            </label>
          </div>
          <div className={s.fields} style={{ gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))" }}>
            <label className={s.field}>
              <span className={s.lbl}>Wide, in</span>
              <input className={s.in} inputMode="decimal" value={draft.w} onChange={(ev) => set({ w: ev.target.value })} data-design-product-w />
            </label>
            <label className={s.field}>
              <span className={s.lbl}>Deep, in</span>
              <input className={s.in} inputMode="decimal" value={draft.d} onChange={(ev) => set({ d: ev.target.value })} />
            </label>
            <label className={s.field}>
              <span className={s.lbl}>High, in</span>
              <input className={s.in} inputMode="decimal" value={draft.h} onChange={(ev) => set({ h: ev.target.value })} />
            </label>
            <label className={s.field}>
              <span className={s.lbl}>Your price, each</span>
              <input className={s.in} inputMode="decimal" value={draft.price} onChange={(ev) => set({ price: ev.target.value })} placeholder="389" data-design-product-price />
            </label>
            <label className={s.field}>
              <span className={s.lbl}>On the shelf</span>
              <input className={s.in} inputMode="numeric" value={draft.onHand} onChange={(ev) => set({ onHand: ev.target.value })} data-design-product-stock />
            </label>
            <label className={s.field}>
              <span className={s.lbl}>Finish colour</span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="color" className={s.in} style={{ width: 54, padding: 2 }} value={draft.color || "#b9ab97"} onChange={(ev) => set({ color: ev.target.value })} aria-label="Finish colour" />
                {draft.color ? (
                  <button type="button" className={s.link} onClick={() => set({ color: "" })}>
                    none
                  </button>
                ) : null}
              </div>
            </label>
          </div>
          <label className={s.field}>
            <span className={s.lbl}>Supplier&apos;s page (optional)</span>
            <input className={s.in} value={draft.url} onChange={(ev) => set({ url: ev.target.value })} placeholder="https://" maxLength={300} />
          </label>
          {e ? (
            <p className={s.note}>
              A standard {e.name.toLowerCase()} is {e.w} × {e.d} × {e.h} in{e.widths.length > 1 ? ` (widths ${e.widths.slice(0, 8).join(", ")} in)` : ""} — put your product&apos;s own numbers from its spec sheet.
            </p>
          ) : null}
          {error ? <p className={`${s.note} ${s.noteWarn}`}>{error}</p> : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={busy || (!draft.brand.trim() && !draft.model.trim())} data-design-product-save>
              {busy ? "Saving…" : draft.id ? "Save the product" : "Add to the inventory"}
            </button>
            {draft.id ? (
              <button type="button" className={s.btn} onClick={() => setDraft(blank(draft.lib))}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className={s.card}>
        <div className={s.head}>
          <div>
            <div className={s.cardTitle}>In the inventory · {products.length}</div>
            <p className={s.cardSub}>{products.length ? `${products.reduce((n, p) => n + p.onHand, 0)} on the shelf across ${products.length} products.` : "Nothing yet — add the products you sell, and they show in the studio's Add list."}</p>
          </div>
          {products.length > 6 ? <input className={s.in} style={{ maxWidth: 260 }} value={find} onChange={(ev) => setFind(ev.target.value)} placeholder="Find a product" aria-label="Find a product" /> : null}
        </div>
        <div className={s.body}>
          {GROUPS.map((g) => {
            const list = shown.filter((p) => lib(p.lib)?.cat === g.cat);
            if (!list.length) return null;
            return (
              <div key={g.cat} style={{ display: "grid", gap: 6 }}>
                <span className={s.lbl}>{g.label}</span>
                {list.map((p) => (
                  <div key={p.id} data-design-product={p.id} style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", alignItems: "center", padding: "9px 10px", border: "1.5px solid var(--hair-soft)", borderRadius: "var(--radius)", background: "#fff" }}>
                    {p.color ? <span aria-hidden style={{ width: 14, height: 14, borderRadius: 3, background: p.color, border: "1px solid var(--ink)" }} /> : null}
                    <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 13.5 }}>{productName(p)}</div>
                      <div className={s.note} style={{ fontSize: 12 }}>
                        {lib(p.lib)?.name} · {p.w} × {p.d} × {p.h} in
                        {p.url ? (
                          <>
                            {" · "}
                            <a className={s.link} href={p.url} target="_blank" rel="noreferrer noopener">
                              supplier
                            </a>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", minWidth: 70, textAlign: "right" }}>{p.price == null ? <span className={s.note}>no price</span> : usd(p.price)}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }} aria-label="On the shelf">
                      <button type="button" className={`${s.btn} ${s.btnSm}`} style={{ width: 32, padding: 0 }} onClick={() => stock(p, -1)} disabled={p.onHand <= 0} aria-label="One fewer on the shelf">
                        −
                      </button>
                      <span style={{ minWidth: 64, textAlign: "center", fontSize: 12.5, fontWeight: 700 }} data-design-product-onhand>
                        {p.onHand} in stock
                      </span>
                      <button type="button" className={`${s.btn} ${s.btnSm}`} style={{ width: 32, padding: 0 }} onClick={() => stock(p, 1)} aria-label="One more on the shelf">
                        +
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        className={`${s.btn} ${s.btnSm}`}
                        onClick={() => {
                          setDraft(draftOf(p));
                          formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                      >
                        Edit
                      </button>
                      <button type="button" className={`${s.btn} ${s.btnSm} ${s.btnDanger}`} onClick={() => remove(p)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
