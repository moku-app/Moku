# Mutations

## Manga (`mutations/manga.ts`)

### `FETCH_MANGA`
Fetches and refreshes manga metadata from its source.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `id` | `Int!` | Manga ID |

---

### `UPDATE_MANGA`
Updates a single manga's library membership.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `id` | `Int!` | Manga ID |
| `inLibrary` | `Boolean` | Add/remove from library |

---

### `UPDATE_MANGAS`
Bulk-updates library membership for multiple manga.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `ids` | `[Int!]!` | Manga IDs |
| `inLibrary` | `Boolean` | Add/remove from library |

---

### `UPDATE_MANGA_CATEGORIES`
Adds or removes a manga from categories.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `mangaId` | `Int!` | Manga ID |
| `addTo` | `[Int!]!` | Category IDs to add to |
| `removeFrom` | `[Int!]!` | Category IDs to remove from |

---

### `CREATE_CATEGORY`
Creates a new manga category.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `name` | `String!` | Category name |

---

### `UPDATE_CATEGORY`
Updates a category's name.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `id` | `Int!` | Category ID |
| `name` | `String` | New name |

---

### `DELETE_CATEGORY`
Deletes a category by ID.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `id` | `Int!` | Category ID |

---

### `UPDATE_CATEGORY_ORDER`
Moves a category to a new position.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `id` | `Int!` | Category ID |
| `position` | `Int!` | New position index |

---

### `UPDATE_LIBRARY`
Triggers a library-wide metadata refresh and returns job status.

**Variables:** none

---

### `CREATE_BACKUP`
Creates a backup and returns its download URL.

**Variables:** none

---

### `RESTORE_BACKUP`
Restores a backup from an uploaded file and returns restore job status.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `backup` | `Upload!` | Backup file |

---

## Chapters (`mutations/chapters.ts`)

### `FETCH_CHAPTERS`
Fetches/refreshes the chapter list for a manga from its source.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `mangaId` | `Int!` | Manga ID |

---

### `FETCH_CHAPTER_PAGES`
Fetches the page URLs for a specific chapter.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `chapterId` | `Int!` | Chapter ID |

---

### `MARK_CHAPTER_READ`
Marks a single chapter as read or unread.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `id` | `Int!` | Chapter ID |
| `isRead` | `Boolean!` | Read state |

---

### `MARK_CHAPTERS_READ`
Bulk-marks multiple chapters as read or unread.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `ids` | `[Int!]!` | Chapter IDs |
| `isRead` | `Boolean!` | Read state |

---

### `UPDATE_CHAPTERS_PROGRESS`
Bulk-updates read state, bookmark state, and last page read for multiple chapters.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `ids` | `[Int!]!` | Chapter IDs |
| `isRead` | `Boolean` | Read state |
| `isBookmarked` | `Boolean` | Bookmark state |
| `lastPageRead` | `Int` | Last page index read |

---

### `DELETE_DOWNLOADED_CHAPTERS`
Deletes downloaded chapter files for the given chapter IDs.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `ids` | `[Int!]!` | Chapter IDs |

---

## Downloads (`mutations/downloads.ts`)

### `ENQUEUE_DOWNLOAD`
Adds a single chapter to the download queue.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `chapterId` | `Int!` | Chapter ID |

---

### `ENQUEUE_CHAPTERS_DOWNLOAD`
Adds multiple chapters to the download queue.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `chapterIds` | `[Int!]!` | Chapter IDs |

---

### `DEQUEUE_DOWNLOAD`
Removes a chapter from the download queue.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `chapterId` | `Int!` | Chapter ID |

---

### `START_DOWNLOADER`
Starts the downloader and returns the current queue state.

**Variables:** none

---

### `STOP_DOWNLOADER`
Stops the downloader and returns the current queue state.

**Variables:** none

---

### `CLEAR_DOWNLOADER`
Clears all items from the download queue.

**Variables:** none

---

### `FETCH_SOURCE_MANGA`
Fetches manga from a source (browse/search), with pagination and optional filters.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `source` | `LongString!` | Source ID |
| `type` | `FetchSourceMangaType!` | Browse type (e.g. popular, latest, search) |
| `page` | `Int!` | Page number |
| `query` | `String` | Search query |
| `filters` | `[FilterChangeInput!]` | Source-specific filters |

