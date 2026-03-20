<script lang="ts">
  import { untrack } from "svelte";
  import { MagnifyingGlass, ArrowsClockwise, Plus, CircleNotch, CaretRight, CaretDown, X, Check, GitBranch } from "phosphor-svelte";
  import { gql, thumbUrl } from "../../lib/client";
  import { GET_EXTENSIONS, FETCH_EXTENSIONS, UPDATE_EXTENSION, INSTALL_EXTERNAL_EXTENSION, GET_SETTINGS, SET_EXTENSION_REPOS } from "../../lib/queries";
  import { store } from "../../store/state.svelte";
  import type { Extension } from "../../lib/types";

  type Filter = "installed" | "available" | "updates" | "all";
  type Panel  = null | "apk" | "repos";

  function baseName(name: string): string { return name.replace(/\s*\([A-Z0-9-]{2,10}\)\s*$/, "").trim(); }

  let extensions: Extension[] = $state([]);
  let loading = $state(true);
  let refreshing = $state(false);
  let filter: Filter          = $state("installed");
  let search = $state("");
  let working = $state(new Set<string>());
  let expanded = $state(new Set<string>());
  let panel: Panel            = $state(null);
  let externalUrl = $state("");
  let installing = $state(false);
  let installError: string|null = $state(null);
  let installSuccess = $state(false);
  let repos: string[]         = $state([]);
  let reposLoading = $state(false);
  let newRepoUrl = $state("");
  let repoError: string|null  = $state(null);
  let savingRepos = $state(false);

  async function load() {
    return gql<{ extensions: { nodes: Extension[] } }>(GET_EXTENSIONS)
      .then((d) => extensions = d.extensions.nodes).catch(console.error);
  }

  async function fetchFromRepo() {
    refreshing = true;
    return gql<{ fetchExtensions: { extensions: Extension[] } }>(FETCH_EXTENSIONS)
      .then((d) => extensions = d.fetchExtensions.extensions).catch(console.error)
      .finally(() => refreshing = false);
  }

  async function loadRepos() {
    reposLoading = true;
    try { const d = await gql<{ settings: { extensionRepos: string[] } }>(GET_SETTINGS); repos = d.settings.extensionRepos ?? []; }
    catch (e) { console.error(e); } finally { reposLoading = false; }
  }

  async function saveRepos(updated: string[]) {
    savingRepos = true;
    try { const d = await gql<{ setSettings: { settings: { extensionRepos: string[] } } }>(SET_EXTENSION_REPOS, { repos: updated }); repos = d.setSettings.settings.extensionRepos; }
    catch (e: any) { repoError = e instanceof Error ? e.message : "Failed to save"; } finally { savingRepos = false; }
  }

  function addRepo() {
    const url = newRepoUrl.trim();
    if (!url) return;
    if (!url.startsWith("http://") && !url.startsWith("https://")) { repoError = "URL must start with http:// or https://"; return; }
    if (repos.includes(url)) { repoError = "Repo already added"; return; }
    repoError = null; newRepoUrl = "";
    saveRepos([...repos, url]);
  }

  function removeRepo(url: string) { saveRepos(repos.filter((r) => r !== url)); }

  async function mutate(fn: () => Promise<unknown>, pkgName: string) {
    working = new Set(working).add(pkgName);
    await fn().catch(console.error);
    await load();
    working.delete(pkgName); working = new Set(working);
  }

  async function installExternal() {
    const url = externalUrl.trim();
    if (!url) return;
    if (!url.startsWith("http://") && !url.startsWith("https://")) { installError = "URL must start with http:// or https://"; return; }
    if (!url.endsWith(".apk")) { installError = "URL must point to an .apk file"; return; }
    installing = true; installError = null; installSuccess = false;
    try {
      await gql(INSTALL_EXTERNAL_EXTENSION, { url });
      installSuccess = true; externalUrl = "";
      await load();
      setTimeout(() => { panel = null; installSuccess = false; }, 1500);
    } catch (e: any) { installError = e instanceof Error ? e.message : "Install failed"; }
    finally { installing = false; }
  }

  function openPanel(p: Panel) {
    panel = panel === p ? null : p;
    installError = null; installSuccess = false; externalUrl = "";
    repoError = null; newRepoUrl = "";
    if (p === "repos") loadRepos();
  }

  $effect(() => { untrack(() => fetchFromRepo().finally(() => { loading = false; })); });

  const filtered = $derived(extensions.filter((e) => {
    const q = search.toLowerCase();
    const matchSearch = e.name.toLowerCase().includes(q) || e.lang.toLowerCase().includes(q);
    const matchFilter = filter === "installed" ? e.isInstalled : filter === "available" ? !e.isInstalled : filter === "updates" ? e.hasUpdate : true;
    return matchSearch && matchFilter;
  }));

  const groups = $derived.by(() => {
    const map = new Map<string, Extension[]>();
    for (const ext of filtered) { const key = baseName(ext.name); if (!map.has(key)) map.set(key, []); map.get(key)!.push(ext); }
    const preferredLang = store.settings.preferredExtensionLang;
    return Array.from(map.entries()).map(([base, all]) => {
      const primary = all.find((v) => v.lang === preferredLang) ?? all.find((v) => v.lang === "en") ?? all[0];
      return { base, primary, variants: all.filter((v) => v.pkgName !== primary.pkgName) };
    });
  });
  const updateCount = $derived(extensions.filter((e) => e.hasUpdate).length);

  const FILTERS: { id: Filter; label: string }[] = [
    { id: "installed", label: "Installed" },
    { id: "available", label: "Available" },
    { id: "updates",   label: "Updates" },
    { id: "all",       label: "All" },
  ];

  function toggleExpand(base: string) {
    const next = new Set(expanded);
    next.has(base) ? next.delete(base) : next.add(base);
    expanded = next;
  }
