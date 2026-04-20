import { createSorter } from "@core/algorithms/sort";
import type { Manga }   from "@types";
import type { LibrarySortMode, LibrarySortDir } from "@store/state.svelte";

export const librarySorter = createSorter<Manga>({
  defaultField: "az",
  defaultDir:   "asc",
  fields: [
    {
      key: "az",
      comparator: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    },
    {
      key: "unreadCount",
      comparator: (a, b) => (a.unreadCount ?? 0) - (b.unreadCount ?? 0),
    },
    {
      key: "totalChapters",
      comparator: (a, b) => (a.chapterCount ?? 0) - (b.chapterCount ?? 0),
    },
    {
      key: "recentlyAdded",
      comparator: (a, b) => a.id - b.id,
    },
    {
      key: "recentlyRead",
      comparator: (a, b, ctx) => {
        const map = ctx?.recentlyReadMap as Map<number, number> | undefined;
        const ra  = map?.get(a.id) ?? 0;
        const rb  = map?.get(b.id) ?? 0;
        return ra - rb;
      },
    },
    {
      key: "latestFetched",
      comparator: (a, b) => a.id - b.id,
    },
    {
      key: "latestUploaded",
      comparator: (a, b) => a.id - b.id,
    },
  ],
});

export function sortLibrary(
  items: Manga[],
  mode: LibrarySortMode,
  dir: LibrarySortDir,
  recentlyReadMap?: Map<number, number>,
): Manga[] {
  return librarySorter.sort(items, mode, dir, recentlyReadMap ? { recentlyReadMap } : undefined);
}
