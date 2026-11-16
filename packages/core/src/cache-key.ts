import { createHash } from "node:crypto";
import { canonicalBoundary, type SpoilerBoundary } from "./boundary";

export interface SummaryKeyInput {
  /** The Subject's id, or the lookup ref ("a-<aliasId>") of an Alias that stands as its own Subject (ADR 0005). */
  subjectId: string;
  /**
   * The Aliases whose Mentions the Summary is built from. Which of a Subject's Aliases are joined depends on
   * which Reveals are inside the boundary, so two boundaries with the same Books can still need different
   * Summaries. Order does not matter.
   */
  aliasIds?: readonly string[];
  boundary: SpoilerBoundary;
  /**
   * Index of the last Chapter in the current Book, at or before the Reading Position,
   * that mentions the Subject. Null when the current Book has no such Mention.
   */
  lastMentionChapterIndex: number | null;
  model: string;
  promptVersion: string;
}

/**
 * Redis key for a cached Summary. Readers whose boundaries reveal the same Mentions of
 * a Subject share a key: the current Book only counts up to its last Mention of the Subject.
 */
export function summaryCacheKey(input: SummaryKeyInput): string {
  const boundary = canonicalBoundary(input.boundary);
  const current =
    boundary.position && input.lastMentionChapterIndex !== null
      ? {
          bookId: boundary.position.bookId,
          throughChapter: Math.min(input.lastMentionChapterIndex, boundary.position.lastFinishedChapterIndex),
        }
      : null;
  const canonical = JSON.stringify({
    finished: boundary.finishedBookIds,
    current,
    ...(input.aliasIds ? { aliases: [...new Set(input.aliasIds)].sort() } : {}),
    model: input.model,
    prompt: input.promptVersion,
  });
  const digest = createHash("sha256").update(canonical).digest("base64url").slice(0, 32);
  return `summary:${input.subjectId}:${digest}`;
}
