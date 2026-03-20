<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { X, Book, Image, Sliders, Info, Keyboard, Gear, HardDrives, FolderSimple, Plus, Pencil, Trash, Wrench, PaintBrush } from "phosphor-svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { gql } from "../../lib/client";
  import { GET_DOWNLOADS_PATH } from "../../lib/queries";
  import { settings, settingsOpen, history, updateSettings, resetKeybinds, addFolder, removeFolder, renameFolder, toggleFolderTab } from "../../store";
  import { cache } from "../../lib/cache";
  import { KEYBIND_LABELS, DEFAULT_KEYBINDS, eventToKeybind } from "../../lib/keybinds";
  import type { Settings, FitMode, Theme } from "../../store";
  import type { Keybinds } from "../../lib/keybinds";

  type Tab = "general" | "appearance" | "reader" | "library" | "performance" | "keybinds" | "storage" | "folders" | "about" | "devtools";

  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: "general",    label: "General",     icon: Gear       },
    { id: "appearance", label: "Appearance",  icon: PaintBrush },
    { id: "reader",     label: "Reader",      icon: Book       },
    { id: "library",    label: "Library",     icon: Image      },
    { id: "performance",label: "Performance", icon: Sliders    },
    { id: "keybinds",   label: "Keybinds",    icon: Keyboard   },
    { id: "storage",    label: "Storage",     icon: HardDrives },
    { id: "folders",    label: "Folders",     icon: FolderSimple },
    { id: "about",      label: "About",       icon: Info       },
    { id: "devtools",   label: "Dev Tools",   icon: Wrench     },
  ];

  const THEMES: { id: Theme; label: string; description: string; swatches: string[] }[] = [
    { id: "dark",           label: "Dark",           description: "Default near-black",            swatches: ["#101010","#151515","#a8c4a8","#f0efec"] },
    { id: "high-contrast",  label: "High Contrast",  description: "Darker base, sharper text",     swatches: ["#080808","#111111","#bcd8bc","#ffffff"] },
    { id: "light",          label: "Light",          description: "Warm off-white",                swatches: ["#f4f2ee","#faf8f4","#2a5a2a","#1a1916"] },
    { id: "light-contrast", label: "Light Contrast", description: "Light with maximum contrast",   swatches: ["#ece8e2","#f5f2ec","#183818","#080806"] },
    { id: "midnight",       label: "Midnight",       description: "Deep blue-black tint",          swatches: ["#0c1020","#101428","#a8b4e8","#eeeef8"] },
    { id: "warm",           label: "Warm",           description: "Amber and sepia tones",         swatches: ["#16130c","#1c1810","#e0b860","#f5f0e0"] },
  ];

  let tab: Tab          = "general";
  let contentBodyEl: HTMLDivElement;

  $: { tab; tick().then(() => contentBodyEl?.scrollTo({ top: 0 })); }

  function close() { settingsOpen.set(false); }

  function onKey(e: KeyboardEvent) { if (e.key === "Escape" && !listeningKey) close(); }
  onMount(() => window.addEventListener("keydown", onKey));
  onDestroy(() => window.removeEventListener("keydown", onKey));

  
  let listeningKey: keyof Keybinds | null = null;

  function startListen(key: keyof Keybinds) {
    listeningKey = listeningKey === key ? null : key;
  }

  function onKeyCapture(e: KeyboardEvent) {
    if (!listeningKey) return;
    e.preventDefault(); e.stopPropagation();
    const bind = eventToKeybind(e);
    if (!bind) return;
    updateSettings({ keybinds: { ...$settings.keybinds, [listeningKey]: bind } });
    listeningKey = null;
  }

  $: if (listeningKey) {
    window.addEventListener("keydown", onKeyCapture, true);
  } else {
    window.removeEventListener("keydown", onKeyCapture, true);
  }

  
  interface StorageInfo { manga_bytes: number; total_bytes: number; free_bytes: number; path: string; }
  let storageInfo: StorageInfo | null = null;
  let storageLoading = false;
  let storageError: string | null = null;
  let clearing = false;
  let cleared  = false;

  async function fetchStorage() {
    storageLoading = true; storageError = null;
    try {
      const pathData = await gql<{ settings: { downloadsPath: string } }>(GET_DOWNLOADS_PATH);
      storageInfo = await invoke<StorageInfo>("get_storage_info", { downloadsPath: pathData.settings.downloadsPath });
    } catch (e: any) { storageError = e instanceof Error ? e.message : String(e); }
    finally { storageLoading = false; }
  }

  $: if (tab === "storage" && !storageInfo && !storageLoading) fetchStorage();

  function handleClearCache() {
    clearing = true;
    caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n)))).catch(() => {})
      .finally(() => { clearing = false; cleared = true; setTimeout(() => cleared = false, 2500); fetchStorage(); });
  }

  function fmtBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const units = ["B","KB","MB","GB","TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
  }

  // ── Performance metrics ───────────────────────────────────────────────────────
  // Pulled from the session cache on demand — lightweight, no extra fetches.
  interface PerfSnapshot {
    cacheEntries: number;
    cacheKeys:    string[];
    oldestEntryMs: number | null;
    newestEntryMs: number | null;
  }

  let perfSnapshot: PerfSnapshot | null = null;

  function refreshPerfMetrics() {
    // cache.list() isn't exported, but we can probe known keys to build a snapshot
    const knownPrefixes = ["library", "sources", "popular", "genre:", "manga:", "chapters:", "page:", "pages:"];
    let entries = 0;
    let oldest: number | null = null;
    let newest: number | null = null;
    const foundKeys: string[] = [];

    // We walk the cache via ageOf — non-zero means the key exists
    // For a real count we introspect via a set of likely keys
    // (The cache module doesn't expose an iterator, so we sample)
    const checkKey = (k: string) => {
      const age = cache.ageOf(k);
      if (age !== undefined) {
        entries++;
        foundKeys.push(k);
        const ts = Date.now() - age;
        if (oldest === null || ts < oldest) oldest = ts;
        if (newest === null || ts > newest) newest = ts;
      }
    };

    ["library", "sources", "popular"].forEach(checkKey);
    ["Action","Romance","Fantasy","Comedy","Drama","Horror","Sci-Fi","Adventure","Thriller",
     "Isekai","Supernatural","Historical","Psychological","Sports","Mystery","Mecha",
     "Slice of Life","School Life","Martial Arts","Magic","Military"].forEach(g => checkKey(`genre:${g}`));

    perfSnapshot = { cacheEntries: entries, cacheKeys: foundKeys, oldestEntryMs: oldest, newestEntryMs: newest };
  }

  $: if (tab === "performance") refreshPerfMetrics();

  function fmtAge(ts: number | null): string {
    if (ts === null) return "—";
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  }

  // Storage limit input state
  let storageLimitInput = String($settings.storageLimitGb ?? "");

  function applyStorageLimit() {
    const v = storageLimitInput.trim();
    if (v === "" || v === "0") { updateSettings({ storageLimitGb: null }); return; }
    const n = parseFloat(v);
    if (!isNaN(n) && n > 0) updateSettings({ storageLimitGb: n });
  }

  
  let newFolderName  = "";
  let editingId: string | null = null;
  let editingName    = "";

  function createFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    addFolder(name); newFolderName = "";
  }

  function startEdit(id: string, name: string) { editingId = id; editingName = name; }

  function commitEdit() {
    if (editingId && editingName.trim()) renameFolder(editingId, editingName.trim());
    editingId = null; editingName = "";
  }

  
  let selectOpen: string | null = null;

  function toggleSelect(id: string) { selectOpen = selectOpen === id ? null : id; }

  function onSelectOutside(e: MouseEvent) {
    if (selectOpen && !(e.target as HTMLElement).closest(".select-wrap")) selectOpen = null;
  }

  onMount(() => document.addEventListener("mousedown", onSelectOutside));
  onDestroy(() => document.removeEventListener("mousedown", onSelectOutside));

  
  let splashTriggered = false;
  function triggerSplash() {
    splashTriggered = true;
    setTimeout(() => splashTriggered = false, 200);
    (window as any).__mokuShowSplash?.();
  }
