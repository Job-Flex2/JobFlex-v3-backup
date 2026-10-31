// All-list card, variant B — "Next step first" (2026-10-30, owner review).
//
// The card is organised around what the contractor must do next:
//   1. who and what — the kind, the title, the client, the total (quiet, one line each);
//   2. THE NEXT STEP — the loudest zone, tinted by state: Send a draft, wait on the client, collect the next
//      stage (overdue in red, the three billing buttons right there), paid in full, declined;
//      a rail under it — Draft → Sent → Viewed → Signed → Paid — whose last leg fills with the money paid;
//   3. the payment stages, small, when there is a schedule;
//   4. a quiet row of everything else that can be done to it, Delete apart at the far end.
// One <tr class="prow"> per proposal plus the classic gap row, so the page's patch/leave helpers (which remove a
// proposal's `prow-(pay|bar|gap)` tail rows) keep working unchanged.

import type { CardRenderer, CardKit } from "./card-kit";
import { nextStage, payState, sendState, stageFacts, type Installment, type ProposalRow } from "../proposals-data";
import { whoHtml } from "@/lib/team/who";

type Tone = "draft" | "wait" | "cold" | "collect" | "late" | "paid" | "off";

const ic = (id: string) => '<svg class="ic" aria-hidden="true"><use href="#i-' + id + '"/></svg>';
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const firstName = (p: ProposalRow) => (p.client ?? "").trim().split(/\s+/)[0] ?? "";
const SIGNED = new Set(["ACCEPTED", "COMPLETED", "PAID"]);

/** What a stage is called in a sentence: "Cabinets set" — never shouted. */
function stageName(it: Installment) {
  return it.label.trim();
}

/** The rail: where the proposal stands, as five steps; the last leg fills with the share paid. */
function railHtml(p: ProposalRow, kit: CardKit, tone: Tone, paidPct: number, fresh: string): string {
  const signed = SIGNED.has(p.status);
  const sent = !!p.sentAgo || p.status !== "DRAFT";
  const viewed = p.views > 0;
  const declined = p.status === "DECLINED";
  // 0 Draft · 1 Sent · 2 Viewed · 3 Signed (or Declined) · 4 Paid
  let now = 0;
  if (p.status === "DRAFT") now = 0;
  else if (p.status === "SENT" || p.status === "EXPIRED") now = viewed ? 2 : 1;
  else if (p.status === "VIEWED") now = 2;
  else if (declined) now = 3;
  else if (signed) now = paidPct >= 100 ? 4 : 3;
  else if (p.status === "ARCHIVED") now = -1;

  type Step = { k: string; when?: string | null; state: "done" | "now" | "todo" | "skip"; cls?: string };
  const steps: Step[] = [
    { k: "Draft", state: now > 0 ? "done" : now === 0 ? "now" : "todo" },
    { k: p.status === "EXPIRED" ? "Expired" : "Sent", when: p.sentAgo, state: now > 1 ? (sent ? "done" : "skip") : now === 1 ? "now" : "todo" },
    { k: "Viewed", when: viewed ? p.lastViewed : null, state: now > 2 ? (viewed ? "done" : "skip") : now === 2 ? "now" : "todo" },
    declined
      ? { k: "Declined", when: null, state: "now", cls: "is-no" }
      : { k: "Signed", when: p.accepted ?? null, state: now > 3 ? "done" : now === 3 ? "now" : "todo" },
    { k: "Paid", when: now === 4 ? p.paid ?? null : null, state: now === 4 ? "now" : declined ? "skip" : "todo" },
  ];
  // How much of the leg AFTER each step is drawn: whole once the next step is reached; the Signed → Paid leg by money.
  const legFill = (i: number) => {
    if (i === 3) return declined ? 0 : signed ? paidPct : 0;
    return now > i ? 100 : 0;
  };
  return (
    '<ol class="pb-rail" aria-label="Where it stands">' +
    steps
      .map((s, i) => {
        const isNow = s.state === "now";
        return (
          '<li class="pb-step is-' + s.state + (s.cls ? " " + s.cls : "") + '"' + (isNow ? ' aria-current="step"' : "") +
          (i < steps.length - 1 ? ' style="--leg:' + legFill(i) + '%"' : "") + ">" +
          '<i class="pb-node' + (isNow ? fresh : "") + '" aria-hidden="true"></i>' +
          (i < steps.length - 1 ? '<span class="pb-leg" aria-hidden="true"></span>' : "") +
          '<span class="pb-step-k">' + kit.esc(s.k) + (s.when && s.state !== "todo" ? " <em>" + kit.esc(s.when) + "</em>" : "") + "</span>" +
          "</li>"
        );
      })
      .join("") +
    "</ol>"
  );
}

