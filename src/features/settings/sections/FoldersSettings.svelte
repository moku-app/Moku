<script lang="ts">
  import { FolderSimple, Plus, Pencil, Trash, Star, Eye, EyeSlash } from "phosphor-svelte";
  import { gql } from "@api/client";
  import { GET_CATEGORIES } from "@api/queries/manga";
  import { CREATE_CATEGORY, UPDATE_CATEGORY, DELETE_CATEGORY, UPDATE_CATEGORY_ORDER } from "@api/mutations/manga";
  import type { Category } from "@types";
  import { store, updateSettings, toggleHiddenCategory, setCategories } from "@store/state.svelte";

  let catsLoading   = $state(false);
  let catsError     = $state<string | null>(null);
  let newFolderName = $state("");
  let editingId     = $state<number | null>(null);
  let editingName   = $state("");

  async function loadCategories() {
    catsLoading = true; catsError = null;
    try {
      const res = await gql<{ categories: { nodes: Category[] } }>(GET_CATEGORIES);
      const zeroCat = store.categories.filter(c => c.id === 0);
      const fresh = res.categories.nodes.filter(c => c.id !== 0);
      const merged = fresh.map(f => {
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

  async function moveCategory(id: number, direction: -1 | 1) {
    const zeroCat  = store.categories.filter(c => c.id === 0);
    const sortable = store.categories.filter(c => c.id !== 0).sort((a, b) => a.order - b.order);
    const idx = sortable.findIndex(c => c.id === id);
    if (idx < 0) return;
    const newPos = idx + 1 + direction;
    if (newPos < 1 || newPos > sortable.length) return;
    const reordered = [...sortable];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(idx + direction, 0, moved);
    setCategories([...zeroCat, ...reordered.map((c, i) => ({ ...c, order: i + 1 }))]);
    try {
      const res = await gql<{ updateCategoryOrder: { categories: Category[] } }>(UPDATE_CATEGORY_ORDER, { id, position: newPos });
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
        {#each displayCats as cat, i}
          <div class="s-folder-row">
            {#if editingId === cat.id}
              <input class="s-input full" bind:value={editingName}
                onkeydown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") editingId = null; }}
                onblur={commitEdit} use:focusInput />
              <button class="s-btn-icon" onclick={commitEdit} title="Save">✓</button>
            {:else}
              <FolderSimple size={14} weight="light" style="color:var(--text-faint);flex-shrink:0" />
              <span class="s-folder-name">{cat.name}</span>
              <span class="s-folder-count">{cat.mangas?.nodes.length ?? 0} manga</span>
              <button class="s-btn-icon"
                class:accent={(store.settings.defaultLibraryCategoryId ?? null) === cat.id}
                onclick={() => updateSettings({ defaultLibraryCategoryId: (store.settings.defaultLibraryCategoryId ?? null) === cat.id ? null : cat.id })}
                title={(store.settings.defaultLibraryCategoryId ?? null) === cat.id ? "Remove as default folder" : "Set as default folder"}>
                <Star size={13} weight={(store.settings.defaultLibraryCategoryId ?? null) === cat.id ? "fill" : "light"} />
              </button>
              <button class="s-btn-icon"
                onclick={() => toggleHiddenCategory(cat.id)}
                title={(store.settings.hiddenCategoryIds ?? []).includes(cat.id) ? "Show in Saved tab" : "Hide from Saved tab"}>
                {#if (store.settings.hiddenCategoryIds ?? []).includes(cat.id)}<EyeSlash size={13} weight="light" />{:else}<Eye size={13} weight="light" />{/if}
              </button>
              <button class="s-btn-icon" onclick={() => moveCategory(cat.id, -1)} disabled={i === 0} title="Move up">↑</button>
              <button class="s-btn-icon" onclick={() => moveCategory(cat.id, 1)} disabled={i === displayCats.length - 1} title="Move down">↓</button>
              <button class="s-btn-icon" onclick={() => startEdit(cat.id, cat.name)} title="Rename"><Pencil size={12} weight="light" /></button>
              <button class="s-btn-icon danger" onclick={() => deleteFolder(cat.id)} title="Delete"><Trash size={12} weight="light" /></button>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </div>

</div>