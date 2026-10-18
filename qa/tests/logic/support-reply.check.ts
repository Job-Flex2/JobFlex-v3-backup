// The conversation under a support ticket (2026-10-14, one dialog per ticket since 2026-10-17): what a message must
// be, where a message moves the ticket, the letter to the other side (lib/supportReply) — and replies by email
// (lib/supportInbound): the ticket's signed address, the webhook signature, the sender, the quote cut. Pure, no database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/support-reply.check.ts
import { createHmac } from "node:crypto";
import {
  checkReply,
  conversationLetter,
  openingMessage,
  paragraphsOf,
  personLeads,
  replySubject,
  statusAfterCustomerMessage,
  statusAfterReply,
  REPLY_ABOVE,
  REPLY_LIMITS,
  type LetterMessage,
} from "../../../src/lib/supportReply";
import { emailAddressOf, htmlToText, isAutoReply, replyAddress, ticketFromAddress, trimQuoted, verifyWebhook } from "../../../src/lib/supportInbound";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

// ── A message ────────────────────────────────────────────────────────────────
check("an empty message does not go", !checkReply("").ok && !checkReply("   ").ok && !checkReply(undefined).ok);
check("one letter is not a message", !checkReply("k").ok);
const long = checkReply("x".repeat(REPLY_LIMITS.body + 1));
check("over the limit is refused, and says so", !long.ok && /4,000/.test(long.ok ? "" : long.error));
const okr = checkReply("  Thanks for writing.\r\n\r\nFixed it.  ");
check("a message is tidied: trimmed, Windows line ends straightened", okr.ok && okr.body === "Thanks for writing.\n\nFixed it.");
check("the subject carries the ticket's subject and ref", replySubject({ subject: "  Bad   sizing ", ref: "J7RCFS" }) === "Re: Bad sizing [JobFlex J7RCFS]");
check("a blank subject still reads", replySubject({ subject: "", ref: "A1B2C3" }) === "Re: Your message [JobFlex A1B2C3]");
check("our answer moves Open to In progress, nothing else", statusAfterReply("OPEN") === "IN_PROGRESS" && statusAfterReply("IN_PROGRESS") === "IN_PROGRESS" && statusAfterReply("RESOLVED") === "RESOLVED" && statusAfterReply("CLOSED") === "CLOSED");
check("the customer's message opens a resolved or closed ticket again, leaves the rest", statusAfterCustomerMessage("RESOLVED") === "OPEN" && statusAfterCustomerMessage("CLOSED") === "OPEN" && statusAfterCustomerMessage("IN_PROGRESS") === "IN_PROGRESS" && statusAfterCustomerMessage("OPEN") === "OPEN");
check("a person on the team leads once they wrote; the AI and the customer don't count", personLeads([{ from: "customer" }, { from: "team" }]) && !personLeads([{ from: "customer" }, { from: "ai" }]));
const opening = openingMessage({ id: "t1", body: "Help", createdAt: "2026-10-14T04:46:00.000Z", by: "Dana" });
check("the ticket's words are the conversation's first message, the customer's", opening.from === "customer" && opening.id === "ticket:t1" && opening.body === "Help" && opening.channel === "app");
check("paragraphs split on blank lines, single breaks stay", JSON.stringify(paragraphsOf("One\nstill one\n\n\nTwo")) === JSON.stringify(["One\nstill one", "Two"]));

