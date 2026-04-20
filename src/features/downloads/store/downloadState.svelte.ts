import { gql } from "@api/client";
import { GET_DOWNLOAD_STATUS } from "@api/queries";
import { START_DOWNLOADER, STOP_DOWNLOADER, CLEAR_DOWNLOADER, DEQUEUE_DOWNLOAD } from "@api/mutations";
import { setActiveDownloads } from "@store/state.svelte";
import type { DownloadStatus } from "@types/index";
import { toActiveDownloads, optimisticRemove, isRunning } from "../lib/downloadQueue";

class DownloadStore {
  status: DownloadStatus | null = $state(null);
  loading                       = $state(true);
  togglingPlay                  = $state(false);
  clearing                      = $state(false);
  dequeueing                    = $state(new Set<number>());

  get queue()      { return this.status?.queue ?? []; }
  get isRunning()  { return isRunning(this.status?.state); }

  applyStatus(ds: DownloadStatus) {
    this.status = ds;
    setActiveDownloads(toActiveDownloads(ds.queue));
  }

  async poll() {
    gql<{ downloadStatus: DownloadStatus }>(GET_DOWNLOAD_STATUS)
      .then((d) => this.applyStatus(d.downloadStatus))
      .catch(console.error)
      .finally(() => this.loading = false);
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
    try { await gql(DEQUEUE_DOWNLOAD, { chapterId }); this.poll(); }
    catch (e) { console.error(e); this.poll(); }
    finally { this.dequeueing.delete(chapterId); this.dequeueing = new Set(this.dequeueing); }
  }
}

export const downloadStore = new DownloadStore();
