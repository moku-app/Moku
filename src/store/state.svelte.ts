import type { Manga, Chapter, Category, Source } from "../lib/types";
import { DEFAULT_KEYBINDS, type Keybinds } from "../lib/keybinds";

export type PageStyle        = "single" | "double" | "longstrip";
export type FitMode          = "width" | "height" | "screen" | "original";
export type LibraryFilter    = "all" | "library" | "downloaded" | string;
export type NavPage          = "home" | "library" | "sources" | "explore" | "downloads" | "extensions" | "history" | "search" | "tracking";
export type ReadingDirection = "ltr" | "rtl";
export type ChapterSortDir   = "desc" | "asc";
export type ChapterSortMode  = "source" | "chapterNumber" | "uploadDate";

export type LibrarySortMode =
  | "az"
  | "unreadCount"
  | "totalChapters"
  | "recentlyAdded"
  | "recentlyRead"
  | "latestFetched"
  | "latestUploaded";

export type LibrarySortDir = "asc" | "desc";

export type LibraryStatusFilter =
  | "ALL"
  | "ONGOING"
  | "COMPLETED"
  | "CANCELLED"
  | "HIATUS"
  | "UNKNOWN";
export type BuiltinTheme     = "dark" | "high-contrast" | "light" | "light-contrast" | "midnight" | "warm";
export type Theme            = BuiltinTheme | string; // custom themes have string IDs like "custom:abc123"

export interface ThemeTokens {
  /* Backgrounds */
  "bg-void":    string;
  "bg-base":    string;
  "bg-surface": string;
  "bg-raised":  string;
  "bg-overlay": string;
  "bg-subtle":  string;
  /* Borders */
  "border-dim":    string;
  "border-base":   string;
  "border-strong": string;
  "border-focus":  string;
  /* Text */
  "text-primary":   string;
  "text-secondary": string;
  "text-muted":     string;
  "text-faint":     string;
  "text-disabled":  string;
  /* Accent */
  "accent":        string;
  "accent-dim":    string;
  "accent-muted":  string;
  "accent-fg":     string;
  "accent-bright": string;
  /* Semantic */
  "color-error":    string;
  "color-error-bg": string;
  "color-success":  string;
  "color-info":     string;
  "color-info-bg":  string;
}

export interface CustomTheme {
  id:     string; // "custom:abc123"
  name:   string;
  tokens: ThemeTokens;
}

export const DEFAULT_THEME_TOKENS: ThemeTokens = {
  "bg-void":    "#080808",
  "bg-base":    "#0c0c0c",
  "bg-surface": "#101010",
  "bg-raised":  "#151515",
  "bg-overlay": "#1a1a1a",
  "bg-subtle":  "#202020",
  "border-dim":    "#1c1c1c",
  "border-base":   "#242424",
  "border-strong": "#2e2e2e",
  "border-focus":  "#4a5c4a",
  "text-primary":   "#f0efec",
  "text-secondary": "#c8c6c0",
  "text-muted":     "#8a8880",
  "text-faint":     "#4e4d4a",
  "text-disabled":  "#2a2a28",
  "accent":        "#6b8f6b",
  "accent-dim":    "#2a3d2a",
  "accent-muted":  "#1a251a",
  "accent-fg":     "#a8c4a8",
  "accent-bright": "#8fb88f",
  "color-error":    "#c47a7a",
  "color-error-bg": "#1f1212",
  "color-success":  "#7aab7a",
  "color-info":     "#7a9ec4",
  "color-info-bg":  "#121a1f",
};


export interface HistoryEntry {
  mangaId:      number;
  mangaTitle:   string;
  thumbnailUrl: string;
  chapterId:    number;
  chapterName:  string;
  pageNumber:   number;
  readAt:       number;
}

/**
 * ReadLogEntry — append-only record of every chapter-completion event.
 * Unlike HistoryEntry (which dedupes per chapter for the "continue" UI),
 * this log never overwrites existing entries. It is the source of truth
 * for all reading stats.
 */
