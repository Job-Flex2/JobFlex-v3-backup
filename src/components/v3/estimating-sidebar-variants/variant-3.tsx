"use client";

import { useId, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Minus, Plus } from "lucide-react";
import type { NavItem } from "../blueprint-shell/nav-map";
import styles from "./variant-3.module.css";

export default function Variant3({ items, activeHref }: { items: NavItem[]; activeHref: string }) {
  const id = useId();
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  const matches = (item: NavItem) => activeHref === item.href || activeHref.startsWith(`${item.href}/`);

  return (
    <nav className={styles.root} aria-label="Estimating tools" data-nest>
      <h2 className={styles.heading}>Estimating tools</h2>
      <ul className={styles.list}>
        {items.map((item, index) => {
          const children = item.children ?? [];
          const childActive = children.some(matches);
          const active = matches(item) || childActive;
          const open = folds[item.href] ?? active;
          const controls = `${id}-inventory-${index}`;
          const description = `${id}-description-${index}`;
          return (
            <li key={item.href} className={`${styles.item}${active ? ` ${styles.active}` : ""}`}>
              <div className={styles.row}>
                <Link
                  className={`${styles.link}${item.locked ? ` ${styles.locked}` : ""}`}
                  href={item.href as Route}
                  aria-current={active && !childActive ? "page" : undefined}
                  aria-describedby={item.tool || item.locked || item.soon ? description : undefined}
                >
                  <span className={styles.label}>{item.label}</span>
                  <span id={description} className={styles.description}>
                    {item.locked ? <span className={styles.status}>Not in your plan</span> : item.soon ? <span className={styles.status}>Coming soon</span> : null}
                    {item.tool && <span>{item.tool.from} <span aria-hidden="true">→</span><span className={styles.srOnly}>to</span> {item.tool.to}</span>}
                  </span>
                </Link>
                {children.length > 0 && (
                  <button
                    type="button"
                    className={styles.toggle}
                    aria-expanded={open}
                    aria-controls={controls}
                    aria-label={`${open ? "Hide" : "Show"} ${item.label} subpages`}
                    onClick={() => setFolds((previous) => ({ ...previous, [item.href]: !open }))}
                  >
                    {open ? <Minus size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
                  </button>
                )}
              </div>
              {children.length > 0 && (
                <ul id={controls} className={styles.children} hidden={!open}>
                  {children.map((child) => (
                    <li key={child.href}>
                      <Link
                        className={`${styles.childLink}${matches(child) ? ` ${styles.currentChild}` : ""}${child.locked ? ` ${styles.locked}` : ""}`}
                        href={child.href as Route}
                        aria-current={matches(child) ? "page" : undefined}
                      >
                        <span>{child.label}</span>
                        {child.locked ? <span className={styles.childStatus}>Not in your plan</span> : child.soon ? <span className={styles.childStatus}>Coming soon</span> : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
