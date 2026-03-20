import { writable, get } from "svelte/store";
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
  mangaId: number; mangaTitle: string; thumbnailUrl: string;
  chapterId: number; chapterName: string; pageNumber: number; readAt: number;
}

export interface ReadingStats {
  totalChaptersRead:  number;
  totalMangaRead:     number;
  totalMinutesRead:   number;
  firstReadAt:        number;
  lastReadAt:         number;
  currentStreakDays:  number;
  longestStreakDays:  number;
  lastStreakDate:     string;
}

const AVG_MIN_PER_CHAPTER = 5;

export const DEFAULT_READING_STATS: ReadingStats = {
  totalChaptersRead: 0, totalMangaRead: 0, totalMinutesRead: 0,
  firstReadAt: 0, lastReadAt: 0,
  currentStreakDays: 0, longestStreakDays: 0, lastStreakDate: "",
};

export interface Toast {
  id: string; kind: "success" | "error" | "info" | "download";
  title: string; body?: string; duration?: number;
}

export interface ActiveDownload { chapterId: number; mangaId: number; progress: number }

export interface Folder {
  id: string; name: string; mangaIds: number[]; showTab: boolean;
  system?: boolean;
}

export interface Settings {
  pageStyle: PageStyle; readingDirection: ReadingDirection; fitMode: FitMode;
  maxPageWidth: number; pageGap: boolean; optimizeContrast: boolean;
  offsetDoubleSpreads: boolean; preloadPages: number; autoMarkRead: boolean;
  autoNextChapter: boolean; libraryCropCovers: boolean; libraryPageSize: number;
  showNsfw: boolean; chapterSortDir: ChapterSortDir; chapterPageSize: number;
  uiScale: number; compactSidebar: boolean; gpuAcceleration: boolean;
  serverUrl: string; serverBinary: string; autoStartServer: boolean;
  preferredExtensionLang: string; keybinds: Keybinds; idleTimeoutMin?: number;
  splashCards?: boolean; storageLimitGb: number | null; folders: Folder[];
  markReadOnNext: boolean; readerDebounceMs: number; theme: Theme;
  libraryBranches: boolean;
  renderLimit: number;
  /**
   * Hero slot pinning for the Home page.
   * 4 slots total. Index 0 = always auto (continue reading, not pinnable).
   * Indices 1-3: null = auto (fill from recent history), number = pinned mangaId.
   */
  heroSlots: (number | null)[];
}

const COMPLETED_FOLDER_DEFAULT: Folder = {
  id: COMPLETED_FOLDER_ID, name: "Completed", mangaIds: [], showTab: true, system: true,
};

export const DEFAULT_SETTINGS: Settings = {
  pageStyle: "longstrip", readingDirection: "ltr", fitMode: "width",
  maxPageWidth: 900, pageGap: true, optimizeContrast: false,
  offsetDoubleSpreads: false, preloadPages: 3, autoMarkRead: true,
  autoNextChapter: true, libraryCropCovers: true, libraryPageSize: 48,
  showNsfw: false, chapterSortDir: "desc", chapterPageSize: 25,
  uiScale: 100, compactSidebar: false, gpuAcceleration: true,
  serverUrl: "http://localhost:4567", serverBinary: "tachidesk-server",
  autoStartServer: true, preferredExtensionLang: "en", keybinds: DEFAULT_KEYBINDS,
  idleTimeoutMin: 5, splashCards: true, storageLimitGb: null,
  folders: [COMPLETED_FOLDER_DEFAULT],
  markReadOnNext: true, readerDebounceMs: 120, theme: "dark",
  libraryBranches: true, renderLimit: 48,
  heroSlots: [null, null, null, null],
};

// ── Persistence ───────────────────────────────────────────────────────────────

