import { getBlobUrl } from "@core/cache/imageCache";

const HASH_SIZE    = 8;
const HASH_PIXELS  = HASH_SIZE * HASH_SIZE;
const CANVAS_SIZE  = 32;
const DUPE_THRESH  = 10;

const hashCache = new Map<string, Uint8Array>();

async function loadGrayscale(blobUrl: string): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = CANVAS_SIZE;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      const { data } = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      const gray = new Uint8ClampedArray(CANVAS_SIZE * CANVAS_SIZE);
      for (let i = 0; i < gray.length; i++) {
        const o = i * 4;
        gray[i] = (data[o] * 299 + data[o + 1] * 587 + data[o + 2] * 114) / 1000;
      }
      resolve(gray);
    };
    img.onerror = reject;
    img.src = blobUrl;
  });
}

function dct8x8(gray: Uint8ClampedArray): number[] {
  const N    = CANVAS_SIZE;
  const step = N / HASH_SIZE;
  const block: number[] = [];

  for (let by = 0; by < HASH_SIZE; by++) {
    for (let bx = 0; bx < HASH_SIZE; bx++) {
      let sum = 0, count = 0;
      for (let dy = 0; dy < step; dy++) {
        for (let dx = 0; dx < step; dx++) {
          sum += gray[(by * step + dy) * N + (bx * step + dx)];
          count++;
        }
      }
      block.push(sum / count);
    }
  }
  return block;
}

function pHash(block: number[]): Uint8Array {
  const mean = block.reduce((a, b) => a + b, 0) / HASH_PIXELS;
  const bits = new Uint8Array(Math.ceil(HASH_PIXELS / 8));
  for (let i = 0; i < HASH_PIXELS; i++) {
    if (block[i] >= mean) bits[i >> 3] |= 1 << (i & 7);
  }
  return bits;
}

function hammingDistance(a: Uint8Array, b: Uint8Array): number {
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    let x = a[i] ^ b[i];
    while (x) { dist += x & 1; x >>= 1; }
  }
  return dist;
}

export async function getHash(url: string, priority = -1): Promise<Uint8Array | null> {
  if (hashCache.has(url)) return hashCache.get(url)!;
  try {
    const blob  = await getBlobUrl(url, priority);
    const gray  = await loadGrayscale(blob);
    const block = dct8x8(gray);
    const hash  = pHash(block);
    hashCache.set(url, hash);
    return hash;
  } catch {
    return null;
  }
}

export function areDuplicates(a: Uint8Array, b: Uint8Array): boolean {
  return hammingDistance(a, b) <= DUPE_THRESH;
}

export function clearHashCache(): void {
  hashCache.clear();
}