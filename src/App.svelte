<script lang="ts">
  import { onMount }           from "svelte";
  import { invoke }            from "@tauri-apps/api/core";
  import { listen }            from "@tauri-apps/api/event";
  import { getCurrentWindow }  from "@tauri-apps/api/window";
  import { platform }          from "@tauri-apps/plugin-os";
  import { store, setActiveDownloads } from "@store/state.svelte";
  import { downloadStore } from "@features/downloads/store/downloadState.svelte";
  import { boot, initStore, startProbe, stopProbe, retryBoot, bypassBoot } from "@store/boot.svelte";
  import { initRpc, setIdle, clearReading, destroyRpc } from "@store/discord";
  import { applyTheme }        from "@core/theme";
  import { applyZoom, mountZoomKey, mountIdleDetection } from "@core/ui";
  import { checkForUpdateSilently } from "@core/updater";
  import Layout       from "@shared/chrome/Layout.svelte";
  import Reader       from "@features/reader/components/Reader.svelte";
  import Settings     from "@features/settings/components/Settings.svelte";
  import ThemeEditor  from "@features/settings/components/ThemeEditor.svelte";
  import TitleBar     from "@shared/chrome/TitleBar.svelte";
  import Toaster      from "@shared/chrome/Toaster.svelte";
  import SplashScreen from "@shared/chrome/SplashScreen.svelte";
  import MangaPreview from "@shared/manga/MangaPreview.svelte";
  import AuthGate     from "@shared/chrome/AuthGate.svelte";

  const win = getCurrentWindow();
  void platform();

  let appReady  = $state(false);
  let idle      = $state(false);
  let devSplash = $state(false);

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

  $effect(() => { void store.settings.theme; applyTheme(); });
  $effect(() => { void store.settings.uiZoom; applyZoom(); });
  $effect(() => mountZoomKey());

  $effect(() => {
    if (!appReady) return;
    return mountIdleDetection(
      () => { idle = true; },
      () => { if (idle) idle = false; },
    );
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

  $effect(() => {
    if (!store.activeChapter && store.settings.discordRpc) setIdle();
  });

  $effect(() => {
    const next = downloadStore.queue.slice();
    downloadStore.detectTransitions(next);
  });

  onMount(async () => {
    document.addEventListener("contextmenu", e => e.preventDefault());
    (window as any).__mokuShowSplash = () => { devSplash = true; };

    applyZoom();

    store.isFullscreen = await win.isFullscreen();

    const unlistenResize = await win.onResized(async () => {
      store.isFullscreen = await win.isFullscreen();
    });

    const unlistenScale = await win.onScaleChanged(async () => {
      applyZoom();
    });

    if (store.settings.autoStartServer) {
      invoke<void>("spawn_server", { binary: store.settings.serverBinary }).catch((err: any) => {
        if (err?.kind === "NotConfigured") boot.notConfigured = true;
        else console.warn("Could not start server:", err);
      });
    }

    await initStore();
    startProbe();

    const unlistenDownload = await listen<{ chapterId: number; mangaId: number; progress: number }[]>(
      "download-progress",
      e => setActiveDownloads(e.payload),
    );

    await downloadStore.poll();
    const dlInterval = setInterval(() => downloadStore.poll(), 2000);

    return () => {
      stopProbe();
      clearInterval(dlInterval);
      unlistenResize();
      unlistenScale();
      unlistenDownload();
      destroyRpc();
      if (store.settings.autoStartServer) invoke("kill_server").catch(() => {});
      delete (window as any).__mokuShowSplash;
    };
  });
</script>

{#if devSplash}
  <SplashScreen mode="idle" showFps showCards={store.settings.splashCards ?? true}
    onDismiss={() => setTimeout(() => devSplash = false, 340)} />

{:else if !appReady && !boot.loginRequired && !boot.unsupportedMode}
  <SplashScreen mode="loading" ringFull={boot.serverProbeOk}
    failed={boot.failed} notConfigured={boot.notConfigured}
    showCards={store.settings.splashCards ?? true}
    onReady={() => { appReady = true; }}
    onRetry={retryBoot}
    onBypass={() => bypassBoot(() => { appReady = true; })} />

{:else if boot.unsupportedMode || boot.loginRequired}
  <SplashScreen mode="loading" ringFull={true} showCards={store.settings.splashCards ?? true} />
  <AuthGate onReady={() => { appReady = true; }} />

{:else}
  {#if idle && !store.activeChapter}
    <SplashScreen mode="idle" showCards={store.settings.splashCards ?? true}
      onDismiss={() => { idle = false; }} />
  {/if}

  <div id="app-shell" class="root">
    {#if !store.activeChapter}<TitleBar />{/if}
    <div class="content">
      {#if store.activeChapter}<Reader />{:else}<Layout />{/if}
    </div>
    {#if store.settingsOpen}<Settings onOpenThemeEditor={openThemeEditor} />{/if}
    {#if themeEditorOpen}
      <ThemeEditor bind:editingId={themeEditorEditId} onClose={closeThemeEditor} />
    {/if}
    <MangaPreview />
    <Toaster />
  </div>
{/if}

<style>
  .root    { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .content { flex: 1; overflow: hidden; }
</style>