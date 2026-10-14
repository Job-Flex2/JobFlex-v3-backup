"use client";

// Proposals v2 — "THE PROPOSAL DESK" client view.
// The reference dashboard's app shell (sidebar + topbar + content column)
// carried over verbatim from the jobflex-page-styler donor, with proposals
// content designed from the dashboard patterns: KPI strip, a clickable
// status funnel that filters the estimate-style Proposal Book, and two
// side cards. Motion System "Balanced": load cascade, adaptive scroll
// reveal, row stagger on filter change, KPI count-up, press effects,
// graph-paper parallax — all disabled under prefers-reduced-motion.

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./proposals-v2.module.css";

/* ── data contract (serialized by page.tsx) ─────────────────────────── */

export type DeskStatus =
  | "DRAFT"
  | "SENT"
  | "VIEWED"
  | "ACCEPTED"
  | "DECLINED"
  | "EXPIRED"
  | "PAID";

export interface DeskRow {
  id: string;
  title: string;
  status: DeskStatus;
  total: number;
  viewCount: number;
  clientName: string;
  clientPlace: string | null;
  ownerName: string | null;
  updatedAtMs: number;
  updatedLabel: string; // "JUL 14" — precomputed server-side (hydration-safe)
  waitDays: number | null; // days since sentAt, SENT/VIEWED only
  leftDays: number | null; // days until validUntil
}

interface Props {
  rows: DeskRow[];
  won30: number;
  userName: string;
  roleLabel: string;
  dateLabel: string; // "Jul 23"
}

/* ── static defs ────────────────────────────────────────────────────── */

type FilterKey = "ALL" | DeskStatus;
type SortKey = "newest" | "oldest" | "value" | "viewed";

const STATUS_LABEL: Record<DeskStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  VIEWED: "Viewed",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  EXPIRED: "Expired",
  PAID: "Paid",
};

const SORT_LABEL: Record<SortKey, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  value: "Highest value",
  viewed: "Most viewed",
};

const NAV: {
  sec: string;
  items: { label: string; icon: string; href: string; active?: boolean }[];
}[] = [
  {
    sec: "Work",
    items: [
      { label: "Overview", icon: "i-grid", href: "/dashboard" },
      { label: "Proposals", icon: "i-file", href: "/v3/proposals-v2", active: true },
      { label: "Clients", icon: "i-users", href: "/dashboard/clients" },
      { label: "Leads", icon: "i-target", href: "/dashboard/leads" },
      { label: "Projects", icon: "i-folder", href: "/dashboard/projects" },
      { label: "CRM", icon: "i-crm", href: "/dashboard/crm" },
    ],
  },
  {
    sec: "Delivery",
    items: [
      { label: "Calendar", icon: "i-cal", href: "/dashboard/calendar" },
      { label: "Jobs", icon: "i-jobs", href: "/dashboard/jobs" },
      { label: "Workers", icon: "i-hardhat", href: "/dashboard/workers" },
      { label: "Hire", icon: "i-userplus", href: "/dashboard/hire" },
      { label: "Company", icon: "i-building", href: "/dashboard/company" },
    ],
  },
  {
    sec: "Money",
    items: [{ label: "Financials", icon: "i-bank", href: "/dashboard/financials" }],
  },
  {
    sec: "Automation",
    items: [
      { label: "Smart Proposal", icon: "i-bulb", href: "/dashboard/proposals/ai" },
      { label: "Roof estimator", icon: "i-roof", href: "/dashboard/advanced-ai" },
      { label: "Fence estimator", icon: "i-fence", href: "/dashboard/advanced-ai" },
      { label: "AI desk", icon: "i-phone", href: "/dashboard/phone" },
      { label: "Messages", icon: "i-msg", href: "/dashboard/messages" },
      { label: "Reviews", icon: "i-thumb", href: "/dashboard/reviews" },
      { label: "Trade board", icon: "i-board", href: "/dashboard/trade" },
      { label: "Referrals", icon: "i-gift", href: "/dashboard/referrals" },
      { label: "Reports", icon: "i-chart", href: "/dashboard/reports" },
    ],
  },
];

const FUNNEL: { key: FilterKey; label: string; dot?: string }[] = [
  { key: "ALL", label: "All" },
  { key: "DRAFT", label: "Draft", dot: "draft" },
  { key: "SENT", label: "Sent", dot: "wait" },
  { key: "VIEWED", label: "Viewed", dot: "wait" },
  { key: "ACCEPTED", label: "Accepted", dot: "won" },
  { key: "PAID", label: "Paid", dot: "won" },
  { key: "DECLINED", label: "Declined", dot: "dead" },
  { key: "EXPIRED", label: "Expired", dot: "dead" },
];

