export const GET_CHAPTERS = `
  query GetChapters($mangaId: Int!) {
    chapters(condition: { mangaId: $mangaId }) {
      nodes {
        id name chapterNumber sourceOrder isRead isDownloaded isBookmarked
        pageCount mangaId uploadDate realUrl lastPageRead scanlator
      }
    }
  }
`;
