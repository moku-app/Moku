/**
 * Session-level request cache — v3.
 *
 * Key design decisions (preserved from v1/v2):
 * - Stores the Promise itself — concurrent callers await the same fetch (no thundering herd).
 * - On real errors the entry is evicted so the next call retries.
 * - AbortErrors do NOT evict — cancellation ≠ failure.
 * - Subscribers are notified when a key is explicitly cleared or updated.
 *
 * v3 additions:
 * - cache.set(): direct write without a fetcher — for optimistic updates and
 *   post-mutation cache patching. Notifies subscribers immediately.
 * - Invalidation groups: tag a cache key with one or more group strings.
 *   cache.clearGroup("library") clears ALL keys tagged with "library" in one call.
 *   This replaces the pattern of manually calling cache.clear() on every related key.
 * - Subscriber notifications on set() — reactive components re-render when the
 *   cache is updated, not just when it's cleared.
 * - cache.update(): atomically patch a cached value (read → transform → write).
 */

interface Entry<T> {
  promise:   Promise<T>;
  fetchedAt: number;
}

const store  = new Map<string, Entry<unknown>>();
const subs   = new Map<string, Set<() => void>>();
const groups = new Map<string, Set<string>>(); // groupTag → Set<cacheKey>

export const DEFAULT_TTL_MS = 5 * 60 * 1_000;

function notify(key: string) {
  subs.get(key)?.forEach((cb) => cb());
}

export const cache = {
  /**
   * Return a cached promise. Re-fetches once older than `ttl` ms.
   * Pass `Infinity` to pin for the session.
   */
  get<T>(
    key:     string,
    fetcher: () => Promise<T>,
    ttl:     number = DEFAULT_TTL_MS,
    group?:  string | string[],
  ): Promise<T> {
    const existing = store.get(key) as Entry<T> | undefined;
    if (existing && Date.now() - existing.fetchedAt < ttl) return existing.promise;

    const promise = fetcher().catch((err) => {
      if (err?.name !== "AbortError") store.delete(key);
      return Promise.reject(err);
    }) as Promise<T>;

    store.set(key, { promise, fetchedAt: Date.now() });

    // Register in invalidation groups
    if (group) {
      const tags = Array.isArray(group) ? group : [group];
      for (const tag of tags) {
        if (!groups.has(tag)) groups.set(tag, new Set());
        groups.get(tag)!.add(key);
      }
    }

    // Notify subscribers once the fetch resolves (reactive update on new data)
    promise.then(() => notify(key)).catch(() => {});

    return promise;
  },

  /**
   * Directly write a value into the cache — for optimistic updates and
   * post-mutation patching. Notifies subscribers immediately.
   */
  set<T>(key: string, value: T, group?: string | string[]) {
    const promise = Promise.resolve(value);
    store.set(key, { promise, fetchedAt: Date.now() });

    if (group) {
      const tags = Array.isArray(group) ? group : [group];
      for (const tag of tags) {
        if (!groups.has(tag)) groups.set(tag, new Set());
        groups.get(tag)!.add(key);
      }
    }

    notify(key);
  },

  /**
   * Atomically patch a cached value.
   * If the key doesn't exist, does nothing.
   */
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

  clear(key: string) {
    store.delete(key);
    notify(key);
  },

  /**
   * Clear all keys belonging to an invalidation group.
   * e.g. cache.clearGroup("library") clears "library", "all_manga_unfiltered", etc.
   */
  clearGroup(tag: string) {
    const keys = groups.get(tag);
    if (!keys) return;
    for (const key of keys) {
      store.delete(key);
      notify(key);
    }
    groups.delete(tag);
  },

  clearAll() {
    const allKeys = [...store.keys()];
    store.clear();
    groups.clear();
    allKeys.forEach(notify);
  },

  subscribe(key: string, cb: () => void): () => void {
    if (!subs.has(key)) subs.set(key, new Set());
    subs.get(key)!.add(cb);
    return () => subs.get(key)?.delete(cb);
  },
};

