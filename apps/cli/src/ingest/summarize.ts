/** Writes Book Summaries for Major Subjects (ADR 0003). */
import {
  BOOK_SUMMARY_PROMPT_VERSION,
  type ChatJson,
  LlmError,
  type LlmUsage,
  type ReasoningEffort,
  writeBookSummary,
} from "@epicaid/core";
import type { NodeDb } from "@epicaid/db/node";
import { schema } from "@epicaid/db";
import type { ExtractedBook } from "./book";
import type { MergedSubject } from "./merge";
import { mapPool } from "./pool";

export { summaryMaxTokens } from "@epicaid/core";

export async function summariseSubjects(options: {
  db: NodeDb;
  chatJson: ChatJson;
  model: string;
  reasoning: ReasoningEffort;
  concurrency: number;
  book: ExtractedBook;
  bookId: string;
  passagesByChapter: string[][];
  subjects: { merged: MergedSubject; subjectId: string }[];
  onUsage: (usage: LlmUsage) => Promise<void> | void;
  log: (line: string) => void;
}): Promise<number> {
  let written = 0;
  const failed: string[] = [];
  await mapPool(options.subjects, options.concurrency, async ({ merged, subjectId }) => {
    const items: { chapterLabel: string; text: string }[] = [];
    try {
      const seen = new Set<string>();
      for (const m of [...merged.mentions].sort((a, b) => a.chapterIndex - b.chapterIndex || a.passageIndex - b.passageIndex)) {
        const key = `${m.chapterIndex}:${m.passageIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          chapterLabel: options.book.chapters[m.chapterIndex]?.label ?? `Chapter ${m.chapterIndex}`,
          text: options.passagesByChapter[m.chapterIndex]?.[m.passageIndex] ?? "",
        });
      }

      const summary = await writeBookSummary({
        chatJson: options.chatJson,
        model: options.model,
        reasoning: options.reasoning,
        subjectName: merged.name,
        aliases: merged.aliases.map((a) => a.name),
        bookTitle: options.book.title,
        passages: items,
        onUsage: options.onUsage,
      });

      // Scope "" = written from all of the Subject's Aliases in this Book (the reader app writes narrower ones).
      await options.db
        .insert(schema.bookSummaries)
        .values({ subjectId, bookId: options.bookId, text: summary, model: options.model, promptVersion: BOOK_SUMMARY_PROMPT_VERSION })
        .onConflictDoUpdate({
          target: [
            schema.bookSummaries.subjectId,
            schema.bookSummaries.bookId,
            schema.bookSummaries.scope,
            schema.bookSummaries.model,
            schema.bookSummaries.promptVersion,
          ],
          set: { text: summary, createdAt: new Date() },
        });
      written++;
      options.log(`  summarised ${merged.name} (${items.length} passages)`);
    } catch (error) {
      // One bad reply shouldn't stop the rest; re-running retries only the missing ones.
      failed.push(merged.name);
      // Failed attempts are still billed: count them in the spend log.
      if (error instanceof LlmError && error.usage && (error.usage.costUsd > 0 || error.usage.completionTokens > 0)) {
        await options.onUsage(error.usage);
      }
      options.log(`  FAILED ${merged.name} (${items.length} passages): ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  if (failed.length) {
    options.log(`${failed.length} Book Summaries failed (${failed.join(", ")}). Re-run the same command to retry just those.`);
  }
  return written;
}
