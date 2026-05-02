<script lang="ts">
  import { FolderSimple, Plus, Trash, Star, Eye, EyeSlash, ArrowsClockwise, ArrowsCounterClockwise, DownloadSimple, DotsSixVertical } from "phosphor-svelte";
  import { gql } from "@api/client";
  import { GET_CATEGORIES } from "@api/queries/manga";
  import { CREATE_CATEGORY, UPDATE_CATEGORY, UPDATE_CATEGORIES, DELETE_CATEGORY, UPDATE_CATEGORY_ORDER } from "@api/mutations/manga";
  import type { Category } from "@types";
  import { store, updateSettings, toggleHiddenCategory, setCategories } from "@store/state.svelte";

  let catsLoading   = $state(false);
  let catsError     = $state<string | null>(null);
  let newFolderName = $state("");
  let editingId     = $state<number | null>(null);
  let editingName   = $state("");

  let dragId       = $state<number | null>(null);
  let dragOverId   = $state<number | null>(null);
  let dropPosition = $state<"above" | "below" | null>(null);

  async function loadCategories() {
    catsLoading = true; catsError = null;
    try {
      const res = await gql<{ categories: { nodes: Category[] } }>(GET_CATEGORIES);
      const zeroCat = store.categories.filter(c => c.id === 0);
      const fresh   = res.categories.nodes.filter(c => c.id !== 0);
      const merged  = fresh.map(f => {
        const existing = store.categories.find(c => c.id === f.id);
        return existing ? { ...existing, ...f } : f;
      });
      setCategories([...zeroCat, ...merged]);
    } catch (e: any) {
      catsError = e?.message ?? "Failed to load folders";
    } finally { catsLoading = false; }
  }

  async function createFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      const res = await gql<{ createCategory: { category: Category } }>(CREATE_CATEGORY, { name });
      setCategories([...store.categories, res.createCategory.category]);
      newFolderName = "";
    } catch (e: any) { catsError = e?.message ?? "Failed to create folder"; }
  }

  function startEdit(id: number, name: string) { editingId = id; editingName = name; }

  async function commitEdit() {
    if (editingId !== null && editingName.trim()) {
      try {
        await gql(UPDATE_CATEGORY, { id: editingId, name: editingName.trim() });
        setCategories(store.categories.map(c => c.id === editingId ? { ...c, name: editingName.trim() } : c));
      } catch (e: any) { catsError = e?.message ?? "Failed to rename"; }
    }
    editingId = null; editingName = "";
  }

  async function deleteFolder(id: number) {
    try {
      await gql(DELETE_CATEGORY, { id });
      setCategories(store.categories.filter(c => c.id !== id));
    } catch (e: any) { catsError = e?.message ?? "Failed to delete folder"; }
  }

  async function toggleCategoryFlag(id: number, flag: "includeInUpdate" | "includeInDownload") {
    const cat = store.categories.find(c => c.id === id);
    if (!cat) return;
    const next = !cat[flag];
    setCategories(store.categories.map(c => c.id === id ? { ...c, [flag]: next } : c));
    try {
      await gql(UPDATE_CATEGORIES, { ids: [id], patch: { [flag]: next ? "INCLUDE" : "EXCLUDE" } });
    } catch (e: any) {
      setCategories(store.categories.map(c => c.id === id ? { ...c, [flag]: !next } : c));
      catsError = e?.message ?? "Failed to update folder";
    }
  }

  async function applyReorder(fromId: number, toId: number) {
    const zeroCat  = store.categories.filter(c => c.id === 0);
    const sortable = store.categories.filter(c => c.id !== 0).sort((a, b) => a.order - b.order);
    const fromIdx  = sortable.findIndex(c => c.id === fromId);
    const toIdx    = sortable.findIndex(c => c.id === toId);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
    const reordered = [...sortable];
    const [moved]   = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    setCategories([...zeroCat, ...reordered.map((c, i) => ({ ...c, order: i + 1 }))]);
    try {
      const res = await gql<{ updateCategoryOrder: { categories: Category[] } }>(UPDATE_CATEGORY_ORDER, { id: fromId, position: toIdx + 1 });
      const updated = res.updateCategoryOrder.categories.filter(c => c.id !== 0);
      setCategories([
        ...zeroCat,
        ...updated.sort((a, b) => a.order - b.order).map(fresh => {
          const existing = store.categories.find(c => c.id === fresh.id);
          return existing ? { ...existing, ...fresh } : fresh;
        }),
      ]);
    } catch (e: any) {
      catsError = e?.message ?? "Failed to reorder";
      await loadCategories();
    }
  }

  function onDragStart(e: DragEvent, id: number) {
    dragId = id;
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(id)); }
  }

  function onDragOver(e: DragEvent, id: number) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    if (dragId === id) return;
    dragOverId = id;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dropPosition = e.clientY < rect.top + rect.height / 2 ? "above" : "below";
  }

  function onDrop(e: DragEvent, id: number) {
    e.preventDefault();
    if (dragId !== null && dragId !== id) applyReorder(dragId, id);
    dragId = null; dragOverId = null; dropPosition = null;
  }

  function onDragEnd() { dragId = null; dragOverId = null; dropPosition = null; }

  function focusInput(node: HTMLElement) { node.focus(); }

  $effect(() => {
    if (!store.categories.length && !catsLoading) loadCategories();
  });