const EASE_OUT = "cubic-bezier(0.22, 0.61, 0.36, 1)";

/* ── helpers ────────────────────────────────────────────────────────── */

function fmtMoney(n: number) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function chipClass(status: DeskStatus) {
  if (status === "ACCEPTED" || status === "PAID") return styles.chipOk;
  if (status === "SENT" || status === "VIEWED") return styles.chipWait;
  if (status === "DECLINED" || status === "EXPIRED") return styles.chipDead;
  return styles.chipDraft;
}

function dotClass(dot?: string) {
  if (dot === "draft") return `${styles.fDot} ${styles.fDotDraft}`;
  if (dot === "wait") return `${styles.fDot} ${styles.fDotWait}`;
  if (dot === "won") return `${styles.fDot} ${styles.fDotWon}`;
  if (dot === "dead") return `${styles.fDot} ${styles.fDotDead}`;
  return styles.fDot;
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* Donor row-stagger: fade + translateY(8px), 300ms, 45ms stagger. */
function staggerRows(els: HTMLElement[]) {
  els.forEach((r, i) => {
    const d = Math.min(i, 20) * 45;
    r.style.opacity = "0";
    r.style.transform = "translateY(8px)";
    r.style.transition = `opacity 300ms ${EASE_OUT} ${d}ms, transform 300ms ${EASE_OUT} ${d}ms`;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        r.style.opacity = "1";
        r.style.transform = "none";
        r.addEventListener(
          "transitionend",
          () => {
            r.style.transition = "";
            r.style.opacity = "";
            r.style.transform = "";
          },
          { once: true },
        );
      }),
    );
  });
}

/* ── component ──────────────────────────────────────────────────────── */

