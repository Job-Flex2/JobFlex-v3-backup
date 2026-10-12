"use client";
// THE MATERIAL LIST PAGE — the deck's takeoff for the lumber yard (a request
// for a delivered quote, no prices) or the installer (to buy, with the
// studio's estimated prices). Print or save it as a PDF, copy it as text for a
// text or an email, download it as a CSV for a spreadsheet, or share it from a
// phone. The numbers are the engine's (lib/deck/materialList), the same the
// studio prices with.
import * as React from "react";
import { priceDeck } from "@/lib/deck/pricing";
import { structureWords, type DeckDesign } from "@/lib/deck/design";
import { materialList, materialListCsv, materialListText, listAsk, type ListFor } from "@/lib/deck/materialList";
import type { DeckRateBook } from "@/lib/deck/rates";
import { parseStateZip, resolveMarket } from "@/lib/fence/market";
import s from "./deck-materials.module.css";

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyText = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : String(Math.round(n * 100) / 100));

export function DeckMaterialSheet({ design, address, title, shop, book, homeState, initialFor }: { design: DeckDesign | null; address: string | null; title: string; shop: { name: string; address: string | null; phone: string | null }; book: DeckRateBook; homeState: string | null; initialFor: ListFor }) {
  const [forWhom, setForWhom] = React.useState<ListFor>(initialFor);
  const [withPrices, setWithPrices] = React.useState(initialFor === "installer");
  const [said, setSaid] = React.useState<string | null>(null);
  const market = React.useMemo(() => {
    const p = parseStateZip(address);
    return p.state || p.zip ? resolveMarket({ address }) : resolveMarket({ state: homeState });
  }, [address, homeState]);
  const list = React.useMemo(() => (design ? materialList(priceDeck(design, { rates: book, market })) : null), [design, book, market]);
  const [canShare, setCanShare] = React.useState(false);
  React.useEffect(() => {
    // Only a browser that can share text (phones, Safari) gets the button; read after the first paint.
    const ok = typeof navigator !== "undefined" && typeof navigator.share === "function";
    if (ok) queueMicrotask(() => setCanShare(true));
  }, []);
  if (!design || !list) {
    return (
      <div className={s.sheet}>
        <div className={s.page}>
          <div className={s.title}>Material list</div>
          <p>No deck design was handed to this page. Open it from the Deck estimator&apos;s Material package, or from a saved draft or proposal.</p>
        </div>
      </div>
    );
  }
  const what = structureWords(design);
  const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const head = { what, title, address, shop: { name: shop.name, phone: shop.phone }, date, forWhom, withPrices };
  const slug = (title !== "Deck" ? title : what).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "deck";
  const say = (t: string) => {
    setSaid(t);
    window.setTimeout(() => setSaid(null), 2400);
  };
  const copy = async () => {
    const text = materialListText(list, head);
    try {
      await navigator.clipboard.writeText(text);
      say("Copied — paste it into a text, an email or the yard's quote form.");
    } catch {
      say("The browser would not copy. Select the list and copy it by hand.");
    }
  };
  const csv = () => {
    const blob = new Blob([materialListCsv(list, withPrices)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `materials-${slug}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    say("The CSV is downloading.");
  };
  const share = async () => {
    try {
      await navigator.share({ title: `Material list — ${what}`, text: materialListText(list, head) });
    } catch {
      /* closed */
    }
  };
  const supplied = list.groups.flatMap((g) => g.lines.filter((l) => l.byClient));
  return (
    <div className={s.sheet} data-deck-materials={forWhom}>
      <div className={s.bar} data-screen-only>
        <div className={s.seg} role="radiogroup" aria-label="Who the list is for">
          {(["yard", "installer"] as const).map((f) => (
            <button key={f} type="button" role="radio" aria-checked={forWhom === f} className={cx(s.segBtn, forWhom === f && s.segOn)} onClick={() => { setForWhom(f); setWithPrices(f === "installer"); }} data-materials-for={f}>
              {f === "yard" ? "For the lumber yard" : "For the installer"}
            </button>
          ))}
        </div>
        <label className={s.toggle}>
          <input type="checkbox" checked={withPrices} onChange={(e) => setWithPrices(e.target.checked)} data-materials-prices />
          <span>Show the studio&apos;s estimated prices</span>
        </label>
        <div className={s.acts}>
          <button type="button" className={cx(s.btn, s.btnPrimary)} onClick={() => window.print()} data-materials-print>Print or save PDF</button>
          <button type="button" className={s.btn} onClick={() => void copy()} data-materials-copy>Copy as text</button>
          <button type="button" className={s.btn} onClick={csv} data-materials-csv>Download CSV</button>
          {canShare ? <button type="button" className={s.btn} onClick={() => void share()} data-materials-share>Share…</button> : null}
        </div>
        {said ? <p className={s.said} role="status">{said}</p> : null}
      </div>

      <div className={s.page}>
        <div className={s.head}>
          <div>
            <div className={s.kicker}>{forWhom === "yard" ? "Request for quote" : "Purchase list"}</div>
            <div className={s.title}>Material list</div>
            <div className={s.sub}>{what}{title !== "Deck" && title !== what ? ` · ${title}` : ""}</div>
            <div className={s.sub}>{address ?? "No job address set"} · <span suppressHydrationWarning>{date}</span></div>
          </div>
          <div className={s.shop}>
            <b>{shop.name || "Your company"}</b>
            {shop.phone ? <span>{shop.phone}</span> : null}
            {shop.address ? <span>{shop.address}</span> : null}
          </div>
        </div>
        <p className={s.ask} data-materials-ask>{listAsk({ forWhom, address })}{forWhom === "yard" ? " Quantities are as yards sell them; let us know of any substitution." : ""}</p>

        <table className={s.table} data-materials-table>
          <thead>
            <tr>
              <th className={s.r}>Qty</th>
              <th>Unit</th>
              <th>Item</th>
              {withPrices ? <th className={s.r}>Est. each</th> : null}
              {withPrices ? <th className={s.r}>Est. total</th> : <th className={cx(s.r, s.quoteCol)}>{forWhom === "yard" ? "Price" : "Got it"}</th>}
            </tr>
          </thead>
          {list.groups.map((g) => {
            const lines = g.lines.filter((l) => !l.byClient);
            if (!lines.length) return null;
            return (
              <tbody key={g.step} data-materials-group={g.step}>
                <tr className={s.groupRow}>
                  <td colSpan={withPrices ? 3 : 4}>{g.label}</td>
                  {withPrices ? <td className={s.r} colSpan={2}>{money(g.cost)}</td> : null}
                </tr>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className={cx(s.r, s.num)}>{qtyText(l.qty)}</td>
                    <td className={s.unit}>{l.unit}</td>
                    <td>
                      <div className={s.item}>{l.label}</div>
                      {l.note ? <div className={s.note}>{l.note}</div> : null}
                    </td>
                    {withPrices ? <td className={cx(s.r, s.num)}>{money(l.unitPrice)}{l.example ? <span className={s.ex} title="An example price — set yours under Your prices in the studio">ex</span> : null}</td> : null}
                    {withPrices ? <td className={cx(s.r, s.num)}>{money(l.cost)}</td> : <td className={s.blank} />}
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>

        {supplied.length ? (
          <div className={s.supplied}>
            <div className={s.h2}>The client supplies — not to order</div>
            <ul>
              {supplied.map((l, i) => <li key={i}>{qtyText(l.qty)} {l.unit} {l.label}</li>)}
            </ul>
          </div>
        ) : null}

        <div className={s.total}>
          <span>{list.count} {list.count === 1 ? "item" : "items"} to order</span>
          {withPrices ? <span>Estimated <b>{money(list.cost)}</b> before tax{list.exampleShare > 0.05 ? ` · ${Math.round(list.exampleShare * 100)}% on example prices` : ""}</span> : null}
        </div>
        {forWhom === "yard" ? (
          <div className={s.quoteBox}>
            <div className={s.h2}>Quote</div>
            <div className={s.lines}>
              <span>Total before tax ________________</span>
              <span>Delivery ________________</span>
              <span>Delivery date ________________</span>
              <span>Quoted by ________________</span>
            </div>
          </div>
        ) : null}
        <p className={s.fine}>Quantities from the Deck Studio&apos;s takeoff: lumber in the lengths yards sell, the waste set in the studio included, ground-contact stock where it sits near the soil. Check the list against the job before ordering.</p>
      </div>
    </div>
  );
}
