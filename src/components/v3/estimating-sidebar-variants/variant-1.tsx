"use client";

import { useId, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import type { NavItem } from "../blueprint-shell/nav-map";
import styles from "./variant-1.module.css";

type Props = { items: NavItem[]; activeHref: string };

function ItemStatus({ item }: { item: NavItem }) {
  if (item.locked) {
    return (
      <svg className={styles.lock} viewBox="0 0 24 24" role="img" aria-label="Not in your plan">
        <rect x="5" y="11" width="14" height="10" rx="1.5" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
    );
  }
  return item.soon ? <span className={styles.soon} aria-label="Coming soon">Soon</span> : null;
}

/** The same row grammar as the main navigation, with a quiet inventory tree. */
export default function EstimatingSidebarVariant1({ items, activeHref }: Props) {
  const id = useId();
  const [folds, setFolds] = useState<Record<string, boolean>>({});

  return (
    <section className={styles.section} aria-label="Estimating tools">
      <h2 className={styles.heading}>Estimating tools</h2>
      <ul className={styles.list}>
        {items.map((item, index) => {
          const selected = item.href === activeHref;
          const childSelected = !!item.children?.some((child) => child.href === activeHref);
          const open = folds[item.href] ?? (selected || childSelected);
          const childrenId = `${id}-inventory-${index}`;
          return (
            <li key={item.href}>
              <div className={`${styles.row}${selected || childSelected ? ` ${styles.active}` : ""}`}>
                <Link
                  className={styles.link}
                  href={item.href as Route}
                  aria-current={selected ? "page" : undefined}
                >
                  <svg className={styles.icon} aria-hidden="true"><use href={`#${item.icon}`} /></svg>
                  <span className={styles.label}>{item.label}</span>
                  <ItemStatus item={item} />
                </Link>
                {!!item.children?.length && (
                  <button
                    type="button"
                    className={styles.toggle}
                    aria-label={`${open ? "Collapse" : "Expand"} ${item.label} inventory`}
                    aria-expanded={open}
                    aria-controls={childrenId}
                    onClick={() => setFolds((previous) => ({ ...previous, [item.href]: !open }))}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true" className={open ? styles.chevronOpen : undefined}>
                      <path d="m7 4 6 6-6 6" />
                    </svg>
                  </button>
                )}
              </div>
              {!!item.children?.length && (
                <ul id={childrenId} className={styles.children} hidden={!open}>
                  {item.children.map((child) => (
                    <li key={child.href}>
                      <Link
                        className={styles.childLink}
                        href={child.href as Route}
                        aria-current={child.href === activeHref ? "page" : undefined}
                      >
                        <span className={styles.label}>{child.label}</span>
                        <ItemStatus item={child} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
