<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import logoUrl from "../../assets/moku-icon.svg";

  interface Props {
    mode?:      "loading" | "idle";
    ringFull?:  boolean;
    failed?:    boolean;
    showCards?: boolean;
    showFps?:   boolean;
    onReady?:   () => void;
    onRetry?:   () => void;
    onDismiss?: () => void;
  }

  let { mode = "loading", ringFull = false, failed = false, showCards = true,
        showFps = false, onReady, onRetry, onDismiss }: Props = $props();

  const EXIT_MS = 320;

  let dots     = $state("");
  let ringProg = $state(0.025);
  let exiting  = $state(false);
  let exitLock = false;

  let fpsEl = $state<HTMLSpanElement | undefined>(undefined);

  function triggerExit(cb?: () => void) {
    if (exitLock) return;
    exitLock = true;
    exiting  = true;
    setTimeout(() => cb?.(), EXIT_MS);
  }

  $effect(() => {
    if (ringFull) {
      ringProg = 1;
      setTimeout(() => triggerExit(onReady), 650);
    }
  });

  const dotsInterval = setInterval(() => {
    dots = dots.length >= 3 ? "" : dots + ".";
  }, 420);

  onMount(() => {
    if (mode === "idle" && onDismiss) {
      const handler = () => triggerExit(onDismiss);
      const t = setTimeout(() => {
        window.addEventListener("keydown",    handler, { once: true });
        window.addEventListener("mousedown",  handler, { once: true });
        window.addEventListener("touchstart", handler, { once: true });
      }, 200);
      return () => {
        clearTimeout(t);
        clearInterval(dotsInterval);
        window.removeEventListener("keydown",    handler);
        window.removeEventListener("mousedown",  handler);
        window.removeEventListener("touchstart", handler);
      };
    }
    return () => clearInterval(dotsInterval);
  });

  interface CardDef { cx: number; w: number; h: number; lines: number; alpha: number; speed: number; cycleSec: number; phase: number; travel: number; yStart: number; angleStart: number; tilt: number; }
  interface CardTrig { cosA: number; sinA: number; tiltRad: number; }

  const LAYER_CFG = [
    { wMin: 26, wMax: 40, speedMin: 30,  speedMax: 50,  alpha: 0.22 },
    { wMin: 38, wMax: 56, speedMin: 52,  speedMax: 80,  alpha: 0.35 },
    { wMin: 54, wMax: 76, speedMin: 85,  speedMax: 120, alpha: 0.50 },
  ] as const;

  const BUF = 80, COLS = 14;

  function hash(n: number): number {
    let x = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    return ((x ^ (x >>> 16)) >>> 0) / 0xffffffff;
  }

  function buildCards(vw: number, vh: number) {
    const cards: CardDef[] = [], laneW = vw / COLS;
    for (let layer = 0; layer < 3; layer++) {
      const cfg = LAYER_CFG[layer];
      for (let col = 0; col < COLS; col++) {
        const seed  = col * 31 + layer * 97 + 7;
        const w     = cfg.wMin + hash(seed + 1) * (cfg.wMax - cfg.wMin);
        const h     = w * 1.44;
        const speed = cfg.speedMin + hash(seed + 5) * (cfg.speedMax - cfg.speedMin);
        const travel = vh + h + BUF;
        cards.push({ cx: (col + 0.5) * laneW + (hash(seed + 2) * 2 - 1) * Math.max(0, (laneW - w) / 2 - 2), w, h, lines: 1 + Math.floor(hash(seed + 7) * 3), alpha: cfg.alpha, speed, cycleSec: travel / speed, phase: ((col / COLS) + hash(seed + 6) * 0.6 + layer * 0.23) % 1, travel, yStart: vh + h / 2 + BUF / 2, angleStart: hash(seed + 3) * 50 - 25, tilt: (hash(seed + 4) * 2 - 1) * 18 });
      }
    }
    const trigs: CardTrig[] = cards.map(c => ({ cosA: Math.cos(c.angleStart * (Math.PI / 180)), sinA: Math.sin(c.angleStart * (Math.PI / 180)), tiltRad: c.tilt * (Math.PI / 180) }));
    return { cards, trigs };
  }

  function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  const STAMP_PAD = 6;

  function buildStamp(c: CardDef, dpr: number): HTMLCanvasElement {
    const oc = document.createElement("canvas");
    oc.width  = Math.round(Math.ceil(c.w + STAMP_PAD * 2) * dpr);
    oc.height = Math.round(Math.ceil(c.h + STAMP_PAD * 2) * dpr);
    const ctx = oc.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const x0 = STAMP_PAD, y0 = STAMP_PAD;
    const coverH = (c.w * 0.72) * 1.05;
    const lineY0 = y0 + 3 + coverH + 5;
    ctx.fillStyle = "rgba(0,0,0,0.5)"; rrect(ctx, x0 + 2, y0 + 2, c.w, c.h, 4); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.07)"; rrect(ctx, x0, y0, c.w, c.h, 4); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.75)"; ctx.lineWidth = 1.2; rrect(ctx, x0, y0, c.w, c.h, 4); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.15)"; rrect(ctx, x0 + 3, y0 + 3, c.w - 6, coverH, 3); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.08)"; rrect(ctx, x0 + 3, y0 + 3, (c.w - 6) * 0.45, coverH, 3); ctx.fill();
    for (let li = 0; li < c.lines; li++) {
      ctx.fillStyle = li === 0 ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.20)";
      ctx.fillRect(x0 + 4, lineY0 + li * 8, (c.w - 8) * (li === 0 ? 0.78 : 0.52), li === 0 ? 3 : 2);
    }
    return oc;
  }

  function buildVignette(vw: number, vh: number, dpr: number): HTMLCanvasElement {
    const oc = document.createElement("canvas");
    oc.width = Math.round(vw * dpr); oc.height = Math.round(vh * dpr);
    const ctx = oc.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const g = ctx.createRadialGradient(vw / 2, vh / 2, 0, vw / 2, vh / 2, Math.max(vw, vh) * 0.65);
    g.addColorStop(0.15, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.82)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, vw, vh);
    return oc;
  }

  function drawFrame(ctx: CanvasRenderingContext2D, t: number, cw: number, ch: number, dpr: number, cards: CardDef[], trigs: CardTrig[], stamps: HTMLCanvasElement[], vignette: HTMLCanvasElement) {
    ctx.clearRect(0, 0, cw, ch);
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const p = ((t / c.cycleSec) + c.phase) % 1;
      const alpha = p < 0.07 ? (p / 0.07) * c.alpha : p > 0.86 ? ((1 - p) / 0.14) * c.alpha : c.alpha;
      if (alpha < 0.005) continue;
      const cy = c.yStart - p * c.travel;
      const tg = trigs[i];
      const delta = tg.tiltRad * p;
      const cos = tg.cosA * Math.cos(delta) - tg.sinA * Math.sin(delta);
      const sin = tg.sinA * Math.cos(delta) + tg.cosA * Math.sin(delta);
      ctx.globalAlpha = alpha;
      ctx.setTransform(cos * dpr, sin * dpr, -sin * dpr, cos * dpr, c.cx * dpr, cy * dpr);
      const sw = stamps[i].width / dpr, sh = stamps[i].height / dpr;
      ctx.drawImage(stamps[i], -sw / 2, -sh / 2, sw, sh);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    ctx.drawImage(vignette, 0, 0, cw, ch);
  }

  let fps = 0, fpsFrames = 0, fpsLast = 0;
  function tickFps(now: number) {
    fpsFrames++;
    if (now - fpsLast >= 500) {
      fps = Math.round(fpsFrames / ((now - fpsLast) / 1000));
      fpsFrames = 0; fpsLast = now;
      if (fpsEl) fpsEl.textContent = `${fps} fps`;
    }
  }

  function mountCanvas(el: HTMLCanvasElement) {
    const win = getCurrentWindow();
    const ctx = el.getContext("2d")!;
    interface RenderState { cards: CardDef[]; trigs: CardTrig[]; stamps: HTMLCanvasElement[]; vignette: HTMLCanvasElement; CW: number; CH: number; scale: number; }
    let live: RenderState | null = null;
    let lastLogW = 0, lastLogH = 0, lastScale = 0, buildGen = 0;
    async function syncSize() {
      const gen = ++buildGen;
      const [phys, scale] = await Promise.all([win.innerSize(), win.scaleFactor()]);
      if (gen !== buildGen) return;
      const logW = phys.width / scale, logH = phys.height / scale;
      if (logW === lastLogW && logH === lastLogH && scale === lastScale) return;
      lastLogW = logW; lastLogH = logH; lastScale = scale;
      const built  = buildCards(logW, logH);
      const stamps = built.cards.map(c => buildStamp(c, scale));
      const vig    = buildVignette(logW, logH, scale);
      el.width = phys.width; el.height = phys.height;
      live = { cards: built.cards, trigs: built.trigs, stamps, vignette: vig, CW: phys.width, CH: phys.height, scale };
    }
    const ro = new ResizeObserver(() => syncSize());
    ro.observe(el); syncSize();
    let raf = 0, t0 = -1;
    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      if (!live) return;
      if (t0 < 0) t0 = now;
      if (showFps) tickFps(now);
      const { cards, trigs, stamps, vignette, CW, CH, scale } = live;
      drawFrame(ctx, (now - t0) / 1000, CW, CH, scale, cards, trigs, stamps, vignette);
    }
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }

  const ringR    = $derived(44);
  const ringPad  = $derived(8);
  const ringSize = $derived((ringR + ringPad) * 2);
  const ringC    = $derived(ringR + ringPad);
  const ringCirc = $derived(2 * Math.PI * ringR);
  const ringArc  = $derived(ringCirc * Math.min(Math.max(ringProg, 0.025), 0.999));
  const ringTop  = $derived(-((ringSize - 80) / 2));
  const ringLeft = $derived(-((ringSize - 80) / 2));