---

### `SET_DOWNLOADS_PATH`
Sets the downloads directory path in settings.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `path` | `String!` | Filesystem path |

---

### `SET_LOCAL_SOURCE_PATH`
Sets the local source directory path in settings.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `path` | `String!` | Filesystem path |

---

## Extensions (`mutations/extensions.ts`)

### `FETCH_EXTENSIONS`
Fetches the latest extension list from configured repos.

**Variables:** none

---

### `UPDATE_EXTENSION`
Installs, uninstalls, or updates an extension.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `id` | `String!` | Extension package name |
| `install` | `Boolean` | Install the extension |
| `uninstall` | `Boolean` | Uninstall the extension |
| `update` | `Boolean` | Update the extension |

---

### `INSTALL_EXTERNAL_EXTENSION`
Installs an extension from an external APK URL.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `url` | `String!` | APK download URL |

---

### `SET_EXTENSION_REPOS`
Sets the list of extension repository URLs.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `repos` | `[String!]!` | Repository URLs |

---

### `SET_SERVER_AUTH`
Configures server authentication mode and credentials.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `authMode` | `AuthMode!` | Auth mode |
| `authUsername` | `String!` | Username |
| `authPassword` | `String!` | Password |

---

### `SET_SOCKS_PROXY`
Configures SOCKS proxy settings.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `socksProxyEnabled` | `Boolean!` | Enable/disable proxy |
| `socksProxyHost` | `String!` | Proxy host |
| `socksProxyPort` | `String!` | Proxy port |
| `socksProxyVersion` | `Int!` | SOCKS version (4 or 5) |
| `socksProxyUsername` | `String!` | Proxy username |
| `socksProxyPassword` | `String!` | Proxy password |

---

### `SET_FLARESOLVERR`
Configures FlareSolverr integration settings.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `flareSolverrEnabled` | `Boolean!` | Enable/disable FlareSolverr |
| `flareSolverrUrl` | `String!` | FlareSolverr URL |
| `flareSolverrTimeout` | `Int!` | Request timeout (ms) |
| `flareSolverrSessionName` | `String!` | Session name |
| `flareSolverrSessionTtl` | `Int!` | Session TTL (seconds) |
| `flareSolverrAsResponseFallback` | `Boolean!` | Use as fallback only |

---

## Tracking (`mutations/tracking.ts`)

### `BIND_TRACK`
Binds a manga to a remote tracker entry.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `mangaId` | `Int!` | Manga ID |
| `trackerId` | `Int!` | Tracker ID |
| `remoteId` | `LongString!` | Remote entry ID on the tracker |

---

### `UPDATE_TRACK`
Updates tracking progress, status, score, and dates for a track record.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `recordId` | `Int!` | Track record ID |
| `status` | `Int` | Reading status |
| `lastChapterRead` | `Float` | Last chapter read |
| `scoreString` | `String` | Score in tracker's format |
| `startDate` | `LongString` | Start date |
| `finishDate` | `LongString` | Finish date |
| `private` | `Boolean` | Mark as private |

---

### `UNBIND_TRACK`
Unbinds a manga from a tracker record.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `recordId` | `Int!` | Track record ID |

---

### `FETCH_TRACK`
Refreshes a track record from the remote tracker.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `recordId` | `Int!` | Track record ID |

---

### `LOGIN_TRACKER_OAUTH`
Initiates OAuth login for a tracker using a callback URL.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `trackerId` | `Int!` | Tracker ID |
| `callbackUrl` | `String!` | OAuth callback URL |

---

### `LOGIN_TRACKER_CREDENTIALS`
Logs into a tracker using username and password.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `trackerId` | `Int!` | Tracker ID |
| `username` | `String!` | Username |
| `password` | `String!` | Password |

---

### `LOGOUT_TRACKER`
Logs out of a tracker.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `trackerId` | `Int!` | Tracker ID |

---

### `LOGIN_USER`
Authenticates a user and returns access and refresh tokens.

**Variables:**
| Name | Type | Description |
|------|------|-------------|
| `username` | `String!` | Username |
| `password` | `String!` | Password |

---

### `REFRESH_TOKEN`
Refreshes the current access token.

**Variables:** none
