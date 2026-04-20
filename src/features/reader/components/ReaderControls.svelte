<script lang="ts">
  import {
    X, CaretLeft, CaretRight,
    Square, Rows, BookOpen, MonitorPlay,
    ArrowsLeftRight, ArrowsIn, ArrowsOut, ArrowsVertical,
    MagnifyingGlassMinus, MagnifyingGlassPlus,
    Bookmark, MapPin, Download, Check,
  } from "phosphor-svelte";
  import { store, updateSettings }       from "@store/state.svelte";
  import { openReader, closeReader }      from "@store/state.svelte";
  import { readerState, MARKER_COLORS, MARKER_COLOR_HEX, ZOOM_STEP, ZOOM_MIN, ZOOM_MAX, PAGE_STYLES } from "../store/readerState.svelte";
  import type { FitMode }                from "@store/state.svelte";
  import type { Chapter }                from "@types";

  interface Props {
    displayChapter:     Chapter | null;
    adjacent:           { prev: Chapter | null; next: Chapter | null };
    visibleChunkLastPage: number;
    fit:                FitMode;
    fitLabel:           string;
    style:              string;
    rtl:                boolean;
    zoom:               number;
    zoomPct:            number;
    isFullscreen:       boolean;
    isBookmarked:       boolean;
    hasMarkerOnPage:    boolean;
    currentPageMarkers: { id: string; color: import("@store/state.svelte").MarkerColor; note: string }[];
    autoNext:           boolean;
    markOnNext:         boolean;
    uiVisible:          boolean;
    hideTimer:          ReturnType<typeof setTimeout> | null;
    onCaptureZoomAnchor: () => void;
    onRestoreZoomAnchor: () => void;
    onMaybeMarkRead:    () => void;
    onToggleBookmark:   () => void;
    onCommitMarker:     () => void;
    onDeleteMarker:     () => void;
    onClampZoom:        (z: number) => number;
    onDlOpen:           () => void;
    win:                import("@tauri-apps/api/window").Window;
  }

  const {
    displayChapter, adjacent, visibleChunkLastPage,
    fit, fitLabel, style, rtl, zoom, zoomPct,
    isFullscreen, isBookmarked, hasMarkerOnPage, currentPageMarkers,
    autoNext, markOnNext, uiVisible, hideTimer,
    onCaptureZoomAnchor, onRestoreZoomAnchor,
    onMaybeMarkRead, onToggleBookmark, onCommitMarker, onDeleteMarker,
    onClampZoom, onDlOpen, win,
  }: Props = $props();

  function adjustZoom(delta: number) {
    onCaptureZoomAnchor();
    updateSettings({ readerZoom: onClampZoom(zoom + delta) });
    onRestoreZoomAnchor();
  }

  function resetZoom() {
    onCaptureZoomAnchor();
    updateSettings({ readerZoom: 1.0 });
    onRestoreZoomAnchor();
  }

  function cycleStyle() {
    const idx = PAGE_STYLES.indexOf(style as typeof PAGE_STYLES[number]);
    updateSettings({ pageStyle: PAGE_STYLES[(idx + 1) % PAGE_STYLES.length] });
  }

  function cycleFit() {
    const opts: FitMode[] = ["width", "height", "screen", "original"];
    updateSettings({ fitMode: opts[(opts.indexOf(fit) + 1) % opts.length] });
  }

  function keepUiAlive() {
    readerState.uiVisible = true;
    if (hideTimer) clearTimeout(hideTimer);
  }

  function openMarkerPopover() {
    if (currentPageMarkers.length > 0) {
      const first = currentPageMarkers[0];
      readerState.openMarker(first.id, first.note, first.color);
    } else {
      readerState.openMarker("", "", "yellow");
    }
  }
</script>

