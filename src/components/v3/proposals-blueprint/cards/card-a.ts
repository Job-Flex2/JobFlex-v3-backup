// All-list card, variant A — "Headline ledger" (2026-10-30, owner review of three candidates).
//
// One proposal reads like one line of a well-set ledger. Two things are loud and sit on one baseline: the
// TITLE (what the job is) and the MONEY (what it is worth). Everything else drops to one quiet metadata line.
// Status is structure, not a chip: the card's left edge is a band in the status colour and the status word
// opens the metadata line in the same colour. Payments fold into one strip — the single figure that matters
// (next to collect / first payment / paid in full) emphasised, the stages a segmented bar under it with
// small captions. The action bar keeps one primary for the state (Send on a draft, Open otherwise); the
// rest are quiet text buttons, Delete apart at the far end.
//
// The whole card is ONE `<tr class="prow">` with one cell, so the page's row patching (tailRowsOf) and
// open-on-click (openFromRow) treat it as the classic row; every `data-act` is the classic one.

import type { CardRenderer, CardKit } from "./card-kit";
import { nextStage, payState, sendState, stageFacts, statusPlate, type Installment, type ProposalRow } from "../proposals-data";
import { whoHtml } from "@/lib/team/who";

const ic = (id: string) => '<svg class="ic" aria-hidden="true"><use href="#i-' + id + '"/></svg>';

/** The status's tone — the band's colour and the status word's. */
function toneOf(status: string): string {
  switch (status) {
    case "SENT":
      return "sent";
    case "VIEWED":
      return "viewed";
    case "ACCEPTED":
      return "won";
    case "COMPLETED":
    case "PAID":
      return "paid";
    case "DECLINED":
      return "lost";
    case "EXPIRED":
      return "expired";
    default:
      return "draft";
  }
}

const signed = (p: ProposalRow) => p.status === "ACCEPTED" || p.status === "COMPLETED" || p.status === "PAID";

/** "Oct 18" from the "OCT 18" plates the rows carry — sentence case reads quieter in a metadata line. */
const plate = (s: string | null | undefined) => (s ? s.replace(/\b([A-Z])([A-Z]+)\b/g, (_, a: string, b: string) => a + b.toLowerCase()) : "");

function statusHtml(p: ProposalRow, kit: CardKit): string {
  const st = statusPlate(p.status);
  const fresh = p.fresh && kit.bloomOnce(p.id, p.fresh.accepted ? "accepted" : "declined", p.fresh.accepted ?? p.fresh.declined);
  const title = p.fresh?.accepted ? ' title="Accepted ' + kit.esc(p.accepted ?? "") + '"' : p.fresh?.declined ? ' title="Declined"' : "";
  return (
    '<span class="pla-st' + (fresh ? " pstatus--fresh" + (p.status === "DECLINED" ? " pstatus--declined" : "") : "") + '"' + title + ">" +
    kit.esc(st.label) +
    (p.accepted && signed(p) ? " <em>" + kit.esc(plate(p.accepted)) + "</em>" : "") +
    "</span>"
  );
}

function viewsHtml(p: ProposalRow, kit: CardKit): string {
  // A draft has nobody to open it — nothing to say.
  if (p.status === "DRAFT") return "";
  if (p.views <= 0) {
    const waiting = p.status === "SENT" || p.status === "VIEWED";
    return (
      '<span class="pla-m pla-views' + (waiting ? " pla-views--none" : "") + '" title="Not opened online' + (p.sentAgo ? kit.esc(" — sent " + p.sentAgo) : "") + '">' +
      ic("eye") + "Not opened</span>"
    );
  }
  return (
    '<span class="pla-m pla-views pla-views--seen" title="' + (p.lastViewed ? kit.esc("Last opened " + p.lastViewed) : "Opened by the client") + '">' +
    ic("eye") + "<span><b>" + p.views + "</b> " + (p.views === 1 ? "view" : "views") +
    (p.lastViewed ? '<span class="pla-dim">, last ' + kit.esc(p.lastViewed) + "</span>" : "") +
    "</span></span>"
  );
}

function metaHtml(p: ProposalRow, chain: string, kit: CardKit): string {
  const sub = kit.subLine(p);
  const co = p.co && p.co.count
    ? '<span class="pla-m pla-co' + (p.co.pending ? " pla-co--wait" : "") + '">' +
      p.co.count + " change order" + (p.co.count === 1 ? "" : "s") + (p.co.pending ? ", " + p.co.pending + " awaiting approval" : "") +
      "</span>"
    : "";
  return (
    '<div class="pla-meta">' +
    statusHtml(p, kit) +
    (p.kind ? '<span class="pla-m pla-kind">' + kit.kindHtml(p) + "</span>" : "") +
    (sub ? '<span class="pla-m pla-client">' + kit.esc(sub) + "</span>" : "") +
    // A proposal alone in view from its project names it; a chained one has the header above it.
    (p.projectId && !chain
      ? '<a class="pla-m pla-proj" href="/dashboard/projects/' + encodeURIComponent(p.projectId) + '">' + ic("folder") + kit.esc(p.projectName ?? "Project") + "</a>"
      : "") +
    co +
    viewsHtml(p, kit) +
    '<span class="pla-m pla-upd">Updated ' + kit.esc(p.updated) + "</span>" +
    (p.mine ? "" : '<span class="pla-owner">' + (p.ownerWho ? whoHtml(p.ownerWho) : kit.esc(p.owner)) + "</span>") +
    "</div>"
  );
}

