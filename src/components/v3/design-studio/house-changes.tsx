"use client";
// CHANGES TO THE HOUSE (Home Design Studio, milestone 5 — 2026-10-17). Beside the design: every wall taken out or
// moved and every new, wider or moved opening, against the house as it stood — each with what it needs (an engineer,
// a header from the code's tables, a look on site first, or framing only), "Show" and "Undo"; what the plan can't tell
// an engineer (what's above, the roof, the foundation); and the request to the engineer — sent by email with its
// link, then seen, then answered, the answers back under each change. Plus the wall inspector's structure reading.
import * as React from "react";
import s from "./design-studio.module.css";
import type { DesignDoc, SiteFacts } from "@/lib/design/model";
import { ftIn } from "@/lib/design/model";
import { forEngineer, houseChanges, LEVEL_WORDS, readingWords, undoChange, type HouseChange, type WallReading } from "@/lib/design/structure";
import { NEEDS_WORDS, type EngAnswer } from "@/lib/design/engineering";
import { readEngineeringRequest, sendEngineeringRequest } from "@/actions/designEngineering";
import type { Selection } from "./plan-editor";

const INK = { engineer: "#b4232a", check: "#9a5b00", header: "#1b5f9e", none: "#5d636b" } as const;

type Props = {
  doc: DesignDoc;
  onPatch: (fn: (d: DesignDoc) => void) => void;
  onSelect: (s: Selection) => void;
  /** Saves the design (when it isn't yet) and gives its id. */
  ensureSaved: () => Promise<string | null>;
};

