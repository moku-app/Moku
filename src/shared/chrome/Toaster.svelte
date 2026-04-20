<script lang="ts">
  import { store, dismissToast } from "@store/state.svelte";
  import type { Toast } from "@store/state.svelte";

  const EXIT_MS = 280;
  const leaving = new Set<string>();
  const timers  = new Map<string, ReturnType<typeof setTimeout>>();

  function schedule(t: Toast) {
    if (timers.has(t.id)) return;
    const dur = t.duration ?? 3500;
    if (dur === 0) return;
    timers.set(t.id, setTimeout(() => dismiss(t.id), dur));
  }

  function dismiss(id: string) {
    if (leaving.has(id)) return;
    leaving.add(id);
    if (timers.has(id)) { clearTimeout(timers.get(id)!); timers.delete(id); }
    const el = document.querySelector<HTMLElement>(`[data-toast-id="${id}"]`);
    if (!el) { finalize(id); return; }
    const h = el.offsetHeight;
    el.style.setProperty("--exit-h", `${h}px`);
    el.classList.add("leaving");
    setTimeout(() => finalize(id), EXIT_MS);
  }

  function finalize(id: string) {
    leaving.delete(id);
    dismissToast(id);
  }

  $effect(() => {
    const activeIds = new Set(store.toasts.map(t => t.id));
    store.toasts.forEach(schedule);
    for (const [id, timer] of timers) {
      if (!activeIds.has(id)) { clearTimeout(timer); timers.delete(id); }
    }
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
      <div role="alert" class="toast toast-{t.kind}" data-toast-id={t.id} onclick={() => dismiss(t.id)}>
        <div class="accent-bar"></div>
        <span class="icon">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d={icons[t.kind]} />
          </svg>
        </span>
        <div class="body">
          <p class="title">{t.title}</p>
          <p class="sub">{t.body ?? '\u00a0'}</p>
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toaster { position: fixed; bottom: var(--sp-5); right: var(--sp-5); z-index: 9999; display: flex; flex-direction: column; gap: 5px; pointer-events: none; }

  .toast {
    display: flex; align-items: center; gap: 10px; padding: 12px var(--sp-3) 12px 0;
    border-radius: var(--radius-md); background: var(--bg-raised); border: 1px solid var(--border-dim);
    box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.04) inset;
    pointer-events: all; width: 280px; overflow: hidden; cursor: pointer;
    font-family: inherit; font-size: inherit; color: inherit; text-align: left;
    will-change: transform, opacity;
    animation: slideIn 0.35s cubic-bezier(0.16,1,0.3,1) both;
    transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
  }
  .toast:hover  { border-color: var(--border-base); box-shadow: 0 12px 40px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.06) inset; transform: translateX(-3px); }
  .toast:active { transform: translateX(0) scale(0.98); }

  :global(.toast.leaving) { animation: slideOut 0.28s cubic-bezier(0.4,0,1,1) forwards !important; pointer-events: none; }

  @keyframes slideIn  { from { opacity:0; transform:translateX(20px) scale(0.96) } to { opacity:1; transform:translateX(0) scale(1) } }
  @keyframes slideOut {
    0%   { opacity:1; transform:translateX(0) scale(1);       max-height:var(--exit-h,80px); margin-bottom:0; }
    40%  { opacity:0; transform:translateX(14px) scale(0.96); max-height:var(--exit-h,80px); margin-bottom:0; }
    100% { opacity:0; transform:translateX(14px) scale(0.96); max-height:0;                  margin-bottom:-5px; }
  }

  .accent-bar { width: 3px; align-self: stretch; flex-shrink: 0; border-radius: 0 2px 2px 0; }
  .toast-success  .accent-bar { background: var(--accent-fg); }
  .toast-error    .accent-bar { background: var(--color-error); }
  .toast-info     .accent-bar { background: var(--text-faint); }
  .toast-download .accent-bar { background: var(--accent-fg); }

  .icon { flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
  .toast-success  .icon { color: var(--accent-fg); }
  .toast-error    .icon { color: var(--color-error); }
  .toast-info     .icon { color: var(--text-muted); }
  .toast-download .icon { color: var(--accent-fg); }

  .body  { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .title { font-size: var(--text-xs); font-family: var(--font-ui); color: var(--text-secondary); font-weight: var(--weight-medium); letter-spacing: var(--tracking-wide); line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub   { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
