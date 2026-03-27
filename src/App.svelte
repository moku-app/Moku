<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { getVersion } from "@tauri-apps/api/app";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { gql } from "./lib/client";
  import { GET_DOWNLOAD_STATUS } from "./lib/queries";
  import { store, addToast, setActiveDownloads, setSettingsOpen } from "./store/state.svelte";
  import type { DownloadStatus, DownloadQueueItem } from "./lib/types";
  import Layout       from "./components/layout/Layout.svelte";
  import Reader       from "./components/reader/Reader.svelte";
  import Settings     from "./components/settings/Settings.svelte";
  import TitleBar     from "./components/layout/TitleBar.svelte";
  import Toaster      from "./components/layout/Toaster.svelte";
  import SplashScreen from "./components/layout/SplashScreen.svelte";
  import MangaPreview from "./components/shared/MangaPreview.svelte";

  const MAX_ATTEMPTS = 60;
  const win = getCurrentWindow();

  let serverProbeOk   = $state(!store.settings.autoStartServer);
  let appReady        = $state(!store.settings.autoStartServer);
  let failed          = $state(false);
  let notConfigured   = $state(false);
  let idle            = $state(false);
  let devSplash       = $state(false);
  let platformScale   = $state(1);

  function applyZoom() {
    const normalized = store.settings.uiScale * platformScale;
    document.documentElement.style.zoom = `${normalized}%`;
    document.documentElement.style.setProperty("--ui-scale", String(normalized));
    document.documentElement.style.setProperty("--visual-vh", `${window.innerHeight / (normalized / 100)}px`);
  }

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
    if (idleTimer) clearTimeout(idleTimer);
    if (idle) return;                        // don't re-arm while PIN screen is showing
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
    // Re-runs whenever uiScale or platformScale changes.
    store.settings.uiScale; platformScale;
    applyZoom();
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

  // ── Auto-update check (runs once after app is ready) ─────────────────────────
  //
  // Fetches the GitHub releases list via the Rust command and compares the latest
  // tag against the installed version. On mismatch, shows a single non-blocking
  // info toast. No modal, no blocking UI.
  async function checkForUpdateSilently() {
    try {
      const [currentVersion, releases] = await Promise.all([
        getVersion(),
        invoke<Array<{ tag_name: string; html_url: string }>>("list_releases"),
      ]);

      // Filter out drafts / incomplete releases that have no tag_name
      const valid = releases.filter(r => typeof r.tag_name === "string" && r.tag_name.trim());
      if (!valid.length) return;

      const parse = (tag: string): number[] =>
        tag.replace(/^v/, "").split(".").map(Number);

      const compare = (a: number[], b: number[]): number => {
        for (let i = 0; i < 3; i++) {
          if ((a[i] ?? 0) !== (b[i] ?? 0)) return (b[i] ?? 0) - (a[i] ?? 0);
        }
        return 0;
      };

      const latestTag = valid
        .map(r => r.tag_name)
        .sort((a, b) => compare(parse(a), parse(b)))[0]
        .replace(/^v/, "");

      // Only toast if latest is strictly newer than installed
      const isNewer = compare(parse(latestTag), parse(currentVersion)) < 0;
      if (isNewer) {
        addToast({
          kind: "info",
          title: `Update available — v${latestTag}`,
          body: "Open Settings → About to install.",
          duration: 8000,
        });
      }
    } catch {
      // Silently ignore — no network, private repo rate-limit, etc.
    }
  }

  onMount(async () => {
    document.addEventListener("contextmenu", e => e.preventDefault());
    (window as any).__mokuShowSplash = () => devSplash = true;

    // Fetch the platform scale factor then immediately re-apply zoom.
    platformScale = await invoke<number>("get_platform_ui_scale").catch(() => 1);
    applyZoom();

    // ── Fullscreen state sync ─────────────────────────────────────────────────
    // Seed the initial state, then keep it in sync on every resize event.
    // onResized is the correct Tauri 2 API — it fires on fullscreen enter/exit,
    // window snap, and manual resize. isFullscreen() is cheap (single IPC call).
    store.isFullscreen = await win.isFullscreen();
    const unlistenResize = await win.onResized(async () => {
      store.isFullscreen = await win.isFullscreen();
    });

    if (store.settings.autoStartServer) {
      invoke<void>("spawn_server", { binary: store.settings.serverBinary }).catch((err: any) => {
        if (err?.kind === "NotConfigured") {
          notConfigured = true;
        } else {
          console.warn("Could not start server:", err);
        }
      });
    }

    if (!serverProbeOk) {
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
        if (!cancelled) setTimeout(probe, 500);
      }
      setTimeout(probe, 800);
    }

    type P = { chapterId: number; mangaId: number; progress: number }[];
    unlistenDownload = await listen<P>("download-progress", e => { setActiveDownloads(e.payload); });

    return () => {
      cancelled = true;
      unlistenResize();
      if (store.settings.autoStartServer) invoke("kill_server").catch(() => {});
      if (idleTimer) clearTimeout(idleTimer);
      if (pollInterval) clearInterval(pollInterval);
      unlistenDownload?.();
      delete (window as any).__mokuShowSplash;
    };
  });

  // Run the update check once, 5 seconds after the app finishes loading.
  // The delay avoids adding to startup latency and ensures list_releases
  // doesn't compete with the server probe.
  $effect(() => {
    if (!appReady) return;
    const timer = setTimeout(checkForUpdateSilently, 5_000);
    return () => clearTimeout(timer);
  });

  function handleRetry() { failed = false; notConfigured = false; serverProbeOk = false; }
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
        onDismiss={() => { idle = false; resetIdle(); }} />
    {/if}
    {#if !store.activeChapter && !store.isFullscreen}<TitleBar />{/if}
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
