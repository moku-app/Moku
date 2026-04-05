<script lang="ts">
  import { onMount, untrack, tick } from "svelte";
  import {
    X, CaretLeft, CaretRight, ArrowLeft, ArrowRight,
    Square, Rows, Download, ArrowsLeftRight, ArrowsIn, ArrowsOut, ArrowsVertical,
    CircleNotch, MagnifyingGlassMinus, MagnifyingGlassPlus,
    Bookmark, BookOpen, MonitorPlay, MapPin, Check,
  } from "phosphor-svelte";
  import { gql, thumbUrl, plainThumbUrl } from "../../lib/client";
  import { getBlobUrl, preloadBlobUrls } from "../../lib/imageCache";
  import { store as appStore } from "../../store/state.svelte";
  import { FETCH_CHAPTER_PAGES, MARK_CHAPTER_READ, ENQUEUE_DOWNLOAD, ENQUEUE_CHAPTERS_DOWNLOAD } from "../../lib/queries";
  import { store, closeReader, openReader, addHistory, updateSettings, checkAndMarkCompleted, setSettingsOpen, addBookmark, removeBookmark, addMarker, removeMarker, updateMarker } from "../../store/state.svelte";
  import { matchesKeybind, toggleFullscreen, DEFAULT_KEYBINDS } from "../../lib/keybinds";
  import { setReading } from "../../lib/discord";
  import type { FitMode, MarkerColor } from "../../store/state.svelte";

  const AVG_MIN_PER_PAGE = 0.33;
  const READ_LINE_PCT    = 0.20;
  const ZOOM_STEP        = 0.05;
  const ZOOM_MIN         = 0.1;
  const ZOOM_MAX         = 1.0;

  const PAGE_STYLES = ["single", "fade", "double", "longstrip"] as const;
  type PageStyle = typeof PAGE_STYLES[number];

  const MARKER_COLORS: MarkerColor[] = ["yellow", "red", "blue", "green", "purple"];
  const MARKER_COLOR_HEX: Record<MarkerColor, string> = {
    yellow: "#c4a94a",
    red:    "#c47a7a",
    blue:   "#7a9ec4",
    green:  "#7aab7a",
    purple: "#a07ac4",
  };

  const pageCache = new Map<number, string[]>();
  const inflight  = new Map<number, Promise<string[]>>();

  const isAuth = () => (appStore.settings.serverAuthMode ?? "NONE") === "BASIC_AUTH";

  function resolveUrl(url: string, priority = 0): Promise<string> {
    return isAuth() ? getBlobUrl(url, priority) : Promise.resolve(url);
  }

  function fetchPages(chapterId: number, signal?: AbortSignal): Promise<string[]> {
    const cached = pageCache.get(chapterId);
    if (cached) return Promise.resolve(cached);
    if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));

    if (!inflight.has(chapterId)) {
      const p = gql<{ fetchChapterPages: { pages: string[] } }>(FETCH_CHAPTER_PAGES, { chapterId })
        .then(d => {
          const urls = d.fetchChapterPages.pages.map(p => plainThumbUrl(p));
          if (isAuth()) preloadBlobUrls(urls, urls.length);
          pageCache.set(chapterId, urls);
          return urls;
        })
        .finally(() => inflight.delete(chapterId));
      inflight.set(chapterId, p);
    }

    const base = inflight.get(chapterId)!;
    if (!signal) return base;
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      base.then(resolve, reject);
    });
  }

  const aspectCache = new Map<string, number>();

  function measureAspect(url: string): Promise<number> {
    if (aspectCache.has(url)) return Promise.resolve(aspectCache.get(url)!);
    return resolveUrl(url).then(src => new Promise(res => {
      const img = new Image();
      img.onload  = () => { const r = img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 0.67; aspectCache.set(url, r); res(r); };
      img.onerror = () => res(0.67);
      img.src = src;
    }));
  }

  function preloadImage(url: string) {
    resolveUrl(url).then(src => { new Image().src = src; }).catch(() => {});
  }

  interface StripChapter { chapterId: number; chapterName: string; urls: string[]; }

  let containerEl: HTMLDivElement;
  let containerWidth = $state(0);
  let zoomAnchorEl:     HTMLElement | null = null;
  let zoomAnchorOffset: number             = 0;

  function captureZoomAnchor() {
    if (!containerEl || style !== "longstrip") return;
    const imgs = containerEl.querySelectorAll<HTMLElement>("img[data-local-page]");
    const containerTop = containerEl.getBoundingClientRect().top;
    for (const img of imgs) {
      const rect = img.getBoundingClientRect();
      if (rect.bottom > containerTop) {
        zoomAnchorEl     = img;
        zoomAnchorOffset = rect.top - containerTop;
        return;
      }
    }
  }

  function restoreZoomAnchor() {
    if (!zoomAnchorEl || !containerEl) return;
    const el = zoomAnchorEl;
    zoomAnchorEl = null;
    requestAnimationFrame(() => {
      const containerTop = containerEl.getBoundingClientRect().top;
      const newRect      = el.getBoundingClientRect();
      containerEl.scrollTop += (newRect.top - containerTop) - zoomAnchorOffset;
    });
  }

  let loading          = $state(true);
  let error: string | null = $state(null);
  let dlOpen           = $state(false);
  let zoomOpen         = $state(false);
  let uiVisible        = $state(true);
  let pageReady        = $state(false);
  let pageGroups: number[][] = $state([]);
  let stripChapters: StripChapter[] = $state([]);
  let visibleChapterId: number | null = $state(null);
  let nextN            = $state(5);
  let dlBusy           = $state(false);
  let hideTimer:       ReturnType<typeof setTimeout> | null = null;
  let markedRead       = new Set<number>();
  let appending        = false;
  let abortCtrl:       AbortController | null = null;
  let hasNavigated     = false;
  let resumePage        = $state(0);
  let resumeDismissed   = $state(false);
  let resumeTimer:      ReturnType<typeof setTimeout> | null = null;
  let resumeFadeTimer:  ReturnType<typeof setTimeout> | null = null;
  let resumeFading      = $state(false);
  let resumeVisible     = $state(false);

  let markerOpen       = $state(false);
  let markerNote       = $state("");
  let markerColor:  MarkerColor = $state("yellow");
  let markerEditId     = $state("");

  function scheduleResumeDismiss() {
    if (resumeTimer)     clearTimeout(resumeTimer);
    if (resumeFadeTimer) clearTimeout(resumeFadeTimer);
    resumeFading  = false;
    resumeFadeTimer = setTimeout(() => { resumeFading = true; },  1500);
    resumeTimer     = setTimeout(() => { resumeVisible = false; resumeFading = false; }, 2500);
  }
  let stripResumeReady  = $state(false);
  let fadingOut         = $state(false);
  let sliderDragging    = $state(false);
  let sliderHover       = $state(false);

  const rtl         = $derived(store.settings.readingDirection === "rtl");
  const fit         = $derived((store.settings.fitMode ?? "width") as FitMode);
  const style       = $derived((store.settings.pageStyle ?? "single") as PageStyle);
  const zoom        = $derived(store.settings.readerZoom ?? 1.0);
  const autoNext    = $derived(store.settings.autoNextChapter ?? false);
  const markOnNext  = $derived(store.settings.markReadOnNext ?? true);
  const overlayBars = $derived(store.settings.overlayBars ?? false);
  const lastPage    = $derived(store.pageUrls.length);
  const effectiveWidth = $derived(containerWidth > 0 ? Math.round(containerWidth * zoom) : undefined);
  const zoomPct = $derived(Math.round(zoom * 100));

  const displayChapter = $derived(
    style === "longstrip" && visibleChapterId
      ? (store.activeChapterList.find(c => c.id === visibleChapterId) ?? store.activeChapter)
      : store.activeChapter
  );
  const currentBookmark = $derived(displayChapter ? store.bookmarks.find(b => b.chapterId === displayChapter!.id) : undefined);
  const isBookmarked = $derived(!!currentBookmark && currentBookmark.pageNumber === store.pageNumber);

  const currentPageMarkers = $derived(
    displayChapter ? store.getMarkersForPage(displayChapter.id, store.pageNumber) : []
  );

  const activeChapterMarkers = $derived(
    displayChapter ? store.getMarkersForChapter(displayChapter.id) : []
  );

  const hasMarkerOnPage = $derived(currentPageMarkers.length > 0);

  const showResumeBanner = $derived(
    resumeVisible && resumePage > 1 &&
    (style === "longstrip" ? stripResumeReady : store.pageNumber === resumePage)
  );

  const adjacent = $derived.by(() => {
    const ref = displayChapter ?? store.activeChapter;
    if (!ref || !store.activeChapterList.length) return { prev: null, next: null, remaining: [] };
    const idx = store.activeChapterList.findIndex(c => c.id === ref.id);
    return {
      prev:      idx > 0                                   ? store.activeChapterList[idx - 1] : null,
      next:      idx < store.activeChapterList.length - 1 ? store.activeChapterList[idx + 1] : null,
      remaining: store.activeChapterList.slice(idx + 1),
    };
  });

  const visibleChunkLastPage = $derived.by(() => {
    if (style !== "longstrip") return lastPage;
    const chId  = visibleChapterId ?? store.activeChapter?.id;
    const chunk = stripChapters.find(c => c.chapterId === chId);
    return chunk?.urls.length ?? lastPage;
  });

  const imgCls = $derived([
    "img",
    fit === "width"    && "fit-width",
    fit === "height"   && "fit-height",
    fit === "screen"   && "fit-screen",
    fit === "original" && "fit-original",
    store.settings.optimizeContrast && "optimize-contrast",
  ].filter(Boolean).join(" "));

  const fitLabel = $derived({ width: "Fit W", height: "Fit H", screen: "Fit Screen", original: "1:1" }[fit]);

  const stripToRender = $derived(
    style === "longstrip"
      ? (stripChapters.length > 0
          ? stripChapters
          : [{ chapterId: store.activeChapter?.id ?? 0, chapterName: store.activeChapter?.name ?? "", urls: store.pageUrls }])
      : []
  );

  const currentGroup = $derived(
    style === "double" && pageGroups.length
      ? (pageGroups.find(g => g.includes(store.pageNumber)) ?? [store.pageNumber])
      : [store.pageNumber]
  );

  const sliderPage = $derived.by(() => {
    if (style === "double" && pageGroups.length) {
      return pageGroups.findIndex(g => g.includes(store.pageNumber)) + 1;
    }
    return store.pageNumber;
  });

  const sliderMax = $derived.by(() => {
    if (style === "double" && pageGroups.length) return pageGroups.length;
    if (style === "longstrip") return visibleChunkLastPage || 1;
    return lastPage || 1;
  });

  const sliderPct = $derived(sliderMax > 1 ? ((sliderPage - 1) / (sliderMax - 1)) * 100 : 0);

  $effect(() => {
    const chapter = displayChapter;
    const manga   = store.activeManga;
    if (store.settings.discordRpc && chapter && manga) setReading(manga, chapter);
  });

  $effect(() => {
    const ch = store.activeChapter;
    if (ch) untrack(() => loadChapter(ch.id));
  });

  async function loadChapter(id: number) {
    abortCtrl?.abort();
    const ctrl = new AbortController();
    abortCtrl  = ctrl;
    hasNavigated     = false;
    appending        = false;
    markedRead       = new Set();
    loading          = true;
    error            = null;
    pageGroups       = [];
    pageReady        = false;
    stripChapters    = [];
    visibleChapterId = null;
    store.pageUrls   = [];
    fadingOut        = false;
    markerOpen       = false;

    const bookmark  = store.bookmarks.find(b => b.chapterId === id);
    const resumeTo  = bookmark ? bookmark.pageNumber : 0;
    resumePage      = resumeTo > 1 ? resumeTo : 0;
    resumeDismissed  = false;
    resumeVisible    = resumeTo > 1;
    if (resumeTo > 1) scheduleResumeDismiss();
    stripResumeReady = false;

    store.pageNumber = 1;
    try {
      const urls = await fetchPages(id, ctrl.signal);
      if (ctrl.signal.aborted) return;
      store.pageUrls = urls;
      if (resumeTo > 1) store.pageNumber = Math.min(resumeTo, urls.length || resumeTo);
      pageReady = true;
      loading   = false;
    } catch (e: any) {
      if (ctrl.signal.aborted) return;
      error   = e instanceof Error ? e.message : String(e);
      loading = false;
    }
  }

  $effect(() => {
    if (style === "longstrip" && store.pageUrls.length && store.activeChapter) {
      const ch       = store.activeChapter;
      const urls     = store.pageUrls;
      const targetPg = untrack(() => resumePage);
      appending        = false;
      stripChapters    = [{ chapterId: ch.id, chapterName: ch.name, urls }];
      visibleChapterId = ch.id;
      tick().then(() => {
        if (!containerEl) return;
        if (targetPg > 1) {
          const chId = ch.id;
          const scrollToResumePage = () => {
            const target = containerEl.querySelector<HTMLImageElement>(`img[data-local-page="${targetPg}"][data-chapter="${chId}"]`);
            if (!target) { requestAnimationFrame(scrollToResumePage); return; }
            containerEl.querySelectorAll<HTMLImageElement>(`img[data-chapter="${chId}"]`).forEach((img, i) => { if (i < targetPg) img.loading = "eager"; });
            const doScroll = () => { target.scrollIntoView({ block: "start" }); stripResumeReady = true; };
            if (target.complete && target.naturalHeight > 0) { doScroll(); }
            else { target.loading = "eager"; target.addEventListener("load", doScroll, { once: true }); }
          };
          scrollToResumePage();
          return;
        }
        containerEl.scrollTop = 0;
      });
    }
  });

  $effect(() => { if (style !== "longstrip" && containerEl) containerEl.scrollTop = 0; });

  $effect(() => {
    const chId = visibleChapterId;
    if (!chId || style !== "longstrip") return;
    if (chId === store.activeChapter?.id) return;
    const wasAppended = untrack(() => stripChapters.findIndex(c => c.chapterId === chId)) > 0;
    if (wasAppended) { untrack(() => { resumePage = 0; resumeVisible = false; }); return; }
    const bookmark = store.bookmarks.find(b => b.chapterId === chId);
    if (bookmark && bookmark.pageNumber > 1) {
      untrack(() => {
        resumePage = bookmark.pageNumber; resumeDismissed = false; resumeVisible = true; stripResumeReady = true;
        scheduleResumeDismiss();
      });
    } else {
      untrack(() => { resumePage = 0; resumeDismissed = false; resumeVisible = false; stripResumeReady = false; });
    }
  });

  function appendNextChapter() {
    if (appending || !stripChapters.length) return;
    const lastChunk = stripChapters[stripChapters.length - 1];
    const list      = store.activeChapterList;
    const lastIdx   = list.findIndex(c => c.id === lastChunk.chapterId);
    if (lastIdx < 0 || lastIdx >= list.length - 1) return;
    const next = list[lastIdx + 1];
    if (!next || stripChapters.some(c => c.chapterId === next.id)) return;
    appending = true;
    fetchPages(next.id)
      .then(urls => { urls.forEach(url => measureAspect(url).catch(() => {})); urls.slice(0, 6).forEach(preloadImage); return urls; })
      .then(urls => {
        if (stripChapters.some(c => c.chapterId === next.id)) { appending = false; return; }
        stripChapters = [...stripChapters, { chapterId: next.id, chapterName: next.name, urls }];
        appending = false;
      })
      .catch(() => { appending = false; });
  }

  let stripChaptersRef: StripChapter[] = [];
  $effect(() => { stripChaptersRef = stripChapters; });

  function setupScrollTracking(): () => void {
    if (!containerEl || style !== "longstrip") return () => {};

    function onScroll() {
      const imgs = containerEl.querySelectorAll<HTMLElement>("img[data-local-page]");
      if (!imgs.length) return;
      const containerTop = containerEl.getBoundingClientRect().top;
      const readLineY    = containerTop + containerEl.clientHeight * READ_LINE_PCT;
      let activePage: number | null = null;
      let activeChId: number | null = null;
      for (const img of imgs) {
        if (img.getBoundingClientRect().top <= readLineY) {
          activePage = Number(img.dataset.localPage);
          activeChId = Number(img.dataset.chapter);
        } else break;
      }
      if (activePage === null) {
        activePage = Number(imgs[0].dataset.localPage);
        activeChId = Number(imgs[0].dataset.chapter);
      }
      if (activePage !== null) store.pageNumber = activePage;
      if (activeChId && activeChId !== visibleChapterId) visibleChapterId = activeChId;
      if (store.settings.autoMarkRead && activePage !== null && activeChId) {
        const chunk = stripChaptersRef.find(c => c.chapterId === activeChId);
        const total = chunk ? chunk.urls.length : store.pageUrls.length;
        if (total > 0 && activePage >= total) markChapterRead(activeChId);
      }
      if (containerEl.scrollTop + containerEl.clientHeight >= containerEl.scrollHeight - 40) {
        const last = stripChaptersRef[stripChaptersRef.length - 1];
        if (last && store.settings.autoMarkRead) markChapterRead(last.chapterId);
      }
    }

    function onScrollAppend() {
      const pct = (containerEl.scrollTop + containerEl.clientHeight) / containerEl.scrollHeight;
      if (pct >= 0.80) appendNextChapter();
    }

    containerEl.addEventListener("scroll", onScroll,       { passive: true });
    containerEl.addEventListener("scroll", onScrollAppend, { passive: true });
    return () => {
      containerEl.removeEventListener("scroll", onScroll);
      containerEl.removeEventListener("scroll", onScrollAppend);
    };
  }

  let cleanupScroll: () => void = () => {};

  $effect(() => {
    void style;
    if (!containerEl) return;
    untrack(() => { cleanupScroll(); cleanupScroll = setupScrollTracking(); });
  });

  $effect(() => {
    if (store.activeChapter && store.activeChapterList.length) {
      const idx = store.activeChapterList.findIndex(c => c.id === store.activeChapter!.id);
      if (idx >= 0) {
        for (let i = 1; i <= 3; i++) {
          const entry = store.activeChapterList[idx + i];
          if (!entry) break;
          fetchPages(entry.id)
            .then(urls => { const n = i === 1 ? 8 : i === 2 ? 4 : 2; urls.slice(0, n).forEach(preloadImage); })
            .catch(() => {});
        }
        if (idx > 0) fetchPages(store.activeChapterList[idx - 1].id).catch(() => {});
      }
    }
  });

  $effect(() => {
    if (style === "double" && store.pageUrls.length) {
      let cancelled = false;
      const snap = store.pageUrls;
      Promise.all(snap.map(measureAspect)).then(aspects => {
        if (cancelled || snap !== store.pageUrls) return;
        const offset = store.settings.offsetDoubleSpreads;
        const groups: number[][] = [[1]];
        if (offset) groups.push([2]);
        let i = offset ? 3 : 2;
        while (i <= snap.length) {
          const a = aspects[i - 1];
          if (a > 1.2 || i === snap.length) { groups.push([i++]); }
          else { groups.push(rtl ? [i + 1, i] : [i, i + 1]); i += 2; }
        }
        pageGroups = groups;
      });
      return () => { cancelled = true; };
    } else { pageGroups = []; }
  });

  $effect(() => {
    const ahead = store.settings.preloadPages ?? 3;
    const current = store.pageUrls[store.pageNumber - 1];
    if (!current) return;
    if (isAuth()) {
      getBlobUrl(current, 999);
      const upcoming = Array.from({ length: ahead }, (_, i) => store.pageUrls[store.pageNumber + i]).filter(Boolean) as string[];
      const behind   = store.pageUrls[store.pageNumber - 2];
      preloadBlobUrls(upcoming, ahead);
      if (behind) preloadBlobUrls([behind], 0);
    } else {
      for (let i = 1; i <= ahead; i++) {
        const url = store.pageUrls[store.pageNumber - 1 + i];
        if (url) preloadImage(url);
      }
      const behind = store.pageUrls[store.pageNumber - 2];
      if (behind) preloadImage(behind);
    }
  });

  $effect(() => {
    const ch = displayChapter ?? store.activeChapter;
    const autoBookmark = store.settings.autoBookmark ?? true;
    if (ch && lastPage && store.activeManga) {
      const chapterId   = ch.id;
      const chapterName = ch.name;
      const mangaId     = store.activeManga.id;
      const mangaTitle  = store.activeManga.title;
      const thumb       = store.activeManga.thumbnailUrl;
      const pageNum     = store.pageNumber;
      const atLast      = store.pageNumber === lastPage;
      if (pageNum > 1) hasNavigated = true;
      untrack(() => {
        if (!hasNavigated) return;
        if (style === "longstrip" && visibleChapterId && chapterId !== visibleChapterId) return;
        addHistory({ mangaId, mangaTitle, thumbnailUrl: thumb, chapterId, chapterName, readAt: Date.now() });
        if (autoBookmark) {
          addBookmark({ mangaId, mangaTitle, thumbnailUrl: thumb, chapterId, chapterName, pageNumber: pageNum });
        }
        if (style !== "longstrip" && store.settings.autoMarkRead && atLast) markChapterRead(chapterId);
      });
    }
  });

  function markChapterRead(id: number) {
    if (markedRead.has(id)) return;
    markedRead.add(id);
    const chapter = store.activeChapterList.find(c => c.id === id) ?? store.activeChapter;
    const pages   = chapter?.pageCount ?? store.pageUrls.length ?? 15;
    const minutes = Math.max(1, Math.round(pages * AVG_MIN_PER_PAGE));
    if (store.activeManga && chapter) {
      addHistory(
        { mangaId: store.activeManga.id, mangaTitle: store.activeManga.title, thumbnailUrl: store.activeManga.thumbnailUrl, chapterId: id, chapterName: chapter.name, readAt: Date.now() },
        true, minutes,
      );
    }
    gql(MARK_CHAPTER_READ, { id, isRead: true })
      .then(() => {
        if (store.activeManga) {
          const updated = store.activeChapterList.map(c => c.id === id ? { ...c, isRead: true } : c);
          checkAndMarkCompleted(store.activeManga.id, updated);
        }
      })
      .catch(e => { markedRead.delete(id); console.error(e); });
  }

  function maybeMarkCurrentRead() {
    const ch = displayChapter ?? store.activeChapter;
    if (ch && markOnNext) markChapterRead(ch.id);
  }

  function advanceGroup(forward: boolean) {
    if (!pageGroups.length) return;
    const gi = pageGroups.findIndex(g => g.includes(store.pageNumber));
    if (forward) {
      if (gi < pageGroups.length - 1) store.pageNumber = pageGroups[gi + 1][0];
      else if (adjacent.next) { store.pageNumber = 1; openReader(adjacent.next, store.activeChapterList); }
      else closeReader();
    } else {
      if (gi > 0) store.pageNumber = pageGroups[gi - 1][0];
      else if (adjacent.prev) openReader(adjacent.prev, store.activeChapterList);
    }
  }

  async function animateFade(fn: () => void) {
    fadingOut = true;
    await new Promise(r => setTimeout(r, 100));
    fn();
    fadingOut = false;
  }

  function goForward() {
    if (loading) return;
    if (style === "longstrip") {
      if (adjacent.next) { maybeMarkCurrentRead(); openReader(adjacent.next, store.activeChapterList); }
      return;
    }
    if (style === "double" && pageGroups.length) { advanceGroup(true); return; }
    if (!store.pageUrls.length) return;
    if (store.pageNumber < lastPage) {
      if (style === "fade") { animateFade(() => { store.pageNumber++; }); }
      else { store.pageNumber++; }
    } else if (adjacent.next) {
      maybeMarkCurrentRead();
      store.pageNumber = 1;
      openReader(adjacent.next, store.activeChapterList);
    } else { closeReader(); }
  }

  function goBack() {
    if (loading) return;
    if (style === "longstrip") {
      if (adjacent.prev) openReader(adjacent.prev, store.activeChapterList);
      return;
    }
    if (style === "double" && pageGroups.length) { advanceGroup(false); return; }
    if (!store.pageUrls.length) return;
    if (store.pageNumber > 1) {
      if (style === "fade") { animateFade(() => { store.pageNumber--; }); }
      else { store.pageNumber--; }
    } else if (adjacent.prev) { openReader(adjacent.prev, store.activeChapterList); }
  }

  const goNext = $derived(rtl ? goBack    : goForward);
  const goPrev = $derived(rtl ? goForward : goBack);

  function jumpToPage(page: number) {
    if (style === "longstrip") {
      const chId = visibleChapterId ?? store.activeChapter?.id;
      const target = containerEl?.querySelector<HTMLImageElement>(`img[data-local-page="${page}"][data-chapter="${chId}"]`);
      target?.scrollIntoView({ block: "start" });
      return;
    }
    if (style === "double" && pageGroups.length) {
      const group = pageGroups[page - 1];
      if (group) store.pageNumber = group[0];
    } else {
      store.pageNumber = Math.max(1, Math.min(lastPage, page));
    }
  }

  function clampZoom(z: number): number {
    return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 1000) / 1000;
  }

  function adjustZoom(delta: number) {
    captureZoomAnchor();
    updateSettings({ readerZoom: clampZoom(zoom + delta) });
    restoreZoomAnchor();
  }

  function resetZoom() {
    captureZoomAnchor();
    updateSettings({ readerZoom: 1.0 });
    restoreZoomAnchor();
  }

  function toggleBookmark() {
    const ch    = displayChapter;
    const manga = store.activeManga;
    if (!ch || !manga) return;
    if (isBookmarked) {
      removeBookmark(ch.id);
      resumeVisible = false;
    } else {
      addBookmark({ mangaId: manga.id, mangaTitle: manga.title, thumbnailUrl: manga.thumbnailUrl, chapterId: ch.id, chapterName: ch.name, pageNumber: store.pageNumber });
    }
  }

  function openMarkerPopover() {
    const ch    = displayChapter;
    const manga = store.activeManga;
    if (!ch || !manga) return;
    if (currentPageMarkers.length > 0) {
      const first = currentPageMarkers[0];
      markerEditId = first.id;
      markerNote   = first.note;
      markerColor  = first.color;
    } else {
      markerEditId = "";
      markerNote   = "";
      markerColor  = "yellow";
    }
    markerOpen = !markerOpen;
    zoomOpen   = false;
    dlOpen     = false;
  }

  function commitMarker() {
    const ch    = displayChapter;
    const manga = store.activeManga;
    if (!ch || !manga) return;
    if (markerEditId) {
      updateMarker(markerEditId, { note: markerNote.trim(), color: markerColor });
    } else {
      addMarker({
        mangaId:      manga.id,
        mangaTitle:   manga.title,
        thumbnailUrl: manga.thumbnailUrl,
        chapterId:    ch.id,
        chapterName:  ch.name,
        pageNumber:   store.pageNumber,
        note:         markerNote.trim(),
        color:        markerColor,
      });
    }
    markerOpen   = false;
    markerNote   = "";
    markerEditId = "";
  }

  function deleteCurrentMarker() {
    if (markerEditId) removeMarker(markerEditId);
    markerOpen   = false;
    markerNote   = "";
    markerEditId = "";
  }

  function cycleStyle() {
    const idx = PAGE_STYLES.indexOf(style);
    updateSettings({ pageStyle: PAGE_STYLES[(idx + 1) % PAGE_STYLES.length] });
  }

  function cycleFit() {
    const opts: FitMode[] = ["width", "height", "screen", "original"];
    updateSettings({ fitMode: opts[(opts.indexOf(fit) + 1) % opts.length] });
  }

  function showUi() {
    uiVisible = true;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!markerOpen) uiVisible = false; }, 3000);
  }

  $effect(() => {
    if (markerOpen) {
      uiVisible = true;
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    }
  });

  function onWheel(e: WheelEvent) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    adjustZoom(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
  }

  function onSliderInput(e: Event) {
    jumpToPage(Number((e.currentTarget as HTMLInputElement).value));
  }

  function onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
    const kb = store.settings.keybinds ?? DEFAULT_KEYBINDS;
    const r  = store.settings.readingDirection === "rtl";
    if (e.key === "Escape") {
      e.preventDefault();
      if (markerOpen) { markerOpen = false; return; }
      if (zoomOpen)   { zoomOpen   = false; return; }
      if (dlOpen)     { dlOpen     = false; return; }
      closeReader(); return;
    }
    if (e.ctrlKey && (e.key === "=" || e.key === "+")) { e.preventDefault(); adjustZoom(ZOOM_STEP * 2); return; }
    if (e.ctrlKey && e.key === "-")                    { e.preventDefault(); adjustZoom(-ZOOM_STEP * 2); return; }
    if (e.ctrlKey && e.key === "0")                    { e.preventDefault(); resetZoom(); return; }
    if      (matchesKeybind(e, kb.exitReader))             { e.preventDefault(); closeReader(); }
    else if (matchesKeybind(e, kb.pageRight))              { e.preventDefault(); goForward(); }
    else if (matchesKeybind(e, kb.pageLeft))               { e.preventDefault(); goBack(); }
    else if (matchesKeybind(e, kb.firstPage))              { e.preventDefault(); store.pageNumber = 1; }
    else if (matchesKeybind(e, kb.lastPage))               { e.preventDefault(); store.pageNumber = lastPage; }
    else if (matchesKeybind(e, kb.chapterRight)) {
      e.preventDefault();
      const list = store.activeChapterList;
      const idx  = list.findIndex(c => c.id === store.activeChapter?.id);
      const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
      if (next) { maybeMarkCurrentRead(); openReader(next, list); }
    }
    else if (matchesKeybind(e, kb.chapterLeft)) {
      e.preventDefault();
      const list = store.activeChapterList;
      const idx  = list.findIndex(c => c.id === store.activeChapter?.id);
      const prev = idx > 0 ? list[idx - 1] : null;
      if (prev) openReader(prev, list);
    }
    else if (matchesKeybind(e, kb.togglePageStyle))        { e.preventDefault(); cycleStyle(); }
    else if (matchesKeybind(e, kb.toggleReadingDirection)) { e.preventDefault(); updateSettings({ readingDirection: r ? "ltr" : "rtl" }); }
    else if (matchesKeybind(e, kb.toggleFullscreen))       { e.preventDefault(); toggleFullscreen().catch(console.error); }
    else if (matchesKeybind(e, kb.openSettings))           { e.preventDefault(); setSettingsOpen(true); }
    else if (matchesKeybind(e, kb.toggleBookmark))         { e.preventDefault(); toggleBookmark(); }
    else if (matchesKeybind(e, kb.toggleMarker))           { e.preventDefault(); openMarkerPopover(); }
  }

  function handleTap(e: MouseEvent) {
    if (style === "longstrip") return;
    const x = e.clientX / window.innerWidth;
    if (!rtl) { if (x > 0.6) goForward(); else if (x < 0.4) goBack(); }
    else       { if (x < 0.4) goForward(); else if (x > 0.6) goBack(); }
  }

  async function runDl(fn: () => Promise<unknown>) {
    dlBusy = true;
    try { await fn(); } catch (e: any) { console.error(e); }
    dlBusy = false; dlOpen = false;
  }

  onMount(() => {
    showUi();
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: false });
    containerEl?.focus({ preventScroll: true });

    const ro = new ResizeObserver(entries => { containerWidth = entries[0].contentRect.width; });
    ro.observe(containerEl);

    return () => {
      abortCtrl?.abort();
      if (hideTimer) clearTimeout(hideTimer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
      cleanupScroll();
      ro.disconnect();
    };
  });
