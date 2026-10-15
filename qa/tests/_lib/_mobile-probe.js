// THE MOBILE SWEEP'S PROBES (2026-10-04) — shared by qa/tests/visual/mobile-sweep.check.ts and the
// full harness in .cache/mobile-sweep. In-page probes are strings evaluated in the page:
//   PAGE    → top bar, sideways overflow, root zoom, the bottom bars and the end of the content
//             after a full scroll of the page's own scroller
//   MARK    → tags every overlay-like box visible now, so OVERLAY can tell the one a click opened
//   OVERLAY → that surface: its box, its foot buttons, its scroller taken to the end
//   PRINT   → what is on screen, for dev ↔ prod
// and the judges: judge(PAGE result), judgeOverlay(OVERLAY result), diffPrint(dev, prod).
"use strict";

const COMMON = String.raw`
const W = innerWidth, H = innerHeight;
const vis = (e) => { if (!e || !e.getBoundingClientRect) return false; const shut = e.closest && e.closest("details:not([open])"); if (shut && !e.closest("summary") && e !== shut) return false; const cs = getComputedStyle(e); if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity < 0.05) return false; const b = e.getBoundingClientRect(); return b.width > 2 && b.height > 2; };
const rect = (e) => { const b = e.getBoundingClientRect(); return { t: Math.round(b.top * 10) / 10, b: Math.round(b.bottom * 10) / 10, l: Math.round(b.left * 10) / 10, r: Math.round(b.right * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 }; };
const label = (e) => (e.getAttribute("aria-label") || e.textContent || e.getAttribute("placeholder") || e.value || "").replace(/\s+/g, " ").trim().slice(0, 32);
const name = (e) => { const c = String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className || "").split(/\s+/).filter(Boolean).map((x) => x.replace(/^.*?__([A-Za-z0-9-]+)__.*$/, "$1").replace(/^.*?_([A-Za-z]+)__.*$/, "$1")).slice(0, 2).join("."); return e.tagName.toLowerCase() + (c ? "." + c : "") + (e.id ? "#" + e.id : ""); };
const posOf = (e) => getComputedStyle(e).position;
// The rules that set prop on el, by value — so a cut bar can be traced to the vh / dvh / % that sized it.
const declared = (el, props) => {
  const out = [];
  const walk = (rules) => { for (const r of rules) { try {
    if (r.cssRules && !r.selectorText) { if (!r.media || matchMedia(r.media.mediaText).matches) walk(r.cssRules); continue; }
    if (!r.selectorText || !el.matches(r.selectorText)) continue;
    for (const p of props) { const v = r.style.getPropertyValue(p); if (v) out.push(p + ": " + v); }
  } catch (_) {} } };
  for (const s of document.styleSheets) { try { walk(s.cssRules); } catch (_) {} }
  for (const p of props) { const v = el.style.getPropertyValue(p); if (v) out.push(p + ": " + v + " (inline)"); }
  return [...new Set(out)];
};
// The fixed ancestor a box hangs from, and how it is sized.
const frameOf = (el) => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const p = posOf(e); if (p === "fixed") return e; } return null; };
const clippedOut = (e) => { const b = e.getBoundingClientRect(); for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.overflowX !== "visible" || cs.overflowY !== "visible") { const r = a.getBoundingClientRect(); if (b.bottom <= r.top + 1 || b.top >= r.bottom - 1 || b.right <= r.left + 1 || b.left >= r.right - 1) return true; if (/(auto|scroll)/.test(cs.overflowX) && (b.right > r.right + 1 || b.left < r.left - 1)) return true; } if (cs.position === "fixed") break; } return false; };
const isOverlay = (e) => !!e.closest('[role=dialog], dialog, [aria-modal="true"], [role=menu], [role=listbox], [data-sweep-overlay]');
const leaves = (root, skip) => [...root.querySelectorAll("button, a, input, textarea, select, img, svg, p, span, label, li, td, th, h1, h2, h3, h4, small, b, strong, em, dd, dt, div")].filter((e) => {
  if (!vis(e) || (e.children.length && e.tagName !== "BUTTON" && e.tagName !== "A" && e.tagName !== "svg")) return false;
  if (e.closest("svg") && e.tagName !== "svg") return false;
  if (e.closest("[aria-hidden=true]")) return false;
  if (skip && skip(e)) return false;
  return !clippedOut(e);
});
const zooms = () => { const z = []; for (const e of [document.documentElement, document.body, ...document.querySelectorAll("body > *, body > * > *, [class*=frame], [class*=app], .bp, .jf-blueprint")]) { const v = parseFloat(getComputedStyle(e).zoom || "1"); if (v && Math.abs(v - 1) > 0.001) z.push(name(e) + " zoom " + v); } return [...new Set(z)].slice(0, 4); };
const mainScroller = () => {
  const c = [...document.querySelectorAll("body *")].filter((e) => { const cs = getComputedStyle(e); return /(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 2 && e.clientHeight > H * 0.4 && vis(e) && !isOverlay(e); });
  return c.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] || null;
};
`;

