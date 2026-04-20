const TRACK_RECORD_FRAGMENT = `
  id trackerId remoteId title status score displayScore
  lastChapterRead totalChapters remoteUrl startDate finishDate private
`;

export const BIND_TRACK = `
  mutation BindTrack($mangaId: Int!, $trackerId: Int!, $remoteId: LongString!) {
    bindTrack(input: { mangaId: $mangaId, trackerId: $trackerId, remoteId: $remoteId }) {
      trackRecord { ${TRACK_RECORD_FRAGMENT} }
    }
  }
`;

export const UPDATE_TRACK = `
  mutation UpdateTrack($recordId: Int!, $status: Int, $lastChapterRead: Float, $scoreString: String, $startDate: LongString, $finishDate: LongString, $private: Boolean) {
    updateTrack(input: { recordId: $recordId, status: $status, lastChapterRead: $lastChapterRead, scoreString: $scoreString, startDate: $startDate, finishDate: $finishDate, private: $private }) {
      trackRecord {
        id trackerId status score displayScore lastChapterRead totalChapters startDate finishDate private
      }
    }
  }
`;

export const UNBIND_TRACK = `
  mutation UnbindTrack($recordId: Int!) {
    unbindTrack(input: { recordId: $recordId }) {
      trackRecord { id }
    }
  }
`;

export const FETCH_TRACK = `
  mutation FetchTrack($recordId: Int!) {
    fetchTrack(input: { recordId: $recordId }) {
      trackRecord {
        id trackerId status score displayScore lastChapterRead totalChapters startDate finishDate
      }
    }
  }
`;

export const LOGIN_TRACKER_OAUTH = `
  mutation LoginTrackerOAuth($trackerId: Int!, $callbackUrl: String!) {
    loginTrackerOAuth(input: { trackerId: $trackerId, callbackUrl: $callbackUrl }) {
      isLoggedIn
      tracker { id name isLoggedIn authUrl }
    }
  }
`;

export const LOGIN_TRACKER_CREDENTIALS = `
  mutation LoginTrackerCredentials($trackerId: Int!, $username: String!, $password: String!) {
    loginTrackerCredentials(input: { trackerId: $trackerId, username: $username, password: $password }) {
      isLoggedIn
      tracker { id name isLoggedIn authUrl }
    }
  }
`;

export const LOGOUT_TRACKER = `
  mutation LogoutTracker($trackerId: Int!) {
    logoutTracker(input: { trackerId: $trackerId }) {
      tracker { id name isLoggedIn authUrl }
    }
  }
`;

export const LOGIN_USER = `
  mutation Login($username: String!, $password: String!) {
    login(input: { username: $username, password: $password }) {
      accessToken refreshToken
    }
  }
`;

export const REFRESH_TOKEN = `
  mutation RefreshToken {
    refreshToken { accessToken }
  }
`;
