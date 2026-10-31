// All-list card, variant F — "Bold state blocks" (2026-10-30, from-scratch round).
//
// One question per card: where does this proposal stand, how much is riding on it, and what do I do now?
// The card answers it in a single vertical unit on its left edge — a solid block in the state's colour,
// the money that matters for that state as the biggest figure on the card, one line of context and the
// one action that moves it forward. Everything else (what the job is, who it is for, the payment plan,
// the tools) sits to its right and under it, clearly smaller.
//
//   draft         paper block    the quote          → Send to client (green)
//   sent/viewed   blueprint      the quote          → Resend, with "not opened" / "opened 4×" in the block
//   to collect    amber          the stage due now  → Send invoice, or Remind once it has been invoiced
//   overdue       rose           the stage overdue  → same rule
//   paid          emerald        the contract       → nothing to do
//   declined      grey           the quote          → nothing to do
//
// Every function of the classic card is here: Open, Send / Resend / the sent stamp, Client view, Change
// order, Zillow, Copy client link, Delete (apart), Mark paid / Send invoice / Remind (office only),
// financing, the client's deck design, the project link, change orders, views, updated, owner, the bloom.

import type { CardKit, CardRenderer } from "./card-kit";
import type { Installment, ProposalRow } from "../proposals-data";
import { nextStage, payState, sendState, statusPlate, stageFacts } from "../proposals-data";
import { whoHtml } from "@/lib/team/who";

type Key = "draft" | "wait" | "expired" | "collect" | "late" | "paid" | "lost" | "quiet";
type Bill = "paid" | "inv" | "rem";

const ic = (id: string) => '<svg class="ic" aria-hidden="true"><use href="#i-' + id + '"/></svg>';

