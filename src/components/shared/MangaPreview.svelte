<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { X, BookmarkSimple, ArrowSquareOut, Play, CircleNotch, Books, CaretDown, FolderSimplePlus, Folder } from "phosphor-svelte";
  import { gql, thumbUrl } from "../../lib/client";
  import { GET_MANGA, GET_CHAPTERS, FETCH_MANGA, FETCH_CHAPTERS, UPDATE_MANGA, ENQUEUE_CHAPTERS_DOWNLOAD } from "../../lib/queries";
  import { cache, CACHE_KEYS } from "../../lib/cache";
  import { settings, previewManga, activeManga, navPage, genreFilter, openReader, addToast, addFolder, assignMangaToFolder, removeMangaFromFolder } from "../../store";
  import type { Manga, Chapter } from "../../lib/types";

  let manga: Manga | null      = null;
  let chapters: Chapter[]      = [];
  let loadingDetail            = false;
  let loadingChapters          = false;
  let togglingLib              = false;
  let descExpanded             = false;
  let folderOpen               = false;
  let newFolderName            = "";
  let creatingFolder           = false;
  let queueingAll              = false;
  let fetchError: string|null  = null;
  let folderRef: HTMLDivElement;

  let detailAbort: AbortController | null  = null;
  let chapterAbort: AbortController | null = null;

  function close() {
    detailAbort?.abort(); chapterAbort?.abort();
    previewManga.set(null);
    manga = null; chapters = []; descExpanded = false;
    folderOpen = false; creatingFolder = false; newFolderName = ""; fetchError = null;
  }

  function formatDate(d: Date) { return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }

  $: displayManga   = manga ?? $previewManga;
  $: totalCount     = chapters.length;
  $: readCount      = chapters.filter((c) => c.isRead).length;
  $: unreadCount    = totalCount - readCount;
  $: downloadedCount = chapters.filter((c) => c.isDownloaded).length;
  $: bookmarkCount  = chapters.filter((c) => c.isBookmarked).length;
  $: inLibrary      = manga?.inLibrary ?? $previewManga?.inLibrary ?? false;
  $: scanlators     = [...new Set(chapters.map((c) => c.scanlator).filter((s): s is string => !!s?.trim()))];
  $: uploadDates    = chapters.map((c) => c.uploadDate ? new Date(c.uploadDate).getTime() : null).filter((d): d is number => d !== null && !isNaN(d));
  $: firstUpload    = uploadDates.length ? new Date(Math.min(...uploadDates)) : null;
  $: lastUpload     = uploadDates.length ? new Date(Math.max(...uploadDates)) : null;
  $: statusLabel    = displayManga?.status ? displayManga.status.charAt(0) + displayManga.status.slice(1).toLowerCase() : null;
  $: assignedFolders = $previewManga ? $settings.folders.filter((f) => f.mangaIds.includes($previewManga!.id)) : [];

  $: continueChapter = (() => {
    if (!chapters.length) return null;
    const inProgress = chapters.find((c) => !c.isRead && (c.lastPageRead ?? 0) > 0);
    if (inProgress) return { ch: inProgress, label: `Continue · Ch.${inProgress.chapterNumber}` };
    const firstUnread = chapters.find((c) => !c.isRead);
    if (firstUnread) return { ch: firstUnread, label: `Start · Ch.${firstUnread.chapterNumber}` };
    return { ch: chapters[0], label: "Read again" };
  })();

  $: if ($previewManga) load($previewManga.id);

  async function load(id: number) {
    detailAbort?.abort(); chapterAbort?.abort();
    const dCtrl = new AbortController(), cCtrl = new AbortController();
    detailAbort = dCtrl; chapterAbort = cCtrl;
    manga = null; chapters = []; descExpanded = false; fetchError = null;
    loadingDetail = true; loadingChapters = true;

    (async (): Promise<Manga> => {
      const key = CACHE_KEYS.MANGA(id);
      if (cache.has(key)) return cache.get(key, () => Promise.resolve($previewManga as Manga)) as Promise<Manga>;
      try {
        const d = await gql<{ fetchManga: { manga: Manga } }>(FETCH_MANGA, { id }, dCtrl.signal);
        return d.fetchManga.manga;
      } catch (e: any) {
        if (e?.name === "AbortError") throw e;
        const local = await gql<{ manga: Manga }>(GET_MANGA, { id }, dCtrl.signal).then((d) => d.manga);
        if (local) return local;
        throw new Error("Could not load manga details");
      }
    })().then((fullManga) => {
      if (dCtrl.signal.aborted) return;
      if (!cache.has(CACHE_KEYS.MANGA(id))) cache.get(CACHE_KEYS.MANGA(id), () => Promise.resolve(fullManga));
      manga = fullManga; loadingDetail = false;
    }).catch((e) => {
      if (e?.name === "AbortError") return;
      manga = $previewManga as Manga;
      fetchError = "Could not load full details — showing cached data";
      loadingDetail = false;
    });

    gql<{ chapters: { nodes: Chapter[] } }>(GET_CHAPTERS, { mangaId: id }, cCtrl.signal)
      .then(async (d) => {
        if (cCtrl.signal.aborted) return;
        let nodes = [...d.chapters.nodes].sort((a, b) => a.sourceOrder - b.sourceOrder);
        if (nodes.length === 0) {
          try {
            const fetched = await gql<{ fetchChapters: { chapters: Chapter[] } }>(FETCH_CHAPTERS, { mangaId: id }, cCtrl.signal);
            if (!cCtrl.signal.aborted) nodes = [...fetched.fetchChapters.chapters].sort((a, b) => a.sourceOrder - b.sourceOrder);
          } catch (e: any) { if (e?.name === "AbortError") return; }
        }
        if (!cCtrl.signal.aborted) chapters = nodes;
      })
      .catch(() => {})
      .finally(() => { if (!cCtrl.signal.aborted) loadingChapters = false; });
  }

  async function toggleLibrary() {
    if (!manga) return;
    togglingLib = true;
    const next = !manga.inLibrary;
    await gql(UPDATE_MANGA, { id: manga.id, inLibrary: next }).catch(console.error);
    manga = { ...manga, inLibrary: next };
    cache.clear(CACHE_KEYS.MANGA(manga.id));
    cache.get(CACHE_KEYS.MANGA(manga.id), () => Promise.resolve(manga!));
    cache.clear(CACHE_KEYS.LIBRARY);
    togglingLib = false;
    addToast({ kind: "success", title: next ? "Added to library" : "Removed from library" });
  }

  async function downloadAll() {
    const ids = chapters.filter((c) => !c.isDownloaded && !c.isRead).map((c) => c.id);
    if (!ids.length) return;
    queueingAll = true;
    await gql(ENQUEUE_CHAPTERS_DOWNLOAD, { chapterIds: ids }).catch(console.error);
    addToast({ kind: "download", title: "Downloading", body: `${ids.length} chapters queued` });
    queueingAll = false;
  }

  function openSeriesDetail() {
    if (!displayManga) return;
    activeManga.set(displayManga);
    navPage.set("library");
    close();
  }

  function handleFolderCreate() {
    const name = newFolderName.trim();
    if (!name || !$previewManga) return;
    const id = addFolder(name);
    assignMangaToFolder(id, $previewManga.id);
    newFolderName = ""; creatingFolder = false;
  }

  function handleFolderOutside(e: MouseEvent) {
    if (folderRef && !folderRef.contains(e.target as Node)) { folderOpen = false; creatingFolder = false; newFolderName = ""; }
  }

  $: if (folderOpen) setTimeout(() => document.addEventListener("mousedown", handleFolderOutside), 0);
  else document.removeEventListener("mousedown", handleFolderOutside);

  function onKey(e: KeyboardEvent) { if (e.key === "Escape") close(); }
  onMount(() => window.addEventListener("keydown", onKey));
  onDestroy(() => { window.removeEventListener("keydown", onKey); detailAbort?.abort(); chapterAbort?.abort(); });
