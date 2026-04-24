<script lang="ts">
  import { Trash, ClockCounterClockwise } from "phosphor-svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { gql } from "@api/client";
  import { GET_DOWNLOADS_PATH, GET_RESTORE_STATUS, VALIDATE_BACKUP } from "@api/queries/manga";
  import { CREATE_BACKUP, RESTORE_BACKUP } from "@api/mutations/manga";
  import { SET_DOWNLOADS_PATH, SET_LOCAL_SOURCE_PATH } from "@api/mutations/downloads";
  import { untrack } from "svelte";
  import { store, updateSettings, addToast } from "@store/state.svelte";
  import { exportAppData, importAppData } from "@core/backup";

  interface StorageInfo { manga_bytes: number; total_bytes: number; free_bytes: number; path: string; }

  const isExternalServer = $derived.by(() => {
    const url = (store.settings.serverUrl ?? "http://localhost:4567").toLowerCase().trim();
    try {
      const host = new URL(url).hostname;
      return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
    } catch { return false; }
  });

  let storageInfo        = $state<StorageInfo | null>(null);
  let storageLoading     = $state(false);
  let storageError       = $state<string | null>(null);

  let downloadsPathInput   = $state(store.settings.serverDownloadsPath ?? "");
  let localSourcePathInput = $state(store.settings.serverLocalSourcePath ?? "");
  let pathsSaving          = $state(false);
  let pathsError           = $state<string | null>(null);
  let pathsFieldError      = $state<{ dl?: string; loc?: string }>({});
  let pathsSaved           = $state(false);

  let defaultDownloadsPath = $state("");
  $effect(() => {
    if (!isExternalServer) {
      invoke<string>("get_default_downloads_path").then(p => { defaultDownloadsPath = p; });
    } else {
      defaultDownloadsPath = "";
    }
  });

  let confirmedDownloadsPath   = $state(store.settings.serverDownloadsPath ?? "");
  let confirmedLocalSourcePath = $state(store.settings.serverLocalSourcePath ?? "");

  let migrateFrom      = $state<string | null>(null);
  let migrateTo        = $state<string | null>(null);
  let migrating        = $state(false);
  let migrateProgress  = $state<{ done: number; total: number; current: string } | null>(null);
  let migrateError     = $state<string | null>(null);
  let migrateUnlisten: (() => void) | null = null;

  let extraScanDirs    = $state<string[]>([...(store.settings.extraScanDirs ?? [])]);
  let newScanDir       = $state("");
  let multiStorageInfos = $state<(StorageInfo & { label: string })[]>([]);
  let advStorageOpen      = $state(false);
  let backupSectionOpen   = $state(false);
  let appDataSectionOpen  = $state(false);

  async function fetchStorage() {
    storageLoading = true; storageError = null;
    try {
      const pathData = await gql<{ settings: { downloadsPath: string; localSourcePath: string } }>(GET_DOWNLOADS_PATH);
      const dl  = pathData.settings.downloadsPath  ?? "";
      const loc = pathData.settings.localSourcePath ?? "";
      downloadsPathInput = dl; localSourcePathInput = loc;
      confirmedDownloadsPath = dl; confirmedLocalSourcePath = loc;
      updateSettings({ serverDownloadsPath: dl, serverLocalSourcePath: loc });
      if (isExternalServer) { multiStorageInfos = []; storageInfo = null; return; }
      const effectiveDl = dl || defaultDownloadsPath;
      const dirsToScan: { path: string; label: string }[] = [];
      if (effectiveDl) dirsToScan.push({ path: effectiveDl, label: dl ? "Downloads" : "Downloads (default)" });
      if (loc && loc !== effectiveDl) dirsToScan.push({ path: loc, label: "Local source" });
      for (const p of extraScanDirs) {
        if (p && !dirsToScan.find(d => d.path === p)) dirsToScan.push({ path: p, label: p });
      }
      if (dirsToScan.length === 0) { multiStorageInfos = []; storageInfo = null; return; }
      const results = await Promise.allSettled(
        dirsToScan.map(d => invoke<StorageInfo>("get_storage_info", { downloadsPath: d.path }).then(info => ({ ...info, label: d.label })))
      );
      multiStorageInfos = results
        .filter((r): r is PromiseFulfilledResult<StorageInfo & { label: string }> => r.status === "fulfilled")
        .map(r => r.value);
      storageInfo = multiStorageInfos[0] ?? null;
    } catch (e: any) {
      storageError = e instanceof Error ? e.message : String(e);
    } finally { storageLoading = false; }
  }

  async function validatePath(path: string): Promise<string | null> {
    if (!path.trim()) return null;
    if (isExternalServer) return null;
    try {
      const exists = await invoke<boolean>("check_path_exists", { path: path.trim() });
      return exists ? null : "Directory does not exist";
    } catch { return "Could not check path"; }
  }

  async function createDirectory(path: string): Promise<void> {
    if (isExternalServer) throw new Error("Cannot create directories on an external server");
    await invoke("create_directory", { path });
  }

  async function savePaths() {
    const dl  = downloadsPathInput.trim();
    const loc = localSourcePathInput.trim();
    pathsError = null; pathsFieldError = {};
    const [dlErr, locErr] = await Promise.all([validatePath(dl), validatePath(loc)]);
    if (dlErr || locErr) { pathsFieldError = { ...(dlErr ? { dl: dlErr } : {}), ...(locErr ? { loc: locErr } : {}) }; return; }
    pathsSaving = true;
    try {
      await gql(SET_DOWNLOADS_PATH, { path: dl });
      if (loc) await gql(SET_LOCAL_SOURCE_PATH, { path: loc });
      updateSettings({ serverDownloadsPath: dl, serverLocalSourcePath: loc });
      if (!isExternalServer) {
        const oldDl = confirmedDownloadsPath || defaultDownloadsPath;
        const newDl = dl || defaultDownloadsPath;
        if (newDl && oldDl && newDl !== oldDl) {
          const hadContent = await invoke<boolean>("check_path_exists", { path: oldDl });
          if (hadContent) { migrateFrom = oldDl; migrateTo = newDl; }
        }
      }
      confirmedDownloadsPath = dl; confirmedLocalSourcePath = loc;
      pathsSaved = true; setTimeout(() => pathsSaved = false, 2000);
      await fetchStorage();
    } catch (e: any) {
      pathsError = e?.message ?? "Failed to save paths";
    } finally { pathsSaving = false; }
  }

  async function startMigration() {
    if (!migrateFrom || !migrateTo) return;
    migrating = true; migrateError = null; migrateProgress = { done: 0, total: 0, current: "" };
    const { listen: tauriListen } = await import("@tauri-apps/api/event");
    migrateUnlisten = await tauriListen<{ done: number; total: number; current: string }>(
      "migrate_progress", (e) => { migrateProgress = e.payload; }
    );
    try {
      await invoke("migrate_downloads", { src: migrateFrom, dst: migrateTo });
      migrateFrom = null; migrateTo = null; migrateProgress = null;
      await fetchStorage();
    } catch (e: any) {
      migrateError = e?.message ?? "Migration failed";
    } finally { migrating = false; migrateUnlisten?.(); migrateUnlisten = null; }
  }

  function dismissMigration() { migrateFrom = null; migrateTo = null; migrateError = null; migrateProgress = null; }

  async function browseDownloadsFolder() {
    const picked = await invoke<string | null>("pick_downloads_folder");
    if (picked) { downloadsPathInput = picked; pathsFieldError = { ...pathsFieldError, dl: undefined }; await savePaths(); }
  }

  async function browseLocalSourceFolder() {
    const picked = await invoke<string | null>("pick_downloads_folder");
    if (picked) { localSourcePathInput = picked; pathsFieldError = { ...pathsFieldError, loc: undefined }; await savePaths(); }
  }

  async function browseExtraScanDir() {
    const picked = await invoke<string | null>("pick_downloads_folder");
    if (picked) { newScanDir = picked; addExtraScanDir(); }
  }

  function addExtraScanDir() {
    const dir = newScanDir.trim();
    if (!dir || extraScanDirs.includes(dir)) return;
    extraScanDirs = [...extraScanDirs, dir];
    updateSettings({ extraScanDirs }); newScanDir = ""; fetchStorage();
  }

  function removeExtraScanDir(path: string) {
    extraScanDirs = extraScanDirs.filter(d => d !== path);
    updateSettings({ extraScanDirs }); fetchStorage();
  }

  function fmtBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const units = ["B","KB","MB","GB","TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
  }

  let backupLoading  = $state(false);
  let backupError    = $state<string | null>(null);
  let backupList     = $state<{ url: string; name: string; deleting?: boolean }[]>([]);

  function loadBackupList() {
    try { backupList = JSON.parse(localStorage.getItem("moku_backups") ?? "[]"); } catch { backupList = []; }
  }
  function saveBackupList() {
    try { localStorage.setItem("moku_backups", JSON.stringify(backupList)); } catch {}
  }

  async function createBackup() {
    backupLoading = true; backupError = null;
    try {
      const res = await gql<{ createBackup: { url: string } }>(CREATE_BACKUP);
      const url = res.createBackup.url;
      const name = url.split("/").pop() ?? url;
      backupList = [{ url, name }, ...backupList]; saveBackupList();
    } catch (e: any) { backupError = e?.message ?? "Failed to create backup"; }
    finally { backupLoading = false; }
  }

  async function deleteBackup(url: string) {
    backupList = backupList.map(b => b.url === url ? { ...b, deleting: true } : b);
    try {
      const serverUrl = (store.settings.serverUrl ?? "http://localhost:4567").replace(/\/$/, "");
      const headers: Record<string, string> = {};
      const pass = store.settings.serverAuthPass ?? "", user = store.settings.serverAuthUser ?? "";
      if (store.settings.serverAuthMode === "BASIC_AUTH" && user && pass)
        headers["Authorization"] = "Basic " + btoa(`${user}:${pass}`);
      await fetch(`${serverUrl}${url}`, { method: "DELETE", headers });
      backupList = backupList.filter(b => b.url !== url); saveBackupList();
    } catch (e: any) {
      backupList = backupList.map(b => b.url === url ? { ...b, deleting: false } : b);
      backupError = (e as any)?.message ?? "Failed to delete backup";
    }
  }

  async function downloadBackup(backup: { url: string; name: string }) {
    try {
      const serverUrl = (store.settings.serverUrl ?? "http://localhost:4567").replace(/\/$/, "");
      const headers: Record<string, string> = {};
      const pass = store.settings.serverAuthPass ?? "", user = store.settings.serverAuthUser ?? "";
      if (store.settings.serverAuthMode === "BASIC_AUTH" && user && pass)
        headers["Authorization"] = "Basic " + btoa(`${user}:${pass}`);
      const resp = await fetch(`${serverUrl}${backup.url}`, { headers });
      if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
      const blob = await resp.blob();
      if ("showSaveFilePicker" in window) {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: backup.name,
            types: [{ description: "Backup file", accept: { "application/octet-stream": [".tachibk", ".proto.gz"] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(blob); await writable.close();
          addToast({ kind: "success", title: "Backup saved", body: backup.name }); return;
        } catch (pickerErr: any) { if (pickerErr?.name === "AbortError") return; }
      }
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl; a.download = backup.name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
      addToast({ kind: "download", title: "Backup downloaded", body: backup.name });
    } catch (e: any) { backupError = e?.message ?? "Failed to download backup"; }
  }

  let restoreLoading      = $state(false);
  let restoreError        = $state<string | null>(null);
  let restoreJobId        = $state<string | null>(null);
  let restoreStatus       = $state<{ mangaProgress: number; state: string; totalManga: number } | null>(null);
  let restorePollInterval = $state<ReturnType<typeof setInterval> | null>(null);
  let validateLoading     = $state(false);
  let validateError       = $state<string | null>(null);
  let validateResult      = $state<{ missingSources: { id: string; name: string }[]; missingTrackers: { name: string }[] } | null>(null);
  let restoreFile         = $state<File | null>(null);

  function stopRestorePoll() {
    if (restorePollInterval) { clearInterval(restorePollInterval); restorePollInterval = null; }
  }

  async function pollRestoreStatus(id: string) {
    try {
      const res = await gql<{ restoreStatus: typeof restoreStatus }>(GET_RESTORE_STATUS, { id });
      restoreStatus = res.restoreStatus;
      if (res.restoreStatus?.state === "SUCCESS" || res.restoreStatus?.state === "FAILURE") stopRestorePoll();
    } catch {}
  }

  function buildBackupFormData(file: File, query: string, variables: Record<string, unknown>) {
    const form = new FormData();
    form.append("operations", JSON.stringify({ query, variables }));
    form.append("map", JSON.stringify({ "0": ["variables.backup"] }));
    form.append("0", file, file.name);
    return form;
  }

  function buildAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "Accept": "application/json" };
    const pass = store.settings.serverAuthPass ?? "", user = store.settings.serverAuthUser ?? "";
    if (store.settings.serverAuthMode === "BASIC_AUTH" && user && pass)
      headers["Authorization"] = "Basic " + btoa(`${user}:${pass}`);
    return headers;
  }

  async function submitRestore() {
    if (!restoreFile) return;
    restoreLoading = true; restoreError = null; restoreStatus = null; restoreJobId = null;
    stopRestorePoll();
    try {
      const serverUrl = (store.settings.serverUrl ?? "http://localhost:4567").replace(/\/$/, "");
      const form = buildBackupFormData(
        restoreFile,
        `mutation RestoreBackup($backup: Upload!) { restoreBackup(input: { backup: $backup }) { id status { mangaProgress state totalManga } } }`,
        { backup: null }
      );
      const resp = await fetch(`${serverUrl}/api/graphql`, { method: "POST", headers: buildAuthHeaders(), body: form });
      const json = await resp.json();
      if (json.errors?.length) throw new Error(json.errors[0].message);
      const result = json.data.restoreBackup;
      restoreJobId = result.id; restoreStatus = result.status;
      if (result.status?.state !== "SUCCESS" && result.status?.state !== "FAILURE")
        restorePollInterval = setInterval(() => pollRestoreStatus(result.id), 1500);
    } catch (e: any) { restoreError = e?.message ?? "Failed to start restore"; }
    finally { restoreLoading = false; }
  }

  async function submitValidate() {
    if (!restoreFile) return;
    validateLoading = true; validateError = null; validateResult = null;
    try {
      const serverUrl = (store.settings.serverUrl ?? "http://localhost:4567").replace(/\/$/, "");
      const form = buildBackupFormData(
        restoreFile,
        `query ValidateBackup($backup: Upload!) { validateBackup(input: { backup: $backup }) { missingSources { id name } missingTrackers { name } } }`,
        { backup: null }
      );
      const resp = await fetch(`${serverUrl}/api/graphql`, { method: "POST", headers: buildAuthHeaders(), body: form });
      const json = await resp.json();
      if (json.errors?.length) throw new Error(json.errors[0].message);
      validateResult = json.data.validateBackup;
    } catch (e: any) { validateError = e?.message ?? "Failed to validate backup"; }
    finally { validateLoading = false; }
  }

  let appDataExporting  = $state(false);
  let appDataImporting  = $state(false);
  let appDataError      = $state<string | null>(null);
  let appDataMsg        = $state<string | null>(null);
  let appDataBackupDir  = $state<string | null>(null);

  $effect(() => {
    invoke<string>("get_auto_backup_dir").then(d => { appDataBackupDir = d; }).catch(() => {});
  });

  async function handleExportAppData() {
    appDataExporting = true; appDataError = null; appDataMsg = null;
    try {
      await exportAppData();
      appDataMsg = "Backup saved.";
      setTimeout(() => appDataMsg = null, 3000);
    } catch (e: any) {
      if (String(e).includes("Cancelled")) return;
      appDataError = e?.message ?? String(e);
    } finally { appDataExporting = false; }
  }

  async function handleImportAppData() {
    appDataImporting = true; appDataError = null; appDataMsg = null;
    try {
      await importAppData();
    } catch (e: any) {
      if (String(e).includes("Cancelled")) { appDataImporting = false; return; }
      appDataError = e?.message ?? String(e);
      appDataImporting = false;
    }
  }

  $effect(() => { untrack(() => { loadBackupList(); fetchStorage(); }); });
  $effect(() => { return () => stopRestorePoll(); });
