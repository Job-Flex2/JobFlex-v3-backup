// SmartHelp pure core: guide order, step gating, page registry vs real routes.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/smarthelp.check.ts
import { HELP_PAGES, isHelpPage, pathOf } from "../../../src/lib/smarthelp/pages";
import { guideCards, stepView } from "../../../src/lib/smarthelp/view";
import type { Guide, HelpContext, SetupState } from "../../../src/lib/smarthelp/types";
import { appRoutes, isRealRoute } from "../../lib/appRoutes";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}

const setup: SetupState = {
  profile: false, aiDesk: false, texting: false, payments: false,
  booking: false, website: false, team: false, proposalSent: false,
};
const ctx: HelpContext = {
  role: "OWNER", plan: null, lockedHrefs: [], setup,
  features: { booking: true, website: true }, page: "/dashboard",
};
const g = (id: string, group: "setup" | "how", extra: Partial<Guide> = {}): Guide =>
  ({ id, title: id, group, icon: "Sparkles", steps: [], ...extra });

const guides: Guide[] = [
  g("s-done", "setup", { needs: "profile" }),
  g("s-todo1", "setup", { needs: "aiDesk" }),
  g("s-none", "setup"),
  g("s-todo2", "setup", { needs: "texting" }),
  g("h1", "how"),
  g("s-book", "setup", { needs: "booking", feature: "booking" }),
  g("h2", "how"),
];
const c1 = { ...ctx, setup: { ...setup, profile: true } };
const ids = guideCards(guides, c1).map((c) => `${c.id}:${c.state}`);
check("guideCards order", ids.join() === "s-todo1:todo,s-todo2:todo,s-book:todo,s-none:none,s-done:done,h1:none,h2:none", ids);
const off = guideCards(guides, { ...c1, features: { booking: false, website: true } }).map((c) => c.id);
check("feature guide absent when off", !off.includes("s-book"), off);

const open = "/dashboard/phone?tab=settings";
check("INSTALLER blocked by role", stepView({ text: "x", open }, { ...ctx, role: "INSTALLER" }).blocked === "role");
check("OWNER not blocked", stepView({ text: "x", open }, ctx).blocked === undefined);
check("plan-locked page", stepView({ text: "x", open }, { ...ctx, lockedHrefs: ["/dashboard/phone"] }).blocked === "plan");
check("step without open untouched", stepView({ text: "x", show: "a" }, { ...ctx, role: "INSTALLER" }).blocked === undefined);

const routes = appRoutes();
const unreal = HELP_PAGES.filter((p) => !isRealRoute(pathOf(p.path), routes)).map((p) => p.path);
check("every HELP_PAGES path is a real route", unreal.length === 0, unreal);
check("HELP_PAGES paths unique", new Set(HELP_PAGES.map((p) => p.path)).size === HELP_PAGES.length);
check("isRealRoute [id] wildcard", isRealRoute("/dashboard/clients/abc", routes));
check("isRealRoute rejects invented", !isRealRoute("/dashboard/ai-desk", routes));
check("isHelpPage settings pane", isHelpPage("/dashboard/settings?pane=payments"));
check("isHelpPage invented", !isHelpPage("/dashboard/ai-desk"));
check("isHelpPage unlisted pane", !isHelpPage("/dashboard/settings?pane=nope"));
check("pathOf strips query+hash", pathOf("/a/b?x=1#h") === "/a/b");

console.log(bad ? `${bad} FAILED` : "all passed");
process.exit(bad ? 1 : 0);
