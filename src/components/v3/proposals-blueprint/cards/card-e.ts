// All-list card, variant E (2026-10-30, from-scratch round): "calm at rest, detail on demand".
//
// At rest a proposal is one line of an index, read left to right in the order a contractor asks:
//   WHAT (title, client, place)  ·  WHERE IT STANDS (stamp + one fact)  ·  MONEY (one figure + one line)  ·  THE ONE
//   ACTION for its state  ·  a disclosure square.
// Columns line up from card to card, so the eye runs down a column (every stamp, every amount) instead of hunting.
// Anything that needs the contractor — an overdue stage, a design the client sent back — replaces the fact line with
// one coloured flag, and the action beside it is the answer to that flag.
// Everything else (payment stages and their billing buttons, financing, activity, change orders, the design line,
// open / client view / copy link / Zillow / delete) lives in a native <details> that opens in place under the line.
// The action shown at rest is never repeated inside, so every data-act appears exactly as often as on the classic card.
//
// The <summary> carries data-act="e-more": openFromRow ignores anything inside [data-act], so a click on it toggles
// the card instead of navigating, and the act delegation has no branch for "e-more", so nothing else runs.
// A row redrawn after a write (patchAllRow) comes back closed.

import type { CardRenderer, CardKit } from "./card-kit";
import { whoHtml } from "@/lib/team/who";
import { payState, sendState, nextStage, stageFacts, statusPlate, paidTier, type ProposalRow, type Installment } from "../proposals-data";

const SIGNED = new Set(["ACCEPTED", "COMPLETED", "PAID"]);
const ic = (id: string, cls = "") => '<svg class="ic' + (cls ? " " + cls : "") + '" aria-hidden="true"><use href="#' + id + '"/></svg>';
/** "OCT 18" → "Oct 18" for running text; the stamp keeps the plate. */
const plate = (s: string) => s.replace(/[A-Z]{2,}/g, (w) => w.charAt(0) + w.slice(1).toLowerCase());
const firstName = (p: ProposalRow) => p.client.split(/\s+/)[0] || "the client";

type Primary = { act: string; html: string } | null;

/** The one thing to do with this proposal now, or null when nothing is waiting on the contractor. */
function primaryOf(p: ProposalRow, kit: CardKit): Primary {
  const { esc } = kit;
  const btn = (act: string, tone: string, icon: string, label: string, title: string, extra = "") =>
    '<button class="e-go e-go--' + tone + '" type="button" data-act="' + act + '"' + extra + ' title="' + esc(title) + '">' + ic(icon) + label + "</button>";
  const ss = sendState(p);
  if (ss === "send") return { act: "send", html: btn("send", "send", "i-send", "Send", p.clientEmail ? "Send to " + p.clientEmail : "Send to the client — add their email as you send") };
  const cd = p.clientDesign;
  if (cd && cd.standing === "returned" && cd.unseen && cd.draftId) {
    return {
      act: "design",
      html: '<a class="e-go e-go--blue" href="/dashboard/deck-estimator?draft=' + encodeURIComponent(cd.draftId) + '" title="' + esc(cd.line) + '">' + ic("i-deck") + "Open design</a>",
    };
  }
  if (payState(p) === "collect" && p.canBill !== false) {
    const next = nextStage(p);
    if (next?.status === "PENDING") return null;
    const what = next ? next.label + " · " + kit.fmtMoney(kit.instDollars(p, next)) : "the balance · " + kit.fmtMoney(p.owed);
    const inst = next ? ' data-inst="' + esc(next.id) + '"' : "";
    if (next && (next.overdue || next.invoiced) && p.clientEmail) {
      return { act: "remind", html: btn("remind", "amber", "i-bell", "Remind", "Email " + p.clientEmail + " a reminder for " + what, inst) };
    }
    return { act: "invoice", html: btn("invoice", "blue", "i-send", next?.invoiced ? "Invoice again" : "Send invoice", "Invoice " + what + " — card, bank or the client's choice", inst) };
  }
  if (ss === "resend") return { act: "send", html: btn("send", "quiet", "i-send", "Resend", "Send it again" + (p.clientEmail ? " to " + p.clientEmail : "")) };
  return null;
}

