// The answer to a support ticket (2026-10-14, lib/supportReply): what a reply must be, the letter it becomes, and
// where a reply moves the ticket. Pure, no database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/support-reply.check.ts
import { checkReply, paragraphsOf, replyLetter, replySubject, statusAfterReply, REPLY_LIMITS } from "../../../src/lib/supportReply";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

check("an empty reply does not go", !checkReply("").ok && !checkReply("   ").ok && !checkReply(undefined).ok);
check("one letter is not an answer", !checkReply("k").ok);
const long = checkReply("x".repeat(REPLY_LIMITS.body + 1));
check("over the limit is refused, and says so", !long.ok && /4,000/.test(long.ok ? "" : long.error));
const okr = checkReply("  Thanks for writing.\r\n\r\nFixed it.  ");
check("a reply is tidied: trimmed, Windows line ends straightened", okr.ok && okr.body === "Thanks for writing.\n\nFixed it.");
check("the subject carries the ticket's subject and ref", replySubject({ subject: "  Bad   sizing ", ref: "J7RCFS" }) === "Re: Bad sizing [JobFlex J7RCFS]");
check("a blank subject still reads", replySubject({ subject: "", ref: "A1B2C3" }) === "Re: Your message [JobFlex A1B2C3]");
check("an answer moves Open to In progress, nothing else", statusAfterReply("OPEN") === "IN_PROGRESS" && statusAfterReply("IN_PROGRESS") === "IN_PROGRESS" && statusAfterReply("RESOLVED") === "RESOLVED" && statusAfterReply("CLOSED") === "CLOSED");
check("paragraphs split on blank lines, single breaks stay", JSON.stringify(paragraphsOf("One\nstill one\n\n\nTwo")) === JSON.stringify(["One\nstill one", "Two"]));

const letter = replyLetter({
  body: "Hi Daniel,\n\nThe sizing uses the pitch you entered — 7/12 gives 5,856 sq ft here. Re-measure & it updates.\n\nLet me know.",
  sender: "Dmitriy",
  ticket: { subject: "Bad sizing", body: "Bad sizing <the roof looks 2x>", ref: "J7RCFS", filedAt: "2026-10-14T04:46:00.000Z" },
  base: "https://jobflex.app/",
});
check("the letter's subject is the reply subject", letter.subject === "Re: Bad sizing [JobFlex J7RCFS]");
check("the paragraphs are in the html, escaped, with the single break kept", letter.html.includes("Re-measure &amp; it updates.") && letter.html.includes("<p ") && (letter.html.match(/<p style="margin:0 0 16px/g) ?? []).length === 3);
check("it is signed by the admin over JobFlex support", /Dmitriy<br><span[^>]*>JobFlex support · jobflex.app/.test(letter.html));
check("it says a reply reaches us and where the ticket lives", letter.html.includes("Reply to this email and it reaches us") && letter.html.includes("https://jobflex.app/dashboard/support") && letter.html.includes("J7RCFS"));
check("the ticket's own words are quoted under it, escaped", letter.html.includes("On Oct 14, 2026 you wrote:") && letter.html.includes("Bad sizing &lt;the roof looks 2x&gt;"));
check("the text twin has the paragraphs, the signature and the quote", letter.text.includes("Let me know.") && letter.text.includes("Dmitriy\nJobFlex support · jobflex.app") && letter.text.includes("> Bad sizing <the roof looks 2x>"));
check("no image, no tracking", !/<img|pixel|track/i.test(letter.html));
const longQuote = replyLetter({ body: "Thanks.", sender: "", ticket: { subject: "Long", body: "y".repeat(3000), ref: "X1", filedAt: "bad date" }, base: "https://jobflex.app" });
check("a long ticket is quoted in part; a blank sender signs as JobFlex support; a bad date still reads", longQuote.html.includes("…") && longQuote.text.includes("JobFlex support\nJobFlex support") === false && longQuote.html.includes("You wrote:") && /JobFlex support<br>/.test(longQuote.html));

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
