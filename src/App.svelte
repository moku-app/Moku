<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { gql } from "./lib/client";
  import { GET_DOWNLOAD_STATUS } from "./lib/queries";
  import { store, addToast, setActiveDownloads } from "./store/state.svelte";
  import type { DownloadStatus, DownloadQueueItem } from "./lib/types";
  import Layout       from "./components/layout/Layout.svelte";
  import Reader       from "./components/reader/Reader.svelte";
  import Settings     from "./components/settings/Settings.svelte";
  import TitleBar     from "./components/layout/TitleBar.svelte";
  import Toaster      from "./components/layout/Toaster.svelte";
  import SplashScreen from "./components/layout/SplashScreen.svelte";
  import MangaPreview from "./components/shared/MangaPreview.svelte";

  const MAX_ATTEMPTS = 30;

  let serverProbeOk   = $state(!store.settings.autoStartServer);
  let appReady        = $state(!store.settings.autoStartServer);
  let failed          = $state(false);
  let notConfigured   = $state(false);
  let idle            = $state(false);
  let devSplash       = $state(false);

  let prevQueue: DownloadQueueItem[] = [];
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let pollInterval: ReturnType<typeof setInterval>;
  let unlistenDownload: (() => void) | undefined;

  function detectCompletions(prev: DownloadQueueItem[], next: DownloadQueueItem[]) {
    for (const item of prev) {
      if (item.state !== "DOWNLOADING") continue;
      if (!next.some(q => q.chapter.id === item.chapter.id)) {
        const manga = item.chapter.manga;
        addToast({ kind: "success", title: "Chapter downloaded",
          body: manga ? `${manga.title} — ${item.chapter.name}` : item.chapter.name,
          duration: 4000 });
      }
    }
  }

  function applyQueue(next: DownloadQueueItem[]) {
    detectCompletions(prevQueue, next);
    prevQueue = next;
    setActiveDownloads(next.map(item => ({
      chapterId: item.chapter.id, mangaId: item.chapter.mangaId, progress: item.progress,
    })));
  }

  function resetIdle() {
    if (idle) return;
    if (idleTimer) clearTimeout(idleTimer);
    const ms = (store.settings.idleTimeoutMin ?? 5) * 60 * 1000;
    if (ms === 0) return;
    idleTimer = setTimeout(() => idle = true, ms);
  }

  const idleEvents = ["mousemove", "mousedown", "keydown", "touchstart", "wheel"] as const;

  $effect(() => {
    if (!appReady) return;
    idleEvents.forEach(e => window.addEventListener(e, resetIdle, { passive: true }));
    resetIdle();
    return () => idleEvents.forEach(e => window.removeEventListener(e, resetIdle));
  });

  $effect(() => {
    const scale = store.settings.uiScale * 1.5;
    document.documentElement.style.zoom = `${scale}%`;
    document.documentElement.style.setProperty("--ui-scale", String(scale));
    document.documentElement.style.setProperty("--visual-vh", `${window.innerHeight / (scale / 100)}px`);
  });

  $effect(() => {
    document.documentElement.setAttribute("data-theme", store.settings.theme ?? "dark");
  });

  $effect(() => {
    if (!appReady) return;
    const poll = () => gql<{ downloadStatus: DownloadStatus }>(GET_DOWNLOAD_STATUS)
      .then(d => applyQueue(d.downloadStatus.queue)).catch(console.error);
    poll();
    pollInterval = setInterval(poll, 2000);
    return () => clearInterval(pollInterval);
  });

  // Probe the server in a loop until it responds or we hit MAX_ATTEMPTS.
  // Returns a cleanup function that cancels any pending probe.
  function startProbe(): () => void {
    let cancelled = false, tries = 0;

    async function probe() {
      if (cancelled) return;
      tries++;
      try {
        const res = await fetch(`${store.settings.serverUrl}/api/graphql`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: "{ __typename }" }),
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok && !cancelled) { serverProbeOk = true; return; }
      } catch {}
      if (tries >= MAX_ATTEMPTS && !cancelled) { failed = true; return; }
      if (!cancelled) setTimeout(probe, 800);
    }

    // Give the server a moment to start binding its port before the first probe.
    setTimeout(probe, 1200);
    return () => { cancelled = true; };
  }

  onMount(async () => {
    document.addEventListener("contextmenu", e => e.preventDefault());
    (window as any).__mokuShowSplash = () => devSplash = true;

    let cancelProbe = () => {};

    if (store.settings.autoStartServer) {
      try {
        await invoke<void>("spawn_server", { binary: store.settings.serverBinary ?? "" });
        // spawn_server succeeded — JRE found and process started. Begin probing.
        cancelProbe = startProbe();
      } catch (err: any) {
        if (err?.kind === "NotConfigured") {
          notConfigured = true;
        } else {
          // SpawnFailed — process couldn't be launched (permissions, bad path, etc.)
          console.error("spawn_server failed:", err);
          failed = true;
        }
      }
    } else {
      // autoStartServer is off — user manages the server themselves, just probe.
      cancelProbe = startProbe();
    }

    type P = { chapterId: number; mangaId: number; progress: number }[];
    unlistenDownload = await listen<P>("download-progress", e => { setActiveDownloads(e.payload); });

    return () => {
      cancelProbe();
      if (store.settings.autoStartServer) invoke("kill_server").catch(() => {});
      if (idleTimer) clearTimeout(idleTimer);
      if (pollInterval) clearInterval(pollInterval);
      unlistenDownload?.();
      delete (window as any).__mokuShowSplash;
    };
  });

  function handleRetry() {
    failed = false;
    notConfigured = false;
    serverProbeOk = false;
    // Re-run the full startup flow by reloading — simplest way to reset all state cleanly.
    window.location.reload();
  }
</script>

{#if devSplash}
  <SplashScreen mode="idle" showFps showCards={store.settings.splashCards ?? true}
    onDismiss={() => setTimeout(() => devSplash = false, 340)} />
{:else if !appReady}
  <SplashScreen mode="loading" ringFull={serverProbeOk} {failed} {notConfigured}
    showCards={store.settings.splashCards ?? true}
    onReady={() => appReady = true}
    onRetry={handleRetry} />
{:else}
  <div class="root">
    {#if idle && !store.activeChapter}
      <SplashScreen mode="idle" showCards={store.settings.splashCards ?? true}
        onDismiss={() => setTimeout(() => idle = false, 340)} />
    {/if}
    {#if !store.activeChapter}<TitleBar />{/if}
    <div class="content">
      {#if store.activeChapter}<Reader />{:else}<Layout />{/if}
    </div>
    {#if store.settingsOpen}<Settings />{/if}
    <MangaPreview />
    <Toaster />
  </div>
{/if}

<style>
  .root { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .content { flex: 1; overflow: hidden; }
</style>
