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

export const UPDATE_MANGAS = `
  mutation UpdateMangas($ids: [Int!]!, $inLibrary: Boolean) {
    updateMangas(input: { ids: $ids, patch: { inLibrary: $inLibrary } }) {
      mangas {
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
      localSourcePath
    }
  }
`;

export const SET_DOWNLOADS_PATH = `
  mutation SetDownloadsPath($path: String!) {
    setSettings(input: { settings: { downloadsPath: $path } }) {
      settings { downloadsPath }
    }
  }
`;

export const SET_LOCAL_SOURCE_PATH = `
  mutation SetLocalSourcePath($path: String!) {
    setSettings(input: { settings: { localSourcePath: $path } }) {
      settings { localSourcePath }
    }
  }
`;

// ── Categories ────────────────────────────────────────────────────────────────

export const GET_CATEGORIES = `
  query GetCategories {
    categories {
      nodes {
        id
        name
        order
        default
        includeInUpdate
        includeInDownload
        mangas {
          nodes {
            id
            title
            thumbnailUrl
            inLibrary
            downloadCount
            unreadCount
          }
        }
      }
    }
  }
`;

export const CREATE_CATEGORY = `
  mutation CreateCategory($name: String!) {
    createCategory(input: { name: $name }) {
      category {
        id
        name
        order
        default
        includeInUpdate
        includeInDownload
      }
    }
  }
`;

export const UPDATE_CATEGORY = `
  mutation UpdateCategory($id: Int!, $name: String) {
    updateCategory(input: { id: $id, patch: { name: $name } }) {
      category {
        id
        name
        order
      }
    }
  }
`;

export const DELETE_CATEGORY = `
  mutation DeleteCategory($id: Int!) {
    deleteCategory(input: { categoryId: $id }) {
      category {
        id
      }
    }
  }
`;

export const UPDATE_CATEGORY_ORDER = `
  mutation UpdateCategoryOrder($id: Int!, $position: Int!) {
    updateCategoryOrder(input: { id: $id, position: $position }) {
      categories {
        id
        name
        order
        default
        includeInUpdate
        includeInDownload
      }
    }
  }
`;

export const UPDATE_MANGA_CATEGORIES = `
  mutation UpdateMangaCategories($mangaId: Int!, $addTo: [Int!]!, $removeFrom: [Int!]!) {
    updateMangaCategories(input: { id: $mangaId, patch: { addToCategories: $addTo, removeFromCategories: $removeFrom } }) {
      manga {
        id
      }
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
  mutation FetchSourceManga($source: LongString!, $type: FetchSourceMangaType!, $page: Int!, $query: String, $filters: [FilterChangeInput!]) {
    fetchSourceManga(input: { source: $source, type: $type, page: $page, query: $query, filters: $filters }) {
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

export const GET_SERVER_SECURITY = `
  query GetServerSecurity {
    settings {
      authMode
      authUsername
      socksProxyEnabled
      socksProxyHost
      socksProxyPort
      socksProxyVersion
      socksProxyUsername
      flareSolverrEnabled
      flareSolverrUrl
      flareSolverrTimeout
      flareSolverrSessionName
      flareSolverrSessionTtl
      flareSolverrAsResponseFallback
    }
  }
`;

export const SET_SERVER_AUTH = `
  mutation SetServerAuth($authMode: AuthMode!, $authUsername: String!, $authPassword: String!) {
    setSettings(input: { settings: { authMode: $authMode, authUsername: $authUsername, authPassword: $authPassword } }) {
      settings {
        authMode
        authUsername
      }
    }
  }
`;

export const SET_SOCKS_PROXY = `
  mutation SetSocksProxy(
    $socksProxyEnabled: Boolean!
    $socksProxyHost: String!
    $socksProxyPort: String!
    $socksProxyVersion: Int!
    $socksProxyUsername: String!
    $socksProxyPassword: String!
  ) {
    setSettings(input: { settings: {
      socksProxyEnabled: $socksProxyEnabled
      socksProxyHost: $socksProxyHost
      socksProxyPort: $socksProxyPort
      socksProxyVersion: $socksProxyVersion
      socksProxyUsername: $socksProxyUsername
      socksProxyPassword: $socksProxyPassword
    }}) {
      settings {
        socksProxyEnabled
        socksProxyHost
        socksProxyPort
        socksProxyVersion
        socksProxyUsername
      }
    }
  }
`;

export const SET_FLARESOLVERR = `
  mutation SetFlareSolverr(
    $flareSolverrEnabled: Boolean!
    $flareSolverrUrl: String!
    $flareSolverrTimeout: Int!
    $flareSolverrSessionName: String!
    $flareSolverrSessionTtl: Int!
    $flareSolverrAsResponseFallback: Boolean!
  ) {
    setSettings(input: { settings: {
      flareSolverrEnabled: $flareSolverrEnabled
      flareSolverrUrl: $flareSolverrUrl
      flareSolverrTimeout: $flareSolverrTimeout
      flareSolverrSessionName: $flareSolverrSessionName
      flareSolverrSessionTtl: $flareSolverrSessionTtl
      flareSolverrAsResponseFallback: $flareSolverrAsResponseFallback
    }}) {
      settings {
        flareSolverrEnabled
        flareSolverrUrl
        flareSolverrTimeout
        flareSolverrSessionName
        flareSolverrSessionTtl
        flareSolverrAsResponseFallback
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

export const LOGIN_USER = `
  mutation Login($username: String!, $password: String!) {
    login(input: { username: $username, password: $password }) {
      accessToken
      refreshToken
    }
  }
`;

export const REFRESH_TOKEN = `
  mutation RefreshToken {
    refreshToken {
      accessToken
    }
  }
`;

export const UPDATE_LIBRARY = `
  mutation UpdateLibrary {
    updateLibrary(input: {}) {
      updateStatus {
        jobsInfo {
          isRunning
          finishedJobs
          totalJobs
        }
      }
    }
  }
`;

// ── Backup ────────────────────────────────────────────────────────────────────

export const CREATE_BACKUP = `
  mutation CreateBackup {
    createBackup(input: {}) {
      url
    }
  }
`;

export const RESTORE_BACKUP = `
  mutation RestoreBackup($backup: Upload!) {
    restoreBackup(input: { backup: $backup }) {
      id
      status {
        mangaProgress
        state
        totalManga
      }
    }
  }
`;

export const GET_RESTORE_STATUS = `
  query GetRestoreStatus($id: String!) {
    restoreStatus(id: $id) {
      mangaProgress
      state
      totalManga
    }
  }
`;

export const VALIDATE_BACKUP = `
  query ValidateBackup($backup: Upload!) {
    validateBackup(input: { backup: $backup }) {
      missingSources {
        id
        name
      }
      missingTrackers {
        name
      }
    }
  }
`;

export const LIBRARY_UPDATE_STATUS = `
  query LibraryUpdateStatus {
    libraryUpdateStatus {
      jobsInfo {
        isRunning
        finishedJobs
        totalJobs
        skippedMangasCount
      }
      mangaUpdates {
        status
        manga {
          id
          title
          thumbnailUrl
          unreadCount
        }
      }
    }
  }
`;
