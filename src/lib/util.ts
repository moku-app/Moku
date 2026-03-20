import { clsx, type ClassValue } from "clsx";
import type { Source } from "./types";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

// ── Source deduplication ──────────────────────────────────────────────────────

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
 * Normalizes a title for fuzzy matching.
 * Strips punctuation, articles, and common source-specific suffixes so that
 * "The Greatest Estate Developer" and "Yeokdaegeum Yeongji Seolgyesa" won't
 * match on title alone — but their identical descriptions will catch them.
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
 * Normalizes a string for fingerprinting — strip all non-alpha, collapse spaces.
 */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Description fingerprint — first 200 normalized chars.
 * Long enough to reliably identify the same series across sources even when
 * translations differ in punctuation or minor wording.
 * Returns null if too short (< 60 chars) to be a reliable signal.
 */
function descFingerprint(desc: string | null | undefined): string | null {
  if (!desc) return null;
  const n = norm(desc);
  if (n.length < 60) return null;
  return n.slice(0, 200);
}

/**
 * Author fingerprint — normalized concatenation of author + artist.
 * Used as a tie-breaker / additional signal alongside description.
 * Two manga with the same authors AND same description are almost certainly
 * the same series. Returns null if no author info.
 */
function authorFingerprint(author?: string | null, artist?: string | null): string | null {
  const parts = [author, artist].filter(Boolean).map(s => norm(s!));
  if (!parts.length) return null;
  return parts.sort().join("|");
}

/**
 * Deduplicates manga by:
 *   1. Normalized title
 *   2. Description fingerprint (first 200 chars)
 *   3. Author + description together
 *   4. User-defined links (mangaLinks from store) — explicit "same series" overrides
 *
 * Pass `links` as `settings.mangaLinks` to honour user-registered pairs.
 * When two entries match, the PREFERRED one is kept:
 *   - Library membership wins
 *   - Otherwise higher downloadCount wins
 *   - Otherwise first occurrence wins
 */
export function dedupeMangaByTitle<T extends {
  id: number;
  title: string;
  description?: string | null;
  author?: string | null;
  artist?: string | null;
  inLibrary?: boolean;
  downloadCount?: number;
}>(items: T[], links: Record<number, number[]> = {}): T[] {
  const byTitle      = new Map<string, number>();
  const byDesc       = new Map<string, number>();
  const byAuthorDesc = new Map<string, number>();
  // id → index in out[]
  const byId         = new Map<number, number>();
  const out: T[] = [];

  for (const m of items) {
    const tk = normalizeTitle(m.title);
    const dk = descFingerprint(m.description);
    const ak = (dk && m.author) ? `${authorFingerprint(m.author, m.artist)}||${dk}` : null;

    // Check user-defined links first (explicit override)
    const linkedIds = links[m.id] ?? [];
    const linkedIdx = linkedIds.map(lid => byId.get(lid)).find(i => i !== undefined);

    const existingIdx =
      linkedIdx ??
      byTitle.get(tk) ??
      (dk ? byDesc.get(dk)       : undefined) ??
      (ak ? byAuthorDesc.get(ak) : undefined);

    if (existingIdx !== undefined) {
      const existing = out[existingIdx];
      const mBetter =
        (m.inLibrary && !existing.inLibrary) ||
        (!existing.inLibrary && (m.downloadCount ?? 0) > (existing.downloadCount ?? 0));

      if (mBetter) {
        out[existingIdx] = m;
        byTitle.set(tk, existingIdx);
        byId.set(m.id, existingIdx);
        if (dk) byDesc.set(dk, existingIdx);
        if (ak) byAuthorDesc.set(ak, existingIdx);
      }
      continue;
    }

    const idx = out.length;
    out.push(m);
    byTitle.set(tk, idx);
    byId.set(m.id, idx);
    if (dk) byDesc.set(dk, idx);
    if (ak) byAuthorDesc.set(ak, idx);
  }

  return out;
}

/**
 * Deduplicates manga by id only (lossless).
 */
export function dedupeMangaById<T extends { id: number }>(items: T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const m of items) {
    if (!seen.has(m.id)) { seen.add(m.id); out.push(m); }
  }
  return out;
}
