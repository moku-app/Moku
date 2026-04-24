<script lang="ts">
  import { CircleNotch } from "phosphor-svelte";
  import DownloadItem from "./DownloadItem.svelte";
  import type { DownloadQueueItem } from "@types/index";

  interface Props {
    queue:              DownloadQueueItem[];
    loading:            boolean;
    isRunning:          boolean;
    dequeueing:         Set<number>;
    selected:           Set<number>;
    batchWorking:       boolean;
    onRemove:           (chapterId: number) => void;
    onRetry:            (chapterId: number) => void;
    onReorder:          (chapterId: number, dir: "up" | "down") => void;
    onReorderEdge:      (chapterId: number, edge: "top" | "bottom") => void;
    onSelect:           (chapterId: number, e: MouseEvent) => void;
    onClearSelect:      () => void;
    onBatchRemove:      () => void;
    onBatchRetry:       () => void;
    onBatchReorder:     (dir: "up" | "down") => void;
    onBatchReorderEdge: (edge: "top" | "bottom") => void;
  }

  const {
    queue, loading, isRunning, dequeueing, selected, batchWorking,
    onRemove, onRetry, onReorder, onReorderEdge, onSelect, onClearSelect,
    onBatchRemove, onBatchRetry, onBatchReorder, onBatchReorderEdge,
  }: Props = $props();

  const selectedErrorCount = $derived(
    queue.filter((i) => selected.has(i.chapter.id) && i.state === "ERROR").length,
  );
</script>

{#if loading}
  <div class="empty">
    <CircleNotch size={16} weight="light" class="anim-spin" style="color:var(--text-faint)" />
  </div>
{:else if queue.length === 0}
  <div class="empty">Queue is empty.</div>
{:else}
  <div class="list">
    <div class="list-header">
      <div class="info-wrap">
        <button class="info-btn" tabindex="-1" aria-label="Selection help">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <circle cx="6" cy="6" r="5.25" stroke="currentColor" stroke-width="1.5"/>
            <rect x="5.25" y="5" width="1.5" height="3.5" rx="0.75" fill="currentColor"/>
            <circle cx="6" cy="3.25" r="0.85" fill="currentColor"/>
          </svg>
        </button>
        <div class="info-popover" role="tooltip">
          <span>Click to select</span>
          <span>Shift+click to range select</span>
          <span>Ctrl+click to toggle</span>
        </div>
      </div>
    </div>
    {#each queue as item, i (item.chapter.id)}
      <DownloadItem
        {item}
        index={i}
        isActive={i === 0 && isRunning}
        isFirst={i === 0}
        isLast={i === queue.length - 1}
        isRemoving={dequeueing.has(item.chapter.id)}
        isSelected={selected.has(item.chapter.id)}
        selectedCount={selected.size}
        {selectedErrorCount}
        {batchWorking}
        {onRemove}
        {onRetry}
        {onReorder}
        {onReorderEdge}
        {onSelect}
        {onClearSelect}
        {onBatchRemove}
        {onBatchRetry}
        {onBatchReorder}
        {onBatchReorderEdge}
      />
    {/each}
  </div>
{/if}

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }

  .list-header {
    display: flex;
    justify-content: flex-end;
    padding: 0 var(--sp-1);
  }

  .info-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .info-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    background: none;
    padding: 0;
    cursor: default;
    color: var(--text-faint);
    border-radius: var(--radius-sm);
    transition: color var(--t-base);
  }
  .info-btn:hover { color: var(--text-muted); }

  .info-popover {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    background: var(--bg-overlay);
    border: 1px solid var(--border-dim);
    border-radius: var(--radius-md);
    padding: var(--sp-2) var(--sp-3);
    display: none;
    flex-direction: column;
    gap: 4px;
    white-space: nowrap;
    z-index: 50;
    pointer-events: none;
  }

  .info-popover span {
    font-family: var(--font-ui);
    font-size: var(--text-2xs);
    color: var(--text-faint);
    letter-spacing: var(--tracking-wide);
  }

  .info-wrap:hover .info-popover { display: flex; }

  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 160px;
    color: var(--text-faint);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide);
  }
</style>