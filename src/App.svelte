<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { getVersion } from "@tauri-apps/api/app";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { platform } from "@tauri-apps/plugin-os";
  import { gql } from "./lib/client";
  import logoUrl from "./assets/moku-icon-splash.svg";
  import { probeServer, loginBasic, authSession, logout } from "./lib/auth";
  import { GET_DOWNLOAD_STATUS } from "./lib/queries";
  import { store, addToast, setActiveDownloads, setSettingsOpen } from "./store/state.svelte";
  import { initRpc, setIdle, clearReading, destroyRpc } from "./lib/discord";
  import type { DownloadStatus, DownloadQueueItem } from "./lib/types";
  import Layout       from "./components/chrome/Layout.svelte";
  import Reader       from "./components/reader/Reader.svelte";
  import Settings     from "./components/settings/Settings.svelte";
  import ThemeEditor  from "./components/settings/ThemeEditor.svelte";
  import TitleBar     from "./components/chrome/TitleBar.svelte";
  import Toaster      from "./components/chrome/Toaster.svelte";
  import SplashScreen from "./components/chrome/SplashScreen.svelte";
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
  const win        = getCurrentWindow();
  const isWindows  = platform() === "windows";

  let serverProbeOk = $state(false);
  let appReady      = $state(false);
  let failed        = $state(false);
  let notConfigured = $state(false);
  let idle          = $state(false);
  let devSplash     = $state(false);

  let loginRequired      = $state(false);
  let loginUser          = $state(store.settings.serverAuthUser ?? "");
  let loginPass          = $state("");
  let loginError         = $state<string | null>(null);
  let loginBusy          = $state(false);
  let unsupportedMode    = $state(false);

  let platformScale = $state(1.0);
  let _appliedZoom = -1;
  let _vhRafId: number | null = null;

  function applyZoom() {
    const uiZoom = store.settings.uiZoom ?? 1.0;
    if (uiZoom === _appliedZoom) return;
    _appliedZoom = uiZoom;

    const pct = uiZoom * 100;
    document.documentElement.style.setProperty("--ui-zoom", String(uiZoom));
    document.documentElement.style.setProperty("--ui-scale", String(uiZoom));
    document.documentElement.style.zoom = `${pct}%`;

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
    loginRequired = false;
    let tries   = 0;

    async function probe() {
      if (cancelProbe) return;
      tries++;
      const result = await probeServer();
      if (cancelProbe) return;

      if (result === "ok") {
        serverProbeOk = true;
        loginRequired = false;
        return;
      }

      if (result === "auth_required") {
        serverProbeOk = true;
        const savedUser = store.settings.serverAuthUser?.trim() ?? "";
        const savedPass = store.settings.serverAuthPass?.trim() ?? "";
        if (savedUser && savedPass) {
          try {
            await loginBasic(savedUser, savedPass);
            loginRequired = false;
            return;
          } catch {}
        }
        loginRequired = true;
        return;
      }

      if (result === "unsupported_mode") {
        serverProbeOk = true;
        unsupportedMode = true;
        return;
      }

      if (tries >= MAX_ATTEMPTS) { failed = true; return; }
      setTimeout(probe, 750);
    }

    setTimeout(probe, 800);
  }

  onMount(async () => {
    document.addEventListener("contextmenu", e => e.preventDefault());
    (window as any).__mokuShowSplash = () => devSplash = true;

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

  async function handleLogin() {
    if (!loginUser.trim() || !loginPass.trim()) {
      loginError = "Username and password are required";
      return;
    }
    loginBusy  = true;
    loginError = null;
    try {
      await loginBasic(loginUser.trim(), loginPass.trim());
      loginRequired = false;
      loginPass     = "";
      loginError    = null;
      appReady      = true;
    } catch (e: any) {
      loginError = e?.message ?? "Login failed";
    } finally {
      loginBusy = false;
    }
  }

  function handleRetry() {
    failed          = false;
    notConfigured   = false;
    serverProbeOk   = false;
    loginRequired   = false;
    unsupportedMode = false;
    startProbe();
  }

  function handleBypass() {
    cancelProbe     = true;
    serverProbeOk   = true;
    loginRequired   = false;
    unsupportedMode = false;
    appReady        = true;
  }
</script>

{#if devSplash}
  <SplashScreen mode="idle" showFps showCards={store.settings.splashCards ?? true}
    onDismiss={() => setTimeout(() => devSplash = false, 340)} />
{:else if !appReady && !loginRequired && !unsupportedMode}
  <SplashScreen mode="loading" ringFull={serverProbeOk} {failed} {notConfigured}
    showCards={store.settings.splashCards ?? true}
    onReady={() => { appReady = true; }}
    onRetry={handleRetry}
    onBypass={handleBypass} />
{:else if unsupportedMode}
  <SplashScreen mode="loading" ringFull={true} showCards={store.settings.splashCards ?? true} />
  <div class="auth-overlay">
    <div class="auth-card">
      <img src={logoUrl} alt="Moku" class="auth-logo" />
      <p class="auth-title">moku</p>
      <span class="auth-mode-badge auth-mode-badge--warn">{
        store.settings.serverAuthMode === "SIMPLE_LOGIN" ? "Simple Login" :
        store.settings.serverAuthMode === "UI_LOGIN"     ? "UI Login"     : "Unsupported Auth"
      }</span>
      <p class="auth-host">{store.settings.serverUrl || "localhost:4567"}</p>
      <p class="auth-body">
        <strong>{
          store.settings.serverAuthMode === "SIMPLE_LOGIN" ? "Simple Login" :
          store.settings.serverAuthMode === "UI_LOGIN"     ? "UI Login"     : "This auth mode"
        }</strong> is not supported. Switch your server to <strong>Basic Auth</strong> and update Settings → Security.
      </p>
      <button class="auth-btn auth-btn--ghost" onclick={handleBypass}>Continue anyway</button>
    </div>
  </div>
{:else if loginRequired}
  <SplashScreen mode="loading" ringFull={true} showCards={store.settings.splashCards ?? true} />
  <div class="auth-overlay">
    <div class="auth-card">
      <img src={logoUrl} alt="Moku" class="auth-logo" />
      <p class="auth-title">moku</p>
      <span class="auth-mode-badge">Basic Auth</span>
      <p class="auth-host">{store.settings.serverUrl || "localhost:4567"}</p>
      {#if loginError}
        <p class="auth-error">{loginError}</p>
      {/if}
      <div class="auth-fields">
        <input class="auth-input" type="text" placeholder="Username"
          bind:value={loginUser} disabled={loginBusy} autocomplete="username"
          onkeydown={(e) => e.key === "Enter" && handleLogin()} />
        <input class="auth-input" type="password" placeholder="Password"
          bind:value={loginPass} disabled={loginBusy} autocomplete="current-password"
          onkeydown={(e) => e.key === "Enter" && handleLogin()} />
      </div>
      <button class="auth-btn" onclick={handleLogin}
        disabled={loginBusy || !loginUser.trim() || !loginPass.trim()}>
        {loginBusy ? "Signing in…" : "Sign in"}
      </button>
      <button class="auth-btn auth-btn--ghost" onclick={handleBypass}>Skip</button>
    </div>
  </div>
{:else}
  <div id="app-shell" class="root">
    {#if idle && !store.activeChapter}
      <SplashScreen mode="idle" showCards={store.settings.splashCards ?? true}
        onDismiss={() => { idle = false; resetIdle(); }} />
    {/if}
    {#if !store.activeChapter}<TitleBar />{/if}
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

  .auth-overlay { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center; pointer-events: none; }
  .auth-card { pointer-events: auto; width: min(280px, calc(100vw - 48px)); background: var(--bg-surface); border: 1px solid var(--border-base); border-radius: var(--radius-xl); padding: var(--sp-6) var(--sp-5); display: flex; flex-direction: column; align-items: center; gap: var(--sp-3); box-shadow: 0 32px 80px rgba(0,0,0,0.75); animation: authIn 0.28s cubic-bezier(0.16,1,0.3,1) both; text-align: center; }
  @keyframes authIn { from { opacity: 0; transform: translateY(10px) scale(0.97); } to { opacity: 1; transform: none; } }

  .auth-logo { width: 56px; height: 56px; border-radius: 14px; display: block; }
  .auth-title { font-family: var(--font-ui); font-size: 11px; font-weight: 500; letter-spacing: 0.26em; text-transform: uppercase; color: var(--text-secondary); margin: -6px 0 0; user-select: none; }
  .auth-mode-badge { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wider); text-transform: uppercase; color: var(--accent-fg); background: var(--accent-muted); border: 1px solid var(--accent-dim); border-radius: var(--radius-full); padding: 2px 10px; }
  .auth-mode-badge--warn { color: var(--color-error); background: var(--color-error-bg); border-color: var(--color-error); }
  .auth-host { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); margin: -4px 0 0; }
  .auth-body { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-muted); letter-spacing: var(--tracking-wide); line-height: var(--leading-snug); margin: 0; }
  .auth-body strong { color: var(--text-secondary); font-weight: var(--weight-medium); }
  .auth-error { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--color-error); background: var(--color-error-bg); border: 1px solid var(--color-error); border-radius: var(--radius-sm); padding: var(--sp-2) var(--sp-3); margin: 0; width: 100%; box-sizing: border-box; }
  .auth-fields { display: flex; flex-direction: column; gap: var(--sp-2); width: 100%; }
  .auth-input { width: 100%; background: var(--bg-raised); border: 1px solid var(--border-strong); border-radius: var(--radius-md); padding: 8px 12px; font-size: var(--text-sm); color: var(--text-primary); outline: none; box-sizing: border-box; transition: border-color var(--t-base), box-shadow var(--t-base); font-family: inherit; }
  .auth-input:focus { border-color: var(--border-focus); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent); }
  .auth-input:disabled { opacity: 0.5; }
  .auth-btn { width: 100%; padding: 9px; border-radius: var(--radius-md); background: var(--accent); border: 1px solid var(--accent); color: var(--accent-fg); font-size: var(--text-sm); font-family: var(--font-ui); letter-spacing: var(--tracking-wide); cursor: pointer; transition: opacity var(--t-base); }
  .auth-btn:hover:not(:disabled) { opacity: 0.85; }
  .auth-btn:disabled { opacity: 0.35; cursor: default; }
  .auth-btn--ghost { background: none; border-color: transparent; color: var(--text-faint); font-size: var(--text-xs); padding: 4px; }
  .auth-btn--ghost:hover:not(:disabled) { color: var(--text-muted); opacity: 1; }
</style>
