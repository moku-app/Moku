<script lang="ts">
  import { Play, Pause, Trash, CircleNotch, X } from "phosphor-svelte";
  import { gql, thumbUrl } from "../../lib/client";
  import { GET_DOWNLOAD_STATUS, START_DOWNLOADER, STOP_DOWNLOADER, CLEAR_DOWNLOADER, DEQUEUE_DOWNLOAD } from "../../lib/queries";
  import { store, setActiveDownloads } from "../../store/state.svelte";
  import type { DownloadStatus } from "../../lib/types";

  let status: DownloadStatus | null = $state(null);
  let loading                       = $state(true);
  let togglingPlay                  = $state(false);
  let clearing                      = $state(false);
  let dequeueing = $state(new Set<number>());
  let interval: ReturnType<typeof setInterval>;

  function applyStatus(ds: DownloadStatus) {
    status = ds;
    setActiveDownloads(ds.queue.map((item) => ({
      chapterId: item.chapter.id,
      mangaId:   item.chapter.mangaId,
      progress:  item.progress,
    })));
  }

  async function poll() {
    gql<{ downloadStatus: DownloadStatus }>(GET_DOWNLOAD_STATUS)
      .then((d) => applyStatus(d.downloadStatus))
      .catch(console.error)
      .finally(() => loading = false);
  }

  $effect(() => { poll(); interval = setInterval(poll, 2000); return () => clearInterval(interval); });

  async function togglePlay() {
    if (togglingPlay) return;
    togglingPlay = true;
    const wasRunning = status?.state === "STARTED";
    if (status) status = { ...status, state: wasRunning ? "STOPPED" : "STARTED" };
    try {
      if (wasRunning) {
        const d = await gql<{ stopDownloader: { downloadStatus: DownloadStatus } }>(STOP_DOWNLOADER);
        applyStatus(d.stopDownloader.downloadStatus);
      } else {
        const d = await gql<{ startDownloader: { downloadStatus: DownloadStatus } }>(START_DOWNLOADER);
        applyStatus(d.startDownloader.downloadStatus);
      }
    } catch (e) { console.error(e); poll(); }
    finally { togglingPlay = false; }
  }

  async function clear() {
    if (clearing) return;
    clearing = true;
    if (status) status = { ...status, queue: [] };
    setActiveDownloads([]);
    try {
      const d = await gql<{ clearDownloader: { downloadStatus: DownloadStatus } }>(CLEAR_DOWNLOADER);
      applyStatus(d.clearDownloader.downloadStatus);
    } catch (e) { console.error(e); poll(); }
    finally { clearing = false; }
  }

  async function dequeue(chapterId: number) {
    if (dequeueing.has(chapterId)) return;
    dequeueing = new Set(dequeueing).add(chapterId);
    if (status) status = { ...status, queue: status.queue.filter((i) => i.chapter.id !== chapterId) };
    try { await gql(DEQUEUE_DOWNLOAD, { chapterId }); poll(); }
    catch (e) { console.error(e); poll(); }
    finally { dequeueing.delete(chapterId); dequeueing = new Set(dequeueing); }
  }
  let queue = $derived(status?.queue ?? []);
  const isRunning = $derived(status?.state === "STARTED");
</script>

