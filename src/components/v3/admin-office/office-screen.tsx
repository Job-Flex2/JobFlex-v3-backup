"use client";

// THE OFFICE SCREEN (owner, 2026-10-13) — the wall board for the office TV. One 16:9 screen, read from across the
// room: today's six big numbers against yesterday at this clock time, a quieter strip under them, today's feed as it
// happens, who is in the app right now, the trials and the money, what needs a person, the systems, and fourteen
// days of signups and proposals. It asks for fresh figures every thirty seconds, marks what arrived since, keeps the
// screen awake, and hides the cursor when the mouse rests. Nothing here writes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadOfficeScreen } from "@/actions/officeScreen";
import { deltaWords, type OfficeFeedItem, type OfficeScreenData, type OfficeTile } from "@/lib/officeScreen";
import s from "./office-screen.module.css";

const REFRESH_MS = 30_000;
const NEW_MS = 90_000;

const KIND_WORDS: Record<OfficeFeedItem["kind"], string> = {
  signup: "Signup",
  paid: "Paying",
  card: "Card",
  cancel: "Cancel",
  proposal: "Proposal",
  first: "First proposal",
  sent: "Sent",
  opened: "Opened",
  accepted: "Accepted",
  estimate: "Estimate",
  lead: "Request",
  support: "Support",
  investor: "Investor",
  offer: "VC offer",
};

const n = (v: number) => v.toLocaleString("en-US");
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

function useClock(tz: string) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  const fmt = useMemo(
    () => ({
      time: new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }),
      date: new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }),
      short: new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }),
      day: new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }),
    }),
    [tz],
  );
  return { now, fmt };
}

/**
 * How many of a list's lines fit its panel (the section around it) on this screen; the rest are hidden and counted.
 * Measured after paint and whenever the panel's size or the list changes — a TV, a laptop and a 4K screen each show
 * what they have room for.
 */
