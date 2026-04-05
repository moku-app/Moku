<script lang="ts">
  import { store } from "../../store/state.svelte";
  import Sidebar        from "./Sidebar.svelte";
  import Home           from "../pages/Home.svelte";
  import Library        from "../pages/Library.svelte";
  import SeriesDetail   from "../series/SeriesDetail.svelte";
  import RecentActivity from "./RecentActivity.svelte";
  import Search         from "../pages/Search.svelte";
  import Discover       from "../pages/Discover.svelte";
  import GenreDrillPage from "../pages/GenreDrillPage.svelte";
  import Downloads      from "../pages/Downloads.svelte";
  import Extensions     from "../pages/Extensions.svelte";
  import Tracking       from "../pages/Tracking.svelte";
</script>

<div class="root">
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
    {:else if (store.navPage === "explore" || store.navPage === "sources") && store.genreFilter}
      <GenreDrillPage />
    {:else if store.navPage === "explore" || store.navPage === "sources"}
      <Discover />
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

<style>
  .root { display: flex; height: 100%; background: var(--bg-base); overflow: hidden; }
  .main { flex: 1; overflow: hidden; background: var(--bg-surface); transform: translateZ(0); contain: layout style; }
</style>