/** "OCT 27" → "Oct 27": the plates read better in a sentence. */
function day(plate: string | null | undefined): string {
  if (!plate) return "";
  return plate.replace(/[A-Z]{2,}/g, (w) => w[0] + w.slice(1).toLowerCase());
}
/** "declined Oct 25" → "Oct 25". */
function decidedDay(p: ProposalRow): string {
  return (p.decided ?? "").replace(/^\s*\S+\s+/, "");
}
function cap1(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** One billing button with exactly the attributes the classic payActsHtml prints, so every write still works. */
function billBtn(kind: Bill, p: ProposalRow, next: Installment | null, kit: CardKit, cls: string): string {
  const inst = next ? ' data-inst="' + kit.esc(next.id) + '"' : "";
  const what = next ? next.label + " · " + kit.fmtMoney(kit.instDollars(p, next)) : "the balance · " + kit.fmtMoney(p.owed);
  const busy = next?.status === "PENDING";
  if (kind === "paid") {
    return (
      '<button class="' + cls + ' f-bill--paid" type="button" data-act="' + (next ? "markpaid" : "paidfull") + '"' + inst +
      (next && busy ? " disabled" : "") + ' title="' + kit.esc("Record " + what + " as paid by hand") + '">' + ic("check") + "<span>Mark paid</span></button>"
    );
  }
  if (kind === "inv") {
    return (
      '<button class="' + cls + ' f-bill--inv" type="button" data-act="invoice"' + inst + (busy ? " disabled" : "") +
      ' title="' + kit.esc("Invoice " + what + " — card, bank or the client's choice") + '">' + ic("send") +
      "<span>" + (next?.invoiced ? "Invoice again" : "Send invoice") + "</span></button>"
    );
  }
  return (
    '<button class="' + cls + ' f-bill--rem" type="button" data-act="remind"' + inst + (p.clientEmail ? "" : " disabled") +
    ' title="' + kit.esc(p.clientEmail ? "Email " + p.clientEmail + " a reminder for " + what : "No email on the client record") + '">' +
    ic("bell") + "<span>Remind</span></button>"
  );
}

/** The billing action that moves the money now: invoice it, or — once invoiced — remind. None while a payment is in flight. */
function primaryBill(p: ProposalRow, next: Installment | null): Bill | null {
  if (!next) return "inv";
  if (next.status === "PENDING") return null;
  if (next.invoiced && p.clientEmail) return "rem";
  return "inv";
}

function viewsLine(p: ProposalRow): string {
  if (p.views <= 0) return "Not opened yet";
  return "Opened " + p.views + "×" + (p.lastViewed ? " · last " + p.lastViewed : "");
}

export const renderCardF: CardRenderer = (p, chain, kit) => {
  const esc = kit.esc;
  const money = kit.fmtMoney;
  const pay = payState(p);
  const send = sendState(p);
  const next = pay === "collect" ? nextStage(p) : null;
  const contract = p.contract ?? p.total;
  const canBill = p.canBill !== false;
  const signed = p.status === "ACCEPTED" || p.status === "COMPLETED" || p.status === "PAID";

  /* ── THE STATE BLOCK ─────────────────────────────────────────────────── */
  let key: Key = "quiet";
  let label = statusPlate(p.status).label;
  let icon = "file";
  let figure = p.total;
  let caption = "Quote";
  let signal = "";
  let signalTone = "";
  let go = "";
  let primary: Bill | null = null;

  if (pay === "collect") {
    const late = !!next?.overdue;
    key = late ? "late" : "collect";
    icon = late ? "clock" : "card";
    figure = next ? kit.instDollars(p, next) : p.owed;
    if (next?.status === "PENDING") {
      label = "Payment in progress";
      caption = next.label;
    } else {
      label = late ? "Overdue" : "To collect";
      caption = next ? next.label + (late && next.due ? " · since " + day(next.due) : next.due ? " · due " + day(next.due) : " · due now") : "Balance due";
    }
    if (next) {
      const done = stageFacts(next).filter((f) => !/^(due |overdue since |payment in progress)/.test(f));
      signal = done.length ? cap1(done.join(" · ")) : "Not invoiced yet";
    }
    if (canBill) {
      primary = primaryBill(p, next);
      if (primary) go = billBtn(primary, p, next, kit, "f-go");
    } else {
      signal = money(p.owed) + " left to collect";
    }
  } else if (pay === "paid") {
    key = "paid";
    icon = "check";
    label = p.status === "COMPLETED" ? "Completed · paid" : "Paid in full";
    figure = contract;
    const last = (p.inst ?? []).filter((i) => i.status === "PAID" && i.paidOn).pop();
    caption = "Collected" + (last ? " · last " + day(last.paidOn) : "");
  } else if (p.status === "DRAFT") {
    key = "draft";
    icon = "pen";
    caption = "Quote · not sent yet";
  } else if (p.status === "SENT" || p.status === "VIEWED" || p.status === "EXPIRED") {
    key = p.status === "EXPIRED" ? "expired" : "wait";
    icon = p.status === "EXPIRED" ? "hourglass" : p.views > 0 ? "eye" : "send";
    caption = "Quote" + (p.sentAgo ? " · sent " + p.sentAgo : "");
    signal = viewsLine(p);
    signalTone = p.views > 0 ? " is-seen" : " is-unseen";
  } else if (p.status === "DECLINED") {
    key = "lost";
    icon = "x";
    caption = "Quote" + (decidedDay(p) ? " · " + decidedDay(p) : "");
  } else if (signed) {
    // Signed with nothing scheduled and nothing owed on a zero contract — say what it is.
    key = "paid";
    icon = "check";
    figure = contract;
    caption = "Contract";
  }

  // Send lives in the block whenever sending is what moves the proposal (a draft, or one out and waiting).
  const sendInBlock = (send === "send" || send === "resend") && !signed && p.status !== "DECLINED";
  if (sendInBlock) {
    const to = p.clientEmail ? " to " + p.clientEmail : "";
    go =
      send === "send"
        ? '<button class="f-go f-go--send" type="button" data-act="send" title="' + esc(p.clientEmail ? "Send" + to : "Send to the client — add their email as you send") + '">' + ic("send") + "<span>Send to client</span></button>"
        : '<button class="f-go" type="button" data-act="send" title="' + esc("Send it again" + to) + '">' + ic("send") + "<span>Resend</span></button>";
  }

  const fresh =
    p.fresh && (p.fresh.accepted || p.fresh.declined) && kit.bloomOnce(p.id, p.fresh.accepted ? "accepted" : "declined", p.fresh.accepted ?? p.fresh.declined);

  const block =
    '<div class="f-state f-state--' + key + (fresh ? " pstatus--fresh" : "") + '"' +
    (fresh ? ' data-fresh="' + (p.fresh?.accepted ? "accepted" : "declined") + '"' : "") +
    (p.fresh?.accepted ? ' title="' + esc("Accepted " + (p.accepted ? day(p.accepted) : "")) + '"' : p.fresh?.declined ? ' title="Declined"' : "") +
    ">" +
    '<span class="f-state-k">' + ic(icon) + esc(label) + "</span>" +
    '<span class="f-state-v">' + money(figure) + "</span>" +
    '<span class="f-state-c">' + esc(caption) + "</span>" +
    (signal ? '<span class="f-state-s' + signalTone + '">' + esc(signal) + "</span>" : "") +
    (go ? '<span class="f-state-go">' + go + "</span>" : "") +
    "</div>";

  /* ── WHAT IT IS ──────────────────────────────────────────────────────── */
  const owner = p.mine ? "" : p.ownerWho ? whoHtml(p.ownerWho) : '<span class="f-owner">' + esc(p.owner) + "</span>";
  const top =
    '<div class="f-top">' + kit.kindHtml(p) +
    '<span class="f-meta">' + owner + '<span class="f-upd">Updated ' + esc(p.updated) + "</span></span></div>";

  const sub = esc(kit.subLine(p));
  const proj =
    p.projectId && !chain
      ? '<a class="f-proj" href="/dashboard/projects/' + encodeURIComponent(p.projectId) + '">' + ic("folder") + esc(p.projectName ?? "Project") + "</a>"
      : "";

  const facts: string[] = [];
  if (signed && p.decided) facts.push('<span class="f-fact f-fact--ok">' + ic("check") + esc(cap1(p.decided)) + "</span>");
  // Views: in the block while the proposal waits on the client; here otherwise. A draft has nobody to open it.
  if (key !== "wait" && key !== "expired" && p.status !== "DRAFT") {
    facts.push(
      '<span class="f-fact" title="' + esc(p.lastViewed ? "Last opened " + p.lastViewed : "Not opened online") + '">' + ic("eye") +
        (p.views > 0 ? p.views + (p.views === 1 ? " view" : " views") + (p.lastViewed ? " · last " + esc(p.lastViewed) : "") : "Not opened online") +
        "</span>",
    );
  }
  // The sent stamp is a fact, not a tool: when Send is not the block's action it reads here; Resend stays in the foot.
  if (!sendInBlock && send !== "none" && p.sentAgo) {
    facts.push('<span class="f-fact f-fact--sent" title="' + esc("Sent " + p.sentAgo) + '">' + ic("send") + "Sent " + esc(p.sentAgo) + "</span>");
  }
  const co = p.co;
  if (co && co.count) {
    const bits: string[] = [co.count + " change order" + (co.count === 1 ? "" : "s")];
    if (co.approvedTotal) bits.push((co.approvedTotal > 0 ? "+" : "−") + money(Math.abs(co.approvedTotal)) + " approved");
    if (co.drafts) bits.push(co.drafts + " draft" + (co.drafts === 1 ? "" : "s"));
    facts.push('<span class="f-fact">' + ic("plus") + esc(bits.join(" · ")) + "</span>");
    if (co.pending)
      facts.push(
        '<span class="f-fact f-fact--wait">' + ic("hourglass") + co.pending + " awaiting approval" +
          (co.pendingTotal ? " (" + (co.pendingTotal > 0 ? "+" : "−") + money(Math.abs(co.pendingTotal)) + ")" : "") + "</span>",
      );
  }

  /* ── PAYMENTS: the plan as one proportional track ────────────────────── */
  let payHtml = "";
  if (pay) {
    const insts = p.inst ?? [];
    const segs = insts
      .map((it) => {
        const amt = kit.instDollars(p, it);
        const share = it.pct ? Math.round(it.amount) : contract > 0 ? Math.round((amt / contract) * 100) : 0;
        let tone = "later";
        let tail = it.due ? "Due " + day(it.due) : "Later";
        if (it.status === "PAID") {
          tone = "paid";
          tail = "Paid" + (it.paidOn ? " " + day(it.paidOn) : "") + (it.paidVia === "STRIPE" ? " · Stripe" : it.paidVia === "SQUARE" ? " · Square" : "");
        } else if (it.status === "WAIVED") {
          tone = "closed";
          tail = "Closed";
        } else if (pay === "plan") {
          tone = "plan";
          tail = it.due ? "Due " + day(it.due) : "After signing";
        } else if (next && it.id === next.id) {
          tone = it.overdue ? "late" : "next";
          tail = it.status === "PENDING" ? "Payment in progress" : it.overdue && it.due ? "Overdue since " + day(it.due) : it.due ? "Due " + day(it.due) : "Due now";
        }
        return (
          '<li class="f-seg f-seg--' + tone + '" style="--w:' + Math.max(1, share) + '" data-stage="' + esc(it.id) + '">' +
          '<i class="f-seg-bar" aria-hidden="true"></i>' +
          '<span class="f-seg-k">' + esc(it.label) + (it.pct ? "<em>" + share + "%</em>" : "") + "</span>" +
          '<b class="f-seg-v">' + money(amt) + "</b>" +
          '<span class="f-seg-s">' + (tone === "paid" ? ic("check") : "") + esc(tail) + "</span>" +
          "</li>"
        );
      })
      .join("");

    let head = "";
    let side = "";
    if (pay === "plan") {
      head = '<span class="f-pay-k">Payment plan</span><span class="f-pay-sum">' + money(contract) + " in " + insts.length + (insts.length === 1 ? " payment" : " payments") + "</span>";
      side = '<span class="f-pay-note">' + esc(p.clientId ? "Billed after " + p.client.split(/\s+/)[0] + " accepts" : "Billed after the client accepts") + "</span>";
    } else if (pay === "paid") {
      head = '<span class="f-pay-k">Payments</span><span class="f-pay-sum f-pay-sum--ok">' + ic("check") + "Paid in full · <b>" + money(contract) + "</b></span>";
    } else {
      head =
        '<span class="f-pay-k">Payments</span><span class="f-pay-sum">Paid <b>' + money(p.paidAmt ?? 0) + "</b> of <b>" + money(contract) + "</b>" +
        (p.owed > 0 ? ' · <b class="f-owed">' + money(p.owed) + "</b> left" : "") + "</span>";
      if (canBill) {
        side = (["paid", "inv", "rem"] as Bill[]).filter((b) => b !== primary).map((b) => billBtn(b, p, next, kit, "f-bill")).join("");
        side = '<span class="f-bills">' + side + "</span>";
      }
    }
    payHtml =
      '<section class="f-pay f-pay--' + pay + '">' +
      '<div class="f-pay-h">' + head + side + "</div>" +
      (segs ? '<ol class="f-track">' + segs + "</ol>" : "") +
      kit.finHtml(p) +
      "</section>";
  } else if (p.fin) {
    payHtml = kit.finHtml(p) ? '<section class="f-pay f-pay--none">' + kit.finHtml(p) + "</section>" : "";
  }

  const body =
    '<div class="f-body">' +
    top +
    '<a class="f-title" href="' + kit.proposalHref(p.id) + '">' + esc(p.title) + "</a>" +
    '<div class="f-sub">' + (sub ? "<span>" + sub + "</span>" : "") + proj + "</div>" +
    (facts.length ? '<div class="f-facts">' + facts.join("") + "</div>" : "") +
    kit.clientDesignHtml(p) +
    payHtml +
    "</div>";

  /* ── TOOLS: everything else that can be done to it, quiet, in one foot ── */
  let sendTool = "";
  if (!sendInBlock) {
    if (send === "none") {
      sendTool = '<button class="f-tool" type="button" data-act="send" title="' + esc(p.clientEmail ? "Send to " + p.clientEmail : "Send to the client") + '">' + ic("send") + "<span>Send to client</span></button>";
    } else {
      sendTool =
        '<button class="f-tool" type="button" data-act="send" title="' + esc("Send it again" + (p.clientEmail ? " to " + p.clientEmail : "")) + '">' + ic("send") + "<span>Resend</span></button>";
    }
  }
  const foot =
    '<div class="f-foot">' +
    '<div class="f-tools">' +
    '<a class="f-tool f-tool--open" href="' + kit.proposalHref(p.id) + '" title="Open the proposal">' + ic("pen") + "<span>Open</span></a>" +
    '<a class="f-tool" href="/portal/q/' + encodeURIComponent(p.publicId) + '" target="_blank" rel="noopener noreferrer" title="Client view — the page the client gets, in a new tab">' + ic("eye") + "<span>Client view</span></a>" +
    '<button class="f-tool" type="button" data-act="change-order" title="Price extras, send for signature">' + ic("plus") + "<span>" + (co && co.count ? "Change orders · " + co.count : "Change order") + "</span></button>" +
    (p.zillow ? '<a class="f-tool" href="' + esc(p.zillow) + '" target="_blank" rel="noopener noreferrer" title="Open the listing">' + ic("building") + "<span>Zillow</span></a>" : "") +
    '<button class="f-tool" type="button" data-act="copylink" title="Copy the client\'s link to paste into a text">' + ic("link") + '<span class="f-l-long">Copy client link</span><span class="f-l-short">Copy link</span></button>' +
    sendTool +
    "</div>" +
    '<button class="f-tool f-tool--del" type="button" data-act="del" title="Delete this proposal — permanent">' + ic("trash") + "<span>Delete</span></button>" +
    "</div>";

  return (
    '<tr class="prow f-row' + chain + '" data-id="' + esc(p.id) + '"' +
    (chain && p.projectId ? ' data-grp="' + esc(p.projectId) + '"' : "") +
    '><td colspan="6" class="f-td"><article class="f-card f-card--' + key + '">' +
    block + body + foot +
    "</article></td></tr>"
  );
};
