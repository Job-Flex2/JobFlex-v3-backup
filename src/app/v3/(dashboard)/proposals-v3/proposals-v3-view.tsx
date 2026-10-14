"use client";

// Proposals v3 — the live proposals page's structure, blueprint-styled.
// Composition mirrors src/components/v3/proposals-c/proposals-c-view.tsx
// one-to-one: dateline head → revenue masthead (figure swaps per tab) →
// All / Accepted / Completed tab rail → per-tab sheet (ledger table /
// accepted dossiers / completed tear-sheets). Shell + Motion System
// "Balanced" carried over from the jobflex-page-styler donor. Read-only.

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./proposals-v3.module.css";

/* ── data contract (serialized by page.tsx) ─────────────────────────── */

export type V3Status =
  | "DRAFT"
  | "SENT"
  | "VIEWED"
  | "ACCEPTED"
  | "DECLINED"
  | "EXPIRED"
  | "PAID";

export interface ScheduleLine {
  id: string;
  label: string;
  amount: number; // resolved dollars (percent lines computed server-side)
  dueLabel: string | null; // "AUG 02" — precomputed (hydration-safe)
}

export interface V3Row {
  id: string;
  title: string;
  status: V3Status;
  total: number;
  viewCount: number;
  clientName: string;
  clientPlace: string | null;
  clientEmail: string | null;
  ownerName: string | null;
  materialCount: number;
  updatedAtMs: number;
  updatedLabel: string; // "JUL 14"
  sentLabel: string | null;
  acceptedLabel: string | null;
  paidLabel: string | null;
  installments: ScheduleLine[];
  beforeUrl: string | null;
  afterUrl: string | null;
}

interface Props {
  rows: V3Row[];
  userName: string;
  roleLabel: string;
  dateLabel: string; // "Jul 23"
}

/* ── static defs ────────────────────────────────────────────────────── */

type TabKey = "all" | "accepted" | "completed";
type StatusSubFilter = "ALL" | "DRAFT" | "SENT" | "DECLINED" | "EXPIRED";

const STATUS_LABEL: Record<V3Status, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  VIEWED: "Viewed",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  EXPIRED: "Expired",
  PAID: "Paid",
};

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "accepted", label: "Accepted" },
  { key: "completed", label: "Completed" },
];

const STATUS_CHIPS: { key: StatusSubFilter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "DRAFT", label: "Draft" },
  { key: "SENT", label: "Sent" },
  { key: "DECLINED", label: "Declined" },
  { key: "EXPIRED", label: "Expired" },
];

