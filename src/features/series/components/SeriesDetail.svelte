<script lang="ts">
  import { onMount, untrack }  from "svelte";
  import { gql }               from "@api/client";
  import Thumbnail       from "@shared/manga/Thumbnail.svelte";
  import {
    X, CheckCircle, Circle, ArrowFatLinesUp, ArrowFatLinesDown,
    ArrowFatLineUp, ArrowFatLineDown, Download, Trash, DownloadSimple,
  } from "phosphor-svelte";
  import { GET_MANGA, GET_ALL_MANGA, GET_CATEGORIES } from "@api/queries/manga";
  import { GET_CHAPTERS } from "@api/queries/chapters";
  import { UPDATE_MANGA, CREATE_CATEGORY, UPDATE_MANGA_CATEGORIES } from "@api/mutations/manga";
  import { FETCH_CHAPTERS, MARK_CHAPTER_READ, MARK_CHAPTERS_READ, DELETE_DOWNLOADED_CHAPTERS } from "@api/mutations/chapters";
  import { ENQUEUE_DOWNLOAD, ENQUEUE_CHAPTERS_DOWNLOAD } from "@api/mutations/downloads";
  import { cache, CACHE_KEYS, recordSourceAccess } from "@core/cache";
  import {
    store, addToast, openReader, setActiveManga, linkManga, unlinkManga,
    addBookmark, acknowledgeUpdate,
    checkAndMarkCompleted as storeCheckAndMarkCompleted,
    clearMarkersForManga,
  } from "@store/state.svelte";
  import { trackingState } from "@features/tracking/store/trackingState.svelte";
  import type { MangaPrefs } from "@store/state.svelte";
  import { DEFAULT_MANGA_PREFS } from "@store/state.svelte";
  import type { Manga, Chapter, Category } from "@types";
  import ContextMenu      from "@shared/ui/ContextMenu.svelte";
  import type { MenuEntry } from "@shared/ui/ContextMenu.svelte";
  import MigrateModal    from "../panels/MigrateModal.svelte";
  import TrackingPanel   from "../panels/TrackingPanel.svelte";
  import AutomationPanel from "../panels/AutomationPanel.svelte";
  import MarkersPanel    from "../panels/MarkersPanel.svelte";
  import SeriesHeader    from "./SeriesHeader.svelte";
  import SeriesActions   from "./SeriesActions.svelte";
  import ChapterList     from "./ChapterList.svelte";
  import { buildChapterList, chaptersAscending } from "../lib/chapterList";
  import { getPref, setPref } from "../lib/mangaPrefs";

  const CHAPTERS_PER_PAGE = 25;
  const MANGA_TTL_MS      = 5 * 60 * 1000;
  const CHAPTER_TTL_MS    = 2 * 60 * 1000;

  const mangaStore:   Map<number, { data: Manga;     fetchedAt: number }> = new Map();
  const chapterStore: Map<number, { data: Chapter[]; fetchedAt: number }> = new Map();

  let manga:           Manga | null = $state(null);
  let chapters:        Chapter[]    = $state([]);
  let loadingManga:    boolean      = $state(false);
  let loadingChapters: boolean      = $state(true);
  let enqueueing:      Set<number>  = $state(new Set());
  let togglingLibrary: boolean      = $state(false);
  let chapterPage:     number       = $state(1);
  let viewMode: "list" | "grid"     = $state("list");
  let deletingAll:     boolean      = $state(false);
  let refreshing:      boolean      = $state(false);
  let selectedIds:     Set<number>  = $state(new Set());
  let migrateOpen:     boolean      = $state(false);
  let autoOpen:        boolean      = $state(false);
  let trackingOpen:    boolean      = $state(false);
  let markersOpen:     boolean      = $state(false);
  let linkPickerOpen:  boolean      = $state(false);
  let linkSearch:      string       = $state("");
  let allMangaForLink: Manga[]      = $state([]);
  let loadingLinkList: boolean      = $state(false);
  let mangaCategories: Category[]   = $state([]);
  let allCategories:   Category[]   = $state([]);
  let catsLoading:     boolean      = $state(false);
  let mangaAbort:      AbortController | null = null;
  let chapterAbort:    AbortController | null = null;
  let loadingFor:      number | null = null;
  let _prevChapterIds: Set<number>  = new Set();

  const get = <K extends keyof MangaPrefs>(key: K) =>
    store.activeManga ? getPref(store.activeManga.id, key) : DEFAULT_MANGA_PREFS[key];
  const set = <K extends keyof MangaPrefs>(key: K, value: MangaPrefs[K]) => {
    if (store.activeManga) setPref(store.activeManga.id, key, value);
  };

  const hasSelection       = $derived(selectedIds.size > 0);
  const sortDir            = $derived(store.settings.chapterSortDir);
  const sortMode           = $derived(store.settings.chapterSortMode ?? "source");
  const scanlatorFilter    = $derived((get("scanlatorFilter")    ?? []) as string[]);
  const scanlatorBlacklist = $derived((get("scanlatorBlacklist") ?? []) as string[]);
  const scanlatorForce     = $derived((get("scanlatorForce")     ?? false) as boolean);

  const availableScanlators = $derived(
    [...new Set(chapters.map(c => c.scanlator).filter((s): s is string => !!s?.trim()))]
      .sort((a, b) => a.localeCompare(b))
  );

  const sortedChapters = $derived(buildChapterList(chapters, {
    sortMode, sortDir,
    preferredScanlator:  get("preferredScanlator") as string,
    scanlatorFilter:     scanlatorFilter as string[],
    scanlatorBlacklist:  scanlatorBlacklist as string[],
    scanlatorForce:      scanlatorForce as boolean,
  }));

  const totalPages      = $derived(Math.ceil(sortedChapters.length / CHAPTERS_PER_PAGE));
  const pageChapters    = $derived(sortedChapters.slice((chapterPage - 1) * CHAPTERS_PER_PAGE, chapterPage * CHAPTERS_PER_PAGE));
  const readCount       = $derived(chapters.filter(c => c.isRead).length);
  const totalCount      = $derived(chapters.length);
  const progressPct     = $derived(totalCount > 0 ? (readCount / totalCount) * 100 : 0);
  const downloadedCount = $derived(chapters.filter(c => c.isDownloaded).length);

  const continueChapter = $derived((() => {
    if (!sortedChapters.length) return null;
    const asc      = [...sortedChapters].sort((a, b) => a.sourceOrder - b.sourceOrder);
    const anyRead  = asc.some(c => c.isRead);
    const bookmark = store.activeManga
      ? store.bookmarks.find(b => b.mangaId === store.activeManga!.id)
      : null;
    const bookmarkedCh = bookmark ? asc.find(c => c.id === bookmark.chapterId) : null;
    if (bookmarkedCh && !bookmarkedCh.isRead) {
      return { chapter: bookmarkedCh, type: (anyRead ? "continue" : "start") as const, resumePage: bookmark!.pageNumber };
    }
    const inProgress  = asc.find(c => !c.isRead && (c.lastPageRead ?? 0) > 0);
    const firstUnread = asc.find(c => !c.isRead);
    const target      = inProgress ?? firstUnread;
    if (target) {
      return { chapter: target, type: (anyRead ? "continue" : "start") as const, resumePage: null };
    }
    return { chapter: asc[0], type: "reread" as const, resumePage: null };
  })());

  const hasAnyAutomation = $derived(
    get("autoDownload")        ||
    (get("downloadAhead") as number) > 0   ||
    (get("maxKeepChapters") as number) > 0 ||
    get("deleteOnRead")        ||
    get("pauseUpdates")        ||
    get("refreshInterval") !== "global" ||
    !!(get("preferredScanlator") as string)
  );

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

  function focusOnMount(node: HTMLElement) { node.focus(); }

  function clearSelection() { selectedIds = new Set(); }

  function toggleSelect(id: number, e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    selectedIds = next;
  }

  function applyChapters(nodes: Chapter[]) {
    if (get("autoDownload") && _prevChapterIds.size > 0) {
      const filtered = buildChapterList(nodes, {
        sortMode, sortDir,
        preferredScanlator:  get("preferredScanlator") as string,
        scanlatorFilter:     scanlatorFilter as string[],
        scanlatorBlacklist:  scanlatorBlacklist as string[],
        scanlatorForce:      scanlatorForce as boolean,
      });
      const newChapters = filtered.filter(c => !_prevChapterIds.has(c.id) && !c.isDownloaded);
      if (newChapters.length) enqueueMultiple(newChapters.map(c => c.id));
    }
    _prevChapterIds = new Set(nodes.map(c => c.id));
    chapters = nodes;
    if (store.activeManga && nodes.length > 0) checkAndMarkCompleted(store.activeManga.id, nodes);
  }

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
    const mangaStatus = manga?.status;
    await storeCheckAndMarkCompleted(mangaId, chaps, allCategories, gql, UPDATE_MANGA_CATEGORIES, UPDATE_MANGA, mangaStatus);
    if (chaps.length && mangaStatus !== "ONGOING") {
      const allRead   = chaps.every(c => c.isRead);
      const completed = allCategories.find(c => c.name === "Completed");
      if (completed) {
        const inCompleted = mangaCategories.some(c => c.id === completed.id);
        if (allRead && !inCompleted)      mangaCategories = [...mangaCategories, completed];
        else if (!allRead && inCompleted) mangaCategories = mangaCategories.filter(c => c.id !== completed.id);
      }
    }
  }

  function loadManga(id: number) {
    mangaAbort?.abort();
    const ctrl = new AbortController();
    mangaAbort = ctrl; loadingFor = id;
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
    if (m) untrack(() => { acknowledgeUpdate(m.id); loadManga(m.id); loadChapters(m.id); loadCategories(m.id); trackingState.loadForManga(m.id); });
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
    if (isRead) {
      const ch = chapters.find(c => c.id === chapterId);
      if (ch) trackingState.updateFromRead(ch, chapters, { sortMode, sortDir, preferredScanlator: get("preferredScanlator") as string, scanlatorFilter: scanlatorFilter as string[], scanlatorBlacklist: scanlatorBlacklist as string[], scanlatorForce: scanlatorForce as boolean });
      if (get("deleteOnRead")) {
        const ch = chapters.find(c => c.id === chapterId);
        if (ch?.isDownloaded) {
          const delayMs = (get("deleteDelayHours") as number) * 60 * 60 * 1000;
          if (delayMs === 0) deleteDownloaded(chapterId);
          else setTimeout(() => deleteDownloaded(chapterId), delayMs);
        }
      }
      const ahead = get("downloadAhead") as number;
      if (ahead > 0) {
        const idx = sortedChapters.findIndex(c => c.id === chapterId);
        if (idx >= 0) {
          const toQueue = sortedChapters.slice(idx + 1, idx + 1 + ahead).filter(c => !c.isDownloaded).map(c => c.id);
          if (toQueue.length) enqueueMultiple(toQueue);
        }
      }
    }
  }

  async function markBulk(ids: number[], isRead: boolean) {
    if (!ids.length) return;
    await gql(MARK_CHAPTERS_READ, { ids, isRead }).catch(console.error);
    const idSet = new Set(ids);
    chapters = chapters.map(c => idSet.has(c.id) ? { ...c, isRead } : c);
    if (store.activeManga) { chapterStore.set(store.activeManga.id, { data: chapters, fetchedAt: Date.now() }); checkAndMarkCompleted(store.activeManga.id, chapters); }
    if (isRead) {
      const ascending   = [...chapters].sort((a, b) => a.sourceOrder - b.sourceOrder);
      const lastInBatch = ascending.filter(c => idSet.has(c.id)).at(-1);
      if (lastInBatch) trackingState.updateFromRead(lastInBatch, chapters, { sortMode, sortDir, preferredScanlator: get("preferredScanlator") as string, scanlatorFilter: scanlatorFilter as string[], scanlatorBlacklist: scanlatorBlacklist as string[], scanlatorForce: scanlatorForce as boolean });
      if (get("deleteOnRead")) {
        const toDelete = ids.filter(id => chapters.find(c => c.id === id)?.isDownloaded);
        if (toDelete.length) {
          const delayMs = (get("deleteDelayHours") as number) * 60 * 60 * 1000;
          const doDelete = async () => {
            await gql(DELETE_DOWNLOADED_CHAPTERS, { ids: toDelete }).catch(console.error);
            chapters = chapters.map(c => toDelete.includes(c.id) ? { ...c, isDownloaded: false } : c);
            if (store.activeManga) chapterStore.set(store.activeManga.id, { data: chapters, fetchedAt: Date.now() });
          };
          if (delayMs === 0) doDelete();
          else setTimeout(doDelete, delayMs);
        }
      }
    }
  }

  async function deleteSelected() {
    const ids = [...selectedIds].filter(id => chapters.find(c => c.id === id)?.isDownloaded);
    if (ids.length) {
      await gql(DELETE_DOWNLOADED_CHAPTERS, { ids }).catch(console.error);
      chapters = chapters.map(c => ids.includes(c.id) ? { ...c, isDownloaded: false } : c);
      if (store.activeManga) chapterStore.set(store.activeManga.id, { data: chapters, fetchedAt: Date.now() });
    }
    clearSelection();
  }

  async function downloadSelected() { await enqueueMultiple([...selectedIds].filter(id => !chapters.find(c => c.id === id)?.isDownloaded)); clearSelection(); }
  async function markSelectedRead(isRead: boolean) { await markBulk([...selectedIds], isRead); clearSelection(); }

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
      .then(() => addToast({ kind: "success", title: "Chapters refreshed", body: `${chapters.length} chapter${chapters.length !== 1 ? "s" : ""} available` }))
      .catch(e => addToast({ kind: "error", title: "Refresh failed", body: e?.message }))
      .finally(() => refreshing = false);
  }

  function buildCtxItems(ch: Chapter, idx: number): MenuEntry[] {
    const above = sortedChapters.slice(0, idx + 1), below = sortedChapters.slice(idx), last = sortedChapters.length - 1;
    return [
      { label: ch.isRead ? "Mark as unread" : "Mark as read", icon: ch.isRead ? Circle : CheckCircle, onClick: () => markRead(ch.id, !ch.isRead) },
      { separator: true },
      { label: "Mark above as read",   icon: ArrowFatLinesUp,   onClick: () => markAboveRead(idx),   disabled: above.filter(c => !c.isRead).length === 0 },
      { label: "Mark above as unread", icon: ArrowFatLineUp,    onClick: () => markAboveUnread(idx), disabled: above.filter(c => c.isRead).length === 0 },
      { separator: true },
      { label: "Mark below as read",   icon: ArrowFatLinesDown, onClick: () => markBelowRead(idx),   disabled: idx === last || below.filter(c => !c.isRead).length === 0 },
      { label: "Mark below as unread", icon: ArrowFatLineDown,  onClick: () => markBelowUnread(idx), disabled: idx === last || below.filter(c => c.isRead).length === 0 },
      { separator: true },
      { label: ch.isDownloaded ? "Delete download" : "Download", icon: ch.isDownloaded ? Trash : Download, danger: ch.isDownloaded, onClick: () => ch.isDownloaded ? deleteDownloaded(ch.id) : gql(ENQUEUE_DOWNLOAD, { chapterId: ch.id }).catch(console.error) },
      { separator: true },
      { label: "Download next 5 from here", icon: DownloadSimple, onClick: () => enqueueMultiple(sortedChapters.slice(idx, idx + 5).filter(c => !c.isDownloaded).map(c => c.id)) },
      { label: "Download all from here",    icon: DownloadSimple, onClick: () => enqueueMultiple(sortedChapters.slice(idx).filter(c => !c.isDownloaded).map(c => c.id)) },
    ];
  }

  function enqueueNext(n: number) {
    if (!continueChapter) return;
    const idx = sortedChapters.indexOf(continueChapter.chapter);
    if (idx < 0) return;
    enqueueMultiple(sortedChapters.slice(idx, idx + n).filter(c => !c.isDownloaded).map(c => c.id));
  }

  function openReaderWithAhead(ch: Chapter, inProgress: boolean) {
    const ascList = [...sortedChapters].sort((a, b) => a.sourceOrder - b.sourceOrder);
    const type    = inProgress ? "continue" : undefined;
    const resumePage = inProgress ? ch.lastPageRead ?? null : null;
    const ahead = get("downloadAhead") as number;
    if (ahead > 0) {
      const idx = ascList.indexOf(ch);
      if (idx >= 0) {
        const toQueue = ascList.slice(idx + 1, idx + 1 + ahead).filter(c => !c.isDownloaded).map(c => c.id);
        if (toQueue.length) enqueueMultiple(toQueue);
      }
    }
    if (type === "continue" && resumePage && resumePage > 1) {
      const existing = store.bookmarks.find(b => b.chapterId === ch.id);
      if (!existing || existing.pageNumber < resumePage) {
        addBookmark({
          mangaId:      store.activeManga!.id,
          mangaTitle:   store.activeManga!.title,
          thumbnailUrl: store.activeManga!.thumbnailUrl,
          chapterId:    ch.id,
          chapterName:  ch.name,
          pageNumber:   resumePage,
        });
      }
    }
    openReader(ch, ascList);
  }

  function handleContinue(cc: typeof continueChapter) {
    if (!cc) return;
    const ascList = [...sortedChapters].sort((a, b) => a.sourceOrder - b.sourceOrder);
    const ahead = get("downloadAhead") as number;
    if (ahead > 0) {
      const idx = ascList.indexOf(cc.chapter);
      if (idx >= 0) {
        const toQueue = ascList.slice(idx + 1, idx + 1 + ahead).filter(c => !c.isDownloaded).map(c => c.id);
        if (toQueue.length) enqueueMultiple(toQueue);
      }
    }
    if (cc.type === "continue" && cc.resumePage && cc.resumePage > 1) {
      const existing = store.bookmarks.find(b => b.chapterId === cc.chapter.id);
      if (!existing || existing.pageNumber < cc.resumePage) {
        addBookmark({
          mangaId:      store.activeManga!.id,
          mangaTitle:   store.activeManga!.title,
          thumbnailUrl: store.activeManga!.thumbnailUrl,
          chapterId:    cc.chapter.id,
          chapterName:  cc.chapter.name,
          pageNumber:   cc.resumePage,
        });
      }
    }
    openReader(cc.chapter, ascList);
  }

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

  async function toggleCategory(cat: Category) {
    if (!store.activeManga) return;
    const inCat = mangaCategories.some(c => c.id === cat.id);
    try {
      await gql(UPDATE_MANGA_CATEGORIES, {
        mangaId:    store.activeManga.id,
        addTo:      inCat ? [] : [cat.id],
        removeFrom: inCat ? [cat.id] : [],
      });
      if (!inCat && !manga?.inLibrary) {
        await gql(UPDATE_MANGA, { id: store.activeManga.id, inLibrary: true }).catch(console.error);
        if (manga) manga = { ...manga, inLibrary: true };
      }
      mangaCategories = inCat ? mangaCategories.filter(c => c.id !== cat.id) : [...mangaCategories, cat];
    } catch (e) { console.error(e); }
  }

  async function createCategory(name: string) {
    if (!name || !store.activeManga) return;
    try {
      const res = await gql<{ createCategory: { category: Category } }>(CREATE_CATEGORY, { name });
      const cat = res.createCategory.category;
      await gql(UPDATE_MANGA_CATEGORIES, { mangaId: store.activeManga.id, addTo: [cat.id], removeFrom: [] });
      if (!manga?.inLibrary) {
        await gql(UPDATE_MANGA, { id: store.activeManga.id, inLibrary: true }).catch(console.error);
        if (manga) manga = { ...manga, inLibrary: true };
      }
      allCategories   = [...allCategories, cat];
      mangaCategories = [...mangaCategories, cat];
    } catch (e) { console.error(e); }
  }

  onMount(() => () => { mangaAbort?.abort(); chapterAbort?.abort(); });
