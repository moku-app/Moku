<script lang="ts">
  import { onMount, onDestroy } from "svelte";

  export interface MenuItem {
    label: string;
    icon?: any;
    onClick: () => void;
    danger?: boolean;
    disabled?: boolean;
    separator?: never;
  }
  export interface MenuSeparator { separator: true }
  export type MenuEntry = MenuItem | MenuSeparator;

  export let x: number;
  export let y: number;
  export let items: MenuEntry[];
  export let onClose: () => void;

  let focused = -1;
  let el: HTMLDivElement;

  const actionable = items
    .map((_, i) => i)
    .filter((i) => !("separator" in items[i]) && !(items[i] as MenuItem).disabled);

  $: if (actionable.length) focused = actionable[0];

  function getPos() {
    const zoom  = parseFloat(document.documentElement.style.zoom || "100") / 100 || 1;
    const menuW = 200, menuH = items.length * 34;
    const vw = window.innerWidth / zoom, vh = window.innerHeight / zoom;
    const sx = x / zoom, sy = y / zoom;
    return {
      left: Math.max(4, sx + menuW > vw ? sx - menuW : sx),
      top:  Math.max(4, sy + menuH > vh ? sy - menuH : sy),
    };
  }

  function onMouseDown(e: MouseEvent) {
    if (el && !el.contains(e.target as Node)) onClose();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const cur = actionable.indexOf(focused);
      focused = actionable[(cur + 1) % actionable.length] ?? actionable[0];
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const cur = actionable.indexOf(focused);
      focused = actionable[(cur - 1 + actionable.length) % actionable.length] ?? actionable[0];
      return;
    }
    if (e.key === "Enter" && focused >= 0) {
      e.preventDefault();
      const item = items[focused] as MenuItem;
      if (item && !item.disabled) { item.onClick(); onClose(); }
    }
  }

  onMount(() => {
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKey, true);
  });
  onDestroy(() => {
    document.removeEventListener("mousedown", onMouseDown, true);
    document.removeEventListener("keydown", onKey, true);
  });

  $: pos = getPos();
</script>

<div bind:this={el} class="menu" style="left:{pos.left}px;top:{pos.top}px"
  on:contextmenu|preventDefault>
  {#each items as item, i}
    {#if "separator" in item}
      <div class="sep"></div>
    {:else}
      {@const mi = item as MenuItem}
      <button
        class="item"
        class:danger={mi.danger}
        class:disabled={mi.disabled}
        class:focused={focused === i}
        disabled={mi.disabled}
        on:click={() => { if (!mi.disabled) { mi.onClick(); onClose(); } }}
        on:mouseenter={() => { if (!mi.disabled) focused = i; }}
        on:mouseleave={() => focused = -1}
      >
        <span class="icon" class:icon-danger={mi.danger}>
          {#if mi.icon}<svelte:component this={mi.icon} size={13} weight="light" />{/if}
        </span>
        <span class="label">{mi.label}</span>
      </button>
    {/if}
  {/each}
</div>

<style>
  .menu {
    position: fixed; z-index: 200;
    background: var(--bg-raised);
    border: 1px solid var(--border-base);
    border-radius: var(--radius-lg);
    padding: var(--sp-1); min-width: 190px;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.35), 0 16px 40px rgba(0,0,0,0.25);
    animation: scaleIn 0.1s ease both;
    transform-origin: top left;
  }
  .item {
    display: flex; align-items: center; gap: var(--sp-2);
    width: 100%; padding: 5px var(--sp-2);
    border-radius: var(--radius-md);
    font-size: var(--text-sm); color: var(--text-secondary);
    text-align: left; cursor: pointer;
    transition: background var(--t-fast), color var(--t-fast);
    background: none; border: none; outline: none;
  }
  .item:hover:not(.disabled), .item.focused:not(.disabled) { background: var(--bg-overlay); color: var(--text-primary); }
  .item.danger { color: var(--color-error); }
  .item.danger:hover:not(.disabled), .item.danger.focused:not(.disabled) { background: var(--color-error-bg); }
  .item.disabled { opacity: 0.3; cursor: default; pointer-events: none; }
  .icon {
    display: flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; flex-shrink: 0;
    color: var(--text-faint); border-radius: var(--radius-sm);
  }
  .icon-danger { color: var(--color-error); opacity: 0.7; }
  .label { flex: 1; line-height: 1.3; }
  .sep { height: 1px; background: var(--border-dim); margin: 3px var(--sp-1); }
</style>
