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
  mangaId:     number;
  mangaTitle:  string;
  thumbnailUrl: string;
  chapterId:   number;
  chapterName: string;
  pageNumber:  number;
  readAt:      number;
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
  id:       string;
  kind:     "success" | "error" | "info" | "download";
  title:    string;
  body?:    string;
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
  serverBinary:           "tachidesk-server",
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

const saved = loadPersisted();

function mergeSettings(saved: any): Settings {
  const userFolders: Folder[]    = saved?.settings?.folders ?? [];
  const existingCompleted        = userFolders.find(f => f.id === COMPLETED_FOLDER_ID);
  const completedFolder: Folder  = existingCompleted
    ? { ...COMPLETED_FOLDER_DEFAULT, mangaIds: existingCompleted.mangaIds }
    : COMPLETED_FOLDER_DEFAULT;
  const otherFolders = userFolders.filter(f => f.id !== COMPLETED_FOLDER_ID);
  return {
    ...DEFAULT_SETTINGS,
    ...saved?.settings,
    folders:   [completedFolder, ...otherFolders],
    keybinds:  { ...DEFAULT_KEYBINDS, ...saved?.settings?.keybinds },
    heroSlots: saved?.settings?.heroSlots ?? [null, null, null, null],
    mangaLinks: saved?.settings?.mangaLinks ?? {},
  };
}

function mergeStats(saved: any): ReadingStats {
  return { ...DEFAULT_READING_STATS, ...saved?.readingStats };
}

// ── State ─────────────────────────────────────────────────────────────────────

export let navPage:           NavPage          = $state(saved?.navPage       ?? "home");
export let libraryFilter:     LibraryFilter    = $state(saved?.libraryFilter ?? "library");
export let history:           HistoryEntry[]   = $state(saved?.history       ?? []);
export let readingStats:      ReadingStats     = $state(mergeStats(saved));
export let settings:          Settings         = $state(mergeSettings(saved));

export let genreFilter:       string           = $state("");
export let searchPrefill:     string           = $state("");
export let activeManga:       Manga | null     = $state(null);
export let previewManga:      Manga | null     = $state(null);
export let activeSource:      Source | null    = $state(null);
export let pageUrls:          string[]         = $state([]);
export let pageNumber:        number           = $state(1);
export let libraryTagFilter:  string[]         = $state([]);
export let settingsOpen:      boolean          = $state(false);
export let activeDownloads:   ActiveDownload[] = $state([]);
export let toasts:            Toast[]          = $state([]);
export let activeChapter:     Chapter | null   = $state(null);
export let activeChapterList: Chapter[]        = $state([]);

// ── Persistence effects ───────────────────────────────────────────────────────

$effect.root(() => {
  $effect(() => { persist({ navPage }); });
  $effect(() => { persist({ libraryFilter }); });
  $effect(() => { persist({ history }); });
  $effect(() => { persist({ readingStats }); });
  $effect(() => { persist({ settings }); });
});

// ── Reader ────────────────────────────────────────────────────────────────────

export function openReader(chapter: Chapter, chapterList: Chapter[]) {
  activeChapter     = chapter;
  activeChapterList = chapterList;
  pageUrls          = [];
  pageNumber        = 1;
}

export function closeReader() {
  activeChapter     = null;
  activeChapterList = [];
  pageUrls          = [];
  pageNumber        = 1;
}

// ── History ───────────────────────────────────────────────────────────────────

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addHistory(entry: HistoryEntry) {
  const isNewChapter = !history.some(x => x.chapterId === entry.chapterId);

  if (history[0]?.chapterId === entry.chapterId) {
    history[0] = { ...history[0], pageNumber: entry.pageNumber, readAt: entry.readAt };
  } else {
    history = [entry, ...history.filter(x => x.chapterId !== entry.chapterId)].slice(0, 300);
  }

  const uniqueChapters = new Set(history.map(e => e.chapterId));
  const uniqueManga    = new Set(history.map(e => e.mangaId));

  const today = todayStr();
  let { currentStreakDays, longestStreakDays, lastStreakDate } = readingStats;
  if (lastStreakDate !== today) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
    currentStreakDays = lastStreakDate === yStr ? currentStreakDays + 1 : 1;
    longestStreakDays = Math.max(longestStreakDays, currentStreakDays);
    lastStreakDate    = today;
  }

  readingStats = {
    totalChaptersRead: Math.max(readingStats.totalChaptersRead, uniqueChapters.size),
    totalMangaRead:    Math.max(readingStats.totalMangaRead,    uniqueManga.size),
    totalMinutesRead:  readingStats.totalMinutesRead + (isNewChapter ? AVG_MIN_PER_CHAPTER : 0),
    firstReadAt:       readingStats.firstReadAt === 0 ? entry.readAt : readingStats.firstReadAt,
    lastReadAt:        entry.readAt,
    currentStreakDays,
    longestStreakDays,
    lastStreakDate,
  };
}

export function clearHistory() {
  history = [];
}

export function clearHistoryForManga(mangaId: number) {
  history = history.filter(x => x.mangaId !== mangaId);
}

