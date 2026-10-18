// THE PAGE'S OWN CLOCK (2026-10-17). The form's "ready after" and the landing's timing were read straight off
// performance.now(), which counts from the document's load — not from the page — and keeps counting while the tab is
// hidden. A visitor who went register → logo → landing, stayed 20 minutes and pressed Back was reported as "The form
// was slow to start — ready after 1364.6 s" when the form came alive in 23 ms: the document was 22 minutes old.
//
// Two rules, one clock:
//   - a page's numbers are measured once, by the page the document was loaded on. Each such page writes this inline
//     script into its HTML; React never runs an inline script it draws on a client-side arrival, so a page reached by
//     a <Link> or Back finds a clock that is not its own (or already claimed) and sends nothing;
//   - the time the tab was hidden is not the page's time. The script notes every hidden span from the start; a
//     document that opens hidden (a background tab) counts from the moment it is first shown.

interface PageClock {
  /** The page the document was loaded on (the key its inline script was written with). */
  page: string;
  /** performance.now() as the script ran. */
  t0: number;
  /** The hidden spans so far, [from, to] on the performance.now() scale. */
  spans: Array<[number, number]>;
  /** When the tab went hidden, -1 while it is shown. */
  since: number;
  /** The page's first measurement has been taken. */
  claimed: boolean;
}

/** The inline script for a page's HTML, ahead of anything it measures. Plain ES5: it runs before any bundle. */
export function pageClockScript(page: string): string {
  return `(function(){var w=window,d=document,p=performance;if(w.__jfClock)return;var c={page:${JSON.stringify(page)},t0:Math.round(p.now()),spans:[],since:d.visibilityState==="hidden"?0:-1,claimed:false};w.__jfClock=c;d.addEventListener("visibilitychange",function(){var t=p.now();if(d.visibilityState==="hidden"){if(c.since<0)c.since=t;}else if(c.since>=0){c.spans.push([c.since,t]);c.since=-1;}});})();`;
}

function clock(): PageClock | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { __jfClock?: PageClock }).__jfClock ?? null;
}

/** How much of the time from the load to `at` the tab was hidden (ms, performance.now() scale). */
export function hiddenBefore(at: number = performance.now()): number {
  const c = clock();
  if (!c) return 0;
  let ms = 0;
  for (const [from, to] of c.spans) ms += Math.max(0, Math.min(to, at) - from);
  if (c.since >= 0 && at > c.since) ms += at - c.since;
  return ms;
}

/** A moment on the performance.now() scale as visible time since the load: the hidden spans before it taken out. */
export function visibleAt(at: number = performance.now()): number {
  return Math.max(0, Math.round(at - hiddenBefore(at)));
}

/**
 * True once per document, and only for the page it was loaded on: the first measurement after a real load. A page
 * reached without a reload (a <Link>, Back) gets false — its document's clock started on another page or long ago.
 */
export function claimPageLoad(page: string): boolean {
  const c = clock();
  if (!c || c.page !== page || c.claimed) return false;
  c.claimed = true;
  return true;
}