const PAGE = String.raw`(async () => {
${COMMON}
const out = { url: location.pathname + location.search, W, H, title: document.title.slice(0, 40) };
out.zoom = zooms();
// TOP BAR — the app's: data-mnav (handheld fleet) or the desk shell's .topbar; any other header is reported, not judged.
const bar = [...document.querySelectorAll("header, .topbar, [class*=topbar], [class*=tbar], nav")].filter(vis).map((e) => [e, e.getBoundingClientRect()]).filter(([, b]) => b.top < 3 && b.top > -3 && b.width >= W - 2 && b.height >= 40 && b.height <= 110).map(([e]) => e)[0] || null;
if (bar) {
  const btns = [...bar.querySelectorAll("button, a")].filter((b) => vis(b) && b.getBoundingClientRect().width >= 24 && b.getBoundingClientRect().height >= 24);
  const xs = btns.map((b) => b.getBoundingClientRect());
  const badges = [...bar.querySelectorAll("span, b, i, em, small, sup")].filter((s) => vis(s) && /^\d{1,3}\+?$/.test(s.textContent.trim()) && s.getBoundingClientRect().width < 30);
  out.topbar = { el: name(bar), app: bar.matches("[data-mnav], .topbar") || !!bar.closest("[data-mnav]"), h: Math.round(bar.getBoundingClientRect().height),
    left: xs.length ? Math.round(Math.min(...xs.map((b) => b.left)) * 10) / 10 : null, right: xs.length ? Math.round((W - Math.max(...xs.map((b) => b.right))) * 10) / 10 : null,
    small: btns.filter((b) => b.getBoundingClientRect().height < 44 || b.getBoundingClientRect().width < 44).map((b) => label(b) + " " + Math.round(b.getBoundingClientRect().width) + "×" + Math.round(b.getBoundingClientRect().height)).slice(0, 4),
    badges: badges.map((s) => { const host = s.closest("button, a"); const r = s.getBoundingClientRect(), h = host ? host.getBoundingClientRect() : null; return { text: s.textContent.trim(), inside: !!h && r.left >= h.left - 0.5 && r.right <= h.right + 0.5 && r.top >= h.top - 0.5 && r.bottom <= h.bottom + 0.5, r: rect(s), host: h ? rect(host) : null }; }) };
}
// FULL SCROLL — the main scroller or the document, twice (lazy content grows the end).
const sc = mainScroller();
out.scroller = sc ? name(sc) + " " + Math.round(sc.clientHeight) + "/" + sc.scrollHeight : "document " + document.scrollingElement.scrollHeight;
for (let i = 0; i < 3; i++) { if (sc) sc.scrollTop = sc.scrollHeight; window.scrollTo(0, document.scrollingElement.scrollHeight); await new Promise((r) => setTimeout(r, 350)); }
// SIDEWAYS
const sw = document.scrollingElement.scrollWidth;
out.hscroll = Math.max(0, sw - W, document.body.scrollWidth - W);
out.wide = [...document.querySelectorAll("body *")].filter((e) => vis(e) && !isOverlay(e) && e.getBoundingClientRect().right > W + 1.5 && e.getBoundingClientRect().left < W && !clippedOut(e) && posOf(e) !== "fixed" && !(e.closest('[data-mnav], .sb, aside')) ).map((e) => name(e) + " →" + Math.round(e.getBoundingClientRect().right)).filter((x, i, a) => a.indexOf(x) === i).slice(0, 4);
// BOTTOM BARS — pinned (fixed / sticky), full-width-ish, resting on or below the bottom edge.
const bars = [...document.querySelectorAll("body *")].filter((e) => { if (!vis(e) || isOverlay(e) || e.closest("[data-mnav], .sb")) return false; const p = posOf(e); if (p !== "fixed" && p !== "sticky") return false; const b = e.getBoundingClientRect(); return b.width >= W * 0.8 && b.height >= 28 && b.height <= 260 && b.bottom >= H - 2 && b.top < H + 260 && b.top > H * 0.4; })
  .filter((e, _, all) => !all.some((o) => o !== e && o.contains(e)));
out.bars = bars.map((e) => { const b = e.getBoundingClientRect(); const fr = frameOf(e);
  return { el: name(e), pos: posOf(e), top: Math.round(b.top), bottom: Math.round(b.bottom), cut: b.bottom > H + 0.5 && b.top < H - 1, parked: b.top >= H - 1,
    btns: [...e.querySelectorAll("button, a")].filter(vis).map((x) => { const r = x.getBoundingClientRect(); return { l: label(x), b: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) }; }).slice(0, 6),
    safe: declared(e, ["padding-bottom", "bottom", "padding"]).filter((v) => /safe|--safe/.test(v)).length > 0,
    sized: fr ? declared(fr, ["height", "max-height", "min-height"]).slice(0, 3) : [] }; });
const barTop = bars.length ? Math.min(...bars.map((e) => e.getBoundingClientRect().top)) : H;
const top = bar ? bar.getBoundingClientRect().bottom : 0;
const ls = leaves(document.body, (e) => bars.some((b) => b.contains(e)) || (bar && bar.contains(e)) || isOverlay(e) || posOf(e) === "fixed" || !!e.closest("[data-mnav], .sb, aside, [class*=support], [class*=Support], .jflp, [class*=cookie], [data-consent]") || frameOf(e) && frameOf(e) !== (sc && frameOf(sc)) && !(sc && sc.contains(e)));
const low = ls.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
if (low) { const b = low.getBoundingClientRect(); out.contentEnd = { el: name(low), text: label(low), bottom: Math.round(b.bottom), limit: Math.round(barTop), under: Math.round(b.bottom - barTop) }; }
return out;
})()`;