</script>

<div class="s-panel">
  <div class="s-section">
    <p class="s-section-title">Manage Folders</p>
    <div class="s-section-body">
      <div class="s-row">
        <span class="s-desc">Folders are stored as Suwayomi categories. Changes sync across all clients.</span>
      </div>
      {#if catsError}
        <div class="s-banner s-banner-error">{catsError}</div>
      {/if}
      <div class="s-folder-create">
        <input class="s-input full" placeholder="New folder name…" bind:value={newFolderName}
          onkeydown={(e) => e.key === "Enter" && createFolder()} />
        <button class="s-btn s-btn-accent" onclick={createFolder} disabled={!newFolderName.trim()}>
          <Plus size={13} weight="bold" /> Create
        </button>
      </div>
      {#if catsLoading}
        <p class="s-empty">Loading folders…</p>
      {:else if store.categories.filter(c => c.id !== 0).length === 0}
        <p class="s-empty">No folders yet. Create one above.</p>
      {:else}
        {@const displayCats = store.categories
            .filter(c => c.id !== 0)
            .sort((a, b) => {
              const defaultId = store.settings.defaultLibraryCategoryId ?? null;
              if (a.id === defaultId) return -1;
              if (b.id === defaultId) return  1;
              return a.order - b.order;
            })}
        <div class="s-folder-list" class:is-dragging={dragId !== null}>
          {#each displayCats as cat}
            <div
              class="s-folder-row"
              class:dragging={dragId === cat.id}
              class:drop-above={dragOverId === cat.id && dragId !== cat.id && dropPosition === "above"}
              class:drop-below={dragOverId === cat.id && dragId !== cat.id && dropPosition === "below"}
              ondragover={(e) => onDragOver(e, cat.id)}
              ondrop={(e) => onDrop(e, cat.id)}
              ondragleave={() => { if (dragOverId === cat.id) { dragOverId = null; dropPosition = null; } }}
            >
              {#if editingId === cat.id}
                <input class="s-input full" bind:value={editingName}
                  onkeydown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") { editingId = null; } }}
                  onblur={commitEdit} use:focusInput />
                <button class="s-btn-icon" onclick={commitEdit} title="Save">✓</button>
              {:else}
                {@const isDefault = (store.settings.defaultLibraryCategoryId ?? null) === cat.id}
                {@const isHidden  = (store.settings.hiddenCategoryIds ?? []).includes(cat.id)}
                {@const inUpdate  = cat.includeInUpdate !== false}
                {@const inDl      = cat.includeInDownload !== false}

                <div class="s-folder-identity" draggable="true"
                  ondragstart={(e) => onDragStart(e, cat.id)}
                  ondragend={onDragEnd}>
                  <span class="s-folder-icon">
                    <FolderSimple size={14} weight="light" />
                    <DotsSixVertical size={14} weight="bold" />
                  </span>
                  <span class="s-folder-name" onclick={(e) => { e.stopPropagation(); startEdit(cat.id, cat.name); }} title="Click to rename">
                    {cat.name}
                  </span>
                </div>

                <span class="s-folder-count">{cat.mangas?.nodes.length ?? 0} manga</span>

                <div class="s-folder-actions">
                  <button class="s-btn-icon" class:active={isDefault}
                    onclick={() => updateSettings({ defaultLibraryCategoryId: isDefault ? null : cat.id })}
                    title={isDefault ? "Remove as default folder" : "Set as default folder"}>
                    <Star size={13} weight={isDefault ? "fill" : "light"} />
                  </button>

                  <button class="s-btn-icon" class:muted={isHidden}
                    onclick={() => toggleHiddenCategory(cat.id)}
                    title={isHidden ? "Show in library" : "Hide from library"}>
                    {#if isHidden}
                      <EyeSlash size={13} weight="light" />
                    {:else}
                      <Eye size={13} weight="light" />
                    {/if}
                  </button>

                  <button class="s-btn-icon" class:active={inUpdate} class:inactive={!inUpdate}
                    onclick={() => toggleCategoryFlag(cat.id, "includeInUpdate")}
                    title={inUpdate ? "Included in updates — click to exclude" : "Excluded from updates — click to include"}>
                    {#if inUpdate}
                      <ArrowsClockwise size={13} weight="bold" />
                    {:else}
                      <ArrowsCounterClockwise size={13} weight="light" />
                    {/if}
                  </button>

                  <button class="s-btn-icon" class:active={inDl} class:inactive={!inDl}
                    onclick={() => toggleCategoryFlag(cat.id, "includeInDownload")}
                    title={inDl ? "Included in auto-downloads — click to exclude" : "Excluded from auto-downloads — click to include"}>
                    <DownloadSimple size={13} weight={inDl ? "bold" : "light"} />
                  </button>

                  <button class="s-btn-icon danger" onclick={() => deleteFolder(cat.id)} title="Delete folder">
                    <Trash size={12} weight="light" />
                  </button>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .s-folder-list {
    display: contents;
  }

  .s-folder-list.is-dragging,
  .s-folder-list.is-dragging * {
    user-select: none;
    -webkit-user-select: none;
  }

  .s-folder-row {
    transition: opacity 0.15s, background 0.1s;
    position: relative;
  }

  .s-folder-row.dragging {
    opacity: 0.35;
  }

  .s-folder-row.drop-above::before,
  .s-folder-row.drop-below::after {
    content: "";
    position: absolute;
    left: 8px;
    right: 8px;
    height: 2px;
    background: var(--color-success, #4ade80);
    border-radius: 2px;
    pointer-events: none;
    z-index: 10;
  }

  .s-folder-row.drop-above::before { top: -1px; }
  .s-folder-row.drop-below::after  { bottom: -1px; }

  .s-folder-identity {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-faint);
    flex-shrink: 0;
    overflow: hidden;
    cursor: grab;
  }

  .s-folder-identity:active {
    cursor: grabbing;
  }

  .s-folder-icon {
    display: grid;
    flex-shrink: 0;
  }

  .s-folder-icon > :global(*) {
    grid-area: 1 / 1;
    transition: opacity 0.12s;
  }

  .s-folder-icon > :global(*:last-child) {
    opacity: 0;
  }

  .s-folder-row:hover .s-folder-icon > :global(*:first-child) {
    opacity: 0;
  }

  .s-folder-row:hover .s-folder-icon > :global(*:last-child) {
    opacity: 1;
  }

  .s-folder-name {
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-primary);
  }

  .s-folder-name:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .s-folder-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
    flex-shrink: 0;
  }

  .s-btn-icon.active {
    color: var(--accent, #6c8ef5);
  }

  .s-btn-icon.inactive {
    color: var(--color-error, #f87171);
    opacity: 0.75;
  }

  .s-btn-icon.inactive:hover {
    opacity: 1;
  }

  .s-btn-icon.muted {
    color: var(--text-faint);
    opacity: 0.5;
  }
</style>