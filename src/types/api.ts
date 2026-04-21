export interface DownloadQueueItem {
  progress: number;
  state: "QUEUED" | "DOWNLOADING" | "FINISHED" | "ERROR";
  tries: number;
  chapter: {
    id: number;
    name: string;
    mangaId: number;
    pageCount: number;
    manga: { id: number; title: string; thumbnailUrl: string } | null;
  };
}

export interface DownloadStatus {
  state: "STARTED" | "STOPPED";
  queue: DownloadQueueItem[];
}

export interface Connection<T> {
  nodes: T[];
}