</script>

<div class="splash" class:exiting style="cursor: {mode === 'idle' ? 'pointer' : 'default'}">
  {#if showCards}
    <canvas style="position:absolute;inset:0;pointer-events:none;width:100%;height:100%" use:mountCanvas></canvas>
    {#if showFps}
      <span bind:this={fpsEl} style="position:absolute;top:8px;right:8px;font-family:var(--font-ui);font-size:10px;color:var(--text-faint);z-index:2;pointer-events:none"></span>
    {/if}
  {/if}

  {#if mode === "idle"}
    <div style="z-index:1;display:flex;flex-direction:column;align-items:center">
      <div style="position:relative;width:128px;height:128px;margin-bottom:32px">
        <div class="logo-glow"></div>
        <img src={logoUrl} alt="Moku" class="logo-breathe" style="width:128px;height:128px;border-radius:28px;display:block;position:relative" />
      </div>
      <p class="hint">press any key to continue</p>
    </div>
  {:else}
    <div style="position:relative;width:80px;height:80px;margin-bottom:20px;z-index:1">
      {#if !failed}
        <svg width={ringSize} height={ringSize} style="position:absolute;pointer-events:none;top:{ringTop}px;left:{ringLeft}px">
          <circle cx={ringC} cy={ringC} r={ringR} fill="none" stroke="var(--border-base)" stroke-width="2" />
          <circle cx={ringC} cy={ringC} r={ringR} fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-dasharray="{ringArc} {ringCirc}" transform="rotate(-90 {ringC} {ringC})" style="transition: stroke-dasharray 0.4s cubic-bezier(0.4,0,0.2,1)" />
        </svg>
      {/if}
      <img src={logoUrl} alt="Moku" style="width:80px;height:80px;border-radius:18px;display:block" />
    </div>
    <p class="title-label">moku</p>
    <div style="z-index:1;display:flex;flex-direction:column;align-items:center;gap:8px">
      {#if failed}
        <p style="font-family:var(--font-ui);font-size:11px;color:var(--color-error);letter-spacing:0.1em;margin:0">Could not reach Suwayomi</p>
        <p style="font-family:var(--font-ui);font-size:10px;color:var(--text-faint);letter-spacing:0.05em;margin:0;text-align:center;max-width:240px;line-height:1.6">Make sure tachidesk-server is on your PATH</p>
        <button class="retry-btn" onclick={onRetry}>Retry</button>
      {:else}
        <p style="font-family:var(--font-ui);font-size:10px;color:var(--text-faint);letter-spacing:0.12em;margin:0;min-width:160px;text-align:center">
          {ringFull ? "Ready" : `Initializing server${dots}`}
        </p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .splash { position: fixed; inset: 0; z-index: 9999; background: var(--bg-base); overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center; animation: spIn 0.35s cubic-bezier(0,0,0.2,1) both; }
  .splash.exiting { animation: spOut 320ms cubic-bezier(0.4,0,1,1) both; }
  @keyframes spIn  { from { opacity:0; transform:scale(1.015) } to { opacity:1; transform:scale(1) } }
  @keyframes spOut { from { opacity:1; transform:scale(1) }     to { opacity:0; transform:scale(0.96) } }
  @keyframes logoBreathe { 0%,100% { transform:scale(1);    filter:drop-shadow(0 0 0px rgba(255,255,255,0)) } 50% { transform:scale(1.04); filter:drop-shadow(0 0 18px rgba(255,255,255,0.12)) } }
  @keyframes hintFade { 0%,100% { opacity:0.35 } 50% { opacity:0.7 } }
  .logo-glow { position: absolute; inset: -20px; border-radius: 50%; background: radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 70%); animation: logoBreathe 4s ease-in-out infinite; }
  .logo-breathe { animation: logoBreathe 4s ease-in-out infinite; }
  .hint { font-family: var(--font-ui); font-size: 10px; color: var(--text-faint); letter-spacing: 0.22em; text-transform: uppercase; margin: 0; user-select: none; animation: hintFade 3.5s ease-in-out infinite; }
  .title-label { font-family: var(--font-ui); font-size: 11px; font-weight: 500; letter-spacing: 0.26em; text-transform: uppercase; color: var(--text-secondary); margin: 0 0 8px; z-index: 1; user-select: none; }
  .retry-btn { margin-top: 4px; padding: 5px 16px; border-radius: var(--radius-md); border: 1px solid var(--border-dim); background: var(--bg-raised); color: var(--text-muted); cursor: pointer; font-family: var(--font-ui); font-size: 11px; letter-spacing: 0.08em; }
</style>
