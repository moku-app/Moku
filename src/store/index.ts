import { writable, get } from "svelte/store";
import type { Manga, Chapter, Source } from "../lib/types";
import { DEFAULT_KEYBINDS, type Keybinds } from "../lib/keybinds";

export type PageStyle        = "single" | "double" | "longstrip";
export type FitMode          = "width" | "height" | "screen" | "original";
export type LibraryFilter    = "all" | "library" | "downloaded" | string;
export type NavPage          = "library" | "sources" | "explore" | "downloads" | "extensions" | "history" | "search";
export type ReadingDirection = "ltr" | "rtl";
export type ChapterSortDir   = "desc" | "asc";
export type Theme            = "dark" | "high-contrast" | "light" | "light-contrast" | "midnight" | "warm";

export interface HistoryEntry {
  mangaId: number; mangaTitle: string; thumbnailUrl: string;
  chapterId: number; chapterName: string; pageNumber: number; readAt: number;
}

export interface Toast {
  id: string; kind: "success" | "error" | "info" | "download";
  title: string; body?: string; duration?: number;
}

export interface ActiveDownload { chapterId: number; mangaId: number; progress: number }

export interface Folder { id: string; name: string; mangaIds: number[]; showTab: boolean }

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
}

export const DEFAULT_SETTINGS: Settings = {
  pageStyle: "longstrip", readingDirection: "ltr", fitMode: "width",
  maxPageWidth: 900, pageGap: true, optimizeContrast: false,
  offsetDoubleSpreads: false, preloadPages: 3, autoMarkRead: true,
  autoNextChapter: true, libraryCropCovers: true, libraryPageSize: 48,
  showNsfw: false, chapterSortDir: "desc", chapterPageSize: 25,
  uiScale: 100, compactSidebar: false, gpuAcceleration: true,
  serverUrl: "http://localhost:4567", serverBinary: "tachidesk-server",
  autoStartServer: true, preferredExtensionLang: "en", keybinds: DEFAULT_KEYBINDS,
  idleTimeoutMin: 5, splashCards: true, storageLimitGb: null, folders: [],
  markReadOnNext: true, readerDebounceMs: 120, theme: "dark",
};

function loadPersisted() {
  try {
    const raw = localStorage.getItem("moku-store");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function persist(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

const saved = loadPersisted();

function mergeSettings(saved: any): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...saved?.settings,
    folders:  saved?.settings?.folders  ?? [],
    keybinds: { ...DEFAULT_KEYBINDS, ...saved?.settings?.keybinds },
  };
}

export const navPage        = writable<NavPage>(saved?.navPage ?? "library");
export const libraryFilter  = writable<LibraryFilter>(saved?.libraryFilter ?? "library");
export const history        = writable<HistoryEntry[]>(saved?.history ?? []);
export const settings       = writable<Settings>(mergeSettings(saved));

export const genreFilter     = writable<string>("");
export const searchPrefill   = writable<string>("");
export const activeManga     = writable<Manga | null>(null);
export const previewManga    = writable<Manga | null>(null);
export const activeSource    = writable<Source | null>(null);
export const pageUrls        = writable<string[]>([]);
export const pageNumber      = writable<number>(1);
export const libraryTagFilter = writable<string[]>([]);
export const settingsOpen    = writable<boolean>(false);
export const activeDownloads = writable<ActiveDownload[]>([]);
export const toasts          = writable<Toast[]>([]);

export const activeChapter     = writable<Chapter | null>(null);
export const activeChapterList = writable<Chapter[]>([]);

export function openReader(chapter: Chapter, chapterList: Chapter[]) {
  activeChapter.set(chapter);
  activeChapterList.set(chapterList);
  pageUrls.set([]);
  pageNumber.set(1);
}

export function closeReader() {
  activeChapter.set(null);
  activeChapterList.set([]);
  pageUrls.set([]);
  pageNumber.set(1);
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
}

export function addToast(toast: Omit<Toast, "id">) {
  toasts.update((t) => [...t, { ...toast, id: Math.random().toString(36).slice(2) }].slice(-5));
}

export function dismissToast(id: string) {
  toasts.update((t) => t.filter((x) => x.id !== id));
}

export function updateSettings(patch: Partial<Settings>) {
  settings.update((s) => ({ ...s, ...patch }));
}

export function resetKeybinds() {
  settings.update((s) => ({ ...s, keybinds: DEFAULT_KEYBINDS }));
}

const genId = () => Math.random().toString(36).slice(2, 10);

export function addFolder(name: string): string {
  const id = genId();
  settings.update((s) => ({ ...s, folders: [...s.folders, { id, name: name.trim(), mangaIds: [], showTab: false }] }));
  return id;
}

export function removeFolder(id: string) {
  settings.update((s) => ({ ...s, folders: s.folders.filter((f) => f.id !== id) }));
}

export function renameFolder(id: string, name: string) {
  settings.update((s) => ({ ...s, folders: s.folders.map((f) => f.id === id ? { ...f, name: name.trim() } : f) }));
}

export function toggleFolderTab(id: string) {
  settings.update((s) => ({ ...s, folders: s.folders.map((f) => f.id === id ? { ...f, showTab: !f.showTab } : f) }));
}

export function assignMangaToFolder(folderId: string, mangaId: number) {
  settings.update((s) => ({
    ...s, folders: s.folders.map((f) =>
      f.id === folderId && !f.mangaIds.includes(mangaId) ? { ...f, mangaIds: [...f.mangaIds, mangaId] } : f
    ),
  }));
}

export function removeMangaFromFolder(folderId: string, mangaId: number) {
  settings.update((s) => ({
    ...s, folders: s.folders.map((f) =>
      f.id === folderId ? { ...f, mangaIds: f.mangaIds.filter((id) => id !== mangaId) } : f
    ),
  }));
}

export function getMangaFolders(mangaId: number): Folder[] {
  return get(settings).folders.filter((f) => f.mangaIds.includes(mangaId));
}

navPage.subscribe((v)       => persist("moku-store", { ...loadPersisted(), navPage: v }));
libraryFilter.subscribe((v) => persist("moku-store", { ...loadPersisted(), libraryFilter: v }));
history.subscribe((v)       => persist("moku-store", { ...loadPersisted(), history: v }));
settings.subscribe((v)      => persist("moku-store", { ...loadPersisted(), settings: v }));
