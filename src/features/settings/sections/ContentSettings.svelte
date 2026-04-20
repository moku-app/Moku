<script lang="ts">
  import { Plus, Tag } from "phosphor-svelte";
  import { store, updateSettings } from "@store/state.svelte";
  import { gql, thumbUrl } from "@api/client";
  import { GET_SOURCES } from "@api/queries/index";
  import type { Source } from "../../lib/types";

  let contentSources:        Source[] = $state([]);
  let contentSourcesLoading: boolean  = $state(false);
  let newTagInput                     = $state("");
  let tagsRevealed                    = $state(false);
  let sourceSearch                    = $state("");

  $effect(() => {
    if (contentSources.length === 0 && !contentSourcesLoading) loadContentSources();
  });

  async function loadContentSources() {
    contentSourcesLoading = true;
    try {
      const d = await gql<{ sources: { nodes: Source[] } }>(GET_SOURCES);
      contentSources = d.sources.nodes.filter(s => s.id !== "0");
    } catch (e) { console.error(e); }
    finally { contentSourcesLoading = false; }
  }

  function addTag() {
    const t = newTagInput.trim().toLowerCase();
    if (!t) return;
    const tags = store.settings.nsfwFilteredTags ?? [];
    if (!tags.includes(t)) updateSettings({ nsfwFilteredTags: [...tags, t] });
    newTagInput = "";
  }

  function removeTag(tag: string) {
    updateSettings({ nsfwFilteredTags: (store.settings.nsfwFilteredTags ?? []).filter(t => t !== tag) });
  }

  function resetTags() {
    updateSettings({ nsfwFilteredTags: ["adult","mature","hentai","ecchi","erotic","pornograph","18+","smut","lemon","explicit","sexual violence"] });
  }

  function toggleSourceAllowed(ids: string[]) {
    const allowed = store.settings.nsfwAllowedSourceIds ?? [];
    const blocked = store.settings.nsfwBlockedSourceIds ?? [];
    const allAllowed = ids.every(id => allowed.includes(id));
    if (allAllowed) {
      updateSettings({ nsfwAllowedSourceIds: allowed.filter(x => !ids.includes(x)) });
    } else {
      updateSettings({
        nsfwAllowedSourceIds: [...allowed.filter(x => !ids.includes(x)), ...ids],
        nsfwBlockedSourceIds: blocked.filter(x => !ids.includes(x)),
      });
    }
  }

  function toggleSourceBlocked(ids: string[]) {
    const allowed = store.settings.nsfwAllowedSourceIds ?? [];
    const blocked = store.settings.nsfwBlockedSourceIds ?? [];
    const allBlocked = ids.every(id => blocked.includes(id));
    if (allBlocked) {
      updateSettings({ nsfwBlockedSourceIds: blocked.filter(x => !ids.includes(x)) });
    } else {
      updateSettings({
        nsfwBlockedSourceIds: [...blocked.filter(x => !ids.includes(x)), ...ids],
        nsfwAllowedSourceIds: allowed.filter(x => !ids.includes(x)),
      });
    }
  }

  interface ContentSourceGroup { name: string; iconUrl: string; isNsfw: boolean; sources: Source[]; }

  const contentSourcesFiltered = $derived.by(() => {
    const q = sourceSearch.trim().toLowerCase();
    const filtered = q ? contentSources.filter(s => s.displayName.toLowerCase().includes(q) || s.lang.toLowerCase().includes(q)) : contentSources;
    const map = new Map<string, ContentSourceGroup>();
    for (const s of filtered) {
      const key = s.name;
      if (!map.has(key)) map.set(key, { name: s.name, iconUrl: s.iconUrl, isNsfw: s.isNsfw, sources: [] });
      map.get(key)!.sources.push(s);
    }
    return Array.from(map.values());
  });
</script>

<div class="s-panel">

  <div class="s-section">
    <p class="s-section-title">Content Filter</p>
    <div class="s-section-body">
      <label class="s-row">
        <div class="s-row-info"><span class="s-label">Show adult content</span><span class="s-desc">Sources and manga matching blocked tags are hidden when off</span></div>
        <button role="switch" aria-checked={store.settings.showNsfw} aria-label="Show adult content" class="s-toggle" class:on={store.settings.showNsfw}
          onclick={() => updateSettings({ showNsfw: !store.settings.showNsfw })}><span class="s-toggle-thumb"></span></button>
      </label>
    </div>
  </div>

  <div class="s-section">
    <p class="s-section-title">
      Blocked Genre Tags
      <button class="s-btn" onclick={() => tagsRevealed = !tagsRevealed}>
        {tagsRevealed ? "Hide" : `Show (${(store.settings.nsfwFilteredTags ?? []).length})`}
      </button>
    </p>
    <div class="s-section-body">
      <div class="s-row" style="padding-bottom:var(--sp-2)">
        <span class="s-desc">Manga matching any of these substrings are filtered. Case-insensitive, partial match.</span>
      </div>
      {#if tagsRevealed}
        <div class="s-tag-grid">
          {#each (store.settings.nsfwFilteredTags ?? []) as tag}
            <span class="s-tag">
              <Tag size={10} weight="light" />
              {tag}
              <button class="s-tag-remove" onclick={() => removeTag(tag)} title="Remove tag">×</button>
            </span>
          {/each}
        </div>
      {/if}
      <div class="s-tag-add">
        <input class="s-input full" placeholder="Add tag substring…" bind:value={newTagInput}
          onkeydown={(e) => { if (e.key === "Enter") addTag(); }} />
        <button class="s-btn s-btn-accent" onclick={addTag} disabled={!newTagInput.trim()}>
          <Plus size={13} weight="bold" /> Add
        </button>
        <button class="s-btn" onclick={resetTags}>Reset</button>
      </div>
    </div>
  </div>

  <div class="s-section">
    <p class="s-section-title">Source Overrides</p>
    <div class="s-section-body">
      <div class="s-row">
        <span class="s-desc">Allow lets a source through even if flagged NSFW. Block always hides it.</span>
      </div>
      <div class="s-search-wrap">
        <input class="s-input full" placeholder="Filter sources…" bind:value={sourceSearch} />
      </div>
      {#if contentSourcesLoading}
        <p class="s-empty">Loading sources…</p>
      {:else if contentSources.length === 0}
        <p class="s-empty">No sources found — check your server connection.</p>
      {:else}
        <div class="s-source-list">
          {#each contentSourcesFiltered as group (group.name)}
            {@const ids = group.sources.map(s => s.id)}
            {@const allowed = store.settings.nsfwAllowedSourceIds ?? []}
            {@const blocked = store.settings.nsfwBlockedSourceIds ?? []}
            {@const isAllowed = ids.every(id => allowed.includes(id))}
            {@const isBlocked = ids.every(id => blocked.includes(id))}
            <div class="s-source-row" class:allowed={isAllowed} class:blocked={isBlocked}>
              <img src={thumbUrl(group.iconUrl)} alt="" class="s-source-icon" loading="lazy" decoding="async" />
              <div class="s-source-info">
                <span class="s-source-name">{group.name}</span>
                <span class="s-source-meta">{group.sources[0].isNsfw ? "NSFW · " : ""}{group.sources.length > 1 ? `${group.sources.length} languages` : group.sources[0].lang.toUpperCase()}</span>
              </div>
              <div class="s-source-actions">
                <button class="s-source-action-btn" class:allow={isAllowed} onclick={() => toggleSourceAllowed(ids)}>Allow</button>
                <button class="s-source-action-btn" class:block={isBlocked} onclick={() => toggleSourceBlocked(ids)}>Block</button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>

</div>