<div class="root">
  <div class="header">
    <h1 class="heading">Downloads</h1>
    <div class="header-actions">
      <button class="icon-btn" class:loading={togglingPlay} onclick={togglePlay}
        disabled={togglingPlay || (queue.length === 0 && !isRunning)} title={isRunning ? "Pause" : "Resume"}>
        {#if togglingPlay}<CircleNotch size={14} weight="light" class="anim-spin" />
        {:else if isRunning}<Pause size={14} weight="fill" />
        {:else}<Play size={14} weight="fill" />{/if}
      </button>
      <button class="icon-btn" class:loading={clearing} onclick={clear}
        disabled={clearing || queue.length === 0} title="Clear queue">
        {#if clearing}<CircleNotch size={14} weight="light" class="anim-spin" />
        {:else}<Trash size={14} weight="regular" />{/if}
      </button>
    </div>
  </div>

  <div class="status-bar">
    <div class="status-dot" class:active={isRunning}></div>
    <span class="status-text">
      {togglingPlay ? (isRunning ? "Pausing…" : "Starting…") : isRunning ? "Downloading" : "Paused"}
    </span>
    <span class="status-count">{queue.length} queued</span>
  </div>

  {#if loading}
    <div class="empty"><CircleNotch size={16} weight="light" class="anim-spin" style="color:var(--text-faint)" /></div>
  {:else if queue.length === 0}
    <div class="empty">Queue is empty.</div>
  {:else}
    <div class="list">
      {#each queue as item, i (item.chapter.id)}
        {@const isActive   = i === 0 && isRunning}
        {@const pages      = item.chapter.pageCount ?? 0}
        {@const done       = Math.round(item.progress * pages)}
        {@const manga      = item.chapter.manga}
        {@const isRemoving = dequeueing.has(item.chapter.id)}
        <div class="row" class:row-active={isActive} class:row-removing={isRemoving}>
          {#if manga?.thumbnailUrl}
            <div class="thumb">
              <img src={thumbUrl(manga.thumbnailUrl)} alt={manga?.title} class="thumb-img" loading="lazy" decoding="async" />
            </div>
          {/if}
          <div class="info">
            {#if manga?.title}<span class="manga-title">{manga.title}</span>{/if}
            <span class="chapter-name">{item.chapter.name}</span>
            {#if pages > 0}
              <span class="pages-label">{isActive ? `${done} / ${pages} pages` : `${pages} pages`}</span>
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
              <button class="remove-btn" onclick={() => dequeue(item.chapter.id)} disabled={isRemoving} title="Remove from queue">
                {#if isRemoving}<CircleNotch size={11} weight="light" class="anim-spin" />{:else}<X size={12} weight="light" />{/if}
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .root { padding: var(--sp-6); overflow-y: auto; height: 100%; animation: fadeIn 0.14s ease both; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--sp-5); }
  .heading { font-family: var(--font-ui); font-size: var(--text-xs); font-weight: var(--weight-normal); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; }
  .header-actions { display: flex; gap: var(--sp-2); }
  .icon-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--radius-md); border: 1px solid var(--border-dim); color: var(--text-muted); transition: color var(--t-base), border-color var(--t-base), background var(--t-base); }
  .icon-btn:hover:not(:disabled) { color: var(--text-secondary); border-color: var(--border-strong); background: var(--bg-raised); }
  .icon-btn:disabled { opacity: 0.3; cursor: default; }
  .icon-btn.loading { border-color: var(--accent-dim); color: var(--accent-fg); background: var(--accent-muted); }
  .status-bar { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3); background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-md); margin-bottom: var(--sp-4); }
  .status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-faint); flex-shrink: 0; transition: background var(--t-base); }
  .status-dot.active { background: var(--accent); animation: pulse 1.6s ease infinite; }
  @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }
  .status-text { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-muted); flex: 1; letter-spacing: var(--tracking-wide); }
  .status-count { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .list { display: flex; flex-direction: column; gap: var(--sp-2); }
  .row { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3); background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-md); transition: border-color var(--t-fast), opacity var(--t-base); }
  .row.row-active { border-color: var(--accent-dim); }
  .row.row-removing { opacity: 0.4; pointer-events: none; }
  .thumb { width: 36px; height: 54px; border-radius: var(--radius-sm); overflow: hidden; background: var(--bg-overlay); flex-shrink: 0; border: 1px solid var(--border-dim); }
  .thumb-img { width: 100%; height: 100%; object-fit: cover; }
  .info { flex: 1; display: flex; flex-direction: column; gap: 3px; overflow: hidden; min-width: 0; }
  .manga-title { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chapter-name { font-size: var(--text-xs); color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pages-label { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .progress-wrap { height: 2px; background: var(--border-base); border-radius: var(--radius-full); overflow: hidden; margin-top: 4px; }
  .progress-bar { height: 100%; background: var(--accent); border-radius: var(--radius-full); transition: width 0.4s ease; }
  .row-right { display: flex; flex-direction: column; align-items: flex-end; gap: var(--sp-1); flex-shrink: 0; }
  .state-label { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; }
  .remove-btn { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: var(--radius-sm); color: var(--text-faint); transition: color var(--t-base), background var(--t-base); }
  .remove-btn:hover:not(:disabled) { color: var(--color-error); background: var(--color-error-bg); }
  .remove-btn:disabled { opacity: 0.5; cursor: default; }
  .empty { display: flex; align-items: center; justify-content: center; height: 160px; color: var(--text-faint); font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); }
</style>
