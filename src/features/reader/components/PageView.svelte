<script lang="ts">
  import { CircleNotch } from "phosphor-svelte";
  import { store }       from "@store/state.svelte";
  import { readerState } from "../store/readerState.svelte";
  import type { StripChapter } from "../lib/scrollHandler";
  import { createPinchTracker } from "../lib/pinchZoom";
  import type { PinchTracker }  from "../lib/pinchZoom";

  interface Props {
    style:           string;
    imgCls:          string;
    effectiveWidth:  number | undefined;
    loading:         boolean;
    error:           string | null;
    pageReady:       boolean;
    pageGroups:      number[][];
    currentGroup:    number[];
    stripToRender:   StripChapter[];
    fadingOut:       boolean;
    tapToToggleBar:  boolean;
    pinchZoomEnabled: boolean;
    onGetZoom:       () => number;
    onSetZoom:       (z: number) => void;
    resolveUrl:      (url: string, priority?: number) => Promise<string>;
    onTap:           (e: MouseEvent) => void;
    onWheel:         (e: WheelEvent) => void;
    onToggleUi:      () => void;
    bindContainer:   (el: HTMLDivElement) => void;
  }

  const {
    style, imgCls, effectiveWidth, loading, error, pageReady,
    pageGroups, currentGroup, stripToRender, fadingOut,
    tapToToggleBar, pinchZoomEnabled, onGetZoom, onSetZoom,
    resolveUrl, onTap, onWheel, onToggleUi, bindContainer,
  }: Props = $props();

  const INSPECT_ZOOM_STEP = 0.15;
  const INSPECT_ZOOM_MAX  = 8;

  let containerEl: HTMLDivElement;

  function getInspectImageEl(): HTMLElement | null {
    if (!containerEl) return null;
    return (
      containerEl.querySelector<HTMLElement>(".inspect-wrap .double-wrap") ??
      containerEl.querySelector<HTMLElement>(".inspect-wrap img")
    );
  }

  function clampInspectPan(scale: number, px: number, py: number): [number, number] {
    const img = getInspectImageEl();
    if (!img) return [px, py];
    const maxX = Math.max(0, (img.offsetWidth  * (scale - 1)) / 2);
    const maxY = Math.max(0, (img.offsetHeight * (scale - 1)) / 2);
    return [Math.max(-maxX, Math.min(maxX, px)), Math.max(-maxY, Math.min(maxY, py))];
  }

  let inspectDragging   = false;
  let inspectDragMoved  = false;
  let inspectDragStartX = 0;
  let inspectDragStartY = 0;
  let inspectPanStartX  = 0;
  let inspectPanStartY  = 0;

  let stripDragging    = $state(false);
  let stripDragMoved   = false;
  let stripDragStartY  = 0;
  let stripScrollStart = 0;

  let pinch: PinchTracker | null = null;

  $effect(() => {
    if (pinchZoomEnabled) {
      pinch = createPinchTracker({
        getZoom:         onGetZoom,
        setZoom:         onSetZoom,
        getInspectScale: () => readerState.inspectScale,
        setInspectScale: (s) => { readerState.inspectScale = s; },
        resetInspectPan: () => { readerState.inspectPanX = 0; readerState.inspectPanY = 0; },
        isLongstrip:     () => style === "longstrip",
      });
    } else {
      pinch = null;
    }
  });

  export function onInspectMouseDown(e: MouseEvent) {
    if ((e.target as Element).closest(".bar")) return;
    if (style === "longstrip") {
      stripDragging    = true;
      stripDragMoved   = false;
      stripDragStartY  = e.clientY;
      stripScrollStart = containerEl?.scrollTop ?? 0;
      e.preventDefault();
      return;
    }
    if (readerState.inspectScale <= 1) return;
    inspectDragging   = true;
    inspectDragMoved  = false;
    inspectDragStartX = e.clientX;
    inspectDragStartY = e.clientY;
    inspectPanStartX  = readerState.inspectPanX;
    inspectPanStartY  = readerState.inspectPanY;
    e.preventDefault();
  }

  export function onInspectMouseMove(e: MouseEvent) {
    if (stripDragging) {
      const dy = e.clientY - stripDragStartY;
      if (!stripDragMoved && Math.abs(dy) > 4) stripDragMoved = true;
      if (containerEl) containerEl.scrollTop = stripScrollStart - dy;
      return;
    }
    if (!inspectDragging) return;
    if (!inspectDragMoved && Math.abs(e.clientX - inspectDragStartX) + Math.abs(e.clientY - inspectDragStartY) > 4) inspectDragMoved = true;
    const rawX = inspectPanStartX + (e.clientX - inspectDragStartX);
    const rawY = inspectPanStartY + (e.clientY - inspectDragStartY);
    const [cx, cy] = clampInspectPan(readerState.inspectScale, rawX, rawY);
    readerState.inspectPanX = cx;
    readerState.inspectPanY = cy;
  }

  export function onInspectMouseUp() {
    stripDragging   = false;
    inspectDragging = false;
  }

  export function onPointerDown(e: PointerEvent) {
    if ((e.target as Element).closest(".bar")) return;
    pinch?.onPointerDown(e);
  }

  export function onPointerMove(e: PointerEvent) {
    if (pinch?.isPinching()) {
      pinch.onPointerMove(e);
      return;
    }
    if (stripDragging) {
      const dy = e.clientY - stripDragStartY;
      if (!stripDragMoved && Math.abs(dy) > 4) stripDragMoved = true;
      if (containerEl) containerEl.scrollTop = stripScrollStart - dy;
    }
    if (inspectDragging) {
      if (!inspectDragMoved && Math.abs(e.clientX - inspectDragStartX) + Math.abs(e.clientY - inspectDragStartY) > 4) inspectDragMoved = true;
      const rawX = inspectPanStartX + (e.clientX - inspectDragStartX);
      const rawY = inspectPanStartY + (e.clientY - inspectDragStartY);
      const [cx, cy] = clampInspectPan(readerState.inspectScale, rawX, rawY);
      readerState.inspectPanX = cx;
      readerState.inspectPanY = cy;
    }
  }

  export function onPointerUp(e: PointerEvent) {
    pinch?.onPointerUp(e);
    if (!pinch?.isPinching()) {
      stripDragging   = false;
      inspectDragging = false;
    }
  }

  export function handleWheel(e: WheelEvent) {
    if (style === "longstrip") {
      if (e.ctrlKey) { onWheel(e); }
      return;
    }
    if (!e.ctrlKey) { onWheel(e); return; }
    e.preventDefault();
    const delta = e.deltaY < 0 ? INSPECT_ZOOM_STEP : -INSPECT_ZOOM_STEP;
    const next  = Math.max(1, Math.min(INSPECT_ZOOM_MAX, readerState.inspectScale + delta));
    if (next === readerState.inspectScale) return;
    if (next === 1) { readerState.inspectScale = 1; readerState.inspectPanX = 0; readerState.inspectPanY = 0; return; }
    const img    = getInspectImageEl();
    const anchor = img ?? containerEl;
    const rect   = anchor?.getBoundingClientRect();
    const cx     = rect ? e.clientX - rect.left - rect.width  / 2 : 0;
    const cy     = rect ? e.clientY - rect.top  - rect.height / 2 : 0;
    const ratio  = next / readerState.inspectScale;
    const rawPanX = cx + (readerState.inspectPanX - cx) * ratio;
    const rawPanY = cy + (readerState.inspectPanY - cy) * ratio;
    const [clampedX, clampedY] = clampInspectPan(next, rawPanX, rawPanY);
    readerState.inspectScale = next;
    readerState.inspectPanX  = clampedX;
    readerState.inspectPanY  = clampedY;
  }

  function handleTap(e: MouseEvent) {
    if (style === "longstrip") return;
    if (inspectDragMoved) { inspectDragMoved = false; return; }
    if (stripDragMoved)   { stripDragMoved   = false; return; }
    onTap(e);
  }

  function setContainer(el: HTMLDivElement) {
    containerEl = el;
    bindContainer(el);
  }
