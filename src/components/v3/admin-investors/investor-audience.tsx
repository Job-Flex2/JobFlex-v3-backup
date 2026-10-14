// WHO OPENED THE INVESTOR LINK, AND WHAT THEY OFFERED (2026-10-13) — under the Investors page's head. The readers of
// the current link first (each email once: first seen, last seen, how many visits), then any earlier link's; the
// offers newest first, each one a mailto away. Read-only; the lists live in lib/investorVisitors.
import type { InvestorOffer, InvestorVisitor } from "@/lib/investorVisitors";
import { INVESTING_KINDS } from "@/lib/investorGate";
import s from "./investor-audience.module.css";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function InvestorAudience({ visitors, offers, linkMadeAt }: { visitors: InvestorVisitor[]; offers: InvestorOffer[]; linkMadeAt: string | null }) {
  const current = visitors.filter((v) => v.linkMadeAt === linkMadeAt);
  const earlier = visitors.filter((v) => v.linkMadeAt !== linkMadeAt);
  const investors = current.filter((v) => INVESTING_KINDS.has(v.kind)).length;
  return (
    <section className={s.panel} id="audience" aria-label="Who opened the link" data-investor-audience>
      <div className={s.head}>
        <h2 className={s.title}>Who opened the link</h2>
        <span className={s.sum}>
          {current.length} reader{current.length === 1 ? "" : "s"} on this link · {investors} investor{investors === 1 ? "" : "s"} · {offers.length} offer{offers.length === 1 ? "" : "s"}
        </span>
      </div>
      <p className={s.hint}>The link asks each reader for their name, company and what they do before the figures open; you get an email each time. &ldquo;We accept VC offers&rdquo; on their page sends the offers below — reply to the email, or from here.</p>
      {offers.length ? (
        <div className={s.offers} data-investor-offers>
          {offers.slice(0, 20).map((o) => (
            <article key={o.id} className={s.offer}>
              <div className={s.oTop}>
                <b>{o.company}</b>
                <span className={s.chip}>{o.type}</span>
                <span className={s.when}>{when(o.at)}</span>
              </div>
              <div className={s.oTerms}>
                {o.amount} · {o.instrument}
                {o.valuation ? ` · ${o.valuation}` : ""} · {o.timeline}
              </div>
              {o.message ? <p className={s.msg}>&ldquo;{o.message}&rdquo;</p> : null}
              <div className={s.oFrom}>
                {o.name} · <a href={`mailto:${o.email}?subject=${encodeURIComponent(`JobFlex — your ${o.type.toLowerCase()}`)}`}>{o.email}</a>
                {o.phone ? ` · ${o.phone}` : ""}
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {current.length || earlier.length ? (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Reader</th>
                <th>What they do</th>
                <th>Contact</th>
                <th>First seen</th>
                <th>Last seen</th>
                <th className={s.num}>Visits</th>
              </tr>
            </thead>
            <tbody>
              {[...current, ...earlier].slice(0, 100).map((v) => (
                <tr key={v.id} className={v.linkMadeAt === linkMadeAt ? "" : s.old} data-reader={v.email}>
                  <td>
                    <b>{v.name}</b>
                    <span className={s.co}>{v.company}</span>
                  </td>
                  <td>{INVESTING_KINDS.has(v.kind) ? <span className={s.inv}>{v.kind}</span> : v.kind}</td>
                  <td>
                    <a href={`mailto:${v.email}`}>{v.email}</a>
                    {v.phone ? <span className={s.co}>{v.phone}</span> : null}
                  </td>
                  <td>{when(v.at)}</td>
                  <td>{when(v.lastSeen)}</td>
                  <td className={s.num}>{v.visits}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {earlier.length ? <p className={s.hint}>Greyed rows read an earlier link.</p> : null}
        </div>
      ) : (
        <p className={s.empty}>Nobody has opened the link yet.</p>
      )}
    </section>
  );
}