// ── Cache key constants ───────────────────────────────────────────────────────

/**
 * Invalidation group tags.
 * cache.clearGroup(CACHE_GROUPS.LIBRARY) clears all library-related keys at once.
 */
export const CACHE_GROUPS = {
  LIBRARY: "g:library",   // library + all_manga_unfiltered
  SOURCES: "g:sources",   // sources list + per-source page caches
} as const;

export const CACHE_KEYS = {
  LIBRARY:             "library",
  ALL_MANGA:           "all_manga_unfiltered",
  DISCOVER:            "discover_all_manga",  // Discover's unfiltered fetch — separate from library
  SOURCES:             "sources",
  POPULAR:             "popular",
  GENRE:    (genre: string) => `genre:${genre}`,
  MANGA:    (id: number)    => `manga:${id}`,
  CHAPTERS: (id: number)    => `chapters:${id}`,

  sourceMangaPages(
    sourceId: string,
    type:     "POPULAR" | "LATEST" | "SEARCH",
    query?:   string | string[],
  ): string {
    const q = Array.isArray(query) ? [...query].sort().join("+") : (query ?? "");
    return `pages:${sourceId}:${type}:${q}`;
  },

  sourceMangaPage(
    sourceId: string,
    type:     "POPULAR" | "LATEST" | "SEARCH",
    page:     number,
    query?:   string | string[],
  ): string {
    const q = Array.isArray(query) ? [...query].sort().join("+") : (query ?? "");
    return `page:${sourceId}:${type}:${page}:${q}`;
  },
} as const;

// ── In-flight request deduplication (for non-cached calls) ───────────────────
//
// Some requests (chapter lists, manga detail) are NOT stored in the long-lived
// cache but still get fired multiple times when a user rapidly opens/closes a
// manga. This map deduplicates them so only one network round-trip is active at
// a time per key.

const inflight = new Map<string, Promise<unknown>>();

export function deduped<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  if (inflight.has(key)) return inflight.get(key) as Promise<T>;
  const p = fetcher().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// ── PageSet: per-session page-number tracker ──────────────────────────────────
//
// Tracks which page numbers have been fetched for a (source, type, query) bucket.
// Lives in a separate map from the TTL store so it never gets TTL-evicted while
// a browse session is actively paginating.
//
// Usage:
//   const ps = getPageSet(sourceId, "SEARCH", ["Action", "Romance"]);
//   ps.add(1);     // after fetching page 1
//   ps.next();     // → 2
//   ps.pages();    // → Set {1}
//   ps.clear();    // call when query/tags change

const _pageSets = new Map<string, Set<number>>();

export interface PageSet {
  add(page: number): void;
  pages(): Set<number>;
  /** Next page to fetch: max fetched + 1, or 1 if nothing fetched yet. */
  next(): number;
  clear(): void;
}

export function getPageSet(
  sourceId: string,
  type:     "POPULAR" | "LATEST" | "SEARCH",
  query?:   string | string[],
): PageSet {
  const key = CACHE_KEYS.sourceMangaPages(sourceId, type, query);
  return {
    add(page)  {
      if (!_pageSets.has(key)) _pageSets.set(key, new Set());
      _pageSets.get(key)!.add(page);
    },
    pages()    { return new Set(_pageSets.get(key) ?? []); },
    next()     { const s = _pageSets.get(key); return s?.size ? Math.max(...s) + 1 : 1; },
    clear()    { _pageSets.delete(key); },
  };
}

// ── Source frecency helpers ───────────────────────────────────────────────────

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
  const withScore = sources.map((s) => ({ s, score: map[s.id] ?? 0 }));
  const hasFrecency = withScore.some((x) => x.score > 0);
  if (hasFrecency) {
    return withScore
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_FRECENCY_SOURCES)
      .map((x) => x.s);
  }
  return sources.slice(0, MAX_FRECENCY_SOURCES);
}