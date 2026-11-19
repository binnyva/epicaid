/**
 * Writes the Book Summaries Ingestion should have written but didn't (a failed call, or a Subject that only
 * became Major after a merge), straight from the database. Unlike re-running ingest, it leaves Chapters,
 * Passages and Reveal Chapters alone.
 */
import {
  BOOK_SUMMARY_PROMPT_VERSION,
  createOpenRouterClient,
  LlmError,
  type ReasoningEffort,
  writeBookSummary,
} from "@epicaid/core";
import { schema, sql } from "@epicaid/db";
import { createNodeDb } from "@epicaid/db/node";
import { mapPool } from "./ingest/pool";

export interface SummariseOptions {
  seriesSlug: string;
  /** Only this Book (slug); otherwise every Book in the Series. */
  bookSlug?: string;
  model: string;
  reasoning: ReasoningEffort;
  concurrency: number;
  /** Passages a Subject needs in a Book to count as Major there, as in ingest. */
  majorThreshold: number;
  dryRun: boolean;
}

interface Missing {
  bookId: string;
  bookTitle: string;
  subjectId: string;
  subjectName: string;
  passages: number;
}

export async function summariseMissing(options: SummariseOptions) {
  const log = (line: string) => console.log(line);
  const { db, close } = createNodeDb();
  try {
    // Same rule as ingest: a Subject mentioned in at least --major Passages of a Book gets a Book Summary
    // (scope "", current prompt version, by any model).
    const result = await db.execute(sql`
      with counts as (
        select ch.book_id, m.subject_id, count(distinct m.passage_id)::int as passages
        from mentions m
        join passages p on p.id = m.passage_id
        join chapters ch on ch.id = p.chapter_id
        group by ch.book_id, m.subject_id)
      select b.id as book_id, b.title as book_title, s.id as subject_id, s.name as subject_name, c.passages
      from counts c
      join books b on b.id = c.book_id
      join series se on se.id = b.series_id
      join subjects s on s.id = c.subject_id
      where se.slug = ${options.seriesSlug}
        and (${options.bookSlug ?? null}::text is null or b.slug = ${options.bookSlug ?? null})
        and c.passages >= ${options.majorThreshold}
        and not exists (
          select 1 from book_summaries bs
          where bs.book_id = c.book_id and bs.subject_id = c.subject_id
            and bs.scope = '' and bs.prompt_version = ${BOOK_SUMMARY_PROMPT_VERSION})
      order by b.created_at, c.passages desc`);
    const missing: Missing[] = result.rows.map((r) => ({
      bookId: String(r.book_id),
      bookTitle: String(r.book_title),
      subjectId: String(r.subject_id),
      subjectName: String(r.subject_name),
      passages: Number(r.passages),
    }));

    if (!missing.length) {
      log("No Book Summaries missing.");
      return;
    }
    log(`${missing.length} Book Summaries missing:`);
    for (const m of missing) log(`  ${m.bookTitle}: ${m.subjectName} (${m.passages} Passages)`);
    if (options.dryRun) {
      log("Dry run: no model calls or writes.");
      return;
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
    const chatJson = createOpenRouterClient({ apiKey });
    let spend = 0;
    const onUsage = async (usage: { model: string; promptTokens: number; completionTokens: number; costUsd: number }) => {
      spend += usage.costUsd;
      try {
        await db.insert(schema.spendLog).values({
          purpose: "book_summary",
          model: usage.model,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          costUsd: usage.costUsd.toFixed(6),
        });
      } catch (error) {
        console.warn(`  (could not record spend in the database: ${error instanceof Error ? error.message : error})`);
      }
    };

    log(`Writing them with ${options.model}, reasoning ${options.reasoning}…`);
    const failed: string[] = [];
    let written = 0;
    await mapPool(missing, options.concurrency, async (m) => {
      const label = `${m.bookTitle}: ${m.subjectName}`;
      try {
        // Every Passage of this Book that mentions the Subject, in reading order, and the Aliases used there.
        const rows = await db.execute(sql`
          select ch.label, p.text, array_agg(distinct a.name) as aliases
          from mentions mn
          join passages p on p.id = mn.passage_id
          join chapters ch on ch.id = p.chapter_id
          join aliases a on a.id = mn.alias_id
          where mn.subject_id = ${m.subjectId}::uuid and ch.book_id = ${m.bookId}::uuid
          group by ch.index, ch.label, p.index, p.text
          order by ch.index, p.index`);
        const aliases = [...new Set(rows.rows.flatMap((r) => r.aliases as string[]))];
        const text = await writeBookSummary({
          chatJson,
          model: options.model,
          reasoning: options.reasoning,
          subjectName: m.subjectName,
          aliases,
          bookTitle: m.bookTitle,
          passages: rows.rows.map((r) => ({ chapterLabel: String(r.label), text: String(r.text) })),
          onUsage,
        });
        await db.execute(sql`insert into book_summaries (subject_id, book_id, scope, text, model, prompt_version)
          values (${m.subjectId}::uuid, ${m.bookId}::uuid, '', ${text}, ${options.model}, ${BOOK_SUMMARY_PROMPT_VERSION})
          on conflict (subject_id, book_id, scope, model, prompt_version) do update set text = excluded.text, created_at = now()`);
        written++;
        log(`  summarised ${label} (${rows.rows.length} Passages)`);
      } catch (error) {
        failed.push(label);
        if (error instanceof LlmError && error.usage && (error.usage.costUsd > 0 || error.usage.completionTokens > 0)) {
          await onUsage(error.usage);
        }
        log(`  FAILED ${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    log(`Wrote ${written} of ${missing.length}. Spent $${spend.toFixed(4)}.`);
    if (failed.length) {
      log(`${failed.length} failed. Re-run the same command to retry just those.`);
      process.exitCode = 1;
    }
  } finally {
    await close();
  }
}
