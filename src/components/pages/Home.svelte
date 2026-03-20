<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import {
    Play, ArrowRight, ArrowLeft, BookOpen, Clock, Fire, TrendUp,
    CalendarBlank, CheckCircle, Star, PushPin, X as XIcon,
    MagnifyingGlass,
  } from "phosphor-svelte";
  import { gql, thumbUrl } from "../../lib/client";
  import { GET_LIBRARY, GET_MANGA } from "../../lib/queries";
  import { cache, CACHE_KEYS } from "../../lib/cache";
  import {
    history, readingStats, settings, activeManga, navPage,
    previewManga, openReader, activeChapterList,
    COMPLETED_FOLDER_ID, setHeroSlot, updateSettings,
  } from "../../store";
  import type { HistoryEntry } from "../../store";
  import type { Manga } from "../../lib/types";

  // ── Helpers ───────────────────────────────────────────────────────────────────
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
  function formatReadTime(m: number): string {
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60), r = m % 60;
    return r === 0 ? `${h}h` : `${h}h ${r}m`;
  }

  // ── Library data — loaded once ────────────────────────────────────────────────
  let libraryManga: Manga[] = [];
  let loadingLibrary = true;
  let searchQuery = "";

  onMount(() => {
    cache.get(CACHE_KEYS.LIBRARY, () =>
      gql<{ mangas: { nodes: Manga[] } }>(GET_LIBRARY).then(d => d.mangas.nodes)
    ).then(m => { libraryManga = m; })
     .catch(console.error)
     .finally(() => loadingLibrary = false);
  });

  // ── Continue reading — deduped by manga ───────────────────────────────────────
  $: continueReading = (() => {
    const seen = new Set<number>();
    const out: HistoryEntry[] = [];
    for (const e of $history) {
      if (seen.has(e.mangaId)) continue;
      seen.add(e.mangaId);
      out.push(e);
      if (out.length >= 10) break;
    }
    return out;
  })();

  // ── Hero slots ────────────────────────────────────────────────────────────────
  // Slot 0: always auto (first continue-reading entry, not pinnable)
  // Slots 1-3: pinned mangaId OR auto (next continue-reading entries)
  const TOTAL_SLOTS = 4;

  interface HeroSlot {
    kind: "continue" | "pinned" | "empty";
    entry?: HistoryEntry;           // for "continue"
    manga?: Manga;                  // for "pinned"
    slotIndex: number;
  }

  $: resolvedSlots = (() => {
    const pins = $settings.heroSlots ?? [null, null, null, null];
    const slots: HeroSlot[] = [];

    // Slot 0 — always continue reading
    const first = continueReading[0];
    slots.push(first
      ? { kind: "continue", entry: first, slotIndex: 0 }
      : { kind: "empty", slotIndex: 0 }
    );

    // Slots 1-3
    let historyIdx = 1; // which continueReading entry to use for auto
    for (let i = 1; i < TOTAL_SLOTS; i++) {
      const pinId = pins[i];
      if (pinId !== null && pinId !== undefined) {
        const manga = libraryManga.find(m => m.id === pinId);
        if (manga) { slots.push({ kind: "pinned", manga, slotIndex: i }); continue; }
      }
      // Auto — use next recent history entry
      const entry = continueReading[historyIdx];
      historyIdx++;
      slots.push(entry
        ? { kind: "continue", entry, slotIndex: i }
        : { kind: "empty", slotIndex: i }
      );
    }
    return slots;
  })();

  // ── Active hero index ─────────────────────────────────────────────────────────
  let activeIdx = 0;
  $: activeSlot = resolvedSlots[activeIdx];

  // ── Manga detail for active pinned slot ───────────────────────────────────────
  // For "continue" slots we have thumbnailUrl from history.
  // For "pinned" slots we have the full Manga object.
  $: heroThumb = activeSlot?.kind === "pinned"
    ? thumbUrl(activeSlot.manga?.thumbnailUrl ?? "")
    : activeSlot?.kind === "continue"
      ? thumbUrl(activeSlot.entry?.thumbnailUrl ?? "")
      : "";

  $: heroTitle = activeSlot?.kind === "pinned"
    ? activeSlot.manga?.title ?? ""
    : activeSlot?.kind === "continue"
      ? activeSlot.entry?.mangaTitle ?? ""
      : "";

  $: heroManga = activeSlot?.kind === "pinned"
    ? activeSlot.manga
    : activeSlot?.kind === "continue"
      ? libraryManga.find(m => m.id === activeSlot.entry?.mangaId)
      : null;

  $: heroEntry = activeSlot?.kind === "continue" ? activeSlot.entry : null;

  // Svelte action — focuses element on mount, avoiding the a11y autofocus warning
  function focusEl(node: HTMLElement) { node.focus(); }

  function cycleNext() { activeIdx = (activeIdx + 1) % TOTAL_SLOTS; }
  function cyclePrev() { activeIdx = (activeIdx - 1 + TOTAL_SLOTS) % TOTAL_SLOTS; }
  function goToSlot(i: number) { activeIdx = i; }

  // Keyboard: left/right arrow keys when no modal is open
  function onKey(e: KeyboardEvent) {
    if (e.target !== document.body && !(e.target instanceof HTMLElement && e.target.closest(".hero-section"))) return;
    if (e.key === "ArrowRight") cycleNext();
    if (e.key === "ArrowLeft")  cyclePrev();
  }
  onMount(() => window.addEventListener("keydown", onKey));
  onDestroy(() => window.removeEventListener("keydown", onKey));

  // ── Slot picker (pin / unpin) ─────────────────────────────────────────────────
  let pickerOpen = false;
  let pickerSlotIndex: 1 | 2 | 3 | null = null;
  let pickerSearch = "";

  $: pickerResults = pickerSearch.trim()
    ? libraryManga.filter(m => m.title.toLowerCase().includes(pickerSearch.toLowerCase())).slice(0, 20)
    : libraryManga.slice(0, 20);

  function openPicker(slotIndex: 1 | 2 | 3) {
    pickerSlotIndex = slotIndex;
    pickerOpen = true;
    pickerSearch = "";
  }
  function closePicker() { pickerOpen = false; pickerSlotIndex = null; }

  function pinManga(manga: Manga) {
    if (pickerSlotIndex === null) return;
    setHeroSlot(pickerSlotIndex, manga.id);
    closePicker();
  }
  function unpinSlot(i: 1 | 2 | 3) {
    setHeroSlot(i, null);
  }

  function resumeActive() {
    if (!heroEntry && heroManga) {
      activeManga.set(heroManga);
      return;
    }
    if (!heroEntry) return;
    const ch = $activeChapterList.find(c => c.id === heroEntry!.chapterId);
    if (ch && $activeChapterList.length > 0) openReader(ch, $activeChapterList);
    else activeManga.set({ id: heroEntry.mangaId, title: heroEntry.mangaTitle, thumbnailUrl: heroEntry.thumbnailUrl } as any);
  }

  // ── Recently completed ────────────────────────────────────────────────────────
  $: completedIds = $settings.folders.find(f => f.id === COMPLETED_FOLDER_ID)?.mangaIds ?? [];
  $: completedManga = completedIds.length > 0
    ? libraryManga.filter(m => completedIds.includes(m.id)).slice(0, 12)
    : [];

  // ── Recent activity ───────────────────────────────────────────────────────────
  $: recentHistory = $history.slice(0, 8);

  // ── Stats ─────────────────────────────────────────────────────────────────────
  $: stats    = $readingStats;
  $: hasStats = stats.totalChaptersRead > 0;

  function handleRowWheel(e: WheelEvent) {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    const el = e.currentTarget as HTMLElement;
    e.stopPropagation(); el.scrollLeft += e.deltaY;
  }
