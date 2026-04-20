export const FETCH_EXTENSIONS = `
  mutation FetchExtensions {
    fetchExtensions(input: {}) {
      extensions {
        apkName pkgName name lang versionName
        isInstalled isObsolete hasUpdate iconUrl
      }
    }
  }
`;

export const UPDATE_EXTENSION = `
  mutation UpdateExtension($id: String!, $install: Boolean, $uninstall: Boolean, $update: Boolean) {
    updateExtension(input: { id: $id, patch: { install: $install, uninstall: $uninstall, update: $update } }) {
      extension { apkName pkgName name isInstalled hasUpdate }
    }
  }
`;

export const INSTALL_EXTERNAL_EXTENSION = `
  mutation InstallExternalExtension($url: String!) {
    installExternalExtension(input: { extensionUrl: $url }) {
      extension { apkName pkgName name isInstalled }
    }
  }
`;

export const SET_EXTENSION_REPOS = `
  mutation SetExtensionRepos($repos: [String!]!) {
    setSettings(input: { settings: { extensionRepos: $repos } }) {
      settings { extensionRepos }
    }
  }
`;

export const SET_SERVER_AUTH = `
  mutation SetServerAuth($authMode: AuthMode!, $authUsername: String!, $authPassword: String!) {
    setSettings(input: { settings: { authMode: $authMode, authUsername: $authUsername, authPassword: $authPassword } }) {
      settings { authMode authUsername }
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
      settings { socksProxyEnabled socksProxyHost socksProxyPort socksProxyVersion socksProxyUsername }
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
        flareSolverrEnabled flareSolverrUrl flareSolverrTimeout
        flareSolverrSessionName flareSolverrSessionTtl flareSolverrAsResponseFallback
      }
    }
  }
`;
