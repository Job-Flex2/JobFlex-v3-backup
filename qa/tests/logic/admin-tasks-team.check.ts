// THE JOBFLEX TEAM, BY TEXT (2026-10-15, no logins) — the pure rules (lib/adminTasks/teamShared): who on the name +
// phone list gets each task text, quiet nights (Urgent still goes), never a switched-off phone, never the person who
// took or had it; what the texts say; phones as typed; the stored list checked; delivery receipts in words.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/admin-tasks-team.check.ts
import {
  cleanMembers,
  deliveryWords,
  isMemberRef,
  isQuietHour,
  memberIdOf,
  memberRef,
  parseTaskReply,
  phoneE164,
  readTextNote,
  replyTextBody,
  taskIdInText,
  textNoteBody,
  phoneWords,
  taskTextBody,
  textRecipients,
  welcomeTextBody,
  type TaskText,
  type TeamMember,
} from "../../../src/lib/adminTasks/teamShared";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const m = (id: string, name: string, phone: string, on = true, quietNights = true): TeamMember => ({ id, name, phone, on, quietNights, addedAt: "2026-10-15T00:00:00Z" });
const team: TeamMember[] = [
  m("dima01", "Dmitriy Apetenok", "+14257726587"),
  m("ivan01", "Ivan Petrov", "+12065550101"),
  m("ana001", "Ana", "+12065550102", true, false),
  m("off001", "Off Person", "+12065550103", false),
];
const task = { id: "t1", title: "Fix the roof estimator's photo upload on iPhone", priority: "NORMAL", dueDate: "2026-10-16" };
const noon = new Date("2026-10-15T19:00:00Z"); // 12:00 PM in Los Angeles
const night = new Date("2026-10-16T06:30:00Z"); // 11:30 PM in Los Angeles

const ids = (t: TaskText, at = noon) => textRecipients(t, team, at).join(",");
check("a new task nobody has: everyone with texts on", ids({ kind: "new", task, by: "Dmitriy Apetenok" }) === "dima01,ivan01,ana001");
check("given to Ivan: Ivan only", ids({ kind: "assigned", task, by: "Dmitriy", to: "ivan01" }) === "ivan01");
check("given to someone with texts off: nobody", ids({ kind: "assigned", task, by: null, to: "off001" }) === "");
check("Ivan took it: everyone else", ids({ kind: "taken", task, member: "ivan01", name: "Ivan Petrov" }) === "dima01,ana001");
check("done, Ivan had it: everyone but Ivan", ids({ kind: "done", task, member: "ivan01", name: "Ivan Petrov" }) === "dima01,ana001");
check("done, an admin had it: the whole team", ids({ kind: "done", task, member: null, name: "Alex" }) === "dima01,ivan01,ana001");
check("at night: only the phone that doesn't keep quiet", ids({ kind: "new", task, by: null }, night) === "ana001");
check("…unless it's Urgent", ids({ kind: "new", task: { ...task, priority: "URGENT" }, by: null }, night) === "dima01,ivan01,ana001");
check("quiet hours are 9 PM–7 AM Los Angeles", isQuietHour(night) && !isQuietHour(noon) && isQuietHour(new Date("2026-10-15T04:30:00Z")) && !isQuietHour(new Date("2026-10-15T14:30:00Z")));

const href = "https://www.jobflex.app/admin/tasks?task=t1";
const t1 = taskTextBody({ kind: "new", task, by: "Dmitriy Apetenok" }, href);
check("new: from whom, the title, the due day, reply OK to take it, the link", t1 === `JobFlex task from Dmitriy: “Fix the roof estimator's photo upload on iPhone” · due Oct 16. Nobody has it yet — reply OK to take it. ${href}`, t1);
check("new from the shared console: no name", taskTextBody({ kind: "new", task, by: null }, href).startsWith("JobFlex task: “Fix"));
const given = taskTextBody({ kind: "assigned", task: { ...task, priority: "URGENT" }, by: "Dmitriy", to: "ivan01" }, href);
check("assigned: a task for you, Urgent first, reply OK or NO", given.startsWith("JobFlex: a task for you from Dmitriy — URGENT · “Fix") && given.includes("Reply OK if you'll do it, NO if you can't.") && given.endsWith(href), given);
check(
  "taken / done read as one line each",
  taskTextBody({ kind: "taken", task, member: "ivan01", name: "Ivan Petrov" }, href) === `JobFlex: Ivan took “Fix the roof estimator's photo upload on iPhone”. ${href}` &&
    taskTextBody({ kind: "done", task, member: "ivan01", name: "Ivan Petrov" }, href) === `JobFlex: ✓ “Fix the roof estimator's photo upload on iPhone” is done (Ivan). ${href}`,
);
const long = taskTextBody({ kind: "new", task: { ...task, title: "x".repeat(200), dueDate: null }, by: "D" }, href);
check("a long title is cut so the text stays short", long.length < 220 && long.includes("…"), String(long.length));
const hi = welcomeTextBody("Ivan Petrov", "Dmitriy Apetenok");
check("the welcome text says who added them, the reply words, and how to stop", hi.startsWith("JobFlex: hi Ivan — Dmitriy added you to the JobFlex team's task texts.") && /reply OK to take it, DONE when it's finished, NO if you can't/.test(hi) && hi.endsWith("Reply STOP to stop."), hi);
check("…and from the shared console without a name", welcomeTextBody("Ivan", null).startsWith("JobFlex: hi Ivan — you're added to"));

