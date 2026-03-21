<script lang="ts">
  import { onDestroy } from "svelte";
  import { ArrowRight, Compass, List, BookOpen, Star, Fire, BookmarkSimple, FolderSimplePlus, Folder } from "phosphor-svelte";
  import { gql, thumbUrl } from "../../lib/client";
  import { UPDATE_MANGA, GET_SOURCES, FETCH_SOURCE_MANGA } from "../../lib/queries";
  import { cache, CACHE_KEYS, getTopSources } from "../../lib/cache";
  import { dedupeSources, dedupeMangaByTitle } from "../../lib/util";
  import { settings, activeSource, genreFilter, previewManga, history, addFolder, assignMangaToFolder } from "../../store";
  import type { Manga, Source } from "../../lib/types";
  import ContextMenu, { type MenuEntry } from "../shared/ContextMenu.svelte";
  import SourceList    from "../sources/SourceList.svelte";
  import SourceBrowse  from "../sources/SourceBrowse.svelte";
  import GenreDrillPage from "./GenreDrillPage.svelte";

  type ExploreMode = "explore" | "sources";
  let mode: ExploreMode = "explore";

  const EXPLORE_ALL_MANGA = `
    query ExploreAllManga {
      mangas(orderBy: IN_LIBRARY_AT, orderByType: DESC) {
        nodes { id title thumbnailUrl inLibrary genre status source { id displayName } }
      }
    }
  `;
  const MANGAS_BY_GENRE_EXPLORE = `
    query MangasByGenreExplore($genre: String!, $first: Int) {
      mangas(filter: { genre: { includesInsensitive: $genre } }, first: $first, orderBy: IN_LIBRARY_AT, orderByType: DESC) {
        nodes { id title thumbnailUrl inLibrary genre }
      }
    }
  `;

  const FOUNDATIONAL_GENRES = ["Action", "Romance", "Fantasy", "Adventure", "Comedy", "Drama"];
  const ROW_CAP = 25;
  const GHOST_COUNT = 3;

  let allManga: Manga[]            = [];
  let popularManga: Manga[]        = [];
  let sources: Source[]            = [];
  let genreResultsMap              = new Map<string, Manga[]>();
  let loadingLib                   = true;
  let loadingPopular               = true;
  let loadingGenres                = false;
  let loadError                    = false;
  let retryCount                   = 0;
  let ctx: { x: number; y: number; manga: Manga } | null = null;
  let abortCtrl: AbortController | null = null;
  let fetchedGenresKey             = "";

  function frecencyScore(readAt: number, count: number): number {
    return count / Math.log((Date.now() - readAt) / 3_600_000 + 2);
  }

  $: frecencyGenres = (() => {
    const mangaScores = new Map<number, number>();
    const mangaReadAt = new Map<number, number>();
    for (const e of $history) {
      mangaScores.set(e.mangaId, (mangaScores.get(e.mangaId) ?? 0) + 1);
      if (e.readAt > (mangaReadAt.get(e.mangaId) ?? 0)) mangaReadAt.set(e.mangaId, e.readAt);
    }
    const genreWeights = new Map<string, number>();
    const mangaMap = new Map(allManga.map((m) => [m.id, m]));
    for (const [mangaId, count] of mangaScores.entries()) {
      const score = frecencyScore(mangaReadAt.get(mangaId) ?? 0, count);
      for (const g of mangaMap.get(mangaId)?.genre ?? []) genreWeights.set(g, (genreWeights.get(g) ?? 0) + score);
    }
    if (genreWeights.size === 0) allManga.filter((m) => m.inLibrary).forEach((m) => (m.genre ?? []).forEach((g) => genreWeights.set(g, (genreWeights.get(g) ?? 0) + 1)));
    if (genreWeights.size === 0) return FOUNDATIONAL_GENRES.slice(0, 3);
    return Array.from(genreWeights.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g);
  })();

  $: continueReading = (() => {
    const mangaMap = new Map(allManga.map((m) => [m.id, m]));
    const seen = new Set<number>();
    const result: { manga: Manga; chapterName: string; progress: number }[] = [];
    for (const e of $history) {
      if (seen.has(e.mangaId)) continue;
      seen.add(e.mangaId);
      const manga = mangaMap.get(e.mangaId);
      if (!manga) continue;
      result.push({ manga, chapterName: e.chapterName, progress: e.pageNumber > 0 ? Math.min(e.pageNumber / 20, 1) : 0 });
      if (result.length >= 12) break;
    }
    return result;
  })();

  $: recommended = allManga.length && frecencyGenres.length ? (() => {
    const continueIds = new Set(continueReading.map((r) => r.manga.id));
    return allManga.filter((m) => m.inLibrary && !continueIds.has(m.id) && frecencyGenres.some((g) => (m.genre ?? []).includes(g))).slice(0, 20);
  })() : [];

  $: if (frecencyGenres.length && allManga.length) loadGenreRows();

  async function loadGenreRows() {
    const key = frecencyGenres.join(",");
    if (fetchedGenresKey === key) return;
    fetchedGenresKey = key;
    loadingGenres = true;
    abortCtrl?.abort();
    const ctrl = new AbortController();
    abortCtrl = ctrl;
    const streamMap = new Map<string, Manga[]>();
    await Promise.allSettled(
      frecencyGenres.map((genre) =>
        cache.get(CACHE_KEYS.GENRE(genre), () =>
          gql<{ mangas: { nodes: Manga[] } }>(MANGAS_BY_GENRE_EXPLORE, { genre, first: 25 }, ctrl.signal)
            .then((d) => d.mangas.nodes)
        ).then((mangas) => {
          if (ctrl.signal.aborted) return;
          streamMap.set(genre, mangas);
          genreResultsMap = new Map(streamMap);
        })
      )
    ).catch(() => {});
    if (!ctrl.signal.aborted) loadingGenres = false;
  }

  $: if (retryCount >= 0) loadData();

  async function loadData() {
    if (allManga.length > 0 && retryCount === 0) return;
    loadingLib = true; loadingPopular = true; loadError = false;
    const preferredLang = $settings.preferredExtensionLang || "en";
    if (retryCount > 0) { cache.clear(CACHE_KEYS.LIBRARY); cache.clear(CACHE_KEYS.SOURCES); fetchedGenresKey = ""; }

    cache.get(CACHE_KEYS.LIBRARY, () =>
      gql<{ mangas: { nodes: Manga[] } }>(EXPLORE_ALL_MANGA).then((d) => d.mangas.nodes)
    ).then((m) => { allManga = m; }).catch((e) => { console.error(e); loadError = true; }).finally(() => loadingLib = false);

    cache.get(CACHE_KEYS.SOURCES, () =>
      gql<{ sources: { nodes: Source[] } }>(GET_SOURCES).then((d) => dedupeSources(d.sources.nodes, preferredLang))
    ).then(async (allSources) => {
      if (!allSources.length) { loadingPopular = false; return; }
      const top = getTopSources(allSources).slice(0, 2);
      sources = allSources;
      cache.get(CACHE_KEYS.POPULAR, () =>
        Promise.allSettled(top.map((src) =>
          gql<{ fetchSourceManga: { mangas: Manga[] } }>(FETCH_SOURCE_MANGA, { source: src.id, type: "POPULAR", page: 1, query: null })
            .then((d) => d.fetchSourceManga.mangas)
        )).then((results) => {
          const merged: Manga[] = [];
          for (const r of results) if (r.status === "fulfilled") merged.push(...r.value);
          return dedupeMangaByTitle(merged).slice(0, 30);
        })
      ).then((m) => popularManga = m).catch(console.error).finally(() => loadingPopular = false);
    }).catch((e) => { console.error(e); loadError = true; loadingPopular = false; });
  }

  function buildCtxItems(m: Manga): MenuEntry[] {
    return [
      { label: m.inLibrary ? "In Library" : "Add to library", icon: BookmarkSimple, disabled: m.inLibrary,
        onClick: () => gql(UPDATE_MANGA, { id: m.id, inLibrary: true }).then(() => cache.clear(CACHE_KEYS.LIBRARY)).catch(console.error) },
      ...($settings.folders.length > 0 ? [
        { separator: true } as MenuEntry,
        ...$settings.folders.map((f): MenuEntry => ({
          label: f.mangaIds.includes(m.id) ? `✓ ${f.name}` : f.name, icon: Folder,
          onClick: () => assignMangaToFolder(f.id, m.id),
        })),
      ] : []),
      { separator: true },
      { label: "New folder & add", icon: FolderSimplePlus, onClick: () => { const name = prompt("Folder name:"); if (name?.trim()) { const id = addFolder(name.trim()); assignMangaToFolder(id, m.id); } } },
    ];
  }

  function rowWheel(e: WheelEvent) {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    const el = e.currentTarget as HTMLDivElement;
    if (el.scrollLeft <= 0 && el.scrollLeft >= el.scrollWidth - el.clientWidth - 1) return;
    e.stopPropagation();
    el.scrollLeft += e.deltaY;
  }

  onDestroy(() => abortCtrl?.abort());
