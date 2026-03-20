<script lang="ts">
  import { ClockCounterClockwise, Trash, MagnifyingGlass, Play, Books, Fire, BookOpen, Clock, TrendUp } from "phosphor-svelte";
  import { thumbUrl } from "../../lib/client";
  import { store, clearHistory, openReader, setActiveManga } from "../../store/state.svelte";
  import type { HistoryEntry } from "../../store/state.svelte";

  let search       = $state("");
  let confirmClear = $state(false);

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
    mangaId:           number;
    mangaTitle:        string;
    thumbnailUrl:      string;
    latestChapterId:   number;
    latestChapterName: string;
    latestPageNumber:  number;
    firstChapterName:  string;
    chapterCount:      number;
    readAt:            number;
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
        if (next.mangaId === anchor.mangaId && anchor.readAt - next.readAt <= SESSION_GAP_MS) {
          group.push(next); j++;
        } else break;
      }
      const latest = group[0], oldest = group[group.length - 1];
      sessions.push({
        mangaId:           latest.mangaId,
        mangaTitle:        latest.mangaTitle,
        thumbnailUrl:      latest.thumbnailUrl,
        latestChapterId:   latest.chapterId,
        latestChapterName: latest.chapterName,
        latestPageNumber:  latest.pageNumber,
        firstChapterName:  oldest.chapterName,
        chapterCount:      group.length,
        readAt:            latest.readAt,
      });
      i = j;
    }
    return sessions;
  }

  const filtered = $derived(search.trim()
    ? store..filter((e) =>
        e.mangaTitle.toLowerCase().includes(search.toLowerCase()) ||
        e.chapterName.toLowerCase().includes(search.toLowerCase())
      )
    : store.);

  const sessions = $derived(buildSessions(filtered));

  const groups = $derived.by(() => {
    const map = new Map<string, Session[]>();
    for (const s of sessions) {
      const l = dayLabel(s.readAt);
      if (!map.has(l)) map.set(l, []);
      map.get(l)!.push(s);
    }
    return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
  });

  function resume(session: Session) {
    const ch = store..find((c) => c.id === session.latestChapterId);
    if (ch && store..length > 0) openReader(ch, );
    else setActiveManga({ id: session.mangaId, title: session.mangaTitle, thumbnailUrl: session.thumbnailUrl } as any);
  }

  function handleClear() {
    if (!confirmClear) { confirmClear = true; setTimeout(() => confirmClear = false, 3000); return; }
    clearHistory(); confirmClear = false;
  }
</script>

