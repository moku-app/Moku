<script lang="ts">
  import { X } from "phosphor-svelte";
  import { store, updateSettings } from "../../store/state.svelte";
  import { DEFAULT_MANGA_PREFS } from "../../store/state.svelte";
  import type { MangaPrefs } from "../../store/state.svelte";
  import type { Chapter } from "../../lib/types";

  let { mangaId, chapters, onClose }: {
    mangaId:  number;
    chapters: Chapter[];
    onClose:  () => void;
  } = $props();

  // ── Prefs helpers ──────────────────────────────────────────────────────────

  const mangaPrefs = $derived(
    (store.settings.mangaPrefs?.[mangaId] ?? {}) as Partial<MangaPrefs>
  );

  function getPref<K extends keyof MangaPrefs>(key: K): MangaPrefs[K] {
    return (mangaPrefs[key] ?? DEFAULT_MANGA_PREFS[key]) as MangaPrefs[K];
  }

  function setPref<K extends keyof MangaPrefs>(key: K, value: MangaPrefs[K]) {
    updateSettings({
      mangaPrefs: {
        ...store.settings.mangaPrefs,
        [mangaId]: { ...(store.settings.mangaPrefs?.[mangaId] ?? {}), [key]: value },
      },
    });
  }

  // ── Scanlator list — derived from loaded chapters ──────────────────────────

  const scanlators = $derived(
    [...new Set(chapters.map(c => c.scanlator).filter((s): s is string => !!s?.trim()))]
      .sort((a, b) => a.localeCompare(b))
  );

  // ── Options ────────────────────────────────────────────────────────────────

  const DOWNLOAD_AHEAD_OPTIONS = [
    { value: 0,  label: "Off"  },
    { value: 2,  label: "2"    },
    { value: 5,  label: "5"    },
    { value: 10, label: "10"   },
  ];

  const MAX_KEEP_OPTIONS = [
    { value: 0,  label: "Off" },
    { value: 5,  label: "5"   },
    { value: 10, label: "10"  },
    { value: 25, label: "25"  },
  ];

  const DELETE_DELAY_OPTIONS = [
    { value: 0,   label: "Now"    },
    { value: 24,  label: "1 day"  },
    { value: 168, label: "1 week" },
  ];

  const REFRESH_INTERVAL_OPTIONS = [
    { value: "global", label: "Default" },
    { value: "daily",  label: "Daily"   },
    { value: "weekly", label: "Weekly"  },
    { value: "manual", label: "Manual"  },
  ];

  // ── Backdrop close ─────────────────────────────────────────────────────────

  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onmousedown={onBackdrop}>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Automation">

    <!-- Header -->
    <div class="modal-header">
      <div class="header-left">
        <span class="modal-title">Automation</span>
        <span class="modal-subtitle">Per-series rules</span>
      </div>
      <button class="close-btn" onclick={onClose} aria-label="Close"><X size={16} weight="light" /></button>
    </div>

    <!-- Body -->
    <div class="modal-body">

      <!-- ── Downloads ────────────────────────────────────────────────────── -->
      <p class="section-label">Downloads</p>

      <div class="auto-row">
        <div class="auto-info">
          <span class="auto-label">Auto-download new chapters</span>
          <span class="auto-desc">Queue new chapters when this series refreshes</span>
        </div>
        <button
          role="switch"
          aria-checked={getPref("autoDownload")}
          class="auto-toggle"
          class:auto-toggle-on={getPref("autoDownload")}
          onclick={() => setPref("autoDownload", !getPref("autoDownload"))}
        ><span class="auto-toggle-thumb"></span></button>
      </div>

      <div class="auto-row">
        <div class="auto-info">
          <span class="auto-label">Download ahead</span>
          <span class="auto-desc">Pre-fetch chapters while reading</span>
        </div>
        <div class="auto-chip-group">
          {#each DOWNLOAD_AHEAD_OPTIONS as opt}
            <button
              class="auto-chip"
              class:auto-chip-on={getPref("downloadAhead") === opt.value}
              onclick={() => setPref("downloadAhead", opt.value)}
            >{opt.label}</button>
          {/each}
        </div>
      </div>

      <div class="auto-row">
        <div class="auto-info">
          <span class="auto-label">Max chapters to keep</span>
          <span class="auto-desc">Delete oldest downloads when limit is exceeded</span>
        </div>
        <div class="auto-chip-group">
          {#each MAX_KEEP_OPTIONS as opt}
            <button
              class="auto-chip"
              class:auto-chip-on={getPref("maxKeepChapters") === opt.value}
              onclick={() => setPref("maxKeepChapters", opt.value)}
            >{opt.label}</button>
          {/each}
        </div>
      </div>

      <div class="divider"></div>

      <!-- ── On Read ──────────────────────────────────────────────────────── -->
      <p class="section-label">On Read</p>

      <div class="auto-row">
        <div class="auto-info">
          <span class="auto-label">Delete after reading</span>
          <span class="auto-desc">Remove download when chapter is marked read</span>
        </div>
        <button
          role="switch"
          aria-checked={getPref("deleteOnRead")}
          class="auto-toggle"
          class:auto-toggle-on={getPref("deleteOnRead")}
          onclick={() => setPref("deleteOnRead", !getPref("deleteOnRead"))}
        ><span class="auto-toggle-thumb"></span></button>
      </div>

      {#if getPref("deleteOnRead")}
        <div class="auto-row auto-row-sub">
          <span class="auto-label">Delete delay</span>
          <div class="auto-chip-group">
            {#each DELETE_DELAY_OPTIONS as opt}
              <button
                class="auto-chip"
                class:auto-chip-on={getPref("deleteDelayHours") === opt.value}
                onclick={() => setPref("deleteDelayHours", opt.value)}
              >{opt.label}</button>
            {/each}
          </div>
        </div>
      {/if}

      <div class="divider"></div>

      <!-- ── Updates ─────────────────────────────────────────────────────── -->
      <p class="section-label">Updates</p>

      <div class="auto-row">
        <div class="auto-info">
          <span class="auto-label">Pause updates</span>
          <span class="auto-desc">Skip this series during global refresh</span>
        </div>
        <button
          role="switch"
          aria-checked={getPref("pauseUpdates")}
          class="auto-toggle"
          class:auto-toggle-on={getPref("pauseUpdates")}
          onclick={() => setPref("pauseUpdates", !getPref("pauseUpdates"))}
        ><span class="auto-toggle-thumb"></span></button>
      </div>

      <div class="auto-row">
        <div class="auto-info">
          <span class="auto-label">Refresh interval</span>
          <span class="auto-desc">How often to check for new chapters</span>
        </div>
        <div class="auto-chip-group">
          {#each REFRESH_INTERVAL_OPTIONS as opt}
            <button
              class="auto-chip"
              class:auto-chip-on={getPref("refreshInterval") === opt.value}
              onclick={() => setPref("refreshInterval", opt.value as MangaPrefs["refreshInterval"])}
            >{opt.label}</button>
          {/each}
        </div>
      </div>

      {#if scanlators.length > 1}
        <div class="divider"></div>

        <!-- ── Scanlator ──────────────────────────────────────────────────── -->
        <p class="section-label">Scanlator</p>

        <div class="auto-row auto-row-align-start">
          <div class="auto-info">
            <span class="auto-label">Preferred scanlator</span>
            <span class="auto-desc">Prioritise this group's chapters in the list</span>
          </div>
          <div class="scanlator-list">
            <button
              class="auto-chip scanlator-chip"
              class:auto-chip-on={!getPref("preferredScanlator")}
              onclick={() => setPref("preferredScanlator", "")}
            >Any</button>
            {#each scanlators as s}
              <button
                class="auto-chip scanlator-chip"
                class:auto-chip-on={getPref("preferredScanlator") === s}
                onclick={() => setPref("preferredScanlator", getPref("preferredScanlator") === s ? "" : s)}
                title={s}
              >{s}</button>
            {/each}
          </div>
        </div>
      {/if}

    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed; inset: 0; z-index: 300;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    animation: fadeIn 0.1s ease both;
  }

  .modal {
    width: 420px; max-width: calc(100vw - var(--sp-6));
    max-height: 80vh;
    display: flex; flex-direction: column;
    background: var(--bg-surface); border: 1px solid var(--border-base);
    border-radius: var(--radius-xl); overflow: hidden;
    box-shadow: 0 0 0 1px var(--border-dim), 0 24px 64px rgba(0,0,0,0.6);
    animation: scaleIn 0.15s ease both;
  }

  /* Header */
  .modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: var(--sp-4) var(--sp-5); border-bottom: 1px solid var(--border-dim); flex-shrink: 0;
  }
  .header-left { display: flex; flex-direction: column; gap: 2px; }
  .modal-title { font-size: var(--text-base); font-weight: var(--weight-medium); color: var(--text-primary); letter-spacing: var(--tracking-tight); }
  .modal-subtitle { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .close-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--radius-sm); color: var(--text-faint); background: none; border: none; cursor: pointer; transition: color var(--t-base), background var(--t-base); flex-shrink: 0; }
  .close-btn:hover { color: var(--text-muted); background: var(--bg-raised); }

  /* Body */
  .modal-body {
    flex: 1; overflow-y: auto; scrollbar-width: none;
    display: flex; flex-direction: column; gap: var(--sp-3);
    padding: var(--sp-4) var(--sp-5);
  }
  .modal-body::-webkit-scrollbar { display: none; }

  /* Section labels */
  .section-label {
    font-family: var(--font-ui); font-size: var(--text-2xs);
    letter-spacing: var(--tracking-widest); color: var(--text-faint);
    text-transform: uppercase; margin: 0;
  }

  .divider { height: 1px; background: var(--border-dim); margin: var(--sp-1) 0; }

  /* Rows — mirrors SeriesDetail auto-row */
  .auto-row {
    display: flex; align-items: center; justify-content: space-between;
    gap: var(--sp-3);
  }
  .auto-row-align-start { align-items: flex-start; }
  .auto-row-sub {
    padding-left: var(--sp-3);
    border-left: 2px solid var(--border-dim);
  }
  .auto-info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .auto-label { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-muted); letter-spacing: var(--tracking-wide); }
  .auto-desc  { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); line-height: var(--leading-snug); }

  /* Toggle */
  .auto-toggle { width: 28px; height: 16px; border-radius: var(--radius-full); border: 1px solid var(--border-strong); background: var(--bg-overlay); cursor: pointer; padding: 0; flex-shrink: 0; position: relative; transition: background var(--t-base), border-color var(--t-base); }
  .auto-toggle-on { background: var(--accent); border-color: var(--accent); }
  .auto-toggle-thumb { position: absolute; top: 1px; left: 1px; width: 12px; height: 12px; border-radius: 50%; background: var(--text-faint); transition: transform var(--t-base), background var(--t-base); }
  .auto-toggle-on .auto-toggle-thumb { transform: translateX(12px); background: var(--bg-base); }

  /* Chips */
  .auto-chip-group { display: flex; flex-direction: row; gap: 4px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
  .auto-chip { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); padding: 2px 7px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: none; color: var(--text-faint); cursor: pointer; white-space: nowrap; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); }
  .auto-chip:hover { color: var(--text-muted); border-color: var(--border-strong); background: var(--bg-raised); }
  .auto-chip-on { color: var(--accent-fg); border-color: var(--accent-dim); background: var(--accent-muted); }

  /* Scanlator list */
  .scanlator-list { display: flex; flex-direction: row; gap: 4px; flex-wrap: wrap; justify-content: flex-end; max-width: 220px; }
  .scanlator-chip { max-width: 160px; overflow: hidden; text-overflow: ellipsis; }

  @keyframes fadeIn  { from { opacity: 0 }                         to { opacity: 1 } }
  @keyframes scaleIn { from { opacity: 0; transform: scale(0.97) } to { opacity: 1; transform: scale(1) } }
</style>
