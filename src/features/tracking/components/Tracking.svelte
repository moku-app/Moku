<script lang="ts">
  import { CircleNotch, ArrowSquareOut, ArrowsClockwise, X, Lock, MagnifyingGlass } from "phosphor-svelte";
  import { gql }              from "@api/client";
  import { addToast, setActiveManga, setNavPage } from "@store/state.svelte";
  import { GET_CHAPTERS }     from "@api/queries/chapters";
  import { store }            from "@store/state.svelte";
  import { trackingState }    from "@features/tracking/store/trackingState.svelte";
  import Thumbnail            from "@shared/manga/Thumbnail.svelte";
  import type { TrackRecord } from "@types/index";
  import type { Chapter }     from "@types/index";
  import {
    flattenRecords, filterRecords, sortRecords, dedupeStatuses,
    scoreToStars, calcProgress,
    type FlatRecord, type SortKey,
  } from "../lib/trackingSync";

  let activeTrackerId = $state<number | "all">("all");
  let statusFilter    = $state<number | "all">("all");
  let searchQuery     = $state("");
  let sortBy          = $state<SortKey>("title");

  let updatingId    = $state<number | null>(null);
  let syncingId     = $state<number | null>(null);
  let editingChapter = $state<number | null>(null);
  let chapterDraft  = $state(0);
  let confirmUnbind = $state<FlatRecord | null>(null);

  $effect(() => {
    if (trackingState.allTrackers.length === 0 && !trackingState.loadingAll) {
      trackingState.loadAll();
    }
  });

  const loggedIn     = $derived(trackingState.allTrackers.filter(t => t.isLoggedIn));
  const allRecords   = $derived(flattenRecords(trackingState.allTrackers));
  const totalCount   = $derived(allRecords.length);

  const statusOptions = $derived(
    activeTrackerId === "all"
      ? dedupeStatuses(trackingState.allTrackers)
      : loggedIn.find(t => t.id === activeTrackerId)?.statuses ?? []
  );

  const filtered = $derived(
    sortRecords(filterRecords(allRecords, activeTrackerId, statusFilter, searchQuery), sortBy)
  );

  function mangaIdForRecord(record: FlatRecord): number | null {
    return record.manga?.id ?? null;
  }

  function prefsForManga(mangaId: number) {
    return store.settings.mangaPrefs?.[mangaId] ?? {};
  }

  async function updateStatus(record: FlatRecord, status: number) {
    const mangaId = mangaIdForRecord(record);
    if (mangaId === null) return;
    updatingId = record.id;
    try {
      await trackingState.updateStatus(mangaId, record, status);
    } catch (e: any) {
      addToast({ kind: "error", title: "Update failed", body: e?.message });
    } finally { updatingId = null; }
  }

  async function updateScore(record: FlatRecord, scoreString: string) {
    const mangaId = mangaIdForRecord(record);
    if (mangaId === null) return;
    updatingId = record.id;
    try {
      await trackingState.updateScore(mangaId, record, scoreString);
    } catch (e: any) {
      addToast({ kind: "error", title: "Update failed", body: e?.message });
    } finally { updatingId = null; }
  }

  async function submitChapter(record: FlatRecord) {
    const val     = Math.max(0, chapterDraft);
    editingChapter = null;
    if (val === record.lastChapterRead) return;

    const mangaId = mangaIdForRecord(record);
    if (mangaId === null) return;
    updatingId = record.id;

    try {
      await trackingState.updateChapterProgress(mangaId, record, val);

      if (store.settings.trackerSyncBack && record.manga?.id) {
        const chapRes = await gql<{ chapters: { nodes: Chapter[] } }>(
          GET_CHAPTERS, { mangaId: record.manga.id }
        );
        await trackingState.syncFromRemote(
          mangaId,
          { ...record, lastChapterRead: val },
          chapRes.chapters.nodes,
          prefsForManga(mangaId),
        );
      }
    } catch (e: any) {
      addToast({ kind: "error", title: "Update failed", body: e?.message });
    } finally { updatingId = null; }
  }

  async function syncRecord(record: FlatRecord) {
    const mangaId = mangaIdForRecord(record);
    if (mangaId === null) return;
    syncingId = record.id;
    try {
      let chapters: Chapter[] = [];
      if (store.settings.trackerSyncBack && record.manga?.id) {
        const res = await gql<{ chapters: { nodes: Chapter[] } }>(
          GET_CHAPTERS, { mangaId: record.manga.id }
        );
        chapters = res.chapters.nodes;
      }

      const { markedIds } = await trackingState.syncFromRemote(
        mangaId, record, chapters, prefsForManga(mangaId)
      );

      const body = markedIds.length > 0
        ? `${markedIds.length} chapter${markedIds.length !== 1 ? "s" : ""} marked read`
        : undefined;
      addToast({ kind: "success", title: "Synced from tracker", body });
    } catch (e: any) {
      addToast({ kind: "error", title: "Sync failed", body: e?.message });
    } finally { syncingId = null; }
  }

  async function unbind(record: FlatRecord) {
    const mangaId = mangaIdForRecord(record);
    if (mangaId === null) return;
    updatingId = record.id;
    try {
      await trackingState.unbind(mangaId, record);
      addToast({ kind: "info", title: `Unlinked from ${record.tracker.name}` });
    } catch (e: any) {
      addToast({ kind: "error", title: "Unbind failed", body: e?.message });
    } finally { updatingId = null; }
  }

  function openManga(record: FlatRecord) {
    if (!record.manga) return;
    setActiveManga(record.manga as any);
    setNavPage("library");
  }

  function openChapterEditor(record: FlatRecord) {
    editingChapter = record.id;
    chapterDraft   = record.lastChapterRead;
  }

  function focusEl(node: HTMLElement) { setTimeout(() => node.focus(), 0); }
