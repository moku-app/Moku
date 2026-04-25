<script lang="ts">
  import { Play, Pause, Trash, CircleNotch, ArrowClockwise, Bell, BellSlash, Repeat } from "phosphor-svelte";
  import DownloadQueue from "./DownloadQueue.svelte";
  import { downloadStore } from "../store/downloadState.svelte";
  import { formatEta } from "../lib/downloadQueue";
  import { onMount } from "svelte";

  onMount(() => {
    downloadStore.poll();
  });

  let selectAnchor = $state<number | null>(null);

  function handleSelect(chapterId: number, e: MouseEvent | { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
    const ctrl = e.ctrlKey || e.metaKey;

    if (e.shiftKey && selectAnchor !== null) {
      downloadStore.selectRange(selectAnchor, chapterId);
    } else if (ctrl) {
      downloadStore.toggleSelect(chapterId);
      selectAnchor = chapterId;
    } else {
      if (downloadStore.selected.size > 1) {
        downloadStore.toggleSelect(chapterId);
        selectAnchor = chapterId;
      } else if (downloadStore.selected.size === 1 && downloadStore.selected.has(chapterId)) {
        downloadStore.clearSelection();
        selectAnchor = null;
      } else {
        downloadStore.selectOnly(chapterId);
        selectAnchor = chapterId;
      }
    }
  }

  function handleClickOff() {
    if (downloadStore.selected.size > 0) {
      downloadStore.clearSelection();
      selectAnchor = null;
    }
  }
</script>

<div class="root">
  <div class="header">
    <h1 class="heading">Downloads</h1>
    <div class="header-actions">
      <button
        class="icon-btn"
        class:active={downloadStore.autoRetryEnabled}
        onclick={() => downloadStore.toggleAutoRetry()}
        title={downloadStore.autoRetryEnabled ? "Disable auto-retry" : "Enable auto-retry"}
      >
        <Repeat size={14} weight="regular" />
      </button>
      {#if downloadStore.hasErrored}
        <button
          class="icon-btn"
          onclick={() => downloadStore.retryAllErrored()}
          disabled={downloadStore.batchWorking}
          title="Retry all errored"
        >
          {#if downloadStore.batchWorking}
            <CircleNotch size={14} weight="light" class="anim-spin" />
          {:else}
            <ArrowClockwise size={14} weight="bold" />
          {/if}
        </button>
      {/if}
      <button
        class="icon-btn"
        class:active={downloadStore.toastsEnabled}
        onclick={() => downloadStore.toggleToasts()}
        title={downloadStore.toastsEnabled ? "Mute download notifications" : "Unmute download notifications"}
      >
        {#if downloadStore.toastsEnabled}
          <Bell size={14} weight="regular" />
        {:else}
          <BellSlash size={14} weight="regular" />
        {/if}
      </button>
      <button
        class="icon-btn"
        class:loading={downloadStore.togglingPlay}
        onclick={() => downloadStore.togglePlay()}
        disabled={downloadStore.togglingPlay || (downloadStore.queue.length === 0 && !downloadStore.isRunning)}
        title={downloadStore.isRunning ? "Pause" : "Resume"}
      >
        {#if downloadStore.togglingPlay}<CircleNotch size={14} weight="light" class="anim-spin" />
        {:else if downloadStore.isRunning}<Pause size={14} weight="fill" />
        {:else}<Play size={14} weight="fill" />{/if}
      </button>
      <button
        class="icon-btn"
        class:loading={downloadStore.clearing}
        onclick={() => downloadStore.clear()}
        disabled={downloadStore.clearing || downloadStore.queue.length === 0}
        title="Clear queue"
      >
        {#if downloadStore.clearing}<CircleNotch size={14} weight="light" class="anim-spin" />
        {:else}<Trash size={14} weight="regular" />{/if}
      </button>
    </div>
  </div>

  <div class="content" onclick={handleClickOff}>
    <div class="status-bar">
      <div class="status-dot" class:active={downloadStore.isRunning}></div>
      <span class="status-text">
        {downloadStore.togglingPlay
          ? (downloadStore.isRunning ? "Pausing…" : "Starting…")
          : downloadStore.isRunning ? "Downloading" : "Paused"}
      </span>
      <div class="status-right">
        {#if downloadStore.isRunning && downloadStore.eta !== null}
          <span class="status-eta">{formatEta(downloadStore.eta)} left</span>
        {/if}
        <span class="status-count">{downloadStore.queue.length} queued</span>
      </div>
    </div>

    <DownloadQueue
      queue={downloadStore.queue}
      loading={downloadStore.loading}
      isRunning={downloadStore.isRunning}
      dequeueing={downloadStore.dequeueing}
      selected={downloadStore.selected}
      batchWorking={downloadStore.batchWorking}
      onRemove={(id) => downloadStore.dequeue(id)}
      onRetry={(id) => downloadStore.retryOne(id)}
      onReorder={(id, dir) => downloadStore.reorder(id, dir)}
      onReorderEdge={(id, edge) => downloadStore.reorderToEdge(id, edge)}
      onSelect={handleSelect}
      onClearSelect={() => { downloadStore.clearSelection(); selectAnchor = null; }}
      onBatchRemove={() => downloadStore.dequeueSelected()}
      onBatchRetry={() => downloadStore.retrySelected()}
      onBatchReorder={(dir) => downloadStore.reorderSelected(dir)}
      onBatchReorderEdge={(edge) => downloadStore.reorderSelectedToEdge(edge)}
    />
  </div>
</div>

<style>
  .root {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    animation: fadeIn 0.14s ease both;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-4) var(--sp-6);
    border-bottom: 1px solid var(--border-dim);
    flex-shrink: 0;
  }

  .heading {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: var(--weight-normal);
    color: var(--text-faint);
    letter-spacing: var(--tracking-wider);
    text-transform: uppercase;
  }

  .header-actions { display: flex; gap: var(--sp-2); }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: var(--sp-5) var(--sp-6) var(--sp-6);
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-dim);
    color: var(--text-muted);
    background: none;
    cursor: pointer;
    transition: color var(--t-base), border-color var(--t-base), background var(--t-base);
  }
  .icon-btn:hover:not(:disabled):not(.active) { color: var(--text-secondary); border-color: var(--border-strong); background: var(--bg-raised); }
  .icon-btn.active:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-muted); }
  .icon-btn:disabled { opacity: 0.3; cursor: default; }
  .icon-btn.loading { border-color: var(--accent-dim); color: var(--accent-fg); background: var(--accent-muted); }
  .icon-btn.active  { border-color: var(--accent-dim); color: var(--accent-fg); background: var(--accent-muted); }

  .status-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3);
    background: var(--bg-raised);
    border: 1px solid var(--border-dim);
    border-radius: var(--radius-md);
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-faint);
    flex-shrink: 0;
    transition: background var(--t-base);
  }
  .status-dot.active { background: var(--accent); animation: pulse 1.6s ease infinite; }

  .status-text {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--text-muted);
    flex: 1;
    letter-spacing: var(--tracking-wide);
  }

  .status-right {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
  }

  .status-eta {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--accent-fg);
    letter-spacing: var(--tracking-wide);
    opacity: 0.8;
  }

  .status-count {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--text-faint);
    letter-spacing: var(--tracking-wide);
  }

  @keyframes pulse  { 0%, 100% { opacity: 1 } 50% { opacity: 0.4 } }
  @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
</style>