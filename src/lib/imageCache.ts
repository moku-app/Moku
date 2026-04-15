import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { store } from "../store/state.svelte";

const cache    = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

const MAX_CONCURRENT = 6;
let   active         = 0;

interface QueueEntry {
  url:      string;
  priority: number;
  resolve:  (v: string) => void;
  reject:   (e: unknown) => void;
}

const queue: QueueEntry[] = [];

function getAuthHeaders(): Record<string, string> {
  const user = store.settings.serverAuthUser?.trim() ?? "";
  const pass = store.settings.serverAuthPass?.trim() ?? "";
  return user && pass ? { Authorization: `Basic ${btoa(`${user}:${pass}`)}` } : {};
}

async function doFetch(url: string): Promise<string> {
  const res = await tauriFetch(url, { method: "GET", headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`${res.status}`);
  const blobUrl = URL.createObjectURL(await res.blob());
  cache.set(url, blobUrl);
  return blobUrl;
}

function insertSorted(entry: QueueEntry) {
  let lo = 0, hi = queue.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (queue[mid].priority > entry.priority) lo = mid + 1;
    else hi = mid;
  }
  queue.splice(lo, 0, entry);
}

function drain() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const entry = queue.shift()!;
    active++;
    doFetch(entry.url)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        inflight.delete(entry.url);
        active--;
        drain();
      });
  }
}

function enqueue(url: string, priority: number): Promise<string> {
  const promise = new Promise<string>((resolve, reject) => {
    insertSorted({ url, priority, resolve, reject });
  });
  inflight.set(url, promise);
  drain();
  return promise;
}

export function getBlobUrl(url: string, priority = 0): Promise<string> {
  if (!url) return Promise.resolve("");

  const cached = cache.get(url);
  if (cached) return Promise.resolve(cached);

  const existing = inflight.get(url);
  if (existing) {
    const idx = queue.findIndex(e => e.url === url);
    if (idx !== -1 && priority > queue[idx].priority) {
      const [entry] = queue.splice(idx, 1);
      entry.priority = priority;
      insertSorted(entry);
    }
    return existing;
  }

  return enqueue(url, priority);
}

export function preloadBlobUrls(urls: string[], basePriority = 0): void {
  urls.forEach((url, i) => {
    if (!url || cache.has(url) || inflight.has(url)) return;
    enqueue(url, basePriority - i);
  });
}

export function revokeBlobUrl(url: string): void {
  const blob = cache.get(url);
  if (blob) {
    URL.revokeObjectURL(blob);
    cache.delete(url);
  }
}

export function clearBlobCache(): void {
  cache.forEach(blob => URL.revokeObjectURL(blob));
  cache.clear();
}
