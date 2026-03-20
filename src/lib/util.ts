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
 * Normalizes a title for fuzzy matching:
 * - Lowercases and trims
 * - Strips common subtitle suffixes: "(Official)", "(Web Comic)", etc.
 * - Removes all non-alphanumeric characters (punctuation, dashes, colons)
 * - Strips leading articles: "the ", "a ", "an "
 * - Collapses whitespace
 *
 * "The Solo Leveling: Official Comic" → "solo leveling official comic"
 * "Solo Leveling (Web Comic)"         → "solo leveling web comic"
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(official\)|\(web comic\)|\(webtoon\)|\(manhwa\)|\(manhua\)/gi, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/^(the|a|an)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Builds a short fingerprint from a description — first 120 chars, normalized.
 * Used as a secondary dedup signal when titles differ but the series is the same.
 * Returns null if the description is too short to be a reliable signal (< 40 chars).
 */
function descFingerprint(desc: string | null | undefined): string | null {
  if (!desc) return null;
  const norm = desc.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (norm.length < 40) return null;
  return norm.slice(0, 120);
}

/**
 * Deduplicates manga by normalized title OR description fingerprint, keeping the
 * first occurrence. Runs in a single O(n) pass — no nested loops.
 *
 * Use this when merging results across sources. Same series from different source
 * variants (e.g. MangaDex EN + Asura Scans) will be collapsed.
 *
 * The kept entry is the first one seen, so prefer passing library manga first so
 * the richer/preferred entry survives.
 */
export function dedupeMangaByTitle<T extends { id: number; title: string; description?: string | null }>(items: T[]): T[] {
  const seenTitles = new Set<string>();
  const seenDescs  = new Set<string>();
  const out: T[] = [];
  for (const m of items) {
    const tk = normalizeTitle(m.title);
    const dk = descFingerprint(m.description);
    if (seenTitles.has(tk)) continue;
    if (dk && seenDescs.has(dk)) continue;
    seenTitles.add(tk);
    if (dk) seenDescs.add(dk);
    out.push(m);
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

/**
 * Groups items that share a normalized title or description fingerprint.
 * Returns an array of groups — single-member groups are non-duplicates,
 * multi-member groups are the same series from different sources.
 *
 * Used by MangaPreview to show alternate thumbnails for merged entries.
 */
export function groupDuplicates<T extends { id: number; title: string; description?: string | null }>(items: T[]): T[][] {
  const titleMap = new Map<string, T[]>();
  const descMap  = new Map<string, T[]>();

  for (const m of items) {
    const tk = normalizeTitle(m.title);
    const dk = descFingerprint(m.description);

    const existingGroup = titleMap.get(tk) ?? (dk ? descMap.get(dk) : undefined);
    if (existingGroup) {
      existingGroup.push(m);
      if (!titleMap.has(tk)) titleMap.set(tk, existingGroup);
      if (dk && !descMap.has(dk)) descMap.set(dk, existingGroup);
    } else {
      const group = [m];
      titleMap.set(tk, group);
      if (dk) descMap.set(dk, group);
    }
  }

  // Return unique groups only
  const seen = new Set<T[]>();
  const out: T[][] = [];
  for (const g of titleMap.values()) {
    if (!seen.has(g)) { seen.add(g); out.push(g); }
  }
  return out;
}