</script>

<div class="root" class:overlay-bars={overlayBars} role="presentation" onmousemove={(e) => { if (e.clientY < 60 || window.innerHeight - e.clientY < 60) showUi(); }}>

  <div class="topbar" class:hidden={!uiVisible}>

    <div class="topbar-left">
      <button class="icon-btn" onclick={closeReader} title="Close reader"><X size={15} weight="light" /></button>
      <button class="icon-btn" onclick={() => { if (adjacent.prev) { maybeMarkCurrentRead(); openReader(adjacent.prev, store.activeChapterList); } }} disabled={!adjacent.prev}>
        <CaretLeft size={14} weight="light" />
      </button>
      <span class="ch-label">
        <span class="ch-title">{store.activeManga?.title}</span>
        <span class="ch-sep">/</span>
        <span>{displayChapter?.name}</span>
      </span>
      <button class="icon-btn" onclick={() => { if (adjacent.next) { maybeMarkCurrentRead(); openReader(adjacent.next, store.activeChapterList); } }} disabled={!adjacent.next}>
        <CaretRight size={14} weight="light" />
      </button>
      <span class="page-label">{store.pageNumber} / {visibleChunkLastPage || "…"}</span>
    </div>

    <div class="topbar-right">
      <div class="top-sep"></div>

      <button class="mode-btn" onclick={cycleFit}>
        {#if fit === "width"}<ArrowsLeftRight size={14} weight="light" />
        {:else if fit === "height"}<ArrowsVertical size={14} weight="light" />
        {:else if fit === "screen"}<ArrowsIn size={14} weight="light" />
        {:else}<ArrowsOut size={14} weight="light" />{/if}
        <span class="mode-label">{fitLabel}</span>
      </button>

      <div class="zoom-wrap">
        <div class="zoom-inline">
          <button class="zoom-step-btn" onclick={() => adjustZoom(-ZOOM_STEP)} title="Zoom out" disabled={zoom <= ZOOM_MIN}>
            <MagnifyingGlassMinus size={13} weight="light" />
          </button>
          <button class="zoom-pct-btn" onclick={() => zoomOpen = !zoomOpen} title="Click to adjust zoom">
            {zoomPct}%
          </button>
          <button class="zoom-step-btn" onclick={() => adjustZoom(ZOOM_STEP)} title="Zoom in" disabled={zoom >= ZOOM_MAX}>
            <MagnifyingGlassPlus size={13} weight="light" />
          </button>
        </div>
        {#if zoomOpen}
          <div class="zoom-popover">
            <div class="zoom-slider-row">
              <input type="range" class="zoom-slider" min={10} max={100} step={5} value={zoomPct}
                oninput={(e) => { captureZoomAnchor(); updateSettings({ readerZoom: clampZoom(Number(e.currentTarget.value) / 100) }); restoreZoomAnchor(); }} />
            </div>
            <button class="zoom-reset" onclick={resetZoom} disabled={zoom === 1.0}>Reset</button>
          </div>
        {/if}
      </div>

      <button class="mode-btn" class:active={rtl} onclick={() => updateSettings({ readingDirection: rtl ? "ltr" : "rtl" })}>
        <ArrowsLeftRight size={14} weight="light" /><span class="mode-label">{rtl ? "RTL" : "LTR"}</span>
      </button>

      <button class="mode-btn" onclick={cycleStyle} title="Cycle view mode">
        {#if style === "single"}<Square size={14} weight="light" />
        {:else if style === "fade"}<MonitorPlay size={14} weight="light" />
        {:else if style === "double"}<BookOpen size={14} weight="light" />
        {:else}<Rows size={14} weight="light" />{/if}
        <span class="mode-label">{style}</span>
      </button>

      <div class="mode-extras">
        {#if style === "double"}
          <button class="mode-btn" class:active={store.settings.offsetDoubleSpreads} onclick={() => updateSettings({ offsetDoubleSpreads: !store.settings.offsetDoubleSpreads })}>
            <span class="mode-label">Offset</span>
          </button>
        {/if}
        {#if style === "longstrip"}
          <button class="mode-btn" class:active={store.settings.pageGap} onclick={() => updateSettings({ pageGap: !store.settings.pageGap })}>
            <span class="mode-label">Gap</span>
          </button>
          <button class="mode-btn" class:active={autoNext} onclick={() => updateSettings({ autoNextChapter: !autoNext })}>
            <span class="mode-label">Auto</span>
          </button>
        {/if}
        {#if !autoNext}
          <button class="mode-btn" class:active={markOnNext} onclick={() => updateSettings({ markReadOnNext: !markOnNext })}>
            <span class="mode-label">Mk.Read</span>
          </button>
        {/if}
      </div>

      <button class="mode-btn" onclick={() => dlOpen = true}>
        <Download size={14} weight="light" />
      </button>

      <div class="marker-wrap">
        <button
          class="icon-btn"
          class:active={hasMarkerOnPage}
          class:marker-btn-has={hasMarkerOnPage}
          onclick={openMarkerPopover}
          title={hasMarkerOnPage ? "Edit marker" : "Add marker"}
          style={hasMarkerOnPage ? `--marker-color:${MARKER_COLOR_HEX[currentPageMarkers[0].color]}` : ""}
        >
          <MapPin size={14} weight={hasMarkerOnPage ? "fill" : "regular"} />
        </button>

        {#if markerOpen}
          <div class="marker-popover" role="presentation" onclick={(e) => e.stopPropagation()}
            onmouseenter={() => { uiVisible = true; if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } }}
          >
            <div class="marker-pop-header">
              <span class="marker-pop-title">
                {markerEditId ? "Edit marker" : "New marker"} · p.{store.pageNumber}
              </span>
              {#if markerEditId}
                <button class="marker-delete-btn" onclick={deleteCurrentMarker} title="Delete marker">
                  <X size={12} weight="light" />
                </button>
              {/if}
            </div>
            <div class="marker-color-row">
              {#each MARKER_COLORS as c}
                <button
                  class="marker-swatch"
                  class:marker-swatch-active={markerColor === c}
                  style="--swatch:{MARKER_COLOR_HEX[c]}"
                  onclick={() => markerColor = c}
                  title={c}
                >
                  <span class="swatch-dot"></span>
                  <span class="swatch-label">{c}</span>
                </button>
              {/each}
            </div>
            <textarea
              class="marker-textarea"
              style="--accent-marker:{MARKER_COLOR_HEX[markerColor]}"
              rows={3}
              placeholder="Note (optional)…"
              bind:value={markerNote}
              onmouseenter={() => { uiVisible = true; if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } }}
              onkeydown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitMarker(); }
                if (e.key === "Escape") { markerOpen = false; }
              }}
            ></textarea>
            <div class="marker-pop-actions">
              <button class="marker-save-btn" style="--accent-marker:{MARKER_COLOR_HEX[markerColor]}" onclick={commitMarker}>
                <Check size={12} weight="bold" />
                {markerEditId ? "Update" : "Save"}
              </button>
              <button class="marker-cancel-btn" onclick={() => markerOpen = false}>Cancel</button>
            </div>
          </div>
        {/if}
      </div>

      <button class="icon-btn" class:active={isBookmarked} onclick={toggleBookmark} title={isBookmarked ? "Remove bookmark" : "Bookmark this page"}>
        <Bookmark size={15} weight={isBookmarked ? "fill" : "regular"} />
      </button>
    </div>
  </div>

  {#if showResumeBanner}
    <button class="resume-banner" class:fading={resumeFading} onclick={() => { resumeVisible = false; resumeFading = false; }}>
      <span>Bookmark at page {resumePage}</span>
    </button>
  {/if}

  <div
    bind:this={containerEl}
    class="viewer"
    class:strip={style === "longstrip"}
    style={effectiveWidth != null ? `--effective-width:${effectiveWidth}px` : ""}
    role="presentation"
    tabindex="-1"
    onclick={handleTap}
    onwheel={(e) => { if (e.ctrlKey) e.preventDefault(); }}
    onkeydown={(e) => { if (e.key === " " && style === "longstrip") { e.preventDefault(); containerEl?.scrollBy({ top: containerEl.clientHeight * 0.85, behavior: "smooth" }); } }}
  >

    {#if loading}
      <div class="center-overlay"><CircleNotch size={20} weight="light" class="anim-spin" style="color:var(--text-faint)" /></div>
    {/if}
    {#if error}
      <div class="center-overlay"><p class="error-msg">{error}</p></div>
    {/if}

    {#if style === "longstrip"}
      {#each stripToRender as chunk}
        {#each chunk.urls as url, i}
          {#await resolveUrl(url, chunk.urls.length - i)}
            <img src="" alt="{chunk.chapterName} – Page {i + 1}" data-local-page={i + 1} data-chapter={chunk.chapterId} data-total={chunk.urls.length} class="{imgCls}{store.settings.pageGap ? ' strip-gap' : ''}" loading={i < 5 ? "eager" : "lazy"} decoding="async" />
          {:then src}
            <img {src} alt="{chunk.chapterName} – Page {i + 1}" data-local-page={i + 1} data-chapter={chunk.chapterId} data-total={chunk.urls.length} class="{imgCls}{store.settings.pageGap ? ' strip-gap' : ''}" loading={i < 5 ? "eager" : "lazy"} decoding="async" />
          {/await}
        {/each}
      {/each}
      <div style="height:1px;flex-shrink:0"></div>

    {:else if style === "fade" && pageReady}
      {#await resolveUrl(store.pageUrls[store.pageNumber - 1], 999)}
        <img src="" alt="Page {store.pageNumber}" class={imgCls} decoding="async" style="opacity:0" />
      {:then src}
        <img {src} alt="Page {store.pageNumber}" class={imgCls} decoding="async" style="opacity: {fadingOut ? 0 : 1}; transition: opacity 0.1s ease;" />
      {/await}

    {:else if style === "double" && pageReady}
      {#if pageGroups.length}
        <div class="double-wrap">
          {#each currentGroup as pg, i}
            {#await resolveUrl(store.pageUrls[pg - 1], 999)}
              <img src="" alt="Page {pg}" class="{imgCls} page-half {i === 0 ? 'gap-left' : 'gap-right'}" decoding="async" />
            {:then src}
              <img {src} alt="Page {pg}" class="{imgCls} page-half {i === 0 ? 'gap-left' : 'gap-right'}" decoding="async" />
            {/await}
          {/each}
        </div>
      {:else}
        <div class="center-overlay"><CircleNotch size={20} weight="light" class="anim-spin" style="color:var(--text-faint)" /></div>
      {/if}

    {:else if pageReady}
      {#await resolveUrl(store.pageUrls[store.pageNumber - 1], 999)}
        <img src="" alt="Page {store.pageNumber}" class={imgCls} decoding="async" />
      {:then src}
        <img {src} alt="Page {store.pageNumber}" class={imgCls} decoding="async" />
      {/await}
    {/if}
  </div>

  <div class="bottombar" class:hidden={!uiVisible}>
    <button class="nav-btn" onclick={goPrev} disabled={loading || (style === "longstrip" ? !adjacent.prev : (store.pageNumber === 1 && !adjacent.prev))}>
      <ArrowLeft size={13} weight="light" />
    </button>

    {#if sliderMax > 1}
      <div
        class="slider-wrap"
        class:dragging={sliderDragging}
        onmouseenter={() => sliderHover = true}
        onmouseleave={() => { sliderHover = false; }}
        role="presentation"
      >
        <div class="slider-track-bg">
          <div class="slider-fill" style="width: {rtl ? 100 - sliderPct : sliderPct}%"></div>
        </div>

        {#if isBookmarked && currentBookmark}
          {@const bPct = sliderMax > 1 ? ((currentBookmark.pageNumber - 1) / (sliderMax - 1)) * 100 : 0}
          <div
            class="slider-checkpoint bookmark-checkpoint"
            style="left: {rtl ? 100 - bPct : bPct}%"
            title="Bookmark: Page {currentBookmark.pageNumber}"
          ></div>
        {/if}

        {#each activeChapterMarkers as m (m.id)}
          {@const mPct = sliderMax > 1 ? ((m.pageNumber - 1) / (sliderMax - 1)) * 100 : 0}
          <div
            class="slider-checkpoint marker-checkpoint"
            style="left: {rtl ? 100 - mPct : mPct}%; background:{MARKER_COLOR_HEX[m.color]}"
            title="{m.note ? m.note : 'Marker'} · Page {m.pageNumber}"
          ></div>
        {/each}

        <input
          type="range"
          class="slider-input"
          min={1}
          max={sliderMax}
          step={1}
          value={sliderPage}
          dir={rtl ? "rtl" : "ltr"}
          oninput={onSliderInput}
          onmousedown={() => sliderDragging = true}
          onmouseup={() => sliderDragging = false}
          ontouchstart={() => sliderDragging = true}
          ontouchend={() => sliderDragging = false}
          aria-label="Page {sliderPage} of {sliderMax}"
        />
        {#if sliderHover || sliderDragging}
          <div class="slider-tooltip" style="left: {rtl ? 100 - sliderPct : sliderPct}%">
            {sliderPage} / {sliderMax}
          </div>
        {/if}
      </div>
    {/if}

    <button class="nav-btn" onclick={goNext} disabled={loading || (style === "longstrip" ? !adjacent.next : (store.pageNumber === lastPage && !adjacent.next))}>
      <ArrowRight size={13} weight="light" />
    </button>
  </div>

  {#if dlOpen && store.activeChapter}
    {@const queueable = adjacent.remaining.filter(c => !c.isDownloaded)}
    <div class="dl-backdrop" role="presentation" onclick={() => dlOpen = false}>
      <div class="dl-modal" role="presentation" onclick={(e) => e.stopPropagation()}>
        <p class="dl-title">Download</p>
        <button class="dl-option" disabled={dlBusy || !!store.activeChapter.isDownloaded}
          onclick={() => runDl(() => gql(ENQUEUE_DOWNLOAD, { chapterId: store.activeChapter!.id }))}>
          This chapter
          <span class="dl-sub">{store.activeChapter.isDownloaded ? "Already downloaded" : store.activeChapter.name}</span>
        </button>
        <div class="dl-row">
          <button class="dl-option" disabled={dlBusy || queueable.length === 0}
            onclick={() => runDl(() => gql(ENQUEUE_CHAPTERS_DOWNLOAD, { chapterIds: queueable.slice(0, nextN).map(c => c.id) }))}>
            Next chapters
            <span class="dl-sub">{Math.min(nextN, queueable.length)} not yet downloaded</span>
          </button>
          <div class="dl-stepper" role="presentation" onclick={(e) => e.stopPropagation()}>
            <button class="dl-step-btn" onclick={() => nextN = Math.max(1, nextN - 1)} disabled={nextN <= 1}>−</button>
            <span class="dl-step-val">{nextN}</span>
            <button class="dl-step-btn" onclick={() => nextN = Math.min(queueable.length || 1, nextN + 1)} disabled={nextN >= queueable.length}>+</button>
          </div>
        </div>
        <button class="dl-option" disabled={dlBusy || queueable.length === 0}
          onclick={() => runDl(() => gql(ENQUEUE_CHAPTERS_DOWNLOAD, { chapterIds: queueable.map(c => c.id) }))}>
          All remaining
          <span class="dl-sub">{queueable.length} not yet downloaded</span>
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .root { position: fixed; inset: 0; background: #000; display: flex; flex-direction: column; z-index: var(--z-reader); transform: translateZ(0); will-change: transform; }
  .overlay-bars { position: fixed; }
  .overlay-bars .topbar    { position: absolute; top: 0; left: 0; right: 0; z-index: 10; }
  .overlay-bars .bottombar { position: absolute; bottom: 0; left: 0; right: 0; z-index: 10; }
  .overlay-bars .viewer    { height: 100%; }

  .topbar { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-1); padding: 0 var(--sp-3); height: 40px; background: var(--bg-void); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; position: relative; z-index: 2; transition: opacity 0.25s ease; }
  .topbar.hidden, .bottombar.hidden { opacity: 0; pointer-events: none; }

  .topbar-left { display: flex; align-items: center; gap: var(--sp-1); min-width: 0; flex: 1; overflow: hidden; }
  .topbar-right { display: flex; align-items: center; gap: var(--sp-1); flex-shrink: 0; }
  .mode-extras { display: flex; align-items: center; gap: var(--sp-1); min-width: 0; }

  .icon-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--radius-sm); color: var(--text-muted); flex-shrink: 0; transition: color var(--t-base), background var(--t-base); }
  .icon-btn:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-raised); }
  .icon-btn:disabled { opacity: 0.2; cursor: default; }
  .icon-btn.active { color: var(--accent-fg); }
  .marker-btn-has { color: var(--marker-color, var(--accent-fg)) !important; }

  .ch-label { display: flex; align-items: center; gap: var(--sp-2); font-size: var(--text-sm); color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .ch-title { color: var(--text-secondary); font-weight: var(--weight-medium); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ch-sep   { color: var(--text-faint); flex-shrink: 0; }
  .page-label { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-muted); letter-spacing: var(--tracking-wide); flex-shrink: 0; }
  .top-sep { width: 1px; height: 16px; background: var(--border-dim); flex-shrink: 0; margin: 0 var(--sp-1); }

  .mode-btn { display: flex; align-items: center; gap: 4px; padding: 4px var(--sp-2); border-radius: var(--radius-sm); color: var(--text-muted); flex-shrink: 0; font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); transition: color var(--t-base), background var(--t-base); }
  .mode-btn:hover { color: var(--text-primary); background: var(--bg-raised); }
  .mode-btn.active { color: var(--accent-fg); background: var(--accent-muted); }
  .mode-label { text-transform: capitalize; }

  .zoom-wrap { position: relative; flex-shrink: 0; }
  .zoom-inline { display: flex; align-items: center; gap: 1px; background: var(--bg-overlay); border: 1px solid var(--border-base); border-radius: var(--radius-sm); overflow: hidden; }
  .zoom-step-btn { display: flex; align-items: center; justify-content: center; width: 22px; height: 24px; color: var(--text-muted); transition: color var(--t-base), background var(--t-base); }
  .zoom-step-btn:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-raised); }
  .zoom-step-btn:disabled { opacity: 0.25; cursor: default; }
  .zoom-pct-btn { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); color: var(--text-secondary); padding: 0 var(--sp-2); height: 24px; min-width: 38px; text-align: center; transition: color var(--t-base), background var(--t-base); border-left: 1px solid var(--border-dim); border-right: 1px solid var(--border-dim); }
  .zoom-pct-btn:hover { color: var(--text-primary); background: var(--bg-raised); }
  .zoom-popover { position: absolute; top: calc(100% + 6px); left: 50%; translate: -50% 0; background: var(--bg-raised); border: 1px solid var(--border-base); border-radius: var(--radius-lg); padding: var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-2); box-shadow: 0 8px 24px rgba(0,0,0,0.5); z-index: 100; min-width: 180px; animation: scaleIn 0.1s ease both; transform-origin: top center; }
  .zoom-slider-row { display: flex; align-items: center; gap: var(--sp-2); }
  .zoom-slider { flex: 1; height: 3px; appearance: none; -webkit-appearance: none; background: var(--border-strong); border-radius: 2px; outline: none; cursor: pointer; }
  .zoom-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: var(--accent-fg); cursor: pointer; }
  .zoom-reset { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-muted); letter-spacing: var(--tracking-wide); padding: 3px var(--sp-2); border-radius: var(--radius-sm); border: 1px solid var(--border-dim); transition: color var(--t-base), background var(--t-base), border-color var(--t-base); }
  .zoom-reset:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-overlay); border-color: var(--border-strong); }
  .zoom-reset:disabled { opacity: 0.3; cursor: default; }

  .marker-wrap { position: relative; flex-shrink: 0; }
  .marker-popover { position: absolute; top: calc(100% + 8px); right: 0; width: 240px; background: var(--bg-surface); border: 1px solid var(--border-base); border-radius: var(--radius-lg); padding: var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-3); box-shadow: 0 12px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4); z-index: 100; animation: scaleIn 0.1s ease both; transform-origin: top right; }
  .marker-pop-header { display: flex; align-items: center; justify-content: space-between; }
  .marker-pop-title { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; }
  .swatch-dot { width: 14px; height: 14px; border-radius: 50%; background: var(--swatch); box-shadow: 0 0 0 0 var(--swatch); transition: box-shadow var(--t-fast), transform var(--t-fast); flex-shrink: 0; }
  .marker-swatch:hover .swatch-dot { transform: scale(1.15); }
  .marker-swatch-active .swatch-dot { box-shadow: 0 0 0 3px color-mix(in srgb, var(--swatch) 30%, transparent); transform: scale(1.1); }
  .swatch-label { font-family: var(--font-ui); font-size: 9px; letter-spacing: var(--tracking-wide); color: var(--text-faint); text-transform: capitalize; line-height: 1; }
  .marker-swatch-active .swatch-label { color: var(--text-muted); }

  .marker-textarea { width: 100%; background: var(--bg-raised); border: 1px solid var(--border-strong); border-radius: var(--radius-md); padding: 7px 9px; font-size: var(--text-xs); color: var(--text-secondary); outline: none; resize: none; font-family: inherit; line-height: var(--leading-snug); transition: border-color var(--t-base), box-shadow var(--t-base); }
  .marker-textarea:focus { border-color: var(--accent-marker, var(--border-focus)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-marker, var(--accent)) 18%, transparent); }
  .marker-pop-actions { display: flex; align-items: center; gap: var(--sp-2); }
  .marker-save-btn { display: flex; align-items: center; gap: 5px; padding: 6px 14px; border-radius: var(--radius-sm); border: 1px solid color-mix(in srgb, var(--accent-marker, var(--accent)) 50%, transparent); background: color-mix(in srgb, var(--accent-marker, var(--accent)) 15%, transparent); color: var(--accent-marker, var(--accent-fg)); font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); cursor: pointer; transition: filter var(--t-fast); }
  .marker-save-btn:hover { filter: brightness(1.2); }
  .marker-cancel-btn { flex: 1; padding: 6px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: none; color: var(--text-faint); font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); cursor: pointer; transition: color var(--t-base), border-color var(--t-base); text-align: center; }
  .marker-cancel-btn:hover { color: var(--text-muted); border-color: var(--border-strong); }

  .viewer { flex: 1; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center; -webkit-overflow-scrolling: touch; position: relative; }
  .viewer.strip { justify-content: flex-start; padding: var(--sp-4) 0; }
  .viewer:focus { outline: none; }

  .img { display: block; user-select: none; image-rendering: auto; }
  .img.optimize-contrast { image-rendering: -webkit-optimize-contrast; }
  .fit-width    { max-width: var(--effective-width, 100%); width: 100%; height: auto; }
  .fit-height   { max-height: calc(100vh - 80px); width: auto; max-width: var(--effective-width, 100%); height: auto; }
  .fit-screen   { max-width: var(--effective-width, 100%); max-height: calc(100vh - 80px); object-fit: contain; height: auto; }
  .fit-original { max-width: 100%; width: auto; height: auto; }
  .strip-gap { margin-bottom: 8px; }

  .double-wrap { display: flex; align-items: flex-start; justify-content: center; max-width: calc(var(--effective-width, 100%) * 2); width: 100%; }
  .page-half { flex: 1; min-width: 0; object-fit: contain; }
  .gap-left  { margin-right: 2px; }
  .gap-right { margin-left: 2px; }

  .center-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .error-msg { color: var(--color-error); font-size: var(--text-base); }

  .bottombar { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--sp-3); border-top: 1px solid var(--border-dim); background: var(--bg-void); flex-shrink: 0; transition: opacity 0.25s ease; }
  .nav-btn { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; flex-shrink: 0; border-radius: var(--radius-md); border: 1px solid var(--border-strong); color: var(--text-muted); transition: background var(--t-base), color var(--t-base); }
  .nav-btn:hover:not(:disabled) { background: var(--bg-raised); color: var(--text-primary); }
  .nav-btn:disabled { opacity: 0.25; cursor: default; }

  .slider-wrap { flex: 1; position: relative; display: flex; align-items: center; height: 34px; cursor: pointer; }
  .slider-track-bg { position: absolute; left: 0; right: 0; height: 3px; background: var(--border-strong); border-radius: 2px; overflow: hidden; pointer-events: none; }
  .slider-fill { height: 100%; background: var(--accent-fg); border-radius: 2px; transition: width 0.05s linear; }
  .slider-input { position: absolute; left: 0; right: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; margin: 0; z-index: 2; }
  .slider-checkpoint { position: absolute; top: 50%; width: 4px; height: 10px; border-radius: 2px; transform: translate(-50%, -50%); pointer-events: none; z-index: 1; }
  .bookmark-checkpoint { background: var(--accent-fg); opacity: 0.7; }
  .marker-checkpoint { opacity: 0.85; }
  .slider-tooltip { position: absolute; bottom: calc(100% + 2px); transform: translateX(-50%); background: var(--bg-raised); border: 1px solid var(--border-base); border-radius: var(--radius-sm); padding: 2px 6px; font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-secondary); white-space: nowrap; pointer-events: none; z-index: 10; letter-spacing: var(--tracking-wide); }
  .slider-wrap:hover .slider-track-bg, .slider-wrap.dragging .slider-track-bg { height: 5px; }

  .resume-banner { position: fixed; top: 48px; left: 50%; display: flex; align-items: center; gap: var(--sp-2); background: var(--bg-raised); border: 1px solid var(--border-base); border-radius: var(--radius-lg); padding: 6px var(--sp-3); font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-secondary); z-index: 20; box-shadow: 0 4px 16px rgba(0,0,0,0.4); animation: bannerIn 0.2s cubic-bezier(0.16,1,0.3,1) both; white-space: nowrap; cursor: pointer; text-align: left; }
  .resume-banner.fading { animation: bannerOut 1s ease forwards; }
  @keyframes bannerIn  { from { opacity: 0; transform: translateX(-50%) translateY(-6px) scale(0.97); } to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); } }
  @keyframes bannerOut { from { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); } to { opacity: 0; transform: translateX(-50%) translateY(-4px) scale(0.97); } }

  .dl-backdrop { position: fixed; inset: 0; z-index: calc(var(--z-reader) + 10); display: flex; align-items: flex-start; justify-content: flex-end; padding: 48px var(--sp-4) 0; }
  .dl-modal { background: var(--bg-raised); border: 1px solid var(--border-base); border-radius: var(--radius-xl); padding: var(--sp-3); min-width: 210px; display: flex; flex-direction: column; gap: var(--sp-1); box-shadow: 0 8px 32px rgba(0,0,0,0.6); animation: scaleIn 0.12s ease both; transform-origin: top right; }
  .dl-title { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; padding: 2px var(--sp-2) var(--sp-2); border-bottom: 1px solid var(--border-dim); margin-bottom: var(--sp-1); }
  .dl-option { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; padding: 7px var(--sp-3); border-radius: var(--radius-md); font-size: var(--text-sm); color: var(--text-secondary); background: none; border: none; cursor: pointer; text-align: left; transition: background var(--t-fast), color var(--t-fast); }
  .dl-option:hover:not(:disabled) { background: var(--bg-overlay); color: var(--text-primary); }
  .dl-option:disabled { opacity: 0.3; cursor: default; }
  .dl-sub { font-size: var(--text-xs); color: var(--text-faint); }
  .dl-row { display: flex; align-items: center; gap: var(--sp-2); }
  .dl-stepper { display: flex; align-items: center; gap: 2px; background: var(--bg-overlay); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: hidden; flex-shrink: 0; }
  .dl-step-btn { display: flex; align-items: center; justify-content: center; width: 22px; height: 28px; font-size: var(--text-base); color: var(--text-muted); background: none; border: none; cursor: pointer; line-height: 1; transition: color var(--t-fast), background var(--t-fast); }
  .dl-step-btn:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-raised); }
  .dl-step-btn:disabled { opacity: 0.25; cursor: default; }
  .dl-step-val { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-secondary); min-width: 24px; text-align: center; letter-spacing: var(--tracking-wide); }

  @keyframes scaleIn { from { opacity: 0; transform: scale(0.97) } to { opacity: 1; transform: scale(1) } }
</style>
