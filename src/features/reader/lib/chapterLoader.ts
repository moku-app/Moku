import { store, openReader } from "@store/state.svelte";
import { readerState }       from "../store/readerState.svelte";
import { fetchPages }        from "./pageLoader";
import { trackingState }     from "@features/tracking/store/trackingState.svelte";

export function scheduleResumeDismiss() {
  setTimeout(() => { readerState.resumeFading = true; }, 1500);
  setTimeout(() => { readerState.resumeVisible = false; readerState.resumeFading = false; }, 2500);
}

export async function loadChapter(
  id: number,
  useBlob: boolean,
  abortCtrl: { current: AbortController | null },
  startAtLastPage: { current: boolean },
  markedRead: Set<number>,
  adjacent: { next: { id: number } | null },
) {
  abortCtrl.current?.abort();
  const ctrl = new AbortController();
  abortCtrl.current = ctrl;
  startAtLastPage.current = false;
  markedRead.clear();
  readerState.resetForChapter();
  store.pageUrls = [];

  const mangaId = store.activeManga?.id;
  if (mangaId) trackingState.loadForManga(mangaId);

  const bookmark = store.bookmarks.find(b => b.chapterId === id);
  const resumeTo = bookmark ? bookmark.pageNumber : 0;
  readerState.resumePage      = resumeTo > 1 ? resumeTo : 0;
  readerState.resumeDismissed = false;
  readerState.resumeVisible   = resumeTo > 1;
  if (resumeTo > 1) scheduleResumeDismiss();

  store.pageNumber = 1;
  try {
    const urls = await fetchPages(id, useBlob, ctrl.signal, resumeTo > 1 ? resumeTo - 1 : 0);
    if (ctrl.signal.aborted) return;
    store.pageUrls = urls;
    if (startAtLastPage.current)  store.pageNumber = urls.length;
    else if (resumeTo > 1)        store.pageNumber = Math.min(resumeTo, urls.length || resumeTo);
    readerState.pageReady = true;
    readerState.loading   = false;
    if (adjacent.next) fetchPages(adjacent.next.id, useBlob).catch(() => {});
  } catch (e: any) {
    if (ctrl.signal.aborted) return;
    readerState.error   = e instanceof Error ? e.message : String(e);
    readerState.loading = false;
  }
}