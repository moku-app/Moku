<script lang="ts">
  import { Pencil, Trash, Plus } from "phosphor-svelte";
  import { store, updateSettings, deleteCustomTheme } from "@store/state.svelte";

  interface Props {
    onOpenThemeEditor?: (id?: string | null) => void;
  }

  let { onOpenThemeEditor }: Props = $props();

  const THEMES: { id: string; label: string; description: string; swatches: string[] }[] = [
    { id: "dark",           label: "Dark",           description: "Default near-black",            swatches: ["#101010","#151515","#a8c4a8","#f0efec"] },
    { id: "high-contrast",  label: "High Contrast",  description: "Darker base, sharper text",     swatches: ["#080808","#111111","#bcd8bc","#ffffff"] },
    { id: "light",          label: "Light",          description: "Warm off-white",                swatches: ["#f4f2ee","#faf8f4","#2a5a2a","#1a1916"] },
    { id: "light-contrast", label: "Light Contrast", description: "Light with maximum contrast",   swatches: ["#ece8e2","#f5f2ec","#183818","#080806"] },
    { id: "midnight",       label: "Midnight",       description: "Deep blue-black tint",          swatches: ["#0c1020","#101428","#a8b4e8","#eeeef8"] },
    { id: "warm",           label: "Warm",           description: "Amber and sepia tones",         swatches: ["#16130c","#1c1810","#e0b860","#f5f0e0"] },
  ];
</script>

<div class="s-panel">

  <div class="s-section">
    <p class="s-section-title">Theme</p>
    <div class="s-theme-grid">
      {#each THEMES as theme}
        {@const active = (store.settings.theme ?? "dark") === theme.id}
        <div class="s-theme-card" class:active>
          <button class="s-theme-card" style="border:none;padding:0;width:100%;display:block" onclick={() => updateSettings({ theme: theme.id })} title={theme.description}>
            <div class="s-theme-preview">
              <div class="s-theme-preview-bg" style="background:{theme.swatches[0]}">
                <div class="s-theme-preview-sidebar" style="background:{theme.swatches[1]}"></div>
                <div class="s-theme-preview-content">
                  <div class="s-theme-preview-accent" style="background:{theme.swatches[2]}"></div>
                  <div class="s-theme-preview-text" style="background:{theme.swatches[3]}55"></div>
                  <div class="s-theme-preview-text" style="background:{theme.swatches[3]}33;width:60%"></div>
                </div>
              </div>
            </div>
            <div class="s-theme-info">
              <span class="s-theme-name">{theme.label}</span>
              <span class="s-theme-desc">{theme.description}</span>
            </div>
            {#if active}<span class="s-theme-check">✓</span>{/if}
          </button>
        </div>
      {/each}

      {#each store.settings.customThemes ?? [] as custom}
        {@const active = store.settings.theme === custom.id}
        <div class="s-theme-card" class:active>
          <div class="s-theme-actions">
            <button class="s-theme-action-btn edit" onclick={() => onOpenThemeEditor?.(custom.id)} title="Edit theme">
              <Pencil size={10} />
            </button>
            <button class="s-theme-action-btn delete"
              onclick={() => { if (confirm(`Delete theme "${custom.name}"?`)) deleteCustomTheme(custom.id); }}
              title="Delete theme">
              <Trash size={10} />
            </button>
          </div>
          <button style="border:none;padding:0;width:100%;display:block;background:none;cursor:pointer"
            onclick={() => updateSettings({ theme: custom.id })} title="Apply {custom.name}">
            <div class="s-theme-preview">
              <div class="s-theme-preview-bg" style="background:{custom.tokens['bg-base']}">
                <div class="s-theme-preview-sidebar" style="background:{custom.tokens['bg-surface']}"></div>
                <div class="s-theme-preview-content">
                  <div class="s-theme-preview-accent" style="background:{custom.tokens['accent']}"></div>
                  <div class="s-theme-preview-text" style="background:{custom.tokens['text-primary']}55"></div>
                  <div class="s-theme-preview-text" style="background:{custom.tokens['text-primary']}33;width:60%"></div>
                </div>
              </div>
            </div>
            <div class="s-theme-info">
              <span class="s-theme-name">{custom.name}</span>
              <span class="s-theme-desc" style="color:var(--accent-fg)">Custom</span>
            </div>
          </button>
          {#if active}<span class="s-theme-check">✓</span>{/if}
        </div>
      {/each}

      <button class="s-theme-card s-theme-new" onclick={() => onOpenThemeEditor?.(null)} title="Create a custom theme">
        <Plus size={18} weight="light" />
        <div class="s-theme-info">
          <span class="s-theme-name">New Theme</span>
          <span class="s-theme-desc">Create custom</span>
        </div>
      </button>
    </div>
  </div>

</div>