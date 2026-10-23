// THE LIVE VIEW'S SOUNDS (owner, 2026-10-23, lib/live-chimes): a chime when a visitor reaches the checkout, a
// "ka-ching" when someone signs up — once each, never for what was already on the page.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/live-chimes.check.ts
import { liveChimes, type ChimeMemory } from "../../../src/lib/live-chimes";
import type { LiveReport, LiveStage, LiveVisitor } from "../../../src/lib/traffic-live";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

type Slice = Pick<LiveReport, "visitors" | "converted" | "otherSignups">;
const v = (id: string, stage: LiveStage, org = ""): LiveVisitor =>
  ({ id, firstAt: "2026-10-23T10:00:00Z", stage, place: "Houston, TX", city: "Houston", trade: "Roofing", signup: org ? { orgName: org } : null } as unknown as LiveVisitor);
const r = (visitors: LiveVisitor[], converted: LiveVisitor[] = [], others: string[] = []): Slice =>
  ({ visitors, converted, otherSignups: others.map((orgName) => ({ orgName, ownerEmail: "", at: "", source: "", planLabel: "" })) });
let mem: ChimeMemory | null = null;
const step = (report: Slice) => { const out = liveChimes(mem, report); mem = out.memory; return out.chimes.map((c) => c.kind + ":" + c.key.split("|")[0]); };

console.log("── the first report only remembers");
check("people already at the checkout or signed up make no sound on opening", step(r([v("a", "checkout"), v("b", "signed-up", "Old Co")], [], ["Other Co"])).length === 0);

console.log("── a visitor reaching the checkout");
check("browsing → nothing", step(r([v("a", "checkout"), v("b", "signed-up", "Old Co"), v("c", "browsing")], [], ["Other Co"])).length === 0);
check("registering → nothing yet", step(r([v("a", "checkout"), v("b", "signed-up", "Old Co"), v("c", "registering")], [], ["Other Co"])).length === 0);
const toCheckout = step(r([v("a", "checkout"), v("b", "signed-up", "Old Co"), v("c", "checkout")], [], ["Other Co"]));
check("checkout → one chime, for that visitor", toCheckout.join() === "card:c", toCheckout.join());
check("still at the checkout next poll → no repeat", step(r([v("a", "checkout"), v("b", "signed-up", "Old Co"), v("c", "checkout")], [], ["Other Co"])).length === 0);
const straight = step(r([v("a", "checkout"), v("b", "signed-up", "Old Co"), v("c", "checkout"), v("d", "checkout")], [], ["Other Co"]));
check("a new visitor who lands straight at the checkout → a chime", straight.join() === "card:d", straight.join());

console.log("── a sign-up");
const signed = step(r([v("a", "checkout"), v("b", "signed-up", "Old Co"), v("c", "signed-up", "Ridge Roofing"), v("d", "checkout")], [v("c", "signed-up", "Ridge Roofing")], ["Other Co"]));
check("signed up → one ka-ching, even listed twice (visit + converted)", signed.join() === "signup:Ridge Roofing", signed.join());
check("the same sign-up next poll → no repeat", step(r([v("c", "signed-up", "Ridge Roofing")], [v("c", "signed-up", "Ridge Roofing")], ["Other Co", "Ridge Roofing"])).length === 0);
const noVisit = step(r([], [], ["Other Co", "Ridge Roofing", "Fence Pros"]));
check("a sign-up with no visit (analytics blocked) → a ka-ching", noVisit.join() === "signup:Fence Pros", noVisit.join());
const both = step(r([v("e", "checkout"), v("f", "signed-up", "Deck Masters")], [], ["Other Co", "Ridge Roofing", "Fence Pros"]));
check("both in one poll → a chime and a ka-ching", both.sort().join() === "card:e,signup:Deck Masters", both.join());
check("a sign-up back at the checkout (another plan) → no chime", step(r([v("f", "checkout", "Deck Masters")], [], ["Other Co", "Ridge Roofing", "Fence Pros", "Deck Masters"])).length === 0);

console.log("── only what happened after the page opened");
const opened = Date.parse("2026-10-23T12:00:00Z");
const at = (iso: string) => ({ steps: [{ label: "Checkout", kind: "checkout" as LiveStage, at: iso }] });
let m2: ChimeMemory | null = liveChimes(null, r([]), opened).memory;
const late = (x: Slice) => { const out = liveChimes(m2, x, opened); m2 = out.memory; return out.chimes.map((c) => c.kind + ":" + c.key.split("|")[0]); };
check("a checkout from before the page opened (a cached first report missed it) → quiet", late(r([{ ...v("g", "checkout"), ...at("2026-10-23T11:59:30Z") } as LiveVisitor])).length === 0);
check("a checkout after it → the chime", late(r([{ ...v("h", "checkout"), ...at("2026-10-23T12:00:20Z") } as LiveVisitor])).join() === "card:h");
const oldSignup = { orgName: "Early Co", ownerEmail: "", at: "2026-10-23T11:58:00Z", source: "", planLabel: "" };
const newSignup = { orgName: "Fresh Co", ownerEmail: "", at: "2026-10-23T12:01:00Z", source: "", planLabel: "" };
const sOut = liveChimes(m2, { visitors: [], converted: [], otherSignups: [oldSignup, newSignup] }, opened).chimes.map((c) => c.key);
check("a sign-up from before the page opened → quiet, one after → the ka-ching", sOut.join() === "Fresh Co", sOut.join());

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