</script>

<div class="root">
  <div class="header">
    <h1 class="heading">Extensions</h1>
    <div class="header-actions">
      <button class="icon-btn" class:active={panel === "repos"} onclick={() => openPanel("repos")} title="Manage repos">
        <GitBranch size={14} weight="light" />
      </button>
      <button class="icon-btn" class:active={panel === "apk"} onclick={() => openPanel("apk")} title="Install from URL">
        <Plus size={14} weight="light" />
      </button>
      <button class="icon-btn" onclick={fetchFromRepo} disabled={refreshing} title="Refresh repo">
        <ArrowsClockwise size={14} weight="light" class={refreshing ? "anim-spin" : ""} />
      </button>
    </div>
  </div>

  {#if panel === "apk"}
    <div class="ext-panel">
      <div class="panel-header">
        <span class="panel-title">Install from APK URL</span>
        <button class="icon-btn" onclick={() => panel = null}><X size={14} weight="light" /></button>
      </div>
      <div class="ext-row">
        <input class="ext-input" class:error={installError} placeholder="https://example.com/extension.apk"
          bind:value={externalUrl} disabled={installing}
          oninput={() => installError = null}
          onkeydown={(e) => e.key === "Enter" && !installing && installExternal()} autofocus />
        <button class="install-btn" class:success={installSuccess} onclick={installExternal} disabled={installing || !externalUrl.trim()}>
          {#if installing}<CircleNotch size={13} weight="light" class="anim-spin" />
          {:else if installSuccess}<Check size={13} weight="bold" /> Done
          {:else}Install{/if}
        </button>
      </div>
      {#if installError}<div class="panel-error">{installError}</div>{/if}
    </div>
  {/if}

  {#if panel === "repos"}
    <div class="ext-panel">
      <div class="panel-header">
        <span class="panel-title">Extension Repositories</span>
        <button class="icon-btn" onclick={() => panel = null}><X size={14} weight="light" /></button>
      </div>
      {#if reposLoading}
        <div class="repo-loading"><CircleNotch size={14} weight="light" class="anim-spin" style="color:var(--text-faint)" /></div>
      {:else}
        {#if repos.length === 0}
          <div class="repo-empty">No repos configured.</div>
        {:else}
          <div class="repo-list">
            {#each repos as url}
              <div class="repo-row">
                <span class="repo-url">{url}</span>
                <button class="repo-remove" onclick={() => removeRepo(url)} disabled={savingRepos} title="Remove repo">
                  {#if savingRepos}<CircleNotch size={12} weight="light" class="anim-spin" />{:else}<X size={12} weight="bold" />{/if}
                </button>
              </div>
            {/each}
          </div>
        {/if}
        <div class="ext-row" style="margin-top:var(--sp-2)">
          <input class="ext-input" class:error={repoError} placeholder="https://example.com/index.min.json"
            bind:value={newRepoUrl} disabled={savingRepos}
            oninput={() => repoError = null}
            onkeydown={(e) => e.key === "Enter" && !savingRepos && addRepo()} />
          <button class="install-btn" onclick={addRepo} disabled={savingRepos || !newRepoUrl.trim()}>
            {#if savingRepos}<CircleNotch size={13} weight="light" class="anim-spin" />{:else}Add{/if}
          </button>
        </div>
        {#if repoError}<div class="panel-error">{repoError}</div>{/if}
      {/if}
    </div>
  {/if}

  <div class="controls">
    <div class="tabs">
      {#each FILTERS as f}
        <button class="tab" class:active={filter === f.id} onclick={() => filter = f.id}>
          {f.id === "updates" && updateCount > 0 ? `Updates (${updateCount})` : f.label}
        </button>
      {/each}
    </div>
    <div class="search-wrap">
      <MagnifyingGlass size={12} class="search-icon" weight="light" />
      <input class="search" placeholder="Search" bind:value={search} />
    </div>
  </div>

  {#if loading}
    <div class="empty"><CircleNotch size={16} weight="light" class="anim-spin" style="color:var(--text-faint)" /></div>
  {:else if groups.length === 0}
    <div class="empty">No extensions found.</div>
  {:else}
    <div class="list">
      {#each groups as { base, primary, variants }}
        {@const isExpanded = expanded.has(base)}
        {@const hasVariants = variants.length > 0}
        <div class="group">
          <div class="row">
            <img src={thumbUrl(primary.iconUrl)} alt={primary.name} class="icon" onerror={(e) => (e.target as HTMLImageElement).style.display = "none"} />
            <div class="info">
              <span class="name">{base}</span>
              <span class="meta"><span class="lang-tag">{primary.lang.toUpperCase()}</span> v{primary.versionName}</span>
            </div>
            {#if working.has(primary.pkgName)}
              <CircleNotch size={14} weight="light" class="anim-spin" style="color:var(--text-faint)" />
            {:else if primary.hasUpdate}
              <div class="row-actions">
                <button class="action-btn" onclick={() => mutate(() => gql(UPDATE_EXTENSION, { id: primary.pkgName, update: true }), primary.pkgName)}>Update</button>
                <button class="action-btn-dim" onclick={() => mutate(() => gql(UPDATE_EXTENSION, { id: primary.pkgName, uninstall: true }), primary.pkgName)}>Remove</button>
              </div>
            {:else if primary.isInstalled}
              <button class="action-btn-dim" onclick={() => mutate(() => gql(UPDATE_EXTENSION, { id: primary.pkgName, uninstall: true }), primary.pkgName)}>Remove</button>
            {:else}
              <button class="action-btn" onclick={() => mutate(() => gql(UPDATE_EXTENSION, { id: primary.pkgName, install: true }), primary.pkgName)}>Install</button>
            {/if}
            {#if hasVariants}
              <button class="expand-btn" onclick={() => toggleExpand(base)} title="{variants.length + 1} languages">
                {#if isExpanded}<CaretDown size={12} weight="light" />{:else}<CaretRight size={12} weight="light" />{/if}
                <span class="expand-count">{variants.length + 1}</span>
              </button>
            {/if}
          </div>
          {#if isExpanded && hasVariants}
            <div class="variants">
              {#each variants as v}
                <div class="variant-row">
                  <span class="lang-tag">{v.lang.toUpperCase()}</span>
                  <span class="variant-name">{v.name}</span>
                  <span class="variant-version">v{v.versionName}</span>
                  {#if v.hasUpdate}<span class="update-badge-small">↑</span>{/if}
                  <div class="variant-actions">
                    {#if working.has(v.pkgName)}
                      <CircleNotch size={14} weight="light" class="anim-spin" style="color:var(--text-faint)" />
                    {:else if v.hasUpdate}
                      <button class="action-btn" onclick={() => mutate(() => gql(UPDATE_EXTENSION, { id: v.pkgName, update: true }), v.pkgName)}>Update</button>
                    {:else if v.isInstalled}
                      <button class="action-btn-dim" onclick={() => mutate(() => gql(UPDATE_EXTENSION, { id: v.pkgName, uninstall: true }), v.pkgName)}>Remove</button>
                    {:else}
                      <button class="action-btn" onclick={() => mutate(() => gql(UPDATE_EXTENSION, { id: v.pkgName, install: true }), v.pkgName)}>Install</button>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>


<style>
  .root { display: flex; flex-direction: column; height: 100%; overflow: hidden; animation: fadeIn 0.14s ease both; }
  .header { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-5) var(--sp-6) var(--sp-3); flex-shrink: 0; }
  .heading { font-family: var(--font-ui); font-size: var(--text-xs); font-weight: var(--weight-normal); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; }
  .header-actions { display: flex; gap: var(--sp-1); }
  .icon-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--radius-md); color: var(--text-muted); transition: color var(--t-base), background var(--t-base); }
  .icon-btn:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-raised); }
  .icon-btn:disabled { opacity: 0.4; }
  .icon-btn.active { color: var(--accent-fg); background: var(--accent-muted); }
  .ext-panel { display: flex; flex-direction: column; gap: var(--sp-2); padding: 0 var(--sp-6) var(--sp-3); flex-shrink: 0; animation: fadeIn 0.1s ease both; }
  .panel-header { display: flex; align-items: center; justify-content: space-between; }
  .panel-title { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-muted); letter-spacing: var(--tracking-wide); }
  .panel-error { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--color-error); letter-spacing: var(--tracking-wide); padding: 0 2px; }
  .ext-row { display: flex; gap: var(--sp-2); }
  .ext-input { flex: 1; background: var(--bg-raised); border: 1px solid var(--border-strong); border-radius: var(--radius-md); padding: 6px var(--sp-3); color: var(--text-primary); font-size: var(--text-sm); outline: none; transition: border-color var(--t-base); }
  .ext-input:focus { border-color: var(--border-focus); }
  .ext-input:disabled { opacity: 0.5; }
  .ext-input.error { border-color: var(--color-error) !important; }
  .install-btn { display: flex; align-items: center; gap: var(--sp-1); font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 6px 14px; border-radius: var(--radius-md); background: var(--accent-muted); color: var(--accent-fg); border: 1px solid var(--accent-dim); cursor: pointer; flex-shrink: 0; transition: filter var(--t-base), opacity var(--t-base); white-space: nowrap; }
  .install-btn:hover:not(:disabled) { filter: brightness(1.1); }
  .install-btn:disabled { opacity: 0.5; cursor: default; }
  .install-btn.success { background: rgba(107,143,107,0.2); border-color: var(--accent-fg); color: var(--accent-fg); }
  .repo-loading { display: flex; align-items: center; justify-content: center; padding: var(--sp-3); }
  .repo-empty { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); padding: var(--sp-1) 2px; }
  .repo-list { display: flex; flex-direction: column; gap: 2px; }
  .repo-row { display: flex; align-items: center; gap: var(--sp-2); padding: 5px var(--sp-2); border-radius: var(--radius-md); background: var(--bg-raised); border: 1px solid var(--border-dim); }
  .repo-url { flex: 1; font-size: var(--text-2xs); color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .repo-remove { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: var(--radius-sm); color: var(--text-faint); flex-shrink: 0; transition: color var(--t-base), background var(--t-base); }
  .repo-remove:hover:not(:disabled) { color: var(--color-error); background: var(--bg-overlay); }
  .controls { display: flex; align-items: center; justify-content: space-between; padding: 0 var(--sp-6) var(--sp-3); gap: var(--sp-3); flex-shrink: 0; }
  .tabs { display: flex; gap: 2px; }
  .tab { font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 4px 10px; border-radius: var(--radius-md); border: none; background: none; color: var(--text-muted); cursor: pointer; transition: background var(--t-base), color var(--t-base); }
  .tab:hover { background: var(--bg-raised); color: var(--text-secondary); }
  .tab.active { background: var(--accent-muted); color: var(--accent-fg); }
  .search-wrap { position: relative; display: flex; align-items: center; }
  .search-wrap :global(.search-icon) { position: absolute; left: 9px; color: var(--text-faint); pointer-events: none; }
  .search { background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-md); padding: 5px 10px 5px 26px; color: var(--text-primary); font-size: var(--text-sm); width: 160px; outline: none; transition: border-color var(--t-base); }
  .search::placeholder { color: var(--text-faint); }
  .search:focus { border-color: var(--border-strong); }
  .list { flex: 1; overflow-y: auto; padding: 0 var(--sp-4) var(--sp-4); display: flex; flex-direction: column; gap: 1px; }
  .group { display: flex; flex-direction: column; }
  .row { display: flex; align-items: center; gap: var(--sp-3); padding: 8px var(--sp-3); border-radius: var(--radius-md); border: 1px solid transparent; transition: background var(--t-fast), border-color var(--t-fast); }
  .row:hover { background: var(--bg-raised); border-color: var(--border-dim); }
  .icon { width: 32px; height: 32px; border-radius: var(--radius-md); object-fit: cover; flex-shrink: 0; background: var(--bg-raised); }
  .info { flex: 1; display: flex; flex-direction: column; gap: 2px; overflow: hidden; min-width: 0; }
  .name { font-size: var(--text-base); font-weight: var(--weight-medium); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { display: flex; align-items: center; gap: var(--sp-2); font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .lang-tag { background: var(--bg-overlay); border: 1px solid var(--border-dim); border-radius: var(--radius-sm); padding: 1px 5px; font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-muted); letter-spacing: var(--tracking-wider); }
  .update-badge { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); background: var(--accent-muted); color: var(--accent-fg); border: 1px solid var(--accent-dim); border-radius: var(--radius-sm); padding: 2px 6px; flex-shrink: 0; }
  .update-badge-small { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--accent-fg); flex-shrink: 0; }
  .row-actions { display: flex; gap: var(--sp-1); flex-shrink: 0; }
  .action-btn { font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 4px 10px; border-radius: var(--radius-md); background: var(--accent-muted); color: var(--accent-fg); border: 1px solid var(--accent-dim); cursor: pointer; flex-shrink: 0; transition: filter var(--t-base); }
  .action-btn:hover { filter: brightness(1.1); }
  .action-btn-dim { font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 4px 10px; border-radius: var(--radius-md); background: none; color: var(--text-faint); border: 1px solid var(--border-dim); cursor: pointer; flex-shrink: 0; transition: color var(--t-base), border-color var(--t-base); }
  .action-btn-dim:hover { color: var(--color-error); border-color: var(--color-error); }
  .expand-btn { display: flex; align-items: center; gap: 3px; padding: 4px 6px; border-radius: var(--radius-sm); color: var(--text-faint); flex-shrink: 0; transition: color var(--t-base), background var(--t-base); }
  .expand-btn:hover { color: var(--text-muted); background: var(--bg-overlay); }
  .expand-count { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); }
  .variants { display: flex; flex-direction: column; gap: 1px; margin: 1px 0 2px calc(32px + var(--sp-3) + var(--sp-3)); padding-left: var(--sp-3); border-left: 1px solid var(--border-dim); animation: fadeIn 0.1s ease both; }
  .variant-row { display: flex; align-items: center; gap: var(--sp-2); padding: 5px var(--sp-2); border-radius: var(--radius-md); transition: background var(--t-fast); }
  .variant-row:hover { background: var(--bg-raised); }
  .variant-name { flex: 1; font-size: var(--text-sm); color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .variant-version { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); flex-shrink: 0; }
  .variant-actions { flex-shrink: 0; }
  .empty { display: flex; align-items: center; justify-content: center; flex: 1; color: var(--text-faint); font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); }
</style>
