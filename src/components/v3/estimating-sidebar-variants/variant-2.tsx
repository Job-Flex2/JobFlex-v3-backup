"use client";

import { useId, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import type { NavItem } from "../blueprint-shell/nav-map";
import s from "./variant-2.module.css";

type Props = { items: NavItem[]; activeHref: string };

function Availability({ item }: { item: NavItem }) {
  if (item.locked) return <span className={s.availability}>Not in plan</span>;
  if (item.soon) return <span className={s.availability}>Soon</span>;
  return null;
}

export default function EstimatingSidebarVariant2({ items, activeHref }: Props) {
  const id = useId();
  const [folds, setFolds] = useState<Record<string, boolean>>({});

  return (
    <nav className={s.directory} aria-label="Estimating tools" data-nest>
      <h2 className={s.heading}>Estimating tools</h2>
      <ul className={s.list}>
        {items.map((item, index) => {
          const current = activeHref === item.href;
          const childCurrent = !!item.children?.some((child) => child.href === activeHref);
          const active = current || childCurrent;
          const hasChildren = !!item.children?.length;
          const open = folds[item.href] ?? active;
          const childrenId = `${id}-inventory-${index}`;

          return (
            <li className={s.entry} key={item.href}>
              <div className={s.row} data-active={active || undefined}>
                <Link
                  href={item.href as Route}
                  className={s.link}
                  aria-current={current ? "page" : undefined}
                >
                  <svg className={s.icon} aria-hidden="true"><use href={`#${item.icon}`} /></svg>
                  <span className={s.copy}>
                    <span className={s.name}>{item.label}</span>
                    {item.tool && (
                      <span className={s.description}>{item.tool.from} <span aria-hidden="true">→</span><span className={s.srOnly}>to</span> {item.tool.to}</span>
                    )}
                    <Availability item={item} />
                  </span>
                </Link>
                {hasChildren ? (
                  <button
                    type="button"
                    className={s.fold}
                    aria-label={`${open ? "Hide" : "Show"} ${item.label} inventory`}
                    aria-expanded={open}
                    aria-controls={childrenId}
                    onClick={() => setFolds((previous) => ({ ...previous, [item.href]: !open }))}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                  </button>
                ) : <span className={s.foldSpace} aria-hidden="true" />}
              </div>
              {hasChildren && (
                <ul className={s.children} id={childrenId} hidden={!open}>
                  {item.children?.map((child) => (
                    <li className={s.child} key={child.href}>
                      <Link
                        href={child.href as Route}
                        className={s.childLink}
                        aria-current={activeHref === child.href ? "page" : undefined}
                      >
                        <svg className={s.childIcon} aria-hidden="true"><use href={`#${child.icon}`} /></svg>
                        <span className={s.copy}><span className={s.name}>{child.label}</span><Availability item={child} /></span>
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