/** The schedule, small: each stage its label, amount and where it stands. */
function stagesHtml(p: ProposalRow, kit: CardKit, state: ReturnType<typeof payState>, next: Installment | null): string {
  const insts = p.inst ?? [];
  if (!insts.length) return "";
  return (
    '<ol class="pb-stages">' +
    insts
      .map((it) => {
        const share = it.pct ? Math.round(it.amount) + "%" : "";
        let tone = "later";
        let tail = "";
        if (it.status === "PAID") {
          tone = "paid";
          tail = it.paidOn ? "Paid " + it.paidOn : "Paid";
        } else if (it.status === "WAIVED") {
          tone = "closed";
          tail = "Closed";
        } else if (state === "plan") {
          tail = it.due ? "Due " + it.due : "After signing";
        } else if (next && it.id === next.id) {
          tone = it.overdue ? "late" : "next";
          tail = it.status === "PENDING" ? "Payment in progress" : it.overdue && it.due ? "Overdue since " + it.due : it.due ? "Due " + it.due : "Next";
        } else {
          tail = it.due ? "Due " + it.due : "Later";
        }
        return (
          '<li class="pb-st pb-st--' + tone + '" data-stage="' + kit.esc(it.id) + '">' +
          '<span class="pb-st-k">' + kit.esc(it.label) + (share ? " <em>" + share + "</em>" : "") + "</span>" +
          '<b class="pb-st-v">' + kit.fmtMoney(kit.instDollars(p, it)) + "</b>" +
          '<span class="pb-st-s">' + (it.status === "PAID" ? ic("check") : "") + kit.esc(tail) + "</span>" +
          "</li>"
        );
      })
      .join("") +
    "</ol>"
  );
}

