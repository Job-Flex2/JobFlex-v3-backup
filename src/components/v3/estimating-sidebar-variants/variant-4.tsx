"use client";

import { useId, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import type { NavItem } from "../blueprint-shell/nav-map";
import styles from "./variant-4.module.css";

type Props = { items: NavItem[]; activeHref: string };

function Availability({ item }: { item: NavItem }) {
  if (item.locked) {
    return (
      <span className={styles.availability} title="Not in your plan">
        <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.lock}>
          <rect x="5" y="11" width="14" height="10" rx="1.5" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        <span className={styles.srOnly}>Not in your plan</span>
      </span>
    );
  }
  return item.soon ? <span className={styles.availability}>Soon</span> : null;
}

export default function Variant4({ items, activeHref }: Props) {
  const id = useId();
  const [expanded, setExpanded] = useState(true);
  const [folds, setFolds] = useState<Record<string, boolean>>({});

  return (
    <section className={styles.section} data-nest aria-labelledby={`${id}-heading`}>
      <h2 className={styles.heading} id={`${id}-heading`}>
        <button
          type="button"
          className={styles.sectionToggle}
          aria-expanded={expanded}
          aria-controls={`${id}-tools`}
          onClick={() => setExpanded((value) => !value)}
        >
          <span>Estimating tools</span>
          <span className={styles.sectionSign} aria-hidden="true">{expanded ? "−" : "+"}</span>
        </button>
      </h2>
      <div id={`${id}-tools`} className={styles.tools} hidden={!expanded}>
        {items.map((item, index) => {
          const current = item.href === activeHref;
          const childCurrent = !!item.children?.some((child) => child.href === activeHref);
          const open = folds[item.href] ?? (current || childCurrent);
          const childrenId = `${id}-inventory-${index}`;

          return (
            <div className={styles.tree} key={item.href}>
              <div className={`${styles.row}${current || childCurrent ? ` ${styles.active}` : ""}`}>
                <Link
                  href={item.href as Route}
                  className={styles.link}
                  aria-current={current ? "page" : undefined}
                >
                  <svg className={styles.icon} aria-hidden="true"><use href={`#${item.icon}`} /></svg>
                  <span className={styles.label}>{item.label}</span>
                  <Availability item={item} />
                </Link>
                {item.children?.length ? (
                  <button
                    type="button"
                    className={styles.inventoryToggle}
                    aria-label={`${open ? "Hide" : "Show"} ${item.label} subpages`}
                    aria-expanded={open}
                    aria-controls={childrenId}
                    onClick={() => setFolds((value) => ({ ...value, [item.href]: !open }))}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" className={open ? styles.chevronOpen : undefined}>
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </button>
                ) : null}
              </div>
              {item.children?.length ? (
                <div className={styles.children} id={childrenId} hidden={!open}>
                  {item.children.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href as Route}
                      className={`${styles.childLink}${child.href === activeHref ? ` ${styles.childActive}` : ""}`}
                      aria-current={child.href === activeHref ? "page" : undefined}
                    >
                      <span className={styles.label}>{child.label}</span>
                      <Availability item={child} />
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
