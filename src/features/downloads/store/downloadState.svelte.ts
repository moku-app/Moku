import { gql } from "@api/client";
import { GET_DOWNLOAD_STATUS } from "@api/queries";
import {
  START_DOWNLOADER, STOP_DOWNLOADER, CLEAR_DOWNLOADER,
  DEQUEUE_DOWNLOAD, DEQUEUE_CHAPTERS_DOWNLOAD,
  ENQUEUE_DOWNLOAD, REORDER_DOWNLOAD,
} from "@api/mutations";
import { setActiveDownloads } from "@store/state.svelte";
import type { DownloadStatus } from "@types/index";
import {
  toActiveDownloads, optimisticRemove, optimisticRemoveMany,
  isRunning, getErrored, calcSpeed, estimateEta,
  type SpeedSample,
} from "../lib/downloadQueue";

class DownloadStore {
  status:       DownloadStatus | null = $state(null);
  loading                             = $state(true);
  togglingPlay                        = $state(false);
  clearing                            = $state(false);
  dequeueing                          = $state(new Set<number>());
  selected                            = $state(new Set<number>());
  batchWorking                        = $state(false);
  pagesPerSec:  number | null         = $state(null);
  eta:          number | null         = $state(null);

  private lastSample: SpeedSample | null = null;

  get queue()      { return this.status?.queue ?? []; }
  get isRunning()  { return isRunning(this.status?.state); }
  get erroredIds() { return new Set(getErrored(this.queue).map((i) => i.chapter.id)); }
  get hasErrored() { return this.erroredIds.size > 0; }

  applyStatus(ds: DownloadStatus) {
    this.status = ds;
    setActiveDownloads(toActiveDownloads(ds.queue));
    this.updateSpeed(ds);
  }

  private updateSpeed(ds: DownloadStatus) {
    const active = ds.queue[0];
    if (!active || active.state !== "DOWNLOADING") {
      this.lastSample = null;
      this.pagesPerSec = null;
      this.eta = null;
      return;
    }
    const sample: SpeedSample = {
      ts:       Date.now(),
      progress: active.progress,
      pages:    active.chapter.pageCount ?? 0,
    };
    const speed = calcSpeed(this.lastSample, sample);
    this.lastSample = sample;
    if (speed !== null) {
      this.pagesPerSec = speed;
      this.eta = estimateEta(speed, ds.queue);
    }
  }

  async poll() {
    gql<{ downloadStatus: DownloadStatus }>(GET_DOWNLOAD_STATUS)
      .then((d) => this.applyStatus(d.downloadStatus))
      .catch(console.error)
      .finally(() => { this.loading = false; });
  }

  async togglePlay() {
    if (this.togglingPlay) return;
    this.togglingPlay = true;
    const wasRunning = this.isRunning;
    if (this.status) this.status = { ...this.status, state: wasRunning ? "STOPPED" : "STARTED" };
    try {
      if (wasRunning) {
        const d = await gql<{ stopDownloader: { downloadStatus: DownloadStatus } }>(STOP_DOWNLOADER);
        this.applyStatus(d.stopDownloader.downloadStatus);
      } else {
        const d = await gql<{ startDownloader: { downloadStatus: DownloadStatus } }>(START_DOWNLOADER);
        this.applyStatus(d.startDownloader.downloadStatus);
      }
    } catch (e) { console.error(e); this.poll(); }
    finally { this.togglingPlay = false; }
  }

  async clear() {
    if (this.clearing) return;
    this.clearing = true;
    this.selected = new Set();
    if (this.status) this.status = { ...this.status, queue: [] };
    setActiveDownloads([]);
    try {
      const d = await gql<{ clearDownloader: { downloadStatus: DownloadStatus } }>(CLEAR_DOWNLOADER);
      this.applyStatus(d.clearDownloader.downloadStatus);
    } catch (e) { console.error(e); this.poll(); }
    finally { this.clearing = false; }
  }

  async dequeue(chapterId: number) {
    if (this.dequeueing.has(chapterId)) return;
    this.dequeueing = new Set(this.dequeueing).add(chapterId);
    if (this.status) this.status = { ...this.status, queue: optimisticRemove(this.status.queue, chapterId) };
    this.selected.delete(chapterId);
    this.selected = new Set(this.selected);
    try { await gql(DEQUEUE_DOWNLOAD, { chapterId }); this.poll(); }
    catch (e) { console.error(e); this.poll(); }
    finally { this.dequeueing.delete(chapterId); this.dequeueing = new Set(this.dequeueing); }
  }

  async dequeueSelected() {
    if (this.batchWorking || this.selected.size === 0) return;
    this.batchWorking = true;
    const ids = [...this.selected];
    if (this.status) this.status = { ...this.status, queue: optimisticRemoveMany(this.status.queue, this.selected) };
    this.selected = new Set();
    try {
      await gql(DEQUEUE_CHAPTERS_DOWNLOAD, { chapterIds: ids });
      this.poll();
    } catch (e) { console.error(e); this.poll(); }
    finally { this.batchWorking = false; }
  }

