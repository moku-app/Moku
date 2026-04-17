<script lang="ts">
  import { House, Books, MagnifyingGlass, ClockCounterClockwise, DownloadSimple, PuzzlePiece, GearSix, ChartLineUp } from "phosphor-svelte";
  import { store, setNavPage, setActiveManga, setActiveSource, setLibraryFilter, setGenreFilter, setSettingsOpen } from "../../store/state.svelte";
  import type { NavPage } from "../../store/state.svelte";

  const TABS: { id: NavPage; label: string; icon: any }[] = [
    { id: "home",       label: "Home",       icon: House },
    { id: "library",    label: "Library",    icon: Books },
    { id: "search",     label: "Search",     icon: MagnifyingGlass },
    { id: "history",    label: "History",    icon: ClockCounterClockwise },
    { id: "downloads",  label: "Downloads",  icon: DownloadSimple },
    { id: "extensions", label: "Extensions", icon: PuzzlePiece },
    { id: "tracking",   label: "Tracking",   icon: ChartLineUp },
  ];

  const anims = $derived(store.settings.qolAnimations ?? true);
  const activeIndex = $derived(TABS.findIndex(t => t.id === store.navPage));

  function navigate(id: NavPage) {
    store.navPage      = id;
    store.activeManga  = null;
    store.activeSource = null;
    store.genreFilter  = "";
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
  <button class="logo" class:anims onclick={goHome} title="Home" aria-label="Go to Home">
    <div class="logo-icon"></div>
  </button>
  <nav class="nav">
    {#if activeIndex >= 0}
      <div class="slide-indicator" class:anims style="--idx: {activeIndex}"></div>
    {/if}
    {#each TABS as tab}
      <button class="tab" class:active={store.navPage === tab.id} class:anims
        title={tab.label} onclick={() => navigate(tab.id)}>
        <tab.icon size={18} weight="light" />
      </button>
    {/each}
  </nav>
  <div class="bottom">
    <button class="settings-btn" class:anims onclick={() => store.settingsOpen = true} title="Settings">
      <GearSix size={18} weight="light" />
    </button>
  </div>
</aside>

<style>
  .root { width: var(--sidebar-width); flex-shrink: 0; background: var(--bg-void); display: flex; flex-direction: column; align-items: center; padding: var(--sp-4) 0; overflow: hidden; min-height: 0; height: 100%; }

  /* Logo */
  .logo { width: 80px; height: 80px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; margin-bottom: var(--sp-3); background: none; border: none; outline: none; cursor: pointer; border-radius: var(--radius-lg); padding: 0; appearance: none; -webkit-appearance: none; }
  .logo:hover { opacity: 0.8; }
  .logo:active { }
  .logo:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  /* QOL: logo press + hover scale */
  .logo.anims { transition: opacity var(--t-base), transform var(--t-base); }
  .logo.anims:hover { transform: scale(0.96); }
  .logo.anims:active { transform: scale(0.92); }

  .logo-icon { width: 67px; height: 67px; background-color: var(--accent); mask-image: url("../../assets/moku-icon-wordmark.svg"); mask-repeat: no-repeat; mask-position: center; mask-size: contain; -webkit-mask-image: url("../../assets/moku-icon-wordmark.svg"); -webkit-mask-repeat: no-repeat; -webkit-mask-position: center; -webkit-mask-size: contain; filter: drop-shadow(0 0 8px rgba(107,143,107,0.35)); pointer-events: none; }

  /* Nav */
  .nav { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; gap: var(--sp-1); width: 100%; padding: 0 var(--sp-2); overflow-y: auto; overflow-x: hidden; scrollbar-width: none; }
  .nav::-webkit-scrollbar { display: none; }

  .slide-indicator { position: absolute; width: 36px; height: 36px; border-radius: var(--radius-md); background: var(--accent-muted); pointer-events: none; top: 0; left: 50%; translate: -50% calc(var(--idx) * (36px + var(--sp-1))); z-index: 0; }
  .slide-indicator.anims { transition: translate 0.22s cubic-bezier(0.16,1,0.3,1); }

  /* Tab base — no transitions by default */
  .tab { position: relative; z-index: 1; width: 36px; height: 36px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-md); color: var(--text-faint); background: none; border: none; outline: none; cursor: pointer; padding: 0; appearance: none; -webkit-appearance: none; }
  .tab:hover { color: var(--text-muted); background: var(--bg-raised); }
  .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .tab.active { color: var(--accent-fg); background: transparent; }
  .tab.active:hover { color: var(--accent-fg); background: transparent; }

  /* QOL: smooth color + bg transitions, subtle scale on click */
  .tab.anims { transition: color var(--t-base), background var(--t-base), transform 80ms ease, box-shadow var(--t-base); }
  .tab.anims:hover { transform: translateY(-1px); box-shadow: 0 2px 6px rgba(0,0,0,0.25); }
  .tab.anims:active { transform: scale(0.88); }
  .tab.anims.active { box-shadow: none; }

  /* Bottom / settings */
  .bottom { flex-shrink: 0; display: flex; flex-direction: column; align-items: center; width: 100%; padding: var(--sp-3) var(--sp-2) 0; border-top: 1px solid var(--border-dim); margin-top: var(--sp-3); }

  .settings-btn { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-md); color: var(--text-faint); background: none; border: none; outline: none; cursor: pointer; padding: 0; appearance: none; -webkit-appearance: none; }
  .settings-btn:hover { color: var(--text-muted); background: var(--bg-raised); }
  .settings-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  /* QOL: gear spin on hover */
  .settings-btn.anims { transition: color var(--t-base), background var(--t-base), transform var(--t-slow); }
  .settings-btn.anims:hover { transform: rotate(30deg); }
</style>