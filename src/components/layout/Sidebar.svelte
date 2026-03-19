<script lang="ts">
  import { navPage, activeManga, activeSource, libraryFilter, genreFilter, settingsOpen } from "../../store";
  import type { NavPage } from "../../store";

  const TABS: { id: NavPage; label: string; path: string }[] = [
    { id: "library",    label: "Library",    path: "M12 2H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h8M12 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-8M12 2v20" },
    { id: "search",     label: "Search",     path: "M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" },
    { id: "history",    label: "History",    path: "M12 8v4l3 3M3.05 11a9 9 0 1 0 .5-3" },
    { id: "explore",    label: "Explore",    path: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 0v20M2 12h20" },
    { id: "downloads",  label: "Downloads",  path: "M12 3v13M7 11l5 5 5-5M5 21h14" },
    { id: "extensions", label: "Extensions", path: "M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z" },
  ];

  function navigate(id: NavPage) {
    navPage.set(id);
    activeManga.set(null);
    genreFilter.set("");
    if (id !== "explore") activeSource.set(null);
  }

  function goHome() {
    navPage.set("library");
    activeSource.set(null);
    activeManga.set(null);
    libraryFilter.set("library");
  }
</script>

<aside class="root">
  <button class="logo" on:click={goHome} title="Go to Library" aria-label="Go to Library">
    <div class="logo-icon" />
  </button>
  <nav class="nav">
    {#each TABS as tab}
      <button class="tab" class:active={$navPage === tab.id}
        title={tab.label} on:click={() => navigate(tab.id)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d={tab.path} />
        </svg>
      </button>
    {/each}
  </nav>
  <div class="bottom">
    <button class="settings-btn" on:click={() => settingsOpen.set(true)} title="Settings">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>
  </div>
</aside>

<style>
  .root {
    width: var(--sidebar-width);
    flex-shrink: 0;
    background: var(--bg-void);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--sp-4) 0;
  }
  .logo {
    width: 80px; height: 80px;
    display: flex; align-items: center; justify-content: center;
    margin-bottom: var(--sp-3);
    background: none; border: none; outline: none;
    cursor: pointer; border-radius: var(--radius-lg);
    transition: opacity var(--t-base), transform var(--t-base);
    padding: 0; appearance: none; -webkit-appearance: none;
  }
  .logo:hover { opacity: 0.8; transform: scale(0.96); }
  .logo:active { transform: scale(0.92); }
  .logo:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .logo-icon {
    width: 80px; height: 80px;
    background-color: var(--accent);
    mask-image: url("../../assets/moku-icon.svg");
    mask-repeat: no-repeat; mask-position: center; mask-size: contain;
    -webkit-mask-image: url("../../assets/moku-icon.svg");
    -webkit-mask-repeat: no-repeat; -webkit-mask-position: center; -webkit-mask-size: contain;
    filter: drop-shadow(0 0 8px rgba(107,143,107,0.35));
    pointer-events: none;
  }
  .nav {
    flex: 1;
    display: flex; flex-direction: column; align-items: center;
    gap: var(--sp-1); width: 100%; padding: 0 var(--sp-2);
  }
  .tab {
    width: 36px; height: 36px;
    display: flex; align-items: center; justify-content: center;
    border-radius: var(--radius-md);
    color: var(--text-faint);
    background: none; border: none; outline: none;
    cursor: pointer; padding: 0; appearance: none; -webkit-appearance: none;
    transition: color var(--t-base), background var(--t-base);
  }
  .tab:hover { color: var(--text-muted); background: var(--bg-raised); }
  .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .tab.active { color: var(--accent-fg); background: var(--accent-muted); }
  .tab.active:hover { color: var(--accent-fg); background: var(--accent-muted); }
  .bottom {
    display: flex; flex-direction: column; align-items: center;
    width: 100%; padding: var(--sp-3) var(--sp-2) 0;
    border-top: 1px solid var(--border-dim);
    margin-top: var(--sp-3);
  }
  .settings-btn {
    width: 36px; height: 36px;
    display: flex; align-items: center; justify-content: center;
    border-radius: var(--radius-md);
    color: var(--text-faint);
    background: none; border: none; outline: none;
    cursor: pointer; padding: 0; appearance: none; -webkit-appearance: none;
    transition: color var(--t-base), background var(--t-base), transform var(--t-slow);
  }
  .settings-btn:hover { color: var(--text-muted); background: var(--bg-raised); transform: rotate(30deg); }
  .settings-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
</style>
