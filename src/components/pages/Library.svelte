<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { MagnifyingGlass, Books, DownloadSimple, X, Folder, FolderSimplePlus, Trash } from "phosphor-svelte";
  import { gql, thumbUrl } from "../../lib/client";
  import { GET_LIBRARY, UPDATE_MANGA, GET_CHAPTERS, DELETE_DOWNLOADED_CHAPTERS, DEQUEUE_DOWNLOAD } from "../../lib/queries";
  import { cache, CACHE_KEYS } from "../../lib/cache";
  import { settings, activeManga, libraryFilter, libraryTagFilter, genreFilter, activeChapter } from "../../store";
  import { addFolder, assignMangaToFolder, removeMangaFromFolder, getMangaFolders } from "../../store";
  import type { Manga, Chapter } from "../../lib/types";
  import ContextMenu, { type MenuEntry } from "../shared/ContextMenu.svelte";

  const CARD_MIN_W = 130;
  const CARD_GAP   = 16;

  let allManga: Manga[]     = [];
  let loading               = true;
  let error: string | null  = null;
  let retryCount            = 0;
  let search                = "";
  let scrollEl: HTMLDivElement;
  let containerWidth        = 800;
  let ctx: { x: number; y: number; manga: Manga } | null = null;
  let emptyCtx: { x: number; y: number } | null = null;

  let prevChapterId: number | null = null;
  $: {
    const wasOpen = prevChapterId !== null;
    prevChapterId = $activeChapter?.id ?? null;
    if (wasOpen && !$activeChapter) cache.clear(CACHE_KEYS.LIBRARY);
  }

  function fetchLibrary() {
    return cache.get(CACHE_KEYS.LIBRARY, () =>
      gql<{ mangas: { nodes: Manga[] } }>(GET_LIBRARY).then((d) => d.mangas.nodes)
    );
  }

  function loadData() {
    fetchLibrary()
      .then((nodes) => { allManga = nodes; error = null; })
      .catch((e) => error = e.message)
      .finally(() => loading = false);
  }

  $: {
    retryCount;
    loading = true; error = null;
    if (retryCount > 0) cache.clear(CACHE_KEYS.LIBRARY);
    loadData();
  }

  $: if (scrollEl) scrollEl.scrollTo({ top: 0 });

  $: {
    const f = $settings.folders.find((f) => f.id === $libraryFilter);
    if (f && !f.showTab) libraryFilter.set("library");
  }

  const isBuiltin = (f: string) => f === "all" || f === "library" || f === "downloaded";

  $: filtered = (() => {
    let items = allManga;
    if ($libraryFilter === "library")         items = items.filter((m) => m.inLibrary);
    else if ($libraryFilter === "downloaded") items = items.filter((m) => (m.downloadCount ?? 0) > 0);
    else if (!isBuiltin($libraryFilter)) {
      const folder = $settings.folders.find((f) => f.id === $libraryFilter);
      if (folder) items = items.filter((m) => folder.mangaIds.includes(m.id));
    }
    if ($libraryTagFilter.length)
      items = items.filter((m) => $libraryTagFilter.every((t) => (m.genre ?? []).includes(t)));
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter((m) => m.title.toLowerCase().includes(q));
    }
    return items;
  })();

  $: cols = Math.max(1, Math.floor((containerWidth + CARD_GAP) / (CARD_MIN_W + CARD_GAP)));

  $: counts = {
    all:        allManga.length,
    library:    allManga.filter((m) => m.inLibrary).length,
    downloaded: allManga.filter((m) => (m.downloadCount ?? 0) > 0).length,
    ...$settings.folders.reduce((a, f) => ({ ...a, [f.id]: allManga.filter((m) => f.mangaIds.includes(m.id)).length }), {}),
  };

  $: allTags = [...new Set(allManga.filter((m) => m.inLibrary).flatMap((m) => m.genre ?? []))].sort();

  async function removeFromLibrary(manga: Manga) {
    await gql(UPDATE_MANGA, { id: manga.id, inLibrary: false }).catch(console.error);
    allManga = allManga.map((m) => m.id === manga.id ? { ...m, inLibrary: false } : m);
    cache.clear(CACHE_KEYS.LIBRARY);
  }

  async function deleteAllDownloads(manga: Manga) {
    try {
      const data = await gql<{ chapters: { nodes: Chapter[] } }>(GET_CHAPTERS, { mangaId: manga.id });
      const ids = data.chapters.nodes.filter((c) => c.isDownloaded).map((c) => c.id);
      if (!ids.length) return;
      await gql(DELETE_DOWNLOADED_CHAPTERS, { ids });
      await Promise.allSettled(ids.map((id) => gql(DEQUEUE_DOWNLOAD, { chapterId: id })));
      allManga = allManga.map((m) => m.id === manga.id ? { ...m, downloadCount: 0 } : m);
    } catch (e) { console.error(e); }
  }

  function openCtx(e: MouseEvent, m: Manga) {
    e.preventDefault();
    ctx = { x: e.clientX, y: e.clientY, manga: m };
  }

  function buildCtxItems(m: Manga): MenuEntry[] {
    const mangaFolders = getMangaFolders(m.id);
    const folderEntries: MenuEntry[] = $settings.folders.map((f) => {
      const inFolder = mangaFolders.some((mf) => mf.id === f.id);
      return {
        label: inFolder ? `Remove from ${f.name}` : `Add to ${f.name}`,
        icon: Folder,
        onClick: () => inFolder ? removeMangaFromFolder(f.id, m.id) : assignMangaToFolder(f.id, m.id),
      };
    });
    return [
      {
        label: m.inLibrary ? "Remove from library" : "Add to library",
        icon: Books,
        onClick: () => m.inLibrary
          ? removeFromLibrary(m)
          : gql(UPDATE_MANGA, { id: m.id, inLibrary: true })
              .then(() => { allManga = allManga.map((x) => x.id === m.id ? { ...x, inLibrary: true } : x); cache.clear(CACHE_KEYS.LIBRARY); })
              .catch(console.error),
      },
      {
        label: "Delete all downloads",
        icon: Trash,
        danger: true,
        disabled: !(m.downloadCount && m.downloadCount > 0),
        onClick: () => deleteAllDownloads(m),
      },
      ...(folderEntries.length ? [{ separator: true } as MenuEntry, ...folderEntries] : []),
      { separator: true },
      {
        label: "New folder",
        icon: FolderSimplePlus,
        onClick: () => {
          const name = prompt("Folder name:");
          if (name?.trim()) { const id = addFolder(name.trim()); assignMangaToFolder(id, m.id); }
        },
      },
    ];
  }

  function buildEmptyCtx(): MenuEntry[] {
    return [{
      label: "New folder",
      icon: FolderSimplePlus,
      onClick: () => { const name = prompt("Folder name:"); if (name?.trim()) addFolder(name.trim()); },
    }];
  }

  function toggleTag(tag: string) {
    libraryTagFilter.update((t) => t.includes(tag) ? t.filter((x) => x !== tag) : [...t, tag]);
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
  bind:this={scrollEl}
  on:contextmenu={(e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    emptyCtx = { x: e.clientX, y: e.clientY };
  }}
>
  {#if $settings.libraryBranches ?? true}
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
      <button class="retry-btn" on:click={() => retryCount++}>Retry</button>
    </div>
  {:else}
    <div class="header">
      <div class="header-left">
        <span class="heading">Library</span>
        <div class="tabs">
          {#each [["library","Saved"], ["downloaded","Downloaded"], ["all","All"]] as [f, label]}
            <button class="tab" class:active={$libraryFilter === f} on:click={() => libraryFilter.set(f)}>
              {#if f === "library"}<Books size={11} weight="bold" />
              {:else if f === "downloaded"}<DownloadSimple size={11} weight="bold" />{/if}
              {label}
              <span class="tab-count">{counts[f] ?? 0}</span>
            </button>
          {/each}
          {#each $settings.folders.filter((f) => f.showTab) as folder}
            <button class="tab" class:active={$libraryFilter === folder.id} on:click={() => libraryFilter.set(folder.id)}>
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

    {#if allTags.length > 0}
      <div class="tag-panel">
        {#if $libraryTagFilter.length > 0}
          <button class="tag-clear" on:click={() => libraryTagFilter.set([])}>
            <X size={11} weight="bold" /> Clear
          </button>
        {/if}
        {#each allTags as tag}
          <button class="tag-chip" class:active={$libraryTagFilter.includes(tag)} on:click={() => toggleTag(tag)}>
            {tag}
          </button>
        {/each}
      </div>
    {/if}

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
        {$libraryFilter === "library" ? "No manga saved to library — browse sources to add some."
          : $libraryFilter === "downloaded" ? "No downloaded manga."
          : !isBuiltin($libraryFilter) ? "No manga in this folder yet. Right-click manga to assign them."
          : "No manga found."}
      </div>
    {:else}
      <div class="grid" style="--cols:{cols}">
        {#each filtered as m (m.id)}
          <button
            class="card"
            on:click={() => activeManga.set(m)}
            on:contextmenu={(e) => openCtx(e, m)}
          >
            <div class="cover-wrap">
              <img
                src={thumbUrl(m.thumbnailUrl)} alt={m.title}
                class="cover"
                style="object-fit:{$settings.libraryCropCovers ? 'cover' : 'contain'}"
                loading="lazy" decoding="async"
              />
              {#if m.downloadCount}<span class="badge-dl">{m.downloadCount}</span>{/if}
              {#if m.unreadCount}<span class="badge-unread">{m.unreadCount}</span>{/if}
            </div>
            <p class="title">{m.title}</p>
          </button>
        {/each}
      </div>
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
  .root {
    position: relative;
    padding: var(--sp-5) var(--sp-6);
    overflow-y: auto; height: 100%;
    animation: fadeIn 0.14s ease both;
    will-change: scroll-position;
    -webkit-overflow-scrolling: touch;
  }

  .branches {
    position: absolute; top: 0; right: 0;
    width: 400px; height: 600px;
    pointer-events: none; z-index: 0;
  }
  .branches :global(.anim-branch) {
    stroke-dasharray: 60;
    stroke-dashoffset: 60;
    animation: branchGrow 2.4s ease forwards;
  }
  @keyframes branchGrow {
    to { stroke-dashoffset: 0; }
  }

  .header {
    position: relative; z-index: 1;
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: var(--sp-4); gap: var(--sp-4); flex-wrap: wrap;
  }
  .header-left { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }

  .heading {
    font-family: var(--font-ui); font-size: var(--text-xs);
    color: var(--text-faint); letter-spacing: var(--tracking-wider);
    text-transform: uppercase; flex-shrink: 0;
  }

  .tabs {
    display: flex; gap: 2px;
    background: var(--bg-raised); border: 1px solid var(--border-dim);
    border-radius: var(--radius-md); padding: 2px;
  }
  .tab {
    display: flex; align-items: center; gap: 5px;
    font-family: var(--font-ui); font-size: var(--text-2xs);
    letter-spacing: var(--tracking-wide); text-transform: uppercase;
    padding: 4px 10px; border-radius: var(--radius-sm);
    color: var(--text-faint); white-space: nowrap;
    transition: background var(--t-base), color var(--t-base);
  }
  .tab:hover { color: var(--text-muted); }
  .tab.active { background: var(--accent-muted); color: var(--accent-fg); border: 1px solid var(--accent-dim); }
  .tab-count { font-size: var(--text-2xs); opacity: 0.6; }

  .search-wrap { position: relative; display: flex; align-items: center; }
  .search-wrap :global(.search-icon) { position: absolute; left: 10px; color: var(--text-faint); pointer-events: none; }
  .search {
    background: var(--bg-raised); border: 1px solid var(--border-dim);
    border-radius: var(--radius-md); padding: 5px 10px 5px 28px;
    color: var(--text-primary); font-size: var(--text-sm); width: 180px; outline: none;
    transition: border-color var(--t-base);
  }
  .search::placeholder { color: var(--text-faint); }
  .search:focus { border-color: var(--border-strong); }

  .tag-panel {
    position: relative; z-index: 1;
    display: flex; flex-wrap: wrap; gap: var(--sp-1);
    margin-bottom: var(--sp-3);
  }
  .tag-chip {
    font-family: var(--font-ui); font-size: var(--text-2xs);
    letter-spacing: var(--tracking-wide); padding: 3px 8px;
    border-radius: var(--radius-sm); border: 1px solid var(--border-dim);
    color: var(--text-faint); cursor: pointer;
    transition: color var(--t-base), border-color var(--t-base), background var(--t-base);
  }
  .tag-chip:hover { color: var(--text-muted); border-color: var(--border-strong); }
  .tag-chip.active { background: var(--accent-muted); border-color: var(--accent-dim); color: var(--accent-fg); }
  .tag-clear {
    display: flex; align-items: center; gap: 4px;
    font-family: var(--font-ui); font-size: var(--text-2xs);
    letter-spacing: var(--tracking-wide); padding: 3px 8px;
    border-radius: var(--radius-sm); border: 1px solid var(--color-error);
    color: var(--color-error); cursor: pointer;
    transition: background var(--t-base);
  }
  .tag-clear:hover { background: var(--color-error-bg); }

  .grid {
    position: relative; z-index: 1;
    display: grid;
    grid-template-columns: repeat(var(--cols, auto-fill), minmax(130px, 1fr));
    gap: var(--sp-4);
  }

  .card {
    background: none; border: none; padding: 0;
    cursor: pointer; text-align: left;
  }
  .card:hover .cover { filter: brightness(1.07); }
  .card:hover .title { color: var(--text-primary); }

  .cover-wrap {
    position: relative; aspect-ratio: 2/3; overflow: hidden;
    border-radius: var(--radius-md);
    background: var(--bg-raised); border: 1px solid var(--border-dim);
    transform: translateZ(0);
  }
  .cover { width: 100%; height: 100%; transition: filter var(--t-base); will-change: filter; }

  .badge-dl {
    position: absolute; bottom: var(--sp-1); right: var(--sp-1);
    min-width: 18px; height: 18px; padding: 0 3px;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: bold;
    background: var(--accent-dim); color: var(--accent-fg);
    border-radius: var(--radius-sm); border: 1px solid var(--accent-muted);
  }
  .badge-unread {
    position: absolute; top: var(--sp-1); left: var(--sp-1);
    min-width: 18px; height: 18px; padding: 0 4px;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: bold;
    background: var(--bg-void); color: var(--text-primary);
    border-radius: var(--radius-sm); border: 1px solid var(--border-strong);
  }

  .title {
    margin-top: var(--sp-2); font-size: var(--text-sm);
    color: var(--text-secondary); line-height: var(--leading-snug);
    display: -webkit-box; -webkit-line-clamp: 2;
    -webkit-box-orient: vertical; overflow: hidden;
    transition: color var(--t-base);
  }

  .card-skeleton { padding: 0; }
  .cover-skeleton { aspect-ratio: 2/3; border-radius: var(--radius-md); }
  .title-skeleton { height: 12px; margin-top: var(--sp-2); width: 80%; border-radius: var(--radius-sm); }

  .center {
    position: relative; z-index: 1;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 60%; color: var(--text-muted); font-size: var(--text-sm);
    gap: var(--sp-2); text-align: center; line-height: var(--leading-base);
  }
  .error-msg { color: var(--color-error); font-size: var(--text-base); }
  .error-detail { color: var(--text-faint); font-size: var(--text-sm); }
  .retry-btn {
    margin-top: var(--sp-3); padding: 6px 16px;
    border-radius: var(--radius-md); border: 1px solid var(--border-dim);
    background: var(--bg-raised); color: var(--text-muted); cursor: pointer;
    font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide);
  }
</style>
