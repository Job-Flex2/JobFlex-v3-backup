// All-list card, variant D (2026-10-30, from-scratch round): THE DRAWING TITLE BLOCK.
//
// Each proposal is the ruled block in the corner of a drawing sheet. One band of four cells answers, left to right,
// the four questions a contractor asks of a row: what job (the title, largest type), where it stands (the status as a
// revision stamp, with when it went and whether it was opened), what it is worth (the money, the second-largest
// figure), and what to do now (ONE next step: Send on a draft, Resend while it waits, the billing buttons while money
// is owed). The cells sit in the same columns on every card, so the eye runs down money or down next steps.
// Under the band, when there is money to schedule, a small payment schedule (one ruled line per stage, the stage
// being chased tinted). The card's foot is the title block's strip: quiet tools split by rules, then who drew it and
// when, then Delete kept apart at the far end.
//
// Every button keeps the page's own data-act; the billing and financing buttons are the kit's own markup.

import type { CardKit, CardRenderer } from "./card-kit";
import type { Installment, ProposalRow } from "../proposals-data";
import { nextStage, paidTier, payState, sendState, stageFacts, statusPlate } from "../proposals-data";
import { whoHtml } from "@/lib/team/who";

const SIGNED = new Set(["ACCEPTED", "COMPLETED", "PAID"]);
const ic = (id: string) => '<svg class="ic" aria-hidden="true"><use href="#i-' + id + '"/></svg>';
const firstName = (s: string) => s.trim().split(/\s+/)[0] ?? "";

/** The revision stamp and the two facts under it: was it opened, when did it go / when was it signed. */
function revCell(p: ProposalRow, kit: CardKit): string {
  const st = statusPlate(p.status);
  const fresh =
    p.fresh && (p.fresh.accepted || p.fresh.declined) && kit.bloomOnce(p.id, p.fresh.accepted ? "accepted" : "declined", p.fresh.accepted ?? p.fresh.declined)
      ? " pstatus--fresh"
      : "";
  const facts: string[] = [];
  const waiting = p.status === "SENT" || p.status === "VIEWED" || p.status === "EXPIRED";
  if (p.status === "DRAFT") {
    facts.push('<span class="tbd-fact tbd-fact--quiet">Not sent yet</span>');
  } else {
    if (SIGNED.has(p.status) && p.accepted) facts.push('<span class="tbd-fact tbd-fact--ok">Signed ' + kit.esc(p.accepted) + "</span>");
    if (p.status === "DECLINED" && p.decided) facts.push('<span class="tbd-fact tbd-fact--bad">' + kit.esc(p.decided.charAt(0).toUpperCase() + p.decided.slice(1)) + "</span>");
    // Opened or not: the thing a contractor checks after sending. Amber only while it is still waiting on the client.
    if (p.views > 0) {
      facts.push(
        '<span class="tbd-fact" title="' + kit.esc(p.lastViewed ? "Last opened " + p.lastViewed : "Opened by the client") + '">' + ic("eye") +
          "<span><b>" + p.views + "</b> " + (p.views === 1 ? "view" : "views") + (p.lastViewed ? " · " + kit.esc(p.lastViewed) : "") + "</span></span>",
      );
    } else if (waiting) {
      facts.push('<span class="tbd-fact tbd-fact--warn">' + ic("eye") + "<span>Not opened yet</span></span>");
    }
    if (p.sentAgo && facts.length < 2) facts.push('<span class="tbd-fact tbd-fact--quiet">Sent ' + kit.esc(p.sentAgo) + "</span>");
  }
  return (
    '<div class="tbd-c tbd-rev">' +
    '<span class="tbd-cap">Status</span>' +
    '<span class="tbd-stamp tbd-stamp--' + p.status.toLowerCase() + fresh + '"' +
    (p.fresh?.accepted ? ' title="' + kit.esc("Accepted " + (p.accepted ?? "")) + '"' : p.fresh?.declined ? ' title="Declined"' : "") +
    ">" + kit.esc(st.label) + "</span>" +
    facts.slice(0, 2).join("") +
    "</div>"
  );
}