/* ── PAYMENTS: the one figure, then the stages as a segmented bar ── */

function segHtml(p: ProposalRow, it: Installment, tone: string, tail: string, kit: CardKit): string {
  const dollars = kit.instDollars(p, it);
  const share = it.pct ? " " + Math.round(it.amount) + "%" : "";
  return (
    '<li class="pla-seg pla-seg--' + tone + '" data-stage="' + kit.esc(it.id) + '" style="flex-grow:' + Math.max(1, Math.round(dollars)) + '" title="' +
    kit.esc(it.label + share + " · " + kit.fmtMoney(dollars) + (tail ? " · " + tail : "")) + '">' +
    '<i class="pla-seg-bar" aria-hidden="true"></i>' +
    '<span class="pla-seg-k">' + kit.esc(it.label) + (share ? "<em>" + share + "</em>" : "") + "</span>" +
    '<span class="pla-seg-v">' + (it.status === "PAID" ? ic("check") : "") + kit.fmtMoney(dollars) + (tail ? ' <span class="pla-seg-t">' + kit.esc(tail) + "</span>" : "") + "</span>" +
    "</li>"
  );
}

function payHtml(p: ProposalRow, kit: CardKit): string {
  const state = payState(p);
  if (!state) return "";
  const insts = p.inst ?? [];
  const next = state === "collect" ? nextStage(p) : null;
  const contract = p.contract ?? p.total;
  const paid = p.paidAmt ?? 0;

  // The one figure.
  let key = "";
  if (state === "paid") {
    key =
      '<span class="pla-pk">' + ic("check") + "Paid in full</span>" +
      '<b class="pla-pv">' + kit.fmtMoney(contract) + "</b>" +
      '<span class="pla-pf">' + (insts.length || 1) + (insts.length === 1 ? " payment" : " payments") + "</span>";
  } else if (state === "plan") {
    const first = insts[0];
    const who = p.clientId && p.client ? p.client.split(/\s+/)[0] : "the client";
    key =
      '<span class="pla-pk">First payment</span>' +
      '<b class="pla-pv">' + kit.fmtMoney(first ? kit.instDollars(p, first) : contract) + "</b>" +
      '<span class="pla-pf">' + kit.esc((first ? first.label + (first.due ? ", due " + plate(first.due) : "") + " · " : "") + "billed after " + who + " accepts") + "</span>";
  } else {
    const late = !!next?.overdue;
    const amount = next ? kit.instDollars(p, next) : p.owed;
    // The stage's own facts; only the one that is a problem (overdue) takes the red.
    const facts = (next ? stageFacts(next) : [])
      .map((f) => (/^overdue/.test(f) ? '<em class="is-late">' + kit.esc(plate(f)) + "</em>" : kit.esc(plate(f))))
      .join(" · ");
    key =
      '<span class="pla-pk">Next to collect</span>' +
      '<b class="pla-pv' + (late ? " is-late" : "") + '">' + kit.fmtMoney(amount) + "</b>" +
      '<span class="pla-pf"><b>' + kit.esc(next ? next.label : "Balance") + "</b>" + (facts ? " · " + facts : "") + "</span>";
  }

  // What the office can do about it — billing is the office's; a rep or an estimator reads what is left.
  let side = "";
  if (state === "collect") {
    side = p.canBill === false ? '<span class="pla-pnote"><b>' + kit.fmtMoney(p.owed) + "</b> left to collect</span>" : kit.payActsHtml(p, next);
  }

  // The stages: a bar in proportion, each stage a segment with a small caption.
  let segs = insts
    .map((it) => {
      if (it.status === "PAID") return segHtml(p, it, "paid", it.paidOn ? plate(it.paidOn) : "", kit);
      if (it.status === "WAIVED") return segHtml(p, it, "closed", "closed", kit);
      if (state === "plan") return segHtml(p, it, "plan", it.due ? plate(it.due) : "", kit);
      if (next && it.id === next.id) return segHtml(p, it, it.overdue ? "late" : "next", it.overdue ? "overdue" : it.due ? plate(it.due) : "", kit);
      return segHtml(p, it, "later", it.due ? plate(it.due) : "", kit);
    })
    .join("");
  if (!segs && state === "collect") {
    segs =
      '<li class="pla-seg pla-seg--next" style="flex-grow:1"><i class="pla-seg-bar" aria-hidden="true"></i>' +
      '<span class="pla-seg-k">Balance</span><span class="pla-seg-v">' + kit.fmtMoney(p.owed) + "</span></li>";
  }
  const sum =
    state === "plan"
      ? kit.fmtMoney(contract) + " in " + (insts.length || 1) + (insts.length === 1 ? " payment" : " payments")
      : state === "paid"
        ? ""
        : kit.fmtMoney(paid) + " paid of " + kit.fmtMoney(contract);

  return (
    '<div class="pla-pay pla-pay--' + state + '">' +
    '<div class="pla-pay-top">' +
    '<div class="pla-pay-key">' + key + "</div>" +
    (side ? '<div class="pla-pay-side">' + side + "</div>" : "") +
    "</div>" +
    (segs
      ? '<div class="pla-pay-track"><ol class="pla-segs" aria-label="' + kit.esc(sum || "Paid in full") + '">' + segs + "</ol>" +
        (sum ? '<span class="pla-pay-sum">' + kit.esc(sum) + "</span>" : "") + "</div>"
      : "") +
    kit.finHtml(p) +
    "</div>"
  );
}

