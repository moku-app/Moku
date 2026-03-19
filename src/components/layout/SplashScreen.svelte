<script lang="ts">
  export const EXIT_MS = 320;
  export let mode: "loading" | "idle" = "loading";
  export let ringFull = false;
  export let failed = false;
  export let showCards = true;
  export let showFps = false;
  export let onReady: (() => void) | undefined = undefined;
  export let onRetry: (() => void) | undefined = undefined;
  export let onDismiss: (() => void) | undefined = undefined;
</script>
<div>SplashScreen stub</div>
