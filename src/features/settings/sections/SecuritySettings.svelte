<script lang="ts">
  import { store, updateSettings, addToast } from "@store/state.svelte";
  import { gql } from "@api/client";
  import { authSession } from "@core/auth";
  import { GET_SERVER_SECURITY } from "@api/queries/extensions";
  import { SET_SERVER_AUTH, SET_SOCKS_PROXY, SET_FLARESOLVERR } from "@api/mutations/extensions";

  interface Props { selectOpen: string | null; toggleSelect: (id: string) => void; }
  let { selectOpen, toggleSelect }: Props = $props();

  let showAuthPass  = $state(false);
  let showSocksPass = $state(false);
  let pinInput      = $state(store.settings.appLockPin ?? "");
  let pinError      = $state("");
  let secLoading    = $state(false);
  let secError      = $state<string | null>(null);
  let secSaved      = $state<string | null>(null);
  let secLoaded     = $state(false);

  let authMode     = $state(store.settings.serverAuthMode ?? "NONE");
  let authUsername = $state(store.settings.serverAuthUser ?? "");
  let authPassword = $state("");

  const authModeUnsupported = $derived(
    store.settings.serverAuthMode === "SIMPLE_LOGIN" ||
    store.settings.serverAuthMode === "UI_LOGIN"
  );

  let socksEnabled  = $state(store.settings.socksProxyEnabled ?? false);
  let socksHost     = $state(store.settings.socksProxyHost ?? "");
  let socksPort     = $state(store.settings.socksProxyPort ?? "1080");
  let socksVersion  = $state(store.settings.socksProxyVersion ?? 5);
  let socksUsername = $state(store.settings.socksProxyUsername ?? "");
  let socksPassword = $state(store.settings.socksProxyPassword ?? "");

  let flareEnabled  = $state(store.settings.flareSolverrEnabled ?? false);
  let flareUrl      = $state(store.settings.flareSolverrUrl ?? "http://localhost:8191");
  let flareTimeout  = $state(store.settings.flareSolverrTimeout ?? 60);
  let flareSession  = $state(store.settings.flareSolverrSessionName ?? "moku");
  let flareTtl      = $state(store.settings.flareSolverrSessionTtl ?? 15);
  let flareFallback = $state(store.settings.flareSolverrAsResponseFallback ?? false);

  function showSaved(key: string) {
    secSaved = key; secError = null;
    setTimeout(() => { if (secSaved === key) secSaved = null; }, 2000);
  }

  $effect(() => {
    if (!secLoaded) { secLoaded = true; loadServerSecurity(); }
  });

  async function loadServerSecurity() {
    try {
      const res = await gql<{ settings: {
        authMode: string; authUsername: string;
        socksProxyEnabled: boolean; socksProxyHost: string; socksProxyPort: string;
        socksProxyVersion: number; socksProxyUsername: string;
        flareSolverrEnabled: boolean; flareSolverrUrl: string; flareSolverrTimeout: number;
        flareSolverrSessionName: string; flareSolverrSessionTtl: number;
        flareSolverrAsResponseFallback: boolean;
      }}>(GET_SERVER_SECURITY);
      const s = res.settings;
      const mode = (s.authMode ?? "NONE") as "NONE" | "BASIC_AUTH" | "SIMPLE_LOGIN" | "UI_LOGIN";
      authMode = mode; authUsername = s.authUsername;
      updateSettings({ serverAuthMode: mode, serverAuthUser: s.authUsername });
      socksEnabled = s.socksProxyEnabled; socksHost = s.socksProxyHost;
      socksPort = s.socksProxyPort; socksVersion = s.socksProxyVersion;
      socksUsername = s.socksProxyUsername;
      flareEnabled = s.flareSolverrEnabled; flareUrl = s.flareSolverrUrl;
      flareTimeout = s.flareSolverrTimeout; flareSession = s.flareSolverrSessionName;
      flareTtl = s.flareSolverrSessionTtl; flareFallback = s.flareSolverrAsResponseFallback;
      updateSettings({
        socksProxyEnabled: socksEnabled, socksProxyHost: socksHost, socksProxyPort: socksPort,
        socksProxyVersion: socksVersion, socksProxyUsername: socksUsername,
        flareSolverrEnabled: flareEnabled, flareSolverrUrl: flareUrl,
        flareSolverrTimeout: flareTimeout, flareSolverrSessionName: flareSession,
        flareSolverrSessionTtl: flareTtl, flareSolverrAsResponseFallback: flareFallback,
      });
    } catch {}
  }

  async function saveAuth() {
    if (authMode === "BASIC_AUTH" && (!authUsername.trim() || !authPassword.trim())) {
      secError = "Username and password are required for Basic Auth"; return;
    }
    secLoading = true; secError = null;
    const prev = { mode: store.settings.serverAuthMode, user: store.settings.serverAuthUser, pass: store.settings.serverAuthPass };
    const newUser = authMode === "BASIC_AUTH" ? authUsername.trim() : "";
    const newPass = authMode === "BASIC_AUTH" ? authPassword.trim() : "";
    if (authMode === "BASIC_AUTH" && !prev.pass.trim())
      updateSettings({ serverAuthMode: authMode as any, serverAuthUser: newUser, serverAuthPass: newPass });
    try {
      await gql(SET_SERVER_AUTH, { authMode, authUsername: newUser, authPassword: newPass });
      updateSettings({ serverAuthMode: authMode as any, serverAuthUser: newUser, serverAuthPass: newPass });
      if (authMode === "NONE") { authSession.clearTokens(); authPassword = ""; }
      showSaved("auth");
    } catch (e: any) {
      updateSettings({ serverAuthMode: prev.mode, serverAuthUser: prev.user, serverAuthPass: prev.pass });
      secError = e?.message ?? "Failed to save authentication settings";
    } finally { secLoading = false; }
  }

  async function clearAuth() {
    secLoading = true; secError = null;
    const prev = { mode: store.settings.serverAuthMode, user: store.settings.serverAuthUser, pass: store.settings.serverAuthPass };
    try {
      await gql(SET_SERVER_AUTH, { authMode: "NONE", authUsername: "", authPassword: "" });
      updateSettings({ serverAuthMode: "NONE", serverAuthUser: "", serverAuthPass: "" });
      authMode = "NONE"; authUsername = ""; authPassword = "";
      authSession.clearTokens(); showSaved("auth");
    } catch (e: any) {
      updateSettings({ serverAuthMode: prev.mode, serverAuthUser: prev.user, serverAuthPass: prev.pass });
      secError = e?.message ?? "Failed to disable authentication";
    } finally { secLoading = false; }
  }

  async function saveSocksProxy() {
    secLoading = true; secError = null;
    try {
      await gql(SET_SOCKS_PROXY, {
        socksProxyEnabled: socksEnabled, socksProxyHost: socksHost.trim(),
        socksProxyPort: socksPort.trim(), socksProxyVersion: socksVersion,
        socksProxyUsername: socksUsername.trim(), socksProxyPassword: socksPassword.trim(),
      });
      updateSettings({
        socksProxyEnabled: socksEnabled, socksProxyHost: socksHost,
        socksProxyPort: socksPort, socksProxyVersion: socksVersion,
        socksProxyUsername: socksUsername, socksProxyPassword: socksPassword,
      });
      showSaved("socks");
    } catch (e: any) {
      secError = e?.message ?? "Failed to save SOCKS proxy";
    } finally { secLoading = false; }
  }

  async function saveFlareSolverr() {
    secLoading = true; secError = null;
    try {
      await gql(SET_FLARESOLVERR, {
        flareSolverrEnabled: flareEnabled, flareSolverrUrl: flareUrl.trim(),
        flareSolverrTimeout: flareTimeout, flareSolverrSessionName: flareSession.trim(),
        flareSolverrSessionTtl: flareTtl, flareSolverrAsResponseFallback: flareFallback,
      });
      updateSettings({
        flareSolverrEnabled: flareEnabled, flareSolverrUrl: flareUrl,
        flareSolverrTimeout: flareTimeout, flareSolverrSessionName: flareSession,
        flareSolverrSessionTtl: flareTtl, flareSolverrAsResponseFallback: flareFallback,
      });
      showSaved("flare");
    } catch (e: any) {
      secError = e?.message ?? "Failed to save FlareSolverr";
    } finally { secLoading = false; }
  }

  function commitPin() {
    const cleaned = pinInput.replace(/\D/g, "").slice(0, 8);
    pinInput = cleaned;
    if (cleaned.length >= 4) { updateSettings({ appLockPin: cleaned }); pinError = ""; }
    else if (cleaned.length > 0) { pinError = "PIN must be at least 4 digits"; }
    else { updateSettings({ appLockPin: "" }); pinError = ""; }
  }

  const EyeOpen  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const EyeClose = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