  async retryOne(chapterId: number) {
    if (this.dequeueing.has(chapterId)) return;
    this.dequeueing = new Set(this.dequeueing).add(chapterId);
    try {
      await gql(DEQUEUE_DOWNLOAD, { chapterId });
      await gql(ENQUEUE_DOWNLOAD, { chapterId });
      this.poll();
    } catch (e) { console.error(e); this.poll(); }
    finally { this.dequeueing.delete(chapterId); this.dequeueing = new Set(this.dequeueing); }
  }

  async retryAllErrored() {
    if (this.batchWorking || !this.hasErrored) return;
    this.batchWorking = true;
    const ids = [...this.erroredIds];
    try {
      await gql(DEQUEUE_CHAPTERS_DOWNLOAD, { chapterIds: ids });
      for (const id of ids) await gql(ENQUEUE_DOWNLOAD, { chapterId: id });
      this.poll();
    } catch (e) { console.error(e); this.poll(); }
    finally { this.batchWorking = false; }
  }

  async retrySelected() {
    if (this.batchWorking || this.selected.size === 0) return;
    this.batchWorking = true;
    const ids = [...this.selected].filter((id) => this.erroredIds.has(id));
    this.selected = new Set();
    try {
      if (ids.length > 0) {
        await gql(DEQUEUE_CHAPTERS_DOWNLOAD, { chapterIds: ids });
        for (const id of ids) await gql(ENQUEUE_DOWNLOAD, { chapterId: id });
      }
      this.poll();
    } catch (e) { console.error(e); this.poll(); }
    finally { this.batchWorking = false; }
  }

  async reorder(chapterId: number, direction: "up" | "down") {
    const idx = this.queue.findIndex((i) => i.chapter.id === chapterId);
    if (idx === -1) return;
    const to = direction === "up" ? idx - 1 : idx + 1;
    if (to < 0 || to >= this.queue.length) return;
    const newQueue = [...this.queue];
    [newQueue[idx], newQueue[to]] = [newQueue[to], newQueue[idx]];
    if (this.status) this.status = { ...this.status, queue: newQueue };
    try {
      const d = await gql<{ reorderChapterDownload: { downloadStatus: DownloadStatus } }>(
        REORDER_DOWNLOAD, { chapterId, to },
      );
      this.applyStatus(d.reorderChapterDownload.downloadStatus);
    } catch (e) { console.error(e); this.poll(); }
  }

  selectOnly(chapterId: number) {
    this.selected = new Set([chapterId]);
  }

  async reorderSelected(direction: "up" | "down") {
    if (this.batchWorking || this.selected.size === 0) return;
    this.batchWorking = true;

    const queue = [...this.queue];
    const selectedIndices = queue
      .map((item, i) => ({ id: item.chapter.id, i }))
      .filter(({ id }) => this.selected.has(id))
      .map(({ i }) => i)
      .sort((a, b) => direction === "up" ? a - b : b - a);

    if (direction === "up"  && selectedIndices[0] === 0) { this.batchWorking = false; return; }
    if (direction === "down" && selectedIndices[0] === queue.length - 1) { this.batchWorking = false; return; }

    const newQueue = [...queue];
    for (const idx of selectedIndices) {
      const to = direction === "up" ? idx - 1 : idx + 1;
      if (to < 0 || to >= newQueue.length) break;
      [newQueue[idx], newQueue[to]] = [newQueue[to], newQueue[idx]];
    }
    if (this.status) this.status = { ...this.status, queue: newQueue };

    try {
      for (const idx of selectedIndices) {
        const to = direction === "up" ? idx - 1 : idx + 1;
        if (to < 0 || to >= queue.length) break;
        const chapterId = queue[idx].chapter.id;
        await gql<{ reorderChapterDownload: { downloadStatus: DownloadStatus } }>(
          REORDER_DOWNLOAD, { chapterId, to },
        );
      }
      this.poll();
    } catch (e) { console.error(e); this.poll(); }
    finally { this.batchWorking = false; }
  }

  toggleSelect(chapterId: number) {
    const next = new Set(this.selected);
    if (next.has(chapterId)) next.delete(chapterId);
    else next.add(chapterId);
    this.selected = next;
  }

  selectRange(fromId: number, toId: number) {
    const ids = this.queue.map((i) => i.chapter.id);
    const a = ids.indexOf(fromId), b = ids.indexOf(toId);
    if (a === -1 || b === -1) return;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const next = new Set(this.selected);
    for (let i = lo; i <= hi; i++) next.add(ids[i]);
    this.selected = next;
  }

  selectAll() {
    this.selected = new Set(this.queue.map((i) => i.chapter.id));
  }

  clearSelection() {
    this.selected = new Set();
  }
}

export const downloadStore = new DownloadStore();