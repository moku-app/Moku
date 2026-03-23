// ── Library ──────────────────────────────────────────────────────────────────

export const GET_LIBRARY = `
  query GetLibrary {
    mangas(condition: { inLibrary: true }) {
      nodes {
        id
        title
        thumbnailUrl
        inLibrary
        downloadCount
        unreadCount
        description
        status
        author
        artist
        genre
        source {
          id
          name
          displayName
        }
        chapters {
          totalCount
        }
      }
    }
  }
`;

export const GET_ALL_MANGA = `
  query GetAllManga {
    mangas {
      nodes {
        id
        title
        thumbnailUrl
        inLibrary
        downloadCount
      }
    }
  }
`;

export const GET_MANGA = `
  query GetManga($id: Int!) {
    manga(id: $id) {
      id
      title
      description
      thumbnailUrl
      status
      author
      artist
      genre
      inLibrary
      realUrl
      source {
        id
        name
        displayName
      }
    }
  }
`;

export const GET_CHAPTERS = `
  query GetChapters($mangaId: Int!) {
    chapters(condition: { mangaId: $mangaId }) {
      nodes {
        id
        name
        chapterNumber
        sourceOrder
        isRead
        isDownloaded
        isBookmarked
        pageCount
        mangaId
        uploadDate
        realUrl
        lastPageRead
        scanlator
      }
    }
  }
`;

export const FETCH_CHAPTERS = `
  mutation FetchChapters($mangaId: Int!) {
    fetchChapters(input: { mangaId: $mangaId }) {
      chapters {
        id
        name
        chapterNumber
        sourceOrder
        isRead
        isDownloaded
        isBookmarked
        pageCount
        mangaId
        uploadDate
        realUrl
        lastPageRead
        scanlator
      }
    }
  }
`;

export const FETCH_CHAPTER_PAGES = `
  mutation FetchChapterPages($chapterId: Int!) {
    fetchChapterPages(input: { chapterId: $chapterId }) {
      pages
    }
  }
`;

export const UPDATE_MANGA = `
  mutation UpdateManga($id: Int!, $inLibrary: Boolean) {
    updateManga(input: { id: $id, patch: { inLibrary: $inLibrary } }) {
      manga {
        id
        inLibrary
      }
    }
  }
`;

export const MARK_CHAPTER_READ = `
  mutation MarkChapterRead($id: Int!, $isRead: Boolean!) {
    updateChapter(input: { id: $id, patch: { isRead: $isRead } }) {
      chapter {
        id
        isRead
      }
    }
  }
`;

export const MARK_CHAPTERS_READ = `
  mutation MarkChaptersRead($ids: [Int!]!, $isRead: Boolean!) {
    updateChapters(input: { ids: $ids, patch: { isRead: $isRead } }) {
      chapters {
        id
        isRead
      }
    }
  }
`;

export const UPDATE_CHAPTERS_PROGRESS = `
  mutation UpdateChaptersProgress($ids: [Int!]!, $isRead: Boolean, $isBookmarked: Boolean, $lastPageRead: Int) {
    updateChapters(input: { ids: $ids, patch: { isRead: $isRead, isBookmarked: $isBookmarked, lastPageRead: $lastPageRead } }) {
      chapters {
        id
        isRead
        isBookmarked
        lastPageRead
      }
    }
  }
`;

export const DELETE_DOWNLOADED_CHAPTERS = `
  mutation DeleteDownloadedChapters($ids: [Int!]!) {
    deleteDownloadedChapters(input: { ids: $ids }) {
      chapters {
        id
        isDownloaded
      }
    }
  }
`;

export const GET_DOWNLOADED_CHAPTERS_PAGES = `
  query GetDownloadedChaptersPages {
    chapters(condition: { isDownloaded: true }) {
      nodes {
        pageCount
      }
    }
  }
`;

export const GET_DOWNLOADS_PATH = `
  query GetDownloadsPath {
    settings {
      downloadsPath
    }
  }
`;

// ── Downloads ─────────────────────────────────────────────────────────────────

export const GET_DOWNLOAD_STATUS = `
  query GetDownloadStatus {
    downloadStatus {
      state
      queue {
        progress
        state
        chapter {
          id
          name
          pageCount
          mangaId
          manga {
            id
            title
            thumbnailUrl
          }
        }
      }
    }
  }
`;

