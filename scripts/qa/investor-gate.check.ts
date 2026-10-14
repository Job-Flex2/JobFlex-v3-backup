// The investor link's front door (2026-10-13): what an introduction and an offer must carry, tidied the same way on
// the page and on the server.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json scripts/qa/investor-gate.check.ts
import { checkIntro, checkOffer, INVESTING_KINDS, INVESTOR_KINDS, offersOf, readersOf } from "../../src/lib/investorGate";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const empty = checkIntro({});
check("an empty introduction names every missing field", ["name", "company", "kind", "email"].every((k) => k in empty.problems), JSON.stringify(empty.problems));
const good = checkIntro({ name: "  Maria   Lopez ", company: "Cascade Ventures", kind: "VC fund", email: " Maria@Cascade.VC ", phone: "" });
check("a good one passes, tidied (spaces, email lower-case, no empty phone)", Object.keys(good.problems).length === 0 && good.value.name === "Maria Lopez" && good.value.email === "maria@cascade.vc" && good.value.phone === undefined, JSON.stringify(good));
check("a made-up kind is refused", "kind" in checkIntro({ name: "Al", company: "Co", kind: "Wizard", email: "a@b.co" }).problems);
check("a bad email is refused", "email" in checkIntro({ name: "Al", company: "Co", kind: "Other", email: "al@" }).problems);
check("a short phone is refused, a real one passes", "phone" in checkIntro({ name: "Al", company: "Co", kind: "Other", email: "a@b.co", phone: "12" }).problems && !("phone" in checkIntro({ name: "Al", company: "Co", kind: "Other", email: "a@b.co", phone: "(425) 555-0100" }).problems));
check("the investing kinds are all real kinds, and a contractor is not one", [...INVESTING_KINDS].every((k) => (INVESTOR_KINDS as readonly string[]).includes(k)) && !INVESTING_KINDS.has("Contractor or trade business"));

const who = { name: "Maria Lopez", company: "Cascade Ventures", email: "maria@cascade.vc" };
const intro = checkOffer({ ...who, type: "Intro call first", amount: "Open", instrument: "Not sure yet", timeline: "Exploring", message: "" });
check("an intro call with open answers passes", Object.keys(intro.problems).length === 0, JSON.stringify(intro.problems));
const sheet = checkOffer({ ...who, type: "Term sheet", amount: "$500K–$1M", instrument: "SAFE", timeline: "This month", message: "" });
check("a term sheet asks for a line on the terms (or the valuation)", "message" in sheet.problems);
check("…a valuation is enough", Object.keys(checkOffer({ ...who, type: "Term sheet", amount: "$500K–$1M", instrument: "SAFE", timeline: "This month", message: "", valuation: "$8M post" }).problems).length === 0);
check("an unknown amount or instrument is refused", (() => { const p = checkOffer({ ...who, type: "Investment interest", amount: "a lot", instrument: "Magic", timeline: "This month", message: "" }).problems; return "amount" in p && "instrument" in p; })());
check("a message is kept whole up to 3,000 characters", checkOffer({ ...who, type: "Investment interest", amount: "Open", instrument: "SAFE", timeline: "Exploring", message: "x".repeat(5000) }).value.message.length === 3000);

// The admins' own walk-throughs (2026-10-14) are not readers, nor their test offers offers.
const people = [{ id: "a", name: "Maria", admin: undefined }, { id: "b", name: "The owner", admin: true }, { id: "c", name: "Chen" }];
check("an admin's walk-through is left out of the readers, the others kept in order", readersOf(people).map((p) => p.id).join("") === "ac");
check("an admin's test offer is left out of the offers", offersOf([{ id: "o1", admin: true }, { id: "o2" }]).map((o) => o.id).join("") === "o2");
check("with no admin entries nothing changes", readersOf(people.slice(0, 1)).length === 1 && offersOf([]).length === 0);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