export function HouseChanges({ doc, onPatch, onSelect, ensureSaved }: Props) {
  const changes = React.useMemo(() => houseChanges(doc), [doc]);
  const forEng = forEngineer(changes);
  const req = doc.engineering?.request ?? null;
  const [to, setTo] = React.useState(req?.to ?? "");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState<{ url: string; emailed: boolean } | null>(null);
  const [status, setStatus] = React.useState<{ token: string; seenAt: string | null; answer: EngAnswer | null; url: string } | null>(null);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!req?.token) return;
    let live = true;
    readEngineeringRequest(req.token).then((r) => {
      if (live && r.ok) setStatus({ token: req.token, seenAt: r.seenAt, answer: r.answer, url: r.url });
    });
    return () => {
      live = false;
    };
  }, [req?.token, tick]);

  if (!changes.length && !req) return null;
  const answer = status && status.token === req?.token ? status.answer : null;
  const site = doc.engineering?.site ?? {};
  const setSite = (patch: Partial<SiteFacts>) =>
    onPatch((d) => {
      d.engineering = { ...(d.engineering ?? {}), site: { ...(d.engineering?.site ?? {}), ...patch } };
    });
  const show = (c: HouseChange) => {
    if (c.openingId && doc.openings.some((o) => o.id === c.openingId)) onSelect({ kind: "opening", id: c.openingId });
    else if (doc.walls.some((w) => w.id === c.wallId)) onSelect({ kind: "wall", id: c.wallId });
  };
  const send = async () => {
    setBusy(true);
    setError(null);
    const designId = await ensureSaved();
    const r = await sendEngineeringRequest({ designId, doc, to, note: note || undefined });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setSent({ url: r.url, emailed: r.emailed });
    setStatus({ token: r.token, seenAt: null, answer: null, url: r.url });
    onPatch((d) => {
      d.engineering = { ...(d.engineering ?? {}), request: { token: r.token, to, sentAt: r.sentAt } };
    });
  };

  return (
    <section className={s.card} data-design-changes>
      <div className={s.head}>
        <div className={s.cardTitle}>Changes to the house</div>
        <span className={s.mono}>{changes.length}</span>
      </div>
      <div className={s.body}>
        {changes.map((c, i) => (
          <div key={c.id} style={{ borderLeft: `3px solid ${INK[c.needs]}`, paddingLeft: 10, display: "grid", gap: 3 }} data-design-change={c.kind}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
              <b style={{ fontSize: 13.5, lineHeight: 1.3 }}>
                {i + 1}. {c.title}
              </b>
              <span className={s.mono} style={{ color: INK[c.needs], whiteSpace: "nowrap" }} data-design-change-needs={c.needs}>
                {NEEDS_WORDS[c.needs]}
              </span>
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--muted)" }}>{c.why}</div>
            {answer?.perChange[c.id] ? (
              <div style={{ fontSize: 12.5, lineHeight: 1.45, borderLeft: "2px solid #1f7a46", paddingLeft: 8 }} data-design-change-answer>
                <b>Engineer:</b> {answer.perChange[c.id]}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => show(c)}>
                Show
              </button>
              <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => onPatch((d) => Object.assign(d, undoChange(d, c)))} data-design-change-undo>
                Undo
              </button>
            </div>
          </div>
        ))}

        {forEng.length || req ? (
          <div style={{ display: "grid", gap: 8, borderTop: "1.5px solid var(--hair-soft)", paddingTop: 12 }}>
            <div className={s.cardTitle} style={{ fontSize: 12 }}>
              For the engineer
            </div>
            <p className={s.note}>What the plan can&apos;t show — it changes the beam:</p>
            <div className={s.fields}>
              <SiteSelect label="Above" value={site.above} onChange={(v) => setSite({ above: v as SiteFacts["above"] })} options={[["roof", "The roof only"], ["floor", "A floor above"]]} id="site-above" />
              <SiteSelect label="Roof" value={site.roof} onChange={(v) => setSite({ roof: v as SiteFacts["roof"] })} options={[["trusses", "Trusses"], ["rafters", "Rafters"]]} id="site-roof" />
              <SiteSelect label="Below" value={site.below} onChange={(v) => setSite({ below: v as SiteFacts["below"] })} options={[["slab", "Slab"], ["crawl", "Crawlspace"], ["basement", "Basement"]]} id="site-below" />
            </div>
            {req && status?.token === req.token ? (
              <p className={`${s.note} ${answer ? s.noteGood : ""}`} data-design-eng-status>
                {answer
                  ? `Answered by ${answer.by}${answer.license ? ` (${answer.license})` : ""}, ${new Date(answer.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`
                  : status.seenAt
                    ? `Sent to ${req.to}; opened ${new Date(status.seenAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} — waiting for the answer.`
                    : `Sent to ${req.to} ${new Date(req.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} — not opened yet.`}{" "}
                <a className={s.link} href={status.url} target="_blank" rel="noreferrer">
                  Open the request
                </a>{" "}
                <button type="button" className={s.link} onClick={() => setTick((t) => t + 1)}>
                  Refresh
                </button>
              </p>
            ) : null}
            {answer?.note ? <p className={s.note}>{answer.note}</p> : null}
            {sent && !sent.emailed ? (
              <p className={`${s.note} ${s.noteWarn}`}>
                The email didn&apos;t go out — send the engineer this link: <a href={sent.url}>{sent.url}</a>
              </p>
            ) : null}
            {forEng.length ? (
              <>
                <label className={s.field}>
                  <span className={s.lbl}>Engineer&apos;s email</span>
                  <input id="eng-to" className={s.in} type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="engineer@firm.com" data-design-eng-to />
                </label>
                <label className={s.field}>
                  <span className={s.lbl}>A note (optional)</span>
                  <textarea id="eng-note" className={s.in} style={{ height: 64, paddingTop: 6 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="When you can come out, the fee…" />
                </label>
                {error ? <p className={`${s.note} ${s.noteWarn}`}>{error}</p> : null}
                <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={send} disabled={busy || !/.+@.+\..+/.test(to)} data-design-eng-send>
                  {busy ? "Sending…" : req ? "Send a new request" : `Send ${forEng.length === 1 ? "it" : `the ${forEng.length}`} to the engineer`}
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        <p className={s.note} style={{ fontSize: 11.5 }}>
          Against the house as it stood{doc.existing ? ` (${new Date(doc.existing.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })})` : ""}. Fixed a plan mistake, not the house?{" "}
          <button
            type="button"
            className={s.link}
            onClick={() => {
              if (!window.confirm("Take the plan as it is now as the house as it stands? The changes listed here stop counting as changes.")) return;
              onPatch((d) => {
                d.existing = { walls: JSON.parse(JSON.stringify(d.walls)), openings: JSON.parse(JSON.stringify(d.openings)), at: new Date().toISOString() };
              });
            }}
          >
            Take the plan as it is now
          </button>
        </p>
      </div>
    </section>
  );
}

function SiteSelect({ label, value, onChange, options, id }: { label: string; value?: string; onChange: (v: string) => void; options: Array<[string, string]>; id: string }) {
  return (
    <label className={s.field}>
      <span className={s.lbl}>{label}</span>
      <select id={id} className={s.in} value={value ?? "unknown"} onChange={(e) => onChange(e.target.value)} data-design-site={id}>
        <option value="unknown">Not known yet</option>
        {options.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The selected wall's structure: the plan's reading, why, what to check on site, and what the contractor found. */
export function WallStructure({ reading, isStanding, onConfirm, onOpenUp, lengthIn }: { reading: WallReading; isStanding: boolean; onConfirm: (v: "bearing" | "not" | null) => void; onOpenUp: () => void; lengthIn: number }) {
  const [more, setMore] = React.useState(false);
  const tone = reading.bearing === true ? "#b4232a" : reading.bearing === false ? "#1f7a46" : "#9a5b00";
  return (
    <div style={{ display: "grid", gap: 6, borderTop: "1.5px solid var(--hair-soft)", paddingTop: 10 }} data-design-structure={reading.level}>
      <div className={s.lbl}>Structure</div>
      <div style={{ fontWeight: 800, color: tone }} data-design-structure-words>
        {readingWords(reading)}
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>
        {reading.confirmed ? `From the plan alone: ${LEVEL_WORDS[reading.level].toLowerCase()} — ` : ""}
        {reading.reasons.join(" ")}
      </div>
      {reading.plumbing ? <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "#9a5b00" }}>{reading.plumbing}</div> : null}
      {isStanding && reading.level !== "outside" ? (
        <>
          {reading.checks.length ? (
            <button type="button" className={s.link} style={{ justifySelf: "start" }} onClick={() => setMore((v) => !v)}>
              {more ? "Hide" : "What to check on site"}
            </button>
          ) : null}
          {more ? (
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5, lineHeight: 1.5 }}>
              {reading.checks.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : null}
          <div className={s.field}>
            <span className={s.lbl}>Found on site</span>
            <div className={s.seg}>
              <button type="button" className={`${s.segB} ${!reading.confirmed ? s.on : ""}`} onClick={() => onConfirm(null)}>
                Not checked
              </button>
              <button type="button" className={`${s.segB} ${reading.confirmed === "not" ? s.on : ""}`} onClick={() => onConfirm("not")} data-design-confirm="not">
                Not bearing
              </button>
              <button type="button" className={`${s.segB} ${reading.confirmed === "bearing" ? s.on : ""}`} onClick={() => onConfirm("bearing")} data-design-confirm="bearing">
                Bearing
              </button>
            </div>
          </div>
        </>
      ) : null}
      {isStanding && lengthIn >= 36 ? (
        <button type="button" className={`${s.btn} ${s.btnSm}`} style={{ justifySelf: "start" }} onClick={onOpenUp} data-design-open-up>
          Open it up ({ftIn(Math.max(24, lengthIn - 9))} opening)
        </button>
      ) : null}
      <p className={s.note} style={{ fontSize: 11.5 }}>A reading from the plan — the framing isn&apos;t on it. Taking it out or opening it up lists it under Changes to the house, with what it needs.</p>
    </div>
  );
}
