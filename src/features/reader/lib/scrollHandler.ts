export const READ_LINE_PCT = 0.50;

export interface StripChapter {
  chapterId:   number;
  chapterName: string;
  urls:        string[];
}

export interface ScrollHandlerCallbacks {
  onPageChange:    (page: number) => void;
  onChapterChange: (chapterId: number) => void;
  onMarkRead:      (chapterId: number) => void;
  onAppend:        () => void;
  getStripChapters: () => StripChapter[];
  getPageUrls:     () => string[];
  shouldAutoMark:  () => boolean;
}

export function setupScrollTracking(
  containerEl: HTMLElement,
  callbacks: ScrollHandlerCallbacks,
): () => void {
  const {
    onPageChange, onChapterChange, onMarkRead,
    onAppend, getStripChapters, getPageUrls, shouldAutoMark,
  } = callbacks;

  function onScroll() {
    const imgs = containerEl.querySelectorAll<HTMLElement>("img[data-local-page]");
    if (!imgs.length) return;

    const containerTop = containerEl.getBoundingClientRect().top;
    const readLineY    = containerTop + containerEl.clientHeight * READ_LINE_PCT;

    let activePage: number | null = null;
    let activeChId: number | null = null;

    for (const img of imgs) {
      if (img.getBoundingClientRect().top <= readLineY) {
        activePage = Number(img.dataset.localPage);
        activeChId = Number(img.dataset.chapter);
      } else break;
    }

    if (activePage === null) {
      activePage = Number(imgs[0].dataset.localPage);
      activeChId = Number(imgs[0].dataset.chapter);
    }

    if (activePage !== null) onPageChange(activePage);
    if (activeChId)          onChapterChange(activeChId);

    if (shouldAutoMark() && activePage !== null && activeChId) {
      const chunks = getStripChapters();
      const chunk  = chunks.find(c => c.chapterId === activeChId);
      const total  = chunk ? chunk.urls.length : getPageUrls().length;
      if (total > 0 && activePage >= total) onMarkRead(activeChId);
    }

    const atBottom = containerEl.scrollTop + containerEl.clientHeight >= containerEl.scrollHeight - 40;
    if (atBottom && shouldAutoMark()) {
      const chunks = getStripChapters();
      const last   = chunks[chunks.length - 1];
      if (last) onMarkRead(last.chapterId);
    }
  }

  function onScrollAppend() {
    const pct = (containerEl.scrollTop + containerEl.clientHeight) / containerEl.scrollHeight;
    if (pct >= 0.80) onAppend();
  }

  containerEl.addEventListener("scroll", onScroll,       { passive: true });
  containerEl.addEventListener("scroll", onScrollAppend, { passive: true });

  return () => {
    containerEl.removeEventListener("scroll", onScroll);
    containerEl.removeEventListener("scroll", onScrollAppend);
  };
}

export function appendNextChapter(
  stripChapters: StripChapter[],
  chapterList: { id: number; name: string }[],
  fetchPages: (chapterId: number) => Promise<string[]>,
  preloadImage: (url: string) => void,
  onAppended: (next: StripChapter) => void,
  onDone: () => void,
): void {
  if (!stripChapters.length) return;

  const lastChunk = stripChapters[stripChapters.length - 1];
  const lastIdx   = chapterList.findIndex(c => c.id === lastChunk.chapterId);
  if (lastIdx < 0 || lastIdx >= chapterList.length - 1) return;

  const next = chapterList[lastIdx + 1];
  if (!next || stripChapters.some(c => c.chapterId === next.id)) return;

  fetchPages(next.id)
    .then(urls => {
      urls.slice(0, 6).forEach(preloadImage);
      return urls;
    })
    .then(urls => {
      if (stripChapters.some(c => c.chapterId === next.id)) { onDone(); return; }
      onAppended({ chapterId: next.id, chapterName: next.name, urls });
      onDone();
    })
    .catch(() => onDone());
}
