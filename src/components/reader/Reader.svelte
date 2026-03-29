<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { X, CaretLeft, CaretRight, ArrowLeft, ArrowRight, Square, Rows, Download, ArrowsLeftRight, ArrowsIn, ArrowsOut, ArrowsVertical, CircleNotch, MagnifyingGlassMinus, MagnifyingGlassPlus } from "phosphor-svelte";
  import { gql, thumbUrl } from "../../lib/client";
  import { FETCH_CHAPTER_PAGES, MARK_CHAPTER_READ, ENQUEUE_DOWNLOAD, ENQUEUE_CHAPTERS_DOWNLOAD } from "../../lib/queries";
  import { store, closeReader, openReader, addHistory, updateSettings, checkAndMarkCompleted, setSettingsOpen } from "../../store/state.svelte";
  import { matchesKeybind, toggleFullscreen, DEFAULT_KEYBINDS } from "../../lib/keybinds";
  import type { FitMode } from "../../store/state.svelte";

  // ─── Constants ────────────────────────────────────────────────────────────────

  const AVG_MIN_PER_PAGE = 0.33;
  const MAX_CACHED       = 10;
  const READ_LINE_PCT    = 0.20;
  // Zoom step per Ctrl+Wheel tick or keyboard shortcut (5% of viewer width)
  const ZOOM_STEP        = 0.05;
  const ZOOM_MIN         = 0.1;
  const ZOOM_MAX         = 4.0;

  // ─── Page cache ───────────────────────────────────────────────────────────────

  const pageCache  = new Map<number, string[]>();
  const inflight   = new Map<number, Promise<string[]>>();
  const cacheOrder: number[] = [];

  function cacheTouch(id: number) {
    const i = cacheOrder.indexOf(id);
    if (i !== -1) cacheOrder.splice(i, 1);
    cacheOrder.push(id);
  }

  function cacheEvict(keep: Set<number>) {
    while (pageCache.size > MAX_CACHED) {
      const victim = cacheOrder.find(id => !keep.has(id));
      if (victim === undefined) break;
      cacheOrder.splice(cacheOrder.indexOf(victim), 1);
      pageCache.delete(victim);
    }
  }

  function fetchPages(chapterId: number, signal?: AbortSignal): Promise<string[]> {
    const cached = pageCache.get(chapterId);
    if (cached) { cacheTouch(chapterId); return Promise.resolve(cached); }
    if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    if (!inflight.has(chapterId)) {
      const p = gql<{ fetchChapterPages: { pages: string[] } }>(FETCH_CHAPTER_PAGES, { chapterId })
        .then(d => {
          const urls = d.fetchChapterPages.pages.map(thumbUrl);
          pageCache.set(chapterId, urls);
          cacheTouch(chapterId);
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

  // ─── Image helpers ────────────────────────────────────────────────────────────

  const aspectCache = new Map<string, number>();
  function preloadImage(url: string) { new Image().src = url; }

  function decodeImage(url: string): Promise<void> {
    return new Promise(resolve => {
      const img = new Image();
      img.onload  = () => { img.decode ? img.decode().then(resolve, resolve) : resolve(); };
      img.onerror = () => resolve();
      img.src = url;
    });
  }

  function measureAspect(url: string): Promise<number> {
    if (aspectCache.has(url)) return Promise.resolve(aspectCache.get(url)!);
    return new Promise(res => {
      const img = new Image();
      img.onload  = () => {
        const r = img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 0.67;
        aspectCache.set(url, r);
        res(r);
      };
      img.onerror = () => res(0.67);
      img.src = url;
    });
  }

  // ─── Types ────────────────────────────────────────────────────────────────────

  interface StripChapter { chapterId: number; chapterName: string; urls: string[]; }

  // ─── DOM refs ─────────────────────────────────────────────────────────────────

  let containerEl: HTMLDivElement;

  // ─── Container width (for resolution-based zoom) ──────────────────────────────
  // Tracked via ResizeObserver so 100% zoom always means "fills the viewer",
  // regardless of screen resolution or window size.

  let containerWidth = $state(0);

  // ─── Zoom anchor (longstrip) ──────────────────────────────────────────────────
  // Before zoom changes the layout we snapshot which image is at the top of the
  // viewport and how far it is from the top edge.  After the DOM re-renders at
  // the new zoom we scroll back so that same image is at the same visual offset,
  // preventing the "random page teleport" that occurs when scrollHeight changes.

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
    // Use rAF to wait for the DOM to finish re-laying out after the zoom change.
    requestAnimationFrame(() => {
      const containerTop = containerEl.getBoundingClientRect().top;
      const newRect      = el.getBoundingClientRect();
      containerEl.scrollTop += (newRect.top - containerTop) - zoomAnchorOffset;
    });
  }

  // ─── UI state ─────────────────────────────────────────────────────────────────

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

  // ─── Non-reactive bookkeeping ─────────────────────────────────────────────────

  let markedRead  = new Set<number>();
  let appending   = false;
  let abortCtrl:  AbortController | null = null;
  let loadingId:  number | null = null;
  let navToken    = 0;
  // Only write history after the user has genuinely moved past the opening page.
  // Prevents the "started on page 1" entry being saved as last position on close.
  let hasNavigated = false;

  // ─── Derived ──────────────────────────────────────────────────────────────────

  const rtl         = $derived(store.settings.readingDirection === "rtl");
  const fit         = $derived((store.settings.fitMode ?? "width") as FitMode);
  const style       = $derived(store.settings.pageStyle ?? "single");
  const zoom        = $derived(store.settings.readerZoom ?? 1.0);
  const autoNext    = $derived(store.settings.autoNextChapter ?? false);
  const markOnNext  = $derived(store.settings.markReadOnNext ?? true);
  const overlayBars = $derived(store.settings.overlayBars ?? false);
  const lastPage    = $derived(store.pageUrls.length);

  // effectiveWidth: how wide the image should be, in pixels.
  // = container width × zoom multiplier. Applied as max-width on the viewer
  // so fit modes (height, screen) can still further constrain the image.
  const effectiveWidth = $derived(
    containerWidth > 0 ? Math.round(containerWidth * zoom) : undefined
  );

  const zoomPct = $derived(Math.round(zoom * 100));

  const displayChapter = $derived(
    style === "longstrip" && autoNext && visibleChapterId
      ? (store.activeChapterList.find(c => c.id === visibleChapterId) ?? store.activeChapter)
      : store.activeChapter
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
    if (style !== "longstrip" || !autoNext) return lastPage;
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
      ? (autoNext && stripChapters.length > 0
          ? stripChapters
          : [{ chapterId: store.activeChapter?.id ?? 0, chapterName: store.activeChapter?.name ?? "", urls: store.pageUrls }])
      : []
  );

  const currentGroup = $derived(
    style === "double" && pageGroups.length
      ? (pageGroups.find(g => g.includes(store.pageNumber)) ?? [store.pageNumber])
      : [store.pageNumber]
  );

  // ─── Chapter loading ──────────────────────────────────────────────────────────

  $effect(() => {
    const ch = store.activeChapter;
    if (ch) untrack(() => loadChapter(ch.id));
  });

  async function loadChapter(id: number) {
    abortCtrl?.abort();
    const ctrl = new AbortController();
    abortCtrl  = ctrl;
    loadingId  = id;
    navToken++;
    appending    = false;
    markedRead   = new Set();
    hasNavigated = false;
    loading      = true;
    error      = null;
    pageGroups = [];
    pageReady  = false;
    stripChapters = [];
    store.pageUrls   = [];
    store.pageNumber = 1;
    try {
      const urls = await fetchPages(id, ctrl.signal);
      if (ctrl.signal.aborted) return;
      store.pageUrls = urls;
      pageReady      = true;
      loading        = false;
    } catch (e: any) {
      if (ctrl.signal.aborted) return;
      error   = e instanceof Error ? e.message : String(e);
      loading = false;
    }
  }

  // ─── Strip initialisation ─────────────────────────────────────────────────────

  $effect(() => {
    if (style === "longstrip" && store.pageUrls.length && store.activeChapter) {
      const ch   = store.activeChapter;
      const urls = store.pageUrls;
      appending = false;
      if (autoNext) {
        stripChapters    = [{ chapterId: ch.id, chapterName: ch.name, urls }];
        visibleChapterId = ch.id;
      } else {
        stripChapters    = [];
        visibleChapterId = null;
      }
      if (containerEl) containerEl.scrollTop = 0;
    }
  });

  $effect(() => { if (style !== "longstrip" && containerEl) containerEl.scrollTop = 0; });

  // ─── Forward append only ──────────────────────────────────────────────────────

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
      .then(urls => {
        urls.forEach(url => measureAspect(url).catch(() => {}));
        urls.slice(0, 6).forEach(preloadImage);
        return urls;
      })
      .then(urls => {
        if (stripChapters.some(c => c.chapterId === next.id)) { appending = false; return; }
        stripChapters = [...stripChapters, { chapterId: next.id, chapterName: next.name, urls }];
        appending = false;
      })
      .catch(() => { appending = false; });
  }

  // ─── Scroll tracking ──────────────────────────────────────────────────────────

  let stripChaptersRef: StripChapter[] = [];
  $effect(() => { stripChaptersRef = stripChapters; });

  let autoNextRef = false;
  $effect(() => { autoNextRef = autoNext; });

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
      if (!autoNextRef) return;
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

  // ─── Observer lifecycle ───────────────────────────────────────────────────────

  let cleanupScroll: () => void = () => {};

  $effect(() => {
    void style;
    if (!containerEl) return;
    untrack(() => {
      cleanupScroll();
      cleanupScroll = setupScrollTracking();
    });
  });

  // ─── Prefetch + cache eviction ────────────────────────────────────────────────

  $effect(() => {
    if (store.activeChapter && store.activeChapterList.length) {
      const idx = store.activeChapterList.findIndex(c => c.id === store.activeChapter!.id);
      if (idx >= 0) {
        const toPin: number[] = [store.activeChapter.id];
        for (let i = 1; i <= 3; i++) {
          const entry = store.activeChapterList[idx + i];
          if (!entry) break;
          toPin.push(entry.id);
          fetchPages(entry.id)
            .then(urls => { const n = i === 1 ? 8 : i === 2 ? 4 : 2; urls.slice(0, n).forEach(preloadImage); })
            .catch(() => {});
        }
        if (idx > 0) {
          toPin.push(store.activeChapterList[idx - 1].id);
          fetchPages(store.activeChapterList[idx - 1].id).catch(() => {});
        }
        cacheEvict(new Set(toPin));
      }
    }
  });

  // ─── Double-page spread computation ──────────────────────────────────────────

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
          const a = aspects[i - 1], nextA = aspects[i] ?? 0;
          if (a > 1.2 || i === snap.length || nextA > 1.2) { groups.push([i++]); }
          else { groups.push(rtl ? [i + 1, i] : [i, i + 1]); i += 2; }
        }
        pageGroups = groups;
      });
      return () => { cancelled = true; };
    } else { pageGroups = []; }
  });

  // ─── Preload around current page ─────────────────────────────────────────────

  $effect(() => {
    const ahead = store.settings.preloadPages ?? 3;
    for (let i = 1; i <= ahead; i++) { const url = store.pageUrls[store.pageNumber - 1 + i]; if (url) decodeImage(url); }
    const behind = store.pageUrls[store.pageNumber - 2];
    if (behind) preloadImage(behind);
  });

  // ─── Progress / history tracking ─────────────────────────────────────────────

  $effect(() => {
    const ch = displayChapter ?? store.activeChapter;
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
        addHistory({ mangaId, mangaTitle, thumbnailUrl: thumb, chapterId, chapterName, pageNumber: pageNum, readAt: Date.now() });
        if (style !== "longstrip" && store.settings.autoMarkRead && atLast) markChapterRead(chapterId);
      });
    }
  });

  // ─── Mark read ────────────────────────────────────────────────────────────────

  function markChapterRead(id: number) {
    if (markedRead.has(id)) return;
    markedRead.add(id);
    const chapter = store.activeChapterList.find(c => c.id === id) ?? store.activeChapter;
    const pages   = chapter?.pageCount ?? store.pageUrls.length ?? 15;
    const minutes = Math.max(1, Math.round(pages * AVG_MIN_PER_PAGE));
    if (store.activeManga && chapter) {
      addHistory(
        { mangaId: store.activeManga.id, mangaTitle: store.activeManga.title, thumbnailUrl: store.activeManga.thumbnailUrl, chapterId: id, chapterName: chapter.name, pageNumber: pages, readAt: Date.now() },
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

  // ─── Navigation ───────────────────────────────────────────────────────────────

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

  function goForward() {
    if (loading) return;
    if (style === "longstrip") { if (adjacent.next) { maybeMarkCurrentRead(); openReader(adjacent.next, store.activeChapterList); } return; }
    if (style === "double" && pageGroups.length) { advanceGroup(true); return; }
    if (!store.pageUrls.length) return;
    if (store.pageNumber < lastPage) {
      const target = store.pageNumber + 1;
      const token  = ++navToken;
      decodeImage(store.pageUrls[target - 1]).then(() => {
        if (navToken === token && store.pageNumber === target - 1) store.pageNumber = target;
      });
    } else if (adjacent.next) { maybeMarkCurrentRead(); store.pageNumber = 1; openReader(adjacent.next, store.activeChapterList); }
    else closeReader();
  }

  function goBack() {
    if (loading) return;
    if (style === "longstrip") { if (adjacent.prev) openReader(adjacent.prev, store.activeChapterList); return; }
    if (style === "double" && pageGroups.length) { advanceGroup(false); return; }
    if (!store.pageUrls.length) return;
    if (store.pageNumber > 1) {
      const target = store.pageNumber - 1;
      const token  = ++navToken;
      decodeImage(store.pageUrls[target - 1]).then(() => {
        if (navToken === token && store.pageNumber === target + 1) store.pageNumber = target;
      });
    } else if (adjacent.prev) openReader(adjacent.prev, store.activeChapterList);
  }

  const goNext = $derived(rtl ? goBack    : goForward);
  const goPrev = $derived(rtl ? goForward : goBack);

  // ─── Zoom helpers ─────────────────────────────────────────────────────────────

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

  // ─── Settings toggles ─────────────────────────────────────────────────────────

  function cycleStyle() {
    const opts = ["single", "longstrip"] as const;
    const cur  = style === "double" ? "single" : style;
    updateSettings({ pageStyle: opts[(opts.indexOf(cur as typeof opts[number]) + 1) % opts.length] });
  }

  function cycleFit() {
    const opts: FitMode[] = ["width", "height", "screen", "original"];
    updateSettings({ fitMode: opts[(opts.indexOf(fit) + 1) % opts.length] });
  }

  // ─── UI helpers ───────────────────────────────────────────────────────────────

  function showUi() {
    uiVisible = true;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => uiVisible = false, 3000);
  }

  function onWheel(e: WheelEvent) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    // Each wheel tick adjusts by ZOOM_STEP (5%). Larger deltaY = bigger scroll = same step.
    adjustZoom(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
  }

  function onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const kb = store.settings.keybinds ?? DEFAULT_KEYBINDS;
    const r  = store.settings.readingDirection === "rtl";
    if (e.key === "Escape") {
      e.preventDefault();
      if (zoomOpen) { zoomOpen = false; return; }
      if (dlOpen)   { dlOpen   = false; return; }
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
      const list = store.activeChapterList, idx = list.findIndex(c => c.id === loadingId);
      const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
      if (next) { maybeMarkCurrentRead(); openReader(next, list); }
    }
    else if (matchesKeybind(e, kb.chapterLeft)) {
      e.preventDefault();
      const list = store.activeChapterList, idx = list.findIndex(c => c.id === loadingId);
      const prev = idx > 0 ? list[idx - 1] : null;
      if (prev) openReader(prev, list);
    }
    else if (matchesKeybind(e, kb.togglePageStyle))        { e.preventDefault(); cycleStyle(); }
    else if (matchesKeybind(e, kb.toggleReadingDirection)) { e.preventDefault(); updateSettings({ readingDirection: r ? "ltr" : "rtl" }); }
    else if (matchesKeybind(e, kb.toggleFullscreen))       { e.preventDefault(); toggleFullscreen().catch(console.error); }
    else if (matchesKeybind(e, kb.openSettings))           { e.preventDefault(); setSettingsOpen(true); }
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

  // ─── Mount / unmount ──────────────────────────────────────────────────────────

  onMount(() => {
    showUi();
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: false });
    containerEl?.focus({ preventScroll: true });

    // Track the viewer's actual paint width so zoom is always relative to it.
    const ro = new ResizeObserver(entries => {
      containerWidth = entries[0].contentRect.width;
    });
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
    <button class="icon-btn" onclick={closeReader} title="Close reader"><X size={15} weight="light" /></button>
    <button class="icon-btn" onclick={() => { if (adjacent.prev) { maybeMarkCurrentRead(); openReader(adjacent.prev, store.activeChapterList); } }} disabled={!adjacent.prev}>
      <CaretLeft size={14} weight="light" />
    </button>
    <span class="ch-label">
      <span class="ch-title">{store.activeManga?.title}</span>
      <span class="ch-sep">/</span>
      <span>{displayChapter?.name}</span>
    </span>
    <span class="page-label">{store.pageNumber} / {visibleChunkLastPage || "…"}</span>
    <button class="icon-btn" onclick={() => { if (adjacent.next) { maybeMarkCurrentRead(); openReader(adjacent.next, store.activeChapterList); } }} disabled={!adjacent.next}>
      <CaretRight size={14} weight="light" />
    </button>
    <div class="top-sep"></div>
    <button class="mode-btn" onclick={cycleFit}>
      {#if fit === "width"}<ArrowsLeftRight size={14} weight="light" />
      {:else if fit === "height"}<ArrowsVertical size={14} weight="light" />
      {:else if fit === "screen"}<ArrowsIn size={14} weight="light" />
      {:else}<ArrowsOut size={14} weight="light" />{/if}
      <span class="mode-label">{fitLabel}</span>
    </button>

    <!-- ── Zoom controls ────────────────────────────────────────────────────── -->
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
            <input type="range" class="zoom-slider" min={10} max={400} step={5} value={zoomPct}
              oninput={(e) => { captureZoomAnchor(); updateSettings({ readerZoom: clampZoom(Number(e.currentTarget.value) / 100) }); restoreZoomAnchor(); }} />
          </div>
          <div class="zoom-presets">
            {#each [50, 75, 100, 125, 150, 200] as pct}
              <button class="zoom-preset" class:active={zoomPct === pct}
                onclick={() => { captureZoomAnchor(); updateSettings({ readerZoom: pct / 100 }); restoreZoomAnchor(); }}>{pct}%</button>
            {/each}
          </div>
          <button class="zoom-reset" onclick={resetZoom} disabled={zoom === 1.0}>Reset</button>
        </div>
      {/if}
    </div>

    <button class="mode-btn" class:active={rtl} onclick={() => updateSettings({ readingDirection: rtl ? "ltr" : "rtl" })}>
      <ArrowsLeftRight size={14} weight="light" /><span class="mode-label">{rtl ? "RTL" : "LTR"}</span>
    </button>
    <button class="mode-btn" onclick={cycleStyle}>
      {#if style === "single"}<Square size={14} weight="light" />{:else}<Rows size={14} weight="light" />{/if}
      <span class="mode-label">{style}</span>
    </button>
    {#if style !== "single"}
      <button class="mode-btn" class:active={store.settings.pageGap} onclick={() => updateSettings({ pageGap: !store.settings.pageGap })}>
        <span class="mode-label">Gap</span>
      </button>
    {/if}
    {#if style === "longstrip"}
      <button class="mode-btn" class:active={autoNext} onclick={() => updateSettings({ autoNextChapter: !autoNext })}>
        <span class="mode-label">Auto</span>
      </button>
    {/if}
    {#if !autoNext}
      <button class="mode-btn" class:active={markOnNext} onclick={() => updateSettings({ markReadOnNext: !markOnNext })}>
        <span class="mode-label">Mk.Read</span>
      </button>
    {/if}
    <button class="mode-btn" onclick={() => dlOpen = true}>
      <Download size={14} weight="light" />
    </button>
  </div>

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
          <img
            src={url}
            alt="{chunk.chapterName} – Page {i + 1}"
            data-local-page={i + 1}
            data-chapter={chunk.chapterId}
            data-total={chunk.urls.length}
            class="{imgCls}{store.settings.pageGap ? ' strip-gap' : ''}"
            loading={i < 3 ? "eager" : "lazy"}
            decoding="async"
          />
        {/each}
      {/each}
      <div style="height:1px;flex-shrink:0"></div>
    {:else if pageReady}
      {#if style === "double" && pageGroups.length}
        <div class="double-wrap">
          {#each currentGroup as pg}
            <img src={store.pageUrls[pg - 1]} alt="Page {pg}" class="{imgCls} page-half {pg === currentGroup[0] ? 'gap-left' : 'gap-right'}" decoding="async" />
          {/each}
        </div>
      {:else}
        <img src={store.pageUrls[store.pageNumber - 1]} alt="Page {store.pageNumber}" class={imgCls} decoding="async" style="transition:opacity 0.1s ease" />
      {/if}
    {/if}
  </div>

  <div class="bottombar" class:hidden={!uiVisible}>
    <button class="nav-btn" onclick={goBack} disabled={loading || (style === "longstrip" ? !adjacent.prev : (store.pageNumber === 1 && !adjacent.prev))}>
      {#if rtl}<ArrowRight size={13} weight="light" />{:else}<ArrowLeft size={13} weight="light" />{/if}
    </button>
    <button class="nav-btn" onclick={goForward} disabled={loading || (style === "longstrip" ? !adjacent.next : (store.pageNumber === lastPage && !adjacent.next))}>
      {#if rtl}<ArrowLeft size={13} weight="light" />{:else}<ArrowRight size={13} weight="light" />{/if}
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
  .topbar { display: flex; align-items: center; gap: var(--sp-1); padding: 0 var(--sp-3); height: 40px; background: var(--bg-void); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; position: relative; z-index: 2; transition: opacity 0.25s ease; }
  .topbar.hidden, .bottombar.hidden { opacity: 0; pointer-events: none; }
  .icon-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--radius-sm); color: var(--text-muted); flex-shrink: 0; transition: color var(--t-base), background var(--t-base); }
  .icon-btn:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-raised); }
  .icon-btn:disabled { opacity: 0.2; cursor: default; }
  .ch-label { flex: 1; display: flex; align-items: center; gap: var(--sp-2); font-size: var(--text-sm); color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ch-title { color: var(--text-secondary); font-weight: var(--weight-medium); }
  .ch-sep   { color: var(--text-faint); }
  .page-label { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-muted); letter-spacing: var(--tracking-wide); flex-shrink: 0; }
  .top-sep { width: 1px; height: 16px; background: var(--border-dim); flex-shrink: 0; margin: 0 var(--sp-1); }
  .mode-btn { display: flex; align-items: center; gap: 4px; padding: 4px var(--sp-2); border-radius: var(--radius-sm); color: var(--text-muted); flex-shrink: 0; font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); transition: color var(--t-base), background var(--t-base); }
  .mode-btn:hover { color: var(--text-primary); background: var(--bg-raised); }
  .mode-btn.active { color: var(--accent-fg); background: var(--accent-muted); }
  .mode-label { text-transform: capitalize; }

  /* ── Zoom controls ───────────────────────────────────────────────────────── */
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
  .zoom-presets { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; }
  .zoom-preset { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); color: var(--text-muted); padding: 3px 6px; border-radius: var(--radius-sm); transition: color var(--t-base), background var(--t-base); }
  .zoom-preset:hover { color: var(--text-primary); background: var(--bg-overlay); }
  .zoom-preset.active { color: var(--accent-fg); background: var(--accent-muted); }
  .zoom-reset { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-muted); letter-spacing: var(--tracking-wide); padding: 3px var(--sp-2); border-radius: var(--radius-sm); border: 1px solid var(--border-dim); transition: color var(--t-base), background var(--t-base), border-color var(--t-base); }
  .zoom-reset:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-overlay); border-color: var(--border-strong); }
  .zoom-reset:disabled { opacity: 0.3; cursor: default; }

  /* ── Viewer ──────────────────────────────────────────────────────────────── */
  .viewer { flex: 1; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center; -webkit-overflow-scrolling: touch; position: relative; }
  .viewer.strip { justify-content: flex-start; padding: var(--sp-4) 0; }
  .viewer:focus { outline: none; }
  .img { display: block; user-select: none; image-rendering: auto; }
  .img.optimize-contrast { image-rendering: -webkit-optimize-contrast; }

  /*
   * Fit modes — all constrain within --effective-width (the zoom-adjusted
   * container width). effectiveWidth is set as a CSS variable on .viewer
   * so every fit class automatically respects the current zoom level.
   *
   * fit-width  : fills up to effectiveWidth, never wider
   * fit-height : constrained to viewport height; never taller, never wider than effectiveWidth
   * fit-screen : fits within both axes (contain); never wider than effectiveWidth
   * fit-original : natural image size, no constraint
   */
  .fit-width    { max-width: var(--effective-width, 100%); width: 100%; height: auto; }
  .fit-height   { max-height: calc(100vh - 80px); width: auto; max-width: var(--effective-width, 100%); height: auto; }
  .fit-screen   { max-width: var(--effective-width, 100%); max-height: calc(100vh - 80px); object-fit: contain; height: auto; }
  .fit-original { max-width: none; width: auto; height: auto; }

  .strip-gap { margin-bottom: 8px; }
  .double-wrap { display: flex; align-items: flex-start; justify-content: center; max-width: calc(var(--effective-width, 100%) * 2); width: 100%; }
  .page-half { flex: 1; min-width: 0; object-fit: contain; }
  .gap-left  { margin-right: 2px; }
  .gap-right { margin-left: 2px; }
  .center-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .error-msg { color: var(--color-error); font-size: var(--text-base); }
  .bottombar { display: flex; align-items: center; justify-content: center; gap: var(--sp-4); padding: var(--sp-3); border-top: 1px solid var(--border-dim); background: var(--bg-void); flex-shrink: 0; transition: opacity 0.25s ease; }
  .nav-btn { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: var(--radius-md); border: 1px solid var(--border-strong); color: var(--text-muted); transition: background var(--t-base), color var(--t-base); }
  .nav-btn:hover:not(:disabled) { background: var(--bg-raised); color: var(--text-primary); }
  .nav-btn:disabled { opacity: 0.25; cursor: default; }
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
