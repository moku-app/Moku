<script lang="ts">
  import { ArrowsClockwise, MagnifyingGlass } from "phosphor-svelte";
  import Thumbnail from "@shared/manga/Thumbnail.svelte";
  import type { SortKey } from "../lib/trackingSync";

  interface Tracker { id: number; name: string; icon: string; trackRecords: { nodes: any[] }; isLoggedIn: boolean; }
  interface StatusOption { value: number; name: string; }

  interface Props {
    loggedIn:       Tracker[];
    totalCount:     number;
    activeTrackerId: number | "all";
    statusFilter:   number | "all";
    statusOptions:  StatusOption[];
    searchQuery:    string;
    sortBy:         SortKey;
    loading:        boolean;
    onRefresh:      () => void;
    onTrackerChange: (id: number | "all") => void;
    onStatusChange: (v: number | "all") => void;
    onSearchChange: (v: string) => void;
    onSortChange:   (v: SortKey) => void;
  }

  let {
    loggedIn, totalCount, activeTrackerId, statusFilter, statusOptions,
    searchQuery, sortBy, loading,
    onRefresh, onTrackerChange, onStatusChange, onSearchChange, onSortChange,
  }: Props = $props();
</script>

<div class="toolbar">
  <div class="toolbar-top">
    <span class="heading">Tracking</span>
    <button class="icon-btn" onclick={onRefresh} disabled={loading} title="Refresh">
      <ArrowsClockwise size={14} weight="bold" class={loading ? "anim-spin" : ""} />
    </button>
  </div>

  {#if !loading && loggedIn.length > 0}
    <div class="tracker-tabs">
      <button
        class="tracker-tab" class:active={activeTrackerId === "all"}
        onclick={() => onTrackerChange("all")}
      >
        All
        <span class="tab-count">{totalCount}</span>
      </button>
      {#each loggedIn as t}
        <button
          class="tracker-tab" class:active={activeTrackerId === t.id}
          onclick={() => onTrackerChange(t.id)}
        >
          <Thumbnail src={t.icon} alt={t.name} class="tab-icon" />
          {t.name}
          <span class="tab-count">{t.trackRecords.nodes.length}</span>
        </button>
      {/each}
    </div>

    <div class="filter-row">
      <div class="search-wrap">
        <MagnifyingGlass size={13} weight="light" class="search-ico" />
        <input
          class="search-input"
          placeholder="Search…"
          value={searchQuery}
          oninput={(e) => onSearchChange((e.target as HTMLInputElement).value)}
        />
      </div>

      <select
        class="pill-select"
        value={statusFilter}
        onchange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          onStatusChange(v === "all" ? "all" : parseInt(v));
        }}
      >
        <option value="all">All statuses</option>
        {#each statusOptions as s}
          <option value={s.value}>{s.name}</option>
        {/each}
      </select>

      <select class="pill-select" value={sortBy} onchange={(e) => onSortChange((e.target as HTMLSelectElement).value as SortKey)}>
        <option value="title">Title</option>
        <option value="status">Status</option>
        <option value="score">Score</option>
        <option value="progress">Progress</option>
      </select>
    </div>
  {/if}
</div>

<style>
  .toolbar { flex-shrink: 0; border-bottom: 1px solid var(--border-dim); }

  .toolbar-top {
    display: flex; align-items: center; justify-content: space-between;
    padding: var(--sp-4) var(--sp-6);
  }
  .heading {
    font-family: var(--font-ui); font-size: var(--text-xs); font-weight: var(--weight-normal);
    color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase;
  }
  .icon-btn {
    display: flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; border-radius: var(--radius-sm);
    color: var(--text-faint); background: none; border: none; cursor: pointer;
    transition: color var(--t-base), background var(--t-base);
  }
  .icon-btn:hover:not(:disabled) { color: var(--text-muted); background: var(--bg-raised); }
  .icon-btn:disabled { opacity: 0.3; cursor: default; }

  .tracker-tabs {
    display: flex; align-items: center; gap: 1px;
    padding: 0 var(--sp-5); overflow-x: auto; scrollbar-width: none;
  }
  .tracker-tabs::-webkit-scrollbar { display: none; }

  .tracker-tab {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 10px 7px;
    font-family: var(--font-ui); font-size: var(--text-2xs);
    letter-spacing: var(--tracking-wider); text-transform: uppercase;
    color: var(--text-faint); background: none; border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer; white-space: nowrap; margin-bottom: -1px;
    transition: color var(--t-base), border-color var(--t-base);
  }
  .tracker-tab:hover { color: var(--text-muted); }
  .tracker-tab.active { color: var(--text-secondary); border-bottom-color: var(--accent); }
  :global(.tab-icon) { width: 13px; height: 13px; border-radius: 2px; object-fit: contain; opacity: 0.8; }

  .tab-count {
    font-size: 10px; padding: 1px 5px; border-radius: var(--radius-full);
    background: var(--bg-overlay); color: var(--text-faint); line-height: 15px;
  }
  .tracker-tab.active .tab-count { background: var(--accent-muted); color: var(--accent-fg); }

  .filter-row {
    display: flex; align-items: center; gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-5) var(--sp-3);
  }
  .search-wrap {
    flex: 1; display: flex; align-items: center; gap: var(--sp-2);
    background: var(--bg-raised); border: 1px solid var(--border-dim);
    border-radius: var(--radius-md); padding: 5px 10px;
    transition: border-color var(--t-base);
  }
  .search-wrap:focus-within { border-color: var(--border-strong); }
  :global(.search-ico) { color: var(--text-faint); flex-shrink: 0; }
  .search-input {
    flex: 1; background: none; border: none; outline: none; min-width: 0;
    font-size: var(--text-sm); color: var(--text-primary);
  }
  .search-input::placeholder { color: var(--text-faint); }

  .pill-select {
    flex-shrink: 0;
    font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide);
    padding: 5px 22px 5px 9px; border-radius: var(--radius-md);
    border: 1px solid var(--border-dim); background: var(--bg-raised);
    color: var(--text-faint); outline: none; cursor: pointer; appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M1 1l3 3 3-3' stroke='%23555' stroke-width='1.3' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 7px center;
    transition: border-color var(--t-base), color var(--t-base);
  }
  .pill-select:hover { border-color: var(--border-strong); color: var(--text-muted); }
  .pill-select option { background: var(--bg-surface); color: var(--text-secondary); }
</style>