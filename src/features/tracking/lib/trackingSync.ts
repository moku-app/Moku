import type { Tracker, TrackRecord } from "@types/index";
import type { Chapter } from "@types/index";
import { MARK_CHAPTERS_READ } from "@api/mutations/chapters";
import { buildChapterList, type ChapterDisplayPrefs } from "@features/series/lib/chapterList";

export interface TrackerWithRecords extends Tracker {
  trackRecords: { nodes: TrackRecord[] };
}

export interface FlatRecord extends TrackRecord {
  tracker: Tracker;
}

export type SortKey = "title" | "status" | "score" | "progress";

export function flattenRecords(trackers: TrackerWithRecords[]): FlatRecord[] {
  return trackers
    .filter((t) => t.isLoggedIn)
    .flatMap((t) =>
      t.trackRecords.nodes.map((r) => ({
        ...r,
        trackerId: r.trackerId ?? t.id,
        tracker: t as Tracker,
      }))
    );
}

export function dedupeStatuses(trackers: TrackerWithRecords[]): { value: number; name: string }[] {
  const seen = new Map<string, { value: number; name: string }>();
  for (const t of trackers.filter((t) => t.isLoggedIn))
    for (const s of t.statuses ?? [])
      seen.set(`${s.value}:${s.name}`, s);
  return [...seen.values()];
}

export function filterRecords(
  records: FlatRecord[],
  trackerId: number | "all",
  statusFilter: number | "all",
  query: string,
): FlatRecord[] {
  let list = trackerId === "all"
    ? records
    : records.filter((r) => Number(r.trackerId) === Number(trackerId));

  if (statusFilter !== "all")
    list = list.filter((r) => Number(r.status) === Number(statusFilter));

  if (query.trim()) {
    const q = query.toLowerCase();
    list = list.filter((r) =>
      r.title.toLowerCase().includes(q) ||
      r.manga?.title?.toLowerCase().includes(q)
    );
  }

  return list;
}

export function sortRecords(records: FlatRecord[], sortBy: SortKey): FlatRecord[] {
  return [...records].sort((a, b) => {
    if (sortBy === "title")    return a.title.localeCompare(b.title);
    if (sortBy === "status")   return a.status - b.status;
    if (sortBy === "score")    return parseFloat(b.displayScore ?? "0") - parseFloat(a.displayScore ?? "0");
    if (sortBy === "progress") {
      const ap = a.totalChapters > 0 ? a.lastChapterRead / a.totalChapters : 0;
      const bp = b.totalChapters > 0 ? b.lastChapterRead / b.totalChapters : 0;
      return bp - ap;
    }
    return 0;
  });
}

export function scoreToStars(score: string | undefined, scores: string[] | undefined): number {
  if (!score || !scores || scores.length === 0) return 0;
  const idx = scores.indexOf(score);
  if (idx < 0) return 0;
  return Math.round((idx / (scores.length - 1)) * 5);
}

export function calcProgress(lastChapterRead: number, totalChapters: number): number | null {
  if (totalChapters <= 0) return null;
  return Math.min(100, (lastChapterRead / totalChapters) * 100);
}

export function patchTracker(
  trackers: TrackerWithRecords[],
  trackerId: number,
  updated: Partial<TrackRecord> & { id: number },
): TrackerWithRecords[] {
  return trackers.map((t) =>
    t.id !== trackerId ? t : {
      ...t,
      trackRecords: {
        nodes: t.trackRecords.nodes.map((r) =>
          r.id === updated.id ? { ...r, ...updated } : r
        ),
      },
    }
  );
}

export function removeRecord(
  trackers: TrackerWithRecords[],
  trackerId: number,
  recordId: number,
): TrackerWithRecords[] {
  return trackers.map((t) =>
    t.id !== trackerId ? t : {
      ...t,
      trackRecords: { nodes: t.trackRecords.nodes.filter((r) => r.id !== recordId) },
    }
  );
}

export interface SyncBackOptions {
  threshold:              number | null;
  respectScanlatorFilter: boolean;
  chapterPrefs:           ChapterDisplayPrefs;
}

export async function syncBackFromTracker(
  records:  TrackRecord[],
  chapters: Chapter[],
  opts:     SyncBackOptions,
  gqlFn:    (query: string, vars: Record<string, unknown>) => Promise<unknown>,
): Promise<number[]> {
  const eligible = buildChapterList(chapters, {
    ...opts.chapterPrefs,
    sortDir: "asc",
    ...(opts.respectScanlatorFilter ? {} : {
      scanlatorFilter:   [],
      scanlatorBlacklist: [],
      scanlatorForce:    false,
    }),
  });

  const toMarkRead: number[] = [];

  for (const record of records) {
    const remote = record.lastChapterRead;
    if (!remote || remote <= 0) continue;

    for (const chapter of eligible) {
      if (chapter.isRead) continue;
      const diff = Math.abs(chapter.chapterNumber - remote);
      if (opts.threshold !== null && diff > opts.threshold) continue;
      if (chapter.chapterNumber <= remote) toMarkRead.push(chapter.id);
    }
  }

  const ids = [...new Set(toMarkRead)];
  if (ids.length > 0) {
    await gqlFn(MARK_CHAPTERS_READ, { ids, isRead: true });
  }

  return ids;
}