<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { MagnifyingGlass, Books, DownloadSimple, Folder, FolderSimplePlus, Trash, Star, CheckSquare, X, ArrowSquareOut } from "phosphor-svelte";
  import { gql, thumbUrl } from "../../lib/client";
  import { GET_CATEGORIES, GET_LIBRARY, UPDATE_MANGA, GET_CHAPTERS, DELETE_DOWNLOADED_CHAPTERS, DEQUEUE_DOWNLOAD, CREATE_CATEGORY, UPDATE_MANGA_CATEGORIES, UPDATE_CATEGORY_ORDER } from "../../lib/queries";
  import { cache, CACHE_KEYS, CACHE_GROUPS, DEFAULT_TTL_MS } from "../../lib/cache";
  import { dedupeMangaById, dedupeMangaByTitle } from "../../lib/util";
  import { store, setLibraryFilter, checkAndMarkCompleted as storeCheckAndMarkCompleted, updateSettings, setCategories } from "../../store/state.svelte";
  import type { Manga, Category, Chapter } from "../../lib/types";
  import ContextMenu, { type MenuEntry } from "../shared/ContextMenu.svelte";

  const CARD_MIN_W     = 130;
  const CARD_GAP       = 16;
  const COMPLETED_NAME = "Completed";

  // Drag type discriminators (tab reorder only — manga cards no longer use drag).
  const DT_TAB = "application/x-moku-tab";

  let activeDragKind: "tab" | null = $state(null);
  let dragInsertIdx:  number       = $state(-1);

  let allManga:       Manga[]      = $state([]);
  let loading:        boolean      = $state(true);
  let error:          string|null  = $state(null);
  let retryCount:     number       = $state(0);
  let search:         string       = $state("");
  let renderVisible:  number       = $state(0);
  let scrollEl:       HTMLDivElement;
  let containerWidth: number       = $state(800);
  let ctx:     { x: number; y: number; manga: Manga } | null = $state(null);
  let emptyCtx:{ x: number; y: number } | null               = $state(null);

  // ── Multi-select ──────────────────────────────────────────────────────────

  let selectedIds:   Set<number> = $state(new Set());
  let selectMode:    boolean     = $state(false);
  let bulkWorking:   boolean     = $state(false);
  // Which folder-move popup is open (shows inline folder list)
  let bulkMoveOpen:  boolean     = $state(false);

  function enterSelectMode(id?: number) {
    selectMode = true;
    if (id !== undefined) selectedIds = new Set([id]);
  }

  function exitSelectMode() {
    selectMode  = false;
    selectedIds = new Set();
    bulkMoveOpen = false;
  }

  function toggleSelect(id: number) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    selectedIds = next;
    if (next.size === 0) exitSelectMode();
  }

  function selectAll() {
    selectedIds = new Set(visibleManga.map(m => m.id));
  }

  // Long-press to enter select mode on touch devices
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  function onCardPointerDown(e: PointerEvent, m: Manga) {
    if (e.button !== 0) return; // only primary
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      enterSelectMode(m.id);
    }, 500);
  }
  function onCardPointerUp() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  }
  function onCardPointerLeave() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  }

  function onCardClick(e: MouseEvent, m: Manga) {
    if (selectMode) {
      toggleSelect(m.id);
      return;
    }
    // Cmd/Ctrl+click or Shift+click enters select mode
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      e.preventDefault();
      enterSelectMode(m.id);
      return;
    }
    store.activeManga = m;
  }

  // ── Bulk mutations ────────────────────────────────────────────────────────

  async function bulkMoveToCategory(cat: Category) {
    bulkWorking  = true;
    bulkMoveOpen = false;
    try {
      await Promise.all(
        [...selectedIds].map(id => {
          const manga = allManga.find(m => m.id === id);
          if (!manga) return Promise.resolve();
          return toggleMangaCategory(manga, cat);
        })
      );
    } finally {
      bulkWorking = false;
      exitSelectMode();
    }
  }

  async function bulkRemoveFromLibrary() {
    bulkWorking = true;
    try {
      await Promise.all(
        [...selectedIds].map(id => {
          const manga = allManga.find(m => m.id === id);
          if (!manga) return Promise.resolve();
          return removeFromLibrary(manga);
        })
      );
    } finally {
      bulkWorking = false;
      exitSelectMode();
    }
  }

  // ── Completed category auto-create ────────────────────────────────────────

  async function ensureCompletedCategory(cats: Category[]): Promise<Category[]> {
    if (cats.some(c => c.name === COMPLETED_NAME)) return cats;
    try {
      const res = await gql<{ createCategory: { category: Category } }>(CREATE_CATEGORY, { name: COMPLETED_NAME });
      return [...cats, res.createCategory.category];
    } catch { return cats; }
  }

  // ── Data loading ──────────────────────────────────────────────────────────

  async function reloadCategories() {
    try {
      const d = await gql<{ categories: { nodes: Category[] } }>(GET_CATEGORIES);
      const cats = await ensureCompletedCategory(d.categories.nodes);
      setCategories(cats);
    } catch (e) { console.error(e); }
  }

  function loadLibrary() {
    return cache.get(
      CACHE_KEYS.LIBRARY,
      () => gql<{ mangas: { nodes: Manga[] } }>(GET_LIBRARY).then(d => d.mangas.nodes),
      DEFAULT_TTL_MS,
      CACHE_GROUPS.LIBRARY,
    );
  }

  async function loadData() {
    try {
      const [nodes] = await Promise.all([loadLibrary(), reloadCategories()]);
      allManga = dedupeMangaByTitle(dedupeMangaById(nodes), store.settings.mangaLinks);
      error    = null;
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    retryCount;
    loading = true; error = null;
    if (retryCount > 0) cache.clear(CACHE_KEYS.LIBRARY);
    untrack(() => loadData());
  });

  $effect(() => { if (scrollEl) scrollEl.scrollTo({ top: 0 }); });

  $effect(() => {
    const f = store.libraryFilter;
    if (f === "library" || f === "downloaded") return;
    const id = Number(f);
    if (!store.categories.some(c => c.id === id)) {
      untrack(() => { store.libraryFilter = "library"; });
    }
  });

  // Exit select mode when the filter changes
  $effect(() => { store.libraryFilter; untrack(() => exitSelectMode()); });

  let prevChapterId: number | null = null;
  $effect(() => {
    const wasOpen = prevChapterId !== null;
    prevChapterId = store.activeChapter?.id ?? null;
    if (wasOpen && !store.activeChapter) {
      cache.clear(CACHE_KEYS.LIBRARY);
      untrack(() => loadData());
    }
  });

  // ── Derived ───────────────────────────────────────────────────────────────

  const visibleCategories = $derived((() => {
    const defaultId = store.settings.defaultLibraryCategoryId ?? null;
    return store.categories
      .filter(c => c.id !== 0 && !(store.settings.hiddenCategoryIds ?? []).includes(c.id))
      .sort((a, b) => {
        if (a.id === defaultId) return -1;
        if (b.id === defaultId) return  1;
        return a.order - b.order;
      });
  })());

  const categoryMangaMap = $derived((() => {
    const map = new Map<number, Manga[]>();
    for (const cat of store.categories) {
      const nodes = cat.mangas?.nodes ?? [];
      map.set(cat.id, nodes);
    }
    return map;
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
    const id    = Number(store.libraryFilter);
    const items = categoryMangaMap.get(id) ?? [];
    return q ? items.filter(m => m.title.toLowerCase().includes(q)) : items;
  })());

  const cols           = $derived(Math.max(1, Math.floor((containerWidth + CARD_GAP) / (CARD_MIN_W + CARD_GAP))));
  const visibleManga   = $derived(filtered.slice(0, renderVisible));
  const hasMore        = $derived(filtered.length > renderVisible);
  const remainingCount = $derived(filtered.length - renderVisible);

  $effect(() => { filtered; untrack(() => { renderVisible = store.settings.renderLimit ?? 48; }); });

  const counts = $derived((() => {
    const m: Record<string, number> = {
      library:    allManga.length,
      downloaded: allManga.filter(m => (m.downloadCount ?? 0) > 0).length,
    };
    for (const cat of visibleCategories) {
      m[String(cat.id)] = (categoryMangaMap.get(cat.id) ?? []).length;
    }
    return m;
  })());

  function loadMore() { renderVisible += store.settings.renderLimit ?? 48; }

  // ── Drag: tab reorder ─────────────────────────────────────────────────────

  let dragTabId:     number | null = $state(null);
  let dragOverTabId: number | null = $state(null);
  let dropTargetTabId: number | null = $state(null);

  function onTabDragStart(e: DragEvent, cat: Category) {
    activeDragKind = "tab";
    dragTabId = cat.id;
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData(DT_TAB, String(cat.id));
    e.dataTransfer!.setData("text/plain", `tab:${cat.id}`);
  }

  function onTabDragOver(e: DragEvent, cat: Category, idx: number) {
    if (activeDragKind !== "tab") return;
    if (dragTabId === null || dragTabId === cat.id) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    dragOverTabId = cat.id;
    dragInsertIdx = idx;
  }

  function onTabDragLeave() {
    dragOverTabId = null;
  }

  async function onTabDrop(e: DragEvent, dropCat: Category) {
    e.preventDefault();
    dragOverTabId = null;
    dragInsertIdx = -1;

    if (activeDragKind !== "tab") return;
    if (dragTabId === null || dragTabId === dropCat.id) { dragTabId = null; return; }

    const dragId = dragTabId;
    dragTabId = null;
    activeDragKind = null;

    const sorted = [...store.categories]
      .filter(c => c.id !== 0)
      .sort((a, b) => a.order - b.order);

    const fromIdx = sorted.findIndex(c => c.id === dragId);
    const toIdx   = sorted.findIndex(c => c.id === dropCat.id);
    if (fromIdx < 0 || toIdx < 0) return;

    const reordered = [...sorted];
    const [moved]   = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const withNewOrder = reordered.map((c, i) => ({ ...c, order: i + 1 }));
    setCategories(store.categories.map(c => withNewOrder.find(u => u.id === c.id) ?? c));

    const newPos = toIdx + 1;
    try {
      await gql<{ updateCategoryOrder: { categories: Category[] } }>(
        UPDATE_CATEGORY_ORDER,
        { id: dragId, position: newPos },
      );
    } catch (err) {
      console.error("Tab reorder failed:", err);
      await reloadCategories();
    }
  }

  function onTabDragEnd() {
    activeDragKind = null;
    dragTabId = null;
    dragOverTabId = null;
    dragInsertIdx = -1;
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  async function removeFromLibrary(manga: Manga) {
    await gql(UPDATE_MANGA, { id: manga.id, inLibrary: false }).catch(console.error);
    allManga = allManga.filter(m => m.id !== manga.id);
    cache.clearGroup(CACHE_GROUPS.LIBRARY);
    await reloadCategories();
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

  async function toggleMangaCategory(manga: Manga, cat: Category) {
    const inCat = (categoryMangaMap.get(cat.id) ?? []).some(m => m.id === manga.id);
    setCategories(store.categories.map(c => {
      if (c.id !== cat.id || !c.mangas) return c;
      const nodes = inCat
        ? c.mangas.nodes.filter(m => m.id !== manga.id)
        : [...c.mangas.nodes, manga];
      return { ...c, mangas: { nodes } };
    }));
    try {
      await gql(UPDATE_MANGA_CATEGORIES, {
        mangaId:    manga.id,
        addTo:      inCat ? [] : [cat.id],
        removeFrom: inCat ? [cat.id] : [],
      });
      await reloadCategories();
    } catch (e) {
      console.error(e);
      await reloadCategories();
    }
  }

  async function createAndAssign(manga: Manga) {
    const name = prompt("Folder name:");
    if (!name?.trim()) return;
    try {
      const res = await gql<{ createCategory: { category: Category } }>(CREATE_CATEGORY, { name: name.trim() });
      const cat = res.createCategory.category;
      await gql(UPDATE_MANGA_CATEGORIES, { mangaId: manga.id, addTo: [cat.id], removeFrom: [] });
      await reloadCategories();
    } catch (e) { console.error(e); }
  }

  // ── Context menu ──────────────────────────────────────────────────────────

  function openCtx(e: MouseEvent, m: Manga) {
    if (selectMode) { toggleSelect(m.id); return; }
    e.preventDefault();
    ctx = { x: e.clientX, y: e.clientY, manga: m };
  }

  function buildCtxItems(m: Manga): MenuEntry[] {
    const catEntries: MenuEntry[] = visibleCategories.map(cat => {
      const inCat = (categoryMangaMap.get(cat.id) ?? []).some(x => x.id === m.id);
      return {
        label: inCat ? `Remove from ${cat.name}` : `Add to ${cat.name}`,
        icon:  Folder,
        onClick: () => toggleMangaCategory(m, cat),
      };
    });
    return [
      { label: m.inLibrary ? "Remove from library" : "Add to library", icon: Books, onClick: () => m.inLibrary ? removeFromLibrary(m) : gql(UPDATE_MANGA, { id: m.id, inLibrary: true }).then(() => { allManga = allManga.map(x => x.id === m.id ? { ...x, inLibrary: true } : x); cache.clear(CACHE_KEYS.LIBRARY); }).catch(console.error) },
      { label: "Delete all downloads", icon: Trash, danger: true, disabled: !(m.downloadCount && m.downloadCount > 0), onClick: () => deleteAllDownloads(m) },
      { separator: true },
      { label: "Select this manga", icon: CheckSquare, onClick: () => enterSelectMode(m.id) },
      ...(catEntries.length ? [{ separator: true } as MenuEntry, ...catEntries] : []),
      { separator: true },
      { label: "New folder", icon: FolderSimplePlus, onClick: () => createAndAssign(m) },
    ];
  }

  function buildEmptyCtx(): MenuEntry[] {
    return [{
      label: "New folder",
      icon:  FolderSimplePlus,
      onClick: async () => {
        const name = prompt("Folder name:");
        if (!name?.trim()) return;
        try {
          await gql(CREATE_CATEGORY, { name: name.trim() });
          await reloadCategories();
        } catch (e) { console.error(e); }
      },
    }];
  }

  // ── Completed auto-assign ─────────────────────────────────────────────────

  export async function checkAndMarkCompleted(mangaId: number, chaps: Chapter[]) {
    await storeCheckAndMarkCompleted(mangaId, chaps, store.categories, gql, UPDATE_MANGA_CATEGORIES, UPDATE_MANGA);
    await reloadCategories();
  }

  onMount(() => {
    const ro = new ResizeObserver(([e]) => containerWidth = e.contentRect.width);
    ro.observe(scrollEl);
    const unsub = cache.subscribe(CACHE_KEYS.LIBRARY, () => loadData());

    const defaultId = store.settings.defaultLibraryCategoryId;
    if (defaultId && store.libraryFilter === "library") {
      store.libraryFilter = String(defaultId);
    }

    // Escape key exits select mode
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && selectMode) exitSelectMode();
      if ((e.key === "a" && (e.metaKey || e.ctrlKey)) && selectMode) {
        e.preventDefault();
        selectAll();
      }
    }
    window.addEventListener("keydown", onKeyDown);

    return () => { ro.disconnect(); unsub(); window.removeEventListener("keydown", onKeyDown); };
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
          {#each visibleCategories as cat, idx}
            {@const isDefault = (store.settings.defaultLibraryCategoryId ?? null) === cat.id}
            {#if dragInsertIdx === idx && activeDragKind === "tab"}
              <div class="tab-insert-bar" aria-hidden="true"></div>
            {/if}
            <button
              class="tab"
              class:active={store.libraryFilter === String(cat.id)}
              class:tab-dragging={dragTabId === cat.id}
              class:tab-drop-target={dropTargetTabId === cat.id}
              class:tab-default={isDefault}
              draggable="true"
              onclick={() => store.libraryFilter = String(cat.id)}
              ondragstart={(e) => onTabDragStart(e, cat)}
              ondragover={(e) => onTabDragOver(e, cat, idx)}
              ondragleave={onTabDragLeave}
              ondrop={(e) => onTabDrop(e, cat)}
              ondragend={onTabDragEnd}
            >
              {#if isDefault}
                <Star size={11} weight="fill" style="color:var(--accent-fg)" />
              {:else}
                <Folder size={11} weight="bold" />
              {/if}
              {cat.name}
              <span class="tab-count">{counts[String(cat.id)] ?? 0}</span>
            </button>
            {#if dragInsertIdx === idx + 1 && activeDragKind === "tab" && idx === visibleCategories.length - 1}
              <div class="tab-insert-bar" aria-hidden="true"></div>
            {/if}
          {/each}
        </div>
      </div>
      <div class="search-wrap">
        <MagnifyingGlass size={13} class="search-icon" weight="light" />
        <input class="search" placeholder="Search" bind:value={search} />
      </div>
    </div>

    <!-- ── Selection toolbar ───────────────────────────────────────────────── -->
    {#if selectMode}
      <div class="select-bar">
        <div class="select-bar-left">
          <button class="sel-btn sel-cancel" onclick={exitSelectMode} title="Cancel (Esc)">
            <X size={13} weight="bold" />
          </button>
          <span class="sel-count">{selectedIds.size} selected</span>
          <button class="sel-btn sel-all" onclick={selectAll} title="Select all (⌘A)">
            Select all
          </button>
        </div>
        <div class="select-bar-right">
          {#if visibleCategories.length}
            <div class="bulk-move-wrap">
              <button
                class="sel-btn sel-move"
                disabled={selectedIds.size === 0 || bulkWorking}
                onclick={() => bulkMoveOpen = !bulkMoveOpen}
              >
                <Folder size={13} weight="bold" />
                Move to folder
              </button>
              {#if bulkMoveOpen}
                <div class="bulk-folder-list">
                  {#each visibleCategories as cat}
                    <button class="bulk-folder-item" onclick={() => bulkMoveToCategory(cat)}>
                      <Folder size={11} weight="bold" />
                      {cat.name}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
          <button
            class="sel-btn sel-remove"
            disabled={selectedIds.size === 0 || bulkWorking}
            onclick={bulkRemoveFromLibrary}
          >
            <Trash size={13} weight="bold" />
            Remove
          </button>
        </div>
      </div>
    {/if}

    <div class="content">
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
          {@const isSelected = selectedIds.has(m.id)}
          <button
            class="card"
            class:card-selected={isSelected}
            class:select-mode={selectMode}
            onclick={(e) => onCardClick(e, m)}
            oncontextmenu={(e) => openCtx(e, m)}
            onpointerdown={(e) => onCardPointerDown(e, m)}
            onpointerup={onCardPointerUp}
            onpointerleave={onCardPointerLeave}
          >
            <div class="cover-wrap">
              <img src={thumbUrl(m.thumbnailUrl)} alt={m.title} class="cover" style="object-fit:{store.settings.libraryCropCovers ? 'cover' : 'contain'}" loading="lazy" decoding="async" draggable="false" />
              {#if m.downloadCount}<span class="badge-dl">{m.downloadCount}</span>{/if}
              {#if m.unreadCount}<span class="badge-unread">{m.unreadCount}</span>{/if}
              {#if selectMode}
                <div class="select-overlay" aria-hidden="true">
                  <div class="select-check" class:checked={isSelected}>
                    {#if isSelected}
                      <CheckSquare size={20} weight="fill" />
                    {:else}
                      <div class="select-check-empty"></div>
                    {/if}
                  </div>
                </div>
              {/if}
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
    </div><!-- .content -->
  {/if}
</div>

{#if ctx}
  <ContextMenu x={ctx.x} y={ctx.y} items={buildCtxItems(ctx.manga)} onClose={() => ctx = null} />
{/if}
{#if emptyCtx}
  <ContextMenu x={emptyCtx.x} y={emptyCtx.y} items={buildEmptyCtx()} onClose={() => emptyCtx = null} />
{/if}

<style>
  .root { position: relative; display: flex; flex-direction: column; height: 100%; overflow: hidden; animation: fadeIn 0.14s ease both; }
  .content { flex: 1; overflow-y: auto; padding: var(--sp-5) var(--sp-6) var(--sp-6); will-change: scroll-position; -webkit-overflow-scrolling: touch; }
  .branches { position: absolute; top: 0; right: 0; width: 400px; height: 600px; pointer-events: none; z-index: 0; }
  .branches :global(.anim-branch) { stroke-dasharray: 60; stroke-dashoffset: 60; animation: branchGrow 2.4s ease forwards; }
  @keyframes branchGrow { to { stroke-dashoffset: 0; } }
  .header { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; padding: var(--sp-4) var(--sp-6); border-bottom: 1px solid var(--border-dim); gap: var(--sp-4); flex-wrap: wrap; flex-shrink: 0; }
  .header-left { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
  .heading { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; flex-shrink: 0; }
  .tabs { display: flex; gap: 2px; background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-md); padding: 2px; }
  .tab { display: flex; align-items: center; gap: 5px; font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); text-transform: uppercase; padding: 4px 10px; border-radius: var(--radius-sm); color: var(--text-faint); white-space: nowrap; transition: background var(--t-base), color var(--t-base); cursor: grab; }
  .tab:hover { color: var(--text-muted); }
  .tab.active { background: var(--accent-muted); color: var(--accent-fg); border: 1px solid var(--accent-dim); }
  .tab-default { color: var(--text-muted); }
  .tab-dragging { opacity: 0.4; cursor: grabbing; }
  .tab-drop-target { background: var(--accent-muted) !important; color: var(--accent-fg) !important; outline: 1px dashed var(--accent); }
  .tab-insert-bar { width: 2px; height: 22px; background: var(--accent); border-radius: 2px; flex-shrink: 0; box-shadow: 0 0 6px var(--accent); pointer-events: none; }
  .tab-count { font-size: var(--text-2xs); opacity: 0.6; }
  .search-wrap { position: relative; display: flex; align-items: center; }
  .search-wrap :global(.search-icon) { position: absolute; left: 10px; color: var(--text-faint); pointer-events: none; }
  .search { background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-md); padding: 5px 10px 5px 28px; color: var(--text-primary); font-size: var(--text-sm); width: 180px; outline: none; transition: border-color var(--t-base); }
  .search::placeholder { color: var(--text-faint); }
  .search:focus { border-color: var(--border-strong); }

  /* ── Selection toolbar ──────────────────────────────────────────────────── */
  .select-bar { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); padding: var(--sp-2) var(--sp-6); background: var(--bg-raised); border-bottom: 1px solid var(--accent-dim); flex-shrink: 0; animation: fadeIn 0.1s ease both; }
  .select-bar-left { display: flex; align-items: center; gap: var(--sp-3); }
  .select-bar-right { display: flex; align-items: center; gap: var(--sp-2); position: relative; }
  .sel-count { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--accent-fg); letter-spacing: var(--tracking-wide); }
  .sel-btn { display: flex; align-items: center; gap: 5px; font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); text-transform: uppercase; padding: 4px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: var(--bg-base); color: var(--text-muted); cursor: pointer; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); white-space: nowrap; }
  .sel-btn:hover:not(:disabled) { color: var(--text-primary); border-color: var(--border-strong); }
  .sel-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .sel-cancel { border-color: transparent; background: transparent; }
  .sel-cancel:hover { background: var(--bg-raised); border-color: var(--border-dim); }
  .sel-move { color: var(--accent-fg); border-color: var(--accent-dim); background: var(--accent-muted); }
  .sel-move:hover:not(:disabled) { background: var(--accent-dim); }
  .sel-remove { color: var(--color-error, #e05c5c); border-color: color-mix(in srgb, var(--color-error, #e05c5c) 30%, transparent); }
  .sel-remove:hover:not(:disabled) { background: color-mix(in srgb, var(--color-error, #e05c5c) 12%, transparent); }
  .sel-all { border-color: transparent; background: transparent; }

  /* Bulk folder dropdown */
  .bulk-move-wrap { position: relative; }
  .bulk-folder-list { position: absolute; top: calc(100% + 4px); right: 0; z-index: 200; background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-md); padding: 4px; min-width: 160px; box-shadow: 0 8px 24px rgba(0,0,0,0.35); animation: fadeIn 0.1s ease both; }
  .bulk-folder-item { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 10px; border-radius: var(--radius-sm); border: none; background: transparent; color: var(--text-muted); font-family: var(--font-ui); font-size: var(--text-xs); cursor: pointer; text-align: left; transition: background var(--t-base), color var(--t-base); }
  .bulk-folder-item:hover { background: var(--bg-hover, var(--bg-base)); color: var(--text-primary); }

  /* ── Grid & cards ───────────────────────────────────────────────────────── */
  .grid { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(var(--cols, auto-fill), minmax(130px, 1fr)); gap: var(--sp-4); }
  .card { background: none; border: none; padding: 0; cursor: pointer; text-align: left; }
  .card:hover .cover { filter: brightness(1.07); }
  .card:hover .title { color: var(--text-primary); }
  /* In select mode, clicking always means "select", so use a checkbox cursor */
  .card.select-mode { cursor: default; }
  .card.card-selected .cover-wrap { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: var(--radius-md); }
  .card.card-selected .title { color: var(--accent-fg); }
  .cover-wrap { position: relative; aspect-ratio: 2/3; overflow: hidden; border-radius: var(--radius-md); background: var(--bg-raised); border: 1px solid var(--border-dim); transform: translateZ(0); }
  .cover { width: 100%; height: 100%; transition: filter var(--t-base); will-change: filter; }
  .badge-dl { position: absolute; bottom: var(--sp-1); right: var(--sp-1); min-width: 18px; height: 18px; padding: 0 3px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; background: var(--accent-dim); color: var(--accent-fg); border-radius: var(--radius-sm); border: 1px solid var(--accent-muted); }
  .badge-unread { position: absolute; top: var(--sp-1); left: var(--sp-1); min-width: 18px; height: 18px; padding: 0 4px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; background: var(--bg-void); color: var(--text-primary); border-radius: var(--radius-sm); border: 1px solid var(--border-strong); }

  /* Select overlay (checkbox) */
  .select-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.18); display: flex; align-items: flex-start; justify-content: flex-end; padding: 6px; pointer-events: none; }
  .select-check { color: var(--text-faint); opacity: 0.7; transition: color var(--t-base), opacity var(--t-base); }
  .select-check.checked { color: var(--accent-fg); opacity: 1; }
  .select-check-empty { width: 20px; height: 20px; border-radius: 4px; border: 2px solid var(--text-faint); background: rgba(0,0,0,0.3); }

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
