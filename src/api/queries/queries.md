# Queries

## Manga (`queries/manga.ts`)

### `GET_LIBRARY`
Fetches all manga marked as in-library, including metadata, source info, chapter count, download count, and unread count.

**Variables:** none

---

### `GET_ALL_MANGA`
Fetches all manga (library and non-library) with minimal fields.

**Variables:** none

---

### `GET_MANGA`
Fetches a single manga by ID with full metadata and source info.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `id` | `Int!` | Manga ID |

---

### `GET_CATEGORIES`
Fetches all categories with their order, settings, and the manga assigned to each.

**Variables:** none

---

### `GET_DOWNLOADED_CHAPTERS_PAGES`
Fetches page counts for all downloaded chapters.

**Variables:** none

---

### `GET_DOWNLOADS_PATH`
Fetches the configured downloads path and local source path from settings.

**Variables:** none

---

### `LIBRARY_UPDATE_STATUS`
Fetches the current library update job status, including progress and any manga with new chapters.

**Variables:** none

---

### `GET_RESTORE_STATUS`
Fetches the status of a backup restore operation by its job ID.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `id` | `String!` | Restore job ID |

---

### `VALIDATE_BACKUP`
Validates a backup file and returns any missing sources or trackers.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `backup` | `Upload!` | Backup file |

---

## Chapters (`queries/chapters.ts`)

### `GET_CHAPTERS`
Fetches all chapters for a given manga, including read/download/bookmark state and page info.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `mangaId` | `Int!` | Manga ID |

---

## Downloads (`queries/downloads.ts`)

### `GET_DOWNLOAD_STATUS`
Fetches the current downloader state and full queue with chapter and manga info.

**Variables:** none

---

## Extensions (`queries/extensions.ts`)

### `GET_EXTENSIONS`
Fetches all extensions with install status, update availability, and metadata.

**Variables:** none

---

### `GET_SOURCES`
Fetches all available sources with language and NSFW flags.

**Variables:** none

---

### `GET_SETTINGS`
Fetches extension repository settings.

**Variables:** none

---

### `GET_SERVER_SECURITY`
Fetches all server security settings including auth mode, SOCKS proxy config, and FlareSolverr config.

**Variables:** none

---

## Tracking (`queries/tracking.ts`)

### `GET_TRACKERS`
Fetches all trackers with login status, supported scores, statuses, and auth info.

**Variables:** none

---

### `GET_MANGA_TRACK_RECORDS`
Fetches all tracking records for a specific manga across all trackers.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `mangaId` | `Int!` | Manga ID |

---

### `SEARCH_TRACKER`
Searches a tracker for manga by query string.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `trackerId` | `Int!` | Tracker ID |
| `query` | `String!` | Search query |

---

### `GET_ALL_TRACKER_RECORDS`
Fetches all trackers and their full track records, including associated manga info.

**Variables:** none

---

### `GET_TRACKER_RECORDS`
Fetches track records for a specific tracker.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `trackerId` | `Int!` | Tracker ID |
