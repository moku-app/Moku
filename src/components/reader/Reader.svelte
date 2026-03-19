<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import {
    X, CaretLeft, CaretRight, ArrowLeft, ArrowRight,
    Square, Rows, Download, ArrowsLeftRight,
    ArrowsIn, ArrowsOut, ArrowsVertical, CircleNotch,
  } from "phosphor-svelte";
  import { gql, thumbUrl } from "../../lib/client";
  import { FETCH_CHAPTER_PAGES, MARK_CHAPTER_READ, ENQUEUE_DOWNLOAD, ENQUEUE_CHAPTERS_DOWNLOAD } from "../../lib/queries";
  import { settings, activeManga, activeChapter, activeChapterList, pageUrls, pageNumber, closeReader, openReader, settingsOpen, addHistory, updateSettings } from "../../store";
  import { matchesKeybind, toggleFullscreen, DEFAULT_KEYBINDS } from "../../lib/keybinds";
  import type { FitMode } from "../../store";

  // ── Page cache ────────────────────────────────────────────────────────────────
  const pageCache  = new Map<number, string[]>();
  const inflight   = new Map<number, Promise<string[]>>();
  const cacheOrder: number[] = [];
  const MAX_CACHED = 10;

  function cacheTouch(id: number) {
    const i = cacheOrder.indexOf(id);
    if (i !== -1) cacheOrder.splice(i, 1);
    cacheOrder.push(id);
  }

  function cacheEvict(keep: Set<number>) {
    while (pageCache.size > MAX_CACHED) {
      const victim = cacheOrder.find((id) => !keep.has(id));
      if (!victim) break;
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
        .then((d) => {
          const urls = d.fetchChapterPages.pages.map(thumbUrl);
          pageCache.set(chapterId, urls); cacheTouch(chapterId); return urls;
        }).finally(() => inflight.delete(chapterId));
      inflight.set(chapterId, p);
    }
    const base = inflight.get(chapterId)!;
    if (!signal) return base;
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      base.then(resolve, reject);
    });
  }

  // ── Image helpers ─────────────────────────────────────────────────────────────
  const aspectCache = new Map<string, number>();

  function preloadImage(url: string) { new Image().src = url; }

  function decodeImage(url: string): Promise<void> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload  = () => { img.decode ? img.decode().then(resolve, resolve) : resolve(); };
      img.onerror = () => resolve();
      img.src = url;
    });
  }

  function measureAspect(url: string): Promise<number> {
    if (aspectCache.has(url)) return Promise.resolve(aspectCache.get(url)!);
    return new Promise((res) => {
      const img = new Image();
      img.onload  = () => { const r = img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 0.67; aspectCache.set(url, r); res(r); };
      img.onerror = () => res(0.67);
      img.src = url;
    });
  }

  // ── State ─────────────────────────────────────────────────────────────────────
  interface StripChapter { chapterId: number; chapterName: string; urls: string[]; startGlobalIdx: number; }

  let containerEl: HTMLDivElement;
  let sentinelEl: HTMLDivElement;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  let loading         = true;
  let error: string | null = null;
  let dlOpen          = false;
  let zoomOpen        = false;
  let uiVisible       = true;
  let pageReady       = false;
  let pageGroups: number[][] = [];
  let stripChapters: StripChapter[] = [];
  let visibleChapterId: number | null = null;
  let nextN           = 5;
  let dlBusy          = false;

  let markedRead   = new Set<number>();
  let appended     = new Set<number>();
  let appending    = false;
  let abortCtrl: AbortController | null = null;
  let loadingId: number | null = null;
  let scrollAnchor: { scrollTop: number; scrollHeight: number } | null = null;

  $: rtl         = $settings.readingDirection === "rtl";
  $: fit         = ($settings.fitMode ?? "width") as FitMode;
  $: style       = $settings.pageStyle ?? "single";
  $: maxW        = $settings.maxPageWidth ?? 900;
  $: autoNext    = $settings.autoNextChapter ?? false;
  $: markOnNext  = $settings.markReadOnNext ?? true;
  $: lastPage    = $pageUrls.length;

  $: displayChapter = (style === "longstrip" && autoNext && visibleChapterId)
    ? ($activeChapterList.find((c) => c.id === visibleChapterId) ?? $activeChapter)
    : $activeChapter;

  $: adjacent = (() => {
    const ref = displayChapter ?? $activeChapter;
    if (!ref || !$activeChapterList.length) return { prev: null, next: null, remaining: [] };
    const idx = $activeChapterList.findIndex((c) => c.id === ref.id);
    return {
      prev:      idx > 0                                ? $activeChapterList[idx - 1] : null,
      next:      idx < $activeChapterList.length - 1   ? $activeChapterList[idx + 1] : null,
      remaining: $activeChapterList.slice(idx + 1),
    };
  })();

  $: visibleChunkLastPage = (() => {
    if (style !== "longstrip" || !autoNext) return lastPage;
    const chId  = visibleChapterId ?? $activeChapter?.id;
    const chunk = stripChapters.find((c) => c.chapterId === chId);
    return chunk?.urls.length ?? lastPage;
  })();

  $: imgCls = [
    "img",
    fit === "width"    && "fit-width",
    fit === "height"   && "fit-height",
    fit === "screen"   && "fit-screen",
    fit === "original" && "fit-original",
    $settings.optimizeContrast && "optimize-contrast",
  ].filter(Boolean).join(" ");

  $: fitLabel = { width: "Fit W", height: "Fit H", screen: "Fit Screen", original: "1:1" }[fit];
  $: styleLabel = style;

  function maybeMarkCurrentRead() {
    const ch = $activeChapter;
    if (!ch || !markOnNext || markedRead.has(ch.id)) return;
    markedRead.add(ch.id);
    gql(MARK_CHAPTER_READ, { id: ch.id, isRead: true }).catch((e) => { markedRead.delete(ch.id); console.error(e); });
  }

  function showUi() {
    uiVisible = true;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => uiVisible = false, 3000);
  }

  // ── Load chapter ──────────────────────────────────────────────────────────────
  $: if ($activeChapter) {
    loadChapter($activeChapter.id);
  }

  async function loadChapter(id: number) {
    abortCtrl?.abort();
    const ctrl = new AbortController();
    abortCtrl = ctrl;
    loadingId  = id;
    appended   = new Set([id]);
    appending  = false;
    markedRead = new Set();
    aspectCache.clear();
    loading    = true;
    error      = null;
    pageGroups = [];
    pageReady  = false;
    stripChapters     = [];
    visibleChapterId  = null;
    pageUrls.set([]);
    pageNumber.set(1);

    try {
      const urls = await fetchPages(id, ctrl.signal);
      if (ctrl.signal.aborted) return;
      pageUrls.set(urls);
      pageReady = true;
      if (style === "longstrip" && autoNext) {
        stripChapters    = [{ chapterId: id, chapterName: $activeChapter?.name ?? "", urls, startGlobalIdx: 0 }];
        visibleChapterId = id;
      }
      loading = false;
    } catch (e: any) {
      if (ctrl.signal.aborted) return;
      error   = e instanceof Error ? e.message : String(e);
      loading = false;
    }
  }

  // ── Append next chapter ───────────────────────────────────────────────────────
  function appendNextChapter() {
    if (appending) return;
    const lastChunk = stripChapters[stripChapters.length - 1];
    if (!lastChunk) return;
    const list    = $activeChapterList;
    const lastIdx = list.findIndex((c) => c.id === lastChunk.chapterId);
    if (lastIdx < 0 || lastIdx >= list.length - 1) return;
    const next = list[lastIdx + 1];
    if (!next || appended.has(next.id)) return;
    appended.add(next.id);
    appending = true;
    fetchPages(next.id)
      .then((urls) => {
        urls.forEach((url) => measureAspect(url).catch(() => {}));
        urls.slice(0, 6).forEach(preloadImage);
        return urls;
      })
      .then((urls) => {
        if (stripChapters.some((c) => c.chapterId === next.id)) return;
        const last = stripChapters[stripChapters.length - 1];
        const start = last ? last.startGlobalIdx + last.urls.length : 0;
        const MAX_STRIP = 8;
        if (stripChapters.length >= MAX_STRIP && containerEl) {
          scrollAnchor = { scrollTop: containerEl.scrollTop, scrollHeight: containerEl.scrollHeight };
          stripChapters = [...stripChapters.slice(1), { chapterId: next.id, chapterName: next.name, urls, startGlobalIdx: start }];
          tick().then(() => {
            if (!scrollAnchor || !containerEl) return;
            const gained = containerEl.scrollHeight - scrollAnchor.scrollHeight;
            if (gained < 0) containerEl.scrollTop = Math.max(0, scrollAnchor.scrollTop + gained);
            scrollAnchor = null;
          });
        } else {
          stripChapters = [...stripChapters, { chapterId: next.id, chapterName: next.name, urls, startGlobalIdx: start }];
        }
        appending = false;
      })
      .catch(() => { appending = false; });
  }

  // ── Scroll tracking ───────────────────────────────────────────────────────────
  function setupScrollTracking() {
    if (!containerEl || style !== "longstrip") return;
    const READ_LINE_PCT = 0.20;
    function onScroll() {
      const containerTop = containerEl.getBoundingClientRect().top;
      const readLineY    = containerTop + containerEl.clientHeight * READ_LINE_PCT;
      const imgs = containerEl.querySelectorAll<HTMLElement>("img[data-local-page]");
      let activeLocalPage: number | null = null;
      let activeChId: number | null = null;
      for (const img of imgs) {
        const rect = img.getBoundingClientRect();
        if (rect.top <= readLineY) { activeLocalPage = Number(img.dataset.localPage); activeChId = Number(img.dataset.chapter); }
        else break;
      }
      if (activeLocalPage === null && imgs.length > 0) { activeLocalPage = Number(imgs[0].dataset.localPage); activeChId = Number(imgs[0].dataset.chapter); }
      if (activeLocalPage !== null) pageNumber.set(activeLocalPage);
      if (activeChId && activeChId !== visibleChapterId) visibleChapterId = activeChId;
      if ($settings.autoMarkRead && activeLocalPage !== null && activeChId) {
        const chunk = stripChapters.find((c) => c.chapterId === activeChId);
        const total = chunk ? chunk.urls.length : $pageUrls.length;
        if (total > 0 && activeLocalPage >= total - 1 && !markedRead.has(activeChId)) {
          markedRead.add(activeChId);
          gql(MARK_CHAPTER_READ, { id: activeChId, isRead: true }).catch((e) => { markedRead.delete(activeChId!); console.error(e); });
        }
      }
      if (containerEl.scrollTop + containerEl.clientHeight < containerEl.scrollHeight - 40) return;
      const last = stripChapters[stripChapters.length - 1];
      if (last && $settings.autoMarkRead && !markedRead.has(last.chapterId)) {
        markedRead.add(last.chapterId);
        gql(MARK_CHAPTER_READ, { id: last.chapterId, isRead: true }).catch(console.error);
      }
    }
    function onScroll80() {
      const pct = (containerEl.scrollTop + containerEl.clientHeight) / containerEl.scrollHeight;
      if (pct >= 0.8) appendNextChapter();
    }
    containerEl.addEventListener("scroll", onScroll, { passive: true });
    if (autoNext) containerEl.addEventListener("scroll", onScroll80, { passive: true });
    onScroll();
    return () => {
      containerEl.removeEventListener("scroll", onScroll);
      containerEl.removeEventListener("scroll", onScroll80);
    };
  }

  // ── Navigation ────────────────────────────────────────────────────────────────
  function advanceGroup(forward: boolean) {
    if (!pageGroups.length) return;
    const gi = pageGroups.findIndex((g) => g.includes($pageNumber));
    if (forward) {
      if (gi < pageGroups.length - 1) pageNumber.set(pageGroups[gi + 1][0]);
      else if (adjacent.next) { pageNumber.set(1); openReader(adjacent.next, $activeChapterList); }
      else closeReader();
    } else {
      if (gi > 0) pageNumber.set(pageGroups[gi - 1][0]);
      else if (adjacent.prev) openReader(adjacent.prev, $activeChapterList);
    }
  }

  function goForward() {
    if (loading) return;
    if (style === "longstrip") { if (adjacent.next) { maybeMarkCurrentRead(); openReader(adjacent.next, $activeChapterList); } return; }
    if (style === "double" && pageGroups.length) { advanceGroup(true); return; }
    if (!$pageUrls.length) return;
    if ($pageNumber < lastPage) { decodeImage($pageUrls[$pageNumber]).then(() => pageNumber.set($pageNumber + 1)); }
    else if (adjacent.next) { maybeMarkCurrentRead(); pageNumber.set(1); openReader(adjacent.next, $activeChapterList); }
    else closeReader();
  }

  function goBack() {
    if (loading) return;
    if (style === "longstrip") { if (adjacent.prev) openReader(adjacent.prev, $activeChapterList); return; }
    if (style === "double" && pageGroups.length) { advanceGroup(false); return; }
    if (!$pageUrls.length) return;
    if ($pageNumber > 1) { decodeImage($pageUrls[$pageNumber - 2]).then(() => pageNumber.set($pageNumber - 1)); }
    else if (adjacent.prev) openReader(adjacent.prev, $activeChapterList);
  }

  $: goNext = rtl ? goBack  : goForward;
  $: goPrev = rtl ? goForward : goBack;

  function cycleStyle() {
    const opts = ["single", "longstrip"] as const;
    const cur  = style === "double" ? "single" : style;
    updateSettings({ pageStyle: opts[(opts.indexOf(cur as typeof opts[number]) + 1) % opts.length] });
  }

  function cycleFit() {
    const opts: FitMode[] = ["width", "height", "screen", "original"];
    updateSettings({ fitMode: opts[(opts.indexOf(fit) + 1) % opts.length] });
  }

  // ── History + auto-mark (non-longstrip) ──────────────────────────────────────
  $: if ($activeChapter && lastPage && $activeManga) {
    addHistory({
      mangaId: $activeManga.id, mangaTitle: $activeManga.title,
      thumbnailUrl: $activeManga.thumbnailUrl, chapterId: $activeChapter.id,
      chapterName: $activeChapter.name, pageNumber: $pageNumber, readAt: Date.now(),
    });
    if (style !== "longstrip" && $settings.autoMarkRead && $pageNumber === lastPage) {
      if (!markedRead.has($activeChapter.id)) {
        markedRead.add($activeChapter.id);
        gql(MARK_CHAPTER_READ, { id: $activeChapter.id, isRead: true }).catch(console.error);
      }
    }
  }

  // ── Double-page grouping ──────────────────────────────────────────────────────
  $: if (style === "double" && $pageUrls.length) {
    let cancelled = false;
    const snap = $pageUrls;
    Promise.all(snap.map(measureAspect)).then((aspects) => {
      if (cancelled || snap !== $pageUrls) return;
      const offset = $settings.offsetDoubleSpreads;
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
  } else { pageGroups = []; }

  // ── Preload pages ─────────────────────────────────────────────────────────────
  $: {
    const ahead = $settings.preloadPages ?? 3;
    for (let i = 1; i <= ahead; i++) { const url = $pageUrls[$pageNumber - 1 + i]; if (url) decodeImage(url); }
    const behind = $pageUrls[$pageNumber - 2];
    if (behind) preloadImage(behind);
  }

  // ── Prefetch next chapters ────────────────────────────────────────────────────
  $: if ($activeChapter && $activeChapterList.length) {
    const idx = $activeChapterList.findIndex((c) => c.id === $activeChapter!.id);
    if (idx >= 0) {
      const toPin: number[] = [$activeChapter.id];
      for (let i = 1; i <= 3; i++) {
        const entry = $activeChapterList[idx + i];
        if (!entry) break;
        toPin.push(entry.id);
        fetchPages(entry.id).then((urls) => { const n = i === 1 ? 8 : i === 2 ? 4 : 2; urls.slice(0, n).forEach(preloadImage); }).catch(() => {});
      }
      if (idx > 0) { const prev = $activeChapterList[idx - 1]; toPin.push(prev.id); fetchPages(prev.id).catch(() => {}); }
      cacheEvict(new Set(toPin));
    }
  }

  // ── Rebuild strip on autoNext toggle ─────────────────────────────────────────
  $: if (style === "longstrip" && $pageUrls.length && $activeChapter) {
    appended  = new Set([$activeChapter.id]);
    appending = false;
    if (autoNext) {
      stripChapters    = [{ chapterId: $activeChapter.id, chapterName: $activeChapter.name, urls: $pageUrls, startGlobalIdx: 0 }];
      visibleChapterId = $activeChapter.id;
    } else {
      stripChapters    = [];
      visibleChapterId = null;
    }
    if (containerEl) containerEl.scrollTop = 0;
  }

  // ── Scroll to top on chapter/page change ─────────────────────────────────────
  $: if ($activeChapter?.id && containerEl) containerEl.scrollTop = 0;
  $: if (style !== "longstrip" && containerEl) containerEl.scrollTop = 0;

  // ── Ctrl+scroll zoom ─────────────────────────────────────────────────────────
  function onWheel(e: WheelEvent) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    updateSettings({ maxPageWidth: Math.min(2400, Math.max(200, maxW + (e.deltaY < 0 ? 50 : -50))) });
  }

  // ── Keybinds ──────────────────────────────────────────────────────────────────
  function onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const kb  = $settings.keybinds ?? DEFAULT_KEYBINDS;
    const mW  = $settings.maxPageWidth ?? 900;
    const r   = $settings.readingDirection === "rtl";
    if (e.key === "Escape") {
      e.preventDefault();
      if (zoomOpen) { zoomOpen = false; return; }
      if (dlOpen)   { dlOpen   = false; return; }
      closeReader(); return;
    }
    if (e.ctrlKey && (e.key === "=" || e.key === "+")) { e.preventDefault(); updateSettings({ maxPageWidth: Math.min(2400, mW + 100) }); return; }
    if (e.ctrlKey && e.key === "-")                    { e.preventDefault(); updateSettings({ maxPageWidth: Math.max(200,  mW - 100) }); return; }
    if (e.ctrlKey && e.key === "0")                    { e.preventDefault(); updateSettings({ maxPageWidth: 900 }); return; }
    if      (matchesKeybind(e, kb.exitReader))             { e.preventDefault(); closeReader(); }
    else if (matchesKeybind(e, kb.pageRight))              { e.preventDefault(); goForward(); }
    else if (matchesKeybind(e, kb.pageLeft))               { e.preventDefault(); goBack(); }
    else if (matchesKeybind(e, kb.firstPage))              { e.preventDefault(); pageNumber.set(1); }
    else if (matchesKeybind(e, kb.lastPage))               { e.preventDefault(); pageNumber.set(lastPage); }
    else if (matchesKeybind(e, kb.chapterRight)) {
      e.preventDefault();
      const list = $activeChapterList, idx = list.findIndex((c) => c.id === loadingId);
      const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
      if (next) { maybeMarkCurrentRead(); openReader(next, list); }
    }
    else if (matchesKeybind(e, kb.chapterLeft)) {
      e.preventDefault();
      const list = $activeChapterList, idx = list.findIndex((c) => c.id === loadingId);
      const prev = idx > 0 ? list[idx - 1] : null;
      if (prev) openReader(prev, list);
    }
    else if (matchesKeybind(e, kb.togglePageStyle))        { e.preventDefault(); cycleStyle(); }
    else if (matchesKeybind(e, kb.toggleReadingDirection)) { e.preventDefault(); updateSettings({ readingDirection: r ? "ltr" : "rtl" }); }
    else if (matchesKeybind(e, kb.toggleFullscreen))       { e.preventDefault(); toggleFullscreen().catch(console.error); }
    else if (matchesKeybind(e, kb.openSettings))           { e.preventDefault(); settingsOpen.set(true); }
  }

  function handleTap(e: MouseEvent) {
    if (style === "longstrip") return;
    const x = e.clientX / window.innerWidth;
    if (!rtl) { if (x > 0.6) goForward(); else if (x < 0.4) goBack(); }
    else       { if (x < 0.4) goForward(); else if (x > 0.6) goBack(); }
  }

  async function runDl(fn: () => Promise<unknown>, body: string) {
    dlBusy = true;
    try {
      await fn();
    } catch (e: any) { console.error(e); }
    dlBusy = false; dlOpen = false;
  }

  let scrollCleanup: (() => void) | undefined;

  onMount(() => {
    showUi();
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: false });
    containerEl?.focus({ preventScroll: true });
    scrollCleanup = setupScrollTracking();
  });

  onDestroy(() => {
    abortCtrl?.abort();
    if (hideTimer) clearTimeout(hideTimer);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("wheel", onWheel);
    scrollCleanup?.();
  });

  $: stripToRender = style === "longstrip"
    ? (autoNext && stripChapters.length > 0
        ? stripChapters
        : [{ chapterId: $activeChapter?.id ?? 0, chapterName: $activeChapter?.name ?? "", urls: $pageUrls, startGlobalIdx: 0 }])
    : [];

  $: currentGroup = style === "double" && pageGroups.length
    ? (pageGroups.find((g) => g.includes($pageNumber)) ?? [$pageNumber])
    : [$pageNumber];
