import type { Manga, Chapter, Source } from "../lib/types";
import { DEFAULT_KEYBINDS, type Keybinds } from "../lib/keybinds";

export type PageStyle        = "single" | "double" | "longstrip";
export type FitMode          = "width" | "height" | "screen" | "original";
export type LibraryFilter    = "all" | "library" | "downloaded" | string;
export type NavPage          = "home" | "library" | "sources" | "explore" | "downloads" | "extensions" | "history" | "search";
export type ReadingDirection = "ltr" | "rtl";
export type ChapterSortDir   = "desc" | "asc";
export type Theme            = "dark" | "high-contrast" | "light" | "light-contrast" | "midnight" | "warm";

export const COMPLETED_FOLDER_ID = "completed";

export interface HistoryEntry {
  mangaId:      number;
  mangaTitle:   string;
  thumbnailUrl: string;
  chapterId:    number;
  chapterName:  string;
  pageNumber:   number;
  readAt:       number;
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

const AVG_MIN_PER_CHAPTER = 5;

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

export interface Folder {
  id:       string;
  name:     string;
  mangaIds: number[];
  showTab:  boolean;
  system?:  boolean;
}

export interface Settings {
  pageStyle:               PageStyle;
  readingDirection:        ReadingDirection;
  fitMode:                 FitMode;
  maxPageWidth:            number;
  pageGap:                 boolean;
  optimizeContrast:        boolean;
  offsetDoubleSpreads:     boolean;
  preloadPages:            number;
  autoMarkRead:            boolean;
  autoNextChapter:         boolean;
  libraryCropCovers:       boolean;
  libraryPageSize:         number;
  showNsfw:                boolean;
  chapterSortDir:          ChapterSortDir;
  chapterPageSize:         number;
  uiScale:                 number;
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
  folders:                 Folder[];
  markReadOnNext:          boolean;
  readerDebounceMs:        number;
  theme:                   Theme;
  libraryBranches:         boolean;
  renderLimit:             number;
  heroSlots:               (number | null)[];
  mangaLinks:              Record<number, number[]>;
}

const COMPLETED_FOLDER_DEFAULT: Folder = {
  id:       COMPLETED_FOLDER_ID,
  name:     "Completed",
  mangaIds: [],
  showTab:  true,
  system:   true,
};

export const DEFAULT_SETTINGS: Settings = {
  pageStyle:              "longstrip",
  readingDirection:       "ltr",
  fitMode:                "width",
  maxPageWidth:           900,
  pageGap:                true,
  optimizeContrast:       false,
  offsetDoubleSpreads:    false,
  preloadPages:           3,
  autoMarkRead:           true,
  autoNextChapter:        true,
  libraryCropCovers:      true,
  libraryPageSize:        48,
  showNsfw:               false,
  chapterSortDir:         "desc",
  chapterPageSize:        25,
  uiScale:                100,
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
  folders:                [COMPLETED_FOLDER_DEFAULT],
  markReadOnNext:         true,
  readerDebounceMs:       120,
  theme:                  "dark",
  libraryBranches:        true,
  renderLimit:            48,
  heroSlots:              [null, null, null, null],
  mangaLinks:             {},
};

// ── Persistence ───────────────────────────────────────────────────────────────

const STORE_VERSION = 2;

// Fields reset to their DEFAULT_SETTINGS value on each version bump.
// Add a key here whenever its default changes meaning between releases.
const RESET_ON_UPGRADE: (keyof Settings)[] = [
  "serverBinary",
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
  const userFolders: Folder[]   = saved?.settings?.folders ?? [];
  const existingCompleted       = userFolders.find(f => f.id === COMPLETED_FOLDER_ID);
  const completedFolder: Folder = existingCompleted
    ? { ...COMPLETED_FOLDER_DEFAULT, mangaIds: existingCompleted.mangaIds }
    : COMPLETED_FOLDER_DEFAULT;
  const otherFolders = userFolders.filter(f => f.id !== COMPLETED_FOLDER_ID);
  return {
    ...DEFAULT_SETTINGS,
    ...saved?.settings,
    folders:    [completedFolder, ...otherFolders],
    keybinds:   { ...DEFAULT_KEYBINDS, ...saved?.settings?.keybinds },
    heroSlots:  saved?.settings?.heroSlots ?? [null, null, null, null],
    mangaLinks: saved?.settings?.mangaLinks ?? {},
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
  libraryFilter:     LibraryFilter    = $state(saved?.libraryFilter ?? "library");
  history:           HistoryEntry[]   = $state(saved?.history       ?? []);
  readingStats:      ReadingStats     = $state(mergeStats(saved));
  settings:          Settings         = $state(mergeSettings(saved));

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

  constructor() {
    $effect.root(() => {
      $effect(() => { persist({ storeVersion:  STORE_VERSION            }); });
      $effect(() => { persist({ navPage:       this.navPage       }); });
      $effect(() => { persist({ libraryFilter: this.libraryFilter }); });
      $effect(() => { persist({ history:       this.history       }); });
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
    this.activeChapter     = null;
    this.activeChapterList = [];
    this.pageUrls          = [];
    this.pageNumber        = 1;
  }

  addHistory(entry: HistoryEntry) {
    const isNewChapter = !this.history.some(x => x.chapterId === entry.chapterId);

    if (this.history[0]?.chapterId === entry.chapterId) {
      this.history[0] = { ...this.history[0], pageNumber: entry.pageNumber, readAt: entry.readAt };
    } else {
      this.history = [entry, ...this.history.filter(x => x.chapterId !== entry.chapterId)].slice(0, 300);
    }

    const uniqueChapters = new Set(this.history.map(e => e.chapterId));
    const uniqueManga    = new Set(this.history.map(e => e.mangaId));

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
      totalChaptersRead: Math.max(this.readingStats.totalChaptersRead, uniqueChapters.size),
      totalMangaRead:    Math.max(this.readingStats.totalMangaRead,    uniqueManga.size),
      totalMinutesRead:  this.readingStats.totalMinutesRead + (isNewChapter ? AVG_MIN_PER_CHAPTER : 0),
      firstReadAt:       this.readingStats.firstReadAt === 0 ? entry.readAt : this.readingStats.firstReadAt,
      lastReadAt:        entry.readAt,
      currentStreakDays,
      longestStreakDays,
      lastStreakDate,
    };
  }

  clearHistory()                        { this.history = []; }
  clearHistoryForManga(mangaId: number) { this.history = this.history.filter(x => x.mangaId !== mangaId); }

  wipeAllData() {
    this.history      = [];
    this.readingStats = { ...DEFAULT_READING_STATS };
    this.settings     = { ...this.settings, folders: [COMPLETED_FOLDER_DEFAULT], heroSlots: [null, null, null, null], mangaLinks: {} };
  }

  markMangaCompleted(mangaId: number) {
    const folder = this.settings.folders.find(f => f.id === COMPLETED_FOLDER_ID);
    if (!folder) return;
    if (!folder.mangaIds.includes(mangaId))
      folder.mangaIds = [...folder.mangaIds, mangaId];
  }

  unmarkMangaCompleted(mangaId: number) {
    const folder = this.settings.folders.find(f => f.id === COMPLETED_FOLDER_ID);
    if (!folder) return;
    folder.mangaIds = folder.mangaIds.filter(id => id !== mangaId);
  }

  isCompleted(mangaId: number): boolean {
    return this.settings.folders.find(f => f.id === COMPLETED_FOLDER_ID)?.mangaIds.includes(mangaId) ?? false;
  }

  checkAndMarkCompleted(mangaId: number, chapters: Chapter[]) {
    if (!chapters.length) return;
    if (chapters.every(c => c.isRead)) this.markMangaCompleted(mangaId);
    else this.unmarkMangaCompleted(mangaId);
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

  addFolder(name: string): string {
    const id = genId();
    this.settings = { ...this.settings, folders: [...this.settings.folders, { id, name: name.trim(), mangaIds: [], showTab: false }] };
    return id;
  }

  removeFolder(id: string) {
    this.settings = { ...this.settings, folders: this.settings.folders.filter(f => f.id !== id || f.system) };
  }

  renameFolder(id: string, name: string) {
    this.settings = {
      ...this.settings,
      folders: this.settings.folders.map(f => f.id === id && !f.system ? { ...f, name: name.trim() } : f),
    };
  }

  toggleFolderTab(id: string) {
    this.settings = {
      ...this.settings,
      folders: this.settings.folders.map(f => f.id === id ? { ...f, showTab: !f.showTab } : f),
    };
  }

  assignMangaToFolder(folderId: string, mangaId: number) {
    this.settings = {
      ...this.settings,
      folders: this.settings.folders.map(f =>
        f.id === folderId && !f.mangaIds.includes(mangaId)
          ? { ...f, mangaIds: [...f.mangaIds, mangaId] }
          : f
      ),
    };
  }

  removeMangaFromFolder(folderId: string, mangaId: number) {
    this.settings = {
      ...this.settings,
      folders: this.settings.folders.map(f =>
        f.id === folderId ? { ...f, mangaIds: f.mangaIds.filter(id => id !== mangaId) } : f
      ),
    };
  }

  getMangaFolders(mangaId: number): Folder[] {
    return this.settings.folders.filter(f => f.mangaIds.includes(mangaId));
  }
}

export const store = new Store();

// ── Function re-exports — zero call-site changes for actions ──────────────────

export function openReader(chapter: Chapter, chapterList: Chapter[])    { store.openReader(chapter, chapterList); }
export function closeReader()                                            { store.closeReader(); }
export function addHistory(entry: HistoryEntry)                          { store.addHistory(entry); }
export function clearHistory()                                           { store.clearHistory(); }
export function clearHistoryForManga(mangaId: number)                    { store.clearHistoryForManga(mangaId); }
export function wipeAllData()                                            { store.wipeAllData(); }
export function markMangaCompleted(mangaId: number)                      { store.markMangaCompleted(mangaId); }
export function unmarkMangaCompleted(mangaId: number)                    { store.unmarkMangaCompleted(mangaId); }
export function isCompleted(mangaId: number)                             { return store.isCompleted(mangaId); }
export function checkAndMarkCompleted(mangaId: number, c: Chapter[])     { store.checkAndMarkCompleted(mangaId, c); }
export function linkManga(idA: number, idB: number)                      { store.linkManga(idA, idB); }
export function unlinkManga(idA: number, idB: number)                    { store.unlinkManga(idA, idB); }
export function getLinkedMangaIds(mangaId: number)                       { return store.getLinkedMangaIds(mangaId); }
export function setHeroSlot(i: 1|2|3, mangaId: number | null)            { store.setHeroSlot(i, mangaId); }
export function addToast(toast: Omit<Toast, "id">)                       { store.addToast(toast); }
export function dismissToast(id: string)                                 { store.dismissToast(id); }
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
export function addFolder(name: string)                                  { return store.addFolder(name); }
export function removeFolder(id: string)                                 { store.removeFolder(id); }
export function renameFolder(id: string, name: string)                   { store.renameFolder(id, name); }
export function toggleFolderTab(id: string)                              { store.toggleFolderTab(id); }
export function assignMangaToFolder(folderId: string, mangaId: number)   { store.assignMangaToFolder(folderId, mangaId); }
export function removeMangaFromFolder(folderId: string, mangaId: number) { store.removeMangaFromFolder(folderId, mangaId); }
export function getMangaFolders(mangaId: number)                         { return store.getMangaFolders(mangaId); }
