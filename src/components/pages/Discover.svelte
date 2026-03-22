<script lang="ts">
  import { onDestroy } from "svelte";
  import { BookmarkSimple, FolderSimplePlus, Folder, Sparkle, ArrowsClockwise } from "phosphor-svelte";
  import { gql, thumbUrl } from "../../lib/client";
  import { GET_SOURCES, FETCH_SOURCE_MANGA, UPDATE_MANGA } from "../../lib/queries";
  import { cache, CACHE_KEYS } from "../../lib/cache";
  import { dedupeSources, dedupeMangaByTitle, dedupeMangaById } from "../../lib/util";
  import { store, addFolder, assignMangaToFolder, setPreviewManga } from "../../store/state.svelte";
  import type { Manga, Source } from "../../lib/types";
  import ContextMenu from "../shared/ContextMenu.svelte";
  import type { MenuEntry } from "../shared/ContextMenu.svelte";
  import SourceBrowse from "../shared/SourceBrowse.svelte";

  // ── Constants ─────────────────────────────────────────────────────────────
  const GENRE_TABS = ["All", "Action", "Romance", "Fantasy", "Comedy", "Drama", "Horror", "Sci-Fi", "Adventure", "Thriller"];
  const GRID_LIMIT = 100;
  const LOCAL_THRESHOLD = 20;
  const CONCURRENCY = 4;
  const BATCH_MS = 400;

  const EXPLORE_ALL_MANGA = `
    query ExploreAllManga {
      mangas(orderBy: IN_LIBRARY_AT, orderByType: DESC) {
        nodes { id title thumbnailUrl inLibrary genre status source { id displayName } }
      }
    }
  `;
  const MANGAS_BY_GENRE = `
    query MangasByGenre($genre: String!, $first: Int) {
      mangas(filter: { genre: { includesInsensitive: $genre } }, first: $first, orderBy: IN_LIBRARY_AT, orderByType: DESC) {
        nodes { id title thumbnailUrl inLibrary genre status source { id displayName } }
      }
    }
  `;

  // ── Dedicated discover cache ───────────────────────────────────────────────
  // Completely isolated from main app cache — refresh only wipes this,
  // leaving library/chapter/source caches untouched.
  const discoverStore = new Map<string, Manga[]>();
  function dKey(srcId: string, type: string, tag: string) { return `${srcId}|${type}|${tag}`; }
  function clearDiscover() { discoverStore.clear(); }

  // ── State ─────────────────────────────────────────────────────────────────
  let allManga:    Manga[]      = $state([]);
  let allSources:  Source[]     = $state([]);
  let libraryIds:  Set<number>  = $state(new Set());
  let loadingLib                = $state(true);
  let loadError                 = $state(false);
  let currentGenre              = $state("All");
  let genreResults              = $state(new Map<string, Manga[]>());
  let genreLoading              = $state(false);
  let srcOffset                 = $state(0);

  let activeCtrl: AbortController | null = null;
  let batchTimer:  ReturnType<typeof setInterval> | null = null;
  let batchAccum   = new Map<string, Manga[]>();

  let ctx: { x: number; y: number; manga: Manga } | null = $state(null);

  const isLoading   = $derived(genreLoading || refreshing || (currentGenre === "All" && loadingLib));
  const visibleGrid = $derived(genreResults.get(currentGenre) ?? []);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function dedup(items: Manga[]): Manga[] {
    return dedupeMangaByTitle(dedupeMangaById(items), store.settings.mangaLinks);
  }

  function filterSource(mangas: Manga[]): Manga[] {
    return dedup(mangas.filter(m => !m.inLibrary && !libraryIds.has(m.id)));
  }

  function rotatedSources(): Source[] {
    const lang = store.settings.preferredExtensionLang || "en";
    const srcs = dedupeSources(allSources.filter(s => s.id !== "0"), lang);
    if (!srcs.length) return [];
    const off = srcOffset % srcs.length;
    return [...srcs.slice(off), ...srcs.slice(0, off)];
  }

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

  // ── Batch flush ───────────────────────────────────────────────────────────
  function startBatch() {
    if (batchTimer) return;
    batchTimer = setInterval(() => {
      if (!batchAccum.size) return;
      for (const [genre, incoming] of batchAccum) {
        const cur = genreResults.get(genre) ?? [];
        genreResults.set(genre, dedup([...cur, ...incoming]).slice(0, GRID_LIMIT));
      }
      batchAccum.clear();
      genreResults = new Map(genreResults);
    }, BATCH_MS);
  }

  function flushBatch() {
    if (batchTimer) { clearInterval(batchTimer); batchTimer = null; }
    if (!batchAccum.size) return;
    for (const [genre, incoming] of batchAccum) {
      const cur = genreResults.get(genre) ?? [];
      genreResults.set(genre, dedup([...cur, ...incoming]).slice(0, GRID_LIMIT));
    }
    batchAccum.clear();
    genreResults = new Map(genreResults);
  }

  function accumulate(genre: string, mangas: Manga[]) {
    const filtered = filterSource(mangas);
    if (!filtered.length) return;
    const existing = batchAccum.get(genre) ?? [];
    batchAccum.set(genre, [...existing, ...filtered]);
  }

  // ── Source fan-out ────────────────────────────────────────────────────────
  async function fanOut(genre: string, ctrl: AbortController) {
    const srcs  = rotatedSources();
    if (!srcs.length) return;

    const isAll = genre === "All";
    const type  = isAll ? "POPULAR" : "SEARCH";
    const query = isAll ? null : genre;

    startBatch();

    await runConcurrent(srcs, async src => {
      if (ctrl.signal.aborted) return;
      const key = dKey(src.id, type, genre);

      let mangas: Manga[];
      if (discoverStore.has(key)) {
        mangas = discoverStore.get(key)!;
      } else {
        const result = await gql<{ fetchSourceManga: { mangas: Manga[] } }>(
          FETCH_SOURCE_MANGA,
          { source: src.id, type, page: 1, query },
          ctrl.signal
        ).then(d => d.fetchSourceManga).catch(() => null);
        if (!result || ctrl.signal.aborted) return;
        mangas = result.mangas;
        discoverStore.set(key, mangas);
      }

      if (ctrl.signal.aborted) return;

      if (isAll) {
        accumulate("All", mangas);
      } else {
        const matching = mangas.filter(m =>
          (m.genre ?? []).some(g => g.toLowerCase() === genre.toLowerCase())
        );
        accumulate(genre, matching.length ? matching : mangas);
      }
    }, ctrl.signal);

    if (!ctrl.signal.aborted) flushBatch();
  }

  // ── Tab switch ────────────────────────────────────────────────────────────
  async function switchGenre(genre: string) {
    if (currentGenre === genre) return;

    activeCtrl?.abort();
    flushBatch();
    currentGenre = genre;

    const ctrl = new AbortController();
    activeCtrl  = ctrl;

    if (genre === "All") {
      genreResults.set("All", []);
      genreResults = new Map(genreResults);
      genreLoading = true;
      await fanOut("All", ctrl);
      if (!ctrl.signal.aborted) genreLoading = false;
      return;
    }

    // Genre tab: check local cache first, always fan out to sources too
    const localKey = `local|${genre}`;
    if (discoverStore.has(localKey)) {
      // Serve cached local results immediately
      genreResults.set(genre, discoverStore.get(localKey)!);
      genreResults = new Map(genreResults);
      // Always fan out in background to get source results too
      fanOut(genre, ctrl).catch(() => {});
      return;
    }

    // Fetch local library results then fan out
    genreLoading = true;
    try {
      const d = await gql<{ mangas: { nodes: Manga[] } }>(
        MANGAS_BY_GENRE, { genre, first: GRID_LIMIT }, ctrl.signal
      );
      if (ctrl.signal.aborted) return;

      const local = dedup(d.mangas.nodes);
      discoverStore.set(localKey, local);
      genreResults.set(genre, local.slice(0, GRID_LIMIT));
      genreResults = new Map(genreResults);
      genreLoading = false;

      // Always fan out — show source results alongside library results
      fanOut(genre, ctrl).catch(() => {});
    } catch (e: any) {
      if (e?.name !== "AbortError") console.error(e);
      if (!ctrl.signal.aborted) genreLoading = false;
    }
  }

  // ── Refresh ───────────────────────────────────────────────────────────────
  let refreshing = $state(false);

  async function refresh() {
    activeCtrl?.abort();
    flushBatch();
    clearDiscover();
    srcOffset++;
    genreResults  = new Map();
    refreshing    = true;
    genreLoading  = true;
    const genre   = currentGenre;
    currentGenre  = "";
    await new Promise(r => setTimeout(r, 20));
    await switchGenre(genre);
    refreshing = false;
  }

  // ── Initial load ──────────────────────────────────────────────────────────
  function loadAll() {
    loadingLib = true;
    loadError  = false;

    // Load library for filtering — don't show stuff already in library
    cache.get(CACHE_KEYS.DISCOVER, () =>
      gql<{ mangas: { nodes: Manga[] } }>(EXPLORE_ALL_MANGA).then(d => d.mangas.nodes)
    ).then(m => {
      allManga   = dedupeMangaById(m);
      libraryIds = new Set(allManga.filter(x => x.inLibrary).map(x => x.id));
    }).catch(e => { console.error(e); loadError = true; })
      .finally(() => { loadingLib = false; });

    // Load sources then kick off initial All tab fan-out
    gql<{ sources: { nodes: Source[] } }>(GET_SOURCES)
      .then(d => {
        allSources = d.sources.nodes;
        // Only trigger if still on All tab
        if (currentGenre === "All" || currentGenre === "") {
          const ctrl = new AbortController();
          activeCtrl  = ctrl;
          genreLoading = true;
          fanOut("All", ctrl).then(() => {
            if (!ctrl.signal.aborted) genreLoading = false;
          }).catch(() => {});
        }
      })
      .catch(console.error);
  }

  onDestroy(() => { activeCtrl?.abort(); flushBatch(); });

  loadAll();

  // ── Context menu ──────────────────────────────────────────────────────────
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
          .then(() => {
            cache.clear(CACHE_KEYS.LIBRARY);
            libraryIds = new Set([...libraryIds, m.id]);
          }).catch(console.error),
      },
      ...(store.settings.folders.length > 0 ? [
        { separator: true } as MenuEntry,
        ...store.settings.folders.map(f => ({
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
</script>

{#if store.activeSource}
  <SourceBrowse />
{:else}
  <div class="root">

    <div class="header">
      <span class="heading">Discover</span>
      <div class="tab-strip">
        {#each GENRE_TABS as tab (tab)}
          <button
            class="genre-tab"
            class:active={currentGenre === tab}
            onclick={() => switchGenre(tab)}
          >
            {#if tab === "All"}<Sparkle size={10} weight="fill" />{/if}
            {tab}
          </button>
        {/each}
      </div>
      <button class="refresh-btn" class:spinning={refreshing} onclick={refresh} title="Refresh results" disabled={refreshing}>
        <ArrowsClockwise size={13} weight="bold" />
      </button>
    </div>

    <div class="body">
      {#if isLoading}
        <div class="manga-grid">
          {#each Array(24) as _, i (i)}
            <div class="card-skeleton"><div class="skeleton cover-area"></div></div>
          {/each}
        </div>

      {:else if loadError && visibleGrid.length === 0}
        <div class="empty">
          <span>Could not reach Suwayomi</span>
          <button class="retry-btn" onclick={loadAll}>Retry</button>
        </div>

      {:else if visibleGrid.length === 0}
        <div class="empty"><span>Nothing found for "{currentGenre}"</span></div>

      {:else}
        <div class="manga-grid">
          {#each visibleGrid as m (m.id)}
            <button
              class="manga-card"
              onclick={() => setPreviewManga(m)}
              oncontextmenu={(e) => openCtx(e, m)}
            >
              <div class="cover-wrap">
                <img src={thumbUrl(m.thumbnailUrl)} alt={m.title} class="cover" loading="lazy" decoding="async" />
                <div class="cover-gradient"></div>
                {#if m.inLibrary}<span class="lib-badge">Saved</span>{/if}
                <div class="card-footer">
                  <p class="card-title">{m.title}</p>
                  {#if m.source?.displayName}<p class="card-source">{m.source.displayName}</p>{/if}
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
  .header { display: flex; align-items: center; gap: var(--sp-4); flex-shrink: 0; padding: var(--sp-3) var(--sp-4) var(--sp-3) var(--sp-6); border-bottom: 1px solid var(--border-dim); overflow-x: auto; scrollbar-width: none; }
  .header::-webkit-scrollbar { display: none; }
  .heading { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; flex-shrink: 0; }
  .tab-strip { display: flex; gap: var(--sp-1); flex-shrink: 0; }
  .genre-tab { display: flex; align-items: center; gap: 5px; font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); padding: 4px 12px; border-radius: var(--radius-full); border: 1px solid var(--border-dim); background: none; color: var(--text-faint); cursor: pointer; white-space: nowrap; transition: background var(--t-base), color var(--t-base), border-color var(--t-base); }
  .genre-tab:hover { color: var(--text-muted); border-color: var(--border-strong); background: var(--bg-raised); }
  .genre-tab.active { background: var(--accent-muted); border-color: var(--accent-dim); color: var(--accent-fg); }
  .refresh-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--radius-sm); background: none; border: none; color: var(--text-faint); cursor: pointer; flex-shrink: 0; margin-left: auto; transition: color var(--t-base), background var(--t-base); }
  .refresh-btn:hover { color: var(--text-muted); background: var(--bg-raised); }
  .body { flex: 1; overflow-y: auto; padding: var(--sp-4) var(--sp-5) var(--sp-6); will-change: scroll-position; -webkit-overflow-scrolling: touch; contain: layout style; }
  .manga-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(clamp(90px, 11vw, 130px), 1fr)); gap: var(--sp-2); align-content: start; contain: layout style; }
  .manga-card { background: none; border: none; padding: 0; cursor: pointer; text-align: left; }
  .manga-card:hover .cover { filter: brightness(1.08) saturate(1.05); transform: scale(1.02); }
  .manga-card:hover .card-title { color: #fff; }
  .manga-card:hover { will-change: transform; }
  .cover-wrap { position: relative; aspect-ratio: 2/3; overflow: hidden; border-radius: var(--radius-md); background: var(--bg-raised); border: 1px solid var(--border-dim); box-shadow: 0 2px 8px rgba(0,0,0,0.25); }
  .cover { width: 100%; height: 100%; object-fit: cover; display: block; transition: filter 0.15s ease, transform 0.15s ease; }
  .cover-gradient { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.15) 50%, transparent 72%); pointer-events: none; }
  .lib-badge { position: absolute; top: var(--sp-1); right: var(--sp-1); font-family: var(--font-ui); font-size: 9px; letter-spacing: var(--tracking-wide); text-transform: uppercase; background: var(--accent-muted); color: var(--accent-fg); border: 1px solid var(--accent-dim); padding: 1px 5px; border-radius: var(--radius-sm); }
  .card-footer { position: absolute; bottom: 0; left: 0; right: 0; padding: var(--sp-2); pointer-events: none; }
  .card-title { font-size: var(--text-xs); font-weight: var(--weight-medium); color: rgba(255,255,255,0.92); line-height: var(--leading-snug); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-shadow: 0 1px 4px rgba(0,0,0,0.7); transition: color var(--t-base); }
  .card-source { font-family: var(--font-ui); font-size: 9px; color: rgba(255,255,255,0.45); letter-spacing: var(--tracking-wide); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-skeleton { padding: 0; }
  .cover-area { aspect-ratio: 2/3; border-radius: var(--radius-md); }
  .skeleton { background: var(--bg-raised); border-radius: var(--radius-sm); animation: pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 0.4 } 50% { opacity: 0.85 } }
  .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-3); padding: var(--sp-10) var(--sp-6); color: var(--text-faint); font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); }
  .retry-btn { padding: 6px 16px; border-radius: var(--radius-md); border: 1px solid var(--border-dim); background: var(--bg-raised); color: var(--text-muted); cursor: pointer; font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); }
  .refresh-btn.spinning { opacity: 0.5; cursor: default; }
  .refresh-btn.spinning :global(svg) { animation: spin 0.8s linear infinite; }
  @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
  @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
</style>
