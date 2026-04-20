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
