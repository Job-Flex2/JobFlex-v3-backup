// SUBSCRIPTION — BLUEPRINT · the ported <script>.
// Route: /dashboard/subscription (promoted 2026-08-12; ported at
// /dashboard/subscription-blueprint, which no longer exists).
//
// Every behavior the mockup's single <script> block owns, minus the pieces
// that belong to the app shell, with one teardown that removes every listener,
// cancels every rAF and disconnects every IntersectionObserver.
//
// PORTED HERE
//   · usage bar fill (`fill`)        — IntersectionObserver, 250ms, then width
//   · MOTION SYSTEM "BALANCED":      reveal cascade (scroll-velocity aware),
//                                    KPI count-up (`frame`), `pressify`
//
// The source's banner dismiss (`te`, the measured height collapse) left with
// the free-plan-limit banner when the Free tier was removed (2026-08-17).
//
// ADDED, NOT IN THE SOURCE
//   · in-page anchor scrolling — the source's hash links native-jump; under
//     the shell's `.main` scroller + sticky topbar + root zoom that lands
//     wrong, so the block below scrolls by hand. See its note.
//
// DISCARDED, BECAUSE THE SHELL ALREADY DOES IT — verified in
// blueprint-shell/shell-behavior.ts, not assumed:
//   · `moveIndicator` + the .sb-link click handlers  → shell (sliding plate)
//   · `drawer` / `close` + the injected .nav-backdrop → shell (#sbOverlay)
//   · the .sb-sec-label/.sb-link entry cascade        → shell, first load only
//   · the graph-paper `--gy` parallax on .main        → shell
//   · press feedback on .sb-foot-ic / .sb-foot-acc    → shell
//   · `fluidScale` — the shell runs the same 1728/0.78/1.35 curve, and better:
//     it writes `zoom` to the SHELL ROOT rather than document.documentElement
//     so it cannot leak into the rest of the app, adds a ≤860px reset to 1, and
//     publishes --app-h because 100vh drifts under zoom. Re-running the
//     source's copy would fight it. (src/components/v3/fluid-scale.tsx is the
//     standalone version of the same thing, for pages outside the shell.)
//
// NOT PORTED, BECAUSE IT HAS NOTHING TO ACT ON
//   · `animateRows` + its MutationObserver — it targets #weekList, #jobsList
//     and #actList, three dashboard lists that do not exist on this page. The
//     repo's shared replacement, blueprint-shell/list-motion.ts `staggerIn`,
//     is there if a list is ever added.
//   · the `window.matchMedia` polyfill shim — every browser Next supports has
//     matchMedia. The `safe()` idea it guarded is kept in spirit: each block
//     below is independent, so one failing cannot take the others down.
//
// REDUCED MOTION is honoured exactly as authored: the whole motion block
// returns early, and the usage bars fill instantly instead of animating.

import styles from "./subscription.module.css";

