<script lang="ts">
  import { navPage, activeManga } from "../../store";
  import Sidebar    from "./Sidebar.svelte";
  import Library    from "../pages/Library.svelte";
  import SeriesDetail from "../pages/SeriesDetail.svelte";
  import History    from "../history/History.svelte";
  import Search     from "../search/Search.svelte";
  import Explore    from "../pages/Explore.svelte";
  import Downloads  from "../downloads/Downloads.svelte";
  import Extensions from "../pages/Extensions.svelte";
</script>

<div class="root">
  <Sidebar />
  <main class="main">
    {#if $activeManga}
      <SeriesDetail />
    {:else if $navPage === "library"}
      <Library />
    {:else if $navPage === "search"}
      <Search />
    {:else if $navPage === "history"}
      <History />
    {:else if $navPage === "explore" || $navPage === "sources"}
      <Explore />
    {:else if $navPage === "downloads"}
      <Downloads />
    {:else if $navPage === "extensions"}
      <Extensions />
    {:else}
      <Library />
    {/if}
  </main>
</div>

<style>
  .root { display: flex; height: 100%; background: var(--bg-base); overflow: hidden; }
  .main {
    flex: 1; overflow: hidden;
    background: var(--bg-surface);
    transform: translateZ(0);
    contain: layout style;
  }
</style>
