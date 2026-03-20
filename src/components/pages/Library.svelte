<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { MagnifyingGlass, Books, DownloadSimple, Folder, FolderSimplePlus, Trash } from "phosphor-svelte";
  import { gql, thumbUrl } from "../../lib/client";
  import { GET_LIBRARY, GET_MANGA, UPDATE_MANGA, GET_CHAPTERS, DELETE_DOWNLOADED_CHAPTERS, DEQUEUE_DOWNLOAD } from "../../lib/queries";
  import { cache, CACHE_KEYS, CACHE_GROUPS, DEFAULT_TTL_MS } from "../../lib/cache";
  import { dedupeMangaById, dedupeMangaByTitle } from "../../lib/util";
  import { store, setActiveManga, setLibraryFilter } from "../../store/state.svelte";
  import { addFolder, assignMangaToFolder, removeMangaFromFolder, getMangaFolders } from "../../store/state.svelte";
  import { COMPLETED_FOLDER_ID } from "../../store/state.svelte";
  import type { Manga, Chapter } from "../../lib/types";
  import ContextMenu, { type MenuEntry } from "../shared/ContextMenu.svelte";

  const CARD_MIN_W = 130;
  const CARD_GAP   = 16;

  let allManga:        Manga[]     = $state([]);
  let extraManga:      Manga[]     = $state([]); // non-library manga needed for folders (e.g. completed)
  let loading:         boolean     = $state(true);
  let error:           string|null = $state(null);
  let retryCount:      number      = $state(0);
  let search:          string      = $state("");
  let renderVisible:   number      = $state(0);
  let scrollEl:        HTMLDivElement;
  let containerWidth:  number      = $state(800);
  let ctx:  { x: number; y: number; manga: Manga } | null = $state(null);
  let emptyCtx: { x: number; y: number } | null           = $state(null);

  let prevChapterId: number | null = null;

  $effect(() => {
    const wasOpen = prevChapterId !== null;
    prevChapterId = store.activeChapter?.id ?? null;
    if (wasOpen && !store.activeChapter) cache.clear(CACHE_KEYS.LIBRARY);
  });

  function fetchLibrary() {
    return cache.get(
      CACHE_KEYS.LIBRARY,
      () => gql<{ mangas: { nodes: Manga[] } }>(GET_LIBRARY).then(d => d.mangas.nodes),
      DEFAULT_TTL_MS,
      CACHE_GROUPS.LIBRARY,
    );
  }

  function loadData() {
    fetchLibrary()
      .then(nodes => { allManga = dedupeMangaByTitle(dedupeMangaById(nodes), store.settings.mangaLinks); error = null; })
      .catch(e => error = e.message)
      .finally(() => loading = false);
  }

  $effect(() => {
    retryCount;
    loading = true; error = null;
    if (retryCount > 0) cache.clear(CACHE_KEYS.LIBRARY);
    untrack(() => loadData());
  });

  // Lazily fetch manga that are in a folder but not in the library (e.g. completed but removed from library)
  $effect(() => {
    const allIds   = new Set(allManga.map(m => m.id));
    const missingIds = store.settings.folders
      .flatMap(f => f.mangaIds)
      .filter(id => !allIds.has(id));
    if (!missingIds.length) return;
    const toFetch = [...new Set(missingIds)].filter(id => !extraManga.some(m => m.id === id));
    if (!toFetch.length) return;
    untrack(() => {
      Promise.all(
        toFetch.map(id =>
          cache.get(CACHE_KEYS.MANGA(id), () =>
            gql<{ manga: Manga }>(GET_MANGA, { id }).then(d => d.manga)
          ).catch(() => null)
        )
      ).then(results => {
        const valid = results.filter(Boolean) as Manga[];
        if (valid.length) extraManga = dedupeMangaById([...extraManga, ...valid]);
      });
    });
  });

  $effect(() => { if (scrollEl) scrollEl.scrollTo({ top: 0 }); });

  $effect(() => {
    const f = store.settings.folders.find(f => f.id === store.libraryFilter);
    if (f && !f.showTab) untrack(() => { store.libraryFilter = "library"; });
  });

  const isBuiltin = (f: string) => f === "library" || f === "downloaded";

  // All manga available for folder filtering — library + any extras fetched above
  const folderPool = $derived((() => {
    const seen = new Set(allManga.map(m => m.id));
    return [...allManga, ...extraManga.filter(m => !seen.has(m.id))];
  })());

  const filtered = $derived((() => {
    const q = search.trim().toLowerCase();
    if (store.libraryFilter === "library") {
      return q ? allManga.filter(m => m.title.toLowerCase().includes(q)) : allManga;
    }
    if (store.libraryFilter === "downloaded") {
      const items = allManga.filter(m => (m.downloadCount ?? 0) > 0);
      return q ? items.filter(m => m.title.toLowerCase().includes(q)) : items;
    }
    const folder = store.settings.folders.find(f => f.id === store.libraryFilter);
    if (folder) {
      const items = folderPool.filter(m => folder.mangaIds.includes(m.id));
      return q ? items.filter(m => m.title.toLowerCase().includes(q)) : items;
    }
    return [];
  })());

  const cols           = $derived(Math.max(1, Math.floor((containerWidth + CARD_GAP) / (CARD_MIN_W + CARD_GAP))));
  const visibleManga   = $derived(filtered.slice(0, renderVisible));
  const hasMore        = $derived(filtered.length > renderVisible);
  const remainingCount = $derived(filtered.length - renderVisible);

  $effect(() => { filtered; untrack(() => { renderVisible = store.settings.renderLimit ?? 48; }); });

  const counts = $derived({
    library:    allManga.length,
    downloaded: allManga.filter(m => (m.downloadCount ?? 0) > 0).length,
    ...store.settings.folders.reduce((a, f) => ({ ...a, [f.id]: folderPool.filter(m => f.mangaIds.includes(m.id)).length }), {} as Record<string, number>),
  });

  function loadMore() { renderVisible += store.settings.renderLimit ?? 48; }

  async function removeFromLibrary(manga: Manga) {
    await gql(UPDATE_MANGA, { id: manga.id, inLibrary: false }).catch(console.error);
    allManga = allManga.filter(m => m.id !== manga.id);
    cache.clearGroup(CACHE_GROUPS.LIBRARY);
  }

  async function deleteAllDownloads(manga: Manga) {
    try {
      const data = await gql<{ chapters: { nodes: Chapter[] } }>(GET_CHAPTERS, { mangaId: manga.id });
      const ids = data.chapters.nodes.filter(c => c.isDownloaded).map(c => c.id);
      if (!ids.length) return;
      await gql(DELETE_DOWNLOADED_CHAPTERS, { ids });
      await Promise.allSettled(ids.map(id => gql(DEQUEUE_DOWNLOAD, { chapterId: id })));
      allManga = allManga.map(m => m.id === manga.id ? { ...m, downloadCount: 0 } : m);
    } catch (e) { console.error(e); }
  }

  function openCtx(e: MouseEvent, m: Manga) { e.preventDefault(); ctx = { x: e.clientX, y: e.clientY, manga: m }; }

  function buildCtxItems(m: Manga): MenuEntry[] {
    const mangaFolders = getMangaFolders(m.id);
    const folderEntries: MenuEntry[] = store.settings.folders.map(f => {
      const inFolder = mangaFolders.some(mf => mf.id === f.id);
      return { label: inFolder ? `Remove from ${f.name}` : `Add to ${f.name}`, icon: Folder, onClick: () => inFolder ? removeMangaFromFolder(f.id, m.id) : assignMangaToFolder(f.id, m.id) };
    });
    return [
      { label: m.inLibrary ? "Remove from library" : "Add to library", icon: Books, onClick: () => m.inLibrary ? removeFromLibrary(m) : gql(UPDATE_MANGA, { id: m.id, inLibrary: true }).then(() => { allManga = allManga.map(x => x.id === m.id ? { ...x, inLibrary: true } : x); cache.clear(CACHE_KEYS.LIBRARY); }).catch(console.error) },
      { label: "Delete all downloads", icon: Trash, danger: true, disabled: !(m.downloadCount && m.downloadCount > 0), onClick: () => deleteAllDownloads(m) },
      ...(folderEntries.length ? [{ separator: true } as MenuEntry, ...folderEntries] : []),
      { separator: true },
      { label: "New folder", icon: FolderSimplePlus, onClick: () => { const name = prompt("Folder name:"); if (name?.trim()) { const id = addFolder(name.trim()); assignMangaToFolder(id, m.id); } } },
    ];
  }

  function buildEmptyCtx(): MenuEntry[] {
    return [{ label: "New folder", icon: FolderSimplePlus, onClick: () => { const name = prompt("Folder name:"); if (name?.trim()) addFolder(name.trim()); } }];
  }

  onMount(() => {
    const ro = new ResizeObserver(([e]) => containerWidth = e.contentRect.width);
    ro.observe(scrollEl);
    const unsub = cache.subscribe(CACHE_KEYS.LIBRARY, loadData);
    return () => { ro.disconnect(); unsub(); };
  });