export function wipeAllData() {
  history      = [];
  readingStats = { ...DEFAULT_READING_STATS };
  settings     = { ...settings, folders: [COMPLETED_FOLDER_DEFAULT], heroSlots: [null, null, null, null], mangaLinks: {} };
}

// ── Completed manga ───────────────────────────────────────────────────────────

export function markMangaCompleted(mangaId: number) {
  let folders = settings.folders.map(f => {
    if (f.id !== COMPLETED_FOLDER_ID) return f;
    if (f.mangaIds.includes(mangaId)) return f;
    return { ...f, mangaIds: [...f.mangaIds, mangaId] };
  });
  if (!settings.folders.find(f => f.id === COMPLETED_FOLDER_ID)) {
    folders = [{ ...COMPLETED_FOLDER_DEFAULT, mangaIds: [mangaId] }, ...folders];
  }
  settings = { ...settings, folders };
}

export function unmarkMangaCompleted(mangaId: number) {
  settings = {
    ...settings,
    folders: settings.folders.map(f =>
      f.id === COMPLETED_FOLDER_ID
        ? { ...f, mangaIds: f.mangaIds.filter(id => id !== mangaId) }
        : f
    ),
  };
}

export function isCompleted(mangaId: number): boolean {
  return settings.folders.find(f => f.id === COMPLETED_FOLDER_ID)?.mangaIds.includes(mangaId) ?? false;
}

export function checkAndMarkCompleted(mangaId: number, chapters: Chapter[]) {
  if (!chapters.length) return;
  if (chapters.every(c => c.isRead)) markMangaCompleted(mangaId);
  else unmarkMangaCompleted(mangaId);
}

// ── Manga links ───────────────────────────────────────────────────────────────

export function linkManga(idA: number, idB: number) {
  if (idA === idB) return;
  const links  = { ...settings.mangaLinks };
  links[idA]   = [...new Set([...(links[idA] ?? []), idB])];
  links[idB]   = [...new Set([...(links[idB] ?? []), idA])];
  settings = { ...settings, mangaLinks: links };
}

export function unlinkManga(idA: number, idB: number) {
  const links = { ...settings.mangaLinks };
  links[idA]  = (links[idA] ?? []).filter(id => id !== idB);
  links[idB]  = (links[idB] ?? []).filter(id => id !== idA);
  if (!links[idA].length) delete links[idA];
  if (!links[idB].length) delete links[idB];
  settings = { ...settings, mangaLinks: links };
}

export function getLinkedMangaIds(mangaId: number): number[] {
  return settings.mangaLinks[mangaId] ?? [];
}

// ── Hero slots ────────────────────────────────────────────────────────────────

export function setHeroSlot(index: 1 | 2 | 3, mangaId: number | null) {
  const slots = [...(settings.heroSlots ?? [null, null, null, null])];
  slots[index] = mangaId;
  settings = { ...settings, heroSlots: slots };
}

// ── Toasts ────────────────────────────────────────────────────────────────────

export function addToast(toast: Omit<Toast, "id">) {
  toasts = [...toasts, { ...toast, id: Math.random().toString(36).slice(2) }].slice(-5);
}

export function dismissToast(id: string) {
  toasts = toasts.filter(x => x.id !== id);
}

// ── Settings ──────────────────────────────────────────────────────────────────

export function updateSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
}

export function resetKeybinds() {
  settings = { ...settings, keybinds: DEFAULT_KEYBINDS };
}

// ── Folders ───────────────────────────────────────────────────────────────────

const genId = () => Math.random().toString(36).slice(2, 10);

export function addFolder(name: string): string {
  const id = genId();
  settings = { ...settings, folders: [...settings.folders, { id, name: name.trim(), mangaIds: [], showTab: false }] };
  return id;
}

export function removeFolder(id: string) {
  settings = { ...settings, folders: settings.folders.filter(f => f.id !== id || f.system) };
}

export function renameFolder(id: string, name: string) {
  settings = {
    ...settings,
    folders: settings.folders.map(f => f.id === id && !f.system ? { ...f, name: name.trim() } : f),
  };
}

export function toggleFolderTab(id: string) {
  settings = {
    ...settings,
    folders: settings.folders.map(f => f.id === id ? { ...f, showTab: !f.showTab } : f),
  };
}

export function assignMangaToFolder(folderId: string, mangaId: number) {
  settings = {
    ...settings,
    folders: settings.folders.map(f =>
      f.id === folderId && !f.mangaIds.includes(mangaId)
        ? { ...f, mangaIds: [...f.mangaIds, mangaId] }
        : f
    ),
  };
}

export function removeMangaFromFolder(folderId: string, mangaId: number) {
  settings = {
    ...settings,
    folders: settings.folders.map(f =>
      f.id === folderId ? { ...f, mangaIds: f.mangaIds.filter(id => id !== mangaId) } : f
    ),
  };
}

export function getMangaFolders(mangaId: number): Folder[] {
  return settings.folders.filter(f => f.mangaIds.includes(mangaId));
}
