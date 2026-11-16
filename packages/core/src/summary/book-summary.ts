/**
 * Writes one Book Summary: what one Book alone reveals about a Subject (ADR 0003). Shared by Ingestion,
 * which writes them ahead for Major Subjects, and the reader app, which writes missing ones on first need.
 */
import {
  BOOK_SUMMARY_SYSTEM,
  bookSummarySchema,
  bookSummaryUserPrompt,
} from "../llm/prompts";
import type { ChatJson, LlmUsage, ReasoningEffort } from "../llm/openrouter";
import { wordCount } from "./sample";

/** Above this many words of Passages, summarise in parts and then summarise the parts. */
export const BOOK_SUMMARY_MAX_WORDS_PER_CALL = 30_000;

/**
 * A summary is at most ~400 words (~600 tokens of JSON). max_tokens covers reasoning too, so leave room for
 * the thinking each effort level does, and enough at high levels that the model is not cut off mid-thought.
 * When a reply is cut off, the client retries that one call with double the budget (up to 4x), so the extra
 * is only paid where it is needed.
 */
export function summaryMaxTokens(reasoning: ReasoningEffort): number {
  if (reasoning === "none") return 1500;
  if (reasoning === "minimal" || reasoning === "low") return 3000;
  return 8000;
}

export async function writeBookSummary(options: {
  chatJson: ChatJson;
  model: string;
  reasoning: ReasoningEffort;
  subjectName: string;
  aliases: string[];
  bookTitle: string;
  /** Every Passage of the Book that mentions the Subject, in reading order. */
  passages: { chapterLabel: string; text: string }[];
  onUsage: (usage: LlmUsage) => Promise<void> | void;
}): Promise<string> {
  const call = async (items: { chapterLabel: string; text: string }[]) => {
    const { data, usage } = await options.chatJson({
      model: options.model,
      system: BOOK_SUMMARY_SYSTEM,
      user: bookSummaryUserPrompt({
        subjectName: options.subjectName,
        aliases: options.aliases,
        bookTitle: options.bookTitle,
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

  // Split into parts small enough for one call; with more than one part, summarise the summaries.
  const parts: (typeof options.passages)[] = [[]];
  let words = 0;
  for (const item of options.passages) {
    const n = wordCount(item.text);
    if (words + n > BOOK_SUMMARY_MAX_WORDS_PER_CALL && (parts.at(-1)?.length ?? 0) > 0) {
      parts.push([]);
      words = 0;
    }
    parts.at(-1)?.push(item);
    words += n;
  }
  if (parts.length === 1) return call(options.passages);
  const partial = [];
  for (const part of parts) {
    partial.push({ chapterLabel: `Notes on ${part[0]?.chapterLabel} to ${part.at(-1)?.chapterLabel}`, text: await call(part) });
  }
  return call(partial);
}
