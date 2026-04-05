<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { Play, ArrowRight, ArrowLeft, BookOpen, Clock, Fire, TrendUp, CalendarBlank, CheckCircle, PushPin, X as XIcon, MagnifyingGlass, ListBullets } from "phosphor-svelte";
  import { gql, thumbUrl } from "../../lib/client";
  import { getBlobUrl } from "../../lib/imageCache";
  import Thumbnail from "../shared/Thumbnail.svelte";
  import { GET_LIBRARY, GET_CHAPTERS, GET_MANGA, GET_CATEGORIES } from "../../lib/queries";
  import { cache, CACHE_KEYS } from "../../lib/cache";
  import { store, openReader, setHeroSlot, setActiveManga, setPreviewManga, setNavPage, setGenreFilter, setLibraryFilter } from "../../store/state.svelte";
  import type { HistoryEntry } from "../../store/state.svelte";
  import type { Manga, Chapter, Category } from "../../lib/types";

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
    const h = Math.floor(mins / 60), r = Math.round(mins % 60);
    if (h < 24) return r === 0 ? `${h}h` : `${h}h ${r}m`;
    const d = Math.floor(h / 24), rh = h % 24;
    return rh === 0 ? `${d}d` : `${d}d ${rh}h`;
  }

  function focusEl(node: HTMLElement) { node.focus(); }

  let libraryManga:       Manga[]            = $state([]);
  let extraManga:         Manga[]            = $state([]);
  let loadingLibrary:     boolean            = $state(true);
  let completedCategory:  Category | null    = $state(null);

  onMount(() => {
    loadLibrary();
  });

  function loadLibrary() {
    const libraryP  = cache.get(CACHE_KEYS.LIBRARY, () =>
      gql<{ mangas: { nodes: Manga[] } }>(GET_LIBRARY).then(d => d.mangas.nodes)
    );
    const categoriesP = gql<{ categories: { nodes: Category[] } }>(GET_CATEGORIES)
      .then(d => d.categories.nodes.find(c => c.name === "Completed") ?? null)
      .catch(() => null);

    Promise.all([libraryP, categoriesP])
      .then(([m, completed]) => {
        libraryManga      = m;
        completedCategory = completed;
        fetchExtraCompleted(m, completed);
      })
      .catch(console.error)
      .finally(() => loadingLibrary = false);
  }

  // Re-fetch library and reset hero chapters whenever the reader closes,
  // so the hero reflects the latest-read chapter immediately.
  $effect(() => {
    const sessionId = store.readerSessionId;
    if (sessionId === 0) return; // skip initial mount — onMount handles that
    cache.clear(CACHE_KEYS.LIBRARY);
    loadingLibrary = true;
    heroChapters    = [];
    heroAllChapters = [];
    heroChaptersFor = null;
    loadLibrary();
  });

  async function fetchExtraCompleted(library: Manga[], completed: Category | null) {
    const completedIds = completed?.mangas?.nodes.map(m => m.id) ?? [];
    const missingIds = completedIds.filter(id => !library.some(m => m.id === id));
    if (!missingIds.length) return;
    const results = await Promise.allSettled(missingIds.map(id => gql<{ manga: Manga }>(GET_MANGA, { id }).then(d => d.manga)));
    const valid = results.flatMap(r => r.status === "fulfilled" && r.value ? [r.value] : []);
    if (valid.length) extraManga = valid;
  }

  const continueReading = $derived((() => {
    const seen = new Set<number>();
    const out: HistoryEntry[] = [];
    for (const e of store.history) {
      if (seen.has(e.mangaId)) continue;
      seen.add(e.mangaId);
      out.push(e);
      if (out.length >= 10) break;
    }
    return out;
  })());

  const TOTAL_SLOTS = 4;
  interface HeroSlot { kind: "continue" | "pinned" | "empty"; entry?: HistoryEntry; manga?: Manga; slotIndex: number; }

  const resolvedSlots = $derived((() => {
    const pins = store.settings.heroSlots ?? [null, null, null, null];
    const slots: HeroSlot[] = [];
    const first = continueReading[0];
    slots.push(first ? { kind: "continue", entry: first, slotIndex: 0 } : { kind: "empty", slotIndex: 0 });
    let hi = 1;
    for (let i = 1; i < TOTAL_SLOTS; i++) {
      const pinId = pins[i];
      if (pinId != null) {
        const manga = libraryManga.find(m => m.id === pinId);
        if (manga) { slots.push({ kind: "pinned", manga, slotIndex: i }); continue; }
      }
      const entry = continueReading[hi++];
      slots.push(entry ? { kind: "continue", entry, slotIndex: i } : { kind: "empty", slotIndex: i });
    }
    return slots;
  })());

  let activeIdx = $state(0);
  const activeSlot  = $derived(resolvedSlots[activeIdx]);
  const heroThumbSrc = $derived(
    activeSlot?.kind === "pinned"   ? (activeSlot.manga?.thumbnailUrl ?? "") :
    activeSlot?.kind === "continue" ? (activeSlot.entry?.thumbnailUrl ?? "") : ""
  );
  let heroThumb = $state("");
  $effect(() => {
    const path = heroThumbSrc;
    const mode = store.settings.serverAuthMode ?? "NONE";
    if (!path) { heroThumb = ""; return; }
    if (mode !== "BASIC_AUTH") { heroThumb = thumbUrl(path); return; }
    // Use tauri-plugin-http backed getBlobUrl which handles auth and bypasses CORS
    getBlobUrl(thumbUrl(path))
      .then(url => { heroThumb = url; })
      .catch(() => { heroThumb = ""; });
  });
  const heroTitle   = $derived(activeSlot?.kind === "pinned"   ? (activeSlot.manga?.title ?? "")               : activeSlot?.kind === "continue" ? (activeSlot.entry?.mangaTitle ?? "") : "");
  const heroManga   = $derived(activeSlot?.kind === "pinned"   ? activeSlot.manga                               : activeSlot?.kind === "continue" ? libraryManga.find(m => m.id === activeSlot.entry?.mangaId) : null);
  const heroEntry   = $derived(activeSlot?.kind === "continue" ? activeSlot.entry : null);
  const heroMangaId = $derived(heroEntry?.mangaId ?? heroManga?.id ?? null);

  function cycleNext() { activeIdx = (activeIdx + 1) % TOTAL_SLOTS; heroChapters = []; heroAllChapters = []; }
  function cyclePrev() { activeIdx = (activeIdx - 1 + TOTAL_SLOTS) % TOTAL_SLOTS; heroChapters = []; heroAllChapters = []; }
  function goToSlot(i: number) { if (i !== activeIdx) { activeIdx = i; heroChapters = []; heroAllChapters = []; } }

  function onKey(e: KeyboardEvent) {
    if (e.target !== document.body && !(e.target instanceof HTMLElement && e.target.closest(".hero-stage"))) return;
    if (e.key === "ArrowRight") cycleNext();
    if (e.key === "ArrowLeft")  cyclePrev();
  }
  onMount(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  let heroStageH = $state(300);
  let heroChapters:    Chapter[] = $state([]);
  let heroAllChapters: Chapter[] = $state([]);
  let loadingHeroChapters = $state(false);
  let heroChaptersFor: number | null = null;

  $effect(() => {
    const id = heroMangaId;
    if (id && id !== heroChaptersFor) untrack(() => loadHeroChapters(id));
  });

  async function loadHeroChapters(mangaId: number) {
    heroChaptersFor = mangaId;
    loadingHeroChapters = true;
    heroChapters = [];
    heroAllChapters = [];
    try {
      const d = await gql<{ chapters: { nodes: Chapter[] } }>(GET_CHAPTERS, { mangaId });
      if (heroChaptersFor !== mangaId) return;
      const all = [...d.chapters.nodes].sort((a, b) => a.sourceOrder - b.sourceOrder);
      heroAllChapters = all;
      const lastReadIdx = heroEntry ? all.findIndex(c => c.id === heroEntry!.chapterId) : all.findLastIndex(c => c.isRead);
      const startIdx = Math.max(0, lastReadIdx);
      heroChapters = all.slice(startIdx, startIdx + 5);
    } catch { heroChapters = []; heroAllChapters = []; }
    finally { loadingHeroChapters = false; }
  }

  let resuming = $state(false);

  async function openChapter(chapter: Chapter) {
    if (!heroMangaId) return;
    resuming = true;
    try {
      let all = heroAllChapters;
      if (!all.length) {
        const d = await gql<{ chapters: { nodes: Chapter[] } }>(GET_CHAPTERS, { mangaId: heroMangaId });
        all = [...d.chapters.nodes].sort((a, b) => a.sourceOrder - b.sourceOrder);
      }
      if (all.length) {
        const manga = heroManga ?? { id: heroMangaId, title: heroTitle, thumbnailUrl: heroManga?.thumbnailUrl ?? "" } as any;
        store.activeManga = manga;
        openReader(chapter, all);
      }
    } catch { store.activeManga = { id: heroMangaId, title: heroTitle, thumbnailUrl: heroManga?.thumbnailUrl ?? "" } as any; }
    finally { resuming = false; }
  }

  async function resumeActive() {
    if (!heroEntry && heroManga) { store.activeManga = heroManga; return; }
    if (!heroEntry) return;
    const target = heroAllChapters.find(c => c.id === heroEntry!.chapterId) ?? heroAllChapters[0];
    if (target && heroAllChapters.length) { await openChapter(target); return; }
    resuming = true;
    try {
      const d = await gql<{ chapters: { nodes: Chapter[] } }>(GET_CHAPTERS, { mangaId: heroEntry.mangaId });
      const chapters = [...d.chapters.nodes].sort((a, b) => a.sourceOrder - b.sourceOrder);
      const ch = chapters.find(c => c.id === heroEntry!.chapterId) ?? chapters[0];
      if (ch) {
        store.activeManga = heroManga ?? { id: heroEntry.mangaId, title: heroEntry.mangaTitle, thumbnailUrl: heroEntry.thumbnailUrl } as any;
        openReader(ch, chapters);
      }
    } catch { store.activeManga = { id: heroEntry.mangaId, title: heroEntry.mangaTitle, thumbnailUrl: heroEntry.thumbnailUrl } as any; }
    finally { resuming = false; }
  }

  async function resumeEntry(entry: HistoryEntry) {
    try {
      const d = await gql<{ chapters: { nodes: Chapter[] } }>(GET_CHAPTERS, { mangaId: entry.mangaId });
      const chapters = [...d.chapters.nodes].sort((a, b) => a.sourceOrder - b.sourceOrder);
      const ch = chapters.find(c => c.id === entry.chapterId) ?? chapters[0];
      if (ch) {
        store.activeManga = { id: entry.mangaId, title: entry.mangaTitle, thumbnailUrl: entry.thumbnailUrl } as any;
        openReader(ch, chapters);
      } else store.activeManga = { id: entry.mangaId, title: entry.mangaTitle, thumbnailUrl: entry.thumbnailUrl } as any;
    } catch { store.activeManga = { id: entry.mangaId, title: entry.mangaTitle, thumbnailUrl: entry.thumbnailUrl } as any; }
  }

  let pickerOpen      = $state(false);
  let pickerSlotIndex: 1|2|3|null = $state(null);
  let pickerSearch    = $state("");

  const pickerResults = $derived(pickerSearch.trim()
    ? libraryManga.filter(m => m.title.toLowerCase().includes(pickerSearch.toLowerCase())).slice(0, 20)
    : libraryManga.slice(0, 20));

  function openPicker(i: 1|2|3) { pickerSlotIndex = i; pickerOpen = true; pickerSearch = ""; }
  function closePicker() { pickerOpen = false; pickerSlotIndex = null; }
  function pinManga(m: Manga) { if (pickerSlotIndex !== null) { setHeroSlot(pickerSlotIndex, m.id); closePicker(); } }
  function unpinSlot(i: 1|2|3) { setHeroSlot(i, null); }

  const completedIds   = $derived(completedCategory?.mangas?.nodes.map(m => m.id) ?? []);
  const completedPool  = $derived([...libraryManga, ...extraManga.filter(m => !libraryManga.some(l => l.id === m.id))]);
  const completedManga = $derived(completedIds.length > 0 ? completedPool.filter(m => completedIds.includes(m.id)).slice(0, 7) : []);
  const recentHistory  = $derived(store.history.slice(0, 6));
  const stats          = $derived(store.readingStats);

  function handleRowWheel(e: WheelEvent) {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    (e.currentTarget as HTMLElement).scrollLeft += e.deltaY;
    e.stopPropagation();
  }
</script>

<div class="root">
  <div class="body">

    <div class="hero-section">
      <div class="hero-stage" bind:clientHeight={heroStageH} style="--hero-h:{heroStageH}px">

        {#if heroThumb}
          <div class="hero-backdrop" style="background-image:url({heroThumb})"></div>
        {:else}
          <div class="hero-backdrop hero-bd-empty"></div>
        {/if}
        <div class="hero-scrim"></div>

        <button class="hero-cover-col" onclick={resumeActive} disabled={resuming || activeSlot?.kind === "empty"} aria-label={heroTitle ? `Resume ${heroTitle}` : "No manga selected"}>
          {#if heroThumb}
            <img src={heroThumb} alt={heroTitle} class="hero-cover" loading="eager" decoding="async" />
            {#if activeSlot?.kind === "continue"}
              <div class="cover-resume-hint"><Play size={18} weight="fill" /></div>
            {/if}
          {:else}
            <div class="hero-cover-empty"><BookOpen size={28} weight="light" /></div>
          {/if}
        </button>

        <div class="hero-details">
          {#if activeSlot?.kind === "empty"}
            <p class="hero-empty-title">Nothing here yet</p>
            <p class="hero-empty-sub">{activeSlot.slotIndex === 0 ? "Read a manga to see it here" : "Pin a manga or keep reading to fill this slot"}</p>
            {#if activeSlot.slotIndex !== 0}
              <button class="hero-cta" onclick={() => openPicker(activeSlot.slotIndex as 1|2|3)}>
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
                <button class="hero-tag hero-tag-genre" onclick={() => { setGenreFilter(g); setNavPage("explore"); }}>{g}</button>
              {/each}
            </div>

            <h2 class="hero-title">{heroTitle}</h2>
            {#if heroManga?.author}<p class="hero-author">{heroManga.author}</p>{/if}

            {#if heroEntry}
              <p class="hero-progress">
                <Clock size={10} weight="light" />
                {heroEntry.chapterName}
                {#if heroEntry.pageNumber > 1}<span class="hero-prog-page"> · p.{heroEntry.pageNumber}</span>{/if}
                <span class="hero-prog-time">{timeAgo(heroEntry.readAt)}</span>
              </p>
            {/if}

            {#if heroManga?.description}<p class="hero-desc">{heroManga.description}</p>{/if}

            <div class="hero-actions">
              {#if activeSlot?.kind === "continue"}
                <button class="hero-cta" onclick={resumeActive} disabled={resuming}>
                  <Play size={11} weight="fill" />{resuming ? "Loading…" : "Resume"}
                </button>
              {:else if heroManga}
                <button class="hero-cta" onclick={() => store.previewManga = heroManga!}>
                  <BookOpen size={11} weight="light" /> View manga
                </button>
              {/if}
              {#if activeSlot?.slotIndex !== 0}
                {#if activeSlot?.kind === "pinned"}
                  <button class="hero-cta-ghost" onclick={() => unpinSlot(activeSlot.slotIndex as 1|2|3)}>
                    <XIcon size={10} weight="bold" /> Unpin
                  </button>
                {:else}
                  <button class="hero-cta-ghost" onclick={() => openPicker(activeSlot!.slotIndex as 1|2|3)}>
                    <PushPin size={10} weight="light" /> Pin
                  </button>
                {/if}
              {/if}
            </div>
          {/if}

          <div class="hero-nav-row">
            <button class="hero-nav-btn" onclick={cyclePrev} aria-label="Previous"><ArrowLeft size={12} weight="bold" /></button>
            <div class="hero-dots">
              {#each resolvedSlots as slot, i}
                <button class="hero-dot" class:active={activeIdx === i} class:pinned={slot.kind === "pinned"} onclick={() => goToSlot(i)} aria-label="Slot {i + 1}"></button>
              {/each}
            </div>
            <button class="hero-nav-btn" onclick={cycleNext} aria-label="Next"><ArrowRight size={12} weight="bold" /></button>
            <span class="hero-counter">{activeIdx + 1}/{TOTAL_SLOTS}</span>
          </div>
        </div>

        <div class="hero-chapters">
          <div class="hero-chapters-header"><ListBullets size={11} weight="bold" /><span>Up Next</span></div>

          {#if activeSlot?.kind === "empty"}
            <p class="hero-chapters-empty">No chapters to show</p>
          {:else if loadingHeroChapters}
            {#each Array(4) as _}
              <div class="chapter-row-sk">
                <div class="sk sk-num"></div>
                <div class="sk-info"><div class="sk sk-name"></div><div class="sk sk-meta"></div></div>
              </div>
            {/each}
          {:else if heroChapters.length === 0}
            <p class="hero-chapters-empty">No chapters available</p>
          {:else}
            {#each heroChapters as ch (ch.id)}
              {@const isCurrent = heroEntry?.chapterId === ch.id}
              <button class="chapter-row" class:chapter-row-current={isCurrent} class:chapter-row-read={ch.isRead && !isCurrent} onclick={() => openChapter(ch)}>
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
                {#if isCurrent}<Play size={10} weight="fill" class="ch-play-icon" />{/if}
              </button>
            {/each}
            {#if heroManga}
              <button class="ch-view-all" onclick={() => { if (heroManga) store.activeManga = heroManga; }}>
                All chapters <ArrowRight size={9} weight="bold" />
              </button>
            {/if}
          {/if}
        </div>

      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <span class="section-title"><Clock size={10} weight="bold" /> Recent Activity</span>
        {#if recentHistory.length > 0}
          <button class="see-all" onclick={() => setNavPage("history")}>Full History <ArrowRight size={9} weight="bold" /></button>
        {/if}
      </div>
      <div class="activity-list">
        {#if recentHistory.length > 0}
          {#each recentHistory as entry (entry.chapterId)}
            <button class="activity-row" onclick={() => resumeEntry(entry)}>
              <Thumbnail src={entry.thumbnailUrl} alt={entry.mangaTitle} class="activity-thumb" />
              <div class="activity-info">
                <span class="activity-title">{entry.mangaTitle}</span>
                <span class="activity-sub">{entry.chapterName}{entry.pageNumber > 1 ? ` · p.${entry.pageNumber}` : ""}</span>
              </div>
              <span class="activity-time">{timeAgo(entry.readAt)}</span>
              <span class="activity-play"><Play size={10} weight="fill" /></span>
            </button>
          {/each}
        {:else}
          <div class="activity-placeholder">
            {#each Array(5) as _, i}
              <div class="activity-row activity-row-sk">
                <div class="sk-thumb"></div>
                <div class="activity-info">
                  <div class="sk sk-title" style="width: {55 + (i * 7) % 30}%"></div>
                  <div class="sk sk-sub" style="width: {30 + (i * 11) % 25}%"></div>
                </div>
                <div class="sk sk-time"></div>
              </div>
            {/each}
            <div class="activity-placeholder-overlay">
              <button class="activity-placeholder-cta" onclick={() => setNavPage("library")}>
                <BookOpen size={12} weight="light" /> Start reading
              </button>
            </div>
          </div>
        {/if}
      </div>
    </div>

    <div class="bottom-row">
      <div class="bottom-col">
        <div class="bottom-section-hd">
          <span class="section-title"><CheckCircle size={10} weight="bold" /> Completed</span>
          {#if completedManga.length > 0}
            <button class="see-all" onclick={() => { if (completedCategory) setLibraryFilter(String(completedCategory.id)); store.navPage = "library"; }}>View all <ArrowRight size={9} weight="bold" /></button>
          {/if}
        </div>
        {#if completedManga.length > 0}
          <div class="mini-row" onwheel={(e) => { e.preventDefault(); handleRowWheel(e); }}>
            {#each completedManga as m (m.id)}
              <button class="mini-card" onclick={() => store.previewManga = m}>
                <div class="mini-cover-wrap">
                  <Thumbnail src={m.thumbnailUrl} alt={m.title} class="mini-cover" />
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

      <div class="bottom-col">
        <div class="bottom-section-hd">
          <span class="section-title"><TrendUp size={10} weight="bold" /> Your Stats</span>
        </div>
        <div class="stats-grid">
          <div class="stat-card"><div class="stat-icon-wrap stat-fire"><Fire size={16} weight="fill" /></div><div class="stat-body"><span class="stat-val">{stats.currentStreakDays}</span><span class="stat-label">Day streak</span></div></div>
          <div class="stat-card"><div class="stat-icon-wrap stat-accent"><BookOpen size={16} weight="light" /></div><div class="stat-body"><span class="stat-val">{stats.totalChaptersRead}</span><span class="stat-label">Chapters read</span></div></div>
          <div class="stat-card"><div class="stat-icon-wrap stat-neutral"><Clock size={16} weight="light" /></div><div class="stat-body"><span class="stat-val">{formatReadTime(stats.totalMinutesRead)}</span><span class="stat-label">Read time</span></div></div>
          <div class="stat-card"><div class="stat-icon-wrap stat-neutral"><TrendUp size={16} weight="light" /></div><div class="stat-body"><span class="stat-val">{stats.totalMangaRead}</span><span class="stat-label">Series started</span></div></div>
          <div class="stat-card"><div class="stat-icon-wrap stat-green"><CheckCircle size={16} weight="light" /></div><div class="stat-body"><span class="stat-val">{completedIds.length}</span><span class="stat-label">Completed</span></div></div>
          <div class="stat-card"><div class="stat-icon-wrap stat-neutral"><CalendarBlank size={16} weight="light" /></div><div class="stat-body"><span class="stat-val">{stats.longestStreakDays}d</span><span class="stat-label">Best streak</span></div></div>
        </div>
      </div>
    </div>

  </div>
</div>

{#if pickerOpen}
  <div class="picker-backdrop" role="presentation"
    onclick={(e) => { if (e.target === e.currentTarget) closePicker(); }}
    onkeydown={(e) => { if (e.key === "Escape") closePicker(); }}>
    <div class="picker-modal">
      <div class="picker-header">
        <span class="picker-title">Pin manga — slot {(pickerSlotIndex ?? 0) + 1}</span>
        <button class="picker-close" onclick={closePicker}><XIcon size={13} weight="light" /></button>
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
            <button class="picker-row" onclick={() => pinManga(m)}>
              <Thumbnail src={m.thumbnailUrl} alt={m.title} class="picker-thumb" />
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
  .body { flex: 1; display: flex; flex-direction: column; overflow-y: auto; overflow-x: hidden; min-height: 0; }
  .hero-section { padding: var(--sp-3) var(--sp-4) var(--sp-2); flex-shrink: 0; display: flex; flex-direction: column; }
  .hero-stage { position: relative; display: flex; align-items: stretch; height: 374px; border-radius: var(--radius-xl); overflow: hidden; background: var(--bg-raised); border: 1px solid var(--border-dim); box-shadow: 0 6px 28px rgba(0,0,0,0.28); }
  .hero-backdrop { position: absolute; inset: -14px; background-size: cover; background-position: center 25%; filter: blur(20px) saturate(2.2) brightness(0.45); transform: scale(1.07); pointer-events: none; z-index: 0; }
  .hero-bd-empty { background: var(--bg-void); filter: none; }
  .hero-scrim { position: absolute; inset: 0; z-index: 1; pointer-events: none; background: linear-gradient(100deg, rgba(0,0,0,0.0) 0%, rgba(0,0,0,0.55) 100%); }
  .hero-cover-col { position: relative; z-index: 2; flex-shrink: 0; width: 263px; height: 374px; overflow: hidden; cursor: pointer; border-right: 1px solid rgba(255,255,255,0.08); background: var(--bg-raised); }
  .hero-cover-col:hover .hero-cover { filter: brightness(1.08); }
  .hero-cover-col:hover .cover-resume-hint { opacity: 1; }
  .hero-cover { width: 100%; height: 100%; object-fit: cover; display: block; transition: filter 0.2s ease; }
  .hero-cover-empty { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: var(--bg-overlay); color: var(--text-faint); }
  .cover-resume-hint { position: absolute; inset: var(--sp-3); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 36px; background: rgba(0,0,0,0.4); border-radius: var(--radius-lg); opacity: 0; transition: opacity 0.18s ease; pointer-events: none; }
  .hero-details { position: relative; z-index: 2; flex: 1; min-width: 0; padding: var(--sp-4) var(--sp-5) var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-2); overflow: hidden; border-right: 1px solid rgba(255,255,255,0.06); }
  .hero-tags { display: flex; flex-wrap: wrap; gap: 5px; flex-shrink: 0; }
  .hero-tag { font-family: var(--font-ui); font-size: 9px; letter-spacing: var(--tracking-wide); text-transform: uppercase; padding: 2px 7px; border-radius: var(--radius-full); background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.62); border: 1px solid rgba(255,255,255,0.14); }
  .hero-tag-reading { background: var(--accent-muted); color: var(--accent-fg); border-color: var(--accent-dim); }
  .hero-tag-pinned  { background: rgba(168,132,232,0.18); color: #c4a8f0; border-color: rgba(168,132,232,0.28); }
  .hero-tag-genre   { cursor: pointer; transition: background 0.15s ease, color 0.15s ease; }
  .hero-tag-genre:hover { background: rgba(255,255,255,0.18); color: rgba(255,255,255,0.9); }
  .hero-title { font-size: var(--text-xl); font-weight: var(--weight-medium); color: #fff; line-height: var(--leading-tight); margin: 0; flex-shrink: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-shadow: 0 2px 10px rgba(0,0,0,0.5); }
  .hero-author { font-family: var(--font-ui); font-size: var(--text-xs); color: rgba(255,255,255,0.48); letter-spacing: var(--tracking-wide); flex-shrink: 0; }
  .hero-progress { display: flex; align-items: center; gap: 5px; flex-shrink: 0; font-family: var(--font-ui); font-size: var(--text-xs); color: rgba(255,255,255,0.58); letter-spacing: var(--tracking-wide); }
  .hero-prog-page { color: rgba(255,255,255,0.38); }
  .hero-prog-time { margin-left: auto; color: rgba(255,255,255,0.32); }
  .hero-desc { font-size: var(--text-xs); color: rgba(255,255,255,0.42); line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; flex-shrink: 0; }
  .hero-empty-title { font-size: var(--text-base); font-weight: var(--weight-medium); color: rgba(255,255,255,0.5); flex-shrink: 0; }
  .hero-empty-sub   { font-family: var(--font-ui); font-size: var(--text-xs); color: rgba(255,255,255,0.28); letter-spacing: var(--tracking-wide); line-height: var(--leading-snug); }
  .hero-actions { display: flex; gap: var(--sp-2); flex-shrink: 0; flex-wrap: wrap; }
  .hero-cta { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 7px 16px; border-radius: var(--radius-full); background: var(--accent-muted); border: 1px solid var(--accent-dim); color: var(--accent-fg); cursor: pointer; transition: filter var(--t-base); white-space: nowrap; }
  .hero-cta:hover:not(:disabled) { filter: brightness(1.15); }
  .hero-cta:disabled { opacity: 0.55; cursor: default; }
  .hero-cta-ghost { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 7px 14px; border-radius: var(--radius-full); background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.13); color: rgba(255,255,255,0.52); cursor: pointer; transition: background var(--t-base), color var(--t-base); white-space: nowrap; }
  .hero-cta-ghost:hover { background: rgba(255,255,255,0.13); color: rgba(255,255,255,0.82); }
  .hero-nav-row { display: flex; align-items: center; gap: var(--sp-2); flex-shrink: 0; margin-top: auto; padding-top: var(--sp-2); border-top: 1px solid rgba(255,255,255,0.08); }
  .hero-nav-btn { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.12); color: rgba(255,255,255,0.6); cursor: pointer; flex-shrink: 0; transition: background var(--t-base), color var(--t-base); }
  .hero-nav-btn:hover { background: rgba(255,255,255,0.2); color: #fff; }
  .hero-dots { display: flex; gap: 5px; align-items: center; }
  .hero-dot { width: 5px; height: 5px; border-radius: 50%; background: rgba(255,255,255,0.22); border: none; cursor: pointer; padding: 0; transition: background var(--t-base), transform var(--t-base); }
  .hero-dot:hover { background: rgba(255,255,255,0.5); }
  .hero-dot.active { background: #fff; transform: scale(1.35); }
  .hero-dot.pinned { background: rgba(168,132,232,0.55); }
  .hero-dot.pinned.active { background: #c4a8f0; }
  .hero-counter { font-family: var(--font-ui); font-size: 10px; color: rgba(255,255,255,0.3); letter-spacing: var(--tracking-wide); margin-left: auto; }
  .hero-chapters { position: relative; z-index: 2; width: clamp(180px, 32%, 240px); flex-shrink: 0; display: flex; flex-direction: column; padding: var(--sp-4) var(--sp-3); gap: 1px; overflow: hidden; }
  .hero-chapters-header { display: flex; align-items: center; gap: var(--sp-2); font-family: var(--font-ui); font-size: var(--text-xs); color: rgba(255,255,255,0.4); letter-spacing: var(--tracking-wider); text-transform: uppercase; padding-bottom: var(--sp-2); margin-bottom: var(--sp-1); border-bottom: 1px solid rgba(255,255,255,0.08); flex-shrink: 0; }
  .hero-chapters-empty { font-family: var(--font-ui); font-size: var(--text-xs); color: rgba(255,255,255,0.25); letter-spacing: var(--tracking-wide); padding: var(--sp-3) 0; }
  .chapter-row { display: flex; align-items: center; gap: var(--sp-2); width: 100%; padding: 7px var(--sp-2); border-radius: var(--radius-sm); background: none; border: none; text-align: left; cursor: pointer; transition: background var(--t-fast); }
  .chapter-row:hover { background: rgba(255,255,255,0.07); }
  .chapter-row-current { background: rgba(255,255,255,0.1) !important; }
  .ch-num { font-family: var(--font-ui); font-size: var(--text-2xs); color: rgba(255,255,255,0.35); letter-spacing: var(--tracking-wide); flex-shrink: 0; min-width: 36px; }
  .chapter-row-current .ch-num { color: var(--accent-fg); }
  .ch-info { flex: 1; display: flex; flex-direction: column; gap: 2px; overflow: hidden; min-width: 0; }
  .ch-name { font-size: var(--text-xs); color: rgba(255,255,255,0.75); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chapter-row-read .ch-name { color: rgba(255,255,255,0.35); }
  .chapter-row-current .ch-name { color: #fff; font-weight: var(--weight-medium); }
  .ch-meta { font-family: var(--font-ui); font-size: 9px; color: rgba(255,255,255,0.28); letter-spacing: var(--tracking-wide); }
  .ch-read { color: rgba(255,255,255,0.2); }
  :global(.ch-play-icon) { color: var(--accent-fg); flex-shrink: 0; }
  .chapter-row-sk { display: flex; gap: var(--sp-2); padding: 7px var(--sp-2); align-items: center; }
  .sk-info { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .sk { background: rgba(255,255,255,0.06); border-radius: var(--radius-sm); }
  .sk-num { width: 32px; height: 10px; flex-shrink: 0; }
  .sk-name { height: 11px; width: 85%; }
  .sk-meta { height: 9px; width: 50%; }
  .ch-view-all { display: flex; align-items: center; gap: 4px; margin-top: auto; font-family: var(--font-ui); font-size: var(--text-2xs); color: rgba(255,255,255,0.3); letter-spacing: var(--tracking-wide); background: none; border: none; cursor: pointer; padding: var(--sp-2) var(--sp-2) 0; transition: color var(--t-base); }
  .ch-view-all:hover { color: var(--accent-fg); }
  .section { border-top: 1px solid var(--border-dim); flex-shrink: 0; }
  .section-header { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-3) var(--sp-4) var(--sp-2); }
  .section-title { display: inline-flex; align-items: center; gap: var(--sp-2); font-family: var(--font-ui); font-size: var(--text-sm); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; }
  .see-all { display: flex; align-items: center; gap: 4px; font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); text-transform: uppercase; color: var(--text-faint); background: none; border: none; cursor: pointer; padding: 0; transition: color var(--t-base); }
  .see-all:hover { color: var(--accent-fg); }
  .activity-list { display: flex; flex-direction: column; padding: 0 var(--sp-3); overflow: hidden; }
  .activity-row { display: flex; align-items: center; gap: var(--sp-3); padding: 7px var(--sp-2); border-radius: var(--radius-md); border: 1px solid transparent; background: none; text-align: left; cursor: pointer; width: 100%; transition: background var(--t-fast), border-color var(--t-fast); }
  .activity-row:hover { background: var(--bg-raised); border-color: var(--border-dim); }
  .activity-row:hover .activity-play { opacity: 1; }
  :global(.activity-thumb) { width: 33px; height: 48px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0; border: 1px solid var(--border-dim); }
  .activity-info { flex: 1; display: flex; flex-direction: column; gap: 2px; overflow: hidden; min-width: 0; }
  .activity-title { font-size: var(--text-base); font-weight: var(--weight-medium); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .activity-sub { font-family: var(--font-ui); font-size: var(--text-sm); color: var(--text-muted); letter-spacing: var(--tracking-wide); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .activity-time { font-family: var(--font-ui); font-size: var(--text-sm); color: var(--text-faint); letter-spacing: var(--tracking-wide); flex-shrink: 0; }
  .activity-play { color: var(--accent-fg); flex-shrink: 0; opacity: 0; transition: opacity var(--t-base); }
  .bottom-row { display: grid; grid-template-columns: 1fr 1px 1fr; padding: 0 var(--sp-4); border-top: 1px solid var(--border-dim); flex-shrink: 0; }
  .bottom-divider { background: var(--border-dim); align-self: stretch; }
  .bottom-col { display: flex; flex-direction: column; min-width: 0; padding-top: var(--sp-4); padding-bottom: var(--sp-5); }
  .bottom-col:first-child { padding-right: var(--sp-4); }
  .bottom-col:last-child  { padding-left:  var(--sp-4); }
  .bottom-section-hd { display: flex; align-items: center; justify-content: space-between; padding-bottom: var(--sp-2); }
  .bottom-empty { font-family: var(--font-ui); font-size: var(--text-sm); color: var(--text-faint); letter-spacing: var(--tracking-wide); padding: var(--sp-1) 0; }
  .mini-row { display: flex; flex-direction: row; gap: var(--sp-3); overflow-x: auto; overflow-y: hidden; scrollbar-width: none; padding-bottom: var(--sp-1); }
  .mini-row::-webkit-scrollbar { display: none; }
  
  .mini-card { flex: 0 0 120px; width: 120px; background: none; border: none; padding: 0; cursor: pointer; text-align: left; }
  .mini-card:hover :global(.mini-cover) { filter: brightness(1.08) saturate(1.05); transform: scale(1.02); }
  .mini-card:hover { will-change: transform; }
  .mini-cover-wrap { position: relative; aspect-ratio: 2/3; overflow: hidden; border-radius: var(--radius-md); background: var(--bg-raised); border: 1px solid var(--border-dim); box-shadow: 0 2px 12px rgba(0,0,0,0.35); }
  :global(.mini-cover) { width: 100%; height: 100%; object-fit: cover; display: block; transition: filter 0.15s ease, transform 0.15s ease; }
  .mini-gradient { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.1) 55%, transparent 75%); pointer-events: none; }
  .mini-footer { position: absolute; bottom: 0; left: 0; right: 0; padding: var(--sp-2); pointer-events: none; }
  .mini-card-title { font-size: var(--text-xs); font-weight: var(--weight-medium); color: rgba(255,255,255,0.92); line-height: var(--leading-snug); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-shadow: 0 1px 4px rgba(0,0,0,0.7); }
  .mini-card-source { font-family: var(--font-ui); font-size: 9px; color: rgba(255,255,255,0.45); letter-spacing: var(--tracking-wide); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-2); }
  .stat-card { display: flex; align-items: center; gap: var(--sp-3); background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-md); padding: var(--sp-3) var(--sp-3); }
  .stat-icon-wrap { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: var(--radius-sm); flex-shrink: 0; }
  .stat-fire    { background: rgba(251,146,60,0.15); color: #fb923c; }
  .stat-accent  { background: var(--accent-muted); color: var(--accent-fg); }
  .stat-neutral { background: var(--bg-overlay); color: var(--text-faint); }
  .stat-green   { background: rgba(34,197,94,0.12); color: #22c55e; }
  .stat-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .stat-val { font-family: var(--font-ui); font-size: var(--text-lg, 1.05rem); font-weight: var(--weight-medium); color: var(--text-secondary); line-height: 1; }
  .stat-label { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); white-space: nowrap; }
  .activity-row-sk { cursor: default; pointer-events: none; }
  .sk-thumb { width: 33px; height: 48px; border-radius: var(--radius-sm); background: rgba(255,255,255,0.06); flex-shrink: 0; }
  .sk { background: var(--bg-raised); border-radius: var(--radius-sm); }
  .sk-title { height: 11px; margin-bottom: 5px; }
  .sk-sub { height: 9px; }
  .sk-time { width: 32px; height: 9px; flex-shrink: 0; background: rgba(255,255,255,0.06); border-radius: var(--radius-sm); }
  .activity-placeholder { position: relative; }
  .activity-placeholder-overlay { position: absolute; left: 0; right: 0; top: 0; bottom: -1px; display: flex; align-items: flex-end; justify-content: center; padding-bottom: var(--sp-4); pointer-events: none; background: linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.6) 100%); }
  .activity-placeholder-cta { pointer-events: all; display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 7px 16px; border-radius: var(--radius-full); background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14); color: rgba(255,255,255,0.65); cursor: pointer; transition: background var(--t-base), color var(--t-base); }
  .activity-placeholder-cta:hover { background: rgba(255,255,255,0.13); color: rgba(255,255,255,0.9); }
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
  :global(.picker-thumb) { height: 50px; width: 35px; aspect-ratio: 1 / 1.42; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0; border: 1px solid var(--border-dim); background: var(--bg-raised); display: block; }
  .picker-info { flex: 1; display: flex; flex-direction: column; gap: 2px; overflow: hidden; min-width: 0; }
  .picker-manga-title { font-size: var(--text-sm); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .picker-source { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  @keyframes fadeIn  { from { opacity: 0 } to { opacity: 1 } }
  @keyframes scaleIn { from { opacity: 0; transform: scale(0.97) } to { opacity: 1; transform: scale(1) } }
  @keyframes pulse   { 0%,100% { opacity: 0.4 } 50% { opacity: 0.7 } }
</style>
