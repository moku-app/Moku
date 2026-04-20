interface Entry<T> {
  promise:   Promise<T>;
  fetchedAt: number;
}

const store  = new Map<string, Entry<unknown>>();
const subs   = new Map<string, Set<() => void>>();
const groups = new Map<string, Set<string>>();

export const DEFAULT_TTL_MS = 5 * 60 * 1_000;

function notify(key: string) { subs.get(key)?.forEach(cb => cb()); }

function registerGroups(key: string, group?: string | string[]) {
  if (!group) return;
  for (const tag of Array.isArray(group) ? group : [group]) {
    if (!groups.has(tag)) groups.set(tag, new Set());
    groups.get(tag)!.add(key);
  }
}

export const cache = {
  get<T>(key: string, fetcher: () => Promise<T>, ttl = DEFAULT_TTL_MS, group?: string | string[]): Promise<T> {
    const existing = store.get(key) as Entry<T> | undefined;
    if (existing && Date.now() - existing.fetchedAt < ttl) return existing.promise;
    const promise = fetcher().catch(err => {
      if (err?.name !== "AbortError") store.delete(key);
      return Promise.reject(err);
    }) as Promise<T>;
    store.set(key, { promise, fetchedAt: Date.now() });
    registerGroups(key, group);
    promise.then(() => notify(key)).catch(() => {});
    return promise;
  },

  set<T>(key: string, value: T, group?: string | string[]) {
    store.set(key, { promise: Promise.resolve(value), fetchedAt: Date.now() });
    registerGroups(key, group);
    notify(key);
  },

  update<T>(key: string, fn: (prev: T) => T) {
    const existing = store.get(key) as Entry<T> | undefined;
    if (!existing) return;
    const next = existing.promise.then(fn);
    store.set(key, { promise: next, fetchedAt: Date.now() });
    next.then(() => notify(key)).catch(() => {});
  },

  has(key: string): boolean { return store.has(key); },

  ageOf(key: string): number | undefined {
    const e = store.get(key);
    return e ? Date.now() - e.fetchedAt : undefined;
  },

  clear(key: string) { store.delete(key); notify(key); },

  clearGroup(tag: string) {
    const keys = groups.get(tag);
    if (!keys) return;
    for (const key of keys) { store.delete(key); notify(key); }
    groups.delete(tag);
  },

  clearAll() {
    const allKeys = [...store.keys()];
    store.clear(); groups.clear();
    allKeys.forEach(notify);
  },

  subscribe(key: string, cb: () => void): () => void {
    if (!subs.has(key)) subs.set(key, new Set());
    subs.get(key)!.add(cb);
    return () => subs.get(key)?.delete(cb);
  },
};

export const CACHE_GROUPS = {
  LIBRARY: "g:library",
  SOURCES: "g:sources",
} as const;

export const CACHE_KEYS = {
  LIBRARY:    "library",
  ALL_MANGA:  "all_manga_unfiltered",
  CATEGORIES: "categories",
  SEARCH:     "search_all_manga",
  SOURCES:    "sources",
  POPULAR:    "popular",
  GENRE:    (genre: string) => `genre:${genre}`,
  MANGA:    (id: number)    => `manga:${id}`,
  CHAPTERS: (id: number)    => `chapters:${id}`,

  sourceMangaPages(sourceId: string, type: "POPULAR" | "LATEST" | "SEARCH", query?: string | string[]): string {
    const q = Array.isArray(query) ? [...query].sort().join("+") : (query ?? "");
    return `pages:${sourceId}:${type}:${q}`;
  },

  sourceMangaPage(sourceId: string, type: "POPULAR" | "LATEST" | "SEARCH", page: number, query?: string | string[]): string {
    const q = Array.isArray(query) ? [...query].sort().join("+") : (query ?? "");
    return `page:${sourceId}:${type}:${page}:${q}`;
  },
} as const;

const inflight = new Map<string, Promise<unknown>>();

export function deduped<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  if (inflight.has(key)) return inflight.get(key) as Promise<T>;
  const p = fetcher().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

const _pageSets = new Map<string, Set<number>>();

export interface PageSet {
  add(page: number): void;
  pages(): Set<number>;
  next(): number;
  clear(): void;
}

export function getPageSet(sourceId: string, type: "POPULAR" | "LATEST" | "SEARCH", query?: string | string[]): PageSet {
  const key = CACHE_KEYS.sourceMangaPages(sourceId, type, query);
  return {
    add(page)  { if (!_pageSets.has(key)) _pageSets.set(key, new Set()); _pageSets.get(key)!.add(page); },
    pages()    { return new Set(_pageSets.get(key) ?? []); },
    next()     { const s = _pageSets.get(key); return s?.size ? Math.max(...s) + 1 : 1; },
    clear()    { _pageSets.delete(key); },
  };
}

const FRECENCY_KEY         = "moku-source-frecency";
const MAX_FRECENCY_SOURCES = 4;
type FrecencyMap = Record<string, number>;

function loadFrecency(): FrecencyMap {
  try { const r = localStorage.getItem(FRECENCY_KEY); return r ? JSON.parse(r) : {}; }
  catch { return {}; }
}

function saveFrecency(map: FrecencyMap) {
  try { localStorage.setItem(FRECENCY_KEY, JSON.stringify(map)); } catch {}
}

export function recordSourceAccess(sourceId: string) {
  if (!sourceId || sourceId === "0") return;
  const map = loadFrecency();
  map[sourceId] = (map[sourceId] ?? 0) + 1;
  saveFrecency(map);
}

export function getTopSources<T extends { id: string }>(sources: T[]): T[] {
  const map = loadFrecency();
  const withScore = sources.map(s => ({ s, score: map[s.id] ?? 0 }));
  if (withScore.some(x => x.score > 0)) {
    return withScore.sort((a, b) => b.score - a.score).slice(0, MAX_FRECENCY_SOURCES).map(x => x.s);
  }
  return sources.slice(0, MAX_FRECENCY_SOURCES);
}
