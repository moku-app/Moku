<script lang="ts">
  import { tick } from "svelte";
  import { X, Book, Image, Sliders, Info, Keyboard, Gear, HardDrives, FolderSimple, Plus, Pencil, Trash, Wrench, PaintBrush, ListChecks, Lock } from "phosphor-svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { getVersion } from "@tauri-apps/api/app";
  import { open as openUrl } from "@tauri-apps/plugin-shell";
  import { gql, thumbUrl } from "../../lib/client";
  import { GET_DOWNLOADS_PATH, GET_TRACKERS, LOGIN_TRACKER_OAUTH, LOGIN_TRACKER_CREDENTIALS, LOGOUT_TRACKER, GET_TRACKER_RECORDS, GET_SERVER_SECURITY, SET_SERVER_AUTH, SET_SOCKS_PROXY, SET_FLARESOLVERR } from "../../lib/queries";
  import { store, updateSettings, resetKeybinds, addFolder, removeFolder, renameFolder, toggleFolderTab, clearHistory, wipeAllData, setSettingsOpen, deleteCustomTheme } from "../../store/state.svelte";
  import { cache } from "../../lib/cache";
  import { KEYBIND_LABELS, DEFAULT_KEYBINDS, eventToKeybind } from "../../lib/keybinds";
  import type { Settings, FitMode, Theme } from "../../store/state.svelte";
  import type { Keybinds } from "../../lib/keybinds";
  import type { Tracker } from "../../lib/types";

  interface Props {
    onOpenThemeEditor?: (id?: string | null) => void;
  }
  let { onOpenThemeEditor }: Props = $props();

  type Tab = "general" | "appearance" | "reader" | "library" | "performance" | "keybinds" | "storage" | "folders" | "tracking" | "security" | "about" | "devtools";

  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: "general",    label: "General",     icon: Gear       },
    { id: "appearance", label: "Appearance",  icon: PaintBrush },
    { id: "reader",     label: "Reader",      icon: Book       },
    { id: "library",    label: "Library",     icon: Image      },
    { id: "performance",label: "Performance", icon: Sliders    },
    { id: "keybinds",   label: "Keybinds",    icon: Keyboard   },
    { id: "storage",    label: "Storage",     icon: HardDrives },
    { id: "folders",    label: "Folders",     icon: FolderSimple },
    { id: "tracking",   label: "Tracking",    icon: ListChecks },
    { id: "security",   label: "Security",    icon: Lock       },
    { id: "about",      label: "About",       icon: Info       },
    { id: "devtools",   label: "Dev Tools",   icon: Wrench     },
  ];

  const THEMES: { id: Theme; label: string; description: string; swatches: string[] }[] = [
    { id: "dark",           label: "Dark",           description: "Default near-black",            swatches: ["#101010","#151515","#a8c4a8","#f0efec"] },
    { id: "high-contrast",  label: "High Contrast",  description: "Darker base, sharper text",     swatches: ["#080808","#111111","#bcd8bc","#ffffff"] },
    { id: "light",          label: "Light",          description: "Warm off-white",                swatches: ["#f4f2ee","#faf8f4","#2a5a2a","#1a1916"] },
    { id: "light-contrast", label: "Light Contrast", description: "Light with maximum contrast",   swatches: ["#ece8e2","#f5f2ec","#183818","#080806"] },
    { id: "midnight",       label: "Midnight",       description: "Deep blue-black tint",          swatches: ["#0c1020","#101428","#a8b4e8","#eeeef8"] },
    { id: "warm",           label: "Warm",           description: "Amber and sepia tones",         swatches: ["#16130c","#1c1810","#e0b860","#f5f0e0"] },
  ];

  let tab: Tab          = $state("general");
  let contentBodyEl: HTMLDivElement;
  $effect(() => { tab; tick().then(() => contentBodyEl?.scrollTo({ top: 0 })); });

  function close() { setSettingsOpen(false); }

  function onKey(e: KeyboardEvent) { if (e.key === "Escape" && !listeningKey) close(); }
  $effect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  
  let listeningKey: keyof Keybinds | null = $state(null);

  function startListen(key: keyof Keybinds) {
    listeningKey = listeningKey === key ? null : key;
  }

  function onKeyCapture(e: KeyboardEvent) {
    if (!listeningKey) return;
    e.preventDefault(); e.stopPropagation();
    const bind = eventToKeybind(e);
    if (!bind) return;
    updateSettings({ keybinds: { ...store.settings.keybinds, [listeningKey]: bind } });
    listeningKey = null;
  }

  $effect(() => {
    if (listeningKey) {
      window.addEventListener("keydown", onKeyCapture, true);
      return () => window.removeEventListener("keydown", onKeyCapture, true);
    }
  });

  
  interface StorageInfo { manga_bytes: number; total_bytes: number; free_bytes: number; path: string; }
  let storageInfo: StorageInfo | null = $state(null);
  let storageLoading = $state(false);
  let storageError: string | null = $state(null);
  let clearing = $state(false);
  let cleared  = $state(false);

  async function fetchStorage() {
    storageLoading = true; storageError = null;
    try {
      const pathData = await gql<{ settings: { downloadsPath: string } }>(GET_DOWNLOADS_PATH);
      storageInfo = await invoke<StorageInfo>("get_storage_info", { downloadsPath: pathData.settings.downloadsPath });
    } catch (e: any) { storageError = e instanceof Error ? e.message : String(e); }
    finally { storageLoading = false; }
  }
  $effect(() => { if (tab === "storage" && !storageInfo && !storageLoading) fetchStorage(); });

  function handleClearCache() {
    clearing = true;
    caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n)))).catch(() => {})
      .finally(() => { clearing = false; cleared = true; setTimeout(() => cleared = false, 2500); fetchStorage(); });
  }

  function fmtBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const units = ["B","KB","MB","GB","TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
  }

  // ── Performance metrics ───────────────────────────────────────────────────────
  interface PerfSnapshot {
    cacheEntries: number;
    cacheKeys:    string[];
    oldestEntryMs: number | null;
    newestEntryMs: number | null;
  }

  let perfSnapshot: PerfSnapshot | null = $state(null);

  function refreshPerfMetrics() {
    const knownPrefixes = ["library", "sources", "popular", "genre:", "manga:", "chapters:", "page:", "pages:"];
    let entries = 0;
    let oldest: number | null = null;
    let newest: number | null = null;
    const foundKeys: string[] = [];

    const checkKey = (k: string) => {
      const age = cache.ageOf(k);
      if (age !== undefined) {
        entries++;
        foundKeys.push(k);
        const ts = Date.now() - age;
        if (oldest === null || ts < oldest) oldest = ts;
        if (newest === null || ts > newest) newest = ts;
      }
    };

    ["library", "sources", "popular"].forEach(checkKey);
    ["Action","Romance","Fantasy","Comedy","Drama","Horror","Sci-Fi","Adventure","Thriller",
     "Isekai","Supernatural","Historical","Psychological","Sports","Mystery","Mecha",
     "Slice of Life","School Life","Martial Arts","Magic","Military"].forEach(g => checkKey(`genre:${g}`));

    perfSnapshot = { cacheEntries: entries, cacheKeys: foundKeys, oldestEntryMs: oldest, newestEntryMs: newest };
  }
  $effect(() => { if (tab === "performance") refreshPerfMetrics(); });

  function fmtAge(ts: number | null): string {
    if (ts === null) return "—";
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  }

  // Storage limit input state
  let storageLimitInput = $state(String(store.settings.storageLimitGb ?? ""));

  function applyStorageLimit() {
    const v = storageLimitInput.trim();
    if (v === "" || v === "0") { updateSettings({ storageLimitGb: null }); return; }
    const n = parseFloat(v);
    if (!isNaN(n) && n > 0) updateSettings({ storageLimitGb: n });
  }

  
  let newFolderName  = $state("");
  let editingId: string | null = $state(null);
  let editingName    = $state("");

  function createFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    addFolder(name); newFolderName = "";
  }

  function startEdit(id: string, name: string) { editingId = id; editingName = name; }

  function commitEdit() {
    if (editingId && editingName.trim()) renameFolder(editingId, editingName.trim());
    editingId = null; editingName = "";
  }

  
  let selectOpen: string | null = $state(null);

  function toggleSelect(id: string) { selectOpen = selectOpen === id ? null : id; }

  function onSelectOutside(e: MouseEvent) {
    if (selectOpen && !(e.target as HTMLElement).closest(".select-wrap")) selectOpen = null;
  }

  $effect(() => {
    document.addEventListener("mousedown", onSelectOutside);
    return () => document.removeEventListener("mousedown", onSelectOutside);
  });

  
  let splashTriggered = $state(false);

  let showAuthPass     = $state(false);
  let showSocksPass    = $state(false);
  let pinInput         = $state(store.settings.appLockPin ?? "");
  let pinError         = $state("");
  let secLoading       = $state(false);
  let secError         = $state<string | null>(null);
  let secSaved         = $state<string | null>(null);

  let authUsername     = $state(store.settings.serverAuthUser ?? "");
  let authPassword     = $state(store.settings.serverAuthPass ?? "");

  let socksEnabled     = $state(store.settings.socksProxyEnabled ?? false);
  let socksHost        = $state(store.settings.socksProxyHost ?? "");
  let socksPort        = $state(store.settings.socksProxyPort ?? "1080");
  let socksVersion     = $state(store.settings.socksProxyVersion ?? 5);
  let socksUsername    = $state(store.settings.socksProxyUsername ?? "");
  let socksPassword    = $state(store.settings.socksProxyPassword ?? "");

  let flareEnabled     = $state(store.settings.flareSolverrEnabled ?? false);
  let flareUrl         = $state(store.settings.flareSolverrUrl ?? "http://localhost:8191");
  let flareTimeout     = $state(store.settings.flareSolverrTimeout ?? 60);
  let flareSession     = $state(store.settings.flareSolverrSessionName ?? "moku");
  let flareTtl         = $state(store.settings.flareSolverrSessionTtl ?? 15);
  let flareFallback    = $state(store.settings.flareSolverrFallback ?? false);

  function showSaved(key: string) {
    secSaved = key; secError = null;
    setTimeout(() => { if (secSaved === key) secSaved = null; }, 2000);
  }

  async function loadServerSecurity() {
    try {
      const res = await gql<{ settings: {
        authMode: string; authUsername: string;
        socksProxyEnabled: boolean; socksProxyHost: string; socksProxyPort: string;
        socksProxyVersion: number; socksProxyUsername: string;
        flareSolverrEnabled: boolean; flareSolverrUrl: string; flareSolverrTimeout: number;
        flareSolverrSessionName: string; flareSolverrSessionTtl: number;
        flareSolverrAsResponseFallback: boolean;
      }}>(GET_SERVER_SECURITY);
      const s = res.settings;
      const authOn = s.authMode === "BASIC_AUTH";
      updateSettings({ serverAuthEnabled: authOn, serverAuthUser: s.authUsername });
      authUsername  = s.authUsername;
      socksEnabled  = s.socksProxyEnabled;  socksHost    = s.socksProxyHost;
      socksPort     = s.socksProxyPort;     socksVersion = s.socksProxyVersion;
      socksUsername = s.socksProxyUsername;
      flareEnabled  = s.flareSolverrEnabled; flareUrl    = s.flareSolverrUrl;
      flareTimeout  = s.flareSolverrTimeout; flareSession = s.flareSolverrSessionName;
      flareTtl      = s.flareSolverrSessionTtl; flareFallback = s.flareSolverrAsResponseFallback;
      updateSettings({
        socksProxyEnabled: socksEnabled, socksProxyHost: socksHost, socksProxyPort: socksPort,
        socksProxyVersion: socksVersion, socksProxyUsername: socksUsername,
        flareSolverrEnabled: flareEnabled, flareSolverrUrl: flareUrl,
        flareSolverrTimeout: flareTimeout, flareSolverrSessionName: flareSession,
        flareSolverrSessionTtl: flareTtl, flareSolverrFallback: flareFallback,
      });
    } catch {}
  }

  $effect(() => { if (tab === "security") loadServerSecurity(); });

  async function enableAuth() {
    if (!authUsername.trim() || !authPassword.trim()) {
      secError = "Username and password are required"; return;
    }
    secLoading = true; secError = null;
    updateSettings({ serverAuthEnabled: true, serverAuthUser: authUsername, serverAuthPass: authPassword });
    try {
      await gql(SET_SERVER_AUTH, { authMode: "BASIC_AUTH", authUsername: authUsername.trim(), authPassword: authPassword.trim() });
      showSaved("auth");
    } catch (e: any) {
      updateSettings({ serverAuthEnabled: false });
      secError = e?.message ?? "Failed to enable authentication";
    } finally { secLoading = false; }
  }

  async function disableAuth() {
    secLoading = true; secError = null;
    try {
      await gql(SET_SERVER_AUTH, { authMode: "NONE", authUsername: "", authPassword: "" });
      updateSettings({ serverAuthEnabled: false, serverAuthUser: "", serverAuthPass: "" });
      authUsername = ""; authPassword = "";
      showSaved("auth");
    } catch (e: any) {
      secError = e?.message ?? "Failed to disable authentication";
    } finally { secLoading = false; }
  }

  async function saveSocksProxy() {
    secLoading = true; secError = null;
    try {
      await gql(SET_SOCKS_PROXY, {
        socksProxyEnabled: socksEnabled, socksProxyHost: socksHost.trim(),
        socksProxyPort: socksPort.trim(), socksProxyVersion: socksVersion,
        socksProxyUsername: socksUsername.trim(), socksProxyPassword: socksPassword.trim(),
      });
      updateSettings({
        socksProxyEnabled: socksEnabled, socksProxyHost: socksHost,
        socksProxyPort: socksPort, socksProxyVersion: socksVersion,
        socksProxyUsername: socksUsername, socksProxyPassword: socksPassword,
      });
      showSaved("socks");
    } catch (e: any) {
      secError = e?.message ?? "Failed to save SOCKS proxy";
    } finally { secLoading = false; }
  }

  async function saveFlareSolverr() {
    secLoading = true; secError = null;
    try {
      await gql(SET_FLARESOLVERR, {
        flareSolverrEnabled: flareEnabled, flareSolverrUrl: flareUrl.trim(),
        flareSolverrTimeout: flareTimeout, flareSolverrSessionName: flareSession.trim(),
        flareSolverrSessionTtl: flareTtl, flareSolverrAsResponseFallback: flareFallback,
      });
      updateSettings({
        flareSolverrEnabled: flareEnabled, flareSolverrUrl: flareUrl,
        flareSolverrTimeout: flareTimeout, flareSolverrSessionName: flareSession,
        flareSolverrSessionTtl: flareTtl, flareSolverrFallback: flareFallback,
      });
      showSaved("flare");
    } catch (e: any) {
      secError = e?.message ?? "Failed to save FlareSolverr";
    } finally { secLoading = false; }
  }

  function commitPin() {
    const cleaned = pinInput.replace(/\D/g, "").slice(0, 8);
    pinInput = cleaned;
    if (cleaned.length >= 4) {
      updateSettings({ appLockPin: cleaned }); pinError = "";
    } else if (cleaned.length > 0) {
      pinError = "PIN must be at least 4 digits";
    } else {
      updateSettings({ appLockPin: "" }); pinError = "";
    }
  }

  // ── Tracker state ─────────────────────────────────────────────────────────────

  let trackers:        Tracker[]    = $state([]);
  let trackersLoading: boolean      = $state(false);
  let trackersError:   string|null  = $state(null);

  // OAuth flow state
  let oauthTrackerId:  number|null  = $state(null);
  let oauthCallbackInput: string    = $state("");
  let oauthSubmitting: boolean      = $state(false);

  // Credentials flow state
  let credsTrackerId:  number|null  = $state(null);
  let credsUsername:   string       = $state("");
  let credsPassword:   string       = $state("");
  let credsSubmitting: boolean      = $state(false);

  // Logout state
  let loggingOut:      number|null  = $state(null); // trackerId being logged out

  async function loadTrackers() {
    trackersLoading = true; trackersError = null;
    try {
      const res = await gql<{ trackers: { nodes: Tracker[] } }>(GET_TRACKERS);
      trackers = res.trackers.nodes;
    } catch (e: any) {
      trackersError = e?.message ?? "Failed to load trackers";
    } finally {
      trackersLoading = false;
    }
  }

  $effect(() => { if (tab === "tracking" && trackers.length === 0 && !trackersLoading) loadTrackers(); });

  // OAuth: trackers with an authUrl use a browser redirect flow.
  // User clicks "Connect", we open the auth URL in their browser.
  // Suwayomi's redirect lands at suwayomi.org/tracker-oauth which shows
  // the full callback URL. User pastes it back here.
  async function startOAuth(tracker: Tracker) {
    if (!tracker.authUrl) return;
    oauthTrackerId     = tracker.id;
    oauthCallbackInput = "";
    await openUrl(tracker.authUrl);
  }

  async function submitOAuth() {
    if (!oauthTrackerId || !oauthCallbackInput.trim()) return;
    oauthSubmitting = true;
    try {
      await gql(LOGIN_TRACKER_OAUTH, {
        trackerId:   oauthTrackerId,
        callbackUrl: oauthCallbackInput.trim(),
      });
      await loadTrackers();
      oauthTrackerId     = null;
      oauthCallbackInput = "";
    } catch (e: any) {
      trackersError = e?.message ?? "Login failed";
    } finally {
      oauthSubmitting = false;
    }
  }

  function cancelOAuth() { oauthTrackerId = null; oauthCallbackInput = ""; }

  // Credentials flow (Kitsu, MangaUpdates)
  function startCredentials(tracker: Tracker) {
    credsTrackerId = tracker.id;
    credsUsername  = "";
    credsPassword  = "";
  }

  async function submitCredentials() {
    if (!credsTrackerId || !credsUsername.trim() || !credsPassword.trim()) return;
    credsSubmitting = true;
    try {
      await gql(LOGIN_TRACKER_CREDENTIALS, {
        trackerId: credsTrackerId,
        username:  credsUsername.trim(),
        password:  credsPassword.trim(),
      });
      await loadTrackers();
      credsTrackerId = null;
      credsUsername  = "";
      credsPassword  = "";
    } catch (e: any) {
      trackersError = e?.message ?? "Login failed";
    } finally {
      credsSubmitting = false;
    }
  }

  function cancelCredentials() { credsTrackerId = null; credsUsername = ""; credsPassword = ""; }

  async function logoutTracker(trackerId: number) {
    loggingOut = trackerId;
    try {
      await gql(LOGOUT_TRACKER, { trackerId });
      await loadTrackers();
    } catch (e: any) {
      trackersError = e?.message ?? "Logout failed";
    } finally {
      loggingOut = null;
    }
  }

  // A tracker uses OAuth if it has an authUrl; otherwise credentials.
  function usesOAuth(t: Tracker): boolean { return !!t.authUrl; }

  // ── About / Updater state ─────────────────────────────────────────────────────

  interface ReleaseInfo {
    tag_name:     string;
    name:         string;
    body:         string;
    published_at: string;
    html_url:     string;
  }

  type UpdatePhase =
    | "idle"
    | "downloading"
    | "ready"      // downloaded, awaiting restart
    | "error";

  const IS_WINDOWS = navigator.userAgent.includes("Windows");

  let appVersion      = $state("…");
  let releases        = $state<ReleaseInfo[]>([]);
  let releasesLoading = $state(false);
  let releasesError   = $state<string | null>(null);
  let expandedTag     = $state<string | null>(null);

  // update install state
  let updatePhase     = $state<UpdatePhase>("idle");
  let updateError     = $state<string | null>(null);
  let dlBytes         = $state(0);
  let dlTotal         = $state<number | null>(null);
  let targetTag       = $state<string | null>(null); // tag being installed

  let releasesLoaded = false; // plain var — not $state, so effect doesn't re-run on change

  $effect(() => {
    if (tab !== "about") return;
    getVersion().then(v => appVersion = v).catch(() => appVersion = "unknown");
    if (!releasesLoaded) { releasesLoaded = true; loadReleases(); }
  });

  async function loadReleases() {
    releasesLoading = true; releasesError = null;
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out after 10s")), 10_000)
      );
      const all = await Promise.race([
        invoke<ReleaseInfo[]>("list_releases"),
        timeout,
      ]);
      // Filter out drafts / incomplete entries with no tag_name
      releases = all.filter(r => typeof r.tag_name === "string" && r.tag_name.trim());
    } catch (e: any) {
      releasesError = e instanceof Error ? e.message : String(e);
    } finally {
      releasesLoading = false;
    }
  }

  // Normalise "v0.4.0" → "0.4.0" for comparison
  function stripV(v: string) { return v.replace(/^v/, ""); }

  function isCurrentVersion(tag: string) { return stripV(tag) === appVersion; }

  function parseSemver(v: string): number[] {
    return stripV(v).split(".").map(Number);
  }

  function compareSemver(a: string, b: string): number {
    const pa = parseSemver(a), pb = parseSemver(b);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
    }
    return 0;
  }

  // True when releases are loaded and installed version is >= highest published tag
  let onLatestVersion = $derived((() => {
    if (releasesLoading || releases.length === 0 || !appVersion || appVersion === "…") return false;
    const sorted = releases.slice().sort((a, b) => compareSemver(a.tag_name, b.tag_name));
    return compareSemver(appVersion, sorted[0].tag_name) >= 0;
  })());

  function fmtDate(iso: string): string {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  // ── Download & install ────────────────────────────────────────────────────────

  // Listen to progress events from Rust while this component is alive.
  let unlistenProgress: (() => void) | undefined;

  $effect(() => {
    listen<{ downloaded: number; total: number | null }>("update-progress", (e) => {
      dlBytes = e.payload.downloaded;
      dlTotal = e.payload.total ?? null;
    }).then(fn => { unlistenProgress = fn; });
    return () => unlistenProgress?.();
  });

  async function installUpdate(release: ReleaseInfo) {
    if (updatePhase === "downloading") return;

    targetTag   = release.tag_name;
    updatePhase = "downloading";
    updateError = null;
    dlBytes     = 0;
    dlTotal     = null;

    try {
      if (IS_WINDOWS) {
        // Kill Suwayomi before installing — its JRE DLLs will be locked otherwise.
        // kill_server blocks on the Rust side until java.exe is fully gone.
        try { await invoke("kill_server"); } catch {}
        // Windows: Tauri updater downloads + runs passive NSIS installer
        await invoke("download_and_install_update");
        updatePhase = "ready";
      } else {
        // Linux / macOS: open GitHub release page
        await openUrl(release.html_url);
        updatePhase = "idle";
        targetTag   = null;
      }
    } catch (e: any) {
      updateError = e instanceof Error ? e.message : String(e);
      updatePhase = "error";
    }
  }

  async function restartNow() {
    await invoke("restart_app");
  }

  function cancelUpdate() {
    updatePhase = "idle";
    updateError = null;
    targetTag   = null;
    dlBytes     = 0;
    dlTotal     = null;
  }

  function fmtProgress(): string {
    if (dlTotal) {
      return `${fmtBytes(dlBytes)} / ${fmtBytes(dlTotal)} (${Math.round((dlBytes / dlTotal) * 100)}%)`;
    }
    return fmtBytes(dlBytes);
  }

  function triggerSplash() {
    splashTriggered = true;
    setTimeout(() => splashTriggered = false, 200);
    (window as any).__mokuShowSplash?.();
  }
</script>

<div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) close(); }} onkeydown={(e) => { if (e.key === "Escape") close(); }}>
  <div class="modal" role="dialog" aria-label="Settings">
    <div class="sidebar">
      <p class="modal-title">Settings</p>
      <nav class="nav">
        {#each TABS as t}
          <button class="nav-item" class:active={tab === t.id} onclick={() => tab = t.id}>
            <t.icon size={14} weight="light" />
            <span>{t.label}</span>
          </button>
        {/each}
      </nav>
    </div>

    <div class="content">
      <div class="content-header">
        <p class="content-title">{TABS.find((t) => t.id === tab)?.label}</p>
        <button class="close-btn" aria-label="Close settings" onclick={close}><X size={15} weight="light" /></button>
      </div>

      <div class="content-body" bind:this={contentBodyEl}>

        
        {#if tab === "general"}
          <div class="panel">
            <div class="section">
              <p class="section-title">Interface Scale</p>
              <div class="scale-row">
                <input type="range" min={50} max={200} step={5} value={store.settings.uiScale}
                  oninput={(e) => updateSettings({ uiScale: Number(e.currentTarget.value) })} class="scale-slider" />
                <input
                  type="number" min={50} max={200} step={1}
                  class="scale-val-input"
                  value={store.settings.uiScale}
                  oninput={(e) => {
                    const n = parseInt(e.currentTarget.value, 10);
                    if (!isNaN(n) && n >= 50 && n <= 200) updateSettings({ uiScale: n });
                  }}
                  onblur={(e) => {
                    const n = parseInt(e.currentTarget.value, 10);
                    if (isNaN(n) || n < 50) { updateSettings({ uiScale: 50 }); e.currentTarget.value = "50"; }
                    else if (n > 200) { updateSettings({ uiScale: 200 }); e.currentTarget.value = "200"; }
                  }}
                />
                <span class="scale-pct">%</span>
                <button class="step-btn" onclick={() => updateSettings({ uiScale: 100 })} disabled={store.settings.uiScale === 100} title="Reset">↺</button>
              </div>
              <p class="scale-hint">
                {#each [50,60,70,80,90,100,110,125,150,175,200] as v}
                  <button class="scale-preset" class:active={store.settings.uiScale === v} onclick={() => updateSettings({ uiScale: v })}>{v}%</button>
                {/each}
              </p>
            </div>
            <div class="section">
              <p class="section-title">Server</p>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Server URL</span><span class="toggle-desc">Base URL of your Suwayomi instance</span></div>
                <input class="text-input" value={store.settings.serverUrl ?? "http://localhost:4567"} oninput={(e) => updateSettings({ serverUrl: e.currentTarget.value })} placeholder="http://localhost:4567" spellcheck="false" />
              </div>

              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Auto-start server</span><span class="toggle-desc">Launch tachidesk-server when Moku opens</span></div>
                <button role="switch" aria-checked={store.settings.autoStartServer} aria-label="Auto-start server" class="toggle" class:on={store.settings.autoStartServer} onclick={() => updateSettings({ autoStartServer: !store.settings.autoStartServer })}><span class="toggle-thumb"></span></button>
              </label>
            </div>
            <div class="section">
              <p class="section-title">Inactivity</p>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Idle screen timeout</span><span class="toggle-desc">Show the Moku idle splash after this much inactivity.</span></div>
                <div class="select-wrap" id="idle-timeout">
                  <button class="select-btn" onclick={() => toggleSelect("idle-timeout")}>
                    <span>{{ "0":"Never","1":"1 minute","2":"2 minutes","5":"5 minutes","10":"10 minutes","15":"15 minutes","30":"30 minutes" }[String(store.settings.idleTimeoutMin ?? 5)] ?? `${store.settings.idleTimeoutMin} min`}</span>
                    <svg class="select-caret" class:open={selectOpen === "idle-timeout"} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
                  </button>
                  {#if selectOpen === "idle-timeout"}
                    <div class="select-menu">
                      {#each [["0","Never"],["1","1 minute"],["2","2 minutes"],["5","5 minutes"],["10","10 minutes"],["15","15 minutes"],["30","30 minutes"]] as [v, l]}
                        <button class="select-option" class:active={String(store.settings.idleTimeoutMin ?? 5) === v} onclick={() => { updateSettings({ idleTimeoutMin: Number(v) }); selectOpen = null; }}>{l}</button>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
            </div>
          </div>

        
        {:else if tab === "appearance"}
          <div class="panel">
            <div class="section">
              <p class="section-title">Theme</p>
              <div class="theme-grid">
                {#each THEMES as theme}
                  {@const active = (store.settings.theme ?? "dark") === theme.id}
                  <button class="theme-card" class:active onclick={() => updateSettings({ theme: theme.id })} title={theme.description}>
                    <div class="theme-preview">
                      <div class="theme-preview-bg" style="background:{theme.swatches[0]}">
                        <div class="theme-preview-sidebar" style="background:{theme.swatches[1]}"></div>
                        <div class="theme-preview-content">
                          <div class="theme-preview-accent" style="background:{theme.swatches[2]}"></div>
                          <div class="theme-preview-text" style="background:{theme.swatches[3]}55"></div>
                          <div class="theme-preview-text" style="background:{theme.swatches[3]}33;width:60%"></div>
                        </div>
                      </div>
                    </div>
                    <div class="theme-card-info">
                      <span class="theme-card-label">{theme.label}</span>
                      <span class="theme-card-desc">{theme.description}</span>
                    </div>
                    {#if active}<span class="theme-card-check">✓</span>{/if}
                  </button>
                {/each}

                <!-- Custom theme cards -->
                {#each store.settings.customThemes ?? [] as custom}
                  {@const active = store.settings.theme === custom.id}
                  <div class="theme-card custom-theme-card" class:active>
                    <button
                      class="custom-theme-select"
                      onclick={() => updateSettings({ theme: custom.id })}
                      title="Apply {custom.name}"
                    >
                      <div class="theme-preview">
                        <div class="theme-preview-bg" style="background:{custom.tokens['bg-base']}">
                          <div class="theme-preview-sidebar" style="background:{custom.tokens['bg-surface']}"></div>
                          <div class="theme-preview-content">
                            <div class="theme-preview-accent" style="background:{custom.tokens['accent']}"></div>
                            <div class="theme-preview-text" style="background:{custom.tokens['text-primary']}55"></div>
                            <div class="theme-preview-text" style="background:{custom.tokens['text-primary']}33;width:60%"></div>
                          </div>
                        </div>
                      </div>
                      <div class="theme-card-info">
                        <span class="theme-card-label">{custom.name}</span>
                        <span class="theme-card-desc custom-badge">Custom</span>
                      </div>
                    </button>
                    <div class="custom-theme-actions">
                      <button
                        class="custom-theme-edit-btn"
                        onclick={() => onOpenThemeEditor?.(custom.id)}
                        title="Edit theme"
                      >
                        <Pencil size={10} />
                      </button>
                      <button
                        class="custom-theme-delete-btn"
                        onclick={() => {
                          if (confirm(`Delete theme "${custom.name}"?`)) deleteCustomTheme(custom.id);
                        }}
                        title="Delete theme"
                      >
                        <Trash size={10} />
                      </button>
                    </div>
                    {#if active}<span class="theme-card-check">✓</span>{/if}
                  </div>
                {/each}

                <!-- New Theme button -->
                <button
                  class="theme-card new-theme-card"
                  onclick={() => onOpenThemeEditor?.(null)}
                  title="Create a custom theme"
                >
                  <div class="new-theme-icon">
                    <Plus size={18} weight="light" />
                  </div>
                  <div class="theme-card-info">
                    <span class="theme-card-label">New Theme</span>
                    <span class="theme-card-desc">Create custom</span>
                  </div>
                </button>
              </div>
            </div>
          </div>

        
        {:else if tab === "reader"}
          <div class="panel">
            <div class="section">
              <p class="section-title">Page Layout</p>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Default layout</span><span class="toggle-desc">How chapters open by default</span></div>
                <div class="select-wrap" id="page-style">
                  <button class="select-btn" onclick={() => toggleSelect("page-style")}>
                    <span>{{ "single":"Single page","longstrip":"Long strip" }[store.settings.pageStyle === "double" ? "single" : store.settings.pageStyle]}</span>
                    <svg class="select-caret" class:open={selectOpen === "page-style"} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
                  </button>
                  {#if selectOpen === "page-style"}
                    <div class="select-menu">
                      {#each [["single","Single page"],["longstrip","Long strip"]] as [v, l]}
                        <button class="select-option" class:active={(store.settings.pageStyle === "double" ? "single" : store.settings.pageStyle) === v} onclick={() => { updateSettings({ pageStyle: v as Settings["pageStyle"] }); selectOpen = null; }}>{l}</button>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Reading direction</span><span class="toggle-desc">Left-to-right for most manga, right-to-left for Japanese</span></div>
                <div class="select-wrap" id="reading-dir">
                  <button class="select-btn" onclick={() => toggleSelect("reading-dir")}>
                    <span>{{ "ltr":"Left to right","rtl":"Right to left" }[store.settings.readingDirection]}</span>
                    <svg class="select-caret" class:open={selectOpen === "reading-dir"} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
                  </button>
                  {#if selectOpen === "reading-dir"}
                    <div class="select-menu">
                      {#each [["ltr","Left to right"],["rtl","Right to left"]] as [v, l]}
                        <button class="select-option" class:active={store.settings.readingDirection === v} onclick={() => { updateSettings({ readingDirection: v as Settings["readingDirection"] }); selectOpen = null; }}>{l}</button>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Page gap</span><span class="toggle-desc">Add spacing between pages in longstrip mode</span></div>
                <button role="switch" aria-checked={store.settings.pageGap} aria-label="Page gap" class="toggle" class:on={store.settings.pageGap} onclick={() => updateSettings({ pageGap: !store.settings.pageGap })}><span class="toggle-thumb"></span></button>
              </label>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Overlay bars</span><span class="toggle-desc">Top and bottom bars float over the page instead of pushing it</span></div>
                <button role="switch" aria-checked={store.settings.overlayBars ?? false} aria-label="Overlay bars" class="toggle" class:on={store.settings.overlayBars ?? false} onclick={() => updateSettings({ overlayBars: !(store.settings.overlayBars ?? false) })}><span class="toggle-thumb"></span></button>
              </label>
            </div>
            <div class="section">
              <p class="section-title">Fit &amp; Zoom</p>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Default fit mode</span><span class="toggle-desc">How pages are sized to fit the screen</span></div>
                <div class="select-wrap" id="fit-mode">
                  <button class="select-btn" onclick={() => toggleSelect("fit-mode")}>
                    <span>{{ "width":"Fit width","height":"Fit height","screen":"Fit screen","original":"Original (1:1)" }[store.settings.fitMode ?? "width"]}</span>
                    <svg class="select-caret" class:open={selectOpen === "fit-mode"} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
                  </button>
                  {#if selectOpen === "fit-mode"}
                    <div class="select-menu">
                      {#each [["width","Fit width"],["height","Fit height"],["screen","Fit screen"],["original","Original (1:1)"]] as [v, l]}
                        <button class="select-option" class:active={(store.settings.fitMode ?? "width") === v} onclick={() => { updateSettings({ fitMode: v as FitMode }); selectOpen = null; }}>{l}</button>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Max page width</span><span class="toggle-desc">Pixel cap for fit-width mode.</span></div>
                <div class="step-controls">
                  <button class="step-btn" onclick={() => updateSettings({ maxPageWidth: Math.max(200, (store.settings.maxPageWidth ?? 900) - 100) })}>−</button>
                  <span class="step-val">{store.settings.maxPageWidth ?? 900}px</span>
                  <button class="step-btn" onclick={() => updateSettings({ maxPageWidth: Math.min(2400, (store.settings.maxPageWidth ?? 900) + 100) })}>+</button>
                </div>
              </div>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Optimize contrast</span><span class="toggle-desc">Use webkit-optimize-contrast rendering</span></div>
                <button role="switch" aria-checked={store.settings.optimizeContrast} aria-label="Optimize contrast" class="toggle" class:on={store.settings.optimizeContrast} onclick={() => updateSettings({ optimizeContrast: !store.settings.optimizeContrast })}><span class="toggle-thumb"></span></button>
              </label>
            </div>
            <div class="section">
              <p class="section-title">Behaviour</p>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Auto-mark chapters read</span><span class="toggle-desc">Mark a chapter as read when you reach the last page</span></div>
                <button role="switch" aria-checked={store.settings.autoMarkRead} aria-label="Auto-mark chapters read" class="toggle" class:on={store.settings.autoMarkRead} onclick={() => updateSettings({ autoMarkRead: !store.settings.autoMarkRead })}><span class="toggle-thumb"></span></button>
              </label>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Auto-advance chapters</span><span class="toggle-desc">Automatically open the next chapter at the end of a long strip</span></div>
                <button role="switch" aria-checked={store.settings.autoNextChapter ?? false} aria-label="Auto-advance chapters" class="toggle" class:on={store.settings.autoNextChapter} onclick={() => updateSettings({ autoNextChapter: !(store.settings.autoNextChapter ?? false) })}><span class="toggle-thumb"></span></button>
              </label>
              {#if !(store.settings.autoNextChapter ?? false)}
                <label class="toggle-row">
                  <div class="toggle-info"><span class="toggle-label">Mark read when skipping to next chapter</span><span class="toggle-desc">Mark chapter as read when you tap next before finishing</span></div>
                  <button role="switch" aria-checked={store.settings.markReadOnNext ?? true} aria-label="Mark read when skipping" class="toggle" class:on={store.settings.markReadOnNext ?? true} onclick={() => updateSettings({ markReadOnNext: !(store.settings.markReadOnNext ?? true) })}><span class="toggle-thumb"></span></button>
                </label>
              {/if}
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Pages to preload</span><span class="toggle-desc">Images loaded ahead of the current page</span></div>
                <div class="step-controls">
                  <button class="step-btn" onclick={() => updateSettings({ preloadPages: Math.max(0, store.settings.preloadPages - 1) })} disabled={store.settings.preloadPages <= 0}>−</button>
                  <span class="step-val">{store.settings.preloadPages}</span>
                  <button class="step-btn" onclick={() => updateSettings({ preloadPages: Math.min(10, store.settings.preloadPages + 1) })} disabled={store.settings.preloadPages >= 10}>+</button>
                </div>
              </div>
            </div>
          </div>

        
        {:else if tab === "library"}
          <div class="panel">
            <div class="section">
              <p class="section-title">Display</p>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Crop cover images</span><span class="toggle-desc">Fill grid cells — may crop cover edges</span></div>
                <button role="switch" aria-checked={store.settings.libraryCropCovers} aria-label="Crop cover images" class="toggle" class:on={store.settings.libraryCropCovers} onclick={() => updateSettings({ libraryCropCovers: !store.settings.libraryCropCovers })}><span class="toggle-thumb"></span></button>
              </label>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Show NSFW sources</span><span class="toggle-desc">Display adult content sources in the sources list</span></div>
                <button role="switch" aria-checked={store.settings.showNsfw} aria-label="Show NSFW sources" class="toggle" class:on={store.settings.showNsfw} onclick={() => updateSettings({ showNsfw: !store.settings.showNsfw })}><span class="toggle-thumb"></span></button>
              </label>
            </div>
            <div class="section">
              <p class="section-title">Chapters</p>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Default sort direction</span></div>
                <div class="select-wrap" id="sort-dir">
                  <button class="select-btn" onclick={() => toggleSelect("sort-dir")}>
                    <span>{{ "desc":"Newest first","asc":"Oldest first" }[store.settings.chapterSortDir]}</span>
                    <svg class="select-caret" class:open={selectOpen === "sort-dir"} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
                  </button>
                  {#if selectOpen === "sort-dir"}
                    <div class="select-menu">
                      {#each [["desc","Newest first"],["asc","Oldest first"]] as [v, l]}
                        <button class="select-option" class:active={store.settings.chapterSortDir === v} onclick={() => { updateSettings({ chapterSortDir: v as Settings["chapterSortDir"] }); selectOpen = null; }}>{l}</button>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
            </div>
            <div class="section">
              <p class="section-title">History</p>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Reading store.history</span><span class="toggle-desc">{store.history.length} entries stored</span></div>
                <button class="danger-btn" onclick={clearHistory} disabled={store.history.length === 0}>Clear activity</button>
              </div>
              <div class="step-row">
                <div class="toggle-info">
                  <span class="toggle-label">Full data cleanse</span>
                  <span class="toggle-desc">Removes store.history, stats, completed list, hero pins, and manga links</span>
                </div>
                <button class="danger-btn" onclick={wipeAllData}>Wipe all data</button>
              </div>
            </div>
          </div>

        
        {:else if tab === "performance"}
          <div class="panel">

            <div class="section">
              <p class="section-title">Render Limit</p>
              <div class="step-row">
                <div class="toggle-info">
                  <span class="toggle-label">Items per page</span>
                  <span class="toggle-desc">Library and Search render this many items before showing a "Load more" button. Lower = faster scrolling on large libraries.</span>
                </div>
                <div class="step-controls">
                  <button class="step-btn" onclick={() => updateSettings({ renderLimit: Math.max(12, (store.settings.renderLimit ?? 48) - 12) })} disabled={(store.settings.renderLimit ?? 48) <= 12}>−</button>
                  <span class="step-val">{store.settings.renderLimit ?? 48}</span>
                  <button class="step-btn" onclick={() => updateSettings({ renderLimit: Math.min(200, (store.settings.renderLimit ?? 48) + 12) })} disabled={(store.settings.renderLimit ?? 48) >= 200}>+</button>
                </div>
              </div>
              <p class="scale-hint">
                {#each [12, 24, 48, 96, 200] as v}
                  <button class="scale-preset" class:active={(store.settings.renderLimit ?? 48) === v} onclick={() => updateSettings({ renderLimit: v })}>{v}</button>
                {/each}
              </p>
            </div>

            <div class="section">
              <p class="section-title">Rendering</p>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">GPU acceleration</span><span class="toggle-desc">Promote reader and library to compositor layers</span></div>
                <button role="switch" aria-checked={store.settings.gpuAcceleration} aria-label="GPU acceleration" class="toggle" class:on={store.settings.gpuAcceleration} onclick={() => updateSettings({ gpuAcceleration: !store.settings.gpuAcceleration })}><span class="toggle-thumb"></span></button>
              </label>
            </div>

            <div class="section">
              <p class="section-title">Idle / Splash Screen</p>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Animated card background</span><span class="toggle-desc">Show floating manga cards on splash and idle screens.</span></div>
                <button role="switch" aria-checked={store.settings.splashCards ?? true} aria-label="Animated card background" class="toggle" class:on={store.settings.splashCards ?? true} onclick={() => updateSettings({ splashCards: !(store.settings.splashCards ?? true) })}><span class="toggle-thumb"></span></button>
              </label>
            </div>

            <div class="section">
              <p class="section-title">Interface</p>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Compact sidebar</span><span class="toggle-desc">Reduce sidebar icon spacing</span></div>
                <button role="switch" aria-checked={store.settings.compactSidebar} aria-label="Compact sidebar" class="toggle" class:on={store.settings.compactSidebar} onclick={() => updateSettings({ compactSidebar: !store.settings.compactSidebar })}><span class="toggle-thumb"></span></button>
              </label>
            </div>

            <div class="section">
              <p class="section-title">Session Cache</p>
              <div class="step-row">
                <div class="toggle-info">
                  <span class="toggle-label">Cache entries</span>
                  <span class="toggle-desc">In-memory request cache for this session (library, sources, genre pages). Cleared on restart.</span>
                </div>
                <div class="perf-stat-group">
                  <span class="perf-stat">{perfSnapshot?.cacheEntries ?? 0} entries</span>
                  <button class="kb-reset" onclick={refreshPerfMetrics} title="Refresh">↺</button>
                </div>
              </div>
              {#if perfSnapshot && perfSnapshot.cacheEntries > 0}
                <div class="step-row">
                  <div class="toggle-info"><span class="toggle-label">Oldest entry</span></div>
                  <span class="perf-stat">{fmtAge(perfSnapshot.oldestEntryMs)}</span>
                </div>
                <div class="step-row">
                  <div class="toggle-info"><span class="toggle-label">Newest entry</span></div>
                  <span class="perf-stat">{fmtAge(perfSnapshot.newestEntryMs)}</span>
                </div>
                <div class="step-row">
                  <div class="toggle-info">
                    <span class="toggle-label">Cached keys</span>
                    <span class="toggle-desc">{perfSnapshot.cacheKeys.join(", ")}</span>
                  </div>
                </div>
              {/if}
            </div>

          </div>

        
        {:else if tab === "keybinds"}
          <div class="panel">
            <div class="section">
              <div class="section-title-row">
                <p class="section-title">Keyboard shortcuts</p>
                <button class="sec-action-btn" onclick={resetKeybinds}>Reset all</button>
              </div>
              <p class="kb-hint">Click a binding to rebind, then press the new key combination.</p>
              <div class="kb-list">
                {#each Object.keys(KEYBIND_LABELS) as key}
                  {@const k = key as keyof Keybinds}
                  {@const isListening = listeningKey === k}
                  {@const isDefault   = store.settings.keybinds[k] === DEFAULT_KEYBINDS[k]}
                  <div class="kb-row">
                    <span class="kb-label">{KEYBIND_LABELS[k]}</span>
                    <div class="kb-right">
                      <button class="kb-bind" class:listening={isListening} onclick={() => startListen(k)}>
                        {isListening ? "Press key…" : store.settings.keybinds[k]}
                      </button>
                      <button class="kb-reset" onclick={() => updateSettings({ keybinds: { ...store.settings.keybinds, [k]: DEFAULT_KEYBINDS[k] } })} disabled={isDefault} title="Reset">↺</button>
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          </div>

        
        {:else if tab === "storage"}
          <div class="panel">
            <div class="section">
              <p class="section-title">Disk Usage</p>
              {#if storageLoading}<p class="storage-loading">Reading filesystem…</p>
              {:else if storageError}<p class="storage-loading" style="color:var(--color-error)">{storageError}</p>
              {:else if storageInfo}
                {@const mangaBytes = storageInfo.manga_bytes}
                {@const totalBytes = storageInfo.total_bytes}
                {@const freeBytes  = storageInfo.free_bytes}
                {@const limitGb    = store.settings.storageLimitGb ?? null}
                {@const limitBytes = limitGb !== null ? limitGb * 1024 ** 3 : null}
                {@const available  = mangaBytes + freeBytes}
                {@const cap        = limitBytes !== null ? Math.min(limitBytes, available) : available}
                {@const pctUsed    = cap > 0 ? Math.min(100, (mangaBytes / cap) * 100) : 0}
                <div class="storage-bar-wrap">
                  <div class="storage-bar">
                    <div class="storage-bar-fill" class:critical={pctUsed > 90} class:warn={pctUsed > 75 && pctUsed <= 90} style="width:{pctUsed}%"></div>
                  </div>
                  <div class="storage-bar-labels">
                    <span class="storage-bar-used">{fmtBytes(mangaBytes)} used</span>
                    <span class="storage-bar-free">{fmtBytes(Math.max(0, cap - mangaBytes))} free</span>
                  </div>
                </div>
                <div class="storage-legend">
                  <div class="storage-legend-row"><span class="storage-dot storage-dot-manga"></span><span class="storage-legend-label">Downloaded manga</span><span class="storage-legend-val">{fmtBytes(mangaBytes)}</span></div>
                  <div class="storage-legend-row"><span class="storage-dot storage-dot-free"></span><span class="storage-legend-label">Drive free</span><span class="storage-legend-val">{fmtBytes(freeBytes)}</span></div>
                  <div class="storage-legend-row"><span class="storage-dot storage-dot-app"></span><span class="storage-legend-label">Drive total</span><span class="storage-legend-val">{fmtBytes(totalBytes)}</span></div>
                </div>
                <p class="storage-path-note">{storageInfo.path}</p>
              {/if}
            </div>
            <div class="section">
              <p class="section-title">Cache</p>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Image cache</span><span class="toggle-desc">Cached page images stored by the webview</span></div>
                <button class="danger-btn" onclick={handleClearCache} disabled={clearing}>
                  {cleared ? "Cleared" : clearing ? "Clearing…" : "Clear cache"}
                </button>
              </div>
            </div>
            <div class="section">
              <p class="section-title">Storage Limit</p>
              <div class="step-row">
                <div class="toggle-info">
                  <span class="toggle-label">Limit download storage</span>
                  <span class="toggle-desc">
                    {store.settings.storageLimitGb === null
                      ? "No limit — uses full drive capacity"
                      : `Warn when downloads exceed ${store.settings.storageLimitGb} GB`}
                  </span>
                </div>
                {#if store.settings.storageLimitGb === null}
                  <button class="step-btn" style="width:auto;padding:0 var(--sp-3);font-size:var(--text-xs);letter-spacing:var(--tracking-wide)"
                    onclick={() => updateSettings({ storageLimitGb: 10 })}>
                    Set limit
                  </button>
                {:else}
                  <div class="step-controls">
                    <button class="step-btn"
                      onclick={() => updateSettings({ storageLimitGb: Math.max(1, (store.settings.storageLimitGb ?? 10) - 1) })}
                      disabled={(store.settings.storageLimitGb ?? 10) <= 1}>−</button>
                    <input
                      type="number" min="1" step="1"
                      class="storage-limit-input"
                      value={store.settings.storageLimitGb}
                      oninput={(e) => {
                        const n = parseFloat(e.currentTarget.value);
                        if (!isNaN(n) && n > 0) updateSettings({ storageLimitGb: n });
                      }}
                    />
                    <span class="storage-limit-unit">GB</span>
                    <button class="step-btn"
                      onclick={() => updateSettings({ storageLimitGb: (store.settings.storageLimitGb ?? 10) + 1 })}>+</button>
                    <button class="kb-reset" title="Remove limit"
                      onclick={() => updateSettings({ storageLimitGb: null })}>↺</button>
                  </div>
                {/if}
              </div>
            </div>
          </div>

        
        {:else if tab === "folders"}
          <div class="panel">
            <div class="section">
              <p class="section-title">Manage Folders</p>
              <p class="toggle-desc" style="padding:0 var(--sp-3) var(--sp-3);display:block">Assign manga to folders from the series detail page.</p>
              <div class="folder-create-row">
                <input class="text-input" placeholder="New folder name…" bind:value={newFolderName}
                  onkeydown={(e) => e.key === "Enter" && createFolder()} style="flex:1;width:auto" />
                <button class="folder-create-btn" onclick={createFolder} disabled={!newFolderName.trim()}>
                  <Plus size={13} weight="bold" /> Create
                </button>
              </div>
              {#if store.settings.folders.length === 0}
                <p class="storage-loading">No folders yet. Create one above.</p>
              {:else}
                <div class="folder-list">
                  {#each store.settings.folders as folder}
                    <div class="folder-row">
                      {#if editingId === folder.id}
                        <input class="text-input" bind:value={editingName}
                          onkeydown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") editingId = null; }}
                          onblur={commitEdit} style="flex:1;width:auto" use:focusInput />
                        <button class="kb-reset" onclick={commitEdit} title="Save">✓</button>
                      {:else}
                        <FolderSimple size={14} weight="light" style="color:var(--text-faint);flex-shrink:0" />
                        <span class="folder-row-name">{folder.name}</span>
                        <span class="folder-row-count">{folder.mangaIds.length} manga</span>
                        <button class="folder-tab-toggle" class:on={folder.showTab} onclick={() => toggleFolderTab(folder.id)}>
                          {folder.showTab ? "Tab on" : "Tab off"}
                        </button>
                        <button class="kb-reset" onclick={() => startEdit(folder.id, folder.name)} title="Rename"><Pencil size={12} weight="light" /></button>
                        <button class="kb-reset folder-delete" onclick={() => removeFolder(folder.id)} title="Delete"><Trash size={12} weight="light" /></button>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          </div>

        
        {:else if tab === "tracking"}
          <div class="panel">

            <div class="section">
              <p class="section-title">Connected Trackers</p>
              <p class="toggle-desc" style="padding:0 var(--sp-3) var(--sp-2)">
                Log in to sync your reading progress with external tracking services.
                After connecting, use the Tracking panel inside any manga's detail page.
              </p>

              {#if trackersError}
                <div class="tracker-error">{trackersError}</div>
              {/if}

              {#if trackersLoading}
                <p class="storage-loading">Loading trackers…</p>
              {:else}
                <div class="tracker-list">
                  {#each trackers as tracker}
                    <div class="tracker-row" class:tracker-row-active={tracker.isLoggedIn}>

                      <!-- Icon + name -->
                      <div class="tracker-identity">
                        <img src={thumbUrl(tracker.icon)} alt={tracker.name} class="tracker-logo" />
                        <div class="tracker-name-block">
                          <span class="tracker-label">{tracker.name}</span>
                          <span class="tracker-status-pill" class:pill-on={tracker.isLoggedIn}>
                            {tracker.isLoggedIn ? "Connected" : "Not connected"}
                          </span>
                        </div>
                      </div>

                      <!-- Action area -->
                      <div class="tracker-action">
                        {#if tracker.isLoggedIn}
                          <div class="tracker-connected-btns">
                            <button
                              class="danger-btn"
                              onclick={() => logoutTracker(tracker.id)}
                              disabled={loggingOut === tracker.id}
                            >
                              {loggingOut === tracker.id ? "Disconnecting…" : "Disconnect"}
                            </button>
                          </div>

                        {:else if oauthTrackerId === tracker.id}
                          <div class="oauth-flow">
                            <p class="oauth-hint">
                              Your browser opened the {tracker.name} login page. After authorising,
                              you'll land on a Suwayomi page — <strong>copy the full URL from your browser's address bar</strong>
                              (it starts with <code>https://suwayomi.org/...</code> and contains your token) and paste it below.
                            </p>
                            <input
                              class="oauth-input"
                              placeholder="https://suwayomi.org/tracker-oauth#access_token=…"
                              bind:value={oauthCallbackInput}
                              onkeydown={(e) => { if (e.key === "Enter") submitOAuth(); if (e.key === "Escape") cancelOAuth(); }}
                              use:focusEl
                            />
                            <div class="oauth-btns">
                              <button class="step-btn" onclick={submitOAuth} disabled={oauthSubmitting || !oauthCallbackInput.trim()}>
                                {oauthSubmitting ? "Connecting…" : "Connect"}
                              </button>
                              <button class="kb-reset" onclick={cancelOAuth}>Cancel</button>
                            </div>
                          </div>

                        {:else if credsTrackerId === tracker.id}
                          <div class="oauth-flow">
                            <input
                              class="oauth-input"
                              placeholder="Username / Email"
                              bind:value={credsUsername}
                              onkeydown={(e) => e.key === "Escape" && cancelCredentials()}
                              use:focusEl
                            />
                            <input
                              class="oauth-input"
                              type="password"
                              placeholder="Password"
                              bind:value={credsPassword}
                              onkeydown={(e) => { if (e.key === "Enter") submitCredentials(); if (e.key === "Escape") cancelCredentials(); }}
                            />
                            <div class="oauth-btns">
                              <button class="step-btn" onclick={submitCredentials} disabled={credsSubmitting || !credsUsername.trim() || !credsPassword.trim()}>
                                {credsSubmitting ? "Connecting…" : "Connect"}
                              </button>
                              <button class="kb-reset" onclick={cancelCredentials}>Cancel</button>
                            </div>
                          </div>

                        {:else}
                          <button
                            class="step-btn"
                            style="width:auto;padding:0 var(--sp-4)"
                            onclick={() => usesOAuth(tracker) ? startOAuth(tracker) : startCredentials(tracker)}
                          >
                            {usesOAuth(tracker) ? "Connect via browser →" : "Connect"}
                          </button>
                        {/if}
                      </div>

                    </div>
                  {/each}
                </div>
              {/if}
            </div>

          </div>

        {:else if tab === "security"}
          <div class="panel">

            {#if secError}
              <div class="sec-banner sec-banner-error">{secError}</div>
            {/if}

            <div class="section">
              <div class="section-title-row">
                <p class="section-title">Server Authentication</p>
                <span class="sec-status-pill" class:sec-pill-on={store.settings.serverAuthEnabled}>
                  {store.settings.serverAuthEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div class="step-row">
                <div class="toggle-info">
                  <span class="toggle-label">Username</span>
                </div>
                <input class="text-input" bind:value={authUsername} placeholder="Username" autocomplete="off" spellcheck="false" disabled={secLoading} />
              </div>
              <div class="step-row">
                <div class="toggle-info">
                  <span class="toggle-label">Password</span>
                </div>
                <div class="sec-field-wrap">
                  <input class="text-input" type={showAuthPass ? "text" : "password"} bind:value={authPassword} placeholder="Password" autocomplete="off" spellcheck="false" disabled={secLoading} />
                  <button class="sec-eye-btn" onclick={() => showAuthPass = !showAuthPass} title={showAuthPass ? "Hide password" : "Show password"} tabindex="-1">
                    {#if showAuthPass}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    {:else}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    {/if}
                  </button>
                </div>
              </div>
              <div class="step-row">
                <div class="toggle-info"></div>
                <div class="sec-btn-row">
                  {#if store.settings.serverAuthEnabled}
                    <button class="sec-action-btn sec-action-danger" onclick={disableAuth} disabled={secLoading}>
                      {secLoading ? "Saving…" : "Disable"}
                    </button>
                  {/if}
                  <button class="sec-action-btn sec-action-primary" onclick={enableAuth} disabled={secLoading || !authUsername.trim() || !authPassword.trim()}>
                    {secLoading ? "Saving…" : secSaved === "auth" ? "Saved ✓" : store.settings.serverAuthEnabled ? "Update" : "Enable"}
                  </button>
                </div>
              </div>
            </div>

            <div class="section">
              <div class="section-title-row">
                <p class="section-title">App Lock</p>
              </div>
              <label class="toggle-row">
                <div class="toggle-info">
                  <span class="toggle-label">PIN lock</span>
                  <span class="toggle-desc">Require a PIN on launch and after idle timeout</span>
                </div>
                <button role="switch" aria-checked={store.settings.appLockEnabled ?? false} aria-label="Enable PIN lock" class="toggle" class:on={store.settings.appLockEnabled} onclick={() => updateSettings({ appLockEnabled: !store.settings.appLockEnabled })}><span class="toggle-thumb"></span></button>
              </label>
              {#if store.settings.appLockEnabled}
                <div class="step-row">
                  <div class="toggle-info">
                    <span class="toggle-label">PIN</span>
                    <span class="toggle-desc">4–8 digits</span>
                  </div>
                  <div class="sec-pin-wrap">
                    <div class="sec-pin-row">
                      <input class="text-input sec-pin-input" type="password" inputmode="numeric" maxlength={8} value={pinInput}
                        oninput={(e) => { pinInput = e.currentTarget.value.replace(/\D/g, "").slice(0, 8); pinError = ""; }}
                        onkeydown={(e) => e.key === "Enter" && commitPin()} placeholder="••••" autocomplete="off" />
                      <button class="sec-action-btn sec-action-primary"
                        onclick={commitPin}
                        disabled={pinInput.length > 0 && pinInput.length < 4}>
                        {store.settings.appLockPin && pinInput === store.settings.appLockPin ? "Saved ✓" : "Save"}
                      </button>
                    </div>
                    {#if pinError}<span class="sec-pin-error">{pinError}</span>{/if}
                  </div>
                </div>
              {/if}
            </div>

            <div class="section">
              <div class="section-title-row">
                <p class="section-title">SOCKS Proxy</p>
              </div>
              <label class="toggle-row">
                <div class="toggle-info">
                  <span class="toggle-label">Enable SOCKS proxy</span>
                  <span class="toggle-desc">Route Suwayomi traffic through a SOCKS4/5 proxy</span>
                </div>
                <button role="switch" aria-checked={socksEnabled} aria-label="Enable SOCKS proxy" class="toggle" class:on={socksEnabled} onclick={() => socksEnabled = !socksEnabled}><span class="toggle-thumb"></span></button>
              </label>
              {#if socksEnabled}
                <div class="step-row">
                  <div class="toggle-info">
                    <span class="toggle-label">Version</span>
                  </div>
                  <div class="select-wrap" id="socks-ver">
                    <button class="select-btn" onclick={() => toggleSelect("socks-ver")}>
                      <span>SOCKS{socksVersion}</span>
                      <svg class="select-caret" class:open={selectOpen === "socks-ver"} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
                    </button>
                    {#if selectOpen === "socks-ver"}
                      <div class="select-menu">
                        {#each [[4,"SOCKS4"],[5,"SOCKS5"]] as [v, l]}
                          <button class="select-option" class:active={socksVersion === v} onclick={() => { socksVersion = v as number; selectOpen = null; }}>{l}</button>
                        {/each}
                      </div>
                    {/if}
                  </div>
                </div>
                <div class="step-row">
                  <div class="toggle-info">
                    <span class="toggle-label">Host</span>
                  </div>
                  <input class="text-input" bind:value={socksHost} placeholder="127.0.0.1" autocomplete="off" spellcheck="false" />
                </div>
                <div class="step-row">
                  <div class="toggle-info">
                    <span class="toggle-label">Port</span>
                  </div>
                  <input class="text-input sec-port-input" bind:value={socksPort} placeholder="1080" autocomplete="off" spellcheck="false" />
                </div>
                <div class="step-row">
                  <div class="toggle-info">
                    <span class="toggle-label">Username</span>
                    <span class="toggle-desc">Optional</span>
                  </div>
                  <input class="text-input" bind:value={socksUsername} placeholder="Username" autocomplete="off" spellcheck="false" />
                </div>
                <div class="step-row">
                  <div class="toggle-info">
                    <span class="toggle-label">Password</span>
                    <span class="toggle-desc">Optional</span>
                  </div>
                  <div class="sec-field-wrap">
                    <input class="text-input" type={showSocksPass ? "text" : "password"} bind:value={socksPassword} placeholder="Password" autocomplete="off" spellcheck="false" />
                    <button class="sec-eye-btn" onclick={() => showSocksPass = !showSocksPass} title={showSocksPass ? "Hide password" : "Show password"} tabindex="-1">
                      {#if showSocksPass}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      {:else}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      {/if}
                    </button>
                  </div>
                </div>
                <div class="step-row">
                  <div class="toggle-info"></div>
                  <button class="sec-action-btn sec-action-primary" onclick={saveSocksProxy} disabled={secLoading}>
                    {secLoading ? "Saving…" : secSaved === "socks" ? "Saved ✓" : "Save"}
                  </button>
                </div>
              {/if}
            </div>

            <div class="section">
              <div class="section-title-row">
                <p class="section-title">FlareSolverr</p>
              </div>
              <label class="toggle-row">
                <div class="toggle-info">
                  <span class="toggle-label">Enable FlareSolverr</span>
                  <span class="toggle-desc">Bypass Cloudflare challenges for sources that require it</span>
                </div>
                <button role="switch" aria-checked={flareEnabled} aria-label="Enable FlareSolverr" class="toggle" class:on={flareEnabled} onclick={() => flareEnabled = !flareEnabled}><span class="toggle-thumb"></span></button>
              </label>
              {#if flareEnabled}
                <div class="step-row">
                  <div class="toggle-info">
                    <span class="toggle-label">URL</span>
                    <span class="toggle-desc">FlareSolverr instance address</span>
                  </div>
                  <input class="text-input" bind:value={flareUrl} placeholder="http://localhost:8191" autocomplete="off" spellcheck="false" />
                </div>
                <div class="step-row">
                  <div class="toggle-info">
                    <span class="toggle-label">Timeout</span>
                    <span class="toggle-desc">Max wait per request, in seconds</span>
                  </div>
                  <div class="step-controls">
                    <button class="step-btn" onclick={() => flareTimeout = Math.max(10, flareTimeout - 10)}>−</button>
                    <span class="step-val">{flareTimeout}s</span>
                    <button class="step-btn" onclick={() => flareTimeout = Math.min(300, flareTimeout + 10)}>+</button>
                  </div>
                </div>
                <div class="step-row">
                  <div class="toggle-info">
                    <span class="toggle-label">Session name</span>
                    <span class="toggle-desc">Reuse browser session across requests</span>
                  </div>
                  <input class="text-input" bind:value={flareSession} placeholder="moku" autocomplete="off" spellcheck="false" />
                </div>
                <div class="step-row">
                  <div class="toggle-info">
                    <span class="toggle-label">Session TTL</span>
                    <span class="toggle-desc">Minutes before session is refreshed</span>
                  </div>
                  <div class="step-controls">
                    <button class="step-btn" onclick={() => flareTtl = Math.max(1, flareTtl - 1)}>−</button>
                    <span class="step-val">{flareTtl}m</span>
                    <button class="step-btn" onclick={() => flareTtl = Math.min(60, flareTtl + 1)}>+</button>
                  </div>
                </div>
                <label class="toggle-row">
                  <div class="toggle-info">
                    <span class="toggle-label">Response fallback</span>
                    <span class="toggle-desc">Use FlareSolverr's response when the direct request fails</span>
                  </div>
                  <button role="switch" aria-checked={flareFallback} aria-label="Use as response fallback" class="toggle" class:on={flareFallback} onclick={() => flareFallback = !flareFallback}><span class="toggle-thumb"></span></button>
                </label>
                <div class="step-row">
                  <div class="toggle-info"></div>
                  <button class="sec-action-btn sec-action-primary" onclick={saveFlareSolverr} disabled={secLoading}>
                    {secLoading ? "Saving…" : secSaved === "flare" ? "Saved ✓" : "Save"}
                  </button>
                </div>
              {/if}
            </div>

          </div>

        {:else if tab === "about"}
          <div class="panel">

            <!-- ── App identity ──────────────────────────────────────── -->
            <div class="section">
              <p class="section-title">Moku</p>
              <div class="about-block">
                <p class="about-line">A manga reader frontend for Suwayomi / Tachidesk.</p>
                <p class="about-line" style="color:var(--text-faint);margin-top:var(--sp-2)">Built with Tauri + Svelte.</p>
              </div>
            </div>

            <!-- ── Current version + in-progress update bar ──────────── -->
            <div class="section">
              <p class="section-title">Version</p>
              <div class="step-row">
                <div class="toggle-info">
                  <span class="toggle-label">Installed</span>
                  <span class="toggle-desc">v{appVersion}</span>
                </div>
                <button class="step-btn" style="width:auto;padding:0 var(--sp-3);font-size:var(--text-xs);letter-spacing:var(--tracking-wide)"
                  onclick={() => { releasesError = null; loadReleases(); }} disabled={releasesLoading}>
                  {releasesLoading ? "Loading…" : "Refresh"}
                </button>
              </div>
              {#if onLatestVersion}
                <div class="step-row">
                  <span class="toggle-desc" style="padding:0 var(--sp-3);color:var(--accent-fg)">✓ You're on the latest version.</span>
                </div>
              {/if}

              <!-- active download progress -->
              {#if updatePhase === "downloading" && IS_WINDOWS}
                <div class="update-progress-wrap">
                  <div class="update-progress-bar">
                    <div class="update-progress-fill"
                      style="width:{dlTotal ? Math.round((dlBytes / dlTotal) * 100) : 0}%"></div>
                  </div>
                  <div class="update-progress-row">
                    <span class="update-progress-label">Downloading {targetTag ?? "update"}…</span>
                    <span class="update-progress-val">{fmtProgress()}</span>
                  </div>
                </div>
              {/if}

              <!-- ready to restart -->
              {#if updatePhase === "ready"}
                <div class="update-ready-row">
                  <span class="update-ready-label">
                    {targetTag} downloaded — restart to finish installing.
                  </span>
                  <button class="update-action-btn primary" onclick={restartNow}>Restart now</button>
                  <button class="kb-reset" onclick={cancelUpdate} title="Dismiss">✕</button>
                </div>
              {/if}

              <!-- error -->
              {#if updatePhase === "error"}
                <div class="update-error-row">
                  <span style="color:var(--color-error);font-family:var(--font-ui);font-size:var(--text-xs)">{updateError}</span>
                  <button class="kb-reset" onclick={cancelUpdate}>Dismiss</button>
                </div>
              {/if}
            </div>

            <!-- ── Release list ───────────────────────────────────────── -->
            <div class="section">
              <p class="section-title">Releases</p>

              {#if releasesError}
                <p class="storage-loading" style="color:var(--color-error)">{releasesError}</p>
              {:else if releasesLoading}
                <p class="storage-loading">Fetching releases…</p>
              {:else if releases.length === 0}
                <p class="storage-loading">No releases found.</p>
              {:else}
                <div class="release-list">
                  {#each releases as release}
                    {@const isCurrent   = isCurrentVersion(release.tag_name)}
                    {@const isExpanded  = expandedTag === release.tag_name}
                    {@const isTarget    = targetTag === release.tag_name}
                    {@const isInstalling = isTarget && updatePhase === "downloading"}

                    <div class="release-row" class:current={isCurrent}>
                      <!-- header: tag + date + action -->
                      <div class="release-header">
                        <div class="release-meta">
                          <span class="release-tag">{release.tag_name}</span>
                          {#if isCurrent}
                            <span class="release-badge current-badge">installed</span>
                          {/if}
                          {#if release.published_at}
                            <span class="release-date">{fmtDate(release.published_at)}</span>
                          {/if}
                        </div>
                        <div class="release-actions">
                          <!-- changelog toggle -->
                          {#if release.body.trim()}
                            <button class="release-changelog-btn"
                              onclick={() => expandedTag = isExpanded ? null : release.tag_name}>
                              {isExpanded ? "Hide" : "Changelog"}
                            </button>
                          {/if}
                          <!-- install / open -->
                          {#if !isCurrent}
                            {#if IS_WINDOWS}
                              <button class="update-action-btn"
                                class:primary={!isInstalling}
                                disabled={updatePhase === "downloading"}
                                onclick={() => installUpdate(release)}>
                                {isInstalling ? "Downloading…" : "Install"}
                              </button>
                            {:else}
                              <button class="update-action-btn"
                                onclick={() => installUpdate(release)}>
                                Open on GitHub
                              </button>
                            {/if}
                          {/if}
                        </div>
                      </div>

                      <!-- expandable changelog -->
                      {#if isExpanded && release.body.trim()}
                        <div class="release-body">
                          <pre class="release-body-pre">{release.body.trim()}</pre>
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>

            <!-- ── Links ─────────────────────────────────────────────── -->
            <div class="section">
              <p class="section-title">Links</p>
              <div class="about-block">
                <a href="https://github.com/Youwes09/Moku" target="_blank" class="about-line" style="color:var(--accent-fg);text-decoration:none">GitHub →</a>
                <a href="https://discord.gg/cfncTbJ2" target="_blank" class="about-line" style="color:var(--accent-fg);text-decoration:none;margin-top:var(--sp-1)">Discord →</a>
              </div>
            </div>

          </div>

        
        {:else if tab === "devtools"}
          <div class="panel">
            <div class="section">
              <p class="section-title">Splash Screen</p>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Preview idle screen</span><span class="toggle-desc">Show the idle splash — dismiss with any click or key</span></div>
                <button class="danger-btn" onclick={triggerSplash}
                  style={splashTriggered ? "background:var(--accent-fg);color:var(--bg-base);border-color:var(--accent-fg);transition:all 0.15s ease" : ""}>
                  Show idle
                </button>
              </div>
            </div>
            <div class="section">
              <p class="section-title">Build Info</p>
              <div class="about-block">
                <p class="about-line" style="font-family:monospace;font-size:11px;color:var(--text-faint)">Mode: {import.meta.env.MODE}</p>
              </div>
            </div>
          </div>
        {/if}

      </div>
    </div>
  </div>
</div>

<script module>
  function focusInput(node: HTMLElement) { node.focus(); }
  function focusEl(node: HTMLElement) { setTimeout(() => node.focus(), 0); }
</script>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: var(--z-settings); display: flex; align-items: center; justify-content: center; animation: fadeIn 0.1s ease both; backdrop-filter: blur(4px); }
  .modal { width: min(720px, calc(100vw - 48px)); height: min(600px, calc(100vh - 80px)); display: flex; background: var(--bg-surface); border: 1px solid var(--border-base); border-radius: var(--radius-xl); overflow: hidden; animation: scaleIn 0.15s ease both; box-shadow: 0 24px 64px rgba(0,0,0,0.6); }
  .sidebar { width: 168px; flex-shrink: 0; background: var(--bg-base); border-right: 1px solid var(--border-dim); padding: var(--sp-5) var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-1); overflow-y: auto; }
  .modal-title { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; padding: 0 var(--sp-2) var(--sp-3); }
  .nav { display: flex; flex-direction: column; gap: 1px; }
  .nav-item { display: flex; align-items: center; gap: var(--sp-2); padding: 6px var(--sp-2); border-radius: var(--radius-md); font-size: var(--text-sm); color: var(--text-muted); background: none; border: none; cursor: pointer; text-align: left; transition: background var(--t-fast), color var(--t-fast); }
  .nav-item:hover { background: var(--bg-raised); color: var(--text-secondary); }
  .nav-item.active { background: var(--accent-muted); color: var(--accent-fg); }
  .content { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
  .content-header { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-5) var(--sp-6) var(--sp-4); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; }
  .content-title { font-size: var(--text-base); font-weight: var(--weight-medium); color: var(--text-secondary); }
  .close-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--radius-sm); color: var(--text-faint); background: none; border: none; cursor: pointer; transition: color var(--t-base), background var(--t-base); }
  .close-btn:hover { color: var(--text-muted); background: var(--bg-raised); }
  .content-body { flex: 1; overflow-y: auto; }

  .panel { display: flex; flex-direction: column; gap: var(--sp-1); padding: var(--sp-4) var(--sp-6); }
  .section { display: flex; flex-direction: column; gap: 1px; border-bottom: 1px solid var(--border-dim); padding-bottom: var(--sp-4); margin-bottom: var(--sp-2); }
  .section:last-child { border-bottom: none; }
  .section-title { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; padding: var(--sp-3) var(--sp-3) var(--sp-2); }

  .toggle-row { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-3); border-radius: var(--radius-md); cursor: default; transition: background var(--t-fast); }
  .toggle-row:hover { background: var(--bg-raised); }
  .toggle-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; margin-right: var(--sp-4); }
  .toggle-label { font-size: var(--text-sm); color: var(--text-secondary); }
  .toggle-desc { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); line-height: var(--leading-snug); }
  .toggle { position: relative; width: 32px; height: 18px; border-radius: var(--radius-full); border: none; background: var(--bg-overlay); cursor: pointer; flex-shrink: 0; transition: background var(--t-base); border: 1px solid var(--border-strong); }
  .toggle.on { background: var(--accent); border-color: var(--accent); }
  .toggle-thumb { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--text-faint); transition: transform var(--t-base), background var(--t-base); }
  .toggle.on .toggle-thumb { transform: translateX(14px); background: var(--bg-void); }

  .step-row { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-3); border-radius: var(--radius-md); transition: background var(--t-fast); gap: var(--sp-3); }
  .step-row:hover { background: var(--bg-raised); }
  .step-controls { display: flex; align-items: center; gap: var(--sp-1); flex-shrink: 0; }
  .step-btn { font-family: var(--font-ui); font-size: var(--text-sm); width: 26px; height: 26px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: none; color: var(--text-muted); cursor: pointer; transition: color var(--t-base), border-color var(--t-base); display: flex; align-items: center; justify-content: center; }
  .step-btn:hover:not(:disabled) { color: var(--text-secondary); border-color: var(--border-strong); }
  .step-btn:disabled { opacity: 0.3; cursor: default; }
  .step-val { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-secondary); letter-spacing: var(--tracking-wide); min-width: 40px; text-align: center; }

  .select-wrap { position: relative; flex-shrink: 0; }
  .select-btn { display: flex; align-items: center; gap: var(--sp-2); font-size: var(--text-sm); color: var(--text-secondary); background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-md); padding: 5px 10px; cursor: pointer; min-width: 130px; transition: border-color var(--t-base); }
  .select-btn:hover { border-color: var(--border-strong); }
  .select-caret { color: var(--text-faint); transition: transform var(--t-base); flex-shrink: 0; margin-left: auto; }
  .select-caret.open { transform: rotate(180deg); }
  .select-menu { position: absolute; top: calc(100% + 4px); right: 0; min-width: 100%; background: var(--bg-raised); border: 1px solid var(--border-base); border-radius: var(--radius-md); padding: var(--sp-1); z-index: 200; box-shadow: 0 8px 24px rgba(0,0,0,0.4); animation: scaleIn 0.1s ease both; transform-origin: top right; }
  .select-option { display: block; width: 100%; padding: 6px var(--sp-3); border-radius: var(--radius-sm); font-size: var(--text-sm); color: var(--text-secondary); background: none; border: none; cursor: pointer; text-align: left; transition: background var(--t-fast), color var(--t-fast); }
  .select-option:hover { background: var(--bg-overlay); color: var(--text-primary); }
  .select-option.active { color: var(--accent-fg); background: var(--accent-muted); }

  .text-input { background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-md); padding: 5px 10px; color: var(--text-primary); font-size: var(--text-sm); outline: none; width: 200px; transition: border-color var(--t-base); flex-shrink: 0; }
  .text-input:focus { border-color: var(--border-strong); }

  .danger-btn { font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 5px 12px; border-radius: var(--radius-md); border: 1px solid var(--color-error); background: none; color: var(--color-error); cursor: pointer; flex-shrink: 0; transition: background var(--t-base); }
  .danger-btn:hover:not(:disabled) { background: var(--color-error-bg); }
  .danger-btn:disabled { opacity: 0.3; cursor: default; }

  .scale-row { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--sp-3); }
  .scale-slider { flex: 1; }
  .scale-val-input {
    font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-secondary);
    width: 42px; text-align: center; padding: 3px 4px;
    background: var(--bg-raised); border: 1px solid var(--border-dim);
    border-radius: var(--radius-sm); outline: none;
    transition: border-color var(--t-base);
    -moz-appearance: textfield;
  }
  .scale-val-input::-webkit-inner-spin-button,
  .scale-val-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .scale-val-input:focus { border-color: var(--border-strong); }
  .scale-pct { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); margin-left: calc(var(--sp-1) * -1); }
  .scale-hint { padding: 0 var(--sp-3) var(--sp-2); display: flex; gap: var(--sp-1); flex-wrap: wrap; }
  .scale-preset { font-family: var(--font-ui); font-size: var(--text-2xs); padding: 2px 7px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: none; color: var(--text-faint); cursor: pointer; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); }
  .scale-preset:hover { color: var(--text-muted); border-color: var(--border-strong); }
  .scale-preset.active { background: var(--accent-muted); border-color: var(--accent-dim); color: var(--accent-fg); }

  /* Theme */
  .theme-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: var(--sp-3); padding: var(--sp-2) var(--sp-3); }
  .theme-card { background: var(--bg-raised); border: 1px solid var(--border-dim); border-radius: var(--radius-lg); overflow: hidden; cursor: pointer; text-align: left; transition: border-color var(--t-base), box-shadow var(--t-base); position: relative; }
  .theme-card:hover { border-color: var(--border-strong); }
  .theme-card.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .theme-preview { height: 70px; overflow: hidden; }
  .theme-preview-bg { width: 100%; height: 100%; display: flex; }
  .theme-preview-sidebar { width: 20%; height: 100%; flex-shrink: 0; }
  .theme-preview-content { flex: 1; padding: 8px 6px; display: flex; flex-direction: column; gap: 5px; }
  .theme-preview-accent { height: 6px; width: 50%; border-radius: 3px; }
  .theme-preview-text { height: 4px; width: 100%; border-radius: 2px; }
  .theme-card-info { padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; }
  .theme-card-label { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-secondary); }
  .theme-card-desc { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .theme-card-check { position: absolute; top: 6px; right: 6px; font-size: 10px; color: var(--accent-fg); background: var(--accent-muted); border: 1px solid var(--accent-dim); border-radius: var(--radius-sm); padding: 1px 4px; }

  /* Keybinds */
  .kb-hint { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); padding: 0 var(--sp-3) var(--sp-3); }
  .kb-list { display: flex; flex-direction: column; gap: 1px; }
  .kb-row { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-md); transition: background var(--t-fast); }
  .kb-row:hover { background: var(--bg-raised); }
  .kb-label { font-size: var(--text-sm); color: var(--text-secondary); flex: 1; }
  .kb-right { display: flex; align-items: center; gap: var(--sp-2); }
  .kb-bind { font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 4px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: var(--bg-raised); color: var(--text-secondary); cursor: pointer; min-width: 90px; text-align: center; transition: border-color var(--t-base), color var(--t-base); }
  .kb-bind:hover { border-color: var(--border-strong); }
  .kb-bind.listening { border-color: var(--accent); color: var(--accent-fg); background: var(--accent-muted); animation: pulse 1s ease infinite; }
  @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.6 } }
  .kb-reset { font-size: var(--text-sm); color: var(--text-faint); padding: 3px 6px; border-radius: var(--radius-sm); border: 1px solid transparent; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); }
  .kb-reset:hover:not(:disabled) { color: var(--text-muted); border-color: var(--border-dim); background: var(--bg-overlay); }
  .kb-reset:disabled { opacity: 0.3; cursor: default; }

  /* Storage */
  .storage-loading { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); padding: var(--sp-3); }
  .storage-bar-wrap { padding: var(--sp-2) var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-2); }
  .storage-bar { height: 6px; background: var(--bg-overlay); border-radius: var(--radius-full); overflow: hidden; }
  .storage-bar-fill { height: 100%; background: var(--accent); border-radius: var(--radius-full); transition: width 0.4s ease; }
  .storage-bar-fill.warn { background: #d97706; }
  .storage-bar-fill.critical { background: var(--color-error); }
  .storage-bar-labels { display: flex; justify-content: space-between; }
  .storage-bar-used, .storage-bar-free { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .storage-legend { display: flex; flex-direction: column; gap: var(--sp-1); padding: 0 var(--sp-3); }
  .storage-legend-row { display: flex; align-items: center; gap: var(--sp-2); }
  .storage-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .storage-dot-manga { background: var(--accent); }
  .storage-dot-free  { background: var(--bg-overlay); border: 1px solid var(--border-strong); }
  .storage-dot-app   { background: var(--text-faint); }
  .storage-legend-label { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-muted); flex: 1; }
  .storage-legend-val   { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-secondary); }
  .storage-path-note { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); padding: var(--sp-2) var(--sp-3) 0; word-break: break-all; }

  /* Folders */
  .folder-create-row { display: flex; gap: var(--sp-2); padding: 0 var(--sp-3) var(--sp-3); }
  .folder-create-btn { display: flex; align-items: center; gap: var(--sp-1); font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 5px 12px; border-radius: var(--radius-md); background: var(--accent-muted); color: var(--accent-fg); border: 1px solid var(--accent-dim); cursor: pointer; flex-shrink: 0; transition: filter var(--t-base); }
  .folder-create-btn:hover:not(:disabled) { filter: brightness(1.1); }
  .folder-create-btn:disabled { opacity: 0.4; cursor: default; }
  .folder-list { display: flex; flex-direction: column; gap: 1px; padding: 0 var(--sp-3); }
  .folder-row { display: flex; align-items: center; gap: var(--sp-2); padding: 8px var(--sp-2); border-radius: var(--radius-md); transition: background var(--t-fast); }
  .folder-row:hover { background: var(--bg-raised); }
  .folder-row-name { flex: 1; font-size: var(--text-sm); color: var(--text-secondary); }
  .folder-row-count { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); flex-shrink: 0; }
  .folder-tab-toggle { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); padding: 2px 7px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: none; color: var(--text-faint); cursor: pointer; flex-shrink: 0; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); }
  .folder-tab-toggle.on { background: var(--accent-muted); border-color: var(--accent-dim); color: var(--accent-fg); }
  .folder-tab-toggle:hover { color: var(--text-muted); border-color: var(--border-strong); }
  .folder-delete:hover:not(:disabled) { color: var(--color-error) !important; }

  /* About */
  .about-block { padding: 0 var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-1); }
  .about-line { font-size: var(--text-sm); color: var(--text-muted); line-height: var(--leading-base); }

  /* Perf metrics */
  .perf-stat-group { display: flex; align-items: center; gap: var(--sp-2); flex-shrink: 0; }
  .perf-stat { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-secondary); letter-spacing: var(--tracking-wide); flex-shrink: 0; }

  /* Storage limit */
  .storage-limit-input {
    width: 64px; text-align: center;
    background: var(--bg-raised); border: 1px solid var(--border-dim);
    border-radius: var(--radius-sm); padding: 3px 6px;
    color: var(--text-secondary); font-family: var(--font-ui); font-size: var(--text-xs);
    outline: none; transition: border-color var(--t-base);
    -moz-appearance: textfield;
  }
  .storage-limit-input::-webkit-inner-spin-button,
  .storage-limit-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .storage-limit-input:focus { border-color: var(--border-strong); }
  .storage-limit-unit { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); flex-shrink: 0; }

  /* ── Release list ─────────────────────────────────────────────── */
  .release-list { display: flex; flex-direction: column; gap: 1px; padding: 0 var(--sp-1); }

  .release-row {
    border-radius: var(--radius-md);
    border: 1px solid transparent;
    transition: background var(--t-fast), border-color var(--t-fast);
    overflow: hidden;
  }
  .release-row:hover { background: var(--bg-raised); }
  .release-row.current {
    border-color: var(--accent-dim);
    background: var(--accent-muted);
  }

  .release-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: var(--sp-2) var(--sp-3); gap: var(--sp-3);
  }
  .release-meta { display: flex; align-items: center; gap: var(--sp-2); flex: 1; min-width: 0; flex-wrap: wrap; }
  .release-tag { font-family: var(--font-ui); font-size: var(--text-xs); font-weight: var(--weight-medium); color: var(--text-secondary); letter-spacing: var(--tracking-wide); flex-shrink: 0; }
  .release-badge { font-family: var(--font-ui); font-size: 10px; padding: 1px 5px; border-radius: var(--radius-sm); letter-spacing: var(--tracking-wide); flex-shrink: 0; }
  .current-badge { background: var(--accent-muted); border: 1px solid var(--accent-dim); color: var(--accent-fg); }
  .release-date { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); flex-shrink: 0; }

  .release-actions { display: flex; align-items: center; gap: var(--sp-2); flex-shrink: 0; }

  .release-changelog-btn {
    font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide);
    padding: 2px 8px; border-radius: var(--radius-sm);
    border: 1px solid var(--border-dim); background: none; color: var(--text-faint);
    cursor: pointer; transition: color var(--t-base), border-color var(--t-base);
  }
  .release-changelog-btn:hover { color: var(--text-muted); border-color: var(--border-strong); }

  .update-action-btn {
    font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide);
    padding: 3px 10px; border-radius: var(--radius-sm);
    border: 1px solid var(--border-dim); background: none; color: var(--text-muted);
    cursor: pointer; flex-shrink: 0;
    transition: color var(--t-base), border-color var(--t-base), background var(--t-base);
  }
  .update-action-btn:hover:not(:disabled) { color: var(--text-secondary); border-color: var(--border-strong); }
  .update-action-btn.primary { background: var(--accent-muted); border-color: var(--accent-dim); color: var(--accent-fg); }
  .update-action-btn.primary:hover:not(:disabled) { filter: brightness(1.1); }
  .update-action-btn:disabled { opacity: 0.4; cursor: default; }

  .release-body { padding: 0 var(--sp-3) var(--sp-3); }
  .release-body-pre {
    font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-muted);
    letter-spacing: var(--tracking-wide); line-height: var(--leading-snug);
    white-space: pre-wrap; word-break: break-word; margin: 0;
    max-height: 220px; overflow-y: auto;
  }

  /* ── Download progress bar ────────────────────────────────────── */
  .update-progress-wrap { padding: var(--sp-1) var(--sp-3) var(--sp-2); display: flex; flex-direction: column; gap: var(--sp-1); }
  .update-progress-bar { height: 4px; background: var(--bg-overlay); border-radius: var(--radius-full); overflow: hidden; }
  .update-progress-fill { height: 100%; background: var(--accent); border-radius: var(--radius-full); transition: width 0.3s ease; }
  .update-progress-row { display: flex; justify-content: space-between; align-items: center; }
  .update-progress-label { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .update-progress-val   { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-secondary); letter-spacing: var(--tracking-wide); }

  /* ── Ready-to-restart bar ─────────────────────────────────────── */
  .update-ready-row {
    display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap;
    padding: var(--sp-2) var(--sp-3);
    background: var(--accent-muted); border-radius: var(--radius-md);
    margin: 0 var(--sp-3) var(--sp-2);
  }
  .update-ready-label { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--accent-fg); letter-spacing: var(--tracking-wide); flex: 1; }
  .update-error-row { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-2) var(--sp-3); }

  /* ── Tracker styles ──────────────────────────────────────────────────────── */
  .tracker-list { display: flex; flex-direction: column; gap: var(--sp-2); padding: 0 var(--sp-3); }
  .tracker-row { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-4); padding: var(--sp-4); border-radius: var(--radius-md); border: 1px solid var(--border-dim); background: var(--bg-raised); transition: border-color var(--t-base); }
  .tracker-row-active { border-color: var(--accent-dim); background: var(--accent-muted); }
  .tracker-identity { display: flex; align-items: center; gap: var(--sp-3); flex-shrink: 0; }
  .tracker-logo { width: 28px; height: 28px; border-radius: var(--radius-sm); object-fit: contain; flex-shrink: 0; }
  .tracker-name-block { display: flex; flex-direction: column; gap: 3px; }
  .tracker-label { font-size: var(--text-sm); color: var(--text-secondary); font-weight: var(--weight-medium); }
  .tracker-status-pill { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wider); text-transform: uppercase; padding: 2px 7px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); color: var(--text-faint); background: var(--bg-overlay); width: fit-content; }
  .tracker-status-pill.pill-on { border-color: var(--accent-dim); color: var(--accent-fg); background: var(--accent-muted); }
  .tracker-action { display: flex; flex-direction: column; align-items: flex-end; gap: var(--sp-2); flex: 1; min-width: 0; }
  .tracker-error { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--color-error); background: var(--color-error-bg); border: 1px solid var(--color-error); border-radius: var(--radius-sm); padding: 6px var(--sp-3); margin: 0 var(--sp-3) var(--sp-2); letter-spacing: var(--tracking-wide); }
  .tracker-connected-btns { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; justify-content: flex-end; }
  .oauth-flow { display: flex; flex-direction: column; gap: var(--sp-2); width: 100%; align-items: flex-end; }
  .oauth-hint { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); line-height: var(--leading-snug); text-align: right; }
  .oauth-hint strong { color: var(--text-secondary); font-weight: var(--weight-medium); }
  .oauth-hint code { font-family: monospace; font-size: 10px; color: var(--text-muted); background: var(--bg-overlay); padding: 1px 4px; border-radius: 3px; }
  .oauth-input { width: 100%; background: var(--bg-overlay); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: 6px 10px; font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-secondary); outline: none; transition: border-color var(--t-base); }
  .oauth-input:focus { border-color: var(--border-focus); }
  .oauth-btns { display: flex; align-items: center; gap: var(--sp-2); }

  /* ── Security tab ───────────────────────────────────────────────────── */
  .sec-banner { font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: var(--sp-2) var(--sp-3); margin: 0 0 var(--sp-2); border-radius: var(--radius-sm); }
  .sec-banner-error { color: var(--color-error); background: var(--color-error-bg); border: 1px solid var(--color-error); }

  .section-title-row { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-3) var(--sp-3) var(--sp-2); }
  .section-title-row .section-title { padding: 0; }
  .sec-status-pill { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wider); text-transform: uppercase; padding: 2px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); color: var(--text-faint); background: var(--bg-overlay); flex-shrink: 0; cursor: default; }
  .sec-pill-on { border-color: var(--accent-dim); color: var(--accent-fg); background: var(--accent-muted); }

  .sec-field-wrap { position: relative; flex-shrink: 0; }
  .sec-field-wrap .text-input { padding-right: 34px; }
  .sec-eye-btn { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); display: flex; align-items: center; justify-content: center; padding: 0; border: none; background: none; color: var(--text-faint); cursor: pointer; transition: color var(--t-base); }
  .sec-eye-btn:hover { color: var(--text-muted); }

  .sec-btn-row { display: flex; align-items: center; gap: var(--sp-2); flex-shrink: 0; }
  .sec-action-btn { font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 5px 14px; border-radius: var(--radius-md); border: 1px solid var(--border-dim); background: none; color: var(--text-muted); cursor: pointer; flex-shrink: 0; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); }
  .sec-action-btn:hover:not(:disabled) { color: var(--text-secondary); border-color: var(--border-strong); }
  .sec-action-btn:disabled { opacity: 0.35; cursor: default; }
  .sec-action-primary { background: var(--accent-muted); border-color: var(--accent-dim); color: var(--accent-fg); }
  .sec-action-primary:hover:not(:disabled) { filter: brightness(1.1); }
  .sec-action-danger { border-color: var(--color-error); color: var(--color-error); }
  .sec-action-danger:hover:not(:disabled) { background: var(--color-error-bg); }

  .sec-pin-wrap { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
  .sec-pin-wrap .sec-pin-row { display: flex; align-items: center; gap: var(--sp-2); }
  .sec-pin-input { width: 96px; text-align: center; letter-spacing: 0.25em; }
  .sec-port-input { width: 88px; }
  .sec-pin-error { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--color-error); letter-spacing: var(--tracking-wide); }

  @keyframes fadeIn  { from { opacity: 0 }           to { opacity: 1 } }
  @keyframes scaleIn { from { transform: scale(0.97); opacity: 0 } to { transform: scale(1); opacity: 1 } }

  /* ── Custom theme cards ─────────────────────────────────────────────── */
  .custom-theme-card {
    position: relative;
    display: flex; flex-direction: column;
    padding: 0; cursor: default;
  }
  .custom-theme-select {
    flex: 1; text-align: left; cursor: pointer;
    display: flex; flex-direction: column;
    background: none; border: none; color: inherit;
    font-family: inherit;
  }
  .custom-badge {
    color: var(--accent-fg) !important;
  }
  .custom-theme-actions {
    display: none;
    position: absolute; top: 5px; left: 5px;
    flex-direction: row; gap: 3px;
    z-index: 1;
  }
  .custom-theme-card:hover .custom-theme-actions { display: flex; }

  .custom-theme-edit-btn,
  .custom-theme-delete-btn {
    display: flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; border-radius: 3px;
    font-size: 10px; cursor: pointer;
    border: 1px solid var(--border-base);
    background: var(--bg-overlay);
    transition: background var(--t-base), color var(--t-base), border-color var(--t-base);
  }
  .custom-theme-edit-btn { color: var(--text-muted); }
  .custom-theme-edit-btn:hover { color: var(--accent-fg); background: var(--accent-muted); border-color: var(--accent-dim); }
  .custom-theme-delete-btn { color: var(--text-faint); }
  .custom-theme-delete-btn:hover { color: var(--color-error); background: var(--color-error-bg); border-color: var(--color-error); }

  /* ── New theme button ───────────────────────────────────────────────── */
  .new-theme-card {
    display: flex; flex-direction: column;
    border-style: dashed !important;
    border-color: var(--border-base) !important;
    background: transparent !important;
    transition: border-color var(--t-base) !important, background var(--t-base) !important;
  }
  .new-theme-card:hover {
    border-color: var(--accent-dim) !important;
    background: var(--accent-muted) !important;
  }
  .new-theme-icon {
    height: 70px; display: flex; align-items: center; justify-content: center;
    color: var(--text-faint);
    transition: color var(--t-base);
  }
  .new-theme-card:hover .new-theme-icon { color: var(--accent-fg); }
</style>
