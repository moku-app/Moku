import { readerState } from "../store/readerState.svelte";

export function clampZoom(z: number): number {
  const { ZOOM_MIN, ZOOM_MAX } = readerState;
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 1000) / 1000;
}

export function captureZoomAnchor(
  containerEl: HTMLElement | null,
  style: string,
  out: { el: HTMLElement | null; offset: number },
) {
  if (!containerEl || style !== "longstrip") return;
  const imgs = containerEl.querySelectorAll<HTMLElement>("img[data-local-page]");
  const containerTop = containerEl.getBoundingClientRect().top;
  for (const img of imgs) {
    const rect = img.getBoundingClientRect();
    if (rect.bottom > containerTop) {
      out.el     = img;
      out.offset = rect.top - containerTop;
      return;
    }
  }
}

export function restoreZoomAnchor(
  containerEl: HTMLElement | null,
  out: { el: HTMLElement | null; offset: number },
) {
  if (!out.el || !containerEl) return;
  const el   = out.el;
  out.el     = null;
  requestAnimationFrame(() => {
    const containerTop = containerEl!.getBoundingClientRect().top;
    const newRect      = el.getBoundingClientRect();
    containerEl!.scrollTop += (newRect.top - containerTop) - out.offset;
  });
}