/** The money: the contract once signed (with how much of it has landed), the quoted total before. */
function amtCell(p: ProposalRow, kit: CardKit): string {
  const signed = SIGNED.has(p.status);
  const contract = p.contract ?? p.total;
  let under = "";
  if (signed && contract > 0) {
    const paid = p.paidAmt ?? 0;
    const full = p.owed <= 0;
    const pct = full ? 100 : Math.max(0, Math.min(100, Math.round((paid / contract) * 100)));
    under =
      '<span class="tbd-meter tbd-meter--' + paidTier(p) + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct +
      '" aria-valuetext="' + kit.esc(kit.fmtMoney(paid) + " paid of " + kit.fmtMoney(contract)) + '"><i style="width:' + pct + '%"></i></span>' +
      (full
        ? '<span class="tbd-fact tbd-fact--ok">' + ic("check") + "<span>Paid in full</span></span>"
        : '<span class="tbd-fact"><span><b>' + kit.fmtMoney(paid) + "</b> paid</span></span>");
  } else if (p.co && p.co.approvedTotal) {
    under = '<span class="tbd-fact tbd-fact--quiet">incl. ' + kit.fmtMoney(p.co.approvedTotal) + " change orders</span>";
  }
  return (
    '<div class="tbd-c tbd-amt">' +
    '<span class="tbd-cap">' + (signed ? "Contract" : "Total") + "</span>" +
    '<span class="tbd-money">' + kit.fmtMoney(contract) + "</span>" +
    under +
    "</div>"
  );
}

/** The ONE thing to do with this proposal now. */
function nextCell(p: ProposalRow, kit: CardKit): string {
  const pay = payState(p);
  const send = sendState(p);
  let body = "";
  if (pay === "collect") {
    const next = nextStage(p);
    if (p.canBill === false) {
      body = '<span class="tbd-next-line"><b>' + kit.fmtMoney(p.owed) + "</b> left to collect</span>";
    } else {
      const due = next ? kit.instDollars(p, next) : p.owed;
      body =
        '<span class="tbd-next-line' + (next?.overdue ? " is-late" : "") + '">Collect <b>' + kit.fmtMoney(due) + "</b> · " + kit.esc(next ? next.label : "balance") + "</span>" +
        kit.payActsHtml(p, next);
    }
  } else if (send === "send") {
    body =
      '<button class="tbd-go tbd-go--send" type="button" data-act="send" title="' +
      kit.esc(p.clientEmail ? "Send to " + p.clientEmail : "Send to the client — add their email as you send") + '">' +
      ic("send") + "Send to client</button>";
  } else if (send === "resend") {
    body =
      '<span class="tbd-next-line">Waiting on ' + kit.esc(firstName(p.client) || "the client") + "</span>" +
      '<button class="tbd-go tbd-go--resend" type="button" data-act="send" title="' +
      kit.esc("Send it again" + (p.clientEmail ? " to " + p.clientEmail : "")) + '">' + ic("send") + "Resend</button>";
  } else if (pay === "paid") {
    body = '<span class="tbd-next-done">' + ic("check") + "Done</span>";
  } else {
    body = '<span class="tbd-next-none">No action due</span>';
  }
  return '<div class="tbd-c tbd-next"><span class="tbd-cap">Next step</span>' + body + "</div>";
}

/** The payment schedule: one ruled line per stage, the one being chased tinted (red when it is late). */
function schedHtml(p: ProposalRow, kit: CardKit): string {
  const state = payState(p);
  const fin = kit.finHtml(p);
  if (!state && !fin) return "";
  const insts = p.inst ?? [];
  const next = state === "collect" ? nextStage(p) : null;
  const line = (it: Installment) => {
    let tone = "later";
    let tail = "";
    if (it.status === "PAID") {
      tone = "paid";
      const via = it.paidVia === "STRIPE" ? "Stripe" : it.paidVia === "SQUARE" ? "Square" : it.paidVia === "MANUAL" ? "by hand" : "";
      tail = ic("check") + "Paid" + (it.paidOn ? " " + kit.esc(it.paidOn) : "") + (via ? " · " + via : "");
    } else if (it.status === "WAIVED") {
      tone = "closed";
      tail = "Closed";
    } else if (state === "plan") {
      tone = "plan";
      tail = it.due ? "Due " + kit.esc(it.due) : "After signing";
    } else if (next && it.id === next.id) {
      tone = it.overdue ? "next is-late" : "next";
      tail = kit.esc(stageFacts(it).join(" · ") || "Next to collect");
    } else {
      tail = it.due ? "Due " + kit.esc(it.due) : "Later";
    }
    return (
      '<li class="tbd-s tbd-s--' + tone + '" data-stage="' + kit.esc(it.id) + '">' +
      '<span class="tbd-s-k">' + kit.esc(it.label) + "</span>" +
      '<span class="tbd-s-p">' + (it.pct ? Math.round(it.amount) + "%" : "") + "</span>" +
      '<span class="tbd-s-v">' + kit.fmtMoney(kit.instDollars(p, it)) + "</span>" +
      '<span class="tbd-s-st">' + tail + "</span>" +
      "</li>"
    );
  };
  let rows = insts.map(line).join("");
  if (!rows && state === "collect") {
    rows =
      '<li class="tbd-s tbd-s--next"><span class="tbd-s-k">Balance</span><span class="tbd-s-p"></span><span class="tbd-s-v">' +
      kit.fmtMoney(p.owed) + '</span><span class="tbd-s-st">Next to collect</span></li>';
  }
  const n = insts.length || 1;
  const sum =
    state === "plan"
      ? n + (n === 1 ? " payment" : " payments") + " · billed after " + kit.esc(p.clientId && p.client ? firstName(p.client) : "the client") + " accepts"
      : state === "collect"
          ? "<b>" + kit.fmtMoney(p.owed) + "</b> left of " + kit.fmtMoney(p.contract ?? p.total)
          : "";
  return (
    '<div class="tbd-sched' + (state ? " tbd-sched--" + state : "") + '">' +
    '<div class="tbd-sched-head"><span class="tbd-cap">Payment schedule</span>' +
    (sum ? '<span class="tbd-sched-sum">' + sum + "</span>" : "") +
    fin +
    "</div>" +
    (rows ? '<ol class="tbd-sl">' + rows + "</ol>" : "") +
    "</div>"
  );
}

