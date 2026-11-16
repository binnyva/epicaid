/** Load stage: writes one Book and its catalogue into the database, as a Draft. */
import type { NodeDb } from "@epicaid/db/node";
import { and, eq, inArray, schema, sql } from "@epicaid/db";
import type { ExtractedBook } from "./book";
import { normaliseName, passageCount, type MergedSubject } from "./merge";

const { series, books, chapters, passages, subjects, aliases, mentions, bookSummaries } = schema;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface LoadResult {
  seriesId: string;
  bookId: string;
  /** Database id of each loaded Subject, by its merged name. */
  subjectIds: Map<MergedSubject, string>;
  newSubjects: number;
  reusedSubjects: number;
}

export async function loadBook(
  db: NodeDb,
  input: {
    seriesSlug: string;
    seriesName: string;
    book: ExtractedBook;
    passagesByChapter: string[][];
    subjects: MergedSubject[];
    majorThreshold: number;
  },
): Promise<LoadResult> {
  return db.transaction(async (tx) => {
    // Series and Book (Drafts until the admin publishes them).
    await tx.insert(series).values({ slug: input.seriesSlug, name: input.seriesName }).onConflictDoNothing();
    const [seriesRow] = await tx.select().from(series).where(eq(series.slug, input.seriesSlug));
    if (!seriesRow) throw new Error("Series insert failed");

    const [existingBook] = await tx
      .select()
      .from(books)
      .where(and(eq(books.seriesId, seriesRow.id), eq(books.slug, input.book.slug)));
    let bookId: string;
    if (existingBook) {
      bookId = existingBook.id;
      // Cascades to Passages and Mentions. Book Summaries stay; pass --resummarise to rewrite them.
      await tx.delete(chapters).where(eq(chapters.bookId, bookId));
      await tx.update(books).set({ title: input.book.title, author: input.book.author }).where(eq(books.id, bookId));
    } else {
      const [row] = await tx
        .insert(books)
        .values({ seriesId: seriesRow.id, slug: input.book.slug, title: input.book.title, author: input.book.author })
        .returning({ id: books.id });
      bookId = (row as { id: string }).id;
    }

    // Chapters and Passages.
    const chapterRows = await tx
      .insert(chapters)
      .values(input.book.chapters.map((c) => ({ bookId, index: c.index, label: c.label, title: c.title, part: c.part })))
      .returning({ id: chapters.id, index: chapters.index });
    const chapterIds = new Map(chapterRows.map((r) => [r.index, r.id]));
    const passageIds = new Map<string, string>();
    const passageValues = input.passagesByChapter.flatMap((texts, chapterIndex) =>
      texts.map((text, index) => ({ chapterId: chapterIds.get(chapterIndex) as string, index, text, chapterIndex })),
    );
    for (const batch of chunks(passageValues, 500)) {
      const rows = await tx
        .insert(passages)
        .values(batch.map(({ chapterIndex: _, ...v }) => v))
        .returning({ id: passages.id, chapterId: passages.chapterId, index: passages.index });
      const chapterIndexById = new Map([...chapterIds].map(([i, id]) => [id, i]));
      for (const r of rows) passageIds.set(`${chapterIndexById.get(r.chapterId)}:${r.index}`, r.id);
    }

    // Subjects: reuse an existing Subject of this Series when an Alias matches (e.g. from an earlier Book).
    const existingAliases = await tx
      .select({ id: aliases.id, name: aliases.name, subjectId: aliases.subjectId })
      .from(aliases)
      .innerJoin(subjects, eq(subjects.id, aliases.subjectId))
      .where(eq(subjects.seriesId, seriesRow.id));
    const subjectsByNorm = new Map<string, string[]>();
    const aliasIdByKey = new Map<string, string>();
    for (const a of existingAliases) {
      const norm = normaliseName(a.name);
      subjectsByNorm.set(norm, [...(subjectsByNorm.get(norm) ?? []), a.subjectId]);
      aliasIdByKey.set(`${a.subjectId}:${a.name}`, a.id);
    }

    const subjectIds = new Map<MergedSubject, string>();
    let newSubjects = 0;
    let reusedSubjects = 0;
    const mentionRows: { passageId: string; aliasId: string; subjectId: string }[] = [];

    for (const merged of input.subjects) {
      const votes = new Map<string, number>();
      for (const alias of merged.aliases) {
        for (const id of subjectsByNorm.get(normaliseName(alias.name)) ?? []) votes.set(id, (votes.get(id) ?? 0) + 1);
      }
      let subjectId = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const isMajor = passageCount(merged) >= input.majorThreshold;
      if (subjectId) {
        reusedSubjects++;
        if (isMajor) await tx.update(subjects).set({ isMajor: true }).where(eq(subjects.id, subjectId));
      } else {
        const [row] = await tx
          .insert(subjects)
          .values({ seriesId: seriesRow.id, name: merged.name, kind: merged.kind, isMajor })
          .returning({ id: subjects.id });
        subjectId = (row as { id: string }).id;
        newSubjects++;
      }
      subjectIds.set(merged, subjectId);

      for (const alias of merged.aliases) {
        const key = `${subjectId}:${alias.name}`;
        if (aliasIdByKey.has(key)) continue;
        const [row] = await tx
          .insert(aliases)
          .values({
            subjectId,
            name: alias.name,
            revealChapterId: alias.revealChapterIndex === null ? null : chapterIds.get(alias.revealChapterIndex),
            reviewNote: alias.reviewNote,
          })
          .returning({ id: aliases.id });
        aliasIdByKey.set(key, (row as { id: string }).id);
        const norm = normaliseName(alias.name);
        subjectsByNorm.set(norm, [...(subjectsByNorm.get(norm) ?? []), subjectId]);
      }
      for (const m of merged.mentions) {
        const passageId = passageIds.get(`${m.chapterIndex}:${m.passageIndex}`);
        const aliasId = aliasIdByKey.get(`${subjectId}:${m.alias}`);
        if (passageId && aliasId) mentionRows.push({ passageId, aliasId, subjectId });
      }
    }

    for (const batch of chunks(mentionRows, 1000)) {
      await tx.insert(mentions).values(batch).onConflictDoNothing();
    }

    // Subjects left with no Mentions anywhere (e.g. after re-ingesting a Book) are dropped.
    await tx.execute(sql`
      delete from ${subjects} s
      where s.series_id = ${seriesRow.id}
        and not exists (select 1 from ${mentions} m where m.subject_id = s.id)`);

    return { seriesId: seriesRow.id, bookId, subjectIds, newSubjects, reusedSubjects };
  });
}

/**
 * Subjects in this Book that already have a Book Summary for this prompt version, mapped to the model that
 * wrote it. Pass a model to count only that model's summaries; leave it out to count any model's.
 */
export async function existingBookSummaries(
  db: NodeDb,
  bookId: string,
  promptVersion: string,
  model?: string,
): Promise<Map<string, string>> {
  const rows = await db
    .select({ subjectId: bookSummaries.subjectId, model: bookSummaries.model })
    .from(bookSummaries)
    .where(
      and(
        eq(bookSummaries.bookId, bookId),
        eq(bookSummaries.promptVersion, promptVersion),
        eq(bookSummaries.scope, ""),
        model ? eq(bookSummaries.model, model) : undefined,
      ),
    );
  return new Map(rows.map((r) => [r.subjectId, r.model]));
}

export async function majorSubjectIds(db: NodeDb, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(and(inArray(subjects.id, ids), eq(subjects.isMajor, true)));
  return new Set(rows.map((r) => r.id));
}
