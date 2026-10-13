"use client";

// ADMIN · USERS & SUBSCRIPTIONS — the page.
// Route: /admin/users. Renders ONLY the shell's `.content` children (the admin
// layout mounts the blueprint chrome), as a fragment, so the reveal cascade
// walks `.content > *`.
//
// Database control over the local mirror: every account, the org it belongs
// to, the org's Subscription row, and the platform-admin flag. Writes go
// through src/actions/adminUsers.ts — updateAdminUser (name/email),
// setPlatformAdmin and deleteAdminUser (typed confirmation; refuses self and
// the last owner) — and, for the subscription itself, the two-mode editor in
// ./admin-subscription-editor (actions/adminSubscription: change the billed
// plan on Stripe, or grant a complimentary plan with a term), and the usage
// meters with the admin's reset in ./admin-usage-reset (actions/adminUsage).

import { freeWasLabel, onFreePlan } from "@/lib/freePlan";
import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Search, RefreshCw } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { longDate } from "@/lib/format";
import { planDisplayName } from "@/lib/planCatalog";
import {
  updateAdminUser,
  setPlatformAdmin,
  deleteAdminUser,
  syncSubscriptionsFromStripe,
} from "@/actions/adminUsers";
import type { AdminUsersData, SubscriptionSummary } from "@/actions/adminUsers";
import type { PlanGrant, SyncingMark } from "@/lib/planGrant";
import { STRIPE_SCAN_CEILING_LABEL } from "@/components/v3/admin-subscribers/billing-metrics";
import { SubscriptionEditor } from "./admin-subscription-editor";
import { UsageReset } from "./admin-usage-reset";
import { CustomPagesEditor } from "./admin-custom-pages";
import { setOrganizationInternal } from "@/actions/adminLeadCenter";
import shared from "./admin-shared.module.css";
import s from "./admin-users.module.css";
import {
  makeCx,
  KIT_BTN_CLASS,
  useSheet,
  Sheet,
  SheetBody,
  SheetFoot,
  Field,
  Toggle,
  Note,
  StatusBadge,
  errorMessage,
} from "./admin-kit";
import { useAdminMotion } from "./use-admin-motion";
import { EmailContractorButton } from "@/components/v3/admin-mail/contractor-mail";

const cx = makeCx(s, shared);

export interface AdminUserDTO {
  id: string;
  email: string;
  name: string | null;
  isPlatformAdmin: boolean;
  orgId: string | null;
  orgName: string | null;
  roles: string[];
  /** What the table shows: Stripe's answer when it has one, else the record's. */
  plan: string;
  planStatus: string;
  planSource: "stripe" | "record" | "none";
  /** The stored Subscription row — what the sheet's fields write. */
  recordPlan: string;
  recordStatus: string;
  provider: string | null;
  /** What Stripe holds for this org, even when the stored row outranks it. */
  stripePlan: string | null;
  stripeStatus: string | null;
  stripeSubId: string | null;
  externalSubId: string | null;
  stripeCustomerId: string | null;
  stripeAmountCents: number | null;
  /** The standing complimentary plan, with its term and author (lib/planGrant). */
  grant: PlanGrant | null;
  /** An admin change Stripe has not confirmed back yet. */
  syncing: SyncingMark | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  canceledAt: string | null;
  orgMemberCount: number;
  /** The organization is JobFlex's own — the only kind a Lead Center test
   *  lead can be sent to (Organization.isInternal). */
  orgInternal: boolean;
  createdAt: string;
}

export interface PlanOption {
  slug: string;
  name: string;
}

type BillingSource = AdminUsersData["source"];

function planLabel(plan: string, plans: PlanOption[]): string {
  return planDisplayName(plan, plans);
}

