"use client";

// ADMIN · "Usage this cycle" inside the account sheet (owner, 2026-09-22).
//
// One row per plan limit: what the organization has used against its cap
// this cycle, and a Reset on every monthly meter (seats are live counts and
// have none). A reset deletes nothing and moves no cap — it writes a mark
// the limits engine counts from (lib/usageReset), so the customer's sidebar,
// plans page and Convert buttons read the new remaining on their next load.
//
// Two presses: the first arms the button and it says what will happen
// ("5 / 5 → 0 / 5"), the second runs it. A reason is required and goes on
// the organization's activity with the admin's email.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/Toast";
import { getAdminOrgUsage, resetAdminOrgUsage, type AdminUsage, type AdminUsageRow } from "@/actions/adminUsage";
import { formatSpend } from "@/lib/paidApiCosts";
import type { LimitKey } from "@/lib/planLimits";
import shared from "./admin-shared.module.css";
import s from "./admin-users.module.css";
import { makeCx, Field, Note, errorMessage } from "./admin-kit";

const cx = makeCx(s, shared);

function meter(used: number, limit: number | null): string {
  return limit === null ? `${used} · no cap` : `${used} / ${limit}`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function UsageReset({ orgId, orgName }: { orgId: string; orgName: string | null }) {
  const router = useRouter();
  const [data, setData] = useState<(AdminUsage & { apiSpendMonthCents: number | null }) | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [armed, setArmed] = useState<LimitKey | "all" | null>(null);
  const [busy, setBusy] = useState<LimitKey | "all" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getAdminOrgUsage(orgId));
      setLoadErr(null);
    } catch (e) {
      setLoadErr(errorMessage(e, "Couldn't read the usage."));
    }
  }, [orgId]);

  // The first read on open — the same read as load(), its state set in the
  // promise's callbacks rather than through a call the effect makes.
  useEffect(() => {
    getAdminOrgUsage(orgId).then(
      (d) => {
        setData(d);
        setLoadErr(null);
      },
      (e) => setLoadErr(errorMessage(e, "Couldn't read the usage.")),
    );
  }, [orgId]);

  const reasonOk = reason.trim().length >= 3;
  const rows = data?.rows ?? [];
  const resettable = rows.filter((r) => r.resettable);
  const inUse = resettable.filter((r) => r.used > 0);

  const run = useCallback(
    async (target: LimitKey | "all") => {
      if (!reasonOk || busy) return;
      if (armed !== target) {
        setArmed(target);
        return;
      }
      setBusy(target);
      setErr(null);
      try {
        const r = await resetAdminOrgUsage({ organizationId: orgId, keys: target === "all" ? "all" : [target], reason });
        if (!r.ok) throw new Error(r.error);
        toast.success(
          target === "all" ? "Usage reset — every limit" : `Usage reset — ${r.done[0]?.label ?? target}`,
          orgName ? `${orgName} counts from now.` : "Counts from now.",
        );
        setArmed(null);
        setReason("");
        await load();
        router.refresh();
      } catch (e) {
        setErr(errorMessage(e, "Couldn't reset."));
        setArmed(null);
      } finally {
        setBusy(null);
      }
    },
    [reasonOk, busy, armed, orgId, reason, orgName, load, router],
  );

  const rowButton = (r: AdminUsageRow) => {
    if (!r.resettable) return <span className={cx("au-us-seat")}>Seat count</span>;
    const isArmed = armed === r.key;
    const isBusy = busy === r.key;
    const nothing = r.used === 0;
    return (
      <button
        type="button"
        className={cx("btn", "btn-sm", isArmed ? "btn-danger" : "btn-ghost")}
        disabled={!reasonOk || busy !== null || nothing}
        title={nothing ? "Nothing to reset" : !reasonOk ? "Give a reason first" : isArmed ? "Press again to run it" : undefined}
        onClick={() => run(r.key)}
      >
        {isBusy ? "Resetting…" : isArmed ? `Confirm: ${meter(r.used, r.limit)} → ${meter(0, r.limit)}` : "Reset"}
      </button>
    );
  };

  return (
    <div className={cx("sec")}>
      <div className={cx("sec-h")}>
        <span className={cx("sec-t")}>Usage this cycle</span>
        {data ? <span className={cx("sec-m")}>Cycle since {when(data.cycleStart)}</span> : null}
      </div>
      {loadErr ? <Note tone="danger">{loadErr}</Note> : null}
      {err ? <Note tone="danger">{err}</Note> : null}

      {data ? (
        <>
          {/* What its paid API calls cost us this calendar month, UTC (lib/apiSpend, 2026-10-22). */}
          {data.apiSpendMonthCents !== null ? (
            <p className={cx("au-us-spend")} data-api-spend="">
              <span>
                API spend this month: <b>{formatSpend(data.apiSpendMonthCents)}</b>
              </span>
              <Link href={`/admin/usage?period=month&org=${encodeURIComponent(orgId)}` as Route}>See services</Link>
            </p>
          ) : null}
          <div className={cx("au-us")} role="table" aria-label="Usage this cycle">
            <div className={cx("au-us-row", "au-us-head")} role="row">
              <span role="columnheader">Limit</span>
              <span role="columnheader" className={cx("au-us-n")}>
                Used
              </span>
              <span role="columnheader" />
            </div>
            {rows.map((r) => (
              <div key={r.key} className={cx("au-us-row", armed === r.key && "is-armed")} role="row">
                <span role="cell" className={cx("au-us-l")}>
                  <span className={cx("au-us-name")}>{r.label}</span>
                  {r.reset ? (
                    <span className={cx("au-us-mark")} title={r.reset.reason}>
                      Reset {when(r.reset.at)} by {r.reset.actorEmail} · was {meter(r.reset.before.used, r.reset.before.limit)}
                    </span>
                  ) : null}
                </span>
                <span role="cell" className={cx("au-us-n", r.limit !== null && r.used >= r.limit && "is-full")}>
                  {meter(r.used, r.limit)}
                </span>
                <span role="cell" className={cx("au-us-act")}>
                  {rowButton(r)}
                </span>
              </div>
            ))}
          </div>

          <Field label="Reason" htmlFor="au-us-reason" hint="Required — goes on the organization's activity with your email. Nothing is deleted; the count starts over from the moment of the reset and the mark ends with the cycle.">
            <textarea
              id="au-us-reason"
              className={cx("in", "ta")}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setArmed(null);
              }}
              placeholder="e.g. Estimates burned by a broken import — agreed on the call to start the month over"
            />
          </Field>

          <div className={cx("au-apply")}>
            <button
              type="button"
              className={cx("btn", armed === "all" ? "btn-danger" : "btn-ghost")}
              disabled={!reasonOk || busy !== null || inUse.length === 0}
              title={inUse.length === 0 ? "Nothing to reset" : !reasonOk ? "Give a reason first" : armed === "all" ? "Press again to run it" : undefined}
              onClick={() => run("all")}
            >
              {busy === "all"
                ? "Resetting…"
                : armed === "all"
                  ? `Confirm: ${inUse.length} limit${inUse.length === 1 ? "" : "s"} → 0`
                  : "Reset all"}
            </button>
          </div>
        </>
      ) : !loadErr ? (
        <div className={cx("au-us-loading")}>Reading the meters…</div>
      ) : null}
    </div>
  );
}