export interface ReadLogEntry {
  mangaId:   number;
  chapterId: number;
  readAt:    number;
  /** Minutes spent on this chapter (estimated from page count or default). */
  minutes:   number;
}

export interface ReadingStats {
  totalChaptersRead: number;
  totalMangaRead:    number;
  totalMinutesRead:  number;
  firstReadAt:       number;
  lastReadAt:        number;
  currentStreakDays: number;
  longestStreakDays: number;
  lastStreakDate:    string;
}

const AVG_MIN_PER_CHAPTER = 5; // fallback when no page count is available

export const DEFAULT_READING_STATS: ReadingStats = {
  totalChaptersRead: 0,
  totalMangaRead:    0,
  totalMinutesRead:  0,
  firstReadAt:       0,
  lastReadAt:        0,
  currentStreakDays: 0,
  longestStreakDays: 0,
  lastStreakDate:    "",
};

export interface Toast {
  id:        string;
  kind:      "success" | "error" | "info" | "download";
  title:     string;
  body?:     string;
  duration?: number;
}

export interface ActiveDownload {
  chapterId: number;
  mangaId:   number;
  progress:  number;
}


export interface Settings {
  pageStyle:               PageStyle;
  readingDirection:        ReadingDirection;
  fitMode:                 FitMode;
  /**
   * Reader zoom level — unitless float multiplier relative to the viewer
   * container width. 1.0 = image fills the viewer, 1.5 = 150%, 0.8 = 80%.
   * Replaces the old `maxPageWidth` pixel value.
   */
  readerZoom:              number;
  pageGap:                 boolean;
  optimizeContrast:        boolean;
  offsetDoubleSpreads:     boolean;
  preloadPages:            number;
  autoMarkRead:            boolean;
  autoNextChapter:         boolean;
  libraryCropCovers:       boolean;
  libraryPageSize:         number;
  showNsfw:                boolean;
  discordRpc:              boolean;
  chapterSortDir:          ChapterSortDir;
  chapterSortMode:         ChapterSortMode;
  chapterPageSize:         number;
  /**
   * UI zoom level — unitless float multiplier applied on top of the
   * platform scale factor from the OS/monitor. 1.0 = no user adjustment.
   * Replaces the old `uiScale` percentage integer.
   */
  uiZoom:                  number;
  compactSidebar:          boolean;
  gpuAcceleration:         boolean;
  serverUrl:               string;
  serverBinary:            string;
  autoStartServer:         boolean;
  preferredExtensionLang:  string;
  keybinds:                Keybinds;
  idleTimeoutMin?:         number;
  splashCards?:            boolean;
  storageLimitGb:          number | null;
  markReadOnNext:          boolean;
  readerDebounceMs:        number;
  theme:                   Theme;
  libraryBranches:         boolean;
  renderLimit:             number;
  heroSlots:               (number | null)[];
  mangaLinks:              Record<number, number[]>;
  serverAuthUser:          string;
  serverAuthPass:          string;
  serverAuthEnabled:       boolean;
  socksProxyEnabled:       boolean;
  socksProxyHost:          string;
  socksProxyPort:          string;
  socksProxyVersion:       number;
  socksProxyUsername:      string;
  socksProxyPassword:      string;
  flareSolverrEnabled:     boolean;
  flareSolverrUrl:         string;
  flareSolverrTimeout:     number;
  flareSolverrSessionName: string;
  flareSolverrSessionTtl:  number;
  flareSolverrFallback:    boolean;
  appLockEnabled:          boolean;
  appLockPin:              string;
  customThemes:            CustomTheme[];
  hiddenCategoryIds:       number[];
  /** Category ID that opens by default when the Library tab is first visited. null = no default (shows Saved). */
  defaultLibraryCategoryId: number | null;
  /** Per-tab sort/filter state — keyed by libraryFilter value (e.g. "library", "downloaded", "42"). */
  libraryTabSort:   Record<string, { mode: LibrarySortMode; dir: LibrarySortDir }>;
  libraryTabStatus: Record<string, LibraryStatusFilter>;
  // Legacy fields kept for migration reads only — never written after v3.
  /** @deprecated use readerZoom */
  maxPageWidth?:           number;
  /** @deprecated use uiZoom */
  uiScale?:                number;
}