function useFit(ref: React.RefObject<HTMLUListElement | null>, list: unknown): number | null {
  const [fit, setFit] = useState<number | null>(null);
  useEffect(() => {
    const ul = ref.current;
    if (!ul) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const panel = ul.closest("section");
        if (!panel) return;
        const items = [...ul.children] as HTMLElement[];
        items.forEach((li) => (li.style.display = ""));
        const bottom = panel.getBoundingClientRect().bottom - parseFloat(getComputedStyle(panel).paddingBottom);
        let n = items.length;
        for (let i = 0; i < items.length; i++) {
          // Room for the "+N more" line whenever anything is left out.
          if (items[i].getBoundingClientRect().bottom > bottom - (i < items.length - 1 ? 22 : 0) + 1) {
            n = i;
            break;
          }
        }
        // Never "+N more" with nothing above it: the first line always shows.
        n = items.length ? Math.max(1, n) : 0;
        items.forEach((li, i) => (li.style.display = i < n ? "" : "none"));
        setFit(n);
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(ul.closest("section") ?? ul);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [ref, list]);
  return fit;
}

function Tile({ t, big }: { t: OfficeTile; big?: boolean }) {
  const d = t.missing ? null : deltaWords(t.today, t.yesterday, t.money);
  return (
    <div className={big ? s.tile : s.chip} data-tile={t.key}>
      <span className={s.tileL}>{t.label}</span>
      <span className={s.tileV}>{t.missing ? "—" : t.money ? `$${n(t.today)}` : n(t.today)}</span>
      {t.missing ? <span className={s.tileD}>not connected</span> : d ? <span className={`${s.tileD} ${d.dir === "up" ? s.up : d.dir === "down" ? s.down : ""}`}>{d.text}</span> : <span className={s.tileD}>&nbsp;</span>}
      {t.sub ? <span className={s.tileS}>{t.sub}</span> : null}
    </div>
  );
}

/** A fourteen-day line with its area, today's point marked and the day's figure beside it. */
function Spark({ label, values, days, fmtDay }: { label: string; values: number[]; days: number[]; fmtDay: (ms: number) => string }) {
  const W = 300;
  const H = 70;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? W / (values.length - 1) : W;
  const pts = values.map((v, i) => [i * step, H - 6 - (v / max) * (H - 14)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = pts.length ? `0,${H} ${line} ${W},${H}` : "";
  const last = pts[pts.length - 1];
  const total = values.reduce((a, v) => a + v, 0);
  return (
    <div className={s.spark}>
      <div className={s.sparkH}>
        <span>{label}</span>
        <b>{n(values[values.length - 1] ?? 0)} today</b>
        <em>{n(total)} in 14 days</em>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={s.sparkSvg} role="img" aria-label={`${label}: ${values.join(", ")}`}>
        {area ? <polygon points={area} className={s.sparkArea} /> : null}
        {line ? <polyline points={line} className={s.sparkLine} /> : null}
        {last ? <circle cx={last[0]} cy={last[1]} r="4" className={s.sparkDot} /> : null}
      </svg>
      {days.length ? (
        <div className={s.sparkX}>
          <span>{fmtDay(days[0])}</span>
          <span>today</span>
        </div>
      ) : null}
    </div>
  );
}

export function OfficeScreen({ initial }: { initial: OfficeScreenData }) {
  const [data, setData] = useState<OfficeScreenData>(initial);
  const [lastOk, setLastOk] = useState<number>(initial.now);
  const [failing, setFailing] = useState(false);
  const [idle, setIdle] = useState(false);
  const [full, setFull] = useState(false);
  // Feed lines seen before this refresh; what is new since glows for a minute and a half.
  const seenRef = useRef<Map<string, number>>(new Map(initial.feed.map((f) => [`${f.at}|${f.kind}|${f.who}`, 0])));
  const [freshKeys, setFreshKeys] = useState<Map<string, number>>(new Map());
  const { now, fmt } = useClock(data.tz);
  // The lists show the lines that fit their panel on this screen, and say how many more there are.
  const attRef = useRef<HTMLUListElement | null>(null);
  const attFit = useFit(attRef, data.attention);
  const onRef = useRef<HTMLUListElement | null>(null);
  const onFit = useFit(onRef, data.online);

  const refresh = useCallback(async () => {
    try {
      const next = await loadOfficeScreen();
      const arrived = new Map<string, number>();
      for (const f of next.feed) {
        const k = `${f.at}|${f.kind}|${f.who}`;
        if (!seenRef.current.has(k)) {
          seenRef.current.set(k, Date.now());
          arrived.set(k, Date.now());
        }
      }
      setFreshKeys((prev) => {
        const m = new Map([...prev].filter(([, t]) => Date.now() - t < NEW_MS));
        for (const [k, t] of arrived) m.set(k, t);
        return m;
      });
      setData(next);
      setLastOk(Date.now());
      setFailing(false);
    } catch {
      setFailing(true);
    }
  }, []);

  useEffect(() => {
    const t = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // Keep the TV awake while the board is up (where the browser allows it), and again after it comes back into view.
  useEffect(() => {
    type Lock = { release: () => Promise<void> };
    let lock: Lock | null = null;
    const ask = async () => {
      try {
        const wl = (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<Lock> } }).wakeLock;
        if (wl && document.visibilityState === "visible") lock = await wl.request("screen");
      } catch {
        /* not allowed here — the TV's own settings keep it on */
      }
    };
    void ask();
    const onVis = () => {
      if (document.visibilityState === "visible") void ask();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release().catch(() => {});
    };
  }, []);

  // The cursor and the two buttons step aside when the mouse rests.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), 4000);
    };
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("keydown", wake);
    const onFull = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFull);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("keydown", wake);
      document.removeEventListener("fullscreenchange", onFull);
    };
  }, []);

  const goFull = () => {
    const el = document.documentElement;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void el.requestFullscreen?.().catch(() => {});
  };

  const ago = now != null ? Math.max(0, Math.round((now - lastOk) / 1000)) : 0;
  const healthBad = data.health?.services.filter((x) => !x.optional && (x.level === "down" || x.level === "degraded")) ?? [];
  const sysWord = !data.health ? "Systems not checked yet" : healthBad.length ? `${healthBad.length} system${healthBad.length === 1 ? "" : "s"} need${healthBad.length === 1 ? "s" : ""} a look` : "All systems running";
  const t = data.trials;

  return (
    <div className={`${s.root} ${idle ? s.idle : ""}`} data-office>
      <header className={s.head}>
        <div className={s.brand}>
          <span className={s.mark} aria-hidden="true" />
          <div>
            <b>JobFlex · Office</b>
            <span>{now != null ? fmt.date.format(now) : ""}</span>
          </div>
        </div>
        <div className={s.clock} data-office-clock>
          {now != null ? fmt.time.format(now) : "—"}
        </div>
        <div className={s.status}>
          <span className={`${s.live} ${failing ? s.liveOff : ""}`} data-office-live={failing ? "off" : "on"}>
            <i aria-hidden="true" />
            {failing ? `Reconnecting — last good ${ago}s ago` : `Live · updated ${ago < 5 ? "just now" : `${ago}s ago`}`}
          </span>
          <span className={`${s.sys} ${healthBad.some((x) => x.level === "down") ? s.sysBad : healthBad.length ? s.sysWarn : s.sysOk}`} data-office-sys>
            <i aria-hidden="true" />
            {sysWord}
          </span>
          <div className={s.acts}>
            <button type="button" onClick={goFull} className={s.btn} data-office-full>
              {full ? "Exit full screen" : "Full screen"}
            </button>
            {!full ? (
              <a href="/admin" className={s.btn}>
                Admin
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <section className={s.tiles} aria-label="Today against yesterday at this time">
        {data.tiles.map((x) => (
          <Tile key={x.key} t={x} big />
        ))}
      </section>
      <section className={s.strip} aria-label="More of today">
        {data.strip.map((x) => (
          <Tile key={x.key} t={x} />
        ))}
      </section>

      <main className={s.main}>
        {/* TODAY — as it happened */}
        <section className={s.panel} data-office-feed>
          <h2 className={s.ph}>
            Today <span>{data.feed.length ? `${data.feed.length} things so far` : "quiet so far"}</span>
          </h2>
          {data.feed.length ? (
            <ol className={s.feed}>
              {data.feed.map((f) => {
                const k = `${f.at}|${f.kind}|${f.who}`;
                const fresh = freshKeys.has(k);
                return (
                  <li key={k} className={`${s.fi} ${s[`k_${f.kind}`] ?? ""} ${f.win ? s.win : ""} ${fresh ? s.fresh : ""}`} data-kind={f.kind}>
                    <time className={s.ft}>{fmt.short.format(f.at)}</time>
                    <span className={s.fk}>{KIND_WORDS[f.kind]}</span>
                    <span className={s.fx}>
                      <b>{f.who}</b>
                      {f.text.startsWith("'s") ? "" : " "}
                      {f.text}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className={s.empty}>Nothing yet today. Signups, proposals, payments and requests show here the moment they happen.</p>
          )}
        </section>

        <div className={`${s.col} ${s.colMid}`}>
          {/* ONLINE NOW */}
          <section className={s.panel} data-office-online>
            <h2 className={s.ph}>
              In the app now <span>{data.online.length} · {n(data.activeToday)} today</span>
            </h2>
            {data.online.length ? (
              <ul className={s.online} ref={onRef}>
                {data.online.map((o) => {
                  const mins = now != null ? Math.max(0, Math.round((now - o.at) / 60_000)) : 0;
                  return (
                    <li key={`${o.name}|${o.company}`}>
                      <i className={mins <= 2 ? s.dotOn : s.dotAway} aria-hidden="true" />
                      <span className={s.on1}>
                        <b>{o.name}</b> {o.company ? <em>{o.company}</em> : null}
                      </span>
                      <span className={s.on2}>{o.screen}</span>
                      <span className={s.on3}>{mins <= 1 ? "now" : `${mins} min`}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={s.empty}>Nobody in the app this minute.</p>
            )}
            {onFit != null && onFit < data.online.length ? <p className={s.more}>+{data.online.length - onFit} more in the app</p> : null}
          </section>
          {/* TRIALS & MONEY */}
          <section className={s.panel} data-office-trials>
            <h2 className={s.ph}>Trials &amp; money</h2>
            <dl className={s.money}>
              <div>
                <dt>On trial</dt>
                <dd>{n(t.onTrial)}</dd>
                <small>card {t.card} · no card {t.nocard}</small>
              </div>
              <div>
                <dt>Ending</dt>
                <dd>{t.endsToday}</dd>
                <small>today · {t.endsTomorrow} tomorrow</small>
              </div>
              <div>
                <dt>Paying</dt>
                <dd>{n(t.paying)}</dd>
                <small>{t.payingMonthlyCents > 0 ? `${usd(t.payingMonthlyCents)}/mo` : t.paying ? "plan prices not on file" : "no one yet"}</small>
              </div>
              <div>
                <dt>Likely worth</dt>
                <dd>{usd(t.likelyCents)}</dd>
                <small>a month{t.setToCancel ? ` · ${t.setToCancel} set to cancel` : ""}</small>
              </div>
            </dl>
          </section>
          {/* TREND */}
          <section className={`${s.panel} ${s.trend}`} data-office-trend>
            <Spark label="Signups" values={data.spark.signups} days={data.spark.days} fmtDay={(ms) => fmt.day.format(ms)} />
            <Spark label="Proposals made" values={data.spark.proposals} days={data.spark.days} fmtDay={(ms) => fmt.day.format(ms)} />
          </section>
        </div>

        <div className={`${s.col} ${s.colGrow}`}>
          {/* NEEDS YOU */}
          <section className={s.panel} data-office-attention>
            <h2 className={s.ph}>
              Needs you <span>{data.attention.length ? data.attention.length : "nothing"}</span>
            </h2>
            {data.attention.length ? (
              <ul className={s.att} ref={attRef}>
                {data.attention.map((a, i) => (
                  <li key={i} className={s[`t_${a.tone}`]} data-tone={a.tone}>
                    <span>{a.text}</span>
                    {a.who?.length ? <em>{a.who.slice(0, 4).join(" · ")}{a.who.length > 4 ? ` · +${a.who.length - 4}` : ""}</em> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.empty}>All clear — nothing waiting on a person.</p>
            )}
            {attFit != null && attFit < data.attention.length ? <p className={s.more} data-office-more>+{data.attention.length - attFit} more — the trials and support pages have them all</p> : null}
          </section>
          {/* SYSTEMS */}
          <section className={s.panel} data-office-health>
            <h2 className={s.ph}>
              Systems{" "}
              <span>{data.health ? `checked ${fmt.short.format(new Date(data.health.ranAt).getTime())}` : "no check stored yet"}</span>
            </h2>
            {data.health ? (
              <ul className={s.health}>
                {data.health.services.map((h) => (
                  <li key={h.name} className={s[`h_${h.level}`]} title={h.reason} data-level={h.level}>
                    <i aria-hidden="true" />
                    <span>{h.name}</span>
                    {h.level !== "ok" ? <em>{h.level === "off" ? "not set up" : h.level}</em> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.empty}>The nightly health check has not run here yet.</p>
            )}
          </section>
        </div>
      </main>
      {data.gaps.length ? <footer className={s.gaps}>Not read this time: {data.gaps.join(", ")}</footer> : null}
    </div>
  );
}
