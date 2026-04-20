export type NavPage =
  | "home" | "library" | "sources" | "explore"
  | "downloads" | "extensions" | "history" | "search" | "tracking";

class AppStore {
  navPage:      NavPage = $state("home");
  settingsOpen: boolean = $state(false);
  searchPrefill: string = $state("");
  genreFilter:   string = $state("");

  setNavPage(next: NavPage)       { this.navPage       = next; }
  setSettingsOpen(next: boolean)  { this.settingsOpen  = next; }
  setSearchPrefill(next: string)  { this.searchPrefill = next; }
  setGenreFilter(next: string)    { this.genreFilter   = next; }
}

export const app = new AppStore();

export function setNavPage(next: NavPage)      { app.setNavPage(next); }
export function setSettingsOpen(next: boolean) { app.setSettingsOpen(next); }
export function setSearchPrefill(next: string) { app.setSearchPrefill(next); }
export function setGenreFilter(next: string)   { app.setGenreFilter(next); }
