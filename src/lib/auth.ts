import { store, updateSettings } from "../store/state.svelte";

// Only NONE and BASIC_AUTH are supported. SIMPLE_LOGIN and UI_LOGIN are
// recognised as values the server may report, but this client will not
// attempt to authenticate with them — it will show an unsupported-mode
// warning instead.
export type AuthMode = "NONE" | "BASIC_AUTH" | "SIMPLE_LOGIN" | "UI_LOGIN";

export const authSession = {
  // These stubs exist so callers that imported authSession don't break.
  // Basic-auth credentials are never stored client-side; they are sent
  // per-request via the Authorization header.
  clearTokens() {},
  hasSession(): boolean { return true; },
};

function getServerBase(): string {
  const url = store.settings.serverUrl;
  return typeof url === "string" && url.trim() ? url.replace(/\/$/, "") : "http://127.0.0.1:4567";
}

function basicHeader(user: string, pass: string): Record<string, string> {
  return { Authorization: `Basic ${btoa(`${user}:${pass}`)}` };
}

function buildRequestInit(init: RequestInit, extraHeaders: Record<string, string> = {}): RequestInit {
  return {
    ...init,
    credentials: "include",
    headers: { ...(init.headers as Record<string, string> ?? {}), ...extraHeaders },
  };
}

export async function fetchAuthenticated(
  url:    string,
  init:   RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  const mode = store.settings.serverAuthMode ?? "NONE";
  const s    = store.settings;

  if (mode === "BASIC_AUTH") {
    const user = s.serverAuthUser?.trim() ?? "";
    const pass = s.serverAuthPass?.trim() ?? "";
    const headers = user && pass ? basicHeader(user, pass) : {};
    return fetch(url, buildRequestInit({ ...init, signal }, headers));
  }

  // SIMPLE_LOGIN, UI_LOGIN, and any future unknown modes: send the request
  // unauthenticated. The probe/login gate in App.svelte will have already
  // shown an unsupported-mode warning so the user knows requests may fail.
  return fetch(url, { ...init, signal });
}

export async function loginBasic(user: string, pass: string): Promise<void> {
  const res = await fetch(`${getServerBase()}/api/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...basicHeader(user, pass) },
    body: JSON.stringify({ query: "{ __typename }" }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Authentication failed (${res.status})`);
  // Persist credentials through the store so fetchAuthenticated picks them up.
  updateSettings({ serverAuthMode: "BASIC_AUTH", serverAuthUser: user, serverAuthPass: pass });
}

export async function logout(): Promise<void> {
  // Basic auth has no server-side session to invalidate.
  updateSettings({ serverAuthPass: "" });
}

export async function probeServer(): Promise<"ok" | "auth_required" | "unsupported_mode" | "unreachable"> {
  const base = getServerBase();
  const mode = store.settings.serverAuthMode ?? "NONE";
  const s    = store.settings;

  try {
    let headers: Record<string, string> = { "Content-Type": "application/json" };

    if (mode === "BASIC_AUTH") {
      const user = s.serverAuthUser?.trim() ?? "";
      const pass = s.serverAuthPass?.trim() ?? "";
      // If we have credentials, try them — a 200 means we're good.
      // If we don't have credentials yet, fall through to the unauthenticated
      // probe so we still get the WWW-Authenticate header back.
      if (user && pass) Object.assign(headers, basicHeader(user, pass));
    }

    const res = await fetch(`${base}/api/graphql`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({ query: "{ __typename }" }),
      signal: AbortSignal.timeout(2000),
    });

    if (res.ok) return "ok";

    if (res.status === 401) {
      // Sniff the WWW-Authenticate header to auto-detect the server's scheme.
      const wwwAuth = (res.headers.get("WWW-Authenticate") ?? "").toLowerCase();

      if (/basic/i.test(wwwAuth)) {
        // Server wants Basic Auth — update the stored mode so the login gate
        // shows the right UI and fetchAuthenticated uses the right scheme.
        if (mode !== "BASIC_AUTH") {
          updateSettings({ serverAuthMode: "BASIC_AUTH" });
        }
        return "auth_required";
      }

      // Any other 401 (Bearer, Digest, cookie-based, etc.) is unsupported.
      // Try to figure out what it is for a better warning label.
      if (/bearer/i.test(wwwAuth)) {
        // Likely SIMPLE_LOGIN or UI_LOGIN — store it so the warning names it.
        if (mode !== "UI_LOGIN") updateSettings({ serverAuthMode: "UI_LOGIN" });
      } else if (mode === "NONE") {
        // Unknown scheme and we had no mode stored — store a sentinel so the
        // warning fires instead of an infinite auth_required loop.
        updateSettings({ serverAuthMode: "SIMPLE_LOGIN" });
      }
      return "unsupported_mode";
    }

    return "unreachable";
  } catch { return "unreachable"; }
}
