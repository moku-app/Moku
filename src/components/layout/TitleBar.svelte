<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  const win = getCurrentWindow();
</script>

<div class="bar" data-tauri-drag-region>
  <span class="title" data-tauri-drag-region>Moku</span>
  <div class="controls">
    <button on:click={() => win.minimize()} title="Minimize" aria-label="Minimize">
      <svg width="10" height="1" viewBox="0 0 10 1">
        <line x1="0" y1="0.5" x2="10" y2="0.5" stroke="currentColor" stroke-width="1.5" />
      </svg>
    </button>
    <button on:click={() => win.toggleMaximize()} title="Maximize" aria-label="Maximize">
      <svg width="9" height="9" viewBox="0 0 9 9">
        <rect x="0.75" y="0.75" width="7.5" height="7.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.5" />
      </svg>
    </button>
    <button class="close" on:click={() => win.close()} title="Close" aria-label="Close">
      <svg width="10" height="10" viewBox="0 0 10 10">
        <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    </button>
  </div>
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 32px;
    padding: 0 var(--sp-3) 0 var(--sp-4);
    background: var(--bg-void);
    border-bottom: 1px solid var(--border-dim);
    flex-shrink: 0;
    user-select: none;
    -webkit-app-region: drag;
  }
  .title {
    font-family: var(--font-ui);
    font-size: var(--text-2xs);
    color: var(--text-faint);
    letter-spacing: var(--tracking-wider);
    text-transform: uppercase;
    -webkit-app-region: drag;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 2px;
    -webkit-app-region: no-drag;
  }
  button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px; height: 28px;
    border-radius: var(--radius-sm);
    color: var(--text-faint);
    transition: color var(--t-base), background var(--t-base);
    -webkit-app-region: no-drag;
  }
  button:hover { color: var(--text-muted); background: var(--bg-raised); }
  .close:hover { color: #fff; background: #c0392b; }
</style>