</script>

{#if store.activeManga}
<div class="root" role="presentation" oncontextmenu={(e) => e.preventDefault()}>

  <SeriesHeader
    {manga}
    {loadingManga}
    {totalCount}
    {readCount}
    {progressPct}
    {downloadedCount}
    {deletingAll}
    {continueChapter}
    {hasAnyAutomation}
    {markersOpen}
    {linkedIds}
    {allMangaForLink}
    {loadingLinkList}
    {mangaCategories}
    {togglingLibrary}
    onRead={handleContinue}
    onToggleLibrary={toggleLibrary}
    onDeleteAll={deleteAllDownloads}
    onMigrateOpen={() => migrateOpen = true}
    onTrackingOpen={() => trackingOpen = true}
    onAutoOpen={() => autoOpen = true}
    onMarkersToggle={() => markersOpen = !markersOpen}
    onLinkPickerOpen={openLinkPicker}
  />

  <div class="list-wrap">
    <SeriesActions
      {chapters}
      {sortedChapters}
      {sortMode}
      {sortDir}
      {viewMode}
      {chapterPage}
      {totalPages}
      {downloadedCount}
      {totalCount}
      {deletingAll}
      {hasSelection}
      selectedCount={selectedIds.size}
      {continueChapter}
      {availableScanlators}
      {scanlatorFilter}
      {scanlatorBlacklist}
      {scanlatorForce}
      {allCategories}
      {mangaCategories}
      {catsLoading}
      {refreshing}
      onViewModeToggle={() => viewMode = viewMode === "list" ? "grid" : "list"}
      onPageChange={(p) => chapterPage = p}
      onDownloadSelected={downloadSelected}
      onDeleteSelected={deleteSelected}
      onMarkSelectedRead={markSelectedRead}
      onClearSelection={clearSelection}
      onEnqueueNext={enqueueNext}
      onEnqueueMultiple={enqueueMultiple}
      onDeleteAll={deleteAllDownloads}
      onRefresh={refreshChapters}
      onToggleCategory={toggleCategory}
      onCreateCategory={createCategory}
      onSetScanlatorFilter={(v) => set("scanlatorFilter", v)}
      onSetScanlatorBlacklist={(v) => set("scanlatorBlacklist", v)}
      onSetScanlatorForce={(v) => set("scanlatorForce", v)}
    />

    <ChapterList
      {pageChapters}
      {sortedChapters}
      {viewMode}
      {loadingChapters}
      {selectedIds}
      {enqueueing}
      {chapterPage}
      {totalPages}
      onOpen={openReaderWithAhead}
      onToggleSelect={toggleSelect}
      onEnqueue={enqueue}
      onDeleteDownload={deleteDownloaded}
      onPageChange={(p) => chapterPage = p}
      {buildCtxItems}
    />
  </div>
</div>

{#if migrateOpen && manga}
  <MigrateModal
    {manga}
    currentChapters={chapters}
    onClose={() => migrateOpen = false}
    onMigrated={(newManga) => { setActiveManga(newManga); migrateOpen = false; cache.clear(CACHE_KEYS.LIBRARY); }}
  />
{/if}

{#if trackingOpen && store.activeManga}
  <TrackingPanel mangaId={store.activeManga.id} mangaTitle={store.activeManga.title} onClose={() => trackingOpen = false} />
{/if}

{#if autoOpen && store.activeManga}
  <AutomationPanel mangaId={store.activeManga.id} onClose={() => autoOpen = false} />
{/if}

{#if markersOpen && store.activeManga}
  <div class="markers-panel-overlay" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) markersOpen = false; }}>
    <div class="markers-panel-drawer">
      <MarkersPanel mangaId={store.activeManga.id} {chapters} onClose={() => markersOpen = false} />
    </div>
  </div>
{/if}

{#if linkPickerOpen}
  <div class="link-backdrop" role="presentation"
    onclick={(e) => { if (e.target === e.currentTarget) closeLinkPicker(); }}
    onkeydown={(e) => e.key === "Escape" && closeLinkPicker()}>
    <div class="link-modal">
      <div class="link-header">
        <span class="link-title">Link as same series</span>
        <button class="link-close" onclick={closeLinkPicker}><X size={14} weight="light" /></button>
      </div>
      <p class="link-hint">Mark two manga as the same series so duplicates are merged in search. Click a linked entry again to unlink.</p>
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
              <Thumbnail src={m.thumbnailUrl} alt={m.title} class="link-thumb" />
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
  .root {
    display: flex;
    height: 100%;
    overflow: hidden;
    animation: fadeIn 0.14s ease both;
  }

  .list-wrap { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

  .link-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.72);
    z-index: var(--z-settings);
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    animation: fadeIn 0.12s ease both;
  }
  .link-modal {
    width: min(460px, calc(100vw - 48px));
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border: 1px solid var(--border-base);
    border-radius: var(--radius-xl);
    overflow: hidden;
    box-shadow: 0 24px 64px rgba(0,0,0,0.6);
    animation: scaleIn 0.14s ease both;
  }
  .link-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-4) var(--sp-5);
    border-bottom: 1px solid var(--border-dim);
    flex-shrink: 0;
  }
  .link-title { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-secondary); }
  .link-close {
    display: flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border-radius: var(--radius-sm);
    color: var(--text-faint); background: none; border: none; cursor: pointer;
    transition: color var(--t-base), background var(--t-base);
  }
  .link-close:hover { color: var(--text-muted); background: var(--bg-raised); }
  .link-hint {
    font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint);
    letter-spacing: var(--tracking-wide); line-height: var(--leading-snug);
    padding: var(--sp-3) var(--sp-5) 0; flex-shrink: 0;
  }
  .link-search-wrap { padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; }
  .link-search {
    width: 100%; background: var(--bg-raised); border: 1px solid var(--border-dim);
    border-radius: var(--radius-md); padding: 6px 10px; color: var(--text-primary);
    font-size: var(--text-sm); outline: none; transition: border-color var(--t-base);
  }
  .link-search:focus { border-color: var(--border-strong); }
  .link-list { flex: 1; overflow-y: auto; padding: var(--sp-2); scrollbar-width: none; }
  .link-list::-webkit-scrollbar { display: none; }
  .link-empty {
    font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint);
    padding: var(--sp-4) var(--sp-3); text-align: center; letter-spacing: var(--tracking-wide);
  }
  .link-row {
    display: flex; align-items: center; gap: var(--sp-3); width: 100%;
    padding: 8px var(--sp-3); border-radius: var(--radius-md); border: none;
    background: none; text-align: left; cursor: pointer; transition: background var(--t-fast);
  }
  .link-row:hover { background: var(--bg-raised); }
  .link-row-linked { background: var(--accent-muted) !important; }
  :global(.link-thumb) { width: 34px; height: 48px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0; border: 1px solid var(--border-dim); }
  .link-info { flex: 1; display: flex; flex-direction: column; gap: 2px; overflow: hidden; min-width: 0; }
  .link-manga-title { font-size: var(--text-sm); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .link-source { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .link-status {
    font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide);
    color: var(--text-faint); flex-shrink: 0; padding: 2px 8px;
    border-radius: var(--radius-sm); border: 1px solid var(--border-dim);
  }
  .link-row-linked .link-status { color: var(--accent-fg); border-color: var(--accent-dim); background: var(--accent-muted); }

  .markers-panel-overlay {
    position: fixed; inset: 0; z-index: var(--z-settings);
    display: flex; align-items: stretch; justify-content: flex-start;
    animation: fadeIn 0.12s ease both;
  }
  .markers-panel-drawer {
    width: 280px; max-width: 90vw;
    background: var(--bg-surface); border-right: 1px solid var(--border-base);
    box-shadow: 4px 0 24px rgba(0,0,0,0.4);
    display: flex; flex-direction: column;
    animation: drawerIn 0.18s cubic-bezier(0.16,1,0.3,1) both;
  }

  @keyframes fadeIn   { from { opacity: 0 }                         to { opacity: 1 } }
  @keyframes scaleIn  { from { opacity: 0; transform: scale(0.97) } to { opacity: 1; transform: scale(1) } }
  @keyframes drawerIn { from { opacity: 0; transform: translateX(-12px) } to { opacity: 1; transform: translateX(0) } }
</style>