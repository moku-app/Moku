<script lang="ts">
  import { tick } from "svelte";
  import { X, Book, Image, Sliders, Info, Keyboard, Gear, HardDrives, FolderSimple, Plus, Pencil, Trash, Wrench, PaintBrush, ListChecks, Lock, Eye, EyeSlash, Star, ShieldCheck, Tag, ClockCounterClockwise } from "phosphor-svelte";
  import ThreeDCard from "../shared/ThreeDCard.svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { getVersion } from "@tauri-apps/api/app";
  import { open as openUrl } from "@tauri-apps/plugin-shell";
  import { gql, thumbUrl } from "../../lib/client";
  import { GET_CATEGORIES, CREATE_CATEGORY, UPDATE_CATEGORY, DELETE_CATEGORY, UPDATE_CATEGORY_ORDER, GET_SOURCES } from "../../lib/queries";
  import { GET_DOWNLOADS_PATH, SET_DOWNLOADS_PATH, SET_LOCAL_SOURCE_PATH, GET_TRACKERS, LOGIN_TRACKER_OAUTH, LOGIN_TRACKER_CREDENTIALS, LOGOUT_TRACKER, GET_TRACKER_RECORDS, GET_SERVER_SECURITY, SET_SERVER_AUTH, SET_SOCKS_PROXY, SET_FLARESOLVERR, CREATE_BACKUP, RESTORE_BACKUP, GET_RESTORE_STATUS, VALIDATE_BACKUP } from "../../lib/queries";
  import type { Category, Source } from "../../lib/types";
  import { store, updateSettings, resetKeybinds, clearHistory, wipeAllData, setSettingsOpen, deleteCustomTheme, toggleHiddenCategory, setCategories, addToast } from "../../store/state.svelte";
  import { authSession } from "../../lib/auth";
  import { cache } from "../../lib/cache";
  import { KEYBIND_LABELS, DEFAULT_KEYBINDS, eventToKeybind } from "../../lib/keybinds";
  import type { Settings, FitMode, Theme } from "../../store/state.svelte";
  import type { Keybinds } from "../../lib/keybinds";
  import type { Tracker } from "../../lib/types";
  interface Props {
    onOpenThemeEditor?: (id?: string | null) => void;
  }
  let { onOpenThemeEditor }: Props = $props();
  type Tab = "general" | "appearance" | "reader" | "library" | "performance" | "keybinds" | "storage" | "folders" | "tracking" | "security" | "content" | "about" | "devtools";
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
    { id: "content",    label: "Content",     icon: ShieldCheck },
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

  // ── External server detection ─────────────────────────────────────────────────
  // A server is "external" if its URL doesn't point to localhost — in that case we
  // cannot invoke Tauri commands against its filesystem (path validation, disk usage,
  // migration). We can still read the server's paths via GraphQL, but we must never
  // overwrite the server's download directory config without the user explicitly asking.
  const isExternalServer = $derived.by(() => {
    const url = (store.settings.serverUrl ?? "http://localhost:4567").toLowerCase().trim();
    try {
      const host = new URL(url).hostname;
      return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
    } catch { return false; }
  });

  // ── Download path editing ────────────────────────────────────────────────────
  let downloadsPathInput    = $state(store.settings.serverDownloadsPath ?? "");
  let localSourcePathInput  = $state(store.settings.serverLocalSourcePath ?? "");
  let pathsSaving           = $state(false);
  let pathsError: string | null = $state(null);
  let pathsFieldError: { dl?: string; loc?: string } = $state({});
  let pathsSaved            = $state(false);

  // The actual resolved default path from Rust — shown as placeholder + scanned when dl path is empty.
  // Only meaningful for local servers — Tauri can't stat a remote filesystem.
  // Re-fetches reactively when the server URL changes (e.g. user switches to local).
  let defaultDownloadsPath  = $state("");
  $effect(() => {
    if (!isExternalServer) {
      invoke<string>("get_default_downloads_path").then(p => { defaultDownloadsPath = p; });
    } else {
      defaultDownloadsPath = "";
    }
  });

  // The last confirmed server paths — used to detect a change requiring migration
  let confirmedDownloadsPath   = $state(store.settings.serverDownloadsPath ?? "");
  let confirmedLocalSourcePath = $state(store.settings.serverLocalSourcePath ?? "");

  // ── Migration state ──────────────────────────────────────────────────────────
  let migrateFrom: string | null   = $state(null); // old path that has content
  let migrateTo:   string | null   = $state(null); // new path
  let migrating                    = $state(false);
  let migrateProgress: { done: number; total: number; current: string } | null = $state(null);
  let migrateError: string | null  = $state(null);
  let migrateUnlisten: (() => void) | null = null;

  // ── Extra scan directories (local-only, stored in app settings) ──────────────
  let extraScanDirs: string[]   = $state([...(store.settings.extraScanDirs ?? [])]);
  let newScanDir                = $state("");
  let multiStorageInfos: (StorageInfo & { label: string })[] = $state([]);
  let advStorageOpen            = $state(false);
  let backupSectionOpen         = $state(false);

  async function fetchStorage() {
    storageLoading = true; storageError = null;
    try {
      // Always pull the current paths from the server via GQL — works for local and external.
      const pathData = await gql<{ settings: { downloadsPath: string; localSourcePath: string } }>(GET_DOWNLOADS_PATH);
      const dl  = pathData.settings.downloadsPath  ?? "";
      const loc = pathData.settings.localSourcePath ?? "";

      downloadsPathInput    = dl;
      localSourcePathInput  = loc;
      confirmedDownloadsPath   = dl;
      confirmedLocalSourcePath = loc;
      updateSettings({ serverDownloadsPath: dl, serverLocalSourcePath: loc });

      // Disk usage scanning uses Tauri invoke — only possible when the server is local.
      // For external servers we display the paths pulled above but skip the filesystem scan.
      if (isExternalServer) {
        multiStorageInfos = []; storageInfo = null; return;
      }

      // When dl is empty the server uses the default path — scan that instead
      const effectiveDl = dl || defaultDownloadsPath;

      const dirsToScan: { path: string; label: string }[] = [];
      if (effectiveDl) dirsToScan.push({ path: effectiveDl, label: dl ? "Downloads" : "Downloads (default)" });
      if (loc && loc !== effectiveDl) dirsToScan.push({ path: loc, label: "Local source" });
      for (const p of extraScanDirs) {
        if (p && !dirsToScan.find(d => d.path === p)) dirsToScan.push({ path: p, label: p });
      }

      if (dirsToScan.length === 0) {
        multiStorageInfos = []; storageInfo = null; return;
      }

      const results = await Promise.allSettled(
        dirsToScan.map(d =>
          invoke<StorageInfo>("get_storage_info", { downloadsPath: d.path })
            .then(info => ({ ...info, label: d.label }))
        )
      );

      multiStorageInfos = results
        .filter((r): r is PromiseFulfilledResult<StorageInfo & { label: string }> => r.status === "fulfilled")
        .map(r => r.value);
      storageInfo = multiStorageInfos[0] ?? null;
    } catch (e: any) {
      storageError = e instanceof Error ? e.message : String(e);
    } finally {
      storageLoading = false;
    }
  }

  /** Validate a path exists on disk. Returns error string or null.
   *  Only runs for local servers — we can't stat a remote filesystem via Tauri. */
  async function validatePath(path: string): Promise<string | null> {
    if (!path.trim()) return null; // empty = use default, always valid
    if (isExternalServer) return null; // can't check remote paths locally
    try {
      const exists = await invoke<boolean>("check_path_exists", { path: path.trim() });
      return exists ? null : "Directory does not exist";
    } catch {
      return "Could not check path";
    }
  }

  /** Create a directory on disk via Tauri. Only valid for local servers. */
  async function createDirectory(path: string): Promise<void> {
    if (isExternalServer) throw new Error("Cannot create directories on an external server");
    await invoke("create_directory", { path });
  }

  async function savePaths() {
    const dl  = downloadsPathInput.trim();
    const loc = localSourcePathInput.trim();
    pathsError = null; pathsFieldError = {};

    // Validate paths exist before touching the server (empty = use default = always valid).
    // Skipped for external servers — we can't stat their filesystem.
    const [dlErr, locErr] = await Promise.all([validatePath(dl), validatePath(loc)]);
    if (dlErr || locErr) {
      pathsFieldError = { ...(dlErr ? { dl: dlErr } : {}), ...(locErr ? { loc: locErr } : {}) };
      return;
    }

    pathsSaving = true;
    try {
      // Send each mutation independently — localSourcePath rejects empty string server-side
      await gql(SET_DOWNLOADS_PATH, { path: dl });
      if (loc) await gql(SET_LOCAL_SOURCE_PATH, { path: loc });

      updateSettings({ serverDownloadsPath: dl, serverLocalSourcePath: loc });

      // Migration requires local filesystem access — skip for external servers.
      if (!isExternalServer) {
        const oldDl = confirmedDownloadsPath || defaultDownloadsPath;
        const newDl = dl || defaultDownloadsPath;
        if (newDl && oldDl && newDl !== oldDl) {
          const hadContent = await invoke<boolean>("check_path_exists", { path: oldDl });
          if (hadContent) { migrateFrom = oldDl; migrateTo = newDl; }
        }
      }

      confirmedDownloadsPath   = dl;
      confirmedLocalSourcePath = loc;
      pathsSaved = true;
      setTimeout(() => pathsSaved = false, 2000);
      await fetchStorage();
    } catch (e: any) {
      pathsError = e?.message ?? "Failed to save paths";
    } finally {
      pathsSaving = false;
    }
  }

  async function startMigration() {
    if (!migrateFrom || !migrateTo) return;
    migrating = true; migrateError = null; migrateProgress = { done: 0, total: 0, current: "" };

    // Subscribe to progress events from Tauri
    const { listen } = await import("@tauri-apps/api/event");
    migrateUnlisten = await listen<{ done: number; total: number; current: string }>(
      "migrate_progress",
      (e) => { migrateProgress = e.payload; }
    );

    try {
      await invoke("migrate_downloads", { src: migrateFrom, dst: migrateTo });
      migrateFrom = null; migrateTo = null; migrateProgress = null;
      await fetchStorage();
    } catch (e: any) {
      migrateError = e?.message ?? "Migration failed";
    } finally {
      migrating = false;
      migrateUnlisten?.(); migrateUnlisten = null;
    }
  }

  function dismissMigration() {
    migrateFrom = null; migrateTo = null; migrateError = null; migrateProgress = null;
  }

  async function browseDownloadsFolder() {
    const picked = await invoke<string | null>("pick_downloads_folder");
    if (picked) {
      downloadsPathInput = picked;
      pathsFieldError = { ...pathsFieldError, dl: undefined };
    }
  }

  function addExtraScanDir() {
    const dir = newScanDir.trim();
    if (!dir || extraScanDirs.includes(dir)) return;
    extraScanDirs = [...extraScanDirs, dir];
    updateSettings({ extraScanDirs });
    newScanDir = "";
    fetchStorage();
  }

  function removeExtraScanDir(path: string) {
    extraScanDirs = extraScanDirs.filter(d => d !== path);
    updateSettings({ extraScanDirs });
    fetchStorage();
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
  $effect(() => { if (tab === "performance" || tab === "devtools") refreshPerfMetrics(); });
  function fmtAge(ts: number | null): string {
    if (ts === null) return "—";
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  }
  let storageLimitInput = $state(String(store.settings.storageLimitGb ?? ""));
  function applyStorageLimit() {
    const v = storageLimitInput.trim();
    if (v === "" || v === "0") { updateSettings({ storageLimitGb: null }); return; }
    const n = parseFloat(v);
    if (!isNaN(n) && n > 0) updateSettings({ storageLimitGb: n });
  }
  let catsLoading:    boolean      = $state(false);
  let catsError:      string|null  = $state(null);
  let newFolderName   = $state("");
  let editingId: number | null     = $state(null);
  let editingName     = $state("");
  async function loadCategories() {
    catsLoading = true; catsError = null;
    try {
      const res = await gql<{ categories: { nodes: Category[] } }>(GET_CATEGORIES);
      const zeroCat = store.categories.filter(c => c.id === 0);
      const fresh = res.categories.nodes.filter(c => c.id !== 0);
      const merged = fresh.map(f => {
        const existing = store.categories.find(c => c.id === f.id);
        return existing ? { ...existing, ...f } : f;
      });
      setCategories([...zeroCat, ...merged]);
    } catch (e: any) {
      catsError = e?.message ?? "Failed to load folders";
    } finally { catsLoading = false; }
  }
  async function createFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      const res = await gql<{ createCategory: { category: Category } }>(CREATE_CATEGORY, { name });
      setCategories([...store.categories, res.createCategory.category]);
      newFolderName = "";
    } catch (e: any) { catsError = e?.message ?? "Failed to create folder"; }
  }
  function startEdit(id: number, name: string) { editingId = id; editingName = name; }
  async function commitEdit() {
    if (editingId !== null && editingName.trim()) {
      try {
        await gql(UPDATE_CATEGORY, { id: editingId, name: editingName.trim() });
        setCategories(store.categories.map(c => c.id === editingId ? { ...c, name: editingName.trim() } : c));
      } catch (e: any) { catsError = e?.message ?? "Failed to rename"; }
    }
    editingId = null; editingName = "";
  }
  async function deleteFolder(id: number) {
    try {
      await gql(DELETE_CATEGORY, { id });
      setCategories(store.categories.filter(c => c.id !== id));
    } catch (e: any) { catsError = e?.message ?? "Failed to delete folder"; }
  }
  async function moveCategory(id: number, direction: -1 | 1) {
    const zeroCat  = store.categories.filter(c => c.id === 0);
    const sortable = store.categories
      .filter(c => c.id !== 0)
      .sort((a, b) => a.order - b.order);
    const idx = sortable.findIndex(c => c.id === id);
    if (idx < 0) return;
    const newPos = idx + 1 + direction; // 1-based server position
    if (newPos < 1 || newPos > sortable.length) return;
    const reordered = [...sortable];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(idx + direction, 0, moved);
    setCategories([...zeroCat, ...reordered.map((c, i) => ({ ...c, order: i + 1 }))]);
    try {
      const res = await gql<{ updateCategoryOrder: { categories: Category[] } }>(UPDATE_CATEGORY_ORDER, { id, position: newPos });
      const updated = res.updateCategoryOrder.categories.filter(c => c.id !== 0);
      setCategories([
        ...zeroCat,
        ...updated
          .sort((a, b) => a.order - b.order)
          .map(fresh => {
            const existing = store.categories.find(c => c.id === fresh.id);
            return existing ? { ...existing, ...fresh } : fresh;
          }),
      ]);
    } catch (e: any) {
      catsError = e?.message ?? "Failed to reorder";
      await loadCategories();
    }
  }
  $effect(() => { if (tab === "folders" && !store.categories.length && !catsLoading) loadCategories(); });
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
  let expOpen         = $state(false);
  let showAuthPass     = $state(false);
  let showSocksPass    = $state(false);
  let pinInput         = $state(store.settings.appLockPin ?? "");
  let pinError         = $state("");
  let secLoading       = $state(false);
  let secError         = $state<string | null>(null);
  let secSaved         = $state<string | null>(null);
  let authMode         = $state(store.settings.serverAuthMode ?? "NONE");
  // Warning is based on what the server has confirmed (store value), not the
  // local draft — so it doesn't fire just because the store has a stale value
  // before loadServerSecurity runs, and it clears once the user saves a
  // supported mode.
  const authModeUnsupported = $derived(
    store.settings.serverAuthMode === "SIMPLE_LOGIN" ||
    store.settings.serverAuthMode === "UI_LOGIN"
  );
  let authUsername     = $state(store.settings.serverAuthUser ?? "");
  let authPassword     = $state("");
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
  let secLoaded        = $state(false);
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
      const mode = (s.authMode ?? "NONE") as "NONE" | "BASIC_AUTH" | "SIMPLE_LOGIN" | "UI_LOGIN";
      authMode     = mode;
      authUsername = s.authUsername;
      updateSettings({ serverAuthMode: mode, serverAuthUser: s.authUsername });
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
      secLoaded = true;
    } catch {}
  }
  $effect(() => { if (tab === "security" && !secLoaded) loadServerSecurity(); });
  async function saveAuth() {
    if (authMode === "BASIC_AUTH" && (!authUsername.trim() || !authPassword.trim())) {
      secError = "Username and password are required for Basic Auth"; return;
    }
    secLoading = true; secError = null;

    const prevMode = store.settings.serverAuthMode;
    const prevUser = store.settings.serverAuthUser;
    const prevPass = store.settings.serverAuthPass;
    const newUser  = authMode === "BASIC_AUTH" ? authUsername.trim() : "";
    const newPass  = authMode === "BASIC_AUTH" ? authPassword.trim() : "";

    // The store must contain valid credentials while the mutation request is
    // in-flight so fetchAuthenticated can authenticate it:
    //   - Updating credentials: server still accepts the OLD password, so keep
    //     the old credentials in the store until the server confirms the change.
    //   - First-time enable (store has no pass yet): pre-commit the new
    //     credentials because there is nothing else to send.
    const isFirstTimeEnable = authMode === "BASIC_AUTH" && !prevPass.trim();
    if (isFirstTimeEnable) {
      updateSettings({ serverAuthMode: authMode as any, serverAuthUser: newUser, serverAuthPass: newPass });
    }

    try {
      await gql(SET_SERVER_AUTH, { authMode, authUsername: newUser, authPassword: newPass });
      // On success, commit new credentials (no-op if already pre-committed).
      updateSettings({ serverAuthMode: authMode as any, serverAuthUser: newUser, serverAuthPass: newPass });
      if (authMode === "NONE") { authSession.clearTokens(); authPassword = ""; }
      showSaved("auth");
    } catch (e: any) {
      // Roll back to previous values on failure.
      updateSettings({ serverAuthMode: prevMode, serverAuthUser: prevUser, serverAuthPass: prevPass });
      secError = e?.message ?? "Failed to save authentication settings";
    } finally { secLoading = false; }
  }

  async function clearAuth() {
    secLoading = true; secError = null;
    const prevMode = store.settings.serverAuthMode;
    const prevUser = store.settings.serverAuthUser;
    const prevPass = store.settings.serverAuthPass;
    // Keep existing credentials in the store so the disable-auth mutation
    // goes out authenticated, then clear them on success.
    try {
      await gql(SET_SERVER_AUTH, { authMode: "NONE", authUsername: "", authPassword: "" });
      updateSettings({ serverAuthMode: "NONE", serverAuthUser: "", serverAuthPass: "" });
      authMode = "NONE"; authUsername = ""; authPassword = "";
      authSession.clearTokens();
      showSaved("auth");
    } catch (e: any) {
      updateSettings({ serverAuthMode: prevMode, serverAuthUser: prevUser, serverAuthPass: prevPass });
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
  let trackers:        Tracker[]    = $state([]);
  let trackersLoading: boolean      = $state(false);
  let trackersError:   string|null  = $state(null);
  let oauthTrackerId:  number|null  = $state(null);
  let oauthCallbackInput: string    = $state("");
  let oauthSubmitting: boolean      = $state(false);
  let credsTrackerId:  number|null  = $state(null);
  let credsUsername:   string       = $state("");
  let credsPassword:   string       = $state("");
  let credsSubmitting: boolean      = $state(false);
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
  function usesOAuth(t: Tracker): boolean { return !!t.authUrl; }
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
      releases = all.filter(r => typeof r.tag_name === "string" && r.tag_name.trim());
    } catch (e: any) {
      releasesError = e instanceof Error ? e.message : String(e);
    } finally {
      releasesLoading = false;
    }
  }
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
        try { await invoke("kill_server"); } catch {}
        await invoke("download_and_install_update");
        updatePhase = "ready";
      } else {
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
  let contentSources:        Source[] = $state([]);
  let contentSourcesLoading: boolean  = $state(false);
  let newTagInput:           string   = $state("");
  let tagsRevealed:          boolean  = $state(false);
  let sourceSearch:          string   = $state("");
  $effect(() => {
    if (tab === "content" && contentSources.length === 0 && !contentSourcesLoading) {
      loadContentSources();
    }
  });
  async function loadContentSources() {
    contentSourcesLoading = true;
    try {
      const d = await gql<{ sources: { nodes: Source[] } }>(GET_SOURCES);
      contentSources = d.sources.nodes.filter(s => s.id !== "0");
    } catch (e) { console.error(e); }
    finally { contentSourcesLoading = false; }
  }
  function addTag() {
    const t = newTagInput.trim().toLowerCase();
    if (!t) return;
    const tags = store.settings.nsfwFilteredTags ?? [];
    if (!tags.includes(t)) updateSettings({ nsfwFilteredTags: [...tags, t] });
    newTagInput = "";
  }
  function removeTag(tag: string) {
    updateSettings({ nsfwFilteredTags: (store.settings.nsfwFilteredTags ?? []).filter(t => t !== tag) });
  }
  function resetTags() {
    updateSettings({ nsfwFilteredTags: ["adult", "mature", "hentai", "ecchi", "erotic", "pornograph", "18+", "smut", "lemon", "explicit", "sexual violence"] });
  }
  function toggleSourceAllowed(ids: string[]) {
    const allowed = store.settings.nsfwAllowedSourceIds ?? [];
    const blocked = store.settings.nsfwBlockedSourceIds ?? [];
    const allAllowed = ids.every(id => allowed.includes(id));
    if (allAllowed) {
      updateSettings({ nsfwAllowedSourceIds: allowed.filter(x => !ids.includes(x)) });
    } else {
      updateSettings({
        nsfwAllowedSourceIds: [...allowed.filter(x => !ids.includes(x)), ...ids],
        nsfwBlockedSourceIds: blocked.filter(x => !ids.includes(x)),
      });
    }
  }
  // ── Backup ────────────────────────────────────────────────────────────────────
  let backupLoading    = $state(false);
  let backupError: string | null = $state(null);
  let backupList: { url: string; name: string; deleting?: boolean }[] = $state(
    JSON.parse(localStorage.getItem("moku_backups") ?? "[]")
  );

  function saveBackupList() {
    localStorage.setItem("moku_backups", JSON.stringify(backupList));
  }

  async function createBackup() {
    backupLoading = true; backupError = null;
    try {
      const res = await gql<{ createBackup: { url: string } }>(CREATE_BACKUP);
      const url = res.createBackup.url;
      const name = url.split("/").pop() ?? url;
      backupList = [{ url, name }, ...backupList];
      saveBackupList();
    } catch (e: any) {
      backupError = e?.message ?? "Failed to create backup";
    } finally {
      backupLoading = false;
    }
  }

  async function deleteBackup(url: string) {
    backupList = backupList.map(b => b.url === url ? { ...b, deleting: true } : b);
    try {
      const serverUrl = (store.settings.serverUrl ?? "http://localhost:4567").replace(/\/$/, "");
      const headers: Record<string, string> = {};
      const pass = store.settings.serverAuthPass ?? "";
      const user = store.settings.serverAuthUser ?? "";
      if (store.settings.serverAuthMode === "BASIC_AUTH" && user && pass) {
        headers["Authorization"] = "Basic " + btoa(`${user}:${pass}`);
      }
      await fetch(`${serverUrl}${url}`, { method: "DELETE", headers });
      backupList = backupList.filter(b => b.url !== url);
      saveBackupList();
    } catch (e: any) {
      backupList = backupList.map(b => b.url === url ? { ...b, deleting: false } : b);
      backupError = (e as any)?.message ?? "Failed to delete backup";
    }
  }
  async function downloadBackup(backup: { url: string; name: string }) {
    try {
      const serverUrl = (store.settings.serverUrl ?? "http://localhost:4567").replace(/\/$/, "");
      const headers: Record<string, string> = {};
      const pass = store.settings.serverAuthPass ?? "";
      const user = store.settings.serverAuthUser ?? "";
      if (store.settings.serverAuthMode === "BASIC_AUTH" && user && pass) {
        headers["Authorization"] = "Basic " + btoa(`${user}:${pass}`);
      }
      const resp = await fetch(`${serverUrl}${backup.url}`, { headers });
      if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
      const blob = await resp.blob();

      // Try File System Access API (lets user pick save location)
      if ("showSaveFilePicker" in window) {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: backup.name,
            types: [{ description: "Backup file", accept: { "application/octet-stream": [".tachibk", ".proto.gz"] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          addToast({ kind: "success", title: "Backup saved", body: backup.name });
          return;
        } catch (pickerErr: any) {
          // User cancelled the picker — abort silently
          if (pickerErr?.name === "AbortError") return;
          // Otherwise fall through to classic download
        }
      }

      // Fallback: classic anchor download
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = backup.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
      addToast({ kind: "download", title: "Backup downloaded", body: backup.name });
    } catch (e: any) {
      backupError = e?.message ?? "Failed to download backup";
    }
  }

  let restoreLoading = $state(false);
  let restoreError: string | null = $state(null);
  let restoreJobId: string | null = $state(null);
  let restoreStatus: { mangaProgress: number; state: string; totalManga: number } | null = $state(null);
  let restorePollInterval: ReturnType<typeof setInterval> | null = null;

  let validateLoading = $state(false);
  let validateError: string | null = $state(null);
  let validateResult: { missingSources: { id: string; name: string }[]; missingTrackers: { name: string }[] } | null = $state(null);

  let restoreFile: File | null   = $state(null);

  function stopRestorePoll() {
    if (restorePollInterval) { clearInterval(restorePollInterval); restorePollInterval = null; }
  }

  async function pollRestoreStatus(id: string) {
    try {
      const res = await gql<{ restoreStatus: typeof restoreStatus }>(GET_RESTORE_STATUS, { id });
      restoreStatus = res.restoreStatus;
      if (res.restoreStatus?.state === "SUCCESS" || res.restoreStatus?.state === "FAILURE") {
        stopRestorePoll();
      }
    } catch {}
  }

  async function submitRestore() {
    if (!restoreFile) return;
    restoreLoading = true; restoreError = null; restoreStatus = null; restoreJobId = null;
    stopRestorePoll();
    try {
      const serverUrl = (store.settings.serverUrl ?? "http://localhost:4567").replace(/\/$/, "");
      const form = new FormData();
      const operations = JSON.stringify({
        query: `mutation RestoreBackup($backup: Upload!) { restoreBackup(input: { backup: $backup }) { id status { mangaProgress state totalManga } } }`,
        variables: { backup: null }
      });
      form.append("operations", operations);
      form.append("map", JSON.stringify({ "0": ["variables.backup"] }));
      form.append("0", restoreFile, restoreFile.name);

      const headers: Record<string, string> = { "Accept": "application/json" };
      const pass = store.settings.serverAuthPass ?? "";
      const user = store.settings.serverAuthUser ?? "";
      if (store.settings.serverAuthMode === "BASIC_AUTH" && user && pass) {
        headers["Authorization"] = "Basic " + btoa(`${user}:${pass}`);
      }

      const resp = await fetch(`${serverUrl}/api/graphql`, { method: "POST", headers, body: form });
      const json = await resp.json();
      if (json.errors?.length) throw new Error(json.errors[0].message);

      const result = json.data.restoreBackup;
      restoreJobId = result.id;
      restoreStatus = result.status;
      if (result.status?.state !== "SUCCESS" && result.status?.state !== "FAILURE") {
        restorePollInterval = setInterval(() => pollRestoreStatus(result.id), 1500);
      }
    } catch (e: any) {
      restoreError = e?.message ?? "Failed to start restore";
    } finally {
      restoreLoading = false;
    }
  }

  async function submitValidate() {
    if (!restoreFile) return;
    validateLoading = true; validateError = null; validateResult = null;
    try {
      const serverUrl = (store.settings.serverUrl ?? "http://localhost:4567").replace(/\/$/, "");
      const form = new FormData();
      const operations = JSON.stringify({
        query: `query ValidateBackup($backup: Upload!) { validateBackup(input: { backup: $backup }) { missingSources { id name } missingTrackers { name } } }`,
        variables: { backup: null }
      });
      form.append("operations", operations);
      form.append("map", JSON.stringify({ "0": ["variables.backup"] }));
      form.append("0", restoreFile, restoreFile.name);

      const headers: Record<string, string> = { "Accept": "application/json" };
      const pass = store.settings.serverAuthPass ?? "";
      const user = store.settings.serverAuthUser ?? "";
      if (store.settings.serverAuthMode === "BASIC_AUTH" && user && pass) {
        headers["Authorization"] = "Basic " + btoa(`${user}:${pass}`);
      }

      const resp = await fetch(`${serverUrl}/api/graphql`, { method: "POST", headers, body: form });
      const json = await resp.json();
      if (json.errors?.length) throw new Error(json.errors[0].message);
      validateResult = json.data.validateBackup;
    } catch (e: any) {
      validateError = e?.message ?? "Failed to validate backup";
    } finally {
      validateLoading = false;
    }
  }

  $effect(() => { if (tab !== "storage") stopRestorePoll(); });

  function toggleSourceBlocked(ids: string[]) {
    const allowed = store.settings.nsfwAllowedSourceIds ?? [];
    const blocked = store.settings.nsfwBlockedSourceIds ?? [];
    const allBlocked = ids.every(id => blocked.includes(id));
    if (allBlocked) {
      updateSettings({ nsfwBlockedSourceIds: blocked.filter(x => !ids.includes(x)) });
    } else {
      updateSettings({
        nsfwBlockedSourceIds: [...blocked.filter(x => !ids.includes(x)), ...ids],
        nsfwAllowedSourceIds: allowed.filter(x => !ids.includes(x)),
      });
    }
  }
  interface ContentSourceGroup {
    name:    string;
    iconUrl: string;
    isNsfw:  boolean;
    sources: Source[];
  }
  const contentSourcesFiltered = $derived.by(() => {
    const q = sourceSearch.trim().toLowerCase();
    const filtered = q
      ? contentSources.filter(s => s.displayName.toLowerCase().includes(q) || s.lang.toLowerCase().includes(q))
      : contentSources;
    const map = new Map<string, ContentSourceGroup>();
    for (const s of filtered) {
      const key = s.name;
      if (!map.has(key)) map.set(key, { name: s.name, iconUrl: s.iconUrl, isNsfw: s.isNsfw, sources: [] });
      map.get(key)!.sources.push(s);
    }
    return Array.from(map.values());
  });
</script>
<div class="backdrop" role="presentation" tabindex="-1" onclick={(e) => { if (e.target === e.currentTarget) close(); }} onkeydown={(e) => { if (e.key === "Escape") close(); }}>
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
        <div class="content-header-left">
          {#each TABS as t}
            {#if t.id === tab}
              <t.icon size={13} weight="light" class="content-header-icon" />
            {/if}
          {/each}
          <p class="content-title">{TABS.find((t) => t.id === tab)?.label}</p>
        </div>
        <button class="close-btn" aria-label="Close settings" onclick={close}><X size={15} weight="light" /></button>
      </div>
      <div class="content-body" bind:this={contentBodyEl}>
        {#if tab === "general"}
          <div class="panel">
            <div class="section">
              <p class="section-title">Interface Scale</p>
              <div class="scale-row">
                <input type="range" min={50} max={200} step={5}
                  value={Math.round((store.settings.uiZoom ?? 1.0) * 100)}
                  oninput={(e) => updateSettings({ uiZoom: Number(e.currentTarget.value) / 100 })}
                  class="scale-slider" />
                <input
                  type="number" min={50} max={200} step={1}
                  class="scale-val-input"
                  value={Math.round((store.settings.uiZoom ?? 1.0) * 100)}
                  oninput={(e) => {
                    const n = parseInt(e.currentTarget.value, 10);
                    if (!isNaN(n) && n >= 50 && n <= 200) updateSettings({ uiZoom: n / 100 });
                  }}
                  onblur={(e) => {
                    const n = parseInt(e.currentTarget.value, 10);
                    if (isNaN(n) || n < 50) { updateSettings({ uiZoom: 0.5 }); e.currentTarget.value = "50"; }
                    else if (n > 200) { updateSettings({ uiZoom: 2.0 }); e.currentTarget.value = "200"; }
                  }}
                />
                <span class="scale-pct">%</span>
                <button class="step-btn" onclick={() => updateSettings({ uiZoom: 1.0 })} disabled={(store.settings.uiZoom ?? 1.0) === 1.0} title="Reset to 100%">↺</button>
              </div>
              <p class="scale-hint">
                {#each [50,60,70,80,90,100,110,125,150,175,200] as v}
                  <button class="scale-preset" class:active={Math.round((store.settings.uiZoom ?? 1.0) * 100) === v} onclick={() => updateSettings({ uiZoom: v / 100 })}>{v}%</button>
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
            <div class="section">
              <p class="section-title">Integrations</p>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Discord Rich Presence</span><span class="toggle-desc">Show what you're reading in your Discord status</span></div>
                <button role="switch" aria-checked={store.settings.discordRpc} aria-label="Discord Rich Presence" class="toggle" class:on={store.settings.discordRpc} onclick={() => updateSettings({ discordRpc: !store.settings.discordRpc })}><span class="toggle-thumb"></span></button>
              </label>
            </div>
            <div class="section">
              <p class="section-title">Language</p>
              <div class="step-row">
                <div class="toggle-info">
                  <span class="toggle-label">Preferred source language</span>
                  <span class="toggle-desc">Used to pre-select languages in Search and deduplicate sources</span>
                </div>
                <input
                  class="text-input"
                  value={store.settings.preferredExtensionLang ?? ""}
                  oninput={(e) => updateSettings({ preferredExtensionLang: e.currentTarget.value.trim().toLowerCase() })}
                  placeholder="e.g. en"
                  spellcheck="false"
                  style="width:72px;text-align:center;text-transform:uppercase"
                />
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
                  <div class="theme-card{active ? ' active' : ''}">
                    <button class="theme-card-inner" onclick={() => updateSettings({ theme: theme.id })} title={theme.description}>
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
                  </div>
                {/each}
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
                <div class="toggle-info"><span class="toggle-label">Page gap</span><span class="toggle-desc">Adds spacing between pages in single-page mode</span></div>
                <button role="switch" aria-checked={store.settings.pageGap} aria-label="Page gap" class="toggle" class:on={store.settings.pageGap} onclick={() => updateSettings({ pageGap: !store.settings.pageGap })}><span class="toggle-thumb"></span></button>
              </label>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Overlay bars</span><span class="toggle-desc">Floats the nav and chapter bars over the page instead of pushing content</span></div>
                <button role="switch" aria-checked={store.settings.overlayBars ?? false} aria-label="Overlay bars" class="toggle" class:on={store.settings.overlayBars ?? false} onclick={() => updateSettings({ overlayBars: !(store.settings.overlayBars ?? false) })}><span class="toggle-thumb"></span></button>
              </label>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Tap to toggle bar</span><span class="toggle-desc">Double-tap the center of the reader to show or hide the bars — ideal for touchscreens</span></div>
                <button role="switch" aria-checked={store.settings.tapToToggleBar ?? false} aria-label="Tap to toggle bar" class="toggle" class:on={store.settings.tapToToggleBar ?? false} onclick={() => updateSettings({ tapToToggleBar: !(store.settings.tapToToggleBar ?? false) })}><span class="toggle-thumb"></span></button>
              </label>
            </div>
            <div class="section">
              <p class="section-title">Fit &amp; Zoom</p>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Default fit mode</span><span class="toggle-desc">How pages are scaled to fill the reader on open</span></div>
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
                <div class="toggle-info">
                  <span class="toggle-label">Default zoom</span>
                  <span class="toggle-desc">100% = fills the reader</span>
                </div>
                <div class="scale-row">
                  <input type="range" min={10} max={400} step={5}
                    value={Math.round((store.settings.readerZoom ?? 0.5) * 100)}
                    oninput={(e) => updateSettings({ readerZoom: Number(e.currentTarget.value) / 100 })}
                    class="scale-slider" />
                  <input
                    type="number" min={10} max={400} step={5}
                    class="scale-val-input"
                    value={Math.round((store.settings.readerZoom ?? 0.5) * 100)}
                    oninput={(e) => {
                      const n = parseInt(e.currentTarget.value, 10);
                      if (!isNaN(n) && n >= 10 && n <= 400) updateSettings({ readerZoom: n / 100 });
                    }}
                    onblur={(e) => {
                      const n = parseInt(e.currentTarget.value, 10);
                      if (isNaN(n) || n < 10) { updateSettings({ readerZoom: 0.1 }); e.currentTarget.value = "10"; }
                      else if (n > 400) { updateSettings({ readerZoom: 4.0 }); e.currentTarget.value = "400"; }
                    }}
                  />
                  <span class="scale-pct">%</span>
                  <button class="step-btn" onclick={() => updateSettings({ readerZoom: 0.5 })} disabled={(store.settings.readerZoom ?? 0.5) === 0.5} title="Reset to 100%">↺</button>
                </div>
              </div>
              <p class="scale-hint">
                {#each [50, 75, 100, 125, 150, 200] as v}
                  <button class="scale-preset"
                    class:active={Math.round((store.settings.readerZoom ?? 0.5) * 100) === v}
                    onclick={() => updateSettings({ readerZoom: v / 100 })}>{v}%</button>
                {/each}
              </p>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Optimize contrast</span><span class="toggle-desc">Sharpens dark lines on light pages; best for black-and-white manga</span></div>
                <button role="switch" aria-checked={store.settings.optimizeContrast} aria-label="Optimize contrast" class="toggle" class:on={store.settings.optimizeContrast} onclick={() => updateSettings({ optimizeContrast: !store.settings.optimizeContrast })}><span class="toggle-thumb"></span></button>
              </label>
            </div>
            <div class="section">
              <p class="section-title">Behaviour</p>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Auto-mark read</span><span class="toggle-desc">Marks a chapter as read when you reach the last page</span></div>
                <button role="switch" aria-checked={store.settings.autoMarkRead} aria-label="Auto-mark chapters read" class="toggle" class:on={store.settings.autoMarkRead} onclick={() => updateSettings({ autoMarkRead: !store.settings.autoMarkRead })}><span class="toggle-thumb"></span></button>
              </label>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Auto-advance chapters</span><span class="toggle-desc">Automatically loads the next chapter when you pass the last page</span></div>
                <button role="switch" aria-checked={store.settings.autoNextChapter ?? false} aria-label="Auto-advance chapters" class="toggle" class:on={store.settings.autoNextChapter} onclick={() => updateSettings({ autoNextChapter: !(store.settings.autoNextChapter ?? false) })}><span class="toggle-thumb"></span></button>
              </label>
              {#if !(store.settings.autoNextChapter ?? false)}
                <label class="toggle-row">
                  <div class="toggle-info"><span class="toggle-label">Mark read when skipping</span><span class="toggle-desc">Marks the current chapter read when you manually jump to the next</span></div>
                  <button role="switch" aria-checked={store.settings.markReadOnNext ?? true} aria-label="Mark read when skipping" class="toggle" class:on={store.settings.markReadOnNext ?? true} onclick={() => updateSettings({ markReadOnNext: !(store.settings.markReadOnNext ?? true) })}><span class="toggle-thumb"></span></button>
                </label>
              {/if}
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Auto-bookmark</span><span class="toggle-desc">Automatically saves your page position as you read</span></div>
                <button role="switch" aria-checked={store.settings.autoBookmark ?? true} aria-label="Enable auto-bookmark" class="toggle" class:on={store.settings.autoBookmark ?? true} onclick={() => {
                    updateSettings({ autoBookmark: !(store.settings.autoBookmark ?? true) });
                  }}><span class="toggle-thumb"></span></button>
              </label>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Pages to preload</span><span class="toggle-desc">How many pages ahead to fetch in the background while reading</span></div>
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
                <div class="toggle-info"><span class="toggle-label">Crop cover images</span><span class="toggle-desc">Fills the card with the cover art instead of letterboxing</span></div>
                <button role="switch" aria-checked={store.settings.libraryCropCovers} aria-label="Crop cover images" class="toggle" class:on={store.settings.libraryCropCovers} onclick={() => updateSettings({ libraryCropCovers: !store.settings.libraryCropCovers })}><span class="toggle-thumb"></span></button>
              </label>
              <label class="toggle-row">
                <div class="toggle-info">
                  <span class="toggle-label">Show all in Saved tab</span>
                  <span class="toggle-desc">Include manga that are in folders — lets you see your whole library in one place</span>
                </div>
                <button role="switch" aria-checked={store.settings.libraryShowAllInSaved ?? true} aria-label="Show all manga in Saved tab" class="toggle" class:on={store.settings.libraryShowAllInSaved ?? true} onclick={() => updateSettings({ libraryShowAllInSaved: !(store.settings.libraryShowAllInSaved ?? true) })}><span class="toggle-thumb"></span></button>
              </label>
            </div>
            <div class="section">
              <p class="section-title">Chapters</p>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Default sort direction</span><span class="toggle-desc">Initial chapter list order when opening a manga</span></div>
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
                <div class="toggle-info"><span class="toggle-label">Reading history</span><span class="toggle-desc">{store.history.length} entries</span></div>
                <button class="danger-btn" onclick={clearHistory} disabled={store.history.length === 0}>Clear</button>
              </div>
              <div class="step-row">
                <div class="toggle-info">
                  <span class="toggle-label">Wipe all data</span>
                  <span class="toggle-desc">History, stats, pins, and manga links</span>
                </div>
                <button class="danger-btn" onclick={wipeAllData}>Wipe</button>
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
                  <span class="toggle-desc">Lower = faster on large libraries</span>
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
                <div class="toggle-info"><span class="toggle-label">GPU acceleration</span><span class="toggle-desc">Uses the GPU for rendering; disable if you see visual glitches</span></div>
                <button role="switch" aria-checked={store.settings.gpuAcceleration} aria-label="GPU acceleration" class="toggle" class:on={store.settings.gpuAcceleration} onclick={() => updateSettings({ gpuAcceleration: !store.settings.gpuAcceleration })}><span class="toggle-thumb"></span></button>
              </label>
            </div>
            <div class="section">
              <p class="section-title">Idle / Splash Screen</p>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Animated card background</span><span class="toggle-desc">Shows cover art cards floating in the background on the idle screen</span></div>
                <button role="switch" aria-checked={store.settings.splashCards ?? true} aria-label="Animated card background" class="toggle" class:on={store.settings.splashCards ?? true} onclick={() => updateSettings({ splashCards: !(store.settings.splashCards ?? true) })}><span class="toggle-thumb"></span></button>
              </label>
            </div>
            <div class="section">
              <p class="section-title">Interface</p>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Compact sidebar</span><span class="toggle-desc">Collapses the sidebar to icons only</span></div>
                <button role="switch" aria-checked={store.settings.compactSidebar} aria-label="Compact sidebar" class="toggle" class:on={store.settings.compactSidebar} onclick={() => updateSettings({ compactSidebar: !store.settings.compactSidebar })}><span class="toggle-thumb"></span></button>
              </label>
            </div>
            <div class="section">
              <p class="section-title">Session Cache</p>
              <div class="step-row">
                <div class="toggle-info">
                  <span class="toggle-label">Cache entries</span>
                  <span class="toggle-desc">In-memory, cleared on restart</span>
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


            {#if migrateFrom && !isExternalServer}
              <div class="migrate-banner">
                <div class="migrate-banner-body">
                  <span class="migrate-title">Manga found at previous path — move to new location?</span>
                  <span class="migrate-paths">{migrateFrom} → {migrateTo}</span>
                  {#if migrateProgress && migrateProgress.total > 0}
                    <div class="migrate-progress">
                      <div class="migrate-progress-labels">
                        <span class="migrate-current">{migrateProgress.current}</span>
                        <span class="migrate-count">{migrateProgress.done} / {migrateProgress.total}</span>
                      </div>
                      <div class="migrate-bar"><div class="migrate-bar-fill" style="width:{Math.round((migrateProgress.done/migrateProgress.total)*100)}%"></div></div>
                    </div>
                  {/if}
                  {#if migrateError}<span class="migrate-error">{migrateError}</span>{/if}
                </div>
                <div class="migrate-banner-actions">
                  <button class="sec-action-btn sec-action-primary" onclick={startMigration} disabled={migrating}>
                    {migrating ? (migrateProgress ? `Moving… ${migrateProgress.done}/${migrateProgress.total}` : "Starting…") : "Move files"}
                  </button>
                  <button class="sec-action-btn" onclick={dismissMigration} disabled={migrating}>Skip</button>
                </div>
              </div>
            {/if}


            <div class="section">
              <div class="section-title-row"><p class="section-title">Disk Usage</p><button class="sec-action-btn" onclick={fetchStorage} disabled={storageLoading}>{storageLoading ? "…" : "↻"}</button></div>
              {#if storageLoading}
                <p class="storage-loading">Reading filesystem…</p>
              {:else if storageError}
                <p class="storage-loading" style="color:var(--color-error)">{storageError}</p>
              {:else if isExternalServer}
                <p class="storage-loading">Disk usage is unavailable for external servers — filesystem access requires a local connection.</p>
              {:else if multiStorageInfos.length > 0}
                {#each multiStorageInfos as info}
                  {@const limitGb    = store.settings.storageLimitGb ?? null}
                  {@const limitBytes = limitGb !== null ? limitGb * 1024 ** 3 : null}
                  {@const available  = info.manga_bytes + info.free_bytes}
                  {@const cap        = limitBytes !== null ? Math.min(limitBytes, available) : available}
                  {@const pct        = cap > 0 ? Math.min(100, (info.manga_bytes / cap) * 100) : 0}
                  <div class="storage-bar-wrap">
                    <div class="storage-bar-header">
                      <span class="storage-bar-label">{info.label}</span>
                      <span class="storage-bar-used">{fmtBytes(info.manga_bytes)} of {fmtBytes(cap)}</span>
                    </div>
                    <div class="storage-bar">
                      <div class="storage-bar-fill" class:critical={pct > 90} class:warn={pct > 75 && pct <= 90} style="width:{pct}%"></div>
                    </div>
                    <div class="storage-bar-labels">
                      <span class="storage-path-note" style="margin:0">{info.path}</span>
                      <span class="storage-bar-free">{fmtBytes(info.free_bytes)} free</span>
                    </div>
                  </div>
                {/each}
              {:else}
                <p class="storage-loading">No download path configured.</p>
              {/if}
            </div>


            <div class="section">
              <p class="section-title">Downloads Path</p>
              {#if isExternalServer}
                <p class="toggle-desc" style="display:block;padding:0 var(--sp-3) var(--sp-2)">
                  Connected to an external server. The path below is read from the server — changes here will update the server's config directly. Make sure the path is valid on the server's filesystem.
                </p>
              {/if}
              <div class="path-row">
                <input
                  class="text-input path-input"
                  class:path-input-error={!!pathsFieldError.dl}
                  bind:value={downloadsPathInput}
                  placeholder={isExternalServer ? "Server default" : (defaultDownloadsPath || "Default location")}
                  spellcheck="false"
                  onkeydown={(e) => e.key === "Enter" && savePaths()}
                  oninput={() => { pathsFieldError = { ...pathsFieldError, dl: undefined }; }}
                />
                {#if !isExternalServer}
                  <button class="sec-action-btn" onclick={browseDownloadsFolder} title="Browse for folder">
                    Browse
                  </button>
                {/if}
                <div class="path-actions">
                  {#if pathsFieldError.dl}
                    <span class="path-field-error">{pathsFieldError.dl}</span>
                    {#if !isExternalServer}
                      <button class="sec-action-btn" onclick={async () => {
                        try { await createDirectory(downloadsPathInput.trim()); pathsFieldError = { ...pathsFieldError, dl: undefined }; }
                        catch (e: any) { pathsFieldError = { ...pathsFieldError, dl: e?.message ?? "Failed" }; }
                      }}>Create</button>
                    {/if}
                  {/if}
                  {#if pathsError}<span class="path-field-error">{pathsError}</span>{/if}
                  <button class="sec-action-btn sec-action-primary" onclick={savePaths} disabled={pathsSaving}>
                    {pathsSaved ? "Saved ✓" : pathsSaving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            </div>


            <div class="section">
              <p class="section-title">Storage Limit</p>
              <div class="step-row">
                <div class="toggle-info">
                  <span class="toggle-label">Warn when limit is reached</span>
                  <span class="toggle-desc">{store.settings.storageLimitGb === null ? "No limit set" : `Warn above ${store.settings.storageLimitGb} GB`}</span>
                </div>
                {#if store.settings.storageLimitGb === null}
                  <button class="step-btn" style="width:auto;padding:0 var(--sp-3);font-size:var(--text-xs);letter-spacing:var(--tracking-wide)"
                    onclick={() => updateSettings({ storageLimitGb: 10 })}>Set limit</button>
                {:else}
                  <div class="step-controls">
                    <button class="step-btn" onclick={() => updateSettings({ storageLimitGb: Math.max(1, (store.settings.storageLimitGb ?? 10) - 1) })} disabled={(store.settings.storageLimitGb ?? 10) <= 1}>−</button>
                    <input type="number" min="1" step="1" class="storage-limit-input" value={store.settings.storageLimitGb}
                      oninput={(e) => { const n = parseFloat(e.currentTarget.value); if (!isNaN(n) && n > 0) updateSettings({ storageLimitGb: n }); }} />
                    <span class="storage-limit-unit">GB</span>
                    <button class="step-btn" onclick={() => updateSettings({ storageLimitGb: (store.settings.storageLimitGb ?? 10) + 1 })}>+</button>
                    <button class="kb-reset" title="Remove limit" onclick={() => updateSettings({ storageLimitGb: null })}>↺</button>
                  </div>
                {/if}
              </div>
            </div>


            <div class="section">
              <p class="section-title">Cache</p>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Image cache</span><span class="toggle-desc">Webview page image cache</span></div>
                <button class="danger-btn" onclick={handleClearCache} disabled={clearing}>
                  {cleared ? "Cleared" : clearing ? "Clearing…" : "Clear"}
                </button>
              </div>
            </div>


            <div class="section adv-section">
              <button class="adv-toggle" onclick={() => advStorageOpen = !advStorageOpen}>
                <span class="section-title" style="padding:0">Advanced</span>
                <svg class="adv-caret" class:open={advStorageOpen} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
              </button>
              {#if advStorageOpen}
                <div class="adv-body">

                  <div class="step-row">
                    <div class="toggle-info">
                      <span class="toggle-label">Local source path</span>
                      <span class="toggle-desc">Read manga already on disk without an extension. Leave blank if unused.</span>
                    </div>
                    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
                      <div style="display:flex;align-items:center;gap:var(--sp-2)">
                        <input class="text-input" style="width:200px;font-family:monospace;font-size:var(--text-xs);{pathsFieldError.loc?'border-color:var(--color-error)':''}"
                          bind:value={localSourcePathInput} placeholder="Optional" spellcheck="false"
                          onkeydown={(e) => e.key === "Enter" && savePaths()}
                          oninput={() => { pathsFieldError = { ...pathsFieldError, loc: undefined }; }} />
                        {#if pathsFieldError.loc && !isExternalServer}
                          <button class="sec-action-btn" onclick={async () => {
                            try { await createDirectory(localSourcePathInput.trim()); pathsFieldError = { ...pathsFieldError, loc: undefined }; }
                            catch (e: any) { pathsFieldError = { ...pathsFieldError, loc: e?.message ?? "Failed" }; }
                          }}>Create</button>
                        {/if}
                      </div>
                      {#if pathsFieldError.loc}<span style="font-family:var(--font-ui);font-size:10px;color:var(--color-error)">{pathsFieldError.loc}</span>{/if}
                    </div>
                  </div>

                  {#each extraScanDirs as dir}
                    <div class="step-row">
                      <div class="toggle-info">
                        <span class="toggle-label" style="font-family:monospace;font-size:var(--text-xs)">{dir}</span>
                        <span class="toggle-desc">Extra scan directory</span>
                      </div>
                      <button class="danger-btn" onclick={() => removeExtraScanDir(dir)}>Remove</button>
                    </div>
                  {/each}

                  <div class="step-row">
                    <div class="toggle-info">
                      <span class="toggle-label">Additional scan path</span>
                      <span class="toggle-desc">Include an extra directory in disk usage readings</span>
                    </div>
                    <div style="display:flex;gap:var(--sp-2);align-items:center;flex-shrink:0">
                      <input class="text-input" style="width:200px;font-family:monospace;font-size:var(--text-xs)"
                        bind:value={newScanDir} placeholder="/path/to/dir" spellcheck="false"
                        onkeydown={(e) => e.key === "Enter" && addExtraScanDir()} />
                      <button class="sec-action-btn" onclick={addExtraScanDir} disabled={!newScanDir.trim() || extraScanDirs.includes(newScanDir.trim())}>Add</button>
                    </div>
                  </div>

                  <div class="step-row" style="padding-top:0">
                    <div class="toggle-info"></div>
                    <button class="sec-action-btn sec-action-primary" onclick={savePaths} disabled={pathsSaving}>
                      {pathsSaved ? "Saved ✓" : pathsSaving ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              {/if}
            </div>


            <div class="section adv-section">
              <button class="adv-toggle" onclick={() => backupSectionOpen = !backupSectionOpen}>
                <span class="section-title" style="padding:0">Backup</span>
                <svg class="adv-caret" class:open={backupSectionOpen} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
              </button>
              {#if backupSectionOpen}
                <div class="adv-body">


                  <div class="step-row">
                    <div class="toggle-info">
                      <span class="toggle-label">Create backup</span>
                      <span class="toggle-desc">Snapshot your library, categories, and tracker links</span>
                    </div>
                    <button class="sec-action-btn sec-action-primary" onclick={createBackup} disabled={backupLoading}>
                      {backupLoading ? "Creating…" : "Create backup"}
                    </button>
                  </div>

                  {#if backupError}
                    <p class="storage-loading" style="color:var(--color-error)">{backupError}</p>
                  {/if}


                  {#if backupList.length === 0}
                    <p class="storage-loading">No backups yet — create one above.</p>
                  {:else}
                    <div class="folder-list" style="margin:0 0 var(--sp-2)">
                      {#each backupList as backup}
                        <div class="folder-row">
                          <ClockCounterClockwise size={14} weight="light" style="color:var(--text-faint);flex-shrink:0" />
                          <span class="folder-row-name" style="font-family:monospace;font-size:var(--text-xs)">{backup.name}</span>
                          <button
                            class="kb-reset"
                            onclick={() => downloadBackup(backup)}
                            title="Download"
                            style="display:flex;align-items:center"
                          >↓</button>
                          <button
                            class="kb-reset folder-delete"
                            onclick={() => deleteBackup(backup.url)}
                            disabled={backup.deleting}
                            title="Delete"
                          ><Trash size={12} weight="light" /></button>
                        </div>
                      {/each}
                    </div>
                  {/if}


                  <div class="step-row">
                    <div class="toggle-info">
                      <span class="toggle-label">Restore from file</span>
                      <span class="toggle-desc">{restoreFile ? restoreFile.name : "Select a .tachibk file"}</span>
                    </div>
                    <label class="sec-action-btn" style="cursor:pointer">
                      Browse
                      <input type="file" accept=".tachibk,.proto.gz" style="display:none"
                        onchange={(e) => {
                          const f = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
                          restoreFile = f; restoreStatus = null; restoreError = null; validateResult = null; validateError = null;
                        }} />
                    </label>
                  </div>
                  {#if restoreFile}
                    <div class="step-row">
                      <div class="toggle-info"></div>
                      <div class="sec-btn-row">
                        <button class="sec-action-btn" onclick={submitValidate} disabled={validateLoading || restoreLoading}>
                          {validateLoading ? "Checking…" : "Validate"}
                        </button>
                        <button class="sec-action-btn sec-action-primary" onclick={submitRestore} disabled={restoreLoading || validateLoading}>
                          {restoreLoading ? "Restoring…" : "Restore"}
                        </button>
                      </div>
                    </div>
                  {/if}
                  {#if validateError}
                    <p class="storage-loading" style="color:var(--color-error)">{validateError}</p>
                  {/if}
                  {#if validateResult}
                    {#if validateResult.missingSources.length === 0 && validateResult.missingTrackers.length === 0}
                      <p class="storage-loading" style="color:var(--color-success, #4caf50)">✓ All sources and trackers present</p>
                    {:else}
                      {#if validateResult.missingSources.length > 0}
                        <div class="step-row">
                          <div class="toggle-info">
                            <span class="toggle-label" style="color:var(--color-error)">Missing sources</span>
                            <span class="toggle-desc">{validateResult.missingSources.map(s => s.name).join(", ")}</span>
                          </div>
                        </div>
                      {/if}
                      {#if validateResult.missingTrackers.length > 0}
                        <div class="step-row">
                          <div class="toggle-info">
                            <span class="toggle-label" style="color:var(--color-error)">Missing trackers</span>
                            <span class="toggle-desc">{validateResult.missingTrackers.map(t => t.name).join(", ")}</span>
                          </div>
                        </div>
                      {/if}
                    {/if}
                  {/if}
                  {#if restoreError}
                    <p class="storage-loading" style="color:var(--color-error)">{restoreError}</p>
                  {/if}
                  {#if restoreStatus}
                    <div class="step-row">
                      <div class="toggle-info">
                        <span class="toggle-label">
                          {restoreStatus.state === "SUCCESS" ? "✓ Restore complete" :
                           restoreStatus.state === "FAILURE" ? "✗ Restore failed"  : "Restoring…"}
                        </span>
                        {#if restoreStatus.totalManga > 0}
                          <span class="toggle-desc">{restoreStatus.mangaProgress} / {restoreStatus.totalManga} manga</span>
                        {/if}
                      </div>
                      {#if restoreStatus.state !== "SUCCESS" && restoreStatus.state !== "FAILURE" && restoreStatus.totalManga > 0}
                        <div class="storage-bar" style="width:160px;flex-shrink:0">
                          <div class="storage-bar-fill" style="width:{Math.round((restoreStatus.mangaProgress / restoreStatus.totalManga) * 100)}%"></div>
                        </div>
                      {/if}
                    </div>
                  {/if}

                </div>
              {/if}
            </div>
          </div>
        {:else if tab === "folders"}
          <div class="panel">
            <div class="section">
              <p class="section-title">Manage Folders</p>
              <p class="toggle-desc" style="padding:0 var(--sp-3) var(--sp-3);display:block">Folders are stored as Suwayomi categories. Changes sync across all clients.</p>
              {#if catsError}
                <p class="toggle-desc" style="padding:0 var(--sp-3) var(--sp-2);color:var(--color-error);display:block">{catsError}</p>
              {/if}
              <div class="folder-create-row">
                <input class="text-input" placeholder="New folder name…" bind:value={newFolderName}
                  onkeydown={(e) => e.key === "Enter" && createFolder()} style="flex:1;width:auto" />
                <button class="folder-create-btn" onclick={createFolder} disabled={!newFolderName.trim()}>
                  <Plus size={13} weight="bold" /> Create
                </button>
              </div>
              {#if catsLoading}
                <p class="storage-loading">Loading folders…</p>
              {:else if store.categories.filter(c => c.id !== 0).length === 0}
                <p class="storage-loading">No folders yet. Create one above.</p>
              {:else}
                {@const displayCats = store.categories
                    .filter(c => c.id !== 0)
                    .sort((a, b) => {
                      const defaultId = store.settings.defaultLibraryCategoryId ?? null;
                      if (a.id === defaultId) return -1;
                      if (b.id === defaultId) return  1;
                      return a.order - b.order;
                    })}
                <div class="folder-list">
                  {#each displayCats as cat, i}
                    <div class="folder-row">
                      {#if editingId === cat.id}
                        <input class="text-input" bind:value={editingName}
                          onkeydown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") editingId = null; }}
                          onblur={commitEdit} style="flex:1;width:auto" use:focusInput />
                        <button class="kb-reset" onclick={commitEdit} title="Save">✓</button>
                      {:else}
                        <FolderSimple size={14} weight="light" style="color:var(--text-faint);flex-shrink:0" />
                        <span class="folder-row-name">{cat.name}</span>
                        <span class="folder-row-count">{cat.mangas?.nodes.length ?? 0} manga</span>
                        <button
                          class="kb-reset"
                          class:folder-default-active={(store.settings.defaultLibraryCategoryId ?? null) === cat.id}
                          onclick={() => updateSettings({ defaultLibraryCategoryId: (store.settings.defaultLibraryCategoryId ?? null) === cat.id ? null : cat.id })}
                          title={(store.settings.defaultLibraryCategoryId ?? null) === cat.id ? "Remove as default folder" : "Set as default folder — opens first when you visit Library"}
                        ><Star size={13} weight={(store.settings.defaultLibraryCategoryId ?? null) === cat.id ? "fill" : "light"} /></button>
                        <button
                          class="kb-reset"
                          class:folder-hidden={(store.settings.hiddenCategoryIds ?? []).includes(cat.id)}
                          onclick={() => toggleHiddenCategory(cat.id)}
                          title={(store.settings.hiddenCategoryIds ?? []).includes(cat.id) ? "Show in Saved tab" : "Hide from Saved tab"}
                        >{#if (store.settings.hiddenCategoryIds ?? []).includes(cat.id)}<EyeSlash size={13} weight="light" />{:else}<Eye size={13} weight="light" />{/if}</button>
                        <button class="kb-reset" onclick={() => moveCategory(cat.id, -1)} disabled={i === 0} title="Move up">↑</button>
                        <button class="kb-reset" onclick={() => moveCategory(cat.id, 1)} disabled={i === displayCats.length - 1} title="Move down">↓</button>
                        <button class="kb-reset" onclick={() => startEdit(cat.id, cat.name)} title="Rename"><Pencil size={12} weight="light" /></button>
                        <button class="kb-reset folder-delete" onclick={() => deleteFolder(cat.id)} title="Delete"><Trash size={12} weight="light" /></button>
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
              {#if trackersError}
                <div class="tracker-error">{trackersError}</div>
              {/if}
              {#if trackersLoading}
                <p class="storage-loading">Loading trackers…</p>
              {:else}
                <div class="tracker-list">
                  {#each trackers as tracker}
                    <div class="tracker-row" class:tracker-row-active={tracker.isLoggedIn}>
                      <div class="tracker-identity">
                        <img src={thumbUrl(tracker.icon)} alt={tracker.name} class="tracker-logo" />
                        <div class="tracker-name-block">
                          <span class="tracker-label">{tracker.name}</span>
                          <span class="tracker-status-pill" class:pill-on={tracker.isLoggedIn}>
                            {tracker.isLoggedIn ? "Connected" : "Not connected"}
                          </span>
                        </div>
                      </div>
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
                              Browser opened {tracker.name} login — after authorising, copy the full callback URL and paste it below.
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
                <span class="sec-status-pill" class:sec-pill-on={store.settings.serverAuthMode === "BASIC_AUTH"} class:sec-pill-warn={authModeUnsupported}>
                  {store.settings.serverAuthMode === "BASIC_AUTH"   ? "Basic Auth"   :
                   store.settings.serverAuthMode === "SIMPLE_LOGIN" ? "Simple Login — unsupported" :
                   store.settings.serverAuthMode === "UI_LOGIN"     ? "UI Login — unsupported"     : "Disabled"}
                </span>
              </div>

              {#if authModeUnsupported}
                <div class="sec-banner sec-banner-warn" style="margin: var(--sp-2) var(--sp-3) 0;">
                  <strong>{store.settings.serverAuthMode === "SIMPLE_LOGIN" ? "Simple Login" : "UI Login"}</strong> is not supported by this client — only <strong>Basic Auth</strong> works here.
                  Switch your Suwayomi server to <code>basic_auth</code> and set the mode below to <strong>Basic</strong>, then save.
                </div>
              {/if}

              <div class="step-row">
                <div class="toggle-info">
                  <span class="toggle-label">Mode</span>
                  <span class="toggle-desc">How Suwayomi verifies requests</span>
                </div>
                <div class="auth-mode-group">
                  {#each [
                    { value: "NONE",       label: "None"  },
                    { value: "BASIC_AUTH", label: "Basic" },
                  ] as opt}
                    <button
                      class="auth-mode-btn"
                      class:auth-mode-active={authMode === opt.value}
                      onclick={() => authMode = opt.value as any}
                      disabled={secLoading}
                    >{opt.label}</button>
                  {/each}
                </div>
              </div>

              {#if authMode !== "NONE"}
                <div class="step-row">
                  <div class="toggle-info"><span class="toggle-label">Username</span></div>
                  <input class="text-input" bind:value={authUsername} placeholder="Username" autocomplete="off" spellcheck="false" disabled={secLoading} />
                </div>
                <div class="step-row">
                  <div class="toggle-info"><span class="toggle-label">Password</span></div>
                  <div class="sec-field-wrap">
                    <input class="text-input" type={showAuthPass ? "text" : "password"} bind:value={authPassword} placeholder="Password" autocomplete="off" spellcheck="false" disabled={secLoading} />
                    <button class="sec-eye-btn" onclick={() => showAuthPass = !showAuthPass} title={showAuthPass ? "Hide" : "Show"} tabindex="-1">
                      {#if showAuthPass}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      {:else}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      {/if}
                    </button>
                  </div>
                </div>


              {/if}

              {#if store.settings.serverAuthMode === "BASIC_AUTH"}
                <div class="step-row">
                  <div class="toggle-info"></div>
                  <p class="auth-perf-note">Images are proxied through Tauri when Basic Auth is active, which reduces loading speed.</p>
                </div>
              {/if}

              <div class="step-row">
                <div class="toggle-info"></div>
                <div class="sec-btn-row">
                  {#if store.settings.serverAuthMode !== "NONE"}
                    <button class="sec-action-btn sec-action-danger" onclick={clearAuth} disabled={secLoading}>
                      {secLoading ? "Saving…" : "Disable"}
                    </button>
                  {/if}
                  <button
                    class="sec-action-btn sec-action-primary"
                    onclick={saveAuth}
                    disabled={secLoading || (authMode === "BASIC_AUTH" && (!authUsername.trim() || !authPassword.trim()))}
                  >
                    {secLoading ? "Saving…" : secSaved === "auth" ? "Saved ✓" : store.settings.serverAuthMode === "BASIC_AUTH" ? "Update" : authMode === "NONE" ? "Save" : "Enable"}
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
                    <span class="toggle-desc">4–8 digits, saved on Enter or Save button</span>
                  </div>
                  <div class="sec-btn-row">
                    <input
                      class="text-input"
                      type="password"
                      inputmode="numeric"
                      maxlength={8}
                      placeholder="4–8 digits"
                      value={pinInput}
                      oninput={(e) => { pinInput = e.currentTarget.value.replace(/\D/g, "").slice(0, 8); pinError = ""; }}
                      onkeydown={(e) => e.key === "Enter" && commitPin()}
                      autocomplete="off"
                      aria-label="Enter PIN"
                      style="width:120px;letter-spacing:0.2em"
                    />
                    <button class="sec-action-btn sec-action-primary"
                      onclick={commitPin}
                      disabled={pinInput.length > 0 && pinInput.length < 4}>
                      {store.settings.appLockPin && pinInput === store.settings.appLockPin ? "Saved ✓" : "Save"}
                    </button>
                  </div>
                  {#if pinError}<span class="sec-pin-error">{pinError}</span>{/if}
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
                <button role="switch" aria-checked={socksEnabled} aria-label="Enable SOCKS proxy" class="toggle" class:on={socksEnabled} onclick={() => { socksEnabled = !socksEnabled; saveSocksProxy(); }}><span class="toggle-thumb"></span></button>
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
                <button role="switch" aria-checked={flareEnabled} aria-label="Enable FlareSolverr" class="toggle" class:on={flareEnabled} onclick={() => { flareEnabled = !flareEnabled; saveFlareSolverr(); }}><span class="toggle-thumb"></span></button>
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
        {:else if tab === "content"}
          <div class="panel">
            <div class="section">
              <p class="section-title">Content Filter</p>
              <label class="toggle-row">
                <div class="toggle-info"><span class="toggle-label">Show adult content</span><span class="toggle-desc">Sources and manga matching blocked tags are hidden when off</span></div>
                <button role="switch" aria-checked={store.settings.showNsfw} aria-label="Show adult content" class="toggle" class:on={store.settings.showNsfw} onclick={() => updateSettings({ showNsfw: !store.settings.showNsfw })}><span class="toggle-thumb"></span></button>
              </label>
            </div>
            <div class="section">
              <p class="section-title">Blocked Genre Tags</p>
              <div class="section-title-row" style="padding-top:0;padding-bottom:var(--sp-2)">
                <span class="toggle-desc" style="flex:1">Manga matching any of these substrings are filtered. Case-insensitive, partial match.</span>
                <button class="kb-reset" style="font-size:var(--text-xs);padding:2px 10px;flex-shrink:0" onclick={() => tagsRevealed = !tagsRevealed}>
                  {tagsRevealed ? "Hide" : `Show (${(store.settings.nsfwFilteredTags ?? []).length})`}
                </button>
              </div>
              {#if tagsRevealed}
              <div class="content-tag-grid">
                {#each (store.settings.nsfwFilteredTags ?? []) as tag}
                  <span class="content-tag">
                    <Tag size={10} weight="light" />
                    {tag}
                    <button class="content-tag-remove" onclick={() => removeTag(tag)} title="Remove tag">×</button>
                  </span>
                {/each}
              </div>
              {/if}
              <div class="content-tag-add">
                <input
                  class="text-input"
                  placeholder="Add tag substring…"
                  bind:value={newTagInput}
                  onkeydown={(e) => { if (e.key === "Enter") addTag(); }}
                  style="flex:1;width:auto"
                />
                <button class="folder-create-btn" onclick={addTag} disabled={!newTagInput.trim()}>
                  <Plus size={13} weight="bold" /> Add
                </button>
                <button class="kb-reset" onclick={resetTags} title="Reset to defaults" style="padding:0 var(--sp-3);font-size:var(--text-xs);color:var(--text-faint)">Reset</button>
              </div>
            </div>
            <div class="section">
              <p class="section-title">Source Overrides</p>
              <p class="toggle-desc" style="padding:0 var(--sp-3) var(--sp-2);display:block">
                Allow lets a source through even if flagged NSFW. Block always hides it.
              </p>
              <div class="content-source-search-wrap">
                <input class="text-input" placeholder="Filter sources…" bind:value={sourceSearch} style="width:100%" />
              </div>
              {#if contentSourcesLoading}
                <p class="storage-loading">Loading sources…</p>
              {:else if contentSources.length === 0}
                <p class="storage-loading">No sources found — check your server connection.</p>
              {:else}
                <div class="content-source-list">
                  {#each contentSourcesFiltered as group (group.name)}
                    {@const ids = group.sources.map(s => s.id)}
                    {@const allowed = store.settings.nsfwAllowedSourceIds ?? []}
                    {@const blocked = store.settings.nsfwBlockedSourceIds ?? []}
                    {@const isAllowed = ids.every(id => allowed.includes(id))}
                    {@const isBlocked = ids.every(id => blocked.includes(id))}
                    <div class="content-source-row" class:content-source-allowed={isAllowed} class:content-source-blocked={isBlocked}>
                      <img src={thumbUrl(group.iconUrl)} alt="" class="content-source-icon" loading="lazy" decoding="async" />
                      <div class="content-source-info">
                        <span class="content-source-name">{group.name}</span>
                        <span class="content-source-lang">{group.sources[0].isNsfw ? "NSFW · " : ""}{group.sources.length > 1 ? `${group.sources.length} languages` : group.sources[0].lang.toUpperCase()}</span>
                      </div>
                      <div class="content-source-actions">
                        <button
                          class="content-action-btn"
                          class:content-action-active-allow={isAllowed}
                          onclick={() => toggleSourceAllowed(ids)}
                          title={isAllowed ? "Remove allow override" : "Allow this source through regardless of NSFW flag"}
                        >Allow</button>
                        <button
                          class="content-action-btn"
                          class:content-action-active-block={isBlocked}
                          onclick={() => toggleSourceBlocked(ids)}
                          title={isBlocked ? "Remove block override" : "Always block this source"}
                        >Block</button>
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {:else if tab === "about"}
          <div class="panel">
            <div class="section">
              <p class="section-title">Moku</p>
              <div class="about-block">
                <p class="about-line">A manga reader frontend for Suwayomi / Tachidesk.</p>
                <p class="about-line" style="color:var(--text-faint);margin-top:var(--sp-2)">Built with Tauri + Svelte.</p>
              </div>
            </div>
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
              {#if updatePhase === "ready"}
                <div class="update-ready-row">
                  <span class="update-ready-label">
                    {targetTag} downloaded — restart to finish installing.
                  </span>
                  <button class="update-action-btn primary" onclick={restartNow}>Restart now</button>
                  <button class="kb-reset" onclick={cancelUpdate} title="Dismiss">✕</button>
                </div>
              {/if}
              {#if updatePhase === "error"}
                <div class="update-error-row">
                  <span style="color:var(--color-error);font-family:var(--font-ui);font-size:var(--text-xs)">{updateError}</span>
                  <button class="kb-reset" onclick={cancelUpdate}>Dismiss</button>
                </div>
              {/if}
            </div>
            <div class="section">
              <p class="section-title">Releases</p>
              {#if releasesError}
                <p class="storage-loading" style="color:var(--color-error)">{releasesError}</p>
              {:else if releasesLoading}
                <p class="storage-loading">Fetching releases…</p>
              {:else if releases.length === 0}
                <p class="storage-loading">No releases found.</p>
              {:else}
                <div class="release-list-scroll">
                  <div class="release-list">
                  {#each releases as release}
                    {@const isCurrent   = isCurrentVersion(release.tag_name)}
                    {@const isExpanded  = expandedTag === release.tag_name}
                    {@const isTarget    = targetTag === release.tag_name}
                    {@const isInstalling = isTarget && updatePhase === "downloading"}
                    <div class="release-row" class:current={isCurrent}>
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
                          {#if release.body.trim()}
                            <button class="release-changelog-btn"
                              onclick={() => expandedTag = isExpanded ? null : release.tag_name}>
                              {isExpanded ? "Hide" : "Changelog"}
                            </button>
                          {/if}
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
                      {#if isExpanded && release.body.trim()}
                        <div class="release-body">
                          <pre class="release-body-pre">{release.body.trim()}</pre>
                        </div>
                      {/if}
                    </div>
                  {/each}
                  </div>
                </div>
              {/if}
            </div>
            <div class="section">
              <p class="section-title">Links</p>
              <div class="about-block">
                <a href="https://github.com/Youwes09/Moku" target="_blank" class="about-line" style="color:var(--accent-fg);text-decoration:none">GitHub →</a>
                <a href="https://discord.gg/Jq3pwuNqPp" target="_blank" class="about-line" style="color:var(--accent-fg);text-decoration:none;margin-top:var(--sp-1)">Discord →</a>
              </div>
            </div>
          </div>
        {:else if tab === "devtools"}
          <div class="panel">
            <div class="section">
              <p class="section-title">Toasts</p>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Fire test toast</span><span class="toggle-desc">Triggers each kind with realistic content</span></div>
                <div class="dev-pill-group">
                  {#each ([["success","S"],["error","E"],["info","I"],["download","D"]] as const) as [kind, label]}
                    <button class="dev-pill dev-pill-{kind}" onclick={() => addToast({
                      kind,
                      title: kind === "success" ? "Library updated" : kind === "error" ? "Could not reach server" : kind === "info" ? "Already up to date" : "Download complete",
                      body:  kind === "success" ? "3 new chapters across 2 series" : kind === "error" ? "Connection refused on port 4567" : kind === "info" ? "No new chapters found" : "Berserk · Ch. 372 ready to read",
                    })}>{label}</button>
                  {/each}
                </div>
              </div>
            </div>
            <div class="section">
              <p class="section-title">Previews</p>
              <div class="step-row">
                <div class="toggle-info"><span class="toggle-label">Idle splash</span><span class="toggle-desc">Dismiss with any click or key</span></div>
                <button class="dev-btn" onclick={triggerSplash} style={splashTriggered ? "background:var(--accent-fg);color:var(--bg-base);border-color:var(--accent-fg)" : ""}>Show</button>
              </div>
            </div>
            <div class="section">
              <button class="exp-disclosure" onclick={() => expOpen = !expOpen} aria-expanded={expOpen}>
                <span class="exp-disclosure-label">Experimental</span>
                <svg class="exp-caret" class:open={expOpen} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
              </button>
              {#if expOpen}
                <div class="exp-body">
                  <p class="exp-hint">3D tilt cards — hover to preview</p>
                  <div class="exp-demo-wrap">
                    {#each [
                      { title: "Berserk",         sub: "Ch. 372", hue: "265" },
                      { title: "Vinland Saga",    sub: "Ch. 208", hue: "200" },
                      { title: "Dungeon Meshi",   sub: "Ch. 97",  hue: "140" },
                    ] as card}
                      <ThreeDCard class="exp-demo-card">
                        <div class="exp-demo-cover" style="--hue:{card.hue}"></div>
                        <div class="exp-demo-info">
                          <span class="exp-demo-title">{card.title}</span>
                          <span class="exp-demo-sub">{card.sub}</span>
                        </div>
                      </ThreeDCard>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
            <div class="section">
              <p class="section-title">Runtime</p>
              <div class="dev-grid">
                <span class="dev-key">Filter</span>
                <span class="dev-val">{store.libraryFilter}</span>
                <span class="dev-key">Folders</span>
                <span class="dev-val">{store.categories.filter(c => c.id !== 0).map(c => c.name).join(", ") || "none"}</span>
                <span class="dev-key">History</span>
                <span class="dev-val">{store.history.length} entries</span>
                <span class="dev-key">Cache</span>
                <span class="dev-val">{perfSnapshot?.cacheEntries ?? "—"} entries</span>
                <span class="dev-key">Toasts</span>
                <span class="dev-val">{store.toasts.length} queued</span>
                <span class="dev-key">Version</span>
                <span class="dev-val">{appVersion} · {import.meta.env.MODE}</span>
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
  /* ── Animations ──────────────────────────────────────────────────────────── */
  @keyframes fadeIn  { from { opacity: 0 }                              to { opacity: 1 } }
  @keyframes scaleIn { from { transform: scale(0.97); opacity: 0 }      to { transform: scale(1); opacity: 1 } }
  @keyframes pulse   { 0%,100% { opacity: 1 }                           50% { opacity: 0.6 } }
  @keyframes ripple  { 0%,100% { transform: scale(1); opacity: 0.18 }   50% { transform: scale(1.7); opacity: 0.5 } }
  @keyframes divider-travel { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }

  /* ── Modal shell ─────────────────────────────────────────────────────────── */
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.55);
    z-index: var(--z-settings);
    display: flex; align-items: center; justify-content: center;
    animation: fadeIn 0.12s ease both;
    backdrop-filter: blur(6px);
  }
  .modal {
    width: min(740px, calc(100vw - 40px));
    height: min(620px, calc(100vh - 72px));
    display: flex;
    background: var(--bg-surface);
    border: 1px solid var(--border-base);
    border-radius: var(--radius-xl);
    overflow: hidden;
    animation: scaleIn 0.18s cubic-bezier(0.16,1,0.3,1) both;
    box-shadow: 0 32px 80px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.03) inset;
  }

  /* ── Sidebar ─────────────────────────────────────────────────────────────── */
  .sidebar {
    width: 160px; flex-shrink: 0;
    background: var(--bg-base);
    border-right: 1px solid var(--border-dim);
    padding: var(--sp-4) var(--sp-2);
    display: flex; flex-direction: column; gap: 2px;
    overflow-y: auto;
  }
  .modal-title {
    font-family: var(--font-ui); font-size: var(--text-2xs);
    color: var(--text-faint); letter-spacing: var(--tracking-wider);
    text-transform: uppercase; padding: 0 var(--sp-2) var(--sp-3);
  }
  .nav { display: flex; flex-direction: column; gap: 1px; }
  .nav-item {
    display: flex; align-items: center; gap: 7px;
    padding: 6px var(--sp-2); border-radius: var(--radius-md);
    font-size: var(--text-sm); color: var(--text-faint);
    background: none; border: none; cursor: pointer; text-align: left;
    transition: background var(--t-fast), color var(--t-fast);
    width: 100%;
  }
  .nav-item:hover  { background: var(--bg-raised); color: var(--text-secondary); }
  .nav-item.active { background: var(--accent-muted); color: var(--accent-fg); }

  /* ── Content area ────────────────────────────────────────────────────────── */
  .content { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
  .content-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: var(--sp-3) var(--sp-5) 0;
    flex-shrink: 0; position: relative;
  }
  .content-header::after {
    content: ""; position: absolute; bottom: 0; left: var(--sp-5); right: var(--sp-5);
    height: 1px;
    background: linear-gradient(to right, transparent, var(--border-strong) 20%, var(--border-strong) 80%, transparent);
  }
  .content-header-left {
    display: flex; align-items: center; gap: var(--sp-2);
    padding-bottom: var(--sp-3); color: var(--text-faint);
  }
  .content-title {
    font-size: var(--text-sm); font-weight: var(--weight-medium);
    color: var(--text-primary); letter-spacing: 0.01em;
  }
  .close-btn {
    display: flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; border-radius: var(--radius-sm);
    color: var(--text-faint); background: none; border: none; cursor: pointer;
    transition: color var(--t-base), background var(--t-base);
    margin-bottom: var(--sp-3);
  }
  .close-btn:hover { color: var(--text-muted); background: var(--bg-raised); }
  .content-body { flex: 1; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--border-base) transparent; }
  .content-body::-webkit-scrollbar { width: 4px; }
  .content-body::-webkit-scrollbar-track { background: transparent; }
  .content-body::-webkit-scrollbar-thumb { background: var(--border-base); border-radius: 2px; }

  /* ── Panel / Section ─────────────────────────────────────────────────────── */
  .panel { display: flex; flex-direction: column; padding: var(--sp-3) var(--sp-5) var(--sp-5); }
  .section {
    display: flex; flex-direction: column;
    border-bottom: 1px solid var(--border-dim);
    padding-bottom: var(--sp-3); margin-bottom: var(--sp-3);
  }
  .section:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
  .section-title {
    font-family: var(--font-ui); font-size: var(--text-2xs);
    color: var(--text-faint); letter-spacing: var(--tracking-wider);
    text-transform: uppercase; padding: var(--sp-3) var(--sp-3) var(--sp-2);
  }

  /* ── Row primitives ──────────────────────────────────────────────────────── */
  .toggle-row, .step-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px var(--sp-3); border-radius: var(--radius-md);
    gap: var(--sp-3); transition: background var(--t-fast);
  }
  .toggle-row { cursor: default; }
  .toggle-row:hover, .step-row:hover { background: var(--bg-raised); }
  .toggle-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .toggle-label { font-size: var(--text-sm); color: var(--text-secondary); line-height: 1.3; }
  .toggle-desc  { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); line-height: var(--leading-snug); }

  /* ── Toggle switch ───────────────────────────────────────────────────────── */
  .toggle {
    position: relative; width: 32px; height: 18px;
    border-radius: var(--radius-full); border: 1px solid var(--border-strong);
    background: var(--bg-overlay); cursor: pointer; flex-shrink: 0;
    transition: background var(--t-base), border-color var(--t-base);
  }
  .toggle.on { background: var(--accent); border-color: var(--accent); }
  .toggle-thumb {
    position: absolute; top: 2px; left: 2px;
    width: 12px; height: 12px; border-radius: 50%;
    background: var(--text-faint);
    transition: transform var(--t-base), background var(--t-base);
  }
  .toggle.on .toggle-thumb { transform: translateX(14px); background: var(--bg-void); }

  /* ── Stepper controls ────────────────────────────────────────────────────── */
  .step-controls { display: flex; align-items: center; gap: var(--sp-1); flex-shrink: 0; }
  .step-btn {
    font-family: var(--font-ui); font-size: var(--text-sm);
    width: 26px; height: 26px; border-radius: var(--radius-sm);
    border: 1px solid var(--border-dim); background: none; color: var(--text-muted);
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: color var(--t-base), border-color var(--t-base), background var(--t-base);
  }
  .step-btn:hover:not(:disabled) { color: var(--text-secondary); border-color: var(--border-strong); background: var(--bg-raised); }
  .step-btn:disabled { opacity: 0.3; cursor: default; }
  .step-val { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-secondary); letter-spacing: var(--tracking-wide); min-width: 40px; text-align: center; }

  /* ── Select dropdown ─────────────────────────────────────────────────────── */
  .select-wrap { position: relative; flex-shrink: 0; }
  .select-btn {
    display: flex; align-items: center; gap: var(--sp-2);
    font-size: var(--text-sm); color: var(--text-secondary);
    background: var(--bg-raised); border: 1px solid var(--border-dim);
    border-radius: var(--radius-md); padding: 5px 10px;
    cursor: pointer; min-width: 130px;
    transition: border-color var(--t-base), background var(--t-base);
  }
  .select-btn:hover { border-color: var(--border-strong); background: var(--bg-overlay); }
  .select-caret { color: var(--text-faint); transition: transform var(--t-base); flex-shrink: 0; margin-left: auto; }
  .select-caret.open { transform: rotate(180deg); }
  .select-menu {
    position: absolute; top: calc(100% + 4px); right: 0; min-width: 100%;
    background: var(--bg-raised); border: 1px solid var(--border-base);
    border-radius: var(--radius-md); padding: var(--sp-1);
    z-index: 200; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    animation: scaleIn 0.1s ease both; transform-origin: top right;
  }
  .select-option {
    display: block; width: 100%; padding: 6px var(--sp-3);
    border-radius: var(--radius-sm); font-size: var(--text-sm);
    color: var(--text-secondary); background: none; border: none;
    cursor: pointer; text-align: left;
    transition: background var(--t-fast), color var(--t-fast);
  }
  .select-option:hover  { background: var(--bg-overlay); color: var(--text-primary); }
  .select-option.active { color: var(--accent-fg); background: var(--accent-muted); }

  /* ── Text input ──────────────────────────────────────────────────────────── */
  .text-input {
    background: var(--bg-raised); border: 1px solid var(--border-dim);
    border-radius: var(--radius-md); padding: 5px 10px;
    color: var(--text-primary); font-size: var(--text-sm);
    outline: none; width: 200px; flex-shrink: 0;
    transition: border-color var(--t-base), background var(--t-base);
  }
  .text-input:focus { border-color: var(--accent-dim); background: var(--bg-overlay); }
  .text-input::placeholder { color: var(--text-faint); }

  /* ── Unified button system ───────────────────────────────────────────────── */
  /* Base: .btn  Variants: --accent  --danger  (no modifier = ghost)           */
  .btn, .danger-btn, .dev-btn, .sec-action-btn, .folder-create-btn,
  .release-changelog-btn, .update-action-btn {
    display: inline-flex; align-items: center; gap: var(--sp-1);
    font-family: var(--font-ui); font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide); white-space: nowrap;
    padding: 5px 13px; border-radius: var(--radius-md);
    border: 1px solid var(--border-dim);
    background: none; color: var(--text-muted);
    cursor: pointer; flex-shrink: 0;
    transition: color var(--t-base), border-color var(--t-base), background var(--t-base), filter var(--t-base);
  }
  .btn:hover:not(:disabled),
  .dev-btn:hover:not(:disabled),
  .sec-action-btn:hover:not(:disabled),
  .release-changelog-btn:hover:not(:disabled) {
    color: var(--text-secondary); border-color: var(--border-strong); background: var(--bg-raised);
  }
  .btn:disabled, .danger-btn:disabled, .dev-btn:disabled,
  .sec-action-btn:disabled, .folder-create-btn:disabled, .update-action-btn:disabled {
    opacity: 0.35; cursor: default;
  }

  /* Accent variant */
  .sec-action-primary, .folder-create-btn,
  .update-action-btn.primary {
    background: var(--accent-muted); border-color: var(--accent-dim); color: var(--accent-fg);
  }
  .sec-action-primary:hover:not(:disabled),
  .folder-create-btn:hover:not(:disabled),
  .update-action-btn.primary:hover:not(:disabled) { filter: brightness(1.12); }

  /* Danger variant */
  .danger-btn, .sec-action-danger {
    border-color: color-mix(in srgb, var(--color-error) 50%, transparent);
    color: var(--color-error); background: none;
  }
  .danger-btn:hover:not(:disabled), .sec-action-danger:hover:not(:disabled) {
    background: var(--color-error-bg);
    border-color: var(--color-error);
  }
  /* ── Dev tools ───────────────────────────────────────────────────────────── */
  .dev-mono { font-family: monospace; font-size: 11px; color: var(--text-faint); flex-shrink: 0; }
  .dev-pill-group { display: flex; gap: 4px; flex-shrink: 0; }
  .dev-pill {
    font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wider);
    font-weight: var(--weight-medium); width: 26px; height: 26px;
    border-radius: var(--radius-sm); border: 1px solid var(--border-dim);
    background: none; color: var(--text-faint); cursor: pointer;
    transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
    display: flex; align-items: center; justify-content: center;
  }
  .dev-pill:hover                { background: var(--bg-overlay); color: var(--text-secondary); border-color: var(--border-strong); }
  .dev-pill-success:hover        { color: var(--accent-fg); border-color: var(--accent-dim); background: var(--accent-muted); }
  .dev-pill-error:hover          { color: var(--color-error); border-color: color-mix(in srgb, var(--color-error) 40%, transparent); background: var(--color-error-bg); }
  .dev-pill-info:hover           { color: var(--text-secondary); border-color: var(--border-strong); background: var(--bg-overlay); }
  .dev-pill-download:hover       { color: var(--accent-fg); border-color: var(--accent-dim); background: var(--accent-muted); }
  .dev-grid { display: grid; grid-template-columns: 64px 1fr; gap: 1px 12px; padding: var(--sp-2) var(--sp-3) var(--sp-3); }
  .dev-key { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wider); text-transform: uppercase; color: var(--text-faint); padding: 4px 0; display: flex; align-items: center; }
  .dev-val { font-family: monospace; font-size: 11px; color: var(--text-secondary); padding: 4px 0; display: flex; align-items: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* ── Experimental disclosure ─────────────────────────────────────────────── */
  .exp-disclosure {
    display: flex; align-items: center; justify-content: space-between;
    width: 100%; padding: var(--sp-2) var(--sp-3);
    background: none; border: none; cursor: pointer;
    color: var(--text-faint); transition: color var(--t-fast);
  }
  .exp-disclosure:hover { color: var(--text-secondary); }
  .exp-disclosure-label { font-family: var(--font-ui); font-size: var(--text-xs); font-weight: var(--weight-medium); letter-spacing: var(--tracking-wider); text-transform: uppercase; }
  .exp-caret { transition: transform 0.18s ease; flex-shrink: 0; }
  .exp-caret.open { transform: rotate(180deg); }
  .exp-body { padding: 0 var(--sp-3) var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-2); }
  .exp-hint { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .exp-demo-wrap { display: flex; justify-content: center; gap: var(--sp-3); padding: var(--sp-2) 0; }
  :global(.exp-demo-card) {
    width: 90px; border-radius: var(--radius-lg);
    background: var(--bg-raised); border: 1px solid var(--border-dim);
  }
  .exp-demo-cover {
    height: 120px;
    background: linear-gradient(160deg,
      hsl(var(--hue, 220) 30% 18%) 0%,
      hsl(var(--hue, 220) 40% 28%) 100%
    );
    border-bottom: 1px solid var(--border-dim);
  }
  .exp-demo-info { padding: 6px 8px; display: flex; flex-direction: column; gap: 2px; }
  .exp-demo-title { font-size: var(--text-xs); font-weight: var(--weight-medium); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .exp-demo-sub   { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }

  /* ── Scale / zoom control ────────────────────────────────────────────────── */
  .scale-row { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--sp-3); }
  .scale-slider { flex: 1; accent-color: var(--accent); }
  .scale-val-input {
    font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-secondary);
    width: 42px; text-align: center; padding: 3px 4px;
    background: var(--bg-raised); border: 1px solid var(--border-dim);
    border-radius: var(--radius-sm); outline: none; transition: border-color var(--t-base);
    -moz-appearance: textfield;
  }
  .scale-val-input::-webkit-inner-spin-button,
  .scale-val-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .scale-val-input:focus { border-color: var(--accent-dim); }
  .scale-pct { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); margin-left: calc(var(--sp-1) * -1); }
  .scale-hint { padding: 0 var(--sp-3) var(--sp-2); display: flex; gap: var(--sp-1); flex-wrap: wrap; }
  .scale-preset {
    font-family: var(--font-ui); font-size: var(--text-2xs); padding: 2px 7px;
    border-radius: var(--radius-sm); border: 1px solid var(--border-dim);
    background: none; color: var(--text-faint); cursor: pointer;
    transition: color var(--t-base), border-color var(--t-base), background var(--t-base);
  }
  .scale-preset:hover        { color: var(--text-muted); border-color: var(--border-strong); }
  .scale-preset.active       { background: var(--accent-muted); border-color: var(--accent-dim); color: var(--accent-fg); }

  /* ── Theme grid ──────────────────────────────────────────────────────────── */
  .theme-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(134px, 1fr)); gap: var(--sp-3); padding: var(--sp-2) var(--sp-3); }
  :global(.theme-card) {
    background: var(--bg-raised); border: 1px solid var(--border-dim);
    border-radius: var(--radius-lg); overflow: hidden; cursor: pointer;
    text-align: left; transition: border-color var(--t-base), box-shadow var(--t-base);
    position: relative;
  }
  :global(.theme-card:hover) { border-color: var(--border-strong); box-shadow: 0 2px 12px rgba(0,0,0,0.2); }
  :global(.theme-card.active) { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .theme-card-inner { display: flex; flex-direction: column; width: 100%; background: none; border: none; cursor: pointer; text-align: left; }
  .theme-preview { height: 68px; overflow: hidden; }
  .theme-preview-bg { width: 100%; height: 100%; display: flex; }
  .theme-preview-sidebar { width: 20%; height: 100%; flex-shrink: 0; }
  .theme-preview-content { flex: 1; padding: 8px 6px; display: flex; flex-direction: column; gap: 5px; }
  .theme-preview-accent { height: 6px; width: 50%; border-radius: 3px; }
  .theme-preview-text   { height: 4px; width: 100%; border-radius: 2px; }
  .theme-card-info { padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; }
  .theme-card-label { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-secondary); }
  .theme-card-desc  { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .theme-card-check { position: absolute; top: 6px; right: 6px; font-size: 10px; color: var(--accent-fg); background: var(--accent-muted); border: 1px solid var(--accent-dim); border-radius: var(--radius-sm); padding: 1px 5px; }
  .custom-badge { color: var(--accent-fg) !important; }
  .custom-theme-card { position: relative; display: flex; flex-direction: column; padding: 0; cursor: default; }
  .custom-theme-select { flex: 1; text-align: left; cursor: pointer; display: flex; flex-direction: column; background: none; border: none; color: inherit; font-family: inherit; }
  .custom-theme-actions { display: none; position: absolute; top: 5px; left: 5px; flex-direction: row; gap: 3px; z-index: 1; }
  .custom-theme-card:hover .custom-theme-actions { display: flex; }
  .custom-theme-edit-btn,
  .custom-theme-delete-btn {
    display: flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; border-radius: 3px; font-size: 10px; cursor: pointer;
    border: 1px solid var(--border-base); background: var(--bg-overlay);
    transition: background var(--t-base), color var(--t-base), border-color var(--t-base);
  }
  .custom-theme-edit-btn   { color: var(--text-muted); }
  .custom-theme-edit-btn:hover   { color: var(--accent-fg); background: var(--accent-muted); border-color: var(--accent-dim); }
  .custom-theme-delete-btn { color: var(--text-faint); }
  .custom-theme-delete-btn:hover { color: var(--color-error); background: var(--color-error-bg); border-color: var(--color-error); }
  .new-theme-card { display: flex; flex-direction: column; border-style: dashed !important; border-color: var(--border-base) !important; background: transparent !important; transition: border-color var(--t-base) !important, background var(--t-base) !important; }
  .new-theme-card:hover { border-color: var(--accent-dim) !important; background: var(--accent-muted) !important; }
  .new-theme-icon { height: 68px; display: flex; align-items: center; justify-content: center; color: var(--text-faint); transition: color var(--t-base); }
  :global(.new-theme-card:hover) .new-theme-icon { color: var(--accent-fg); }

  /* ── Keybinds ────────────────────────────────────────────────────────────── */
  .kb-hint  { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); padding: 0 var(--sp-3) var(--sp-3); }
  .kb-list  { display: flex; flex-direction: column; gap: 1px; }
  .kb-row   { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-md); transition: background var(--t-fast); }
  .kb-row:hover { background: var(--bg-raised); }
  .kb-label { font-size: var(--text-sm); color: var(--text-secondary); flex: 1; }
  .kb-right { display: flex; align-items: center; gap: var(--sp-2); }
  .kb-bind  {
    font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide);
    padding: 4px 10px; border-radius: var(--radius-sm);
    border: 1px solid var(--border-dim); background: var(--bg-raised);
    color: var(--text-secondary); cursor: pointer; min-width: 90px; text-align: center;
    transition: border-color var(--t-base), color var(--t-base);
  }
  .kb-bind:hover              { border-color: var(--border-strong); }
  .kb-bind.listening          { border-color: var(--accent); color: var(--accent-fg); background: var(--accent-muted); animation: pulse 1s ease infinite; }
  .kb-reset {
    font-size: var(--text-sm); color: var(--text-faint);
    padding: 3px 7px; border-radius: var(--radius-sm);
    border: 1px solid transparent; background: none; cursor: pointer;
    transition: color var(--t-base), border-color var(--t-base), background var(--t-base);
  }
  .kb-reset:hover:not(:disabled) { color: var(--text-muted); border-color: var(--border-dim); background: var(--bg-overlay); }
  .kb-reset:disabled { opacity: 0.3; cursor: default; }

  /* ── Storage ─────────────────────────────────────────────────────────────── */
  .storage-loading { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); padding: var(--sp-3); }
  .storage-bar-wrap   { padding: var(--sp-2) var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-2); }
  .storage-bar-header { display: flex; justify-content: space-between; align-items: baseline; }
  .storage-bar-label  { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-muted); letter-spacing: var(--tracking-wide); }
  .storage-bar        { height: 5px; background: var(--bg-overlay); border-radius: var(--radius-full); overflow: hidden; }
  .storage-bar-fill   { height: 100%; background: var(--accent); border-radius: var(--radius-full); transition: width 0.4s ease; }
  .storage-bar-fill.warn     { background: #d97706; }
  .storage-bar-fill.critical { background: var(--color-error); }
  .storage-bar-labels { display: flex; justify-content: space-between; }
  .storage-bar-used, .storage-bar-free { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .storage-path-note  { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); padding: var(--sp-1) var(--sp-3) 0; word-break: break-all; }
  .storage-limit-input {
    width: 64px; text-align: center;
    background: var(--bg-raised); border: 1px solid var(--border-dim);
    border-radius: var(--radius-sm); padding: 3px 6px;
    color: var(--text-secondary); font-family: var(--font-ui); font-size: var(--text-xs);
    outline: none; transition: border-color var(--t-base); -moz-appearance: textfield;
  }
  .storage-limit-input::-webkit-inner-spin-button,
  .storage-limit-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .storage-limit-input:focus { border-color: var(--accent-dim); }
  .storage-limit-unit { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); flex-shrink: 0; }

  /* ── Migration banner ────────────────────────────────────────────────────── */
  .migrate-banner { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-4); margin-bottom: var(--sp-2); padding: var(--sp-3) var(--sp-4); background: color-mix(in srgb, var(--color-info) 7%, transparent); border: 1px solid color-mix(in srgb, var(--color-info) 22%, transparent); border-radius: var(--radius-md); }
  .migrate-banner-body    { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
  .migrate-title          { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--color-info); letter-spacing: var(--tracking-wide); }
  .migrate-paths          { font-family: monospace; font-size: 10px; color: var(--text-faint); word-break: break-all; }
  .migrate-error          { font-size: var(--text-xs); color: var(--color-error); }
  .migrate-progress       { display: flex; flex-direction: column; gap: 4px; margin-top: 2px; }
  .migrate-progress-labels { display: flex; justify-content: space-between; }
  .migrate-current        { font-family: monospace; font-size: 10px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%; }
  .migrate-count          { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); flex-shrink: 0; }
  .migrate-bar            { height: 3px; background: var(--bg-overlay); border-radius: 2px; overflow: hidden; }
  .migrate-bar-fill       { height: 100%; background: var(--color-info); border-radius: 2px; transition: width 0.15s; }
  .migrate-banner-actions { display: flex; flex-direction: column; gap: var(--sp-1); flex-shrink: 0; align-items: flex-end; }

  /* ── Downloads path ──────────────────────────────────────────────────────── */
  .path-row         { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-2) var(--sp-3) var(--sp-3); }
  .path-input       { flex: 1; width: 0 !important; min-width: 0; font-family: monospace !important; font-size: var(--text-xs) !important; }
  .path-input-error { border-color: var(--color-error) !important; }
  .path-field-error { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--color-error); letter-spacing: var(--tracking-wide); white-space: nowrap; }
  .path-actions     { display: flex; align-items: center; gap: var(--sp-2); flex-shrink: 0; }

  /* ── Advanced / Backup collapsible ──────────────────────────────────────── */
  .adv-section  { padding-bottom: var(--sp-1); }
  .adv-toggle   { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: var(--sp-2) var(--sp-3); background: none; border: none; cursor: pointer; border-radius: var(--radius-md); transition: background var(--t-fast); }
  .adv-toggle:hover { background: var(--bg-raised); }
  .adv-caret    { color: var(--text-faint); transition: transform var(--t-base); flex-shrink: 0; }
  .adv-caret.open { transform: rotate(180deg); }
  .adv-body     { display: flex; flex-direction: column; gap: 1px; padding-top: var(--sp-1); }

  /* ── Folders / categories ────────────────────────────────────────────────── */
  .folder-create-row { display: flex; gap: var(--sp-2); padding: 0 var(--sp-3) var(--sp-3); }
  .folder-list  { display: flex; flex-direction: column; gap: 1px; padding: 0 var(--sp-2); }
  .folder-row   { display: flex; align-items: center; gap: var(--sp-2); padding: 7px var(--sp-2); border-radius: var(--radius-md); transition: background var(--t-fast); }
  .folder-row:hover     { background: var(--bg-raised); }
  .folder-row-name      { flex: 1; font-size: var(--text-sm); color: var(--text-secondary); }
  .folder-row-count     { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); flex-shrink: 0; }
  .folder-delete:hover:not(:disabled)  { color: var(--color-error) !important; }
  .folder-hidden        { opacity: 0.35; }
  .folder-default-active { color: var(--accent-fg) !important; }

  /* ── Trackers ────────────────────────────────────────────────────────────── */
  .tracker-list         { display: flex; flex-direction: column; gap: var(--sp-2); padding: 0 var(--sp-3) var(--sp-3); }
  .tracker-row          { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-3); border-radius: var(--radius-md); border: 1px solid var(--border-dim); background: var(--bg-raised); transition: border-color var(--t-fast); gap: var(--sp-3); }
  .tracker-row-active   { border-color: color-mix(in srgb, var(--accent) 30%, transparent); }
  .tracker-identity     { display: flex; align-items: center; gap: var(--sp-3); min-width: 0; flex: 1; }
  .tracker-logo         { width: 32px; height: 32px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0; border: 1px solid var(--border-dim); }
  .tracker-name-block   { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .tracker-label        { font-size: var(--text-sm); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tracker-status-pill  { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wider); text-transform: uppercase; padding: 1px 6px; border-radius: var(--radius-full); border: 1px solid var(--border-dim); color: var(--text-faint); background: transparent; width: fit-content; }
  .pill-on              { border-color: color-mix(in srgb, var(--accent) 40%, transparent); color: var(--accent-fg); background: var(--accent-muted); }
  .tracker-action       { flex-shrink: 0; }
  .tracker-connected-btns { display: flex; gap: var(--sp-2); }
  .tracker-error        { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--color-error); padding: var(--sp-2) var(--sp-3); letter-spacing: var(--tracking-wide); }
  .oauth-panel          { display: flex; flex-direction: column; gap: var(--sp-3); padding: 0 var(--sp-3) var(--sp-3); }
  .oauth-label          { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .oauth-input-row      { display: flex; gap: var(--sp-2); }
  .oauth-input-row .text-input { flex: 1; width: 0; }
  .creds-panel          { display: flex; flex-direction: column; gap: var(--sp-2); padding: 0 var(--sp-3) var(--sp-3); }

  /* ── About / releases ────────────────────────────────────────────────────── */
  .about-block  { padding: 0 var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-1); }
  .about-line   { font-size: var(--text-sm); color: var(--text-muted); line-height: var(--leading-base); }
  .release-list-scroll { max-height: 320px; overflow-y: auto; padding: 0 var(--sp-1); scrollbar-width: thin; scrollbar-color: var(--border-base) transparent; }
  .release-list-scroll::-webkit-scrollbar       { width: 4px; }
  .release-list-scroll::-webkit-scrollbar-track { background: transparent; }
  .release-list-scroll::-webkit-scrollbar-thumb { background: var(--border-base); border-radius: 2px; }
  .release-list         { display: flex; flex-direction: column; gap: 2px; }
  .release-row          { border-radius: var(--radius-md); border: 1px solid transparent; overflow: hidden; transition: border-color var(--t-fast); }
  .release-row.current  { border-color: color-mix(in srgb, var(--accent) 25%, transparent); }
  .release-header       { display: flex; align-items: center; justify-content: space-between; padding: 8px var(--sp-3); gap: var(--sp-3); }
  .release-header:hover { background: var(--bg-raised); }
  .release-meta         { display: flex; align-items: center; gap: var(--sp-2); flex: 1; min-width: 0; }
  .release-tag          { font-family: var(--font-ui); font-size: var(--text-xs); font-weight: var(--weight-medium); color: var(--text-secondary); letter-spacing: var(--tracking-wide); }
  .release-badge        { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wider); text-transform: uppercase; padding: 1px 6px; border-radius: var(--radius-full); border: 1px solid; }
  .current-badge        { color: var(--accent-fg); border-color: var(--accent-dim); background: var(--accent-muted); }
  .release-date         { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .release-actions      { display: flex; align-items: center; gap: var(--sp-2); flex-shrink: 0; }
  .release-changelog-btn { padding: 3px 10px; }
  .release-body         { padding: var(--sp-2) var(--sp-3) var(--sp-3); border-top: 1px solid var(--border-dim); }
  .release-body-text    { font-size: var(--text-xs); color: var(--text-faint); line-height: var(--leading-base); white-space: pre-wrap; word-break: break-word; }
  .update-action-btn    { padding: 4px 12px; }
  .update-progress-wrap { padding: var(--sp-2) var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-2); }
  .update-progress-bar  { height: 3px; background: var(--bg-overlay); border-radius: 2px; overflow: hidden; }
  .update-progress-fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.3s ease; }
  .update-progress-row  { display: flex; justify-content: space-between; }
  .update-progress-label, .update-progress-val { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .update-ready-row     { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3); background: color-mix(in srgb, var(--accent) 8%, transparent); border-radius: var(--radius-md); margin: 0 var(--sp-1); }
  .update-ready-label   { flex: 1; font-family: var(--font-ui); font-size: var(--text-xs); color: var(--accent-fg); letter-spacing: var(--tracking-wide); }
  .update-error-row     { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3); }

  /* ── Performance ─────────────────────────────────────────────────────────── */
  .perf-stat-group { display: flex; align-items: center; gap: var(--sp-2); flex-shrink: 0; }
  .perf-stat { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-secondary); letter-spacing: var(--tracking-wide); flex-shrink: 0; }

  /* ── Security ────────────────────────────────────────────────────────────── */
  .sec-banner        { font-family: var(--font-ui); font-size: var(--text-xs); line-height: var(--leading-snug); border-radius: var(--radius-md); padding: var(--sp-3); letter-spacing: var(--tracking-wide); }
  .sec-banner-error  { color: var(--color-error); background: var(--color-error-bg); border: 1px solid var(--color-error); }
  .sec-banner-warn   { color: var(--color-warn, var(--color-error)); background: var(--color-warn-bg, var(--color-error-bg)); border: 1px solid var(--color-warn, var(--color-error)); }
  .sec-banner-warn code { font-family: monospace; font-size: 10px; background: color-mix(in srgb, var(--color-warn, var(--color-error)) 12%, transparent); padding: 1px 4px; border-radius: 3px; }
  .sec-pill-warn    { border-color: var(--color-error); color: var(--color-error); background: var(--color-error-bg); }
  .section-title-row { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-3) var(--sp-3) var(--sp-2); }
  .section-title-row .section-title { padding: 0; }
  .sec-status-pill { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wider); text-transform: uppercase; padding: 2px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); color: var(--text-faint); background: var(--bg-overlay); flex-shrink: 0; cursor: default; }
  .sec-pill-on     { border-color: var(--accent-dim); color: var(--accent-fg); background: var(--accent-muted); }
  .sec-field-wrap  { position: relative; flex-shrink: 0; }
  .sec-field-wrap .text-input { padding-right: 34px; }
  .sec-eye-btn { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); display: flex; align-items: center; justify-content: center; padding: 0; border: none; background: none; color: var(--text-faint); cursor: pointer; transition: color var(--t-base); }
  .sec-eye-btn:hover { color: var(--text-muted); }
  .sec-btn-row  { display: flex; align-items: center; gap: var(--sp-2); flex-shrink: 0; }
  .auth-perf-note { font-size: var(--text-xs); color: var(--text-faint); max-width: 260px; line-height: var(--leading-snug); }
  .auth-mode-group { display: flex; gap: 2px; background: var(--bg-overlay); border: 1px solid var(--border-base); border-radius: var(--radius-md); padding: 2px; flex-shrink: 0; }
  .auth-mode-btn { font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 4px 10px; border-radius: var(--radius-sm); border: none; background: none; color: var(--text-faint); cursor: pointer; transition: color var(--t-fast), background var(--t-fast); white-space: nowrap; }
  .auth-mode-btn:hover:not(:disabled)  { color: var(--text-secondary); background: var(--bg-raised); }
  .auth-mode-btn.auth-mode-active      { background: var(--bg-surface); color: var(--text-primary); box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
  .auth-mode-btn:disabled { opacity: 0.4; cursor: default; }
  .sec-pin-error { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--color-error); letter-spacing: var(--tracking-wide); }

  /* ── Content filter ──────────────────────────────────────────────────────── */
  .content-tag-grid    { display: flex; flex-wrap: wrap; gap: var(--sp-2); padding: 0 var(--sp-3) var(--sp-3); }
  .content-tag         { display: inline-flex; align-items: center; gap: 5px; font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 4px 8px 4px 7px; border-radius: var(--radius-full); border: 1px solid var(--border-base); background: var(--bg-raised); color: var(--text-secondary); }
  .content-tag-remove  { display: flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%; border: none; background: none; color: var(--text-faint); cursor: pointer; font-size: 14px; line-height: 1; padding: 0; margin-left: 1px; transition: color var(--t-fast), background var(--t-fast); }
  .content-tag-remove:hover { color: var(--color-error); background: var(--color-error-bg); }
  .content-tag-add     { display: flex; align-items: center; gap: var(--sp-2); padding: 0 var(--sp-3); }
  .content-source-search-wrap { padding: 0 var(--sp-3) var(--sp-3); }
  .content-source-list { display: flex; flex-direction: column; gap: 2px; padding: 0 var(--sp-2); }
  .content-source-row  { display: flex; align-items: center; gap: var(--sp-3); padding: 8px var(--sp-3); border-radius: var(--radius-md); border: 1px solid transparent; transition: background var(--t-fast), border-color var(--t-fast); }
  .content-source-row:hover      { background: var(--bg-raised); }
  .content-source-allowed        { background: color-mix(in srgb, var(--color-success) 6%, transparent); border-color: color-mix(in srgb, var(--color-success) 25%, transparent) !important; }
  .content-source-blocked        { background: color-mix(in srgb, var(--color-error)   6%, transparent); border-color: color-mix(in srgb, var(--color-error)   25%, transparent) !important; }
  .content-source-icon  { width: 28px; height: 28px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0; border: 1px solid var(--border-dim); background: var(--bg-overlay); }
  .content-source-info  { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .content-source-name  { font-size: var(--text-sm); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .content-source-lang  { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .content-source-actions { display: flex; gap: var(--sp-1); flex-shrink: 0; }
  .content-action-btn   { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); padding: 3px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: none; color: var(--text-faint); cursor: pointer; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); }
  .content-action-btn:hover              { color: var(--text-muted); border-color: var(--border-strong); background: var(--bg-overlay); }
  .content-action-active-allow { color: var(--color-success) !important; border-color: color-mix(in srgb, var(--color-success) 40%, transparent) !important; background: color-mix(in srgb, var(--color-success) 10%, transparent) !important; }
  .content-action-active-block { color: var(--color-error)   !important; border-color: color-mix(in srgb, var(--color-error)   40%, transparent) !important; background: color-mix(in srgb, var(--color-error)   10%, transparent) !important; }
</style>