<div class="topbar" class:hidden={!uiVisible}>

  <div class="topbar-left">
    <button class="icon-btn" onclick={closeReader} title="Close reader"><X size={15} weight="light" /></button>
    <button class="icon-btn"
      onclick={() => { if (adjacent.prev) { onMaybeMarkRead(); openReader(adjacent.prev, store.activeChapterList); } }}
      disabled={!adjacent.prev}>
      <CaretLeft size={14} weight="light" />
    </button>
    <span class="ch-label">
      <span class="ch-title">{store.activeManga?.title}</span>
      <span class="ch-sep">/</span>
      <span>{displayChapter?.name}</span>
    </span>
    <button class="icon-btn"
      onclick={() => { if (adjacent.next) { onMaybeMarkRead(); openReader(adjacent.next, store.activeChapterList); } }}
      disabled={!adjacent.next}>
      <CaretRight size={14} weight="light" />
    </button>
    <span class="page-label">{store.pageNumber} / {visibleChunkLastPage || "…"}</span>
  </div>

  <div class="topbar-right">
    <div class="top-sep"></div>

    <button class="mode-btn" onclick={cycleFit}>
      {#if fit === "width"}<ArrowsLeftRight size={14} weight="light" />
      {:else if fit === "height"}<ArrowsVertical size={14} weight="light" />
      {:else if fit === "screen"}<ArrowsIn size={14} weight="light" />
      {:else}<ArrowsOut size={14} weight="light" />{/if}
      <span class="mode-label">{fitLabel}</span>
    </button>

    <div class="zoom-wrap">
      <div class="zoom-inline">
        <button class="zoom-step-btn" onclick={() => adjustZoom(-ZOOM_STEP)} title="Zoom out" disabled={zoom <= ZOOM_MIN}>
          <MagnifyingGlassMinus size={13} weight="light" />
        </button>
        <button class="zoom-pct-btn" onclick={() => readerState.zoomOpen = !readerState.zoomOpen} title="Click to adjust zoom">
          {zoomPct}%
        </button>
        <button class="zoom-step-btn" onclick={() => adjustZoom(ZOOM_STEP)} title="Zoom in" disabled={zoom >= ZOOM_MAX}>
          <MagnifyingGlassPlus size={13} weight="light" />
        </button>
      </div>
      {#if readerState.zoomOpen}
        <div class="zoom-popover">
          <div class="zoom-slider-row">
            <input type="range" class="zoom-slider" min={10} max={100} step={5} value={zoomPct}
              oninput={(e) => { onCaptureZoomAnchor(); updateSettings({ readerZoom: onClampZoom(Number(e.currentTarget.value) / 100) }); onRestoreZoomAnchor(); }} />
          </div>
          <button class="zoom-reset" onclick={resetZoom} disabled={zoom === 1.0}>Reset</button>
        </div>
      {/if}
    </div>

    <button class="mode-btn" class:active={rtl} onclick={() => updateSettings({ readingDirection: rtl ? "ltr" : "rtl" })}>
      <ArrowsLeftRight size={14} weight="light" /><span class="mode-label">{rtl ? "RTL" : "LTR"}</span>
    </button>

    <button class="mode-btn" onclick={cycleStyle} title="Cycle view mode">
      {#if style === "single"}<Square size={14} weight="light" />
      {:else if style === "fade"}<MonitorPlay size={14} weight="light" />
      {:else if style === "double"}<BookOpen size={14} weight="light" />
      {:else}<Rows size={14} weight="light" />{/if}
      <span class="mode-label">{style}</span>
    </button>

    <div class="mode-extras">
      {#if style === "double"}
        <button class="mode-btn" class:active={store.settings.offsetDoubleSpreads}
          onclick={() => updateSettings({ offsetDoubleSpreads: !store.settings.offsetDoubleSpreads })}>
          <span class="mode-label">Offset</span>
        </button>
      {/if}
      {#if style === "longstrip"}
        <button class="mode-btn" class:active={store.settings.pageGap}
          onclick={() => updateSettings({ pageGap: !store.settings.pageGap })}>
          <span class="mode-label">Gap</span>
        </button>
        <button class="mode-btn" class:active={autoNext}
          onclick={() => updateSettings({ autoNextChapter: !autoNext })}>
          <span class="mode-label">Auto</span>
        </button>
      {/if}
      {#if !autoNext}
        <button class="mode-btn" class:active={markOnNext}
          onclick={() => updateSettings({ markReadOnNext: !markOnNext })}>
          <span class="mode-label">Mk.Read</span>
        </button>
      {/if}
    </div>

    <button class="mode-btn" onclick={onDlOpen}>
      <Download size={14} weight="light" />
    </button>

    <div class="marker-wrap">
      <button
        class="icon-btn"
        class:active={hasMarkerOnPage}
        class:marker-btn-has={hasMarkerOnPage}
        onclick={openMarkerPopover}
        title={hasMarkerOnPage ? "Edit marker" : "Add marker"}
        style={hasMarkerOnPage ? `--marker-color:${MARKER_COLOR_HEX[currentPageMarkers[0].color]}` : ""}
      >
        <MapPin size={14} weight={hasMarkerOnPage ? "fill" : "regular"} />
      </button>

      {#if readerState.markerOpen}
        <div class="marker-popover" role="presentation"
          onclick={(e) => e.stopPropagation()}
          onmouseenter={keepUiAlive}
        >
          <div class="marker-pop-header">
            <span class="marker-pop-title">
              {readerState.markerEditId ? "Edit marker" : "New marker"} · p.{store.pageNumber}
            </span>
            {#if readerState.markerEditId}
              <button class="marker-delete-btn" onclick={onDeleteMarker} title="Delete marker">
                <X size={12} weight="light" />
              </button>
            {/if}
          </div>
          <div class="marker-color-row">
            {#each MARKER_COLORS as c}
              <button
                class="marker-swatch"
                class:marker-swatch-active={readerState.markerColor === c}
                style="--swatch:{MARKER_COLOR_HEX[c]}"
                onclick={() => readerState.markerColor = c}
                title={c}
              >
                <span class="swatch-dot"></span>
                <span class="swatch-label">{c}</span>
              </button>
            {/each}
          </div>
          <textarea
            class="marker-textarea"
            style="--accent-marker:{MARKER_COLOR_HEX[readerState.markerColor]}"
            rows={3}
            placeholder="Note (optional)…"
            bind:value={readerState.markerNote}
            onmouseenter={keepUiAlive}
            onkeydown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onCommitMarker(); }
              if (e.key === "Escape") readerState.markerOpen = false;
            }}
          ></textarea>
          <div class="marker-pop-actions">
            <button class="marker-save-btn" style="--accent-marker:{MARKER_COLOR_HEX[readerState.markerColor]}" onclick={onCommitMarker}>
              <Check size={12} weight="bold" />
              {readerState.markerEditId ? "Update" : "Save"}
            </button>
            <button class="marker-cancel-btn" onclick={() => readerState.markerOpen = false}>Cancel</button>
          </div>
        </div>
      {/if}
    </div>

    <button class="icon-btn" class:active={isBookmarked} onclick={onToggleBookmark}
      title={isBookmarked ? "Remove bookmark" : "Bookmark this page"}>
      <Bookmark size={15} weight={isBookmarked ? "fill" : "regular"} />
    </button>

    <div class="wc-wrap">
      <button
        class="icon-btn"
        class:active={readerState.winOpen}
        onclick={() => { readerState.winOpen = !readerState.winOpen; readerState.markerOpen = false; readerState.zoomOpen = false; readerState.dlOpen = false; }}
        title="Window controls"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="1.5"  r="1.2" fill="currentColor"/>
          <circle cx="6" cy="6"    r="1.2" fill="currentColor"/>
          <circle cx="6" cy="10.5" r="1.2" fill="currentColor"/>
        </svg>
      </button>
      {#if readerState.winOpen}
        <div class="wc-dropdown" role="presentation" onclick={(e) => e.stopPropagation()}>
          <button class="wc-btn" onclick={() => { readerState.winOpen = false; win.minimize(); }}>
            <svg width="10" height="1" viewBox="0 0 10 1"><line x1="0" y1="0.5" x2="10" y2="0.5" stroke="currentColor" stroke-width="1.5"/></svg>
            <span>Minimize</span>
          </button>
          <button class="wc-btn" onclick={() => { readerState.winOpen = false; win.toggleMaximize(); }}>
            {#if isFullscreen}
              <svg width="10" height="10" viewBox="0 0 10 10">
                <polyline points="1,4 1,1 4,1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <polyline points="6,1 9,1 9,4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <polyline points="9,6 9,9 6,9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <polyline points="4,9 1,9 1,6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            {:else}
              <svg width="9" height="9" viewBox="0 0 9 9"><rect x="0.75" y="0.75" width="7.5" height="7.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
            {/if}
            <span>{isFullscreen ? "Exit Fullscreen" : "Fullscreen"}</span>
          </button>
          <button class="wc-btn wc-close" onclick={() => { readerState.winOpen = false; win.close(); }}>
            <svg width="10" height="10" viewBox="0 0 10 10">
              <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <span>Close</span>
          </button>
        </div>
      {/if}
    </div>
  </div>

</div>

<style>
  .topbar { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-1); padding: 0 var(--sp-3); height: 40px; background: var(--bg-void); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; position: relative; z-index: 2; transition: opacity 0.25s ease; }
  .topbar.hidden { opacity: 0; pointer-events: none; }

  .topbar-left  { display: flex; align-items: center; gap: var(--sp-1); min-width: 0; flex: 1; overflow: hidden; }
  .topbar-right { display: flex; align-items: center; gap: var(--sp-1); flex-shrink: 0; }
  .mode-extras  { display: flex; align-items: center; gap: var(--sp-1); min-width: 0; }

  .icon-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--radius-sm); color: var(--text-muted); flex-shrink: 0; transition: color var(--t-base), background var(--t-base); }
  .icon-btn:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-raised); }
  .icon-btn:disabled { opacity: 0.2; cursor: default; }
  .icon-btn.active { color: var(--accent-fg); }
  .marker-btn-has { color: var(--marker-color, var(--accent-fg)) !important; }

  .ch-label { display: flex; align-items: center; gap: var(--sp-2); font-size: var(--text-sm); color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .ch-title { color: var(--text-secondary); font-weight: var(--weight-medium); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ch-sep   { color: var(--text-faint); flex-shrink: 0; }
  .page-label { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-muted); letter-spacing: var(--tracking-wide); flex-shrink: 0; }
  .top-sep { width: 1px; height: 16px; background: var(--border-dim); flex-shrink: 0; margin: 0 var(--sp-1); }

  .mode-btn { display: flex; align-items: center; gap: 4px; padding: 4px var(--sp-2); border-radius: var(--radius-sm); color: var(--text-muted); flex-shrink: 0; font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); transition: color var(--t-base), background var(--t-base); }
  .mode-btn:hover { color: var(--text-primary); background: var(--bg-raised); }
  .mode-btn.active { color: var(--accent-fg); background: var(--accent-muted); }
  .mode-label { text-transform: capitalize; }

  .zoom-wrap     { position: relative; flex-shrink: 0; }
  .zoom-inline   { display: flex; align-items: center; gap: 1px; background: var(--bg-overlay); border: 1px solid var(--border-base); border-radius: var(--radius-sm); overflow: hidden; }
  .zoom-step-btn { display: flex; align-items: center; justify-content: center; width: 22px; height: 24px; color: var(--text-muted); transition: color var(--t-base), background var(--t-base); }
  .zoom-step-btn:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-raised); }
  .zoom-step-btn:disabled { opacity: 0.25; cursor: default; }
  .zoom-pct-btn  { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); color: var(--text-secondary); padding: 0 var(--sp-2); height: 24px; min-width: 38px; text-align: center; transition: color var(--t-base), background var(--t-base); border-left: 1px solid var(--border-dim); border-right: 1px solid var(--border-dim); }
  .zoom-pct-btn:hover { color: var(--text-primary); background: var(--bg-raised); }
  .zoom-popover  { position: absolute; top: calc(100% + 6px); left: 50%; translate: -50% 0; background: var(--bg-raised); border: 1px solid var(--border-base); border-radius: var(--radius-lg); padding: var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-2); box-shadow: 0 8px 24px rgba(0,0,0,0.5); z-index: 100; min-width: 180px; animation: scaleIn 0.1s ease both; transform-origin: top center; }
  .zoom-slider-row { display: flex; align-items: center; gap: var(--sp-2); }
  .zoom-slider   { flex: 1; height: 3px; appearance: none; -webkit-appearance: none; background: var(--border-strong); border-radius: 2px; outline: none; cursor: pointer; }
  .zoom-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: var(--accent-fg); cursor: pointer; }
  .zoom-reset    { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-muted); letter-spacing: var(--tracking-wide); padding: 3px var(--sp-2); border-radius: var(--radius-sm); border: 1px solid var(--border-dim); transition: color var(--t-base), background var(--t-base), border-color var(--t-base); }
  .zoom-reset:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-overlay); border-color: var(--border-strong); }
  .zoom-reset:disabled { opacity: 0.3; cursor: default; }

  .marker-wrap     { position: relative; flex-shrink: 0; }
  .marker-popover  { position: absolute; top: calc(100% + 8px); right: 0; width: 240px; background: var(--bg-surface); border: 1px solid var(--border-base); border-radius: var(--radius-lg); padding: var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-3); box-shadow: 0 12px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4); z-index: 100; animation: scaleIn 0.1s ease both; transform-origin: top right; }
  .marker-pop-header { display: flex; align-items: center; justify-content: space-between; }
  .marker-pop-title  { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; }
  .marker-delete-btn { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: var(--radius-sm); border: none; background: none; color: var(--text-faint); cursor: pointer; transition: color var(--t-fast), background var(--t-fast); }
  .marker-delete-btn:hover { color: var(--color-error); background: var(--color-error-bg); }
  .marker-color-row  { display: flex; align-items: center; gap: var(--sp-2); }
  .marker-swatch     { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 4px; border-radius: var(--radius-sm); background: none; border: none; cursor: pointer; flex: 1; transition: background var(--t-fast); }
  .marker-swatch:hover { background: var(--bg-overlay); }
  .swatch-dot        { width: 14px; height: 14px; border-radius: 50%; background: var(--swatch); box-shadow: 0 0 0 0 var(--swatch); transition: box-shadow var(--t-fast), transform var(--t-fast); flex-shrink: 0; }
  .marker-swatch:hover .swatch-dot { transform: scale(1.15); }
  .marker-swatch-active .swatch-dot { box-shadow: 0 0 0 3px color-mix(in srgb, var(--swatch) 30%, transparent); transform: scale(1.1); }
  .swatch-label      { font-family: var(--font-ui); font-size: 9px; letter-spacing: var(--tracking-wide); color: var(--text-faint); text-transform: capitalize; line-height: 1; }
  .marker-swatch-active .swatch-label { color: var(--text-muted); }
  .marker-textarea   { width: 100%; background: var(--bg-raised); border: 1px solid var(--border-strong); border-radius: var(--radius-md); padding: 7px 9px; font-size: var(--text-xs); color: var(--text-secondary); outline: none; resize: none; font-family: inherit; line-height: var(--leading-snug); transition: border-color var(--t-base), box-shadow var(--t-base); }
  .marker-textarea:focus { border-color: var(--accent-marker, var(--border-focus)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-marker, var(--accent)) 18%, transparent); }
  .marker-pop-actions { display: flex; align-items: center; gap: var(--sp-2); }
  .marker-save-btn   { display: flex; align-items: center; gap: 5px; padding: 6px 14px; border-radius: var(--radius-sm); border: 1px solid color-mix(in srgb, var(--accent-marker, var(--accent)) 50%, transparent); background: color-mix(in srgb, var(--accent-marker, var(--accent)) 15%, transparent); color: var(--accent-marker, var(--accent-fg)); font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); cursor: pointer; transition: filter var(--t-fast); }
  .marker-save-btn:hover { filter: brightness(1.2); }
  .marker-cancel-btn { flex: 1; padding: 6px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: none; color: var(--text-faint); font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); cursor: pointer; transition: color var(--t-base), border-color var(--t-base); text-align: center; }
  .marker-cancel-btn:hover { color: var(--text-muted); border-color: var(--border-strong); }

  .wc-wrap     { position: relative; flex-shrink: 0; }
  .wc-dropdown { position: absolute; top: calc(100% + 6px); right: 0; background: var(--bg-raised); border: 1px solid var(--border-base); border-radius: var(--radius-lg); padding: var(--sp-1); display: flex; flex-direction: column; gap: 2px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); z-index: 100; min-width: 148px; animation: scaleIn 0.1s ease both; transform-origin: top right; }
  .wc-btn      { display: flex; align-items: center; gap: var(--sp-2); padding: 6px var(--sp-2); border-radius: var(--radius-sm); background: none; border: none; color: var(--text-muted); font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); cursor: pointer; width: 100%; transition: color var(--t-base), background var(--t-base); }
  .wc-btn svg  { flex-shrink: 0; opacity: 0.75; }
  .wc-btn:hover { color: var(--text-primary); background: var(--bg-overlay); }
  .wc-close:hover { color: #fff; background: #c0392b; }

  @keyframes scaleIn { from { opacity: 0; transform: scale(0.97) } to { opacity: 1; transform: scale(1) } }
</style>