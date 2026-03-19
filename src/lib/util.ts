import { clsx, type ClassValue } from "clsx";
import type { Source } from "./types";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

// ── Source deduplication ──────────────────────────────────────────────────────

/**
 * Deduplicates sources by name, preferring the given language.
 * This prevents fetching MangaDex EN + MangaDex ES + MangaDex FR separately —
 * only the preferred-lang variant (or alphabetically first fallback) is kept.
 */
export function dedupeSources(sources: Source[], preferredLang: string): Source[] {
  const byName = new Map<string, Source[]>();
  for (const src of sources) {
    if (src.id === "0") continue;
    if (!byName.has(src.name)) byName.set(src.name, []);
    byName.get(src.name)!.push(src);
  }
  const picked: Source[] = [];
  for (const group of byName.values()) {
    const preferred = group.find((s) => s.lang === preferredLang);
    picked.push(preferred ?? group.sort((a, b) => a.lang.localeCompare(b.lang))[0]);
  }
  return picked;
}

// ── Manga deduplication ───────────────────────────────────────────────────────

/**
 * Deduplicates manga by title (case-insensitive), keeping the first occurrence.
 * Use this when merging results across sources — eliminates the same series
 * appearing multiple times in grids from different source variants.
 */
export function dedupeMangaByTitle<T extends { id: number; title: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const m of items) {
    const key = m.title.toLowerCase().trim();
    if (!seen.has(key)) { seen.add(key); out.push(m); }
  }
  return out;
}

/**
 * Deduplicates manga by id only (lossless — use when sources are already deduped).
 * Use this when merging library results with source results for the same query,
 * where the same manga id may appear in both sets.
 */
export function dedupeMangaById<T extends { id: number }>(items: T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const m of items) {
    if (!seen.has(m.id)) { seen.add(m.id); out.push(m); }
  }
  return out;
}
