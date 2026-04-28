import { store }                    from "@store/state.svelte";
import { searchWithScore }          from "@core/algorithms/search";
import { getHash, areDuplicates }   from "@features/series/lib/coverHash";

type CoverManga = { id: number; thumbnailUrl: string; source?: { displayName: string } | null };

export type CoverCandidate = {
  mangaId:  number;
  url:      string;
  label:    string;
  isActive: boolean;
};

const FUZZY_SCORE_THRESHOLD = 0.5;

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    return u.href.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function resolvedCover(mangaId: number, ownUrl: string): string {
  return store.settings.mangaPrefs?.[mangaId]?.coverUrl ?? ownUrl;
}

function fuzzyMatchIds(
  mangaId:  number,
  title:    string,
  mangaById: Map<number, CoverManga & { title: string }>,
): number[] {
  const results = searchWithScore(
    [...mangaById.values()].filter(m => m.id !== mangaId),
    title,
    m => m.title,
  );
  return results
    .filter(r => r.score >= FUZZY_SCORE_THRESHOLD)
    .map(r => r.item.id);
}

export function coverCandidatesSync(
  mangaId:   number,
  title:     string,
  ownUrl:    string,
  mangaById: Map<number, CoverManga & { title: string }>,
): CoverCandidate[] {
  const linkedIds  = store.getLinkedMangaIds(mangaId);
  const fuzzyIds   = fuzzyMatchIds(mangaId, title, mangaById);
  const current    = store.settings.mangaPrefs?.[mangaId]?.coverUrl ?? ownUrl;

  const allIds = Array.from(new Set([...linkedIds, ...fuzzyIds]));

  const raw: { mangaId: number; url: string; label: string }[] = [
    { mangaId, url: ownUrl, label: "This source" },
    ...allIds.flatMap(id => {
      const m = mangaById.get(id);
      return m ? [{ mangaId: m.id, url: m.thumbnailUrl, label: m.source?.displayName ?? `ID ${m.id}` }] : [];
    }),
  ];

  const seen = new Set<string>();
  return raw
    .filter(c => {
      const key = normalizeUrl(c.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(c => ({ ...c, isActive: normalizeUrl(c.url) === normalizeUrl(current) }));
}

export async function dedupeByImage(candidates: CoverCandidate[]): Promise<CoverCandidate[]> {
  const hashes = await Promise.all(candidates.map(c => getHash(c.url)));

  const keptIndices: number[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const hi = hashes[i];
    if (!hi) { keptIndices.push(i); continue; }

    const isDupe = keptIndices.some(j => {
      const hj = hashes[j];
      return hj ? areDuplicates(hi, hj) : false;
    });

    if (!isDupe) keptIndices.push(i);
  }

  return keptIndices.map(i => candidates[i]);
}