<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { getVersion } from "@tauri-apps/api/app";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { gql } from "./lib/client";
  import { GET_DOWNLOAD_STATUS } from "./lib/queries";
  import { store, addToast, setActiveDownloads, setSettingsOpen } from "./store/state.svelte";
  import { initRpc, setIdle, clearReading, destroyRpc } from "./lib/discord";
  import type { DownloadStatus, DownloadQueueItem } from "./lib/types";
  import Layout       from "./components/layout/Layout.svelte";
  import Reader       from "./components/reader/Reader.svelte";
  import Settings     from "./components/settings/Settings.svelte";
  import ThemeEditor  from "./components/settings/ThemeEditor.svelte";
  import TitleBar     from "./components/layout/TitleBar.svelte";
  import Toaster      from "./components/layout/Toaster.svelte";
  import SplashScreen from "./components/layout/SplashScreen.svelte";
  import MangaPreview from "./components/shared/MangaPreview.svelte";

  let themeStyleEl: HTMLStyleElement | null = null;

  $effect(() => {
    const themeId  = store.settings.theme ?? "dark";
    const isCustom = themeId.startsWith("custom:");

    if (!isCustom) {
      themeStyleEl?.remove();
      themeStyleEl = null;
      document.documentElement.setAttribute("data-theme", themeId);
      return;
    }

    const custom = store.settings.customThemes?.find(t => t.id === themeId);
    if (!custom) {
      themeStyleEl?.remove();
      themeStyleEl = null;
      document.documentElement.setAttribute("data-theme", "dark");
      return;
    }

    const vars = Object.entries(custom.tokens)
      .map(([k, v]) => `  --${k}: ${v};`)
      .join("\n");
    const css = `[data-theme="custom"] {\n${vars}\n}`;

    if (!themeStyleEl) {
      themeStyleEl = document.createElement("style");
      themeStyleEl.id = "moku-custom-theme";
      document.head.appendChild(themeStyleEl);
    }
    themeStyleEl.textContent = css;
    document.documentElement.setAttribute("data-theme", "custom");
  });

  let themeEditorOpen   = $state(false);
  let themeEditorEditId = $state<string | null>(null);

  function openThemeEditor(id?: string | null) {
    themeEditorEditId = id ?? null;
    themeEditorOpen   = true;
  }

  function closeThemeEditor() {
    themeEditorOpen   = false;
    themeEditorEditId = null;
  }

  const MAX_ATTEMPTS = 10;
  const win = getCurrentWindow();

  let serverProbeOk = $state(false);
  let appReady      = $state(false);
  let failed        = $state(false);
  let notConfigured = $state(false);
  let idle          = $state(false);
  let devSplash     = $state(false);

  let platformScale = $state(1.0);

  // Track last applied zoom so we only touch the DOM when the value actually changes.
  let _appliedZoom = -1;
  let _vhRafId: number | null = null;

  function applyZoom() {
    const uiZoom = store.settings.uiZoom ?? 1.0;
    // Only touch the DOM when the zoom value has genuinely changed.
    if (uiZoom === _appliedZoom) return;
    _appliedZoom = uiZoom;

    const pct = uiZoom * 100;
    document.documentElement.style.setProperty("--ui-zoom", String(uiZoom));
    document.documentElement.style.setProperty("--ui-scale", String(uiZoom));

    // Only scale the non-reader shell. The reader mounts as a fixed overlay
    // and manages its own zoom — applying document-level zoom to it would
    // double-scale manga images.
    const shell = document.getElementById("app-shell");
    if (shell) {
      (shell as HTMLElement).style.zoom = `${pct}%`;
    } else {
      document.documentElement.style.zoom = `${pct}%`;
    }

    // Defer --visual-vh until after the browser has re-laid-out at the new
    // zoom level so we read a stable innerHeight, not a mid-transition value.
    if (_vhRafId !== null) cancelAnimationFrame(_vhRafId);
    _vhRafId = requestAnimationFrame(() => {
      _vhRafId = null;
      document.documentElement.style.setProperty("--visual-vh", `${window.innerHeight / uiZoom}px`);
    });
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
    if (idle) return;
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
    // Re-run only when uiZoom actually changes. platformScale is handled
    // directly inside onScaleChanged so it doesn't trigger spurious re-runs
    // of this effect on unrelated reactive flushes.
    void store.settings.uiZoom;
    applyZoom();
  });

  $effect(() => {
    if (!appReady) return;
    const poll = () => gql<{ downloadStatus: DownloadStatus }>(GET_DOWNLOAD_STATUS)
      .then(d => applyQueue(d.downloadStatus.queue)).catch(console.error);
    poll();
    pollInterval = setInterval(poll, 2000);
    return () => clearInterval(pollInterval);
  });

  async function checkForUpdateSilently() {
    try {
      const [currentVersion, releases] = await Promise.all([
        getVersion(),
        invoke<Array<{ tag_name: string; html_url: string }>>("list_releases"),
      ]);

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

      const isNewer = compare(parse(latestTag), parse(currentVersion)) < 0;
      if (isNewer) {
        addToast({
          kind: "info",
          title: `Update available — v${latestTag}`,
          body: "Open Settings → About to install.",
          duration: 8000,
        });
      }
    } catch {}
  }

  let cancelProbe = false;

  function startProbe() {
    cancelProbe = false;
    failed      = false;
    let tries   = 0;

    async function probe() {
      if (cancelProbe) return;
      tries++;
      try {
        const rawUrl = store.settings.serverUrl;
        const base   = typeof rawUrl === "string" && rawUrl.trim()
          ? rawUrl.replace(/\/$/, "")
          : "http://127.0.0.1:4567";
        const s      = store.settings;
        const auth: Record<string, string> = s.serverAuthEnabled && s.serverAuthUser && s.serverAuthPass
          ? { Authorization: `Basic ${btoa(`${s.serverAuthUser.trim()}:${s.serverAuthPass.trim()}`)}` }
          : {};
        const res = await fetch(`${base}/api/graphql`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...auth },
          body: JSON.stringify({ query: "{ __typename }" }),
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok && !cancelProbe) { serverProbeOk = true; return; }
      } catch {}
      if (tries >= MAX_ATTEMPTS && !cancelProbe) { failed = true; return; }
      if (!cancelProbe) setTimeout(probe, 750);
    }

    setTimeout(probe, 800);
  }

  onMount(async () => {
    document.addEventListener("contextmenu", e => e.preventDefault());
    (window as any).__mokuShowSplash = () => devSplash = true;

    // We read the scale factor so onScaleChanged can re-trigger applyZoom when
    // the window moves to a different-DPI monitor, but we do NOT fold it into
    // the zoom math — Tauri's WebView already accounts for DPI scaling.
    platformScale = await invoke<number>("get_platform_ui_scale").catch(() => 1.0);
    applyZoom();

    store.isFullscreen = await win.isFullscreen();

    const unlistenResize = await win.onResized(async () => {
      store.isFullscreen = await win.isFullscreen();
    });

    const unlistenScale = await win.onScaleChanged(async (event) => {
      platformScale = event.payload.scaleFactor;
      applyZoom();
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

    startProbe();

    type P = { chapterId: number; mangaId: number; progress: number }[];
    unlistenDownload = await listen<P>("download-progress", e => { setActiveDownloads(e.payload); });

    return () => {
      cancelProbe = true;
      unlistenResize();
      unlistenScale();
      destroyRpc();
      if (store.settings.autoStartServer) invoke("kill_server").catch(() => {});
      if (idleTimer) clearTimeout(idleTimer);
      if (pollInterval) clearInterval(pollInterval);
      unlistenDownload?.();
      delete (window as any).__mokuShowSplash;
    };
  });

  $effect(() => {
    if (!appReady) return;
    const timer = setTimeout(checkForUpdateSilently, 5_000);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    if (store.settings.discordRpc) {
      initRpc();
    } else {
      clearReading();
      destroyRpc();
    }
  });

  // When the reader closes, show idle presence.
  $effect(() => {
    if (!store.activeChapter) {
      if (store.settings.discordRpc) setIdle();
    }
  });

  function handleZoomKey(e: KeyboardEvent) {
    if (!e.ctrlKey) return;
    if (e.key === "=" || e.key === "+") {
      e.preventDefault();
      store.settings.uiZoom = Math.min(2.0, Math.round(((store.settings.uiZoom ?? 1.0) + 0.1) * 10) / 10);
    } else if (e.key === "-") {
      e.preventDefault();
      store.settings.uiZoom = Math.max(0.5, Math.round(((store.settings.uiZoom ?? 1.0) - 0.1) * 10) / 10);
    } else if (e.key === "0") {
      e.preventDefault();
      store.settings.uiZoom = 1.0;
    }
  }

  $effect(() => {
    window.addEventListener("keydown", handleZoomKey);
    return () => window.removeEventListener("keydown", handleZoomKey);
  });

  function handleRetry() {
    failed        = false;
    notConfigured = false;
    serverProbeOk = false;
    startProbe();
  }

  function handleBypass() {
    cancelProbe   = true;
    serverProbeOk = true;
    appReady      = true;
  }
</script>

{#if devSplash}
  <SplashScreen mode="idle" showFps showCards={store.settings.splashCards ?? true}
    onDismiss={() => setTimeout(() => devSplash = false, 340)} />
{:else if !appReady}
  <SplashScreen mode="loading" ringFull={serverProbeOk} {failed} {notConfigured}
    showCards={store.settings.splashCards ?? true}
    onReady={() => appReady = true}
    onRetry={handleRetry}
    onBypass={handleBypass} />
{:else}
  <div id="app-shell" class="root">
    {#if idle && !store.activeChapter}
      <SplashScreen mode="idle" showCards={store.settings.splashCards ?? true}
        onDismiss={() => { idle = false; resetIdle(); }} />
    {/if}
    {#if !store.activeChapter && !store.isFullscreen}<TitleBar />{/if}
    <div class="content">
      {#if store.activeChapter}<Reader />{:else}<Layout />{/if}
    </div>
    {#if store.settingsOpen}<Settings onOpenThemeEditor={openThemeEditor} />{/if}
    {#if themeEditorOpen}
      <ThemeEditor
        bind:editingId={themeEditorEditId}
        onClose={closeThemeEditor}
      />
    {/if}
    <MangaPreview />
    <Toaster />
  </div>
{/if}

<style>
  .root { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .content { flex: 1; overflow: hidden; }
</style>
