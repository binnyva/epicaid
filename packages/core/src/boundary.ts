/**
 * The Spoiler Boundary (see CONTEXT.md and ADR 0004).
 *
 * A boundary is the set of Finished Books plus, optionally, the current Book up to
 * and including the last finished Chapter. It is never a position in a Reading Order.
 */

export interface ChapterRef {
  bookId: string;
  /** Zero-based position of the Chapter within its Book. */
  chapterIndex: number;
}

export interface ReadingPosition {
  bookId: string;
  /** Zero-based index of the last Chapter the Reader has finished in this Book. */
  lastFinishedChapterIndex: number;
}

export interface SpoilerBoundary {
  finishedBookIds: readonly string[];
  /** Null when the Reader is between Books or has not finished a Chapter of the current Book. */
  position: ReadingPosition | null;
}

export function isChapterVisible(boundary: SpoilerBoundary, chapter: ChapterRef): boolean {
  if (boundary.finishedBookIds.includes(chapter.bookId)) return true;
  const { position } = boundary;
  return (
    position !== null &&
    position.bookId === chapter.bookId &&
    chapter.chapterIndex <= position.lastFinishedChapterIndex
  );
}

/**
 * An Alias with no Reveal is an ordinary name and joins its Subject wherever it is visible.
 * A secret-identity Alias joins only once its Reveal Chapter is inside the boundary (ADR 0005).
 */
export function isAliasJoined(boundary: SpoilerBoundary, reveal: ChapterRef | null): boolean {
  return reveal === null || isChapterVisible(boundary, reveal);
}

/**
 * Canonical form of a boundary: Finished Books sorted and de-duplicated, and a position
 * dropped when its Book is already finished. Two Readers with the same visible text
 * get the same canonical boundary, whatever Reading Order they follow.
 */
export function canonicalBoundary(boundary: SpoilerBoundary): SpoilerBoundary {
  const finishedBookIds = [...new Set(boundary.finishedBookIds)].sort();
  const position =
    boundary.position && !finishedBookIds.includes(boundary.position.bookId)
      ? { ...boundary.position }
      : null;
  return { finishedBookIds, position };
}
