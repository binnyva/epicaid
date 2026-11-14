import { createOpenRouterClient, type ChatJson, type LlmUsage } from "@epicaid/core";
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

export const DEFAULT_MODEL = "deepseek/deepseek-v4-flash-0731";

export interface IngestOptions {
  bookFolder: string;
  seriesSlug: string;
  seriesName?: string;
  model: string;
  summaryModel: string;
  concurrency: number;
  majorThreshold: number;
  passageWords: number;
  dryRun: boolean;
  skipSummaries: boolean;
  /** Rewrite Book Summaries that already exist for this model and prompt version. */
  resummarise?: boolean;
  /** Injected in tests; otherwise an OpenRouter client is created from OPENROUTER_API_KEY. */
  chatJson?: ChatJson;
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
  const usageLogger = (purpose: "extraction" | "book_summary") => async (usage: LlmUsage) => {
    spend += usage.costUsd;
    await db.insert(schema.spendLog).values({
      purpose,
      model: usage.model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsd: usage.costUsd.toFixed(6),
    });
  };

  try {
    log(`Extracting with ${options.model} (cached per Chapter, safe to re-run)…`);
    const extraction = await extractBook({
      bookFolder: book.folder,
      passagesByChapter,
      chatJson,
      model: options.model,
      concurrency: options.concurrency,
      onUsage: usageLogger("extraction"),
      log,
    });

    const subjects = mergeSubjects(extraction);
    const report = await writeReport(book, subjects, options.majorThreshold);
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
        ? new Set<string>()
        : await existingBookSummaries(db, loaded.bookId, options.summaryModel, BOOK_SUMMARY_PROMPT_VERSION);
      const majors = subjects
        .filter((s) => passageCount(s) >= options.majorThreshold)
        .map((merged) => ({ merged, subjectId: loaded.subjectIds.get(merged) as string }))
        .filter(({ subjectId }) => !done.has(subjectId));
      log(`Writing Book Summaries for ${majors.length} Major Subjects with ${options.summaryModel} (${done.size} already written)…`);
      await summariseSubjects({
        db,
        chatJson,
        model: options.summaryModel,
        concurrency: options.concurrency,
        book,
        bookId: loaded.bookId,
        passagesByChapter,
        subjects: majors,
        onUsage: usageLogger("book_summary"),
        log,
      });
    }
    log(`Done. Spent $${spend.toFixed(4)} on this run (cached Chapters cost nothing).`);
  } finally {
    await close();
  }
}
