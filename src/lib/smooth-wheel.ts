/** Wheel easing for the three owner-selected workspaces. Touch and keyboard stay native. */
export function createWheelMotion(read: () => number, write: (value: number) => void, maximum: () => number, tokens: Element, onActivity?: (active: boolean) => void) {
  const style = getComputedStyle(tokens);
  const scale = Number.parseFloat(style.getPropertyValue("--scroll-wheel-scale")) || 0.65;
  const settle = Number.parseFloat(style.getPropertyValue("--scroll-wheel-settle")) || 110;
  // Scroll positions quantize to physical pixels inside the shell's CSS zoom.
  const zoom = Number.parseFloat(getComputedStyle(tokens.closest(".jf-blueprint") ?? tokens).zoom) || 1;
  const epsilon = 1.5 / zoom;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let raf = 0;
  let target = 0;
  let position = 0;
  let previous = 0;
  const clamp = (value: number) => Math.max(0, Math.min(maximum(), value));
  const stop = () => { const active = !!raf; cancelAnimationFrame(raf); raf = 0; if (active) onActivity?.(false); };
  const frame = (now: number) => {
    const value = position;
    target = clamp(target);
    const next = value + (target - value) * (1 - Math.exp(-Math.min(64, now - previous) / settle));
    previous = now;
    if (Math.abs(target - next) < epsilon) { position = target; write(target); raf = 0; onActivity?.(false); return; }
    position = next;
    write(next);
    raf = requestAnimationFrame(frame);
  };
  return {
    stop,
    move(delta: number) {
      if (!raf) target = position = read();
      target = clamp(target + delta * scale);
      if (reduced.matches) { stop(); write(target); return; }
      if (!raf) { onActivity?.(true); previous = performance.now(); raf = requestAnimationFrame(frame); }
    },
  };
}

export function wheelPixels(event: WheelEvent, pageHeight: number) {
  return event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight : 1);
}

/** Find the real scroller under the pointer, including nested lists and mobile frames. */
export function bindSmoothWheel(root: Document) {
  const motions = new Map<HTMLElement, ReturnType<typeof createWheelMotion>>();
  const stop = () => motions.forEach((motion) => motion.stop());
  const onWheel = (event: WheelEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('textarea, select, [contenteditable="true"], input[type="range"], input[type="number"], [data-native-scroll]')) return;
    let box = target instanceof HTMLElement ? target : target?.parentElement;
    while (box) {
      const limit = box.scrollHeight - box.clientHeight;
      if (limit > 1 && /(auto|scroll)/.test(getComputedStyle(box).overflowY) && (event.deltaY > 0 ? box.scrollTop < limit - 1 : box.scrollTop > 0)) break;
      box = box.parentElement;
    }
    if (!box) {
      const documentBox = document.scrollingElement as HTMLElement | null;
      if (!documentBox || documentBox.scrollHeight <= documentBox.clientHeight) return;
      box = documentBox;
    }
    const scroller = box;
    let motion = motions.get(scroller);
    if (!motion) {
      motion = createWheelMotion(() => scroller.scrollTop, (value) => { scroller.scrollTop = value; }, () => scroller.scrollHeight - scroller.clientHeight, scroller);
      motions.set(scroller, motion);
    }
    event.preventDefault();
    motion.move(wheelPixels(event, scroller.clientHeight));
  };
  root.addEventListener("wheel", onWheel, { capture: true, passive: false });
  root.addEventListener("pointerdown", stop, true);
  root.addEventListener("touchstart", stop, { capture: true, passive: true });
  root.addEventListener("keydown", stop, true);
  return () => {
    stop();
    root.removeEventListener("wheel", onWheel, true);
    root.removeEventListener("pointerdown", stop, true);
    root.removeEventListener("touchstart", stop, true);
    root.removeEventListener("keydown", stop, true);
  };
}