</script>

{#if $activeSource}
  <SourceBrowse />
{:else if $genreFilter}
  <GenreDrillPage />
{:else}
  <div class="root">
    <div class="header">
      <div class="header-left">
        <h1 class="heading">Explore</h1>
        <div class="tabs">
          <button class="tab" class:active={mode === "explore"} on:click={() => mode = "explore"}>
            <Compass size={11} weight="bold" /> Explore
          </button>
          <button class="tab" class:active={mode === "sources"} on:click={() => mode = "sources"}>
            <List size={11} weight="bold" /> Sources
          </button>
        </div>
      </div>
    </div>

    <div style="display:{mode === 'explore' ? 'contents' : 'none'}">
      <div class="body">

        {#if continueReading.length > 0 || loadingLib}
          <div class="section">
            <div class="section-header">
              <span class="section-title"><BookOpen size={11} weight="bold" /> Continue Reading</span>
            </div>
            {#if loadingLib}
              <div class="skeleton-row">{#each Array(8) as _}<div class="card-skeleton"><div class="cover-skeleton skeleton"></div><div class="title-skeleton skeleton"></div></div>{/each}</div>
            {:else}
              <div class="row" on:wheel={rowWheel}>
                {#each continueReading.slice(0, ROW_CAP) as { manga, chapterName, progress }}
                  <button class="card" on:click={() => previewManga.set(manga)} on:contextmenu={(e) => { e.preventDefault(); ctx = { x: e.clientX, y: e.clientY, manga }; }}>
                    <div class="cover-wrap">
                      <img src={thumbUrl(manga.thumbnailUrl)} alt={manga.title} class="cover" loading="lazy" decoding="async" />
                      {#if manga.inLibrary}<span class="in-library-badge">Saved</span>{/if}
                      {#if progress > 0}<div class="progress-bar"><div class="progress-fill" style="width:{progress * 100}%"></div></div>{/if}
                    </div>
                    <p class="title">{manga.title}</p>
                    {#if chapterName}<p class="subtitle">{chapterName}</p>{/if}
                  </button>
                {/each}
                {#each Array(GHOST_COUNT) as _}<div class="ghost-card" aria-hidden></div>{/each}
              </div>
            {/if}
          </div>
        {/if}

        {#if recommended.length > 0 || loadingLib}
          <div class="section">
            <div class="section-header">
              <span class="section-title"><Star size={11} weight="bold" /> Recommended for You</span>
            </div>
            {#if loadingLib}
              <div class="skeleton-row">{#each Array(8) as _}<div class="card-skeleton"><div class="cover-skeleton skeleton"></div><div class="title-skeleton skeleton"></div></div>{/each}</div>
            {:else}
              <div class="row" on:wheel={rowWheel}>
                {#each recommended.slice(0, ROW_CAP) as m}
                  <button class="card" on:click={() => previewManga.set(m)} on:contextmenu={(e) => { e.preventDefault(); ctx = { x: e.clientX, y: e.clientY, manga: m }; }}>
                    <div class="cover-wrap"><img src={thumbUrl(m.thumbnailUrl)} alt={m.title} class="cover" loading="lazy" decoding="async" />{#if m.inLibrary}<span class="in-library-badge">Saved</span>{/if}</div>
                    <p class="title">{m.title}</p>
                  </button>
                {/each}
                {#each Array(GHOST_COUNT) as _}<div class="ghost-card" aria-hidden></div>{/each}
              </div>
            {/if}
          </div>
        {/if}

        {#if popularManga.length > 0 || loadingPopular}
          <div class="section">
            <div class="section-header">
              <span class="section-title">
                <Fire size={11} weight="bold" />
                {sources.length === 1 ? `Popular on ${sources[0].displayName}` : sources.length > 1 ? `Popular across ${sources.length} sources` : "Popular"}
              </span>
            </div>
            {#if loadingPopular}
              <div class="skeleton-row">{#each Array(8) as _}<div class="card-skeleton"><div class="cover-skeleton skeleton"></div><div class="title-skeleton skeleton"></div></div>{/each}</div>
            {:else if sources.length === 0}
              <div class="no-source">No sources installed. Add extensions first.</div>
            {:else}
              <div class="row" on:wheel={rowWheel}>
                {#each popularManga.slice(0, ROW_CAP) as m}
                  <button class="card" on:click={() => previewManga.set(m)} on:contextmenu={(e) => { e.preventDefault(); ctx = { x: e.clientX, y: e.clientY, manga: m }; }}>
                    <div class="cover-wrap"><img src={thumbUrl(m.thumbnailUrl)} alt={m.title} class="cover" loading="lazy" decoding="async" />{#if m.inLibrary}<span class="in-library-badge">Saved</span>{/if}</div>
                    <p class="title">{m.title}</p>
                  </button>
                {/each}
                {#each Array(GHOST_COUNT) as _}<div class="ghost-card" aria-hidden></div>{/each}
              </div>
            {/if}
          </div>
        {/if}

        {#each frecencyGenres as genre}
          {@const items = genreResultsMap.get(genre) ?? []}
          {@const isLoading = loadingGenres && items.length === 0}
          {#if isLoading || items.length > 0}
            <div class="section">
              <div class="section-header">
                <span class="section-title">{genre}</span>
                <button class="see-all" on:click={() => genreFilter.set(genre)}>See all <ArrowRight size={11} weight="light" /></button>
              </div>
              {#if isLoading}
                <div class="skeleton-row">{#each Array(8) as _}<div class="card-skeleton"><div class="cover-skeleton skeleton"></div><div class="title-skeleton skeleton"></div></div>{/each}</div>
              {:else}
                <div class="row" on:wheel={rowWheel}>
                  {#each items.slice(0, ROW_CAP) as m}
                    <button class="card" on:click={() => previewManga.set(m)} on:contextmenu={(e) => { e.preventDefault(); ctx = { x: e.clientX, y: e.clientY, manga: m }; }}>
                      <div class="cover-wrap"><img src={thumbUrl(m.thumbnailUrl)} alt={m.title} class="cover" loading="lazy" decoding="async" />{#if m.inLibrary}<span class="in-library-badge">Saved</span>{/if}</div>
                      <p class="title">{m.title}</p>
                    </button>
                  {/each}
                  {#if items.length >= ROW_CAP}
                    <button class="explore-more-card" on:click={() => genreFilter.set(genre)}>
                      <div class="explore-more-inner">
                        <ArrowRight size={20} weight="light" class="explore-more-icon" />
                        <span class="explore-more-label">Explore more</span>
                        <span class="explore-more-genre">{genre}</span>
                      </div>
                    </button>
                  {/if}
                  {#each Array(GHOST_COUNT) as _}<div class="ghost-card" aria-hidden></div>{/each}
                </div>
              {/if}
            </div>
          {/if}
        {/each}

        {#if !loadingLib && !loadingPopular && !loadingGenres && continueReading.length === 0 && recommended.length === 0 && popularManga.length === 0 && frecencyGenres.every((g) => !genreResultsMap.get(g)?.length)}
          <div class="empty">
            {#if loadError}
              <span>Could not reach Suwayomi</span>
              <span class="empty-hint">Make sure the server is running, then try again.</span>
              <button class="retry-btn" on:click={() => { loadingLib = true; loadingPopular = true; retryCount++; }}>Retry</button>
            {:else}
              <span>Nothing to explore yet</span>
              <span class="empty-hint">Add manga to your library or install sources to get started.</span>
            {/if}
          </div>
        {/if}
      </div>
    </div>

    {#if mode === "sources"}<SourceList />{/if}
  </div>
{/if}

{#if ctx}
  <ContextMenu x={ctx.x} y={ctx.y} items={buildCtxItems(ctx.manga)} onClose={() => ctx = null} />
{/if}

<style>
  .root { display: flex; flex-direction: column; height: 100%; overflow: hidden; animation: fadeIn 0.14s ease both; }
  .header { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-4) var(--sp-6); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; gap: var(--sp-4); }
  .header-left { display: flex; align-items: center; gap: var(--sp-4); }
  .heading { font-family: var(--font-ui); font-size: var(--text-xs); font-weight: var(--weight-normal); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; flex-shrink: 0; }
  .tabs { display: flex; gap: 2px; background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-md); padding: 2px; }
  .tab { display: flex; align-items: center; gap: 5px; font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); text-transform: uppercase; padding: 4px 10px; border-radius: var(--radius-sm); color: var(--text-faint); transition: background var(--t-base), color var(--t-base); white-space: nowrap; }
  .tab:hover { color: var(--text-muted); }
  .tab.active { background: var(--accent-muted); color: var(--accent-fg); border: 1px solid var(--accent-dim); }
  .body { flex: 1; overflow-y: auto; padding: var(--sp-5) 0 var(--sp-6); will-change: scroll-position; -webkit-overflow-scrolling: touch; }
  .section { margin-bottom: var(--sp-6); }
  .section-header { display: flex; align-items: center; justify-content: space-between; padding: 0 var(--sp-6) var(--sp-3); }
  .section-title { display: inline-flex; align-items: center; gap: var(--sp-2); font-family: var(--font-ui); font-size: var(--text-xs); font-weight: var(--weight-normal); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; }
  .see-all { display: flex; align-items: center; gap: 4px; font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); text-transform: uppercase; color: var(--text-faint); background: none; border: none; cursor: pointer; padding: 2px 0; transition: color var(--t-base); }
  .see-all:hover { color: var(--accent-fg); }
  .row { display: flex; gap: var(--sp-3); padding: 0 var(--sp-6); overflow-x: auto; scrollbar-width: none; -ms-overflow-style: none; scroll-behavior: smooth; }
  .row::-webkit-scrollbar { display: none; }
  .card { flex-shrink: 0; width: 110px; background: none; border: none; padding: 0; cursor: pointer; text-align: left; }
  .card:hover .cover { filter: brightness(1.06); }
  .card:hover .title { color: var(--text-primary); }
  .cover-wrap { position: relative; aspect-ratio: 2/3; overflow: hidden; border-radius: var(--radius-md); background: var(--bg-raised); border: 1px solid var(--border-dim); transform: translateZ(0); }
  .cover { width: 100%; height: 100%; object-fit: cover; transition: filter var(--t-base); will-change: filter; }
  .in-library-badge { position: absolute; bottom: var(--sp-1); left: var(--sp-1); font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); text-transform: uppercase; background: var(--accent-muted); color: var(--accent-fg); border: 1px solid var(--accent-dim); padding: 2px 5px; border-radius: var(--radius-sm); }
  .progress-bar { position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: var(--bg-overlay); }
  .progress-fill { height: 100%; background: var(--accent-fg); border-radius: 0 2px 0 0; transition: width 0.2s ease; }
  .title { margin-top: var(--sp-2); font-size: var(--text-sm); color: var(--text-secondary); line-height: var(--leading-snug); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; transition: color var(--t-base); }
  .subtitle { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); margin-top: 2px; letter-spacing: var(--tracking-wide); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ghost-card { flex-shrink: 0; width: 110px; aspect-ratio: 2/3; pointer-events: none; visibility: hidden; }
  .skeleton-row { display: flex; gap: var(--sp-3); padding: 0 var(--sp-6); overflow: hidden; }
  .card-skeleton { flex-shrink: 0; width: 110px; }
  .cover-skeleton { aspect-ratio: 2/3; border-radius: var(--radius-md); }
  .title-skeleton { height: 11px; margin-top: var(--sp-2); width: 80%; }
  .explore-more-card { flex-shrink: 0; width: 110px; aspect-ratio: 2/3; border-radius: var(--radius-md); border: 1px dashed var(--border-strong); background: var(--bg-raised); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: border-color var(--t-base), background var(--t-base); padding: 0; }
  .explore-more-card:hover { border-color: var(--accent); background: var(--accent-muted); }
  .explore-more-inner { display: flex; flex-direction: column; align-items: center; gap: var(--sp-2); padding: var(--sp-3); pointer-events: none; }
  :global(.explore-more-icon) { color: var(--text-faint); transition: color var(--t-base); }
  .explore-more-label { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); text-transform: uppercase; color: var(--text-faint); text-align: center; }
  .explore-more-genre { font-size: var(--text-2xs); color: var(--text-faint); opacity: 0.6; text-align: center; font-family: var(--font-ui); letter-spacing: var(--tracking-wide); }
  .no-source { display: flex; align-items: center; justify-content: center; padding: var(--sp-4) var(--sp-6); color: var(--text-faint); font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); }
  .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: var(--sp-8) var(--sp-6); color: var(--text-faint); font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); gap: var(--sp-2); text-align: center; }
  .empty-hint { font-size: var(--text-2xs); color: var(--text-faint); opacity: 0.6; }
  .retry-btn { margin-top: var(--sp-3); padding: 6px 16px; border-radius: var(--radius-md); border: 1px solid var(--border-dim); background: var(--bg-raised); color: var(--text-muted); cursor: pointer; font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); }
</style>
