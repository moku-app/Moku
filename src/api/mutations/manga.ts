export const FETCH_MANGA = `
  mutation FetchManga($id: Int!) {
    fetchManga(input: { id: $id }) {
      manga {
        id title description thumbnailUrl status author artist genre inLibrary realUrl
        source { id name displayName }
      }
    }
  }
`;

export const UPDATE_MANGA = `
  mutation UpdateManga($id: Int!, $inLibrary: Boolean) {
    updateManga(input: { id: $id, patch: { inLibrary: $inLibrary } }) {
      manga { id inLibrary }
    }
  }
`;

export const UPDATE_MANGAS = `
  mutation UpdateMangas($ids: [Int!]!, $inLibrary: Boolean) {
    updateMangas(input: { ids: $ids, patch: { inLibrary: $inLibrary } }) {
      mangas { id inLibrary }
    }
  }
`;

export const UPDATE_MANGA_CATEGORIES = `
  mutation UpdateMangaCategories($mangaId: Int!, $addTo: [Int!]!, $removeFrom: [Int!]!) {
    updateMangaCategories(input: { id: $mangaId, patch: { addToCategories: $addTo, removeFromCategories: $removeFrom } }) {
      manga { id }
    }
  }
`;

export const CREATE_CATEGORY = `
  mutation CreateCategory($name: String!) {
    createCategory(input: { name: $name }) {
      category { id name order default includeInUpdate includeInDownload }
    }
  }
`;

export const UPDATE_CATEGORY = `
  mutation UpdateCategory($id: Int!, $name: String) {
    updateCategory(input: { id: $id, patch: { name: $name } }) {
      category { id name order }
    }
  }
`;

export const DELETE_CATEGORY = `
  mutation DeleteCategory($id: Int!) {
    deleteCategory(input: { categoryId: $id }) {
      category { id }
    }
  }
`;

export const UPDATE_CATEGORY_ORDER = `
  mutation UpdateCategoryOrder($id: Int!, $position: Int!) {
    updateCategoryOrder(input: { id: $id, position: $position }) {
      categories { id name order default includeInUpdate includeInDownload }
    }
  }
`;

export const UPDATE_LIBRARY = `
  mutation UpdateLibrary {
    updateLibrary(input: {}) {
      updateStatus {
        jobsInfo { isRunning finishedJobs totalJobs }
      }
    }
  }
`;

export const CREATE_BACKUP = `
  mutation CreateBackup {
    createBackup(input: {}) { url }
  }
`;

export const RESTORE_BACKUP = `
  mutation RestoreBackup($backup: Upload!) {
    restoreBackup(input: { backup: $backup }) {
      id
      status { mangaProgress state totalManga }
    }
  }
`;
