"use client";
// CARD SPEND FROM RAMP ON THE EXPENSES TAB (2026-10-29): the swipes nobody has placed on a job yet — the office
// picks the job, the warehouse, or leaves it — and the latest ones that landed on their own. Reads through the
// server action once on mount (nothing on the page's own loader), and again after every pick.
import { useCallback, useEffect, useState } from "react";
import { placeRampTransaction, readRampCardSpend } from "@/actions/ramp";
import type { RampTxRecord } from "@/lib/ramp/sync";

const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");

export function RampCardSpend({ jobs, onChanged }: { jobs: ReadonlyArray<{ id: string; title: string }>; onChanged?: () => void }) {
  const [state, setState] = useState<{ connected: boolean; needsJob: RampTxRecord[]; recent: RampTxRecord[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string>("");
  const load = useCallback(() => {
    readRampCardSpend()
      .then(setState)
      .catch(() => setState({ connected: false, needsJob: [], recent: [] }));
  }, []);
  useEffect(() => {
    const t = window.setTimeout(load, 0);
    return () => window.clearTimeout(t);
  }, [load]);
  if (!state?.connected) return null;

  const place = async (txId: string, pick: string) => {
    setBusy(txId);
    setNote("");
    try {
      const r = await placeRampTransaction({ txId, jobId: pick === "stock" || pick === "none" ? null : pick, stock: pick === "stock", none: pick === "none" });
      if (!r.ok) throw new Error(r.error);
      setNote(`Placed on ${r.where}.`);
      load();
      onChanged?.();
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not place it.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card card--table" data-ramp-spend>
      <div className="tb-head">
        <span className="kpi-lbl">Card spend · Ramp</span>
        <span className="tb-total">{state.needsJob.length ? `${state.needsJob.length} waiting for a job` : "every swipe is on a job"}</span>
      </div>
      {note ? <div className="fi-tnote" role="status">{note}</div> : null}
      {state.needsJob.length > 0 && (
        <table className="ptable fi-table" data-ramp-needs>
          <thead>
            <tr>
              <th>Date</th>
              <th>Who</th>
              <th>Where</th>
              <th className="num">Amount</th>
              <th>Put it on</th>
            </tr>
          </thead>
          <tbody>
            {state.needsJob.map((r) => (
              <tr key={r.txId} data-ramp-tx={r.txId}>
                <td>{day(r.at)}</td>
                <td>{r.who || "—"}{r.askedAt ? <span className="pmuted"> · asked by text</span> : null}</td>
                <td>{r.merchant}<span className="pmuted"> · {r.category}</span></td>
                <td className="num">{money(r.amount)}</td>
                <td>
                  <select className="pselect" aria-label={`Job for ${r.merchant}`} disabled={busy === r.txId} defaultValue="" onChange={(e) => { if (e.target.value) void place(r.txId, e.target.value); }} data-ramp-pick>
                    <option value="">Pick a job…</option>
                    {jobs.map((j) => (
                      <option key={j.id} value={j.id}>{j.title}</option>
                    ))}
                    <option value="stock">Stock / warehouse</option>
                    <option value="none">Leave it off the jobs</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {state.recent.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="pmuted">Latest swipes on jobs · {state.recent.length}</summary>
          <table className="ptable fi-table" data-ramp-recent>
            <tbody>
              {state.recent.slice(0, 12).map((r) => (
                <tr key={r.txId}>
                  <td>{day(r.at)}</td>
                  <td>{r.who || "—"}</td>
                  <td>{r.merchant}</td>
                  <td>{r.stock ? "Stock" : r.jobTitle}{r.receiptDone ? <span className="pmuted"> · receipt</span> : null}</td>
                  <td className="num">{money(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
