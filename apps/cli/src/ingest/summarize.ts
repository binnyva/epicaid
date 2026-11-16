/** Writes Book Summaries for Major Subjects (ADR 0003). */
import {
  BOOK_SUMMARY_PROMPT_VERSION,
  BOOK_SUMMARY_SYSTEM,
  bookSummarySchema,
  bookSummaryUserPrompt,
  type ChatJson,
  LlmError,
  type LlmUsage,
  type ReasoningEffort,
} from "@epicaid/core";
import type { NodeDb } from "@epicaid/db/node";
import { schema } from "@epicaid/db";
import type { ExtractedBook } from "./book";
import type { MergedSubject } from "./merge";
import { mapPool } from "./pool";

/** Above this many words of Passages, summarise in parts and then summarise the parts. */
const MAX_WORDS_PER_CALL = 30_000;

/**
 * A summary is at most ~400 words (~600 tokens of JSON). max_tokens covers reasoning too, so leave room for
 * the thinking each effort level does, and enough at high levels that the model is not cut off mid-thought.
 * Subjects with many Passages make the model think longer; when a reply is cut off, the client retries that one
 * call with double the budget (up to 4x), so the extra is only paid where it is needed.
 */
export function summaryMaxTokens(reasoning: ReasoningEffort): number {
  if (reasoning === "none") return 1500;
  if (reasoning === "minimal" || reasoning === "low") return 3000;
  return 8000;
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

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
  const call = async (subject: MergedSubject, items: { chapterLabel: string; text: string }[]) => {
    const { data, usage } = await options.chatJson({
      model: options.model,
      system: BOOK_SUMMARY_SYSTEM,
      user: bookSummaryUserPrompt({
        subjectName: subject.name,
        aliases: subject.aliases.map((a) => a.name),
        bookTitle: options.book.title,
        passages: items,
      }),
      schema: bookSummarySchema,
      schemaName: "book_summary",
      reasoning: options.reasoning,
      maxTokens: summaryMaxTokens(options.reasoning),
    });
    await options.onUsage(usage);
    return data.summary.trim();
  };

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

      // Split into parts small enough for one call; with more than one part, summarise the summaries.
      const parts: (typeof items)[] = [[]];
      let words = 0;
      for (const item of items) {
        const n = wordCount(item.text);
        if (words + n > MAX_WORDS_PER_CALL && (parts.at(-1)?.length ?? 0) > 0) {
          parts.push([]);
          words = 0;
        }
        parts.at(-1)?.push(item);
        words += n;
      }
      let summary: string;
      if (parts.length === 1) {
        summary = await call(merged, items);
      } else {
        const partial = [];
        for (const part of parts) {
          const first = part[0]?.chapterLabel;
          const last = part.at(-1)?.chapterLabel;
          partial.push({ chapterLabel: `Notes on ${first} to ${last}`, text: await call(merged, part) });
        }
        summary = await call(merged, partial);
      }

      await options.db
        .insert(schema.bookSummaries)
        .values({ subjectId, bookId: options.bookId, text: summary, model: options.model, promptVersion: BOOK_SUMMARY_PROMPT_VERSION })
        .onConflictDoUpdate({
          target: [schema.bookSummaries.subjectId, schema.bookSummaries.bookId, schema.bookSummaries.model, schema.bookSummaries.promptVersion],
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