</script>

<div class="s-panel">

  {#if secError}
    <div class="s-banner s-banner-error">{secError}</div>
  {/if}

  <div class="s-section">
    <p class="s-section-title">
      Server Authentication
      <span class="s-pill" class:on={store.settings.serverAuthMode === "BASIC_AUTH"} class:warn={authModeUnsupported}>
        {store.settings.serverAuthMode === "BASIC_AUTH"   ? "Basic Auth"                  :
         store.settings.serverAuthMode === "SIMPLE_LOGIN" ? "Simple Login — unsupported"  :
         store.settings.serverAuthMode === "UI_LOGIN"     ? "UI Login — unsupported"      : "Disabled"}
      </span>
    </p>
    <div class="s-section-body">
      {#if authModeUnsupported}
        <div class="s-banner s-banner-warn">
          <strong>{store.settings.serverAuthMode === "SIMPLE_LOGIN" ? "Simple Login" : "UI Login"}</strong> is not supported — only <strong>Basic Auth</strong> works here. Switch your server to <code>basic_auth</code> and set the mode to <strong>Basic</strong>.
        </div>
      {/if}
      <div class="s-row">
        <div class="s-row-info"><span class="s-label">Mode</span><span class="s-desc">How Suwayomi verifies requests</span></div>
        <div class="s-segment">
          {#each [{ value: "NONE", label: "None" }, { value: "BASIC_AUTH", label: "Basic" }] as opt}
            <button class="s-segment-btn" class:active={authMode === opt.value}
              onclick={() => authMode = opt.value as any} disabled={secLoading}>{opt.label}</button>
          {/each}
        </div>
      </div>
      {#if authMode !== "NONE"}
        <div class="s-row">
          <div class="s-row-info"><span class="s-label">Username</span></div>
          <input class="s-input" bind:value={authUsername} placeholder="Username" autocomplete="off" spellcheck="false" disabled={secLoading} />
        </div>
        <div class="s-row">
          <div class="s-row-info"><span class="s-label">Password</span></div>
          <div class="s-field-wrap">
            <input class="s-input" type={showAuthPass ? "text" : "password"} bind:value={authPassword} placeholder="Password" autocomplete="off" spellcheck="false" disabled={secLoading} />
            <button class="s-eye-btn" onclick={() => showAuthPass = !showAuthPass} tabindex="-1">{@html showAuthPass ? EyeClose : EyeOpen}</button>
          </div>
        </div>
      {/if}
      {#if store.settings.serverAuthMode === "BASIC_AUTH"}
        <div class="s-row">
          <span class="s-desc">Images are proxied through Tauri when Basic Auth is active, which reduces loading speed.</span>
        </div>
      {/if}
      <div class="s-row">
        <div class="s-row-info"></div>
        <div class="s-btn-row">
          {#if store.settings.serverAuthMode !== "NONE"}
            <button class="s-btn s-btn-danger" onclick={clearAuth} disabled={secLoading}>
              {secLoading ? "Saving…" : "Disable"}
            </button>
          {/if}
          <button class="s-btn s-btn-accent" onclick={saveAuth}
            disabled={secLoading || (authMode === "BASIC_AUTH" && (!authUsername.trim() || !authPassword.trim()))}>
            {secLoading ? "Saving…" : secSaved === "auth" ? "Saved ✓" : store.settings.serverAuthMode === "BASIC_AUTH" ? "Update" : authMode === "NONE" ? "Save" : "Enable"}
          </button>
        </div>
      </div>
    </div>
  </div>

  <div class="s-section">
    <p class="s-section-title">App Lock</p>
    <div class="s-section-body">
      <label class="s-row">
        <div class="s-row-info"><span class="s-label">PIN lock</span><span class="s-desc">Require a PIN on launch and after idle timeout</span></div>
        <button role="switch" aria-checked={store.settings.appLockEnabled ?? false} class="s-toggle" class:on={store.settings.appLockEnabled}
          onclick={() => updateSettings({ appLockEnabled: !store.settings.appLockEnabled })}><span class="s-toggle-thumb"></span></button>
      </label>
      {#if store.settings.appLockEnabled}
        <div class="s-row">
          <div class="s-row-info"><span class="s-label">PIN</span><span class="s-desc">4–8 digits</span></div>
          <div class="s-btn-row">
            <input class="s-input" type="password" inputmode="numeric" maxlength={8} placeholder="4–8 digits"
              value={pinInput}
              oninput={(e) => { pinInput = e.currentTarget.value.replace(/\D/g, "").slice(0, 8); pinError = ""; }}
              onkeydown={(e) => e.key === "Enter" && commitPin()}
              autocomplete="off" style="width:120px;letter-spacing:0.2em" />
            <button class="s-btn s-btn-accent" onclick={commitPin} disabled={pinInput.length > 0 && pinInput.length < 4}>
              {store.settings.appLockPin && pinInput === store.settings.appLockPin ? "Saved ✓" : "Save"}
            </button>
          </div>
        </div>
        {#if pinError}<div class="s-row"><span class="s-pin-error">{pinError}</span></div>{/if}
      {/if}
    </div>
  </div>

  <div class="s-section">
    <p class="s-section-title">SOCKS Proxy</p>
    <div class="s-section-body">
      <label class="s-row">
        <div class="s-row-info"><span class="s-label">Enable SOCKS proxy</span><span class="s-desc">Route Suwayomi traffic through a SOCKS4/5 proxy</span></div>
        <button role="switch" aria-checked={socksEnabled} class="s-toggle" class:on={socksEnabled}
          onclick={() => { socksEnabled = !socksEnabled; saveSocksProxy(); }}><span class="s-toggle-thumb"></span></button>
      </label>
      {#if socksEnabled}
        <div class="s-row">
          <div class="s-row-info"><span class="s-label">Version</span></div>
          <div class="s-select" id="socks-ver">
            <button class="s-select-btn" onclick={() => toggleSelect("socks-ver")}>
              <span>SOCKS{socksVersion}</span>
              <svg class="s-select-caret" class:open={selectOpen === "socks-ver"} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
            </button>
            {#if selectOpen === "socks-ver"}
              <div class="s-select-menu">
                {#each [[4,"SOCKS4"],[5,"SOCKS5"]] as [v, l]}
                  <button class="s-select-option" class:active={socksVersion === v} onclick={() => { socksVersion = v as number; toggleSelect("socks-ver"); }}>{l}</button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
        <div class="s-row">
          <div class="s-row-info"><span class="s-label">Host</span></div>
          <input class="s-input" bind:value={socksHost} placeholder="127.0.0.1" autocomplete="off" spellcheck="false" />
        </div>
        <div class="s-row">
          <div class="s-row-info"><span class="s-label">Port</span></div>
          <input class="s-input" style="width:80px" bind:value={socksPort} placeholder="1080" autocomplete="off" spellcheck="false" />
        </div>
        <div class="s-row">
          <div class="s-row-info"><span class="s-label">Username</span><span class="s-desc">Optional</span></div>
          <input class="s-input" bind:value={socksUsername} placeholder="Username" autocomplete="off" spellcheck="false" />
        </div>
        <div class="s-row">
          <div class="s-row-info"><span class="s-label">Password</span><span class="s-desc">Optional</span></div>
          <div class="s-field-wrap">
            <input class="s-input" type={showSocksPass ? "text" : "password"} bind:value={socksPassword} placeholder="Password" autocomplete="off" spellcheck="false" />
            <button class="s-eye-btn" onclick={() => showSocksPass = !showSocksPass} tabindex="-1">{@html showSocksPass ? EyeClose : EyeOpen}</button>
          </div>
        </div>
        <div class="s-row">
          <div class="s-row-info"></div>
          <button class="s-btn s-btn-accent" onclick={saveSocksProxy} disabled={secLoading}>
            {secLoading ? "Saving…" : secSaved === "socks" ? "Saved ✓" : "Save"}
          </button>
        </div>
      {/if}
    </div>
  </div>

  <div class="s-section">
    <p class="s-section-title">FlareSolverr</p>
    <div class="s-section-body">
      <label class="s-row">
        <div class="s-row-info"><span class="s-label">Enable FlareSolverr</span><span class="s-desc">Bypass Cloudflare challenges for sources that require it</span></div>
        <button role="switch" aria-checked={flareEnabled} class="s-toggle" class:on={flareEnabled}
          onclick={() => { flareEnabled = !flareEnabled; saveFlareSolverr(); }}><span class="s-toggle-thumb"></span></button>
      </label>
      {#if flareEnabled}
        <div class="s-row">
          <div class="s-row-info"><span class="s-label">URL</span><span class="s-desc">FlareSolverr instance address</span></div>
          <input class="s-input" bind:value={flareUrl} placeholder="http://localhost:8191" autocomplete="off" spellcheck="false" />
        </div>
        <div class="s-row">
          <div class="s-row-info"><span class="s-label">Timeout</span><span class="s-desc">Max wait per request, in seconds</span></div>
          <div class="s-stepper">
            <button class="s-step-btn" onclick={() => flareTimeout = Math.max(10, flareTimeout - 10)}>−</button>
            <span class="s-step-val">{flareTimeout}s</span>
            <button class="s-step-btn" onclick={() => flareTimeout = Math.min(300, flareTimeout + 10)}>+</button>
          </div>
        </div>
        <div class="s-row">
          <div class="s-row-info"><span class="s-label">Session name</span><span class="s-desc">Reuse browser session across requests</span></div>
          <input class="s-input" bind:value={flareSession} placeholder="moku" autocomplete="off" spellcheck="false" />
        </div>
        <div class="s-row">
          <div class="s-row-info"><span class="s-label">Session TTL</span><span class="s-desc">Minutes before session is refreshed</span></div>
          <div class="s-stepper">
            <button class="s-step-btn" onclick={() => flareTtl = Math.max(1, flareTtl - 1)}>−</button>
            <span class="s-step-val">{flareTtl}m</span>
            <button class="s-step-btn" onclick={() => flareTtl = Math.min(60, flareTtl + 1)}>+</button>
          </div>
        </div>
        <label class="s-row">
          <div class="s-row-info"><span class="s-label">Response fallback</span><span class="s-desc">Use FlareSolverr's response when the direct request fails</span></div>
          <button role="switch" aria-checked={flareFallback} class="s-toggle" class:on={flareFallback}
            onclick={() => flareFallback = !flareFallback}><span class="s-toggle-thumb"></span></button>
        </label>
        <div class="s-row">
          <div class="s-row-info"></div>
          <button class="s-btn s-btn-accent" onclick={saveFlareSolverr} disabled={secLoading}>
            {secLoading ? "Saving…" : secSaved === "flare" ? "Saved ✓" : "Save"}
          </button>
        </div>
      {/if}
    </div>
  </div>

</div>