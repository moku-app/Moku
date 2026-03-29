<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { ArrowLeft, BookmarkSimple, Download, CheckCircle, Circle, ArrowSquareOut, CircleNotch, Play, SortAscending, SortDescending, CaretDown, ArrowsClockwise, List, SquaresFour, FolderSimplePlus, Trash, DownloadSimple, X, LinkSimpleHorizontalBreak, ChartLineUp } from "phosphor-svelte";
  import { gql, thumbUrl } from "../../lib/client";
  import { GET_MANGA, GET_CHAPTERS, FETCH_CHAPTERS, ENQUEUE_DOWNLOAD, UPDATE_MANGA, MARK_CHAPTER_READ, MARK_CHAPTERS_READ, DELETE_DOWNLOADED_CHAPTERS, ENQUEUE_CHAPTERS_DOWNLOAD, GET_ALL_MANGA, GET_CATEGORIES, CREATE_CATEGORY, UPDATE_MANGA_CATEGORIES } from "../../lib/queries";
  import { cache, CACHE_KEYS, recordSourceAccess } from "../../lib/cache";
  import { dedupeMangaById, dedupeMangaByTitle } from "../../lib/util";
  import { store, addToast, updateSettings, openReader, setActiveManga, setGenreFilter, setNavPage, linkManga, unlinkManga, checkAndMarkCompleted as storeCheckAndMarkCompleted } from "../../store/state.svelte";
  import type { Manga, Chapter, Category } from "../../lib/types";
  import ContextMenu, { type MenuEntry } from "../shared/ContextMenu.svelte";
  import MigrateModal from "./MigrateModal.svelte";
  import TrackingPanel from "../shared/TrackingPanel.svelte";

  const CHAPTERS_PER_PAGE = 25;
  const MANGA_TTL_MS      = 5 * 60 * 1000;
  const CHAPTER_TTL_MS    = 2 * 60 * 1000;

  const mangaStore:   Map<number, { data: Manga;     fetchedAt: number }> = new Map();
  const chapterStore: Map<number, { data: Chapter[]; fetchedAt: number }> = new Map();

  let manga:           Manga | null     = $state(null);
  let chapters:        Chapter[]        = $state([]);
  let loadingManga:    boolean          = $state(false);
  let loadingChapters: boolean          = $state(true);
  let enqueueing:      Set<number>      = $state(new Set());
  let dlOpen:          boolean          = $state(false);
  let detailsOpen:     boolean          = $state(false);
  let togglingLibrary: boolean          = $state(false);
  let chapterPage:     number           = $state(1);
  let ctx: { x: number; y: number; chapter: Chapter; idx: number } | null = $state(null);
  let jumpOpen:        boolean          = $state(false);
  let jumpInput:       string           = $state("");
  let viewMode: "list" | "grid"         = $state("list");
  let deletingAll:     boolean          = $state(false);
  let refreshing:      boolean          = $state(false);
  let genresExpanded:  boolean          = $state(false);
  let folderPickerOpen: boolean         = $state(false);
  let folderCreating:  boolean          = $state(false);
  let folderNewName:   string           = $state("");
  let mangaCategories: Category[]       = $state([]);
  let allCategories:   Category[]       = $state([]);
  let catsLoading:     boolean          = $state(false);
  let rangeFrom:       string           = $state("");
  let rangeTo:         string           = $state("");
  let showRange:       boolean          = $state(false);
  let migrateOpen:     boolean          = $state(false);
  let dlDropRef:       HTMLDivElement | undefined = $state();
  let folderPickerRef: HTMLDivElement | undefined = $state();

  // Series link state
  let linkPickerOpen:   boolean   = $state(false);
  let linkSearch:       string    = $state("");
  let allMangaForLink:  Manga[]   = $state([]);
  let loadingLinkList:  boolean   = $state(false);

  // Tracking modal
  let trackingOpen: boolean = $state(false);

  let mangaAbort:  AbortController | null = null;
  let chapterAbort: AbortController | null = null;
  let loadingFor:  number | null = null;

  function formatDate(ts: string | null | undefined): string {
    if (!ts) return "";
    const n = Number(ts);
    const d = new Date(n > 1e10 ? n : n * 1000);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }

  function applyChapters(nodes: Chapter[]) {
    chapters = nodes;
    if (store.activeManga && nodes.length > 0) checkAndMarkCompleted(store.activeManga.id, nodes);
  }

  const sortDir        = $derived(store.settings.chapterSortDir);
  const sortMode       = $derived(store.settings.chapterSortMode ?? "source");
  let sortMenuOpen     = $state(false);

  const sortedChapters = $derived.by(() => {
    const base = [...chapters];
    if (sortMode === "chapterNumber") {
      base.sort((a, b) => a.chapterNumber - b.chapterNumber);
    } else if (sortMode === "uploadDate") {
      base.sort((a, b) => Number(a.uploadDate ?? 0) - Number(b.uploadDate ?? 0));
    } else {
      base.sort((a, b) => a.sourceOrder - b.sourceOrder);
    }
    return sortDir === "desc" ? base.reverse() : base;
  });

  /**
   * Chapter list in canonical reading order (ch1 -> ch2 -> ch3).
   * Always passed to openReader so the Reader's idx-based prev/next
   * navigation is direction-independent of the user's display sort.
   */
  const chaptersAsc = $derived(
    [...chapters].sort((a, b) => a.sourceOrder - b.sourceOrder)
  );
  const totalPages     = $derived(Math.ceil(sortedChapters.length / CHAPTERS_PER_PAGE));
  const pageChapters   = $derived(sortedChapters.slice((chapterPage - 1) * CHAPTERS_PER_PAGE, chapterPage * CHAPTERS_PER_PAGE));
  const readCount      = $derived(chapters.filter(c => c.isRead).length);
  const totalCount     = $derived(chapters.length);
  const progressPct    = $derived(totalCount > 0 ? (readCount / totalCount) * 100 : 0);
  const downloadedCount = $derived(chapters.filter(c => c.isDownloaded).length);

  const continueChapter = $derived((() => {
    if (!chapters.length) return null;
    const asc        = [...chapters].sort((a, b) => a.sourceOrder - b.sourceOrder);
    const anyRead    = asc.some(c => c.isRead);
    const inProgress = asc.find(c => !c.isRead && (c.lastPageRead ?? 0) > 0);
    if (inProgress) return { chapter: inProgress, type: "continue" as const };
    const firstUnread = asc.find(c => !c.isRead);
    if (firstUnread) return { chapter: firstUnread, type: (anyRead ? "continue" : "start") as const };
    return { chapter: asc[0], type: "reread" as const };
  })());

  const statusLabel     = $derived(manga?.status ? manga.status.charAt(0) + manga.status.slice(1).toLowerCase() : null);
  const assignedFolders = $derived(mangaCategories.filter(c => c.id !== 0));
  const hasFolders      = $derived(assignedFolders.length > 0);

  function loadCategories(mangaId: number) {
    catsLoading = true;
    gql<{ categories: { nodes: Category[] } }>(GET_CATEGORIES)
      .then(d => {
        allCategories   = d.categories.nodes.filter(c => c.id !== 0);
        mangaCategories = allCategories.filter(c => c.mangas?.nodes.some(m => m.id === mangaId));
      })
      .catch(console.error)
      .finally(() => { catsLoading = false; });
  }

  async function checkAndMarkCompleted(mangaId: number, chaps: Chapter[]) {
    await storeCheckAndMarkCompleted(mangaId, chaps, allCategories, gql, UPDATE_MANGA_CATEGORIES, UPDATE_MANGA);
    // Sync local mangaCategories state after the mutation
    if (chaps.length) {
      const allRead   = chaps.every(c => c.isRead);
      const completed = allCategories.find(c => c.name === "Completed");
      if (completed) {
        const inCompleted = mangaCategories.some(c => c.id === completed.id);
        if (allRead && !inCompleted)  mangaCategories = [...mangaCategories, completed];
        else if (!allRead && inCompleted) mangaCategories = mangaCategories.filter(c => c.id !== completed.id);
      }
    }
  }

  function loadManga(id: number) {
    mangaAbort?.abort();
    const ctrl = new AbortController();
    mangaAbort = ctrl;
    loadingFor = id;
    const cached = mangaStore.get(id);
    if (cached) {
      manga = cached.data; loadingManga = false;
      if (Date.now() - cached.fetchedAt < MANGA_TTL_MS) return;
      gql<{ manga: Manga }>(GET_MANGA, { id }, ctrl.signal).then(d => {
        if (ctrl.signal.aborted || loadingFor !== id) return;
        mangaStore.set(id, { data: d.manga, fetchedAt: Date.now() });
        manga = d.manga;
        if (d.manga.source?.id) recordSourceAccess(d.manga.source.id);
      }).catch(() => {});
      return;
    }
    loadingManga = true;
    gql<{ manga: Manga }>(GET_MANGA, { id }, ctrl.signal).then(d => {
      if (ctrl.signal.aborted || loadingFor !== id) return;
      mangaStore.set(id, { data: d.manga, fetchedAt: Date.now() });
      manga = d.manga;
      if (d.manga.source?.id) recordSourceAccess(d.manga.source.id);
    }).catch(() => {}).finally(() => { if (!ctrl.signal.aborted && loadingFor === id) loadingManga = false; });
  }

  function loadChapters(id: number) {
    chapterAbort?.abort();
    const ctrl = new AbortController();
    chapterAbort = ctrl;
    const cached = chapterStore.get(id);
    if (cached) {
      applyChapters(cached.data); loadingChapters = false;
      if (Date.now() - cached.fetchedAt < CHAPTER_TTL_MS) return;
      gql(FETCH_CHAPTERS, { mangaId: id }, ctrl.signal)
        .then(() => gql<{ chapters: { nodes: Chapter[] } }>(GET_CHAPTERS, { mangaId: id }, ctrl.signal))
        .then(d => {
          if (ctrl.signal.aborted || loadingFor !== id) return;
          chapterStore.set(id, { data: d.chapters.nodes, fetchedAt: Date.now() });
          applyChapters(d.chapters.nodes);
        }).catch(() => {});
      return;
    }
    chapters = []; loadingChapters = true;
    gql<{ chapters: { nodes: Chapter[] } }>(GET_CHAPTERS, { mangaId: id }, ctrl.signal).then(d => {
      if (ctrl.signal.aborted || loadingFor !== id) return;
      applyChapters(d.chapters.nodes); loadingChapters = false;
      return gql(FETCH_CHAPTERS, { mangaId: id }, ctrl.signal)
        .then(() => gql<{ chapters: { nodes: Chapter[] } }>(GET_CHAPTERS, { mangaId: id }, ctrl.signal))
        .then(fresh => {
          if (ctrl.signal.aborted || loadingFor !== id) return;
          chapterStore.set(id, { data: fresh.chapters.nodes, fetchedAt: Date.now() });
          applyChapters(fresh.chapters.nodes);
        });
    }).catch(() => { if (!ctrl.signal.aborted) loadingChapters = false; });
  }

  $effect(() => {
    const m = store.activeManga;
    if (m) untrack(() => { loadManga(m.id); loadChapters(m.id); loadCategories(m.id); });
  });

  let prevChapterId: number | null = null;
  $effect(() => {
    const wasOpen = prevChapterId !== null;
    prevChapterId = store.activeChapter?.id ?? null;
    if (wasOpen && !store.activeChapter && store.activeManga) {
      const id = store.activeManga.id;
      untrack(() => { loadChapters(id); cache.clear(CACHE_KEYS.LIBRARY); });
    }
  });

  async function toggleLibrary() {
    if (!manga) return;
    togglingLibrary = true;
    const next = !manga.inLibrary;
    await gql(UPDATE_MANGA, { id: manga.id, inLibrary: next }).catch(console.error);
    manga = { ...manga, inLibrary: next };
    if (mangaStore.has(manga.id)) { const e = mangaStore.get(manga.id)!; mangaStore.set(manga.id, { ...e, data: manga }); }
    cache.clear(CACHE_KEYS.LIBRARY);
    togglingLibrary = false;
  }

  async function reloadChapters(id: number) {
    const d = await gql<{ chapters: { nodes: Chapter[] } }>(GET_CHAPTERS, { mangaId: id });
    chapterStore.set(id, { data: d.chapters.nodes, fetchedAt: Date.now() });
    applyChapters(d.chapters.nodes);
  }

  async function enqueue(ch: Chapter, e: MouseEvent) {
    e.stopPropagation();
    enqueueing = new Set(enqueueing).add(ch.id);
    await gql(ENQUEUE_DOWNLOAD, { chapterId: ch.id }).catch(console.error);
    addToast({ kind: "download", title: "Download queued", body: ch.name });
    enqueueing.delete(ch.id); enqueueing = new Set(enqueueing);
    if (store.activeManga) reloadChapters(store.activeManga.id);
  }

  async function enqueueMultiple(chapterIds: number[]) {
    if (!chapterIds.length) return;
    await gql(ENQUEUE_CHAPTERS_DOWNLOAD, { chapterIds }).catch(console.error);
    addToast({ kind: "download", title: "Download queued", body: `${chapterIds.length} chapter${chapterIds.length !== 1 ? "s" : ""} added` });
    if (store.activeManga) reloadChapters(store.activeManga.id);
  }

  async function markRead(chapterId: number, isRead: boolean) {
    await gql(MARK_CHAPTER_READ, { id: chapterId, isRead }).catch(console.error);
    chapters = chapters.map(c => c.id === chapterId ? { ...c, isRead } : c);
    if (store.activeManga) { chapterStore.set(store.activeManga.id, { data: chapters, fetchedAt: Date.now() }); checkAndMarkCompleted(store.activeManga.id, chapters); }
  }

  async function markBulk(ids: number[], isRead: boolean) {
    if (!ids.length) return;
    await gql(MARK_CHAPTERS_READ, { ids, isRead }).catch(console.error);
    const idSet = new Set(ids);
    chapters = chapters.map(c => idSet.has(c.id) ? { ...c, isRead } : c);
    if (store.activeManga) { chapterStore.set(store.activeManga.id, { data: chapters, fetchedAt: Date.now() }); checkAndMarkCompleted(store.activeManga.id, chapters); }
  }

  const markAboveRead   = (i: number) => markBulk(sortedChapters.slice(0, i + 1).filter(c => !c.isRead).map(c => c.id), true);
  const markBelowRead   = (i: number) => markBulk(sortedChapters.slice(i).filter(c => !c.isRead).map(c => c.id), true);
  const markAboveUnread = (i: number) => markBulk(sortedChapters.slice(0, i + 1).filter(c => c.isRead).map(c => c.id), false);
  const markBelowUnread = (i: number) => markBulk(sortedChapters.slice(i).filter(c => c.isRead).map(c => c.id), false);

  async function deleteDownloaded(chapterId: number) {
    await gql(DELETE_DOWNLOADED_CHAPTERS, { ids: [chapterId] }).catch(console.error);
    chapters = chapters.map(c => c.id === chapterId ? { ...c, isDownloaded: false } : c);
    if (store.activeManga) chapterStore.set(store.activeManga.id, { data: chapters, fetchedAt: Date.now() });
  }

  async function deleteAllDownloads() {
    const ids = chapters.filter(c => c.isDownloaded).map(c => c.id);
    if (!ids.length) return;
    deletingAll = true;
    await gql(DELETE_DOWNLOADED_CHAPTERS, { ids }).catch(console.error);
    chapters = chapters.map(c => ({ ...c, isDownloaded: false }));
    if (store.activeManga) chapterStore.set(store.activeManga.id, { data: chapters, fetchedAt: Date.now() });
    deletingAll = false;
  }

  async function refreshChapters() {
    if (!store.activeManga || refreshing) return;
    refreshing = true;
    chapterStore.delete(store.activeManga.id);
    gql(FETCH_CHAPTERS, { mangaId: store.activeManga.id })
      .then(() => reloadChapters(store.activeManga!.id))
      .then(() => addToast({ kind: "success", title: "Chapters refreshed" }))
      .catch(e => addToast({ kind: "error", title: "Refresh failed", body: e?.message }))
      .finally(() => refreshing = false);
  }

  function buildCtxItems(ch: Chapter, idx: number): MenuEntry[] {
    const above = sortedChapters.slice(0, idx + 1), below = sortedChapters.slice(idx), last = sortedChapters.length - 1;
    return [
      { label: ch.isRead ? "Mark as unread" : "Mark as read", icon: ch.isRead ? Circle : CheckCircle, onClick: () => markRead(ch.id, !ch.isRead) },
      { separator: true },
      { label: "Mark above as read",   icon: CheckCircle, onClick: () => markAboveRead(idx),   disabled: above.filter(c => !c.isRead).length === 0 },
      { label: "Mark above as unread", icon: Circle,      onClick: () => markAboveUnread(idx), disabled: above.filter(c => c.isRead).length === 0 },
      { separator: true },
      { label: "Mark below as read",   icon: CheckCircle, onClick: () => markBelowRead(idx),   disabled: idx === last || below.filter(c => !c.isRead).length === 0 },
      { label: "Mark below as unread", icon: Circle,      onClick: () => markBelowUnread(idx), disabled: idx === last || below.filter(c => c.isRead).length === 0 },
      { separator: true },
      { label: ch.isDownloaded ? "Delete download" : "Download", icon: ch.isDownloaded ? Trash : Download, danger: ch.isDownloaded, onClick: () => ch.isDownloaded ? deleteDownloaded(ch.id) : gql(ENQUEUE_DOWNLOAD, { chapterId: ch.id }).catch(console.error) },
      { separator: true },
      { label: "Download next 5 from here", icon: DownloadSimple, onClick: () => enqueueMultiple(sortedChapters.slice(idx, idx + 5).filter(c => !c.isDownloaded).map(c => c.id)) },
      { label: "Download all from here",    icon: DownloadSimple, onClick: () => enqueueMultiple(sortedChapters.slice(idx).filter(c => !c.isDownloaded).map(c => c.id)) },
    ];
  }

  function handleDlOutside(e: MouseEvent) { if (dlDropRef && !dlDropRef.contains(e.target as Node)) dlOpen = false; }
  function handleFolderOutside(e: MouseEvent) { if (folderPickerRef && !folderPickerRef.contains(e.target as Node)) { folderPickerOpen = false; folderCreating = false; folderNewName = ""; } }

  $effect(() => {
    if (dlOpen) { setTimeout(() => document.addEventListener("mousedown", handleDlOutside, true), 0); }
    else document.removeEventListener("mousedown", handleDlOutside, true);
  });
  $effect(() => {
    if (folderPickerOpen) { setTimeout(() => document.addEventListener("mousedown", handleFolderOutside, true), 0); }
    else document.removeEventListener("mousedown", handleFolderOutside, true);
  });

  function enqueueNext(n: number) {
    if (!continueChapter) return;
    const idx = sortedChapters.indexOf(continueChapter.chapter);
    if (idx < 0) return;
    enqueueMultiple(sortedChapters.slice(idx, idx + n).filter(c => !c.isDownloaded).map(c => c.id));
  }

  function enqueueRange() {
    const from = parseFloat(rangeFrom), to = parseFloat(rangeTo);
    if (isNaN(from) || isNaN(to)) return;
    const lo = Math.min(from, to), hi = Math.max(from, to);
    enqueueMultiple(sortedChapters.filter(c => c.chapterNumber >= lo && c.chapterNumber <= hi && !c.isDownloaded).map(c => c.id));
  }

  async function createCategory() {
    const name = folderNewName.trim();
    if (!name || !store.activeManga) return;
    try {
      const res = await gql<{ createCategory: { category: Category } }>(CREATE_CATEGORY, { name });
      const cat = res.createCategory.category;
      await gql(UPDATE_MANGA_CATEGORIES, { mangaId: store.activeManga.id, addTo: [cat.id], removeFrom: [] });
      allCategories   = [...allCategories, cat];
      mangaCategories = [...mangaCategories, cat];
    } catch (e) { console.error(e); }
    folderNewName = ""; folderCreating = false;
  }

  async function toggleCategory(cat: Category) {
    if (!store.activeManga) return;
    const inCat = mangaCategories.some(c => c.id === cat.id);
    try {
      await gql(UPDATE_MANGA_CATEGORIES, {
        mangaId:    store.activeManga.id,
        addTo:      inCat ? [] : [cat.id],
        removeFrom: inCat ? [cat.id] : [],
      });
      mangaCategories = inCat
        ? mangaCategories.filter(c => c.id !== cat.id)
        : [...mangaCategories, cat];
    } catch (e) { console.error(e); }
  }

  onMount(() => () => { mangaAbort?.abort(); chapterAbort?.abort(); });

  // ── Series link ────────────────────────────────────────────────────────────

  const linkedIds = $derived(
    store.activeManga ? (store.settings.mangaLinks?.[store.activeManga.id] ?? []) : []
  );

  const linkPickerResults = $derived.by(() => {
    const id       = store.activeManga?.id;
    const others   = allMangaForLink.filter(m => m.id !== id);
    const q        = linkSearch.trim().toLowerCase();
    const filtered = q ? others.filter(m => m.title.toLowerCase().includes(q)) : others;
    const linked   = filtered.filter(m => linkedIds.includes(m.id));
    const rest     = filtered.filter(m => !linkedIds.includes(m.id)).slice(0, 30);
    return [...linked, ...rest];
  });

  async function openLinkPicker() {
    linkPickerOpen = true; linkSearch = "";
    if (allMangaForLink.length) return;
    loadingLinkList = true;
    gql<{ mangas: { nodes: Manga[] } }>(GET_ALL_MANGA)
      .then(d => { allMangaForLink = d.mangas.nodes; })
      .catch(console.error)
      .finally(() => { loadingLinkList = false; });
  }

  function closeLinkPicker() { linkPickerOpen = false; linkSearch = ""; }

  function handleLink(other: Manga) {
    if (!store.activeManga) return;
    if (linkedIds.includes(other.id)) unlinkManga(store.activeManga.id, other.id);
    else linkManga(store.activeManga.id, other.id);
  }
