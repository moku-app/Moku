<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { gql } from "../../lib/client";
  import Thumbnail from "../shared/Thumbnail.svelte";
  import { GET_SOURCES, FETCH_SOURCE_MANGA, FETCH_MANGA } from "../../lib/queries";
  import { cache, CACHE_KEYS, getPageSet } from "../../lib/cache";
  import { dedupeMangaById, dedupeMangaByTitle, shouldHideNsfw, shouldHideSource, normalizeTitle } from "../../lib/util";
  import { store, setSearchPrefill, setPreviewManga } from "../../store/state.svelte";
  import type { Manga, Source } from "../../lib/types";

  type SearchTab = "keyword" | "tag" | "source";
  type TagMode   = "AND" | "OR";

  interface SourceResult {
    source:  Source;
    mangas:  Manga[];
    loading: boolean;
    error:   string | null;
  }

  // ── Cached manga entry for tag/source browsing ────────────────────────────
  interface CachedManga {
    id:           number;
    title:        string;
    thumbnailUrl: string;
    inLibrary:    boolean;
    status:       string;
    genre:        string[];
    sourceId:     string;
    genreEnriched: boolean; // true once fetchManga has been called for this entry
  }

  const CONCURRENCY    = 6;
  const POPULAR_PAGES  = 3; // pages to pre-fetch per source

  const COMMON_GENRES = [
    "Action","Adventure","Comedy","Drama","Fantasy","Romance",
    "Sci-Fi","Slice of Life","Horror","Mystery","Thriller","Sports",
    "Supernatural","Mecha","Historical","Psychological","School Life",
    "Shounen","Seinen","Josei","Shoujo","Isekai","Martial Arts",
    "Magic","Music","Cooking","Medical","Military","Harem","Ecchi",
  ];

  const MANGA_STATUSES: { value: string; label: string }[] = [
    { value: "ONGOING",   label: "Ongoing"   },
    { value: "COMPLETED", label: "Completed" },
    { value: "HIATUS",    label: "Hiatus"    },
    { value: "ABANDONED", label: "Abandoned" },
    { value: "UNKNOWN",   label: "Unknown"   },
  ];

  // ── Concurrency helper ────────────────────────────────────────────────────
  async function runConcurrent<T>(items: T[], fn: (item: T) => Promise<void>, signal: AbortSignal): Promise<void> {
    let i = 0;
    async function worker() {
      while (i < items.length) {
        if (signal.aborted) return;
        const item = items[i++];
        await fn(item).catch(() => {});
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  }

  // ── Source dedup by preferred lang ────────────────────────────────────────
  // For each unique source name, keep only the preferred-lang variant (or the
  // first alphabetically if preferred lang isn't available). This collapses
  // MangaDex (60+ lang variants) and Manga Ball (40+) down to one each.
  function dedupSourcesByLang(sources: Source[], preferredLang: string): Source[] {
    const map = new Map<string, Source>();
    for (const s of sources) {
      if (s.id === "0") continue; // skip local source
      const key      = s.name;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, s);
        continue;
      }
      // Prefer the preferred lang; otherwise keep alphabetically first lang
      const existingIsPreferred = existing.lang === preferredLang;
      const newIsPreferred      = s.lang === preferredLang;
      if (newIsPreferred && !existingIsPreferred) {
        map.set(key, s);
      } else if (!existingIsPreferred && !newIsPreferred && s.lang < existing.lang) {
        map.set(key, s);
      }
    }
    return Array.from(map.values());
  }

  // ── In-memory source manga cache ─────────────────────────────────────────
  // Keyed by manga id. Shared across tag searches for the session.
  const sourceCache = new Map<number, CachedManga>();
  let sourceCacheReady   = $state(false);  // true once phase 1 (popular fetch) is done
  let sourceCacheLoading = $state(false);
  let sourceCacheEnriching = $state(false); // true while background genre enrichment runs
  let sourceCacheAbort: AbortController | null = null;

  // Phase 1: fetch 3 pages of POPULAR per deduped source, store in sourceCache
  async function buildSourceCache(sources: Source[], signal: AbortSignal) {
    const pages = [1, 2, 3];
    const tasks: { src: Source; page: number }[] = [];
    for (const src of sources) {
      for (const page of pages) tasks.push({ src, page });
    }

    await runConcurrent(tasks, async ({ src, page }) => {
      if (signal.aborted) return;
      try {
        const d = await gql<{ fetchSourceManga: { mangas: Manga[]; hasNextPage: boolean } }>(
          FETCH_SOURCE_MANGA,
          { source: src.id, type: "POPULAR", page },
          signal,
        );
        if (signal.aborted) return;
        for (const m of d.fetchSourceManga.mangas) {
          if (!sourceCache.has(m.id)) {
            sourceCache.set(m.id, {
              id:           m.id,
              title:        m.title,
              thumbnailUrl: m.thumbnailUrl,
              inLibrary:    m.inLibrary,
              status:       (m as any).status ?? "UNKNOWN",
              genre:        (m as any).genre  ?? [],
              sourceId:     src.id,
              genreEnriched: ((m as any).genre?.length ?? 0) > 0,
            });
          }
        }
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        // Individual source failures are silently skipped
      }
    }, signal);
  }

  // Phase 2: background genre enrichment — only for entries with empty genre[]
  async function enrichGenres(signal: AbortSignal) {
    const unenriched = [...sourceCache.values()].filter((m) => !m.genreEnriched);
    if (!unenriched.length) return;
    sourceCacheEnriching = true;
    await runConcurrent(unenriched, async (entry) => {
      if (signal.aborted) return;
      try {
        const d = await gql<{ fetchManga: { manga: Manga & { genre: string[]; status: string } } }>(
          FETCH_MANGA,
          { id: entry.id },
          signal,
        );
        if (signal.aborted) return;
        const updated = sourceCache.get(entry.id);
        if (updated) {
          updated.genre        = d.fetchManga.manga.genre ?? [];
          updated.status       = d.fetchManga.manga.status ?? updated.status;
          updated.genreEnriched = true;
        }
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        // Mark as enriched anyway so we don't retry endlessly
        const updated = sourceCache.get(entry.id);
        if (updated) updated.genreEnriched = true;
      }
    }, signal);
    if (!signal.aborted) sourceCacheEnriching = false;
  }

  // MANGAS_BY_GENRE — local library query
  const MANGAS_BY_GENRE = `
    query MangasByGenre($filter: MangaFilterInput, $first: Int, $offset: Int) {
      mangas(filter: $filter, first: $first, offset: $offset, orderBy: IN_LIBRARY_AT, orderByType: DESC) {
        nodes {
          id title thumbnailUrl inLibrary genre status
          source { id displayName }
        }
        pageInfo { hasNextPage }
        totalCount
      }
    }
  `;

  // Build GraphQL filter for local library query
  function buildTagFilter(
    tags: string[],
    mode: TagMode,
    statuses: string[],
  ): Record<string, unknown> {
    const genrePart: Record<string, unknown> | null =
      tags.length === 0 ? null :
      mode === "AND"
        ? { and: tags.map((t) => ({ genre: { includesInsensitive: t } })) }
        : { or:  tags.map((t) => ({ genre: { includesInsensitive: t } })) };

    const statusPart: Record<string, unknown> | null =
      statuses.length === 0 ? null :
      statuses.length === 1
        ? { status: { equalTo: statuses[0] } }
        : { or: statuses.map((s) => ({ status: { equalTo: s } })) };

    if (!genrePart && !statusPart) return {};
    if (genrePart && !statusPart)  return genrePart;
    if (!genrePart && statusPart)  return statusPart;
    return { and: [genrePart, statusPart] };
  }

  // Filter the in-memory source cache by active tags + statuses
  function filterSourceCache(
    tags: string[],
    mode: TagMode,
    statuses: string[],
  ): CachedManga[] {
    return [...sourceCache.values()].filter((m) => {
      if (!shouldHideNsfw(m as any, store.settings)) return false; // keep non-nsfw
      // Actually: shouldHideNsfw returns true when we SHOULD hide, so:
      if (shouldHideNsfw(m as any, store.settings)) return false;

      const statusMatch =
        statuses.length === 0 || statuses.includes(m.status);

      let genreMatch = true;
      if (tags.length > 0) {
        const lowerGenres = m.genre.map((g) => g.toLowerCase());
        if (mode === "AND") {
          genreMatch = tags.every((t) => lowerGenres.some((g) => g.includes(t.toLowerCase())));
        } else {
          genreMatch = tags.some((t) => lowerGenres.some((g) => g.includes(t.toLowerCase())));
        }
      }

      return statusMatch && genreMatch;
    });
  }

  // ── Global state ──────────────────────────────────────────────────────────
  let tab: SearchTab = $state("keyword");
  let preferredLang  = store.settings?.preferredExtensionLang ?? "en";

  let allSources:    Source[] = $state([]);
  let loadingSources           = $state(false);
  let pendingPrefill           = $state("");

  $effect(() => {
    if (store.searchPrefill) {
      const prefill = store.searchPrefill;
      untrack(() => {
        pendingPrefill = prefill;
        tab = "keyword";
        setSearchPrefill("");
      });
    }
  });

  // Load sources then kick off the cache build
  loadingSources = true;
  gql<{ sources: { nodes: Source[] } }>(GET_SOURCES)
    .then((d) => {
      allSources = d.sources.nodes.filter((src: Source) => src.id !== "0");
      // Kick off source cache build immediately after sources load
      startSourceCacheBuild();
    })
    .catch(console.error)
    .finally(() => { loadingSources = false; });

  function startSourceCacheBuild() {
    if (sourceCacheLoading || sourceCacheReady) return;
    sourceCacheAbort?.abort();
    const ctrl = new AbortController();
    sourceCacheAbort = ctrl;
    sourceCacheLoading = true;
    sourceCache.clear();

    const dedupedSources = dedupSourcesByLang(allSources, preferredLang)
      .filter((s) => !shouldHideSource(s, store.settings));

    buildSourceCache(dedupedSources, ctrl.signal)
      .then(() => {
        if (ctrl.signal.aborted) return;
        sourceCacheReady   = true;
        sourceCacheLoading = false;
        // Phase 2: enrich genres in background at low priority
        enrichGenres(ctrl.signal);
      })
      .catch((e) => {
        if (e?.name !== "AbortError") console.error(e);
        sourceCacheLoading = false;
      });
  }

  const availableLangs   = $derived(Array.from(new Set<string>(allSources.map((s) => s.lang))).sort());
  const hasMultipleLangs = $derived(availableLangs.length > 1);

  // ── Keyword tab ───────────────────────────────────────────────────────────
  let kw_query        = $state("");
  let kw_submitted    = $state("");
  let kw_results:     SourceResult[] = $state([]);
  let kw_showAdvanced = $state(false);
  let kw_selectedLangs: Set<string>  = $state(new Set());
  let kw_inputEl:     HTMLInputElement | null = $state(null);
  let kw_abortCtrl:   AbortController | null  = null;

  $effect(() => {
    if (allSources.length) {
      const available = new Set(allSources.map((s) => s.lang));
      kw_selectedLangs = available.has(preferredLang)
        ? new Set([preferredLang])
        : new Set(availableLangs.slice(0, 1));
    }
  });

  $effect(() => {
    if (!loadingSources && pendingPrefill && !kw_submitted && allSources.length) {
      const q = pendingPrefill;
      pendingPrefill = "";
      kw_query = q;
      kwDoSearch(q);
    }
  });

  function kwGetVisibleSources(): Source[] {
    let filtered = allSources;
    if (kw_selectedLangs.size > 0)
      filtered = filtered.filter((s) => kw_selectedLangs.has(s.lang));
    if (!store.settings.showNsfw)
      filtered = filtered.filter((s) => !shouldHideSource(s, store.settings));
    return filtered;
  }

  async function kwDoSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    const visible = kwGetVisibleSources();
    if (!visible.length) return;
    kw_abortCtrl?.abort();
    const ctrl = new AbortController();
    kw_abortCtrl = ctrl;
    kw_submitted = trimmed;
    kw_results   = visible.map((src) => ({ source: src, mangas: [], loading: true, error: null }));
    await runConcurrent(visible, async (src) => {
      if (ctrl.signal.aborted) return;
      try {
        const d = await gql<{ fetchSourceManga: { mangas: Manga[] } }>(
          FETCH_SOURCE_MANGA, { source: src.id, type: "SEARCH", page: 1, query: trimmed }, ctrl.signal,
        );
        if (ctrl.signal.aborted) return;
        const mangas = d.fetchSourceManga.mangas.filter((m) => !shouldHideNsfw(m, store.settings));
        kw_results = kw_results.map((r) =>
          r.source.id === src.id ? { ...r, mangas, loading: false } : r,
        );
      } catch (e: any) {
        if (ctrl.signal.aborted || e?.name === "AbortError") return;
        kw_results = kw_results.map((r) =>
          r.source.id === src.id ? { ...r, loading: false, error: e.message ?? "Error" } : r,
        );
      }
    }, ctrl.signal);
  }

  function kwToggleLang(lang: string) {
    const next = new Set(kw_selectedLangs);
    if (next.has(lang)) { if (next.size === 1) return; next.delete(lang); }
    else next.add(lang);
    kw_selectedLangs = next;
  }

  const kw_visibleCount = $derived(kwGetVisibleSources().length);
  const kw_hasResults   = $derived(kw_results.some((r) => r.mangas.length > 0));
  const kw_allDone      = $derived(kw_results.length > 0 && kw_results.every((r) => !r.loading));

  // ── Tag tab ───────────────────────────────────────────────────────────────
  let tag_activeTags:     string[] = $state([]);
  let tag_activeStatuses: string[] = $state([]);
  let tag_tagMode:        TagMode  = $state("AND");
  let tag_tagFilter                = $state("");

  // Local library results
  let tag_localResults:   Manga[]  = $state([]);
  let tag_totalCount               = $state(0);
  let tag_loadingLocal             = $state(false);
  let tag_loadingMoreLocal         = $state(false);
  let tag_localOffset              = $state(0);
  let tag_localHasNext             = $state(false);
  let tag_abortLocal: AbortController | null = null;

  // Source cache results (filtered client-side from sourceCache)
  let tag_searchSources    = $state(false);
  let tag_sourceFiltered:  CachedManga[] = $state([]);

  const tag_filteredGenres = $derived.by(() => {
    const q = tag_tagFilter.trim().toLowerCase();
    return q ? COMMON_GENRES.filter((g) => g.toLowerCase().includes(q)) : COMMON_GENRES;
  });

  const tag_hasActiveFilters = $derived(tag_activeTags.length > 0 || tag_activeStatuses.length > 0);

  // Local library fetch — triggered when tags or statuses change
  $effect(() => {
    const _tags     = tag_activeTags;
    const _mode     = tag_tagMode;
    const _statuses = tag_activeStatuses;
    untrack(() => tagFetchLocal(_tags, _mode, _statuses));
  });

  // Source cache filter — reactive to filters + cache readiness
  $effect(() => {
    const _tags     = tag_activeTags;
    const _mode     = tag_tagMode;
    const _statuses = tag_activeStatuses;
    const _ready    = sourceCacheReady;
    const _search   = tag_searchSources;
    untrack(() => {
      if (_search && _ready && (_tags.length > 0 || _statuses.length > 0)) {
        tag_sourceFiltered = filterSourceCache(_tags, _mode, _statuses);
      } else {
        tag_sourceFiltered = [];
      }
    });
  });

  // Auto-enable source search when local results are sparse
  let tag_autoSearchFired = $state(false);
  $effect(() => {
    if (!tag_loadingLocal && tag_hasActiveFilters && !tag_autoSearchFired && !tag_searchSources && sourceCacheReady) {
      if (tag_localResults.length < 20) {
        untrack(() => { tag_autoSearchFired = true; tag_searchSources = true; });
      }
    }
  });
  $effect(() => {
    const _ = tag_activeTags;
    const __ = tag_activeStatuses;
    untrack(() => { tag_autoSearchFired = false; });
  });

  async function tagFetchLocal(activeTags: string[], tagMode: TagMode, activeStatuses: string[]) {
    if (activeTags.length === 0 && activeStatuses.length === 0) {
      tag_localResults = []; tag_totalCount = 0; tag_localHasNext = false; tag_localOffset = 0;
      return;
    }
    tag_abortLocal?.abort();
    const ctrl = new AbortController();
    tag_abortLocal = ctrl;
    tag_localResults = []; tag_totalCount = 0; tag_localOffset = 0; tag_localHasNext = false;
    tag_loadingLocal = true;
    gql<{ mangas: { nodes: Manga[]; pageInfo: { hasNextPage: boolean }; totalCount: number } }>(
      MANGAS_BY_GENRE,
      { filter: buildTagFilter(activeTags, tagMode, activeStatuses), first: (store.settings.renderLimit ?? 48), offset: 0 },
      ctrl.signal,
    ).then((d) => {
      if (ctrl.signal.aborted) return;
      const nsfwFilter = (m: Manga) => !shouldHideNsfw(m, store.settings);
      tag_localResults = d.mangas.nodes.filter(nsfwFilter);
      tag_totalCount   = d.mangas.totalCount;
      tag_localHasNext = d.mangas.pageInfo.hasNextPage;
      tag_localOffset  = (store.settings.renderLimit ?? 48);
    }).catch((e: any) => {
      if (e?.name !== "AbortError") console.error(e);
    }).finally(() => {
      if (!ctrl.signal.aborted) tag_loadingLocal = false;
    });
  }

  async function tagLoadMoreLocal() {
    if (tag_loadingMoreLocal || !tag_localHasNext) return;
    tag_loadingMoreLocal = true;
    tag_abortLocal?.abort();
    const ctrl = new AbortController();
    tag_abortLocal = ctrl;
    try {
      const d = await gql<{ mangas: { nodes: Manga[]; pageInfo: { hasNextPage: boolean } } }>(
        MANGAS_BY_GENRE,
        { filter: buildTagFilter(tag_activeTags, tag_tagMode, tag_activeStatuses), first: (store.settings.renderLimit ?? 48), offset: tag_localOffset },
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      const nsfwFilter = (m: Manga) => !shouldHideNsfw(m, store.settings);
      tag_localResults  = [...tag_localResults, ...d.mangas.nodes.filter(nsfwFilter)];
      tag_localHasNext  = d.mangas.pageInfo.hasNextPage;
      tag_localOffset  += (store.settings.renderLimit ?? 48);
    } catch (e: any) {
      if (e?.name !== "AbortError") console.error(e);
    } finally {
      if (!ctrl.signal.aborted) tag_loadingMoreLocal = false;
    }
  }

  function tagToggleTag(tag: string) {
    tag_activeTags = tag_activeTags.includes(tag)
      ? tag_activeTags.filter((t) => t !== tag)
      : [...tag_activeTags, tag];
  }

  function tagToggleStatus(status: string) {
    tag_activeStatuses = tag_activeStatuses.includes(status)
      ? tag_activeStatuses.filter((s) => s !== status)
      : [...tag_activeStatuses, status];
  }

  function tagToggleSearchSources() {
    tag_searchSources = !tag_searchSources;
  }

  // Deduplicate merged results: local library wins over source cache on id,
  // then dedupe by title to avoid cross-source duplicates.
  const tag_localIds = $derived(new Set(tag_localResults.map((m) => m.id)));
  const tag_mergedResults = $derived.by(() => {
    const localMapped = tag_localResults;
    const sourceMapped: Manga[] = tag_sourceFiltered
      .filter((m) => !tag_localIds.has(m.id))
      .map((m) => ({
        id:           m.id,
        title:        m.title,
        thumbnailUrl: m.thumbnailUrl,
        inLibrary:    m.inLibrary,
        genre:        m.genre,
        status:       m.status,
      } as Manga));
    return dedupeMangaByTitle(
      dedupeMangaById([...localMapped, ...sourceMapped]),
      store.settings.mangaLinks,
    );
  });

  const tag_totalVisible = $derived(tag_mergedResults.length);

  // ── Source browse tab ─────────────────────────────────────────────────────
  let src_selectedLang  = $state(preferredLang || "all");
  let src_activeSource: Source | null = $state(null);
  let src_browseResults: Manga[]       = $state([]);
  let src_loadingBrowse                = $state(false);
  let src_browseQuery                  = $state("");
  let src_submitted                    = $state("");
  let src_hasNextPage                  = $state(false);
  let src_currentPage                  = $state(1);
  let src_abortCtrl: AbortController | null = null;

  $effect(() => {
    if (!allSources.length) return;
    const langs = new Set(allSources.map((s) => s.lang));
    if (src_selectedLang !== "all" && !langs.has(src_selectedLang)) {
      src_selectedLang = langs.has(preferredLang) ? preferredLang : "all";
    }
  });

  // Source tab visible sources — deduped by preferred lang when showing "all"
  const src_visibleSources = $derived.by(() => {
    const hide = (s: Source) => shouldHideSource(s, store.settings);
    if (src_selectedLang !== "all") {
      return allSources.filter((s) => s.lang === src_selectedLang && !hide(s));
    }
    // Dedup by name, prefer preferredLang
    const map = new Map<string, Source>();
    for (const s of allSources) {
      if (hide(s)) continue;
      const key      = s.name;
      const existing = map.get(key);
      if (!existing) { map.set(key, s); continue; }
      const existingIsPreferred = existing.lang === preferredLang;
      const newIsPreferred      = s.lang === preferredLang;
      if (newIsPreferred && !existingIsPreferred) {
        map.set(key, s);
      } else if (!existingIsPreferred && !newIsPreferred && s.lang < existing.lang) {
        map.set(key, s);
      }
    }
    return Array.from(map.values());
  });

  async function srcFetchBrowse(src: Source, type: "POPULAR" | "SEARCH", q?: string, page = 1) {
    src_abortCtrl?.abort();
    const ctrl = new AbortController();
    src_abortCtrl = ctrl;
    if (page === 1) { src_loadingBrowse = true; src_browseResults = []; }
    try {
      const d = await gql<{ fetchSourceManga: { mangas: Manga[]; hasNextPage: boolean } }>(
        FETCH_SOURCE_MANGA, { source: src.id, type, page, query: q ?? null }, ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      const incoming = d.fetchSourceManga.mangas.filter((m) => !shouldHideNsfw(m, store.settings));
      src_browseResults = page === 1 ? incoming : [...src_browseResults, ...incoming];
      src_hasNextPage   = d.fetchSourceManga.hasNextPage;
      src_currentPage   = page;
    } catch (e: any) {
      if (e?.name !== "AbortError") console.error(e);
    } finally {
      if (!ctrl.signal.aborted) src_loadingBrowse = false;
    }
  }

  function srcSelectSource(src: Source) {
    src_activeSource = src; src_browseQuery = ""; src_submitted = "";
    srcFetchBrowse(src, "POPULAR");
  }

  function srcHandleSearch() {
    if (!src_activeSource || !src_browseQuery.trim()) return;
    src_submitted = src_browseQuery.trim();
    srcFetchBrowse(src_activeSource, "SEARCH", src_browseQuery.trim());
  }

  function srcClearSearch() {
    src_browseQuery = ""; src_submitted = "";
    if (src_activeSource) srcFetchBrowse(src_activeSource, "POPULAR");
  }

  onDestroy(() => {
    kw_abortCtrl?.abort();
    tag_abortLocal?.abort();
    src_abortCtrl?.abort();
    sourceCacheAbort?.abort();
  });
</script>

<div class="root">

  <div class="header">
    <h1 class="heading">Search</h1>
    <div class="tabs">
      <button class="tab" class:tabActive={tab === "keyword"} onclick={() => (tab = "keyword")}>
        <svg width="11" height="11" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
          <path d="M229.66,218.34l-50.07-50.07a88,88,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.31ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"/>
        </svg>
        Keyword
      </button>
      <button class="tab" class:tabActive={tab === "tag"} onclick={() => (tab = "tag")}>
        <svg width="11" height="11" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
          <path d="M224,104H200l8-48a8,8,0,0,0-15.79-2.67L183.79,104H136l8-48a8,8,0,0,0-15.79-2.67L119.79,104H72a8,8,0,0,0,0,16h45.33L105.6,200H56a8,8,0,0,0,0,16H103l-8,48a8,8,0,0,0,15.79,2.67L119.21,216H168l-8,48a8,8,0,0,0,15.79,2.67L184.21,216H232a8,8,0,0,0,0-16H186.67l11.73-80H224a8,8,0,0,0,0-16Zm-69.33,96H101.6L113.33,120h53.07Z"/>
        </svg>
        Tags
      </button>
      <button class="tab" class:tabActive={tab === "source"} onclick={() => (tab = "source")}>
        <svg width="11" height="11" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
          <path d="M224,128a8,8,0,0,1-8,8H40a8,8,0,0,1,0-16H216A8,8,0,0,1,224,128ZM40,72H216a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16ZM216,184H40a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Z"/>
        </svg>
        Sources
      </button>
    </div>
  </div>

  {#if tab === "keyword"}
    <div class="keywordBar">
      <div class="searchBar">
        <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" class="searchIcon" aria-hidden="true">
          <path d="M229.66,218.34l-50.07-50.07a88,88,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.31ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"/>
        </svg>
        <input
          bind:this={kw_inputEl}
          bind:value={kw_query}
          class="searchInput"
          placeholder="Search across sources…"
          onkeydown={(e) => e.key === "Enter" && kwDoSearch(kw_query)}
        />
        {#if kw_query}
          <button class="clearBtn" title="Clear" onclick={() => { kw_query = ""; kw_inputEl?.focus(); }}>×</button>
        {/if}
        {#if hasMultipleLangs}
          <button
            class="advancedBtn"
            class:advancedBtnActive={kw_showAdvanced}
            title="Language & filter options"
            onclick={() => (kw_showAdvanced = !kw_showAdvanced)}
          >
            <svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
              <path d="M40,88H73a32,32,0,0,0,62,0h81a8,8,0,0,0,0-16H135a32,32,0,0,0-62,0H40a8,8,0,0,0,0,16Zm64-24A16,16,0,1,1,88,80,16,16,0,0,1,104,64ZM216,168H183a32,32,0,0,0-62,0H40a8,8,0,0,0,0,16h81a32,32,0,0,0,62,0h33a8,8,0,0,0,0-16Zm-64,24a16,16,0,1,1,16-16A16,16,0,0,1,152,192Z"/>
            </svg>
          </button>
        {/if}
        <button class="searchBtn" onclick={() => kwDoSearch(kw_query)} disabled={!kw_query.trim() || loadingSources}>
          {#if loadingSources}
            <svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor" class="anim-spin" aria-hidden="true">
              <path d="M232,128a104,104,0,0,1-208,0c0-41,23.81-78.36,60.66-95.27a8,8,0,0,1,6.68,14.54C60.15,61.59,40,93.27,40,128a88,88,0,0,0,176,0c0-34.73-20.15-66.41-51.34-80.73a8,8,0,0,1,6.68-14.54C208.19,49.64,232,87,232,128Z"/>
            </svg>
          {:else}
            Search
          {/if}
        </button>
      </div>

      {#if hasMultipleLangs && kw_showAdvanced}
        <div class="advancedPanel">
          <div class="advancedHeader">
            <span class="advancedTitle">Languages</span>
            <div class="advancedActions">
              <button class="advancedLink" onclick={() => (kw_selectedLangs = new Set(availableLangs))}>All</button>
              <button class="advancedLink" onclick={() => (kw_selectedLangs = new Set([preferredLang]))}>Reset</button>
            </div>
          </div>
          <div class="langGrid">
            {#each availableLangs as lang (lang)}
              <button class="langChip" class:langChipActive={kw_selectedLangs.has(lang)} onclick={() => kwToggleLang(lang)}>
                {lang === preferredLang ? `${lang.toUpperCase()} ★` : lang.toUpperCase()}
              </button>
            {/each}
          </div>
          <div class="advancedDivider"></div>
          <div class="advancedFooter">
            Searching <strong>{kw_visibleCount}</strong> source{kw_visibleCount !== 1 ? "s" : ""}
          </div>
        </div>
      {/if}
    </div>

    {#if !kw_submitted}
      <div class="empty">
        <svg width="36" height="36" viewBox="0 0 256 256" fill="currentColor" class="emptyIcon" aria-hidden="true">
          <path d="M229.66,218.34l-50.07-50.07a88,88,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.31ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"/>
        </svg>
        <p class="emptyText">Search across sources</p>
        <p class="emptyHint">
          {#if hasMultipleLangs}
            {kw_visibleCount} source{kw_visibleCount !== 1 ? "s" : ""} · {kw_selectedLangs.size} language{kw_selectedLangs.size !== 1 ? "s" : ""}
          {:else}
            {kw_visibleCount} source{kw_visibleCount !== 1 ? "s" : ""}
          {/if}
        </p>
        {#if hasMultipleLangs && !kw_showAdvanced}
          <button class="advancedLinkStandalone" onclick={() => (kw_showAdvanced = true)}>
            <svg width="12" height="12" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
              <path d="M40,88H73a32,32,0,0,0,62,0h81a8,8,0,0,0,0-16H135a32,32,0,0,0-62,0H40a8,8,0,0,0,0,16Zm64-24A16,16,0,1,1,88,80,16,16,0,0,1,104,64ZM216,168H183a32,32,0,0,0-62,0H40a8,8,0,0,0,0,16h81a32,32,0,0,0,62,0h33a8,8,0,0,0,0-16Zm-64,24a16,16,0,1,1,16-16A16,16,0,0,1,152,192Z"/>
            </svg>
            Adjust language filters
          </button>
        {/if}
      </div>
    {:else}
      <div class="results">
        {#if kw_results.length === 0}
          <div class="empty">
            <svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor" class="anim-spin" style="color:var(--text-faint)" aria-hidden="true">
              <path d="M232,128a104,104,0,0,1-208,0c0-41,23.81-78.36,60.66-95.27a8,8,0,0,1,6.68,14.54C60.15,61.59,40,93.27,40,128a88,88,0,0,0,176,0c0-34.73-20.15-66.41-51.34-80.73a8,8,0,0,1,6.68-14.54C208.19,49.64,232,87,232,128Z"/>
            </svg>
          </div>
        {/if}

        {#each kw_results.filter((r) => r.mangas.length > 0 || r.loading || r.error) as { source, mangas, loading, error } (source.id)}
          <div class="sourceSection">
            <div class="sourceHeader">
              <Thumbnail src={source.iconUrl} alt={source.displayName} class="sourceIcon" onerror={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <span class="sourceName">{source.displayName}</span>
              {#if hasMultipleLangs}<span class="sourceLang">{source.lang.toUpperCase()}</span>{/if}
              {#if loading}
                <svg width="12" height="12" viewBox="0 0 256 256" fill="currentColor" class="anim-spin" style="color:var(--text-faint);margin-left:auto" aria-hidden="true">
                  <path d="M232,128a104,104,0,0,1-208,0c0-41,23.81-78.36,60.66-95.27a8,8,0,0,1,6.68,14.54C60.15,61.59,40,93.27,40,128a88,88,0,0,0,176,0c0-34.73-20.15-66.41-51.34-80.73a8,8,0,0,1,6.68-14.54C208.19,49.64,232,87,232,128Z"/>
                </svg>
              {:else if mangas.length > 0}
                <span class="resultCount">{mangas.length} results</span>
              {/if}
            </div>
            {#if error}
              <p class="sourceError">{error}</p>
            {:else if loading}
              <div class="sourceRow">
                {#each Array(4) as _, i (i)}
                  <div class="skCard"><div class="skeleton skCover"></div><div class="skeleton skTitle"></div></div>
                {/each}
              </div>
            {:else if mangas.length > 0}
              <div class="sourceRow">
                {#each mangas.slice(0, (store.settings.renderLimit ?? 48)) as m (m.id)}
                  <button class="card" onclick={() => setPreviewManga(m)}>
                    <div class="coverWrap">
                      <Thumbnail src={m.thumbnailUrl} alt={m.title} class="cover" />
                      {#if m.inLibrary}<span class="inLibBadge">Saved</span>{/if}
                    </div>
                    <p class="cardTitle">{m.title}</p>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/each}

        {#if kw_allDone && !kw_hasResults}
          <div class="empty">
            <p class="emptyText">No results for "{kw_submitted}"</p>
            <p class="emptyHint">Try a different spelling or fewer words</p>
          </div>
        {/if}
      </div>
    {/if}

  {:else if tab === "tag"}
    <div class="splitRoot">
      <div class="splitSidebar">
        <div class="splitSearchWrap">
          <svg width="12" height="12" viewBox="0 0 256 256" fill="currentColor" class="splitSearchIcon" aria-hidden="true">
            <path d="M229.66,218.34l-50.07-50.07a88,88,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.31ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"/>
          </svg>
          <input bind:value={tag_tagFilter} class="splitSearchInput" placeholder="Filter genres…" />
          {#if tag_tagFilter}
            <button class="splitSearchClear" title="Clear" onclick={() => (tag_tagFilter = "")}>×</button>
          {/if}
        </div>
        <div class="splitList">
          <div class="splitSectionLabel">Status</div>
          {#each MANGA_STATUSES as { value, label } (value)}
            <button class="splitItem" class:splitItemActive={tag_activeStatuses.includes(value)} onclick={() => tagToggleStatus(value)}>
              <span class="splitItemLabel">{label}</span>
              {#if tag_activeStatuses.includes(value)}<span class="tagCheckMark">✓</span>{/if}
            </button>
          {/each}
          <div class="splitSectionLabel splitSectionLabelSpaced">Genre</div>
          {#each tag_filteredGenres as tag (tag)}
            <button class="splitItem" class:splitItemActive={tag_activeTags.includes(tag)} onclick={() => tagToggleTag(tag)}>
              <span class="splitItemLabel">{tag}</span>
              {#if tag_activeTags.includes(tag)}<span class="tagCheckMark">✓</span>{/if}
            </button>
          {/each}
          {#if tag_filteredGenres.length === 0}
            <p class="splitEmpty">No matching genres</p>
          {/if}
        </div>
      </div>

      <div class="splitContent">
        {#if !tag_hasActiveFilters}
          <div class="empty">
            <svg width="32" height="32" viewBox="0 0 256 256" fill="currentColor" class="emptyIcon" aria-hidden="true">
              <path d="M224,104H200l8-48a8,8,0,0,0-15.79-2.67L183.79,104H136l8-48a8,8,0,0,0-15.79-2.67L119.79,104H72a8,8,0,0,0,0,16h45.33L105.6,200H56a8,8,0,0,0,0,16H103l-8,48a8,8,0,0,0,15.79,2.67L119.21,216H168l-8,48a8,8,0,0,0,15.79,2.67L184.21,216H232a8,8,0,0,0,0-16H186.67l11.73-80H224a8,8,0,0,0,0-16Zm-69.33,96H101.6L113.33,120h53.07Z"/>
            </svg>
            <p class="emptyText">Browse by tag</p>
            <p class="emptyHint">Select a status or genre to find matching manga.</p>
          </div>
        {:else}
          <div class="tagActiveBar">
            <div class="tagPillRow">
              {#each tag_activeStatuses as status (status)}
                <span class="tagPill tagPillStatus">
                  {MANGA_STATUSES.find((s) => s.value === status)?.label ?? status}
                  <button class="tagPillRemove" title="Remove {status}" onclick={() => tagToggleStatus(status)}>×</button>
                </span>
              {/each}
              {#each tag_activeTags as tag (tag)}
                <span class="tagPill">
                  {tag}
                  <button class="tagPillRemove" title="Remove {tag}" onclick={() => tagToggleTag(tag)}>×</button>
                </span>
              {/each}
            </div>
            <div class="tagBarRight">
              {#if tag_activeTags.length > 1}
                <div class="tagModeToggle">
                  <button class="tagModeBtn" class:tagModeBtnActive={tag_tagMode === "AND"} title="Match ALL tags" onclick={() => (tag_tagMode = "AND")}>AND</button>
                  <button class="tagModeBtn" class:tagModeBtnActive={tag_tagMode === "OR"}  title="Match ANY tag"  onclick={() => (tag_tagMode = "OR")}>OR</button>
                </div>
              {/if}
              <button
                class="tagModeBtn"
                class:tagModeBtnActive={tag_searchSources}
                title={sourceCacheLoading ? "Building source cache…" : sourceCacheReady ? "Search across sources" : "Sources unavailable"}
                disabled={!sourceCacheReady && !sourceCacheLoading}
                onclick={tagToggleSearchSources}
              >
                {#if sourceCacheLoading}
                  <svg width="11" height="11" viewBox="0 0 256 256" fill="currentColor" class="anim-spin" aria-hidden="true">
                    <path d="M232,128a104,104,0,0,1-208,0c0-41,23.81-78.36,60.66-95.27a8,8,0,0,1,6.68,14.54C60.15,61.59,40,93.27,40,128a88,88,0,0,0,176,0c0-34.73-20.15-66.41-51.34-80.73a8,8,0,0,1,6.68-14.54C208.19,49.64,232,87,232,128Z"/>
                  </svg>
                {:else}
                  <svg width="11" height="11" viewBox="0 0 256 256" fill="currentColor" style="margin-right:3px;vertical-align:middle" aria-hidden="true">
                    <path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24ZM101.63,168h52.74C149,186.34,140,202.87,128,215.89,116,202.87,107,186.34,101.63,168ZM98,152a145.72,145.72,0,0,1,0-48h60a145.72,145.72,0,0,1,0,48ZM40,128a87.61,87.61,0,0,1,3.33-24H81.79a161.79,161.79,0,0,0,0,48H43.33A87.61,87.61,0,0,1,40,128ZM154.37,88H101.63C107,69.66,116,53.13,128,40.11,140,53.13,149,69.66,154.37,88ZM174.21,104h38.46a88.15,88.15,0,0,1,0,48H174.21a161.79,161.79,0,0,0,0-48Zm32.32-16H170.71a133.32,133.32,0,0,0-22.7-45.8A88.21,88.21,0,0,1,206.53,88ZM108,42.2A133.32,133.32,0,0,0,85.29,88H49.47A88.21,88.21,0,0,1,108,42.2ZM49.47,168H85.29A133.32,133.32,0,0,0,108,213.8,88.21,88.21,0,0,1,49.47,168Zm98.53,45.8A133.32,133.32,0,0,0,170.71,168h35.82A88.21,88.21,0,0,1,148,213.8Z"/>
                  </svg>
                {/if}
                Sources{sourceCacheEnriching ? " ·" : ""}
              </button>
              <button class="tagClearAll" onclick={() => { tag_activeTags = []; tag_activeStatuses = []; }}>Clear all</button>
            </div>
          </div>

          <div class="splitContentHeader">
            <span class="splitContentTitle">
              {#if tag_activeStatuses.length > 0 && tag_activeTags.length === 0}
                {tag_activeStatuses.map((s) => MANGA_STATUSES.find((x) => x.value === s)?.label ?? s).join(" · ")}
              {:else if tag_activeTags.length === 1 && tag_activeStatuses.length === 0}
                {tag_activeTags[0]}
              {:else}
                {[...tag_activeStatuses.map((s) => MANGA_STATUSES.find((x) => x.value === s)?.label ?? s), ...tag_activeTags].join(` ${tag_tagMode} `)}
              {/if}
              {#if tag_searchSources}
                <span style="margin-left:6px;font-weight:400;opacity:0.55;font-size:0.9em">+ sources</span>
              {/if}
            </span>
            {#if tag_loadingLocal}
              <svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor" class="anim-spin" style="color:var(--text-faint)" aria-hidden="true">
                <path d="M232,128a104,104,0,0,1-208,0c0-41,23.81-78.36,60.66-95.27a8,8,0,0,1,6.68,14.54C60.15,61.59,40,93.27,40,128a88,88,0,0,0,176,0c0-34.73-20.15-66.41-51.34-80.73a8,8,0,0,1,6.68-14.54C208.19,49.64,232,87,232,128Z"/>
              </svg>
            {:else}
              <span class="splitResultCount">
                {tag_totalVisible}{tag_localHasNext ? "+" : ""} results
                {#if tag_searchSources && sourceCacheReady}
                  · {sourceCache.size} cached
                {/if}
              </span>
            {/if}
          </div>

          {#if tag_loadingLocal}
            <div class="tagGrid">
              {#each Array(48) as _, i (i)}
                <div class="skCard"><div class="skeleton skCover"></div><div class="skeleton skTitle"></div></div>
              {/each}
            </div>
          {:else if tag_mergedResults.length > 0}
            <div class="tagGrid">
              {#each tag_mergedResults as m (m.id)}
                <button class="card" onclick={() => setPreviewManga(m)}>
                  <div class="coverWrap">
                    <Thumbnail src={m.thumbnailUrl} alt={m.title} class="cover" />
                    {#if m.inLibrary}<span class="inLibBadge">Saved</span>{/if}
                  </div>
                  <p class="cardTitle">{m.title}</p>
                </button>
              {/each}

              {#if tag_localHasNext}
                <div class="showMoreCell">
                  <button class="showMoreBtn" onclick={tagLoadMoreLocal} disabled={tag_loadingMoreLocal}>
                    {#if tag_loadingMoreLocal}
                      <svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor" class="anim-spin" aria-hidden="true">
                        <path d="M232,128a104,104,0,0,1-208,0c0-41,23.81-78.36,60.66-95.27a8,8,0,0,1,6.68,14.54C60.15,61.59,40,93.27,40,128a88,88,0,0,0,176,0c0-34.73-20.15-66.41-51.34-80.73a8,8,0,0,1,6.68-14.54C208.19,49.64,232,87,232,128Z"/>
                      </svg> Loading…
                    {:else}
                      Show more (library)
                    {/if}
                  </button>
                </div>
              {/if}
            </div>
          {:else}
            <div class="empty">
              <p class="emptyText">No results</p>
              <p class="emptyHint">
                {#if tag_searchSources}
                  Try OR mode or broader tags.
                {:else}
                  Try OR mode, enable Sources, or check your library.
                {/if}
              </p>
            </div>
          {/if}
        {/if}
      </div>
    </div>

  {:else if tab === "source"}
    <div class="splitRoot">
      <div class="splitSidebar">
        <div class="srcLangRow">
          <span class="langPocketLabel">Language</span>
          <select class="langSelect" bind:value={src_selectedLang}>
            <option value="all">All</option>
            {#each availableLangs as lang (lang)}
              <option value={lang}>{lang.toUpperCase()}{lang === preferredLang ? " ★" : ""}</option>
            {/each}
          </select>
        </div>
        {#if loadingSources}
          <div class="splitLoading">
            <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" class="anim-spin" style="color:var(--text-faint)" aria-hidden="true">
              <path d="M232,128a104,104,0,0,1-208,0c0-41,23.81-78.36,60.66-95.27a8,8,0,0,1,6.68,14.54C60.15,61.59,40,93.27,40,128a88,88,0,0,0,176,0c0-34.73-20.15-66.41-51.34-80.73a8,8,0,0,1,6.68-14.54C208.19,49.64,232,87,232,128Z"/>
            </svg>
          </div>
        {:else}
          <div class="splitList">
            {#each src_visibleSources as src (src.id)}
              <button class="splitItem splitItemSource" class:splitItemActive={src_activeSource?.id === src.id} onclick={() => srcSelectSource(src)}>
                <Thumbnail src={src.iconUrl} alt="" class="splitSourceIcon" onerror={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                <span class="splitItemLabel">{src.name}</span>
                {#if src_selectedLang === "all"}
                  <span class="sourceLang" style="margin-left:auto;margin-right:4px">{src.lang.toUpperCase()}</span>
                {/if}
                {#if src.isNsfw}<span class="nsfwBadge">18+</span>{/if}
              </button>
            {/each}
            {#if src_visibleSources.length === 0}
              <p class="splitEmpty">No sources for this language</p>
            {/if}
          </div>
        {/if}
      </div>

      <div class="splitContent">
        {#if !src_activeSource}
          <div class="empty">
            <svg width="32" height="32" viewBox="0 0 256 256" fill="currentColor" class="emptyIcon" aria-hidden="true">
              <path d="M224,128a8,8,0,0,1-8,8H40a8,8,0,0,1,0-16H216A8,8,0,0,1,224,128ZM40,72H216a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16ZM216,184H40a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Z"/>
            </svg>
            <p class="emptyText">Browse a source</p>
            <p class="emptyHint">Select a source to see its popular titles, or search within it.</p>
          </div>
        {:else}
          <div class="splitContentHeader">
            <div class="splitSourceTitle">
              <Thumbnail src={src_activeSource.iconUrl} alt="" class="splitSourceIcon" onerror={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <span class="splitContentTitle">{src_activeSource.displayName}</span>
              {#if src_loadingBrowse}
                <svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor" class="anim-spin" style="color:var(--text-faint)" aria-hidden="true">
                  <path d="M232,128a104,104,0,0,1-208,0c0-41,23.81-78.36,60.66-95.27a8,8,0,0,1,6.68,14.54C60.15,61.59,40,93.27,40,128a88,88,0,0,0,176,0c0-34.73-20.15-66.41-51.34-80.73a8,8,0,0,1,6.68-14.54C208.19,49.64,232,87,232,128Z"/>
                </svg>
              {:else if src_browseResults.length > 0}
                <span class="splitResultCount">{src_browseResults.length} results</span>
              {/if}
            </div>
          </div>
          <div class="sourceBrowseBar">
            <div class="searchBar" style="flex:1">
              <svg width="12" height="12" viewBox="0 0 256 256" fill="currentColor" class="searchIcon" aria-hidden="true">
                <path d="M229.66,218.34l-50.07-50.07a88,88,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.31ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"/>
              </svg>
              <input
                bind:value={src_browseQuery}
                class="searchInput"
                placeholder="Search {src_activeSource.displayName}…"
                onkeydown={(e) => e.key === "Enter" && srcHandleSearch()}
              />
              {#if src_submitted}
                <button class="clearBtn" title="Clear search" onclick={srcClearSearch}>×</button>
              {/if}
            </div>
            <button class="searchBtn" onclick={srcHandleSearch} disabled={!src_browseQuery.trim() || src_loadingBrowse}>Search</button>
          </div>

          {#if src_loadingBrowse && src_browseResults.length === 0}
            <div class="tagGrid">
              {#each Array(18) as _, i (i)}
                <div class="skCard"><div class="skeleton skCover"></div><div class="skeleton skTitle"></div></div>
              {/each}
            </div>
          {:else if src_browseResults.length > 0}
            <div class="tagGrid">
              {#each src_browseResults as m (m.id)}
                <button class="card" onclick={() => setPreviewManga(m)}>
                  <div class="coverWrap">
                    <Thumbnail src={m.thumbnailUrl} alt={m.title} class="cover" />
                    {#if m.inLibrary}<span class="inLibBadge">Saved</span>{/if}
                  </div>
                  <p class="cardTitle">{m.title}</p>
                </button>
              {/each}
            </div>
            {#if src_hasNextPage}
              <div class="loadMoreRow">
                <button
                  class="showMoreBtn"
                  disabled={src_loadingBrowse}
                  onclick={() => src_activeSource && srcFetchBrowse(
                    src_activeSource,
                    src_submitted ? "SEARCH" : "POPULAR",
                    src_submitted || undefined,
                    src_currentPage + 1,
                  )}
                >
                  {#if src_loadingBrowse}
                    <svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor" class="anim-spin" aria-hidden="true">
                      <path d="M232,128a104,104,0,0,1-208,0c0-41,23.81-78.36,60.66-95.27a8,8,0,0,1,6.68,14.54C60.15,61.59,40,93.27,40,128a88,88,0,0,0,176,0c0-34.73-20.15-66.41-51.34-80.73a8,8,0,0,1,6.68-14.54C208.19,49.64,232,87,232,128Z"/>
                    </svg> Loading…
                  {:else}
                    Load more
                  {/if}
                </button>
              </div>
            {/if}
          {:else if !src_loadingBrowse}
            <div class="empty">
              <p class="emptyText">{src_submitted ? `No results for "${src_submitted}"` : "No results"}</p>
            </div>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .root { display: flex; flex-direction: column; height: 100%; overflow: hidden; animation: fadeIn 0.14s ease both; }
  .header { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-4) var(--sp-6); flex-shrink: 0; border-bottom: 1px solid var(--border-dim); }
  .heading { font-family: var(--font-ui); font-size: var(--text-xs); font-weight: var(--weight-normal); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; }
  .tabs { display: flex; gap: 2px; background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-md); padding: 2px; }
  .tab { display: flex; align-items: center; gap: 5px; font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); text-transform: uppercase; padding: 4px 10px; border-radius: var(--radius-sm); background: none; border: 1px solid transparent; color: var(--text-faint); cursor: pointer; transition: background var(--t-base), color var(--t-base); white-space: nowrap; }
  .tab:hover { color: var(--text-muted); }
  .tabActive { background: var(--accent-muted); color: var(--accent-fg); border: 1px solid var(--accent-dim); }
  .tabActive:hover { color: var(--accent-fg); }
  .keywordBar { padding: var(--sp-3) var(--sp-4); flex-shrink: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
  .searchBar { display: flex; align-items: center; gap: var(--sp-2); background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-md); padding: 0 var(--sp-3) 0 var(--sp-2); transition: border-color var(--t-base); }
  .searchBar:focus-within { border-color: var(--border-strong); }
  .searchIcon { color: var(--text-faint); flex-shrink: 0; }
  .searchInput { flex: 1; background: none; border: none; outline: none; color: var(--text-primary); font-size: var(--text-sm); padding: 7px 0; }
  .searchInput::placeholder { color: var(--text-faint); }
  .clearBtn { color: var(--text-faint); font-size: 14px; line-height: 1; background: none; border: none; cursor: pointer; padding: 2px; transition: color var(--t-base); }
  .clearBtn:hover { color: var(--text-muted); }
  .advancedBtn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--radius-sm); background: none; border: none; color: var(--text-faint); flex-shrink: 0; cursor: pointer; transition: color var(--t-base), background var(--t-base); }
  .advancedBtn:hover { color: var(--text-muted); background: var(--bg-overlay); }
  .advancedBtnActive { color: var(--accent-fg); background: var(--accent-muted); }
  .advancedBtnActive:hover { color: var(--accent-fg); background: var(--accent-muted); }
  .searchBtn { font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 6px 12px; border-radius: var(--radius-md); background: var(--accent-muted); color: var(--accent-fg); border: 1px solid var(--accent-dim); cursor: pointer; flex-shrink: 0; display: flex; align-items: center; gap: var(--sp-1); transition: filter var(--t-base); }
  .searchBtn:hover:not(:disabled) { filter: brightness(1.1); }
  .searchBtn:disabled { opacity: 0.4; cursor: default; }
  .advancedPanel { background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-md); padding: var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-2); animation: fadeIn 0.1s ease both; }
  .advancedHeader { display: flex; align-items: center; justify-content: space-between; }
  .advancedTitle { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; }
  .advancedActions { display: flex; gap: var(--sp-1); }
  .advancedLink { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); color: var(--accent-fg); background: none; border: none; padding: 0; cursor: pointer; opacity: 0.7; transition: opacity var(--t-base); }
  .advancedLink:hover { opacity: 1; }
  .langGrid { display: flex; flex-wrap: wrap; gap: var(--sp-1); }
  .langChip { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); padding: 3px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: none; color: var(--text-faint); cursor: pointer; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); }
  .langChip:hover { color: var(--text-muted); border-color: var(--border-strong); }
  .langChipActive { background: var(--accent-muted); border-color: var(--accent-dim); color: var(--accent-fg); }
  .langChipActive:hover { background: var(--accent-muted); color: var(--accent-fg); }
  .advancedDivider { height: 1px; background: var(--border-dim); margin: 2px 0; }
  .advancedFooter { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .advancedLinkStandalone { display: inline-flex; align-items: center; gap: 5px; font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); color: var(--accent-fg); background: none; border: none; padding: 0; cursor: pointer; opacity: 0.7; transition: opacity var(--t-base); }
  .advancedLinkStandalone:hover { opacity: 1; }
  .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-2); }
  .emptyIcon { color: var(--text-faint); }
  .emptyText { font-size: var(--text-base); color: var(--text-muted); }
  .emptyHint { font-size: var(--text-sm); color: var(--text-faint); }
  .results { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
  .sourceSection { padding: var(--sp-1) var(--sp-4) var(--sp-3); border-bottom: 1px solid var(--border-dim); }
  .sourceSection:last-child { border-bottom: none; }
  .sourceHeader { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-2) 0; }
  :global(.sourceIcon) { width: 20px; height: 20px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0; background: var(--bg-raised); }
  .sourceName { font-size: var(--text-base); font-weight: var(--weight-medium); color: var(--text-secondary); }
  .sourceLang { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-sm); padding: 1px 5px; }
  .resultCount { margin-left: auto; font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .sourceError { font-size: var(--text-xs); color: var(--color-error); padding: var(--sp-1) 0; margin: 0; }
  .sourceRow { display: flex; gap: var(--sp-3); overflow-x: auto; padding-bottom: var(--sp-1); scrollbar-width: none; }
  .sourceRow::-webkit-scrollbar { display: none; }
  .card { display: flex; flex-direction: column; gap: var(--sp-2); cursor: pointer; flex-shrink: 0; width: 110px; text-align: left; background: none; border: none; padding: 0; }
  .card:hover :global(.cover) { filter: brightness(1.06); }
  .card:hover .cardTitle { color: var(--text-primary); }
  .coverWrap { position: relative; width: 100%; aspect-ratio: 2 / 3; border-radius: var(--radius-md); overflow: hidden; background: var(--bg-raised); border: 1px solid var(--border-dim); transform: translateZ(0); }
  :global(.cover) { width: 100%; height: 100%; object-fit: cover; transition: filter var(--t-base); }
  .inLibBadge { position: absolute; bottom: var(--sp-1); right: var(--sp-1); background: var(--accent-dim); color: var(--accent-fg); font-family: var(--font-ui); font-size: 9px; font-weight: var(--weight-medium); letter-spacing: var(--tracking-wide); padding: 1px 5px; border-radius: var(--radius-sm); border: 1px solid var(--accent-muted); }
  .cardTitle { font-size: var(--text-sm); color: var(--text-secondary); line-height: var(--leading-snug); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; transition: color var(--t-base); }
  .skCard { display: flex; flex-direction: column; gap: var(--sp-2); flex-shrink: 0; width: 110px; }
  .tagGrid .card  { width: 100%; }
  .tagGrid .skCard { width: 100%; }
  .skeleton { border-radius: var(--radius-sm); }
  .skCover { aspect-ratio: 2 / 3; width: 100%; border-radius: var(--radius-md); }
  .skTitle { height: 10px; width: 80%; }
  .splitRoot { flex: 1; display: flex; overflow: hidden; }
  .splitSidebar { width: 180px; flex-shrink: 0; border-right: 1px solid var(--border-dim); overflow: hidden; display: flex; flex-direction: column; }
  .splitSearchWrap { display: flex; align-items: center; gap: var(--sp-1); padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; }
  .splitSearchIcon { color: var(--text-faint); flex-shrink: 0; }
  .splitSearchInput { flex: 1; background: none; border: none; outline: none; font-size: var(--text-xs); color: var(--text-primary); font-family: var(--font-ui); min-width: 0; }
  .splitSearchInput::placeholder { color: var(--text-faint); }
  .splitSearchClear { color: var(--text-faint); font-size: 13px; line-height: 1; background: none; border: none; cursor: pointer; padding: 2px; transition: color var(--t-base); }
  .splitSearchClear:hover { color: var(--text-muted); }
  .splitList { flex: 1; overflow-y: auto; padding: var(--sp-1); scrollbar-width: thin; scrollbar-color: var(--border-dim) transparent; }
  .splitSectionLabel { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wider); text-transform: uppercase; color: var(--text-faint); padding: var(--sp-2) var(--sp-3) var(--sp-1); pointer-events: none; user-select: none; }
  .splitSectionLabelSpaced { margin-top: var(--sp-2); border-top: 1px solid var(--border-dim); padding-top: var(--sp-3); }
  .splitItem { display: flex; align-items: center; gap: var(--sp-2); width: 100%; padding: 7px var(--sp-3); border-radius: var(--radius-md); border: 1px solid transparent; background: none; text-align: left; cursor: pointer; transition: background var(--t-fast), border-color var(--t-fast); }
  .splitItem:hover { background: var(--bg-raised); border-color: var(--border-dim); }
  .splitItemActive { background: var(--accent-muted); border-color: var(--accent-dim); }
  .splitItemActive:hover { background: var(--accent-muted); }
  .splitItemLabel { font-size: var(--text-xs); color: var(--text-muted); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .splitItemActive .splitItemLabel { color: var(--accent-fg); font-weight: var(--weight-medium); }
  .splitItemSource { gap: var(--sp-2); }
  .splitEmpty { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); padding: var(--sp-3); margin: 0; }
  .splitLoading { flex: 1; display: flex; align-items: center; justify-content: center; padding: var(--sp-6); }
  .splitContent { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .splitContentHeader { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; gap: var(--sp-2); }
  .splitSourceTitle { display: flex; align-items: center; gap: var(--sp-2); flex: 1; min-width: 0; }
  .splitContentTitle { font-size: var(--text-base); font-weight: var(--weight-medium); color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; letter-spacing: var(--tracking-tight); }
  .splitResultCount { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); flex-shrink: 0; }
  :global(.splitSourceIcon) { width: 20px; height: 20px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0; background: var(--bg-raised); }
  .tagActiveBar { display: flex; align-items: flex-start; gap: var(--sp-2); padding: var(--sp-2) var(--sp-4); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; flex-wrap: wrap; }
  .tagPillRow { display: flex; flex-wrap: wrap; gap: var(--sp-1); flex: 1; min-width: 0; }
  .tagPill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; background: var(--accent-muted); border: 1px solid var(--accent-dim); border-radius: var(--radius-sm); font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); color: var(--accent-fg); }
  .tagPillStatus { background: color-mix(in srgb, var(--color-info, #4a90d9) 12%, transparent); border-color: color-mix(in srgb, var(--color-info, #4a90d9) 30%, transparent); color: var(--color-info, #4a90d9); }
  .tagPillRemove { color: currentColor; opacity: 0.6; font-size: 13px; line-height: 1; background: none; border: none; cursor: pointer; padding: 0; transition: opacity var(--t-base); }
  .tagPillRemove:hover { opacity: 1; }
  .tagBarRight { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
  .tagModeToggle { display: flex; border: 1px solid var(--border-dim); border-radius: var(--radius-md); overflow: hidden; }
  .tagModeBtn { display: flex; align-items: center; gap: 4px; padding: 4px 8px; font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); color: var(--text-faint); background: none; border: none; border-right: 1px solid var(--border-dim); cursor: pointer; transition: color var(--t-base), background var(--t-base); }
  .tagModeBtn:last-child { border-right: none; }
  .tagModeBtn:hover { color: var(--text-muted); background: var(--bg-raised); }
  .tagModeBtnActive { color: var(--accent-fg); background: var(--accent-muted); }
  .tagModeBtnActive:hover { color: var(--accent-fg); background: var(--accent-muted); }
  .tagClearAll { display: flex; align-items: center; font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); color: var(--text-faint); padding: 4px 8px; border-radius: var(--radius-md); border: 1px solid var(--border-dim); background: none; cursor: pointer; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); }
  .tagClearAll:hover { color: var(--color-error); border-color: color-mix(in srgb, var(--color-error) 40%, transparent); background: var(--color-error-bg, color-mix(in srgb, var(--color-error) 8%, transparent)); }
  .tagCheckMark { font-size: var(--text-xs); color: var(--accent-fg); margin-left: auto; }
  .tagGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: var(--sp-4); padding: var(--sp-4); overflow-y: auto; flex: 1; align-content: start; }
  .showMoreCell { grid-column: 1 / -1; display: flex; justify-content: center; gap: var(--sp-2); padding: var(--sp-2) 0; }
  .showMoreBtn { display: inline-flex; align-items: center; gap: var(--sp-1); padding: 5px 12px; border-radius: var(--radius-md); border: 1px solid var(--border-dim); background: none; font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); color: var(--text-muted); cursor: pointer; transition: background var(--t-base), color var(--t-base), border-color var(--t-base); }
  .showMoreBtn:hover:not(:disabled) { background: var(--bg-raised); color: var(--text-secondary); border-color: var(--border-strong); }
  .showMoreBtn:disabled { opacity: 0.4; cursor: default; }
  .loadMoreRow { display: flex; justify-content: center; padding: var(--sp-3) var(--sp-4); flex-shrink: 0; border-top: 1px solid var(--border-dim); }
  .sourceBrowseBar { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-2) var(--sp-4); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; }
  .srcLangRow { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; gap: var(--sp-2); }
  .langPocketLabel { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; }
  .langSelect { appearance: none; -webkit-appearance: none; background: var(--bg-overlay); border: 1px solid var(--border-dim); border-radius: var(--radius-sm); color: var(--text-secondary); font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); padding: 4px 24px 4px 8px; cursor: pointer; max-width: 110px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 256 256'%3E%3Cpath fill='%23888' d='M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 7px center; transition: border-color var(--t-base), background var(--t-base), color var(--t-base); }
  .langSelect:hover { border-color: var(--border-strong); background-color: var(--bg-raised); color: var(--text-primary); }
  .langSelect:focus { outline: none; border-color: var(--accent-dim); color: var(--text-primary); }
  .langSelect option { background: var(--bg-surface); color: var(--text-secondary); }
  .nsfwBadge { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); color: var(--color-error); background: var(--color-error-bg, rgba(180, 60, 60, 0.08)); border: 1px solid rgba(180, 60, 60, 0.25); border-radius: var(--radius-sm); padding: 1px 5px; margin-left: auto; flex-shrink: 0; }
</style>

<script module>
  function focusOnMount(node: HTMLElement) { node.focus(); }
</script>
