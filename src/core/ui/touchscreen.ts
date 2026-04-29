export interface LongPressOptions {
  onLongPress: (e: PointerEvent) => void;
  duration?:   number;
  moveThreshold?: number;
}

export function longPress(node: HTMLElement, opts: LongPressOptions) {
  const { onLongPress, duration = 500, moveThreshold = 8 } = opts;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0, startY = 0;
  let fired = false;

  function start(e: PointerEvent) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    startX = e.clientX; startY = e.clientY; fired = false;
    timer = setTimeout(() => { timer = null; fired = true; onLongPress(e); }, duration);
  }
  function move(e: PointerEvent) {
    if (!timer) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (Math.sqrt(dx * dx + dy * dy) > moveThreshold) cancel();
  }
  function cancel() { if (timer) { clearTimeout(timer); timer = null; } }

  node.addEventListener("pointerdown",  start);
  node.addEventListener("pointermove",  move);
  node.addEventListener("pointerup",    cancel);
  node.addEventListener("pointerleave", cancel);
  node.addEventListener("pointercancel",cancel);

  function suppressClick(e: MouseEvent) { if (fired) { fired = false; e.preventDefault(); e.stopPropagation(); } }
  node.addEventListener("click", suppressClick, true);

  return {
    get fired() { return fired; },
    destroy() {
      cancel();
      node.removeEventListener("pointerdown",  start);
      node.removeEventListener("pointermove",  move);
      node.removeEventListener("pointerup",    cancel);
      node.removeEventListener("pointerleave", cancel);
      node.removeEventListener("pointercancel",cancel);
      node.removeEventListener("click", suppressClick, true);
    },
  };
}

export interface TapOptions {
  onTap:       (e: PointerEvent) => void;
  onDoubleTap?: (e: PointerEvent) => void;
  doubleTapGap?: number;
}

export function tap(node: HTMLElement, opts: TapOptions) {
  const { onTap, onDoubleTap, doubleTapGap = 300 } = opts;
  let lastTap = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;
  let startX = 0, startY = 0;
  const SLOP = 8;

  function down(e: PointerEvent) { startX = e.clientX; startY = e.clientY; }
  function up(e: PointerEvent) {
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (Math.sqrt(dx * dx + dy * dy) > SLOP) return;
    const now = Date.now();
    if (onDoubleTap && now - lastTap < doubleTapGap) {
      if (pending) { clearTimeout(pending); pending = null; }
      onDoubleTap(e);
      lastTap = 0;
    } else {
      lastTap = now;
      if (onDoubleTap) {
        pending = setTimeout(() => { pending = null; onTap(e); }, doubleTapGap);
      } else {
        onTap(e);
      }
    }
  }

  node.addEventListener("pointerdown", down);
  node.addEventListener("pointerup",   up);
  return { destroy() {
    node.removeEventListener("pointerdown", down);
    node.removeEventListener("pointerup",   up);
  }};
}

export interface SwipeOptions {
  onSwipeLeft?:  (e: PointerEvent) => void;
  onSwipeRight?: (e: PointerEvent) => void;
  onSwipeUp?:    (e: PointerEvent) => void;
  onSwipeDown?:  (e: PointerEvent) => void;
  threshold?:    number;
  lockAxis?:     boolean;
}

export function swipe(node: HTMLElement, opts: SwipeOptions) {
  const { onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown, threshold = 40, lockAxis = true } = opts;
  let startX = 0, startY = 0, active = false;

  function down(e: PointerEvent) {
    if (e.pointerType === "mouse") return;
    startX = e.clientX; startY = e.clientY; active = true;
    node.setPointerCapture(e.pointerId);
  }
  function up(e: PointerEvent) {
    if (!active) return; active = false;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) < threshold) return;
    if (lockAxis && ax > ay) {
      if (dx < 0) onSwipeLeft?.(e); else onSwipeRight?.(e);
    } else if (lockAxis && ay >= ax) {
      if (dy < 0) onSwipeUp?.(e); else onSwipeDown?.(e);
    } else {
      if (ax >= ay) { if (dx < 0) onSwipeLeft?.(e); else onSwipeRight?.(e); }
      else          { if (dy < 0) onSwipeUp?.(e);   else onSwipeDown?.(e); }
    }
  }
  function cancel() { active = false; }

  node.addEventListener("pointerdown",   down);
  node.addEventListener("pointerup",     up);
  node.addEventListener("pointercancel", cancel);
  return { destroy() {
    node.removeEventListener("pointerdown",   down);
    node.removeEventListener("pointerup",     up);
    node.removeEventListener("pointercancel", cancel);
  }};
}

export interface PinchOptions {
  onPinch:    (scale: number, origin: { x: number; y: number }) => void;
  onPinchEnd?: (scale: number) => void;
}

export function pinch(node: HTMLElement, opts: PinchOptions) {
  const { onPinch, onPinchEnd } = opts;
  const pointers = new Map<number, PointerEvent>();
  let initDist = 0, initMid = { x: 0, y: 0 };

  function dist(a: PointerEvent, b: PointerEvent) {
    const dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function mid(a: PointerEvent, b: PointerEvent) {
    return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
  }

  function down(e: PointerEvent) {
    pointers.set(e.pointerId, e);
    node.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      initDist = dist(a, b);
      initMid  = mid(a, b);
    }
  }
  function move(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, e);
    if (pointers.size !== 2 || initDist === 0) return;
    const [a, b] = [...pointers.values()];
    onPinch(dist(a, b) / initDist, mid(a, b));
  }
  function up(e: PointerEvent) {
    if (pointers.size === 2 && onPinchEnd) {
      const [a, b] = [...pointers.values()];
      onPinchEnd(dist(a, b) / initDist);
    }
    pointers.delete(e.pointerId);
    initDist = 0;
  }

  node.addEventListener("pointerdown",   down);
  node.addEventListener("pointermove",   move);
  node.addEventListener("pointerup",     up);
  node.addEventListener("pointercancel", up);
  return { destroy() {
    node.removeEventListener("pointerdown",   down);
    node.removeEventListener("pointermove",   move);
    node.removeEventListener("pointerup",     up);
    node.removeEventListener("pointercancel", up);
  }};
}

export interface DragScrollOptions {
  direction?: "x" | "y" | "both";
  onDragStart?: () => void;
  onDragEnd?:   () => void;
}

export function dragScroll(node: HTMLElement, opts: DragScrollOptions = {}) {
  const { direction = "both", onDragStart, onDragEnd } = opts;
  let active = false, startX = 0, startY = 0, scrollX = 0, scrollY = 0;

  function down(e: PointerEvent) {
    if (e.pointerType === "mouse") return;
    active = true;
    startX = e.clientX; startY = e.clientY;
    scrollX = node.scrollLeft; scrollY = node.scrollTop;
    node.setPointerCapture(e.pointerId);
    onDragStart?.();
  }
  function move(e: PointerEvent) {
    if (!active) return;
    if (direction !== "x") node.scrollTop  = scrollY - (e.clientY - startY);
    if (direction !== "y") node.scrollLeft = scrollX - (e.clientX - startX);
  }
  function up() { if (active) { active = false; onDragEnd?.(); } }

  node.addEventListener("pointerdown",   down);
  node.addEventListener("pointermove",   move);
  node.addEventListener("pointerup",     up);
  node.addEventListener("pointercancel", up);
  return { destroy() {
    node.removeEventListener("pointerdown",   down);
    node.removeEventListener("pointermove",   move);
    node.removeEventListener("pointerup",     up);
    node.removeEventListener("pointercancel", up);
  }};
}