check("phones as typed → E.164", phoneE164("(425) 772-6587") === "+14257726587" && phoneE164("1 425 772 6587") === "+14257726587" && phoneE164("+44 20 7946 0958") === "+442079460958" && phoneE164("12345") === null && phoneE164("") === null);
check("shown back in US words", phoneWords("+14257726587") === "(425) 772-6587" && phoneWords("+442079460958") === "+442079460958");
const cleaned = cleanMembers([
  { id: "abcd12", name: "  Ivan   Petrov ", phone: "(206) 555-0101" },
  { id: "bad id!", name: "X", phone: "+12065550101" },
  { id: "efgh34", name: "", phone: "+12065550102" },
  { id: "ijkl56", name: "No phone", phone: "nope" },
  { id: "abcd12", name: "Twice", phone: "+12065550103" },
  7,
  { id: "mnop78", name: "Ana", phone: "+12065550104", on: false, quietNights: false },
]);
check("the stored list checked: junk and repeats dropped, names tidied, defaults on", cleaned.map((x) => x.id).join() === "abcd12,mnop78" && cleaned[0].name === "Ivan Petrov" && cleaned[0].phone === "+12065550101" && cleaned[0].on && cleaned[0].quietNights && !cleaned[1].on && !cleaned[1].quietNights);
check("not a list → empty", cleanMembers(null).length === 0 && cleanMembers({}).length === 0);
check("a task given to someone on the list: m:<id>", memberRef("abcd12") === "m:abcd12" && isMemberRef("m:abcd12") && !isMemberRef("m:") && !isMemberRef("cmv698hn70000") && !isMemberRef(null) && memberIdOf("m:abcd12") === "abcd12");

const at = "2026-10-15T19:00:00Z";
const dw = (status: string, error: string | null = null) => deliveryWords({ status, error, at });
check(
  "delivery in words: delivered, waiting, didn't arrive (with the carrier's reason), not sent (with ours)",
  dw("DELIVERED")?.tone === "ok" &&
    dw("SENT")?.tone === "wait" &&
    dw("UNDELIVERED", "30006 Landline or unreachable carrier")?.words === "Last text didn't arrive — it's a landline" &&
    dw("FAILED", "30007")?.words === "Last text didn't arrive — the carrier filtered it" &&
    dw("UNDELIVERED", "39999 who knows")?.words === "Last text didn't arrive — carrier error 39999" &&
    dw("SKIPPED", "not-configured")?.words === "Last text not sent — texting isn't set up on this server" &&
    dw("SKIPPED", "no-number")?.words === "Last text not sent — JobFlex's number isn't approved yet" &&
    deliveryWords(null) === null,
);

// Replies to a task text (2026-10-15): OK / DONE / NO, a note, a named task.
check("Ivan said no: everyone else hears it's open again", ids({ kind: "declined", task, member: "ivan01", name: "Ivan Petrov" }) === "dima01,ana001" && taskTextBody({ kind: "declined", task, member: "ivan01", name: "Ivan Petrov" }, href).startsWith("JobFlex: Ivan can't do “Fix the roof estimator's photo upload on iPhone” — it's open again. Reply OK to take it."));
const r = (t: string) => parseTaskReply(t);
check("OK in its everyday spellings", ["OK", "ok", "Okay!", "k", "Yes", "yep", "Sure", "on it", "I'll do it", "I’ll do it", "got it", "👍", "1"].every((t) => r(t).intent === "ok" && r(t).note === ""));
check("DONE / NO", ["DONE", "done.", "Finished", "completed", "✅", "2"].every((t) => r(t).intent === "done") && ["NO", "nope", "can't", "can’t", "not me", "3"].every((t) => r(t).intent === "no"));
check("words beyond the command become their note, as written", r("ok, on my way").intent === "ok" && r("ok, on my way").note === "ok, on my way" && r("can't today").intent === "no" && r("can't today").note === "can't today" && r("done - pushed the fix").note === "done - pushed the fix");
check("anything else is a note; look-alikes aren't commands", r("what time?").intent === "note" && r("what time?").note === "what time?" && r("nothing yet").intent === "note" && r("okra for lunch").intent === "note" && r("Dones").intent === "note");
check("a named task: T-XXXXXX anywhere", r("T-3g60ge done").ref === "3G60GE" && r("T-3g60ge done").intent === "done" && r("done T-3G60GE").ref === "3G60GE" && r("ok").ref === null);
check("the answers say what the reply did",
  replyTextBody("took", "Fix it", "Ivan Petrov") === "JobFlex: it's yours, Ivan — “Fix it”. Reply DONE when it's finished." &&
    replyTextBody("confirmed", "Fix it", "Ivan Petrov") === "JobFlex: confirmed, Ivan — “Fix it” is yours. Reply DONE when it's finished." &&
    replyTextBody("done", "Fix it", "Ivan") === "JobFlex: ✓ “Fix it” is marked done. Thanks, Ivan!" &&
    replyTextBody("theirs", "Fix it", "Ivan", "Ana Lee") === "JobFlex: Ana has “Fix it”, so nothing changed." &&
    /no task to answer/.test(replyTextBody("none", null, "Ivan")));
check("a texted note keeps who wrote it", JSON.stringify(readTextNote(textNoteBody("Ivan Petrov", "on my way\nsecond line"))) === JSON.stringify({ name: "Ivan Petrov", note: "on my way\nsecond line" }) && readTextNote("plain comment") === null);
check("the task a text was about, from its link", taskIdInText(`JobFlex: Ivan took “x”. ${href.replace("t1", "cmv9ybdra003c17o4nq86y8xy")}`) === "cmv9ybdra003c17o4nq86y8xy" && taskIdInText("JobFlex: hi Ivan — you're added. Reply STOP to stop.") === null);

if (bad) {
  console.log(`\n${bad} FAILED`);
  process.exit(1);
}
console.log("\nall passed");
