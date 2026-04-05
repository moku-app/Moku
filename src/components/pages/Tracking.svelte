<script lang="ts">
  import { CircleNotch, ArrowSquareOut, ArrowsClockwise, X, Lock, MagnifyingGlass, Funnel } from "phosphor-svelte";
  import { gql } from "../../lib/client";
  import Thumbnail from "../shared/Thumbnail.svelte";
  import {
    GET_ALL_TRACKER_RECORDS,
    UPDATE_TRACK,
    UNBIND_TRACK,
    FETCH_TRACK,
  } from "../../lib/queries";
  import { addToast, setActiveManga, setNavPage } from "../../store/state.svelte";
  import type { Tracker, TrackRecord } from "../../lib/types";

  interface TrackerWithRecords extends Tracker {
    trackRecords: { nodes: TrackRecord[] };
  }

  interface FlatRecord extends TrackRecord {
    tracker: Tracker;
  }

  let trackers:   TrackerWithRecords[] = $state([]);
  let loading:    boolean              = $state(true);
  let error:      string | null        = $state(null);

  let activeTrackerId: number | "all" = $state("all");
  let statusFilter:    number | "all" = $state("all");
  let searchQuery:     string         = $state("");
  let sortBy:          "title" | "status" | "score" | "progress" = $state("title");

  let updatingId: number | null = $state(null);
  let syncingId:  number | null = $state(null);
  let editingChapter: number | null = $state(null);
  let chapterDraft:   number        = $state(0);
  let confirmUnbindRecord: FlatRecord | null = $state(null);

  async function load() {
    loading = true; error = null;
    try {
      const res = await gql<{ trackers: { nodes: TrackerWithRecords[] } }>(GET_ALL_TRACKER_RECORDS);
      trackers = res.trackers.nodes;
    } catch (e: any) {
      error = e?.message ?? "Failed to load tracking data";
    } finally {
      loading = false;
    }
  }

  $effect(() => { load(); });

  const loggedInTrackers = $derived(trackers.filter(t => t.isLoggedIn));

  const allRecords: FlatRecord[] = $derived(
    loggedInTrackers.flatMap(t =>
      t.trackRecords.nodes.map(r => ({
        ...r,
        trackerId: r.trackerId ?? t.id,
        tracker: t as Tracker,
      }))
    )
  );

  const totalCount = $derived(allRecords.length);

  const statusOptions = $derived.by(() => {
    if (activeTrackerId === "all") {
      const seen = new Map<string, { value: number; name: string }>();
      for (const t of loggedInTrackers)
        for (const s of t.statuses ?? []) seen.set(`${s.value}:${s.name}`, s);
      return [...seen.values()];
    }
    return loggedInTrackers.find(t => t.id === activeTrackerId)?.statuses ?? [];
  });

  const filtered = $derived.by(() => {
    let list = activeTrackerId === "all"
      ? allRecords
      : allRecords.filter(r => Number(r.trackerId) === Number(activeTrackerId));

    if (statusFilter !== "all")
      list = list.filter(r => Number(r.status) === Number(statusFilter));

    if (searchQuery.trim())
      list = list.filter(r =>
        r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.manga?.title?.toLowerCase().includes(searchQuery.toLowerCase())
      );

    return [...list].sort((a, b) => {
      if (sortBy === "title")    return a.title.localeCompare(b.title);
      if (sortBy === "status")   return a.status - b.status;
      if (sortBy === "score")    return parseFloat(b.displayScore ?? "0") - parseFloat(a.displayScore ?? "0");
      if (sortBy === "progress") {
        const ap = a.totalChapters > 0 ? a.lastChapterRead / a.totalChapters : 0;
        const bp = b.totalChapters > 0 ? b.lastChapterRead / b.totalChapters : 0;
        return bp - ap;
      }
      return 0;
    });
  });

  async function updateStatus(record: FlatRecord, status: number) {
    updatingId = record.id;
    try {
      const res = await gql<{ updateTrack: { trackRecord: TrackRecord } }>(
        UPDATE_TRACK, { recordId: record.id, status }
      );
      patchRecord(record.trackerId, res.updateTrack.trackRecord);
    } catch (e: any) {
      addToast({ kind: "error", title: "Update failed", body: e?.message });
    } finally { updatingId = null; }
  }

  async function updateScore(record: FlatRecord, scoreString: string) {
    updatingId = record.id;
    try {
      const res = await gql<{ updateTrack: { trackRecord: TrackRecord } }>(
        UPDATE_TRACK, { recordId: record.id, scoreString }
      );
      patchRecord(record.trackerId, res.updateTrack.trackRecord);
    } catch (e: any) {
      addToast({ kind: "error", title: "Update failed", body: e?.message });
    } finally { updatingId = null; }
  }

  async function syncRecord(record: FlatRecord) {
    syncingId = record.id;
    try {
      const res = await gql<{ fetchTrack: { trackRecord: TrackRecord } }>(
        FETCH_TRACK, { recordId: record.id }
      );
      patchRecord(record.trackerId, res.fetchTrack.trackRecord);
      addToast({ kind: "success", title: "Synced from tracker" });
    } catch (e: any) {
      addToast({ kind: "error", title: "Sync failed", body: e?.message });
    } finally { syncingId = null; }
  }

  async function unbind(record: FlatRecord) {
    updatingId = record.id;
    try {
      await gql(UNBIND_TRACK, { recordId: record.id });
      trackers = trackers.map(t =>
        t.id !== record.trackerId ? t : {
          ...t,
          trackRecords: { nodes: t.trackRecords.nodes.filter(r => r.id !== record.id) }
        }
      );
      addToast({ kind: "info", title: "Unlinked from " + record.tracker.name });
    } catch (e: any) {
      addToast({ kind: "error", title: "Unbind failed", body: e?.message });
    } finally { updatingId = null; }
  }

  function patchRecord(trackerId: number, updated: Partial<TrackRecord> & { id: number }) {
    trackers = trackers.map(t =>
      t.id !== trackerId ? t : {
        ...t,
        trackRecords: {
          nodes: t.trackRecords.nodes.map(r => r.id === updated.id ? { ...r, ...updated } : r)
        }
      }
    );
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

  function cancelChapterEditor() { editingChapter = null; }

  async function submitChapter(record: FlatRecord) {
    const val = Math.max(0, chapterDraft);
    editingChapter = null;
    if (val === record.lastChapterRead) return;
    updatingId = record.id;
    try {
      const res = await gql<{ updateTrack: { trackRecord: TrackRecord } }>(
        UPDATE_TRACK, { recordId: record.id, lastChapterRead: val }
      );
      patchRecord(record.trackerId, res.updateTrack.trackRecord);
    } catch (e: any) {
      addToast({ kind: "error", title: "Update failed", body: e?.message });
    } finally { updatingId = null; }
  }

  function requestUnbind(record: FlatRecord) {
    confirmUnbindRecord = record;
  }

  function cancelUnbind() {
    confirmUnbindRecord = null;
  }

  async function confirmAndUnbind() {
    if (!confirmUnbindRecord) return;
    const record = confirmUnbindRecord;
    confirmUnbindRecord = null;
    await unbind(record);
  }

  function scoreToStars(score: string | undefined, scores: string[] | undefined): number {
    if (!score || !scores || scores.length === 0) return 0;
    const idx = scores.indexOf(score);
    if (idx < 0) return 0;
    return Math.round((idx / (scores.length - 1)) * 5);
  }
</script>

<div class="page">

  <div class="header">
    <div class="header-top">
      <h1 class="heading">Tracking</h1>
      <div class="header-actions">
        <button class="icon-btn" onclick={load} disabled={loading} title="Refresh all">
          <ArrowsClockwise size={14} weight="light" class={loading ? "anim-spin" : ""} />
        </button>
      </div>
    </div>

    {#if !loading && loggedInTrackers.length > 0}
      <div class="tracker-tabs">
        <button
          class="tracker-tab"
          class:tab-active={activeTrackerId === "all"}
          onclick={() => { activeTrackerId = "all"; statusFilter = "all"; }}
        >
          All
          <span class="tab-count">{totalCount}</span>
        </button>
        {#each loggedInTrackers as t}
          {@const count = t.trackRecords.nodes.length}
          <button
            class="tracker-tab"
            class:tab-active={activeTrackerId === t.id}
            onclick={() => { activeTrackerId = Number(t.id); statusFilter = "all"; }}
          >
            <Thumbnail src={t.icon} alt={t.name} class="tab-tracker-icon" />
            {t.name}
            <span class="tab-count">{count}</span>
          </button>
        {/each}
      </div>

      <div class="filter-bar">
        <div class="search-wrap">
          <MagnifyingGlass size={12} weight="light" class="search-ico" />
          <input
            class="filter-search"
            placeholder="Search titles…"
            bind:value={searchQuery}
          />
        </div>
        <div class="filter-right">
          <Funnel size={12} weight="light" style="color:var(--text-faint);flex-shrink:0" />
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
      </div>
    {/if}
  </div>

  <div class="page-body">

    {#if loading}
      <div class="state-center">
        <CircleNotch size={20} weight="light" class="anim-spin" style="color:var(--text-faint)" />
        <span class="state-label">Loading…</span>
      </div>

    {:else if error}
      <div class="state-center">
        <p class="state-error">{error}</p>
        <button class="retry-btn" onclick={load}>Retry</button>
      </div>

    {:else if loggedInTrackers.length === 0}
      <div class="state-center">
        <p class="state-text">No trackers connected.</p>
        <p class="state-hint">Go to Settings → Tracking to connect AniList, MAL, or others.</p>
      </div>

    {:else if filtered.length === 0}
      <div class="state-center">
        <p class="state-text">{searchQuery || statusFilter !== "all" ? "No results." : "Nothing tracked yet."}</p>
        {#if searchQuery || statusFilter !== "all"}
          <button class="retry-btn" onclick={() => { searchQuery = ""; statusFilter = "all"; }}>Clear filters</button>
        {/if}
      </div>

    {:else}
      <div class="records-grid">
        {#each filtered as record (record.tracker.id + ":" + record.id)}
          {@const tracker   = record.tracker}
          {@const isBusy    = updatingId === record.id}
          {@const isSyncing = syncingId === record.id}
          {@const progress  = record.totalChapters > 0
            ? Math.min(100, (record.lastChapterRead / record.totalChapters) * 100)
            : null}
          {@const stars = scoreToStars(record.displayScore, tracker.scores)}
          {@const statusName = (tracker.statuses ?? []).find(s => s.value === record.status)?.name ?? "—"}

          <div class="record-card" class:record-busy={isBusy}>

            <div class="card-cover-wrap">
              <div class="card-cover-region"
                role="button" tabindex="0"
                onclick={() => openManga(record)}
                onkeydown={(e) => e.key === "Enter" && openManga(record)}
                title="Open in library"
              >
                {#if record.manga?.thumbnailUrl}
                  <Thumbnail src={record.manga.thumbnailUrl} alt={record.title} class="card-cover-img" />
                {:else}
                  <div class="card-cover-empty"></div>
                {/if}
              </div>

              <div class="card-top-actions">
                {#if record.private}
                  <span class="card-badge-btn" title="Private"><Lock size={10} weight="fill" /></span>
                {/if}
                {#if isSyncing}
                  <span class="card-badge-btn">
                    <CircleNotch size={10} weight="light" class="anim-spin" />
                  </span>
                {:else}
                  <button class="card-badge-btn" title="Sync" onclick={() => syncRecord(record)}>
                    <ArrowsClockwise size={10} weight="light" />
                  </button>
                {/if}
                {#if record.remoteUrl}
                  <a href={record.remoteUrl} target="_blank" rel="noreferrer" class="card-badge-btn" title="Open on {tracker.name}">
                    <ArrowSquareOut size={10} weight="light" />
                  </a>
                {/if}
                <button class="card-badge-btn danger" title="Unlink" onclick={() => requestUnbind(record)} disabled={isBusy}>
                  <X size={10} weight="bold" />
                </button>
              </div>

              <div class="card-tracker-badge">
                <Thumbnail src={tracker.icon} alt={tracker.name} class="tracker-badge-img" />
              </div>
            </div>

            <div class="card-footer">
              <div class="card-stars">
                {#each Array(5) as _, i}
                  <span class="star" class:star-filled={i < stars}>★</span>
                {/each}
              </div>

              <div class="card-title-block"
                role="button" tabindex="0"
                onclick={() => openManga(record)}
                onkeydown={(e) => e.key === "Enter" && openManga(record)}
              >
                <span class="card-title">{record.title}</span>
                {#if record.manga?.title && record.manga.title !== record.title}
                  <span class="card-local-title">{record.manga.title}</span>
                {/if}
              </div>

              <div class="card-meta-row">
                <select
                  class="status-pill"
                  value={record.status}
                  disabled={isBusy}
                  onchange={(e) => updateStatus(record, parseInt((e.target as HTMLSelectElement).value))}
                >
                  {#each (tracker.statuses ?? []) as s}
                    <option value={s.value}>{s.name}</option>
                  {/each}
                </select>

                <select
                  class="score-select"
                  value={record.displayScore}
                  disabled={isBusy}
                  onchange={(e) => updateScore(record, (e.target as HTMLSelectElement).value)}
                >
                  {#each (tracker.scores ?? []) as s}
                    <option value={s}>★ {s}</option>
                  {/each}
                </select>
              </div>

              {#if editingChapter === record.id}
                <div class="chapter-editor" role="presentation" onclick={(e) => e.stopPropagation()}>
                  <div class="chapter-editor-top">
                    <span class="chapter-editor-label">Chapter</span>
                    <div class="chapter-input-wrap">
                      <input
                        type="number" class="chapter-input"
                        min="0" max={record.totalChapters > 0 ? record.totalChapters : undefined}
                        step="0.5" bind:value={chapterDraft}
                        onkeydown={(e) => { if (e.key === "Enter") submitChapter(record); if (e.key === "Escape") cancelChapterEditor(); }}
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
                  <div class="chapter-editor-actions">
                    <button class="chapter-cancel-btn" onclick={cancelChapterEditor}>Cancel</button>
                    <button class="chapter-save-btn" onclick={() => submitChapter(record)}>Save</button>
                  </div>
                </div>
              {:else}
                <div class="progress-block clickable"
                  role="button" tabindex="0"
                  onclick={() => openChapterEditor(record)}
                  onkeydown={(e) => e.key === "Enter" && openChapterEditor(record)}
                  title="Click to edit chapter"
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

{#if confirmUnbindRecord}
  {@const r = confirmUnbindRecord}
  <div class="modal-backdrop" role="presentation" onclick={cancelUnbind}>
    <div class="modal" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
      <div class="modal-icon">
        <X size={18} weight="bold" />
      </div>
      <p class="modal-title">Unlink from {r.tracker.name}?</p>
      <p class="modal-body">
        <strong>{r.title}</strong> will be removed from your tracking list. This won't affect your progress on {r.tracker.name} itself.
      </p>
      <div class="modal-actions">
        <button class="modal-cancel" onclick={cancelUnbind}>Cancel</button>
        <button class="modal-confirm" onclick={confirmAndUnbind}>Unlink</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .page {
    display: flex; flex-direction: column; height: 100%; overflow: hidden;
    animation: fadeIn 0.16s ease both;
  }

  .header {
    flex-shrink: 0;
    border-bottom: 1px solid var(--border-dim);
    background: var(--bg-base);
  }
  .header-top {
    display: flex; align-items: center; justify-content: space-between;
    padding: var(--sp-4) var(--sp-6) var(--sp-3);
  }
  .heading {
    font-family: var(--font-ui); font-size: var(--text-xs);
    font-weight: var(--weight-normal); color: var(--text-faint);
    letter-spacing: var(--tracking-wider); text-transform: uppercase;
  }
  .header-actions { display: flex; align-items: center; gap: var(--sp-2); }
  .icon-btn {
    display: flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; border-radius: var(--radius-sm);
    border: none; color: var(--text-faint); background: none;
    cursor: pointer; transition: color var(--t-base), background var(--t-base);
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
    font-family: var(--font-ui); font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide); color: var(--text-faint);
    background: none; border: none; border-bottom: 2px solid transparent;
    cursor: pointer; white-space: nowrap; margin-bottom: -1px;
    transition: color var(--t-base), border-color var(--t-base);
  }
  .tracker-tab:hover { color: var(--text-muted); }
  .tab-active { color: var(--text-secondary) !important; border-bottom-color: var(--accent); }
  :global(.tab-tracker-icon) { width: 13px; height: 13px; border-radius: 2px; object-fit: contain; opacity: 0.85; }
  .tab-count {
    font-size: 10px; padding: 0 4px; border-radius: var(--radius-full);
    background: var(--bg-overlay); color: var(--text-faint);
    min-width: 16px; text-align: center; line-height: 16px;
  }
  .tab-active .tab-count { background: var(--accent-muted); color: var(--accent-fg); }

  .filter-bar {
    display: flex; align-items: center; gap: var(--sp-3);
    padding: var(--sp-2) var(--sp-5);
    border-top: 1px solid var(--border-dim);
  }
  .search-wrap {
    display: flex; align-items: center; gap: var(--sp-2); flex: 1;
    background: var(--bg-raised); border: 1px solid var(--border-dim);
    border-radius: var(--radius-md); padding: 4px 10px;
  }
  :global(.search-ico) { color: var(--text-faint); flex-shrink: 0; }
  .filter-search {
    flex: 1; background: none; border: none; outline: none;
    font-size: var(--text-sm); color: var(--text-primary); min-width: 0;
  }
  .filter-search::placeholder { color: var(--text-faint); }
  .filter-right { display: flex; align-items: center; gap: var(--sp-2); flex-shrink: 0; }
  .filter-select {
    font-family: var(--font-ui); font-size: var(--text-2xs);
    letter-spacing: var(--tracking-wide); padding: 4px 22px 4px 8px;
    border-radius: var(--radius-sm); border: 1px solid var(--border-dim);
    background: var(--bg-raised); color: var(--text-faint);
    outline: none; cursor: pointer; appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23555' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 6px center;
    transition: border-color var(--t-base), color var(--t-base);
  }
  .filter-select:hover { border-color: var(--border-strong); color: var(--text-muted); }
  .filter-select option { background: var(--bg-surface); color: var(--text-secondary); }

  .page-body {
    flex: 1; overflow-y: auto; padding: var(--sp-5);
    scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent;
  }

  .state-center {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: var(--sp-3); height: 100%;
    padding: var(--sp-10); text-align: center;
  }
  .state-label { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .state-text  { font-size: var(--text-sm); color: var(--text-muted); }
  .state-hint  { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .state-error { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--color-error); letter-spacing: var(--tracking-wide); }
  .retry-btn {
    font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide);
    padding: 5px 14px; border-radius: var(--radius-md);
    border: 1px solid var(--border-dim); background: none;
    color: var(--text-faint); cursor: pointer;
    transition: color var(--t-base), border-color var(--t-base);
  }
  .retry-btn:hover { color: var(--accent-fg); border-color: var(--accent-dim); }

  .records-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: var(--sp-4);
    align-content: start;
  }

  .record-card {
    display: flex; flex-direction: column;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-dim);
    background: var(--bg-raised);
    overflow: hidden;
    transition: border-color var(--t-base), opacity var(--t-base), transform var(--t-base);
  }
  .record-card:hover {
    border-color: var(--border-strong);
    transform: translateY(-2px);
  }
  .record-busy { opacity: 0.35; pointer-events: none; }

  .card-cover-wrap {
    position: relative;
    aspect-ratio: 2 / 3;
    flex-shrink: 0;
    overflow: hidden;
    background: var(--bg-overlay);
  }

  .card-cover-region {
    position: absolute; inset: 0;
    cursor: pointer;
  }

  :global(.card-cover-img) {
    width: 100%; height: 100%;
    object-fit: cover; display: block;
    transition: transform 0.35s ease, opacity 0.2s ease;
  }
  .card-cover-wrap:hover :global(.card-cover-img) {
    transform: scale(1.04);
    opacity: 0.88;
  }
  .card-cover-empty { width: 100%; height: 100%; background: var(--bg-overlay); }

  .card-stars {
    display: flex; gap: 3px; align-items: center;
    padding-bottom: 2px;
  }
  .star {
    font-size: 15px; line-height: 1;
    color: var(--border-strong);
    transition: color var(--t-base);
  }
  .star-filled { color: #f5c518; }

  .card-top-actions {
    position: absolute; top: 6px; right: 6px; z-index: 2;
    display: flex; gap: 2px;
    opacity: 0;
    transition: opacity var(--t-base);
  }
  .card-cover-wrap:hover .card-top-actions { opacity: 1; }

  .card-badge-btn {
    display: flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; border-radius: var(--radius-sm);
    background: rgba(0,0,0,0.6); backdrop-filter: blur(8px);
    border: 1px solid rgba(255,255,255,0.1);
    color: rgba(255,255,255,0.75); cursor: pointer;
    text-decoration: none;
    transition: background var(--t-base), color var(--t-base);
  }
  .card-badge-btn:hover { background: rgba(0,0,0,0.75); color: #fff; }
  .card-badge-btn.danger:hover { background: rgba(180,40,40,0.7); color: #fff; }
  .card-badge-btn:disabled { opacity: 0.3; cursor: default; }

  .card-tracker-badge {
    position: absolute; bottom: 9px; right: 9px; z-index: 2;
    width: 22px; height: 22px;
    border-radius: 6px;
    border: 1px solid rgba(0,0,0,0.35);
    background: var(--bg-raised);
    box-shadow: 0 2px 8px rgba(0,0,0,0.55);
    overflow: hidden;
    display: flex; align-items: center; justify-content: center;
  }
  :global(.tracker-badge-img) {
    width: 100%; height: 100%;
    object-fit: contain; display: block;
  }

  /* ── Footer panel ───────────────────────────────────────────────────────── */
  .card-footer {
    display: flex; flex-direction: column; gap: 10px;
    padding: 13px 13px 13px;
    border-top: 1px solid var(--border-dim);
  }

  /* Title */
  .card-title-block {
    display: flex; flex-direction: column; gap: 3px;
    cursor: pointer; min-width: 0;
  }
  .card-title {
    font-size: var(--text-sm); font-weight: var(--weight-medium);
    color: var(--text-secondary); line-height: 1.38;
    display: -webkit-box; -webkit-line-clamp: 2;
    -webkit-box-orient: vertical; overflow: hidden;
    transition: color var(--t-base);
  }
  .card-title-block:hover .card-title { color: var(--accent-fg); }
  .card-local-title {
    font-family: var(--font-ui); font-size: 11px; color: var(--text-faint);
    letter-spacing: var(--tracking-wide);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  .card-meta-row {
    display: flex; align-items: center; gap: var(--sp-1);
  }

  .status-pill {
    flex: 1; min-width: 0;
    font-family: var(--font-ui); font-size: var(--text-2xs);
    letter-spacing: var(--tracking-wide);
    padding: 5px 20px 5px 9px;
    border-radius: 999px;
    border: 1px solid var(--border-dim);
    background: var(--bg-overlay);
    color: var(--text-muted);
    outline: none; cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M1 1l3 3 3-3' stroke='%23555' stroke-width='1.3' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 6px center;
    transition: border-color var(--t-base), color var(--t-base);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .status-pill:hover:not(:disabled) { border-color: var(--border-strong); color: var(--text-secondary); }
  .status-pill:disabled { opacity: 0.35; cursor: default; }
  .status-pill option { background: var(--bg-surface); color: var(--text-secondary); }

  .score-select {
    flex-shrink: 0; width: 58px;
    font-family: var(--font-ui); font-size: var(--text-2xs);
    letter-spacing: var(--tracking-wide);
    padding: 5px 16px 5px 6px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-dim);
    background: var(--bg-overlay);
    color: var(--text-faint);
    outline: none; cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M1 1l3 3 3-3' stroke='%23555' stroke-width='1.3' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 4px center;
    transition: border-color var(--t-base), color var(--t-base);
  }
  .score-select:hover:not(:disabled) { border-color: var(--border-strong); color: var(--text-secondary); }
  .score-select:disabled { opacity: 0.35; cursor: default; }
  .score-select option { background: var(--bg-surface); color: var(--text-secondary); }

  .progress-block {
    display: flex; flex-direction: column; gap: 7px;
  }
  .progress-block.clickable {
    cursor: pointer; border-radius: var(--radius-sm);
    padding: 4px 5px;
    margin: 0 -5px;
    transition: background var(--t-fast);
  }
  .progress-block.clickable:hover { background: var(--bg-overlay); }
  .progress-labels {
    display: flex; align-items: center; justify-content: space-between;
  }
  .progress-text {
    font-family: var(--font-ui); font-size: var(--text-2xs);
    color: var(--text-muted); letter-spacing: var(--tracking-wide);
  }
  .progress-pct {
    font-family: var(--font-ui); font-size: var(--text-2xs);
    color: var(--text-faint); letter-spacing: var(--tracking-wide);
  }
  .progress-track {
    height: 3px; background: var(--border-strong);
    border-radius: var(--radius-full); overflow: hidden;
  }
  .progress-fill {
    height: 100%; background: var(--accent);
    border-radius: var(--radius-full); transition: width 0.3s ease;
  }

  .chapter-editor {
    display: flex; flex-direction: column; gap: var(--sp-2);
    padding: var(--sp-2); border-radius: var(--radius-md);
    border: 1px solid var(--border-dim); background: var(--bg-surface);
  }
  .chapter-editor-top { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); }
  .chapter-editor-label { font-family: var(--font-ui); font-size: 10px; color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .chapter-input-wrap { display: flex; align-items: center; gap: var(--sp-1); }
  .chapter-input {
    width: 58px; background: var(--bg-surface);
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
  .chapter-editor-actions { display: flex; align-items: center; gap: var(--sp-2); justify-content: flex-end; }
  .chapter-save-btn {
    font-family: var(--font-ui); font-size: 10px; letter-spacing: var(--tracking-wide);
    padding: 3px 10px; border-radius: var(--radius-sm);
    border: 1px solid var(--accent-dim); background: var(--accent-muted);
    color: var(--accent-fg); cursor: pointer; transition: filter var(--t-base);
  }
  .chapter-save-btn:hover { filter: brightness(1.15); }
  .chapter-cancel-btn {
    font-family: var(--font-ui); font-size: 10px; letter-spacing: var(--tracking-wide);
    padding: 3px 6px; border-radius: var(--radius-sm);
    border: none; background: none; color: var(--text-faint);
    cursor: pointer; transition: color var(--t-base);
  }
  .chapter-cancel-btn:hover { color: var(--text-muted); }

  .modal-backdrop {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(0,0,0,0.55);
    backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
    animation: fadeIn 0.12s ease both;
  }
  .modal {
    background: var(--bg-surface);
    border: 1px solid var(--border-dim);
    border-radius: var(--radius-xl, 14px);
    padding: var(--sp-6, 24px);
    width: 320px; max-width: calc(100vw - 32px);
    display: flex; flex-direction: column; align-items: center; gap: var(--sp-3);
    box-shadow: 0 24px 60px rgba(0,0,0,0.5);
    animation: modalIn 0.18s cubic-bezier(0.34,1.56,0.64,1) both;
  }
  .modal-icon {
    width: 40px; height: 40px; border-radius: 50%;
    background: var(--color-error-bg, rgba(200,50,50,0.12));
    border: 1px solid var(--color-error-dim, rgba(200,50,50,0.25));
    color: var(--color-error, #e05252);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .modal-title {
    font-size: var(--text-sm); font-weight: var(--weight-medium);
    color: var(--text-primary); text-align: center; margin: 0;
  }
  .modal-body {
    font-family: var(--font-ui); font-size: var(--text-xs);
    color: var(--text-muted); text-align: center; line-height: 1.5;
    margin: 0;
  }
  .modal-body strong { color: var(--text-secondary); font-weight: var(--weight-medium); }
  .modal-actions {
    display: flex; gap: var(--sp-2); width: 100%; margin-top: var(--sp-1);
  }
  .modal-cancel {
    flex: 1;
    font-family: var(--font-ui); font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide);
    padding: 8px 0; border-radius: var(--radius-md);
    border: 1px solid var(--border-dim); background: none;
    color: var(--text-muted); cursor: pointer;
    transition: border-color var(--t-base), color var(--t-base);
  }
  .modal-cancel:hover { border-color: var(--border-strong); color: var(--text-primary); }
  .modal-confirm {
    flex: 1;
    font-family: var(--font-ui); font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide);
    padding: 8px 0; border-radius: var(--radius-md);
    border: 1px solid var(--color-error-dim, rgba(200,50,50,0.3));
    background: var(--color-error-bg, rgba(200,50,50,0.1));
    color: var(--color-error, #e05252); cursor: pointer;
    transition: filter var(--t-base), background var(--t-base);
  }
  .modal-confirm:hover { filter: brightness(1.2); background: var(--color-error-bg, rgba(200,50,50,0.18)); }

  @keyframes modalIn {
    from { opacity: 0; transform: scale(0.92) translateY(8px); }
    to   { opacity: 1; transform: none; }
  }

  @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
</style>

<script module>
  function focusEl(node: HTMLElement) { setTimeout(() => node.focus(), 0); }
</script>
