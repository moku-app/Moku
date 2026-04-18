<script lang="ts">
  import { store } from "../../store/state.svelte";
  import Sidebar        from "./Sidebar.svelte";
  import Home           from "../pages/Home.svelte";
  import Library        from "../pages/Library.svelte";
  import SeriesDetail   from "../series/SeriesDetail.svelte";
  import RecentActivity from "./RecentActivity.svelte";
  import Search         from "../pages/Search.svelte";
  import Downloads      from "../pages/Downloads.svelte";
  import Extensions     from "../pages/Extensions.svelte";
  import Tracking       from "../pages/Tracking.svelte";
</script>

<div class="frame">
  <div class="shell">
    <Sidebar />
    <main class="main">
      {#if store.activeManga}
        <SeriesDetail />
      {:else if store.navPage === "home"}
        <Home />
      {:else if store.navPage === "library"}
        <Library />
      {:else if store.navPage === "search"}
        <Search />
      {:else if store.navPage === "history"}
        <RecentActivity />
      {:else if store.navPage === "downloads"}
        <Downloads />
      {:else if store.navPage === "extensions"}
        <Extensions />
      {:else if store.navPage === "tracking"}
        <Tracking />
      {:else}
        <Home />
      {/if}
    </main>
  </div>
</div>

<style>
  :global(*, *::before, *::after) { scrollbar-width: none; }
  :global(*::-webkit-scrollbar) { display: none; }

  .frame { display: flex; padding: 0 10px 10px; width: 100%; height: 100%; box-sizing: border-box; overflow: hidden; }
  .shell { display: flex; flex: 1; border-radius: 14px; overflow: hidden; border: 1px solid var(--border-dim); background: var(--bg-base); min-height: 0; min-width: 0; }
  .main { flex: 1; overflow: hidden; background: var(--bg-surface); transform: translateZ(0); contain: layout style; min-width: 0; }
</style>