// Marks every overlay-like box visible now, so the one a click opens can be told apart.
const MARK = String.raw`(() => { ${COMMON}
  let n = 0; for (const e of document.querySelectorAll("body *")) { if (!vis(e)) continue; const p = posOf(e); if ((p === "fixed" || p === "absolute") && e.getBoundingClientRect().height > 80) { e.setAttribute("data-sweep-was", "1"); n++; } }
  return n; })()`;

const OVERLAY = String.raw`(async () => {
${COMMON}
// The surface the click opened: a modal dialog, a menu / listbox, or a fixed / absolute box that was not visible before.
let cand = [...document.querySelectorAll('[role=dialog], dialog[open], [aria-modal="true"], [role=menu], [role=listbox]')].filter((d) => vis(d) && d.getAttribute("aria-hidden") !== "true");
if (!cand.length) cand = [...document.querySelectorAll("body *")].filter((e) => { if (!vis(e) || e.hasAttribute("data-sweep-was")) return false; const p = posOf(e); const b = e.getBoundingClientRect(); return (p === "fixed" || p === "absolute") && b.height > 80 && b.width > 160 && b.bottom > 0 && b.top < H; }).filter((e, _, all) => !all.some((o) => o !== e && o.contains(e) && !o.hasAttribute("data-sweep-was")));
if (!cand.length) return { none: true };
let dlg = cand.sort((a, b) => (parseInt(getComputedStyle(b).zIndex) || 0) - (parseInt(getComputedStyle(a).zIndex) || 0) || b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
dlg.setAttribute("data-sweep-overlay", "1");
// A full-screen layer → its panel is the biggest child that is not a backdrop.
let panel = dlg;
const fullScreen = (e) => { const b = e.getBoundingClientRect(); return b.height >= H - 2 && b.top <= 1 && b.width >= W - 2; };
for (let i = 0; i < 4 && fullScreen(panel); i++) { const kids = [...panel.children].filter(vis).filter((k) => !/rgba\(.*, 0\.[0-9]+\)/.test(getComputedStyle(k).backgroundColor) || k.children.length > 0); const kid = kids.sort((a, b) => b.querySelectorAll("*").length - a.querySelectorAll("*").length)[0]; if (!kid) break; panel = kid; }
// A menu that opens in the page's flow (absolute under its trigger) is reached the way a person
// reaches it: by scrolling the page. Scroll its nearest scrolling ancestor until its end shows,
// as far as that ancestor can go; only what is still off screen after that is cut.
if (posOf(panel) !== "fixed" && !frameOf(panel)?.isSameNode(panel)) {
  for (let a = panel.parentElement; a && a !== document.documentElement; a = a.parentElement) {
    const cs = getComputedStyle(a);
    if (cs.position === "fixed" && !/(auto|scroll)/.test(cs.overflowY)) break;
    const scrolls = a === document.body ? document.scrollingElement : (/(auto|scroll)/.test(cs.overflowY) ? a : null);
    if (!scrolls) continue;
    const over = panel.getBoundingClientRect().bottom - H + 8;
    if (over > 0) { scrolls.scrollTop += over; await new Promise((r) => setTimeout(r, 200)); }
    break;
  }
}
const modal = !!(dlg.matches('[role=dialog], dialog, [aria-modal="true"]') || dlg.querySelector('[role=dialog], [aria-modal="true"]'));
const pb = panel.getBoundingClientRect();
const scrollers = [panel, ...panel.querySelectorAll("*")].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && vis(e) && e.clientHeight > 30);
const sc = scrollers.filter((e) => e.scrollHeight > e.clientHeight + 2).sort((a, b) => b.clientHeight - a.clientHeight)[0] || null;
const fields = [...panel.querySelectorAll("input:not([type=hidden]):not([type=file]), textarea, select, button")].filter(vis);
const pinned = [...panel.querySelectorAll("button, a[role=button], input[type=submit], a[class*=btn]")].filter((b) => vis(b) && !(sc && sc !== panel && sc.contains(b)) && b.getBoundingClientRect().top > pb.top + pb.height * 0.5);
let end = null;
if (sc) {
  for (let i = 0; i < 3; i++) { sc.scrollTop = sc.scrollHeight; await new Promise((r) => setTimeout(r, 150)); }
  const sb = sc.getBoundingClientRect();
  const inside = leaves(sc).filter((e) => !pinned.some((p) => p.contains(e)));
  const last = inside.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
  end = { atEnd: Math.abs(sc.scrollTop + sc.clientHeight - sc.scrollHeight) <= 2, scBottom: Math.round(Math.min(sb.bottom, H)), last: last ? label(last) || name(last) : "", lastBottom: last ? Math.round(last.getBoundingClientRect().bottom) : null };
}
const all = leaves(panel).filter((e) => !(sc && sc.contains(e)));
const spill = all.length ? Math.round(Math.max(...all.map((e) => e.getBoundingClientRect().bottom))) : Math.round(pb.bottom);
const fr = frameOf(panel);
return { label: (dlg.getAttribute("aria-label") || (dlg.getAttribute("aria-labelledby") && document.getElementById(dlg.getAttribute("aria-labelledby"))?.textContent) || label(panel)).trim().slice(0, 34), el: name(panel), pos: posOf(panel), modal,
  top: Math.round(pb.top), bottom: Math.round(pb.bottom), right: Math.round(pb.right), left: Math.round(pb.left), H, W, fields: fields.length,
  scroller: sc ? name(sc) : null, end, spill,
  pinned: pinned.map((b) => { const r = b.getBoundingClientRect(); return { l: label(b), t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) }; }),
  sized: [...new Set([...declared(panel, ["height", "max-height", "bottom", "top"]), ...(fr && fr !== panel ? declared(fr, ["height", "max-height"]).map((v) => "frame " + v) : [])])].slice(0, 5),
  safe: [panel, ...panel.querySelectorAll("*")].some((e) => declared(e, ["padding-bottom", "padding", "bottom", "margin-bottom"]).some((v) => /safe|--safe/.test(v))),
  zoom: zooms() };
})()`;

