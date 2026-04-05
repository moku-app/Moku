<script lang="ts">
  import { onDestroy } from "svelte";
  import { thumbUrl } from "../../lib/client";
  import { fetchAuthenticated } from "../../lib/auth";
  import { store } from "../../store/state.svelte";

  let {
    src,
    alt = "",
    class: className = "",
    loading = "lazy",
    decoding = "async",
    onerror = undefined,
    ...rest
  }: {
    src: string;
    alt?: string;
    class?: string;
    loading?: string;
    decoding?: string;
    onerror?: ((e: Event) => void) | undefined;
    [key: string]: any;
  } = $props();

  const blobCache = new Map<string, string>();

  let resolved = $state("");
  let current  = "";

  $effect(() => {
    const path = src;
    const mode = store.settings.serverAuthMode ?? "NONE";

    if (path === current) return;
    current = path;

    if (!path) { resolved = ""; return; }

    if (mode !== "BASIC_AUTH") {
      resolved = thumbUrl(path);
      return;
    }

    if (blobCache.has(path)) {
      resolved = blobCache.get(path)!;
      return;
    }

    resolved = "";
    fetchAuthenticated(thumbUrl(path), { method: "GET" })
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        blobCache.set(path, url);
        if (current === path) resolved = url;
      })
      .catch(() => {});
  });
</script>

<img src={resolved} {alt} class={className} {loading} {decoding} {onerror} {...rest} />
