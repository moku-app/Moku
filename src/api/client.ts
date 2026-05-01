import { store } from "@store/state.svelte";
import { fetchAuthenticated, AuthRequiredError } from "../core/auth";
import { boot } from "@store/boot.svelte";

const DEFAULT_URL = "http://127.0.0.1:4567";

function getServerUrl(): string {
  const url = store.settings.serverUrl;
  return typeof url === "string" && url.trim() ? url.replace(/\/$/, "") : DEFAULT_URL;
}

export function plainThumbUrl(path: string): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${getServerUrl()}${path}`;
}

export const thumbUrl = plainThumbUrl;

interface GQLResponse<T> {
  data: T;
  errors?: { message: string }[];
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
  retries = 3,
  delayMs = 300,
): Promise<Response> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  for (let i = 0; i < retries; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const res = await fetchAuthenticated(url, init, signal, boot.skipped);
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return res;
    } catch (e: any) {
      if (e?.authRequired) throw e;
      if (e?.name === "AbortError" || signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (e instanceof AuthRequiredError) throw e;
      if (i === retries - 1) throw e;
      await abortableSleep(delayMs * Math.pow(1.5, i), signal);
    }
  }
  throw new Error("unreachable");
}

export async function gql<T>(
  query: string,
  variables?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetchWithRetry(
    `${getServerUrl()}/api/graphql`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) },
    signal,
  );
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (!res.ok) throw new Error(`Suwayomi HTTP ${res.status}`);
  const json: GQLResponse<T> = await res.json();
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (json.errors?.length) {
    const isAuthError = json.errors.some(e => /unauthorized|unauthenticated/i.test(e.message));
    if (isAuthError && !boot.skipped) {
      boot.sessionExpired = true;
      boot.loginRequired  = true;
      boot.loginUser      = store.settings.serverAuthUser ?? "";
      throw new AuthRequiredError(json.errors[0].message);
    }
    throw new Error(json.errors[0].message);
  }
  return json.data;
}