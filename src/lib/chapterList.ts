import type { Chapter } from "./types";

export function buildReaderChapterList(
  chapters:   Chapter[],
  mangaPrefs: { preferredScanlator?: string; scanlatorFilter?: string[] } | undefined,
): Chapter[] {
  const preferred = mangaPrefs?.preferredScanlator ?? "";
  const filter    = mangaPrefs?.scanlatorFilter ?? [];

  let base = [...chapters].sort((a, b) => a.sourceOrder - b.sourceOrder);

  if (preferred) {
    const pref: Chapter[] = [], rest: Chapter[] = [];
    for (const c of base) (c.scanlator === preferred ? pref : rest).push(c);
    base = [...pref, ...rest];
  }

  if (filter.length > 0) {
    const seen = new Map<number, Chapter>();
    for (const ch of base) {
      const existing = seen.get(ch.chapterNumber);
      if (!existing) {
        seen.set(ch.chapterNumber, ch);
      } else {
        const np = filter.indexOf(ch.scanlator ?? "");
        const op = filter.indexOf(existing.scanlator ?? "");
        if (np !== -1 && (op === -1 || np < op)) seen.set(ch.chapterNumber, ch);
      }
    }
    base = [...seen.values()].sort((a, b) => a.sourceOrder - b.sourceOrder);
  }

  return base;
}
