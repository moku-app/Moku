export interface Category {
  id: number;
  name: string;
  order: number;
  default: boolean;
  includeInUpdate: string;
  includeInDownload: string;
  mangas?: { nodes: Manga[] };
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
  source?: { id: string; name: string; displayName: string } | null;
}

export interface MangaDetail extends Manga {
  description: string | null;
  author: string | null;
  artist: string | null;
  status: string | null;
  genre: string[];
}
