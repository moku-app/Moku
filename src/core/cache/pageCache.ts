import { gql, plainThumbUrl }         from "@api/client";
import { getBlobUrl, preloadBlobUrls } from "@core/cache/imageCache";
import { dedupeRequest }               from "@core/async/batchRequests";
import { FETCH_CHAPTER_PAGES }         from "@api/mutations/chapters";

const pageCache        = new Map<number, string[]>();
const inflight         = new Map<number, Promise<string[]>>();
const resolvedUrlCache = new Map<string, Promise<string>>();
const preloadedUrls    = new Set<string>();
const aspectCache      = new Map<string, number>();

export function resolveUrl(url: string, useBlob: boolean, priority = 0): Promise<string> {
  if (!useBlob) return Promise.resolve(url);
  if (!resolvedUrlCache.has(url)) resolvedUrlCache.set(url, getBlobUrl(url, priority));
  return resolvedUrlCache.get(url)!;
}

export function fetchPages(
  chapterId: number,
  useBlob: boolean,
  signal?: AbortSignal,
  priorityPage = 0,
): Promise<string[]> {
  const cached = pageCache.get(chapterId);
  if (cached) return Promise.resolve(cached);
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));

  if (!inflight.has(chapterId)) {
    const p = dedupeRequest(`chapter-pages:${chapterId}`, () =>
      gql<{ fetchChapterPages: { pages: string[] } }>(FETCH_CHAPTER_PAGES, { chapterId })
        .then(d => {
          const urls = d.fetchChapterPages.pages.map(p => plainThumbUrl(p));
          if (useBlob) {
            if (urls[priorityPage]) getBlobUrl(urls[priorityPage], urls.length + 999);
            preloadBlobUrls(urls.filter((_, i) => i !== priorityPage), urls.length);
          }
          pageCache.set(chapterId, urls);
          return urls;
        })
    ).finally(() => inflight.delete(chapterId));
    inflight.set(chapterId, p);
  }

  const base = inflight.get(chapterId)!;
  if (!signal) return base;
  return new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    base.then(resolve, reject);
  });
}

export function measureAspect(url: string, useBlob: boolean): Promise<number> {
  if (aspectCache.has(url)) return Promise.resolve(aspectCache.get(url)!);
  return resolveUrl(url, useBlob).then(src => new Promise(res => {
    const img = new Image();
    img.onload  = () => { const r = img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 0.67; aspectCache.set(url, r); res(r); };
    img.onerror = () => res(0.67);
    img.src = src;
  }));
}

export function preloadImage(url: string, useBlob: boolean): void {
  if (preloadedUrls.has(url)) return;
  preloadedUrls.add(url);
  resolveUrl(url, useBlob).then(src => { new Image().src = src; }).catch(() => {});
}

export function clearPageCache(chapterId?: number): void {
  if (chapterId !== undefined) {
    pageCache.delete(chapterId);
    inflight.delete(chapterId);
  } else {
    pageCache.clear();
    inflight.clear();
    resolvedUrlCache.clear();
    preloadedUrls.clear();
    aspectCache.clear();
  }
}