<script lang="ts">
  import { untrack }     from "svelte";
  import { CircleNotch, X, Check } from "phosphor-svelte";
  import { gql }         from "@api/client";
  import { store, addToast } from "@store/state.svelte";
  import { GET_EXTENSIONS, GET_SETTINGS } from "@api/queries";
  import { SET_EXTENSION_REPOS, INSTALL_EXTERNAL_EXTENSION, FETCH_EXTENSIONS, UPDATE_EXTENSION } from "@api/mutations";
  import type { Extension } from "@types/index";
  import { matchesFilter, groupExtensions, validateUrl, type Filter, type Panel } from "../lib/extensionHelpers";
  import ExtensionFilters from "./ExtensionFilters.svelte";
  import ExtensionCard    from "./ExtensionCard.svelte";

  let extensions: Extension[] = $state([]);
  let loading      = $state(true);
  let refreshing   = $state(false);
  let filter       = $state<Filter>("installed");
  let search       = $state("");
  let langFilter   = $state<string | null>(null);
  let working      = $state(new Set<string>());
  let expanded     = $state(new Set<string>());
  let panel        = $state<Panel>(null);

  let externalUrl    = $state("");
  let installing     = $state(false);
  let installError   = $state<string | null>(null);
  let installSuccess = $state(false);

  let repos        = $state<string[]>([]);
  let reposLoading = $state(false);
  let newRepoUrl   = $state("");
  let repoError    = $state<string | null>(null);
  let savingRepos  = $state(false);

  async function load() {
    const d = await gql<{ extensions: { nodes: Extension[] } }>(GET_EXTENSIONS).catch(console.error);
    if (d) extensions = d.extensions.nodes;
  }

  async function fetchFromRepo() {
    refreshing = true;
    const d = await gql<{ fetchExtensions: { extensions: Extension[] } }>(FETCH_EXTENSIONS)
      .catch(console.error)
      .finally(() => refreshing = false);
    if (d) extensions = d.fetchExtensions.extensions;
  }

  async function loadRepos() {
    reposLoading = true;
    try {
      const d = await gql<{ settings: { extensionRepos: string[] } }>(GET_SETTINGS);
      repos = d.settings.extensionRepos ?? [];
    } catch (e) { console.error(e); }
    finally { reposLoading = false; }
  }

  async function saveRepos(updated: string[]) {
    savingRepos = true;
    try {
      const d = await gql<{ setSettings: { settings: { extensionRepos: string[] } } }>(SET_EXTENSION_REPOS, { repos: updated });
      repos = d.setSettings.settings.extensionRepos;
    } catch (e: any) {
      repoError = e instanceof Error ? e.message : "Failed to save";
    } finally { savingRepos = false; }
  }

  function addRepo() {
    const url = newRepoUrl.trim();
    const err = validateUrl(url);
    if (err) { repoError = err; return; }
    if (repos.includes(url)) { repoError = "Repo already added"; return; }
    repoError = null; newRepoUrl = "";
    saveRepos([...repos, url]);
  }

  function removeRepo(url: string) { saveRepos(repos.filter((r) => r !== url)); }

  async function mutate(pkgName: string, op: "install" | "update" | "uninstall") {
    working = new Set(working).add(pkgName);
    const label = extensions.find((e) => e.pkgName === pkgName)?.name ?? pkgName;
    const gqlArgs = {
      install:   { id: pkgName, install:   true },
      update:    { id: pkgName, update:    true },
      uninstall: { id: pkgName, uninstall: true },
    }[op];
    try {
      await gql(UPDATE_EXTENSION, gqlArgs);
      await load();
      addToast({
        install:   { kind: "download" as const, title: "Extension installed", body: label },
        update:    { kind: "success"  as const, title: "Extension updated",   body: label },
        uninstall: { kind: "info"     as const, title: "Extension removed",   body: label },
      }[op]);
    } catch (e: any) {
      await load();
      addToast({ kind: "error", title: "Extension error", body: e instanceof Error ? e.message : String(e) });
    } finally {
      working.delete(pkgName); working = new Set(working);
    }
  }

  async function installExternal() {
    const url = externalUrl.trim();
    const err = validateUrl(url, ".apk");
    if (err) { installError = err; return; }
    installing = true; installError = null; installSuccess = false;
    try {
      await gql(INSTALL_EXTERNAL_EXTENSION, { url });
      installSuccess = true; externalUrl = "";
      await load();
      addToast({ kind: "download", title: "Extension installed", body: url.split("/").pop() ?? url });
      setTimeout(() => { panel = null; installSuccess = false; }, 1500);
    } catch (e: any) {
      installError = e instanceof Error ? e.message : "Install failed";
      addToast({ kind: "error", title: "Install failed", body: installError });
    } finally { installing = false; }
  }

  function openPanel(p: Panel) {
    panel = panel === p ? null : p;
    installError = null; installSuccess = false; externalUrl = "";
    repoError = null; newRepoUrl = "";
    if (p === "repos") loadRepos();
  }

  function toggleExpand(base: string) {
    const next = new Set(expanded);
    next.has(base) ? next.delete(base) : next.add(base);
    expanded = next;
  }

  function setFilter(f: Filter) { filter = f; langFilter = null; }

  const filtered = $derived(extensions.filter((e) => {
    const q = search.toLowerCase();
    return (e.name.toLowerCase().includes(q) || e.lang.toLowerCase().includes(q))
      && matchesFilter(e, filter)
      && (langFilter === null || e.lang === langFilter);
  }));

  const availableLangs = $derived(
    [...new Set(extensions.filter((e) => matchesFilter(e, filter)).map((e) => e.lang))].sort()
  );

  const groups      = $derived(groupExtensions(filtered, store.settings.preferredExtensionLang));
  const updateCount = $derived(extensions.filter((e) => e.hasUpdate).length);

  $effect(() => { untrack(() => fetchFromRepo().finally(() => { loading = false; })); });

  function focusOnMount(node: HTMLElement) { node.focus(); }
