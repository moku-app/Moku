import { gql } from "@api/client";
import { MANGAS_BY_GENRE } from "@api/queries/manga";
import { buildTagFilter } from "@features/discover/lib/searchFilter";
import type { Manga } from "@types";
import type { HistoryEntry } from "@store/state.svelte";

export interface RecommendedManga {
  manga:         Manga;
  matchedGenres: string[];
}

const TOP_GENRES   = 6;
const PAGE_SIZE    = 100;
const MAX_PAGES    = 5;

export function topGenres(history: HistoryEntry[], libraryManga: Manga[]): string[] {
  const byId  = new Map(libraryManga.map(m => [m.id, m]));
  const tally = new Map<string, { count: number; original: string }>();

  for (const entry of history) {
    const manga = byId.get(entry.mangaId);
    if (!manga?.genre?.length) continue;
    for (const g of manga.genre) {
      const key      = g.toLowerCase();
      const existing = tally.get(key);
      if (existing) { existing.count++; }
      else { tally.set(key, { count: 1, original: g }); }
    }
  }

  return [...tally.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_GENRES)
    .map(e => e.original);
}

type Result = { mangas: { nodes: Manga[] } };

async function fetchGenrePages(genre: string, signal?: AbortSignal): Promise<Manga[]> {
  const filter = {
    and: [
      buildTagFilter([genre], "OR", []),
      { inLibrary: { equalTo: false } },
    ],
  };

  const pages = await Promise.all(
    Array.from({ length: MAX_PAGES }, (_, i) =>
      gql<Result>(MANGAS_BY_GENRE, { filter, first: PAGE_SIZE, offset: i * PAGE_SIZE }, signal)
        .then(d => d.mangas.nodes)
        .catch(() => [] as Manga[])
    )
  );

  const seen  = new Set<number>();
  const nodes: Manga[] = [];
  for (const page of pages) {
    if (!page.length) break;
    for (const m of page) {
      if (!seen.has(m.id)) { seen.add(m.id); nodes.push(m); }
    }
    if (page.length < PAGE_SIZE) break;
  }
  return nodes;
}

export async function fetchRecommendations(
  history:      HistoryEntry[],
  libraryManga: Manga[],
  signal?:      AbortSignal,
): Promise<RecommendedManga[]> {
  if (!history.length || !libraryManga.length) return [];

  const genres = topGenres(history, libraryManga);
  if (!genres.length) return [];

  const perGenre = await Promise.all(genres.map(g => fetchGenrePages(g, signal)));

  const seen   = new Set<number>();
  const merged: Manga[] = [];
  for (const page of perGenre) {
    for (const m of page) {
      if (!seen.has(m.id)) { seen.add(m.id); merged.push(m); }
    }
  }

  return merged.map(m => ({
    manga: m,
    matchedGenres: (m.genre ?? []).filter(g =>
      genres.some(tg => tg.toLowerCase() === g.toLowerCase())
    ),
  }));
}