import { start, stop, setActivity, clearActivity } from "tauri-plugin-drpc";
import { Activity, Assets, Button, Timestamps }     from "tauri-plugin-drpc/activity";
import type { Manga, Chapter }                       from "./types";

const APP_ID         = "1487894643613106298";
const FALLBACK_IMAGE = "moku_logo";

let sessionStart: number | null = null; // ← captured once on init

function isPublicUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith("https://");
}

function resolveCoverImage(manga: Manga): string {
  return isPublicUrl(manga.thumbnailUrl) ? manga.thumbnailUrl : FALLBACK_IMAGE;
}

function trunc(s: string, max = 128): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function formatChapter(chapter: Chapter): string {
  const n = chapter.chapterNumber;
  return `Chapter ${Number.isInteger(n) ? n : n.toFixed(1)}`;
}

function getTimestamps(): Timestamps {
  return new Timestamps(sessionStart ?? Date.now());
}

const BUTTONS = [
  new Button("GitHub", "https://github.com/Youwes09/Moku"),
  new Button("Discord", "https://discord.gg/Jq3pwuNqPp"),
];

export async function initRpc(): Promise<void> {
  sessionStart = Date.now(); // ← set once here
  await start(APP_ID)
    .then(() => console.log("[discord] RPC started"))
    .catch((e) => console.error("[discord] initRpc failed:", e));
}

export async function setReading(manga: Manga, chapter: Chapter): Promise<void> {
  const assets = new Assets()
    .setLargeImage(resolveCoverImage(manga))
    .setLargeText(trunc(manga.title))
    .setSmallImage(FALLBACK_IMAGE)
    .setSmallText("Moku");

  const activity = new Activity()
    .setDetails(trunc(manga.title))
    .setState(`${formatChapter(chapter)}  ·  Reading`)
    .setAssets(assets)
    .setTimestamps(getTimestamps()); // ← reuses session start
  activity.setButton(BUTTONS);

  await setActivity(activity)
    .then(() => console.log("[discord] reading →", manga.title, formatChapter(chapter)))
    .catch((e) => console.error("[discord] setActivity failed:", e));
}

export async function setIdle(): Promise<void> {
  const assets = new Assets()
    .setLargeImage(FALLBACK_IMAGE)
    .setLargeText("Moku");

  const activity = new Activity()
    .setDetails("Browsing")
    .setAssets(assets)
    .setTimestamps(getTimestamps()); // ← reuses session start
  activity.setButton(BUTTONS);

  await setActivity(activity)
    .then(() => console.log("[discord] idle"))
    .catch((e) => console.error("[discord] setActivity failed (idle):", e));
}

export async function clearReading(): Promise<void> {
  await clearActivity()
    .then(() => console.log("[discord] activity cleared"))
    .catch((e) => console.error("[discord] clearActivity failed:", e));
}

export async function destroyRpc(): Promise<void> {
  sessionStart = null; // ← clean up on stop
  await stop()
    .then(() => console.log("[discord] RPC stopped"))
    .catch((e) => console.error("[discord] destroyRpc failed:", e));
}