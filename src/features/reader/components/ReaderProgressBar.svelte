<script lang="ts">
  import { ArrowLeft, ArrowRight } from "phosphor-svelte";
  import { readerState, MARKER_COLOR_HEX } from "../store/readerState.svelte";
  import type { BookmarkEntry, MarkerEntry } from "@store/state.svelte";
  import type { Chapter } from "@types";

  interface Props {
    style:               string;
    loading:             boolean;
    rtl:                 boolean;
    sliderPage:          number;
    sliderMax:           number;
    sliderPct:           number;
    lastPage:            number;
    displayChapter:      Chapter | null;
    currentBookmark:     BookmarkEntry | undefined;
    activeChapterMarkers: MarkerEntry[];
    adjacent:            { prev: Chapter | null; next: Chapter | null };
    uiVisible:           boolean;
    onGoPrev:            () => void;
    onGoNext:            () => void;
    onJumpToPage:        (page: number) => void;
  }

  const {
    style, loading, rtl, sliderPage, sliderMax, sliderPct, lastPage,
    displayChapter, currentBookmark, activeChapterMarkers, adjacent, uiVisible,
    onGoPrev, onGoNext, onJumpToPage,
  }: Props = $props();
</script>

<div class="bottombar" class:hidden={!uiVisible}>
  <button class="nav-btn" onclick={onGoPrev}
    disabled={loading || (style === "longstrip" ? !adjacent.prev : (sliderPage === 1 && !adjacent.prev))}>
    <ArrowLeft size={13} weight="light" />
  </button>

  {#if sliderMax > 1}
    <div
      class="slider-wrap"
      class:dragging={readerState.sliderDragging}
      role="slider"
      aria-valuenow={sliderPage}
      aria-valuemin={1}
      aria-valuemax={sliderMax}
      tabindex="-1"
      onmouseenter={() => readerState.sliderHover = true}
      onmouseleave={() => { readerState.sliderHover = false; readerState.sliderDragging = false; }}
      onmousedown={(e) => {
        readerState.sliderDragging = true;
        const rect  = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        onJumpToPage(Math.round(1 + (rtl ? 1 - ratio : ratio) * (sliderMax - 1)));
      }}
      onmousemove={(e) => {
        if (!readerState.sliderDragging) return;
        const rect  = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        onJumpToPage(Math.round(1 + (rtl ? 1 - ratio : ratio) * (sliderMax - 1)));
      }}
      onmouseup={() => readerState.sliderDragging = false}
    >
      <div class="slider-track-bg">
        <div class="slider-fill" style={rtl ? `width:${100 - sliderPct}%;margin-left:auto` : `width:${sliderPct}%`}></div>
      </div>
      <div class="slider-thumb" style="left:{sliderPct}%"></div>

      {#if currentBookmark && currentBookmark.chapterId === displayChapter?.id}
        {@const bOrd = rtl ? lastPage - currentBookmark.pageNumber + 1 : currentBookmark.pageNumber}
        {@const bPct = lastPage > 1 ? ((bOrd - 1) / (lastPage - 1)) * 100 : 0}
        <div class="slider-checkpoint bookmark-checkpoint" style="left:{bPct}%" title="Bookmark: Page {currentBookmark.pageNumber}"></div>
      {/if}

      {#each activeChapterMarkers as m (m.id)}
        {@const mOrd = rtl ? lastPage - m.pageNumber + 1 : m.pageNumber}
        {@const mPct = lastPage > 1 ? ((mOrd - 1) / (lastPage - 1)) * 100 : 0}
        <div class="slider-checkpoint marker-checkpoint" style="left:{mPct}%;background:{MARKER_COLOR_HEX[m.color]}" title="{m.note ? m.note : 'Marker'} · Page {m.pageNumber}"></div>
      {/each}

      {#if readerState.sliderHover || readerState.sliderDragging}
        <div class="slider-tooltip" style="left:{sliderPct}%">
          {sliderPage} / {sliderMax}
        </div>
      {/if}
    </div>
  {/if}

  <button class="nav-btn" onclick={onGoNext}
    disabled={loading || (style === "longstrip" ? !adjacent.next : (sliderPage === sliderMax && !adjacent.next))}>
    <ArrowRight size={13} weight="light" />
  </button>
</div>

<style>
  .bottombar { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--sp-3); border-top: 1px solid var(--border-dim); background: var(--bg-void); flex-shrink: 0; transition: opacity 0.25s ease; }
  .bottombar.hidden { opacity: 0; pointer-events: none; }

  .nav-btn { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; flex-shrink: 0; border-radius: var(--radius-md); border: 1px solid var(--border-strong); color: var(--text-muted); transition: background var(--t-base), color var(--t-base); }
  .nav-btn:hover:not(:disabled) { background: var(--bg-raised); color: var(--text-primary); }
  .nav-btn:disabled { opacity: 0.25; cursor: default; }

  .slider-wrap       { flex: 1; position: relative; display: flex; align-items: center; height: 34px; cursor: pointer; }
  .slider-track-bg   { position: absolute; left: 0; right: 0; height: 3px; background: var(--border-strong); border-radius: 2px; pointer-events: none; }
  .slider-fill       { height: 100%; background: var(--accent-fg); border-radius: 2px; transition: width 0.05s linear; position: relative; }
  .slider-checkpoint { position: absolute; top: 50%; width: 4px; height: 10px; border-radius: 2px; transform: translate(-50%, -50%); pointer-events: none; z-index: 1; }
  .slider-thumb      { position: absolute; top: 50%; transform: translate(-50%, -50%); width: 12px; height: 12px; border-radius: 50%; background: var(--accent-fg); pointer-events: none; z-index: 2; box-shadow: 0 0 0 2px rgba(0,0,0,0.5); transition: transform var(--t-fast); }
  .slider-wrap:hover .slider-thumb, .slider-wrap.dragging .slider-thumb { transform: translate(-50%, -50%) scale(1.3); }
  .bookmark-checkpoint { background: #ffffff; opacity: 0.8; }
  .marker-checkpoint   { opacity: 0.85; }
  .slider-tooltip    { position: absolute; bottom: calc(100% + 2px); transform: translateX(-50%); background: var(--bg-raised); border: 1px solid var(--border-base); border-radius: var(--radius-sm); padding: 2px 6px; font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-secondary); white-space: nowrap; pointer-events: none; z-index: 10; letter-spacing: var(--tracking-wide); }
  .slider-wrap:hover .slider-track-bg, .slider-wrap.dragging .slider-track-bg { height: 5px; }
</style>