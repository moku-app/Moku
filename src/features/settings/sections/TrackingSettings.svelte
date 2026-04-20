<script lang="ts">
  import { gql, thumbUrl } from "@api/client";
  import { GET_TRACKERS } from "@api/queries/tracking";
  import { LOGIN_TRACKER_OAUTH, LOGIN_TRACKER_CREDENTIALS, LOGOUT_TRACKER } from "@api/mutations/tracking";
  import { open as openUrl } from "@tauri-apps/plugin-shell";
  import type { Tracker } from "../../lib/types";

  let trackers        = $state<Tracker[]>([]);
  let trackersLoading = $state(false);
  let trackersError   = $state<string | null>(null);
  let oauthTrackerId  = $state<number | null>(null);
  let oauthCallbackInput = $state("");
  let oauthSubmitting = $state(false);
  let credsTrackerId  = $state<number | null>(null);
  let credsUsername   = $state("");
  let credsPassword   = $state("");
  let credsSubmitting = $state(false);
  let loggingOut      = $state<number | null>(null);

  $effect(() => {
    if (trackers.length === 0 && !trackersLoading) loadTrackers();
  });

  async function loadTrackers() {
    trackersLoading = true; trackersError = null;
    try {
      const res = await gql<{ trackers: { nodes: Tracker[] } }>(GET_TRACKERS);
      trackers = res.trackers.nodes;
    } catch (e: any) {
      trackersError = e?.message ?? "Failed to load trackers";
    } finally { trackersLoading = false; }
  }

  async function startOAuth(tracker: Tracker) {
    if (!tracker.authUrl) return;
    oauthTrackerId = tracker.id; oauthCallbackInput = "";
    await openUrl(tracker.authUrl);
  }

  async function submitOAuth() {
    if (!oauthTrackerId || !oauthCallbackInput.trim()) return;
    oauthSubmitting = true;
    try {
      await gql(LOGIN_TRACKER_OAUTH, { trackerId: oauthTrackerId, callbackUrl: oauthCallbackInput.trim() });
      await loadTrackers();
      oauthTrackerId = null; oauthCallbackInput = "";
    } catch (e: any) {
      trackersError = e?.message ?? "Login failed";
    } finally { oauthSubmitting = false; }
  }

  function cancelOAuth() { oauthTrackerId = null; oauthCallbackInput = ""; }

  function startCredentials(tracker: Tracker) { credsTrackerId = tracker.id; credsUsername = ""; credsPassword = ""; }

  async function submitCredentials() {
    if (!credsTrackerId || !credsUsername.trim() || !credsPassword.trim()) return;
    credsSubmitting = true;
    try {
      await gql(LOGIN_TRACKER_CREDENTIALS, { trackerId: credsTrackerId, username: credsUsername.trim(), password: credsPassword.trim() });
      await loadTrackers();
      credsTrackerId = null; credsUsername = ""; credsPassword = "";
    } catch (e: any) {
      trackersError = e?.message ?? "Login failed";
    } finally { credsSubmitting = false; }
  }

  function cancelCredentials() { credsTrackerId = null; credsUsername = ""; credsPassword = ""; }

  async function logoutTracker(trackerId: number) {
    loggingOut = trackerId;
    try {
      await gql(LOGOUT_TRACKER, { trackerId });
      await loadTrackers();
    } catch (e: any) {
      trackersError = e?.message ?? "Logout failed";
    } finally { loggingOut = null; }
  }

  function focusEl(node: HTMLElement) { setTimeout(() => node.focus(), 0); }
</script>

<div class="s-panel">

  <div class="s-section">
    <p class="s-section-title">Connected Trackers</p>
    <div class="s-section-body">
      {#if trackersError}
        <div class="s-banner s-banner-error">{trackersError}</div>
      {/if}
      {#if trackersLoading}
        <p class="s-empty">Loading trackers…</p>
      {:else}
        {#each trackers as tracker}
          <div class="s-tracker-row" class:expanded={oauthTrackerId === tracker.id || credsTrackerId === tracker.id}>
            <div class="s-tracker-identity">
              <img src={thumbUrl(tracker.icon)} alt={tracker.name} class="s-tracker-logo" />
              <div class="s-row-info">
                <span class="s-label">{tracker.name}</span>
                <span class="s-pill" class:on={tracker.isLoggedIn}>
                  {tracker.isLoggedIn ? "Connected" : "Not connected"}
                </span>
              </div>
            </div>
            <div class="s-tracker-action">
              {#if tracker.isLoggedIn}
                <button class="s-btn s-btn-danger" onclick={() => logoutTracker(tracker.id)} disabled={loggingOut === tracker.id}>
                  {loggingOut === tracker.id ? "Disconnecting…" : "Disconnect"}
                </button>
              {:else if oauthTrackerId !== tracker.id && credsTrackerId !== tracker.id}
                <button class="s-btn" onclick={() => tracker.authUrl ? startOAuth(tracker) : startCredentials(tracker)}>
                  {tracker.authUrl ? "Connect via browser →" : "Connect"}
                </button>
              {/if}
            </div>
            {#if oauthTrackerId === tracker.id}
              <div class="s-tracker-expand">
                <p class="s-oauth-hint">Browser opened {tracker.name} login — authorise then paste the callback URL below.</p>
                <input class="s-input full" placeholder="https://suwayomi.org/tracker-oauth#access_token=…"
                  bind:value={oauthCallbackInput}
                  onkeydown={(e) => { if (e.key === "Enter") submitOAuth(); if (e.key === "Escape") cancelOAuth(); }}
                  use:focusEl />
                <div class="s-oauth-btns">
                  <button class="s-btn s-btn-accent" onclick={submitOAuth} disabled={oauthSubmitting || !oauthCallbackInput.trim()}>
                    {oauthSubmitting ? "Connecting…" : "Connect"}
                  </button>
                  <button class="s-btn" onclick={cancelOAuth}>Cancel</button>
                </div>
              </div>
            {/if}
            {#if credsTrackerId === tracker.id}
              <div class="s-tracker-expand">
                <input class="s-input full" placeholder="Username / Email" bind:value={credsUsername}
                  onkeydown={(e) => e.key === "Escape" && cancelCredentials()} use:focusEl />
                <input class="s-input full" type="password" placeholder="Password" bind:value={credsPassword}
                  onkeydown={(e) => { if (e.key === "Enter") submitCredentials(); if (e.key === "Escape") cancelCredentials(); }} />
                <div class="s-oauth-btns">
                  <button class="s-btn s-btn-accent" onclick={submitCredentials} disabled={credsSubmitting || !credsUsername.trim() || !credsPassword.trim()}>
                    {credsSubmitting ? "Connecting…" : "Connect"}
                  </button>
                  <button class="s-btn" onclick={cancelCredentials}>Cancel</button>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </div>

</div>