export const DEFAULT_SETTINGS: Settings = {
  pageStyle:              "longstrip",
  readingDirection:       "ltr",
  fitMode:                "width",
  readerZoom:             1.0,
  pageGap:                true,
  optimizeContrast:       false,
  offsetDoubleSpreads:    false,
  preloadPages:           3,
  autoMarkRead:           true,
  autoNextChapter:        true,
  libraryCropCovers:      true,
  libraryPageSize:        48,
  showNsfw:               false,
  discordRpc:             false,
  chapterSortDir:         "desc",
  chapterSortMode:        "source",
  chapterPageSize:        25,
  uiZoom:                 1.0,
  compactSidebar:         false,
  gpuAcceleration:        true,
  serverUrl:              "http://localhost:4567",
  serverBinary:           "",
  autoStartServer:        true,
  preferredExtensionLang: "en",
  keybinds:               DEFAULT_KEYBINDS,
  idleTimeoutMin:         5,
  splashCards:            true,
  storageLimitGb:         null,
  markReadOnNext:         true,
  readerDebounceMs:       120,
  theme:                  "dark",
  libraryBranches:        true,
  renderLimit:            48,
  heroSlots:              [null, null, null, null],
  mangaLinks:             {},
  serverAuthUser:         "",
  serverAuthPass:         "",
  serverAuthEnabled:      false,
  socksProxyEnabled:      false,
  socksProxyHost:         "",
  socksProxyPort:         "1080",
  socksProxyVersion:      5,
  socksProxyUsername:     "",
  socksProxyPassword:     "",
  flareSolverrEnabled:    false,
  flareSolverrUrl:        "http://localhost:8191",
  flareSolverrTimeout:    60,
  flareSolverrSessionName: "moku",
  flareSolverrSessionTtl: 15,
  flareSolverrFallback:   false,
  appLockEnabled:         false,
  appLockPin:             "",
  customThemes:           [],
  hiddenCategoryIds:      [],
  defaultLibraryCategoryId: null,
  libraryTabSort:         {},
  libraryTabStatus:       {},
};

// ── Persistence ───────────────────────────────────────────────────────────────

const STORE_VERSION = 3;

// Fields reset to their DEFAULT_SETTINGS value on each version bump.
// Add a key here whenever its default changes meaning between releases.
const RESET_ON_UPGRADE: (keyof Settings)[] = [
  "serverBinary",
  "readerZoom",
  "uiZoom",
];

function loadPersisted(): any {
  try {
    const raw = localStorage.getItem("moku-store");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persist(patch: Record<string, unknown>) {
  try {
    const current = loadPersisted() ?? {};
    localStorage.setItem("moku-store", JSON.stringify({ ...current, ...patch }));
  } catch {}
}

const saved = (() => {
  const data = loadPersisted();
  if (!data) return null;
  if ((data.storeVersion ?? 1) < STORE_VERSION) {
    const resetPatch: Partial<Settings> = {};
    for (const key of RESET_ON_UPGRADE) {
      (resetPatch as any)[key] = (DEFAULT_SETTINGS as any)[key];
    }
    const migrated = {
      ...data,
      storeVersion: STORE_VERSION,
      settings: { ...data.settings, ...resetPatch },
    };
    try {
      localStorage.setItem("moku-store", JSON.stringify(migrated));
    } catch {}
    return migrated;
  }
  return data;
})();

function mergeSettings(saved: any): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...saved?.settings,
    keybinds:     { ...DEFAULT_KEYBINDS, ...saved?.settings?.keybinds },
    heroSlots:    saved?.settings?.heroSlots ?? [null, null, null, null],
    mangaLinks:   saved?.settings?.mangaLinks ?? {},
    customThemes: saved?.settings?.customThemes ?? [],
    hiddenCategoryIds: saved?.settings?.hiddenCategoryIds ?? [],
    libraryTabSort:    saved?.settings?.libraryTabSort    ?? {},
    libraryTabStatus:  saved?.settings?.libraryTabStatus  ?? {},
  };
}

