<script lang="ts">
  import { thumbUrl, plainThumbUrl } from "../../lib/client";
  import { store } from "../../store/state.svelte";
  import { getBlobUrl } from "../../lib/imageCache";

  let {
    src,
    alt        = "",
    class: cls = "",
    loading    = "lazy",
    decoding   = "async",
    priority   = 0,
    onerror    = undefined,
    ...rest
  }: {
    src:       string;
    alt?:      string;
    class?:    string;
    loading?:  string;
    decoding?: string;
    priority?: number;
    onerror?:  ((e: Event) => void) | undefined;
    [key: string]: any;
  } = $props();

  const isAuth = $derived(store.settings.serverAuthMode === "BASIC_AUTH");

  let blobUrl = $state("");
  $effect(() => {
    if (!isAuth || !src) { blobUrl = ""; return; }
    getBlobUrl(plainThumbUrl(src), priority)
      .then(u => { blobUrl = u; })
      .catch(() => { blobUrl = ""; });
  });

  const resolved = $derived(
    isAuth
      ? (blobUrl || undefined)
      : (src ? thumbUrl(src) : undefined)
  );
</script>

<img src={resolved} {alt} class={cls} {loading} {decoding} {onerror} {...rest} />
