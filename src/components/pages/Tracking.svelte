<script lang="ts">
  import { CircleNotch, ArrowSquareOut, ArrowsClockwise, X, Lock, MagnifyingGlass, Funnel } from "phosphor-svelte";
  import { gql, thumbUrl } from "../../lib/client";
  import {
    GET_ALL_TRACKER_RECORDS,
    UPDATE_TRACK,
    UNBIND_TRACK,
    FETCH_TRACK,
  } from "../../lib/queries";
  import { addToast, setActiveManga, setNavPage } from "../../store/state.svelte";
  import type { Tracker, TrackRecord } from "../../lib/types";

  // ── Types ──────────────────────────────────────────────────────────────────

  interface TrackerWithRecords extends Tracker {
    trackRecords: { nodes: TrackRecord[] };
  }

  interface FlatRecord extends TrackRecord {
    tracker: Tracker;
  }

  // ── State ──────────────────────────────────────────────────────────────────

  let trackers:   TrackerWithRecords[] = $state([]);
  let loading:    boolean              = $state(true);
  let error:      string | null        = $state(null);

  // Filter/view state
  let activeTrackerId: number | "all" = $state("all");
  let statusFilter:    number | "all" = $state("all");
  let searchQuery:     string         = $state("");
  let sortBy:          "title" | "status" | "score" | "progress" = $state("title");

  // Mutation state
  let updatingId: number | null = $state(null);
  let syncingId:  number | null = $state(null);
  // Chapter editing: recordId → draft value
  let editingChapter: number | null = $state(null);
  let chapterDraft:   number        = $state(0);

  // ── Load ───────────────────────────────────────────────────────────────────

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

  // ── Derived data ───────────────────────────────────────────────────────────

  const loggedInTrackers = $derived(trackers.filter(t => t.isLoggedIn));

  const allRecords: FlatRecord[] = $derived(
    loggedInTrackers.flatMap(t =>
      t.trackRecords.nodes.map(r => ({
        ...r,
        trackerId: r.trackerId ?? t.id, // fallback in case field is missing
        tracker: t as Tracker,
      }))
    )
  );

  const totalCount  = $derived(allRecords.length);

  // Status options across active tracker
  const statusOptions = $derived.by(() => {
    if (activeTrackerId === "all") {
      // Merge all statuses, dedupe by value+name
      const seen = new Map<string, { value: number; name: string }>();
      for (const t of loggedInTrackers) {
        for (const s of t.statuses ?? []) seen.set(`${s.value}:${s.name}`, s);
      }
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

  // ── Mutations ──────────────────────────────────────────────────────────────

  async function updateStatus(record: FlatRecord, status: number) {
    updatingId = record.id;
    try {
      const res = await gql<{ updateTrack: { trackRecord: TrackRecord } }>(
        UPDATE_TRACK, { recordId: record.id, status }
      );
      patchRecord(record.trackerId, res.updateTrack.trackRecord);
    } catch (e: any) {
      addToast({ kind: "error", title: "Update failed", body: e?.message });
    } finally {
      updatingId = null;
    }
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
    } finally {
      updatingId = null;
    }
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
    } finally {
      syncingId = null;
    }
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
    } finally {
      updatingId = null;
    }
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

  function cancelChapterEditor() {
    editingChapter = null;
  }

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
    } finally {
      updatingId = null;
    }
  }
</script>