// What is on screen, for dev ↔ prod: the visible controls and headings with their boxes, and the
// computed geometry of the top bar, the scroller and the bottom bars.
const PRINT = String.raw`(async () => {
${COMMON}
const take = () => [...document.querySelectorAll("button, a, input, select, textarea, h1, h2, h3, [role=tab], header, nav, [data-mnav]")].filter(vis).filter((e) => { const b = e.getBoundingClientRect(); return b.bottom > 0 && b.top < H; }).slice(0, 80).map((e) => [e.tagName.toLowerCase() + ":" + label(e), rect(e)]);
const geo = (e) => { if (!e) return null; const cs = getComputedStyle(e); return { r: rect(e), pos: cs.position, pad: cs.padding, mar: cs.margin, gap: cs.gap, fs: cs.fontSize, lh: cs.lineHeight, h: cs.height, mh: cs.maxHeight, ov: cs.overflowY, z: cs.zoom }; };
const bar = [...document.querySelectorAll("header, .topbar, [class*=topbar], [class*=tbar]")].filter(vis).find((e) => e.getBoundingClientRect().top < 3 && e.getBoundingClientRect().width >= W - 2);
const sc = mainScroller();
const top = take();
for (let i = 0; i < 2; i++) { if (sc) sc.scrollTop = sc.scrollHeight; window.scrollTo(0, document.scrollingElement.scrollHeight); await new Promise((r) => setTimeout(r, 300)); }
return { top, end: take(), topbar: geo(bar), topbarKids: bar ? [...bar.querySelectorAll("button, a")].filter(vis).map(geo) : [], scroller: geo(sc) };
})()`;