function mergeStats(saved: any): ReadingStats {
  return { ...DEFAULT_READING_STATS, ...saved?.readingStats };
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const genId = () => Math.random().toString(36).slice(2, 10);

// ── Store ─────────────────────────────────────────────────────────────────────

class Store {
  navPage:           NavPage          = $state(saved?.navPage       ?? "home");
  libraryFilter:     LibraryFilter    = $state("library");
  history:           HistoryEntry[]   = $state(saved?.history       ?? []);
  /**
   * readLog — append-only, never deduped. Every chapter completion/progress
   * event lands here. This is the authoritative source for all reading stats.
   * Capped at 5 000 entries; oldest are trimmed first.
   */
  readLog:           ReadLogEntry[]   = $state(saved?.readLog       ?? []);
  readingStats:      ReadingStats     = $state(mergeStats(saved));
  settings:          Settings         = $state(mergeSettings(saved));

  /**
   * Bumped each time the reader closes. Home.svelte watches this to know
   * when to re-fetch library data and refresh the hero section.
   */
  readerSessionId:   number           = $state(0);

  genreFilter:       string           = $state("");
  searchPrefill:     string           = $state("");
  activeManga:       Manga | null     = $state(null);
  previewManga:      Manga | null     = $state(null);
  activeSource:      Source | null    = $state(null);
  pageUrls:          string[]         = $state([]);
  pageNumber:        number           = $state(1);
  libraryTagFilter:  string[]         = $state([]);
  settingsOpen:      boolean          = $state(false);
  activeDownloads:   ActiveDownload[] = $state([]);
  toasts:            Toast[]          = $state([]);
  activeChapter:     Chapter | null   = $state(null);
  activeChapterList: Chapter[]        = $state([]);
  // UI-only: synced from Tauri window events in App.svelte. Not persisted.
  isFullscreen:      boolean          = $state(false);

  // ── Shared category list ──────────────────────────────────────────────────
  // Single source of truth for the category list, shared between Library and
  // Settings. Library owns fetching; Settings reads and mutates in-place.
  // No pub/sub or guard flags needed — both components share this $state ref.
  categories: Category[] = $state([]);

  // ── Discover session cache ────────────────────────────────────────────────
  // Survives navigation within a session but is never persisted to localStorage.
  // Key format: "<sourceId>|<type>|<genre>" or "local|<genre>"
  discoverCache:      Map<string, Manga[]> = $state(new Map());
  discoverLibraryIds: Set<number>          = $state(new Set());
  discoverSrcOffset:  number               = $state(0);

  constructor() {
    $effect.root(() => {
      $effect(() => { persist({ storeVersion:  STORE_VERSION            }); });
      $effect(() => { persist({ navPage:       this.navPage       }); });
      $effect(() => { persist({ libraryFilter: this.libraryFilter }); });
      $effect(() => { persist({ history:       this.history       }); });
      $effect(() => { persist({ readLog:       this.readLog       }); });
      $effect(() => { persist({ readingStats:  this.readingStats  }); });
      $effect(() => { persist({ settings:      this.settings      }); });
    });
  }

  openReader(chapter: Chapter, chapterList: Chapter[]) {
    this.activeChapter     = chapter;
    this.activeChapterList = chapterList;
    this.pageUrls          = [];
    this.pageNumber        = 1;
  }

  closeReader() {
    // Null activeChapter FIRST so the history $effect in Reader can't fire
    // one last time with stale chapter + pageNumber=1, overwriting the real
    // last-read position with page 1.
    this.activeChapter     = null;
    this.activeChapterList = [];
    this.pageUrls          = [];
    this.pageNumber        = 1;
    this.readerSessionId  += 1;   // signals Home to refresh
  }

  /**
   * Record a reading event.
   *
   * @param entry     - The history entry for the "continue reading" UI.
   * @param completed - True when the chapter was fully read (triggers stat
   *                    accrual). False for mid-chapter progress updates.
   * @param minutes   - Actual minutes to credit; defaults to AVG_MIN_PER_CHAPTER.
   */
  addHistory(entry: HistoryEntry, completed = false, minutes = AVG_MIN_PER_CHAPTER) {
    // ── 1. Update the deduped "continue reading" history ──────────────────
    // Always keep the latest position for each chapter at the top.
    if (this.history[0]?.chapterId === entry.chapterId) {
      this.history[0] = { ...this.history[0], pageNumber: entry.pageNumber, readAt: entry.readAt };
    } else {
      this.history = [entry, ...this.history.filter(x => x.chapterId !== entry.chapterId)].slice(0, 300);
    }

    // ── 2. Append to the read log (only on completion) ────────────────────
    // This is append-only — every completed chapter read lands here,
    // including re-reads. We cap at 5 000 to keep storage bounded.
    if (completed) {
      const logEntry: ReadLogEntry = {
        mangaId:   entry.mangaId,
        chapterId: entry.chapterId,
        readAt:    entry.readAt,
        minutes,
      };
      this.readLog = [...this.readLog, logEntry].slice(-5000);
    }

    // ── 3. Recompute stats from the read log ──────────────────────────────
    // Use the log as ground truth so stats are always accurate even after
    // history is cleared or entries are back-filled.
    const log = completed
      ? [...this.readLog] // already updated above
      : this.readLog;

    const uniqueChapters = new Set(log.map(e => e.chapterId));
    const uniqueManga    = new Set(log.map(e => e.mangaId));
    const totalMinutes   = log.reduce((sum, e) => sum + e.minutes, 0);

    const today = todayStr();
    let { currentStreakDays, longestStreakDays, lastStreakDate } = this.readingStats;
    if (lastStreakDate !== today) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
      currentStreakDays = lastStreakDate === yStr ? currentStreakDays + 1 : 1;
      longestStreakDays = Math.max(longestStreakDays, currentStreakDays);
      lastStreakDate    = today;
    }

    this.readingStats = {
      totalChaptersRead: uniqueChapters.size,
      totalMangaRead:    uniqueManga.size,
      totalMinutesRead:  totalMinutes,
      firstReadAt:       this.readingStats.firstReadAt === 0 ? entry.readAt : this.readingStats.firstReadAt,
      lastReadAt:        entry.readAt,
      currentStreakDays,
      longestStreakDays,
      lastStreakDate,
    };
  }

  clearHistory()                        { this.history = []; this.readLog = []; }
  clearHistoryForManga(mangaId: number) {
    this.history = this.history.filter(x => x.mangaId !== mangaId);
    this.readLog  = this.readLog.filter(x => x.mangaId !== mangaId);
    // Recompute stats after removal
    const uniqueChapters = new Set(this.readLog.map(e => e.chapterId));
    const uniqueManga    = new Set(this.readLog.map(e => e.mangaId));
    const totalMinutes   = this.readLog.reduce((sum, e) => sum + e.minutes, 0);
    this.readingStats = {
      ...this.readingStats,
      totalChaptersRead: uniqueChapters.size,
      totalMangaRead:    uniqueManga.size,
      totalMinutesRead:  totalMinutes,
    };
  }

  wipeAllData() {
    this.history      = [];
    this.readLog      = [];
    this.readingStats = { ...DEFAULT_READING_STATS };
    this.settings     = { ...this.settings, heroSlots: [null, null, null, null], mangaLinks: {} };
  }


  linkManga(idA: number, idB: number) {
    if (idA === idB) return;
    const links = { ...this.settings.mangaLinks };
    links[idA]  = [...new Set([...(links[idA] ?? []), idB])];
    links[idB]  = [...new Set([...(links[idB] ?? []), idA])];
    this.settings = { ...this.settings, mangaLinks: links };
  }

  unlinkManga(idA: number, idB: number) {
    const links = { ...this.settings.mangaLinks };
    links[idA]  = (links[idA] ?? []).filter(id => id !== idB);
    links[idB]  = (links[idB] ?? []).filter(id => id !== idA);
    if (!links[idA].length) delete links[idA];
    if (!links[idB].length) delete links[idB];
    this.settings = { ...this.settings, mangaLinks: links };
  }

  getLinkedMangaIds(mangaId: number): number[]  { return this.settings.mangaLinks[mangaId] ?? []; }

  setHeroSlot(index: 1 | 2 | 3, mangaId: number | null) {
    const slots = [...(this.settings.heroSlots ?? [null, null, null, null])];
    slots[index] = mangaId;
    this.settings = { ...this.settings, heroSlots: slots };
  }

  addToast(toast: Omit<Toast, "id">) {
    this.toasts = [...this.toasts, { ...toast, id: Math.random().toString(36).slice(2) }].slice(-5);
  }

  dismissToast(id: string)                      { this.toasts = this.toasts.filter(x => x.id !== id); }
  setCategories(cats: Category[])              { this.categories       = cats; }
  setActiveDownloads(next: ActiveDownload[])     { this.activeDownloads  = next; }
  setNavPage(next: NavPage)                      { this.navPage          = next; }
  setLibraryFilter(next: LibraryFilter)          { this.libraryFilter    = next; }
  setGenreFilter(next: string)                   { this.genreFilter      = next; }
  setSearchPrefill(next: string)                 { this.searchPrefill    = next; }
  setActiveManga(next: Manga | null)             { this.activeManga      = next; }
  setPreviewManga(next: Manga | null)            { this.previewManga     = next; }
  setActiveSource(next: Source | null)           { this.activeSource     = next; }
  setPageUrls(next: string[])                    { this.pageUrls         = next; }
  setPageNumber(next: number)                    { this.pageNumber       = next; }
  setLibraryTagFilter(next: string[])            { this.libraryTagFilter = next; }
  setSettingsOpen(next: boolean)                 { this.settingsOpen     = next; }
  updateSettings(patch: Partial<Settings>)       { this.settings = { ...this.settings, ...patch }; }
  resetKeybinds()                                { this.settings = { ...this.settings, keybinds: DEFAULT_KEYBINDS }; }


  saveCustomTheme(theme: CustomTheme) {
    const existing = this.settings.customThemes.findIndex(t => t.id === theme.id);
    const next = existing >= 0
      ? this.settings.customThemes.map((t, i) => i === existing ? theme : t)
      : [...this.settings.customThemes, theme];
    this.settings = { ...this.settings, customThemes: next };
  }

  deleteCustomTheme(id: string) {
    const next = this.settings.customThemes.filter(t => t.id !== id);
    const wasActive = this.settings.theme === id;
    this.settings = { ...this.settings, customThemes: next, theme: wasActive ? "dark" : this.settings.theme };
  }

  /**
   * Auto-assign or remove the "Completed" category for a manga based on
   * whether all chapters are read. Pass the `gql` executor to avoid a
   * circular import between state.svelte.ts and client.ts.
   *
   * Call after any batch mark-read/unread operation.
   */
  async checkAndMarkCompleted(
    mangaId:    number,
    chaps:      Chapter[],
    categories: Category[],
    gqlFn:      (query: string, vars: Record<string, unknown>) => Promise<unknown>,
    UPDATE_MANGA_CATEGORIES: string,
    UPDATE_MANGA?: string,
  ): Promise<void> {
    if (!chaps.length) return;
    const allRead   = chaps.every(c => c.isRead);
    const completed = categories.find(c => c.name === "Completed");
    if (!completed) return;
    if (allRead) {
      await gqlFn(UPDATE_MANGA_CATEGORIES, { mangaId, addTo: [completed.id], removeFrom: [] }).catch(console.error);
      // Ensure the manga is in the library so it shows up in the Saved tab
      if (UPDATE_MANGA) {
        await gqlFn(UPDATE_MANGA, { id: mangaId, inLibrary: true }).catch(console.error);
      }
    } else {
      await gqlFn(UPDATE_MANGA_CATEGORIES, { mangaId, addTo: [], removeFrom: [completed.id] }).catch(console.error);
    }
  }

  toggleHiddenCategory(id: number) {
    const ids = this.settings.hiddenCategoryIds ?? [];
    const next = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
    this.settings = { ...this.settings, hiddenCategoryIds: next };
  }

  clearDiscoverCache() {
    this.discoverCache      = new Map();
    this.discoverLibraryIds = new Set();
    this.discoverSrcOffset++;
  }
}