export const ENQUEUE_DOWNLOAD = `
  mutation EnqueueDownload($chapterId: Int!) {
    enqueueChapterDownload(input: { id: $chapterId }) {
      downloadStatus {
        state
        queue {
          progress
          state
          chapter {
            id
            name
            pageCount
            mangaId
            manga { id title thumbnailUrl }
          }
        }
      }
    }
  }
`;

export const ENQUEUE_CHAPTERS_DOWNLOAD = `
  mutation EnqueueChaptersDownload($chapterIds: [Int!]!) {
    enqueueChapterDownloads(input: { ids: $chapterIds }) {
      downloadStatus {
        state
      }
    }
  }
`;

export const DEQUEUE_DOWNLOAD = `
  mutation DequeueDownload($chapterId: Int!) {
    dequeueChapterDownload(input: { id: $chapterId }) {
      downloadStatus {
        state
      }
    }
  }
`;

export const START_DOWNLOADER = `
  mutation StartDownloader {
    startDownloader(input: {}) {
      downloadStatus {
        state
        queue {
          progress
          state
          chapter {
            id
            name
            pageCount
            mangaId
            manga { id title thumbnailUrl }
          }
        }
      }
    }
  }
`;

export const STOP_DOWNLOADER = `
  mutation StopDownloader {
    stopDownloader(input: {}) {
      downloadStatus {
        state
        queue {
          progress
          state
          chapter {
            id
            name
            pageCount
            mangaId
            manga { id title thumbnailUrl }
          }
        }
      }
    }
  }
`;

export const CLEAR_DOWNLOADER = `
  mutation ClearDownloader {
    clearDownloader(input: {}) {
      downloadStatus {
        state
        queue {
          progress
          state
          chapter {
            id name pageCount mangaId
            manga { id title thumbnailUrl }
          }
        }
      }
    }
  }
`;

// ── Sources ───────────────────────────────────────────────────────────────────

export const GET_SOURCES = `
  query GetSources {
    sources {
      nodes {
        id
        name
        lang
        displayName
        iconUrl
        isNsfw
      }
    }
  }
`;

export const FETCH_SOURCE_MANGA = `
  mutation FetchSourceManga($source: LongString!, $type: FetchSourceMangaType!, $page: Int!, $query: String) {
    fetchSourceManga(input: { source: $source, type: $type, page: $page, query: $query }) {
      mangas {
        id
        title
        thumbnailUrl
        inLibrary
      }
      hasNextPage
    }
  }
`;

export const FETCH_MANGA = `
  mutation FetchManga($id: Int!) {
    fetchManga(input: { id: $id }) {
      manga {
        id
        title
        description
        thumbnailUrl
        status
        author
        artist
        genre
        inLibrary
        realUrl
        source {
          id
          name
          displayName
        }
      }
    }
  }
`;

// ── Extensions ────────────────────────────────────────────────────────────────

export const GET_EXTENSIONS = `
  query GetExtensions {
    extensions {
      nodes {
        apkName
        pkgName
        name
        lang
        versionName
        isInstalled
        isObsolete
        hasUpdate
        iconUrl
      }
    }
  }
`;

export const FETCH_EXTENSIONS = `
  mutation FetchExtensions {
    fetchExtensions(input: {}) {
      extensions {
        apkName
        pkgName
        name
        lang
        versionName
        isInstalled
        isObsolete
        hasUpdate
        iconUrl
      }
    }
  }
`;

export const UPDATE_EXTENSION = `
  mutation UpdateExtension($id: String!, $install: Boolean, $uninstall: Boolean, $update: Boolean) {
    updateExtension(input: { id: $id, patch: { install: $install, uninstall: $uninstall, update: $update } }) {
      extension {
        apkName
        pkgName
        name
        isInstalled
        hasUpdate
      }
    }
  }
`;

export const INSTALL_EXTERNAL_EXTENSION = `
  mutation InstallExternalExtension($url: String!) {
    installExternalExtension(input: { extensionUrl: $url }) {
      extension {
        apkName
        pkgName
        name
        isInstalled
      }
    }
  }
`;

// ── Settings ──────────────────────────────────────────────────────────────────

export const GET_SETTINGS = `
  query GetSettings {
    settings {
      extensionRepos
    }
  }
`;

export const SET_EXTENSION_REPOS = `
  mutation SetExtensionRepos($repos: [String!]!) {
    setSettings(input: { settings: { extensionRepos: $repos } }) {
      settings {
        extensionRepos
      }
    }
  }
`;

// ── Trackers ──────────────────────────────────────────────────────────────────

