"use client";

// QUIET — the two pickers (client, project).
//
// Hand-rolled popovers: this codebase has no Radix and the house pattern is an
// in-house dialog. A native <select> was the other option and it loses here for
// one reason — the client list needs a second line per option ("Austin, TX",
// "No contact on file") and <option> cannot carry one. The project picker keeps
// the same shell so the two fields read as one control type rather than two.
//
// The client field is THREE modes in one union (`ClientChoice`) rather than
// three booleans, so "a record AND a typed name" is unrepresentable. Whichever
// mode is live, exactly one extra control appears under the trigger — never
// two — which is what keeps this card short.
//
// A11y: the trigger carries the field name in its own aria-label, because a
// <label for> pointing at a popover button names the button and orphans the
// word. Escape closes; a mousedown anywhere outside closes; the panel is
// keyboard-reachable in DOM order.

import { useEffect, useId, useRef, useState } from "react";
import type { ClientChoice, ClientRecord, ProjectRecord } from "../manual-focus/manual-focus-types";
import styles from "./manual-blueprint.module.css";
import { Btn, Field, Ic, TextField, cx } from "./bp-ui";

/* ============================================================
   POPOVER SHELL
   ============================================================ */

function Picker({
  ariaLabel,
  display,
  empty,
  children,
}: {
  ariaLabel: string;
  display: string;
  empty?: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.picker} ref={rootRef}>
      <button
        type="button"
        className={cx(styles.pickTrigger, empty && styles.pickEmpty)}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{display}</span>
        <Ic name="chev" />
      </button>
      {open ? (
        <div className={styles.pickPanel} role="listbox" aria-label={ariaLabel}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

function Opt({
  on,
  label,
  sub,
  icon,
  onClick,
}: {
  on: boolean;
  label: string;
  sub?: string;
  /** Sprite symbol drawn ahead of the label. Carried by the two ACTION options
   *  at the foot of the client list ("Type a name instead", "Add a new client")
   *  so they are separable at a glance from the records above them — the divider
   *  alone said "these are different" without saying what they do. */
  icon?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={on}
      className={cx(styles.pickOpt, on && styles.pickOptOn)}
      onClick={onClick}
    >
      {icon ? (
        <span className={styles.pickOptIcon} aria-hidden="true">
          <Ic name={icon} />
        </span>
      ) : null}
      <span className={styles.pickOptBody}>
        {label}
        {sub ? <span className={styles.pickSub}>{sub}</span> : null}
      </span>
      {on ? <Ic name="check" /> : null}
    </button>
  );
}

/* ============================================================
   PROJECT
   ============================================================ */

export function ProjectField({
  projects,
  value,
  onChange,
  hint,
}: {
  projects: ProjectRecord[];
  value: string;
  onChange: (id: string) => void;
  /** Six words at most, under the control. Carries the one thing the field
   *  cannot show by itself — currently that a pick is not stored on the
   *  proposal (Proposal has no project column). */
  hint?: string;
}) {
  const current = projects.find((p) => p.id === value);
  return (
    <Field label="Project" hint={hint}>
      <Picker
        ariaLabel="Project"
        display={current?.name ?? (projects.length === 0 ? "No projects on file" : "No project")}
        empty={!current}
      >
        {(close) => (
          <>
            <Opt
              on={value === ""}
              label="No project"
              onClick={() => {
                onChange("");
                close();
              }}
            />
            <div className={styles.pickDiv} />
            {projects.map((p) => (
              <Opt
                key={p.id}
                on={p.id === value}
                label={p.name}
                sub={p.description}
                onClick={() => {
                  onChange(p.id);
                  close();
                }}
              />
            ))}
          </>
        )}
      </Picker>
    </Field>
  );
}

/* ============================================================
   CLIENT
   ============================================================ */

/** A blank record for the inline create form. Only the four fields a
 *  contractor actually has at proposal time; the rest arrive later. */
const BLANK = { name: "", email: "", phone: "", address: "", city: "", state: "", zip: "" };

/** What the inline form collects. NO id: the record is created by the
 *  `createClient` server action and the row it returns is what gets selected —
 *  a locally invented id would file the proposal against a client that does not
 *  exist. */
export type NewClientInput = {
  name: string;
  email: string;
  phone: string;
  address: string;
};

export function ClientField({
  clients,
  choice,
  onChoice,
  onCreate,
  onCreatingChange,
}: {
  clients: ClientRecord[];
  choice: ClientChoice;
  onChoice: (next: ClientChoice) => void;
  /** Writes the client, then appends it to the roster and selects it. Rejects
   *  with a message the form prints in place — the create is a real round trip
   *  now, so it can fail, and a silently discarded name is worse than an error. */
  onCreate: (input: NewClientInput) => Promise<unknown>;
  /** Told whenever the inline "add a new client" form opens or closes, so the
   *  card above can hide the contact rows that belong to the SELECTED client —
   *  two Email/Phone/Address pairs stacked on one card read as one long form
   *  where half the boxes silently do nothing. */
  onCreatingChange?: (creating: boolean) => void;
}) {
  const [creating, setCreatingState] = useState(false);
  const setCreating = (next: boolean) => {
    setCreatingState(next);
    onCreatingChange?.(next);
  };
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();

  /**
   * Free text is now the FIELD ITSELF, not a second field under a trigger that
   * read "Typed name".
   *
   * The old shape asked the user to click "Type a name instead", watch the
   * control they had just used go inert with a placeholder word in it, and then
   * find a separate "Name" row underneath to actually type in. Two controls for
   * one value, and the one they had their pointer on was the dead one. Picking
   * the option now REPLACES the trigger with the text input, which is where the
   * caret goes — so the click and the typing happen in the same place.
   *
   * The flag guards the focus: arriving in free-text mode on first paint (a
   * restored draft would) must not steal the caret from the top of the page.
   */
  const freeRef = useRef<HTMLInputElement>(null);
  const owedFocus = useRef(false);
  const freeMode = choice.mode === "freeText" && !creating;
  useEffect(() => {
    if (!freeMode || !owedFocus.current) return;
    owedFocus.current = false;
    freeRef.current?.focus();
  }, [freeMode]);

  const record = choice.mode === "record" ? clients.find((c) => c.id === choice.id) : undefined;
  const display = creating
    ? "Add a new client"
    : choice.mode === "record"
      ? (record?.name ?? "No client")
      : "No client";

  const set = (k: keyof typeof BLANK, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <>
      {freeMode ? (
        <Field label="Client" htmlFor={nameId}>
          <TextField
            id={nameId}
            inputRef={freeRef}
            value={choice.name}
            onChange={(v) => onChoice({ mode: "freeText", name: v })}
            placeholder="Who is this for?"
          />
          <div className={styles.freeRow}>
            <span className={styles.freeTag}>New client · added to your clients when you save</span>
            <button
              type="button"
              className={styles.freeBack}
              onClick={() => onChoice({ mode: "none" })}
            >
              <Ic name="undo" />
              Back to the client list
            </button>
          </div>
        </Field>
      ) : (
        <Field label="Client">
          <Picker ariaLabel="Client" display={display} empty={choice.mode === "none" && !creating}>
            {(close) => (
              <>
                {clients.length === 0 ? (
                  <div className={styles.pickSub}>No clients on file yet.</div>
                ) : null}
                {clients.map((c) => (
                  <Opt
                    key={c.id}
                    on={choice.mode === "record" && choice.id === c.id}
                    label={c.name}
                    icon="user"
                    sub={
                      c.city ? `${c.city}, ${c.state}` : c.email || "No contact details on file"
                    }
                    onClick={() => {
                      setCreating(false);
                      onChoice({ mode: "record", id: c.id });
                      close();
                    }}
                  />
                ))}
                <div className={styles.pickDiv} />
                <Opt
                  on={false}
                  label="Type a name instead"
                  icon="pen"
                  onClick={() => {
                    setCreating(false);
                    owedFocus.current = true;
                    onChoice({ mode: "freeText", name: "" });
                    close();
                  }}
                />
                <Opt
                  on={creating}
                  label="Add a new client"
                  icon="userplus"
                  onClick={() => {
                    setForm(BLANK);
                    setError(null);
                    setCreating(true);
                    close();
                  }}
                />
              </>
            )}
          </Picker>
        </Field>
      )}

      {creating ? (
        <>
          <Field label="New client">
            <TextField
              value={form.name}
              onChange={(v) => set("name", v)}
              placeholder="Name"
              ariaLabel="New client name"
            />
          </Field>
          <div className={styles.grid2}>
            <Field label="Email" small>
              <TextField
                value={form.email}
                onChange={(v) => set("email", v)}
                ariaLabel="New client email"
              />
            </Field>
            <Field label="Phone" small>
              <TextField
                value={form.phone}
                onChange={(v) => set("phone", v)}
                ariaLabel="New client phone"
              />
            </Field>
          </div>
          <Field label="Address" small>
            <TextField
              value={form.address}
              onChange={(v) => set("address", v)}
              placeholder="Street, city, state ZIP"
              ariaLabel="New client address"
            />
          </Field>
          {error ? <div className={styles.freeTag}>{error}</div> : null}
          <div className={styles.rowActions}>
            <Btn
              tone="primary"
              disabled={busy}
              onClick={() => {
                const name = form.name.trim();
                if (!name) {
                  setError("A name is required.");
                  return;
                }
                // The address is typed as one line here, so it is stored as one
                // line: splitting a free-text string into street/city/state/zip
                // by guesswork is how a record ends up with "TX 78704" as its
                // city. The tax estimate reads the same single line anyway.
                setBusy(true);
                setError(null);
                void onCreate({
                  name,
                  email: form.email.trim(),
                  phone: form.phone.trim(),
                  address: form.address.trim(),
                })
                  .then(() => setCreating(false))
                  .catch((err: unknown) =>
                    setError(err instanceof Error ? err.message : "Could not add the client."),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Adding…" : "Add client"}
            </Btn>
            <Btn tone="quiet" disabled={busy} onClick={() => setCreating(false)}>
              Cancel
            </Btn>
          </div>
        </>
      ) : null}
    </>
  );
}