// ── The letter to the customer ───────────────────────────────────────────────
const history: LetterMessage[] = [
  { from: "customer", by: "Daniel", body: "Bad sizing <the roof looks 2x>", at: "2026-10-14T04:46:00.000Z" },
  { from: "ai", by: "JobFlex support", body: "We're on it.", at: "2026-10-14T04:47:00.000Z" },
  { from: "customer", by: "Daniel", body: "Any news?", at: "2026-10-15T09:00:00.000Z" },
  { from: "team", by: "Dmitriy", body: "Looking now.", at: "2026-10-15T09:10:00.000Z" },
];
const letter = conversationLetter({
  to: "customer",
  message: { from: "team", by: "Dmitriy", body: "Hi Daniel,\n\nThe sizing uses the pitch you entered — 7/12 gives 5,856 sq ft here. Re-measure & it updates.\n\nLet me know.", at: "2026-10-15T10:00:00.000Z" },
  ticket: { subject: "Bad sizing", ref: "J7RCFS" },
  history,
  link: "https://jobflex.app/dashboard/support?ticket=t1",
});
check("the customer's letter: the reply subject", letter.subject === "Re: Bad sizing [JobFlex J7RCFS]");
check("the paragraphs are in the html, escaped, with the single break kept", letter.html.includes("Re-measure &amp; it updates.") && (letter.html.match(/<p style="margin:0 0 16px/g) ?? []).length === 3);
check("signed by the admin over JobFlex support", /Dmitriy<br><span[^>]*>JobFlex support · jobflex.app/.test(letter.html));
check("an 'Open conversation' button on the ticket", /<a href="https:\/\/jobflex.app\/dashboard\/support\?ticket=t1"[^>]*>Open conversation<\/a>/.test(letter.html) && letter.text.includes("Open conversation: https://jobflex.app/dashboard/support?ticket=t1"));
check("a short history: the last three, labelled You / JobFlex support, escaped", letter.html.includes("Earlier in this conversation (last 3 of 4)") && !letter.html.includes("Bad sizing &lt;the roof") && letter.html.includes("<b style=\"color:#4a4a4a;\">You</b>") && letter.html.includes("Dmitriy · JobFlex support"));
check("stage 1: 'reply to this email reaches us', no cut line", letter.html.includes("Reply to this email and it reaches us.") && !letter.html.includes(REPLY_ABOVE));
check("the text twin has the paragraphs, the signature, the button and the history", letter.text.includes("Let me know.") && letter.text.includes("Dmitriy\nJobFlex support · jobflex.app") && letter.text.includes("> Any news?"));
check("no image, no tracking", !/<img|pixel|track/i.test(letter.html));
const aiLetter = conversationLetter({ to: "customer", message: { from: "ai", by: "JobFlex support", body: "Thanks.", at: "t" }, ticket: { subject: "S", ref: "X1" }, history: [], link: null });
check("the AI signs as the team; no history, no button when the page can't be opened — just the ticket number", /JobFlex support<br><span[^>]*>jobflex.app/.test(aiLetter.html) && !aiLetter.html.includes("Open conversation") && aiLetter.text.includes("Your ticket is X1.") && !aiLetter.html.includes("Earlier"));
const longOne = conversationLetter({ to: "customer", message: { from: "team", by: "", body: "OK.", at: "t" }, ticket: { subject: "S", ref: "X1" }, history: [{ from: "customer", by: "D", body: "y".repeat(3000), at: "bad" }], link: null });
check("a long earlier message is clipped; a blank sender signs as the team; a bad date still reads", longOne.html.includes("…") && !longOne.html.includes("y".repeat(401)) && /JobFlex support<br>/.test(longOne.html));

// ── The letter to the team ───────────────────────────────────────────────────
const team = conversationLetter({
  to: "team",
  message: { from: "customer", by: "Daniel", body: "Still wrong.", at: "2026-10-16T10:00:00.000Z" },
  ticket: { subject: "Bad sizing", ref: "J7RCFS", orgName: "Acme Roofing", customerEmail: "d@acme.test" },
  history: history.slice(0, 2),
  link: "https://jobflex.app/admin/support?ticket=t1",
  replyByEmail: true,
});
check("the team's letter names the company in its subject and who wrote", team.subject === "Re: Bad sizing [JobFlex J7RCFS] — Acme Roofing replied" && team.html.includes("Acme Roofing (d@acme.test) wrote in J7RCFS:"));
check("…with the button to the ticket in admin, the customer's own name in the history, no signature", team.html.includes("https://jobflex.app/admin/support?ticket=t1") && team.html.includes(">Daniel</b>") && !team.html.includes("JobFlex support · jobflex.app"));
check("stage 2: the cut line at the top and 'reply goes to the customer'", team.html.indexOf(REPLY_ABOVE) > 0 && team.html.indexOf(REPLY_ABOVE) < team.html.indexOf("Still wrong.") && team.text.startsWith(REPLY_ABOVE) && team.html.includes("Reply to this email and it goes to the customer"));

// ── Stage 2: the ticket's own address ────────────────────────────────────────
const cfg = { domain: "reply.jobflex.app", secret: "s3cret" };
const addr = replyAddress("cmgx1abcd0001xyz", cfg);
check("the address is t-<ticket>-<signature>@reply.jobflex.app", /^t-cmgx1abcd0001xyz-[a-f0-9]{20}@reply\.jobflex\.app$/.test(addr), addr);
check("…and reads back to its ticket, with a display name and any case", ticketFromAddress(addr, cfg) === "cmgx1abcd0001xyz" && ticketFromAddress(`"JobFlex" <${addr.toUpperCase()}>`, cfg) === "cmgx1abcd0001xyz");
check("a forged signature, another ticket's id, another domain or secret: no ticket", ticketFromAddress(addr.replace(/-[a-f0-9]{20}@/, "-0123456789abcdef0123@"), cfg) === null && ticketFromAddress(addr.replace("cmgx1abcd0001xyz", "cmgx1abcd0002xyz"), cfg) === null && ticketFromAddress(addr.replace("reply.jobflex.app", "evil.test"), cfg) === null && ticketFromAddress(addr, { ...cfg, secret: "other" }) === null && ticketFromAddress("support@jobflex.app", cfg) === null);
check("the sender's address, from any form", emailAddressOf("Dana Ray <Dana@X.test>") === "dana@x.test" && emailAddressOf(" d@x.test ") === "d@x.test" && emailAddressOf("no address") === null && emailAddressOf(null) === null);

// ── Stage 2: the webhook's signature (Standard Webhooks) ─────────────────────
const key = Buffer.from("MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw").toString("base64");
const whsec = `whsec_${key}`;
const body = JSON.stringify({ type: "email.received", data: { to: [addr] } });
const now = 1_790_000_000;
const sign = (id: string, ts: number, payload: string) => `v1,${createHmac("sha256", Buffer.from(key, "base64")).update(`${id}.${ts}.${payload}`).digest("base64")}`;
const good = { id: "msg_1", timestamp: String(now), signature: sign("msg_1", now, body) };
check("a signed payload verifies", verifyWebhook(good, body, whsec, now));
check("…also among several signatures (a rotated secret)", verifyWebhook({ ...good, signature: `v1,AAAA ${good.signature}` }, body, whsec, now));
check("a changed body, another id, an old timestamp, no signature or the wrong secret: refused", !verifyWebhook(good, body.replace("received", "sent"), whsec, now) && !verifyWebhook({ ...good, id: "msg_2" }, body, whsec, now) && !verifyWebhook(good, body, whsec, now + 600) && !verifyWebhook({ ...good, signature: null }, body, whsec, now) && !verifyWebhook(good, body, `whsec_${Buffer.from("other").toString("base64")}`, now));

// ── Stage 2: what the reply says, without the letter it quotes ───────────────
check("Gmail: cut at 'On … wrote:'", trimQuoted("Thanks, that works.\n\nOn Fri, Oct 17, 2026 at 9:14 AM JobFlex <x@y.z> wrote:\n> Hi Daniel,\n> blah") === "Thanks, that works.");
check("Gmail's header split over two lines", trimQuoted("Still broken.\n\nOn Fri, Oct 17, 2026 at 9:14 AM JobFlex support <\nt-abc@reply.jobflex.app> wrote:\n> old") === "Still broken.");
check("our own cut line", trimQuoted(`New words.\n\n${REPLY_ABOVE}\nold letter`) === "New words.");
check("Outlook's header block and separator", trimQuoted("Yes please.\n\n________________________________\nFrom: JobFlex <x@y>\nSent: Friday\nTo: me\nSubject: Re: S") === "Yes please." && trimQuoted("Yes.\n\nFrom: JobFlex <x@y>\nSent: Friday\nSubject: Re") === "Yes.");
check("…but a line that merely starts with 'From:' stays", trimQuoted("From: my side it still fails.\nTwice today.") === "From: my side it still fails.\nTwice today.");
check("a Russian mail app's 'пишет:'", trimQuoted("Спасибо!\n\n17 окт. 2026 г., в 9:14, JobFlex <x@y.z> пишет:\n> old") === "Спасибо!");
check("a trailing quote and a phone's sign-off go", trimQuoted("Got it.\n\nSent from my iPhone\n\n> old\n> older") === "Got it.");
check("HTML only: tags out, the quoted blockquote out", htmlToText('<div>Hi there,<br>it works &amp; thanks</div><blockquote class="gmail_quote">old</blockquote>') === "Hi there,\nit works & thanks");
check("out-of-office and machine replies are recognised; a person's reply is not", isAutoReply("Automatic reply: away", null) && isAutoReply("Re: Bad sizing", { "Auto-Submitted": "auto-replied" }) && isAutoReply("Re: x", { Precedence: "bulk" }) && !isAutoReply("Re: Bad sizing [JobFlex J7RCFS]", { "Auto-Submitted": "no" }));

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
