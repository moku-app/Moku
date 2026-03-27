const DEFAULT_URL = "http://127.0.0.1:4567";

function getSettings(): Record<string, any> {
  try {
    const raw = localStorage.getItem("moku-store");
    if (raw) return JSON.parse(raw)?.settings ?? {};
  } catch {}
  return {};
}

function getServerUrl(): string {
  const url = getSettings().serverUrl;
  if (typeof url === "string" && url.trim()) return url.replace(/\/$/, "");
  return DEFAULT_URL;
}

function getAuthHeader(): Record<string, string> {
  const s = getSettings();
  if (!s.serverAuthEnabled) return {};
  const user = typeof s.serverAuthUser === "string" ? s.serverAuthUser.trim() : "";
  const pass = typeof s.serverAuthPass === "string" ? s.serverAuthPass.trim() : "";
  if (user && pass) return { Authorization: `Basic ${btoa(`${user}:${pass}`)}` };
  return {};
}

function gqlUrl(): string { return `${getServerUrl()}/api/graphql`; }

export function thumbUrl(path: string): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${getServerUrl()}${path}`;
}

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
      const res = await fetch(url, { ...init, signal });
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return res;
    } catch (e: any) {
      const isAbort = e?.name === "AbortError" || signal?.aborted;
      if (isAbort) throw new DOMException("Aborted", "AbortError");
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
  const res = await fetchWithRetry(gqlUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify({ query, variables }),
  }, signal);

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (!res.ok) throw new Error(`Suwayomi HTTP ${res.status}`);

  const json: GQLResponse<T> = await res.json();

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (json.errors?.length) throw new Error(json.errors[0].message);

  return json.data;
}
