"use client";
// MINUTES AND PACKS — Settings → AI desk (2026-10-13): where the company stands this
// month, "Add 300 minutes" (the card on file to confirm, or Stripe Checkout — the Lead
// Center's flow, lib/aiDesk/packs), auto top-up, the packs bought; and the way back from
// Checkout (`?pane=desk&pack_paid=1&session_id=…`).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { chargeDeskPack, finishDeskPackCheckout, setDeskAutoTopUp, startDeskPack } from "@/actions/aiDesk";
import { dollars, minutesLeftWords, type DeskBalance, type DeskPackRecord } from "@/lib/aiDesk/shared";
import { DESK_COPY as C, type DeskSettingsData } from "@/components/v3/settings-blueprint/settings-data";
import s from "./ai-desk.module.css";

type Confirm = { amountCents: number; brand: string; last4: string };

export function DeskMinutes({ desk }: { desk: DeskSettingsData }) {
  const router = useRouter();
  const m = desk.minutes;
  const [balance, setBalance] = useState<DeskBalance>(m.balance);
  const [history, setHistory] = useState<DeskPackRecord[]>(m.history);
  const [auto, setAuto] = useState(m.balance.autoTopUp);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState<null | "start" | "charge" | "auto">(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const price = dollars(m.pack.cents);

  const start = async () => {
    setBusy("start");
    setErr("");
    setNote("");
    try {
      const step = await startDeskPack();
      if (step.kind === "confirm") setConfirm(step);
      else if (step.kind === "checkout") window.location.assign(step.url);
      else if (step.kind === "added") {
        setBalance(step.balance);
        setHistory(step.history);
        setNote(C.added(step.minutes));
        router.refresh();
      } else setErr(step.reason);
    } catch {
      setErr(C.packFailed);
    } finally {
      setBusy(null);
    }
  };

  const charge = async () => {
    setBusy("charge");
    setErr("");
    try {
      const step = await chargeDeskPack();
      if (step.kind === "added") {
        setBalance(step.balance);
        setHistory(step.history);
        setConfirm(null);
        setNote(C.added(step.minutes));
        router.refresh();
      } else if (step.kind === "checkout") {
        // The card said no, or the bank wants a word: Stripe's page takes it from here.
        window.location.assign(step.url);
      } else if (step.kind === "no-billing") setErr(step.reason);
    } catch {
      setErr(C.packFailed);
    } finally {
      setBusy(null);
    }
  };

  const toggleAuto = async (on: boolean) => {
    const prev = auto;
    setAuto(on);
    setBusy("auto");
    setErr("");
    try {
      const r = await setDeskAutoTopUp(on);
      if (r.ok) {
        setNote(r.note ?? "");
        router.refresh();
      } else {
        setAuto(prev);
        setErr(r.error);
      }
    } catch {
      setAuto(prev);
      setErr(C.packFailed);
    } finally {
      setBusy(null);
    }
  };

  // Back from Stripe Checkout — the Lead Center's pattern: read the address bar once,
  // land the pack, then clean the address bar so Back is just the settings.
  useEffect(() => {
    const url = new URL(window.location.href);
    const sessionId = url.searchParams.get("session_id");
    const paid = url.searchParams.get("pack_paid");
    const cancelled = url.searchParams.get("pack_checkout") === "cancelled";
    if (!paid && !cancelled) return;
    const clean = () => {
      url.searchParams.delete("pack_paid");
      url.searchParams.delete("session_id");
      url.searchParams.delete("pack_checkout");
      router.replace((url.pathname + url.search + url.hash) as never, { scroll: false });
    };
    void (async () => {
      try {
        if (cancelled || !sessionId) {
          await Promise.resolve();
          if (cancelled) setNote(C.checkoutCancelled);
          return;
        }
        const r = await finishDeskPackCheckout(sessionId);
        if (r.status === "added" && r.balance) {
          setBalance(r.balance);
          setHistory(r.history ?? []);
          setNote(C.added(m.pack.minutes));
        } else if (r.status === "pending") setNote(C.checkoutPending);
        else if (r.status === "invalid") setErr(C.checkoutInvalid);
        else setErr(C.packFailed);
      } catch {
        setErr(C.packFailed);
      } finally {
        clean();
      }
    })();
  }, [router, m.pack.minutes]);

  const usedMin = Math.round(balance.usedSeconds / 60);
  const includedPct = balance.includedMinutes > 0 ? Math.min(100, Math.round((Math.min(usedMin, balance.includedMinutes) / balance.includedMinutes) * 100)) : 100;

  return (
    <div className={s.root} data-desk-minutes-card data-out={balance.out ? "1" : "0"} data-low={balance.low ? "1" : "0"}>
      <div className={s.balance}>
        <div className={s.row}>
          <div className={s.balanceBig} data-desk-left>
            {minutesLeftWords(balance)}
          </div>
          {confirm ? null : (
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy !== null || !m.billingOn || !desk.canManage} onClick={() => void start()} data-desk-buy>
              {busy === "start" ? C.buying : C.buyPack(m.pack.minutes, price)}
            </button>
          )}
        </div>
        <div className={s.balanceRow} data-desk-balance-row>
          <span>{C.included(balance.includedMinutes)}</span>
          <span>{C.usedWords(usedMin)}</span>
          <span>{C.packsWords(Math.floor(balance.packSeconds / 60))}</span>
        </div>
        <div className={s.bar} aria-hidden>
          <span style={{ width: `${includedPct}%` }} />
        </div>
      </div>

      {confirm ? (
        <div className={`${s.row} ${s.confirm}`} data-desk-confirm>
          <span>{C.confirmCharge(dollars(confirm.amountCents), confirm.brand, confirm.last4)}</span>
          <span className={s.rowActs}>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy !== null} onClick={() => void charge()} data-desk-charge>
              {busy === "charge" ? C.buying : C.charge}
            </button>
            <button type="button" className={s.btn} disabled={busy !== null} onClick={() => setConfirm(null)}>
              {C.notNow}
            </button>
          </span>
        </div>
      ) : null}
      {!m.billingOn ? <p className={`${s.note} ${s.noteErr}`}>{C.noBilling}</p> : null}

      <label className={s.switch} data-desk-auto>
        <input type="checkbox" checked={auto} disabled={busy !== null || !m.card || !desk.canManage} onChange={(e) => void toggleAuto(e.target.checked)} />
        <span>
          <b>{C.autoTitle}</b>
          <span className={s.note}>{m.card ? C.autoSub(m.pack.minutes, price, m.card.brand, m.card.last4) : C.autoNoCard}</span>
          {m.autoFailedAt ? <span className={`${s.note} ${s.noteErr}`}>{C.autoFailed}</span> : null}
        </span>
      </label>

      <div className={s.sec}>
        <div className={s.h}>{C.historyTitle}</div>
        {history.length ? (
          <ul className={s.history} data-desk-history>
            {history.map((h) => (
              <li key={`${h.at}-${h.ref ?? ""}`}>
                <span>{h.at.slice(0, 10)}</span>
                <span>{h.minutes} min</span>
                <span>{dollars(h.cents)}</span>
                <span>{C.via[h.via] ?? h.via}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={s.note}>{C.historyNone}</p>
        )}
      </div>

      {note ? (
        <p className={`${s.note} ${s.noteOk}`} role="status" data-desk-minutes-note>
          {note}
        </p>
      ) : null}
      {err ? (
        <p className={`${s.note} ${s.noteErr}`} role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}