<div class="page">

  <!-- ── Header ──────────────────────────────────────────────────────────── -->
  <div class="header">
    <div class="header-top">
      <h1 class="heading">Tracking</h1>
      <div class="header-actions">
        <button class="icon-btn" onclick={load} disabled={loading} title="Refresh all">
          <ArrowsClockwise size={14} weight="light" class={loading ? "anim-spin" : ""} />
        </button>
      </div>
    </div>

    <!-- Tracker filter tabs -->
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
            <img src={thumbUrl(t.icon)} alt={t.name} class="tab-tracker-icon" />
            {t.name}
            <span class="tab-count">{count}</span>
          </button>
        {/each}
      </div>

      <!-- Filter + sort bar -->
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
            <option value="title">Sort: Title</option>
            <option value="status">Sort: Status</option>
            <option value="score">Sort: Score</option>
            <option value="progress">Sort: Progress</option>
          </select>
        </div>
      </div>
    {/if}
  </div>

  <!-- ── Body ────────────────────────────────────────────────────────────── -->
  <div class="page-body">

    {#if loading}
      <div class="state-center">
        <CircleNotch size={22} weight="light" class="anim-spin" style="color:var(--text-faint)" />
        <span class="state-label">Loading tracking data…</span>
      </div>

    {:else if error}
      <div class="state-center">
        <p class="state-error">{error}</p>
        <button class="retry-btn" onclick={load}>Retry</button>
      </div>

    {:else if loggedInTrackers.length === 0}
      <div class="state-center">
        <p class="state-text">No trackers connected.</p>
        <p class="state-hint">Go to Settings → Tracking to log in to AniList, MAL, or others.</p>
      </div>

    {:else if filtered.length === 0}
      <div class="state-center">
        <p class="state-text">{searchQuery || statusFilter !== "all" ? "No results match your filters." : "Nothing tracked yet."}</p>
        {#if searchQuery || statusFilter !== "all"}
          <button class="retry-btn" onclick={() => { searchQuery = ""; statusFilter = "all"; }}>Clear filters</button>
        {/if}
      </div>

    {:else}
      <div class="records-list">
        {#each filtered as record (record.tracker.id + ":" + record.id)}
          {@const tracker  = record.tracker}
          {@const isBusy   = updatingId === record.id}
          {@const isSyncing = syncingId === record.id}
          {@const progress = record.totalChapters > 0
            ? Math.min(100, (record.lastChapterRead / record.totalChapters) * 100)
            : null}

          <div class="record-card" class:record-busy={isBusy}>

            <!-- Cover -->
            <div class="record-cover-wrap" role="button" tabindex="0"
              onclick={() => openManga(record)}
              onkeydown={(e) => e.key === "Enter" && openManga(record)}
            >
              {#if record.manga?.thumbnailUrl}
                <img src={thumbUrl(record.manga.thumbnailUrl)} alt={record.title} class="record-cover" loading="lazy" />
              {:else}
                <div class="record-cover record-cover-empty"></div>
              {/if}
              <!-- Tracker badge -->
              <img src={thumbUrl(tracker.icon)} alt={tracker.name} class="record-tracker-badge" />
            </div>

            <!-- Info -->
            <div class="record-body">
              <div class="record-top">
                <div class="record-titles" role="button" tabindex="0"
                  onclick={() => openManga(record)}
                  onkeydown={(e) => e.key === "Enter" && openManga(record)}
                >
                  <span class="record-title">{record.title}</span>
                  {#if record.manga?.title && record.manga.title !== record.title}
                    <span class="record-local-title">{record.manga.title}</span>
                  {/if}
                </div>
                <div class="record-header-actions">
                  {#if activeTrackerId === "all"}
                    <span class="record-tracker-label">
                      <img src={thumbUrl(record.tracker.icon)} alt={record.tracker.name} class="record-tracker-label-icon" />
                      {record.tracker.name}
                    </span>
                  {/if}
                  {#if isSyncing}
                    <CircleNotch size={12} weight="light" class="anim-spin" style="color:var(--text-faint)" />
                  {:else}
                    <button class="card-icon-btn" title="Sync from tracker" onclick={() => syncRecord(record)}>
                      <ArrowsClockwise size={12} weight="light" />
                    </button>
                  {/if}
                  {#if record.remoteUrl}
                    <a href={record.remoteUrl} target="_blank" rel="noreferrer" class="card-icon-btn" title="Open on {record.tracker.name}">
                      <ArrowSquareOut size={12} weight="light" />
                    </a>
                  {/if}
                  <button class="card-icon-btn danger" title="Unlink" onclick={() => unbind(record)} disabled={isBusy}>
                    <X size={12} weight="bold" />
                  </button>
                </div>
              </div>

              <!-- Controls row -->
              <div class="record-controls">
                <select
                  class="record-select"
                  value={record.status}
                  disabled={isBusy}
                  onchange={(e) => updateStatus(record, parseInt((e.target as HTMLSelectElement).value))}
                >
                  {#each (tracker.statuses ?? []) as s}
                    <option value={s.value}>{s.name}</option>
                  {/each}
                </select>

                <select
                  class="record-select record-select-score"
                  value={record.displayScore}
                  disabled={isBusy}
                  onchange={(e) => updateScore(record, (e.target as HTMLSelectElement).value)}
                >
                  {#each (tracker.scores ?? []) as s}
                    <option value={s}>★ {s}</option>
                  {/each}
                </select>

                {#if record.private}
                  <span class="private-badge" title="Private"><Lock size={10} weight="fill" /></span>
                {/if}
              </div>

              <!-- Progress / Chapter editor -->
              {#if editingChapter === record.id}
                <div class="chapter-editor">
                  <div class="chapter-editor-top">
                    <span class="chapter-editor-label">Chapter read</span>
                    <div class="chapter-input-wrap">
                      <input
                        type="number"
                        class="chapter-input"
                        min="0"
                        max={record.totalChapters > 0 ? record.totalChapters : undefined}
                        step="0.5"
                        bind:value={chapterDraft}
                        onkeydown={(e) => {
                          if (e.key === "Enter") submitChapter(record);
                          if (e.key === "Escape") cancelChapterEditor();
                        }}
                        use:focusEl
                      />
                      {#if record.totalChapters > 0}
                        <span class="chapter-total">/ {record.totalChapters}</span>
                      {/if}
                    </div>
                  </div>
                  {#if record.totalChapters > 0}
                    <input
                      type="range"
                      class="chapter-slider"
                      min="0"
                      max={record.totalChapters}
                      step="1"
                      bind:value={chapterDraft}
                    />
                  {/if}
                  <div class="chapter-editor-actions">
                    <button class="chapter-save-btn" onclick={() => submitChapter(record)}>Save</button>
                    <button class="chapter-cancel-btn" onclick={cancelChapterEditor}>Cancel</button>
                  </div>
                </div>
              {:else if progress !== null}
                <div class="record-progress clickable" role="button" tabindex="0"
                  onclick={() => openChapterEditor(record)}
                  onkeydown={(e) => e.key === "Enter" && openChapterEditor(record)}
                  title="Click to edit"
                >
                  <div class="progress-track">
                    <div class="progress-fill" style="width:{progress}%"></div>
                  </div>
                  <span class="progress-label">Ch. {record.lastChapterRead} / {record.totalChapters}</span>
                  <span class="progress-edit-hint">✎</span>
                </div>
              {:else}
                <div class="record-progress clickable no-total" role="button" tabindex="0"
                  onclick={() => openChapterEditor(record)}
                  onkeydown={(e) => e.key === "Enter" && openChapterEditor(record)}
                  title="Click to set chapter"
                >
                  <span class="progress-label">
                    {record.lastChapterRead > 0 ? `Ch. ${record.lastChapterRead} read` : "Set chapter…"}
                  </span>
                  <span class="progress-edit-hint">✎</span>
                </div>
              {/if}

            </div>
          </div>
        {/each}
      </div>
    {/if}

  </div>
</div>

<style>
  .page { display: flex; flex-direction: column; height: 100%; overflow: hidden; animation: fadeIn 0.14s ease both; }

  /* ── Header ─────────────────────────────────────────────────────────────── */
  .header { flex-shrink: 0; border-bottom: 1px solid var(--border-dim); background: var(--bg-base); }
  .header-top { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-4) var(--sp-6) var(--sp-3); }
  .heading { font-family: var(--font-ui); font-size: var(--text-xs); font-weight: var(--weight-normal); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; }
  .header-actions { display: flex; align-items: center; gap: var(--sp-2); }
  .icon-btn { display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: var(--radius-sm); border: none; color: var(--text-faint); background: none; cursor: pointer; transition: color var(--t-base), background var(--t-base); }
  .icon-btn:hover:not(:disabled) { color: var(--text-muted); background: var(--bg-raised); }
  .icon-btn:disabled { opacity: 0.3; cursor: default; }

  /* ── Tracker tabs ───────────────────────────────────────────────────────── */
  .tracker-tabs { display: flex; align-items: center; gap: 1px; padding: 0 var(--sp-5); overflow-x: auto; scrollbar-width: none; }
  .tracker-tabs::-webkit-scrollbar { display: none; }
  .tracker-tab {
    display: flex; align-items: center; gap: var(--sp-2);
    padding: 9px 10px 8px;
    font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide);
    color: var(--text-faint); background: none; border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0; cursor: pointer; white-space: nowrap;
    transition: color var(--t-base), border-color var(--t-base);
    margin-bottom: -1px;
  }
  .tracker-tab:hover { color: var(--text-muted); }
  .tab-active { color: var(--text-secondary) !important; border-bottom-color: var(--accent); }
  .tab-tracker-icon { width: 13px; height: 13px; border-radius: 2px; object-fit: contain; opacity: 0.85; }
  .tab-count { font-size: 10px; padding: 0 4px; border-radius: var(--radius-full); background: var(--bg-overlay); color: var(--text-faint); min-width: 16px; text-align: center; line-height: 16px; }
  .tab-active .tab-count { background: var(--accent-muted); color: var(--accent-fg); }

  /* ── Filter bar ─────────────────────────────────────────────────────────── */
  .filter-bar { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--sp-5); border-top: 1px solid var(--border-dim); }
  .search-wrap { display: flex; align-items: center; gap: var(--sp-2); flex: 1; background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-md); padding: 4px 10px; }
  :global(.search-ico) { color: var(--text-faint); flex-shrink: 0; }
  .filter-search { flex: 1; background: none; border: none; outline: none; font-size: var(--text-sm); color: var(--text-primary); min-width: 0; }
  .filter-search::placeholder { color: var(--text-faint); }
  .filter-right { display: flex; align-items: center; gap: var(--sp-2); flex-shrink: 0; }
  .filter-select {
    font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide);
    padding: 4px 24px 4px 8px; border-radius: var(--radius-sm);
    border: 1px solid var(--border-dim); background: var(--bg-raised);
    color: var(--text-faint); outline: none; cursor: pointer;
    appearance: none; -webkit-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23555' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 7px center;
    transition: border-color var(--t-base), color var(--t-base);
  }
  .filter-select:hover { border-color: var(--border-strong); color: var(--text-muted); }
  .filter-select option { background: var(--bg-surface); color: var(--text-secondary); }

  /* ── Body ───────────────────────────────────────────────────────────────── */
  .page-body { flex: 1; overflow-y: auto; padding: var(--sp-3) var(--sp-5); scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent; }

  /* ── States ─────────────────────────────────────────────────────────────── */
  .state-center { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-3); height: 100%; padding: var(--sp-10); text-align: center; }
  .state-label { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .state-text  { font-size: var(--text-sm); color: var(--text-muted); }
  .state-hint  { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .state-error { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--color-error); letter-spacing: var(--tracking-wide); }
  .retry-btn { font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 5px 14px; border-radius: var(--radius-md); border: 1px solid var(--border-dim); background: none; color: var(--text-faint); cursor: pointer; transition: color var(--t-base), border-color var(--t-base); }
  .retry-btn:hover { color: var(--accent-fg); border-color: var(--accent-dim); }

  /* ── Records list ───────────────────────────────────────────────────────── */
  .records-list { display: flex; flex-direction: column; gap: 2px; }

  .record-card {
    display: flex; align-items: flex-start; gap: var(--sp-4);
    padding: var(--sp-3) var(--sp-3);
    border-radius: var(--radius-md);
    background: none;
    transition: background var(--t-fast), opacity var(--t-base);
  }
  .record-card:hover { background: var(--bg-raised); }
  .record-busy { opacity: 0.4; pointer-events: none; }

  /* Cover */
  .record-cover-wrap { position: relative; flex-shrink: 0; cursor: pointer; }
  .record-cover { width: 44px; height: 62px; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); display: block; transition: opacity var(--t-fast); }
  .record-cover-empty { background: var(--bg-overlay); }
  .record-cover-wrap:hover .record-cover { opacity: 0.75; }
  .record-tracker-badge { position: absolute; bottom: -3px; right: -3px; width: 14px; height: 14px; border-radius: 2px; border: 1px solid var(--bg-base); object-fit: contain; background: var(--bg-raised); }

  /* Body */
  .record-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
  .record-top  { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-3); }
  .record-titles { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; cursor: pointer; }
  .record-title { font-size: var(--text-sm); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: color var(--t-base); }
  .record-titles:hover .record-title { color: var(--accent-fg); }
  .record-local-title { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .record-header-actions { display: flex; align-items: center; gap: 1px; flex-shrink: 0; }
  .record-tracker-label { display: flex; align-items: center; gap: 4px; font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); padding: 2px 6px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: var(--bg-overlay); margin-right: var(--sp-1); }
  .record-tracker-label-icon { width: 11px; height: 11px; border-radius: 2px; object-fit: contain; }
  .card-icon-btn { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: var(--radius-sm); color: var(--text-faint); background: none; border: none; cursor: pointer; text-decoration: none; transition: color var(--t-base), background var(--t-base); }
  .card-icon-btn:hover { color: var(--text-muted); background: var(--bg-overlay); }
  .card-icon-btn.danger:hover { color: var(--color-error); background: var(--color-error-bg); }
  .card-icon-btn:disabled { opacity: 0.3; cursor: default; }

  /* Controls */
  .record-controls { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
  .record-select {
    font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide);
    padding: 3px 22px 3px 7px; border-radius: var(--radius-sm);
    border: 1px solid transparent; background: var(--bg-overlay);
    color: var(--text-faint); outline: none; cursor: pointer;
    appearance: none; -webkit-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23555' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 6px center;
    transition: border-color var(--t-base), color var(--t-base), background var(--t-base);
  }
  .record-select:hover:not(:disabled) { border-color: var(--border-dim); color: var(--text-secondary); background: var(--bg-raised); }
  .record-select:disabled { opacity: 0.35; cursor: default; }
  .record-select option { background: var(--bg-surface); color: var(--text-secondary); }
  .record-select-score { max-width: 86px; }
  .private-badge { display: flex; align-items: center; color: var(--text-faint); padding: 2px 4px; }

  /* Progress */
  .record-progress { display: flex; align-items: center; gap: var(--sp-3); }
  .progress-track { flex: 1; height: 2px; background: var(--border-strong); border-radius: var(--radius-full); overflow: hidden; max-width: 140px; }
  .progress-fill  { height: 100%; background: var(--accent); border-radius: var(--radius-full); transition: width 0.3s ease; }
  .progress-label { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); white-space: nowrap; }
  .record-progress.clickable { cursor: pointer; border-radius: var(--radius-sm); padding: 2px 4px; margin: -2px -4px; transition: background var(--t-fast); }
  .record-progress.clickable:hover { background: var(--bg-overlay); }
  .record-progress.clickable:hover .progress-label { color: var(--text-muted); }
  .progress-edit-hint { font-size: 10px; color: var(--text-faint); opacity: 0; transition: opacity var(--t-fast); }
  .record-progress.clickable:hover .progress-edit-hint { opacity: 1; }

  /* Chapter editor */
  .chapter-editor { display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-3); border-radius: var(--radius-md); border: 1px solid var(--border-dim); background: var(--bg-raised); }
  .chapter-editor-top { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); }
  .chapter-editor-label { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .chapter-input-wrap { display: flex; align-items: center; gap: var(--sp-2); }
  .chapter-input { width: 72px; background: var(--bg-surface); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: 4px 8px; font-family: var(--font-ui); font-size: var(--text-sm); color: var(--text-primary); outline: none; text-align: center; appearance: none; -webkit-appearance: none; -moz-appearance: textfield; }
  .chapter-input:focus { border-color: var(--accent); }
  .chapter-input::-webkit-outer-spin-button,
  .chapter-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .chapter-total { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .chapter-slider { width: 100%; accent-color: var(--accent); cursor: pointer; height: 3px; }
  .chapter-editor-actions { display: flex; align-items: center; gap: var(--sp-2); justify-content: flex-end; }
  .chapter-save-btn { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); padding: 4px 12px; border-radius: var(--radius-sm); border: 1px solid var(--accent-dim); background: var(--accent-muted); color: var(--accent-fg); cursor: pointer; transition: filter var(--t-base); }
  .chapter-save-btn:hover { filter: brightness(1.15); }
  .chapter-cancel-btn { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); padding: 4px 8px; border-radius: var(--radius-sm); border: none; background: none; color: var(--text-faint); cursor: pointer; transition: color var(--t-base); }
  .chapter-cancel-btn:hover { color: var(--text-muted); }

  @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
</style>

<script module>
  function focusEl(node: HTMLElement) { setTimeout(() => node.focus(), 0); }
</script>