</script>

<div class="root">
  <div class="page-header">
    <span class="heading">Home</span>
  </div>

  <div class="body">

    <!-- ── Hero section ───────────────────────────────────────────────────────── -->
    <div class="hero-section" tabindex="-1">
      <div class="hero-stage">

        <!-- Cover backdrop (blurred) -->
        {#if heroThumb}
          <div class="hero-backdrop" style="background-image:url({heroThumb})"></div>
        {:else}
          <div class="hero-backdrop hero-backdrop-empty"></div>
        {/if}
        <div class="hero-scrim"></div>

        <!-- Left: Cover art -->
        <div class="hero-cover-col">
          {#if heroThumb}
            <img src={heroThumb} alt={heroTitle} class="hero-cover" loading="eager" decoding="async" />
          {:else}
            <div class="hero-cover hero-cover-placeholder">
              <BookOpen size={32} weight="light" class="placeholder-book" />
            </div>
          {/if}
        </div>

        <!-- Right: Info panel -->
        <div class="hero-info-col">
          {#if activeSlot?.kind === "empty"}
            <p class="hero-empty-label">Slot empty</p>
            <p class="hero-empty-sub">
              {activeSlot.slotIndex === 0
                ? "Start reading a manga to see it here"
                : "Pin a manga or read more to fill this slot"}
            </p>
            {#if activeSlot.slotIndex !== 0}
              <button class="hero-cta" on:click={() => openPicker(activeSlot.slotIndex as 1|2|3)}>
                <PushPin size={13} weight="fill" /> Pin a manga
              </button>
            {/if}
          {:else}
            <!-- Title & meta -->
            <div class="hero-tags">
              {#if activeSlot?.kind === "continue"}
                <span class="hero-tag hero-tag-reading"><Play size={9} weight="fill" /> Reading</span>
              {:else}
                <span class="hero-tag hero-tag-pinned"><PushPin size={9} weight="fill" /> Pinned</span>
              {/if}
              {#each (heroManga?.genre ?? []).slice(0, 3) as g}
                <span class="hero-tag">{g}</span>
              {/each}
            </div>

            <h2 class="hero-title">{heroTitle}</h2>

            {#if heroManga?.author}
              <p class="hero-author">{heroManga.author}</p>
            {/if}

            {#if heroEntry}
              <p class="hero-chapter">
                <Clock size={11} weight="light" />
                {heroEntry.chapterName}
                {#if heroEntry.pageNumber > 1}<span class="hero-page">· p.{heroEntry.pageNumber}</span>{/if}
                <span class="hero-time">{timeAgo(heroEntry.readAt)}</span>
              </p>
            {/if}

            {#if heroManga?.description}
              <p class="hero-desc">{heroManga.description}</p>
            {/if}

            <!-- CTAs -->
            <div class="hero-actions">
              {#if activeSlot?.kind === "continue"}
                <button class="hero-cta" on:click={resumeActive}>
                  <Play size={13} weight="fill" /> Resume
                </button>
              {:else}
                <button class="hero-cta" on:click={() => heroManga && previewManga.set(heroManga)}>
                  <BookOpen size={13} weight="light" /> View manga
                </button>
              {/if}
              {#if activeSlot?.slotIndex !== 0}
                {#if activeSlot?.kind === "pinned"}
                  <button class="hero-cta-ghost" on:click={() => unpinSlot(activeSlot.slotIndex as 1|2|3)}>
                    <XIcon size={11} weight="bold" /> Unpin
                  </button>
                {:else}
                  <button class="hero-cta-ghost" on:click={() => openPicker(activeSlot!.slotIndex as 1|2|3)}>
                    <PushPin size={11} weight="light" /> Pin a manga
                  </button>
                {/if}
              {/if}
            </div>
          {/if}
        </div>

        <!-- Nav arrows -->
        <button class="hero-nav hero-nav-left" on:click={cyclePrev} aria-label="Previous">
          <ArrowLeft size={16} weight="bold" />
        </button>
        <button class="hero-nav hero-nav-right" on:click={cycleNext} aria-label="Next">
          <ArrowRight size={16} weight="bold" />
        </button>

        <!-- Dot indicators -->
        <div class="hero-dots">
          {#each resolvedSlots as slot, i}
            <button
              class="hero-dot"
              class:hero-dot-active={activeIdx === i}
              class:hero-dot-pinned={slot.kind === "pinned"}
              on:click={() => goToSlot(i)}
              aria-label="Go to slot {i + 1}"
            ></button>
          {/each}
        </div>

        <!-- Slot index label -->
        <div class="hero-counter">{activeIdx + 1} / {TOTAL_SLOTS}</div>

      </div>
    </div>

    <!-- ── Stats strip ─────────────────────────────────────────────────────────── -->
    {#if hasStats}
      <div class="stats-strip">
        <div class="stat-card">
          <Fire size={16} weight="fill" class="stat-fire" />
          <span class="stat-val accent">{stats.currentStreakDays}</span>
          <span class="stat-label">day streak</span>
        </div>
        <div class="stat-div"></div>
        <div class="stat-card">
          <BookOpen size={15} weight="light" class="stat-neutral" />
          <span class="stat-val">{stats.totalChaptersRead}</span>
          <span class="stat-label">chapters</span>
        </div>
        <div class="stat-div"></div>
        <div class="stat-card">
          <Clock size={15} weight="light" class="stat-neutral" />
          <span class="stat-val">{formatReadTime(stats.totalMinutesRead)}</span>
          <span class="stat-label">read time</span>
        </div>
        <div class="stat-div"></div>
        <div class="stat-card">
          <TrendUp size={15} weight="light" class="stat-neutral" />
          <span class="stat-val">{stats.totalMangaRead}</span>
          <span class="stat-label">series</span>
        </div>
        <div class="stat-div"></div>
        <div class="stat-card">
          <CalendarBlank size={15} weight="light" class="stat-neutral" />
          <span class="stat-val muted">{stats.longestStreakDays}d</span>
          <span class="stat-label">best streak</span>
        </div>
      </div>
    {/if}

    <!-- ── Recently Completed ──────────────────────────────────────────────────── -->
    {#if completedIds.length > 0 && completedManga.length > 0}
      <div class="section">
        <div class="section-header">
          <span class="section-title"><CheckCircle size={11} weight="bold" /> Recently Completed</span>
          <button class="see-all" on:click={() => navPage.set("library")}>View all <ArrowRight size={10} weight="bold" /></button>
        </div>
        <div class="mini-row" on:wheel|preventDefault={handleRowWheel}>
          {#each completedManga as m (m.id)}
            <button class="mini-card" on:click={() => previewManga.set(m)}>
              <div class="mini-cover-wrap">
                <img src={thumbUrl(m.thumbnailUrl)} alt={m.title} class="mini-cover" loading="lazy" decoding="async" />
                <div class="completed-check"><CheckCircle size={14} weight="fill" /></div>
              </div>
              <p class="mini-title">{m.title}</p>
            </button>
          {/each}
          <div class="ghost" aria-hidden="true"></div>
        </div>
      </div>
    {/if}

    <!-- ── Recent Activity ────────────────────────────────────────────────────── -->
    {#if recentHistory.length > 0}
      <div class="section">
        <div class="section-header">
          <span class="section-title"><Clock size={11} weight="bold" /> Recent Activity</span>
          <button class="see-all" on:click={() => navPage.set("history")}>Full history <ArrowRight size={10} weight="bold" /></button>
        </div>
        <div class="activity-list">
          {#each recentHistory as entry (entry.chapterId)}
            <button class="activity-row" on:click={() => {
              const ch = $activeChapterList.find(c => c.id === entry.chapterId);
              if (ch && $activeChapterList.length > 0) openReader(ch, $activeChapterList);
              else activeManga.set({ id: entry.mangaId, title: entry.mangaTitle, thumbnailUrl: entry.thumbnailUrl } as any);
            }}>
              <div class="activity-thumb-wrap">
                <img src={thumbUrl(entry.thumbnailUrl)} alt={entry.mangaTitle} class="activity-thumb" loading="lazy" decoding="async" />
              </div>
              <div class="activity-info">
                <span class="activity-title">{entry.mangaTitle}</span>
                <span class="activity-chapter">
                  {entry.chapterName}
                  {#if entry.pageNumber > 1}<span class="activity-page">· p.{entry.pageNumber}</span>{/if}
                </span>
              </div>
              <span class="activity-time">{timeAgo(entry.readAt)}</span>
              <div class="activity-play"><Play size={11} weight="fill" /></div>
            </button>
          {/each}
        </div>
      </div>
    {:else}
      <div class="empty-activity">
        <p class="empty-text">Start reading to see activity here</p>
        <button class="empty-cta" on:click={() => navPage.set("library")}>
          Open Library <ArrowRight size={12} weight="bold" />
        </button>
      </div>
    {/if}

  </div>
</div>

<!-- ── Slot picker modal ──────────────────────────────────────────────────────── -->
{#if pickerOpen}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="picker-backdrop" on:click|self={closePicker}>
    <div class="picker-modal">
      <div class="picker-header">
        <span class="picker-title">Pin manga to slot {(pickerSlotIndex ?? 0) + 1}</span>
        <button class="picker-close" on:click={closePicker}><XIcon size={14} weight="light" /></button>
      </div>
      <div class="picker-search-wrap">
        <MagnifyingGlass size={13} weight="light" class="picker-search-icon" />
        <input class="picker-search" placeholder="Search library…" bind:value={pickerSearch} use:focusEl />
      </div>
      <div class="picker-list">
        {#if loadingLibrary}
          <p class="picker-empty">Loading library…</p>
        {:else if pickerResults.length === 0}
          <p class="picker-empty">No results</p>
        {:else}
          {#each pickerResults as m (m.id)}
            <button class="picker-row" on:click={() => pinManga(m)}>
              <img src={thumbUrl(m.thumbnailUrl)} alt={m.title} class="picker-thumb" loading="lazy" decoding="async" />
              <div class="picker-info">
                <span class="picker-manga-title">{m.title}</span>
                {#if m.source?.displayName}<span class="picker-source">{m.source.displayName}</span>{/if}
              </div>
              <PushPin size={13} weight="light" class="picker-pin-icon" />
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .root { display: flex; flex-direction: column; height: 100%; overflow: hidden; animation: fadeIn 0.14s ease both; }

  .page-header {
    display: flex; align-items: center; padding: var(--sp-4) var(--sp-6);
    border-bottom: 1px solid var(--border-dim); flex-shrink: 0;
  }
  .heading { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; }

  .body { flex: 1; overflow-y: auto; padding-bottom: var(--sp-8); will-change: scroll-position; }

  /* ── Hero stage ───────────────────────────────────────────────────────────── */
  .hero-section { padding: var(--sp-5) var(--sp-6) var(--sp-2); outline: none; }
  .hero-stage {
    position: relative; border-radius: var(--radius-xl); overflow: hidden;
    height: 220px; display: flex; align-items: stretch;
    background: var(--bg-raised); border: 1px solid var(--border-dim);
    box-shadow: 0 8px 32px rgba(0,0,0,0.35);
  }

  /* Blurred backdrop */
  .hero-backdrop {
    position: absolute; inset: -10px;
    background-size: cover; background-position: center;
    filter: blur(18px) saturate(1.2) brightness(0.45);
    transform: scale(1.05);
    pointer-events: none; z-index: 0;
  }
  .hero-backdrop-empty { background: var(--bg-void); filter: none; }
  .hero-scrim {
    position: absolute; inset: 0;
    background: linear-gradient(to right, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.4) 100%);
    z-index: 1; pointer-events: none;
  }

  /* Cover column */
  .hero-cover-col {
    position: relative; z-index: 2; flex-shrink: 0;
    width: 130px; padding: var(--sp-4);
    display: flex; align-items: center; justify-content: center;
  }
  .hero-cover {
    width: 100%; aspect-ratio: 2/3; object-fit: cover;
    border-radius: var(--radius-lg);
    box-shadow: 0 4px 20px rgba(0,0,0,0.6);
    display: block;
  }
  .hero-cover-placeholder {
    display: flex; align-items: center; justify-content: center;
    background: var(--bg-overlay); border-radius: var(--radius-lg);
    aspect-ratio: 2/3;
  }
  :global(.placeholder-book) { color: var(--text-faint); }

  /* Info column */
  .hero-info-col {
    position: relative; z-index: 2; flex: 1; min-width: 0;
    padding: var(--sp-4) var(--sp-5) var(--sp-4) var(--sp-3);
    display: flex; flex-direction: column; gap: var(--sp-2);
    overflow: hidden;
  }

  .hero-tags { display: flex; flex-wrap: wrap; gap: var(--sp-1); flex-shrink: 0; }
  .hero-tag {
    font-family: var(--font-ui); font-size: 9px; letter-spacing: var(--tracking-wide);
    text-transform: uppercase; padding: 2px 6px; border-radius: var(--radius-sm);
    background: rgba(255,255,255,0.12); color: rgba(255,255,255,0.7);
    border: 1px solid rgba(255,255,255,0.15);
  }
  .hero-tag-reading { background: var(--accent-muted); color: var(--accent-fg); border-color: var(--accent-dim); }
  .hero-tag-pinned  { background: rgba(168,132,232,0.2); color: #c4a8f0; border-color: rgba(168,132,232,0.3); }

  .hero-title {
    font-size: var(--text-base); font-weight: var(--weight-medium);
    color: #fff; line-height: var(--leading-snug);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    text-shadow: 0 1px 6px rgba(0,0,0,0.6);
    flex-shrink: 0;
  }
  .hero-author {
    font-family: var(--font-ui); font-size: var(--text-2xs); color: rgba(255,255,255,0.55);
    letter-spacing: var(--tracking-wide); flex-shrink: 0;
  }
  .hero-chapter {
    display: flex; align-items: center; gap: 5px;
    font-family: var(--font-ui); font-size: var(--text-2xs); color: rgba(255,255,255,0.65);
    letter-spacing: var(--tracking-wide); flex-shrink: 0;
  }
  .hero-page { color: rgba(255,255,255,0.45); }
  .hero-time { margin-left: auto; color: rgba(255,255,255,0.4); }
  .hero-desc {
    font-size: var(--text-xs); color: rgba(255,255,255,0.5); line-height: var(--leading-snug);
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
    flex: 1; min-height: 0;
  }

  /* Empty slot */
  .hero-empty-label { font-size: var(--text-sm); font-weight: var(--weight-medium); color: rgba(255,255,255,0.6); }
  .hero-empty-sub   { font-family: var(--font-ui); font-size: var(--text-xs); color: rgba(255,255,255,0.35); letter-spacing: var(--tracking-wide); line-height: var(--leading-snug); }

  /* CTAs */
  .hero-actions { display: flex; gap: var(--sp-2); flex-shrink: 0; flex-wrap: wrap; }
  .hero-cta {
    display: inline-flex; align-items: center; gap: var(--sp-1);
    font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide);
    padding: 6px 14px; border-radius: var(--radius-full);
    background: var(--accent-muted); border: 1px solid var(--accent-dim); color: var(--accent-fg);
    cursor: pointer; transition: filter var(--t-base); white-space: nowrap;
  }
  .hero-cta:hover { filter: brightness(1.15); }
  .hero-cta-ghost {
    display: inline-flex; align-items: center; gap: var(--sp-1);
    font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide);
    padding: 6px 14px; border-radius: var(--radius-full);
    background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
    color: rgba(255,255,255,0.6); cursor: pointer;
    transition: background var(--t-base), color var(--t-base); white-space: nowrap;
  }
  .hero-cta-ghost:hover { background: rgba(255,255,255,0.15); color: rgba(255,255,255,0.9); }

  /* Nav arrows */
  .hero-nav {
    position: absolute; top: 50%; transform: translateY(-50%);
    z-index: 3; width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.4); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
    border: 1px solid rgba(255,255,255,0.12); border-radius: 50%;
    color: rgba(255,255,255,0.75); cursor: pointer;
    transition: background var(--t-base), color var(--t-base);
  }
  .hero-nav:hover { background: rgba(0,0,0,0.65); color: #fff; }
  .hero-nav-left  { left: var(--sp-2); }
  .hero-nav-right { right: var(--sp-2); }

  /* Dots */
  .hero-dots {
    position: absolute; bottom: var(--sp-2); left: 50%; transform: translateX(-50%);
    z-index: 3; display: flex; gap: 6px; align-items: center;
  }
  .hero-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: rgba(255,255,255,0.3); border: none; cursor: pointer; padding: 0;
    transition: background var(--t-base), transform var(--t-base);
  }
  .hero-dot:hover { background: rgba(255,255,255,0.6); }
  .hero-dot-active { background: #fff; transform: scale(1.3); }
  .hero-dot-pinned { background: rgba(168,132,232,0.7); }
  .hero-dot-pinned.hero-dot-active { background: #c4a8f0; }

  /* Counter */
  .hero-counter {
    position: absolute; top: var(--sp-2); right: var(--sp-3); z-index: 3;
    font-family: var(--font-ui); font-size: 10px; color: rgba(255,255,255,0.4);
    letter-spacing: var(--tracking-wide);
  }

  /* ── Stats strip ─────────────────────────────────────────────────────────── */
  .stats-strip {
    display: flex; align-items: center;
    margin: var(--sp-4) var(--sp-6);
    background: var(--bg-raised); border: 1px solid var(--border-dim);
    border-radius: var(--radius-xl); padding: var(--sp-4) var(--sp-5); gap: 0;
  }
  .stat-card { display: flex; flex-direction: column; align-items: center; gap: 3px; flex: 1; }
  .stat-div  { width: 1px; height: 32px; background: var(--border-dim); flex-shrink: 0; }
  :global(.stat-fire)    { color: #f97316; }
  :global(.stat-neutral) { color: var(--text-faint); }
  .stat-val  { font-family: var(--font-ui); font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-secondary); line-height: 1; }
  .stat-val.accent { color: var(--accent-fg); }
  .stat-val.muted  { color: var(--text-faint); }
  .stat-label { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); text-align: center; white-space: nowrap; }

  /* ── Section chrome ───────────────────────────────────────────────────────── */
  .section { margin-bottom: var(--sp-5); }
  .section-header { display: flex; align-items: center; justify-content: space-between; padding: 0 var(--sp-6) var(--sp-3); }
  .section-title { display: inline-flex; align-items: center; gap: var(--sp-2); font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; }
  .see-all { display: flex; align-items: center; gap: 4px; font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); text-transform: uppercase; color: var(--text-faint); background: none; border: none; cursor: pointer; padding: 0; transition: color var(--t-base); }
  .see-all:hover { color: var(--accent-fg); }

  /* ── Mini row ─────────────────────────────────────────────────────────────── */
  .mini-row { display: flex; gap: var(--sp-3); padding: 0 var(--sp-6); overflow-x: auto; scrollbar-width: none; -ms-overflow-style: none; scroll-behavior: smooth; }
  .mini-row::-webkit-scrollbar { display: none; }
  .ghost { flex-shrink: 0; width: 110px; aspect-ratio: 2/3; pointer-events: none; visibility: hidden; }
  .mini-card { flex-shrink: 0; width: 110px; background: none; border: none; padding: 0; cursor: pointer; text-align: left; }
  .mini-card:hover .mini-cover { filter: brightness(1.06); }
  .mini-card:hover .mini-title { color: var(--text-primary); }
  .mini-cover-wrap { position: relative; aspect-ratio: 2/3; overflow: hidden; border-radius: var(--radius-md); background: var(--bg-raised); border: 1px solid var(--border-dim); }
  .mini-cover { width: 100%; height: 100%; object-fit: cover; transition: filter var(--t-base); }
  .completed-check { position: absolute; top: var(--sp-1); right: var(--sp-1); color: #22c55e; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.5)); }
  .mini-title { margin-top: var(--sp-2); font-size: var(--text-sm); color: var(--text-secondary); line-height: var(--leading-snug); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; transition: color var(--t-base); }

  /* ── Activity feed ────────────────────────────────────────────────────────── */
  .activity-list { display: flex; flex-direction: column; padding: 0 var(--sp-4); }
  .activity-row { display: flex; align-items: center; gap: var(--sp-3); padding: 8px var(--sp-2); border-radius: var(--radius-md); border: 1px solid transparent; background: none; text-align: left; cursor: pointer; transition: background var(--t-fast), border-color var(--t-fast); }
  .activity-row:hover { background: var(--bg-raised); border-color: var(--border-dim); }
  .activity-row:hover .activity-play { opacity: 1; }
  .activity-thumb-wrap { flex-shrink: 0; }
  .activity-thumb { width: 38px; height: 54px; border-radius: var(--radius-sm); object-fit: cover; display: block; background: var(--bg-raised); border: 1px solid var(--border-dim); }
  .activity-info { flex: 1; display: flex; flex-direction: column; gap: 3px; overflow: hidden; min-width: 0; }
  .activity-title { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .activity-chapter { font-size: var(--text-xs); color: var(--text-muted); display: flex; align-items: center; gap: var(--sp-1); }
  .activity-page { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .activity-time { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); flex-shrink: 0; white-space: nowrap; }
  .activity-play { color: var(--text-faint); flex-shrink: 0; opacity: 0; transition: opacity var(--t-base); }

  .empty-activity { display: flex; flex-direction: column; align-items: center; gap: var(--sp-3); padding: var(--sp-6); }
  .empty-text { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .empty-cta { display: flex; align-items: center; gap: var(--sp-2); font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 7px 16px; border-radius: var(--radius-full); background: var(--accent-muted); border: 1px solid var(--accent-dim); color: var(--accent-fg); cursor: pointer; transition: filter var(--t-base); }
  .empty-cta:hover { filter: brightness(1.1); }

  /* ── Picker modal ─────────────────────────────────────────────────────────── */
  .picker-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: var(--z-settings); display: flex; align-items: center; justify-content: center; animation: fadeIn 0.1s ease both; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
  .picker-modal { width: min(480px, calc(100vw - 48px)); max-height: 70vh; display: flex; flex-direction: column; background: var(--bg-surface); border: 1px solid var(--border-base); border-radius: var(--radius-xl); overflow: hidden; box-shadow: 0 24px 64px rgba(0,0,0,0.6); animation: scaleIn 0.14s ease both; }
  .picker-header { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-4) var(--sp-5); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; }
  .picker-title { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-secondary); }
  .picker-close { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: var(--radius-sm); color: var(--text-faint); background: none; border: none; cursor: pointer; transition: color var(--t-base), background var(--t-base); }
  .picker-close:hover { color: var(--text-muted); background: var(--bg-raised); }
  .picker-search-wrap { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; }
  :global(.picker-search-icon) { color: var(--text-faint); flex-shrink: 0; }
  .picker-search { flex: 1; background: none; border: none; outline: none; color: var(--text-primary); font-size: var(--text-sm); }
  .picker-search::placeholder { color: var(--text-faint); }
  .picker-list { flex: 1; overflow-y: auto; padding: var(--sp-2); }
  .picker-empty { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); padding: var(--sp-4) var(--sp-3); text-align: center; }
  .picker-row { display: flex; align-items: center; gap: var(--sp-3); width: 100%; padding: 8px var(--sp-3); border-radius: var(--radius-md); border: none; background: none; text-align: left; cursor: pointer; transition: background var(--t-fast); }
  .picker-row:hover { background: var(--bg-raised); }
  .picker-thumb { width: 36px; height: 52px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0; background: var(--bg-raised); border: 1px solid var(--border-dim); }
  .picker-info { flex: 1; display: flex; flex-direction: column; gap: 3px; overflow: hidden; min-width: 0; }
  .picker-manga-title { font-size: var(--text-sm); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .picker-source { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  :global(.picker-pin-icon) { color: var(--text-faint); flex-shrink: 0; opacity: 0; transition: opacity var(--t-base); }
  .picker-row:hover :global(.picker-pin-icon) { opacity: 1; }

  @keyframes fadeIn  { from { opacity: 0 } to { opacity: 1 } }
  @keyframes scaleIn { from { opacity: 0; transform: scale(0.97) } to { opacity: 1; transform: scale(1) } }
</style>