/** The single flag that needs the contractor, or "". */
function signalOf(p: ProposalRow, kit: CardKit): string {
  const { esc } = kit;
  if (payState(p) === "collect") {
    const next = nextStage(p);
    if (next?.overdue) {
      return (
        '<span class="e-flag e-flag--late">' + ic("i-bell") +
        "<span><b>" + kit.fmtMoney(kit.instDollars(p, next)) + " overdue</b>" + (next.due ? "since " + esc(plate(next.due)) : esc(next.label)) + "</span></span>"
      );
    }
  }
  const cd = p.clientDesign;
  if (cd && cd.standing === "returned" && cd.unseen) {
    return '<span class="e-flag e-flag--new">' + ic("i-deck") + "<span><b>Design sent back</b>" + esc(cd.line.replace(/^.*?·\s*/, "")) + "</span></span>";
  }
  return "";
}

/** The one plain fact under the stamp when nothing is flagged. */
function factOf(p: ProposalRow, esc: CardKit["esc"]): string {
  // A draft's stamp already says it has not gone out; nothing to add.
  if (p.status === "DRAFT") return "";
  if (p.status === "SENT" || p.status === "VIEWED" || p.status === "EXPIRED") {
    if (p.views <= 0) return '<span class="e-fact e-fact--wait">Not opened' + (p.sentAgo ? " · sent " + esc(p.sentAgo) : "") + "</span>";
    return '<span class="e-fact">Opened ' + p.views + "×" + (p.lastViewed ? " · last " + esc(p.lastViewed) : "") + "</span>";
  }
  if (payState(p) === "collect") {
    const next = nextStage(p);
    if (next?.status === "PENDING") return '<span class="e-fact">Payment in progress</span>';
    if (next) return '<span class="e-fact">Next: ' + esc(next.label) + (next.due ? " · due " + esc(plate(next.due)) : "") + "</span>";
    return '<span class="e-fact">Balance to collect</span>';
  }
  return "";
}

function stampOf(p: ProposalRow, kit: CardKit): string {
  const st = statusPlate(p.status);
  const fresh = p.fresh && (p.fresh.accepted || p.fresh.declined) && kit.bloomOnce(p.id, p.fresh.accepted ? "accepted" : "declined", p.fresh.accepted ?? p.fresh.declined);
  const date = SIGNED.has(p.status) && p.accepted ? p.accepted : p.status === "DECLINED" && p.decided ? p.decided.replace(/^declined\s+/i, "").toUpperCase() : "";
  return (
    '<span class="pstatus ' + st.cls + (fresh ? " pstatus--fresh" : "") + '"' +
    (p.fresh?.accepted ? ' title="Accepted ' + kit.esc(p.accepted ?? "") + '"' : p.fresh?.declined ? ' title="Declined"' : "") + ">" +
    kit.esc(st.label) + (date ? '<em class="pstatus-d">' + kit.esc(date) + "</em>" : "") + "</span>"
  );
}

function moneyOf(p: ProposalRow, kit: CardKit): string {
  const contract = p.contract ?? p.total;
  const state = payState(p);
  let sub = "";
  if (state === "collect") {
    const paid = p.paidAmt ?? 0;
    const pct = contract > 0 ? Math.max(0, Math.min(100, Math.round((paid / contract) * 100))) : 0;
    sub =
      '<span class="e-meter e-meter--' + paidTier(p) + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct +
      '" aria-valuetext="' + kit.esc(kit.fmtMoney(paid) + " paid of " + kit.fmtMoney(contract)) + '"><i style="width:' + pct + '%"></i></span>' +
      '<span class="e-msub"><b>' + kit.fmtMoney(p.owed) + "</b> due</span>";
  } else if (state === "paid") {
    sub = '<span class="e-msub e-msub--ok">' + ic("i-check") + "Paid in full</span>";
  } else if (state === "plan") {
    const n = p.inst?.length ?? 0;
    sub = '<span class="e-msub e-msub--quiet">' + n + (n === 1 ? " payment" : " payments") + "</span>";
  }
  return '<span class="e-amt' + (p.status === "DECLINED" ? " e-amt--off" : "") + '">' + kit.fmtMoney(contract) + "</span>" + sub;
}

