"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Check, ChevronDown, Lock, ShieldCheck, X } from "lucide-react";
import type { PortalPayModel } from "@/lib/payments/portalModel";
import { isBelowMin } from "@/lib/paymentSchedule";
import { lockScroll } from "@/lib/scrollLock";
import { startCheckout } from "./use-pay-return";
import styles from "./payment-center.module.css";

type Provider = "stripe" | "square" | "stax";
const providers: Array<{ id: Provider; name: string }> = [{ id: "stripe", name: "Stripe" }, { id: "square", name: "Square" }, { id: "stax", name: "Stax" }];

export function paymentActionLabel(model: PortalPayModel): string {
  return model.anyHosted ? "Make payment" : "Payment details";
}

/** One payment center for both proposal layouts; amounts and availability come from the server. */
export function PaymentCenter({ model, onClose, initialTarget = "next", method = null }: {
  model: PortalPayModel;
  onClose: () => void;
  initialTarget?: "next" | "remaining";
  method?: "card" | "bank" | "any" | null;
}) {
  const next = model.stages.find((s) => s.id === model.nextPayableId);
  const [target, setTarget] = useState(initialTarget);
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const remaining = target === "remaining" || !next;
  const amount = remaining ? model.remaining : next.amount;
  const minor = remaining ? model.remainingMinor : next.amountMinor;
  const available = providers.filter((p) => model.providers[p.id].ok && method !== "bank");
  const bank = model.bankTransfer.ok && method !== "card";

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    const release = lockScroll();
    element?.showModal();
    return () => { element?.close(); release(); previous?.focus(); };
  }, []);

  async function pay(provider: Provider) {
    if (busy) return;
    setBusy(provider);
    setError("");
    try {
      const result = await startCheckout(provider, model.publicId, remaining || next?.synthetic ? "remaining" : { installmentId: next!.id });
      if (!result.ok) setError(result.error);
    } catch {
      setError("Couldn't reach the payment provider. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const stageLabel = remaining ? "Remaining balance" : next.label;
  return createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby={title} aria-busy={Boolean(busy)}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className={styles.content}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <Lock size={18} aria-hidden="true" />
          <div><p className={styles.label}>Secure payment</p><h2 id={title}>Payment center</h2></div>
        </div>
        <button type="button" className={styles.close} aria-label="Close payment center" disabled={Boolean(busy)} onClick={onClose}><X size={20} aria-hidden="true" /></button>
      </header>
      <div className={styles.body}>
        <div className={styles.amount}>
          <span className={styles.label}>{stageLabel}</span>
          <strong>{amount}</strong>
        </div>
        {next && next.amountMinor < model.remainingMinor && !model.financing?.coveredIds.length && <div className={styles.targets} role="radiogroup" aria-label="Amount to pay">
          <button type="button" role="radio" aria-checked={!remaining} disabled={Boolean(busy)} onClick={() => setTarget("next")}>
            <span className={styles.check} aria-hidden="true">{!remaining && <Check size={14} />}</span>
            <span className={styles.targetText}><span className={styles.label}>{next.label}</span><b>{next.amount}</b></span>
          </button>
          <button type="button" role="radio" aria-checked={remaining} disabled={Boolean(busy)} onClick={() => setTarget("remaining")}>
            <span className={styles.check} aria-hidden="true">{remaining && <Check size={14} />}</span>
            <span className={styles.targetText}><span className={styles.label}>Everything</span><b>{model.remaining}</b></span>
          </button>
        </div>}
        {available.length > 0 && <div className={styles.section}>
          <p className={styles.label}>Choose payment provider</p>
          {available.map((provider, i) => {
            const below = isBelowMin(minor, provider.id.toUpperCase() as "STRIPE" | "SQUARE" | "STAX");
            return <div key={provider.id} className={styles.providerWrap}><button type="button" className={`${styles.provider}${i === 0 ? " " + styles.primary : ""}`} disabled={Boolean(busy) || below || minor <= 0} onClick={() => pay(provider.id)}>
              <span className={styles.payAmount}>{busy === provider.id ? "Opening checkout…" : `Pay ${amount}`}</span>
              <span className={styles.providerName}>via {provider.name}<ArrowRight size={16} aria-hidden="true" /></span>
            </button>{below && <p className={styles.note}>Below this provider’s minimum. Select the remaining balance or contact the team.</p>}</div>;
          })}
        </div>}
        {bank && <details className={styles.bank} open={available.length === 0}><summary><span className={styles.label}>Bank transfer</span><ChevronDown size={16} aria-hidden="true" className={styles.chevron} /></summary><p className={styles.bankBody}>{model.bankTransfer.instructions}</p><p className={styles.note}>Reference: {remaining ? "Balance" : next.label}. The team will confirm when it arrives.</p></details>}
        {!available.length && !bank && <p className={styles.note}>The team will be in touch about payment.</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
      {available.length > 0 && <footer className={styles.footer}><ShieldCheck size={16} aria-hidden="true" /><p>You’ll complete payment with the provider you choose, then return to your proposal.</p></footer>}
    </div>
  </dialog>, document.body);
}