/* ── ACTIONS: one primary for the state, the rest quiet, Delete apart ── */

function barHtml(p: ProposalRow, kit: CardKit): string {
  const s = sendState(p);
  const href = kit.proposalHref(p.id);
  const sendTitle = kit.esc(p.clientEmail ? "Send to " + p.clientEmail : "Send to the client — add their email as you send");
  // A draft's job is to go out: Send is the primary, Open steps back. Otherwise Open leads.
  const primarySend = s === "send";
  const open = '<a class="pla-btn' + (primarySend ? "" : " pla-btn--primary") + '" href="' + href + '" title="Open the proposal">' + ic("pen") + "Open</a>";
  let send = "";
  if (s === "send") {
    send = '<button class="pla-btn pla-btn--send" type="button" data-act="send" title="' + sendTitle + '">' + ic("send") + "Send to client</button>";
  } else if (s === "none") {
    send = '<button class="pla-btn" type="button" data-act="send" title="' + sendTitle + '">' + ic("send") + "Send to client</button>";
  } else {
    // Out once, it can always go again (owner, 2026-10-28): the stamp says when, Resend beside it.
    send =
      '<span class="pla-sent" title="' + kit.esc("Sent " + (p.sentAgo ?? "")) + '">' + ic("check") + "Sent <small>" + kit.esc(p.sentAgo ?? "") + "</small></span>" +
      '<button class="pla-btn" type="button" data-act="send" title="' + kit.esc("Send it again" + (p.clientEmail ? " to " + p.clientEmail : "")) + '">' + ic("send") + "Resend</button>";
  }
  const lead = primarySend ? send + open : open + send;
  return (
    '<div class="pla-bar">' +
    '<div class="pla-bar-l">' +
    lead +
    '<span class="pla-sep" aria-hidden="true"></span>' +
    '<a class="pla-btn" href="/portal/q/' + encodeURIComponent(p.publicId) + '" target="_blank" rel="noopener noreferrer" title="Client view — the page the client gets, in a new tab">' + ic("eye") + "Client view</a>" +
    '<button class="pla-btn" type="button" data-act="change-order" title="Price extras, send for signature">' + ic("plus") + (p.co && p.co.count ? "Change orders · " + p.co.count : "Change order") + "</button>" +
    (p.zillow ? '<a class="pla-btn" href="' + kit.esc(p.zillow) + '" target="_blank" rel="noopener noreferrer" title="Open the listing">' + ic("building") + "Zillow</a>" : "") +
    '<button class="pla-btn" type="button" data-act="copylink" title="Copy the client\'s link to paste into a text">' + ic("link") + "Copy client link</button>" +
    "</div>" +
    '<button class="pla-btn pla-btn--del" type="button" data-act="del" aria-label="Delete" title="Delete this proposal — permanent">' + ic("trash") + '<span class="pla-btn-t">Delete</span></button>' +
    "</div>"
  );
}

export const renderCardA: CardRenderer = (p, chain, kit) => {
  const pay = payHtml(p, kit);
  return (
    '<tr class="prow pla-row' + chain + (pay ? " has-pay" : " no-pay") + '" data-id="' + kit.esc(p.id) + '"' +
    (chain && p.projectId ? ' data-grp="' + kit.esc(p.projectId) + '"' : "") +
    '><td colspan="6">' +
    '<article class="pla" data-tone="' + toneOf(p.status) + '">' +
    '<div class="pla-main">' +
    '<div class="pla-head">' +
    '<a class="pla-title" href="' + kit.proposalHref(p.id) + '">' + kit.esc(p.title) + "</a>" +
    '<span class="pla-money">' + kit.fmtMoney(p.contract ?? p.total) + "</span>" +
    "</div>" +
    metaHtml(p, chain, kit) +
    kit.clientDesignHtml(p) +
    "</div>" +
    pay +
    barHtml(p, kit) +
    "</article>" +
    "</td></tr>"
  );
};