</script>

<div class="s-panel">

  {#if migrateFrom && !isExternalServer}
    <div class="s-migrate-banner">
      <div class="s-migrate-body">
        <span class="s-migrate-title">Manga found at previous path — move to new location?</span>
        <span class="s-migrate-paths">{migrateFrom} → {migrateTo}</span>
        {#if migrateProgress && migrateProgress.total > 0}
          <div class="s-migrate-bar"><div class="s-migrate-fill" style="width:{Math.round((migrateProgress.done/migrateProgress.total)*100)}%"></div></div>
          <span class="s-migrate-paths">{migrateProgress.current} · {migrateProgress.done} / {migrateProgress.total}</span>
        {/if}
        {#if migrateError}<span class="s-desc" style="color:var(--color-error)">{migrateError}</span>{/if}
      </div>
      <div class="s-migrate-actions">
        <button class="s-btn s-btn-accent" onclick={startMigration} disabled={migrating}>
          {migrating ? (migrateProgress ? `Moving… ${migrateProgress.done}/${migrateProgress.total}` : "Starting…") : "Move files"}
        </button>
        <button class="s-btn" onclick={dismissMigration} disabled={migrating}>Skip</button>
      </div>
    </div>
  {/if}

  <div class="s-section">
    <p class="s-section-title">
      Disk Usage
      <button class="s-btn" onclick={fetchStorage} disabled={storageLoading}>{storageLoading ? "…" : "↻"}</button>
    </p>
    <div class="s-section-body">
      {#if storageLoading}
        <p class="s-empty">Reading filesystem…</p>
      {:else if storageError}
        <p class="s-empty" style="color:var(--color-error)">{storageError}</p>
      {:else if isExternalServer}
        <p class="s-empty">Disk usage is unavailable for external servers — filesystem access requires a local connection.</p>
      {:else if multiStorageInfos.length > 0}
        {#each multiStorageInfos as info}
          {@const limitGb    = store.settings.storageLimitGb ?? null}
          {@const limitBytes = limitGb !== null ? limitGb * 1024 ** 3 : null}
          {@const available  = info.manga_bytes + info.free_bytes}
          {@const cap        = limitBytes !== null ? Math.min(limitBytes, available) : available}
          {@const pct        = cap > 0 ? Math.min(100, (info.manga_bytes / cap) * 100) : 0}
          <div class="s-storage-wrap">
            <div class="s-storage-header">
              <span class="s-storage-label">{info.label}</span>
              <span class="s-storage-used">{fmtBytes(info.manga_bytes)} of {fmtBytes(cap)}</span>
            </div>
            <div class="s-storage-bar">
              <div class="s-storage-fill" class:critical={pct > 90} class:warn={pct > 75 && pct <= 90} style="width:{pct}%"></div>
            </div>
            <div class="s-storage-footer">
              <span>{info.path}</span>
              <span>{fmtBytes(info.free_bytes)} free</span>
            </div>
          </div>
        {/each}
      {:else}
        <p class="s-empty">No download path configured.</p>
      {/if}
    </div>
  </div>

  <div class="s-section">
    <p class="s-section-title">Downloads Path</p>
    <div class="s-section-body">
      {#if isExternalServer}
        <div class="s-row">
          <span class="s-desc">Connected to an external server. The path below is read from the server — changes here will update the server's config directly.</span>
        </div>
      {/if}
      <div class="s-row" style="gap:var(--sp-2)">
        <input class="s-input full" class:error={!!pathsFieldError.dl}
          bind:value={downloadsPathInput}
          placeholder={isExternalServer ? "Server default" : (defaultDownloadsPath || "Default location")}
          spellcheck="false"
          onkeydown={(e) => e.key === "Enter" && savePaths()}
          oninput={() => { pathsFieldError = { ...pathsFieldError, dl: undefined }; }} />
        {#if !isExternalServer}
          <button class="s-btn" onclick={browseDownloadsFolder}>Browse</button>
        {/if}
      </div>
      <div class="s-row">
        <div class="s-row-info">
          {#if pathsFieldError.dl}
            <span class="s-desc" style="color:var(--color-error)">{pathsFieldError.dl}</span>
          {/if}
          {#if pathsError}
            <span class="s-desc" style="color:var(--color-error)">{pathsError}</span>
          {/if}
        </div>
        <div class="s-btn-row">
          {#if pathsFieldError.dl && !isExternalServer}
            <button class="s-btn" onclick={async () => {
              try { await createDirectory(downloadsPathInput.trim()); pathsFieldError = { ...pathsFieldError, dl: undefined }; }
              catch (e: any) { pathsFieldError = { ...pathsFieldError, dl: e?.message ?? "Failed" }; }
            }}>Create</button>
          {/if}
          {#if downloadsPathInput.trim() !== confirmedDownloadsPath}
            <button class="s-btn s-btn-accent" onclick={savePaths} disabled={pathsSaving}>
              {pathsSaved ? "Saved ✓" : pathsSaving ? "Saving…" : "Save"}
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <div class="s-section">
    <p class="s-section-title">Storage Limit</p>
    <div class="s-section-body">
      <div class="s-row">
        <div class="s-row-info">
          <span class="s-label">Warn when limit is reached</span>
          <span class="s-desc">{store.settings.storageLimitGb === null ? "No limit set" : `Warn above ${store.settings.storageLimitGb} GB`}</span>
        </div>
        {#if store.settings.storageLimitGb === null}
          <button class="s-btn" onclick={() => updateSettings({ storageLimitGb: 10 })}>Set limit</button>
        {:else}
          <div class="s-stepper">
            <button class="s-step-btn" onclick={() => updateSettings({ storageLimitGb: Math.max(1, (store.settings.storageLimitGb ?? 10) - 1) })} disabled={(store.settings.storageLimitGb ?? 10) <= 1}>−</button>
            <input type="number" min="1" step="1" class="s-slider-val" style="width:52px"
              value={store.settings.storageLimitGb}
              oninput={(e) => { const n = parseFloat(e.currentTarget.value); if (!isNaN(n) && n > 0) updateSettings({ storageLimitGb: n }); }} />
            <span class="s-slider-unit">GB</span>
            <button class="s-step-btn" onclick={() => updateSettings({ storageLimitGb: (store.settings.storageLimitGb ?? 10) + 1 })}>+</button>
            <button class="s-btn-icon" title="Remove limit" onclick={() => updateSettings({ storageLimitGb: null })}>↺</button>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <div class="s-section">
    <button class="s-collapsible-trigger" onclick={() => advStorageOpen = !advStorageOpen}>
      <span class="s-label">Advanced</span>
      <svg class="s-collapsible-caret" class:open={advStorageOpen} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
    </button>
    {#if advStorageOpen}
      <div class="s-collapsible-body">
        <div class="s-row">
          <div class="s-row-info">
            <span class="s-label">Local source path</span>
            <span class="s-desc">Read manga already on disk without an extension. Leave blank if unused.</span>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
            <div class="s-btn-row">
              <input class="s-input mono" class:error={!!pathsFieldError.loc}
                bind:value={localSourcePathInput} placeholder="Optional" spellcheck="false"
                onkeydown={(e) => e.key === "Enter" && savePaths()}
                oninput={() => { pathsFieldError = { ...pathsFieldError, loc: undefined }; }} />
              {#if !isExternalServer}
                <button class="s-btn" onclick={browseLocalSourceFolder}>Browse</button>
              {/if}
              {#if pathsFieldError.loc && !isExternalServer}
                <button class="s-btn" onclick={async () => {
                  try { await createDirectory(localSourcePathInput.trim()); pathsFieldError = { ...pathsFieldError, loc: undefined }; }
                  catch (e: any) { pathsFieldError = { ...pathsFieldError, loc: e?.message ?? "Failed" }; }
                }}>Create</button>
              {/if}
            </div>
            {#if pathsFieldError.loc}<span class="s-desc" style="color:var(--color-error)">{pathsFieldError.loc}</span>{/if}
          </div>
        </div>

        {#each extraScanDirs as dir}
          <div class="s-row">
            <div class="s-row-info">
              <span class="s-label mono" style="font-family:monospace;font-size:var(--text-xs)">{dir}</span>
              <span class="s-desc">Extra scan directory</span>
            </div>
            <button class="s-btn s-btn-danger" onclick={() => removeExtraScanDir(dir)}>Remove</button>
          </div>
        {/each}

        <div class="s-row">
          <div class="s-row-info">
            <span class="s-label">Additional scan path</span>
            <span class="s-desc">Include an extra directory in disk usage readings</span>
          </div>
          <div class="s-btn-row">
            <input class="s-input mono" bind:value={newScanDir} placeholder="/path/to/dir" spellcheck="false"
              onkeydown={(e) => e.key === "Enter" && addExtraScanDir()} />
            {#if !isExternalServer}
              <button class="s-btn" onclick={browseExtraScanDir}>Browse</button>
            {/if}
          </div>
        </div>

      </div>
    {/if}
  </div>

  <div class="s-section">
    <button class="s-collapsible-trigger" onclick={() => backupSectionOpen = !backupSectionOpen}>
      <span class="s-label">Backup</span>
      <svg class="s-collapsible-caret" class:open={backupSectionOpen} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
    </button>
    {#if backupSectionOpen}
      <div class="s-collapsible-body">
        <div class="s-row">
          <div class="s-row-info">
            <span class="s-label">Create backup</span>
            <span class="s-desc">Snapshot your library, categories, and tracker links</span>
          </div>
          <button class="s-btn s-btn-accent" onclick={createBackup} disabled={backupLoading}>
            {backupLoading ? "Creating…" : "Create backup"}
          </button>
        </div>

        {#if backupError}
          <div class="s-banner s-banner-error">{backupError}</div>
        {/if}

        {#if backupList.length === 0}
          <p class="s-empty">No backups yet — create one above.</p>
        {:else}
          {#each backupList as backup}
            <div class="s-folder-row">
              <ClockCounterClockwise size={14} weight="light" style="color:var(--text-faint);flex-shrink:0" />
              <span class="s-folder-name" style="font-family:monospace;font-size:var(--text-xs)">{backup.name}</span>
              <button class="s-btn-icon" onclick={() => downloadBackup(backup)} title="Download">↓</button>
              <button class="s-btn-icon danger" onclick={() => deleteBackup(backup.url)} disabled={backup.deleting} title="Delete">
                <Trash size={12} weight="light" />
              </button>
            </div>
          {/each}
        {/if}

        <div class="s-row">
          <div class="s-row-info">
            <span class="s-label">Restore from file</span>
            <span class="s-desc">{restoreFile ? restoreFile.name : "Select a .tachibk file"}</span>
          </div>
          <label class="s-btn" style="cursor:pointer">
            Browse
            <input type="file" accept=".tachibk,.proto.gz" style="display:none"
              onchange={(e) => {
                const f = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
                restoreFile = f; restoreStatus = null; restoreError = null; validateResult = null; validateError = null;
              }} />
          </label>
        </div>

        {#if restoreFile}
          <div class="s-row">
            <div class="s-row-info"></div>
            <div class="s-btn-row">
              <button class="s-btn" onclick={submitValidate} disabled={validateLoading || restoreLoading}>
                {validateLoading ? "Checking…" : "Validate"}
              </button>
              <button class="s-btn s-btn-accent" onclick={submitRestore} disabled={restoreLoading || validateLoading}>
                {restoreLoading ? "Restoring…" : "Restore"}
              </button>
            </div>
          </div>
        {/if}

        {#if validateError}
          <div class="s-banner s-banner-error">{validateError}</div>
        {/if}

        {#if validateResult}
          {#if validateResult.missingSources.length === 0 && validateResult.missingTrackers.length === 0}
            <div class="s-row"><span class="s-desc" style="color:var(--color-success,#4caf50)">✓ All sources and trackers present</span></div>
          {:else}
            {#if validateResult.missingSources.length > 0}
              <div class="s-row">
                <div class="s-row-info">
                  <span class="s-label" style="color:var(--color-error)">Missing sources</span>
                  <span class="s-desc">{validateResult.missingSources.map(s => s.name).join(", ")}</span>
                </div>
              </div>
            {/if}
            {#if validateResult.missingTrackers.length > 0}
              <div class="s-row">
                <div class="s-row-info">
                  <span class="s-label" style="color:var(--color-error)">Missing trackers</span>
                  <span class="s-desc">{validateResult.missingTrackers.map(t => t.name).join(", ")}</span>
                </div>
              </div>
            {/if}
          {/if}
        {/if}

        {#if restoreError}
          <div class="s-banner s-banner-error">{restoreError}</div>
        {/if}

        {#if restoreStatus}
          <div class="s-row">
            <div class="s-row-info">
              <span class="s-label">
                {restoreStatus.state === "SUCCESS" ? "✓ Restore complete" :
                 restoreStatus.state === "FAILURE" ? "✗ Restore failed"  : "Restoring…"}
              </span>
              {#if restoreStatus.totalManga > 0}
                <span class="s-desc">{restoreStatus.mangaProgress} / {restoreStatus.totalManga} manga</span>
              {/if}
            </div>
            {#if restoreStatus.state !== "SUCCESS" && restoreStatus.state !== "FAILURE" && restoreStatus.totalManga > 0}
              <div class="s-storage-bar" style="width:160px;flex-shrink:0">
                <div class="s-storage-fill" style="width:{Math.round((restoreStatus.mangaProgress / restoreStatus.totalManga) * 100)}%"></div>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <div class="s-section">
    <button class="s-collapsible-trigger" onclick={() => appDataSectionOpen = !appDataSectionOpen}>
      <span class="s-label">App-Data Backup</span>
      <svg class="s-collapsible-caret" class:open={appDataSectionOpen} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
    </button>
    {#if appDataSectionOpen}
      <div class="s-collapsible-body">

        <div class="s-row">
          <div class="s-row-info">
            <span class="s-label">Export settings</span>
            <span class="s-desc">Save all Moku app settings to a JSON file via a native save dialog.</span>
          </div>
          <button class="s-btn s-btn-accent" onclick={handleExportAppData} disabled={appDataExporting}>
            {appDataExporting ? "Saving…" : "Export"}
          </button>
        </div>

        <div class="s-row">
          <div class="s-row-info">
            <span class="s-label">Import settings</span>
            <span class="s-desc">Restore from a previously exported JSON file. Reloads the app immediately.</span>
          </div>
          <button class="s-btn" onclick={handleImportAppData} disabled={appDataImporting}>
            {appDataImporting ? "Importing…" : "Import"}
          </button>
        </div>

        {#if appDataError}
          <div class="s-banner s-banner-error">{appDataError}</div>
        {/if}

        {#if appDataMsg}
          <div class="s-row">
            <span class="s-desc" style="color:var(--color-success,#4caf50)">{appDataMsg}</span>
          </div>
        {/if}

        {#if appDataBackupDir}
          <div class="s-row">
            <div class="s-row-info">
              <span class="s-label">Auto-backup location</span>
              <span class="s-desc">Pre-update snapshots are kept here (last 5).</span>
            </div>
            <button class="s-btn" onclick={() => invoke("open_path", { path: appDataBackupDir })}>Open folder</button>
          </div>
        {/if}

      </div>
    {/if}
  </div>

</div>