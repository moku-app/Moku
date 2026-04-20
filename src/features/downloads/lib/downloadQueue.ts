import type { DownloadQueueItem, ActiveDownload } from "@types/index";

export function toActiveDownloads(queue: DownloadQueueItem[]): ActiveDownload[] {
  return queue.map((item) => ({
    chapterId: item.chapter.id,
    mangaId:   item.chapter.mangaId,
    progress:  item.progress,
  }));
}

export function optimisticRemove(queue: DownloadQueueItem[], chapterId: number): DownloadQueueItem[] {
  return queue.filter((i) => i.chapter.id !== chapterId);
}

export function optimisticToggle(state: string, wasRunning: boolean): string {
  return wasRunning ? "STOPPED" : "STARTED";
}

export function isRunning(state: string | undefined): boolean {
  return state === "STARTED";
}

export function pageProgress(progress: number, pageCount: number): { done: number; total: number } {
  return { done: Math.round(progress * pageCount), total: pageCount };
}