</script>

<div
  use:setContainer
  class="viewer"
  class:strip={style === "longstrip"}
  class:inspect-active={readerState.inspectScale > 1}
  style={effectiveWidth != null ? `--effective-width:${effectiveWidth}px` : ""}
  role="presentation"
  tabindex="-1"
  onclick={handleTap}
  ondblclick={(e) => { if (tapToToggleBar) { const x = e.clientX / window.innerWidth; if (x >= 0.3 && x <= 0.7) onToggleUi(); } }}
  onmousedown={onInspectMouseDown}
  onpointerdown={pinchZoomEnabled ? onPointerDown : undefined}
  onwheel={(e) => { if (e.ctrlKey || style !== "longstrip") e.preventDefault(); }}
  style:cursor={style === "longstrip" ? (stripDragging ? "grabbing" : "grab") : undefined}
  onkeydown={(e) => { if (e.key === " " && style === "longstrip") { e.preventDefault(); containerEl?.scrollBy({ top: containerEl.clientHeight * 0.85, behavior: "smooth" }); } }}
>

  {#if loading}
    <div class="center-overlay"><CircleNotch size={20} weight="light" class="anim-spin" style="color:var(--text-faint)" /></div>
  {/if}
  {#if error}
    <div class="center-overlay"><p class="error-msg">{error}</p></div>
  {/if}

  {#if style === "longstrip"}
    {#each stripToRender as chunk}
      {#each chunk.urls as url, i}
        {#await resolveUrl(url, chunk.urls.length - i)}
          <img src="" alt="{chunk.chapterName} – Page {i + 1}" data-local-page={i + 1} data-chapter={chunk.chapterId} data-total={chunk.urls.length} class="{imgCls}{store.settings.pageGap ? ' strip-gap' : ''}" loading={i < 5 ? "eager" : "lazy"} decoding="async" />
        {:then src}
          <img {src} alt="{chunk.chapterName} – Page {i + 1}" data-local-page={i + 1} data-chapter={chunk.chapterId} data-total={chunk.urls.length} class="{imgCls}{store.settings.pageGap ? ' strip-gap' : ''}" loading={i < 5 ? "eager" : "lazy"} decoding="async" />
        {/await}
      {/each}
    {/each}
    <div style="height:1px;flex-shrink:0"></div>

  {:else if style === "fade" && pageReady}
    <div class="inspect-wrap" style="transform:scale({readerState.inspectScale}) translate({readerState.inspectPanX / readerState.inspectScale}px,{readerState.inspectPanY / readerState.inspectScale}px)">
      {#await resolveUrl(store.pageUrls[store.pageNumber - 1], 999)}
        <img src="" alt="Page {store.pageNumber}" class={imgCls} decoding="async" style="opacity:0" />
      {:then src}
        <img {src} alt="Page {store.pageNumber}" class={imgCls} decoding="async" style="opacity: {fadingOut ? 0 : 1}; transition: opacity 0.1s ease;" />
      {/await}
    </div>

  {:else if style === "double" && pageReady}
    <div class="inspect-wrap" style="transform:scale({readerState.inspectScale}) translate({readerState.inspectPanX / readerState.inspectScale}px,{readerState.inspectPanY / readerState.inspectScale}px)">
      {#if pageGroups.length}
        <div class="double-wrap">
          {#each currentGroup as pg, i}
            {#await resolveUrl(store.pageUrls[pg - 1], 999)}
              <img src="" alt="Page {pg}" class="{imgCls} page-half {i === 0 ? 'gap-left' : 'gap-right'}" decoding="async" />
            {:then src}
              <img {src} alt="Page {pg}" class="{imgCls} page-half {i === 0 ? 'gap-left' : 'gap-right'}" decoding="async" />
            {/await}
          {/each}
        </div>
      {:else}
        <div class="center-overlay"><CircleNotch size={20} weight="light" class="anim-spin" style="color:var(--text-faint)" /></div>
      {/if}
    </div>

  {:else if pageReady}
    <div class="inspect-wrap" style="transform:scale({readerState.inspectScale}) translate({readerState.inspectPanX / readerState.inspectScale}px,{readerState.inspectPanY / readerState.inspectScale}px)">
      {#await resolveUrl(store.pageUrls[store.pageNumber - 1], 999)}
        <img src="" alt="Page {store.pageNumber}" class={imgCls} decoding="async" />
      {:then src}
        <img {src} alt="Page {store.pageNumber}" class={imgCls} decoding="async" />
      {/await}
    </div>
  {/if}

</div>

<style>
  .viewer { flex: 1; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center; -webkit-overflow-scrolling: touch; position: relative; touch-action: pan-x pan-y; }
  .viewer.strip { justify-content: flex-start; padding: var(--sp-4) 0; }
  .viewer:focus { outline: none; }
  .viewer.inspect-active { cursor: grab; overflow: hidden; }
  .viewer.inspect-active:active { cursor: grabbing; }

  :global(.pinch-active) .viewer { touch-action: none; }

  .inspect-wrap { display: flex; align-items: center; justify-content: center; transform-origin: center center; will-change: transform; }

  .img { display: block; user-select: none; image-rendering: auto; }
  .img:global(.optimize-contrast) { image-rendering: -webkit-optimize-contrast; }
  :global(.fit-width)    { max-width: var(--effective-width, 100%); width: 100%; height: auto; }
  :global(.fit-height)   { max-height: calc(100vh - 80px); width: auto; max-width: var(--effective-width, 100%); height: auto; }
  :global(.fit-screen)   { max-width: var(--effective-width, 100%); max-height: calc(100vh - 80px); object-fit: contain; height: auto; }
  :global(.fit-original) { max-width: 100%; width: auto; height: auto; }
  :global(.strip-gap)    { margin-bottom: 8px; }

  .double-wrap { display: flex; align-items: flex-start; justify-content: center; max-width: calc(var(--effective-width, 100%) * 2); width: 100%; }
  .page-half   { flex: 1; min-width: 0; object-fit: contain; }
  .gap-left    { margin-right: 2px; }
  .gap-right   { margin-left: 2px; }

  .center-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .error-msg      { color: var(--color-error); font-size: var(--text-base); }
</style>