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
    success:  "M9 12l2 2 4-4M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z",
    error:    "M12 9v4M12 17h.01M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z",
    info:     "M12 16v-4M12 8h.01M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z",
    download: "M12 3v13M7 11l5 5 5-5M5 21h14",
  };
</script>

{#if store.toasts.length}
  <div class="toaster" aria-live="polite">
    {#each store.toasts as t (t.id)}
      <div class="toast toast-{t.kind}" role="alert">
        <span class="icon">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d={icons[t.kind]} />
          </svg>
        </span>
        <div class="body">
          <p class="title">{t.title}</p>
          {#if t.body}<p class="sub">{t.body}</p>{/if}
        </div>
        <button class="close" onclick={() => dismissToast(t.id)} title="Dismiss">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toaster {
    position: fixed; bottom: var(--sp-5); right: var(--sp-5);
    z-index: 9999; display: flex; flex-direction: column;
    gap: var(--sp-2); pointer-events: none; max-width: 320px;
  }
  .toast {
    display: flex; align-items: flex-start; gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-3);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-base);
    background: var(--bg-raised);
    box-shadow: 0 4px 24px rgba(0,0,0,0.45), 0 0 0 1px rgba(0,0,0,0.08);
    pointer-events: all; min-width: 220px;
    animation: toastIn 0.18s cubic-bezier(0.16,1,0.3,1) both;
  }
  @keyframes toastIn {
    from { opacity: 0; transform: translateX(24px) scale(0.96); }
    to   { opacity: 1; transform: translateX(0) scale(1); }
  }
  .toast-success { border-color: var(--accent-dim); }
  .toast-success .icon { color: var(--accent-fg); }
  .toast-error { border-color: var(--color-error); }
  .toast-error .icon { color: var(--color-error); }
  .toast-download .icon, .toast-info .icon { color: var(--accent-fg); }
  .icon { flex-shrink: 0; margin-top: 2px; color: var(--text-faint); }
  .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .title { font-size: var(--text-sm); color: var(--text-secondary); font-weight: var(--weight-medium); line-height: 1.3; }
  .sub {
    font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint);
    letter-spacing: var(--tracking-wide); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .close {
    display: flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; border-radius: var(--radius-sm);
    color: var(--text-faint); flex-shrink: 0; margin-top: 1px;
    transition: color var(--t-base), background var(--t-base);
  }
  .close:hover { color: var(--text-muted); background: var(--bg-overlay); }
</style>
