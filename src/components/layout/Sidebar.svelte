<script lang="ts">
  import { House, Books, MagnifyingGlass, ClockCounterClockwise, Compass, DownloadSimple, PuzzlePiece, GearSix } from "phosphor-svelte";
  import { store, setNavPage, setActiveManga, setActiveSource, setLibraryFilter, setGenreFilter, setSettingsOpen } from "../../store/state.svelte";
  import type { NavPage } from "../../store/state.svelte";

  const TABS: { id: NavPage; label: string; icon: any }[] = [
    { id: "home",       label: "Home",       icon: House },
    { id: "library",    label: "Library",    icon: Books },
    { id: "search",     label: "Search",     icon: MagnifyingGlass },
    { id: "history",    label: "History",    icon: ClockCounterClockwise },
    { id: "explore",    label: "Discover",   icon: Compass },
    { id: "downloads",  label: "Downloads",  icon: DownloadSimple },
    { id: "extensions", label: "Extensions", icon: PuzzlePiece },
  ];

  function navigate(id: NavPage) {
    store.navPage     = id;
    store.activeManga = null;
    store.genreFilter = "";
    if (id !== "explore") store.activeSource = null;
  }

  function goHome() {
    store.navPage       = "home";
    store.activeSource  = null;
    store.activeManga   = null;
    store.libraryFilter = "library";
    store.genreFilter   = "";
  }
</script>

<aside class="root">
  <button class="logo" onclick={goHome} title="Home" aria-label="Go to Home">
    <div class="logo-icon"></div>
  </button>
  <nav class="nav">
    {#each TABS as tab}
      <button class="tab" class:active={store.navPage === tab.id}
        title={tab.label} onclick={() => navigate(tab.id)}>
        <tab.icon size={18} weight="light" />
      </button>
    {/each}
  </nav>
  <div class="bottom">
    <button class="settings-btn" onclick={() => store.settingsOpen = true} title="Settings">
      <GearSix size={18} weight="light" />
    </button>
  </div>
</aside>

<style>
  .root { width: var(--sidebar-width); flex-shrink: 0; background: var(--bg-void); display: flex; flex-direction: column; align-items: center; padding: var(--sp-4) 0; }
  .logo { width: 80px; height: 80px; display: flex; align-items: center; justify-content: center; margin-bottom: var(--sp-3); background: none; border: none; outline: none; cursor: pointer; border-radius: var(--radius-lg); transition: opacity var(--t-base), transform var(--t-base); padding: 0; appearance: none; -webkit-appearance: none; }
  .logo:hover { opacity: 0.8; transform: scale(0.96); }
  .logo:active { transform: scale(0.92); }
  .logo:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .logo-icon { width: 80px; height: 80px; background-color: var(--accent); mask-image: url("../../assets/moku-icon.svg"); mask-repeat: no-repeat; mask-position: center; mask-size: contain; -webkit-mask-image: url("../../assets/moku-icon.svg"); -webkit-mask-repeat: no-repeat; -webkit-mask-position: center; -webkit-mask-size: contain; filter: drop-shadow(0 0 8px rgba(107,143,107,0.35)); pointer-events: none; }
  .nav { flex: 1; display: flex; flex-direction: column; align-items: center; gap: var(--sp-1); width: 100%; padding: 0 var(--sp-2); }
  .tab { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-md); color: var(--text-faint); background: none; border: none; outline: none; cursor: pointer; padding: 0; appearance: none; -webkit-appearance: none; transition: color var(--t-base), background var(--t-base); }
  .tab:hover { color: var(--text-muted); background: var(--bg-raised); }
  .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .tab.active { color: var(--accent-fg); background: var(--accent-muted); }
  .tab.active:hover { color: var(--accent-fg); background: var(--accent-muted); }
  .bottom { display: flex; flex-direction: column; align-items: center; width: 100%; padding: var(--sp-3) var(--sp-2) 0; border-top: 1px solid var(--border-dim); margin-top: var(--sp-3); }
  .settings-btn { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-md); color: var(--text-faint); background: none; border: none; outline: none; cursor: pointer; padding: 0; appearance: none; -webkit-appearance: none; transition: color var(--t-base), background var(--t-base), transform var(--t-slow); }
  .settings-btn:hover { color: var(--text-muted); background: var(--bg-raised); transform: rotate(30deg); }
  .settings-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
</style>
