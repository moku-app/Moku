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
