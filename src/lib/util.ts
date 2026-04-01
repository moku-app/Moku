import { clsx, type ClassValue } from "clsx";
import type { Source } from "./types";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

// ── NSFW genre filtering ──────────────────────────────────────────────────────

/**
 * Default substrings used when no user-configured list is available.
 * The Settings > Content tab lets users add/remove entries from this list,
 * which is stored as settings.nsfwFilteredTags.
 */
export const DEFAULT_NSFW_TAGS = [
  "adult",
  "mature",
  "hentai",
  "ecchi",
  "erotic",       // catches "erotica", "erotic content", "erotic manga"
  "pornograph",   // catches "pornographic", "pornography"
  "18+",
  "smut",
  "lemon",
  "explicit",
  "sexual violence",
];

/**
 * Returns true if the manga carries at least one genre tag matching any of
 * the provided substrings (case-insensitive). Pass settings.nsfwFilteredTags
 * as the tag list; falls back to DEFAULT_NSFW_TAGS if omitted.
 */
export function isNsfwManga(
  manga: { genre?: string[] | null },
  tags: string[] = DEFAULT_NSFW_TAGS,
): boolean {
  return (manga.genre ?? []).some((g) => {
    const normalized = g.toLowerCase().trim();
    return tags.some((sub) => normalized.includes(sub));
  });
}

/**
 * Single authoritative NSFW gate used by all views.
 *
 * Returns true when the manga should be HIDDEN. Checks in order:
 *   1. showNsfw disabled globally → skip everything, hide by source flag or genre match.
 *   2. Source is in blockedSourceIds → always hide regardless of showNsfw.
 *   3. Source is in allowedSourceIds → always show (bypasses isNsfw flag only, genre tags still apply).
 *   4. Source isNsfw flag → hide unless source is allowed.
 *   5. Genre tag match → hide.
 *
 * Usage:  items.filter(m => !shouldHideNsfw(m, settings))
 */
export function shouldHideNsfw(
  manga: {
    genre?: string[] | null;
    source?: { id?: string; isNsfw?: boolean } | null;
  },
  settings: {
    showNsfw:            boolean;
    nsfwFilteredTags:    string[];
    nsfwAllowedSourceIds: string[];
    nsfwBlockedSourceIds: string[];
  },
): boolean {
  const srcId = manga.source?.id;

  // Explicit block always wins, even when showNsfw is on
  if (srcId && settings.nsfwBlockedSourceIds.includes(srcId)) return true;

  // If NSFW is globally allowed, only explicit blocks apply
  if (settings.showNsfw) return false;

  // Source is explicitly allowed — skip the isNsfw flag check, but still filter genres
  const sourceAllowed = !!(srcId && settings.nsfwAllowedSourceIds.includes(srcId));

  if (!sourceAllowed && manga.source?.isNsfw) return true;

  return isNsfwManga(manga, settings.nsfwFilteredTags);
}

/**
 * Gate for Source objects — parallel to shouldHideNsfw for manga.
 *
 * Priority:
 *   1. Blocked list → always hidden, even when showNsfw is on.
 *   2. Allowed list → always shown, even if isNsfw is true.
 *   3. Fallback     → hide when showNsfw is off and source.isNsfw is true.
 *
 * Usage:  sources.filter(s => !shouldHideSource(s, settings))
 */
export function shouldHideSource(
  source: { id: string; isNsfw: boolean },
  settings: {
    showNsfw:             boolean;
    nsfwAllowedSourceIds: string[];
    nsfwBlockedSourceIds: string[];
  },
): boolean {
  if (settings.nsfwBlockedSourceIds.includes(source.id)) return true;
  if (settings.nsfwAllowedSourceIds.includes(source.id)) return false;
  return !settings.showNsfw && source.isNsfw;
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