function judge(p) {
  const issues = [];
  if (p.hscroll > 1) issues.push({ el: "page", what: `scrolls sideways by ${p.hscroll}px${p.wide.length ? " (" + p.wide.join(", ") + ")" : ""}`, why: "overflow" });
  if (p.zoom.length) issues.push({ el: "root", what: p.zoom.join("; "), why: "zoom" });
  if (p.topbar && p.topbar.app) {
    if (p.topbar.left !== null && Math.abs(p.topbar.left - 12) > 0.6) issues.push({ el: "topbar " + p.topbar.el, what: `left edge ${p.topbar.left}px, not 12`, why: "topbar" });
    if (p.topbar.right !== null && Math.abs(p.topbar.right - 12) > 0.6) issues.push({ el: "topbar " + p.topbar.el, what: `right edge ${p.topbar.right}px, not 12`, why: "topbar" });
    for (const b of p.topbar.badges) if (!b.inside) issues.push({ el: "topbar badge " + b.text, what: "hangs outside its button", why: "topbar" });
    if (p.topbar.small.length) issues.push({ el: "topbar", what: "under 44px: " + p.topbar.small.join(", "), why: "tap" });
  }
  for (const b of p.bars) {
    if (b.cut) issues.push({ el: "bar " + b.el, what: `bottom ${b.bottom} below the screen (${p.H})`, why: b.sized.some((s) => /vh|dvh/.test(s)) ? "vh" : "height" , note: b.sized.join("; ") });
    if (b.parked) continue;
    for (const x of b.btns) if (x.b > p.H + 0.5) issues.push({ el: "bar button " + x.l, what: `bottom ${x.b} below the screen`, why: "cut" });
    const small = b.btns.filter((x) => x.h < 44 && x.w >= 24);
    if (small.length) issues.push({ el: "bar " + b.el, what: "under 44px: " + small.map((x) => `${x.l} ${x.w}×${x.h}`).join(", "), why: "tap" });
    if (!b.safe && b.pos === "fixed") issues.push({ el: "bar " + b.el, what: "no safe-area-inset-bottom", why: "safe-area", soft: true });
  }
  if (p.contentEnd && p.contentEnd.under > 1) issues.push({ el: "content end " + p.contentEnd.el + (p.contentEnd.text ? ` “${p.contentEnd.text}”` : ""), what: `ends at ${p.contentEnd.bottom}, ${p.contentEnd.under}px under ${p.bars.length ? "the bottom bar" : "the screen"} at full scroll`, why: p.bars.length ? "bar padding" : "height" });
  return issues;
}

function judgeOverlay(o) {
  const issues = [];
  if (o.top < -1) issues.push({ what: `top ${o.top} above the screen`, why: "height", note: o.sized.join("; ") });
  if (o.bottom > o.H + 1) issues.push({ what: `bottom ${o.bottom} below the screen (${o.H})`, why: o.sized.some((s) => /vh|dvh/.test(s)) ? "vh" : "height", note: o.sized.join("; ") });
  if (o.right > o.W + 1 || o.left < -1) issues.push({ what: `sideways ${o.left}..${o.right}`, why: "overflow" });
  for (const b of o.pinned) { if (b.b > o.H + 0.5) issues.push({ what: `“${b.l}” bottom ${b.b} below the screen`, why: "cut", note: o.sized.join("; ") }); if (o.modal && b.h < 44 && b.w >= 24 && b.t > o.top + (o.bottom - o.top) * 0.6) issues.push({ what: `“${b.l}” ${b.w}×${b.h}, under 44`, why: "tap" }); }
  if (o.end && !o.end.atEnd) issues.push({ what: "the body does not scroll to its end", why: "height" });
  if (o.end && o.end.lastBottom !== null && o.end.lastBottom > o.end.scBottom + 1) issues.push({ what: `last field “${o.end.last}” ends ${o.end.lastBottom - o.end.scBottom}px under the body's edge`, why: "height" });
  if (!o.scroller && o.spill > o.H + 1) issues.push({ what: `content to ${o.spill} with nothing to scroll it`, why: "height", note: o.sized.join("; ") });
  if (o.zoom.length) issues.push({ what: o.zoom.join("; "), why: "zoom" });
  if (!o.safe && o.bottom >= o.H - 2 && o.pos !== "static" && o.pinned.length) issues.push({ what: "no safe-area-inset-bottom under its foot", why: "safe-area", soft: true });
  return issues;
}

