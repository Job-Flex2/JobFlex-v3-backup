#!/usr/bin/env node
// THE PRETEND WISETACK (2026-10-28) — a stand-in for Wisetack's partner API, answering to exactly the shape
// src/lib/financing/wisetack.ts assumes, so the whole financing loop can be walked on a local stand before JobFlex has
// Wisetack's docs and sandbox keys. In memory, no dependencies. Never used in production.
//
//   node qa/tools/fake-wisetack.mjs --port 3620 --hook http://localhost:3540/api/webhooks/wisetack --secret stand-wisetack
//
// The stand points WISETACK_API_BASE at http://127.0.0.1:<port>, WISETACK_API_KEY at anything, WISETACK_WEBHOOK_SECRET
// at the same --secret. Pages a person (or a walk) presses:
//   /apply/merchant/<ref>  Approve · Needs info · Under review · Decline
//   /apply/loan/<id>       Approve · Approve less · Accept terms · Decline · Fund all · Fund half · Expire
//   /prequal/<merchantRef> pre-qualify a person (→ prequal.completed)
// Each press sends a signed webhook to --hook, then returns to the page. GET /_state shows everything (JSON).
// --known <email> (repeatable) = emails "I already use Wisetack" can link (default linked@wisetack.example).

import { createServer } from "node:http";
import { createHmac } from "node:crypto";

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const PORT = Number(arg("port", "3620"));
const HOOK = arg("hook", "http://localhost:3540/api/webhooks/wisetack");
const SECRET = arg("secret", "stand-wisetack");
const KNOWN = args.flatMap((a, i) => (a === "--known" && args[i + 1] ? [args[i + 1].toLowerCase()] : []));
if (!KNOWN.length) KNOWN.push("linked@wisetack.example");
const SELF = `http://localhost:${PORT}`;

const merchants = new Map();
const loans = new Map();
let seq = 0;
const next = (p) => `${p}_${Date.now().toString(36)}${(++seq).toString(36)}`;
const now = () => new Date().toISOString();
const dollars = (c) => `$${Math.round(c / 100).toLocaleString("en-US")}`;

const merchantView = (m) => ({
  merchantRef: m.ref,
  status: m.status,
  requirements: m.requirements,
  note: m.note,
  minAmount: m.status === "APPROVED" ? 50_000 : null,
  maxAmount: m.status === "APPROVED" ? 6_500_000 : null,
  feeBps: m.status === "APPROVED" ? 390 : null,
  prequalUrl: m.status === "APPROVED" ? `${SELF}/prequal/${m.ref}` : null,
});
const loanView = (l) => ({ transactionId: l.id, status: l.status, approvedAmount: l.approvedAmount, fundings: l.fundings, expiresAt: l.expiresAt });

