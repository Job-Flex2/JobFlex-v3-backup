"use client";

// THE WAY BACK TO THE HOME DASHBOARD (2026-10-14). A homeowner who opened this
// proposal from their home dashboard (or the project page) and accepted it had
// no way back but the browser's arrow. The dashboard's key is never put on this
// page — the proposal link is shared more widely than the home (the contractor's
// "client view" opens it too), and the key unlocks every project on the house.
// So the link is the page the browser itself came from, read from
// `document.referrer` on the same origin, and remembered for this tab so a
// reload after accepting keeps it. Nothing is rendered on the server.

import { useSyncExternalStore } from "react";
import s from "./home-back-link.module.css";

const KEY = "jf:proposal-back";
const noop = () => () => {};

function backPath(): string | null {
  try {
    const ref = document.referrer ? new URL(document.referrer) : null;
    const path = ref && ref.origin === window.location.origin ? ref.pathname : null;
    if (path && /^\/(home|request)\/[^/]+\/?$/.test(path)) {
      window.sessionStorage.setItem(KEY, path);
      return path;
    }
    const kept = window.sessionStorage.getItem(KEY);
    return kept && /^\/(home|request)\/[^/]+\/?$/.test(kept) ? kept : null;
  } catch {
    return null;
  }
}

/** `phone`: a slim bar above the handheld layout, which has no `.pv` wrapper of its own to sit in. */
export function HomeBackLink({ phone = false }: { phone?: boolean }) {
  const path = useSyncExternalStore(noop, backPath, () => null);
  if (!path) return null;
  const words = path.startsWith("/home/") ? "Back to your home dashboard" : "Back to your project";
  if (phone) {
    return (
      <div className={s.bar}>
        <a className={s.link} href={path} data-home-back>← {words}</a>
      </div>
    );
  }
  return (
    <a className="pv-back" href={path} data-home-back>
      ← {words}
    </a>
  );
}
