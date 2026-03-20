<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import {
    Play, ArrowRight, ArrowLeft, BookOpen, Clock, Fire, TrendUp,
    CalendarBlank, CheckCircle, PushPin, X as XIcon,
    MagnifyingGlass, ListBullets,
  } from "phosphor-svelte";
  import { gql, thumbUrl } from "../../lib/client";
  import { GET_LIBRARY, GET_CHAPTERS } from "../../lib/queries";
  import { cache, CACHE_KEYS } from "../../lib/cache";
  import {
    history, readingStats, settings, activeManga, navPage,
    previewManga, openReader, activeChapterList,
    COMPLETED_FOLDER_ID, setHeroSlot,
  } from "../../store";
  import type { HistoryEntry } from "../../store";
  import type { Manga, Chapter } from "../../lib/types";

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
  function formatReadTime(mins: number): string {
    if (mins < 1)   return `${Math.round(mins * 60)}s`;
    if (mins < 60)  return `${Math.round(mins)}m`;
    const h = Math.floor(mins / 60), r = mins % 60;
    if (h < 24) return r === 0 ? `${h}h` : `${h}h ${r}m`;
    const d = Math.floor(h / 24), rh = h % 24;
    return rh === 0 ? `${d}d` : `${d}d ${rh}h`;
  }
  function focusEl(node: HTMLElement) { node.focus(); }

  // ── Library ───────────────────────────────────────────────────────────────────
  let libraryManga: Manga[] = [];
  let loadingLibrary = true;

  onMount(() => {
    cache.get(CACHE_KEYS.LIBRARY, () =>
      gql<{ mangas: { nodes: Manga[] } }>(GET_LIBRARY).then(d => d.mangas.nodes)
    ).then(m => { libraryManga = m; })
     .catch(console.error)
     .finally(() => loadingLibrary = false);
  });

  // ── Continue reading (deduped) ────────────────────────────────────────────────
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
  const TOTAL_SLOTS = 4;
  interface HeroSlot {
    kind: "continue" | "pinned" | "empty";
    entry?: HistoryEntry;
    manga?: Manga;
    slotIndex: number;
  }

  $: resolvedSlots = (() => {
    const pins = $settings.heroSlots ?? [null, null, null, null];
    const slots: HeroSlot[] = [];
    const first = continueReading[0];
    slots.push(first
      ? { kind: "continue", entry: first, slotIndex: 0 }
      : { kind: "empty", slotIndex: 0 });
    let hi = 1;
    for (let i = 1; i < TOTAL_SLOTS; i++) {
      const pinId = pins[i];
      if (pinId != null) {
        const manga = libraryManga.find(m => m.id === pinId);
        if (manga) { slots.push({ kind: "pinned", manga, slotIndex: i }); continue; }
      }
      const entry = continueReading[hi++];
      slots.push(entry
        ? { kind: "continue", entry, slotIndex: i }
        : { kind: "empty", slotIndex: i });
    }
    return slots;
  })();

  let activeIdx = 0;
  $: activeSlot = resolvedSlots[activeIdx];
  $: heroThumb  = activeSlot?.kind === "pinned"  ? thumbUrl(activeSlot.manga?.thumbnailUrl ?? "")
                : activeSlot?.kind === "continue" ? thumbUrl(activeSlot.entry?.thumbnailUrl ?? "") : "";
  $: heroTitle  = activeSlot?.kind === "pinned"  ? (activeSlot.manga?.title ?? "")
                : activeSlot?.kind === "continue" ? (activeSlot.entry?.mangaTitle ?? "") : "";
  $: heroManga  = activeSlot?.kind === "pinned"  ? activeSlot.manga
                : activeSlot?.kind === "continue" ? libraryManga.find(m => m.id === activeSlot.entry?.mangaId) : null;
  $: heroEntry  = activeSlot?.kind === "continue" ? activeSlot.entry : null;
  $: heroMangaId = heroEntry?.mangaId ?? heroManga?.id ?? null;

  function cycleNext() { activeIdx = (activeIdx + 1) % TOTAL_SLOTS; heroChapters = []; }
  function cyclePrev() { activeIdx = (activeIdx - 1 + TOTAL_SLOTS) % TOTAL_SLOTS; heroChapters = []; }
  function goToSlot(i: number) { if (i !== activeIdx) { activeIdx = i; heroChapters = []; } }

  function onKey(e: KeyboardEvent) {
    if (e.target !== document.body && !(e.target instanceof HTMLElement && e.target.closest(".hero-stage"))) return;
    if (e.key === "ArrowRight") cycleNext();
    if (e.key === "ArrowLeft")  cyclePrev();
  }
  onMount(() => window.addEventListener("keydown", onKey));
  onDestroy(() => window.removeEventListener("keydown", onKey));

  // ── Hero chapter panel ────────────────────────────────────────────────────────
  // Load chapters for the active slot's manga, show 3-5 starting at where user left off
  let heroChapters: Chapter[] = [];
  let loadingHeroChapters = false;
  let heroChaptersFor: number | null = null;

  $: if (heroMangaId && heroMangaId !== heroChaptersFor) {
    loadHeroChapters(heroMangaId);
  }

  async function loadHeroChapters(mangaId: number) {
    heroChaptersFor = mangaId;
    loadingHeroChapters = true;
    heroChapters = [];
    try {
      const d = await gql<{ chapters: { nodes: Chapter[] } }>(GET_CHAPTERS, { mangaId });
      if (heroChaptersFor !== mangaId) return; // stale
      const all = [...d.chapters.nodes].sort((a, b) => a.sourceOrder - b.sourceOrder);
      // Find the chapter user left off on, show from one before it
      const lastReadIdx = heroEntry
        ? all.findIndex(c => c.id === heroEntry!.chapterId)
        : all.findLastIndex(c => c.isRead);
      const startIdx = Math.max(0, lastReadIdx);
      heroChapters = all.slice(startIdx, startIdx + 5);
    } catch { heroChapters = []; }
    finally { loadingHeroChapters = false; }
  }

  // ── Resume helpers ────────────────────────────────────────────────────────────
  let resuming = false;

  async function openChapter(chapter: Chapter) {
    if (!heroMangaId) return;
    resuming = true;
    try {
      let all = heroChapters;
      if (!all.length) {
        const d = await gql<{ chapters: { nodes: Chapter[] } }>(GET_CHAPTERS, { mangaId: heroMangaId });
        all = [...d.chapters.nodes].sort((a, b) => a.sourceOrder - b.sourceOrder);
      }
      openReader(chapter, all);
    } catch {
      activeManga.set({ id: heroMangaId, title: heroTitle, thumbnailUrl: (heroManga?.thumbnailUrl ?? "") } as any);
    } finally { resuming = false; }
  }

  async function resumeActive() {
    if (!heroEntry && heroManga) { activeManga.set(heroManga); return; }
    if (!heroEntry) return;
    // Use hero chapter panel data if available (already fetched)
    const target = heroChapters.find(c => c.id === heroEntry!.chapterId) ?? heroChapters[0];
    if (target && heroChapters.length) { await openChapter(target); return; }
    // Fallback — fetch
    resuming = true;
    try {
      const d = await gql<{ chapters: { nodes: Chapter[] } }>(GET_CHAPTERS, { mangaId: heroEntry.mangaId });
      const chapters = [...d.chapters.nodes].sort((a, b) => a.sourceOrder - b.sourceOrder);
      const ch = chapters.find(c => c.id === heroEntry!.chapterId) ?? chapters[0];
      if (ch) openReader(ch, chapters);
      else activeManga.set({ id: heroEntry.mangaId, title: heroEntry.mangaTitle, thumbnailUrl: heroEntry.thumbnailUrl } as any);
    } catch {
      activeManga.set({ id: heroEntry.mangaId, title: heroEntry.mangaTitle, thumbnailUrl: heroEntry.thumbnailUrl } as any);
    } finally { resuming = false; }
  }

  async function resumeEntry(entry: HistoryEntry) {
    try {
      const d = await gql<{ chapters: { nodes: Chapter[] } }>(GET_CHAPTERS, { mangaId: entry.mangaId });
      const chapters = [...d.chapters.nodes].sort((a, b) => a.sourceOrder - b.sourceOrder);
      const ch = chapters.find(c => c.id === entry.chapterId) ?? chapters[0];
      if (ch) openReader(ch, chapters);
      else activeManga.set({ id: entry.mangaId, title: entry.mangaTitle, thumbnailUrl: entry.thumbnailUrl } as any);
    } catch {
      activeManga.set({ id: entry.mangaId, title: entry.mangaTitle, thumbnailUrl: entry.thumbnailUrl } as any);
    }
  }

  // ── Slot picker ───────────────────────────────────────────────────────────────
  let pickerOpen = false;
  let pickerSlotIndex: 1|2|3|null = null;
  let pickerSearch = "";
  $: pickerResults = pickerSearch.trim()
    ? libraryManga.filter(m => m.title.toLowerCase().includes(pickerSearch.toLowerCase())).slice(0, 20)
    : libraryManga.slice(0, 20);
  function openPicker(i: 1|2|3) { pickerSlotIndex = i; pickerOpen = true; pickerSearch = ""; }
  function closePicker() { pickerOpen = false; pickerSlotIndex = null; }
  function pinManga(m: Manga) { if (pickerSlotIndex !== null) { setHeroSlot(pickerSlotIndex, m.id); closePicker(); } }
  function unpinSlot(i: 1|2|3) { setHeroSlot(i, null); }

  // ── Completed, activity, stats ────────────────────────────────────────────────
  $: completedIds   = $settings.folders.find(f => f.id === COMPLETED_FOLDER_ID)?.mangaIds ?? [];
  $: completedManga = completedIds.length > 0
    ? libraryManga.filter(m => completedIds.includes(m.id)).slice(0, 10)
    : [];
  $: recentHistory = $history.slice(0, 8);
  $: stats    = $readingStats;
  $: hasStats = true;

  function handleRowWheel(e: WheelEvent) {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    (e.currentTarget as HTMLElement).scrollLeft += e.deltaY;
    e.stopPropagation();
  }
