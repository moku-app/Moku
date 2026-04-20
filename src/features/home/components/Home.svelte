<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { gql, thumbUrl } from "@api/client";
  import { getBlobUrl } from "@core/cache/imageCache";
  import { GET_CHAPTERS } from "@api/queries/chapters";
  import { GET_LIBRARY } from "@api/queries/manga";
  import { cache, CACHE_KEYS } from "@core/cache";
  import { store, openReader, setHeroSlot, setNavPage, setLibraryFilter, clearLibraryUpdates } from "@store/state.svelte";
  import type { HistoryEntry } from "@store/state.svelte";
  import type { Manga, Chapter } from "@types";
  import { buildReaderChapterList } from "@features/series/lib/chapterList";
  import HeroStage from "./HeroStage.svelte";
  import HeroSlotPicker from "./HeroSlotPicker.svelte";
  import ActivityFeed from "./ActivityFeed.svelte";
  import UpdatesRow from "./UpdatesRow.svelte";
  import StatsGrid from "./StatsGrid.svelte";

  let libraryManga:   Manga[]  = $state([]);
  let loadingLibrary: boolean  = $state(true);

  onMount(() => {
    loadLibrary();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function loadLibrary() {
    cache.get(CACHE_KEYS.LIBRARY, () =>
      gql<{ mangas: { nodes: Manga[] } }>(GET_LIBRARY).then(d => d.mangas.nodes)
    )
      .then(m => { libraryManga = m; })
      .catch(console.error)
      .finally(() => loadingLibrary = false);
  }

  function resetAndReload() {
    cache.clear(CACHE_KEYS.LIBRARY);
    loadingLibrary  = true;
    heroChapters    = [];
    heroAllChapters = [];
    heroChaptersFor = null;
    loadLibrary();
  }

  $effect(() => {
    if (store.navPage === "home") untrack(() => resetAndReload());
  });
  $effect(() => {
    const sessionId = store.readerSessionId;
    if (sessionId === 0) return;
    untrack(() => resetAndReload());
  });

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
    getBlobUrl(thumbUrl(path))
      .then(url => { heroThumb = url; })
      .catch(() => { heroThumb = ""; });
  });

  const heroTitle   = $derived(
    activeSlot?.kind === "pinned"   ? (activeSlot.manga?.title ?? "") :
    activeSlot?.kind === "continue" ? (activeSlot.entry?.mangaTitle ?? "") : ""
  );
  const heroManga   = $derived(
    activeSlot?.kind === "pinned"   ? activeSlot.manga :
    activeSlot?.kind === "continue" ? libraryManga.find(m => m.id === activeSlot.entry?.mangaId) : null
  );
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

  let heroChapters:    Chapter[] = $state([]);
  let heroAllChapters: Chapter[] = $state([]);
  let loadingHeroChapters = $state(false);
  let heroChaptersFor: number | null = null;

  $effect(() => {
    const id = heroMangaId;
    void store.settings.mangaPrefs?.[id!];
    if (id) untrack(() => loadHeroChapters(id));
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
      const filtered = buildReaderChapterList(all, store.settings.mangaPrefs?.[mangaId]);
      const lastReadIdx = heroEntry ? filtered.findIndex(c => c.id === heroEntry!.chapterId) : filtered.findLastIndex(c => c.isRead);
      const startIdx = Math.max(0, lastReadIdx);
      heroChapters = filtered.slice(startIdx, startIdx + 5);
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
        const list = buildReaderChapterList(all, store.settings.mangaPrefs?.[heroMangaId]);
        const target = list.find(c => c.id === chapter.id) ?? list[0];
        if (target) openReader(target, list);
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
      const raw = [...d.chapters.nodes].sort((a, b) => a.sourceOrder - b.sourceOrder);
      const list = buildReaderChapterList(raw, store.settings.mangaPrefs?.[heroEntry.mangaId]);
      const ch = list.find(c => c.id === heroEntry!.chapterId) ?? list[0];
      if (ch) {
        store.activeManga = heroManga ?? { id: heroEntry.mangaId, title: heroEntry.mangaTitle, thumbnailUrl: heroEntry.thumbnailUrl } as any;
        openReader(ch, list);
      }
    } catch { store.activeManga = { id: heroEntry.mangaId, title: heroEntry.mangaTitle, thumbnailUrl: heroEntry.thumbnailUrl } as any; }
    finally { resuming = false; }
  }

  async function resumeEntry(entry: HistoryEntry) {
    try {
      const d = await gql<{ chapters: { nodes: Chapter[] } }>(GET_CHAPTERS, { mangaId: entry.mangaId });
      const raw = [...d.chapters.nodes].sort((a, b) => a.sourceOrder - b.sourceOrder);
      const list = buildReaderChapterList(raw, store.settings.mangaPrefs?.[entry.mangaId]);
      const ch = list.find(c => c.id === entry.chapterId) ?? list[0];
      if (ch) {
        store.activeManga = { id: entry.mangaId, title: entry.mangaTitle, thumbnailUrl: entry.thumbnailUrl } as any;
        openReader(ch, list);
      } else store.activeManga = { id: entry.mangaId, title: entry.mangaTitle, thumbnailUrl: entry.thumbnailUrl } as any;
    } catch { store.activeManga = { id: entry.mangaId, title: entry.mangaTitle, thumbnailUrl: entry.thumbnailUrl } as any; }
  }

  let pickerOpen      = $state(false);
  let pickerSlotIndex: 1 | 2 | 3 | null = $state(null);

  function openPicker(i: 1 | 2 | 3) { pickerSlotIndex = i; pickerOpen = true; }
  function closePicker() { pickerOpen = false; pickerSlotIndex = null; }
  function pinManga(m: Manga) { if (pickerSlotIndex !== null) { setHeroSlot(pickerSlotIndex, m.id); closePicker(); } }
  function unpinSlot(i: 1 | 2 | 3) { setHeroSlot(i, null); }

  const recentHistory  = $derived(store.history.slice(0, 6));
  const stats          = $derived(store.readingStats);
  const libraryUpdates = $derived(store.libraryUpdates.slice(0, 7));
  const lastRefresh    = $derived(store.lastLibraryRefresh);