/** The title block's strip: tools, then who and when, then Delete apart. */
function toolsHtml(p: ProposalRow, kit: CardKit): string {
  const co = p.co && p.co.count ? p.co : null;
  const s = sendState(p);
  const settled = s === "sent" || s === "none";
  const owner = p.mine ? "" : p.ownerWho ? whoHtml(p.ownerWho) : p.owner ? '<span class="tbd-meta">' + kit.esc(p.owner) + "</span>" : "";
  return (
    '<div class="tbd-tools">' +
    '<div class="tbd-tools-l">' +
    '<a class="tbd-t" href="' + kit.proposalHref(p.id) + '" title="Open the proposal">' + ic("pen") + "Open</a>" +
    // A settled proposal can still go again (owner, 2026-10-28); a waiting one has Send / Resend as its next step.
    (settled
      ? '<button class="tbd-t" type="button" data-act="send" title="' + kit.esc((s === "sent" ? "Send it again" : "Send to the client") + (p.clientEmail ? " to " + p.clientEmail : "")) + '">' +
        ic("send") + (s === "sent" ? "Resend" : "Send to client") + (s === "sent" && p.sentAgo ? '<em class="tbd-t-note">sent ' + kit.esc(p.sentAgo) + "</em>" : "") + "</button>"
      : "") +
    '<a class="tbd-t" href="/portal/q/' + encodeURIComponent(p.publicId) + '" target="_blank" rel="noopener noreferrer" title="Client view — the page the client gets, in a new tab">' + ic("eye") + "Client view</a>" +
    '<button class="tbd-t" type="button" data-act="change-order" title="Price extras, send for signature">' + ic("plus") +
    (co ? "Change orders · " + co.count : "Change order") +
    (co && co.pending ? '<em class="tbd-t-wait">' + co.pending + " awaiting</em>" : "") +
    "</button>" +
    (p.zillow ? '<a class="tbd-t" href="' + kit.esc(p.zillow) + '" target="_blank" rel="noopener noreferrer" title="Open the listing">' + ic("building") + "Zillow</a>" : "") +
    '<button class="tbd-t" type="button" data-act="copylink" title="Copy the client\'s link to paste into a text">' + ic("link") + "Copy client link</button>" +
    "</div>" +
    '<div class="tbd-tools-r">' +
    owner +
    '<span class="tbd-meta" title="Last changed">Updated ' + kit.esc(p.updated) + "</span>" +
    '<button class="tbd-t tbd-t--del" type="button" data-act="del" title="Delete this proposal — permanent">' + ic("trash") + "Delete</button>" +
    "</div>" +
    "</div>"
  );
}

export const renderCardD: CardRenderer = (p, chain, kit) => {
  const sub = kit.subLine(p);
  const project =
    p.projectId && !chain
      ? '<a class="tbd-proj" href="/dashboard/projects/' + encodeURIComponent(p.projectId) + '">' + ic("folder") + kit.esc(p.projectName ?? "Project") + "</a>"
      : "";
  const job =
    '<div class="tbd-c tbd-job">' +
    kit.kindHtml(p) +
    '<a class="tbd-title" href="' + kit.proposalHref(p.id) + '">' + kit.esc(p.title) + "</a>" +
    (sub || project ? '<div class="tbd-sub">' + (sub ? "<span>" + kit.esc(sub) + "</span>" : "") + project + "</div>" : "") +
    kit.clientDesignHtml(p) +
    "</div>";
  return (
    '<tr class="prow tbd-row' + chain + '" data-id="' + kit.esc(p.id) + '"' +
    (chain && p.projectId ? ' data-grp="' + kit.esc(p.projectId) + '"' : "") +
    '><td colspan="6" class="tbd-td"><article class="tbd" data-st="' + kit.esc(p.status.toLowerCase()) + '">' +
    '<div class="tbd-band">' + job + revCell(p, kit) + amtCell(p, kit) + nextCell(p, kit) + "</div>" +
    schedHtml(p, kit) +
    toolsHtml(p, kit) +
    "</article></td></tr>"
  );
};