</script>

{#if $previewManga}
<div class="backdrop" on:click={(e) => { if (e.target === e.currentTarget) close(); }}>
  <div class="modal" role="dialog" aria-label="Manga preview">

    <!-- Cover column -->
    <div class="cover-col">
      <div class="cover-wrap">
        <img src={thumbUrl($previewManga.thumbnailUrl)} alt={displayManga?.title} class="cover" />
        {#if loadingDetail}
          <div class="cover-spinner"><CircleNotch size={18} weight="light" class="anim-spin" /></div>
        {/if}
      </div>
      <div class="cover-actions">
        <button class="action-btn" class:active={inLibrary} on:click={toggleLibrary} disabled={togglingLib || loadingDetail}>
          <BookmarkSimple size={13} weight={inLibrary ? "fill" : "light"} />
          {togglingLib ? "…" : inLibrary ? "In Library" : "Add to Library"}
        </button>
        <button class="action-btn" on:click={openSeriesDetail}>
          <Books size={13} weight="light" /> Series Detail
        </button>
        <div class="folder-wrap" bind:this={folderRef}>
          <button class="action-btn" class:folder-active={assignedFolders.length > 0} on:click={() => folderOpen = !folderOpen}>
            <FolderSimplePlus size={13} weight={assignedFolders.length > 0 ? "fill" : "light"} />
            <span class="action-label">{assignedFolders.length > 0 ? assignedFolders.map((f) => f.name).join(", ") : "Add to folder"}</span>
          </button>
          {#if folderOpen}
            <div class="folder-menu">
              {#if $settings.folders.length === 0 && !creatingFolder}<p class="folder-empty">No folders yet</p>{/if}
              {#each $settings.folders as f}
                {@const isIn = $previewManga ? f.mangaIds.includes($previewManga.id) : false}
                <button class="folder-item" class:folder-item-on={isIn}
                  on:click={() => $previewManga && (isIn ? removeMangaFromFolder(f.id, $previewManga.id) : assignMangaToFolder(f.id, $previewManga.id))}>
                  <Folder size={12} weight={isIn ? "fill" : "light"} />{isIn ? "✓ " : ""}{f.name}
                </button>
              {/each}
              <div class="folder-divider"></div>
              {#if creatingFolder}
                <div class="folder-create-row">
                  <input class="folder-input" placeholder="Folder name…" bind:value={newFolderName}
                    on:keydown={(e) => { if (e.key === "Enter") handleFolderCreate(); if (e.key === "Escape") { creatingFolder = false; newFolderName = ""; } }}
                    use:focus />
                  <button class="folder-ok" on:click={handleFolderCreate} disabled={!newFolderName.trim()}>Add</button>
                </div>
              {:else}
                <button class="folder-new" on:click={() => creatingFolder = true}>+ New folder</button>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- Content column -->
    <div class="content">
      <div class="content-header">
        <div class="title-block">
          <h2 class="title">{displayManga?.title}</h2>
          {#if loadingDetail}
            <div class="sk-byline"></div>
          {:else if displayManga?.author || displayManga?.artist}
            <p class="byline">{[displayManga?.author, displayManga?.artist].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" · ")}</p>
          {/if}
        </div>
        <button class="close-btn" on:click={close}><X size={15} weight="light" /></button>
      </div>

      <div class="content-body">
        {#if fetchError}<div class="error-banner">{fetchError}</div>{/if}

        <!-- Badges -->
        {#if loadingDetail}
          <div class="sk-row"><div class="sk-badge"></div><div class="sk-badge" style="width:72px"></div></div>
        {:else}
          <div class="badges">
            {#if statusLabel}<span class="badge" class:badge-green={displayManga?.status === "ONGOING"}>{statusLabel}</span>{/if}
            {#if displayManga?.source}<span class="badge">{displayManga.source.displayName}</span>{/if}
            {#if inLibrary}<span class="badge badge-accent">In Library</span>{/if}
            {#if !loadingChapters && unreadCount > 0}<span class="badge badge-unread">{unreadCount} unread</span>{/if}
            {#if !loadingChapters && bookmarkCount > 0}<span class="badge">{bookmarkCount} bookmarked</span>{/if}
          </div>
        {/if}

        <!-- Chapter box -->
        <div class="chapter-box">
          {#if loadingChapters}
            <div class="chapter-loading">
              <CircleNotch size={13} weight="light" class="anim-spin" style="color:var(--text-faint)" />
              <span class="chapter-loading-label">Loading chapters…</span>
            </div>
          {:else if totalCount > 0}
            <div class="chapter-meta">
              <span class="chapter-label">
                {totalCount} {totalCount === 1 ? "chapter" : "chapters"}{readCount > 0 ? ` · ${readCount} read` : ""}{unreadCount > 0 && readCount > 0 ? ` · ${unreadCount} left` : ""}{downloadedCount > 0 ? ` · ${downloadedCount} dl` : ""}
              </span>
              {#if unreadCount > 0}
                <button class="dl-all-btn" on:click={downloadAll} disabled={queueingAll}>
                  {#if queueingAll}<CircleNotch size={11} weight="light" class="anim-spin" />{/if}
                  {queueingAll ? "Queuing…" : "Download unread"}
                </button>
              {/if}
            </div>
            {#if readCount > 0}
              <div class="progress-track"><div class="progress-fill" style="width:{(readCount / totalCount) * 100}%"></div></div>
            {/if}
            {#if continueChapter}
              <button class="read-btn" on:click={() => { openReader(continueChapter!.ch, chapters); close(); }}>
                <Play size={12} weight="fill" />{continueChapter.label}
              </button>
            {/if}
          {:else if !loadingDetail}
            <span class="chapter-label" style="color:var(--text-faint)">No chapters in local library</span>
          {/if}
        </div>

        <!-- Description -->
        {#if loadingDetail}
          <div class="sk-desc">
            <div class="sk-line" style="width:100%"></div>
            <div class="sk-line" style="width:88%"></div>
            <div class="sk-line" style="width:70%"></div>
          </div>
        {:else if displayManga?.description}
          <div class="desc-block">
            <p class="desc" class:desc-open={descExpanded}>{displayManga.description}</p>
            {#if displayManga.description.length > 220}
              <button class="desc-toggle" on:click={() => descExpanded = !descExpanded}>
                {descExpanded ? "Show less" : "Show more"}
                <CaretDown size={10} weight="light" style="transform:{descExpanded ? 'rotate(180deg)' : 'none'};transition:transform 0.15s ease" />
              </button>
            {/if}
          </div>
        {/if}

        <!-- Genres -->
        {#if !loadingDetail && displayManga?.genre?.length}
          <div class="genres">
            {#each displayManga.genre as g}
              <button class="genre-tag" on:click={() => { genreFilter.set(g); navPage.set("explore"); close(); }}>{g}</button>
            {/each}
          </div>
        {/if}

        <!-- Meta table -->
        {#if !loadingDetail}
          <div class="meta-table">
            {#if displayManga?.author}<div class="meta-row"><span class="meta-key">Author</span><span class="meta-val">{displayManga.author}</span></div>{/if}
            {#if displayManga?.artist && displayManga.artist !== displayManga.author}<div class="meta-row"><span class="meta-key">Artist</span><span class="meta-val">{displayManga.artist}</span></div>{/if}
            {#if statusLabel}<div class="meta-row"><span class="meta-key">Status</span><span class="meta-val">{statusLabel}</span></div>{/if}
            {#if displayManga?.source}<div class="meta-row"><span class="meta-key">Source</span><span class="meta-val">{displayManga.source.displayName}</span></div>{/if}
            {#if !loadingChapters && scanlators.length > 0}<div class="meta-row"><span class="meta-key">{scanlators.length === 1 ? "Scanlator" : "Scanlators"}</span><span class="meta-val">{scanlators.join(", ")}</span></div>{/if}
            {#if !loadingChapters && firstUpload && lastUpload}
              <div class="meta-row">
                <span class="meta-key">Published</span>
                <span class="meta-val">{firstUpload.getTime() === lastUpload.getTime() ? formatDate(firstUpload) : `${formatDate(firstUpload)} – ${formatDate(lastUpload)}`}</span>
              </div>
            {/if}
            {#if !loadingChapters && downloadedCount > 0}<div class="meta-row"><span class="meta-key">Downloaded</span><span class="meta-val">{downloadedCount} / {totalCount} chapters</span></div>{/if}
            {#if displayManga?.realUrl}<div class="meta-row"><span class="meta-key">Link</span><a href={displayManga.realUrl} target="_blank" rel="noreferrer" class="meta-link">Open <ArrowSquareOut size={11} weight="light" /></a></div>{/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
{/if}

<script context="module">
  function focus(node: HTMLElement) { node.focus(); }
</script>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.72); z-index: var(--z-settings); display: flex; align-items: center; justify-content: center; animation: fadeIn 0.12s ease both; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
  .modal { width: min(800px, calc(100vw - 48px)); height: min(560px, calc(100vh - 80px)); display: flex; background: var(--bg-surface); border: 1px solid var(--border-base); border-radius: var(--radius-xl); overflow: hidden; animation: scaleIn 0.16s ease both; box-shadow: 0 0 0 1px var(--border-dim), 0 24px 64px rgba(0,0,0,0.6); }
  .cover-col { width: 190px; flex-shrink: 0; background: var(--bg-raised); border-right: 1px solid var(--border-dim); display: flex; flex-direction: column; padding: var(--sp-5) var(--sp-4) var(--sp-4); gap: var(--sp-3); overflow-y: auto; overflow-x: hidden; scrollbar-width: none; }
  .cover-col::-webkit-scrollbar { display: none; }
  .cover-wrap { position: relative; width: 100%; }
  .cover { width: 100%; aspect-ratio: 2/3; object-fit: cover; border-radius: var(--radius-md); border: 1px solid var(--border-dim); display: block; }
  .cover-spinner { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.35); border-radius: var(--radius-md); color: var(--text-faint); }
  .cover-actions { display: flex; flex-direction: column; gap: var(--sp-2); }
  .action-btn { display: flex; align-items: center; justify-content: center; gap: var(--sp-2); width: 100%; padding: 7px var(--sp-3); border-radius: var(--radius-md); font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); border: 1px solid var(--border-strong); background: none; color: var(--text-muted); cursor: pointer; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; }
  .action-btn:hover:not(:disabled) { color: var(--accent-fg); border-color: var(--accent); background: var(--accent-muted); }
  .action-btn:disabled { opacity: 0.4; cursor: default; }
  .action-btn.active { background: var(--accent-muted); border-color: var(--accent-dim); color: var(--accent-fg); }
  .action-btn.folder-active { color: var(--text-secondary); border-color: var(--border-strong); }
  .action-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .folder-wrap { position: relative; width: 100%; }
  .folder-menu { position: absolute; bottom: calc(100% + 4px); left: 0; right: 0; background: var(--bg-raised); border: 1px solid var(--border-base); border-radius: var(--radius-md); padding: var(--sp-1); display: flex; flex-direction: column; gap: 1px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); z-index: 10; animation: scaleIn 0.1s ease both; transform-origin: bottom center; }
  .folder-empty { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); padding: var(--sp-2) var(--sp-3); }
  .folder-item { display: flex; align-items: center; gap: var(--sp-2); padding: 6px var(--sp-3); border-radius: var(--radius-sm); font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-muted); background: none; border: none; cursor: pointer; text-align: left; transition: background var(--t-fast), color var(--t-fast); }
  .folder-item:hover { background: var(--bg-overlay); color: var(--text-primary); }
  .folder-item.folder-item-on { color: var(--accent-fg); }
  .folder-divider { height: 1px; background: var(--border-dim); margin: var(--sp-1) 0; }
  .folder-create-row { display: flex; gap: var(--sp-1); padding: var(--sp-1); }
  .folder-input { flex: 1; background: var(--bg-overlay); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: 4px 8px; color: var(--text-secondary); font-family: var(--font-ui); font-size: var(--text-xs); outline: none; min-width: 0; }
  .folder-input:focus { border-color: var(--border-focus); }
  .folder-ok { font-family: var(--font-ui); font-size: var(--text-xs); padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); background: none; color: var(--text-muted); cursor: pointer; flex-shrink: 0; transition: color var(--t-base); }
  .folder-ok:disabled { opacity: 0.4; cursor: default; }
  .folder-ok:not(:disabled):hover { color: var(--accent-fg); border-color: var(--accent); }
  .folder-new { padding: 6px var(--sp-3); border-radius: var(--radius-sm); font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); background: none; border: none; cursor: pointer; text-align: left; width: 100%; transition: color var(--t-fast); }
  .folder-new:hover { color: var(--accent-fg); }
  .content { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
  .content-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-4); padding: var(--sp-5) var(--sp-6) var(--sp-4); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; }
  .title-block { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--sp-1); }
  .title { font-size: var(--text-lg); font-weight: var(--weight-medium); color: var(--text-primary); letter-spacing: var(--tracking-tight); line-height: var(--leading-tight); }
  .byline { font-size: var(--text-sm); color: var(--text-muted); line-height: var(--leading-snug); }
  .sk-byline { height: 14px; width: 55%; background: var(--bg-overlay); border-radius: var(--radius-sm); animation: pulse 1.4s ease infinite; }
  .close-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--radius-sm); color: var(--text-faint); background: none; border: none; cursor: pointer; flex-shrink: 0; transition: color var(--t-base), background var(--t-base); }
  .close-btn:hover { color: var(--text-muted); background: var(--bg-raised); }
  .content-body { flex: 1; overflow-y: auto; padding: var(--sp-5) var(--sp-6); display: flex; flex-direction: column; gap: var(--sp-4); scrollbar-width: thin; }
  .error-banner { font-family: var(--font-ui); font-size: var(--text-xs); color: #f59e0b; background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.25); border-radius: var(--radius-sm); padding: 6px var(--sp-3); }
  .sk-row { display: flex; gap: var(--sp-2); align-items: center; }
  .sk-badge { height: 20px; width: 54px; background: var(--bg-overlay); border-radius: var(--radius-sm); animation: pulse 1.4s ease infinite; }
  .sk-desc { display: flex; flex-direction: column; gap: 8px; padding: var(--sp-2) 0; }
  .sk-line { height: 13px; background: var(--bg-overlay); border-radius: var(--radius-sm); animation: pulse 1.4s ease infinite; }
  .badges { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
  .badge { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); text-transform: uppercase; padding: 3px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: var(--bg-raised); color: var(--text-faint); }
  .badge-green { background: rgba(34,197,94,0.12); border-color: rgba(34,197,94,0.3); color: #22c55e; }
  .badge-accent { background: var(--accent-muted); border-color: var(--accent-dim); color: var(--accent-fg); }
  .badge-unread { background: rgba(245,158,11,0.12); border-color: rgba(245,158,11,0.3); color: #f59e0b; }
  .chapter-box { display: flex; flex-direction: column; gap: var(--sp-3); padding: var(--sp-4); background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-md); }
  .chapter-loading { display: flex; align-items: center; gap: var(--sp-2); }
  .chapter-loading-label { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .chapter-meta { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); }
  .chapter-label { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-muted); letter-spacing: var(--tracking-wide); }
  .dl-all-btn { display: flex; align-items: center; gap: var(--sp-1); font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); padding: 3px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: none; color: var(--text-faint); cursor: pointer; flex-shrink: 0; transition: color var(--t-base), border-color var(--t-base); }
  .dl-all-btn:hover:not(:disabled) { color: var(--text-muted); border-color: var(--border-strong); }
  .dl-all-btn:disabled { opacity: 0.5; cursor: default; }
  .progress-track { height: 3px; background: var(--bg-overlay); border-radius: var(--radius-full); overflow: hidden; }
  .progress-fill { height: 100%; background: var(--accent); border-radius: var(--radius-full); transition: width 0.3s ease; }
  .read-btn { display: flex; align-items: center; gap: var(--sp-2); padding: 8px var(--sp-4); border-radius: var(--radius-md); font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); background: var(--accent-muted); border: 1px solid var(--accent-dim); color: var(--accent-fg); cursor: pointer; align-self: flex-start; transition: filter var(--t-base); }
  .read-btn:hover { filter: brightness(1.1); }
  .desc-block { display: flex; flex-direction: column; gap: var(--sp-2); border-top: 1px solid var(--border-dim); padding-top: var(--sp-3); }
  .desc { font-size: var(--text-sm); color: var(--text-muted); line-height: var(--leading-base); display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
  .desc.desc-open { display: block; -webkit-line-clamp: unset; overflow: visible; }
  .desc-toggle { display: flex; align-items: center; gap: var(--sp-1); font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); background: none; border: none; cursor: pointer; padding: 0; align-self: flex-start; transition: color var(--t-base); }
  .desc-toggle:hover { color: var(--accent-fg); }
  .genres { display: flex; flex-wrap: wrap; gap: var(--sp-1); }
  .genre-tag { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); padding: 3px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: var(--bg-raised); color: var(--text-faint); cursor: pointer; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); }
  .genre-tag:hover { color: var(--accent-fg); border-color: var(--accent-dim); background: var(--accent-muted); }
  .meta-table { display: flex; flex-direction: column; gap: 1px; border-top: 1px solid var(--border-dim); padding-top: var(--sp-3); }
  .meta-row { display: flex; align-items: baseline; gap: var(--sp-3); padding: 5px 0; }
  .meta-key { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); text-transform: uppercase; min-width: 56px; flex-shrink: 0; }
  .meta-val { font-size: var(--text-sm); color: var(--text-secondary); line-height: var(--leading-snug); }
  .meta-link { display: inline-flex; align-items: center; gap: 4px; font-size: var(--text-sm); color: var(--accent-fg); text-decoration: none; transition: opacity var(--t-base); }
  .meta-link:hover { opacity: 0.75; }
  @keyframes pulse { 0%,100% { opacity: 0.4 } 50% { opacity: 0.8 } }
</style>
