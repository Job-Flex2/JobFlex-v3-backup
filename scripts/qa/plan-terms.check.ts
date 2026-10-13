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
//   · the landing's Annual does not carry into the signup plan step;
//   · (2026-10-12) on a desk — 1280×800, 1440×900, 1536×864, 1920×1080 — the plan step scrolls,
//     a card's list scrolls inside it, or a card's start button is not wholly in the window;
//     the row of cards is not centred (three cards, and four with CUSTOM_PLAN_ENABLED=true on
//     a second server, where the Custom card must be in the row on the plan step and
//     /dashboard/upgrade, while /pricing and the landing keep three cards and the wide "Build
//     your plan" plate under them); a plan card's hard offset is not 3px; a sign-in page still
//     draws the old "J" square (.brand-mark) instead of the product mark (.jf-pmark), or the
//     mark's ink is not 22–24px tall;
//   · (2026-10-12, the year's saving shown louder) the Annual badge on the switch is missing on
//     either side of it, or does not read what the cards' catalogue gives ("2–3 months free",
//     "Save up to $N"); on Monthly a card says "months free"; on Annual a card's "N MONTHS FREE"
//     stamp or its "You save $N a year" does not match its prices, or that line is under 15px;
//   · (2026-10-12, tidied) the stamps of a row do not stand at one distance from their cards'
//     right edges on one line; the signup's date line repeats "months free"; the switch's badge
//     does not cross the Annual half's bottom edge, starts other than 6–8px inside the Annual
//     half, sticks out past the switch by other than 8–16px (0–16px on a phone), covers the word ANNUAL, comes within 8px of the cards or
//     "Most picked", or does not choose Annual when pressed; on a desk the logo, "Pick a plan."
//     and the first card do not share a left edge, or the steps, the switch and the last card a
//     right one (1px).
//   · (2026-10-12, the phone's plan step is tiles) at 360×640, 390×844 and 430×932 — Chromium,
//     and WebKit at 360 and 390 — with three plans and with four (the custom one): a tile is cut,
//     under the pinned start button or under 72px; the page scrolls sideways; a tap does not make
//     that tile alone the choice, with its own list under the tiles and its name and price on the
//     button's line; a list is the same for two plans; Annual does not price every tile a year or
//     moves a tile; at the end the terms or the last row are under the button, or it is not pinned;
//     the code field is out of sight with the window 300px shorter (the keyboard) or under the
//     button; a cancelled Checkout does not come back to the plan chosen before it.
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
import { annualDeal, dealWords, savedWords, savedYearWords, sharedDealWords, planTerm } from "../../src/lib/planDeal";

const PORT = Number(process.env.QA_TERMS_PORT || 3314);
let BASE = (process.env.QA_TERMS_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
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
  check("the switch's badge: the range of whole free months", sharedDealWords([annualDeal(4500, 40500), annualDeal(9500, 85500), annualDeal(19900, 199000)]) === "2\u20133 months free");
  check("…one value when they agree, and plans without whole months are left out", sharedDealWords([annualDeal(8900, 89000), annualDeal(19900, 199000)]) === "2 months free" && sharedDealWords([annualDeal(4500, 29000), annualDeal(19900, 199000)]) === "2 months free");
  check("…'Save up to $N' when no plan gives whole months, nothing when no year saves", sharedDealWords([annualDeal(4500, 29000), annualDeal(8900, 95000)]) === "Save up to $250" && sharedDealWords([null, annualDeal(8900, 120000)]) === "" && sharedDealWords([]) === "");
  check("the card's green line: 'You save $135 a year'", savedYearWords(annualDeal(4500, 40500)) === "You save $135 a year" && dealWords(annualDeal(4500, 40500)) === "3 months free");
  check("a plan with no yearly price bills MONTH on Annual", planTerm("YEAR", null) === "MONTH" && planTerm("YEAR", 29000) === "YEAR" && planTerm("MONTH", 29000) === "MONTH");
}

