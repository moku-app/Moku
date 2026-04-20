import type { Manga, Source } from "@types";
import type { Settings }      from "@types";
import { shouldHideSource }   from "@core/util";

// ── Source deduplication ──────────────────────────────────────────────────────

/**
 * Deduplicates sources by name, preferring `preferredLang` when multiple
 * sources share a name. The local source (id "0") is always excluded.
 *
 * When `applyHide` is true, sources that fail the NSFW/block check are
 * also removed — used in fan-out and cache-build paths where only
 * user-visible sources should be queried.
 */
export function dedupeSourcesByLang(
  sources:      Source[],
  preferredLang: string,
  settings:     Pick<Settings, "showNsfw" | "nsfwAllowedSourceIds" | "nsfwBlockedSourceIds">,
  applyHide     = false,
): Source[] {
  const map = new Map<string, Source>();
  for (const s of sources) {
    if (s.id === "0") continue;
    if (applyHide && shouldHideSource(s, settings)) continue;
    const existing = map.get(s.name);
    if (!existing) { map.set(s.name, s); continue; }
    const existingPref = existing.lang === preferredLang;
    const newPref      = s.lang === preferredLang;
    if (newPref && !existingPref) map.set(s.name, s);
    else if (!existingPref && !newPref && s.lang < existing.lang) map.set(s.name, s);
  }
  return Array.from(map.values());
}

// ── Manga predicate filters ───────────────────────────────────────────────────

/**
 * Generic predicate pipeline — composes multiple boolean predicates into one.
 * All predicates must return true for an item to pass.
 *
 * Usage:
 *   const keep = buildFilter<Manga>(
 *     m => !shouldHideNsfw(m, settings),
 *     m => m.inLibrary,
 *   );
 *   const filtered = items.filter(keep);
 */
export function buildFilter<T>(...predicates: ((item: T) => boolean)[]): (item: T) => boolean {
  return (item) => predicates.every((p) => p(item));
}
