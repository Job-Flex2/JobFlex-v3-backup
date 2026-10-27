"use client";

// SETTINGS → WEBSITE ESTIMATORS (2026-10-27): one card per trade — on/off, the price words, what the homeowner sees
// (a range or the exact figure, how wide), which materials they may pick, a note under the price, ask for the email —
// then the shop's sites, the monthly cap, this month's counts, and the three ways onto a website (the link, the
// button, the frame), each with Copy and a Preview. A platform admin also sees the owner's switch that opens the
// feature to every account. Loads and saves itself (actions/webEstimator).
import { useEffect, useState, useTransition } from "react";
import { loadWebEstimator, saveWebEstimator, setWebEstimatorOpenAction, type WebEstimatorView } from "@/actions/webEstimator";
import { SPREAD_MAX, SPREAD_MIN, WEB_TRADE, WEB_TRADES, embedSnippets, type WebEstimatorSettings, type WebTrade } from "@/lib/webEstimator";
import styles from "./web-estimator-form.module.css";

const priceWords = (cents: number) => `$${Math.round(cents / 100)} a month`;

export function WebEstimatorForm() {
  const [view, setView] = useState<WebEstimatorView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<WebEstimatorSettings | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);
  const [domainsText, setDomainsText] = useState("");

  useEffect(() => {
    let alive = true;
    void loadWebEstimator().then((r) => {
      if (!alive) return;
      if (!r.ok) { setError(r.error); return; }
      setView(r.view); setSettings(r.view.settings); setDomainsText(r.view.settings.domains.join(", "));
    });
    return () => { alive = false; };
  }, []);

  if (error) return <p className={styles.err} role="alert">{error}</p>;
  if (!view || !settings) return <p className={styles.muted}>Loading…</p>;

  const set = (next: WebEstimatorSettings) => { setSettings(next); setSaved(null); };
  const setTrade = (t: WebTrade, patch: Partial<WebEstimatorSettings["trades"][WebTrade]>) => set({ ...settings, trades: { ...settings.trades, [t]: { ...settings.trades[t], ...patch } } });
  const save = () => start(async () => {
    const next = { ...settings, domains: domainsText.split(/[,\s]+/).map((d) => d.trim()).filter(Boolean) };
    const r = await saveWebEstimator(next);
    if (!r.ok) { setError(r.error); return; }
    setSettings(r.settings); setDomainsText(r.settings.domains.join(", ")); setSaved("Saved."); setError(null);
  });
  const copy = async (what: string, text: string) => { try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied((c) => (c === what ? null : c)), 1800); } catch { /* the field is selectable */ } };
  const flipOpen = (on: boolean) => start(async () => { const r = await setWebEstimatorOpenAction(on); if (r.ok) setView({ ...view, open: r.open }); else setError(r.error); });

  const onTrades = WEB_TRADES.filter((t) => settings.trades[t].on);

  return (
    <div className={styles.form} data-web-estimator-form>
      {view.admin ? (
        <div className={styles.adminBox} data-web-admin>
          <div>
            <b>JobFlex admin</b> · {view.open ? "Open to every account." : "In preview: only JobFlex admins see this page and can turn a trade on. Nothing is billed yet."}
          </div>
          <button type="button" className={styles.btnGhost} disabled={pending} onClick={() => flipOpen(!view.open)} data-web-open-switch>
            {view.open ? "Back to preview" : "Open to every account"}
          </button>
        </div>
      ) : null}

      <div className={styles.cards}>
        {WEB_TRADES.map((t) => {
          const info = WEB_TRADE[t], ts = settings.trades[t];
          return (
            <section key={t} className={styles.card + (ts.on ? " " + styles.cardOn : "")} data-web-trade={t} data-on={ts.on}>
              <header className={styles.cardHead}>
                <div>
                  <div className={styles.cardTitle}>{info.name}</div>
                  <div className={styles.cardPrice}>{priceWords(info.cents)}{!view.open ? " · preview, not billed" : ""}</div>
                </div>
                <label className={styles.switch}>
                  <input type="checkbox" checked={ts.on} onChange={(e) => setTrade(t, { on: e.target.checked })} data-web-on={t} />
                  <span>{ts.on ? "On" : "Off"}</span>
                </label>
              </header>
              {ts.on ? (
                <div className={styles.cardBody}>
                  <div className={styles.row}>
                    <label className={styles.field}>
                      <span>The homeowner sees</span>
                      <select value={ts.show} onChange={(e) => setTrade(t, { show: e.target.value as "range" | "exact" })} data-web-show={t}>
                        <option value="range">A price range</option>
                        <option value="exact">The exact figure</option>
                      </select>
                    </label>
                    {ts.show === "range" ? (
                      <label className={styles.field}>
                        <span>How wide · ±{Math.round(ts.spread * 100)}%</span>
                        <input type="range" min={SPREAD_MIN * 100} max={SPREAD_MAX * 100} step={1} value={Math.round(ts.spread * 100)} onChange={(e) => setTrade(t, { spread: Number(e.target.value) / 100 })} data-web-spread={t} />
                      </label>
                    ) : null}
                    <label className={styles.check}>
                      <input type="checkbox" checked={ts.askEmail} onChange={(e) => setTrade(t, { askEmail: e.target.checked })} />
                      <span>Ask for their email too</span>
                    </label>
                  </div>
                  <div className={styles.field}>
                    <span>What they may pick <small>none ticked = all of these</small></span>
                    <div className={styles.chips}>
                      {view.choices[t].map((c) => {
                        const on = ts.materials.includes(c.id);
                        return (
                          <button key={c.id} type="button" className={styles.chip + (on ? " " + styles.chipOn : "")} aria-pressed={on} title={c.note ?? ""} onClick={() => setTrade(t, { materials: on ? ts.materials.filter((m) => m !== c.id) : [...ts.materials, c.id] })} data-web-material={c.id}>
                            {c.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <label className={styles.field}>
                    <span>Under the price <small>your own words, or leave the standard line</small></span>
                    <input value={ts.note} placeholder={info.basis} maxLength={200} onChange={(e) => setTrade(t, { note: e.target.value })} data-web-note={t} />
                  </label>
                  <Snippets base={view.base} slug={view.slug} trade={t} copied={copied} onCopy={copy} />
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <section className={styles.shared}>
        <label className={styles.field}>
          <span>Your websites <small>the button runs only on these; the link works anywhere. Blank = any site.</small></span>
          <input value={domainsText} placeholder="ridgelineroofing.com, shop.ridgelineroofing.com" onChange={(e) => { setDomainsText(e.target.value); setSaved(null); }} data-web-domains />
        </label>
        <label className={styles.field + " " + styles.narrow}>
          <span>Public estimates a month <small>a cost guard; the page rests after it and still takes the lead</small></span>
          <input type="number" min={20} max={5000} step={10} value={settings.monthlyCap} onChange={(e) => set({ ...settings, monthlyCap: Number(e.target.value) || 0 })} data-web-cap />
        </label>
        <div className={styles.counts} data-web-counts>
          <b>This month</b>
          <span>{view.counts.views} views</span>
          <span>{view.counts.estimates} estimates</span>
          <span>{view.counts.leads} leads</span>
        </div>
      </section>

      <div className={styles.foot}>
        <button type="button" className={styles.btn} disabled={pending} onClick={save} data-web-save>{pending ? "Saving…" : "Save"}</button>
        {saved ? <span className={styles.ok} data-web-saved>{saved}{onTrades.length ? ` ${onTrades.map((t) => WEB_TRADE[t].name.split(" ")[0]).join(", ")} on.` : ""}</span> : null}
        {!view.slug ? <span className={styles.err}>This company has no public handle yet — the link can&apos;t be made.</span> : null}
      </div>
    </div>
  );
}

function Snippets({ base, slug, trade, copied, onCopy }: { base: string; slug: string; trade: WebTrade; copied: string | null; onCopy: (what: string, text: string) => void }) {
  const s = embedSnippets(base, slug, trade);
  const rows: Array<[string, string, string, string]> = [
    ["link", "The link", "Paste it in a button on your site, Google Business Profile, Facebook, an email, a QR code.", s.link],
    ["button", "The button", 'One line where your site builder takes "custom HTML" or "embed code": a button that opens the estimator in a window.', s.button],
    ["frame", "On the page", "A frame that shows the estimator inside your own page.", s.iframe],
  ];
  return (
    <div className={styles.snips} data-web-snippets={trade}>
      {rows.map(([k, name, how, code]) => (
        <div key={k} className={styles.snip}>
          <div className={styles.snipHead}>
            <b>{name}</b>
            <span>{how}</span>
          </div>
          <div className={styles.snipRow}>
            <input readOnly value={code} onFocus={(e) => e.currentTarget.select()} data-web-snippet={k} />
            <button type="button" className={styles.btnGhost} onClick={() => onCopy(`${trade}:${k}`, code)}>{copied === `${trade}:${k}` ? "Copied" : "Copy"}</button>
            {k === "link" ? <a className={styles.btnGhost} href={code} target="_blank" rel="noreferrer" data-web-preview={trade}>Preview</a> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
