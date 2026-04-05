import { store, updateSettings } from "../store/state.svelte";

export type AuthMode = "NONE" | "BASIC_AUTH" | "SIMPLE_LOGIN" | "UI_LOGIN";

export const authSession = {
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
  url:     string,
  init:    RequestInit,
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

  return fetch(url, { ...init, signal });
}

export async function loginBasic(user: string, pass: string): Promise<void> {
  const res = await fetch(`${getServerBase()}/api/graphql`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", ...basicHeader(user, pass) },
    body:    JSON.stringify({ query: "{ __typename }" }),
    signal:  AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Authentication failed (${res.status})`);
  updateSettings({ serverAuthMode: "BASIC_AUTH", serverAuthUser: user, serverAuthPass: pass });
}

export async function logout(): Promise<void> {
  updateSettings({ serverAuthPass: "" });
}

export async function probeServer(): Promise<"ok" | "auth_required" | "unsupported_mode" | "unreachable"> {
  const base = getServerBase();
  const mode = store.settings.serverAuthMode ?? "NONE";
  const s    = store.settings;

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    if (mode === "BASIC_AUTH") {
      const user = s.serverAuthUser?.trim() ?? "";
      const pass = s.serverAuthPass?.trim() ?? "";
      if (user && pass) Object.assign(headers, basicHeader(user, pass));
    }

    const res = await fetch(`${base}/api/graphql`, {
      method:      "POST",
      credentials: "include",
      headers,
      body:        JSON.stringify({ query: "{ __typename }" }),
      signal:      AbortSignal.timeout(2000),
    });

    if (res.ok) {
      if (mode !== "NONE") updateSettings({ serverAuthMode: "NONE" });
      return "ok";
    }

    if (res.status === 401) {
      const wwwAuth = res.headers.get("WWW-Authenticate") ?? "";

      if (/basic/i.test(wwwAuth)) {
        if (mode !== "BASIC_AUTH") updateSettings({ serverAuthMode: "BASIC_AUTH" });
        return "auth_required";
      }

      if (/bearer/i.test(wwwAuth)) {
        if (mode !== "UI_LOGIN") updateSettings({ serverAuthMode: "UI_LOGIN" });
      } else if (mode === "NONE") {
        updateSettings({ serverAuthMode: "SIMPLE_LOGIN" });
      }
      return "unsupported_mode";
    }

    return "unreachable";
  } catch { return "unreachable"; }
}