async function send(type, data) {
  const raw = JSON.stringify({ id: next("ev"), type, data });
  const sig = `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`;
  try {
    const r = await fetch(HOOK, { method: "POST", headers: { "content-type": "application/json", "x-wisetack-signature": sig }, body: raw });
    console.log(`[fake-wisetack] → ${type} ${r.status}`);
    return r.status;
  } catch (e) {
    console.log(`[fake-wisetack] → ${type} failed: ${e.message}`);
    return 0;
  }
}

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const html = (res, body) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wisetack (pretend)</title>
<style>body{font:16px system-ui;margin:24px;max-width:560px}button{font:inherit;padding:10px 14px;margin:4px 6px 4px 0;border-radius:8px;border:1px solid #888;background:#fff;cursor:pointer}
.k{color:#666}.st{font-weight:600}form{display:inline}input{font:inherit;padding:8px;margin:4px 0;width:100%}</style>
<p class="k">Pretend Wisetack — the JobFlex stand</p>${body}`);
};
const readBody = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });
const back = (url) => (url ? `<p><a href="${url}" data-back>Back to JobFlex</a></p>` : "");
const btn = (path, label, extra = "") => `<form method="post" action="${path}"><button ${extra}>${label}</button></form>`;

function merchantPage(res, m) {
  html(
    res,
    `<h1>Merchant application</h1><p>${m.businessName || m.email || m.ref}</p><p>Status: <span class="st" data-status>${m.status}</span></p>
${btn(`/act/merchant/${m.ref}/approve`, "Approve", "data-act=approve")}${btn(`/act/merchant/${m.ref}/needs`, "Needs info", "data-act=needs")}${btn(`/act/merchant/${m.ref}/review`, "Under review", "data-act=review")}${btn(`/act/merchant/${m.ref}/decline`, "Decline", "data-act=decline")}
${back(m.returnUrl)}`,
  );
}
function loanPage(res, l) {
  html(
    res,
    `<h1>Pay over time</h1><p>${l.purpose || "Your project"} · ${dollars(l.amount)} · ${l.customer?.name ?? ""}</p>
<p>Status: <span class="st" data-status>${l.status}</span>${l.approvedAmount ? ` · approved ${dollars(l.approvedAmount)}` : ""}${l.fundings.length ? ` · funded ${dollars(l.fundings.reduce((n, f) => n + f.amount, 0))}` : ""}${l.completionRequested ? " · completion requested" : ""}</p>
${btn(`/act/loan/${l.id}/approve`, "Approve", "data-act=approve")}${btn(`/act/loan/${l.id}/approve-less`, "Approve less", "data-act=approve-less")}${btn(`/act/loan/${l.id}/accept`, "Accept terms", "data-act=accept")}${btn(`/act/loan/${l.id}/decline`, "Decline", "data-act=decline")}
${btn(`/act/loan/${l.id}/fund-all`, "Fund all", "data-act=fund-all")}${btn(`/act/loan/${l.id}/fund-half`, "Fund half", "data-act=fund-half")}${btn(`/act/loan/${l.id}/expire`, "Expire", "data-act=expire")}
${back(l.returnUrl)}`,
  );
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, SELF);
  const path = url.pathname;
  const parts = path.split("/").filter(Boolean);
  try {
    if (path === "/_state") return json(res, 200, { merchants: [...merchants.values()], loans: [...loans.values()] });

    if (parts[0] === "v1") {
      if (!/^Bearer \S+/.test(req.headers.authorization ?? "")) return json(res, 401, { error: "unauthorized" });
      const body = req.method === "POST" ? JSON.parse((await readBody(req)) || "{}") : {};
      // merchants
      if (req.method === "POST" && path === "/v1/merchants") {
        const m = { ref: next("m"), status: "APPLICATION_STARTED", requirements: [], note: null, email: body.email ?? null, businessName: body.businessName ?? "", returnUrl: body.returnUrl ?? null, reference: body.reference ?? null, prefill: body };
        merchants.set(m.ref, m);
        return json(res, 200, { merchantRef: m.ref, applicationUrl: `${SELF}/apply/merchant/${m.ref}` });
      }
      if (req.method === "POST" && path === "/v1/merchants/link") {
        const email = String(body.email ?? "").toLowerCase();
        if (!KNOWN.includes(email)) return json(res, 404, { error: "not_found" });
        const m = { ref: next("m"), status: "APPROVED", requirements: [], note: null, email, businessName: "", returnUrl: body.returnUrl ?? null, reference: body.reference ?? null };
        merchants.set(m.ref, m);
        return json(res, 200, { merchantRef: m.ref, url: null });
      }
      if (parts[1] === "merchants" && parts[2]) {
        const m = merchants.get(parts[2]);
        if (!m) return json(res, 404, { error: "not_found" });
        if (parts[3] === "monthly") return json(res, 204);
        return json(res, 200, merchantView(m));
      }
      // transactions
      if (req.method === "POST" && path === "/v1/transactions") {
        if (!merchants.get(body.merchantRef)) return json(res, 404, { error: "no merchant" });
        const l = {
          id: next("t"),
          merchantRef: body.merchantRef,
          status: "INITIATED",
          amount: Number(body.amount) || 0,
          approvedAmount: null,
          fundings: [],
          expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
          purpose: body.purpose ?? "",
          reference: body.reference ?? null,
          customer: body.customer ?? null,
          returnUrl: body.returnUrl ?? null,
          completionRequested: false,
        };
        loans.set(l.id, l);
        return json(res, 200, { transactionId: l.id, paymentLink: `${SELF}/apply/loan/${l.id}`, expiresAt: l.expiresAt });
      }
      if (parts[1] === "transactions" && parts[2]) {
        const l = loans.get(parts[2]);
        if (!l) return json(res, 404, { error: "not_found" });
        if (req.method === "POST" && parts[3] === "completion-request") {
          if (l.status !== "LOAN_TERMS_ACCEPTED") return json(res, 409, { error: "not accepted" });
          l.status = "COMPLETION_REQUESTED";
          l.completionRequested = true;
          await send("transaction.updated", loanView(l));
          return json(res, 202, {});
        }
        if (req.method === "POST" && parts[3] === "cancel") {
          l.status = "CANCELED";
          return json(res, 200, {});
        }
        return json(res, 200, loanView(l));
      }
      return json(res, 404, { error: "no such endpoint" });
    }

    // pages
    if (req.method === "GET" && parts[0] === "apply" && parts[1] === "merchant") {
      const m = merchants.get(parts[2]);
      return m ? merchantPage(res, m) : html(res, "<p>No such application.</p>");
    }
    if (req.method === "GET" && parts[0] === "apply" && parts[1] === "loan") {
      const l = loans.get(parts[2]);
      if (l && l.status === "INITIATED") l.status = "STARTED";
      return l ? loanPage(res, l) : html(res, "<p>No such application.</p>");
    }
    if (req.method === "GET" && parts[0] === "prequal") {
      const m = merchants.get(parts[1]);
      if (!m) return html(res, "<p>No such business.</p>");
      return html(
        res,
        `<h1>See what you qualify for</h1><form method="post" action="/act/prequal/${m.ref}" style="display:block">
<input name="name" placeholder="Name" value="Dana Reyes"><input name="phone" placeholder="Phone" value="+15550001111"><input name="email" placeholder="Email" value="dana@example.com"><input name="amount" placeholder="Amount in dollars" value="20000">
<button data-act="prequal">Pre-qualify</button></form>`,
      );
    }

    // presses
    if (req.method === "POST" && parts[0] === "act") {
      const raw = await readBody(req);
      if (parts[1] === "merchant") {
        const m = merchants.get(parts[2]);
        if (!m) return html(res, "<p>No such application.</p>");
        const to = { approve: "APPROVED", needs: "ACTION_REQUIRED", review: "UNDER_REVIEW", decline: "DECLINED" }[parts[3]];
        if (to) {
          m.status = to;
          m.requirements = to === "ACTION_REQUIRED" ? ["Upload a voided check for the business bank account"] : [];
          await send("merchant.updated", merchantView(m));
        }
        res.writeHead(303, { location: `/apply/merchant/${m.ref}` });
        return res.end();
      }
      if (parts[1] === "loan") {
        const l = loans.get(parts[2]);
        if (!l) return html(res, "<p>No such application.</p>");
        const act = parts[3];
        const funded = l.fundings.reduce((n, f) => n + f.amount, 0);
        if (act === "approve") (l.status = "AUTHORIZED"), (l.approvedAmount = l.amount);
        if (act === "approve-less") (l.status = "AUTHORIZED"), (l.approvedAmount = Math.round((l.amount * 0.7) / 100) * 100);
        if (act === "accept" && l.approvedAmount) l.status = "LOAN_TERMS_ACCEPTED";
        if (act === "decline") l.status = "DECLINED";
        if (act === "expire") l.status = "EXPIRED";
        if ((act === "fund-all" || act === "fund-half") && l.approvedAmount) {
          const left = l.approvedAmount - funded;
          const amount = act === "fund-all" ? left : Math.round(l.approvedAmount / 2);
          if (amount > 0) l.fundings.push({ id: next("f"), amount: Math.min(amount, left), at: now() });
          l.status = "SETTLED";
        }
        await send("transaction.updated", loanView(l));
        res.writeHead(303, { location: `/apply/loan/${l.id}` });
        return res.end();
      }
      if (parts[1] === "prequal") {
        const f = new URLSearchParams(raw);
        await send("prequal.completed", {
          merchantRef: parts[2],
          customer: { name: f.get("name") || "Someone", phone: f.get("phone") || null, email: f.get("email") || null },
          amount: Math.round(Number(f.get("amount") || 0) * 100),
        });
        return html(res, `<p data-status>Pre-qualified.</p>`);
      }
    }
    return json(res, 404, { error: "not found" });
  } catch (e) {
    console.log(`[fake-wisetack] error: ${e.message}`);
    return json(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`[fake-wisetack] on ${SELF}, webhooks → ${HOOK}`));
