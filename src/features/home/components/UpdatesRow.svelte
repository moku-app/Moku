<script lang="ts">
  import { Bell, ArrowRight } from "phosphor-svelte";
  import Thumbnail from "@shared/manga/Thumbnail.svelte";
  import type { Manga } from "@types";
  import { timeAgoRefresh, handleRowWheel } from "../lib/homeHelpers";

  interface LibraryUpdate {
    mangaId: number;
    mangaTitle: string;
    thumbnailUrl: string;
    newChapters: number;
  }

  let {
    updates,
    libraryManga,
    lastRefresh,
    onopen,
    onclear,
  }: {
    updates: LibraryUpdate[];
    libraryManga: Manga[];
    lastRefresh: number;
    onopen: (m: Manga | undefined) => void;
    onclear: () => void;
  } = $props();
</script>

<div class="col">
  <div class="col-header">
    <span class="col-title">
      <Bell size={10} weight="bold" /> Updates
      {#if lastRefresh}<span class="refresh-age">{timeAgoRefresh(lastRefresh)}</span>{/if}
    </span>
    {#if updates.length > 0}
      <button class="action-btn" onclick={onclear}>
        Clear <ArrowRight size={9} weight="bold" />
      </button>
    {/if}
  </div>

  {#if updates.length > 0}
    <div class="scroll-row" onwheel={(e) => { e.preventDefault(); handleRowWheel(e); }}>
      {#each updates as u (u.mangaId)}
        {@const m = libraryManga.find(x => x.id === u.mangaId)}
        <button class="card" onclick={() => onopen(m)}>
          <div class="card-cover-wrap">
            <Thumbnail src={u.thumbnailUrl} alt={u.mangaTitle} class="card-cover" />
            <div class="card-gradient"></div>
            <div class="card-footer">
              <p class="card-title">{u.mangaTitle}</p>
              <p class="card-badge">+{u.newChapters} chapter{u.newChapters !== 1 ? "s" : ""}</p>
            </div>
          </div>
        </button>
      {/each}
    </div>
  {:else}
    <p class="empty-msg">{lastRefresh ? "No new chapters found" : "Check for updates in the library"}</p>
  {/if}
</div>

<style>
  .col { display: flex; flex-direction: column; min-width: 0; }

  .col-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: var(--sp-2);
  }
  .col-title {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    font-family: var(--font-ui);
    font-size: var(--text-2xs);
    color: var(--text-faint);
    letter-spacing: var(--tracking-wider);
    text-transform: uppercase;
  }
  .refresh-age {
    font-family: var(--font-ui);
    font-size: var(--text-2xs);
    color: var(--text-faint);
    letter-spacing: var(--tracking-wide);
    margin-left: var(--sp-2);
  }
  .action-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--text-faint);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    transition: color var(--t-base);
  }
  .action-btn:hover { color: var(--accent-fg); }

  .scroll-row {
    display: flex;
    flex-direction: row;
    gap: var(--sp-3);
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    padding-bottom: var(--sp-1);
  }
  .scroll-row::-webkit-scrollbar { display: none; }

  .card {
    flex: 0 0 112px;
    width: 112px;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
  }
  .card:hover :global(.card-cover) { filter: brightness(1.1) saturate(1.05); transform: scale(1.02); }

  .card-cover-wrap {
    position: relative;
    aspect-ratio: 2 / 3;
    overflow: hidden;
    border-radius: var(--radius-md);
    background: var(--bg-raised);
    border: 1px solid var(--border-dim);
    box-shadow: 0 2px 14px rgba(0, 0, 0, 0.38);
  }
  :global(.card-cover) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: filter 0.15s ease, transform 0.15s ease;
  }
  .card-gradient {
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.08) 55%, transparent 75%);
    pointer-events: none;
  }
  .card-footer {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: var(--sp-2);
    pointer-events: none;
  }
  .card-title {
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: rgba(255,255,255,0.92);
    line-height: var(--leading-snug);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-shadow: 0 1px 4px rgba(0,0,0,0.7);
  }
  .card-badge {
    font-family: var(--font-ui);
    font-size: 9px;
    color: rgba(255,255,255,0.45);
    letter-spacing: var(--tracking-wide);
    margin-top: 1px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .empty-msg {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--text-faint);
    letter-spacing: var(--tracking-wide);
    padding: var(--sp-1) 0;
  }
</style>
