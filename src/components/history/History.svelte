<script lang="ts">
  import { derived } from "svelte/store";
  import { ClockCounterClockwise, Trash, MagnifyingGlass, Play, Books } from "phosphor-svelte";
  import { thumbUrl } from "../../lib/client";
  import { history, settings, activeManga, activeChapter, activeChapterList, openReader } from "../../store";
  import type { HistoryEntry } from "../../store";

  let search = "";

  function timeAgo(ts: number): string {
    const diff = Date.now() - ts, m = Math.floor(diff / 60000);
    if (m < 1)  return "Just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7)  return `${d}d ago`;
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function dayLabel(ts: number): string {
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return "Today";
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  }

  function formatReadTime(m: number): string {
    if (m < 1)  return "< 1 min";
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return r === 0 ? `${h}h` : `${h}h ${r}m`;
  }

  const SESSION_GAP_MS = 30 * 60 * 1000;

  interface Session {
    mangaId: number; mangaTitle: string; thumbnailUrl: string;
    latestChapterId: number; latestChapterName: string; latestPageNumber: number;
    firstChapterName: string; chapterCount: number; readAt: number;
  }

  function buildSessions(entries: HistoryEntry[]): Session[] {
    if (!entries.length) return [];
    const sessions: Session[] = [];
    let i = 0;
    while (i < entries.length) {
      const anchor = entries[i];
      const group: HistoryEntry[] = [anchor];
      let j = i + 1;
      while (j < entries.length) {
        const next = entries[j];
        if (next.mangaId === anchor.mangaId && anchor.readAt - next.readAt <= SESSION_GAP_MS) { group.push(next); j++; }
        else break;
      }
      const latest = group[0], oldest = group[group.length - 1];
      sessions.push({
        mangaId: latest.mangaId, mangaTitle: latest.mangaTitle, thumbnailUrl: latest.thumbnailUrl,
        latestChapterId: latest.chapterId, latestChapterName: latest.chapterName,
        latestPageNumber: latest.pageNumber, firstChapterName: oldest.chapterName,
        chapterCount: group.length, readAt: latest.readAt,
      });
      i = j;
    }
    return sessions;
  }

  $: filtered = search.trim()
    ? $history.filter((e) => e.mangaTitle.toLowerCase().includes(search.toLowerCase()) || e.chapterName.toLowerCase().includes(search.toLowerCase()))
    : $history;

  $: sessions = buildSessions(filtered);

  $: groups = (() => {
    const map = new Map<string, Session[]>();
    for (const s of sessions) {
      const l = dayLabel(s.readAt);
      if (!map.has(l)) map.set(l, []);
      map.get(l)!.push(s);
    }
    return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
  })();

  $: stats = $history.length ? {
    uniqueChapters: new Set($history.map((e) => e.chapterId)).size,
    uniqueManga:    new Set($history.map((e) => e.mangaId)).size,
    estimatedMinutes: Math.round(new Set($history.map((e) => e.chapterId)).size * 4.5),
  } : null;

  function resume(session: Session) {
    const ch = $activeChapterList.find((c) => c.id === session.latestChapterId);
    if (ch && $activeChapterList.length > 0) openReader(ch, $activeChapterList);
    else activeManga.set({ id: session.mangaId, title: session.mangaTitle, thumbnailUrl: session.thumbnailUrl } as any);
  }
</script>

<div class="root">
  <div class="header">
    <h1 class="heading">History</h1>
    <div class="header-right">
      <div class="search-wrap">
        <MagnifyingGlass size={12} class="search-icon" weight="light" />
        <input class="search" placeholder="Search history…" bind:value={search} />
        {#if search}
          <button class="search-clear" on:click={() => search = ""}>×</button>
        {/if}
      </div>
      {#if $history.length > 0}
        <button class="clear-btn" on:click={() => history.set([])} title="Clear all history">
          <Trash size={14} weight="light" />
        </button>
      {/if}
    </div>
  </div>

  {#if stats}
    <div class="stats-bar">
      <span class="stat-item">
        <span class="stat-val">{stats.uniqueChapters}</span>
        <span class="stat-label">chapters read</span>
      </span>
      <span class="stat-div"></span>
      <span class="stat-item">
        <span class="stat-val">{stats.uniqueManga}</span>
        <span class="stat-label">series</span>
      </span>
      <span class="stat-div"></span>
      <span class="stat-item">
        <span class="stat-val">{formatReadTime(stats.estimatedMinutes)}</span>
        <span class="stat-label">est. read time</span>
      </span>
    </div>
  {/if}

  {#if $history.length === 0}
    <div class="empty">
      <ClockCounterClockwise size={32} weight="light" class="empty-icon" />
      <p class="empty-text">No reading history yet</p>
      <p class="empty-hint">Chapters you read will appear here</p>
    </div>
  {:else if sessions.length === 0}
    <div class="empty">
      <Books size={28} weight="light" class="empty-icon" />
      <p class="empty-text">No results for "{search}"</p>
    </div>
  {:else}
    <div class="list">
      {#each groups as { label, items }}
        <div class="group">
          <p class="group-label">{label}</p>
          {#each items as session}
            <button class="row" on:click={() => resume(session)}>
              <div class="thumb-wrap">
                <img src={thumbUrl(session.thumbnailUrl)} alt={session.mangaTitle} class="thumb" />
                {#if session.chapterCount > 1}
                  <span class="session-badge">{session.chapterCount}</span>
                {/if}
              </div>
              <div class="info">
                <span class="manga-title">{session.mangaTitle}</span>
                <span class="chapter-name">
                  {#if session.chapterCount > 1}
                    <span class="chapter-range">
                      {session.firstChapterName}
                      <span class="range-sep">→</span>
                      {session.latestChapterName}
                    </span>
                  {:else}
                    {session.latestChapterName}
                    {#if session.latestPageNumber > 1}
                      <span class="page-badge">p.{session.latestPageNumber}</span>
                    {/if}
                  {/if}
                </span>
              </div>
              <span class="time">{timeAgo(session.readAt)}</span>
              <Play size={12} weight="fill" class="play-icon" />
            </button>
          {/each}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .root { display: flex; flex-direction: column; height: 100%; overflow: hidden; animation: fadeIn 0.14s ease both; }

  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: var(--sp-5) var(--sp-6) var(--sp-3); flex-shrink: 0;
    border-bottom: 1px solid var(--border-dim);
  }
  .heading {
    font-family: var(--font-ui); font-size: var(--text-xs); font-weight: var(--weight-normal);
    color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase;
  }
  .header-right { display: flex; align-items: center; gap: var(--sp-2); }

  .search-wrap { position: relative; display: flex; align-items: center; }
  .search-wrap :global(.search-icon) { position: absolute; left: 9px; color: var(--text-faint); pointer-events: none; }
  .search {
    background: var(--bg-raised); border: 1px solid var(--border-dim);
    border-radius: var(--radius-md); padding: 5px 28px 5px 26px;
    color: var(--text-primary); font-size: var(--text-sm); width: 180px; outline: none;
    transition: border-color var(--t-base);
  }
  .search::placeholder { color: var(--text-faint); }
  .search:focus { border-color: var(--border-strong); }
  .search-clear {
    position: absolute; right: 7px; color: var(--text-faint); font-size: 14px; line-height: 1;
    background: none; border: none; cursor: pointer; padding: 2px; transition: color var(--t-base);
  }
  .search-clear:hover { color: var(--text-muted); }
  .clear-btn {
    display: flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border-radius: var(--radius-md);
    color: var(--text-faint); transition: color var(--t-base), background var(--t-base);
  }
  .clear-btn:hover { color: var(--color-error); background: var(--color-error-bg); }

  .stats-bar {
    display: flex; align-items: center; gap: var(--sp-3);
    padding: var(--sp-2) var(--sp-6); border-bottom: 1px solid var(--border-dim);
    flex-shrink: 0; background: var(--bg-raised);
  }
  .stat-item { display: flex; align-items: baseline; gap: 5px; }
  .stat-val { font-family: var(--font-ui); font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--accent-fg); }
  .stat-label { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .stat-div { width: 1px; height: 12px; background: var(--border-dim); flex-shrink: 0; }

  .list { flex: 1; overflow-y: auto; padding: var(--sp-4) var(--sp-6); }
  .group { margin-bottom: var(--sp-5); }
  .group-label {
    font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint);
    letter-spacing: var(--tracking-wider); text-transform: uppercase;
    margin-bottom: var(--sp-2); padding: 0 var(--sp-1);
  }
  .row {
    display: flex; align-items: center; gap: var(--sp-3);
    width: 100%; padding: 8px var(--sp-2); border-radius: var(--radius-md);
    border: 1px solid transparent; background: none; text-align: left; cursor: pointer;
    transition: background var(--t-fast), border-color var(--t-fast);
  }
  .row:hover { background: var(--bg-raised); border-color: var(--border-dim); }
  .row:hover :global(.play-icon) { opacity: 1; }

  .thumb-wrap { position: relative; flex-shrink: 0; }
  .thumb {
    width: 36px; height: 52px; border-radius: var(--radius-sm); object-fit: cover;
    display: block; background: var(--bg-raised); border: 1px solid var(--border-dim);
  }
  .session-badge {
    position: absolute; bottom: -4px; right: -6px;
    background: var(--accent-muted); border: 1px solid var(--accent-dim); color: var(--accent-fg);
    font-family: var(--font-ui); font-size: 9px; font-weight: 600;
    padding: 1px 4px; border-radius: 6px; line-height: 1.4; pointer-events: none;
  }

  .info { flex: 1; display: flex; flex-direction: column; gap: 3px; overflow: hidden; min-width: 0; }
  .manga-title {
    font-size: var(--text-base); font-weight: var(--weight-medium);
    color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .chapter-name {
    font-size: var(--text-sm); color: var(--text-muted);
    display: flex; align-items: center; gap: var(--sp-1); min-width: 0;
  }
  .chapter-range {
    display: flex; align-items: center; gap: 5px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-muted);
  }
  .range-sep { color: var(--text-faint); font-size: 10px; flex-shrink: 0; }
  .page-badge { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); flex-shrink: 0; }
  .time { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); flex-shrink: 0; white-space: nowrap; }
  :global(.play-icon) { color: var(--text-faint); flex-shrink: 0; opacity: 0; transition: opacity var(--t-base); }

  .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-2); }
  :global(.empty-icon) { color: var(--text-faint); }
  .empty-text { font-size: var(--text-base); color: var(--text-muted); }
  .empty-hint { font-size: var(--text-sm); color: var(--text-faint); }
</style>
