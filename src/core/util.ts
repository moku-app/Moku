import type { Manga, Source } from "@types";
import type { Settings } from "@types";

// ── Class utility ─────────────────────────────────────────────────────────────

export { clsx as cn } from "clsx";

// ── Time / formatting ─────────────────────────────────────────────────────────

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts, m = Math.floor(diff / 60000);
  if (m < 1)  return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `${d}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function dayLabel(ts: number): string {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export function formatReadTime(m: number): string {
  if (m < 1)  return "< 1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

// ── NSFW filtering ────────────────────────────────────────────────────────────

/**
 * Default genre substrings used when no user-configured list is available.
 * Stored as settings.nsfwFilteredTags; editable in Settings > Content.
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
 * Returns true if the manga's genre list contains any of the given substrings.
 * Falls back to DEFAULT_NSFW_TAGS if no tag list is provided.
 */
export function isNsfwManga(
  manga: { genre?: string[] | null },
  tags: string[] = DEFAULT_NSFW_TAGS,
): boolean {
  return (manga.genre ?? []).some(g =>
    tags.some(sub => g.toLowerCase().trim().includes(sub))
  );
}

/**
 * Single authoritative NSFW gate used by all views.
 * Returns true when the manga should be HIDDEN. Priority order:
 *   1. Source in blockedSourceIds → always hidden, even when showNsfw is on.
 *   2. showNsfw globally enabled → only blocked sources are hidden.
 *   3. Source in allowedSourceIds → skip isNsfw flag, but genre tags still apply.
 *   4. source.isNsfw flag → hidden.
 *   5. Genre tag match → hidden.
 *
 * Usage: items.filter(m => !shouldHideNsfw(m, settings))
 */
export function shouldHideNsfw(
  manga: Pick<Manga, "genre" | "source">,
  settings: Pick<Settings, "showNsfw" | "nsfwFilteredTags" | "nsfwAllowedSourceIds" | "nsfwBlockedSourceIds">,
): boolean {
  const srcId = manga.source?.id;

  if (srcId && settings.nsfwBlockedSourceIds.includes(srcId)) return true;
  if (settings.showNsfw) return false;

  const sourceAllowed = !!(srcId && settings.nsfwAllowedSourceIds.includes(srcId));
  if (!sourceAllowed && manga.source?.isNsfw) return true;

  return isNsfwManga(manga, settings.nsfwFilteredTags);
}

/**
 * Gate for Source objects — parallel to shouldHideNsfw for manga.
 * Usage: sources.filter(s => !shouldHideSource(s, settings))
 */
export function shouldHideSource(
  source: Pick<Source, "id" | "isNsfw">,
  settings: Pick<Settings, "showNsfw" | "nsfwAllowedSourceIds" | "nsfwBlockedSourceIds">,
): boolean {
  if (settings.nsfwBlockedSourceIds.includes(source.id)) return true;
  if (settings.nsfwAllowedSourceIds.includes(source.id)) return false;
  return !settings.showNsfw && source.isNsfw;
}

// ── Source deduplication ──────────────────────────────────────────────────────

/**
 * Deduplicates sources by name. When multiple sources share a name,
 * the preferred language wins; otherwise falls back to alphabetical by lang.
 * The local source (id "0") is always excluded.
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
    const preferred = group.find(s => s.lang === preferredLang);
    picked.push(preferred ?? group.sort((a, b) => a.lang.localeCompare(b.lang))[0]);
  }
  return picked;
}

// ── Manga deduplication ───────────────────────────────────────────────────────

/** Strips punctuation, articles, and source suffixes for fuzzy title matching. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(official\)|\(web comic\)|\(webtoon\)|\(manhwa\)|\(manhua\)/gi, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/^(the|a|an)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strips all non-alphanumeric chars and collapses whitespace. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * First 200 normalized chars of a description — reliable cross-source fingerprint.
 * Returns null if too short (< 60 chars) to be a trustworthy signal.
 */
function descFingerprint(desc: string | null | undefined): string | null {
  if (!desc) return null;
  const n = norm(desc);
  return n.length >= 60 ? n.slice(0, 200) : null;
}

/**
 * Normalized author + artist concatenation for tie-breaking.
 * Returns null if no author info available.
 */
function authorFingerprint(author?: string | null, artist?: string | null): string | null {
  const parts = [author, artist].filter(Boolean).map(s => norm(s!));
  return parts.length ? parts.sort().join("|") : null;
}

/**
 * Deduplicates manga across sources using title, description, and author signals,
 * plus explicit user-defined links (settings.mangaLinks).
 *
 * When two entries match, the better one is kept:
 *   - Library membership wins over non-library.
 *   - Otherwise higher downloadCount wins.
 *   - Otherwise first occurrence wins.
 */
export function dedupeMangaByTitle<T extends {
  id:             number;
  title:          string;
  description?:   string | null;
  author?:        string | null;
  artist?:        string | null;
  inLibrary?:     boolean;
  downloadCount?: number;
}>(items: T[], links: Record<number, number[]> = {}): T[] {
  const byTitle      = new Map<string, number>();
  const byDesc       = new Map<string, number>();
  const byAuthorDesc = new Map<string, number>();
  const byId         = new Map<number, number>();
  const out: T[]     = [];

  for (const m of items) {
    const tk = normalizeTitle(m.title);
    const dk = descFingerprint(m.description);
    const ak = (dk && m.author) ? `${authorFingerprint(m.author, m.artist)}||${dk}` : null;

    const linkedIds   = links[m.id] ?? [];
    const linkedIdx   = linkedIds.map(lid => byId.get(lid)).find(i => i !== undefined);
    const existingIdx =
      linkedIdx ??
      byTitle.get(tk) ??
      (dk ? byDesc.get(dk)       : undefined) ??
      (ak ? byAuthorDesc.get(ak) : undefined);

    if (existingIdx !== undefined) {
      const existing = out[existingIdx];
      const mBetter  =
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
 * Lossless deduplication by ID only. Preserves first occurrence.
 */
export function dedupeMangaById<T extends { id: number }>(items: T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const m of items) {
    if (!seen.has(m.id)) { seen.add(m.id); out.push(m); }
  }
  return out;
}