</script>

<div class="root" on:mousemove={(e) => { if (e.clientY < 60 || window.innerHeight - e.clientY < 60) showUi(); }}>

  <!-- Topbar -->
  <div class="topbar" class:hidden={!uiVisible}>
    <button class="icon-btn" on:click={closeReader} title="Close reader"><X size={15} weight="light" /></button>
    <button class="icon-btn" on:click={() => { if (adjacent.prev) { maybeMarkCurrentRead(); openReader(adjacent.prev, $activeChapterList); } }} disabled={!adjacent.prev}>
      <CaretLeft size={14} weight="light" />
    </button>
    <span class="ch-label">
      <span class="ch-title">{$activeManga?.title}</span>
      <span class="ch-sep">/</span>
      <span>{displayChapter?.name}</span>
    </span>
    <span class="page-label">{$pageNumber} / {visibleChunkLastPage || "…"}</span>
    <button class="icon-btn" on:click={() => { if (adjacent.next) { maybeMarkCurrentRead(); openReader(adjacent.next, $activeChapterList); } }} disabled={!adjacent.next}>
      <CaretRight size={14} weight="light" />
    </button>
    <div class="top-sep"></div>
    <button class="mode-btn" on:click={cycleFit}>
      {#if fit === "width"}<ArrowsLeftRight size={14} weight="light" />
      {:else if fit === "height"}<ArrowsVertical size={14} weight="light" />
      {:else if fit === "screen"}<ArrowsIn size={14} weight="light" />
      {:else}<ArrowsOut size={14} weight="light" />{/if}
      <span class="mode-label">{fitLabel}</span>
    </button>
    <div class="zoom-wrap">
      <button class="zoom-btn" on:click={() => zoomOpen = !zoomOpen}>{Math.round((maxW / 900) * 100)}%</button>
      {#if zoomOpen}
        <div class="zoom-popover">
          <input type="range" class="zoom-slider" min={200} max={2400} step={50} value={maxW}
            on:input={(e) => updateSettings({ maxPageWidth: Number(e.currentTarget.value) })} />
          <button class="zoom-reset" on:click={() => updateSettings({ maxPageWidth: 900 })}>{Math.round((maxW / 900) * 100)}%</button>
        </div>
      {/if}
    </div>
    <button class="mode-btn" class:active={rtl} on:click={() => updateSettings({ readingDirection: rtl ? "ltr" : "rtl" })}>
      <ArrowsLeftRight size={14} weight="light" /><span class="mode-label">{rtl ? "RTL" : "LTR"}</span>
    </button>
    <button class="mode-btn" on:click={cycleStyle}>
      {#if style === "single"}<Square size={14} weight="light" />{:else}<Rows size={14} weight="light" />{/if}
      <span class="mode-label">{styleLabel}</span>
    </button>
    {#if style !== "single"}
      <button class="mode-btn" class:active={$settings.pageGap} on:click={() => updateSettings({ pageGap: !$settings.pageGap })}>
        <span class="mode-label">Gap</span>
      </button>
    {/if}
    {#if style === "longstrip"}
      <button class="mode-btn" class:active={autoNext} on:click={() => updateSettings({ autoNextChapter: !autoNext })}>
        <span class="mode-label">Auto</span>
      </button>
    {/if}
    {#if !autoNext}
      <button class="mode-btn" class:active={markOnNext} on:click={() => updateSettings({ markReadOnNext: !markOnNext })}>
        <span class="mode-label">Mk.Read</span>
      </button>
    {/if}
    <button class="mode-btn" on:click={() => dlOpen = true}>
      <Download size={14} weight="light" />
    </button>
  </div>

  <!-- Viewer -->
  <div
    bind:this={containerEl}
    class="viewer"
    class:strip={style === "longstrip"}
    style="--max-page-width:{maxW}px"
    tabindex="-1"
    on:click={handleTap}
    on:wheel={(e) => { if (e.ctrlKey) e.preventDefault(); }}
    on:keydown={(e) => { if (e.key === " " && style === "longstrip") { e.preventDefault(); containerEl?.scrollBy({ top: containerEl.clientHeight * 0.85, behavior: "smooth" }); } }}
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
            class="{imgCls}{$settings.pageGap ? ' strip-gap' : ''}"
            loading={i < 3 ? "eager" : "lazy"}
            decoding="async"
            height="1000"
          />
        {/each}
      {/each}
      <div bind:this={sentinelEl} style="height:1px;flex-shrink:0;overflow-anchor:none"></div>
    {:else if pageReady}
      {#if style === "double" && pageGroups.length}
        <div class="double-wrap">
          {#each currentGroup as pg}
            <img src={$pageUrls[pg - 1]} alt="Page {pg}" class="{imgCls} page-half {pg === currentGroup[0] ? 'gap-left' : 'gap-right'}" decoding="async" />
          {/each}
        </div>
      {:else}
        <img src={$pageUrls[$pageNumber - 1]} alt="Page {$pageNumber}" class={imgCls} decoding="async" style="transition:opacity 0.1s ease" />
      {/if}
    {/if}
  </div>

  <!-- Bottom nav -->
  <div class="bottombar" class:hidden={!uiVisible}>
    <button class="nav-btn" on:click={goPrev}
      disabled={loading || (style === "longstrip" ? !adjacent.prev : ($pageNumber === 1 && !adjacent.prev))}>
      <ArrowLeft size={13} weight="light" />
    </button>
    <button class="nav-btn" on:click={goNext}
      disabled={loading || (style === "longstrip" ? !adjacent.next : ($pageNumber === lastPage && !adjacent.next))}>
      <ArrowRight size={13} weight="light" />
    </button>
  </div>

  <!-- Download modal -->
  {#if dlOpen && $activeChapter}
    {@const queueable = adjacent.remaining.filter((c) => !c.isDownloaded)}
    <div class="dl-backdrop" on:click={() => dlOpen = false}>
      <div class="dl-modal" on:click|stopPropagation>
        <p class="dl-title">Download</p>
        <button class="dl-option" disabled={dlBusy || !!$activeChapter.isDownloaded}
          on:click={() => runDl(() => gql(ENQUEUE_DOWNLOAD, { chapterId: $activeChapter!.id }), $activeChapter!.name)}>
          This chapter
          <span class="dl-sub">{$activeChapter.isDownloaded ? "Already downloaded" : $activeChapter.name}</span>
        </button>
        <div class="dl-row">
          <button class="dl-option" disabled={dlBusy || queueable.length === 0}
            on:click={() => runDl(() => gql(ENQUEUE_CHAPTERS_DOWNLOAD, { chapterIds: queueable.slice(0, nextN).map((c) => c.id) }), `${Math.min(nextN, queueable.length)} chapters queued`)}>
            Next chapters
            <span class="dl-sub">{Math.min(nextN, queueable.length)} not yet downloaded</span>
          </button>
          <div class="dl-stepper" on:click|stopPropagation>
            <button class="dl-step-btn" on:click={() => nextN = Math.max(1, nextN - 1)} disabled={nextN <= 1}>−</button>
            <span class="dl-step-val">{nextN}</span>
            <button class="dl-step-btn" on:click={() => nextN = Math.min(queueable.length || 1, nextN + 1)} disabled={nextN >= queueable.length}>+</button>
          </div>
        </div>
        <button class="dl-option" disabled={dlBusy || queueable.length === 0}
          on:click={() => runDl(() => gql(ENQUEUE_CHAPTERS_DOWNLOAD, { chapterIds: queueable.map((c) => c.id) }), `${queueable.length} chapters queued`)}>
          All remaining
          <span class="dl-sub">{queueable.length} not yet downloaded</span>
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .root {
    position: fixed; inset: 0; background: #000;
    display: flex; flex-direction: column;
    z-index: var(--z-reader);
    transform: translateZ(0); will-change: transform;
  }

  .topbar {
    display: flex; align-items: center; gap: var(--sp-1);
    padding: 0 var(--sp-3); height: 40px;
    background: var(--bg-void); border-bottom: 1px solid var(--border-dim);
    flex-shrink: 0; position: relative; z-index: 2;
    transition: opacity 0.25s ease;
  }
  .topbar.hidden, .bottombar.hidden { opacity: 0; pointer-events: none; }

  .icon-btn {
    display: flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border-radius: var(--radius-sm);
    color: var(--text-muted); flex-shrink: 0;
    transition: color var(--t-base), background var(--t-base);
  }
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

  .zoom-wrap { position: relative; flex-shrink: 0; }
  .zoom-btn { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); color: var(--text-faint); padding: 4px var(--sp-2); border-radius: var(--radius-sm); min-width: 36px; text-align: center; transition: color var(--t-base), background var(--t-base); }
  .zoom-btn:hover { color: var(--text-secondary); background: var(--bg-raised); }
  .zoom-popover { position: absolute; top: calc(100% + 6px); left: 50%; transform: translateX(-50%); background: var(--bg-raised); border: 1px solid var(--border-base); border-radius: var(--radius-lg); padding: var(--sp-3) var(--sp-3) var(--sp-2); display: flex; flex-direction: column; align-items: center; gap: var(--sp-2); box-shadow: 0 8px 24px rgba(0,0,0,0.5); z-index: 100; min-width: 160px; animation: scaleIn 0.1s ease both; transform-origin: top center; }
  .zoom-slider { width: 140px; height: 3px; appearance: none; -webkit-appearance: none; background: var(--border-strong); border-radius: 2px; outline: none; cursor: pointer; }
  .zoom-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: var(--accent-fg); cursor: pointer; }
  .zoom-reset { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-muted); letter-spacing: var(--tracking-wide); padding: 2px var(--sp-2); border-radius: var(--radius-sm); transition: color var(--t-base), background var(--t-base); }
  .zoom-reset:hover { color: var(--text-primary); background: var(--bg-overlay); }

  .viewer { flex: 1; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center; -webkit-overflow-scrolling: touch; position: relative; }
  .viewer.strip { justify-content: flex-start; padding: var(--sp-4) 0; overflow-anchor: auto; }
  .viewer:focus { outline: none; }

  .img { display: block; user-select: none; image-rendering: auto; }
  .img.optimize-contrast { image-rendering: -webkit-optimize-contrast; }
  .fit-width    { max-width: var(--max-page-width); width: 100%; height: auto; }
  .fit-height   { max-height: calc(100vh - 80px); width: auto; max-width: 100%; height: auto; }
  .fit-screen   { max-width: 100%; max-height: calc(100vh - 80px); object-fit: contain; height: auto; }
  .fit-original { max-width: none; width: auto; height: auto; }
  .strip-gap { margin-bottom: 8px; }

  .double-wrap { display: flex; align-items: flex-start; justify-content: center; max-width: calc(var(--max-page-width) * 2); width: 100%; }
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
</style>