/** Selector for one of the module's hashed classes, by its SOURCE name. */
const c = (n: string) => "." + styles[n];

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function initSubscriptionContent(content: HTMLElement): () => void {
  const disposers: Array<() => void> = [];
  const on = (t: EventTarget, ev: string, fn: EventListener, o?: AddEventListenerOptions) => {
    t.addEventListener(ev, fn, o);
    disposers.push(() => t.removeEventListener(ev, fn, o));
  };
  const $ = (sel: string) => content.querySelector<HTMLElement>(sel);
  const $$ = (sel: string) => Array.from(content.querySelectorAll<HTMLElement>(sel));

  // ================= IN-PAGE ANCHORS =================
  // The page's hash links (Upgrade plan / Change plan; the source's third,
  // the banner's "See plans", left with the free-plan banner)
  // rely on native fragment navigation, and inside the shell that lands wrong
  // two ways: the scroll container is `.main` with a sticky 62px topbar the
  // browser doesn't offset for, and the shell scales its root with CSS `zoom`,
  // which throws native anchor math off entirely. So the clicks are
  // intercepted and the scroll is computed by hand against `.main`, zoom
  // compensated, with the topbar (plus the content gap) as headroom.
  (function () {
    const host = content.closest<HTMLElement>(".main");
    if (!host) return; // outside the shell — native behavior is correct

    // The travel is animated by hand rather than with native smooth scrolling,
    // for two reasons. Chrome's smooth scroll runs a fixed ~450ms regardless
    // of distance — over the ~2000px these anchors cover it reads as a jump
    // cut. And the reveal cascade means every below-the-fold block is parked
    // at opacity 0 until its IntersectionObserver fires, so the destination
    // faded in AFTER arrival — which is the "page just reloaded" impression.
    // So: park every still-hidden block in its final state first, then ease
    // the scroll over a distance-scaled duration.
    let rafId = 0;
    const stopScroll = () => cancelAnimationFrame(rafId);
    on(host, "wheel", stopScroll, { passive: true }); // the user's hand wins
    on(host, "touchstart", stopScroll, { passive: true });
    disposers.push(stopScroll);
    const animateTo = (to: number) => {
      stopScroll();
      const from = host.scrollTop;
      const dist = to - from;
      if (!dist) return;
      const dur = Math.min(900, Math.max(500, Math.abs(dist) * 0.35));
      let t0: number | null = null;
      const step = (t: number) => {
        if (t0 === null) t0 = t;
        const pr = Math.min(1, (t - t0) / dur);
        // easeInOutCubic — a gentle launch and a settled landing; the reveal
        // ease-out (0.22,0.61,0.36,1) is tuned for 420ms entrances, and over
        // 900ms of travel its long tail feels like the page stalling.
        const e = pr < 0.5 ? 4 * pr * pr * pr : 1 - Math.pow(-2 * pr + 2, 3) / 2;
        host.scrollTop = from + dist * e;
        if (pr < 1) rafId = requestAnimationFrame(step);
      };
      rafId = requestAnimationFrame(step);
    };

    $$('a[href^="#"]').forEach((a) => {
      const id = (a.getAttribute("href") || "").slice(1);
      if (!id) return;
      on(a, "click", (e) => {
        const target = $("#" + id);
        if (!target) return;
        e.preventDefault();
        // Reveal everything the cascade still holds hidden — instantly, not
        // animated, so the blocks scrolled past (and the destination itself)
        // are already painted. Done BEFORE measuring: `rv` carries a 14px
        // translateY that would skew the target's rect.
        $$(".rv:not(.rv-in), .rv-cell:not(.rv-in)").forEach((el) => {
          el.style.transitionDuration = "0ms";
          el.style.transitionDelay = "0ms";
          el.classList.add("rv-in");
        });
        // Both rects are in visual px scaled by the shell's zoom; scrollTop is
        // in local px — divide the delta by the effective factor to convert.
        const hostRect = host.getBoundingClientRect();
        const z = host.offsetWidth ? hostRect.width / host.offsetWidth : 1;
        const headroom = (host.querySelector<HTMLElement>(".topbar")?.offsetHeight ?? 0) + 22;
        const raw = host.scrollTop + (target.getBoundingClientRect().top - hostRect.top) / z - headroom;
        const top = Math.max(0, Math.min(raw, host.scrollHeight - host.clientHeight));
        if (reduced()) {
          host.scrollTop = top; // the accessibility commitment: no travel
        } else {
          animateTo(top);
        }
        // Keep the URL shareable without retriggering the native jump.
        history.replaceState(null, "", "#" + id);
      });
    });
  })();

  // ================= USAGE BARS =================
  // The widths live on data-w and are written to style.width, never to JSX, so
  // a later React render cannot undo them: React only touches attributes it
  // owns, and it never sets `style` on these spans.
  (function () {
    const list = $("#usList");
    if (!list) return;
    const fills = Array.from(list.querySelectorAll<HTMLElement>(c("us-fill")));
    const fill = () => {
      fills.forEach((f) => {
        f.style.width = f.dataset.w + "%";
      });
    };
    if (reduced()) {
      fill();
      return;
    }
    let timer = 0;
    const io = new IntersectionObserver(
      (es) => {
        es.forEach((e) => {
          if (e.isIntersecting) {
            timer = window.setTimeout(fill, 250);
            io.disconnect();
          }
        });
      },
      { threshold: 0.3 },
    );
    io.observe(list);
    disposers.push(() => {
      io.disconnect();
      window.clearTimeout(timer);
    });
  })();

  // ================= REDUCED MOTION — the source's own gap, closed =========
  // The markup carries `rv` (opacity 0, translateY(14px)) on all six blocks,
  // and the motion block below returns early under
  // `prefers-reduced-motion: reduce` — so opening the mockup with reduced
  // motion on gives you a BLANK PAGE: nothing ever adds `rv-in`. That is a bug
  // in the source, not a design decision, and DESIGN.md's standing
  // reduced-motion commitment makes shipping it not an option. Park those
  // blocks in their FINAL state instead: no animation runs, everything is
  // readable. Exactly the resolution manual-blueprint's use-reveal.ts uses.
  // Described, not silently "improved" — it is called out in the port report.
  if (reduced()) {
    const parked = $$(".rv");
    parked.forEach((el) => el.classList.add("rv-in"));
    disposers.push(() => parked.forEach((el) => el.classList.remove("rv-in")));
  }

  // ================= MOTION SYSTEM — BALANCED (пакет 02) =================
  (function () {
    if (reduced()) return;

    // Reveal: загрузка + скролл.
    // Reveal адаптируется к скорости скролла: медленный скролл — полная
    // анимация 420ms; быстрый — короткая (до 200ms): не отстаёт, но видима.
    // (Reveal adapts to scroll speed: slow scrolling gets the full 420ms;
    // fast scrolling gets a shorter one — it keeps up but stays visible.)
    const vpH = window.innerHeight;
    const scrollHost = content.closest<HTMLElement>(".main");
    let velLastY = scrollHost ? scrollHost.scrollTop : 0;
    let velLastT = performance.now();
    let scrollVel = 0; // px/ms
    if (scrollHost)
      on(
        scrollHost,
        "scroll",
        () => {
          const now = performance.now();
          scrollVel = Math.abs(scrollHost.scrollTop - velLastY) / Math.max(1, now - velLastT);
          velLastY = scrollHost.scrollTop;
          velLastT = now;
        },
        { passive: true },
      );

    // The source walks `.content > *`. Two of this page's `.content` children
    // are not blocks — the icon sprite (an out-of-flow SVGElement) and the
    // <noscript> — and including either would shift every stagger index after
    // it. `instanceof HTMLElement` drops the sprite; the tag check drops the
    // noscript.
    const blocks = Array.from(content.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el.tagName !== "NOSCRIPT",
    );
    blocks.forEach((el, i) => {
      el.classList.add("rv");
      const initial = el.getBoundingClientRect().top < vpH;
      if (!initial) el.dataset.rvScroll = "1";
      el.style.transitionDelay = initial ? i * 60 + "ms" : "200ms";
    });
    const cells = $$(c("kpi"));
    cells.forEach((el, i) => {
      el.classList.add("rv-cell");
      const initial = el.getBoundingClientRect().top < vpH;
      if (!initial) el.dataset.rvScroll = "1";
      el.style.transitionDelay = initial ? 160 + (i % 8) * 45 + "ms" : "200ms";
    });
    const io = new IntersectionObserver(
      (es) => {
        es.forEach((en) => {
          if (!en.isIntersecting) return;
          const target = en.target as HTMLElement;
          if (target.dataset.rvScroll) {
            // элемент ниже фолда: длительность по текущей скорости скролла
            // (below the fold: duration follows the current scroll speed)
            const dur = Math.round(Math.max(550, 900 - scrollVel * 160));
            target.style.transitionDuration = dur + "ms";
          }
          target.classList.add("rv-in");
          io.unobserve(target);
          const te = () => {
            target.style.transitionDelay = "";
            target.style.transitionDuration = "";
            target.removeEventListener("transitionend", te);
          };
          target.addEventListener("transitionend", te);
        });
      },
      { threshold: 0, rootMargin: "0px 0px 60px 0px" },
    );
    blocks.concat(cells).forEach((el) => io.observe(el));
    disposers.push(() => {
      io.disconnect();
      blocks.concat(cells).forEach((el) => {
        el.classList.remove("rv", "rv-in", "rv-cell");
        delete el.dataset.rvScroll;
        el.style.transitionDelay = "";
        el.style.transitionDuration = "";
      });
    });

    // (Каскад сайдбара и параллакс миллиметровки живут в шелле.)
    // (The sidebar cascade and the graph-paper parallax live in the shell.)

    // Каунт-ап KPI — the three Refer & earn figures.
    const rafs: number[] = [];
    $$(c("kpi-val")).forEach((el) => {
      const raw = (el.textContent || "").trim();
      const money = raw.charAt(0) === "$";
      const target = parseInt(raw.replace(/[^0-9]/g, ""), 10);
      if (!isFinite(target)) return;
      let t0: number | null = null;
      const frame = (t: number) => {
        if (!t0) t0 = t;
        const pr = Math.min(1, (t - t0) / 750);
        const e = 1 - Math.pow(1 - pr, 3);
        // toLocaleString is client-only by construction — this whole module
        // runs from a layout effect — so it cannot cause a hydration mismatch.
        el.textContent = (money ? "$" : "") + Math.round(target * e).toLocaleString("en-US");
        if (pr < 1) rafs.push(requestAnimationFrame(frame));
      };
      rafs.push(requestAnimationFrame(frame));
      disposers.push(() => {
        el.textContent = raw;
      });
    });
    disposers.push(() => rafs.forEach((r) => cancelAnimationFrame(r)));

    // Пресс-эффекты (press feedback).
    function pressify(sel: string, cls: string) {
      on(content, "click", (e) => {
        const el = (e.target as Element).closest<HTMLElement>(sel);
        if (!el || !content.contains(el)) return;
        el.classList.remove(cls);
        void el.offsetWidth;
        el.classList.add(cls);
      });
      on(content, "animationend", (e) => {
        const el = e.target as HTMLElement;
        if (el.matches && el.matches(sel)) el.classList.remove(cls);
      });
    }
    pressify(
      [c("btn"), c("icon-btn"), c("card-foot-btn"), c("dd-item")].join(", "),
      styles["pressed"],
    );
    pressify(c("week-strip") + " " + c("day"), styles["day-pressed"]);
  })();

  return () => disposers.forEach((d) => d());
}