export const renderCardB: CardRenderer = (p, chain, kit) => {
  const esc = kit.esc;
  const money = kit.fmtMoney;
  const pay = payState(p);
  const send = sendState(p);
  const next = pay === "collect" ? nextStage(p) : null;
  const contract = p.contract ?? p.total;
  const paid = p.paidAmt ?? 0;
  const paidPct = contract > 0 && p.owed <= 0 ? 100 : contract > 0 ? Math.max(0, Math.min(100, Math.round((paid / contract) * 100))) : 0;
  const who = firstName(p);

  // The bloom on a fresh acceptance or decline lands on the rail's current step.
  const fresh =
    p.fresh && (p.fresh.accepted || p.fresh.declined) && kit.bloomOnce(p.id, p.fresh.accepted ? "accepted" : "declined", p.fresh.accepted ?? p.fresh.declined)
      ? " pstatus--fresh" + (p.fresh.declined && !p.fresh.accepted ? " pstatus--declined" : "")
      : "";

  /* ── The next step ── */
  let tone: Tone = "draft";
  let head = "";
  let fact = "";
  let acts = "";
  let sendInZone = false;
  // Once sent it can always go again (owner, 2026-10-28). When it went is on the rail ("Sent 3d ago"), so the
  // card carries the button alone — same data-act and dialog as the classic stamp's Resend.
  const resendBtn = (cls: string) =>
    '<button class="' + cls + '" type="button" data-act="send" title="' + esc("Send it again" + (p.clientEmail ? " to " + p.clientEmail : "")) + '">' + ic("send") + "Resend</button>";
  const viewsLine =
    p.views > 0
      ? "Opened " + (p.views === 1 ? "once" : p.views + " times") + (p.lastViewed ? " · last " + esc(p.lastViewed) : "")
      : "";

  if (p.status === "DRAFT") {
    tone = "draft";
    head = "Ready to send";
    fact = p.clientEmail ? "Goes to " + esc(p.clientEmail) : "Add " + (who ? esc(who) + "’s" : "the client’s") + " email as you send";
    acts =
      '<button class="pb-hero" type="button" data-act="send" title="' +
      esc(p.clientEmail ? "Send to " + p.clientEmail : "Send to the client — add their email as you send") +
      '">' + ic("send") + "<span>" + (who ? "Send to " + esc(who) : "Send") + "</span></button>";
    sendInZone = true;
  } else if (p.status === "SENT" || p.status === "VIEWED" || p.status === "EXPIRED") {
    const opened = p.views > 0;
    tone = p.status === "EXPIRED" ? "cold" : opened ? "wait" : "cold";
    head = p.status === "EXPIRED" ? "Expired" : "Waiting on " + (who ? esc(who) : "the client");
    fact =
      p.status === "EXPIRED"
        ? "Send it again to reopen it"
        : opened
          ? viewsLine
          : "Not opened yet" + (p.sentAgo ? " · sent " + esc(p.sentAgo) : "");
    acts = send === "send" ? kit.sendCellHtml(p) : resendBtn("pb-act");
    sendInZone = true;
  } else if (pay === "collect") {
    const late = !!next?.overdue;
    tone = late ? "late" : "collect";
    const amt = next ? kit.instDollars(p, next) : p.owed;
    head = "Collect <b>" + money(amt) + "</b>" + '<span class="pb-next-of">for ' + (next ? esc(stageName(next)) : "the balance") + "</span>";
    const facts = next ? stageFacts(next) : [];
    fact = facts.length ? esc(cap(facts.join(" · "))) : next ? "Next to collect" : "No payment schedule";
    acts =
      p.canBill === false
        ? '<span class="pb-left"><b>' + money(p.owed) + "</b> left to collect</span>"
        : kit.payActsHtml(p, next);
  } else if (pay === "paid") {
    tone = "paid";
    head = ic("check") + "Paid in full";
    const n = (p.inst ?? []).length;
    fact = money(paid || contract) + " collected" + (n > 1 ? " · " + n + " payments" : "");
  } else if (p.status === "DECLINED") {
    tone = "off";
    head = (who ? esc(who) : "The client") + " declined";
    fact = p.decided ? esc(cap(p.decided)) : viewsLine || "No longer open";
    if (send !== "none") {
      acts = send === "send" ? kit.sendCellHtml(p) : resendBtn("pb-act");
      sendInZone = true;
    }
  } else {
    tone = "off";
    head = p.status === "ARCHIVED" ? "Archived" : esc(p.status.charAt(0) + p.status.slice(1).toLowerCase());
    fact = viewsLine;
  }

  const nextHtml =
    '<section class="pb-next pb-next--' + tone + '">' +
    '<div class="pb-next-main">' +
    '<p class="pb-next-h">' + head + "</p>" +
    (fact ? '<p class="pb-next-f">' + fact + "</p>" : "") +
    kit.clientDesignHtml(p) +
    "</div>" +
    (acts ? '<div class="pb-next-acts">' + acts + "</div>" : "") +
    railHtml(p, kit, tone, paidPct, fresh) +
    "</section>";

  /* ── The payments, small ── */
  let payHtml = "";
  const stages = stagesHtml(p, kit, pay, next);
  const fin = kit.finHtml(p);
  if (pay && (stages || fin)) {
    const n = (p.inst ?? []).length;
    let sum = "";
    if (pay === "plan") {
      sum = money(contract) + " in " + n + (n === 1 ? " payment" : " payments") + " · billed after " + (who ? esc(who) : "the client") + " accepts";
    } else if (pay === "paid") {
      sum = ""; // the next step already says "Paid in full" and how much
    } else {
      sum = "<b>" + money(paid) + "</b> paid · <b class=\"pb-due\">" + money(p.owed) + "</b> due · " + money(contract) + " contract";
    }
    payHtml =
      '<section class="pb-pay">' +
      '<div class="pb-pay-h"><span class="pb-lbl">' + (pay === "plan" ? "Payment plan" : "Payments") + '</span><span class="pb-pay-sum">' + sum + "</span></div>" +
      stages +
      fin +
      "</section>";
  }

  /* ── Who and what ── */
  const coWait = p.co && p.co.pending ? '<span class="pb-co-wait">' + p.co.pending + " change order" + (p.co.pending === 1 ? "" : "s") + " awaiting approval</span>" : "";
  const sub =
    esc(kit.subLine(p)) +
    (p.projectId && !chain
      ? ' · <a class="pb-proj" href="/dashboard/projects/' + encodeURIComponent(p.projectId) + '">' + esc(p.projectName ?? "Project") + "</a>"
      : "");
  const owner = p.mine ? "" : p.ownerWho ? whoHtml(p.ownerWho) : '<span class="pb-owner-plain">' + esc(p.owner) + "</span>";
  const idHtml =
    '<header class="pb-id">' +
    '<div class="pb-id-main">' +
    '<div class="pb-id-top">' + kit.kindHtml(p) + (owner ? '<span class="pb-owner">' + owner + "</span>" : "") + "</div>" +
    '<a class="pb-title" href="' + kit.proposalHref(p.id) + '">' + esc(p.title) + "</a>" +
    '<div class="pb-sub">' + sub + (coWait ? " · " + coWait : "") + "</div>" +
    "</div>" +
    '<div class="pb-total">' +
    '<span class="pb-money">' + money(contract) + "</span>" +
    "</div>" +
    "</header>";

  /* ── Everything else, quiet ── */
  const sendQuiet = sendInZone
    ? "" // the next step already carries it
    : send === "none"
      ? '<button class="pb-btn" type="button" data-act="send" title="' + esc(p.clientEmail ? "Send to " + p.clientEmail : "Send to the client") + '">' + ic("send") + "Send to client</button>"
      : send === "send"
        ? kit.sendCellHtml(p)
        : resendBtn("pb-btn");
  const footHtml =
    '<footer class="pb-foot">' +
    '<div class="pb-foot-l">' +
    '<a class="pb-btn pb-btn--open" href="' + kit.proposalHref(p.id) + '" title="Open the proposal">' + ic("pen") + "Open</a>" +
    '<a class="pb-btn" href="/portal/q/' + encodeURIComponent(p.publicId) + '" target="_blank" rel="noopener noreferrer" title="Client view — the page the client gets, in a new tab">' + ic("eye") + "Client view</a>" +
    '<button class="pb-btn" type="button" data-act="change-order" title="Price extras, send for signature">' + ic("plus") + (p.co && p.co.count ? "Change orders · " + p.co.count : "Change order") + "</button>" +
    (p.zillow ? '<a class="pb-btn" href="' + esc(p.zillow) + '" target="_blank" rel="noopener noreferrer" title="Open the listing">' + ic("building") + "Zillow</a>" : "") +
    '<button class="pb-btn" type="button" data-act="copylink" title="Copy the client\'s link to paste into a text">' + ic("link") + "Copy link</button>" +
    sendQuiet +
    "</div>" +
    '<span class="pb-upd" title="Last changed">Updated ' + esc(p.updated) + "</span>" +
    '<button class="pb-btn pb-btn--del" type="button" data-act="del" title="Delete this proposal — permanent">' + ic("trash") + "Delete</button>" +
    "</footer>";

  const grp = chain && p.projectId ? ' data-grp="' + esc(p.projectId) + '"' : "";
  return (
    '<tr class="prow pb-row' + chain + '" data-id="' + esc(p.id) + '"' + grp + ">" +
    '<td colspan="6"><article class="pb pb--' + tone + '">' + idHtml + nextHtml + payHtml + footHtml + "</article></td>" +
    "</tr>" +
    '<tr class="prow-gap pb-gap' + (chain && !chain.includes("chain-end") ? " pb-gap--chain" : "") + '" data-id="' + esc(p.id) + '"' + grp + ' aria-hidden="true"><td colspan="6"></td></tr>'
  );
};
