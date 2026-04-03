<script lang="ts">
  import { store, dismissToast } from "../../store/state.svelte";
  import type { Toast } from "../../store/state.svelte";

  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function schedule(t: Toast) {
    if (timers.has(t.id)) return;
    const dur = t.duration ?? 3500;
    if (dur === 0) return;
    timers.set(t.id, setTimeout(() => dismissToast(t.id), dur));
  }

  $effect(() => {
    store.toasts.forEach(schedule);
    return () => timers.forEach(clearTimeout);
  });

  const icons: Record<Toast["kind"], string> = {
    success:  "M20 6L9 17l-5-5",
    error:    "M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z",
    info:     "M12 16v-4M12 8h.01M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z",
    download: "M12 3v13M7 11l5 5 5-5M5 21h14",
  };
</script>

{#if store.toasts.length}
  <div class="toaster" aria-live="polite">
    {#each store.toasts as t (t.id)}
      <button
        class="toast toast-{t.kind}"
        role="alert"
        onclick={() => dismissToast(t.id)}
      >
        <div class="accent-bar"></div>
        <span class="icon">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d={icons[t.kind]} />
          </svg>
        </span>
        <div class="body">
          <p class="title">{t.title}</p>
          {#if t.body}<p class="sub">{t.body}</p>{/if}
        </div>
      </button>
    {/each}
  </div>
{/if}

<style>
  .toaster {
    position: fixed;
    bottom: var(--sp-5);
    right: var(--sp-5);
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 6px;
    pointer-events: none;
    max-width: 300px;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: 10px var(--sp-3) 10px 0;
    border-radius: var(--radius-md);
    background: var(--bg-raised);
    border: 1px solid var(--border-dim);
    box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.04) inset;
    pointer-events: all;
    min-width: 200px;
    overflow: hidden;
    cursor: pointer;
    animation: slideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) both;
    transition: opacity 0.15s ease, transform 0.15s ease;
    font-family: inherit;
    font-size: inherit;
    color: inherit;
    text-align: left;
  }

  .toast:hover  { opacity: 0.85; transform: translateX(-2px); }
  .toast:active { transform: translateX(0) scale(0.98); }

  @keyframes slideIn {
    from { opacity: 0; transform: translateX(16px) scale(0.98); }
    to   { opacity: 1; transform: translateX(0)    scale(1); }
  }

  .accent-bar {
    width: 3px;
    align-self: stretch;
    flex-shrink: 0;
    border-radius: 0 2px 2px 0;
    margin-right: 2px;
  }

  .toast-success  .accent-bar { background: var(--accent-fg); }
  .toast-error    .accent-bar { background: var(--color-error); }
  .toast-info     .accent-bar { background: var(--text-faint); }
  .toast-download .accent-bar { background: var(--accent-fg); }

  .icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .toast-success  .icon { color: var(--accent-fg); }
  .toast-error    .icon { color: var(--color-error); }
  .toast-info     .icon { color: var(--text-muted); }
  .toast-download .icon { color: var(--accent-fg); }

  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .title {
    font-size: var(--text-xs);
    font-family: var(--font-ui);
    color: var(--text-secondary);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-wide);
    line-height: 1.3;
  }

  .sub {
    font-family: var(--font-ui);
    font-size: var(--text-2xs);
    color: var(--text-faint);
    letter-spacing: var(--tracking-wide);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