const NAV: {
  sec: string;
  items: { label: string; icon: string; href: string; active?: boolean }[];
}[] = [
  {
    sec: "Work",
    items: [
      { label: "Overview", icon: "i-grid", href: "/dashboard" },
      { label: "Proposals", icon: "i-file", href: "/v3/proposals-v3", active: true },
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

const EASE_OUT = "cubic-bezier(0.22, 0.61, 0.36, 1)";

/* ── helpers ────────────────────────────────────────────────────────── */

function fmtMoney(n: number) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function chipClass(status: V3Status) {
  if (status === "ACCEPTED" || status === "PAID") return styles.chipOk;
  if (status === "SENT" || status === "VIEWED") return styles.chipWait;
  if (status === "DECLINED" || status === "EXPIRED") return styles.chipDead;
  return styles.chipDraft;
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

export function ProposalsV3({ rows, userName, roleLabel, dateLabel }: Props) {
  const [tab, setTab] = useState<TabKey>("all");
  const [statusFilter, setStatusFilter] = useState<StatusSubFilter>("ALL");
  const [query, setQuery] = useState("");

  const layoutRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sbScrollRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const activeLinkRef = useRef<HTMLAnchorElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabInkRef = useRef<HTMLSpanElement>(null);
  const figureRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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

  /* ── derived data (same buckets as the live page) ──────────────── */

  const accepted = useMemo(() => rows.filter((r) => r.status === "ACCEPTED"), [rows]);
  const completed = useMemo(() => rows.filter((r) => r.status === "PAID"), [rows]);

  const totals = useMemo(
    () => ({
      allPipeline: rows.reduce((a, r) => a + r.total, 0),
      acceptedValue: accepted.reduce((a, r) => a + r.total, 0),
      completedValue: completed.reduce((a, r) => a + r.total, 0),
    }),
    [rows, accepted, completed],
  );

  const counts: Record<TabKey, number> = {
    all: rows.length,
    accepted: accepted.length,
    completed: completed.length,
  };

  // Masthead config per tab — mirrors the live page's RevenueMasthead logic.
  const masthead = useMemo(() => {
    if (tab === "all") {
      const drafts = rows.filter((r) => r.status === "DRAFT").length;
      const sent = rows.filter((r) => r.status === "SENT" || r.status === "VIEWED").length;
      return {
        primaryLabel: "",
        amount: totals.allPipeline,
        count: rows.length,
        countLabel: "Open proposals",
        secondary: [
          { label: "Drafts", value: String(drafts), tone: "muted" as const },
          { label: "Sent · viewed", value: String(sent), tone: "ink" as const },
          { label: "Accepted", value: String(accepted.length), tone: "accent" as const },
        ],
      };
    }
    if (tab === "accepted") {
      return {
        primaryLabel: "Money owed · work in motion",
        amount: totals.acceptedValue,
        count: accepted.length,
        countLabel: "Active jobs",
        secondary: [
          {
            label: "Avg contract",
            value: accepted.length > 0 ? fmtMoney(totals.acceptedValue / accepted.length) : "—",
            tone: "ink" as const,
          },
          { label: "Completed to date", value: String(completed.length), tone: "muted" as const },
        ],
      };
    }
    return {
      primaryLabel: "Banked · jobs closed",
      amount: totals.completedValue,
      count: completed.length,
      countLabel: "Filed jobs",
      secondary: [
        { label: "Lifetime jobs", value: String(completed.length), tone: "ink" as const },
        {
          label: "Avg job size",
          value: completed.length > 0 ? fmtMoney(totals.completedValue / completed.length) : "—",
          tone: "muted" as const,
        },
      ],
    };
  }, [tab, rows, accepted, completed, totals]);

  const chipCounts = useMemo(() => {
    const c: Record<StatusSubFilter, number> = {
      ALL: rows.length,
      DRAFT: 0,
      SENT: 0,
      DECLINED: 0,
      EXPIRED: 0,
    };
    for (const r of rows) {
      if (r.status === "DRAFT") c.DRAFT++;
      else if (r.status === "SENT") c.SENT++;
      else if (r.status === "DECLINED") c.DECLINED++;
      else if (r.status === "EXPIRED") c.EXPIRED++;
    }
    return c;
  }, [rows]);

  const ledgerRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rows;
    if (statusFilter !== "ALL") list = list.filter((r) => r.status === statusFilter);
    if (q) {
      list = list.filter((r) =>
        [r.title, r.clientName, r.ownerName ?? "", STATUS_LABEL[r.status]]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    return list;
  }, [rows, statusFilter, query]);

  /* ── motion: load cascade, reveal, press, parallax (donor) ─────── */

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
    blocks.forEach((el) => io.observe(el));

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

  // Sliding blueprint underline on the tab rail
  useEffect(() => {
    const place = () => {
      const rail = tabsRef.current;
      const ink = tabInkRef.current;
      if (!rail || !ink) return;
      const on = rail.querySelector<HTMLElement>(`[data-tab-on="1"]`);
      if (!on) return;
      ink.style.left = `${on.offsetLeft}px`;
      ink.style.width = `${on.offsetWidth}px`;
      requestAnimationFrame(() => ink.classList.add(styles.tabInkReady));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [tab]);

  // Masthead figure count-up (750ms easeOutCubic) on tab switch
  useEffect(() => {
    const el = figureRef.current;
    if (!el) return;
    const target = masthead.amount;
    if (reducedMotion()) {
      el.textContent = fmtMoney(target);
      return;
    }
    let raf = 0;
    let t0: number | null = null;
    const frame = (t: number) => {
      if (t0 === null) t0 = t;
      const pr = Math.min(1, (t - t0) / 750);
      const e = 1 - Math.pow(1 - pr, 3);
      el.textContent = fmtMoney(target * e);
      if (pr < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [tab, masthead.amount]);

  // Press effects (donor pressify), delegated so re-renders keep working
  useEffect(() => {
    const root = layoutRef.current;
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      if (reducedMotion()) return;
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-press]");
      if (!t || !root.contains(t)) return;
      t.classList.remove(styles.pressed);
      void t.offsetWidth;
      t.classList.add(styles.pressed);
      t.addEventListener("animationend", () => t.classList.remove(styles.pressed), { once: true });
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, []);

  // ⌘K / Ctrl+K focuses the search
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

  // Panel rows re-stagger when the tab or status filter changes
  useEffect(() => {
    if (reducedMotion()) return;
    const wrap = panelRef.current;
    if (!wrap) return;
    staggerRows(Array.from(wrap.querySelectorAll<HTMLElement>("[data-row]")));
  }, [tab, statusFilter]);

  /* ── render ────────────────────────────────────────────────────── */

  const initial = (userName.trim().charAt(0) || "O").toUpperCase();

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
          {/* PAGE HEAD — the live page's dateline row */}
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

          {/* REVENUE MASTHEAD — figure + readouts swap with the tab */}
          <section className={styles.masthead} data-rv>
            <div className={styles.mhEyebrowRow}>
              {masthead.primaryLabel && (
                <>
                  <span className={`${styles.eyebrow} ${styles.eyebrowAccent}`}>
                    {masthead.primaryLabel}
                  </span>
                  <span className={styles.mhRule} aria-hidden />
                </>
              )}
              <span className={`${styles.eyebrow} ${styles.eyebrowFaint}`}>
                {masthead.countLabel}
                <span className={styles.mhCount}>{masthead.count}</span>
              </span>
            </div>
            <div className={styles.mhFigure} ref={figureRef}>
              {fmtMoney(masthead.amount)}
            </div>
            <div className={styles.mhSecondary}>
              {masthead.secondary.map((s) => (
                <div key={s.label} className={styles.mhStat}>
                  <span className={`${styles.eyebrow} ${styles.eyebrowFaint}`}>{s.label}</span>
                  <span
                    className={`${styles.mhStatVal} ${
                      s.tone === "accent"
                        ? styles.mhStatAccent
                        : s.tone === "muted"
                          ? styles.mhStatMuted
                          : ""
                    }`}
                  >
                    {s.value}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* TAB RAIL — All / Accepted / Completed */}
          <div className={styles.tabs} ref={tabsRef} role="tablist" aria-label="Proposals view" data-rv>
            <span className={styles.tabInk} ref={tabInkRef} aria-hidden />
            {TABS.map((t) => {
              const on = t.key === tab;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  className={`${styles.tab} ${on ? styles.tabOn : ""}`}
                  data-tab-on={on ? "1" : undefined}
                  onClick={() => setTab(t.key)}
                  data-press
                >
                  <span className={styles.tabLbl}>{t.label}</span>
                  <span className={styles.tabCount}>
                    {counts[t.key].toString().padStart(2, "0")}
                  </span>
                </button>
              );
            })}
          </div>

          {/* PANEL — one sheet per tab, same structure as the live page */}
          <div className={styles.panel} ref={panelRef} data-rv>
            {tab === "all" && (
              <>
                <div className={styles.filterRow} role="group" aria-label="Filter by status">
                  <span className={styles.filterLbl}>Status</span>
                  {STATUS_CHIPS.map((c) => {
                    const on = statusFilter === c.key;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        aria-pressed={on}
                        className={`${styles.fChip} ${on ? styles.fChipOn : ""}`}
                        onClick={() => setStatusFilter(c.key)}
                        data-press
                      >
                        {c.label}
                        <span className={styles.fChipN}>{chipCounts[c.key]}</span>
                      </button>
                    );
                  })}
                </div>

                {ledgerRows.length === 0 ? (
                  <EmptyState
                    eyebrow="Nothing in this view"
                    title={
                      rows.length === 0
                        ? "No proposals yet"
                        : query
                          ? `Nothing matches “${query}”`
                          : `Nothing ${statusFilter.toLowerCase()} right now`
                    }
                  >
                    {rows.length === 0 ? (
                      <>
                        Draft № 001 with{" "}
                        <Link href={"/dashboard/proposals/new" as Route}>Manual proposal</Link> — it
                        lands here, alongside everything else in flight.
                      </>
                    ) : (
                      <>When a proposal hits this stage, it&apos;ll appear on this sheet.</>
                    )}
                  </EmptyState>
                ) : (
                  <div className={styles.ledger}>
                    <div className={styles.lCols} aria-hidden>
                      <span>№</span>
                      <span>Proposal</span>
                      <span>Created by</span>
                      <span>Status</span>
                      <span>Views</span>
                      <span>Updated</span>
                      <span>Total</span>
                    </div>
                    {ledgerRows.map((r, i) => (
                      <Link
                        key={r.id}
                        href={`/dashboard/proposals/${r.id}` as Route}
                        className={styles.lRow}
                        data-row
                      >
                        <span className={styles.lNum}>
                          {String(ledgerRows.length - i).padStart(3, "0")}
                        </span>
                        <span className={styles.lMain}>
                          <span className={styles.lTitle}>{r.title}</span>
                          <span className={styles.lSub}>
                            {r.clientName}
                            {r.clientPlace ? ` · ${r.clientPlace}` : ""}
                          </span>
                        </span>
                        <span className={styles.lBy}>
                          {r.ownerName ? (
                            <>
                              <span className={styles.lByAv}>
                                {r.ownerName.trim().charAt(0).toUpperCase()}
                              </span>
                              <span className={styles.lByName}>{r.ownerName}</span>
                            </>
                          ) : (
                            <span className={styles.lByNone}>Unassigned</span>
                          )}
                        </span>
                        <span>
                          <span className={`${styles.chip} ${chipClass(r.status)}`}>
                            {STATUS_LABEL[r.status]}
                          </span>
                        </span>
                        <span className={styles.lViews}>
                          {r.viewCount > 0 ? `${r.viewCount}×` : "—"}
                        </span>
                        <span className={styles.lDate}>{r.updatedLabel}</span>
                        <span className={styles.lTotal}>{fmtMoney(r.total)}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === "accepted" &&
              (accepted.length === 0 ? (
                <EmptyState eyebrow="Nothing in this view" title="No signed work yet">
                  When a client accepts a proposal, the contract files itself on this sheet.
                </EmptyState>
              ) : (
                <div className={styles.stack}>
                  {accepted.map((r) => (
                    <article key={r.id} className={styles.dossier} data-row>
                      <header className={styles.dHead}>
                        <div className={styles.dHeadMain}>
                          <div className={styles.dMetaRow}>
                            <span className={`${styles.chip} ${styles.chipOk}`}>Accepted</span>
                            {r.acceptedLabel && (
                              <span className={styles.dTag}>signed {r.acceptedLabel}</span>
                            )}
                          </div>
                          <Link
                            href={`/dashboard/proposals/${r.id}` as Route}
                            className={styles.dTitleLink}
                          >
                            <span className={styles.dTitle}>{r.title}</span>
                            <svg className={styles.ic} aria-hidden>
                              <use href="#i-arrow" />
                            </svg>
                          </Link>
                          <div className={styles.dSub}>
                            {r.clientName}
                            {r.clientPlace ? ` · ${r.clientPlace}` : ""}
                            {r.ownerName ? ` · ${r.ownerName}` : ""}
                          </div>
                        </div>
                        <div className={styles.dAmt}>
                          <span className={`${styles.eyebrow} ${styles.eyebrowFaint}`}>
                            Contract
                          </span>
                          <div className={styles.dAmtVal}>{fmtMoney(r.total)}</div>
                        </div>
                      </header>

                      {r.installments.length > 0 ? (
                        <div className={styles.dSched}>
                          {r.installments.map((s) => (
                            <div key={s.id} className={styles.dSchedCell}>
                              <div className={styles.dSchedLbl}>{s.label}</div>
                              <div className={styles.dSchedVal}>{fmtMoney(s.amount)}</div>
                              {s.dueLabel && <div className={styles.dSchedDue}>due {s.dueLabel}</div>}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={styles.dSchedEmpty}>
                          No payment schedule — due in full on completion.
                        </div>
                      )}

                      <footer className={styles.dFoot}>
                        <span className={styles.dFootMeta}>
                          {r.materialCount} material line{r.materialCount === 1 ? "" : "s"} ·{" "}
                          {r.viewCount > 0 ? `viewed ${r.viewCount}×` : "not viewed yet"}
                        </span>
                        <Link
                          href={`/dashboard/proposals/${r.id}` as Route}
                          className={styles.cardLink}
                        >
                          Open proposal
                          <svg className={styles.ic} aria-hidden>
                            <use href="#i-arrow" />
                          </svg>
                        </Link>
                      </footer>
                    </article>
                  ))}
                </div>
              ))}

            {tab === "completed" &&
              (completed.length === 0 ? (
                <EmptyState eyebrow="Nothing in this view" title="Nothing filed yet">
                  When a job is paid in full, its tear-sheet is filed here — dates, schedule, and
                  the before-and-after record.
                </EmptyState>
              ) : (
                <div className={styles.tearStack}>
                  {completed.map((r) => (
                    <article key={r.id} className={styles.dossier} data-row>
                      <header className={styles.dHead}>
                        <div className={styles.dHeadMain}>
                          <div className={styles.dMetaRow}>
                            <span className={`${styles.eyebrow} ${styles.eyebrowOk}`}>
                              Completed{r.paidLabel ? ` · ${r.paidLabel}` : ""}
                            </span>
                            <span className={styles.mhRule} aria-hidden />
                            <span className={`${styles.eyebrow} ${styles.eyebrowFaint}`}>
                              Filed
                            </span>
                          </div>
                          <Link
                            href={`/dashboard/proposals/${r.id}` as Route}
                            className={styles.dTitleLink}
                          >
                            <span className={styles.dTitle}>{r.title}</span>
                            <svg className={styles.ic} aria-hidden>
                              <use href="#i-arrow" />
                            </svg>
                          </Link>
                          <div className={styles.dSub}>
                            {r.clientName}
                            {r.clientPlace ? ` · ${r.clientPlace}` : ""}
                          </div>
                        </div>
                        <div className={styles.dAmt}>
                          <span className={`${styles.eyebrow} ${styles.eyebrowFaint}`}>Banked</span>
                          <div className={`${styles.dAmtVal} ${styles.dAmtOk}`}>
                            {fmtMoney(r.total)}
                          </div>
                        </div>
                      </header>

                      {/* Lifecycle dateline — sent → signed → paid */}
                      <div className={styles.tearDates}>
                        <DateCell label="Sent out" value={r.sentLabel} />
                        <DateCell label="Signed" value={r.acceptedLabel} />
                        <DateCell label="Paid in full" value={r.paidLabel} />
                      </div>

                      {/* Settled schedule + before/after record */}
                      <div className={styles.tearBody}>
                        <div className={styles.tearPay}>
                          <span className={`${styles.eyebrow} ${styles.eyebrowFaint}`}>
                            Payment schedule
                          </span>
                          <div className={styles.tearPayRows}>
                            {r.installments.length > 0 ? (
                              r.installments.map((s) => (
                                <div key={s.id} className={styles.tearPayRow}>
                                  <span className={styles.payCheck} aria-hidden>
                                    <svg className={styles.ic}>
                                      <use href="#i-check" />
                                    </svg>
                                  </span>
                                  <span className={styles.tearPayLbl}>{s.label}</span>
                                  <span className={styles.tearPayAmt}>{fmtMoney(s.amount)}</span>
                                </div>
                              ))
                            ) : (
                              <div className={styles.tearPayRow}>
                                <span className={styles.payCheck} aria-hidden>
                                  <svg className={styles.ic}>
                                    <use href="#i-check" />
                                  </svg>
                                </span>
                                <span className={styles.tearPayLbl}>Paid in one payment</span>
                                <span className={styles.tearPayAmt}>{fmtMoney(r.total)}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className={styles.tearShots}>
                          <span className={`${styles.eyebrow} ${styles.eyebrowFaint}`}>
                            Before / after
                          </span>
                          <div className={styles.shotGrid}>
                            <Shot label="Before" url={r.beforeUrl} title={r.title} />
                            <Shot label="After" url={r.afterUrl} title={r.title} />
                          </div>
                        </div>
                      </div>

                      <footer className={styles.dFoot}>
                        <span className={styles.dFootMeta}>
                          receipt · {r.clientEmail ?? "no email on file"}
                        </span>
                        <Link
                          href={`/dashboard/proposals/${r.id}` as Route}
                          className={styles.cardLink}
                        >
                          Open proposal
                          <svg className={styles.ic} aria-hidden>
                            <use href="#i-arrow" />
                          </svg>
                        </Link>
                      </footer>
                    </article>
                  ))}
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── leaf pieces ────────────────────────────────────────────────────── */

function DateCell({ label, value }: { label: string; value: string | null }) {
  return (
    <div className={styles.tearDateCell}>
      <div className={styles.dSchedLbl}>{label}</div>
      <div className={styles.dSchedDue}>{value ?? "—"}</div>
    </div>
  );
}

function Shot({ label, url, title }: { label: string; url: string | null; title: string }) {
  return (
    <div className={styles.shot}>
      <div className={styles.dSchedLbl}>{label}</div>
      {url ? (
        <div className={styles.shotFrame}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={`${label} — ${title}`} />
        </div>
      ) : (
        <div className={styles.shotEmpty}>No photo</div>
      )}
    </div>
  );
}

function EmptyState({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.emptyCard} data-row>
      <span className={`${styles.eyebrow} ${styles.eyebrowFaint}`}>{eyebrow}</span>
      <div className={styles.emptyTitle}>{title}</div>
      <p className={styles.emptyTxt}>{children}</p>
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
        <symbol id="i-arrow" viewBox="0 0 24 24">
          <path d="M7 7h10v10" />
          <path d="M7 17 17 7" />
        </symbol>
        <symbol id="i-check" viewBox="0 0 24 24">
          <path d="M20 6 9 17l-5-5" />
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
