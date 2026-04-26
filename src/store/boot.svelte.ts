import { store } from "@store/state.svelte";
import { probeServer, loginBasic } from "@core/auth";
import { trackingState } from "@features/tracking/store/trackingState.svelte";

const MAX_ATTEMPTS = 40;

export const boot = $state({
  serverProbeOk:   false,
  failed:          false,
  notConfigured:   false,
  loginRequired:   false,
  unsupportedMode: false,
  loginUser:       "",
  loginPass:       "",
  loginError:      null as string | null,
  loginBusy:       false,
});

let probeGeneration = 0;

export function startProbe() {
  const gen = ++probeGeneration;
  boot.failed          = false;
  boot.loginRequired   = false;
  boot.unsupportedMode = false;
  let tries = 0;

  async function probe() {
    if (gen !== probeGeneration) return;
    tries++;
    const result = await probeServer();
    if (gen !== probeGeneration) return;

    if (result === "ok") {
      boot.serverProbeOk = true;
      boot.loginRequired = false;
      trackingState.bootSync().catch(() => {});
      return;
    }

    if (result === "auth_required") {
      boot.serverProbeOk = true;
      const savedUser = store.settings.serverAuthUser?.trim() ?? "";
      const savedPass = store.settings.serverAuthPass?.trim() ?? "";
      if (savedUser && savedPass) {
        try {
          await loginBasic(savedUser, savedPass);
          boot.loginRequired = false;
          trackingState.bootSync().catch(() => {});
          return;
        } catch {}
      }
      boot.loginRequired = true;
      boot.loginUser     = store.settings.serverAuthUser ?? "";
      return;
    }

    if (result === "unsupported_mode") {
      boot.serverProbeOk   = true;
      boot.unsupportedMode = true;
      return;
    }

    if (tries >= MAX_ATTEMPTS) { boot.failed = true; return; }
    const delay = Math.min(750 + tries * 250, 3000);
    setTimeout(probe, delay);
  }

  setTimeout(probe, 2000);
}

export function stopProbe() {
  probeGeneration++;
}

export async function submitLogin(onSuccess: () => void) {
  if (!boot.loginUser.trim() || !boot.loginPass.trim()) {
    boot.loginError = "Username and password are required";
    return;
  }
  boot.loginBusy  = true;
  boot.loginError = null;
  try {
    await loginBasic(boot.loginUser.trim(), boot.loginPass.trim());
    boot.loginRequired = false;
    boot.loginPass     = "";
    boot.loginError    = null;
    trackingState.bootSync().catch(() => {});
    onSuccess();
  } catch (e: any) {
    boot.loginError = e?.message ?? "Login failed";
  } finally {
    boot.loginBusy = false;
  }
}

export function retryBoot() {
  boot.serverProbeOk   = false;
  boot.failed          = false;
  boot.notConfigured   = false;
  boot.loginRequired   = false;
  boot.unsupportedMode = false;
  startProbe();
}

export function bypassBoot(onReady: () => void) {
  probeGeneration++;
  boot.serverProbeOk   = true;
  boot.loginRequired   = false;
  boot.unsupportedMode = false;
  onReady();
}