import { store }                           from "@store/state.svelte";
import { probeServer, loginBasic, loginUI } from "@core/auth";
import { trackingState }                   from "@features/tracking/store/trackingState.svelte";
import { loadAllStores }                   from "@core/persistence/persist";

const MAX_ATTEMPTS = 40;

export const boot = $state({
  serverProbeOk:  false,
  failed:         false,
  notConfigured:  false,
  loginRequired:  false,
  loginError:     null as string | null,
  loginBusy:      false,
  loginUser:      "",
  loginPass:      "",
  sessionExpired: false,
  skipped:        false,
});

let probeGeneration = 0;

export async function initStore() {
  const saved = await loadAllStores();
  store.hydrate(saved);
}

export function startProbe() {
  const gen = ++probeGeneration;
  boot.failed        = false;
  boot.loginRequired = false;
  boot.skipped       = false;
  let tries          = 0;

  async function probe() {
    if (gen !== probeGeneration) return;
    tries++;

    const result = await probeServer();
    if (gen !== probeGeneration) return;

    if (result === "ok") {
      boot.serverProbeOk = true;
      trackingState.bootSync().catch(() => {});
      return;
    }

    if (result === "auth_required") {
      boot.serverProbeOk = true;
      const mode = store.settings.serverAuthMode ?? "NONE";

      if (mode === "BASIC_AUTH") {
        const user = store.settings.serverAuthUser?.trim() ?? "";
        const pass = store.settings.serverAuthPass?.trim() ?? "";
        if (user && pass) {
          try {
            await loginBasic(user, pass);
            if (gen !== probeGeneration) return;
            trackingState.bootSync().catch(() => {});
            return;
          } catch {}
        }
        boot.loginUser     = store.settings.serverAuthUser ?? "";
        boot.loginRequired = true;
        return;
      }

      if (mode === "UI_LOGIN") {
        boot.loginUser     = store.settings.serverAuthUser ?? "";
        boot.loginRequired = true;
        return;
      }

      trackingState.bootSync().catch(() => {});
      return;
    }

    if (tries >= MAX_ATTEMPTS) { boot.failed = true; return; }
    setTimeout(probe, Math.min(750 + tries * 250, 3000));
  }

  setTimeout(probe, 2000);
}

export function stopProbe() {
  probeGeneration++;
}

export async function submitLogin(onSuccess: () => void): Promise<void> {
  if (!boot.loginUser.trim() || !boot.loginPass.trim()) {
    boot.loginError = "Username and password are required";
    return;
  }
  boot.loginBusy  = true;
  boot.loginError = null;

  try {
    const mode = store.settings.serverAuthMode ?? "NONE";
    if (mode === "UI_LOGIN") {
      await loginUI(boot.loginUser.trim(), boot.loginPass.trim());
    } else {
      await loginBasic(boot.loginUser.trim(), boot.loginPass.trim());
    }

    boot.loginRequired  = false;
    boot.sessionExpired = false;
    boot.skipped        = false;
    boot.loginPass      = "";
    boot.loginError     = null;
    trackingState.bootSync().catch(() => {});
    onSuccess();
  } catch (e: any) {
    boot.loginError = e?.message ?? "Login failed";
  } finally {
    boot.loginBusy = false;
  }
}

export function retryBoot() {
  boot.serverProbeOk = false;
  boot.failed        = false;
  boot.notConfigured = false;
  boot.loginRequired = false;
  boot.skipped       = false;
  startProbe();
}

export function bypassBoot(onReady: () => void) {
  probeGeneration++;
  boot.serverProbeOk  = true;
  boot.loginRequired  = false;
  boot.sessionExpired = false;
  boot.skipped        = true;
  onReady();
}