</script>

<div class="page">

  <div class="header">
    <div class="header-top">
      <h1 class="heading">Tracking</h1>
      <button class="icon-btn" onclick={() => trackingState.loadAll()} disabled={trackingState.loadingAll} title="Refresh">
        <ArrowsClockwise size={14} weight="light" class={trackingState.loadingAll ? "anim-spin" : ""} />
      </button>
    </div>

    {#if !trackingState.loadingAll && loggedIn.length > 0}
      <div class="tracker-tabs">
        <button
          class="tracker-tab" class:active={activeTrackerId === "all"}
          onclick={() => { activeTrackerId = "all"; statusFilter = "all"; }}
        >
          All
          <span class="tab-pill">{totalCount}</span>
        </button>
        {#each loggedIn as t}
          <button
            class="tracker-tab" class:active={activeTrackerId === t.id}
            onclick={() => { activeTrackerId = Number(t.id); statusFilter = "all"; }}
          >
            <Thumbnail src={t.icon} alt={t.name} class="tab-icon" />
            {t.name}
            <span class="tab-pill">{t.trackRecords.nodes.length}</span>
          </button>
        {/each}
      </div>

      <div class="filter-bar">
        <div class="search-wrap">
          <MagnifyingGlass size={12} weight="light" class="search-ico" />
          <input class="filter-input" placeholder="Search…" bind:value={searchQuery} />
        </div>
        <select class="filter-select" bind:value={statusFilter}
          onchange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            statusFilter = v === "all" ? "all" : parseInt(v);
          }}>
          <option value="all">All statuses</option>
          {#each statusOptions as s}
            <option value={s.value}>{s.name}</option>
          {/each}
        </select>
        <select class="filter-select" bind:value={sortBy}>
          <option value="title">Title</option>
          <option value="status">Status</option>
          <option value="score">Score</option>
          <option value="progress">Progress</option>
        </select>
      </div>
    {/if}
  </div>

  <div class="body">
    {#if trackingState.loadingAll}
      <div class="state">
        <CircleNotch size={18} weight="light" class="anim-spin" style="color:var(--text-faint)" />
      </div>

    {:else if trackingState.error}
      <div class="state">
        <span class="state-error">{trackingState.error}</span>
        <button class="ghost-btn" onclick={() => trackingState.loadAll()}>Retry</button>
      </div>

    {:else if loggedIn.length === 0}
      <div class="state">
        <span class="state-text">No trackers connected.</span>
        <span class="state-hint">Settings → Tracking to connect AniList, MAL, or others.</span>
      </div>

    {:else if filtered.length === 0}
      <div class="state">
        <span class="state-text">{searchQuery || statusFilter !== "all" ? "No results." : "Nothing tracked yet."}</span>
        {#if searchQuery || statusFilter !== "all"}
          <button class="ghost-btn" onclick={() => { searchQuery = ""; statusFilter = "all"; }}>Clear filters</button>
        {/if}
      </div>

    {:else}
      <div class="grid">
        {#each filtered as record (record.tracker.id + ":" + record.id)}
          {@const isBusy    = updatingId === record.id}
          {@const isSyncing = syncingId  === record.id}
          {@const progress  = calcProgress(record.lastChapterRead, record.totalChapters)}
          {@const stars     = scoreToStars(record.displayScore, record.tracker.scores)}

          <div class="card" class:busy={isBusy}>

            <div class="cover-wrap">
              <div class="cover-click"
                role="button" tabindex="0"
                onclick={() => openManga(record)}
                onkeydown={(e) => e.key === "Enter" && openManga(record)}
              >
                {#if record.manga?.thumbnailUrl}
                  <Thumbnail src={record.manga.thumbnailUrl} alt={record.title} class="cover-img" />
                {:else}
                  <div class="cover-empty"></div>
                {/if}
              </div>

              <div class="cover-actions">
                {#if record.private}
                  <span class="cover-btn" title="Private"><Lock size={10} weight="fill" /></span>
                {/if}
                {#if isSyncing}
                  <span class="cover-btn"><CircleNotch size={10} weight="light" class="anim-spin" /></span>
                {:else}
                  <button class="cover-btn" title="Sync from tracker" onclick={() => syncRecord(record)}>
                    <ArrowsClockwise size={10} weight="light" />
                  </button>
                {/if}
                {#if record.remoteUrl}
                  <a href={record.remoteUrl} target="_blank" rel="noreferrer" class="cover-btn" title="Open on {record.tracker.name}">
                    <ArrowSquareOut size={10} weight="light" />
                  </a>
                {/if}
                <button class="cover-btn destroy" title="Unlink" onclick={() => confirmUnbind = record} disabled={isBusy}>
                  <X size={10} weight="bold" />
                </button>
              </div>

              <div class="tracker-badge">
                <Thumbnail src={record.tracker.icon} alt={record.tracker.name} class="badge-img" />
              </div>
            </div>

            <div class="card-body">
              <div class="stars">
                {#each Array(5) as _, i}
                  <span class="star" class:lit={i < stars}>★</span>
                {/each}
              </div>

              <div class="title-block"
                role="button" tabindex="0"
                onclick={() => openManga(record)}
                onkeydown={(e) => e.key === "Enter" && openManga(record)}
              >
                <span class="title">{record.title}</span>
                {#if record.manga?.title && record.manga.title !== record.title}
                  <span class="local-title">{record.manga.title}</span>
                {/if}
              </div>

              <div class="controls-row">
                <select class="status-select"
                  value={record.status} disabled={isBusy}
                  onchange={(e) => updateStatus(record, parseInt((e.target as HTMLSelectElement).value))}>
                  {#each (record.tracker.statuses ?? []) as s}
                    <option value={s.value}>{s.name}</option>
                  {/each}
                </select>
                <select class="score-select"
                  value={record.displayScore} disabled={isBusy}
                  onchange={(e) => updateScore(record, (e.target as HTMLSelectElement).value)}>
                  {#each (record.tracker.scores ?? []) as s}
                    <option value={s}>★ {s}</option>
                  {/each}
                </select>
              </div>

              {#if editingChapter === record.id}
                <div class="chapter-editor" role="presentation" onclick={(e) => e.stopPropagation()}>
                  <div class="chapter-editor-top">
                    <span class="chapter-label">Chapter</span>
                    <div class="chapter-input-row">
                      <input
                        type="number" class="chapter-input"
                        min="0" max={record.totalChapters > 0 ? record.totalChapters : undefined}
                        step="0.5" bind:value={chapterDraft}
                        onkeydown={(e) => {
                          if (e.key === "Enter")  submitChapter(record);
                          if (e.key === "Escape") editingChapter = null;
                        }}
                        use:focusEl
                      />
                      {#if record.totalChapters > 0}
                        <span class="chapter-total">/ {record.totalChapters}</span>
                      {/if}
                    </div>
                  </div>
                  {#if record.totalChapters > 0}
                    <input type="range" class="chapter-slider" min="0" max={record.totalChapters} step="1" bind:value={chapterDraft} />
                  {/if}
                  <div class="chapter-actions">
                    <button class="chapter-cancel" onclick={() => editingChapter = null}>Cancel</button>
                    <button class="chapter-save"   onclick={() => submitChapter(record)}>Save</button>
                  </div>
                </div>
              {:else}
                <div class="progress-block"
                  role="button" tabindex="0"
                  onclick={() => openChapterEditor(record)}
                  onkeydown={(e) => e.key === "Enter" && openChapterEditor(record)}
                >
                  <div class="progress-labels">
                    <span class="progress-text">
                      {#if progress !== null}
                        Ch.&nbsp;{record.lastChapterRead}&thinsp;/&thinsp;{record.totalChapters}
                      {:else if record.lastChapterRead > 0}
                        Ch.&nbsp;{record.lastChapterRead}&nbsp;read
                      {:else}
                        Set chapter…
                      {/if}
                    </span>
                    {#if progress !== null}
                      <span class="progress-pct">{Math.round(progress)}%</span>
                    {/if}
                  </div>
                  <div class="progress-track">
                    <div class="progress-fill" style="width:{progress ?? 0}%"></div>
                  </div>
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

{#if confirmUnbind}
  {@const r = confirmUnbind}
  <div class="modal-backdrop" role="presentation" onclick={() => confirmUnbind = null}>
    <div class="modal" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
      <div class="modal-icon"><X size={16} weight="bold" /></div>
      <p class="modal-title">Unlink from {r.tracker.name}?</p>
      <p class="modal-body">
        <strong>{r.title}</strong> will be removed from your list. Your progress on {r.tracker.name} is unaffected.
      </p>
      <div class="modal-actions">
        <button class="modal-cancel"  onclick={() => confirmUnbind = null}>Cancel</button>
        <button class="modal-confirm" onclick={async () => { const rec = r; confirmUnbind = null; await unbind(rec); }}>Unlink</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .page { display: flex; flex-direction: column; height: 100%; overflow: hidden; animation: fadeIn 0.16s ease both; }

  .header { flex-shrink: 0; border-bottom: 1px solid var(--border-dim); }
  .header-top {
    display: flex; align-items: center; justify-content: space-between;
    padding: var(--sp-4) var(--sp-6) var(--sp-3);
  }
  .heading {
    font-family: var(--font-ui); font-size: var(--text-xs); font-weight: var(--weight-normal);
    color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase;
  }
  .icon-btn {
    display: flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; border-radius: var(--radius-sm);
    color: var(--text-faint); background: none;
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
    display: flex; align-items: center; gap: var(--sp-2);
    padding: 9px 10px 8px;
    font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide);
    color: var(--text-faint); background: none; border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer; white-space: nowrap; margin-bottom: -1px;
    transition: color var(--t-base), border-color var(--t-base);
  }
  .tracker-tab:hover { color: var(--text-muted); }
  .tracker-tab.active { color: var(--text-secondary); border-bottom-color: var(--accent); }
  :global(.tab-icon) { width: 13px; height: 13px; border-radius: 2px; object-fit: contain; opacity: 0.85; }
  .tab-pill {
    font-size: 10px; padding: 0 5px; border-radius: var(--radius-full);
    background: var(--bg-overlay); color: var(--text-faint);
    min-width: 18px; text-align: center; line-height: 17px;
  }
  .tracker-tab.active .tab-pill { background: var(--accent-muted); color: var(--accent-fg); }

  .filter-bar {
    display: flex; align-items: center; gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-5);
    border-top: 1px solid var(--border-dim);
  }
  .search-wrap {
    display: flex; align-items: center; gap: var(--sp-2); flex: 1;
    background: var(--bg-raised); border: 1px solid var(--border-dim);
    border-radius: var(--radius-md); padding: 4px 10px;
  }
  :global(.search-ico) { color: var(--text-faint); flex-shrink: 0; }
  .filter-input {
    flex: 1; background: none; border: none; outline: none;
    font-size: var(--text-sm); color: var(--text-primary); min-width: 0;
  }
  .filter-input::placeholder { color: var(--text-faint); }
  .filter-select {
    font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide);
    padding: 4px 22px 4px 8px; border-radius: var(--radius-sm);
    border: 1px solid var(--border-dim); background: var(--bg-raised);
    color: var(--text-faint); outline: none; cursor: pointer; appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23555' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 6px center;
    transition: border-color var(--t-base), color var(--t-base);
    flex-shrink: 0;
  }
  .filter-select:hover { border-color: var(--border-strong); color: var(--text-muted); }
  .filter-select option { background: var(--bg-surface); color: var(--text-secondary); }

  .body { flex: 1; overflow-y: auto; padding: var(--sp-5); scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent; }

  .state {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: var(--sp-3); height: 100%; text-align: center;
  }
  .state-text  { font-size: var(--text-sm); color: var(--text-muted); }
  .state-hint  { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); max-width: 260px; line-height: 1.5; }
  .state-error { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--color-error); letter-spacing: var(--tracking-wide); }
  .ghost-btn {
    font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide);
    padding: 5px 14px; border-radius: var(--radius-md);
    border: 1px solid var(--border-dim); background: none; color: var(--text-faint); cursor: pointer;
    transition: color var(--t-base), border-color var(--t-base);
  }
  .ghost-btn:hover { color: var(--accent-fg); border-color: var(--accent-dim); }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(178px, 1fr));
    gap: var(--sp-4); align-content: start;
  }

  .card {
    display: flex; flex-direction: column;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-dim);
    background: var(--bg-raised);
    overflow: hidden;
    transition: border-color var(--t-base), transform var(--t-base), opacity var(--t-base);
  }
  .card:hover { border-color: var(--border-strong); transform: translateY(-1px); }
  .card.busy { opacity: 0.35; pointer-events: none; }

  .cover-wrap { position: relative; aspect-ratio: 2/3; flex-shrink: 0; overflow: hidden; background: var(--bg-overlay); }
  .cover-click { position: absolute; inset: 0; cursor: pointer; }
  :global(.cover-img) { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.35s ease, opacity 0.2s ease; }
  .cover-wrap:hover :global(.cover-img) { transform: scale(1.04); opacity: 0.85; }
  .cover-empty { width: 100%; height: 100%; background: var(--bg-overlay); }

  .cover-actions {
    position: absolute; top: 6px; right: 6px; z-index: 2;
    display: flex; gap: 2px; opacity: 0;
    transition: opacity var(--t-base);
  }
  .cover-wrap:hover .cover-actions { opacity: 1; }
  .cover-btn {
    display: flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; border-radius: var(--radius-sm);
    background: rgba(0,0,0,0.55); backdrop-filter: blur(8px);
    border: 1px solid rgba(255,255,255,0.08);
    color: rgba(255,255,255,0.7); cursor: pointer; text-decoration: none;
    transition: background var(--t-base), color var(--t-base);
  }
  .cover-btn:hover { background: rgba(0,0,0,0.75); color: #fff; }
  .cover-btn.destroy:hover { background: rgba(180,40,40,0.65); }
  .cover-btn:disabled { opacity: 0.3; cursor: default; }

  .tracker-badge {
    position: absolute; bottom: 8px; right: 8px; z-index: 2;
    width: 20px; height: 20px; border-radius: 5px;
    border: 1px solid rgba(0,0,0,0.3); background: var(--bg-raised);
    box-shadow: 0 2px 6px rgba(0,0,0,0.5); overflow: hidden;
    display: flex; align-items: center; justify-content: center;
  }
  :global(.badge-img) { width: 100%; height: 100%; object-fit: contain; display: block; }

  .card-body { display: flex; flex-direction: column; gap: 9px; padding: 11px 12px 12px; }

  .stars { display: flex; gap: 2px; align-items: center; }
  .star { font-size: 13px; line-height: 1; color: var(--border-strong); transition: color var(--t-base); }
  .star.lit { color: #f5c518; }

  .title-block {
    display: flex; flex-direction: column; gap: 2px;
    cursor: pointer; min-width: 0;
  }
  .title {
    font-size: var(--text-sm); font-weight: var(--weight-medium);
    color: var(--text-secondary); line-height: 1.38;
    display: -webkit-box; -webkit-line-clamp: 2;
    -webkit-box-orient: vertical; overflow: hidden;
    transition: color var(--t-base);
  }
  .title-block:hover .title { color: var(--accent-fg); }
  .local-title {
    font-family: var(--font-ui); font-size: 10px; color: var(--text-faint);
    letter-spacing: var(--tracking-wide);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  .controls-row { display: flex; align-items: center; gap: var(--sp-1); }
  .status-select {
    flex: 1; min-width: 0;
    font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide);
    padding: 4px 18px 4px 8px; border-radius: var(--radius-full);
    border: 1px solid var(--border-dim); background: var(--bg-overlay);
    color: var(--text-muted); outline: none; cursor: pointer; appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M1 1l3 3 3-3' stroke='%23555' stroke-width='1.3' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 6px center;
    transition: border-color var(--t-base), color var(--t-base);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .status-select:hover:not(:disabled) { border-color: var(--border-strong); color: var(--text-secondary); }
  .status-select:disabled { opacity: 0.35; cursor: default; }
  .status-select option { background: var(--bg-surface); color: var(--text-secondary); }

  .score-select {
    flex-shrink: 0; width: 54px;
    font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide);
    padding: 4px 14px 4px 5px; border-radius: var(--radius-sm);
    border: 1px solid var(--border-dim); background: var(--bg-overlay);
    color: var(--text-faint); outline: none; cursor: pointer; appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M1 1l3 3 3-3' stroke='%23555' stroke-width='1.3' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 4px center;
    transition: border-color var(--t-base), color var(--t-base);
  }
  .score-select:hover:not(:disabled) { border-color: var(--border-strong); color: var(--text-secondary); }
  .score-select:disabled { opacity: 0.35; cursor: default; }
  .score-select option { background: var(--bg-surface); color: var(--text-secondary); }

  .progress-block {
    display: flex; flex-direction: column; gap: 6px;
    padding: 4px 5px; margin: 0 -5px;
    cursor: pointer; border-radius: var(--radius-sm);
    transition: background var(--t-fast);
  }
  .progress-block:hover { background: var(--bg-overlay); }
  .progress-labels { display: flex; align-items: center; justify-content: space-between; }
  .progress-text { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-muted); letter-spacing: var(--tracking-wide); }
  .progress-pct  { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .progress-track { height: 2px; background: var(--border-strong); border-radius: var(--radius-full); overflow: hidden; }
  .progress-fill  { height: 100%; background: var(--accent); border-radius: var(--radius-full); transition: width 0.3s ease; }

  .chapter-editor {
    display: flex; flex-direction: column; gap: var(--sp-2);
    padding: var(--sp-2); border-radius: var(--radius-md);
    border: 1px solid var(--border-dim); background: var(--bg-surface);
  }
  .chapter-editor-top { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); }
  .chapter-label { font-family: var(--font-ui); font-size: 10px; color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .chapter-input-row { display: flex; align-items: center; gap: var(--sp-1); }
  .chapter-input {
    width: 52px; background: var(--bg-raised);
    border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
    padding: 3px 6px; font-family: var(--font-ui); font-size: var(--text-xs);
    color: var(--text-primary); outline: none; text-align: center;
    appearance: none; -moz-appearance: textfield;
  }
  .chapter-input:focus { border-color: var(--accent); }
  .chapter-input::-webkit-outer-spin-button,
  .chapter-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .chapter-total { font-family: var(--font-ui); font-size: 10px; color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .chapter-slider { width: 100%; accent-color: var(--accent); cursor: pointer; height: 3px; }
  .chapter-actions { display: flex; align-items: center; gap: var(--sp-2); justify-content: flex-end; }
  .chapter-save {
    font-family: var(--font-ui); font-size: 10px; letter-spacing: var(--tracking-wide);
    padding: 3px 10px; border-radius: var(--radius-sm);
    border: 1px solid var(--accent-dim); background: var(--accent-muted);
    color: var(--accent-fg); cursor: pointer; transition: filter var(--t-base);
  }
  .chapter-save:hover { filter: brightness(1.15); }
  .chapter-cancel {
    font-family: var(--font-ui); font-size: 10px; letter-spacing: var(--tracking-wide);
    padding: 3px 6px; border-radius: var(--radius-sm);
    border: none; background: none; color: var(--text-faint);
    cursor: pointer; transition: color var(--t-base);
  }
  .chapter-cancel:hover { color: var(--text-muted); }

  .modal-backdrop {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
    animation: fadeIn 0.12s ease both;
  }
  .modal {
    background: var(--bg-surface); border: 1px solid var(--border-dim);
    border-radius: var(--radius-xl); padding: var(--sp-6);
    width: 300px; max-width: calc(100vw - 32px);
    display: flex; flex-direction: column; align-items: center; gap: var(--sp-3);
    box-shadow: 0 24px 60px rgba(0,0,0,0.5);
    animation: modalIn 0.18s cubic-bezier(0.34,1.56,0.64,1) both;
  }
  .modal-icon {
    width: 36px; height: 36px; border-radius: 50%;
    background: rgba(200,50,50,0.1); border: 1px solid rgba(200,50,50,0.2);
    color: var(--color-error); display: flex; align-items: center; justify-content: center;
  }
  .modal-title {
    font-size: var(--text-sm); font-weight: var(--weight-medium);
    color: var(--text-primary); text-align: center; margin: 0;
  }
  .modal-body {
    font-family: var(--font-ui); font-size: var(--text-xs);
    color: var(--text-muted); text-align: center; line-height: 1.5; margin: 0;
  }
  .modal-body strong { color: var(--text-secondary); font-weight: var(--weight-medium); }
  .modal-actions { display: flex; gap: var(--sp-2); width: 100%; margin-top: var(--sp-1); }
  .modal-cancel {
    flex: 1; font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide);
    padding: 8px 0; border-radius: var(--radius-md);
    border: 1px solid var(--border-dim); background: none;
    color: var(--text-muted); cursor: pointer;
    transition: border-color var(--t-base), color var(--t-base);
  }
  .modal-cancel:hover { border-color: var(--border-strong); color: var(--text-primary); }
  .modal-confirm {
    flex: 1; font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide);
    padding: 8px 0; border-radius: var(--radius-md);
    border: 1px solid rgba(200,50,50,0.25); background: rgba(200,50,50,0.08);
    color: var(--color-error); cursor: pointer;
    transition: filter var(--t-base), background var(--t-base);
  }
  .modal-confirm:hover { filter: brightness(1.2); background: rgba(200,50,50,0.16); }

  @keyframes modalIn {
    from { opacity: 0; transform: scale(0.94) translateY(6px); }
    to   { opacity: 1; transform: none; }
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: none; }
  }
</style>