/* ── Inside the fold ─────────────────────────────────────────────────────────────────────────────── */

function stageLi(p: ProposalRow, it: Installment, next: Installment | null, plan: boolean, kit: CardKit): string {
  let tone = "later";
  let tail = it.due ? "Due " + plate(it.due) : "Later";
  if (it.status === "PAID") {
    tone = "paid";
    tail = "Paid" + (it.paidOn ? " " + plate(it.paidOn) : "") + (it.paidVia === "STRIPE" ? " · Stripe" : it.paidVia === "SQUARE" ? " · Square" : it.paidVia === "MANUAL" ? " · by hand" : "");
  } else if (it.status === "WAIVED") {
    tone = "closed";
    tail = "Closed";
  } else if (plan) {
    tone = "plan";
    tail = it.due ? "Due " + plate(it.due) : "After signing";
  } else if (next && it.id === next.id) {
    tone = it.overdue ? "late" : "next";
    tail = stageFacts(it).map((f) => plate(f)).join(" · ") || "Next to collect";
  }
  return (
    '<li class="e-st e-st--' + tone + '">' +
    '<i class="e-st-mk" aria-hidden="true"></i>' +
    '<span class="e-st-k">' + kit.esc(it.label) + (it.pct ? "<em>" + Math.round(it.amount) + "%</em>" : "") + "</span>" +
    '<span class="e-st-v">' + kit.fmtMoney(kit.instDollars(p, it)) + "</span>" +
    '<span class="e-st-s">' + kit.esc(tail.charAt(0).toUpperCase() + tail.slice(1)) + "</span>" +
    "</li>"
  );
}

/** Mark paid · Send invoice · Remind for the next stage — the same writes payActsHtml draws, minus the one at rest. */
function billActs(p: ProposalRow, next: Installment | null, skip: string, kit: CardKit): string {
  const { esc } = kit;
  const inst = next ? ' data-inst="' + esc(next.id) + '"' : "";
  const what = next ? next.label + " · " + kit.fmtMoney(kit.instDollars(p, next)) : "the balance · " + kit.fmtMoney(p.owed);
  const busy = next?.status === "PENDING" ? " disabled" : "";
  const out: string[] = [];
  const paidAct = next ? "markpaid" : "paidfull";
  if (skip !== paidAct)
    out.push('<button class="e-bill e-bill--paid" type="button" data-act="' + paidAct + '"' + inst + (next ? busy : "") + ' title="' + esc("Record " + what + " as paid by hand") + '">' + ic("i-check") + "Mark paid</button>");
  if (skip !== "invoice")
    out.push('<button class="e-bill e-bill--inv" type="button" data-act="invoice"' + inst + busy + ' title="' + esc("Invoice " + what + " — card, bank or the client's choice") + '">' + ic("i-send") + (next?.invoiced ? "Invoice again" : "Send invoice") + "</button>");
  if (skip !== "remind")
    out.push('<button class="e-bill e-bill--rem" type="button" data-act="remind"' + inst + (p.clientEmail ? "" : " disabled") + ' title="' + esc(p.clientEmail ? "Email " + p.clientEmail + " a reminder for " + what : "No email on the client record") + '">' + ic("i-bell") + "Remind</button>");
  return out.length ? '<div class="e-bills">' + out.join("") + "</div>" : "";
}

