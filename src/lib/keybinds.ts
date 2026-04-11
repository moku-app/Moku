import { getCurrentWindow } from "@tauri-apps/api/window";

export interface Keybinds {
  turnPageRight:          string;
  turnPageLeft:           string;
  firstPage:              string;
  lastPage:               string;
  turnChapterRight:       string;
  turnChapterLeft:        string;
  exitReader:             string;
  toggleReadingDirection: string;
  togglePageStyle:        string;
  toggleFullscreen:       string;
  openSettings:           string;
  toggleBookmark:         string;
  toggleMarker:           string;
}

export const DEFAULT_KEYBINDS: Keybinds = {
  turnPageRight:          "ArrowRight",
  turnPageLeft:           "ArrowLeft",
  firstPage:              "ctrl+ArrowLeft",
  lastPage:               "ctrl+ArrowRight",
  turnChapterRight:       "]",
  turnChapterLeft:        "[",
  exitReader:             "Backspace",
  toggleReadingDirection: "d",
  togglePageStyle:        "q",
  toggleFullscreen:       "f",
  openSettings:           "o",
  toggleBookmark:         "m",
  toggleMarker:           "n",
};

export const KEYBIND_LABELS: Record<keyof Keybinds, string> = {
  turnPageRight:          "Turn page right (→)",
  turnPageLeft:           "Turn page left (←)",
  firstPage:              "Jump to first page",
  lastPage:               "Jump to last page",
  turnChapterRight:       "Turn chapter right (→)",
  turnChapterLeft:        "Turn chapter left (←)",
  exitReader:             "Exit reader",
  toggleReadingDirection: "Toggle reading direction",
  togglePageStyle:        "Toggle page style",
  toggleFullscreen:       "Toggle fullscreen",
  openSettings:           "Open settings",
  toggleBookmark:         "Toggle bookmark",
  toggleMarker:           "Toggle marker",
};

export function eventToKeybind(e: KeyboardEvent): string {
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return "";
  const parts: string[] = [];
  if (e.ctrlKey)  parts.push("ctrl");
  if (e.altKey)   parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  if (e.metaKey)  parts.push("meta");
  parts.push(e.key);
  return parts.join("+");
}

export function matchesKeybind(e: KeyboardEvent, bind: string): boolean {
  return eventToKeybind(e) === bind;
}

export async function toggleFullscreen(): Promise<void> {
  try {
    const win = getCurrentWindow();
    const isFs = await win.isFullscreen();
    await win.setFullscreen(!isFs);
  } catch (e) {
    console.warn("toggleFullscreen unavailable:", e);
  }
}
