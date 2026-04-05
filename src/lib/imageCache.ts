import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { store } from "../store/state.svelte";

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function getAuthHeaders(): Record<string, string> {
  const mode = store.settings.serverAuthMode;
  if (mode === "BASIC_AUTH") {
    const user = store.settings.serverAuthUser?.trim() ?? "";
    const pass = store.settings.serverAuthPass?.trim() ?? "";
    if (user && pass) {
      return { Authorization: `Basic ${btoa(`${user}:${pass}`)}` };
    }
  }
  return {};
}

export async function getBlobUrl(url: string): Promise<string> {
  if (!url) return "";

  const cached = cache.get(url);
  if (cached) return cached;

  const existing = inflight.get(url);
  if (existing) return existing;

  const promise = tauriFetch(url, {
    method: "GET",
    headers: getAuthHeaders(),
  })
    .then(res => {
      if (!res.ok) throw new Error(`${res.status}`);
      return res.blob();
    })
    .then(blob => {
      const blobUrl = URL.createObjectURL(blob);
      cache.set(url, blobUrl);
      inflight.delete(url);
      return blobUrl;
    })
    .catch(err => {
      inflight.delete(url);
      throw err;
    });

  inflight.set(url, promise);
  return promise;
}