</script>

<div class="root">
  <div class="body">

    <div class="hero-section">
      <HeroStage
        {resolvedSlots}
        bind:activeIdx
        {heroThumb}
        {heroTitle}
        {heroManga}
        {heroEntry}
        {heroMangaId}
        {heroChapters}
        {loadingHeroChapters}
        {resuming}
        onresume={resumeActive}
        onopenchapter={openChapter}
        oncyclenext={cycleNext}
        oncycleprev={cyclePrev}
        ongotoslot={goToSlot}
        onopenpicker={openPicker}
        onunpin={unpinSlot}
        onviewall={() => { if (heroManga) store.activeManga = heroManga; }}
      />
    </div>

    <ActivityFeed
      entries={recentHistory}
      onresume={resumeEntry}
      onviewhistory={() => setNavPage("history")}
      onopenlibrary={() => setNavPage("library")}
    />

    <div class="bottom-row">
      <UpdatesRow
        updates={libraryUpdates}
        {libraryManga}
        {lastRefresh}
        onopen={(m) => { if (m) store.previewManga = m; }}
        onclear={() => { clearLibraryUpdates(); setLibraryFilter("all"); setNavPage("library"); }}
      />
      <div class="bottom-divider"></div>
      <StatsGrid {stats} updateCount={libraryUpdates.length} />
    </div>

  </div>
</div>

{#if pickerOpen && pickerSlotIndex !== null}
  <HeroSlotPicker
    slotIndex={pickerSlotIndex}
    {libraryManga}
    loading={loadingLibrary}
    onpin={pinManga}
    onclose={closePicker}
  />
{/if}

<style>
  .root {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    animation: fadeIn 0.14s ease both;
  }
  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
  }
  .hero-section {
    padding: var(--sp-3) var(--sp-4) var(--sp-2);
    flex-shrink: 0;
  }
  .bottom-row {
    display: grid;
    grid-template-columns: 1fr 1px 1fr;
    padding: var(--sp-4) var(--sp-4) var(--sp-5);
    border-top: 1px solid var(--border-dim);
    gap: var(--sp-4);
    flex-shrink: 0;
  }
  .bottom-divider { background: var(--border-dim); align-self: stretch; }

  @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
</style>
