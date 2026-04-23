import { gql } from "@api/client";
import { LIBRARY_UPDATE_STATUS } from "@api/queries/manga";
import { UPDATE_LIBRARY } from "@api/mutations/manga";
import { GET_RECENTLY_UPDATED } from "@api/queries/chapters";
import type { LibraryUpdateEntry } from "@store/state.svelte";

const POLL_INTERVAL_MS = 3000;
const POLL_INITIAL_MS  = 2000;

export interface UpdateProgress {
  finished: number;
  total:    number;
}

export interface UpdateResult {
  entries:      LibraryUpdateEntry[];
  totalUpdated: number;
  newChapters:  number;
}

export interface LibraryUpdaterCallbacks {
  onProgress: (p: UpdateProgress) => void;
  onDone:     (r: UpdateResult)   => void;
  onError:    ()                  => void;
}

export function startLibraryUpdate(callbacks: LibraryUpdaterCallbacks): () => void {
  let timer:    ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  const startedAt = Math.floor(Date.now() / 1000);

  function cancel() {
    cancelled = true;
    if (timer) { clearTimeout(timer); timer = null; }
  }

  async function run() {
    let seenWork = false;

    try {
      const res = await gql<{
        updateLibrary: { updateStatus: { jobsInfo: { isRunning: boolean; totalJobs: number } } }
      }>(UPDATE_LIBRARY, {});
      if (cancelled) return;
      seenWork = res.updateLibrary.updateStatus.jobsInfo.totalJobs > 0;
    } catch {
      if (!cancelled) callbacks.onError();
      return;
    }

    function poll() {
      gql<{
        libraryUpdateStatus: {
          jobsInfo:     { isRunning: boolean; finishedJobs: number; totalJobs: number };
          mangaUpdates: { status: string; manga: { id: number } }[];
        }
      }>(LIBRARY_UPDATE_STATUS, {})
        .then(async d => {
          if (cancelled) return;
          const { jobsInfo } = d.libraryUpdateStatus;

          if (jobsInfo.totalJobs > 0) seenWork = true;
          callbacks.onProgress({ finished: jobsInfo.finishedJobs, total: jobsInfo.totalJobs });

          if (!jobsInfo.isRunning && seenWork) {
            const recent = await gql<{
              chapters: {
                nodes: {
                  mangaId:  number;
                  fetchedAt: string;
                  manga: { id: number; title: string; thumbnailUrl: string; inLibrary: boolean };
                }[]
              }
            }>(GET_RECENTLY_UPDATED, {}).catch(() => ({ chapters: { nodes: [] } }));

            if (cancelled) return;

            const byManga = new Map<number, LibraryUpdateEntry>();
            for (const ch of recent.chapters.nodes) {
              if (!ch.manga.inLibrary) continue;
              if (Number(ch.fetchedAt) < startedAt) continue;
              const existing = byManga.get(ch.mangaId);
              if (existing) {
                existing.newChapters++;
              } else {
                byManga.set(ch.mangaId, {
                  mangaId:      ch.mangaId,
                  mangaTitle:   ch.manga.title,
                  thumbnailUrl: ch.manga.thumbnailUrl,
                  newChapters:  1,
                  checkedAt:    Date.now(),
                });
              }
            }

            const entries     = [...byManga.values()];
            const newChapters = entries.reduce((s, e) => s + e.newChapters, 0);

            callbacks.onDone({ entries, totalUpdated: entries.length, newChapters });
            return;
          }

          timer = setTimeout(poll, POLL_INTERVAL_MS);
        })
        .catch(() => {
          if (!cancelled) callbacks.onError();
        });
    }

    timer = setTimeout(poll, POLL_INITIAL_MS);
  }

  run();
  return cancel;
}