function paymentsOf(p: ProposalRow, primary: Primary, kit: CardKit): string {
  const state = payState(p);
  if (!state) return "";
  const insts = p.inst ?? [];
  const next = state === "collect" ? nextStage(p) : null;
  const contract = p.contract ?? p.total;
  const head =
    state === "plan"
      ? kit.fmtMoney(contract) + " in " + insts.length + (insts.length === 1 ? " payment" : " payments")
      : kit.fmtMoney(p.paidAmt ?? 0) + " paid of " + kit.fmtMoney(contract);
  const list = insts.length
    ? '<ol class="e-stages">' + insts.map((it) => stageLi(p, it, next, state === "plan", kit)).join("") + "</ol>"
    : state === "collect"
      ? '<ol class="e-stages"><li class="e-st e-st--next"><i class="e-st-mk" aria-hidden="true"></i><span class="e-st-k">Balance</span><span class="e-st-v">' + kit.fmtMoney(p.owed) + '</span><span class="e-st-s">Next to collect</span></li></ol>'
      : "";
  let foot = "";
  if (state === "plan") foot = '<p class="e-note">Billed after ' + kit.esc(p.clientId ? firstName(p) : "the client") + " accepts</p>";
  else if (state === "collect") foot = p.canBill === false ? '<p class="e-note"><b>' + kit.fmtMoney(p.owed) + "</b> left to collect</p>" : billActs(p, next, primary?.act ?? "", kit);
  return (
    '<section class="e-sec e-sec--pay">' +
    '<h4 class="e-h">Payments<span>' + kit.esc(head) + "</span></h4>" +
    list + foot + kit.finHtml(p) +
    "</section>"
  );
}

function activityOf(p: ProposalRow, primary: Primary, kit: CardKit): string {
  const { esc } = kit;
  const rows: [string, string][] = [];
  if (p.sentAgo) rows.push(["Sent", esc(p.sentAgo)]);
  else if (p.status === "DRAFT") rows.push(["Sent", "Not yet"]);
  if (p.status !== "DRAFT") rows.push(["Opened", p.views > 0 ? p.views + (p.views === 1 ? " view" : " views") + (p.lastViewed ? " · last " + esc(p.lastViewed) : "") : "Not opened online"]);
  if (p.decided) rows.push([p.status === "DECLINED" ? "Declined" : "Signed", esc(plate(p.decided.replace(/^(accepted|declined)\s+/i, "")))]);
  rows.push(["Updated", esc(p.updated)]);
  const co = p.co;
  if (co && co.count) {
    const bits: string[] = [co.count + " change order" + (co.count === 1 ? "" : "s")];
    if (co.approvedTotal) bits.push((co.approvedTotal > 0 ? "+" : "−") + kit.fmtMoney(Math.abs(co.approvedTotal)) + " approved");
    if (co.pending) bits.push(co.pending + " awaiting approval" + (co.pendingTotal ? " (" + (co.pendingTotal > 0 ? "+" : "−") + kit.fmtMoney(Math.abs(co.pendingTotal)) + ")" : ""));
    if (co.drafts) bits.push(co.drafts + " draft" + (co.drafts === 1 ? "" : "s"));
    rows.push(["Changes", '<span class="' + (co.pending ? "e-wait" : "") + '">' + bits.join(" · ") + "</span>"]);
  }
  // The design line, unless the card already leads with it (the flag + Open design at rest).
  const design = primary?.act === "design" ? "" : kit.clientDesignHtml(p);
  return (
    '<section class="e-sec e-sec--act">' +
    '<h4 class="e-h">Activity</h4>' +
    '<dl class="e-dl">' + rows.map(([k, v]) => "<div><dt>" + k + "</dt><dd>" + v + "</dd></div>").join("") + "</dl>" +
    design +
    "</section>"
  );
}