function diffPrint(a, b) {
  const out = [];
  const near = (x, y) => Math.abs(x - y) <= 1.5;
  for (const k of ["top", "end"]) {
    const used = new Set();
    for (const [key, r] of a[k]) {
      const j = b[k].findIndex(([k2], i) => !used.has(i) && k2 === key);
      if (j < 0) { out.push(`${k}: “${key}” on dev only`); continue; }
      used.add(j); const r2 = b[k][j][1];
      // At the end of a scroll a lazy image or a late list moves everything by the same amount; there only
      // the boxes' own size and left edge are compared — the cause above is reported in `top`.
      if ((k === "top" && !near(r.t, r2.t)) || !near(r.l, r2.l) || !near(r.w, r2.w) || !near(r.h, r2.h)) out.push(`${k}: “${key}” dev ${r.l},${r.t} ${r.w}×${r.h} → prod ${r2.l},${r2.t} ${r2.w}×${r2.h}`);
    }
    b[k].forEach(([key], i) => { if (!used.has(i)) out.push(`${k}: “${key}” on prod only`); });
  }
  for (const k of ["topbar", "scroller"]) {
    const x = a[k], y = b[k]; if (!x && !y) continue; if (!x || !y) { out.push(`${k}: ${x ? "dev" : "prod"} only`); continue; }
    for (const p of ["pos", "pad", "mar", "gap", "fs", "h", "mh", "ov", "z"]) if (x[p] !== y[p] && !(p === "h" && Math.abs(parseFloat(x[p]) - parseFloat(y[p])) <= 1.5)) out.push(`${k} ${p}: dev ${x[p]} → prod ${y[p]}`);
  }
  (a.topbarKids || []).forEach((x, i) => { const y = (b.topbarKids || [])[i]; if (!y) return; for (const p of ["pad", "mar", "fs", "h"]) if (x[p] !== y[p]) out.push(`topbar control ${i + 1} ${p}: dev ${x[p]} → prod ${y[p]}`); });
  return out;
}

/** A page ready to be measured: its shell drawn (the handheld switch loads a chunk after
 *  hydration), fonts in, finite animations over, and the same controls and height for 2 s. */
async function settle(page, { first = 0, timeout = 30000 } = {}) {
  if (first) await new Promise((r) => setTimeout(r, first));
  await page.waitForFunction(() => document.querySelector("[data-mnav], header, h1, main, form"), null, { timeout }).catch(() => {});
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await page.waitForFunction(() => !document.getAnimations || document.getAnimations().every((a) => a.playState !== "running" || (a.effect && a.effect.getTiming && a.effect.getTiming().iterations === Infinity)), null, { timeout: 10000, polling: 200 }).catch(() => {});
  await page.waitForFunction(() => { const w = window; const n = document.querySelectorAll("button, a, h1, h2, input").length + ":" + document.body.scrollHeight + ":" + (document.querySelector("[data-mnav], header")?.getBoundingClientRect().height || 0); if (w.__settleN === n) w.__settleK = (w.__settleK || 0) + 1; else { w.__settleN = n; w.__settleK = 0; } return w.__settleK >= 8; }, null, { polling: 250, timeout }).catch(() => {});
  for (const sel of ['[data-consent="accept-all"]', '[data-consent="got-it"]']) { const b = page.locator(sel).first(); if (await b.count().catch(() => 0)) await b.click({ timeout: 1500 }).catch(() => {}); }
}

module.exports = { PAGE, MARK, OVERLAY, PRINT, judge, judgeOverlay, diffPrint, settle };
