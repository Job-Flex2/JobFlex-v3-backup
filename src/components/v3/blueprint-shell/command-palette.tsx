"use client";

// Blueprint command palette — the topbar search, opened.
//
// The topbar has always carried a search field and a ⌘K chip, and neither did
// anything: the input was a dead `<input>` and the chip was decoration. This is
// what they open.
//
// The classic shell already had one (src/components/layout/CommandK.tsx) with
// the right item list; this is that behaviour in the blueprint's own vocabulary,
// living in the shared shell so it is available on every blueprint page without
// each page mounting its own.
//
// GO items come from NAV_SECTIONS rather than a second hardcoded list — the nav
// map is already the single source of truth for what pages exist, and a palette
// that lists pages the sidebar does not (or misses ones it has) is worse than no
// palette. CREATE items are the two things you can make from anywhere.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { canOpen, navSectionsFor, flattenNavItems } from "./nav-map";
import { useNavHidden, useNavLocked, useNavRole, useNavView, type NavView } from "./nav-role";

type Item = {
  key: string;
  group: "Go" | "Create";
  label: string;
  hint: string;
  icon: string;
  href: string;
};

/** The two things worth making from anywhere. Everything else is navigation. */
const CREATE: Item[] = [
  {
    key: "create-smart",
    group: "Create",
    label: "Smart Proposal",
    hint: "Describe the job, get a priced breakdown",
    icon: "i-bulb",
    href: "/dashboard/advanced-ai",
  },
  {
    key: "create-manual",
    group: "Create",
    label: "Manual Proposal",
    hint: "Build it line by line",
    icon: "i-file",
    href: "/dashboard/proposals/new",
  },
];

/** The palette for one role. GO comes from that role's nav — the same
 *  navSectionsFor() the sidebar and the drawer draw — so a page the sidebar
 *  hides can never be reachable by typing its name instead. CREATE rows are
 *  tested individually: they are not nav items, so nothing else would catch a
 *  worker landing on the proposal builder from a keystroke. */
function buildItems(role: string | null, locked: readonly string[], hidden: readonly string[], view?: NavView): Item[] {
  const go: Item[] = [];
  for (const section of navSectionsFor(role, locked, hidden, view)) {
    for (const item of flattenNavItems(section.items)) {
      if (item.href === "#") continue; // surfaces with no page yet stay unlisted
      go.push({
        key: "go-" + item.href,
        group: "Go",
        label: item.label,
        hint: section.label,
        icon: item.icon,
        href: item.href,
      });
    }
  }
  return go.concat(CREATE.filter((item) => canOpen(role, item.href, locked)));
}

/** Subsequence match, so "prop" finds Proposals and "trbd" finds Trade board. */
function score(item: Item, q: string): number {
  if (!q) return 1;
  const label = item.label.toLowerCase();
  const hint = item.hint.toLowerCase();
  if (label.startsWith(q)) return 100;
  if (label.includes(q)) return 60;
  if (hint.includes(q)) return 30;
  let i = 0;
  for (const ch of label) if (ch === q[i]) i += 1;
  return i === q.length ? 10 : 0;
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Held separately from `open` so the box can animate OUT before it unmounts —
  // the same reason the dialogs use a `.mdl--closing` class rather than dropping
  // straight to display:none.
  const [closing, setClosing] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const role = useNavRole();
  const locked = useNavLocked();
  const hidden = useNavHidden();
  const view = useNavView();
  const items = useMemo(() => buildItems(role, locked, hidden, view), [role, locked, hidden, view]);
  // Rows carry their own "is this the first of its group" flag, computed here
  // rather than by mutating a cursor while mapping — a running variable read and
  // written during render is exactly the pattern React's rules forbid, and it
  // silently produces the wrong headers under a re-render that starts midway.
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hits = items
      .map((it) => ({ it, s: score(it, needle) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.it)
      .slice(0, 12);
    return hits.map((it, i) => ({
      it,
      header: i === 0 || hits[i - 1].group !== it.group ? it.group : null,
    }));
  }, [items, q]);

  const close = useCallback(() => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
    setClosing(true);
    // Matches the exit duration in the stylesheet.
    exitTimer.current = setTimeout(() => {
      setOpen(false);
      setClosing(false);
      setQ("");
      setActive(0);
    }, 160);
  }, []);

  const show = useCallback(() => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
    setClosing(false);
    setQ("");
    setActive(0);
    setOpen(true);
  }, []);

  // ⌘K / Ctrl+K from anywhere, plus the topbar field, which dispatches this.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close();
        else show();
      }
    };
    const onOpen = () => show();
    document.addEventListener("keydown", onKey);
    document.addEventListener("jf:command-palette", onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("jf:command-palette", onOpen);
    };
  }, [open, show, close]);

  useEffect(() => {
    if (open && !closing) inputRef.current?.focus();
  }, [open, closing]);

  useEffect(() => () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
  }, []);

  if (!open) return null;

  const run = (href: string) => {
    close();
    router.push(href as Route);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[active];
      if (hit) run(hit.it.href);
    }
  };

  return (
    <div className={"cmdk" + (closing ? " cmdk--closing" : "")} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="cmdk-bg" onMouseDown={close} />
      <div className="cmdk-box" onKeyDown={onKeyDown}>
        <div className="cmdk-head">
          <svg className="ic cmdk-head-ic">
            <use href="#i-search" />
          </svg>
          <input
            ref={inputRef}
            className="cmdk-in"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            placeholder="Search clients, proposals, leads…"
            aria-label="Search"
            autoComplete="off"
          />
          <kbd className="cmdk-esc">ESC</kbd>
        </div>

        <ul className="cmdk-list" role="listbox">
          {results.map(({ it, header }, i) => {
            return (
              <li key={it.key}>
                {header && <div className="cmdk-group">{header}</div>}
                <button
                  type="button"
                  className={"cmdk-item" + (i === active ? " on" : "")}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  // mousedown, not click: the default would blur the input first
                  onMouseDown={(e) => {
                    e.preventDefault();
                    run(it.href);
                  }}
                >
                  <svg className="ic cmdk-item-ic">
                    <use href={`#${it.icon}`} />
                  </svg>
                  <span className="cmdk-item-t">
                    <span className="cmdk-item-l">{it.label}</span>
                    <span className="cmdk-item-h">{it.hint}</span>
                  </span>
                  <span className="cmdk-tag">{it.group === "Create" ? "CREATE" : "GO"}</span>
                </button>
              </li>
            );
          })}
          {results.length === 0 && (
            <li className="cmdk-empty">Nothing matches “{q.trim()}”.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
