<script lang="ts">
  import {
    MagnifyingGlass, Books, DownloadSimple, Folder, FolderSimple,
    SortAscending, CaretUp, CaretDown, ArrowsClockwise, Star, X,
  } from "phosphor-svelte";
  import LibraryFilters from "./LibraryFilters.svelte";
  import type { Category } from "@types";
  import type { LibrarySortMode, LibrarySortDir, LibraryStatusFilter, LibraryContentFilter } from "@store/state.svelte";

  interface Props {
    tab:              string;
    tabSortMode:      LibrarySortMode;
    tabSortDir:       LibrarySortDir;
    tabStatus:        LibraryStatusFilter;
    tabFilters:       Partial<Record<LibraryContentFilter, boolean>>;
    hasActiveFilters: boolean;
    anims:            boolean;
    visibleCategories: Category[];
    counts:           Record<string, number>;
    search:           string;
    activeDragKind:   "tab" | null;
    dragInsertIdx:    number;
    dragTabId:        number | null;
    dragOverTabId:    number | null;
    sortPanelOpen:    boolean;
    filterPanelOpen:  boolean;
    tabsEl:           HTMLDivElement;
    onSearchChange:      (v: string) => void;
    onTabChange:         (f: string) => void;
    onSortChange:        (mode: LibrarySortMode) => void;
    onSortDirToggle:     () => void;
    onStatusChange:      (s: LibraryStatusFilter) => void;
    onFilterToggle:      (f: LibraryContentFilter) => void;
    onFiltersClear:      () => void;
    onSortPanelToggle:   () => void;
    onFilterPanelToggle: () => void;
    onOpenDownloadsFolder: () => void;
    onTabDragStart:      (e: DragEvent, cat: Category) => void;
    onTabDragOver:       (e: DragEvent, cat: Category, idx: number) => void;
    onTabDragLeave:      () => void;
    onTabDrop:           (e: DragEvent, cat: Category) => void;
    onTabDragEnd:        () => void;
  }

  let {
    tab, tabSortMode, tabSortDir, tabStatus, tabFilters, hasActiveFilters,
    anims, visibleCategories, counts, search, refreshing,
    refreshProgress, refreshDone, activeDragKind, dragInsertIdx,
    dragTabId, dragOverTabId, sortPanelOpen, filterPanelOpen,
    tabsEl = $bindable(),
    onSearchChange, onTabChange, onSortChange, onSortDirToggle, onStatusChange,
    onFilterToggle, onFiltersClear, onSortPanelToggle, onFilterPanelToggle,
    onRefresh, onOpenDownloadsFolder,
    onTabDragStart, onTabDragOver, onTabDragLeave, onTabDrop, onTabDragEnd,
  }: Props = $props();

  const SORT_LABELS: Record<LibrarySortMode, string> = {
    az:             "A–Z",
    unreadCount:    "Unread chapters",
    totalChapters:  "Total chapters",
    recentlyAdded:  "Recently added",
    recentlyRead:   "Recently read",
    latestFetched:  "Latest fetched chapter",
    latestUploaded: "Latest uploaded chapter",
  };

  const ALL_SORT_MODES: LibrarySortMode[] = [
    "az", "unreadCount", "totalChapters", "recentlyAdded", "recentlyRead", "latestFetched", "latestUploaded",
  ];

  const activeCatId = $derived(
    tab !== "library" && tab !== "downloaded" ? Number(tab) : null
  );
</script>

