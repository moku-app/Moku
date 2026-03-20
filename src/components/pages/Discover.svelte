<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { BookmarkSimple, FolderSimplePlus, Folder, Sparkle } from "phosphor-svelte";
  import { gql, thumbUrl } from "../../lib/client";
  import { GET_SOURCES, FETCH_SOURCE_MANGA, UPDATE_MANGA } from "../../lib/queries";
  import { cache, CACHE_KEYS } from "../../lib/cache";
  import { dedupeSources, dedupeMangaByTitle, dedupeMangaById } from "../../lib/util";
  import { settings, previewManga, activeSource, addFolder, assignMangaToFolder } from "../../store";
  import type { Manga, Source } from "../../lib/types";
  import ContextMenu from "../shared/ContextMenu.svelte";
  import type { MenuEntry } from "../shared/ContextMenu.svelte";
  import SourceBrowse from "../sources/SourceBrowse.svelte";

  // ── Config ────────────────────────────────────────────────────────────────────
  const GENRE_TABS      = ["All", "Action", "Romance", "Fantasy", "Comedy", "Drama", "Horror", "Sci-Fi", "Adventure", "Thriller"];
  const GRID_LIMIT      = 60;    // max rendered per tab
  const LOCAL_THRESHOLD = 20;    // fan out to sources if local results below this
  const CONCURRENCY     = 4;     // parallel source requests — kept conservative to not saturate connections
  const BATCH_INTERVAL  = 400;   // ms between DOM updates during background source fan-out

  const EXPLORE_ALL_MANGA = `
    query ExploreAllManga {
      mangas(orderBy: IN_LIBRARY_AT, orderByType: DESC) {
        nodes { id title thumbnailUrl inLibrary genre status source { id displayName } }
      }
    }
  `;
  const MANGAS_BY_GENRE = `
    query MangasByGenre($genre: String!, $first: Int) {
      mangas(
        filter: { genre: { includesInsensitive: $genre } }
        first: $first orderBy: IN_LIBRARY_AT orderByType: DESC
      ) { nodes { id title thumbnailUrl inLibrary genre status source { id displayName } } }
    }
  `;

  // ── State ─────────────────────────────────────────────────────────────────────
  let allManga:    Manga[]  = [];  // local library — loaded once, never triggers lag
  let allSources:  Source[] = [];  // all deduped sources — loaded once
  let loadingLib   = true;
  let loadError    = false;

  // Per-genre result map. Keyed by genre string.
  // "All" key → local library deduped by title
  // Each tab key → local + background source results, deduped id+title
  let genreResults  = new Map<string, Manga[]>();
  let genreLoading  = false;  // true only during the initial local fetch for a new tab
  let currentGenre  = "All";
  let genreAbort: AbortController | null = null;

  // batch timer handle for background source fan-out
  let batchTimer: ReturnType<typeof setInterval> | null = null;
  // accumulator: source results collected between batches
  let batchAccum   = new Map<string, Manga[]>(); // genre → pending mangas

  // Context menu
  let ctx: { x: number; y: number; manga: Manga } | null = null;

  // ── Derived ───────────────────────────────────────────────────────────────────
  $: visibleGrid = genreResults.get(currentGenre) ?? [];
  $: isLoading   = genreLoading || (currentGenre === "All" && loadingLib);

  // ── Dedup helper — always apply id first then title ───────────────────────────
  function dedup(items: Manga[]): Manga[] {
    return dedupeMangaByTitle(dedupeMangaById(items), $settings.mangaLinks);
  }

  // ── Concurrent fan-out — conservative concurrency keeps connections free ──────
  async function runConcurrent<T>(items: T[], fn: (i: T) => Promise<void>, signal: AbortSignal) {
    let i = 0;
    const worker = async () => {
      while (i < items.length) {
        if (signal.aborted) return;
        await fn(items[i++]).catch(() => {});
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  }

  // ── Batched DOM flush ─────────────────────────────────────────────────────────
  // Source fan-out collects results in batchAccum. A timer fires every BATCH_INTERVAL
  // ms and flushes them into genreResults in one shot — preventing a Svelte re-render
  // per-source and keeping the grid smooth.
  function startBatchFlush() {
    if (batchTimer) return;
    batchTimer = setInterval(() => {
      if (batchAccum.size === 0) return;
      for (const [genre, incoming] of batchAccum) {
        const current = genreResults.get(genre) ?? [];
        genreResults.set(genre, dedup([...current, ...incoming]).slice(0, GRID_LIMIT));
      }
      batchAccum.clear();
      genreResults = new Map(genreResults);
    }, BATCH_INTERVAL);
  }

  function stopBatchFlush() {
    if (batchTimer) { clearInterval(batchTimer); batchTimer = null; }
    // Final flush of anything remaining
    if (batchAccum.size > 0) {
      for (const [genre, incoming] of batchAccum) {
        const current = genreResults.get(genre) ?? [];
        genreResults.set(genre, dedup([...current, ...incoming]).slice(0, GRID_LIMIT));
      }
      batchAccum.clear();
      genreResults = new Map(genreResults);
    }
  }

  // Push source results into the accumulator (never touches the DOM directly)
  function accumulate(genre: string, mangas: Manga[]) {
    const existing = batchAccum.get(genre) ?? [];
    batchAccum.set(genre, [...existing, ...mangas]);
  }

  // ── Background source fan-out for a genre ────────────────────────────────────
  // Runs entirely in the background. Results appear in batches via batchAccum.
  // Does NOT set genreLoading = true — the local result is already showing.
  async function fanOutSources(genre: string, ctrl: AbortController) {
    if (!allSources.length) return;
    const lang = $settings.preferredExtensionLang || "en";
    const srcs = dedupeSources(allSources, lang);

    startBatchFlush();

    await runConcurrent(srcs, async src => {
      if (ctrl.signal.aborted) return;
      const pageKey = CACHE_KEYS.sourceMangaPage(src.id, "SEARCH", 1, [genre]);
      const result  = await cache.get<{ mangas: Manga[]; hasNextPage: boolean }>(
        pageKey,
        () => gql<{ fetchSourceManga: { mangas: Manga[]; hasNextPage: boolean } }>(
          FETCH_SOURCE_MANGA, { source: src.id, type: "SEARCH", page: 1, query: genre }, ctrl.signal
        ).then(d => d.fetchSourceManga),
        5 * 60 * 1000, // 5-min TTL — results are stable enough to cache
      ).catch(() => null);

      if (!result || ctrl.signal.aborted) return;

      // Only accumulate results that actually match the genre (client-side AND check)
      const matching = result.mangas.filter(m =>
        (m.genre ?? []).some(g => g.toLowerCase() === genre.toLowerCase())
          || result.mangas.length <= 5 // source returns few results, trust them
      );

      accumulate(genre, matching.length > 0 ? matching : result.mangas);
    }, ctrl.signal);

    if (!ctrl.signal.aborted) stopBatchFlush();
  }

  // ── Tab switch ───────────────────────────────────────────────────────────────
  // 1. Show local results immediately (no spinner if already cached)
  // 2. If local < LOCAL_THRESHOLD, kick off background fan-out silently
  async function switchGenre(genre: string) {
    if (currentGenre === genre) return;

    // Abort any in-flight fan-out for the previous tab
    genreAbort?.abort();
    stopBatchFlush();

    currentGenre = genre;

    if (genre === "All") {
      // "All" is just the deduped local library — no network needed
      genreResults.set("All", dedup(allManga).slice(0, GRID_LIMIT));
      genreResults = new Map(genreResults);
      return;
    }

    // If we already have a fully-populated cache for this genre, show it instantly
    const cached = genreResults.get(genre);
    if (cached && cached.length >= LOCAL_THRESHOLD) return;

    // Fetch local results (fast — single DB query)
    genreLoading = true;
    const ctrl = new AbortController();
    genreAbort = ctrl;

    try {
      const localData = await cache.get(CACHE_KEYS.GENRE(genre), () =>
        gql<{ mangas: { nodes: Manga[] } }>(MANGAS_BY_GENRE, { genre, first: GRID_LIMIT }, ctrl.signal)
          .then(d => d.mangas.nodes)
      );
      if (ctrl.signal.aborted) return;

      const local = dedup(localData);
      genreResults.set(genre, local.slice(0, GRID_LIMIT));
      genreResults = new Map(genreResults);
      genreLoading = false;

      // If sparse, fan out to sources in the background — no loading state shown
      if (local.length < LOCAL_THRESHOLD) {
        fanOutSources(genre, ctrl).catch(() => {}); // fully detached background task
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") console.error(e);
      if (!ctrl.signal.aborted) genreLoading = false;
    }
  }

  // ── Context menu ──────────────────────────────────────────────────────────────
  function openCtx(e: MouseEvent, m: Manga) {
    e.preventDefault(); e.stopPropagation();
    ctx = { x: e.clientX, y: e.clientY, manga: m };
  }
  function buildCtxItems(m: Manga): MenuEntry[] {
    return [
      {
        label: m.inLibrary ? "In Library" : "Add to library",
        icon: BookmarkSimple, disabled: m.inLibrary,
        onClick: () => gql(UPDATE_MANGA, { id: m.id, inLibrary: true })
          .then(() => cache.clear(CACHE_KEYS.LIBRARY)).catch(console.error),
      },
      ...($settings.folders.length > 0 ? [
        { separator: true } as MenuEntry,
        ...$settings.folders.map(f => ({
          label: f.mangaIds.includes(m.id) ? `✓ ${f.name}` : f.name,
          icon: Folder,
          onClick: () => assignMangaToFolder(f.id, m.id),
        })),
      ] : []),
      { separator: true },
      {
        label: "New folder & add", icon: FolderSimplePlus,
        onClick: () => {
          const n = prompt("Folder name:");
          if (n?.trim()) { const id = addFolder(n.trim()); assignMangaToFolder(id, m.id); }
        },
      },
    ];
  }

  // ── Initial load ──────────────────────────────────────────────────────────────
  // 1. Load local library → populate "All" tab immediately
  // 2. Load source list in background (needed for genre fan-out, not needed for initial render)
  function loadAll() {
    loadingLib = true; loadError = false;
    const lang = $settings.preferredExtensionLang || "en";

    // Local library — populates "All" tab
    cache.get(CACHE_KEYS.DISCOVER, () =>
      gql<{ mangas: { nodes: Manga[] } }>(EXPLORE_ALL_MANGA).then(d => d.mangas.nodes)
    ).then(m => {
      allManga = dedupeMangaById(m);
      genreResults.set("All", dedup(allManga).slice(0, GRID_LIMIT));
      genreResults = new Map(genreResults);
    }).catch(e => { console.error(e); loadError = true; })
      .finally(() => { loadingLib = false; });

    // Source list — loaded silently in background, cached for the session
    // Not awaited — the grid doesn't depend on this for the initial render
    cache.get(CACHE_KEYS.SOURCES, () =>
      gql<{ sources: { nodes: Source[] } }>(GET_SOURCES)
        .then(d => dedupeSources(d.sources.nodes, lang)),
      Infinity, // pin for session — source list is stable
    ).then(srcs => {
      allSources = srcs;
    }).catch(console.error);
  }

  onMount(loadAll);
  onDestroy(() => {
    genreAbort?.abort();
    stopBatchFlush();
  });
</script>

<!-- ── Source browse passthrough ─────────────────────────────────────────────── -->
{#if $activeSource}
  <SourceBrowse />
{:else}
  <div class="root">

    <!-- ── Header: page label + genre pill tabs ──────────────────────────────── -->
    <div class="header">
      <span class="heading">Discover</span>
      <div class="tab-strip">
        {#each GENRE_TABS as tab (tab)}
          <button
            class="genre-tab"
            class:active={currentGenre === tab}
            on:click={() => switchGenre(tab)}
          >
            {#if tab === "All"}<Sparkle size={10} weight="fill" />{/if}
            {tab}
          </button>
        {/each}
      </div>
    </div>

    <!-- ── Body ──────────────────────────────────────────────────────────────── -->
    <div class="body">

      {#if isLoading}
        <!-- Skeleton — shown only during first local fetch, never during bg fan-out -->
        <div class="manga-grid">
          {#each Array(24) as _, i (i)}
            <div class="card-skeleton"><div class="skeleton cover-area"></div></div>
          {/each}
        </div>

      {:else if loadError && visibleGrid.length === 0}
        <div class="empty">
          <span>Could not reach Suwayomi</span>
          <button class="retry-btn" on:click={loadAll}>Retry</button>
        </div>

      {:else if visibleGrid.length === 0}
        <div class="empty"><span>Nothing found for "{currentGenre}"</span></div>

      {:else}
        <div class="manga-grid">
          {#each visibleGrid as m (m.id)}
            <button
              class="manga-card"
              on:click={() => previewManga.set(m)}
              on:contextmenu={(e) => openCtx(e, m)}
            >
              <div class="cover-wrap">
                <img
                  src={thumbUrl(m.thumbnailUrl)} alt={m.title}
                  class="cover" loading="lazy" decoding="async"
                />
                <div class="cover-gradient"></div>
                {#if m.inLibrary}<span class="lib-badge">Saved</span>{/if}
                <div class="card-footer">
                  <p class="card-title">{m.title}</p>
                  {#if m.source?.displayName}
                    <p class="card-source">{m.source.displayName}</p>
                  {/if}
                </div>
              </div>
            </button>
          {/each}
        </div>
      {/if}

    </div>
  </div>
{/if}

{#if ctx}
  <ContextMenu x={ctx.x} y={ctx.y} items={buildCtxItems(ctx.manga)} onClose={() => ctx = null} />
{/if}

<style>
  .root { display: flex; flex-direction: column; height: 100%; overflow: hidden; animation: fadeIn 0.14s ease both; }

  /* ── Header ──────────────────────────────────────────────────────────────── */
  .header {
    display: flex; align-items: center; gap: var(--sp-4); flex-shrink: 0;
    padding: var(--sp-3) var(--sp-6); border-bottom: 1px solid var(--border-dim);
    overflow-x: auto; scrollbar-width: none;
  }
  .header::-webkit-scrollbar { display: none; }
  .heading {
    font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint);
    letter-spacing: var(--tracking-wider); text-transform: uppercase; flex-shrink: 0;
  }

  /* Genre pill tabs */
  .tab-strip { display: flex; gap: var(--sp-1); flex-shrink: 0; }
  .genre-tab {
    display: flex; align-items: center; gap: 5px;
    font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide);
    padding: 4px 12px; border-radius: var(--radius-full);
    border: 1px solid var(--border-dim); background: none; color: var(--text-faint);
    cursor: pointer; white-space: nowrap;
    transition: background var(--t-base), color var(--t-base), border-color var(--t-base);
  }
  .genre-tab:hover { color: var(--text-muted); border-color: var(--border-strong); background: var(--bg-raised); }
  .genre-tab.active { background: var(--accent-muted); border-color: var(--accent-dim); color: var(--accent-fg); }

  /* ── Body ────────────────────────────────────────────────────────────────── */
  .body {
    flex: 1; overflow-y: auto;
    padding: var(--sp-4) var(--sp-5) var(--sp-6);
    /* GPU-accelerated scroll — does NOT promote every card, only the scroll container */
    will-change: scroll-position;
    -webkit-overflow-scrolling: touch;
    contain: layout style;
  }

  /* ── Grid ────────────────────────────────────────────────────────────────── */
  .manga-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(clamp(90px, 11vw, 130px), 1fr));
    gap: var(--sp-2);
    align-content: start;
    /* Isolate the grid from the rest of the layout — prevents full-page reflow on update */
    contain: layout style;
  }

  /* ── Card ────────────────────────────────────────────────────────────────── */
  .manga-card {
    background: none; border: none; padding: 0; cursor: pointer; text-align: left;
    /* NO will-change here — only promote on actual hover to avoid 60+ simultaneous GPU layers */
  }
  .manga-card:hover .cover { filter: brightness(1.08) saturate(1.05); transform: scale(1.02); }
  .manga-card:hover .card-title { color: #fff; }
  /* Promote only the hovered card to its own GPU layer */
  .manga-card:hover { will-change: transform; }

  .cover-wrap {
    position: relative; aspect-ratio: 2/3; overflow: hidden;
    border-radius: var(--radius-md); background: var(--bg-raised);
    border: 1px solid var(--border-dim);
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  }
  .cover {
    width: 100%; height: 100%; object-fit: cover; display: block;
    transition: filter 0.15s ease, transform 0.15s ease;
    /* will-change removed — only the parent card gets it on hover */
  }
  .cover-gradient {
    position: absolute; inset: 0;
    background: linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.15) 50%, transparent 72%);
    pointer-events: none;
  }
  .lib-badge {
    position: absolute; top: var(--sp-1); right: var(--sp-1);
    font-family: var(--font-ui); font-size: 9px; letter-spacing: var(--tracking-wide);
    text-transform: uppercase; background: var(--accent-muted); color: var(--accent-fg);
    border: 1px solid var(--accent-dim); padding: 1px 5px; border-radius: var(--radius-sm);
  }
  .card-footer {
    position: absolute; bottom: 0; left: 0; right: 0;
    padding: var(--sp-2); pointer-events: none;
  }
  .card-title {
    font-size: var(--text-xs); font-weight: var(--weight-medium);
    color: rgba(255,255,255,0.92); line-height: var(--leading-snug);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    text-shadow: 0 1px 4px rgba(0,0,0,0.7);
    transition: color var(--t-base);
  }
  .card-source {
    font-family: var(--font-ui); font-size: 9px; color: rgba(255,255,255,0.45);
    letter-spacing: var(--tracking-wide); margin-top: 1px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  /* ── Skeleton ────────────────────────────────────────────────────────────── */
  .card-skeleton { padding: 0; }
  .cover-area { aspect-ratio: 2/3; border-radius: var(--radius-md); }

  /* ── Empty / error ───────────────────────────────────────────────────────── */
  .empty {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: var(--sp-3); padding: var(--sp-10) var(--sp-6);
    color: var(--text-faint); font-family: var(--font-ui); font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide);
  }
  .retry-btn {
    padding: 6px 16px; border-radius: var(--radius-md); border: 1px solid var(--border-dim);
    background: var(--bg-raised); color: var(--text-muted); cursor: pointer;
    font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide);
  }

  @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
</style>
