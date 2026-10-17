"use client";

import { useId, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import type { NavItem } from "../blueprint-shell/nav-map";
import styles from "./variant-5.module.css";

type Props = { items: NavItem[]; activeHref: string };

function Availability({ item }: { item: NavItem }) {
  if (item.locked) {
    return <span className={styles.status} aria-label="Not in your plan" title="Not in your plan">Plan</span>;
  }
  return item.soon ? <span className={styles.status} aria-label="Coming soon">Soon</span> : null;
}

/** Compact navigation with each tool's explanation and inventory in its disclosure. */
export default function EstimatingSidebarVariant5({ items, activeHref }: Props) {
  const id = useId();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <section className={styles.section} aria-label="Estimating tools" data-nest>
      <h2 className={styles.heading}>Estimating tools</h2>
      <ul className={styles.list}>
        {items.map((item, index) => {
          const current = item.href === activeHref;
          const childCurrent = !!item.children?.some((child) => child.href === activeHref);
          const selected = current || childCurrent;
          const open = expanded[item.href] ?? selected;
          const panelId = `${id}-tool-details-${index}`;
          const hasDetails = !!item.tool || !!item.children?.length;
          const content = (
            <>
              <svg className={styles.icon} aria-hidden="true"><use href={`#${item.icon}`} /></svg>
              <span className={styles.label}>{item.label}</span>
              <Availability item={item} />
            </>
          );

          return (
            <li key={item.href} className={selected ? styles.selected : undefined}>
              <div className={styles.row}>
                {item.href === "#" ? (
                  <span className={`${styles.link} ${styles.unavailable}`} aria-disabled="true">{content}</span>
                ) : (
                  <Link className={styles.link} href={item.href as Route} aria-current={current ? "page" : undefined}>
                    {content}
                  </Link>
                )}
                {hasDetails && (
                  <button
                    type="button"
                    className={styles.toggle}
                    aria-label={`${open ? "Hide" : "Show"} ${item.label} details`}
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => setExpanded((previous) => ({ ...previous, [item.href]: !open }))}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M5 10h10" />
                      {!open && <path d="M10 5v10" />}
                    </svg>
                  </button>
                )}
              </div>
              {hasDetails && (
                <div className={styles.details} id={panelId} hidden={!open}>
                  {item.tool && (
                    <p className={styles.description}>
                      {item.tool.from}<span className={styles.arrow} aria-label="to"> → </span>{item.tool.to}
                    </p>
                  )}
                  {!!item.children?.length && (
                    <ul className={styles.inventory}>
                      {item.children.map((child) => (
                        <li key={child.href}>
                          {child.href === "#" ? (
                            <span className={`${styles.childLink} ${styles.unavailable}`} aria-disabled="true">
                              <span className={styles.label}>{child.label}</span>
                              <Availability item={child} />
                            </span>
                          ) : (
                            <Link className={styles.childLink} href={child.href as Route} aria-current={child.href === activeHref ? "page" : undefined}>
                              <svg className={styles.childIcon} aria-hidden="true"><use href={`#${child.icon}`} /></svg>
                              <span className={styles.label}>{child.label}</span>
                              <Availability item={child} />
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
