import { createOpenRouterClient, type ChatJson, type LlmUsage, type ReasoningEffort } from "@epicaid/core";
import { schema } from "@epicaid/db";
import { createNodeDb } from "@epicaid/db/node";
import { readExtractedBook } from "./book";
import { extractBook } from "./extract";
import { BOOK_SUMMARY_PROMPT_VERSION } from "@epicaid/core";
import { existingBookSummaries, loadBook } from "./load";
import { mergeSubjects, passageCount } from "./merge";
import { chapterParagraphs, splitPassages } from "./passages";
import { writeReport } from "./report";
import { summariseSubjects } from "./summarize";
import { terminalProgress, type ProgressFactory } from "./progress";

export const DEFAULT_MODEL = "deepseek/deepseek-v4-flash-0731";
/** Extraction is listing names in a short Passage: thinking first mostly burns output tokens. */
export const DEFAULT_EXTRACTION_REASONING: ReasoningEffort = "none";
/** A little thinking helps a summary stay in story order and cite the right Chapters. */
export const DEFAULT_SUMMARY_REASONING: ReasoningEffort = "low";

export interface IngestOptions {
  bookFolder: string;
  seriesSlug: string;
  seriesName?: string;
  model: string;
  summaryModel: string;
  reasoning: ReasoningEffort;
  summaryReasoning: ReasoningEffort;
  concurrency: number;
  majorThreshold: number;
  passageWords: number;
  dryRun: boolean;
  skipSummaries: boolean;
  /** Rewrite Book Summaries that already exist for this model and prompt version. */
  resummarise?: boolean;
  /**
   * Ignore work other models did: extraction caches in other models' folders and other models' Book Summaries.
   * Off by default, so switching models only pays for what no model has done yet.
   */
  fresh?: boolean;
  /** Injected in tests; otherwise an OpenRouter client is created from OPENROUTER_API_KEY. */
  chatJson?: ChatJson;
  /** Injected in tests; otherwise bars are drawn on stdout when it is a terminal. */
  progress?: ProgressFactory;
}

export async function ingest(options: IngestOptions) {
  const log = (line: string) => console.log(line);
  const book = await readExtractedBook(options.bookFolder);
  const passagesByChapter = book.chapters.map((c) => splitPassages(chapterParagraphs(c.html), options.passageWords));
  const passageTotal = passagesByChapter.reduce((n, p) => n + p.length, 0);
  const words = passagesByChapter.flat().reduce((n, p) => n + p.split(/\s+/).length, 0);
  log(`${book.title} by ${book.author}: ${book.chapters.length} Chapters, ${passageTotal} Passages, ${words.toLocaleString()} words.`);
  if (options.dryRun) {
    log("Dry run: stopping before any model calls or database writes.");
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!options.chatJson && !apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  const chatJson = options.chatJson ?? createOpenRouterClient({ apiKey: apiKey as string });
  const { db, close } = createNodeDb();
  let spend = 0;
  const tokens = { completion: 0, reasoning: 0 };
  const usageLogger = (purpose: "extraction" | "book_summary") => async (usage: LlmUsage) => {
    spend += usage.costUsd;
    tokens.completion += usage.completionTokens;
    tokens.reasoning += usage.reasoningTokens;
    await db.insert(schema.spendLog).values({
      purpose,
      model: usage.model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsd: usage.costUsd.toFixed(6),
    });
  };

  try {
    log(`Extracting with ${options.model}, reasoning ${options.reasoning} (cached per Chapter, safe to re-run)…`);
    const extraction = await extractBook({
      bookFolder: book.folder,
      passagesByChapter,
      chatJson,
      model: options.model,
      reasoning: options.reasoning,
      fresh: options.fresh,
      concurrency: options.concurrency,
      onUsage: usageLogger("extraction"),
      log,
      progress: options.progress ?? terminalProgress(),
    });

    const merged = mergeSubjects(extraction);
    const { subjects } = merged;
    const report = await writeReport(book, merged, options.majorThreshold);
    log(`Merged into ${subjects.length} Subjects. Review report: ${report}`);

    const loaded = await loadBook(db, {
      seriesSlug: options.seriesSlug,
      seriesName: options.seriesName ?? book.seriesName ?? options.seriesSlug,
      book,
      passagesByChapter,
      subjects,
      majorThreshold: options.majorThreshold,
    });
    log(`Loaded as Draft: ${loaded.newSubjects} new Subjects, ${loaded.reusedSubjects} matched to existing ones.`);

    if (!options.skipSummaries) {
      const done = options.resummarise
        ? new Map<string, string>()
        : await existingBookSummaries(
            db,
            loaded.bookId,
            BOOK_SUMMARY_PROMPT_VERSION,
            options.fresh ? options.summaryModel : undefined,
          );
      const byOthers = [...done.values()].filter((m) => m !== options.summaryModel).length;
      const majors = subjects
        .filter((s) => passageCount(s) >= options.majorThreshold)
        .map((merged) => ({ merged, subjectId: loaded.subjectIds.get(merged) as string }))
        .filter(({ subjectId }) => !done.has(subjectId));
      log(`Writing Book Summaries for ${majors.length} Major Subjects with ${options.summaryModel}, reasoning ${options.summaryReasoning} (${done.size} already written${byOthers ? `, ${byOthers} of them by other models` : ""})…`);
      await summariseSubjects({
        db,
        chatJson,
        model: options.summaryModel,
        reasoning: options.summaryReasoning,
        concurrency: options.concurrency,
        book,
        bookId: loaded.bookId,
        passagesByChapter,
        subjects: majors,
        onUsage: usageLogger("book_summary"),
        log,
        progress: options.progress ?? terminalProgress(),
      });
    }
    log(
      `Done. Spent $${spend.toFixed(4)} on this run (cached Chapters cost nothing). ` +
        `Output tokens: ${tokens.completion.toLocaleString()}, of which reasoning: ${tokens.reasoning.toLocaleString()}.`,
    );
  } finally {
    await close();
  }
}