type CardRead = { slug: string; top: number; left: number; height: number; priceTop: number; featTop: number; text: string; deal: string; dealPx: number; stamp: string | null; stampRight: number | null; stampTop: number | null; when: string; price: string; monthly: number; yearly: number | null; overflow: boolean; cut: boolean };
type RowRead = { cards: CardRead[]; more: string[]; scrollX: number; vw: number; switches: number; halves: number[]; badge: string | null; badgeLabel: string | null };

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
          // What the card SHOWS (innerText: an unpainted twin of the other term is not text).
          text: (c.innerText || "").replace(/\s+/g, " "),
          deal: (c.querySelector(".jf-deal")?.textContent || "").replace(/\s+/g, " ").trim(),
          dealPx: parseFloat(getComputedStyle(c.querySelector(".jf-deal-save") || c.querySelector(".jf-deal") || c).fontSize),
          stamp: c.querySelector("[data-plan-stamp]")?.textContent?.trim() ?? null,
          stampRight: (() => { const st = c.querySelector("[data-plan-stamp]"); return st ? Math.round((box.right - st.getBoundingClientRect().right) * 10) / 10 : null; })(),
          stampTop: (() => { const st = c.querySelector("[data-plan-stamp]"); return st ? Math.round(st.getBoundingClientRect().top * 10) / 10 : null; })(),
          when: ((c.querySelector(".pw-when-now") as HTMLElement | null)?.innerText || "").replace(/\s+/g, " ").trim(),
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
      badge: root.querySelector(".jf-term [data-term-badge]")?.textContent?.trim() ?? null,
      badgeLabel: root.querySelector('.jf-term [data-term="YEAR"]')?.getAttribute("aria-label") ?? null,
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
  // The badge on the switch: there on either side, and it reads the cards' own catalogue.
  if (r.switches) {
    const want = sharedDealWords(r.cards.filter((c) => c.yearly).map((c) => annualDeal(c.monthly, c.yearly)));
    check(`${name}: the Annual badge reads "${want}"`, (want ? r.badge === want : r.badge === null) && (!want || r.badgeLabel === `Annual, ${want}`), `${r.badge} · ${r.badgeLabel}`);
  }
  check(`${name}: every card open (no Show all)`, !r.more.length && !r.cards.some((c) => c.cut), [...r.more, ...r.cards.filter((c) => c.cut).map((c) => c.slug + " cut")].join(", "));
  for (const row of rows(r.cards)) {
    const ids = row.map((c) => c.slug).join("/");
    check(`${name}: ${ids} one height`, spread(row.map((c) => c.height)) <= 1, row.map((c) => c.height).join(" · "));
    check(`${name}: ${ids} prices on one line`, spread(row.map((c) => c.priceTop)) <= 1, row.map((c) => c.priceTop).join(" · "));
    check(`${name}: ${ids} first feature rows on one line`, spread(row.map((c) => c.featTop)) <= 1, row.map((c) => c.featTop).join(" · "));
    const stamped = row.filter((c) => c.stampRight !== null);
    if (stamped.length > 1) {
      check(`${name}: ${ids} stamps at one distance from the right edge`, spread(stamped.map((c) => c.stampRight!)) <= 1, stamped.map((c) => `${c.slug} ${c.stampRight}`).join(" · "));
      check(`${name}: ${ids} stamps on one line`, spread(stamped.map((c) => c.stampTop!)) <= 1, stamped.map((c) => `${c.slug} ${c.stampTop}`).join(" · "));
    }
  }
  for (const c of r.cards) {
    if (c.slug === "custom" && !c.monthly) continue;
    if (term === "MONTH") {
      check(`${name}: ${c.slug} Monthly says no /yr and no months free`, !/\/yr/.test(c.text) && !/months? free/i.test(c.text) && !c.stamp, c.price);
    } else {
      const d = annualDeal(c.monthly, c.yearly);
      check(`${name}: ${c.slug} Annual deal has no %`, !/%/.test(c.deal), c.deal);
      if (!c.yearly) check(`${name}: ${c.slug} has no yearly price → /mo, Billed monthly`, /\/mo$/.test(c.price) && /Billed monthly/.test(c.deal), `${c.price} · ${c.deal}`);
      else {
        check(`${name}: ${c.slug} Annual price is the year`, c.price === `$${c.yearly / 100}/yr`.replace(/\.(\d)$/, ".$10"), c.price);
        check(`${name}: ${c.slug} "${savedYearWords(d) || "Billed yearly"}"${dealWords(d) ? " + stamp " + dealWords(d) : ""}`, (d ? c.deal === savedYearWords(d) : /Billed yearly/.test(c.deal)) && (dealWords(d) ? c.stamp === dealWords(d) : c.stamp === null), `${c.deal} · stamp ${c.stamp}`);
        if (d) check(`${name}: ${c.slug} the saving line is 15px or more`, c.dealPx >= 15, `${c.dealPx}px`);
        if (c.when) check(`${name}: ${c.slug} the date line does not repeat the months`, !/months? free/i.test(c.when), c.when);
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
  await badge(page, name, scope, phone);
}

/** The switch's badge, a sticker on the Annual half's bottom-right corner. Leaves Monthly on. */
async function badge(page: any, name: string, scope: string, phone: boolean) {
  const g = await page.evaluate((scope: string) => {
    const root = document.querySelector(scope) || document.body;
    const sw = root.querySelector(".jf-term") as HTMLElement | null;
    const tag = sw?.querySelector("[data-term-badge]") as HTMLElement | null;
    if (!sw || !tag) return null;
    const yr = sw.querySelector('[data-term="YEAR"]') as HTMLElement;
    const text = document.createRange();
    text.selectNodeContents(yr.querySelector(".jf-term-label") as Node);
    const t = text.getBoundingClientRect();
    const b = tag.getBoundingClientRect();
    const s = sw.getBoundingClientRect();
    const a = yr.getBoundingClientRect();
    const z = (sw as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom || 1;
    // what lies under it: the cards, and the "Most picked" plates that share its columns
    const below = Array.from(root.querySelectorAll<HTMLElement>("[data-plan-card], .pw-tag, .lp-pw-tag, .jf-up-tag"))
      .filter((e) => e.getClientRects().length)
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.top >= s.bottom - 1 && r.right > b.left && r.left < b.right);
    const next = below.length ? Math.min(...below.map((r) => r.top)) : null;
    return {
      crosses: b.top < a.bottom && b.bottom > s.bottom,
      share: Math.round(((s.bottom - b.top) / b.height) * 100),
      // in the page's own px: the desk dashboard draws its whole content under a CSS zoom
      out: Math.round(((b.right - s.right) / z) * 10) / 10,
      // the seam between the halves is the Annual half's left edge (its 2px frame is its own)
      inset: Math.round(((b.left - a.left) / z) * 10) / 10,
      clearOfWord: b.top >= t.bottom || b.right <= t.left || b.left >= t.right,
      gap: next === null ? null : Math.round((next - (b.bottom + 2)) * 10) / 10,
      inWindow: b.right <= innerWidth && b.left >= 0,
      x: b.left + b.width / 2, y: b.bottom - 3,
    };
  }, scope);
  if (!g) return check(`${name}: the switch's badge is drawn`, false);
  check(`${name}: the badge crosses the Annual half's bottom edge (${g.share}% of it over)`, g.crosses && g.share >= 20 && g.share <= 50, JSON.stringify(g));
  check(`${name}: the badge starts ${g.inset}px inside the Annual half (6–8px, never over Monthly)`, g.inset >= 6 && g.inset <= 8, `${g.inset}px`);
  check(`${name}: the badge sticks out ${g.out}px past the switch`, phone ? g.out >= 0 && g.out <= 16 && g.inWindow : g.out >= 8 && g.out <= 16, `${g.out}px`);
  check(`${name}: the badge leaves the word ANNUAL clear`, g.clearOfWord);
  check(`${name}: the badge is 8px or more above the cards`, g.gap === null || g.gap >= 8, `${g.gap}px`);
  await page.mouse.click(g.x, g.y);
  await page.waitForTimeout(300);
  const on = await page.locator(`${scope} .jf-term [aria-checked="true"]`).first().getAttribute("data-term");
  check(`${name}: a press on the badge chooses Annual`, on === "YEAR", String(on));
  await page.locator(`${scope} .jf-term [data-term="MONTH"]`).first().click();
  await page.waitForTimeout(300);
}

async function visit(browser: any, width: number, height?: number) {
  const phone = width <= 768;
  // isMobile is Chromium's; WebKit takes the phone's size and touch.
  const mobile = phone && browser.browserType().name() === "chromium";
  const ctx = await browser.newContext({ viewport: { width, height: height ?? (phone ? 844 : 900) }, isMobile: mobile, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1, locale: "en-US" });
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

async function marketing(browser: any, widths = WIDTHS, plate = false) {
  const cards = 3;
  for (const width of widths) {
    const ctx = await visit(browser, width);
    const page = await ctx.newPage();
    try {
      for (const [path, scope] of [["/#pricing", "#pricing"], ["/pricing", "main"]] as const) {
        await page.goto(BASE + path, { waitUntil: "load", timeout: 180000 });
        await page.locator(`${scope} [data-plan-card]`).first().waitFor({ timeout: 60000 });
        await page.locator(`${scope} [data-plan-card]`).first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(1200);
        await surface(page, `${path} @${width}`, scope, width <= 768, width === 1440);
        const n = await page.locator(`${scope} [data-plan-card]`).count();
        check(`${path} @${width}: ${cards} cards in the row`, n === cards, `${n}`);
        const plates = await page.locator(".pr-custom").count();
        check(`${path} @${width}: the "Build your plan" plate ${plate ? "under the row" : "absent"}`, plate ? plates === 1 : plates === 0, `${plates}`);
        if (width === 1440) {
          const sh = await page.locator(`${scope} [data-plan-card]:not(.lp-pw-plan--hero)`).first().evaluate((el: HTMLElement) => getComputedStyle(el).boxShadow);
          check(`${path} @${width}: a card's hard offset is 3px`, /3px 3px 0px/.test(sh), sh);
        }
      }
    } catch (e) {
      check(`marketing @${width}: ran through`, false, String((e as Error)?.message || e).split("\n")[0]);
    } finally {
      await ctx.close();
    }
  }
}

const DESKS: [number, number][] = [[1280, 800], [1440, 900], [1536, 864], [1920, 1080]];

/** The plan step on a desk: no scroll, no list scrolling, every start button in the window,
 *  the row centred, the 3px offset. Leaves the viewport at 1440×900. */
async function fitDesk(page: any, name: string, scope: string, cards: number) {
  for (const [w, h] of DESKS) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(600);
    await page.mouse.move(1, 1);
    await page.waitForTimeout(200);
    const m = await page.evaluate((scope: string) => {
      const sheet = document.querySelector(scope) as HTMLElement;
      const list = Array.from(sheet.querySelectorAll<HTMLElement>("[data-plan-card]"));
      const box = list.map((c) => c.getBoundingClientRect());
      const go = list.map((c) => { const r = c.querySelector(".pw-go")!.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
      const sw = sheet.querySelector(".pw-plans")!.getBoundingClientRect();
      return {
        n: list.length,
        sheet: sheet.scrollHeight - sheet.clientHeight,
        page: document.scrollingElement!.scrollHeight - innerHeight,
        inner: list.map((c) => { const f = c.querySelector<HTMLElement>("[data-plan-feats]")!; return f.scrollHeight - f.clientHeight; }),
        goOut: go.filter((g) => g.top < 0 || g.bottom > innerHeight).length,
        maxBottom: Math.round(Math.max(...go.map((g) => g.bottom))),
        centre: Math.round(((Math.min(...box.map((r) => r.left)) + Math.max(...box.map((r) => r.right))) / 2 - (sw.left + sw.right) / 2) * 10) / 10,
        pageCentre: Math.round(((Math.min(...box.map((r) => r.left)) + Math.max(...box.map((r) => r.right))) / 2 - innerWidth / 2) * 10) / 10,
        shadow: getComputedStyle(list.find((c) => !c.classList.contains("pw-plan--hero")) || list[0]).boxShadow,
        // one column: the logo's ink, the heading and the first card on the left; the last step,
        // the switch and the last card on the right
        lefts: [
          (document.querySelector("section.plan-sheet.is-in .jf-pmark") as HTMLElement).getBoundingClientRect().left + 0.5,
          sheet.querySelector("#stepPlan .auth-h1")!.getBoundingClientRect().left,
          Math.min(...box.map((r) => r.left)),
        ].map((x) => Math.round(x * 10) / 10),
        rights: [
          (() => { const items = sheet.querySelectorAll(".stepper .st-item"); return items[items.length - 1].getBoundingClientRect().right; })(),
          sheet.querySelector(".jf-term")!.getBoundingClientRect().right,
          Math.max(...box.map((r) => r.right)),
        ].map((x) => Math.round(x * 10) / 10),
      };
    }, scope);
    const at = `${name} @${w}×${h}`;
    check(`${at}: ${cards} cards in the row`, m.n === cards, `${m.n}`);
    check(`${at}: the step does not scroll`, m.sheet <= 0 && m.page <= 0, `sheet +${m.sheet}px, page +${m.page}px`);
    check(`${at}: no list scrolls inside its card`, m.inner.every((x: number) => x <= 0), m.inner.join(" · "));
    check(`${at}: every start button wholly in the window`, m.goOut === 0, `lowest button ends at ${m.maxBottom}px of ${h}`);
    check(`${at}: the row is centred`, Math.abs(m.centre) <= 1 && Math.abs(m.pageCentre) <= 1, `${m.centre}px off its rail, ${m.pageCentre}px off the window`);
    check(`${at}: a card's hard offset is 3px`, /3px 3px 0px/.test(m.shadow), m.shadow);
    check(`${at}: the logo, the heading and the first card share a left edge`, spread(m.lefts) <= 1, m.lefts.join(" · "));
    check(`${at}: the steps, the switch and the last card share a right edge`, spread(m.rights) <= 1, m.rights.join(" · "));
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
}

/** Landing on Annual → a card's start → step 1 → step 2 → the plan sheet opens on Annual. */
async function planStep(browser: any, width: number, n: number, cards = 3) {
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
    if (cards === 4) check(`${name}: the Custom card is in the row`, (await page.locator(`${scope} [data-plan-card="custom"]`).count()) === 1);
    if (width >= 1280) await fitDesk(page, name, scope, cards);
    // QA_TERMS_SHOTS=<dir>: the plan step on Annual, for a look by eye.
    if (process.env.QA_TERMS_SHOTS) {
      await page.locator(`${scope} .jf-term [data-term="YEAR"]`).first().click().catch(() => {});
      await page.waitForTimeout(400);
      await page.locator(scope).screenshot({ path: `${process.env.QA_TERMS_SHOTS}/plan-step-${width}-${cards}.png` }).catch(() => {});
    }
  } catch (e) {
    check(`${name}: ran through`, false, String((e as Error)?.message || e).split("\n")[0]);
  } finally {
    await ctx.close();
  }
}

/** /auth/register → step 1 → step 2 → the plan sheet (the password sign-up's three steps). */
async function toPlanSheet(page: any, n: number, query = "") {
  await page.goto(BASE + "/auth/register" + query, { waitUntil: "load", timeout: 180000 });
  await page.locator("#nextBtn").waitFor({ timeout: 120000 });
  await page.waitForTimeout(800);
  await page.getByPlaceholder("First and last").fill("Plan Tiles");
  await page.getByPlaceholder("you@yourshop.com").fill(`tiles.${n}@${MAIL_DOMAIN}`);
  const pw = page.locator('input[autocomplete="new-password"]');
  for (let i = 0; i < (await pw.count()); i++) if (await pw.nth(i).isVisible()) await pw.nth(i).fill("PlanTiles-2026!");
  await page.locator("#nextBtn").click();
  await page.getByPlaceholder("Company name").waitFor({ state: "visible", timeout: 60000 });
  await page.getByPlaceholder("Company name").fill("Plan Tiles Co");
  await page.getByPlaceholder("Street, city, state, ZIP").fill("142 Alder Ridge Rd, Seattle, WA 98101");
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.getByPlaceholder("Phone number").fill("2065550123");
  if (!(await page.locator("#step2 .chip.on").count())) await page.locator("#step2 .chip").first().click();
  await page.locator("#createBtn").click();
  await page.locator("section.plan-sheet.is-in [data-plan-card]").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
}

/** THE PHONE'S PLAN STEP (owner, 2026-10-12): every plan a tile on the first screen, the chosen
 *  plan whole under them, one pinned start button. Fails when a tile is cut or under the button,
 *  the page scrolls sideways, a tap does not change the list and the button's line, the switch
 *  moves a tile, the button covers the terms at the end, the code field is not in sight with the
 *  keyboard up (the window 300px shorter), or a cancelled Checkout does not come back to its plan. */
async function phoneTiles(browser: any, width: number, height: number, n: number, cards = 3) {
  const engine = browser.browserType().name();
  const name = `phone plan step ${engine} ${width}×${height}${cards === 4 ? " (custom)" : ""}`;
  const ctx = await visit(browser, width, height);
  const page = await ctx.newPage();
  const sheet = "section.plan-sheet.is-in";
  const look = () =>
    page.evaluate((sheet: string) => {
      const root = document.querySelector(sheet)!;
      const r = (e: Element | null) => (e ? e.getBoundingClientRect() : null);
      const bar = document.querySelector("[data-plan-bar]");
      const b = r(bar);
      const tiles = Array.from(root.querySelectorAll<HTMLElement>("[data-plan-card]"));
      return {
        vw: innerWidth, vh: innerHeight, sw: document.scrollingElement!.scrollWidth,
        cards: root.querySelectorAll(".pw-plans, .pw-dots").length,
        tiles: tiles.map((t) => { const x = t.getBoundingClientRect(); return { slug: t.dataset.planCard!, top: x.top, bottom: x.bottom, left: x.left, right: x.right, h: Math.round(x.height * 10) / 10, on: t.getAttribute("aria-pressed") === "true", price: (t.querySelector("[data-plan-price]")?.textContent || "").replace(/\s+/g, "") }; }),
        barTop: b ? b.top : null, barBottom: b ? b.bottom : null,
        sub: (document.querySelector("[data-plan-sub]")?.textContent || "").replace(/\s+/g, " ").trim(),
        go: (document.querySelector("[data-plan-go]")?.textContent || "").trim(),
        detail: (document.querySelector("[data-plan-detail]") as HTMLElement | null)?.dataset.planDetail ?? null,
        rows: Array.from(document.querySelectorAll("[data-plan-detail] [data-plan-feats] > *")).map((x) => `${x.classList.contains("pw-f--no") ? "-" : "+"}${(x.textContent || "").trim()}`),
        when: (document.querySelector("[data-plan-detail] p")?.textContent || "").trim(),
      };
    }, sheet);
  try {
    await toPlanSheet(page, n);
    await page.mouse.move(1, 1);
    const m = await look();
    check(`${name}: ${cards} tiles, no swiped row of cards`, m.tiles.length === cards && m.cards === 0, `${m.tiles.length} tiles · ${m.cards} card rows`);
    check(`${name}: no sideways scroll`, m.sw <= m.vw + 1, `${m.sw} > ${m.vw}`);
    const cut = m.tiles.filter((t) => t.top < 0 || t.bottom + 3 > (m.barTop ?? m.vh) || t.left < 0 || t.right + 3 > m.vw).map((t) => `${t.slug} ${Math.round(t.top)}..${Math.round(t.bottom)}`);
    check(`${name}: every tile whole on the first screen, above the start button`, !cut.length && m.barTop !== null, `${cut.join(", ")} · button from ${Math.round(m.barTop ?? -1)}`);
    check(`${name}: tiles ≥ 72px tall`, m.tiles.every((t) => t.h >= 72), m.tiles.map((t) => t.h).join(" · "));
    if (cards % 2 === 1) { const last = m.tiles[m.tiles.length - 1], first = m.tiles[0]; check(`${name}: the odd tile takes the full width`, last.left - first.left < 1 && last.right - m.tiles[1].right > -1, `${Math.round(last.left)}..${Math.round(last.right)}`); }
    const hero = m.tiles.find((t) => t.on);
    check(`${name}: the "Most picked" plan is chosen on arrival`, !!hero && Boolean((await page.locator(`${sheet} [data-plan-card="${hero.slug}"]`).textContent())?.includes("Most picked")), hero?.slug ?? "none");
    check(`${name}: the button is pinned to the bottom edge`, Math.abs((m.barBottom ?? 0) - m.vh) <= 1 && /^Start \d+-day free trial$/.test(m.go), `${m.barBottom} of ${m.vh} · ${m.go}`);
    // Every tile: the list under the tiles and the button's line follow the tap; the page stays put.
    const seen = new Set<string>();
    for (const t of m.tiles) {
      const before = await page.locator(sheet).evaluate((el: HTMLElement) => el.scrollTop);
      await page.locator(`${sheet} [data-plan-card="${t.slug}"]`).click();
      await page.waitForTimeout(250);
      const a = await look();
      const tile = a.tiles.find((x) => x.slug === t.slug)!;
      const tileName = (await page.locator(`${sheet} [data-plan-card="${t.slug}"] [data-plan-head] > :first-child`).innerText()).trim().toLowerCase();
      const after = await page.locator(sheet).evaluate((el: HTMLElement) => el.scrollTop);
      seen.add(a.rows.join("|"));
      check(`${name}: tap ${t.slug} — it alone is chosen; the list and the button's line are its own`, tile.on && a.tiles.filter((x) => x.on).length === 1 && a.detail === t.slug && a.rows.length > 0 && a.sub.toLowerCase().startsWith(tileName + " ·") && a.sub.endsWith(tile.price.replace(/^from/, "")) && Math.abs(after - before) <= 1, `${a.sub} · ${a.rows.length} rows · scroll ${before}→${after}`);
    }
    check(`${name}: each plan's list differs`, seen.size === m.tiles.length, `${seen.size} lists for ${m.tiles.length} tiles`);
    // Monthly ↔ Annual: the prices change, no tile moves.
    const heights = (await look()).tiles.map((t) => t.h);
    await page.locator(`${sheet} .jf-term [data-term="YEAR"]`).click();
    await page.waitForTimeout(350);
    const y = await look();
    check(`${name}: Annual — every tile prices a year, no tile changes height`, y.tiles.every((t) => /\/yr$/.test(t.price)) && y.tiles.every((t, i) => Math.abs(t.h - heights[i]) <= 1) && /\/yr$/.test(y.sub), `${y.tiles.map((t) => `${t.price} ${t.h}`).join(" · ")} · ${y.sub}`);
    await page.locator(`${sheet} .jf-term [data-term="MONTH"]`).click();
    await page.waitForTimeout(350);
    const mo = await look();
    check(`${name}: Monthly again — /mo, the same heights`, mo.tiles.every((t) => /\/mo$/.test(t.price)) && mo.tiles.every((t, i) => Math.abs(t.h - heights[i]) <= 1), mo.tiles.map((t) => `${t.price} ${t.h}`).join(" · "));
    // The end of the sheet: the terms and the last row clear of the button, which is still there.
    await page.locator(sheet).evaluate((el: HTMLElement) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(350);
    const end = await page.evaluate(() => {
      const bar = document.querySelector("[data-plan-bar]")!.getBoundingClientRect();
      const terms = document.querySelector("#pwTerms")!.getBoundingClientRect();
      const rows = Array.from(document.querySelectorAll("[data-plan-detail] [data-plan-feats] > *"));
      const last = rows[rows.length - 1]?.getBoundingClientRect();
      return { barTop: bar.top, barBottom: bar.bottom, terms: terms.bottom, last: last?.bottom ?? 0, vh: innerHeight };
    });
    check(`${name}: at the end the terms and the last row are above the button, still pinned`, end.terms <= end.barTop && end.last <= end.barTop && Math.abs(end.barBottom - end.vh) <= 1, JSON.stringify(end));
    // The code field with the keyboard up: the window 300px shorter, the field in sight, uncovered.
    const promo = page.locator(`${sheet} .pw-promo-in`);
    await promo.scrollIntoViewIfNeeded();
    await promo.focus();
    await page.setViewportSize({ width, height: height - 300 });
    await page.waitForTimeout(700);
    const kb = await page.evaluate(() => {
      const f = document.querySelector("section.plan-sheet.is-in .pw-promo-in")!.getBoundingClientRect();
      const bar = document.querySelector("[data-plan-bar]") as HTMLElement;
      const cs = getComputedStyle(bar), b = bar.getBoundingClientRect();
      const hidden = cs.visibility === "hidden" || b.top >= innerHeight - 1;
      return { top: f.top, bottom: f.bottom, vh: innerHeight, hidden, barTop: b.top };
    });
    check(`${name}: the code field in sight with the keyboard up, the button out of its way`, kb.top >= 0 && kb.bottom <= kb.vh && (kb.hidden || kb.barTop >= kb.bottom), JSON.stringify(kb));
    await page.setViewportSize({ width, height });
    // A cancelled Checkout comes back to the plan chosen before it (the tab's memory).
    const pick = m.tiles[0].slug;
    await page.locator(`${sheet} [data-plan-card="${pick}"]`).click();
    const row = await db.syncState.findFirst({ where: { key: { startsWith: "signup:" }, cursor: { contains: `tiles.${n}@${MAIL_DOMAIN}` } }, select: { key: true } });
    const tok = new URL(page.url()).searchParams.get("signup") ?? row?.key.slice("signup:".length) ?? null;
    if (tok) {
      await page.goto(`${BASE}/auth/register?signup=${encodeURIComponent(tok)}&checkout=cancelled`, { waitUntil: "load", timeout: 120000 });
      await page.locator(`${sheet} [data-plan-card]`).first().waitFor({ timeout: 60000 });
      await page.waitForTimeout(800);
      const back = await look();
      check(`${name}: back from a cancelled Checkout, ${pick} is still the choice`, back.tiles.find((t) => t.on)?.slug === pick, back.tiles.find((t) => t.on)?.slug ?? "none");
    } else note(name, "no ?signup= in the address — the cancelled return was not tried");
  } catch (e) {
    check(`${name}: ran through`, false, String((e as Error)?.message || e).split("\n")[0]);
  } finally {
    await ctx.close();
  }
}

/** /dashboard/upgrade as qa@acme.test: the desk build at 1024 / 1440, the phone build at ≤768. */
let qaCookies: any[] | null = null;
async function upgrade(browser: any, widths = WIDTHS, cards = 3) {
  // One sign-in for the run (./_qa, on the first server): localhost's cookies hold on any port.
  if (!qaCookies) {
    const qa = req("./_qa.js");
    const signer = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const sp = await signer.newPage();
    await qa.signIn(sp);
    qaCookies = await signer.cookies();
    await signer.close();
  }
  const cookies = qaCookies;
  for (const width of widths) {
    const ctx = await visit(browser, width);
    await ctx.addCookies(cookies);
    const page = await ctx.newPage();
    try {
      await page.goto(BASE + "/dashboard/upgrade", { waitUntil: "domcontentloaded", timeout: 180000 });
      await page.locator("[data-plan-card]").first().waitFor({ timeout: 90000 });
      await page.waitForTimeout(2500);
      await surface(page, `/dashboard/upgrade @${width}`, "body", width <= 768, width === 1440);
      const n = await page.locator("[data-plan-card]").count();
      check(`/dashboard/upgrade @${width}: ${cards} cards`, n === cards, `${n}`);
      if (width === 1440) {
        const c = await page.evaluate(() => {
          const list = Array.from(document.querySelectorAll<HTMLElement>("[data-plan-card]")).map((x) => x.getBoundingClientRect());
          const rail = document.querySelector(".jf-up-plans")!.getBoundingClientRect();
          return Math.round(((Math.min(...list.map((r) => r.left)) + Math.max(...list.map((r) => r.right))) / 2 - (rail.left + rail.right) / 2) * 10) / 10;
        });
        check(`/dashboard/upgrade @${width}: the row is centred`, Math.abs(c) <= 1, `${c}px`);
      }
    } catch (e) {
      check(`/dashboard/upgrade @${width}: ran through`, false, String((e as Error)?.message || e).split("\n")[0]);
    } finally {
      await ctx.close();
    }
  }
}

/** Every sign-in page draws the product mark, never the old "J" square. */
async function authMarks(browser: any) {
  const PAGES: [string, number][] = [["/auth/register", 1440], ["/auth/register", 390], ["/auth/login", 1440], ["/auth/login", 390], ["/auth/forgot", 1440], ["/auth/reset?token=qa-none", 1440], ["/auth/invite/qa-none", 1440], ["/w/qa-none", 390], ["/mobile-v1/auth/login", 390]];
  for (const [path, width] of PAGES) {
    const ctx = await visit(browser, width);
    const page = await ctx.newPage();
    try {
      const res = await page.goto(BASE + path, { waitUntil: "load", timeout: 180000 });
      await page.waitForTimeout(1500);
      const m = await page.evaluate(() => ({
        old: document.querySelectorAll(".brand-mark").length,
        mark: Array.from(document.querySelectorAll<HTMLElement>(".jf-pmark")).filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); const img = e.querySelector("img") as HTMLImageElement | null; return { ink: Math.round((r.height - 1) * 10) / 10, link: !!e.closest('a[href="/"]'), loaded: !!img && img.complete && img.naturalWidth > 0 }; }),
      }));
      const shown = m.mark.length > 0;
      check(`${path} @${width}: no "J" square`, m.old === 0, `${m.old} .brand-mark (HTTP ${res?.status()})`);
      if (shown) check(`${path} @${width}: the product mark, linked home, loaded, 22–24px of ink`, m.mark.every((x: any) => x.link && x.loaded && x.ink >= 22 && x.ink <= 24), JSON.stringify(m.mark));
      else note(`${path} @${width}`, `no brand drawn in this state (HTTP ${res?.status()})`);
    } catch (e) {
      check(`${path} @${width}: ran through`, false, String((e as Error)?.message || e).split("\n")[0]);
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
      // QA_TERMS_TILES=3|4: only the phone's tiles, against QA_TERMS_URL (a server with or without the custom plan).
      if (process.env.QA_TERMS_TILES) {
        const cards = Number(process.env.QA_TERMS_TILES) || 3;
        for (const [w, h, k] of [[360, 640, 31], [390, 844, 32], [430, 932, 33]]) await phoneTiles(browser, w, h, k, cards);
        const wk = await pw.webkit.launch().catch(() => null);
        if (wk) {
          try {
            await phoneTiles(wk, 390, 844, 34, cards);
          } finally {
            await wk.close();
          }
        }
      } else {
      console.log("── landing #pricing and /pricing");
      await marketing(browser);
      console.log("── the signup plan step");
      await planStep(browser, 390, 1);
      await planStep(browser, 1440, 2);
      console.log("── the phone's plan step: tiles, the chosen plan, one pinned button");
      for (const [w, h, k] of [[360, 640, 11], [390, 844, 12], [430, 932, 13]]) await phoneTiles(browser, w, h, k);
      const wk = await pw.webkit.launch().catch(() => null);
      if (!wk) note("WebKit", "not installed (npx playwright install webkit) — the tiles ran in Chromium only");
      else {
        try {
          for (const [w, h, k] of [[360, 640, 14], [390, 844, 15]]) await phoneTiles(wk, w, h, k);
        } finally {
          await wk.close();
        }
      }
      console.log("── /dashboard/upgrade");
      await upgrade(browser);
      console.log("── the sign-in pages' mark");
      await authMarks(browser);
      // THE CUSTOM PLAN ON SALE: a second server with CUSTOM_PLAN_ENABLED=true (no .env edit).
      if (!process.env.QA_TERMS_URL) {
        console.log("── CUSTOM_PLAN_ENABLED=true");
        stopServer(server);
        server = await startServer(PORT + 1, { STRIPE_SECRET_KEY: "", RESEND_API_KEY: "", SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "", CUSTOM_PLAN_ENABLED: "true" }, "QA_TERMS_PORT");
        BASE = `http://localhost:${PORT + 1}`;
        await marketing(browser, [390, 1440], true);
        await planStep(browser, 1440, 3, 4);
        for (const [w, h, k] of [[360, 640, 21], [390, 844, 22], [430, 932, 23]]) await phoneTiles(browser, w, h, k, 4);
        await upgrade(browser, [390, 1440], 4);
      }
      }
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