function loadPersisted() {
  try { const raw = localStorage.getItem("moku-store"); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}

function persist(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

const saved = loadPersisted();

function mergeSettings(saved: any): Settings {
  const userFolders: Folder[] = saved?.settings?.folders ?? [];
  const existingCompleted = userFolders.find(f => f.id === COMPLETED_FOLDER_ID);
  const completedFolder: Folder = existingCompleted
    ? { ...COMPLETED_FOLDER_DEFAULT, mangaIds: existingCompleted.mangaIds }
    : COMPLETED_FOLDER_DEFAULT;
  const otherFolders = userFolders.filter(f => f.id !== COMPLETED_FOLDER_ID);
  return {
    ...DEFAULT_SETTINGS,
    ...saved?.settings,
    folders: [completedFolder, ...otherFolders],
    keybinds: { ...DEFAULT_KEYBINDS, ...saved?.settings?.keybinds },
    heroSlots: saved?.settings?.heroSlots ?? [null, null, null, null],
  };
}

function mergeStats(saved: any): ReadingStats {
  return { ...DEFAULT_READING_STATS, ...saved?.readingStats };
}

// ── Stores ────────────────────────────────────────────────────────────────────

export const navPage          = writable<NavPage>(saved?.navPage ?? "home");
export const libraryFilter    = writable<LibraryFilter>(saved?.libraryFilter ?? "library");
export const history          = writable<HistoryEntry[]>(saved?.history ?? []);
export const readingStats     = writable<ReadingStats>(mergeStats(saved));
export const settings         = writable<Settings>(mergeSettings(saved));

export const genreFilter      = writable<string>("");
export const searchPrefill    = writable<string>("");
export const activeManga      = writable<Manga | null>(null);
export const previewManga     = writable<Manga | null>(null);
export const activeSource     = writable<Source | null>(null);
export const pageUrls         = writable<string[]>([]);
export const pageNumber       = writable<number>(1);
export const libraryTagFilter = writable<string[]>([]);
export const settingsOpen     = writable<boolean>(false);
export const activeDownloads  = writable<ActiveDownload[]>([]);
export const toasts           = writable<Toast[]>([]);
export const activeChapter    = writable<Chapter | null>(null);
export const activeChapterList = writable<Chapter[]>([]);

// ── Reader ────────────────────────────────────────────────────────────────────

export function openReader(chapter: Chapter, chapterList: Chapter[]) {
  activeChapter.set(chapter); activeChapterList.set(chapterList);
  pageUrls.set([]); pageNumber.set(1);
}

export function closeReader() {
  activeChapter.set(null); activeChapterList.set([]);
  pageUrls.set([]); pageNumber.set(1);
}

// ── History ───────────────────────────────────────────────────────────────────

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addHistory(entry: HistoryEntry) {
  history.update((h) => {
    if (h[0]?.chapterId === entry.chapterId) {
      const updated = [...h];
      updated[0] = { ...updated[0], pageNumber: entry.pageNumber, readAt: entry.readAt };
      return updated;
    }
    return [entry, ...h.filter((x) => x.chapterId !== entry.chapterId)].slice(0, 300);
  });

  readingStats.update((s) => {
    const currentH = get(history);
    const uniqueChapters = new Set(currentH.map(e => e.chapterId));
    const uniqueManga    = new Set(currentH.map(e => e.mangaId));
    const isNewChapter   = !uniqueChapters.has(entry.chapterId) || currentH[0]?.chapterId !== entry.chapterId;

    const today = todayStr();
    let { currentStreakDays, longestStreakDays, lastStreakDate } = s;
    if (lastStreakDate !== today) {
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
      currentStreakDays = lastStreakDate === yStr ? currentStreakDays + 1 : 1;
      longestStreakDays = Math.max(longestStreakDays, currentStreakDays);
      lastStreakDate    = today;
    }

    return {
      totalChaptersRead: Math.max(s.totalChaptersRead, uniqueChapters.size),
      totalMangaRead:    Math.max(s.totalMangaRead,    uniqueManga.size),
      totalMinutesRead:  s.totalMinutesRead + (isNewChapter ? AVG_MIN_PER_CHAPTER : 0),
      firstReadAt:       s.firstReadAt === 0 ? entry.readAt : s.firstReadAt,
      lastReadAt:        entry.readAt,
      currentStreakDays, longestStreakDays, lastStreakDate,
    };
  });
}

export function clearHistory() { history.set([]); }

// ── Completed manga ───────────────────────────────────────────────────────────

export function markMangaCompleted(mangaId: number) {
  settings.update((s) => {
    let folders = [...s.folders];
    const idx = folders.findIndex(f => f.id === COMPLETED_FOLDER_ID);
    if (idx >= 0) {
      if (folders[idx].mangaIds.includes(mangaId)) return s;
      folders[idx] = { ...folders[idx], mangaIds: [...folders[idx].mangaIds, mangaId] };
    } else {
      folders = [{ ...COMPLETED_FOLDER_DEFAULT, mangaIds: [mangaId] }, ...folders];
    }
    return { ...s, folders };
  });
}

export function unmarkMangaCompleted(mangaId: number) {
  settings.update((s) => ({
    ...s,
    folders: s.folders.map(f =>
      f.id === COMPLETED_FOLDER_ID
        ? { ...f, mangaIds: f.mangaIds.filter(id => id !== mangaId) }
        : f
    ),
  }));
}

export function isCompleted(mangaId: number): boolean {
  return get(settings).folders
    .find(f => f.id === COMPLETED_FOLDER_ID)
    ?.mangaIds.includes(mangaId) ?? false;
}

/**
 * Called from SeriesDetail after marking chapters read.
 * If ALL chapters are read, auto-adds to the Completed folder.
 * If NOT all chapters are read, removes from Completed (handles un-read).
 * Pure function — no UI side effects.
 */
export function checkAndMarkCompleted(mangaId: number, chapters: Chapter[]) {
  if (chapters.length === 0) return;
  const allRead = chapters.every(c => c.isRead);
  if (allRead) markMangaCompleted(mangaId);
  else unmarkMangaCompleted(mangaId);
}

// ── Hero slots ────────────────────────────────────────────────────────────────

/**
 * Pin a manga to a hero slot (indices 1-3). Index 0 is always auto.
 * Pass null to unpin and revert to auto (recent history).
 */
export function setHeroSlot(index: 1 | 2 | 3, mangaId: number | null) {
  settings.update(s => {
    const slots = [...(s.heroSlots ?? [null, null, null, null])];
    slots[index] = mangaId;
    return { ...s, heroSlots: slots };
  });
}

// ── Toasts ────────────────────────────────────────────────────────────────────

export function addToast(toast: Omit<Toast, "id">) {
  toasts.update((t) => [...t, { ...toast, id: Math.random().toString(36).slice(2) }].slice(-5));
}
export function dismissToast(id: string) {
  toasts.update((t) => t.filter((x) => x.id !== id));
}

// ── Settings ──────────────────────────────────────────────────────────────────

export function updateSettings(patch: Partial<Settings>) {
  settings.update((s) => ({ ...s, ...patch }));
}
export function resetKeybinds() {
  settings.update((s) => ({ ...s, keybinds: DEFAULT_KEYBINDS }));
}

// ── Folders ───────────────────────────────────────────────────────────────────

const genId = () => Math.random().toString(36).slice(2, 10);

export function addFolder(name: string): string {
  const id = genId();
  settings.update((s) => ({ ...s, folders: [...s.folders, { id, name: name.trim(), mangaIds: [], showTab: false }] }));
  return id;
}
export function removeFolder(id: string) {
  settings.update((s) => ({ ...s, folders: s.folders.filter(f => f.id !== id || f.system) }));
}
export function renameFolder(id: string, name: string) {
  settings.update((s) => ({ ...s, folders: s.folders.map(f => f.id === id && !f.system ? { ...f, name: name.trim() } : f) }));
}
export function toggleFolderTab(id: string) {
  settings.update((s) => ({ ...s, folders: s.folders.map(f => f.id === id ? { ...f, showTab: !f.showTab } : f) }));
}
export function assignMangaToFolder(folderId: string, mangaId: number) {
  settings.update((s) => ({
    ...s, folders: s.folders.map(f =>
      f.id === folderId && !f.mangaIds.includes(mangaId) ? { ...f, mangaIds: [...f.mangaIds, mangaId] } : f
    ),
  }));
}
export function removeMangaFromFolder(folderId: string, mangaId: number) {
  settings.update((s) => ({
    ...s, folders: s.folders.map(f =>
      f.id === folderId ? { ...f, mangaIds: f.mangaIds.filter(id => id !== mangaId) } : f
    ),
  }));
}
export function getMangaFolders(mangaId: number): Folder[] {
  return get(settings).folders.filter(f => f.mangaIds.includes(mangaId));
}

// ── Persistence subscriptions ─────────────────────────────────────────────────

navPage.subscribe(v     => persist("moku-store", { ...loadPersisted(), navPage: v }));
libraryFilter.subscribe(v => persist("moku-store", { ...loadPersisted(), libraryFilter: v }));
history.subscribe(v     => persist("moku-store", { ...loadPersisted(), history: v }));
readingStats.subscribe(v => persist("moku-store", { ...loadPersisted(), readingStats: v }));
settings.subscribe(v    => persist("moku-store", { ...loadPersisted(), settings: v }));
