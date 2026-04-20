import { getCurrentWindow } from "@tauri-apps/api/window";
import { gql } from "@api/client";
import { GET_DOWNLOAD_STATUS } from "@api/queries/downloads";
import { addToast, setActiveDownloads } from "@store/state.svelte";
import type { DownloadStatus, DownloadQueueItem } from "@types/index";

let prevQueue: DownloadQueueItem[] = [];

function detectCompletions(prev: DownloadQueueItem[], next: DownloadQueueItem[]) {
  for (const item of prev) {
    if (item.state !== "DOWNLOADING") continue;
    if (!next.some(q => q.chapter.id === item.chapter.id)) {
      const manga = item.chapter.manga;
      addToast({
        kind:     "success",
        title:    "Chapter downloaded",
        body:     manga ? `${manga.title} — ${item.chapter.name}` : item.chapter.name,
        duration: 4000,
      });
    }
  }
}

function applyQueue(next: DownloadQueueItem[]) {
  detectCompletions(prevQueue, next);
  prevQueue = next;
  setActiveDownloads(next.map(item => ({
    chapterId: item.chapter.id,
    mangaId:   item.chapter.mangaId,
    progress:  item.progress,
  })));
}

export async function mountDownloadPoller(): Promise<() => void> {
  const win = getCurrentWindow();
  let paused = false;
  let interval: ReturnType<typeof setInterval>;

  const poll = () => {
    if (paused) return;
    gql<{ downloadStatus: DownloadStatus }>(GET_DOWNLOAD_STATUS)
      .then(d => applyQueue(d.downloadStatus.queue))
      .catch(console.error);
  };

  poll();
  interval = setInterval(poll, 2000);

  const onVisibility = () => { paused = document.hidden; };
  document.addEventListener("visibilitychange", onVisibility);

  const unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
    paused = !focused;
  });

  return () => {
    clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisibility);
    unlistenFocus();
  };
}
