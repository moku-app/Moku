export interface Category {
  id: number;
  name: string;
  order: number;
  default: boolean;
  includeInUpdate: string;
  includeInDownload: string;
  mangas?: {
    nodes: Manga[];
  };
}

export interface Manga {
  id: number;
  title: string;
  thumbnailUrl: string;
  inLibrary: boolean;
  downloadCount?: number;
  unreadCount?: number;
  chapterCount?: number;
  description?: string | null;
  status?: string | null;
  author?: string | null;
  artist?: string | null;
  genre?: string[];
  realUrl?: string | null;
  source?: {
    id: string;
    name: string;
    displayName: string;
  } | null;
}

export interface Chapter {
  id: number;
  name: string;
  chapterNumber: number;
  sourceOrder: number;
  isRead: boolean;
  isDownloaded: boolean;
  isBookmarked: boolean;
  pageCount: number;
  mangaId: number;
  uploadDate?: string | null;
  realUrl?: string | null;
  lastPageRead?: number;
  scanlator?: string | null;
}

export interface MangaDetail extends Manga {
  description: string | null;
  author: string | null;
  artist: string | null;
  status: string | null;
  genre: string[];
}

export interface Source {
  id: string;
  name: string;
  lang: string;
  displayName: string;
  iconUrl: string;
  isNsfw: boolean;
}

export interface Extension {
  apkName: string;
  pkgName: string;
  name: string;
  lang: string;
  versionName: string;
  isInstalled: boolean;
  isObsolete: boolean;
  hasUpdate: boolean;
  iconUrl: string;
}

export interface DownloadQueueItem {
  progress: number;
  state: "QUEUED" | "DOWNLOADING" | "FINISHED" | "ERROR";
  chapter: {
    id: number;
    name: string;
    mangaId: number;
    pageCount: number;
    manga: {
      id: number;
      title: string;
      thumbnailUrl: string;
    } | null;
  };
}

export interface DownloadStatus {
  state: "STARTED" | "STOPPED";
  queue: DownloadQueueItem[];
}

export interface Connection<T> {
  nodes: T[];
}

export interface TrackerStatus {
  value: number;
  name: string;
}

export interface Tracker {
  id: number;
  name: string;
  icon: string;
  isLoggedIn: boolean;
  authUrl: string | null;
  supportsPrivateTracking: boolean;
  scores: string[];
  statuses: TrackerStatus[];
}

export interface TrackRecord {
  id: number;
  trackerId: number;
  remoteId: string;
  title: string;
  status: number;
  score: number;
  displayScore: string;
  lastChapterRead: number;
  totalChapters: number;
  remoteUrl: string | null;
  startDate: string | null;
  finishDate: string | null;
  private: boolean;
}

export interface TrackSearch {
  id: number;
  trackerId: number;
  remoteId: string;
  title: string;
  coverUrl: string | null;
  summary: string | null;
  publishingStatus: string | null;
  publishingType: string | null;
  startDate: string | null;
  totalChapters: number;
  trackingUrl: string | null;
}
