import { gql }          from "@api/client";
import { GET_MANGA_TRACK_RECORDS } from "@api/queries/tracking";
import { UPDATE_TRACK, FETCH_TRACK } from "@api/mutations/tracking";
import { buildChapterList } from "@features/series/lib/chapterList";
import type { TrackRecord } from "@types/index";
import type { Chapter }     from "@types/index";

class TrackingState {
  records:  TrackRecord[] = $state([]);
  mangaId:  number | null = $state(null);
  loading:  boolean       = $state(false);
  error:    string | null = $state(null);

  async loadForManga(id: number) {
    if (this.mangaId === id && this.records.length > 0) return;
    this.mangaId = id;
    this.loading = true;
    this.error   = null;
    try {
      const res = await gql<{ manga: { trackRecords: { nodes: TrackRecord[] } } }>(
        GET_MANGA_TRACK_RECORDS, { mangaId: id }
      );
      if (this.mangaId !== id) return;
      this.records = res.manga.trackRecords.nodes;
    } catch (e: any) {
      this.error = e?.message ?? "Failed to load tracking";
    } finally {
      this.loading = false;
    }
  }

  async refresh() {
    if (this.mangaId === null) return;
    const id = this.mangaId;
    this.loading = true;
    try {
      const res = await gql<{ manga: { trackRecords: { nodes: TrackRecord[] } } }>(
        GET_MANGA_TRACK_RECORDS, { mangaId: id }
      );
      if (this.mangaId !== id) return;
      this.records = res.manga.trackRecords.nodes;
    } catch (e: any) {
      this.error = e?.message ?? "Failed to refresh tracking";
    } finally {
      this.loading = false;
    }
  }

  patchRecord(updated: Partial<TrackRecord> & { id: number }) {
    this.records = this.records.map(r => r.id === updated.id ? { ...r, ...updated } : r);
  }

  removeRecord(id: number) {
    this.records = this.records.filter(r => r.id !== id);
  }

  clear() {
    this.records = [];
    this.mangaId = null;
    this.error   = null;
  }

  async syncRecordFromRemote(recordId: number) {
    try {
      const res = await gql<{ fetchTrack: { trackRecord: TrackRecord } }>(
        FETCH_TRACK, { recordId }
      );
      this.patchRecord(res.fetchTrack.trackRecord);
      return res.fetchTrack.trackRecord;
    } catch {
      return null;
    }
  }

  async updateFromRead(chapter: Chapter, chapterList: Chapter[], prefs?: import("@features/series/lib/chapterList").ChapterDisplayPrefs) {
    const filtered  = prefs ? buildChapterList(chapterList, { ...prefs, sortDir: "asc" }) : [...chapterList].sort((a, b) => a.sourceOrder - b.sourceOrder);
    const idx       = filtered.findIndex(c => c.id === chapter.id);
    if (idx < 0) return;
    const position  = idx + 1;
    const eligible  = this.records.filter(r => position > (r.lastChapterRead ?? 0));
    for (const record of eligible) {
      try {
        const res = await gql<{ updateTrack: { trackRecord: TrackRecord } }>(
          UPDATE_TRACK, { recordId: record.id, lastChapterRead: position }
        );
        this.patchRecord(res.updateTrack.trackRecord);
      } catch {}
    }
  }
}

export const trackingState = new TrackingState();