import { clampZoom } from "./zoomHelpers";
import { ZOOM_MIN, ZOOM_MAX } from "../store/readerState.svelte";

export interface PinchTrackerOptions {
  getZoom:         () => number;
  setZoom:         (z: number) => void;
  getInspectScale: () => number;
  setInspectScale: (s: number) => void;
  resetInspectPan: () => void;
  isLongstrip:     () => boolean;
}

export interface PinchTracker {
  onPointerDown: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerUp:   (e: PointerEvent) => void;
  isPinching:    () => boolean;
}

const INSPECT_ZOOM_MAX = 8;

export function createPinchTracker(opts: PinchTrackerOptions): PinchTracker {
  const pointers = new Map<number, { x: number; y: number }>();
  let startDist    = 0;
  let startZoom    = 0;
  let startInspect = 0;
  let pinching     = false;

  function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function onPointerDown(e: PointerEvent) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      startDist    = dist(a, b);
      startZoom    = opts.getZoom();
      startInspect = opts.getInspectScale();
      pinching     = true;
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!pinching || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size < 2) return;

    const [a, b]   = [...pointers.values()];
    const current  = dist(a, b);
    if (startDist === 0) return;
    const ratio    = current / startDist;

    if (opts.isLongstrip()) {
      opts.setZoom(clampZoom(startZoom * ratio));
    } else {
      const next = Math.max(1, Math.min(INSPECT_ZOOM_MAX, startInspect * ratio));
      if (next !== opts.getInspectScale()) {
        if (next === 1) opts.resetInspectPan();
        opts.setInspectScale(next);
      }
    }
  }

  function onPointerUp(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) {
      pinching     = false;
      startDist    = 0;
      startZoom    = 0;
      startInspect = 0;
    }
  }

  function isPinching() { return pinching; }

  return { onPointerDown, onPointerMove, onPointerUp, isPinching };
}