export function AdminUsersContent({
  users,
  plans,
  summary,
  source,
  meId,
}: {
  users: AdminUserDTO[];
  plans: PlanOption[];
  summary: SubscriptionSummary;
  source: BillingSource;
  meId: string;
}) {
  useAdminMotion(KIT_BTN_CLASS);
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [internalOnly, setInternalOnly] = useState(false);
  const internalCount = useMemo(
    () => new Set(users.filter((u) => u.orgInternal && u.orgId).map((u) => u.orgId)).size,
    [users],
  );
  const [selected, setSelected] = useState<AdminUserDTO | null>(null);
  // The sheet reads the LATEST row for the account it opened on: the
  // subscription editor refreshes the server data after a change and the
  // sheet must show the new state, not the row as it was when clicked.
  const current = selected ? (users.find((u) => u.id === selected.id) ?? selected) : null;
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ text: string; bad: boolean } | null>(null);
  const sheet = useSheet();

  // Pull the live Stripe subscriptions into the platform's own record, then
  // re-render the server component so the numerals above are the new truth.
  const runSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const r = await syncSubscriptionsFromStripe();
      // Every subscription read lands in exactly one bucket; the parts that
      // are zero are left off rather than padded onto the line.
      const parts = [
        `${r.written} written`,
        r.unchanged ? `${r.unchanged} unchanged` : "",
        r.superseded ? `${r.superseded} superseded` : "",
        r.keptManual ? `${r.keptManual} kept as grants` : "",
        r.conflicts ? `${r.conflicts} conflicts` : "",
        r.unnamed ? `${r.unnamed} unnamed plan` : "",
        r.unmatched ? `${r.unmatched} unmatched` : "",
      ].filter(Boolean);
      // A partition of a silently cut set reads exactly like a partition of
      // the whole account, so the cut has to be part of the sentence.
      const scanned = r.truncated
        ? `first ${STRIPE_SCAN_CEILING_LABEL} of more`
        : `${r.scanned} read`;
      setSyncResult({
        text: `${scanned} · ${parts.join(" · ")}`,
        bad: r.conflicts > 0 || r.unnamed > 0 || r.truncated,
      });
      router.refresh();
    } catch (e) {
      setSyncResult({ text: errorMessage(e, "Sync failed."), bad: true });
    } finally {
      setSyncing(false);
    }
  }, [router, syncing]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = internalOnly ? users.filter((u) => u.orgInternal) : users;
    const matched = !q
      ? pool
      : pool.filter(
          (u) =>
            (u.name ?? "").toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q) ||
            (u.orgName ?? "").toLowerCase().includes(q) ||
            u.plan.toLowerCase().includes(q),
        );
    // The signed-in admin first, so "where am I?" is always answerable.
    return [...matched].sort((a, b) => (b.id === meId ? 1 : 0) - (a.id === meId ? 1 : 0));
  }, [users, query, meId, internalOnly]);

  const openRow = useCallback(
    (u: AdminUserDTO) => {
      setSelected(u);
      sheet.open();
    },
    [sheet],
  );
  const closeSheet = useCallback(() => sheet.close(() => setSelected(null)), [sheet]);

  const sourceLabel = source.stripeLive
    ? "Stripe · live"
    : source.stripeEnabled
      ? "Stripe unreachable"
      : "Platform record";


  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, u: AdminUserDTO) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openRow(u);
    }
  };

  return (
    <>
      <div className={cx("page-head")}>
        <div>
          <div className={cx("kicker")}>Platform</div>
          <h1 className={cx("page-title")}>Users &amp; subscriptions</h1>
        </div>
        <div className={cx("au-head-actions")}>
          {/* JobFlex's own organizations — the Lead Center's test-lead
              targets. A filter, so they can be found and checked. */}
          <button
            type="button"
            className={cx("btn", internalOnly ? "btn-primary" : "btn-ghost", "au-internal-filter")}
            aria-pressed={internalOnly}
            onClick={() => setInternalOnly((v) => !v)}
          >
            Internal{internalCount ? ` · ${internalCount}` : ""}
          </button>
          <label className={cx("search")}>
            <Search className={cx("ic")} aria-hidden="true" />
            <input
              type="search"
              placeholder="Name, email, org or plan…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search users"
            />
            <kbd>
              {filtered.length}/{users.length}
            </kbd>
          </label>
        </div>
      </div>

      <div className={cx("au-kpis")} aria-label="Subscriptions">
        <div className={cx("au-kpi")}>
          <div className={cx("au-kpi-l")}>Active</div>
          <div className={cx("au-kpi-v", "accent")}>{summary.active}</div>
        </div>
        <div className={cx("au-kpi")}>
          <div className={cx("au-kpi-l")}>Trialing</div>
          <div className={cx("au-kpi-v")}>{summary.trialing}</div>
        </div>
        <div className={cx("au-kpi")}>
          <div className={cx("au-kpi-l")}>Past due</div>
          <div className={cx("au-kpi-v", summary.pastDue > 0 && "warn")}>{summary.pastDue}</div>
        </div>
        <div className={cx("au-kpi")}>
          <div className={cx("au-kpi-l")}>Lapsed</div>
          <div className={cx("au-kpi-v", summary.lapsed > 0 && "danger")}>{summary.lapsed}</div>
        </div>
        <div className={cx("au-kpi")}>
          <div className={cx("au-kpi-l")}>Free</div>
          <div className={cx("au-kpi-v")}>{summary.free}</div>
        </div>
        <div className={cx("au-ribbon")}>
          <span className={cx("au-ribbon-k")}>By plan</span>
          {summary.byPlan.length === 0 ? (
            <span className={cx("au-dash")}>—</span>
          ) : (
            summary.byPlan.map(([plan, n]) => (
              <span key={plan}>
                {planLabel(plan, plans)}
                <b>{n}</b>
              </span>
            ))
          )}
          <div className={cx("au-sync")}>
            {syncResult ? (
              <span className={cx("au-sync-r", syncResult.bad && "bad")} role="status">
                {syncResult.text}
              </span>
            ) : null}
            <button
              type="button"
              className={cx("btn", "btn-sm")}
              onClick={runSync}
              disabled={syncing}
            >
              <RefreshCw className={cx("ic")} aria-hidden="true" />
              {syncing ? "Syncing…" : "Sync from Stripe"}
            </button>
          </div>
        </div>
        {/* What the numerals above are counted over, and where they came from.
            One organization can hold several accounts, so the strip counts
            organizations while the table lists people. */}
        <div className={cx("au-scope")}>
          <span className={cx(source.stripeLive && "au-scope-live")}>{sourceLabel}</span>
          {source.truncated ? (
            <span className={cx("au-scope-bad")}>
              first {STRIPE_SCAN_CEILING_LABEL} only
            </span>
          ) : null}
        </div>
        {source.stripeEnabled && !source.stripeLive ? (
          <div className={cx("au-scope", "au-scope--err")}>
            <span>Stripe did not answer — showing the platform’s own record.</span>
            {source.stripeError ? <span>{source.stripeError}</span> : null}
          </div>
        ) : null}
      </div>

      <section className={cx("card", "tbl-card")}>
        {filtered.length === 0 ? (
          <div className={cx("tbl-empty")}>
            {users.length === 0 ? "No accounts." : "No matches."}
          </div>
        ) : (
          <div className={cx("tbl-wrap")}>
            <table className={cx("tbl", "tbl--stack")}>
              <colgroup>
                <col className={cx("au-c-user")} />
                <col className={cx("au-c-org")} />
                <col className={cx("au-c-roles")} />
                <col className={cx("au-c-plan")} />
                <col className={cx("au-c-admin")} />
                <col className={cx("au-c-created")} />
              </colgroup>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Organization</th>
                  <th>Roles</th>
                  <th>Plan</th>
                  <th>Admin</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr
                    key={u.id}
                    className={cx("is-link")}
                    tabIndex={0}
                    role="button"
                    aria-label={`Edit ${u.name ?? u.email}`}
                    onClick={() => openRow(u)}
                    onKeyDown={(e) => onRowKey(e, u)}
                  >
                    <td>
                      <div className={cx("au-name")}>
                        <div className={cx("t-title", "au-name-t")} title={u.name ?? undefined}>
                          {u.name ?? "—"}
                        </div>
                        {u.id === meId ? <span className={cx("stamp", "stamp--bp")}>You</span> : null}
                      </div>
                      <div className={cx("t-sub")} title={u.email}>
                        {u.email}
                      </div>
                    </td>
                    <td data-l="Org">
                      {u.orgName ? (
                        <>
                          <div className={cx("t-clip")} title={u.orgName}>
                            {u.orgName}
                          </div>
                          <div className={cx("t-mono")}>
                            {u.orgMemberCount} member{u.orgMemberCount === 1 ? "" : "s"}
                            {/* On the members line: the name above ellipsises, the stamp must not. */}
                            {u.orgInternal ? <span className={cx("stamp", "au-internal-stamp")}>Internal</span> : null}
                          </div>
                          {/* Write to the account's owner (2026-10-08): the console's
                              composer; owners only — the email goes to the owner. */}
                          {u.orgId && u.roles.includes("OWNER") ? (
                            <EmailContractorButton spaced orgId={u.orgId} seed={{ business: u.orgName, ownerName: u.name ?? undefined, ownerEmail: u.email }} />
                          ) : null}
                        </>
                      ) : (
                        <span className={cx("au-dash")}>—</span>
                      )}
                    </td>
                    <td data-l="Roles">
                      {u.roles.length ? (
                        <div className={cx("t-chips")}>
                          {u.roles.map((r) => (
                            <span key={r} className={cx("st")}>
                              {r}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className={cx("au-dash")}>—</span>
                      )}
                    </td>
                    <td data-l="Plan">
                      <div className={cx("au-plan")}>
                        <span className={cx("au-plan-name")}>
                          {!u.plan || u.plan === "NONE" ? (
                            <span className={cx("au-dash")}>—</span>
                          ) : onFreePlan({ status: u.planStatus }) && u.provider !== "MANUAL" ? (
                            // Its subscription ended: the Free plan (lib/freePlan).
                            freeWasLabel(planLabel(u.plan, plans))
                          ) : (
                            planLabel(u.plan, plans)
                          )}
                        </span>
                        {u.planStatus !== "NONE" ? (
                          <StatusBadge status={onFreePlan({ status: u.planStatus }) && u.provider !== "MANUAL" ? "FREE" : u.planStatus} />
                        ) : null}
                        {/* Where the plan on this row came from, but only when
                            it is not the ordinary case. A grant and a
                            Stripe-only subscription are read differently. */}
                        {u.planSource === "stripe" && u.recordStatus === "NONE" ? (
                          <span className={cx("au-plan-src")}>Stripe only</span>
                        ) : u.planSource === "record" && u.provider === "MANUAL" ? (
                          <span className={cx("au-plan-src")}>
                            {u.grant?.endsAt
                              ? `Complimentary · until ${longDate(u.grant.endsAt)}`
                              : u.currentPeriodEnd && u.recordStatus === "ACTIVE"
                                ? `Complimentary · until ${longDate(u.currentPeriodEnd)}`
                                : "Complimentary"}
                          </span>
                        ) : null}
                        {u.syncing ? <span className={cx("au-plan-src", "au-syncing")}>Syncing</span> : null}
                      </div>
                    </td>
                    <td data-l="Admin">
                      {u.isPlatformAdmin ? <span className={cx("stamp")}>Admin</span> : <span className={cx("au-dash")}>—</span>}
                    </td>
                    <td data-l="Created" className={cx("t-mono")}>
                      {longDate(u.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Sheet
        handle={sheet}
        kicker={selected ? selected.email : "Account"}
        title={selected?.name || selected?.email || "Account"}
        onClose={closeSheet}
      >
        {current ? (
          <UserForm key={current.id} user={current} plans={plans} meId={meId} onDone={closeSheet} />
        ) : null}
      </Sheet>
    </>
  );
}

// ── The edit form ──────────────────────────────────────────────────
// Keyed on the user id by the parent, so every field initialises from props
// and there is no effect that syncs state — the sheet stays mounted through
// its exit with the last user's values still in place.

function UserForm({
  user,
  plans,
  meId,
  onDone,
}: {
  user: AdminUserDTO;
  plans: PlanOption[];
  meId: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const isMe = user.id === meId;

  const [name, setName] = useState(user.name ?? "");
  const [email, setEmail] = useState(user.email);
  const [admin, setAdmin] = useState(user.isPlatformAdmin);

  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const profileDirty = name.trim() !== (user.name ?? "") || email.trim().toLowerCase() !== user.email;
  const adminDirty = admin !== user.isPlatformAdmin;
  // The subscription has its own Apply inside its section (SubscriptionEditor):
  // a Stripe change is confirmed on its own, not swept up with a name edit.
  const dirty = profileDirty || adminDirty;

  async function save() {
    if (!dirty || busy) return;
    setBusy("save");
    setErr(null);
    try {
      if (profileDirty) {
        await updateAdminUser({
          userId: user.id,
          email: email.trim().toLowerCase() !== user.email ? email.trim() : undefined,
          name: name.trim() !== (user.name ?? "") ? name.trim() || null : undefined,
        });
      }
      if (adminDirty) await setPlatformAdmin(user.id, admin);

      toast.success("Saved");
      router.refresh();
      onDone();
    } catch (e) {
      setErr(errorMessage(e, "Couldn't save."));
    } finally {
      setBusy(null);
    }
  }

  const confirmMatches = confirm.trim().toLowerCase() === user.email.toLowerCase();

  async function remove() {
    if (!confirmMatches || isMe || busy) return;
    setBusy("delete");
    setErr(null);
    try {
      await deleteAdminUser(user.id);
      toast.success("Account deleted", user.email);
      router.refresh();
      onDone();
    } catch (e) {
      setErr(errorMessage(e, "Couldn't delete."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <SheetBody>
      {err ? <Note tone="danger">{err}</Note> : null}

      <div className={cx("sec")}>
        <div className={cx("sec-h")}>
          <span className={cx("sec-t")}>Account</span>
          <span className={cx("sec-m")}>Since {longDate(user.createdAt)}</span>
        </div>
        <div className={cx("row")}>
          <Field label="Name" htmlFor="au-name">
            <input id="au-name" className={cx("in")} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email" htmlFor="au-email">
            <input
              id="au-email"
              className={cx("in")}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        </div>
        <Toggle
          on={admin}
          onChange={setAdmin}
          disabled={isMe}
          label="Platform admin"
          title={isMe ? "You can't remove your own flag" : "Not an org role"}
        />
      </div>

      <div className={cx("sec")}>
        <div className={cx("sec-h")}>
          <span className={cx("sec-t")}>Subscription</span>
          {user.orgId ? (
            <span className={cx("sec-m")}>
              {user.orgName} · {user.orgMemberCount} member{user.orgMemberCount === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        {!user.orgId ? (
          <Note>No organization.</Note>
        ) : (
          <SubscriptionEditor key={user.orgId + user.recordStatus + user.recordPlan + (user.syncing?.since ?? "")} user={user} plans={plans} />
        )}
      </div>

      {/* The custom plan's pages — what its gate opens, beside what Stripe
          bills (owner, 2026-10-06). Only for an org on the custom plan. */}
      {user.orgId && user.recordPlan.toUpperCase() === "CUSTOM" ? (
        <CustomPagesEditor key={user.orgId + user.recordPlan} orgId={user.orgId} orgName={user.orgName} />
      ) : null}

      {user.orgId ? (
        <OrgInternal key={user.orgId + String(user.orgInternal)} orgId={user.orgId} orgName={user.orgName} initial={user.orgInternal} />
      ) : null}

      {/* The meters and the admin's reset (owner, 2026-09-22). Reads on open,
          so the table lists people without a COUNT per limit per row. */}
      {user.orgId ? <UsageReset key={user.orgId} orgId={user.orgId} orgName={user.orgName} /> : null}

      <div className={cx("sec", "sec--danger")}>
        <div className={cx("sec-h")}>
          <span className={cx("sec-t")}>Delete account</span>
        </div>
        <div className={cx("au-del-row")}>
          <Field label="Confirm email" htmlFor="au-confirm">
            <input
              id="au-confirm"
              className={cx("in", "in--mono")}
              placeholder={user.email}
              value={confirm}
              disabled={isMe}
              autoComplete="off"
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <button
            type="button"
            className={cx("btn", "btn-danger", "btn-field")}
            title={isMe ? "You can't delete your own account" : undefined}
            disabled={!confirmMatches || isMe || busy !== null}
            onClick={remove}
          >
            {busy === "delete" ? "Deleting…" : "Delete account"}
          </button>
        </div>
      </div>

      </SheetBody>
      <SheetFoot>
        <button type="button" className={cx("btn", "btn-ghost")} onClick={onDone} disabled={busy !== null}>
          Cancel
        </button>
        <button
          type="button"
          className={cx("btn", "btn-primary")}
          onClick={save}
          disabled={!dirty || busy !== null}
        >
          {busy === "save" ? "Saving…" : "Save changes"}
        </button>
      </SheetFoot>
    </>
  );
}

/**
 * "Internal organization" — JobFlex's own (Organization.isInternal), the only
 * kind a Lead Center test lead can be sent to. Saved the moment it flips, on
 * its own: it is the organization's flag, not part of this account's form.
 */
function OrgInternal({ orgId, orgName, initial }: { orgId: string; orgName: string | null; initial: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  async function flip(next: boolean) {
    if (busy) return;
    setBusy(true);
    setOn(next);
    try {
      await setOrganizationInternal(orgId, next);
      toast.success(next ? "Marked internal" : "No longer internal", next ? `${orgName ?? "The organization"} can receive Lead Center test leads.` : `${orgName ?? "The organization"} gets no test leads.`);
      router.refresh();
    } catch (err) {
      setOn(!next);
      toast.error("Couldn't change it", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={cx("sec")}>
      <div className={cx("sec-h")}>
        <span className={cx("sec-t")}>Lead Center</span>
      </div>
      <Toggle
        on={on}
        onChange={(next) => void flip(next)}
        disabled={busy}
        label="Internal organization"
        sub="JobFlex's own. Test leads go to internal organizations only."
      />
    </div>
  );
}
