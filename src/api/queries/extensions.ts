export const GET_LOCAL_MANGA = `
  query GetLocalManga {
    mangas(condition: { sourceId: "0" }) {
      nodes { id title thumbnailUrl inLibrary }
    }
  }
`;

export const GET_EXTENSIONS = `
  query GetExtensions {
    extensions {
      nodes {
        apkName pkgName name lang versionName
        isInstalled isObsolete hasUpdate iconUrl
      }
    }
  }
`;

export const GET_SOURCES = `
  query GetSources {
    sources {
      nodes {
        id name lang displayName iconUrl isNsfw
        isConfigurable supportsLatest baseUrl
      }
    }
  }
`;

export const GET_SETTINGS = `
  query GetSettings {
    settings { extensionRepos }
  }
`;

export const GET_SERVER_SECURITY = `
  query GetServerSecurity {
    settings {
      authMode authUsername
      socksProxyEnabled socksProxyHost socksProxyPort socksProxyVersion socksProxyUsername
      flareSolverrEnabled flareSolverrUrl flareSolverrTimeout
      flareSolverrSessionName flareSolverrSessionTtl flareSolverrAsResponseFallback
    }
  }
`;