</script>

{#if store.activeManga}
<div class="root" role="presentation" oncontextmenu={(e) => e.preventDefault()}>

  <!-- ── Sidebar ────────────────────────────────────────────────────────── -->
  <div class="sidebar">
    <button class="back" onclick={() => setActiveManga(null)}>
      <ArrowLeft size={13} weight="light" /> Back
    </button>

    <!-- Zone 1: Cover -->
    <div class="cover-wrap">
      <img src={thumbUrl(store.activeManga.thumbnailUrl)} alt={store.activeManga.title} class="cover" />
    </div>

    <!-- Zone 2: Meta -->
    {#if loadingManga}
      <div class="meta-skeleton">
        <div class="skeleton sk-line" style="width:90%;height:14px"></div>
        <div class="skeleton sk-line" style="width:60%;height:11px"></div>
      </div>
    {:else}
      <div class="meta">
        <p class="title">{manga?.title}</p>
        {#if manga?.author || manga?.artist}
          <p class="byline">{[manga?.author, manga?.artist].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" · ")}</p>
        {/if}
        {#if statusLabel}
          <span class="status-badge" class:ongoing={manga?.status === "ONGOING"} class:ended={manga?.status !== "ONGOING"}>{statusLabel}</span>
        {/if}
        {#if manga?.genre?.length}
          <div class="genres">
            {#each (genresExpanded ? manga.genre : manga.genre.slice(0, 3)) as g}
              <button class="genre" onclick={() => { setGenreFilter(g); setNavPage("explore"); setActiveManga(null); }}>{g}</button>
            {/each}
            {#if manga.genre.length > 3}
              <button class="genre-toggle" onclick={() => genresExpanded = !genresExpanded}>
                {genresExpanded ? "less" : `+${manga.genre.length - 3}`}
              </button>
            {/if}
          </div>
        {/if}
        {#if manga?.description}
          <p class="desc">{manga.description}</p>
        {/if}
      </div>
    {/if}

    <!-- Zone 3: Primary CTA + library action -->
    <div class="cta-section">
      {#if continueChapter}
        <button class="read-btn" onclick={() => openReader(continueChapter!.chapter, chaptersAsc)}>
          <Play size={12} weight="fill" />
          {continueChapter.type === "continue"
            ? `Continue · Ch.${continueChapter.chapter.chapterNumber}${(continueChapter.chapter.lastPageRead ?? 0) > 0 ? ` p.${continueChapter.chapter.lastPageRead}` : ""}`
            : continueChapter.type === "reread" ? "Read again" : "Start reading"}
        </button>
      {/if}
      <div class="actions">
        <button class="library-btn" class:active={manga?.inLibrary} onclick={toggleLibrary} disabled={togglingLibrary || loadingManga}>
          <BookmarkSimple size={13} weight={manga?.inLibrary ? "fill" : "light"} />
          {manga?.inLibrary ? "In Library" : "Add to Library"}
        </button>
        {#if manga?.realUrl}
          <a href={manga.realUrl} target="_blank" rel="noreferrer" class="external-link">
            <ArrowSquareOut size={13} weight="light" />
          </a>
        {/if}
      </div>
    </div>

    <!-- Zone 4: Progress -->
    {#if totalCount > 0}
      <div class="progress-section">
        <div class="progress-header">
          <span class="progress-label">{readCount} / {totalCount} read</span>
          <span class="progress-pct">{Math.round(progressPct)}%</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:{progressPct}%"></div></div>
      </div>
    {/if}

    <!-- Zone 5: Details accordion (source info + all secondary actions) -->
    {#if !loadingManga && manga?.source}
      <div class="details-section">
        <button class="details-toggle" onclick={() => detailsOpen = !detailsOpen}>
          <span>Details</span>
          <CaretDown size={11} weight="light" style="transform:{detailsOpen ? 'rotate(180deg)' : 'rotate(0)'};transition:transform 0.15s ease" />
        </button>
        {#if detailsOpen}
          <div class="details-body">
            <div class="detail-row"><span class="detail-key">Source</span><span class="detail-val">{manga.source.displayName}</span></div>
            {#if manga.status}<div class="detail-row"><span class="detail-key">Status</span><span class="detail-val">{statusLabel}</span></div>{/if}
            {#if manga.author}<div class="detail-row"><span class="detail-key">Author</span><span class="detail-val">{manga.author}</span></div>{/if}
            {#if manga.artist && manga.artist !== manga.author}<div class="detail-row"><span class="detail-key">Artist</span><span class="detail-val">{manga.artist}</span></div>{/if}

            <div class="detail-actions">
              <button class="detail-action-btn" onclick={() => migrateOpen = true}>
                <ArrowsClockwise size={12} weight="light" /> Switch Source
              </button>
              <button
                class="detail-action-btn"
                class:detail-action-active={linkedIds.length > 0}
                onclick={openLinkPicker}
              >
                <LinkSimpleHorizontalBreak size={12} weight={linkedIds.length > 0 ? "fill" : "light"} />
                Series Link{linkedIds.length > 0 ? ` (${linkedIds.length})` : ""}
              </button>
              <button
                class="detail-action-btn"
                onclick={() => trackingOpen = true}
              >
                <ChartLineUp size={12} weight="light" /> Tracking
              </button>
              {#if downloadedCount > 0}
                <button class="detail-action-btn detail-action-danger" onclick={deleteAllDownloads} disabled={deletingAll}>
                  <Trash size={12} weight="light" /> {deletingAll ? "Deleting…" : `Delete Downloads (${downloadedCount})`}
                </button>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- ── Chapter list ───────────────────────────────────────────────────── -->
  <div class="list-wrap">
    <div class="list-header">
      <div class="list-header-left">
        <div class="sort-wrap">
          <button class="sort-btn" onclick={() => sortMenuOpen = !sortMenuOpen}>
            {#if sortDir === "desc"}<SortDescending size={14} weight="light" />{:else}<SortAscending size={14} weight="light" />{/if}
            {{ source: "Source order", chapterNumber: "Ch. number", uploadDate: "Upload date" }[sortMode]}
            <CaretDown size={10} weight="light" />
          </button>
          {#if sortMenuOpen}
            <div class="sort-menu" role="presentation" onmouseleave={() => sortMenuOpen = false}>
              {#each [["source","Source order"],["chapterNumber","Chapter number"],["uploadDate","Upload date"]] as [val, label]}
                <button class="sort-option" class:active={sortMode === val}
                  onclick={() => { updateSettings({ chapterSortMode: val as any }); chapterPage = 1; sortMenuOpen = false; }}>
                  {label}
                </button>
              {/each}
              <div class="sort-divider"></div>
              <button class="sort-option" onclick={() => { updateSettings({ chapterSortDir: sortDir === "desc" ? "asc" : "desc" }); chapterPage = 1; sortMenuOpen = false; }}>
                {sortDir === "desc" ? "↑ Ascending" : "↓ Descending"}
              </button>
            </div>
          {/if}
        </div>
        <!-- View toggle: icon reflects current state -->
        <button class="icon-btn" class:active={viewMode === "grid"} onclick={() => viewMode = viewMode === "list" ? "grid" : "list"} title={viewMode === "list" ? "Grid view" : "List view"}>
          {#if viewMode === "list"}<SquaresFour size={14} weight="light" />{:else}<List size={14} weight="light" />{/if}
        </button>
      </div>
      <div class="list-header-right">
        <button class="icon-btn" onclick={refreshChapters} disabled={refreshing}>
          <ArrowsClockwise size={14} weight="light" class={refreshing ? "anim-spin" : ""} />
        </button>

        <!-- Category picker -->
        <div class="fp-wrap" bind:this={folderPickerRef}>
          <button class="icon-btn" class:active={hasFolders} onclick={() => folderPickerOpen = !folderPickerOpen}>
            <FolderSimplePlus size={14} weight={hasFolders ? "fill" : "light"} />
          </button>
          {#if folderPickerOpen}
            <div class="fp-menu">
              {#if catsLoading}
                <p class="fp-empty">Loading…</p>
              {:else if allCategories.length === 0 && !folderCreating}
                <p class="fp-empty">No folders yet</p>
              {/if}
              {#each allCategories as cat}
                {@const isIn = mangaCategories.some(c => c.id === cat.id)}
                <button class="fp-item" class:fp-item-active={isIn} onclick={() => toggleCategory(cat)}>
                  <span class="fp-check">{isIn ? "✓" : ""}</span>{cat.name}
                </button>
              {/each}
              <div class="fp-div"></div>
              {#if folderCreating}
                <div class="fp-create">
                  <input class="fp-input" placeholder="Folder name…" bind:value={folderNewName}
                    onkeydown={(e) => { if (e.key === "Enter") createCategory(); if (e.key === "Escape") { folderCreating = false; folderNewName = ""; } }} use:focusOnMount />
                  <button class="fp-confirm" onclick={createCategory} disabled={!folderNewName.trim()}>Add</button>
                  <button class="fp-cancel" onclick={() => { folderCreating = false; folderNewName = ""; }}>
                    <X size={12} weight="light" />
                  </button>
                </div>
              {:else}
                <button class="fp-new" onclick={() => folderCreating = true}>+ New folder</button>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Download dropdown -->
        {#if chapters.length > 0}
          <div class="dl-wrap" bind:this={dlDropRef}>
            <button class="icon-btn" onclick={() => dlOpen = !dlOpen}>
              <Download size={13} weight="light" />
            </button>
            {#if dlOpen}
              <div class="dl-dropdown">
                {#if continueChapter}
                  {@const contIdx = sortedChapters.indexOf(continueChapter.chapter)}
                  {#if contIdx >= 0}
                    <p class="dl-section-label">From Ch.{continueChapter.chapter.chapterNumber}</p>
                    <div class="dl-next-row">
                      {#each [5, 10, 25] as n}
                        {@const avail = sortedChapters.slice(contIdx, contIdx + n).filter(c => !c.isDownloaded).length}
                        <button class="dl-next-btn" disabled={avail === 0} onclick={() => { enqueueNext(n); dlOpen = false; }}>
                          <span>Next {n}</span><span class="dl-next-sub">{avail} new</span>
                        </button>
                      {/each}
                    </div>
                    <div class="dl-divider"></div>
                  {/if}
                {/if}
                {#if !showRange}
                  <button class="dl-item" onclick={() => showRange = true}>
                    <span>Custom range…</span><span class="dl-item-sub">Enter chapter numbers</span>
                  </button>
                {:else}
                  <div class="dl-range-row">
                    <button class="dl-range-back" onclick={() => showRange = false}>‹</button>
                    <input class="dl-range-input" placeholder="From" bind:value={rangeFrom} onkeydown={(e) => e.key === "Enter" && enqueueRange()} use:focusOnMount />
                    <span class="dl-range-sep">–</span>
                    <input class="dl-range-input" placeholder="To" bind:value={rangeTo} onkeydown={(e) => e.key === "Enter" && enqueueRange()} />
                    <button class="dl-range-go" disabled={!rangeFrom.trim() || !rangeTo.trim()} onclick={enqueueRange}>Go</button>
                  </div>
                {/if}
                <div class="dl-divider"></div>
                <button class="dl-item" onclick={() => { enqueueMultiple(sortedChapters.filter(c => !c.isRead && !c.isDownloaded).map(c => c.id)); dlOpen = false; }}>
                  <span>Unread chapters</span><span class="dl-item-sub">{sortedChapters.filter(c => !c.isRead && !c.isDownloaded).length} remaining</span>
                </button>
                <button class="dl-item" onclick={() => { enqueueMultiple(sortedChapters.filter(c => !c.isDownloaded).map(c => c.id)); dlOpen = false; }}>
                  <span>Download all</span><span class="dl-item-sub">{sortedChapters.filter(c => !c.isDownloaded).length} not downloaded</span>
                </button>
                {#if downloadedCount > 0}
                  <div class="dl-divider"></div>
                  <button class="dl-item dl-item-danger" onclick={() => { deleteAllDownloads(); dlOpen = false; }} disabled={deletingAll}>
                    <span>{deletingAll ? "Deleting…" : "Delete all downloads"}</span>
                    <span class="dl-item-sub">{downloadedCount} downloaded</span>
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        {#if totalPages > 1}
          <div class="pagination">
            <button class="page-btn" onclick={() => chapterPage = Math.max(1, chapterPage - 1)} disabled={chapterPage === 1}>←</button>
            <span class="page-num">{chapterPage} / {totalPages}</span>
            <button class="page-btn" onclick={() => chapterPage = Math.min(totalPages, chapterPage + 1)} disabled={chapterPage === totalPages}>→</button>
          </div>
        {/if}
      </div>
    </div>

    <div class={viewMode === "grid" ? "ch-grid" : "ch-list"}>
      {#if loadingChapters && chapters.length === 0}
        {#if viewMode === "grid"}
          {#each Array(24) as _}<div class="grid-cell-skeleton skeleton"></div>{/each}
        {:else}
          {#each Array(8) as _}<div class="row-skeleton"><div class="skeleton sk-line" style="width:55%;height:12px"></div><div class="skeleton sk-line" style="width:25%;height:11px"></div></div>{/each}
        {/if}
      {:else if viewMode === "grid"}
        {#each sortedChapters as ch, i}
          {@const inProgress = !ch.isRead && (ch.lastPageRead ?? 0) > 0}
          <button class="grid-cell" class:read={ch.isRead} class:in-progress={inProgress}
            onclick={() => openReader(ch, chaptersAsc)}
            oncontextmenu={(e) => { e.preventDefault(); ctx = { x: e.clientX, y: e.clientY, chapter: ch, idx: i }; }}
            title={ch.name}>
            <span class="grid-cell-num">{ch.chapterNumber % 1 === 0 ? ch.chapterNumber.toFixed(0) : ch.chapterNumber}</span>
            {#if ch.isRead}<span class="grid-cell-dot"></span>{/if}
            {#if enqueueing.has(ch.id)}<span class="grid-cell-spinner"><CircleNotch size={10} weight="light" class="anim-spin" /></span>{/if}
          </button>
        {/each}
      {:else}
        {#each pageChapters as ch}
          {@const idxInSorted = sortedChapters.indexOf(ch)}
          <div role="button" tabindex="0" class="ch-row" class:read={ch.isRead}
            onclick={() => openReader(ch, chaptersAsc)}
            onkeydown={(e) => e.key === "Enter" && openReader(ch, chaptersAsc)}
            oncontextmenu={(e) => { e.preventDefault(); ctx = { x: e.clientX, y: e.clientY, chapter: ch, idx: idxInSorted }; }}>
            <div class="ch-left">
              <span class="ch-name">{ch.name}</span>
              <div class="ch-meta">
                {#if ch.scanlator}<span class="ch-meta-item">{ch.scanlator}</span>{/if}
                {#if ch.uploadDate}<span class="ch-meta-item">{formatDate(ch.uploadDate)}</span>{/if}
                {#if ch.lastPageRead && ch.lastPageRead > 0 && !ch.isRead}<span class="ch-meta-item">p.{ch.lastPageRead}</span>{/if}
              </div>
            </div>
            <div class="ch-right">
              {#if ch.isRead}<CheckCircle size={14} weight="light" class="read-icon" />{/if}
              {#if ch.isDownloaded}
                <button class="dl-btn" onclick={(e) => { e.stopPropagation(); deleteDownloaded(ch.id); }}><Trash size={13} weight="light" /></button>
              {:else if enqueueing.has(ch.id)}
                <CircleNotch size={14} weight="light" class="anim-spin enqueue-icon" />
              {:else}
                <button class="dl-btn" onclick={(e) => { e.stopPropagation(); enqueue(ch, e); }}><Download size={13} weight="light" /></button>
              {/if}
            </div>
          </div>
        {/each}
      {/if}
    </div>

    {#if totalPages > 1}
      <div class="pagination-bottom">
        <button class="page-btn" onclick={() => chapterPage = Math.max(1, chapterPage - 1)} disabled={chapterPage === 1}>← Prev</button>
        <span class="page-num">{chapterPage} / {totalPages}</span>
        <button class="page-btn" onclick={() => chapterPage = Math.min(totalPages, chapterPage + 1)} disabled={chapterPage === totalPages}>Next →</button>
      </div>
    {/if}
  </div>
</div>

{#if ctx}
  <ContextMenu x={ctx.x} y={ctx.y} items={buildCtxItems(ctx.chapter, ctx.idx)} onClose={() => ctx = null} />
{/if}

{#if migrateOpen && manga}
  <MigrateModal
    {manga}
    currentChapters={chapters}
    onClose={() => migrateOpen = false}
    onMigrated={(newManga) => { setActiveManga(newManga); migrateOpen = false; cache.clear(CACHE_KEYS.LIBRARY); }}
  />
{/if}

{#if trackingOpen && store.activeManga}
  <TrackingPanel
    mangaId={store.activeManga.id}
    mangaTitle={store.activeManga.title}
    onClose={() => trackingOpen = false}
  />
{/if}

{#if linkPickerOpen}
  <div
    class="link-backdrop"
    role="presentation"
    onclick={(e) => { if (e.target === e.currentTarget) closeLinkPicker(); }}
    onkeydown={(e) => e.key === "Escape" && closeLinkPicker()}
  >
    <div class="link-modal">
      <div class="link-header">
        <span class="link-title">Link as same series</span>
        <button class="link-close" onclick={closeLinkPicker}><X size={14} weight="light" /></button>
      </div>
      <p class="link-hint">Mark two manga as the same series so duplicates are merged in search and discover. Click a linked entry again to unlink.</p>
      <div class="link-search-wrap">
        <input class="link-search" placeholder="Search your library…" bind:value={linkSearch} use:focusOnMount />
      </div>
      <div class="link-list">
        {#if loadingLinkList}
          <p class="link-empty">Loading…</p>
        {:else if linkPickerResults.length === 0}
          <p class="link-empty">No results</p>
        {:else}
          {#each linkPickerResults as m (m.id)}
            {@const isLinked = linkedIds.includes(m.id)}
            <button class="link-row" class:link-row-linked={isLinked} onclick={() => handleLink(m)}>
              <img src={thumbUrl(m.thumbnailUrl)} alt={m.title} class="link-thumb" loading="lazy" decoding="async" />
              <div class="link-info">
                <span class="link-manga-title">{m.title}</span>
                {#if m.source?.displayName}<span class="link-source">{m.source.displayName}</span>{/if}
              </div>
              <span class="link-status">{isLinked ? "✓ Linked" : "Link"}</span>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}
{/if}


<style>
  .root { display: flex; height: 100%; overflow: hidden; animation: fadeIn 0.14s ease both; }

  /* ── Sidebar ─────────────────────────────────────────────────────────────── */
  .sidebar { width: 240px; flex-shrink: 0; padding: var(--sp-5); border-right: 1px solid var(--border-dim); overflow-y: auto; display: flex; flex-direction: column; gap: var(--sp-4); background: var(--bg-base); }
  .back { display: flex; align-items: center; gap: var(--sp-2); color: var(--text-muted); font-size: var(--text-xs); font-family: var(--font-ui); letter-spacing: var(--tracking-wide); text-transform: uppercase; transition: color var(--t-base); }
  .back:hover { color: var(--text-secondary); }

  /* Zone 1: Cover */
  .cover-wrap { width: 100%; aspect-ratio: 2/3; border-radius: var(--radius-md); overflow: hidden; background: var(--bg-raised); border: 1px solid var(--border-dim); flex-shrink: 0; }
  .cover { width: 100%; height: 100%; object-fit: cover; }

  /* Zone 2: Meta */
  .meta-skeleton { display: flex; flex-direction: column; gap: var(--sp-2); }
  .sk-line { border-radius: var(--radius-sm); }
  .meta { display: flex; flex-direction: column; gap: var(--sp-3); }
  .title { font-size: var(--text-base); font-weight: var(--weight-medium); color: var(--text-primary); line-height: var(--leading-snug); letter-spacing: var(--tracking-tight); }
  .byline { font-size: var(--text-xs); color: var(--text-muted); font-family: var(--font-ui); }
  .status-badge { display: inline-block; font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wider); text-transform: uppercase; padding: 2px 7px; border-radius: var(--radius-sm); width: fit-content; }
  .status-badge.ongoing { background: var(--accent-muted); color: var(--accent-fg); border: 1px solid var(--accent-dim); }
  .status-badge.ended   { background: var(--bg-raised); color: var(--text-faint); border: 1px solid var(--border-dim); }
  .genres { display: flex; flex-wrap: wrap; gap: var(--sp-1); }
  .genre { font-size: var(--text-2xs); font-family: var(--font-ui); color: var(--text-faint); background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-sm); padding: 1px 6px; letter-spacing: var(--tracking-wide); cursor: pointer; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); }
  .genre:hover { color: var(--accent-fg); border-color: var(--accent-dim); background: var(--accent-muted); }
  .genre-toggle { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-sm); padding: 1px 6px; letter-spacing: var(--tracking-wide); cursor: pointer; transition: color var(--t-base), border-color var(--t-base); }
  .genre-toggle:hover { color: var(--accent-fg); border-color: var(--accent-dim); }
  /* Description clamped — no expand in 240px sidebar */
  .desc { font-size: var(--text-xs); color: var(--text-muted); line-height: var(--leading-base); display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }

  /* Zone 3: CTA */
  .cta-section { display: flex; flex-direction: column; gap: var(--sp-2); }
  .read-btn { display: flex; align-items: center; justify-content: center; gap: var(--sp-2); width: 100%; padding: 9px var(--sp-3); border-radius: var(--radius-md); background: var(--accent); border: 1px solid var(--accent); color: var(--accent-contrast, #fff); font-size: var(--text-xs); font-family: var(--font-ui); letter-spacing: var(--tracking-wide); cursor: pointer; transition: opacity var(--t-base); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .read-btn:hover { opacity: 0.88; }
  .actions { display: flex; align-items: center; gap: var(--sp-2); }
  .library-btn { display: flex; align-items: center; gap: var(--sp-2); font-size: var(--text-xs); font-family: var(--font-ui); letter-spacing: var(--tracking-wide); padding: 5px 10px; border-radius: var(--radius-md); border: 1px solid var(--border-strong); color: var(--text-muted); background: var(--bg-raised); transition: border-color var(--t-base), color var(--t-base), background var(--t-base); flex: 1; }
  .library-btn:hover { border-color: var(--accent); color: var(--accent-fg); }
  .library-btn.active { background: var(--accent-muted); border-color: var(--accent-dim); color: var(--accent-fg); }
  .library-btn:disabled { opacity: 0.4; cursor: default; }
  .external-link { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--radius-md); border: 1px solid var(--border-dim); color: var(--text-faint); flex-shrink: 0; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); }
  .external-link:hover { color: var(--text-muted); border-color: var(--border-strong); }

  /* Zone 4: Progress */
  .progress-section { display: flex; flex-direction: column; gap: var(--sp-1); }
  .progress-header { display: flex; justify-content: space-between; align-items: center; }
  .progress-label { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .progress-pct { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--accent-fg); letter-spacing: var(--tracking-wide); }
  .progress-track { height: 3px; background: var(--border-base); border-radius: var(--radius-full); overflow: hidden; }
  .progress-fill { height: 100%; background: var(--accent); border-radius: var(--radius-full); transition: width 0.4s ease; }

  /* Zone 5: Details accordion */
  .details-section { display: flex; flex-direction: column; gap: 2px; }
  .details-toggle { display: flex; align-items: center; justify-content: space-between; font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); padding: 4px 0; transition: color var(--t-base); }
  .details-toggle:hover { color: var(--text-muted); }
  .details-body { display: flex; flex-direction: column; gap: var(--sp-2); padding-top: var(--sp-2); }
  .detail-row { display: flex; justify-content: space-between; align-items: baseline; gap: var(--sp-2); }
  .detail-key { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .detail-val { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-secondary); letter-spacing: var(--tracking-wide); text-align: right; }
  .detail-actions { display: flex; flex-direction: column; gap: var(--sp-1); padding-top: var(--sp-1); }
  .detail-action-btn { display: flex; align-items: center; gap: var(--sp-2); width: 100%; padding: 6px var(--sp-2); border-radius: var(--radius-md); font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); color: var(--text-faint); background: none; border: 1px solid var(--border-dim); cursor: pointer; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); }
  .detail-action-btn:hover { color: var(--text-muted); border-color: var(--border-strong); background: var(--bg-raised); }
  .detail-action-active { color: var(--accent-fg); border-color: var(--accent-dim); background: var(--accent-muted); }
  .detail-action-active:hover { color: var(--accent-fg); border-color: var(--accent); }
  .detail-action-danger { color: var(--color-error); }
  .detail-action-danger:hover:not(:disabled) { background: var(--color-error-bg); border-color: var(--color-error); color: var(--color-error); }
  .detail-action-danger:disabled { opacity: 0.4; cursor: default; }

  /* ── Series link modal ───────────────────────────────────────────────────── */
  .link-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.72); z-index: var(--z-settings); display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); animation: fadeIn 0.12s ease both; }
  .link-modal { width: min(460px, calc(100vw - 48px)); max-height: 70vh; display: flex; flex-direction: column; background: var(--bg-surface); border: 1px solid var(--border-base); border-radius: var(--radius-xl); overflow: hidden; box-shadow: 0 24px 64px rgba(0,0,0,0.6); animation: scaleIn 0.14s ease both; }
  .link-header { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-4) var(--sp-5); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; }
  .link-title { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-secondary); }
  .link-close { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--radius-sm); color: var(--text-faint); background: none; border: none; cursor: pointer; transition: color var(--t-base), background var(--t-base); }
  .link-close:hover { color: var(--text-muted); background: var(--bg-raised); }
  .link-hint { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); line-height: var(--leading-snug); padding: var(--sp-3) var(--sp-5) 0; flex-shrink: 0; }
  .link-search-wrap { padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; }
  .link-search { width: 100%; background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-md); padding: 6px 10px; color: var(--text-primary); font-size: var(--text-sm); outline: none; transition: border-color var(--t-base); }
  .link-search:focus { border-color: var(--border-strong); }
  .link-list { flex: 1; overflow-y: auto; padding: var(--sp-2); scrollbar-width: none; }
  .link-list::-webkit-scrollbar { display: none; }
  .link-empty { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); padding: var(--sp-4) var(--sp-3); text-align: center; letter-spacing: var(--tracking-wide); }
  .link-row { display: flex; align-items: center; gap: var(--sp-3); width: 100%; padding: 8px var(--sp-3); border-radius: var(--radius-md); border: none; background: none; text-align: left; cursor: pointer; transition: background var(--t-fast); }
  .link-row:hover { background: var(--bg-raised); }
  .link-row-linked { background: var(--accent-muted) !important; }
  .link-thumb { width: 34px; height: 48px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0; border: 1px solid var(--border-dim); }
  .link-info { flex: 1; display: flex; flex-direction: column; gap: 2px; overflow: hidden; min-width: 0; }
  .link-manga-title { font-size: var(--text-sm); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .link-source { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .link-status { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); color: var(--text-faint); flex-shrink: 0; padding: 2px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); }
  .link-row-linked .link-status { color: var(--accent-fg); border-color: var(--accent-dim); background: var(--accent-muted); }

  /* ── Chapter list ────────────────────────────────────────────────────────── */
  .list-wrap { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .list-header { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; gap: var(--sp-2); flex-wrap: wrap; }
  .list-header-left, .list-header-right { display: flex; align-items: center; gap: var(--sp-1); }
  .sort-btn { display: flex; align-items: center; gap: 5px; font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 4px var(--sp-2); border-radius: var(--radius-sm); color: var(--text-muted); transition: color var(--t-base), background var(--t-base); }
  .sort-btn:hover { color: var(--text-secondary); background: var(--bg-raised); }
  .sort-wrap { position: relative; }
  .sort-menu { position: absolute; top: calc(100% + 4px); left: 0; min-width: 160px; background: var(--bg-raised); border: 1px solid var(--border-base); border-radius: var(--radius-md); padding: var(--sp-1); z-index: 200; box-shadow: 0 8px 24px rgba(0,0,0,0.5); animation: scaleIn 0.1s ease both; transform-origin: top left; }
  .sort-option { display: block; width: 100%; padding: 6px var(--sp-3); border-radius: var(--radius-sm); font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-secondary); background: none; border: none; cursor: pointer; text-align: left; transition: background var(--t-fast), color var(--t-fast); }
  .sort-option:hover { background: var(--bg-overlay); color: var(--text-primary); }
  .sort-option.active { color: var(--accent-fg); }
  .sort-divider { height: 1px; background: var(--border-dim); margin: var(--sp-1) var(--sp-2); }
  .icon-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--radius-md); border: 1px solid var(--border-dim); color: var(--text-muted); background: none; cursor: pointer; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); }
  .icon-btn:hover:not(:disabled) { color: var(--text-secondary); border-color: var(--border-strong); background: var(--bg-raised); }
  .icon-btn.active { color: var(--accent-fg); border-color: var(--accent-dim); background: var(--accent-muted); }
  .icon-btn:disabled { opacity: 0.3; cursor: default; }

  /* ── Folder picker ───────────────────────────────────────────────────────── */
  .fp-wrap { position: relative; }
  .fp-menu { position: absolute; top: calc(100% + 4px); right: 0; min-width: 180px; background: var(--bg-raised); border: 1px solid var(--border-base); border-radius: var(--radius-md); padding: var(--sp-1); z-index: 200; box-shadow: 0 8px 24px rgba(0,0,0,0.5); animation: scaleIn 0.1s ease both; transform-origin: top right; }
  .fp-empty { padding: var(--sp-2) var(--sp-3); font-size: var(--text-xs); color: var(--text-faint); }
  .fp-item { display: flex; align-items: center; gap: var(--sp-2); width: 100%; padding: 6px var(--sp-3); border-radius: var(--radius-sm); font-size: var(--text-xs); color: var(--text-secondary); background: none; border: none; cursor: pointer; text-align: left; transition: background var(--t-fast), color var(--t-fast); }
  .fp-item:hover { background: var(--bg-overlay); }
  .fp-item.fp-item-active { color: var(--accent-fg); }
  .fp-check { width: 12px; font-size: var(--text-xs); color: var(--accent-fg); flex-shrink: 0; }
  .fp-div { height: 1px; background: var(--border-dim); margin: var(--sp-1) var(--sp-2); }
  .fp-create { display: flex; align-items: center; gap: var(--sp-1); padding: 4px var(--sp-2); }
  .fp-input { flex: 1; background: var(--bg-overlay); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: 4px 8px; font-size: var(--text-xs); color: var(--text-secondary); outline: none; min-width: 0; }
  .fp-input:focus { border-color: var(--border-focus); }
  .fp-confirm { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid var(--accent-dim); background: var(--accent-muted); color: var(--accent-fg); cursor: pointer; }
  .fp-confirm:disabled { opacity: 0.4; cursor: default; }
  .fp-cancel { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: var(--radius-sm); border: 1px solid transparent; background: none; color: var(--text-faint); cursor: pointer; transition: color var(--t-base), border-color var(--t-base); }
  .fp-cancel:hover { color: var(--text-muted); border-color: var(--border-dim); }
  .fp-new { width: 100%; padding: 6px var(--sp-3); border-radius: var(--radius-sm); font-size: var(--text-xs); color: var(--text-faint); background: none; border: none; cursor: pointer; text-align: left; transition: color var(--t-fast), background var(--t-fast); }
  .fp-new:hover { color: var(--text-secondary); background: var(--bg-overlay); }

  /* ── Download dropdown ───────────────────────────────────────────────────── */
  .dl-wrap { position: relative; }
  .dl-dropdown { position: absolute; top: calc(100% + 4px); right: 0; min-width: 220px; background: var(--bg-raised); border: 1px solid var(--border-base); border-radius: var(--radius-lg); padding: var(--sp-1); z-index: 200; box-shadow: 0 8px 32px rgba(0,0,0,0.5); animation: scaleIn 0.1s ease both; transform-origin: top right; }
  .dl-section-label { padding: 6px var(--sp-3) 4px; font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; }
  .dl-next-row { display: flex; gap: 4px; padding: 2px var(--sp-2) var(--sp-2); }
  .dl-next-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px; padding: 5px 6px; border-radius: var(--radius-md); border: 1px solid var(--border-dim); background: var(--bg-overlay); color: var(--text-secondary); font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); cursor: pointer; transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast); }
  .dl-next-btn:hover:not(:disabled) { background: var(--accent-muted); border-color: var(--accent-dim); color: var(--accent-fg); }
  .dl-next-btn:disabled { opacity: 0.3; cursor: default; }
  .dl-next-sub { font-size: var(--text-2xs); color: var(--text-faint); }
  .dl-divider { height: 1px; background: var(--border-dim); margin: var(--sp-1) var(--sp-2); }
  .dl-item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; padding: 7px var(--sp-3); border-radius: var(--radius-md); font-size: var(--text-sm); color: var(--text-secondary); background: none; border: none; cursor: pointer; text-align: left; transition: background var(--t-fast), color var(--t-fast); }
  .dl-item:hover:not(:disabled) { background: var(--bg-overlay); color: var(--text-primary); }
  .dl-item:disabled { opacity: 0.3; cursor: default; }
  .dl-item.dl-item-danger { color: var(--color-error); }
  .dl-item.dl-item-danger:hover:not(:disabled) { background: var(--color-error-bg); }
  .dl-item-sub { font-size: var(--text-xs); color: var(--text-faint); }
  .dl-range-row { display: flex; align-items: center; gap: 4px; padding: 7px var(--sp-2); }
  .dl-range-back { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: none; color: var(--text-faint); font-size: 14px; cursor: pointer; }
  .dl-range-back:hover { color: var(--text-muted); background: var(--bg-overlay); }
  .dl-range-input { flex: 1; min-width: 0; padding: 4px 8px; background: var(--bg-overlay); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--text-secondary); font-family: var(--font-ui); font-size: var(--text-xs); outline: none; text-align: center; }
  .dl-range-input:focus { border-color: var(--border-focus); }
  .dl-range-sep { color: var(--text-faint); font-size: var(--text-xs); }
  .dl-range-go { padding: 4px 10px; border-radius: var(--radius-sm); border: 1px solid var(--accent-dim); background: var(--accent-muted); color: var(--accent-fg); font-family: var(--font-ui); font-size: var(--text-xs); cursor: pointer; }
  .dl-range-go:disabled { opacity: 0.3; cursor: default; }

  /* ── Pagination ──────────────────────────────────────────────────────────── */
  .pagination, .pagination-bottom { display: flex; align-items: center; gap: var(--sp-2); }
  .pagination-bottom { justify-content: center; padding: var(--sp-3); border-top: 1px solid var(--border-dim); flex-shrink: 0; }
  .page-btn { font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 4px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); color: var(--text-faint); background: none; cursor: pointer; transition: color var(--t-base), border-color var(--t-base); }
  .page-btn:hover:not(:disabled) { color: var(--text-muted); border-color: var(--border-strong); }
  .page-btn:disabled { opacity: 0.3; cursor: default; }
  .page-num { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }

  /* ── Chapter rows ────────────────────────────────────────────────────────── */
  .ch-list { flex: 1; overflow-y: auto; }
  .ch-grid { flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(42px, 1fr)); gap: 4px; padding: var(--sp-3); align-content: start; }
  .ch-row { display: flex; align-items: center; padding: 10px var(--sp-4); border-bottom: 1px solid var(--border-dim); cursor: pointer; transition: background var(--t-fast); gap: var(--sp-3); }
  .ch-row:hover { background: var(--bg-raised); }
  .ch-row.read { opacity: 0.45; }
  .ch-left { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .ch-name { font-size: var(--text-sm); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ch-meta { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
  .ch-meta-item { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .ch-right { display: flex; align-items: center; gap: var(--sp-1); flex-shrink: 0; }
  :global(.read-icon) { color: var(--text-faint); }
  :global(.enqueue-icon) { color: var(--text-faint); }
  .dl-btn { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: var(--radius-sm); color: var(--text-faint); transition: color var(--t-base), background var(--t-base); opacity: 0; }
  .ch-row:hover .dl-btn { opacity: 1; }
  .dl-btn:hover { color: var(--text-muted); background: var(--bg-overlay); }
  .row-skeleton { display: flex; flex-direction: column; gap: var(--sp-2); padding: 12px var(--sp-4); border-bottom: 1px solid var(--border-dim); }
  .grid-cell { display: flex; align-items: center; justify-content: center; aspect-ratio: 1; border-radius: var(--radius-sm); background: var(--bg-raised); border: 1px solid var(--border-dim); font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-muted); cursor: pointer; position: relative; transition: background var(--t-fast), border-color var(--t-fast); }
  .grid-cell:hover { background: var(--bg-overlay); border-color: var(--border-strong); }
  .grid-cell.read { background: var(--color-read); color: var(--text-faint); border-color: transparent; }
  .grid-cell.in-progress { border-color: var(--accent-dim); color: var(--accent-fg); }
  .grid-cell-num { font-size: 10px; }
  .grid-cell-dot { position: absolute; bottom: 3px; right: 3px; width: 4px; height: 4px; border-radius: 50%; background: var(--text-faint); }
  .grid-cell-spinner { position: absolute; top: 2px; right: 2px; }
  .grid-cell-skeleton { aspect-ratio: 1; border-radius: var(--radius-sm); }

  @keyframes fadeIn  { from { opacity: 0 } to { opacity: 1 } }
  @keyframes scaleIn { from { opacity: 0; transform: scale(0.97) } to { opacity: 1; transform: scale(1) } }
</style>

<script module>
  function focusOnMount(node: HTMLElement) { node.focus(); }
</script>