export function ProposalsDesk({ rows, won30, userName, roleLabel, dateLabel }: Props) {
  const [filterKey, setFilterKey] = useState<FilterKey>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [query, setQuery] = useState("");
  const [ddOpen, setDdOpen] = useState(false);

  const layoutRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sbScrollRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const activeLinkRef = useRef<HTMLAnchorElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const bookRowsRef = useRef<HTMLDivElement>(null);
  const ddRef = useRef<HTMLDivElement>(null);

  // Mobile nav drawer (donor: burger toggles .sb.open + overlay)
  const [navOpen, setNavOpen] = useState(false);

  // FLUID SCALE — donor module. The reference composition is a MacBook 16"
  // (1728 CSS px viewport); on any other screen the whole interface scales
  // proportionally. Bare 100vh drifts under root zoom, so the real viewport
  // height is published as --app-h (consumed by .layout/.sb).
  useEffect(() => {
    const BASE = 1728,
      MIN = 0.78,
      MAX = 1.35;
    const applyScale = () => {
      const z = window.innerWidth <= 860 ? 1 : Math.min(MAX, Math.max(MIN, window.innerWidth / BASE));
      document.documentElement.style.setProperty("zoom", String(z));
      document.documentElement.style.setProperty("--app-h", window.innerHeight / z + "px");
    };
    applyScale();
    window.addEventListener("resize", applyScale);
    return () => {
      window.removeEventListener("resize", applyScale);
      document.documentElement.style.removeProperty("zoom");
      document.documentElement.style.removeProperty("--app-h");
    };
  }, []);

  /* ── derived data ──────────────────────────────────────────────── */

  const byStatus = useMemo(() => {
    const m = new Map<DeskStatus, { n: number; sum: number }>();
    for (const r of rows) {
      const cur = m.get(r.status) ?? { n: 0, sum: 0 };
      cur.n += 1;
      cur.sum += r.total;
      m.set(r.status, cur);
    }
    return m;
  }, [rows]);

  const at = (s: DeskStatus) => byStatus.get(s) ?? { n: 0, sum: 0 };

  const openValue = at("DRAFT").sum + at("SENT").sum + at("VIEWED").sum;
  const awaiting = at("SENT").n + at("VIEWED").n;
  const wins = at("ACCEPTED").n + at("PAID").n;
  const losses = at("DECLINED").n + at("EXPIRED").n;
  const winRate = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : null;
  const bookSum = rows.reduce((acc, r) => acc + r.total, 0);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rows;
    if (filterKey !== "ALL") list = list.filter((r) => r.status === filterKey);
    if (q) {
      list = list.filter((r) =>
        [r.title, r.clientName, r.ownerName ?? "", STATUS_LABEL[r.status]]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    const sorted = list.slice();
    if (sortKey === "newest") sorted.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    if (sortKey === "oldest") sorted.sort((a, b) => a.updatedAtMs - b.updatedAtMs);
    if (sortKey === "value") sorted.sort((a, b) => b.total - a.total);
    if (sortKey === "viewed") sorted.sort((a, b) => b.viewCount - a.viewCount);
    return sorted;
  }, [rows, filterKey, sortKey, query]);

  const visibleSum = visible.reduce((acc, r) => acc + r.total, 0);

  const nudge = useMemo(
    () =>
      rows
        .filter((r) => r.status === "SENT" || r.status === "VIEWED")
        .sort((a, b) => (b.waitDays ?? 0) - (a.waitDays ?? 0)),
    [rows],
  );
  const nudgeSum = nudge.reduce((acc, r) => acc + r.total, 0);

  const closing = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            r.leftDays !== null &&
            r.leftDays >= 0 &&
            r.leftDays <= 14 &&
            (r.status === "DRAFT" || r.status === "SENT" || r.status === "VIEWED"),
        )
        .sort((a, b) => (a.leftDays ?? 0) - (b.leftDays ?? 0)),
    [rows],
  );
  const closingSum = closing.reduce((acc, r) => acc + r.total, 0);

  const kpis: { label: string; text: string; target: number | null; fmt: string; accent?: boolean }[] = [
    { label: "Open Value", text: fmtMoney(openValue), target: openValue, fmt: "money", accent: true },
    { label: "Awaiting Decision", text: String(awaiting), target: awaiting, fmt: "int" },
    { label: "Won · 30D", text: fmtMoney(won30), target: won30, fmt: "money" },
    {
      label: "Win Rate",
      text: winRate === null ? "—" : `${winRate}%`,
      target: winRate,
      fmt: "pct",
    },
  ];

  /* ── motion: load cascade, reveal, count-up, press, parallax ───── */

  useEffect(() => {
    if (reducedMotion()) return;
    const content = contentRef.current;
    const main = mainRef.current;
    if (!content || !main) return;

    const vpH = window.innerHeight;
    let velLastY = main.scrollTop;
    let velLastT = performance.now();
    let scrollVel = 0;
    const onVel = () => {
      const now = performance.now();
      scrollVel = Math.abs(main.scrollTop - velLastY) / Math.max(1, now - velLastT);
      velLastY = main.scrollTop;
      velLastT = now;
    };
    main.addEventListener("scroll", onVel, { passive: true });

    const blocks = Array.from(content.querySelectorAll<HTMLElement>("[data-rv]"));
    blocks.forEach((el, i) => {
      el.classList.add(styles.rv);
      const initial = el.getBoundingClientRect().top < vpH;
      if (!initial) el.dataset.rvScroll = "1";
      el.style.transitionDelay = initial ? `${i * 60}ms` : "200ms";
    });
    const cells = Array.from(content.querySelectorAll<HTMLElement>("[data-rv-cell]"));
    cells.forEach((el, i) => {
      el.classList.add(styles.rvCell);
      const initial = el.getBoundingClientRect().top < vpH;
      if (!initial) el.dataset.rvScroll = "1";
      el.style.transitionDelay = initial ? `${160 + (i % 8) * 45}ms` : "200ms";
    });
    const io = new IntersectionObserver(
      (es) => {
        es.forEach((en) => {
          if (!en.isIntersecting) return;
          const el = en.target as HTMLElement;
          if (el.dataset.rvScroll) {
            el.style.transitionDuration = `${Math.round(Math.max(550, 900 - scrollVel * 160))}ms`;
          }
          el.classList.add(styles.rvIn);
          io.unobserve(el);
          el.addEventListener(
            "transitionend",
            () => {
              el.style.transitionDelay = "";
              el.style.transitionDuration = "";
            },
            { once: true },
          );
        });
      },
      { threshold: 0, rootMargin: "0px 0px 60px 0px" },
    );
    blocks.concat(cells).forEach((el) => io.observe(el));

    // Sidebar cascade (dx -8px, 320ms, stagger 22ms)
    const sbItems = Array.from(
      (sbScrollRef.current ?? content).querySelectorAll<HTMLElement>("[data-sb]"),
    );
    sbItems.forEach((el, i) => {
      el.style.opacity = "0";
      el.style.transform = "translateX(-8px)";
      el.style.transition = `opacity 320ms ${EASE_OUT} ${i * 22}ms, transform 320ms ${EASE_OUT} ${i * 22}ms`;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          el.style.opacity = "";
          el.style.transform = "";
          el.addEventListener("transitionend", () => (el.style.transition = ""), { once: true });
        }),
      );
    });

    // KPI count-up (750ms easeOutCubic, tabular-nums keep columns steady)
    const vals = Array.from(content.querySelectorAll<HTMLElement>("[data-count]"));
    vals.forEach((el) => {
      const target = parseFloat(el.dataset.count ?? "");
      if (!isFinite(target)) return;
      const fmt = el.dataset.fmt;
      let t0: number | null = null;
      const frame = (t: number) => {
        if (t0 === null) t0 = t;
        const pr = Math.min(1, (t - t0) / 750);
        const e = 1 - Math.pow(1 - pr, 3);
        const v = Math.round(target * e);
        el.textContent =
          fmt === "money" ? fmtMoney(v) : fmt === "pct" ? `${v}%` : v.toLocaleString("en-US");
        if (pr < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });

    // Graph-paper parallax
    let ticking = false;
    const onPar = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        main.style.setProperty("--gy", `${(-(main.scrollTop * 0.06)).toFixed(1)}px`);
        ticking = false;
      });
    };
    main.addEventListener("scroll", onPar, { passive: true });

    return () => {
      io.disconnect();
      main.removeEventListener("scroll", onVel);
      main.removeEventListener("scroll", onPar);
    };
  }, []);

  // Sliding indicator plate under the active sidebar item
  useEffect(() => {
    const place = () => {
      const link = activeLinkRef.current;
      const ind = indicatorRef.current;
      if (!link || !ind) return;
      ind.style.top = `${link.offsetTop}px`;
      ind.style.height = `${link.offsetHeight}px`;
      requestAnimationFrame(() => ind.classList.add(styles.sbIndicatorReady));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);

  // Press effects (donor pressify), delegated so re-renders keep working
  useEffect(() => {
    const root = layoutRef.current;
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      if (reducedMotion()) return;
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-press]");
      if (!t || !root.contains(t)) return;
      const cls = t.dataset.press === "cell" ? styles.fPressed : styles.pressed;
      t.classList.remove(cls);
      void t.offsetWidth;
      t.classList.add(cls);
      t.addEventListener("animationend", () => t.classList.remove(cls), { once: true });
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, []);

  // ⌘K / Ctrl+K focuses the book search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close the sort dropdown on outside click
  useEffect(() => {
    if (!ddOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!ddRef.current?.contains(e.target as Node)) setDdOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [ddOpen]);

  // Book rows re-stagger when the filter or sort changes (not on typing)
  useEffect(() => {
    if (reducedMotion()) return;
    const wrap = bookRowsRef.current;
    if (!wrap) return;
    staggerRows(Array.from(wrap.querySelectorAll<HTMLElement>("[data-book-row]")));
  }, [filterKey, sortKey]);

  // Side lists stagger once on load
  useEffect(() => {
    if (reducedMotion()) return;
    const content = contentRef.current;
    if (!content) return;
    staggerRows(Array.from(content.querySelectorAll<HTMLElement>("[data-side-row]")));
  }, []);

  /* ── render ────────────────────────────────────────────────────── */

  const initial = (userName.trim().charAt(0) || "O").toUpperCase();
  const filterLabel = filterKey === "ALL" ? "Book" : STATUS_LABEL[filterKey];

  return (
    <div className={styles.layout} ref={layoutRef}>
      <Sprite />

      <div
        className={navOpen ? `${styles.sbOverlay} ${styles.sbOverlayOn}` : styles.sbOverlay}
        onClick={() => setNavOpen(false)}
      />

      {/* ── SIDEBAR — donor markup, active on Proposals ─────────────── */}
      <aside
        className={navOpen ? `${styles.sb} ${styles.sbOpen}` : styles.sb}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) setNavOpen(false);
        }}
      >
        <div className={styles.sbHead}>
          <svg className={styles.sbMark} viewBox="0 0 24 24" aria-hidden>
            <use href="#i-logo" />
          </svg>
          <div className={styles.sbHeadTxt}>
            <div className={styles.sbHeadName}>JOBFLEX</div>
            <div className={styles.sbHeadSub}>Contractor OS</div>
          </div>
        </div>

        <nav className={styles.sbScroll} ref={sbScrollRef} aria-label="Navigation">
          <div className={styles.sbIndicator} ref={indicatorRef} aria-hidden />
          {NAV.map((sec) => (
            <div key={sec.sec}>
              <div className={styles.sbSecLabel} data-sb>
                {sec.sec}
              </div>
              {sec.items.map((it) => (
                <Link
                  key={it.label}
                  href={it.href as Route}
                  className={`${styles.sbLink} ${it.active ? styles.sbActive : ""}`}
                  aria-current={it.active ? "page" : undefined}
                  ref={it.active ? activeLinkRef : undefined}
                  data-sb
                >
                  <svg className={styles.ic} aria-hidden>
                    <use href={`#${it.icon}`} />
                  </svg>
                  {it.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className={styles.sbFoot}>
          <Link
            href={"/dashboard/settings" as Route}
            className={styles.sbFootAcc}
            title="Account"
            data-press
          >
            <span className={styles.sbFootAv}>{initial}</span>
            <span className={styles.sbFootTxt}>
              <span className={styles.sbFootName}>{userName}</span>
              <span className={styles.sbFootRole}>{roleLabel}</span>
            </span>
          </Link>
          <Link
            href={"/dashboard/settings" as Route}
            className={styles.sbFootIc}
            title="Settings"
            aria-label="Settings"
            data-press
          >
            <svg className={styles.ic} aria-hidden>
              <use href="#i-gear" />
            </svg>
          </Link>
        </div>
      </aside>

      {/* ── MAIN ────────────────────────────────────────────────────── */}
      <div className={styles.main} ref={mainRef}>
        <header className={styles.topbar}>
          <button
            className={`${styles.iconBtn} ${styles.navBurger}`}
            type="button"
            aria-label="Open navigation"
            onClick={() => setNavOpen((o) => !o)}
          >
            <svg className={styles.ic} aria-hidden>
              <use href="#i-menu" />
            </svg>
          </button>
          <label className={styles.search}>
            <svg className={styles.ic} aria-hidden>
              <use href="#i-search" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              placeholder="Search proposals, clients…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search proposals"
            />
            <kbd>⌘K</kbd>
          </label>

          <div className={styles.topbarRight}>
            <Link
              href={"/dashboard/proposals/new" as Route}
              className={`${styles.btn} ${styles.btnPrimary}`}
              data-press
            >
              <svg className={styles.ic} aria-hidden>
                <use href="#i-plus" />
              </svg>
              New Estimate
            </Link>
            <button className={styles.iconBtn} title="Notifications" aria-label="Notifications" data-press>
              <svg className={styles.ic} aria-hidden>
                <use href="#i-bell" />
              </svg>
              <span className={styles.bellDot} />
            </button>
          </div>
        </header>

        <div className={styles.content} ref={contentRef}>
          {/* PAGE HEAD */}
          <div className={styles.pageHead} data-rv>
            <div>
              <div className={styles.kicker}>
                {rows.length} on file · {dateLabel}
              </div>
              <h1 className={styles.pageTitle}>Proposals</h1>
            </div>
            <div className={styles.pageActions}>
              <Link
                href={"/dashboard/proposals/ai" as Route}
                className={`${styles.btn} ${styles.btnPrimary}`}
                data-press
              >
                <svg className={styles.ic} aria-hidden>
                  <use href="#i-bulb" />
                </svg>
                Smart Proposal
              </Link>
              <Link
                href={"/dashboard/proposals/new" as Route}
                className={`${styles.btn} ${styles.btnGhost}`}
                data-press
              >
                <svg className={styles.ic} aria-hidden>
                  <use href="#i-file" />
                </svg>
                Manual proposal
              </Link>
            </div>
          </div>

          {/* KPI STRIP */}
          <div className={styles.kpiGrid} data-rv>
            {kpis.map((k) => (
              <div key={k.label} className={styles.kpi} data-rv-cell>
                <div className={styles.kpiLbl}>{k.label}</div>
                <div
                  className={`${styles.kpiVal} ${k.accent ? styles.kpiAccent : ""}`}
                  data-count={k.target ?? undefined}
                  data-fmt={k.fmt}
                >
                  {k.text}
                </div>
              </div>
            ))}
          </div>

          {/* FUNNEL STRIP — click a stage to filter the book */}
          <div className={styles.funnel} data-rv role="group" aria-label="Filter by status">
            {FUNNEL.map((f) => {
              const stat =
                f.key === "ALL" ? { n: rows.length, sum: bookSum } : at(f.key as DeskStatus);
              const on = filterKey === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  className={`${styles.fCell} ${on ? styles.fOn : ""}`}
                  aria-pressed={on}
                  onClick={() => setFilterKey(f.key)}
                  data-press="cell"
                >
                  <span className={styles.fLbl}>
                    <span className={dotClass(f.dot)} aria-hidden />
                    {f.label}
                  </span>
                  <span className={styles.fCount}>{stat.n}</span>
                  <div className={styles.fSum}>{fmtMoney(stat.sum)}</div>
                </button>
              );
            })}
          </div>

          {/* BOOK + SIDE CARDS */}
          <div className={styles.grid23}>
            <div className={styles.card} data-rv>
              <div className={styles.cardHead}>
                <div className={styles.cardTitles}>
                  <div className={styles.cardTitle}>Proposal Book</div>
                  <div className={styles.cardSub}>
                    {visible.length} of {rows.length} · <b>{fmtMoney(visibleSum)}</b>
                  </div>
                </div>
                <div className={styles.cardTools}>
                  <Link href={"/dashboard/proposals" as Route} className={styles.cardLink}>
                    Classic
                    <svg className={styles.ic} aria-hidden>
                      <use href="#i-arrow" />
                    </svg>
                  </Link>
                  <div className={`${styles.dd} ${ddOpen ? styles.ddOpen : ""}`} ref={ddRef}>
                    <button
                      type="button"
                      className={styles.ddBtn}
                      aria-haspopup="listbox"
                      aria-expanded={ddOpen}
                      onClick={() => setDdOpen((v) => !v)}
                    >
                      <span>{SORT_LABEL[sortKey]}</span>
                      <svg className={styles.ic} aria-hidden>
                        <use href="#i-chev" />
                      </svg>
                    </button>
                    <div className={styles.ddMenu} role="listbox">
                      {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                        <button
                          key={k}
                          type="button"
                          role="option"
                          aria-selected={sortKey === k}
                          className={`${styles.ddItem} ${sortKey === k ? styles.ddItemActive : ""}`}
                          onClick={() => {
                            setSortKey(k);
                            setDdOpen(false);
                          }}
                          data-press
                        >
                          {SORT_LABEL[k]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.bookCols} aria-hidden>
                <span>№</span>
                <span>Proposal</span>
                <span>Status</span>
                <span>Updated</span>
                <span>Views</span>
                <span>Total</span>
              </div>

              <div className={styles.bookRows} ref={bookRowsRef}>
                {visible.length > 0 ? (
                  visible.map((r, i) => (
                    <Link
                      key={r.id}
                      href={`/dashboard/proposals/${r.id}` as Route}
                      className={styles.bookRow}
                      data-book-row
                    >
                      <span className={styles.bNum}>{String(i + 1).padStart(2, "0")}</span>
                      <span className={styles.bMain}>
                        <span className={styles.bTitle}>{r.title}</span>
                        <span className={styles.bSub}>
                          {r.clientName}
                          {r.clientPlace ? ` · ${r.clientPlace}` : ""}
                          {r.ownerName ? ` · ${r.ownerName}` : ""}
                        </span>
                      </span>
                      <span>
                        <span className={`${styles.chip} ${chipClass(r.status)}`}>
                          {STATUS_LABEL[r.status]}
                        </span>
                      </span>
                      <span className={styles.bDate}>{r.updatedLabel}</span>
                      <span className={styles.bViews}>
                        {r.viewCount > 0 ? `${r.viewCount}×` : "—"}
                      </span>
                      <span className={styles.bTotal}>{fmtMoney(r.total)}</span>
                    </Link>
                  ))
                ) : (
                  <div className={styles.empty} data-book-row>
                    {rows.length === 0 ? (
                      <>
                        No proposals on file —{" "}
                        <Link href={"/dashboard/proposals/new" as Route}>draft № 001 →</Link>
                      </>
                    ) : (
                      <>Nothing matches {query ? `“${query}”` : `“${filterLabel}”`} — clear the filter.</>
                    )}
                  </div>
                )}
              </div>

              {visible.length > 0 && (
                <div className={styles.bookTotal}>
                  <span className={styles.bookTotalLbl}>
                    {filterKey === "ALL" ? "Book total" : `${filterLabel} total`}
                  </span>
                  <span className={styles.bookTotalVal}>{fmtMoney(visibleSum)}</span>
                </div>
              )}
            </div>

            <div className={styles.sideStack}>
              {/* AWAITING SIGNATURE */}
              <div className={styles.card} data-rv>
                <div className={styles.cardHead}>
                  <div className={styles.cardTitles}>
                    <div className={styles.cardTitle}>Awaiting Signature</div>
                    {nudge.length > 0 && (
                      <div className={styles.cardSub}>
                        {nudge.length} out · <b>{fmtMoney(nudgeSum)}</b>
                      </div>
                    )}
                  </div>
                </div>
                <hr className={styles.cardRule} />
                <div className={`${styles.list} ${nudge.length >= 5 ? styles.listScroll : ""}`}>
                  {nudge.length > 0 ? (
                    <>
                      {nudge.map((r) => (
                        <div key={r.id} className={styles.nRow} data-side-row>
                          <span
                            className={`${styles.tag} ${
                              (r.waitDays ?? 0) >= 7 ? styles.tagWarn : ""
                            }`}
                          >
                            {r.waitDays !== null ? `${r.waitDays}d out` : "out"}
                          </span>
                          <span className={styles.nInfo}>
                            <span className={styles.nTitle}>{r.clientName}</span>
                            <span className={styles.nSub}>{r.title}</span>
                          </span>
                          <span className={styles.nVal}>{fmtMoney(r.total)}</span>
                        </div>
                      ))}
                      {nudge.length > 10 && (
                        <Link
                          href={"/dashboard/proposals" as Route}
                          className={styles.cardFootBtn}
                          data-press
                        >
                          Go to classic list
                          <svg className={styles.ic} aria-hidden>
                            <use href="#i-arrow" />
                          </svg>
                        </Link>
                      )}
                    </>
                  ) : (
                    <div className={styles.empty} data-side-row>
                      Nothing waiting on a signature.
                    </div>
                  )}
                </div>
              </div>

              {/* CLOSING WINDOW */}
              <div className={styles.card} data-rv>
                <div className={styles.cardHead}>
                  <div className={styles.cardTitles}>
                    <div className={styles.cardTitle}>Closing Window</div>
                    {closing.length > 0 && (
                      <div className={styles.cardSub}>
                        {closing.length} expiring in 14 days · <b>{fmtMoney(closingSum)}</b>
                      </div>
                    )}
                  </div>
                </div>
                <hr className={styles.cardRule} />
                <div className={`${styles.list} ${closing.length >= 5 ? styles.listScroll : ""}`}>
                  {closing.length > 0 ? (
                    closing.map((r) => (
                      <div key={r.id} className={styles.nRow} data-side-row>
                        <span
                          className={`${styles.tag} ${
                            (r.leftDays ?? 99) <= 3 ? styles.tagWarn : ""
                          }`}
                        >
                          {r.leftDays === 0 ? "today" : `${r.leftDays}d left`}
                        </span>
                        <span className={styles.nInfo}>
                          <span className={styles.nTitle}>{r.clientName}</span>
                          <span className={styles.nSub}>{r.title}</span>
                        </span>
                        <span className={styles.nVal}>{fmtMoney(r.total)}</span>
                      </div>
                    ))
                  ) : (
                    <div className={styles.empty} data-side-row>
                      No expiration deadlines in the next 14 days.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── SVG sprite — donor symbols, 24×24 / stroke 2 / currentColor ────── */

function Sprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        <symbol id="i-logo" viewBox="0 0 24 24">
          <path d="M15 4v11a4 4 0 0 1-4 4 4 4 0 0 1-4-4" />
          <path d="M11 4h6" />
        </symbol>
        <symbol id="i-search" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </symbol>
        <symbol id="i-menu" viewBox="0 0 24 24">
          <path d="M4 6h16" />
          <path d="M4 12h16" />
          <path d="M4 18h16" />
        </symbol>
        <symbol id="i-grid" viewBox="0 0 24 24">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </symbol>
        <symbol id="i-file" viewBox="0 0 24 24">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M16 13H8" />
          <path d="M16 17H8" />
        </symbol>
        <symbol id="i-users" viewBox="0 0 24 24">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </symbol>
        <symbol id="i-target" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" />
        </symbol>
        <symbol id="i-folder" viewBox="0 0 24 24">
          <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
        </symbol>
        <symbol id="i-crm" viewBox="0 0 24 24">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="m8.6 13.5 6.8 4" />
          <path d="m15.4 6.5-6.8 4" />
        </symbol>
        <symbol id="i-cal" viewBox="0 0 24 24">
          <rect x="3" y="4" width="18" height="18" rx="1" />
          <path d="M16 2v4" />
          <path d="M8 2v4" />
          <path d="M3 10h18" />
        </symbol>
        <symbol id="i-jobs" viewBox="0 0 24 24">
          <rect x="2" y="7" width="20" height="14" rx="1" />
          <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
          <path d="M2 13h20" />
        </symbol>
        <symbol id="i-hardhat" viewBox="0 0 24 24">
          <path d="M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1z" />
          <path d="M10 10V5a2 2 0 1 1 4 0v5" />
          <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
        </symbol>
        <symbol id="i-userplus" viewBox="0 0 24 24">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M19 8v6" />
          <path d="M22 11h-6" />
        </symbol>
        <symbol id="i-building" viewBox="0 0 24 24">
          <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
          <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
          <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
          <path d="M10 6h4" />
          <path d="M10 10h4" />
          <path d="M10 14h4" />
          <path d="M10 18h4" />
        </symbol>
        <symbol id="i-bank" viewBox="0 0 24 24">
          <path d="M3 22h18" />
          <path d="M6 18v-7" />
          <path d="M10 18v-7" />
          <path d="M14 18v-7" />
          <path d="M18 18v-7" />
          <path d="m12 2 9 5H3z" />
        </symbol>
        <symbol id="i-roof" viewBox="0 0 24 24">
          <path d="m2 11 10-8 10 8" />
          <path d="M5 9v12h14V9" />
        </symbol>
        <symbol id="i-fence" viewBox="0 0 24 24">
          <path d="M4 21V8l2-3 2 3v13" />
          <path d="M10 21V8l2-3 2 3v13" />
          <path d="M16 21V8l2-3 2 3v13" />
          <path d="M2 12h20" />
          <path d="M2 17h20" />
        </symbol>
        <symbol id="i-phone" viewBox="0 0 24 24">
          <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.45c.9.34 1.84.57 2.8.7A2 2 0 0 1 22 16.9z" />
        </symbol>
        <symbol id="i-msg" viewBox="0 0 24 24">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </symbol>
        <symbol id="i-megaphone" viewBox="0 0 24 24">
          <path d="m3 11 18-5v12L3 13z" />
          <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
        </symbol>
        <symbol id="i-board" viewBox="0 0 24 24">
          <rect x="8" y="2" width="8" height="4" rx="1" />
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <path d="M12 11h4" />
          <path d="M12 16h4" />
          <path d="M8 11h.01" />
          <path d="M8 16h.01" />
        </symbol>
        <symbol id="i-gift" viewBox="0 0 24 24">
          <rect x="3" y="8" width="18" height="4" />
          <path d="M12 8v13" />
          <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
          <path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5" />
        </symbol>
        <symbol id="i-chart" viewBox="0 0 24 24">
          <path d="M3 3v18h18" />
          <path d="M18 17V9" />
          <path d="M13 17V5" />
          <path d="M8 17v-3" />
        </symbol>
        <symbol id="i-gear" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </symbol>
        <symbol id="i-plus" viewBox="0 0 24 24">
          <path d="M5 12h14" />
          <path d="M12 5v14" />
        </symbol>
        <symbol id="i-bell" viewBox="0 0 24 24">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </symbol>
        <symbol id="i-chev" viewBox="0 0 24 24">
          <path d="m6 9 6 6 6-6" />
        </symbol>
        <symbol id="i-arrow" viewBox="0 0 24 24">
          <path d="M7 7h10v10" />
          <path d="M7 17 17 7" />
        </symbol>
        <symbol id="i-bulb" viewBox="0 0 24 24">
          <path d="M9 15c-.2-1-.7-1.7-1.4-2.4A4.9 4.9 0 0 1 7.1 9.4a4.9 4.9 0 0 1 9.8 0c0 1.2-.5 2.3-1.5 3.2-.7.7-1.2 1.4-1.4 2.4" />
          <path d="M9.5 18h5" />
          <path d="M10.5 21h3" />
          <path d="M12 1.5V3" />
          <path d="m5.4 4.2 1.1 1.1" />
          <path d="m18.6 4.2-1.1 1.1" />
          <path d="M3 9.5h1.5" />
          <path d="M19.5 9.5H21" />
        </symbol>
        <symbol id="i-thumb" viewBox="0 0 24 24">
          <path d="M7 10v12" />
          <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
        </symbol>
      </defs>
    </svg>
  );
}