function barOf(p: ProposalRow, primary: Primary, kit: CardKit): string {
  const { esc } = kit;
  const ss = sendState(p);
  const send =
    primary?.act === "send"
      ? ""
      : '<button class="e-tool" type="button" data-act="send" title="' + esc(p.clientEmail ? "Send to " + p.clientEmail : "Send to the client") + '">' + ic("i-send") +
        (ss === "send" || ss === "none" ? "Send to client" : "Resend") + "</button>";
  return (
    '<div class="e-bar">' +
    '<div class="e-bar-l">' +
    '<a class="e-tool e-tool--open" href="' + kit.proposalHref(p.id) + '" title="Open the proposal">' + ic("i-pen") + "Open</a>" +
    send +
    '<a class="e-tool" href="/portal/q/' + encodeURIComponent(p.publicId) + '" target="_blank" rel="noopener noreferrer" title="Client view — the page the client gets, in a new tab">' + ic("i-eye") + "Client view</a>" +
    '<button class="e-tool" type="button" data-act="change-order" title="Price extras, send for signature">' + ic("i-plus") + (p.co && p.co.count ? "Change orders · " + p.co.count : "Change order") + "</button>" +
    (p.zillow ? '<a class="e-tool" href="' + esc(p.zillow) + '" target="_blank" rel="noopener noreferrer" title="Open the listing">' + ic("i-building") + "Zillow</a>" : "") +
    '<button class="e-tool" type="button" data-act="copylink" title="Copy the client\'s link to paste into a text">' + ic("i-link") + "Copy client link</button>" +
    "</div>" +
    '<button class="e-tool e-tool--del" type="button" data-act="del" title="Delete this proposal — permanent">' + ic("i-trash") + "Delete</button>" +
    "</div>"
  );
}

export const renderCardE: CardRenderer = (p, chain, kit) => {
  const { esc } = kit;
  const primary = primaryOf(p, kit);
  const flag = signalOf(p, kit);
  const meta: string[] = [];
  const sub = kit.subLine(p);
  if (sub) meta.push('<span class="e-who">' + esc(sub) + "</span>");
  if (p.projectId && !chain) meta.push('<a class="e-proj" href="/dashboard/projects/' + encodeURIComponent(p.projectId) + '">' + ic("i-folder") + esc(p.projectName ?? "Project") + "</a>");
  const owner = p.mine ? "" : p.ownerWho ? whoHtml(p.ownerWho, { compact: true }) : '<span class="e-owner">' + esc(p.owner) + "</span>";
  return (
    '<tr class="prow e-row' + chain + (flag ? " e-row--flag" : "") + '" data-id="' + esc(p.id) + '"' + (chain && p.projectId ? ' data-grp="' + esc(p.projectId) + '"' : "") + ">" +
    '<td class="e-td" colspan="6"><article class="e-card">' +
    '<div class="e-main">' +
    // WHAT
    '<div class="e-id">' +
    '<div class="e-tags">' + kit.kindHtml(p) + owner + "</div>" +
    '<a class="e-title pt-link" href="' + kit.proposalHref(p.id) + '">' + esc(p.title) + "</a>" +
    (meta.length ? '<div class="e-meta">' + meta.join('<i class="e-dot" aria-hidden="true">·</i>') + "</div>" : "") +
    "</div>" +
    // WHERE IT STANDS
    '<div class="e-stand">' + stampOf(p, kit) + (flag || factOf(p, esc)) + "</div>" +
    // MONEY
    '<div class="e-money">' + moneyOf(p, kit) + "</div>" +
    // THE ONE ACTION
    '<div class="e-do">' + (primary ? primary.html : "") + "</div>" +
    "</div>" +
    // EVERYTHING ELSE, ON DEMAND
    '<details class="e-more">' +
    '<summary class="e-tog" data-act="e-more" title="Payments, activity and every action"><span class="e-sr">Details for ' + esc(p.title) + "</span>" + ic("i-chev") + "</summary>" +
    '<div class="e-panel">' +
    '<div class="e-cols">' + paymentsOf(p, primary, kit) + activityOf(p, primary, kit) + "</div>" +
    barOf(p, primary, kit) +
    "</div>" +
    "</details>" +
    "</article></td></tr>"
  );
};
