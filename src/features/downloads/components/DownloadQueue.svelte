<script lang="ts">
  import { CircleNotch } from "phosphor-svelte";
  import DownloadItem from "./DownloadItem.svelte";
  import type { DownloadQueueItem } from "@types/index";

  interface Props {
    queue:        DownloadQueueItem[];
    loading:      boolean;
    isRunning:    boolean;
    dequeueing:   Set<number>;
    selected:     Set<number>;
    batchWorking: boolean;
    onRemove:     (chapterId: number) => void;
    onRetry:      (chapterId: number) => void;
    onReorder:    (chapterId: number, dir: "up" | "down") => void;
    onSelect:     (chapterId: number, e: MouseEvent) => void;
    onClearSelect: () => void;
    onBatchRemove: () => void;
    onBatchRetry:  () => void;
    onBatchReorder: (dir: "up" | "down") => void;
  }

  const {
    queue, loading, isRunning, dequeueing, selected, batchWorking,
    onRemove, onRetry, onReorder, onSelect, onClearSelect,
    onBatchRemove, onBatchRetry, onBatchReorder,
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
        {onSelect}
        {onClearSelect}
        {onBatchRemove}
        {onBatchRetry}
        {onBatchReorder}
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