</script>

<div class="backdrop" role="presentation" on:click={(e) => { if (e.target === e.currentTarget) close(); }} on:keydown={(e) => { if (e.key === "Escape") close(); }}>
  <div class="modal" role="dialog" aria-label="Settings">
    <div class="sidebar">
      <p class="modal-title">Settings</p>
      <nav class="nav">
        {#each TABS as t}
          <button class="nav-item" class:active={tab === t.id} on:click={() => tab = t.id}>
            <svelte:component this={t.icon} size={14} weight="light" />
            <span>{t.label}</span>
          </button>
        {/each}
      </nav>
    </div>

    <div class="content">
      <div class="content-header">
        <p class="content-title">{TABS.find((t) => t.id === tab)?.label}</p>
        <button class="close-btn" aria-label="Close settings" on:click={close}><X size={15} weight="light" /></button>
      </div>

      <div class="content-body" bind:this={contentBodyEl}>

        
        {#if tab === "general"}
          <div class="panel">
            <div class="section">
              <p class="section-title">Interface Scale</p>
              <div class="scale-row">
                <input type="range" min={70} max={150} step={5} value={$settings.uiScale}
                  on:input={(e) => updateSettings({ uiScale: Number(e.currentTarget.value) })} class="scale-slider" />
                <span class="scale-val">{$settings.uiScale}%</span>
                <button class="step-btn" on:click={() => updateSettings({ uiScale: 100 })} disabled={$settings.uiScale === 100} title="Reset">↺</button>
              </div>
              <p class="scale-hint">
                {#each [70,80,90,100,110,125,150] as v}
                  <button class="scale-preset" class:active={$settings.uiScale === v} on:click={() => updateSettings({ uiScale: v })}>{v}%</button>
                {/each}
              </p>
            </div>
            <div class="section">
              <p class="section-title">Server</p>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Server URL</span><span class="toggle-desc">Base URL of your Suwayomi instance</span></div>
                <input class="text-input" value={$settings.serverUrl ?? "http://localhost:4567"} on:input={(e) => updateSettings({ serverUrl: e.currentTarget.value })} placeholder="http://localhost:4567" spellcheck="false" />
              </div>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Server binary</span><span class="toggle-desc">Path or command to launch tachidesk-server</span></div>
                <input class="text-input" value={$settings.serverBinary} on:input={(e) => updateSettings({ serverBinary: e.currentTarget.value })} placeholder="tachidesk-server" spellcheck="false" />
              </div>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Auto-start server</span><span class="toggle-desc">Launch tachidesk-server when Moku opens</span></div>
                <button role="switch" aria-checked={$settings.autoStartServer} aria-label="Auto-start server" class="toggle" class:on={$settings.autoStartServer} on:click={() => updateSettings({ autoStartServer: !$settings.autoStartServer })}><span class="toggle-thumb"></span></button>
              </label>
            </div>
            <div class="section">
              <p class="section-title">Inactivity</p>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Idle screen timeout</span><span class="toggle-desc">Show the Moku idle splash after this much inactivity.</span></div>
                <div class="select-wrap" id="idle-timeout">
                  <button class="select-btn" on:click={() => toggleSelect("idle-timeout")}>
                    <span>{{ "0":"Never","1":"1 minute","2":"2 minutes","5":"5 minutes","10":"10 minutes","15":"15 minutes","30":"30 minutes" }[String($settings.idleTimeoutMin ?? 5)] ?? `${$settings.idleTimeoutMin} min`}</span>
                    <svg class="select-caret" class:open={selectOpen === "idle-timeout"} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
                  </button>
                  {#if selectOpen === "idle-timeout"}
                    <div class="select-menu">
                      {#each [["0","Never"],["1","1 minute"],["2","2 minutes"],["5","5 minutes"],["10","10 minutes"],["15","15 minutes"],["30","30 minutes"]] as [v, l]}
                        <button class="select-option" class:active={String($settings.idleTimeoutMin ?? 5) === v} on:click={() => { updateSettings({ idleTimeoutMin: Number(v) }); selectOpen = null; }}>{l}</button>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
            </div>
          </div>

        
        {:else if tab === "appearance"}
          <div class="panel">
            <div class="section">
              <p class="section-title">Theme</p>
              <div class="theme-grid">
                {#each THEMES as theme}
                  {@const active = ($settings.theme ?? "dark") === theme.id}
                  <button class="theme-card" class:active on:click={() => updateSettings({ theme: theme.id })} title={theme.description}>
                    <div class="theme-preview">
                      <div class="theme-preview-bg" style="background:{theme.swatches[0]}">
                        <div class="theme-preview-sidebar" style="background:{theme.swatches[1]}"></div>
                        <div class="theme-preview-content">
                          <div class="theme-preview-accent" style="background:{theme.swatches[2]}"></div>
                          <div class="theme-preview-text" style="background:{theme.swatches[3]}55"></div>
                          <div class="theme-preview-text" style="background:{theme.swatches[3]}33;width:60%"></div>
                        </div>
                      </div>
                    </div>
                    <div class="theme-card-info">
                      <span class="theme-card-label">{theme.label}</span>
                      <span class="theme-card-desc">{theme.description}</span>
                    </div>
                    {#if active}<span class="theme-card-check">✓</span>{/if}
                  </button>
                {/each}
              </div>
            </div>
          </div>

        
        {:else if tab === "reader"}
          <div class="panel">
            <div class="section">
              <p class="section-title">Page Layout</p>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Default layout</span><span class="toggle-desc">How chapters open by default</span></div>
                <div class="select-wrap" id="page-style">
                  <button class="select-btn" on:click={() => toggleSelect("page-style")}>
                    <span>{{ "single":"Single page","longstrip":"Long strip" }[$settings.pageStyle === "double" ? "single" : $settings.pageStyle]}</span>
                    <svg class="select-caret" class:open={selectOpen === "page-style"} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
                  </button>
                  {#if selectOpen === "page-style"}
                    <div class="select-menu">
                      {#each [["single","Single page"],["longstrip","Long strip"]] as [v, l]}
                        <button class="select-option" class:active={($settings.pageStyle === "double" ? "single" : $settings.pageStyle) === v} on:click={() => { updateSettings({ pageStyle: v as Settings["pageStyle"] }); selectOpen = null; }}>{l}</button>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Reading direction</span><span class="toggle-desc">Left-to-right for most manga, right-to-left for Japanese</span></div>
                <div class="select-wrap" id="reading-dir">
                  <button class="select-btn" on:click={() => toggleSelect("reading-dir")}>
                    <span>{{ "ltr":"Left to right","rtl":"Right to left" }[$settings.readingDirection]}</span>
                    <svg class="select-caret" class:open={selectOpen === "reading-dir"} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
                  </button>
                  {#if selectOpen === "reading-dir"}
                    <div class="select-menu">
                      {#each [["ltr","Left to right"],["rtl","Right to left"]] as [v, l]}
                        <button class="select-option" class:active={$settings.readingDirection === v} on:click={() => { updateSettings({ readingDirection: v as Settings["readingDirection"] }); selectOpen = null; }}>{l}</button>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Page gap</span><span class="toggle-desc">Add spacing between pages in longstrip mode</span></div>
                <button role="switch" aria-checked={$settings.pageGap} aria-label="Page gap" class="toggle" class:on={$settings.pageGap} on:click={() => updateSettings({ pageGap: !$settings.pageGap })}><span class="toggle-thumb"></span></button>
              </label>
            </div>
            <div class="section">
              <p class="section-title">Fit &amp; Zoom</p>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Default fit mode</span><span class="toggle-desc">How pages are sized to fit the screen</span></div>
                <div class="select-wrap" id="fit-mode">
                  <button class="select-btn" on:click={() => toggleSelect("fit-mode")}>
                    <span>{{ "width":"Fit width","height":"Fit height","screen":"Fit screen","original":"Original (1:1)" }[$settings.fitMode ?? "width"]}</span>
                    <svg class="select-caret" class:open={selectOpen === "fit-mode"} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
                  </button>
                  {#if selectOpen === "fit-mode"}
                    <div class="select-menu">
                      {#each [["width","Fit width"],["height","Fit height"],["screen","Fit screen"],["original","Original (1:1)"]] as [v, l]}
                        <button class="select-option" class:active={($settings.fitMode ?? "width") === v} on:click={() => { updateSettings({ fitMode: v as FitMode }); selectOpen = null; }}>{l}</button>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Max page width</span><span class="toggle-desc">Pixel cap for fit-width mode.</span></div>
                <div class="step-controls">
                  <button class="step-btn" on:click={() => updateSettings({ maxPageWidth: Math.max(200, ($settings.maxPageWidth ?? 900) - 100) })}>−</button>
                  <span class="step-val">{$settings.maxPageWidth ?? 900}px</span>
                  <button class="step-btn" on:click={() => updateSettings({ maxPageWidth: Math.min(2400, ($settings.maxPageWidth ?? 900) + 100) })}>+</button>
                </div>
              </div>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Optimize contrast</span><span class="toggle-desc">Use webkit-optimize-contrast rendering</span></div>
                <button role="switch" aria-checked={$settings.optimizeContrast} aria-label="Optimize contrast" class="toggle" class:on={$settings.optimizeContrast} on:click={() => updateSettings({ optimizeContrast: !$settings.optimizeContrast })}><span class="toggle-thumb"></span></button>
              </label>
            </div>
            <div class="section">
              <p class="section-title">Behaviour</p>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Auto-mark chapters read</span><span class="toggle-desc">Mark a chapter as read when you reach the last page</span></div>
                <button role="switch" aria-checked={$settings.autoMarkRead} aria-label="Auto-mark chapters read" class="toggle" class:on={$settings.autoMarkRead} on:click={() => updateSettings({ autoMarkRead: !$settings.autoMarkRead })}><span class="toggle-thumb"></span></button>
              </label>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Auto-advance chapters</span><span class="toggle-desc">Automatically open the next chapter at the end of a long strip</span></div>
                <button role="switch" aria-checked={$settings.autoNextChapter ?? false} aria-label="Auto-advance chapters" class="toggle" class:on={$settings.autoNextChapter} on:click={() => updateSettings({ autoNextChapter: !($settings.autoNextChapter ?? false) })}><span class="toggle-thumb"></span></button>
              </label>
              {#if !($settings.autoNextChapter ?? false)}
                <label class="toggle-row">
                  <div class="toggle-info"><span class="toggle-label">Mark read when skipping to next chapter</span><span class="toggle-desc">Mark chapter as read when you tap next before finishing</span></div>
                  <button role="switch" aria-checked={$settings.markReadOnNext ?? true} aria-label="Mark read when skipping" class="toggle" class:on={$settings.markReadOnNext ?? true} on:click={() => updateSettings({ markReadOnNext: !($settings.markReadOnNext ?? true) })}><span class="toggle-thumb"></span></button>
                </label>
              {/if}
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Pages to preload</span><span class="toggle-desc">Images loaded ahead of the current page</span></div>
                <div class="step-controls">
                  <button class="step-btn" on:click={() => updateSettings({ preloadPages: Math.max(0, $settings.preloadPages - 1) })} disabled={$settings.preloadPages <= 0}>−</button>
                  <span class="step-val">{$settings.preloadPages}</span>
                  <button class="step-btn" on:click={() => updateSettings({ preloadPages: Math.min(10, $settings.preloadPages + 1) })} disabled={$settings.preloadPages >= 10}>+</button>
                </div>
              </div>
            </div>
          </div>

        
        {:else if tab === "library"}
          <div class="panel">
            <div class="section">
              <p class="section-title">Display</p>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Crop cover images</span><span class="toggle-desc">Fill grid cells — may crop cover edges</span></div>
                <button role="switch" aria-checked={$settings.libraryCropCovers} aria-label="Crop cover images" class="toggle" class:on={$settings.libraryCropCovers} on:click={() => updateSettings({ libraryCropCovers: !$settings.libraryCropCovers })}><span class="toggle-thumb"></span></button>
              </label>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Show NSFW sources</span><span class="toggle-desc">Display adult content sources in the sources list</span></div>
                <button role="switch" aria-checked={$settings.showNsfw} aria-label="Show NSFW sources" class="toggle" class:on={$settings.showNsfw} on:click={() => updateSettings({ showNsfw: !$settings.showNsfw })}><span class="toggle-thumb"></span></button>
              </label>
            </div>
            <div class="section">
              <p class="section-title">Chapters</p>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Default sort direction</span></div>
                <div class="select-wrap" id="sort-dir">
                  <button class="select-btn" on:click={() => toggleSelect("sort-dir")}>
                    <span>{{ "desc":"Newest first","asc":"Oldest first" }[$settings.chapterSortDir]}</span>
                    <svg class="select-caret" class:open={selectOpen === "sort-dir"} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
                  </button>
                  {#if selectOpen === "sort-dir"}
                    <div class="select-menu">
                      {#each [["desc","Newest first"],["asc","Oldest first"]] as [v, l]}
                        <button class="select-option" class:active={$settings.chapterSortDir === v} on:click={() => { updateSettings({ chapterSortDir: v as Settings["chapterSortDir"] }); selectOpen = null; }}>{l}</button>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
            </div>
            <div class="section">
              <p class="section-title">History</p>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Reading history</span><span class="toggle-desc">{$history.length} entries stored</span></div>
                <button class="danger-btn" on:click={() => history.set([])} disabled={$history.length === 0}>Clear history</button>
              </div>
            </div>
          </div>

        
        {:else if tab === "performance"}
          <div class="panel">

            <div class="section">
              <p class="section-title">Render Limit</p>
              <div class="step-row">
                <div class="toggle-info">
                  <span class="toggle-label">Items per page</span>
                  <span class="toggle-desc">Library and Search render this many items before showing a "Load more" button. Lower = faster scrolling on large libraries.</span>
                </div>
                <div class="step-controls">
                  <button class="step-btn" on:click={() => updateSettings({ renderLimit: Math.max(12, ($settings.renderLimit ?? 48) - 12) })} disabled={($settings.renderLimit ?? 48) <= 12}>−</button>
                  <span class="step-val">{$settings.renderLimit ?? 48}</span>
                  <button class="step-btn" on:click={() => updateSettings({ renderLimit: Math.min(200, ($settings.renderLimit ?? 48) + 12) })} disabled={($settings.renderLimit ?? 48) >= 200}>+</button>
                </div>
              </div>
              <p class="scale-hint">
                {#each [12, 24, 48, 96, 200] as v}
                  <button class="scale-preset" class:active={($settings.renderLimit ?? 48) === v} on:click={() => updateSettings({ renderLimit: v })}>{v}</button>
                {/each}
              </p>
            </div>

            <div class="section">
              <p class="section-title">Rendering</p>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">GPU acceleration</span><span class="toggle-desc">Promote reader and library to compositor layers</span></div>
                <button role="switch" aria-checked={$settings.gpuAcceleration} aria-label="GPU acceleration" class="toggle" class:on={$settings.gpuAcceleration} on:click={() => updateSettings({ gpuAcceleration: !$settings.gpuAcceleration })}><span class="toggle-thumb"></span></button>
              </label>
            </div>

            <div class="section">
              <p class="section-title">Idle / Splash Screen</p>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Animated card background</span><span class="toggle-desc">Show floating manga cards on splash and idle screens.</span></div>
                <button role="switch" aria-checked={$settings.splashCards ?? true} aria-label="Animated card background" class="toggle" class:on={$settings.splashCards ?? true} on:click={() => updateSettings({ splashCards: !($settings.splashCards ?? true) })}><span class="toggle-thumb"></span></button>
              </label>
            </div>

            <div class="section">
              <p class="section-title">Interface</p>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Compact sidebar</span><span class="toggle-desc">Reduce sidebar icon spacing</span></div>
                <button role="switch" aria-checked={$settings.compactSidebar} aria-label="Compact sidebar" class="toggle" class:on={$settings.compactSidebar} on:click={() => updateSettings({ compactSidebar: !$settings.compactSidebar })}><span class="toggle-thumb"></span></button>
              </label>
            </div>

            <div class="section">
              <p class="section-title">Session Cache</p>
              <div class="step-row">
                <div class="toggle-info">
                  <span class="toggle-label">Cache entries</span>
                  <span class="toggle-desc">In-memory request cache for this session (library, sources, genre pages). Cleared on restart.</span>
                </div>
                <div class="perf-stat-group">
                  <span class="perf-stat">{perfSnapshot?.cacheEntries ?? 0} entries</span>
                  <button class="kb-reset" on:click={refreshPerfMetrics} title="Refresh">↺</button>
                </div>
              </div>
              {#if perfSnapshot && perfSnapshot.cacheEntries > 0}
                <div class="step-row">
                  <div class="toggle-info"><span class="toggle-label">Oldest entry</span></div>
                  <span class="perf-stat">{fmtAge(perfSnapshot.oldestEntryMs)}</span>
                </div>
                <div class="step-row">
                  <div class="toggle-info"><span class="toggle-label">Newest entry</span></div>
                  <span class="perf-stat">{fmtAge(perfSnapshot.newestEntryMs)}</span>
                </div>
                <div class="step-row">
                  <div class="toggle-info">
                    <span class="toggle-label">Cached keys</span>
                    <span class="toggle-desc">{perfSnapshot.cacheKeys.join(", ")}</span>
                  </div>
                </div>
              {/if}
            </div>

          </div>

        
        {:else if tab === "keybinds"}
          <div class="panel">
            <div class="section">
              <div class="kb-header">
                <p class="section-title">Keyboard shortcuts</p>
                <button class="reset-all-btn" on:click={resetKeybinds}>Reset all</button>
              </div>
              <p class="kb-hint">Click a key to rebind, then press the new combination.</p>
              <div class="kb-list">
                {#each Object.keys(KEYBIND_LABELS) as key}
                  {@const k = key as keyof Keybinds}
                  {@const isListening = listeningKey === k}
                  {@const isDefault   = $settings.keybinds[k] === DEFAULT_KEYBINDS[k]}
                  <div class="kb-row">
                    <span class="kb-label">{KEYBIND_LABELS[k]}</span>
                    <div class="kb-right">
                      <button class="kb-bind" class:listening={isListening} on:click={() => startListen(k)}>
                        {isListening ? "Press key…" : $settings.keybinds[k]}
                      </button>
                      <button class="kb-reset" on:click={() => updateSettings({ keybinds: { ...$settings.keybinds, [k]: DEFAULT_KEYBINDS[k] } })} disabled={isDefault} title="Reset">↺</button>
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          </div>

        
        {:else if tab === "storage"}
          <div class="panel">
            <div class="section">
              <p class="section-title">Disk Usage</p>
              {#if storageLoading}<p class="storage-loading">Reading filesystem…</p>
              {:else if storageError}<p class="storage-loading" style="color:var(--color-error)">{storageError}</p>
              {:else if storageInfo}
                {@const mangaBytes = storageInfo.manga_bytes}
                {@const totalBytes = storageInfo.total_bytes}
                {@const freeBytes  = storageInfo.free_bytes}
                {@const limitGb    = $settings.storageLimitGb ?? null}
                {@const limitBytes = limitGb !== null ? limitGb * 1024 ** 3 : null}
                {@const available  = mangaBytes + freeBytes}
                {@const cap        = limitBytes !== null ? Math.min(limitBytes, available) : available}
                {@const pctUsed    = cap > 0 ? Math.min(100, (mangaBytes / cap) * 100) : 0}
                <div class="storage-bar-wrap">
                  <div class="storage-bar">
                    <div class="storage-bar-fill" class:critical={pctUsed > 90} class:warn={pctUsed > 75 && pctUsed <= 90} style="width:{pctUsed}%"></div>
                  </div>
                  <div class="storage-bar-labels">
                    <span class="storage-bar-used">{fmtBytes(mangaBytes)} used</span>
                    <span class="storage-bar-free">{fmtBytes(Math.max(0, cap - mangaBytes))} free</span>
                  </div>
                </div>
                <div class="storage-legend">
                  <div class="storage-legend-row"><span class="storage-dot storage-dot-manga"></span><span class="storage-legend-label">Downloaded manga</span><span class="storage-legend-val">{fmtBytes(mangaBytes)}</span></div>
                  <div class="storage-legend-row"><span class="storage-dot storage-dot-free"></span><span class="storage-legend-label">Drive free</span><span class="storage-legend-val">{fmtBytes(freeBytes)}</span></div>
                  <div class="storage-legend-row"><span class="storage-dot storage-dot-app"></span><span class="storage-legend-label">Drive total</span><span class="storage-legend-val">{fmtBytes(totalBytes)}</span></div>
                </div>
                <p class="storage-path-note">{storageInfo.path}</p>
              {/if}
            </div>
            <div class="section">
              <p class="section-title">Cache</p>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Image cache</span><span class="toggle-desc">Cached page images stored by the webview</span></div>
                <button class="danger-btn" on:click={handleClearCache} disabled={clearing}>
                  {cleared ? "Cleared" : clearing ? "Clearing…" : "Clear cache"}
                </button>
              </div>
            </div>
            <div class="section">
              <p class="section-title">Storage Limit</p>
              <div class="step-row">
                <div class="toggle-info">
                  <span class="toggle-label">Limit download storage</span>
                  <span class="toggle-desc">
                    {$settings.storageLimitGb === null
                      ? "No limit — uses full drive capacity"
                      : `Warn when downloads exceed ${$settings.storageLimitGb} GB`}
                  </span>
                </div>
                {#if $settings.storageLimitGb === null}
                  <button class="step-btn" style="width:auto;padding:0 var(--sp-3);font-size:var(--text-xs);letter-spacing:var(--tracking-wide)"
                    on:click={() => updateSettings({ storageLimitGb: 10 })}>
                    Set limit
                  </button>
                {:else}
                  <div class="step-controls">
                    <button class="step-btn"
                      on:click={() => updateSettings({ storageLimitGb: Math.max(1, ($settings.storageLimitGb ?? 10) - 1) })}
                      disabled={($settings.storageLimitGb ?? 10) <= 1}>−</button>
                    <input
                      type="number" min="1" step="1"
                      class="storage-limit-input"
                      value={$settings.storageLimitGb}
                      on:input={(e) => {
                        const n = parseFloat(e.currentTarget.value);
                        if (!isNaN(n) && n > 0) updateSettings({ storageLimitGb: n });
                      }}
                    />
                    <span class="storage-limit-unit">GB</span>
                    <button class="step-btn"
                      on:click={() => updateSettings({ storageLimitGb: ($settings.storageLimitGb ?? 10) + 1 })}>+</button>
                    <button class="kb-reset" title="Remove limit"
                      on:click={() => updateSettings({ storageLimitGb: null })}>↺</button>
                  </div>
                {/if}
              </div>
            </div>
          </div>

        
        {:else if tab === "folders"}
          <div class="panel">
            <div class="section">
              <p class="section-title">Manage Folders</p>
              <p class="toggle-desc" style="padding:0 var(--sp-3) var(--sp-3);display:block">Assign manga to folders from the series detail page.</p>
              <div class="folder-create-row">
                <input class="text-input" placeholder="New folder name…" bind:value={newFolderName}
                  on:keydown={(e) => e.key === "Enter" && createFolder()} style="flex:1;width:auto" />
                <button class="folder-create-btn" on:click={createFolder} disabled={!newFolderName.trim()}>
                  <Plus size={13} weight="bold" /> Create
                </button>
              </div>
              {#if $settings.folders.length === 0}
                <p class="storage-loading">No folders yet. Create one above.</p>
              {:else}
                <div class="folder-list">
                  {#each $settings.folders as folder}
                    <div class="folder-row">
                      {#if editingId === folder.id}
                        <input class="text-input" bind:value={editingName}
                          on:keydown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") editingId = null; }}
                          on:blur={commitEdit} style="flex:1;width:auto" use:focusInput />
                        <button class="kb-reset" on:click={commitEdit} title="Save">✓</button>
                      {:else}
                        <FolderSimple size={14} weight="light" style="color:var(--text-faint);flex-shrink:0" />
                        <span class="folder-row-name">{folder.name}</span>
                        <span class="folder-row-count">{folder.mangaIds.length} manga</span>
                        <button class="folder-tab-toggle" class:on={folder.showTab} on:click={() => toggleFolderTab(folder.id)}>
                          {folder.showTab ? "Tab on" : "Tab off"}
                        </button>
                        <button class="kb-reset" on:click={() => startEdit(folder.id, folder.name)} title="Rename"><Pencil size={12} weight="light" /></button>
                        <button class="kb-reset folder-delete" on:click={() => removeFolder(folder.id)} title="Delete"><Trash size={12} weight="light" /></button>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          </div>

        
        {:else if tab === "about"}
          <div class="panel">
            <div class="section">
              <p class="section-title">Moku</p>
              <div class="about-block">
                <p class="about-line">A manga reader frontend for Suwayomi / Tachidesk.</p>
                <p class="about-line" style="color:var(--text-faint);margin-top:var(--sp-2)">Built with Tauri + Svelte. Connects to tachidesk-server.</p>
              </div>
            </div>
          </div>

        
        {:else if tab === "devtools"}
          <div class="panel">
            <div class="section">
              <p class="section-title">Splash Screen</p>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Preview idle screen</span><span class="toggle-desc">Show the idle splash — dismiss with any click or key</span></div>
                <button class="danger-btn" on:click={triggerSplash}
                  style={splashTriggered ? "background:var(--accent-fg);color:var(--bg-base);border-color:var(--accent-fg);transition:all 0.15s ease" : ""}>
                  Show idle
                </button>
              </div>
            </div>
            <div class="section">
              <p class="section-title">Build Info</p>
              <div class="about-block">
                <p class="about-line" style="font-family:monospace;font-size:11px;color:var(--text-faint)">Mode: {import.meta.env.MODE}</p>
              </div>
            </div>
          </div>
        {/if}

      </div>
    </div>
  </div>
</div>

<script context="module">
  function focusInput(node: HTMLElement) { node.focus(); }
</script>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: var(--z-settings); display: flex; align-items: center; justify-content: center; animation: fadeIn 0.1s ease both; backdrop-filter: blur(4px); }
  .modal { width: min(720px, calc(100vw - 48px)); height: min(600px, calc(100vh - 80px)); display: flex; background: var(--bg-surface); border: 1px solid var(--border-base); border-radius: var(--radius-xl); overflow: hidden; animation: scaleIn 0.15s ease both; box-shadow: 0 24px 64px rgba(0,0,0,0.6); }
  .sidebar { width: 168px; flex-shrink: 0; background: var(--bg-base); border-right: 1px solid var(--border-dim); padding: var(--sp-5) var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-1); overflow-y: auto; }
  .modal-title { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; padding: 0 var(--sp-2) var(--sp-3); }
  .nav { display: flex; flex-direction: column; gap: 1px; }
  .nav-item { display: flex; align-items: center; gap: var(--sp-2); padding: 6px var(--sp-2); border-radius: var(--radius-md); font-size: var(--text-sm); color: var(--text-muted); background: none; border: none; cursor: pointer; text-align: left; transition: background var(--t-fast), color var(--t-fast); }
  .nav-item:hover { background: var(--bg-raised); color: var(--text-secondary); }
  .nav-item.active { background: var(--accent-muted); color: var(--accent-fg); }
  .content { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
  .content-header { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-5) var(--sp-6) var(--sp-4); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; }
  .content-title { font-size: var(--text-base); font-weight: var(--weight-medium); color: var(--text-secondary); }
  .close-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--radius-sm); color: var(--text-faint); background: none; border: none; cursor: pointer; transition: color var(--t-base), background var(--t-base); }
  .close-btn:hover { color: var(--text-muted); background: var(--bg-raised); }
  .content-body { flex: 1; overflow-y: auto; }

  .panel { display: flex; flex-direction: column; gap: var(--sp-1); padding: var(--sp-4) var(--sp-6); }
  .section { display: flex; flex-direction: column; gap: 1px; border-bottom: 1px solid var(--border-dim); padding-bottom: var(--sp-4); margin-bottom: var(--sp-2); }
  .section:last-child { border-bottom: none; }
  .section-title { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; padding: var(--sp-3) var(--sp-3) var(--sp-2); }

  .toggle-row { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-3); border-radius: var(--radius-md); cursor: default; transition: background var(--t-fast); }
  .toggle-row:hover { background: var(--bg-raised); }
  .toggle-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; margin-right: var(--sp-4); }
  .toggle-label { font-size: var(--text-sm); color: var(--text-secondary); }
  .toggle-desc { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); line-height: var(--leading-snug); }
  .toggle { position: relative; width: 32px; height: 18px; border-radius: var(--radius-full); border: none; background: var(--bg-overlay); cursor: pointer; flex-shrink: 0; transition: background var(--t-base); border: 1px solid var(--border-strong); }
  .toggle.on { background: var(--accent); border-color: var(--accent); }
  .toggle-thumb { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--text-faint); transition: transform var(--t-base), background var(--t-base); }
  .toggle.on .toggle-thumb { transform: translateX(14px); background: var(--bg-void); }

  .step-row { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-3); border-radius: var(--radius-md); transition: background var(--t-fast); gap: var(--sp-3); }
  .step-row:hover { background: var(--bg-raised); }
  .step-controls { display: flex; align-items: center; gap: var(--sp-1); flex-shrink: 0; }
  .step-btn { font-family: var(--font-ui); font-size: var(--text-sm); width: 26px; height: 26px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: none; color: var(--text-muted); cursor: pointer; transition: color var(--t-base), border-color var(--t-base); display: flex; align-items: center; justify-content: center; }
  .step-btn:hover:not(:disabled) { color: var(--text-secondary); border-color: var(--border-strong); }
  .step-btn:disabled { opacity: 0.3; cursor: default; }
  .step-val { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-secondary); letter-spacing: var(--tracking-wide); min-width: 40px; text-align: center; }

  .select-wrap { position: relative; flex-shrink: 0; }
  .select-btn { display: flex; align-items: center; gap: var(--sp-2); font-size: var(--text-sm); color: var(--text-secondary); background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-md); padding: 5px 10px; cursor: pointer; min-width: 130px; transition: border-color var(--t-base); }
  .select-btn:hover { border-color: var(--border-strong); }
  .select-caret { color: var(--text-faint); transition: transform var(--t-base); flex-shrink: 0; margin-left: auto; }
  .select-caret.open { transform: rotate(180deg); }
  .select-menu { position: absolute; top: calc(100% + 4px); right: 0; min-width: 100%; background: var(--bg-raised); border: 1px solid var(--border-base); border-radius: var(--radius-md); padding: var(--sp-1); z-index: 200; box-shadow: 0 8px 24px rgba(0,0,0,0.4); animation: scaleIn 0.1s ease both; transform-origin: top right; }
  .select-option { display: block; width: 100%; padding: 6px var(--sp-3); border-radius: var(--radius-sm); font-size: var(--text-sm); color: var(--text-secondary); background: none; border: none; cursor: pointer; text-align: left; transition: background var(--t-fast), color var(--t-fast); }
  .select-option:hover { background: var(--bg-overlay); color: var(--text-primary); }
  .select-option.active { color: var(--accent-fg); background: var(--accent-muted); }

  .text-input { background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-md); padding: 5px 10px; color: var(--text-primary); font-size: var(--text-sm); outline: none; width: 200px; transition: border-color var(--t-base); flex-shrink: 0; }
  .text-input:focus { border-color: var(--border-strong); }

  .danger-btn { font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 5px 12px; border-radius: var(--radius-md); border: 1px solid var(--color-error); background: none; color: var(--color-error); cursor: pointer; flex-shrink: 0; transition: background var(--t-base); }
  .danger-btn:hover:not(:disabled) { background: var(--color-error-bg); }
  .danger-btn:disabled { opacity: 0.3; cursor: default; }

  .scale-row { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--sp-3); }
  .scale-slider { flex: 1; }
  .scale-val { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-secondary); min-width: 40px; text-align: center; }
  .scale-hint { padding: 0 var(--sp-3) var(--sp-2); display: flex; gap: var(--sp-1); flex-wrap: wrap; }
  .scale-preset { font-family: var(--font-ui); font-size: var(--text-2xs); padding: 2px 7px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: none; color: var(--text-faint); cursor: pointer; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); }
  .scale-preset:hover { color: var(--text-muted); border-color: var(--border-strong); }
  .scale-preset.active { background: var(--accent-muted); border-color: var(--accent-dim); color: var(--accent-fg); }

  /* Theme */
  .theme-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: var(--sp-3); padding: var(--sp-2) var(--sp-3); }
  .theme-card { background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-lg); overflow: hidden; cursor: pointer; text-align: left; transition: border-color var(--t-base), box-shadow var(--t-base); position: relative; }
  .theme-card:hover { border-color: var(--border-strong); }
  .theme-card.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .theme-preview { height: 70px; overflow: hidden; }
  .theme-preview-bg { width: 100%; height: 100%; display: flex; }
  .theme-preview-sidebar { width: 20%; height: 100%; flex-shrink: 0; }
  .theme-preview-content { flex: 1; padding: 8px 6px; display: flex; flex-direction: column; gap: 5px; }
  .theme-preview-accent { height: 6px; width: 50%; border-radius: 3px; }
  .theme-preview-text { height: 4px; width: 100%; border-radius: 2px; }
  .theme-card-info { padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; }
  .theme-card-label { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-secondary); }
  .theme-card-desc { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .theme-card-check { position: absolute; top: 6px; right: 6px; font-size: 10px; color: var(--accent-fg); background: var(--accent-muted); border: 1px solid var(--accent-dim); border-radius: var(--radius-sm); padding: 1px 4px; }

  /* Keybinds */
  .kb-header { display: flex; align-items: center; justify-content: space-between; padding: 0 var(--sp-3) var(--sp-2); }
  .reset-all-btn { font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 4px 10px; border-radius: var(--radius-md); border: 1px solid var(--border-dim); background: none; color: var(--text-muted); cursor: pointer; transition: color var(--t-base), border-color var(--t-base); }
  .reset-all-btn:hover { color: var(--text-secondary); border-color: var(--border-strong); }
  .kb-hint { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); padding: 0 var(--sp-3) var(--sp-3); }
  .kb-list { display: flex; flex-direction: column; gap: 1px; }
  .kb-row { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-md); transition: background var(--t-fast); }
  .kb-row:hover { background: var(--bg-raised); }
  .kb-label { font-size: var(--text-sm); color: var(--text-secondary); flex: 1; }
  .kb-right { display: flex; align-items: center; gap: var(--sp-2); }
  .kb-bind { font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 4px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: var(--bg-raised); color: var(--text-secondary); cursor: pointer; min-width: 90px; text-align: center; transition: border-color var(--t-base), color var(--t-base); }
  .kb-bind:hover { border-color: var(--border-strong); }
  .kb-bind.listening { border-color: var(--accent); color: var(--accent-fg); background: var(--accent-muted); animation: pulse 1s ease infinite; }
  @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.6 } }
  .kb-reset { font-size: var(--text-sm); color: var(--text-faint); padding: 3px 6px; border-radius: var(--radius-sm); border: 1px solid transparent; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); }
  .kb-reset:hover:not(:disabled) { color: var(--text-muted); border-color: var(--border-dim); background: var(--bg-overlay); }
  .kb-reset:disabled { opacity: 0.3; cursor: default; }

  /* Storage */
  .storage-loading { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); padding: var(--sp-3); }
  .storage-bar-wrap { padding: var(--sp-2) var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-2); }
  .storage-bar { height: 6px; background: var(--bg-overlay); border-radius: var(--radius-full); overflow: hidden; }
  .storage-bar-fill { height: 100%; background: var(--accent); border-radius: var(--radius-full); transition: width 0.4s ease; }
  .storage-bar-fill.warn { background: #d97706; }
  .storage-bar-fill.critical { background: var(--color-error); }
  .storage-bar-labels { display: flex; justify-content: space-between; }
  .storage-bar-used, .storage-bar-free { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .storage-legend { display: flex; flex-direction: column; gap: var(--sp-1); padding: 0 var(--sp-3); }
  .storage-legend-row { display: flex; align-items: center; gap: var(--sp-2); }
  .storage-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .storage-dot-manga { background: var(--accent); }
  .storage-dot-free  { background: var(--bg-overlay); border: 1px solid var(--border-strong); }
  .storage-dot-app   { background: var(--text-faint); }
  .storage-legend-label { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-muted); flex: 1; }
  .storage-legend-val   { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-secondary); }
  .storage-path-note { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); padding: var(--sp-2) var(--sp-3) 0; word-break: break-all; }

  /* Folders */
  .folder-create-row { display: flex; gap: var(--sp-2); padding: 0 var(--sp-3) var(--sp-3); }
  .folder-create-btn { display: flex; align-items: center; gap: var(--sp-1); font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 5px 12px; border-radius: var(--radius-md); background: var(--accent-muted); color: var(--accent-fg); border: 1px solid var(--accent-dim); cursor: pointer; flex-shrink: 0; transition: filter var(--t-base); }
  .folder-create-btn:hover:not(:disabled) { filter: brightness(1.1); }
  .folder-create-btn:disabled { opacity: 0.4; cursor: default; }
  .folder-list { display: flex; flex-direction: column; gap: 1px; padding: 0 var(--sp-3); }
  .folder-row { display: flex; align-items: center; gap: var(--sp-2); padding: 8px var(--sp-2); border-radius: var(--radius-md); transition: background var(--t-fast); }
  .folder-row:hover { background: var(--bg-raised); }
  .folder-row-name { flex: 1; font-size: var(--text-sm); color: var(--text-secondary); }
  .folder-row-count { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); flex-shrink: 0; }
  .folder-tab-toggle { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); padding: 2px 7px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: none; color: var(--text-faint); cursor: pointer; flex-shrink: 0; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); }
  .folder-tab-toggle.on { background: var(--accent-muted); border-color: var(--accent-dim); color: var(--accent-fg); }
  .folder-tab-toggle:hover { color: var(--text-muted); border-color: var(--border-strong); }
  .folder-delete:hover:not(:disabled) { color: var(--color-error) !important; }

  /* About */
  .about-block { padding: 0 var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-1); }
  .about-line { font-size: var(--text-sm); color: var(--text-muted); line-height: var(--leading-base); }

  /* Perf metrics */
  .perf-stat-group { display: flex; align-items: center; gap: var(--sp-2); flex-shrink: 0; }
  .perf-stat { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-secondary); letter-spacing: var(--tracking-wide); flex-shrink: 0; }

  /* Storage limit */
  .storage-limit-row { display: flex; align-items: center; gap: var(--sp-2); flex-shrink: 0; }
  .storage-limit-input {
    width: 64px; text-align: center;
    background: var(--bg-raised); border: 1px solid var(--border-dim);
    border-radius: var(--radius-sm); padding: 3px 6px;
    color: var(--text-secondary); font-family: var(--font-ui); font-size: var(--text-xs);
    outline: none; transition: border-color var(--t-base);
    -moz-appearance: textfield;
  }
  .storage-limit-input::-webkit-inner-spin-button,
  .storage-limit-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .storage-limit-input:focus { border-color: var(--border-strong); }
  .storage-limit-unit { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); flex-shrink: 0; }
  .storage-limit-note { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--accent-fg); letter-spacing: var(--tracking-wide); padding: 0 var(--sp-3) var(--sp-2); }
</style>
