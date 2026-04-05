<script lang="ts">
  import { thumbUrl, plainThumbUrl } from "../../lib/client";
  import { store } from "../../store/state.svelte";
  import { getBlobUrl } from "../../lib/imageCache";

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

  const isAuth = $derived(store.settings.serverAuthMode === "BASIC_AUTH");

  // Plain URL for non-auth users — fast, no overhead
  const plainResolved = $derived(src ? thumbUrl(src) : "");

  // Blob URL for auth users — fetched with Authorization header
  let blobUrl = $state("");
  $effect(() => {
    if (!isAuth || !src) { blobUrl = ""; return; }
    const fullUrl = plainThumbUrl(src);
    getBlobUrl(fullUrl)
      .then(u => { blobUrl = u; })
      .catch(() => { blobUrl = ""; });
  });

  const resolved = $derived(isAuth ? blobUrl || undefined : plainResolved || undefined);
</script>

<img src={resolved} {alt} class={className} {loading} {decoding} {onerror} {...rest} />