export const GET_TRACKERS = `
  query GetTrackers {
    trackers {
      nodes {
        id
        name
        icon
        isLoggedIn
        authUrl
        supportsPrivateTracking
        scores
        statuses {
          value
          name
        }
      }
    }
  }
`;

export const GET_MANGA_TRACK_RECORDS = `
  query GetMangaTrackRecords($mangaId: Int!) {
    manga(id: $mangaId) {
      trackRecords {
        nodes {
          id
          trackerId
          remoteId
          title
          status
          score
          displayScore
          lastChapterRead
          totalChapters
          remoteUrl
          startDate
          finishDate
          private
        }
      }
    }
  }
`;

export const SEARCH_TRACKER = `
  query SearchTracker($trackerId: Int!, $query: String!) {
    searchTracker(input: { trackerId: $trackerId, query: $query }) {
      trackSearches {
        id
        trackerId
        remoteId
        title
        coverUrl
        summary
        publishingStatus
        publishingType
        startDate
        totalChapters
        trackingUrl
      }
    }
  }
`;

export const BIND_TRACK = `
  mutation BindTrack($mangaId: Int!, $trackerId: Int!, $remoteId: LongString!) {
    bindTrack(input: { mangaId: $mangaId, trackerId: $trackerId, remoteId: $remoteId }) {
      trackRecord {
        id
        trackerId
        remoteId
        title
        status
        score
        displayScore
        lastChapterRead
        totalChapters
        remoteUrl
        startDate
        finishDate
        private
      }
    }
  }
`;

export const UPDATE_TRACK = `
  mutation UpdateTrack($recordId: Int!, $status: Int, $lastChapterRead: Float, $scoreString: String, $startDate: LongString, $finishDate: LongString, $private: Boolean) {
    updateTrack(input: { recordId: $recordId, status: $status, lastChapterRead: $lastChapterRead, scoreString: $scoreString, startDate: $startDate, finishDate: $finishDate, private: $private }) {
      trackRecord {
        id
        trackerId
        status
        score
        displayScore
        lastChapterRead
        totalChapters
        startDate
        finishDate
        private
      }
    }
  }
`;

export const UNBIND_TRACK = `
  mutation UnbindTrack($recordId: Int!) {
    unbindTrack(input: { recordId: $recordId }) {
      trackRecord {
        id
      }
    }
  }
`;

export const FETCH_TRACK = `
  mutation FetchTrack($recordId: Int!) {
    fetchTrack(input: { recordId: $recordId }) {
      trackRecord {
        id
        trackerId
        status
        score
        displayScore
        lastChapterRead
        totalChapters
        startDate
        finishDate
      }
    }
  }
`;

export const GET_ALL_TRACKER_RECORDS = `
  query GetAllTrackerRecords {
    trackers {
      nodes {
        id
        name
        icon
        isLoggedIn
        scores
        statuses { value name }
        trackRecords {
          nodes {
            id
            trackerId
            title
            status
            displayScore
            lastChapterRead
            totalChapters
            remoteUrl
            private
            manga {
              id
              title
              thumbnailUrl
              inLibrary
            }
          }
        }
      }
    }
  }
`;

export const GET_TRACKER_RECORDS = `
  query GetTrackerRecords($trackerId: Int!) {
    trackers(condition: { id: $trackerId }) {
      nodes {
        id
        name
        statuses { value name }
        trackRecords {
          nodes {
            id
            title
            status
            displayScore
            lastChapterRead
            totalChapters
            remoteUrl
            manga {
              id
              title
              thumbnailUrl
            }
          }
        }
      }
    }
  }
`;

export const LOGIN_TRACKER_OAUTH = `
  mutation LoginTrackerOAuth($trackerId: Int!, $callbackUrl: String!) {
    loginTrackerOAuth(input: { trackerId: $trackerId, callbackUrl: $callbackUrl }) {
      isLoggedIn
      tracker {
        id
        name
        isLoggedIn
        authUrl
      }
    }
  }
`;

export const LOGIN_TRACKER_CREDENTIALS = `
  mutation LoginTrackerCredentials($trackerId: Int!, $username: String!, $password: String!) {
    loginTrackerCredentials(input: { trackerId: $trackerId, username: $username, password: $password }) {
      isLoggedIn
      tracker {
        id
        name
        isLoggedIn
        authUrl
      }
    }
  }
`;

export const LOGOUT_TRACKER = `
  mutation LogoutTracker($trackerId: Int!) {
    logoutTracker(input: { trackerId: $trackerId }) {
      tracker {
        id
        name
        isLoggedIn
        authUrl
      }
    }
  }
`;
