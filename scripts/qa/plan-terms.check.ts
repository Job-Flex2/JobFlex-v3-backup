// THE PLAN CARDS' MONTHLY | ANNUAL (2026-10-12). One switch over every row of plan cards —
// the landing (#pricing), /pricing, the signup plan step and /dashboard/upgrade (desk and
// phone builds) — and cards that are always open. Against a PRODUCTION build (./_prod-server,
// the shared .cache/next-sweep build), at 360 · 390 · 430 · 768 · 1024 · 1440, it fails when:
//   · Monthly: a card says "/yr";
//   · Annual: a card's deal carries "%"; "You save $N" is not 12 × monthly − yearly for that
//     plan; a plan with no yearly price does not read "/mo" + "Billed monthly";
//   · a "Show all" / "Show less" / "What's included" control is drawn, or a list is cut;
//   · the cards of a row differ in height, or their prices / first feature rows are not on
//     one line — in Monthly or in Annual — or a card changes height on the switch;
//   · the page scrolls sideways, or a card's content is wider than the card;
//   · the switch is not a radio group the arrow keys drive, or a half is under 44px on a phone;
//   · the landing's Annual does not carry into the signup plan step.
// Pure half: lib/planDeal (months free in whole months only, never a percentage).
// The plan step is reached the way signup-flow.check.ts reaches it (its own made-up IP, mail
// keys blank, its pending signups and brake rows removed after). The upgrade page signs in
// only as qa@acme.test (QA Co).
//   npx --no-install tsx --tsconfig tsconfig.json scripts/qa/plan-terms.check.ts
// QA_TERMS_URL=http://localhost:NNNN uses a server already up instead (no build, no start).
/* eslint-disable @typescript-eslint/no-explicit-any -- Playwright is resolved at run time (./_prod-server), so its types are not here */
import type { ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";
import { ensureBuild, playwright, startServer, stopServer } from "./_prod-server";
import { annualDeal, dealWords, savedWords, sharedDealWords, planTerm } from "../../src/lib/planDeal";

const PORT = Number(process.env.QA_TERMS_PORT || 3314);
const BASE = (process.env.QA_TERMS_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
process.env.QA_BASE_URL = BASE; // ./_qa reads it once, on load
const req = createRequire(__filename);
const WIDTHS = [360, 390, 430, 768, 1024, 1440];
const STAMP = Date.now();
const MAIL_DOMAIN = `planterms${STAMP}.test`;
const IP = `10.${1 + (STAMP % 250)}.${1 + ((STAMP >> 8) % 250)}.${1 + ((STAMP >> 16) % 250)}`;
const db = new PrismaClient();
let bad = 0;
const check = (name: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const note = (name: string, extra = "") => console.log(`note ${name}${extra ? " — " + extra : ""}`);

function pure() {
  console.log("── lib/planDeal");
  check("$890/yr on $89/mo: 2 months free, You save $178", dealWords(annualDeal(8900, 89000)) === "2 months free" && savedWords(annualDeal(8900, 89000)) === "You save $178");
  check("$1,990/yr on $199/mo: 2 months free, You save $398", dealWords(annualDeal(19900, 199000)) === "2 months free" && savedWords(annualDeal(19900, 199000)) === "You save $398");
  check("$290/yr on $45/mo: no stamp (5.56 months), You save $250", dealWords(annualDeal(4500, 29000)) === "" && savedWords(annualDeal(4500, 29000)) === "You save $250");
  check("$950/yr on $89/mo: no stamp, never a percentage", dealWords(annualDeal(8900, 95000)) === "" && !/%/.test(dealWords(annualDeal(8900, 95000)) + savedWords(annualDeal(8900, 95000))));
  check("a saving with cents keeps its cents: $1,000.50/yr on $100/mo", savedWords(annualDeal(10000, 100050)) === "You save $199.50");
  check("no yearly price, a dearer year, or a free plan: no deal", annualDeal(8900, null) === null && annualDeal(8900, 106800) === null && annualDeal(0, 1000) === null);
  check("the switch's tag: only when every yearly plan gives the same whole months", sharedDealWords([annualDeal(8900, 89000), annualDeal(19900, 199000)]) === "2 months free" && sharedDealWords([annualDeal(4500, 29000), annualDeal(19900, 199000)]) === "");
  check("a plan with no yearly price bills MONTH on Annual", planTerm("YEAR", null) === "MONTH" && planTerm("YEAR", 29000) === "YEAR" && planTerm("MONTH", 29000) === "MONTH");
}

type CardRead = { slug: string; top: number; left: number; height: number; priceTop: number; featTop: number; text: string; deal: string; price: string; monthly: number; yearly: number | null; overflow: boolean; cut: boolean };
type RowRead = { cards: CardRead[]; more: string[]; scrollX: number; vw: number; switches: number; halves: number[] };

/** Every plan card on the page (data-plan-card), measured. */
async function read(page: any, scope: string): Promise<RowRead> {
  // No pointer over a card: a hovered card lifts 2px and would read as out of line.
  await page.mouse.move(1, 1);
  await page.waitForTimeout(200);
  return page.evaluate((scope: string) => {
    const root = document.querySelector(scope) || document.body;
    const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-plan-card]")).filter((c) => c.getClientRects().length);
    const more = Array.from(root.querySelectorAll<HTMLElement>("button, [role=button], a")).filter((b) => b.getClientRects().length && /^(show (all|less)|what's included|hide the list)/i.test((b.textContent || "").trim())).map((b) => (b.textContent || "").trim());
    const r = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
    return {
      cards: cards.map((c) => {
        const box = c.getBoundingClientRect();
        const feats = c.querySelector("[data-plan-feats]");
        const items = feats ? Array.from(feats.children) as HTMLElement[] : [];
        const cut = !!feats && (feats.scrollHeight > feats.clientHeight + 1 || items.some((i) => getComputedStyle(i).display === "none"));
        return {
          slug: c.dataset.planCard || "",
          top: Math.round(box.top), left: Math.round(box.left), height: Math.round(box.height * 10) / 10,
          priceTop: Math.round((r(c.querySelector("[data-plan-price]"))?.top ?? -1) * 10) / 10,
          featTop: Math.round((r(items[0] || feats)?.top ?? -1) * 10) / 10,
          text: (c.textContent || "").replace(/\s+/g, " "),
          deal: (c.querySelector(".jf-deal")?.textContent || "").replace(/\s+/g, " ").trim(),
          price: (c.querySelector("[data-plan-price]")?.textContent || "").replace(/\s+/g, ""),
          monthly: Number(c.dataset.monthlyCents || 0),
          yearly: c.dataset.yearlyCents ? Number(c.dataset.yearlyCents) : null,
          overflow: c.scrollWidth > c.clientWidth + 1,
          cut,
        };
      }),
      more,
      scrollX: document.scrollingElement!.scrollWidth,
      vw: window.innerWidth,
      switches: root.querySelectorAll(".jf-term").length,
      halves: Array.from(root.querySelectorAll<HTMLElement>(".jf-term-b")).map((b) => Math.round(b.getBoundingClientRect().height)),
    };
  }, scope);
}

/** Cards that share a row: the same top (a carousel's cards all do). */
function rows(cards: CardRead[]): CardRead[][] {
  const by = new Map<number, CardRead[]>();
  for (const c of cards) { const k = [...by.keys()].find((t) => Math.abs(t - c.top) <= 2) ?? c.top; by.set(k, [...(by.get(k) ?? []), c]); }
  return [...by.values()];
}
const spread = (xs: number[]) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0);

function judgeRow(name: string, r: RowRead, term: "MONTH" | "YEAR") {
  check(`${name}: plan cards drawn`, r.cards.length > 0, `${r.cards.length}`);
  if (!r.cards.length) return;
  check(`${name}: no sideways scroll`, r.scrollX <= r.vw + 1, `${r.scrollX} > ${r.vw}`);
  const wide = r.cards.filter((c) => c.overflow).map((c) => c.slug);
  check(`${name}: nothing wider than its card`, !wide.length, wide.join(", "));
  check(`${name}: every card open (no Show all)`, !r.more.length && !r.cards.some((c) => c.cut), [...r.more, ...r.cards.filter((c) => c.cut).map((c) => c.slug + " cut")].join(", "));
  for (const row of rows(r.cards)) {
    const ids = row.map((c) => c.slug).join("/");
    check(`${name}: ${ids} one height`, spread(row.map((c) => c.height)) <= 1, row.map((c) => c.height).join(" · "));
    check(`${name}: ${ids} prices on one line`, spread(row.map((c) => c.priceTop)) <= 1, row.map((c) => c.priceTop).join(" · "));
    check(`${name}: ${ids} first feature rows on one line`, spread(row.map((c) => c.featTop)) <= 1, row.map((c) => c.featTop).join(" · "));
  }
  for (const c of r.cards) {
    if (c.slug === "custom" && !c.monthly) continue;
    if (term === "MONTH") {
      check(`${name}: ${c.slug} Monthly says no /yr`, !/\/yr/.test(c.text), c.price);
    } else {
      const d = annualDeal(c.monthly, c.yearly);
      check(`${name}: ${c.slug} Annual deal has no %`, !/%/.test(c.deal), c.deal);
      if (!c.yearly) check(`${name}: ${c.slug} has no yearly price → /mo, Billed monthly`, /\/mo$/.test(c.price) && /Billed monthly/.test(c.deal), `${c.price} · ${c.deal}`);
      else {
        check(`${name}: ${c.slug} Annual price is the year`, c.price === `$${c.yearly / 100}/yr`.replace(/\.(\d)$/, ".$10"), c.price);
        check(`${name}: ${c.slug} "${savedWords(d)}"${dealWords(d) ? " + " + dealWords(d) : ""}`, (!d || c.deal.includes(savedWords(d))) && (!d || !dealWords(d) || c.deal.includes(dealWords(d))) && (!d || (!dealWords(d) ? !/months? free/i.test(c.deal) : true)), c.deal);
      }
    }
  }
}

/** The switch: a radio group, the arrow key moves it, 44px halves on a phone. Leaves it on `to`. */
async function flip(page: any, name: string, scope: string, to: "MONTH" | "YEAR", phone: boolean, viaKeys: boolean) {
  const sw = page.locator(`${scope} .jf-term`).first();
  if (!(await sw.count())) return check(`${name}: the switch is drawn`, false);
  if (viaKeys) {
    await page.locator(`${scope} .jf-term [aria-checked="true"]`).first().focus();
    await page.keyboard.press(to === "YEAR" ? "ArrowRight" : "ArrowLeft");
  } else {
    await page.locator(`${scope} .jf-term [data-term="${to}"]`).first().click();
  }
  await page.waitForTimeout(350);
  const state = await sw.evaluate((el: HTMLElement) => ({ role: el.getAttribute("role"), on: el.querySelector('[aria-checked="true"]')?.getAttribute("data-term"), focus: (document.activeElement as HTMLElement | null)?.getAttribute("data-term") ?? null, h: Array.from(el.querySelectorAll<HTMLElement>(".jf-term-b")).map((b) => b.getBoundingClientRect().height) }));
  check(`${name}: switch → ${to === "YEAR" ? "Annual" : "Monthly"}${viaKeys ? " by arrow key" : ""}`, state.role === "radiogroup" && state.on === to && (!viaKeys || state.focus === to), JSON.stringify(state));
  if (phone) check(`${name}: switch halves ≥ 44px`, state.h.every((h: number) => h >= 44), state.h.join(" · "));
}

async function surface(page: any, name: string, scope: string, phone: boolean, viaKeys: boolean) {
  const m = await read(page, scope);
  judgeRow(`${name} Monthly`, m, "MONTH");
  const hasYear = m.cards.some((c) => c.yearly);
  check(`${name}: one switch iff a plan has a yearly price`, m.switches === (hasYear ? 1 : 0), `${m.switches}`);
  if (!hasYear) return;
  await flip(page, name, scope, "YEAR", phone, viaKeys);
  const a = await read(page, scope);
  judgeRow(`${name} Annual`, a, "YEAR");
  const jumped = a.cards.filter((c, i) => Math.abs(c.height - (m.cards[i]?.height ?? c.height)) > 1).map((c, i) => `${c.slug} ${m.cards[i]?.height}→${c.height}`);
  check(`${name}: no card changes height on the switch`, !jumped.length, jumped.join(", "));
  await flip(page, name, scope, "MONTH", phone, false);
}

async function visit(browser: any, width: number) {
  const phone = width <= 768;
  const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1, locale: "en-US" });
  // tsx names the helpers inside page.evaluate with esbuild's __name; the page has none.
  await ctx.addInitScript({ content: "window.__name = function (f) { return f; };" });
  const host = new URL(BASE).hostname;
  await ctx.addCookies([{ name: "jf_consent", value: encodeURIComponent(JSON.stringify({ v: 1, at: new Date().toISOString(), analytics: false, marketing: false, ack: true })), domain: host, path: "/" }]);
  await ctx.route("**/*", (route: any) => {
    const u = route.request().url();
    if (u.startsWith(BASE)) return route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": IP } });
    if (/facebook\.(com|net)|posthog|googletagmanager|google-analytics|doubleclick/.test(u)) return route.fulfill({ status: 204, body: "" });
    return route.continue();
  });
  return ctx;
}

async function marketing(browser: any) {
  for (const width of WIDTHS) {
    const ctx = await visit(browser, width);
    const page = await ctx.newPage();
    try {
      for (const [path, scope] of [["/#pricing", "#pricing"], ["/pricing", "main"]] as const) {
        await page.goto(BASE + path, { waitUntil: "load", timeout: 180000 });
        await page.locator(`${scope} [data-plan-card]`).first().waitFor({ timeout: 60000 });
        await page.locator(`${scope} [data-plan-card]`).first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(1200);
        await surface(page, `${path} @${width}`, scope, width <= 768, width === 1440);
      }
    } catch (e) {
      check(`marketing @${width}: ran through`, false, String((e as Error)?.message || e).split("\n")[0]);
    } finally {
      await ctx.close();
    }
  }
}

/** Landing on Annual → a card's start → step 1 → step 2 → the plan sheet opens on Annual. */
async function planStep(browser: any, width: number, n: number) {
  const ctx = await visit(browser, width);
  const page = await ctx.newPage();
  const name = `signup plan step @${width}`;
  try {
    await page.goto(BASE + "/#pricing", { waitUntil: "load", timeout: 180000 });
    const hadSwitch = (await page.locator("#pricing .jf-term").count()) > 0;
    if (hadSwitch) {
      await page.locator('#pricing .jf-term [data-term="YEAR"]').first().click();
      await page.waitForTimeout(300);
    }
    const go = page.locator("#pricing [data-plan-card] a").filter({ visible: true }).first();
    const href = await go.getAttribute("href");
    check(`${name}: the landing's Annual rides the start link`, !hadSwitch || /[?&]billing=annual\b/.test(href || ""), href || "");
    await Promise.all([page.waitForURL(/\/auth\/register/, { timeout: 120000 }), go.click()]);
    await page.locator("#nextBtn").waitFor({ timeout: 120000 });
    await page.waitForTimeout(800);
    await page.getByPlaceholder("First and last").fill("Plan Terms");
    await page.getByPlaceholder("you@yourshop.com").fill(`terms.${n}@${MAIL_DOMAIN}`);
    const pw = page.locator('input[autocomplete="new-password"]');
    for (let i = 0; i < (await pw.count()); i++) if (await pw.nth(i).isVisible()) await pw.nth(i).fill("PlanTerms-2026!");
    await page.locator("#nextBtn").click();
    await page.getByPlaceholder("Company name").waitFor({ state: "visible", timeout: 60000 });
    await page.getByPlaceholder("Company name").fill("Plan Terms Co");
    await page.getByPlaceholder("Street, city, state, ZIP").fill("142 Alder Ridge Rd, Seattle, WA 98101");
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    await page.getByPlaceholder("Phone number").fill("2065550123");
    if (!(await page.locator("#step2 .chip.on").count())) await page.locator("#step2 .chip").first().click();
    await page.locator("#createBtn").click();
    await page.locator("section.plan-sheet.is-in [data-plan-card]").first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(1500);
    const scope = "section.plan-sheet.is-in";
    if (hadSwitch) {
      const on = await page.locator(`${scope} .jf-term [aria-checked="true"]`).getAttribute("data-term").catch(() => null);
      check(`${name}: opens on the Annual picked on the landing`, on === "YEAR", String(on));
      const a = await read(page, scope);
      judgeRow(`${name} Annual (carried)`, a, "YEAR");
      await flip(page, name, scope, "MONTH", width <= 768, false);
    }
    await surface(page, name, scope, width <= 768, width === 1440);
    // QA_TERMS_SHOTS=<dir>: the plan step on Annual, for a look by eye.
    if (process.env.QA_TERMS_SHOTS) {
      await page.locator(`${scope} .jf-term [data-term="YEAR"]`).first().click().catch(() => {});
      await page.waitForTimeout(400);
      await page.locator(scope).screenshot({ path: `${process.env.QA_TERMS_SHOTS}/plan-step-${width}.png` }).catch(() => {});
    }
  } catch (e) {
    check(`${name}: ran through`, false, String((e as Error)?.message || e).split("\n")[0]);
  } finally {
    await ctx.close();
  }
}

/** /dashboard/upgrade as qa@acme.test: the desk build at 1024 / 1440, the phone build at ≤768. */
async function upgrade(browser: any) {
  const qa = req("./_qa.js");
  const signer = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const sp = await signer.newPage();
  await qa.signIn(sp);
  const cookies = await signer.cookies();
  await signer.close();
  for (const width of WIDTHS) {
    const ctx = await visit(browser, width);
    await ctx.addCookies(cookies);
    const page = await ctx.newPage();
    try {
      await page.goto(BASE + "/dashboard/upgrade", { waitUntil: "domcontentloaded", timeout: 180000 });
      await page.locator("[data-plan-card]").first().waitFor({ timeout: 90000 });
      await page.waitForTimeout(2500);
      await surface(page, `/dashboard/upgrade @${width}`, "body", width <= 768, width === 1440);
    } catch (e) {
      check(`/dashboard/upgrade @${width}: ran through`, false, String((e as Error)?.message || e).split("\n")[0]);
    } finally {
      await ctx.close();
    }
  }
}

async function main() {
  pure();
  const pw = playwright();
  let server: ChildProcess | null = null;
  try {
    if (!process.env.QA_TERMS_URL) {
      ensureBuild(note);
      server = await startServer(PORT, { STRIPE_SECRET_KEY: "", RESEND_API_KEY: "", SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "" }, "QA_TERMS_PORT");
    }
    const browser = await pw.chromium.launch({ channel: "chrome", args: ["--disable-blink-features=AutomationControlled"] }).catch(() => pw.chromium.launch());
    try {
      console.log("── landing #pricing and /pricing");
      await marketing(browser);
      console.log("── the signup plan step");
      await planStep(browser, 390, 1);
      await planStep(browser, 1440, 2);
      console.log("── /dashboard/upgrade");
      await upgrade(browser);
    } finally {
      await browser.close();
    }
  } finally {
    stopServer(server);
    await db.syncState.deleteMany({ where: { key: { startsWith: "signup:" }, cursor: { contains: MAIL_DOMAIN } } }).catch(() => {});
    await db.syncState.deleteMany({ where: { OR: [{ key: { startsWith: "rl:", endsWith: ":" + IP } }, { key: { startsWith: `rl:signup-start:${IP}:` } }] } }).catch(() => {});
    await db.$disconnect();
  }
  console.log(bad ? `\n${bad} failing` : "\nall green");
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log("\n1 failing"); process.exit(1); });
