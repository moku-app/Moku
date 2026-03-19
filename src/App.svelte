<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { gql } from "./lib/client";
  import { GET_DOWNLOAD_STATUS } from "./lib/queries";
  import {
    activeChapter, settingsOpen, settings,
    activeDownloads, addToast,
  } from "./store";
  import type { DownloadStatus, DownloadQueueItem } from "./lib/types";
  import Layout      from "./components/layout/Layout.svelte";
  import Reader      from "./components/reader/Reader.svelte";
  import Settings    from "./components/settings/Settings.svelte";
  import TitleBar    from "./components/layout/TitleBar.svelte";
  import Toaster     from "./components/layout/Toaster.svelte";
  import SplashScreen from "./components/layout/SplashScreen.svelte";

  const MAX_ATTEMPTS = 30;

  let serverProbeOk = !$settings.autoStartServer;
  let appReady      = !$settings.autoStartServer;
  let failed        = false;
  let retryKey      = 0;
  let idle          = false;
  let devSplash     = false;

  let prevQueue: DownloadQueueItem[] = [];
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

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
    activeDownloads.set(next.map(item => ({
      chapterId: item.chapter.id, mangaId: item.chapter.mangaId, progress: item.progress,
    })));
  }

  function resetIdle() {
    if (idle) return;
    if (idleTimer) clearTimeout(idleTimer);
    const ms = ($settings.idleTimeoutMin ?? 5) * 60 * 1000;
    if (ms === 0) return;
    idleTimer = setTimeout(() => idle = true, ms);
  }

  const idleEvents = ["mousemove","mousedown","keydown","touchstart","wheel"] as const;

  $: if (appReady) {
    idleEvents.forEach(e => window.addEventListener(e, resetIdle, { passive: true }));
    resetIdle();
  }

  $: document.documentElement.style.zoom = `${$settings.uiScale * 1.5}%`;
  $: document.documentElement.setAttribute("data-theme", $settings.theme ?? "dark");

  let pollInterval: ReturnType<typeof setInterval>;
  $: if (appReady) {
    const poll = () => gql<{ downloadStatus: DownloadStatus }>(GET_DOWNLOAD_STATUS)
      .then(d => applyQueue(d.downloadStatus.queue)).catch(console.error);
    poll();
    pollInterval = setInterval(poll, 2000);
  }

  let unlistenDownload: (() => void) | undefined;

  onMount(async () => {
    document.addEventListener("contextmenu", e => e.preventDefault());

    (window as any).__mokuShowSplash = () => devSplash = true;

    if ($settings.autoStartServer) {
      invoke("spawn_server", { binary: $settings.serverBinary }).catch(err =>
        console.warn("Could not start server:", err));
    }

    if (!serverProbeOk) {
      let cancelled = false, tries = 0;
      async function probe() {
        if (cancelled) return;
        tries++;
        try {
          const res = await fetch(`${$settings.serverUrl}/api/graphql`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: "{ __typename }" }),
            signal: AbortSignal.timeout(2000),
          });
          if (res.ok && !cancelled) { serverProbeOk = true; return; }
        } catch {}
        if (tries >= MAX_ATTEMPTS && !cancelled) { failed = true; return; }
        if (!cancelled) setTimeout(probe, 800);
      }
      setTimeout(probe, 800);
    }

    type P = { chapterId: number; mangaId: number; progress: number }[];
    unlistenDownload = await listen<P>("download-progress", e =>
      activeDownloads.set(e.payload));
  });

  onDestroy(() => {
    if ($settings.autoStartServer) invoke("kill_server").catch(() => {});
    idleEvents.forEach(e => window.removeEventListener(e, resetIdle));
    if (idleTimer) clearTimeout(idleTimer);
    if (pollInterval) clearInterval(pollInterval);
    unlistenDownload?.();
    delete (window as any).__mokuShowSplash;
  });

  function handleRetry() {
    failed = false;
    serverProbeOk = false;
    retryKey++;
  }
</script>

{#if devSplash}
  <SplashScreen mode="idle" showFps showCards={$settings.splashCards ?? true}
    onDismiss={() => setTimeout(() => devSplash = false, 340)} />
{:else if !appReady}
  <SplashScreen mode="loading" ringFull={serverProbeOk} {failed}
    showCards={$settings.splashCards ?? true}
    onReady={() => appReady = true}
    onRetry={handleRetry} />
{:else}
  <div class="root">
    {#if idle && !$activeChapter}
      <SplashScreen mode="idle" showCards={$settings.splashCards ?? true}
        onDismiss={() => setTimeout(() => idle = false, 340)} />
    {/if}
    {#if !$activeChapter}<TitleBar />{/if}
    <div class="content">
      {#if $activeChapter}<Reader />{:else}<Layout />{/if}
    </div>
    {#if $settingsOpen}<Settings />{/if}
    <Toaster />
  </div>
{/if}

<style>
  .root {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
  .content {
    flex: 1;
    overflow: hidden;
  }
</style>
