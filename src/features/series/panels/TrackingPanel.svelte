<script lang="ts">
  import { CircleNotch, X, MagnifyingGlass, ArrowSquareOut, Lock, LockOpen, ArrowsClockwise, ArrowLineDown } from "phosphor-svelte";
  import { gql }        from "@api/client";
  import Thumbnail      from "@shared/manga/Thumbnail.svelte";
  import { GET_TRACKERS, GET_MANGA_TRACK_RECORDS, SEARCH_TRACKER } from "@api/queries/tracking";
  import { BIND_TRACK, UPDATE_TRACK, UNBIND_TRACK, FETCH_TRACK } from "@api/mutations/tracking";
  import { GET_CHAPTERS } from "@api/queries/chapters";
  import { addToast, store } from "@store/state.svelte";
  import { syncBackFromTracker } from "@features/tracking/lib/trackingSync";
  import type { Tracker, TrackRecord, TrackSearch } from "@types";
  import type { Chapter } from "@types/index";

  let { mangaId, mangaTitle, onClose }: {
    mangaId:    number;
    mangaTitle: string;
    onClose:    () => void;
  } = $props();

  type TabId = "records" | number;

  let trackers:    Tracker[]     = $state([]);
  let records:     TrackRecord[] = $state([]);
  let loading:     boolean       = $state(true);
  let activeTab:   TabId         = $state("records");

  let searchQuery:   string        = $state("");
  let searchResults: TrackSearch[] = $state([]);
  let searching:     boolean       = $state(false);
  let searchInited:  Set<number>   = $state(new Set());

  let binding:        boolean       = $state(false);
  let updatingRecord: number | null = $state(null);
  let syncing:        number | null = $state(null);
  let editingChapter: number | null = $state(null);
  let chapterDraft:   number        = $state(0);
  let applyingRecord: number | null = $state(null);

  const loggedInTrackers = $derived(trackers.filter(t => t.isLoggedIn));

  function autoFocus(node: HTMLElement) { setTimeout(() => node.focus(), 50); }

  async function load() {
    loading = true;
    try {
      const [tRes, rRes] = await Promise.all([
        gql<{ trackers: { nodes: Tracker[] } }>(GET_TRACKERS),
        gql<{ manga: { trackRecords: { nodes: TrackRecord[] } } }>(GET_MANGA_TRACK_RECORDS, { mangaId }),
      ]);
      trackers = tRes.trackers.nodes;
      records  = rRes.manga.trackRecords.nodes;
    } catch (e: any) {
      addToast({ kind: "error", title: "Failed to load tracking", body: e?.message });
    } finally {
      loading = false;
    }
  }

  $effect(() => { load(); });

  $effect(() => {
    const tab = activeTab;
    if (typeof tab !== "number") return;
    if (searchInited.has(tab)) return;
    searchQuery  = mangaTitle;
    searchInited = new Set([...searchInited, tab]);
    doSearch(tab, mangaTitle);
  });

  function trackerFor(id: number)       { return trackers.find(t => t.id === id); }
  function recordFor(trackerId: number) { return records.find(r => r.trackerId === trackerId); }

  let searchTimer: ReturnType<typeof setTimeout>;

  function onSearchInput() {
    clearTimeout(searchTimer);
    if (typeof activeTab !== "number") return;
    const tid = activeTab;
    if (!searchQuery.trim()) { searchResults = []; return; }
    searchTimer = setTimeout(() => doSearch(tid, searchQuery), 400);
  }

  async function doSearch(trackerId: number, query: string) {
    if (!query.trim()) return;
    searching = true; searchResults = [];
    try {
      const res = await gql<{ searchTracker: { trackSearches: TrackSearch[] } }>(
        SEARCH_TRACKER, { trackerId, query: query.trim() }
      );
      searchResults = res.searchTracker.trackSearches;
    } catch (e: any) {
      addToast({ kind: "error", title: "Search failed", body: e?.message });
    } finally {
      searching = false;
    }
  }

  async function bind(result: TrackSearch) {
    if (typeof activeTab !== "number") return;
    binding = true;
    try {
      const res = await gql<{ bindTrack: { trackRecord: TrackRecord } }>(
        BIND_TRACK, { mangaId, trackerId: activeTab, remoteId: result.remoteId }
      );
      records   = [...records.filter(r => r.trackerId !== activeTab), res.bindTrack.trackRecord];
      activeTab = "records";
      addToast({ kind: "success", title: "Now tracking", body: result.title });
    } catch (e: any) {
      addToast({ kind: "error", title: "Failed to bind", body: e?.message });
    } finally {
      binding = false;
    }
  }

  async function unbind(record: TrackRecord) {
    updatingRecord = record.id;
    try {
      await gql(UNBIND_TRACK, { recordId: record.id });
      records = records.filter(r => r.id !== record.id);
      addToast({ kind: "info", title: "Unlinked from " + trackerFor(record.trackerId)?.name });
    } catch (e: any) {
      addToast({ kind: "error", title: "Failed to unlink", body: e?.message });
    } finally {
      updatingRecord = null;
    }
  }

  function patchRecord(updated: Partial<TrackRecord> & { id: number }) {
    records = records.map(r => r.id === updated.id ? { ...r, ...updated } : r);
  }

  async function updateStatus(record: TrackRecord, status: number) {
    updatingRecord = record.id;
    try {
      const res = await gql<{ updateTrack: { trackRecord: TrackRecord } }>(UPDATE_TRACK, { recordId: record.id, status });
      patchRecord(res.updateTrack.trackRecord);
    } catch (e: any) {
      addToast({ kind: "error", title: "Update failed", body: e?.message });
    } finally {
      updatingRecord = null;
    }
  }

  async function updateScore(record: TrackRecord, scoreString: string) {
    updatingRecord = record.id;
    try {
      const res = await gql<{ updateTrack: { trackRecord: TrackRecord } }>(UPDATE_TRACK, { recordId: record.id, scoreString });
      patchRecord(res.updateTrack.trackRecord);
    } catch (e: any) {
      addToast({ kind: "error", title: "Update failed", body: e?.message });
    } finally {
      updatingRecord = null;
    }
  }

  async function togglePrivate(record: TrackRecord) {
    updatingRecord = record.id;
    try {
      const res = await gql<{ updateTrack: { trackRecord: TrackRecord } }>(UPDATE_TRACK, { recordId: record.id, private: !record.private });
      patchRecord(res.updateTrack.trackRecord);
    } catch (e: any) {
      addToast({ kind: "error", title: "Update failed", body: e?.message });
    } finally {
      updatingRecord = null;
    }
  }

  async function syncRecord(record: TrackRecord) {
    syncing = record.id;
    try {
      const res = await gql<{ fetchTrack: { trackRecord: TrackRecord } }>(FETCH_TRACK, { recordId: record.id });
      patchRecord(res.fetchTrack.trackRecord);
      addToast({ kind: "success", title: "Synced from tracker" });
    } catch (e: any) {
      addToast({ kind: "error", title: "Sync failed", body: e?.message });
    } finally {
      syncing = null;
    }
  }

  function openChapterEditor(record: TrackRecord) {
    editingChapter = record.id;
    chapterDraft   = record.lastChapterRead;
  }

  function cancelChapterEditor() { editingChapter = null; }

  async function applyToLibrary(record: TrackRecord) {
    applyingRecord = record.id;
    try {
      const chapRes = await gql<{ chapters: { nodes: Chapter[] } }>(GET_CHAPTERS, { mangaId });
      const prefs   = store.settings.mangaPrefs?.[mangaId] ?? {};
      const marked  = await syncBackFromTracker(
        [record],
        chapRes.chapters.nodes,
        {
          threshold:              store.settings.trackerSyncBackThreshold ?? null,
          respectScanlatorFilter: store.settings.trackerRespectScanlatorFilter ?? true,
          chapterPrefs:           prefs,
        },
        (query, vars) => gql(query, vars),
      );
      if (marked.length > 0) {
        addToast({ kind: "success", title: `${marked.length} chapter${marked.length !== 1 ? "s" : ""} marked read` });
      } else {
        addToast({ kind: "info", title: "Already up to date" });
      }
    } catch (e: any) {
      addToast({ kind: "error", title: "Apply failed", body: e?.message });
    } finally {
      applyingRecord = null;
    }
  }

  async function submitChapter(record: TrackRecord) {
    const val = Math.max(0, chapterDraft);
    editingChapter = null;
    if (val === record.lastChapterRead) return;
    updatingRecord = record.id;
    try {
      const res = await gql<{ updateTrack: { trackRecord: TrackRecord } }>(UPDATE_TRACK, { recordId: record.id, lastChapterRead: val });
      patchRecord(res.updateTrack.trackRecord);
    } catch (e: any) {
      addToast({ kind: "error", title: "Update failed", body: e?.message });
    } finally {
      updatingRecord = null;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
  <div class="modal" role="dialog" aria-label="Tracking">

    <div class="modal-header">
      <div class="header-left">
        <span class="modal-title">Tracking</span>
        <span class="modal-subtitle">{mangaTitle}</span>
      </div>
      <button class="close-btn" onclick={onClose}><X size={15} weight="light" /></button>
    </div>

    {#if loading}
      <div class="state-body">
        <CircleNotch size={20} weight="light" class="anim-spin" style="color:var(--text-faint)" />
        <span class="state-label">Loading…</span>
      </div>

    {:else if loggedInTrackers.length === 0}
      <div class="state-body">
        <p class="state-text">No trackers connected.</p>
        <p class="state-hint">Go to Settings → Tracking to log in.</p>
      </div>

    {:else}
      <div class="tabs">
        <button class="tab" class:tab-active={activeTab === "records"} onclick={() => activeTab = "records"}>
          My List
          {#if records.length > 0}<span class="tab-badge">{records.length}</span>{/if}
        </button>
        {#each loggedInTrackers as t}
          {@const rec = recordFor(t.id)}
          <button class="tab" class:tab-active={activeTab === t.id} onclick={() => { activeTab = t.id; searchResults = []; }}>
            <Thumbnail src={t.icon} alt={t.name} class="tab-icon" />
            {t.name}
            {#if rec}<span class="tab-dot"></span>{/if}
          </button>
        {/each}
      </div>

      {#if activeTab === "records"}
        <div class="tab-body">
          {#if records.length === 0}
            <div class="state-body">
              <p class="state-text">Not tracking this manga yet.</p>
              <p class="state-hint">Click a tracker tab above to search and add it.</p>
            </div>
          {:else}
            {#each records as record (record.id)}
              {@const tracker = trackerFor(record.trackerId)}
              {@const isBusy  = updatingRecord === record.id}
              <div class="record-card" class:record-busy={isBusy}>

                <div class="record-head">
                  <div class="record-source">
                    {#if tracker}<Thumbnail src={tracker.icon} alt={tracker.name} class="record-tracker-icon" />{/if}
                    <span class="record-source-name">{tracker?.name ?? "Tracker"}</span>
                  </div>
                  <div class="record-head-actions">
                    {#if tracker?.supportsPrivateTracking}
                      <button
                        class="record-icon-btn"
                        class:icon-active={record.private}
                        title={record.private ? "Private — click to make public" : "Public"}
                        disabled={isBusy}
                        onclick={() => togglePrivate(record)}
                      >
                        {#if record.private}<Lock size={11} weight="fill" />{:else}<LockOpen size={11} weight="light" />{/if}
                      </button>
                    {/if}
                    <button class="record-icon-btn" title="Sync from tracker" disabled={syncing === record.id} onclick={() => syncRecord(record)}>
                      <ArrowsClockwise size={11} weight="light" class={syncing === record.id ? "anim-spin" : ""} />
                    </button>
                    {#if store.settings.trackerSyncBack}
                      <button class="record-icon-btn" title="Apply tracker progress to library" disabled={applyingRecord === record.id} onclick={() => applyToLibrary(record)}>
                        <ArrowLineDown size={11} weight="light" class={applyingRecord === record.id ? "anim-spin" : ""} />
                      </button>
                    {/if}
                    <button class="record-icon-btn icon-danger" title="Unlink" disabled={isBusy} onclick={() => unbind(record)}>
                      <X size={11} weight="bold" />
                    </button>
                  </div>
                </div>

                {#if record.remoteUrl}
                  <a href={record.remoteUrl} target="_blank" rel="noreferrer" class="record-title">
                    {record.title} <ArrowSquareOut size={10} weight="light" />
                  </a>
                {:else}
                  <span class="record-title-plain">{record.title}</span>
                {/if}

                <div class="record-selects">
                  <select class="record-select record-select-status" value={record.status} disabled={isBusy}
                    onchange={(e) => updateStatus(record, parseInt((e.target as HTMLSelectElement).value))}>
                    {#each (tracker?.statuses ?? []) as s}
                      <option value={s.value}>{s.name}</option>
                    {/each}
                  </select>
                  <select class="record-select record-select-score" value={record.displayScore} disabled={isBusy}
                    onchange={(e) => updateScore(record, (e.target as HTMLSelectElement).value)}>
                    {#each (tracker?.scores ?? []) as s}
                      <option value={s}>★ {s}</option>
                    {/each}
                  </select>
                </div>

                {#if editingChapter === record.id}
                  <div class="chapter-editor">
                    <div class="chapter-editor-top">
                      <span class="chapter-editor-label">Chapter read</span>
                      <div class="chapter-input-wrap">
                        <input
                          type="number" class="chapter-input"
                          min="0" max={record.totalChapters > 0 ? record.totalChapters : undefined}
                          step="0.5" bind:value={chapterDraft}
                          onkeydown={(e) => { if (e.key === "Enter") submitChapter(record); if (e.key === "Escape") cancelChapterEditor(); }}
                          use:autoFocus
                        />
                        {#if record.totalChapters > 0}
                          <span class="chapter-total">/ {record.totalChapters}</span>
                        {/if}
                      </div>
                    </div>
                    {#if record.totalChapters > 0}
                      <input type="range" class="chapter-slider" min="0" max={record.totalChapters} step="1" bind:value={chapterDraft} />
                    {/if}
                    <div class="chapter-editor-actions">
                      <button class="chapter-cancel-btn" onclick={cancelChapterEditor}>Cancel</button>
                      <button class="chapter-save-btn" onclick={() => submitChapter(record)}>Save</button>
                    </div>
                  </div>
                {:else}
                  <div class="record-progress clickable" role="button" tabindex="0"
                    onclick={() => openChapterEditor(record)}
                    onkeydown={(e) => e.key === "Enter" && openChapterEditor(record)}
                    title="Click to edit"
                  >
                    <div class="record-progress-header">
                      <span class="record-progress-label">
                        {#if record.totalChapters > 0}
                          Ch. {record.lastChapterRead} / {record.totalChapters}
                        {:else if record.lastChapterRead > 0}
                          Ch. {record.lastChapterRead} read
                        {:else}
                          Set chapter…
                        {/if}
                      </span>
                      <span class="edit-hint">Edit</span>
                    </div>
                    {#if record.totalChapters > 0}
                      <div class="record-progress-track">
                        <div class="record-progress-fill" style="width:{Math.min(100,(record.lastChapterRead/record.totalChapters)*100)}%"></div>
                      </div>
                    {/if}
                  </div>
                {/if}

              </div>
            {/each}
          {/if}
        </div>

      {:else}
        {@const tracker     = trackerFor(activeTab as number)}
        {@const boundRecord = recordFor(activeTab as number)}
        <div class="search-bar">
          <MagnifyingGlass size={13} weight="light" class="search-icon" />
          <input
            class="search-input"
            placeholder="Search {tracker?.name}…"
            bind:value={searchQuery}
            oninput={onSearchInput}
            onkeydown={(e) => e.key === "Enter" && doSearch(activeTab as number, searchQuery)}
            use:autoFocus
          />
          {#if searching}<CircleNotch size={13} weight="light" class="anim-spin search-icon" />{/if}
        </div>

        <div class="search-results">
          {#if searching && searchResults.length === 0}
            <div class="state-body"><p class="state-hint">Searching…</p></div>
          {:else if !searching && searchQuery.trim() && searchResults.length === 0}
            <div class="state-body"><p class="state-text">No results for "{searchQuery}"</p></div>
          {:else if !searchQuery.trim()}
            <div class="state-body"><p class="state-hint">Type a title to search</p></div>
          {:else}
            {#each searchResults as result (result.trackerId + ":" + result.remoteId)}
              {@const isBound = boundRecord?.remoteId === result.remoteId}
              <button
                class="result-row"
                class:result-bound={isBound}
                onclick={() => isBound ? unbind(boundRecord!) : bind(result)}
                disabled={binding}
              >
                {#if result.coverUrl}
                  <img src={result.coverUrl} alt={result.title} class="result-cover" loading="lazy"
                    onerror={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                {:else}
                  <div class="result-cover result-cover-empty"></div>
                {/if}
                <div class="result-info">
                  <span class="result-title">{result.title}</span>
                  <div class="result-meta">
                    {#if result.publishingType}<span class="result-tag">{result.publishingType}</span>{/if}
                    {#if result.publishingStatus}<span class="result-tag">{result.publishingStatus}</span>{/if}
                    {#if result.totalChapters > 0}<span class="result-tag">{result.totalChapters} ch</span>{/if}
                  </div>
                  {#if result.summary}
                    <p class="result-summary">{result.summary.slice(0,140)}{result.summary.length > 140 ? "…" : ""}</p>
                  {/if}
                </div>
                <span class="result-action" class:result-action-on={isBound}>
                  {isBound ? "✓ Tracking" : "Track"}
                </span>
              </button>
            {/each}
          {/if}
        </div>
      {/if}
    {/if}

  </div>
</div>

<style>
  .backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.72);
    z-index: var(--z-settings);
    display: flex; align-items: center; justify-content: center;
    backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
    animation: fadeIn 0.12s ease both;
  }
  .modal {
    width: min(560px, calc(100vw - 48px));
    max-height: min(660px, calc(100vh - 80px));
    display: flex; flex-direction: column;
    background: var(--bg-surface); border: 1px solid var(--border-base);
    border-radius: var(--radius-xl); overflow: hidden;
    box-shadow: 0 0 0 1px var(--border-dim), 0 24px 64px rgba(0,0,0,0.6);
    animation: scaleIn 0.15s ease both;
  }

  .modal-header { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-4) var(--sp-5); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; }
  .header-left { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .modal-title { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-primary); letter-spacing: var(--tracking-tight); }
  .modal-subtitle { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .close-btn { display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: var(--radius-sm); color: var(--text-faint); background: none; border: none; cursor: pointer; transition: color var(--t-base), background var(--t-base); flex-shrink: 0; }
  .close-btn:hover { color: var(--text-muted); background: var(--bg-raised); }

  .state-body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-2); padding: var(--sp-10) var(--sp-5); flex: 1; }
  .state-label { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .state-text  { font-size: var(--text-sm); color: var(--text-muted); }
  .state-hint  { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); text-align: center; }

  .tabs { display: flex; align-items: center; gap: 1px; padding: 0 var(--sp-4); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; overflow-x: auto; scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .tab { display: flex; align-items: center; gap: var(--sp-2); position: relative; font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 10px 10px 9px; color: var(--text-faint); background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; white-space: nowrap; transition: color var(--t-base), border-color var(--t-base); margin-bottom: -1px; }
  .tab:hover { color: var(--text-muted); }
  .tab-active { color: var(--text-secondary); border-bottom-color: var(--accent); }
  :global(.tab-icon) { width: 13px; height: 13px; border-radius: 2px; object-fit: contain; }
  .tab-badge { font-size: 10px; padding: 0 4px; border-radius: var(--radius-full); background: var(--bg-overlay); color: var(--text-faint); min-width: 16px; text-align: center; line-height: 16px; }
  .tab-active .tab-badge { background: var(--accent-muted); color: var(--accent-fg); }
  .tab-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }

  .tab-body { flex: 1; overflow-y: auto; padding: var(--sp-3); scrollbar-width: none; display: flex; flex-direction: column; gap: var(--sp-2); }
  .tab-body::-webkit-scrollbar { display: none; }

  .record-card { display: flex; flex-direction: column; gap: var(--sp-3); padding: var(--sp-4); border-radius: var(--radius-lg); border: 1px solid var(--border-dim); background: var(--bg-raised); transition: opacity var(--t-base), border-color var(--t-base); }
  .record-card:hover { border-color: var(--border-strong); }
  .record-busy { opacity: 0.4; pointer-events: none; }

  .record-head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); }
  .record-source { display: flex; align-items: center; gap: var(--sp-2); }
  :global(.record-tracker-icon) { width: 14px; height: 14px; border-radius: 2px; flex-shrink: 0; object-fit: contain; opacity: 0.75; }
  .record-source-name { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; }
  .record-head-actions { display: flex; align-items: center; gap: 2px; }

  .record-title { display: inline-flex; align-items: center; gap: 4px; font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-secondary); text-decoration: none; line-height: var(--leading-snug); transition: color var(--t-base); }
  .record-title:hover { color: var(--accent-fg); }
  .record-title-plain { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-secondary); line-height: var(--leading-snug); }

  .record-selects { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
  .record-select { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); padding: 5px 24px 5px 10px; border-radius: var(--radius-md); border: 1px solid var(--border-dim); background: var(--bg-surface); color: var(--text-muted); outline: none; cursor: pointer; flex: 1; min-width: 0; appearance: none; -webkit-appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23555' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 8px center; transition: border-color var(--t-base), color var(--t-base); }
  .record-select:hover:not(:disabled) { border-color: var(--border-strong); color: var(--text-secondary); }
  .record-select:focus { border-color: var(--accent-dim); color: var(--text-secondary); }
  .record-select:disabled { opacity: 0.35; cursor: default; }
  .record-select option { background: var(--bg-surface); color: var(--text-secondary); }
  .record-select-score { flex: 0 0 auto; min-width: 80px; }
  .record-select-status { flex: 1; }

  .record-icon-btn { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: var(--radius-sm); border: none; background: none; color: var(--text-faint); cursor: pointer; transition: color var(--t-base), background var(--t-base); flex-shrink: 0; }
  .record-icon-btn:hover:not(:disabled) { color: var(--text-muted); background: var(--bg-overlay); }
  .record-icon-btn.icon-active { color: var(--accent-fg); }
  .record-icon-btn.icon-danger:hover:not(:disabled) { color: var(--color-error); background: var(--color-error-bg); }
  .record-icon-btn:disabled { opacity: 0.3; cursor: default; }

  .record-progress { display: flex; flex-direction: column; gap: 6px; }
  .record-progress.clickable { cursor: pointer; border-radius: var(--radius-sm); padding: 4px 6px; margin: -4px -6px; transition: background var(--t-fast); }
  .record-progress.clickable:hover { background: var(--bg-overlay); }
  .record-progress-header { display: flex; align-items: center; justify-content: space-between; }
  .record-progress-label { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .edit-hint { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); opacity: 0; transition: opacity var(--t-fast); }
  .record-progress.clickable:hover .edit-hint { opacity: 0.6; }
  .record-progress-track { height: 2px; background: var(--border-strong); border-radius: var(--radius-full); overflow: hidden; }
  .record-progress-fill { height: 100%; background: var(--accent); border-radius: var(--radius-full); transition: width 0.3s ease; }

  .chapter-editor { display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-3); border-radius: var(--radius-md); border: 1px solid var(--border-dim); background: var(--bg-surface); }
  .chapter-editor-top { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); }
  .chapter-editor-label { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .chapter-input-wrap { display: flex; align-items: center; gap: var(--sp-2); }
  .chapter-input { width: 64px; background: var(--bg-raised); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: 3px 6px; font-family: var(--font-ui); font-size: var(--text-sm); color: var(--text-primary); outline: none; text-align: center; }
  .chapter-input:focus { border-color: var(--accent); }
  .chapter-total { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .chapter-slider { width: 100%; accent-color: var(--accent); cursor: pointer; height: 3px; }
  .chapter-editor-actions { display: flex; gap: var(--sp-2); justify-content: flex-end; }
  .chapter-save-btn { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); padding: 4px 12px; border-radius: var(--radius-sm); border: 1px solid var(--accent-dim); background: var(--accent-muted); color: var(--accent-fg); cursor: pointer; transition: filter var(--t-base); }
  .chapter-save-btn:hover { filter: brightness(1.15); }
  .chapter-cancel-btn { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); padding: 4px 8px; border-radius: var(--radius-sm); border: none; background: none; color: var(--text-faint); cursor: pointer; transition: color var(--t-base); }
  .chapter-cancel-btn:hover { color: var(--text-muted); }

  .search-bar { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; background: var(--bg-surface); }
  :global(.search-icon) { color: var(--text-faint); flex-shrink: 0; }
  .search-input { flex: 1; background: none; border: none; outline: none; font-size: var(--text-sm); color: var(--text-primary); }
  .search-input::placeholder { color: var(--text-faint); }
  .search-results { flex: 1; overflow-y: auto; padding: var(--sp-2); scrollbar-width: none; }
  .search-results::-webkit-scrollbar { display: none; }

  .result-row { display: flex; align-items: flex-start; gap: var(--sp-3); width: 100%; padding: var(--sp-3); border-radius: var(--radius-md); border: none; background: none; text-align: left; cursor: pointer; transition: background var(--t-fast); }
  .result-row:hover:not(:disabled) { background: var(--bg-raised); }
  .result-row:disabled { opacity: 0.4; cursor: default; }
  .result-bound { background: color-mix(in srgb, var(--accent) 8%, transparent) !important; }
  .result-cover { width: 44px; height: 62px; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); flex-shrink: 0; }
  .result-cover-empty { background: var(--bg-raised); }
  .result-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--sp-1); padding-top: 2px; }
  .result-title { font-size: var(--text-sm); color: var(--text-secondary); line-height: var(--leading-snug); text-align: left; }
  .result-meta { display: flex; flex-wrap: wrap; gap: var(--sp-1); }
  .result-tag { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); padding: 1px 5px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: var(--bg-raised); color: var(--text-faint); }
  .result-summary { font-size: var(--text-xs); color: var(--text-faint); line-height: var(--leading-snug); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-align: left; }
  .result-action { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); padding: 3px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: none; color: var(--text-faint); flex-shrink: 0; align-self: center; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); }
  .result-row:hover:not(:disabled) .result-action { color: var(--accent-fg); border-color: var(--accent-dim); background: var(--accent-muted); }
  .result-action-on { color: var(--accent-fg) !important; border-color: var(--accent-dim) !important; background: var(--accent-muted) !important; }

  @keyframes fadeIn  { from { opacity: 0 }                         to { opacity: 1 } }
  @keyframes scaleIn { from { opacity: 0; transform: scale(0.97) } to { opacity: 1; transform: scale(1) } }
</style>