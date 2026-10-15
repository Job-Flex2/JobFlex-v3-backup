"use client";

// WHO'S AT THE SCREEN (2026-10-15). The team shares the admin login (owner: "let's not do any logins — the team
// already has access to admin tasks"), so "Take it" asks who is taking it — a name off the team list — and this
// browser remembers the answer, listing it first next time. Only a convenience: the task, the journal and the texts
// all say who took it either way.

import { useSyncExternalStore } from "react";
import { Hand } from "lucide-react";
import { isMemberRef } from "@/lib/adminTasks/teamShared";
import type { AdminPersonDTO } from "@/lib/adminTasks/model";
import { cx } from "./task-bits";

const KEY = "jf-admin-tasks-me";
const EVENT = "jf-admin-tasks-me";

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

/** The team member this browser last took a task as ("m:<id>"), or null (always null on the server). */
export function useTakeAs(): string | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

export function rememberTakeAs(ref: string): void {
  try {
    localStorage.setItem(KEY, ref);
  } catch {
    /* private window: just not remembered */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The team list out of everyone a task can go to. */
export const teamOf = (people: readonly AdminPersonDTO[]) => people.filter((p) => isMemberRef(p.id));

/** The team in pick order: whoever this browser remembers, first and marked. */
export function takeOptions(people: readonly AdminPersonDTO[], mine: string | null): Array<{ value: string; label: string }> {
  const team = teamOf(people);
  const me = team.find((p) => p.id === mine);
  return [...(me ? [{ value: me.id, label: `${me.name} (me)` }] : []), ...team.filter((p) => p.id !== me?.id).map((p) => ({ value: p.id, label: p.name }))];
}

/** The row's "Take it…": a pill that opens the team list; picking a name takes the task as them. */
export function TakeSelect({ people, onTake, label = "Take it…" }: { people: readonly AdminPersonDTO[]; onTake: (who: string) => void; label?: string }) {
  const mine = useTakeAs();
  const options = takeOptions(people, mine);
  if (!options.length) return null;
  return (
    <span className={cx("rowAct", "rowTake")} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Hand size={13} aria-hidden />
      <span aria-hidden="true">{label}</span>
      <select
        value=""
        aria-label="Who's taking it"
        onChange={(e) => {
          const v = e.target.value;
          if (v) onTake(v);
        }}
        data-row-act="take"
      >
        <option value="" disabled>
          Who&apos;s taking it?
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}