<div class="header">
  <span class="heading">Library</span>

  <div class="tabs" class:tabs-anims={anims} bind:this={tabsEl}>
    {#each [["library", "Saved"], ["downloaded", "Downloaded"]] as [f, label]}
      <button class="tab" class:active={tab === f} onclick={() => onTabChange(f)}>
        {#if f === "library"}<Books size={11} weight="bold" />
        {:else if f === "downloaded"}<DownloadSimple size={11} weight="bold" />{/if}
        {label}
        <span class="tab-count">{counts[f] ?? 0}</span>
      </button>
    {/each}
    {#if visibleCategories.length > 0}
      <div class="tab-separator" aria-hidden="true"></div>
      <div class="tabs-scroll">
        {#each visibleCategories as cat, idx}
          {#if dragInsertIdx === idx && activeDragKind === "tab"}
            <div class="tab-insert-bar" aria-hidden="true"></div>
          {/if}
          <button
            class="tab"
            class:active={tab === String(cat.id)}
            class:tab-dragging={dragTabId === cat.id}
            draggable="true"
            onclick={() => onTabChange(String(cat.id))}
            ondragstart={(e) => onTabDragStart(e, cat)}
            ondragover={(e) => onTabDragOver(e, cat, idx)}
            ondragleave={onTabDragLeave}
            ondrop={(e) => onTabDrop(e, cat)}
            ondragend={onTabDragEnd}
          >
            <Folder size={11} weight="bold" />
            {cat.name}
            <span class="tab-count">{counts[String(cat.id)] ?? 0}</span>
          </button>
          {#if dragInsertIdx === idx + 1 && activeDragKind === "tab" && idx === visibleCategories.length - 1}
            <div class="tab-insert-bar" aria-hidden="true"></div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>

  <div class="header-right">
    <div class="search-wrap">
      <MagnifyingGlass size={13} class="search-icon" weight="light" />
      <input class="search" placeholder="Search" value={search} oninput={(e) => onSearchChange((e.target as HTMLInputElement).value)} />
    </div>

    {#if refreshing}
      <button
        class="icon-btn refresh-btn icon-btn-active"
        title={`Checking… ${refreshProgress.finished}/${refreshProgress.total}`}
        onclick={onRefresh}
      >
        <ArrowsClockwise size={15} weight="bold" class="anim-spin" />
        {#if refreshProgress.total > 0}
          <span class="refresh-progress">{refreshProgress.finished}/{refreshProgress.total}</span>
        {/if}
      </button>
    {:else}
      <button
        class="icon-btn refresh-btn"
        class:refresh-btn-done={refreshDone}
        title={refreshDone ? "Library updated" : "Check for updates"}
        onclick={onRefresh}
      >
        <ArrowsClockwise size={15} weight="bold" />
      </button>
    {/if}

    <button class="icon-btn" title="Open downloads folder" onclick={onOpenDownloadsFolder}>
      <FolderSimple size={15} weight="bold" />
    </button>

    <div class="sort-panel-wrap">
      <button
        class="icon-btn"
        class:icon-btn-active={tabSortMode !== "az" || tabSortDir !== "asc"}
        title="Sort"
        onclick={onSortPanelToggle}
      >
        <SortAscending size={15} weight="bold" />
      </button>
      {#if sortPanelOpen}
        <div class="dropdown-panel sort-panel anim-fade-in" role="menu">
          <div class="panel-header">
            <span class="panel-heading">Sort</span>
          </div>
          <div class="panel-divider"></div>
          <p class="panel-label">Order by</p>
          {#each ALL_SORT_MODES as m}
            <button
              class="panel-item"
              class:panel-item-active={tabSortMode === m}
              role="menuitem"
              onclick={() => onSortChange(m)}
            >
              {SORT_LABELS[m]}
              {#if tabSortMode === m}
                {#if tabSortDir === "asc"}<CaretUp size={11} weight="bold" class="sort-caret" />
                {:else}<CaretDown size={11} weight="bold" class="sort-caret" />{/if}
              {/if}
            </button>
          {/each}
          <button class="panel-item dir-toggle" role="menuitem" onclick={onSortDirToggle}>
            {tabSortDir === "asc" ? "Ascending" : "Descending"}
            {#if tabSortDir === "asc"}<CaretUp size={11} weight="bold" />
            {:else}<CaretDown size={11} weight="bold" />{/if}
          </button>
        </div>
      {/if}
    </div>

    <LibraryFilters
      {tabStatus}
      {tabFilters}
      {hasActiveFilters}
      {filterPanelOpen}
      {onStatusChange}
      {onFilterToggle}
      {onFiltersClear}
      {onFilterPanelToggle}
    />
  </div>
</div>

<style>
  .header { position: relative; z-index: 100; display: flex; align-items: center; gap: var(--sp-4); padding: var(--sp-4) var(--sp-6); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; min-width: 0; }
  .header-right { display: flex; align-items: center; gap: var(--sp-2); margin-left: auto; flex-shrink: 0; }
  .heading { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; flex-shrink: 0; }
  .tabs { display: flex; align-items: center; gap: 2px; background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-md); padding: 2px; position: relative; flex-shrink: 1; min-width: 0; overflow: hidden; }
  .tabs-scroll { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; min-width: 0; flex-shrink: 1; }
  .tabs-scroll::-webkit-scrollbar { display: none; }
  .tab-separator { width: 1px; height: 16px; background: var(--border-dim); flex-shrink: 0; margin: 0 2px; }
  .tab { position: relative; z-index: 1; display: flex; align-items: center; gap: 5px; font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); text-transform: uppercase; padding: 4px 10px; border-radius: var(--radius-sm); border: 1px solid transparent; color: var(--text-faint); white-space: nowrap; transition: background var(--t-base), color var(--t-base), border-color var(--t-base); cursor: grab; flex-shrink: 0; }
  .tab:hover { color: var(--text-muted); }
  .tab.active { background: var(--accent-muted); color: var(--accent-fg); border-color: var(--accent-dim); }
  .tab-dragging { opacity: 0.4; cursor: grabbing; }
  .tab-insert-bar { width: 2px; height: 22px; background: var(--accent); border-radius: 2px; flex-shrink: 0; box-shadow: 0 0 6px var(--accent); pointer-events: none; }
  .tab-count { font-size: var(--text-2xs); opacity: 0.6; }
  .search-wrap { position: relative; display: flex; align-items: center; }
  .search-wrap :global(.search-icon) { position: absolute; left: 10px; color: var(--text-faint); pointer-events: none; }
  .search { background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-md); padding: 5px 10px 5px 28px; color: var(--text-primary); font-size: var(--text-sm); width: 180px; outline: none; transition: border-color var(--t-base); }
  .search::placeholder { color: var(--text-faint); }
  .search:focus { border-color: var(--border-strong); }
  .icon-btn { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: var(--radius-md); border: 1px solid var(--border-dim); background: var(--bg-raised); color: var(--text-faint); cursor: pointer; flex-shrink: 0; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); }
  .icon-btn:hover { color: var(--text-primary); border-color: var(--border-strong); }
  .icon-btn-active { color: var(--accent-fg); border-color: var(--accent-dim); background: var(--accent-muted); }

  .refresh-btn { gap: var(--sp-1); width: auto; padding: 0 8px; }
  .refresh-btn:disabled { cursor: default; }
  .refresh-progress { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); color: var(--accent-fg); }
  .refresh-btn-done { color: var(--color-success, #5cae6e) !important; border-color: color-mix(in srgb, var(--color-success, #5cae6e) 40%, transparent) !important; background: color-mix(in srgb, var(--color-success, #5cae6e) 10%, transparent) !important; }
  .sort-panel-wrap { position: relative; }
  .dropdown-panel { position: absolute; top: calc(100% + 6px); right: 0; z-index: 9999; min-width: 220px; background: var(--bg-raised); border: 1px solid var(--border-base); border-radius: var(--radius-lg); padding: var(--sp-1); box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
  .panel-label { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wider); text-transform: uppercase; color: var(--text-faint); padding: 4px 8px 8px; }
  .panel-item { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 7px 10px; border-radius: var(--radius-sm); border: none; background: transparent; color: var(--text-muted); font-family: var(--font-ui); font-size: var(--text-xs); cursor: pointer; text-align: left; transition: background var(--t-base), color var(--t-base); gap: var(--sp-2); }
  .panel-item:hover { background: var(--bg-overlay); color: var(--text-primary); }
  .panel-item-active { color: var(--accent-fg); background: var(--accent-muted); font-weight: var(--weight-medium, 500); }
  .panel-item-active:hover { background: var(--accent-dim); }
  .panel-divider { height: 1px; background: var(--border-dim); margin: 4px 2px; }
  .panel-header { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px 4px; }
  .panel-heading { font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); color: var(--text-secondary); font-weight: var(--weight-medium, 500); }
  .dir-toggle { color: var(--text-secondary); justify-content: flex-start; gap: var(--sp-2); border-top: 1px solid var(--border-dim); border-radius: 0 0 var(--radius-sm) var(--radius-sm); margin-top: 2px; padding-top: 9px; }
  :global(.sort-caret) { flex-shrink: 0; }
</style>