</script>

<div
  class="root"
  role="presentation"
  bind:this={scrollEl}
  oncontextmenu={(e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    emptyCtx = { x: e.clientX, y: e.clientY };
  }}
>
  {#if store.settings.libraryBranches ?? true}
    <svg class="branches" viewBox="0 0 400 600" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
      <g stroke="var(--accent)" stroke-width="0.6" fill="none" opacity="0.13">
        <path d="M380 600 C380 500 340 460 310 400 C280 340 300 280 270 220"/>
        <path d="M270 220 C255 190 230 175 210 150"/>
        <path d="M270 220 C290 195 310 185 330 165"/>
        <path d="M310 400 C290 375 265 368 245 350"/>
        <path d="M310 400 C330 370 355 362 370 340"/>
        <path d="M210 150 C195 128 185 108 175 80"/>
        <path d="M210 150 C225 130 240 122 258 105"/>
        <path d="M245 350 C228 330 215 315 205 290"/>
        <path d="M175 80  C168 60  162 42  158 20"/>
        <path d="M175 80  C185 62  195 50  208 35"/>
        <path d="M205 290 C196 268 190 250 186 225"/>
        <path d="M258 105 C268 88  278 72  292 52"/>
        <path class="anim-branch" d="M186 225 C180 205 176 185 174 160"/>
        <path class="anim-branch" d="M292 52  C300 36  308 20  318 0"/>
      </g>
    </svg>
  {/if}

  {#if error}
    <div class="center">
      <p class="error-msg">Could not reach Suwayomi</p>
      <p class="error-detail">Make sure the server is running, then retry.</p>
      <button class="retry-btn" onclick={() => retryCount++}>Retry</button>
    </div>
  {:else}
    <div class="header">
      <div class="header-left">
        <span class="heading">Library</span>
        <div class="tabs">
          {#each [["library","Saved"], ["downloaded","Downloaded"]] as [f, label]}
            <button class="tab" class:active={store.libraryFilter === f} onclick={() => store.libraryFilter = f}>
              {#if f === "library"}<Books size={11} weight="bold" />
              {:else if f === "downloaded"}<DownloadSimple size={11} weight="bold" />{/if}
              {label}
              <span class="tab-count">{counts[f] ?? 0}</span>
            </button>
          {/each}
          {#each store.settings.folders.filter(f => f.showTab) as folder}
            <button class="tab" class:active={store.libraryFilter === folder.id} onclick={() => store.libraryFilter = folder.id}>
              <Folder size={11} weight="bold" />
              {folder.name}
              <span class="tab-count">{counts[folder.id] ?? 0}</span>
            </button>
          {/each}
        </div>
      </div>
      <div class="search-wrap">
        <MagnifyingGlass size={13} class="search-icon" weight="light" />
        <input class="search" placeholder="Search" bind:value={search} />
      </div>
    </div>

    {#if loading}
      <div class="grid">
        {#each Array(12) as _}
          <div class="card-skeleton">
            <div class="cover-skeleton skeleton"></div>
            <div class="title-skeleton skeleton"></div>
          </div>
        {/each}
      </div>
    {:else if filtered.length === 0}
      <div class="center">
        {store.libraryFilter === "library" ? "No manga saved to library — browse sources to add some."
          : store.libraryFilter === "downloaded" ? "No downloaded manga."
          : "No manga in this folder yet. Right-click manga anywhere to assign them."}
      </div>
    {:else}
      <div class="grid" style="--cols:{cols}">
        {#each visibleManga as m (m.id)}
          <button class="card" onclick={() => store.activeManga = m} oncontextmenu={(e) => openCtx(e, m)}>
            <div class="cover-wrap">
              <img src={thumbUrl(m.thumbnailUrl)} alt={m.title} class="cover" style="object-fit:{store.settings.libraryCropCovers ? 'cover' : 'contain'}" loading="lazy" decoding="async" />
              {#if m.downloadCount}<span class="badge-dl">{m.downloadCount}</span>{/if}
              {#if m.unreadCount}<span class="badge-unread">{m.unreadCount}</span>{/if}
            </div>
            <p class="title">{m.title}</p>
          </button>
        {/each}
      </div>
      {#if hasMore}
        <div class="load-more-row">
          <button class="load-more-btn" onclick={loadMore}>
            Show {Math.min(remainingCount, store.settings.renderLimit ?? 48)} more
            <span class="load-more-count">({remainingCount} remaining)</span>
          </button>
        </div>
      {/if}
    {/if}
  {/if}
</div>

{#if ctx}
  <ContextMenu x={ctx.x} y={ctx.y} items={buildCtxItems(ctx.manga)} onClose={() => ctx = null} />
{/if}
{#if emptyCtx}
  <ContextMenu x={emptyCtx.x} y={emptyCtx.y} items={buildEmptyCtx()} onClose={() => emptyCtx = null} />
{/if}

<style>
  .root { position: relative; padding: var(--sp-5) var(--sp-6); overflow-y: auto; height: 100%; animation: fadeIn 0.14s ease both; will-change: scroll-position; -webkit-overflow-scrolling: touch; }
  .branches { position: absolute; top: 0; right: 0; width: 400px; height: 600px; pointer-events: none; z-index: 0; }
  .branches :global(.anim-branch) { stroke-dasharray: 60; stroke-dashoffset: 60; animation: branchGrow 2.4s ease forwards; }
  @keyframes branchGrow { to { stroke-dashoffset: 0; } }
  .header { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--sp-4); gap: var(--sp-4); flex-wrap: wrap; }
  .header-left { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
  .heading { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; flex-shrink: 0; }
  .tabs { display: flex; gap: 2px; background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-md); padding: 2px; }
  .tab { display: flex; align-items: center; gap: 5px; font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); text-transform: uppercase; padding: 4px 10px; border-radius: var(--radius-sm); color: var(--text-faint); white-space: nowrap; transition: background var(--t-base), color var(--t-base); }
  .tab:hover { color: var(--text-muted); }
  .tab.active { background: var(--accent-muted); color: var(--accent-fg); border: 1px solid var(--accent-dim); }
  .tab-count { font-size: var(--text-2xs); opacity: 0.6; }
  .search-wrap { position: relative; display: flex; align-items: center; }
  .search-wrap :global(.search-icon) { position: absolute; left: 10px; color: var(--text-faint); pointer-events: none; }
  .search { background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-md); padding: 5px 10px 5px 28px; color: var(--text-primary); font-size: var(--text-sm); width: 180px; outline: none; transition: border-color var(--t-base); }
  .search::placeholder { color: var(--text-faint); }
  .search:focus { border-color: var(--border-strong); }
  .grid { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(var(--cols, auto-fill), minmax(130px, 1fr)); gap: var(--sp-4); }
  .card { background: none; border: none; padding: 0; cursor: pointer; text-align: left; }
  .card:hover .cover { filter: brightness(1.07); }
  .card:hover .title { color: var(--text-primary); }
  .cover-wrap { position: relative; aspect-ratio: 2/3; overflow: hidden; border-radius: var(--radius-md); background: var(--bg-raised); border: 1px solid var(--border-dim); transform: translateZ(0); }
  .cover { width: 100%; height: 100%; transition: filter var(--t-base); will-change: filter; }
  .badge-dl { position: absolute; bottom: var(--sp-1); right: var(--sp-1); min-width: 18px; height: 18px; padding: 0 3px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; background: var(--accent-dim); color: var(--accent-fg); border-radius: var(--radius-sm); border: 1px solid var(--accent-muted); }
  .badge-unread { position: absolute; top: var(--sp-1); left: var(--sp-1); min-width: 18px; height: 18px; padding: 0 4px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; background: var(--bg-void); color: var(--text-primary); border-radius: var(--radius-sm); border: 1px solid var(--border-strong); }
  .title { margin-top: var(--sp-2); font-size: var(--text-sm); color: var(--text-secondary); line-height: var(--leading-snug); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; transition: color var(--t-base); }
  .card-skeleton { padding: 0; }
  .cover-skeleton { aspect-ratio: 2/3; border-radius: var(--radius-md); }
  .title-skeleton { height: 12px; margin-top: var(--sp-2); width: 80%; border-radius: var(--radius-sm); }
  .load-more-row { display: flex; justify-content: center; padding: var(--sp-5) 0 var(--sp-2); position: relative; z-index: 1; }
  .load-more-btn { display: flex; align-items: center; gap: var(--sp-2); font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 8px 20px; border-radius: var(--radius-full); border: 1px solid var(--border-dim); background: var(--bg-raised); color: var(--text-muted); cursor: pointer; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); }
  .load-more-btn:hover { color: var(--accent-fg); border-color: var(--accent-dim); background: var(--accent-muted); }
  .load-more-count { color: var(--text-faint); font-size: var(--text-2xs); }
  .center { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 60%; color: var(--text-muted); font-size: var(--text-sm); gap: var(--sp-2); text-align: center; line-height: var(--leading-base); }
  .error-msg { color: var(--color-error); font-size: var(--text-base); }
  .error-detail { color: var(--text-faint); font-size: var(--text-sm); }
  .retry-btn { margin-top: var(--sp-3); padding: 6px 16px; border-radius: var(--radius-md); border: 1px solid var(--border-dim); background: var(--bg-raised); color: var(--text-muted); cursor: pointer; font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); }
  @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
</style>