export const store = new Store();

// ── Function re-exports — zero call-site changes for actions ──────────────────

export function openReader(chapter: Chapter, chapterList: Chapter[])    { store.openReader(chapter, chapterList); }
export function closeReader()                                            { store.closeReader(); }
export function addHistory(entry: HistoryEntry, completed?: boolean, minutes?: number) { store.addHistory(entry, completed, minutes); }
export function clearHistory()                                           { store.clearHistory(); }
export function clearHistoryForManga(mangaId: number)                    { store.clearHistoryForManga(mangaId); }
export function wipeAllData()                                            { store.wipeAllData(); }
export function linkManga(idA: number, idB: number)                      { store.linkManga(idA, idB); }
export function unlinkManga(idA: number, idB: number)                    { store.unlinkManga(idA, idB); }
export function getLinkedMangaIds(mangaId: number)                       { return store.getLinkedMangaIds(mangaId); }
export function setHeroSlot(i: 1|2|3, mangaId: number | null)            { store.setHeroSlot(i, mangaId); }
export function addToast(toast: Omit<Toast, "id">)                       { store.addToast(toast); }
export function dismissToast(id: string)                                 { store.dismissToast(id); }
export function setCategories(cats: Category[])                           { store.setCategories(cats); }
export function setActiveDownloads(next: ActiveDownload[])               { store.setActiveDownloads(next); }
export function setNavPage(next: NavPage)                                { store.setNavPage(next); }
export function setLibraryFilter(next: LibraryFilter)                    { store.setLibraryFilter(next); }
export function setGenreFilter(next: string)                             { store.setGenreFilter(next); }
export function setSearchPrefill(next: string)                           { store.setSearchPrefill(next); }
export function setActiveManga(next: Manga | null)                       { store.setActiveManga(next); }
export function setPreviewManga(next: Manga | null)                      { store.setPreviewManga(next); }
export function setActiveSource(next: Source | null)                     { store.setActiveSource(next); }
export function setPageUrls(next: string[])                              { store.setPageUrls(next); }
export function setPageNumber(next: number)                              { store.setPageNumber(next); }
export function setLibraryTagFilter(next: string[])                      { store.setLibraryTagFilter(next); }
export function setSettingsOpen(next: boolean)                           { store.setSettingsOpen(next); }
export function updateSettings(patch: Partial<Settings>)                 { store.updateSettings(patch); }
export function resetKeybinds()                                          { store.resetKeybinds(); }
export function clearDiscoverCache()                                       { store.clearDiscoverCache(); }
export function toggleHiddenCategory(id: number)                           { store.toggleHiddenCategory(id); }
export function saveCustomTheme(theme: CustomTheme)                        { store.saveCustomTheme(theme); }
export function deleteCustomTheme(id: string)                              { store.deleteCustomTheme(id); }
export async function checkAndMarkCompleted(
  mangaId:    number,
  chaps:      Chapter[],
  categories: Category[],
  gqlFn:      (query: string, vars: Record<string, unknown>) => Promise<unknown>,
  UPDATE_MANGA_CATEGORIES: string,
  UPDATE_MANGA?: string,
): Promise<void> {
  return store.checkAndMarkCompleted(mangaId, chaps, categories, gqlFn, UPDATE_MANGA_CATEGORIES, UPDATE_MANGA);
}
