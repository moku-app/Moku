<script lang="ts">
  import { Play, Pause, Trash, CircleNotch } from "phosphor-svelte";
  import DownloadQueue from "./DownloadQueue.svelte";
  import { downloadStore } from "../store/downloadState.svelte";

  $effect(() => {
    downloadStore.poll();
    const interval = setInterval(() => downloadStore.poll(), 2000);
    return () => clearInterval(interval);
  });
</script>

<div class="root">
  <div class="header">
    <h1 class="heading">Downloads</h1>
    <div class="header-actions">
      <button class="icon-btn" class:loading={downloadStore.togglingPlay}
        onclick={() => downloadStore.togglePlay()}
        disabled={downloadStore.togglingPlay || (downloadStore.queue.length === 0 && !downloadStore.isRunning)}
        title={downloadStore.isRunning ? "Pause" : "Resume"}>
        {#if downloadStore.togglingPlay}<CircleNotch size={14} weight="light" class="anim-spin" />
        {:else if downloadStore.isRunning}<Pause size={14} weight="fill" />
        {:else}<Play size={14} weight="fill" />{/if}
      </button>
      <button class="icon-btn" class:loading={downloadStore.clearing}
        onclick={() => downloadStore.clear()}
        disabled={downloadStore.clearing || downloadStore.queue.length === 0}
        title="Clear queue">
        {#if downloadStore.clearing}<CircleNotch size={14} weight="light" class="anim-spin" />
        {:else}<Trash size={14} weight="regular" />{/if}
      </button>
    </div>
  </div>

  <div class="content">
    <div class="status-bar">
      <div class="status-dot" class:active={downloadStore.isRunning}></div>
      <span class="status-text">
        {downloadStore.togglingPlay
          ? (downloadStore.isRunning ? "Pausing…" : "Starting…")
          : downloadStore.isRunning ? "Downloading" : "Paused"}
      </span>
      <span class="status-count">{downloadStore.queue.length} queued</span>
    </div>

    <DownloadQueue
      queue={downloadStore.queue}
      loading={downloadStore.loading}
      isRunning={downloadStore.isRunning}
      dequeueing={downloadStore.dequeueing}
      onRemove={(id) => downloadStore.dequeue(id)}
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
    transition: color var(--t-base), border-color var(--t-base), background var(--t-base);
  }
  .icon-btn:hover:not(:disabled) { color: var(--text-secondary); border-color: var(--border-strong); background: var(--bg-raised); }
  .icon-btn:disabled { opacity: 0.3; cursor: default; }
  .icon-btn.loading { border-color: var(--accent-dim); color: var(--accent-fg); background: var(--accent-muted); }

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
  .status-count {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--text-faint);
    letter-spacing: var(--tracking-wide);
  }

  @keyframes pulse  { 0%, 100% { opacity: 1 } 50% { opacity: 0.4 } }
  @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
</style>
