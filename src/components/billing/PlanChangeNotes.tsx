"use client";
// THE MONEY LINES OF A PLAN CHANGE (owner, 2026-10-12). The declined-card line
// with the way to a new card: a change the card did not pay for changes
// nothing (actions/billing changePlan), and the owner is pointed at
// /api/billing/update-card. One component for the desk page, the handheld
// page and the subscription page that embeds them.
import * as React from "react";
import { useUpdateCard } from "@/components/v3/payment-ribbon/payment-ribbon";
import "./plan-change-notes.css";

/** "Card declined — update your card" and the button to a new card. */
export function CardDeclinedNote({ message, className }: { message: string; className?: string }) {
  const card = useUpdateCard();
  return (
    <div className={"jf-pcn-declined" + (className ? ` ${className}` : "")} role="alert" data-card-declined>
      <span>{message}</span>
      <button type="button" className="jf-pcn-btn" disabled={card.busy} onClick={() => void card.go()}>
        {card.busy ? "Opening…" : "Update card"}
      </button>
      {card.error ? <span className="jf-pcn-err">{card.error}</span> : null}
    </div>
  );
}