</script>

<div class="root">
  <div class="body">

    <!-- ══ HERO ════════════════════════════════════════════════════════════════ -->
    <div class="hero-section">
      <div class="hero-stage">

        <!-- Blurred backdrop -->
        {#if heroThumb}
          <div class="hero-backdrop" style="background-image:url({heroThumb})"></div>
        {:else}
          <div class="hero-backdrop hero-bd-empty"></div>
        {/if}
        <div class="hero-scrim"></div>

        <!-- ── Col 1: Cover (clickable → resume) ─────────────────────────── -->
        <button
          class="hero-cover-col"
          on:click={resumeActive}
          disabled={resuming || activeSlot?.kind === "empty"}
          title={heroTitle ? `Resume ${heroTitle}` : undefined}
          aria-label={heroTitle ? `Resume ${heroTitle}` : "No manga selected"}
        >
          {#if heroThumb}
            <img src={heroThumb} alt={heroTitle} class="hero-cover" loading="eager" decoding="async" />
            {#if activeSlot?.kind === "continue"}
              <div class="cover-resume-hint">
                <Play size={18} weight="fill" />
              </div>
            {/if}
          {:else}
            <div class="hero-cover-empty"><BookOpen size={28} weight="light" /></div>
          {/if}
        </button>

        <!-- ── Col 2: Details ────────────────────────────────────────────── -->
        <div class="hero-details">
          {#if activeSlot?.kind === "empty"}
            <p class="hero-empty-title">Nothing here yet</p>
            <p class="hero-empty-sub">
              {activeSlot.slotIndex === 0
                ? "Read a manga to see it here"
                : "Pin a manga or keep reading to fill this slot"}
            </p>
            {#if activeSlot.slotIndex !== 0}
              <button class="hero-cta" on:click={() => openPicker(activeSlot.slotIndex as 1|2|3)}>
                <PushPin size={11} weight="fill" /> Pin manga
              </button>
            {/if}
          {:else}
            <div class="hero-tags">
              {#if activeSlot?.kind === "continue"}
                <span class="hero-tag hero-tag-reading"><Play size={8} weight="fill" /> Reading</span>
              {:else}
                <span class="hero-tag hero-tag-pinned"><PushPin size={8} weight="fill" /> Pinned</span>
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
              <p class="hero-progress">
                <Clock size={10} weight="light" />
                {heroEntry.chapterName}
                {#if heroEntry.pageNumber > 1}<span class="hero-prog-page"> · p.{heroEntry.pageNumber}</span>{/if}
                <span class="hero-prog-time">{timeAgo(heroEntry.readAt)}</span>
              </p>
            {/if}

            {#if heroManga?.description}
              <p class="hero-desc">{heroManga.description}</p>
            {/if}

            <div class="hero-actions">
              {#if activeSlot?.kind === "continue"}
                <button class="hero-cta" on:click={resumeActive} disabled={resuming}>
                  <Play size={11} weight="fill" />
                  {resuming ? "Loading…" : "Resume"}
                </button>
              {:else if heroManga}
                <button class="hero-cta" on:click={() => previewManga.set(heroManga!)}>
                  <BookOpen size={11} weight="light" /> View manga
                </button>
              {/if}
              {#if activeSlot?.slotIndex !== 0}
                {#if activeSlot?.kind === "pinned"}
                  <button class="hero-cta-ghost" on:click={() => unpinSlot(activeSlot.slotIndex as 1|2|3)}>
                    <XIcon size={10} weight="bold" /> Unpin
                  </button>
                {:else}
                  <button class="hero-cta-ghost" on:click={() => openPicker(activeSlot!.slotIndex as 1|2|3)}>
                    <PushPin size={10} weight="light" /> Pin
                  </button>
                {/if}
              {/if}
            </div>
          {/if}

          <!-- Slot dots and arrows — inside details col, at the bottom -->
          <div class="hero-nav-row">
            <button class="hero-nav-btn" on:click={cyclePrev} aria-label="Previous">
              <ArrowLeft size={12} weight="bold" />
            </button>
            <div class="hero-dots">
              {#each resolvedSlots as slot, i}
                <button
                  class="hero-dot"
                  class:active={activeIdx === i}
                  class:pinned={slot.kind === "pinned"}
                  on:click={() => goToSlot(i)}
                  aria-label="Slot {i + 1}"
                ></button>
              {/each}
            </div>
            <button class="hero-nav-btn" on:click={cycleNext} aria-label="Next">
              <ArrowRight size={12} weight="bold" />
            </button>
            <span class="hero-counter">{activeIdx + 1}/{TOTAL_SLOTS}</span>
          </div>
        </div>

        <!-- ── Col 3: Chapters panel ──────────────────────────────────────── -->
        <div class="hero-chapters">
          <div class="hero-chapters-header">
            <ListBullets size={11} weight="bold" />
            <span>Up Next</span>
          </div>

          {#if activeSlot?.kind === "empty"}
            <p class="hero-chapters-empty">No chapters to show</p>
          {:else if loadingHeroChapters}
            {#each Array(4) as _}
              <div class="chapter-row-sk">
                <div class="sk sk-num"></div>
                <div class="sk-info">
                  <div class="sk sk-name"></div>
                  <div class="sk sk-meta"></div>
                </div>
              </div>
            {/each}
          {:else if heroChapters.length === 0}
            <p class="hero-chapters-empty">No chapters available</p>
          {:else}
            {#each heroChapters as ch (ch.id)}
              {@const isCurrent = heroEntry?.chapterId === ch.id}
              <button
                class="chapter-row"
                class:chapter-row-current={isCurrent}
                class:chapter-row-read={ch.isRead && !isCurrent}
                on:click={() => openChapter(ch)}
              >
                <span class="ch-num">Ch.{ch.chapterNumber % 1 === 0 ? Math.floor(ch.chapterNumber) : ch.chapterNumber}</span>
                <div class="ch-info">
                  <span class="ch-name">{ch.name}</span>
                  {#if isCurrent && heroEntry && heroEntry.pageNumber > 1}
                    <span class="ch-meta">p.{heroEntry.pageNumber} · in progress</span>
                  {:else if ch.isRead}
                    <span class="ch-meta ch-read">Read</span>
                  {:else if ch.uploadDate}
                    <span class="ch-meta">{new Date(Number(ch.uploadDate) > 1e10 ? Number(ch.uploadDate) : Number(ch.uploadDate)*1000).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>
                  {/if}
                </div>
                {#if isCurrent}
                  <Play size={10} weight="fill" class="ch-play-icon" />
                {/if}
              </button>
            {/each}
            {#if heroManga}
              <button class="ch-view-all" on:click={() => { if (heroManga) activeManga.set(heroManga); }}>
                All chapters <ArrowRight size={9} weight="bold" />
              </button>
            {/if}
          {/if}
        </div>

      </div>
    </div>

    <!-- ══ RECENT ACTIVITY ═════════════════════════════════════════════════════ -->
    {#if recentHistory.length > 0}
      <div class="section">
        <div class="section-header">
          <span class="section-title"><Clock size={10} weight="bold" /> Recent Activity</span>
          <button class="see-all" on:click={() => navPage.set("history")}>
            Full history <ArrowRight size={9} weight="bold" />
          </button>
        </div>
        <div class="activity-list">
          {#each recentHistory as entry (entry.chapterId)}
            <button class="activity-row" on:click={() => resumeEntry(entry)}>
              <img src={thumbUrl(entry.thumbnailUrl)} alt={entry.mangaTitle} class="activity-thumb" loading="lazy" decoding="async" />
              <div class="activity-info">
                <span class="activity-title">{entry.mangaTitle}</span>
                <span class="activity-sub">
                  {entry.chapterName}{entry.pageNumber > 1 ? ` · p.${entry.pageNumber}` : ""}
                </span>
              </div>
              <span class="activity-time">{timeAgo(entry.readAt)}</span>
              <span class="activity-play"><Play size={10} weight="fill" /></span>
            </button>
          {/each}
        </div>
      </div>
    {:else}
      <div class="empty-state">
        <p class="empty-text">Start reading to build your activity feed</p>
        <button class="empty-cta" on:click={() => navPage.set("library")}>
          Open Library <ArrowRight size={11} weight="bold" />
        </button>
      </div>
    {/if}

    <!-- ══ BOTTOM ROW ══════════════════════════════════════════════════════════ -->
    <div class="bottom-row">

      <!-- Left: Completed -->
      <div class="bottom-col">
        <div class="bottom-section-hd">
          <span class="section-title"><CheckCircle size={10} weight="bold" /> Completed</span>
          {#if completedManga.length > 0}
            <button class="see-all" on:click={() => navPage.set("library")}>View all <ArrowRight size={9} weight="bold" /></button>
          {/if}
        </div>
        {#if completedManga.length > 0}
          <div class="mini-row" on:wheel|preventDefault={handleRowWheel}>
            {#each completedManga as m (m.id)}
              <button class="mini-card" on:click={() => previewManga.set(m)}>
                <div class="mini-cover-wrap">
                  <img src={thumbUrl(m.thumbnailUrl)} alt={m.title} class="mini-cover" loading="lazy" decoding="async" />
                  <div class="mini-gradient"></div>
                  <div class="mini-footer">
                    <p class="mini-card-title">{m.title}</p>
                    {#if m.source?.displayName}<p class="mini-card-source">{m.source.displayName}</p>{/if}
                  </div>
                </div>
              </button>
            {/each}
          </div>
        {:else}
          <p class="bottom-empty">Finish a manga to see it here</p>
        {/if}
      </div>

      <div class="bottom-divider"></div>

      <!-- Right: Stats -->
      <div class="bottom-col">
        <div class="bottom-section-hd">
          <span class="section-title"><TrendUp size={10} weight="bold" /> Your Stats</span>
        </div>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-icon-wrap stat-fire"><Fire size={16} weight="fill" /></div>
            <div class="stat-body">
              <span class="stat-val">{stats.currentStreakDays}</span>
              <span class="stat-label">Day streak</span>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon-wrap stat-accent"><BookOpen size={16} weight="light" /></div>
            <div class="stat-body">
              <span class="stat-val">{stats.totalChaptersRead}</span>
              <span class="stat-label">Chapters read</span>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon-wrap stat-neutral"><Clock size={16} weight="light" /></div>
            <div class="stat-body">
              <span class="stat-val">{formatReadTime(stats.totalMinutesRead)}</span>
              <span class="stat-label">Read time</span>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon-wrap stat-neutral"><TrendUp size={16} weight="light" /></div>
            <div class="stat-body">
              <span class="stat-val">{stats.totalMangaRead}</span>
              <span class="stat-label">Series started</span>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon-wrap stat-green"><CheckCircle size={16} weight="light" /></div>
            <div class="stat-body">
              <span class="stat-val">{completedIds.length}</span>
              <span class="stat-label">Completed</span>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon-wrap stat-neutral"><CalendarBlank size={16} weight="light" /></div>
            <div class="stat-body">
              <span class="stat-val">{stats.longestStreakDays}d</span>
              <span class="stat-label">Best streak</span>
            </div>
          </div>
        </div>
      </div>
    </div>

  </div>
</div>

<!-- ── Slot picker ────────────────────────────────────────────────────────────── -->
{#if pickerOpen}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="picker-backdrop" on:click|self={closePicker}>
    <div class="picker-modal">
      <div class="picker-header">
        <span class="picker-title">Pin manga — slot {(pickerSlotIndex ?? 0) + 1}</span>
        <button class="picker-close" on:click={closePicker}><XIcon size={13} weight="light" /></button>
      </div>
      <div class="picker-search-wrap">
        <MagnifyingGlass size={12} weight="light" style="color:var(--text-faint);flex-shrink:0" />
        <input class="picker-search" placeholder="Search library…" bind:value={pickerSearch} use:focusEl />
      </div>
      <div class="picker-list">
        {#if loadingLibrary}
          <p class="picker-empty">Loading…</p>
        {:else if pickerResults.length === 0}
          <p class="picker-empty">No results</p>
        {:else}
          {#each pickerResults as m (m.id)}
            <button class="picker-row" on:click={() => pinManga(m)}>
              <img src={thumbUrl(m.thumbnailUrl)} alt={m.title} class="picker-thumb" loading="lazy" />
              <div class="picker-info">
                <span class="picker-manga-title">{m.title}</span>
                {#if m.source?.displayName}<span class="picker-source">{m.source.displayName}</span>{/if}
              </div>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .root { display: flex; flex-direction: column; height: 100%; overflow: hidden; animation: fadeIn 0.14s ease both; }
  .body { flex: 1; overflow-y: auto; scrollbar-width: none; padding-bottom: var(--sp-8); }
  .body::-webkit-scrollbar { display: none; }

  /* ══ HERO ════════════════════════════════════════════════════════════════════ */
  .hero-section { padding: var(--sp-4) var(--sp-5) 0; }

  .hero-stage {
    position: relative; display: flex; align-items: stretch;
    height: 340px; border-radius: var(--radius-xl); overflow: hidden;
    background: var(--bg-raised); border: 1px solid var(--border-dim);
    box-shadow: 0 6px 28px rgba(0,0,0,0.28);
  }

  /* Backdrop */
  .hero-backdrop {
    position: absolute; inset: -14px;
    background-size: cover; background-position: center 25%;
    filter: blur(24px) saturate(1.4) brightness(0.32);
    transform: scale(1.07); pointer-events: none; z-index: 0;
  }
  .hero-bd-empty { background: var(--bg-void); filter: none; }
  .hero-scrim {
    position: absolute; inset: 0; z-index: 1; pointer-events: none;
    background: linear-gradient(100deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.4) 100%);
  }

  /* ── Cover column ─────────────────────────────────────────────────────────── */
  .hero-cover-col {
    position: relative; z-index: 2;
    width: clamp(150px, 30%, 195px); flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    padding: var(--sp-5); background: none; border: none;
    cursor: pointer;
    /* Subtle inner separator */
    border-right: 1px solid rgba(255,255,255,0.06);
  }
  .hero-cover-col:hover .hero-cover { filter: brightness(1.1); }
  .hero-cover-col:hover .cover-resume-hint { opacity: 1; }
  .hero-cover-col:disabled { cursor: default; }
  .hero-cover {
    width: 100%; aspect-ratio: 2/3; object-fit: cover;
    border-radius: var(--radius-lg);
    box-shadow: 0 10px 36px rgba(0,0,0,0.75), 0 2px 8px rgba(0,0,0,0.4);
    display: block; transition: filter 0.18s ease;
  }
  .hero-cover-empty {
    width: 100%; aspect-ratio: 2/3;
    display: flex; align-items: center; justify-content: center;
    background: var(--bg-overlay); border-radius: var(--radius-lg);
    color: var(--text-faint);
  }
  /* Play hint overlay on cover hover */
  .cover-resume-hint {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: 32px;
    background: rgba(0,0,0,0.35); border-radius: var(--radius-lg);
    opacity: 0; transition: opacity 0.18s ease;
    pointer-events: none;
  }

  /* ── Details column ───────────────────────────────────────────────────────── */
  .hero-details {
    position: relative; z-index: 2; flex: 1; min-width: 0;
    padding: var(--sp-5) var(--sp-4) var(--sp-4);
    display: flex; flex-direction: column; gap: var(--sp-2); overflow: hidden;
    border-right: 1px solid rgba(255,255,255,0.06);
  }

  .hero-tags { display: flex; flex-wrap: wrap; gap: 5px; flex-shrink: 0; }
  .hero-tag {
    font-family: var(--font-ui); font-size: 9px; letter-spacing: var(--tracking-wide);
    text-transform: uppercase; padding: 2px 7px; border-radius: var(--radius-full);
    background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.62);
    border: 1px solid rgba(255,255,255,0.14);
  }
  .hero-tag-reading { background: var(--accent-muted); color: var(--accent-fg); border-color: var(--accent-dim); }
  .hero-tag-pinned  { background: rgba(168,132,232,0.18); color: #c4a8f0; border-color: rgba(168,132,232,0.28); }

  .hero-title {
    font-size: var(--text-xl); font-weight: var(--weight-medium); color: #fff;
    line-height: var(--leading-tight); margin: 0; flex-shrink: 0;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    text-shadow: 0 2px 10px rgba(0,0,0,0.5);
  }
  .hero-author { font-family: var(--font-ui); font-size: var(--text-xs); color: rgba(255,255,255,0.48); letter-spacing: var(--tracking-wide); flex-shrink: 0; }
  .hero-progress {
    display: flex; align-items: center; gap: 5px; flex-shrink: 0;
    font-family: var(--font-ui); font-size: var(--text-xs); color: rgba(255,255,255,0.58);
    letter-spacing: var(--tracking-wide);
  }
  .hero-prog-page { color: rgba(255,255,255,0.38); }
  .hero-prog-time { margin-left: auto; color: rgba(255,255,255,0.32); }
  .hero-desc {
    font-size: var(--text-xs); color: rgba(255,255,255,0.42); line-height: 1.55;
    display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
    flex: 1; min-height: 0;
  }
  .hero-empty-title { font-size: var(--text-base); font-weight: var(--weight-medium); color: rgba(255,255,255,0.5); flex-shrink: 0; }
  .hero-empty-sub   { font-family: var(--font-ui); font-size: var(--text-xs); color: rgba(255,255,255,0.28); letter-spacing: var(--tracking-wide); line-height: var(--leading-snug); }

  .hero-actions { display: flex; gap: var(--sp-2); flex-shrink: 0; flex-wrap: wrap; }
  .hero-cta {
    display: inline-flex; align-items: center; gap: 6px;
    font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide);
    padding: 7px 16px; border-radius: var(--radius-full);
    background: var(--accent-muted); border: 1px solid var(--accent-dim); color: var(--accent-fg);
    cursor: pointer; transition: filter var(--t-base); white-space: nowrap;
  }
  .hero-cta:hover:not(:disabled) { filter: brightness(1.15); }
  .hero-cta:disabled { opacity: 0.55; cursor: default; }
  .hero-cta-ghost {
    display: inline-flex; align-items: center; gap: 6px;
    font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide);
    padding: 7px 14px; border-radius: var(--radius-full);
    background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.13);
    color: rgba(255,255,255,0.52); cursor: pointer;
    transition: background var(--t-base), color var(--t-base); white-space: nowrap;
  }
  .hero-cta-ghost:hover { background: rgba(255,255,255,0.13); color: rgba(255,255,255,0.82); }

  /* Nav row — arrows + dots in one line at bottom of details col */
  .hero-nav-row {
    display: flex; align-items: center; gap: var(--sp-2);
    flex-shrink: 0; margin-top: auto; padding-top: var(--sp-2);
    border-top: 1px solid rgba(255,255,255,0.08);
  }
  .hero-nav-btn {
    display: flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; border-radius: 50%;
    background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.12);
    color: rgba(255,255,255,0.6); cursor: pointer; flex-shrink: 0;
    transition: background var(--t-base), color var(--t-base);
  }
  .hero-nav-btn:hover { background: rgba(255,255,255,0.2); color: #fff; }
  .hero-dots { display: flex; gap: 5px; align-items: center; }
  .hero-dot {
    width: 5px; height: 5px; border-radius: 50%;
    background: rgba(255,255,255,0.22); border: none; cursor: pointer; padding: 0;
    transition: background var(--t-base), transform var(--t-base);
  }
  .hero-dot:hover { background: rgba(255,255,255,0.5); }
  .hero-dot.active { background: #fff; transform: scale(1.35); }
  .hero-dot.pinned { background: rgba(168,132,232,0.55); }
  .hero-dot.pinned.active { background: #c4a8f0; }
  .hero-counter {
    font-family: var(--font-ui); font-size: 10px; color: rgba(255,255,255,0.3);
    letter-spacing: var(--tracking-wide); margin-left: auto;
  }

  /* ── Chapters panel ───────────────────────────────────────────────────────── */
  .hero-chapters {
    position: relative; z-index: 2;
    width: clamp(180px, 32%, 240px); flex-shrink: 0;
    display: flex; flex-direction: column;
    padding: var(--sp-4) var(--sp-3);
    gap: 1px; overflow: hidden;
  }
  .hero-chapters-header {
    display: flex; align-items: center; gap: var(--sp-2);
    font-family: var(--font-ui); font-size: var(--text-xs); color: rgba(255,255,255,0.4);
    letter-spacing: var(--tracking-wider); text-transform: uppercase;
    padding-bottom: var(--sp-2); margin-bottom: var(--sp-1);
    border-bottom: 1px solid rgba(255,255,255,0.08); flex-shrink: 0;
  }
  .hero-chapters-empty {
    font-family: var(--font-ui); font-size: var(--text-xs); color: rgba(255,255,255,0.25);
    letter-spacing: var(--tracking-wide); padding: var(--sp-3) 0;
  }

  /* Chapter rows */
  .chapter-row {
    display: flex; align-items: center; gap: var(--sp-2);
    width: 100%; padding: 7px var(--sp-2); border-radius: var(--radius-sm);
    background: none; border: none; text-align: left; cursor: pointer;
    transition: background var(--t-fast);
  }
  .chapter-row:hover { background: rgba(255,255,255,0.07); }
  .chapter-row-current { background: rgba(255,255,255,0.1) !important; }
  .ch-num {
    font-family: var(--font-ui); font-size: var(--text-2xs); color: rgba(255,255,255,0.35);
    letter-spacing: var(--tracking-wide); flex-shrink: 0; min-width: 36px;
  }
  .chapter-row-current .ch-num { color: var(--accent-fg); }
  .ch-info { flex: 1; display: flex; flex-direction: column; gap: 2px; overflow: hidden; min-width: 0; }
  .ch-name {
    font-size: var(--text-xs); color: rgba(255,255,255,0.75);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .chapter-row-read .ch-name { color: rgba(255,255,255,0.35); }
  .chapter-row-current .ch-name { color: #fff; font-weight: var(--weight-medium); }
  .ch-meta {
    font-family: var(--font-ui); font-size: 9px; color: rgba(255,255,255,0.28);
    letter-spacing: var(--tracking-wide);
  }
  .ch-read { color: rgba(255,255,255,0.2); }
  :global(.ch-play-icon) { color: var(--accent-fg); flex-shrink: 0; }

  /* Skeleton rows */
  .chapter-row-sk { display: flex; gap: var(--sp-2); padding: 7px var(--sp-2); align-items: center; }
  .sk-info { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .sk { background: rgba(255,255,255,0.08); border-radius: var(--radius-sm); animation: pulse 1.4s ease infinite; }
  .sk-num { width: 32px; height: 10px; flex-shrink: 0; }
  .sk-name { height: 11px; width: 85%; }
  .sk-meta { height: 9px; width: 50%; }

  /* View all link */
  .ch-view-all {
    display: flex; align-items: center; gap: 4px; margin-top: auto;
    font-family: var(--font-ui); font-size: var(--text-2xs);
    color: rgba(255,255,255,0.3); letter-spacing: var(--tracking-wide);
    background: none; border: none; cursor: pointer; padding: var(--sp-2) var(--sp-2) 0;
    transition: color var(--t-base);
  }
  .ch-view-all:hover { color: var(--accent-fg); }

  /* ══ SECTIONS ════════════════════════════════════════════════════════════════ */
  .section { border-top: 1px solid var(--border-dim); margin-top: var(--sp-4); }
  .section-header { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-3) var(--sp-5) var(--sp-2); }
  .section-title { display: inline-flex; align-items: center; gap: var(--sp-2); font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; }
  .see-all { display: flex; align-items: center; gap: 4px; font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); text-transform: uppercase; color: var(--text-faint); background: none; border: none; cursor: pointer; padding: 0; transition: color var(--t-base); }
  .see-all:hover { color: var(--accent-fg); }

  /* ── Activity ─────────────────────────────────────────────────────────────── */
  .activity-list { display: flex; flex-direction: column; padding: 0 var(--sp-3); }
  .activity-row { display: flex; align-items: center; gap: var(--sp-3); padding: 9px var(--sp-2); border-radius: var(--radius-md); border: 1px solid transparent; background: none; text-align: left; cursor: pointer; width: 100%; transition: background var(--t-fast), border-color var(--t-fast); }
  .activity-row:hover { background: var(--bg-raised); border-color: var(--border-dim); }
  .activity-row:hover .activity-play { opacity: 1; }
  .activity-thumb { width: 36px; height: 52px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0; border: 1px solid var(--border-dim); }
  .activity-info { flex: 1; display: flex; flex-direction: column; gap: 3px; overflow: hidden; min-width: 0; }
  .activity-title { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .activity-sub { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-muted); letter-spacing: var(--tracking-wide); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .activity-time { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); flex-shrink: 0; }
  .activity-play { color: var(--accent-fg); flex-shrink: 0; opacity: 0; transition: opacity var(--t-base); }

  /* ── Bottom row ───────────────────────────────────────────────────────────── */
  .bottom-row {
    display: grid; grid-template-columns: 1fr 1px 1fr;
    padding: 0 var(--sp-5) 0; margin-top: var(--sp-4);
    border-top: 1px solid var(--border-dim); align-items: start;
  }
  .bottom-divider { background: var(--border-dim); align-self: stretch; min-height: 100%; }
  .bottom-col { display: flex; flex-direction: column; min-width: 0; padding-top: var(--sp-3); }
  .bottom-col:first-child { padding-right: var(--sp-5); }
  .bottom-col:last-child  { padding-left:  var(--sp-5); }
  .bottom-section-hd { display: flex; align-items: center; justify-content: space-between; padding-bottom: var(--sp-2); }
  .bottom-empty { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); padding: var(--sp-2) 0; }

  /* Completed cards — Discover format */
  .mini-row { display: flex; gap: var(--sp-3); overflow-x: auto; scrollbar-width: none; padding-bottom: var(--sp-2); }
  .mini-row::-webkit-scrollbar { display: none; }
  .mini-card { flex-shrink: 0; width: 120px; background: none; border: none; padding: 0; cursor: pointer; text-align: left; }
  .mini-card:hover .mini-cover { filter: brightness(1.08) saturate(1.05); transform: scale(1.02); }
  .mini-card:hover { will-change: transform; }
  .mini-cover-wrap {
    position: relative; aspect-ratio: 2/3; overflow: hidden;
    border-radius: var(--radius-md); background: var(--bg-raised);
    border: 1px solid var(--border-dim); box-shadow: 0 2px 12px rgba(0,0,0,0.35);
  }
  .mini-cover { width: 100%; height: 100%; object-fit: cover; display: block; transition: filter 0.15s ease, transform 0.15s ease; }
  .mini-gradient { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.1) 55%, transparent 75%); pointer-events: none; }
  .mini-footer { position: absolute; bottom: 0; left: 0; right: 0; padding: var(--sp-2); pointer-events: none; }
  .mini-card-title {
    font-size: var(--text-xs); font-weight: var(--weight-medium);
    color: rgba(255,255,255,0.92); line-height: var(--leading-snug);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    text-shadow: 0 1px 4px rgba(0,0,0,0.7);
  }
  .mini-card-source { font-family: var(--font-ui); font-size: 9px; color: rgba(255,255,255,0.45); letter-spacing: var(--tracking-wide); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Stats grid */
  .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-2); }
  .stat-card {
    display: flex; align-items: center; gap: var(--sp-2);
    background: var(--bg-raised); border: 1px solid var(--border-dim);
    border-radius: var(--radius-md); padding: var(--sp-2) var(--sp-3);
  }
  .stat-icon-wrap { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--radius-sm); flex-shrink: 0; }
  .stat-fire    { background: rgba(251,146,60,0.15); color: #fb923c; }
  .stat-accent  { background: var(--accent-muted); color: var(--accent-fg); }
  .stat-neutral { background: var(--bg-overlay); color: var(--text-faint); }
  .stat-green   { background: rgba(34,197,94,0.12); color: #22c55e; }
  .stat-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .stat-val { font-family: var(--font-ui); font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-secondary); line-height: 1; }
  .stat-label { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); white-space: nowrap; }

  /* ── Empty state / Picker ─────────────────────────────────────────────────── */
  .empty-state { display: flex; flex-direction: column; align-items: center; gap: var(--sp-3); padding: var(--sp-7) var(--sp-6); }
  .empty-text { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .empty-cta { display: flex; align-items: center; gap: var(--sp-2); font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 7px 16px; border-radius: var(--radius-full); background: var(--accent-muted); border: 1px solid var(--accent-dim); color: var(--accent-fg); cursor: pointer; transition: filter var(--t-base); }
  .empty-cta:hover { filter: brightness(1.1); }

  .picker-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: var(--z-settings); display: flex; align-items: center; justify-content: center; animation: fadeIn 0.1s ease both; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
  .picker-modal { width: min(460px, calc(100vw - 48px)); max-height: 68vh; display: flex; flex-direction: column; background: var(--bg-surface); border: 1px solid var(--border-base); border-radius: var(--radius-xl); overflow: hidden; box-shadow: 0 24px 64px rgba(0,0,0,0.6); animation: scaleIn 0.14s ease both; }
  .picker-header { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-4) var(--sp-5); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; }
  .picker-title { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-secondary); }
  .picker-close { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: var(--radius-sm); color: var(--text-faint); background: none; border: none; cursor: pointer; }
  .picker-close:hover { color: var(--text-muted); background: var(--bg-raised); }
  .picker-search-wrap { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; }
  .picker-search { flex: 1; background: none; border: none; outline: none; color: var(--text-primary); font-size: var(--text-sm); }
  .picker-search::placeholder { color: var(--text-faint); }
  .picker-list { flex: 1; overflow-y: auto; padding: var(--sp-2); scrollbar-width: none; }
  .picker-list::-webkit-scrollbar { display: none; }
  .picker-empty { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); padding: var(--sp-4) var(--sp-3); text-align: center; }
  .picker-row { display: flex; align-items: center; gap: var(--sp-3); width: 100%; padding: 8px var(--sp-3); border-radius: var(--radius-md); border: none; background: none; text-align: left; cursor: pointer; transition: background var(--t-fast); }
  .picker-row:hover { background: var(--bg-raised); }
  .picker-thumb { width: 34px; height: 50px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0; border: 1px solid var(--border-dim); }
  .picker-info { flex: 1; display: flex; flex-direction: column; gap: 2px; overflow: hidden; min-width: 0; }
  .picker-manga-title { font-size: var(--text-sm); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .picker-source { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }

  @keyframes fadeIn  { from { opacity: 0 } to { opacity: 1 } }
  @keyframes scaleIn { from { opacity: 0; transform: scale(0.97) } to { opacity: 1; transform: scale(1) } }
  @keyframes pulse   { 0%,100% { opacity: 0.4 } 50% { opacity: 0.7 } }
</style>
