<script lang="ts">
  import { CircleNotch, ArrowLineUp, ArrowLineDown, ArrowClockwise, X } from "phosphor-svelte";
  import Thumbnail from "@shared/manga/Thumbnail.svelte";
  import ContextMenu from "@shared/ui/ContextMenu.svelte";
  import type { MenuEntry } from "@shared/ui/ContextMenu.svelte";
  import type { DownloadQueueItem } from "@types/index";
  import { pageProgress } from "../lib/downloadQueue";

  interface Props {
    item:               DownloadQueueItem;
    index:              number;
    isActive:           boolean;
    isFirst:            boolean;
    isLast:             boolean;
    isRemoving:         boolean;
    isSelected:         boolean;
    selectedCount:      number;
    selectedErrorCount: number;
    batchWorking:       boolean;
    onRemove:           (chapterId: number) => void;
    onRetry:            (chapterId: number) => void;
    onReorder:          (chapterId: number, dir: "up" | "down") => void;
    onReorderEdge:      (chapterId: number, edge: "top" | "bottom") => void;
    onSelect:           (chapterId: number, e: MouseEvent | { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void;
    onBatchRemove:      () => void;
    onBatchRetry:       () => void;
    onBatchReorder:     (dir: "up" | "down") => void;
    onBatchReorderEdge: (edge: "top" | "bottom") => void;
    onClearSelect:      () => void;
  }

  const {
    item, index, isActive, isFirst, isLast, isRemoving,
    isSelected, selectedCount, selectedErrorCount, batchWorking,
    onRemove, onRetry, onReorder, onReorderEdge, onSelect,
    onBatchRemove, onBatchRetry, onBatchReorder, onBatchReorderEdge, onClearSelect,
  }: Props = $props();

  const manga   = $derived(item.chapter.manga);
  const pages   = $derived(item.chapter.pageCount ?? 0);
  const prog    = $derived(pageProgress(item.progress, pages));
  const isError = $derived(item.state === "ERROR");
  const pct     = $derived(Math.round(item.progress * 100));

  let menuX    = $state(0);
  let menuY    = $state(0);
  let menuOpen = $state(false);

  function openMenu(e: MouseEvent) {
    e.preventDefault();
    menuX = e.clientX;
    menuY = e.clientY;
    menuOpen = true;
  }

  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let touchMoved = false;

  function onTouchStart(e: TouchEvent) {
    touchMoved = false;
    const touch = e.touches[0];
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      if (touchMoved) return;
      if (selectedCount === 0) {
        onSelect(item.chapter.id, { shiftKey: false, ctrlKey: false, metaKey: false });
      } else {
        menuX = touch.clientX;
        menuY = touch.clientY;
        menuOpen = true;
      }
    }, 500);
  }

  function onTouchMove() {
    touchMoved = true;
    cancelLongPress();
  }

  function cancelLongPress() {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  const menuItems = $derived.by<MenuEntry[]>(() => {
    const inBatch = isSelected && selectedCount > 1;
    const entries: MenuEntry[] = [];

    if (inBatch) {
      entries.push({
        label: `Move to top (${selectedCount})`,
        icon: ArrowLineUp,
        onClick: () => onBatchReorderEdge("top"),
        disabled: batchWorking,
      });
      entries.push({
        label: `Move to bottom (${selectedCount})`,
        icon: ArrowLineDown,
        onClick: () => onBatchReorderEdge("bottom"),
        disabled: batchWorking,
      });
      entries.push({ separator: true });
      entries.push({
        label: `Move up (${selectedCount})`,
        icon: ArrowUp,
        onClick: () => onBatchReorder("up"),
        disabled: batchWorking,
      });
      entries.push({
        label: `Move down (${selectedCount})`,
        icon: ArrowDown,
        onClick: () => onBatchReorder("down"),
        disabled: batchWorking,
      });
      entries.push({ separator: true });
      if (selectedErrorCount > 0) {
        entries.push({
          label: `Retry errors (${selectedErrorCount})`,
          icon: ArrowClockwise,
          onClick: onBatchRetry,
          disabled: batchWorking,
        });
      }
      entries.push({
        label: `Remove selected (${selectedCount})`,
        icon: X,
        onClick: onBatchRemove,
        danger: true,
        disabled: batchWorking,
      });
      entries.push({ separator: true });
      entries.push({ label: "Deselect all", onClick: onClearSelect });
    } else {
      if (isError) {
        entries.push({
          label: "Retry",
          icon: ArrowClockwise,
          onClick: () => onRetry(item.chapter.id),
          disabled: isRemoving,
        });
        entries.push({ separator: true });
      }
      entries.push({
        label: "Move to top",
        icon: ArrowLineUp,
        onClick: () => onReorderEdge(item.chapter.id, "top"),
        disabled: isFirst || isActive,
      });
      entries.push({
        label: "Move to bottom",
        icon: ArrowLineDown,
        onClick: () => onReorderEdge(item.chapter.id, "bottom"),
        disabled: isLast || isActive,
      });
      entries.push({ separator: true });
      entries.push({
        label: "Move up",
        icon: ArrowUp,
        onClick: () => onReorder(item.chapter.id, "up"),
        disabled: isFirst || isActive,
      });
      entries.push({
        label: "Move down",
        icon: ArrowDown,
        onClick: () => onReorder(item.chapter.id, "down"),
        disabled: isLast || isActive,
      });
      entries.push({ separator: true });
      entries.push({
        label: "Remove",
        icon: X,
        onClick: () => onRemove(item.chapter.id),
        danger: true,
        disabled: isRemoving || isActive,
      });
    }

    return entries;
  });
</script>

<div
  class="row"
  class:row-active={isActive}
  class:row-error={isError}
  class:row-selected={isSelected}
  class:row-removing={isRemoving}
  onclick={(e) => { e.stopPropagation(); onSelect(item.chapter.id, e); }}
  oncontextmenu={openMenu}
  ontouchstart={onTouchStart}
  ontouchend={cancelLongPress}
  ontouchmove={onTouchMove}
>
  {#if manga?.thumbnailUrl}
    <div class="thumb">
      <Thumbnail src={manga.thumbnailUrl} alt={manga.title} class="thumb-img" />
    </div>
  {/if}

  <div class="info">
    {#if manga?.title}<span class="manga-title">{manga.title}</span>{/if}
    <span class="chapter-name">{item.chapter.name}</span>
    {#if pages > 0}
      <div class="progress-row">
        <div class="progress-wrap">
          <div class="progress-bar" class:progress-error={isError} style="width:{pct}%"></div>
        </div>
        <span class="pages-label">
          {#if isActive}
            {prog.done}/{prog.total}
          {:else if isError}
            failed · {item.tries} {item.tries === 1 ? "try" : "tries"}
          {:else}
            {prog.total}p
          {/if}
        </span>
      </div>
    {/if}
  </div>

  <div class="row-right">
    <span class="state-label" class:state-error={isError}>{item.state}</span>
    <div class="actions">
      {#if isError}
        <button class="action-btn retry" onclick={(e) => { e.stopPropagation(); onRetry(item.chapter.id); }} disabled={isRemoving} title="Retry">
          {#if isRemoving}<CircleNotch size={11} weight="light" class="anim-spin" />{:else}<ArrowClockwise size={11} weight="bold" />{/if}
        </button>
      {/if}
      {#if !isActive}
        <button class="action-btn remove" onclick={(e) => { e.stopPropagation(); onRemove(item.chapter.id); }} disabled={isRemoving} title="Remove">
          {#if isRemoving}<CircleNotch size={11} weight="light" class="anim-spin" />{:else}<X size={12} weight="light" />{/if}
        </button>
      {/if}
    </div>
  </div>
</div>

{#if menuOpen}
  <ContextMenu x={menuX} y={menuY} items={menuItems} onClose={() => (menuOpen = false)} />
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3);
    background: var(--bg-raised);
    border: 1px solid var(--border-dim);
    border-radius: var(--radius-md);
    transition: border-color var(--t-fast), opacity var(--t-base), background var(--t-fast);
    cursor: default;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }

  .row:hover:not(.row-active):not(.row-removing) {
    border-color: var(--border-strong);
    background: var(--bg-elevated);
  }

  .row.row-active   { border-color: var(--accent-dim); }
  .row.row-error    { border-color: color-mix(in srgb, var(--color-error) 30%, transparent); }
  .row.row-selected { background: var(--bg-elevated); border-color: var(--border-strong); }
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
    gap: 4px;
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

  .progress-row {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .progress-wrap {
    flex: 1;
    height: 2px;
    background: var(--border-base);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .progress-bar {
    height: 100%;
    background: var(--accent);
    border-radius: var(--radius-full);
    transition: width 0.4s ease;
    opacity: 0.5;
  }
  .row-active .progress-bar { opacity: 1; }
  .progress-bar.progress-error { background: var(--color-error); opacity: 0.7; }

  .pages-label {
    font-family: var(--font-ui);
    font-size: var(--text-2xs);
    color: var(--text-faint);
    letter-spacing: var(--tracking-wide);
    flex-shrink: 0;
    white-space: nowrap;
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
  .state-label.state-error { color: var(--color-error); opacity: 0.8; }

  .actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: var(--radius-sm);
    color: var(--text-faint);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    transition: color var(--t-base), background var(--t-base);
  }
  .action-btn:hover:not(:disabled) { color: var(--text-secondary); background: var(--bg-overlay); }
  .action-btn:disabled { opacity: 0.25; cursor: default; }
  .action-btn.remove:hover:not(:disabled) { color: var(--color-error); background: var(--color-error-bg); }
  .action-btn.retry:hover:not(:disabled)  { color: var(--accent-fg); background: var(--accent-muted); }
</style>