</script>

<div class="root">
  <ExtensionFilters
    {filter} {search} {panel} {refreshing} {updateCount} {availableLangs} {langFilter}
    onFilter={setFilter}
    onSearch={(q) => search = q}
    onLang={(l) => langFilter = l}
    onPanel={openPanel}
    onRefresh={fetchFromRepo}
  />

  {#if panel === "apk"}
    <div class="ext-panel">
      <div class="panel-header">
        <span class="panel-title">Install from APK URL</span>
        <button class="icon-btn" onclick={() => panel = null}><X size={14} weight="light" /></button>
      </div>
      <div class="ext-row">
        <input
          class="ext-input" class:error={installError}
          placeholder="https://example.com/extension.apk"
          bind:value={externalUrl} disabled={installing}
          oninput={() => installError = null}
          onkeydown={(e) => e.key === "Enter" && !installing && installExternal()}
          use:focusOnMount
        />
        <button class="install-btn" class:success={installSuccess}
          onclick={installExternal} disabled={installing || !externalUrl.trim()}>
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
          <input
            class="ext-input" class:error={repoError}
            placeholder="https://example.com/index.min.json"
            bind:value={newRepoUrl} disabled={savingRepos}
            oninput={() => repoError = null}
            onkeydown={(e) => e.key === "Enter" && !savingRepos && addRepo()}
          />
          <button class="install-btn" onclick={addRepo} disabled={savingRepos || !newRepoUrl.trim()}>
            {#if savingRepos}<CircleNotch size={13} weight="light" class="anim-spin" />{:else}Add{/if}
          </button>
        </div>
        {#if repoError}<div class="panel-error">{repoError}</div>{/if}
      {/if}
    </div>
  {/if}

  {#if loading}
    <div class="empty"><CircleNotch size={16} weight="light" class="anim-spin" style="color:var(--text-faint)" /></div>
  {:else if groups.length === 0}
    <div class="empty">No extensions found.</div>
  {:else}
    <div class="list">
      {#each groups as { base, primary, variants }}
        <ExtensionCard
          {base} {primary} {variants} {working}
          expanded={expanded.has(base)}
          onToggle={toggleExpand}
          onMutate={mutate}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .root { display: flex; flex-direction: column; height: 100%; overflow: hidden; animation: fadeIn 0.14s ease both; }
  .list { flex: 1; overflow-y: auto; padding: 0 var(--sp-4) var(--sp-4); display: flex; flex-direction: column; gap: 1px; }
  .empty { display: flex; align-items: center; justify-content: center; flex: 1; color: var(--text-faint); font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); }
  .icon-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--radius-md); color: var(--text-muted); transition: color var(--t-base), background var(--t-base); }
  .icon-btn:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-raised); }
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
</style>
