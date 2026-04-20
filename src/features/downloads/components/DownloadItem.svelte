<script lang="ts">
  import { CircleNotch, X } from "phosphor-svelte";
  import Thumbnail from "@shared/manga/Thumbnail.svelte";
  import type { DownloadQueueItem } from "@types/index";
  import { pageProgress } from "../lib/downloadQueue";

  interface Props {
    item:       DownloadQueueItem;
    isActive:   boolean;
    isRemoving: boolean;
    onRemove:   (chapterId: number) => void;
  }

  const { item, isActive, isRemoving, onRemove }: Props = $props();

  const manga  = $derived(item.chapter.manga);
  const pages  = $derived(item.chapter.pageCount ?? 0);
  const prog   = $derived(pageProgress(item.progress, pages));
</script>

<div class="row" class:row-active={isActive} class:row-removing={isRemoving}>
  {#if manga?.thumbnailUrl}
    <div class="thumb">
      <Thumbnail src={manga.thumbnailUrl} alt={manga.title} class="thumb-img" />
    </div>
  {/if}
  <div class="info">
    {#if manga?.title}<span class="manga-title">{manga.title}</span>{/if}
    <span class="chapter-name">{item.chapter.name}</span>
    {#if pages > 0}
      <span class="pages-label">{isActive ? `${prog.done} / ${prog.total} pages` : `${prog.total} pages`}</span>
    {/if}
    {#if isActive}
      <div class="progress-wrap">
        <div class="progress-bar" style="width:{Math.round(item.progress * 100)}%"></div>
      </div>
    {/if}
  </div>
  <div class="row-right">
    <span class="state-label">{item.state}</span>
    {#if !isActive}
      <button class="remove-btn" onclick={() => onRemove(item.chapter.id)} disabled={isRemoving} title="Remove from queue">
        {#if isRemoving}<CircleNotch size={11} weight="light" class="anim-spin" />{:else}<X size={12} weight="light" />{/if}
      </button>
    {/if}
  </div>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3);
    background: var(--bg-raised);
    border: 1px solid var(--border-dim);
    border-radius: var(--radius-md);
    transition: border-color var(--t-fast), opacity var(--t-base);
  }
  .row.row-active  { border-color: var(--accent-dim); }
  .row.row-removing { opacity: 0.4; pointer-events: none; }

  .thumb {
    width: 36px;
    height: 54px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--bg-overlay);
    flex-shrink: 0;
    border: 1px solid var(--border-dim);
  }
  :global(.thumb-img) { width: 100%; height: 100%; object-fit: cover; }

  .info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    overflow: hidden;
    min-width: 0;
  }
  .manga-title {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chapter-name {
    font-size: var(--text-xs);
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pages-label {
    font-family: var(--font-ui);
    font-size: var(--text-2xs);
    color: var(--text-faint);
    letter-spacing: var(--tracking-wide);
  }

  .progress-wrap {
    height: 2px;
    background: var(--border-base);
    border-radius: var(--radius-full);
    overflow: hidden;
    margin-top: 4px;
  }
  .progress-bar {
    height: 100%;
    background: var(--accent);
    border-radius: var(--radius-full);
    transition: width 0.4s ease;
  }

  .row-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--sp-1);
    flex-shrink: 0;
  }
  .state-label {
    font-family: var(--font-ui);
    font-size: var(--text-2xs);
    color: var(--text-faint);
    letter-spacing: var(--tracking-wider);
    text-transform: uppercase;
  }

  .remove-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: var(--radius-sm);
    color: var(--text-faint);
    transition: color var(--t-base), background var(--t-base);
  }
  .remove-btn:hover:not(:disabled) { color: var(--color-error); background: var(--color-error-bg); }
  .remove-btn:disabled { opacity: 0.5; cursor: default; }
</style>