<div class="root">

  <div class="page-header">
    <span class="heading">History</span>
    <div class="header-right">
      <div class="search-wrap">
        <MagnifyingGlass size={12} class="search-icon" weight="light" />
        <input class="search" placeholder="Search store.…" bind:value={search} />
        {#if search}<button class="search-clear" onclick={() => search = ""}>×</button>{/if}
      </div>
      {#if store..length > 0}
        <button class="clear-btn" class:confirm={confirmClear} onclick={handleClear}
          title={confirmClear ? "Click again to confirm" : "Clear store. feed"}>
          <Trash size={14} weight="light" />
          {#if confirmClear}<span class="clear-label">Confirm?</span>{/if}
        </button>
      {/if}
    </div>
  </div>

  {#if store..totalChaptersRead > 0}
    <div class="stats-bar">
      <div class="stat-group">
        <Fire size={13} weight="fill" class="stat-fire" />
        <span class="stat-val accent">{store..currentStreakDays}</span>
        <span class="stat-label">day streak</span>
      </div>
      <div class="stat-sep"></div>
      <div class="stat-group">
        <BookOpen size={13} weight="light" class="stat-icon-neutral" />
        <span class="stat-val">{store..totalChaptersRead}</span>
        <span class="stat-label">chapters</span>
      </div>
      <div class="stat-sep"></div>
      <div class="stat-group">
        <Clock size={13} weight="light" class="stat-icon-neutral" />
        <span class="stat-val">{formatReadTime(store..totalMinutesRead)}</span>
        <span class="stat-label">read time</span>
      </div>
      <div class="stat-sep"></div>
      <div class="stat-group">
        <TrendUp size={13} weight="light" class="stat-icon-neutral" />
        <span class="stat-val">{store..totalMangaRead}</span>
        <span class="stat-label">series</span>
      </div>
      <div class="stat-sep"></div>
      <div class="stat-group">
        <span class="stat-val muted">{store..longestStreakDays}d</span>
        <span class="stat-label">best streak</span>
      </div>
      <span class="stats-note">Stats are preserved when you clear the feed</span>
    </div>
  {/if}

  {#if store..length === 0}
    <div class="empty">
      <ClockCounterClockwise size={32} weight="light" class="empty-icon" />
      <p class="empty-text">No reading store.</p>
      <p class="empty-hint">Chapters you read will appear here</p>
    </div>
  {:else if sessions.length === 0}
    <div class="empty">
      <Books size={28} weight="light" class="empty-icon" />
      <p class="empty-text">No results for "{search}"</p>
    </div>
  {:else}
    <div class="timeline">
      {#each groups as { label, items }}
        <div class="day-group">
          <div class="day-label-row">
            <span class="day-label">{label}</span>
            <div class="day-line"></div>
          </div>
          <div class="session-list">
            {#each items as session (session.latestChapterId)}
              <button class="session-row" onclick={() => resume(session)}>
                <div class="thumb-wrap">
                  <img src={thumbUrl(session.thumbnailUrl)} alt={session.mangaTitle} class="thumb" />
                  {#if session.chapterCount > 1}
                    <span class="session-count">{session.chapterCount}</span>
                  {/if}
                </div>
                <div class="session-info">
                  <span class="session-title">{session.mangaTitle}</span>
                  <span class="session-chapter">
                    {#if session.chapterCount > 1}
                      {session.firstChapterName}
                      <span class="ch-arrow">→</span>
                      {session.latestChapterName}
                    {:else}
                      {session.latestChapterName}
                      {#if session.latestPageNumber > 1}
                        <span class="ch-page">p.{session.latestPageNumber}</span>
                      {/if}
                    {/if}
                  </span>
                </div>
                <span class="session-time">{timeAgo(session.readAt)}</span>
                <div class="play-pill">
                  <Play size={10} weight="fill" /> Resume
                </div>
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}

</div>

<style>
  .root { display: flex; flex-direction: column; height: 100%; overflow: hidden; animation: fadeIn 0.14s ease both; }

  .page-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: var(--sp-4) var(--sp-6); border-bottom: 1px solid var(--border-dim); flex-shrink: 0;
  }
  .heading { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; }
  .header-right { display: flex; align-items: center; gap: var(--sp-2); }

  .search-wrap { position: relative; display: flex; align-items: center; }
  .search-wrap :global(.search-icon) { position: absolute; left: 9px; color: var(--text-faint); pointer-events: none; }
  .search { background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-md); padding: 5px 26px 5px 26px; color: var(--text-primary); font-size: var(--text-sm); width: 180px; outline: none; transition: border-color var(--t-base); }
  .search::placeholder { color: var(--text-faint); }
  .search:focus { border-color: var(--border-strong); }
  .search-clear { position: absolute; right: 7px; color: var(--text-faint); font-size: 14px; line-height: 1; background: none; border: none; cursor: pointer; padding: 2px; transition: color var(--t-base); }
  .search-clear:hover { color: var(--text-muted); }

  .clear-btn {
    display: flex; align-items: center; gap: 5px;
    height: 28px; padding: 0 var(--sp-2); border-radius: var(--radius-md);
    color: var(--text-faint); background: none; border: 1px solid transparent;
    cursor: pointer; font-family: var(--font-ui); font-size: var(--text-2xs);
    letter-spacing: var(--tracking-wide);
    transition: color var(--t-base), background var(--t-base), border-color var(--t-base);
  }
  .clear-btn:hover { color: var(--color-error); background: var(--color-error-bg); }
  .clear-btn.confirm { color: var(--color-error); background: var(--color-error-bg); border-color: var(--color-error); }
  .clear-label { font-size: var(--text-2xs); }

  .stats-bar {
    display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap;
    padding: var(--sp-3) var(--sp-6); border-bottom: 1px solid var(--border-dim);
    background: var(--bg-raised); flex-shrink: 0;
  }
  .stat-group { display: flex; align-items: center; gap: 5px; }
  .stat-sep { width: 1px; height: 14px; background: var(--border-dim); flex-shrink: 0; }
  :global(.stat-fire) { color: #f97316; }
  :global(.stat-icon-neutral) { color: var(--text-faint); }
  .stat-val { font-family: var(--font-ui); font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-secondary); }
  .stat-val.accent { color: var(--accent-fg); }
  .stat-val.muted { color: var(--text-faint); }
  .stat-label { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .stats-note { margin-left: auto; font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); opacity: 0.5; letter-spacing: var(--tracking-wide); font-style: italic; }

  .timeline { flex: 1; overflow-y: auto; padding: var(--sp-4) var(--sp-6); }

  .day-group { margin-bottom: var(--sp-5); }
  .day-label-row { display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-3); }
  .day-label { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; white-space: nowrap; flex-shrink: 0; }
  .day-line { flex: 1; height: 1px; background: var(--border-dim); }

  .session-list { display: flex; flex-direction: column; gap: 2px; }

  .session-row {
    display: flex; align-items: center; gap: var(--sp-3);
    width: 100%; padding: 8px var(--sp-3); border-radius: var(--radius-md);
    border: 1px solid transparent; background: none; text-align: left; cursor: pointer;
    transition: background var(--t-fast), border-color var(--t-fast);
  }
  .session-row:hover { background: var(--bg-raised); border-color: var(--border-dim); }
  .session-row:hover .play-pill { opacity: 1; transform: translateX(0); }

  .thumb-wrap { position: relative; flex-shrink: 0; }
  .thumb { width: 38px; height: 54px; border-radius: var(--radius-sm); object-fit: cover; display: block; background: var(--bg-raised); border: 1px solid var(--border-dim); }
  .session-count {
    position: absolute; bottom: -4px; right: -6px;
    background: var(--accent-muted); border: 1px solid var(--accent-dim); color: var(--accent-fg);
    font-family: var(--font-ui); font-size: 9px; font-weight: 600;
    padding: 1px 4px; border-radius: 6px; line-height: 1.4; pointer-events: none;
  }

  .session-info { flex: 1; display: flex; flex-direction: column; gap: 3px; overflow: hidden; min-width: 0; }
  .session-title { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .session-chapter { font-size: var(--text-xs); color: var(--text-muted); display: flex; align-items: center; gap: var(--sp-1); min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ch-arrow { color: var(--text-faint); font-size: 10px; flex-shrink: 0; }
  .ch-page { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); flex-shrink: 0; }

  .session-time { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); flex-shrink: 0; white-space: nowrap; }
  .play-pill {
    display: flex; align-items: center; gap: 4px; flex-shrink: 0;
    font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide);
    color: var(--accent-fg); background: var(--accent-muted); border: 1px solid var(--accent-dim);
    padding: 3px 8px; border-radius: var(--radius-full);
    opacity: 0; transform: translateX(4px);
    transition: opacity var(--t-base), transform var(--t-base);
  }

  .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-2); }
  :global(.empty-icon) { color: var(--text-faint); }
  .empty-text { font-size: var(--text-base); color: var(--text-muted); }
  .empty-hint { font-size: var(--text-sm); color: var(--text-faint); }

  @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
</style>
