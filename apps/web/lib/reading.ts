/**
 * The signed-in Reader's current Reading and everything the reader screens show about it.
 * The current Reading is the one touched most recently; "Switch Series" touches another.
 */
import { cache } from "react";
import { redirect } from "next/navigation";
import type { SpoilerBoundary } from "@epicaid/core";
import { and, asc, desc, eq, schema, sql } from "@epicaid/db";
import { requireReader, type Reader } from "./auth";
import { getDb } from "./db";

export interface BookInfo {
  id: string;
  title: string;
  author: string;
  chapterCount: number;
  /** Position in the chosen Reading Order, or null when the order leaves the Book out. */
  orderPosition: number | null;
  finished: boolean;
}

export interface ChapterInfo {
  index: number;
  label: string;
  title: string | null;
  part: string | null;
}

export interface ReadingContext {
  reader: Reader;
  reading: typeof schema.readings.$inferSelect;
  series: { id: string; name: string; slug: string };
  readingOrder: { id: string; name: string } | null;
  /** Published Books of the Series: those in the Reading Order first, in its order, then the rest. */
  books: BookInfo[];
  currentBook: BookInfo | null;
  /** Chapters of the current Book, in order. */
  chapters: ChapterInfo[];
  /** The last finished Chapter of the current Book, if any. */
  lastFinished: ChapterInfo | null;
  boundary: SpoilerBoundary;
}

/** The Reader's current Reading, or null when they have not picked a Series yet. */
export const getReadingContext = cache(async (): Promise<ReadingContext | null> => {
  const reader = await requireReader();
  const db = getDb();
  const [row] = await db
    .select({ reading: schema.readings, series: schema.series })
    .from(schema.readings)
    .innerJoin(schema.series, eq(schema.series.id, schema.readings.seriesId))
    .where(and(eq(schema.readings.readerId, reader.id), eq(schema.series.status, "published")))
    .orderBy(desc(schema.readings.updatedAt))
    .limit(1);
  if (!row) return null;
  const { reading } = row;

  const [bookRows, finishedRows, order] = await Promise.all([
    db
      .select({
        id: schema.books.id,
        title: schema.books.title,
        author: schema.books.author,
        chapterCount: sql<number>`(select count(*)::int from chapters c where c.book_id = books.id)`,
        orderPosition: reading.readingOrderId
          ? sql<number | null>`(select position from reading_order_books rob where rob.book_id = books.id and rob.reading_order_id = ${reading.readingOrderId})`
          : sql<null>`null`,
      })
      .from(schema.books)
      .where(and(eq(schema.books.seriesId, row.series.id), eq(schema.books.status, "published")))
      .orderBy(asc(schema.books.createdAt)),
    db.select({ bookId: schema.finishedBooks.bookId }).from(schema.finishedBooks).where(eq(schema.finishedBooks.readingId, reading.id)),
    reading.readingOrderId
      ? db
          .select({ id: schema.readingOrders.id, name: schema.readingOrders.name })
          .from(schema.readingOrders)
          .where(eq(schema.readingOrders.id, reading.readingOrderId))
      : Promise.resolve([]),
  ]);
  const finished = new Set(finishedRows.map((f) => f.bookId));
  const books: BookInfo[] = bookRows
    .map((b, i) => ({ ...b, finished: finished.has(b.id), i }))
    .sort((a, b) => (a.orderPosition ?? 1e9 + a.i) - (b.orderPosition ?? 1e9 + b.i))
    .map(({ i: _i, ...b }) => b);

  const currentBook = books.find((b) => b.id === reading.currentBookId) ?? null;
  const chapters: ChapterInfo[] = currentBook
    ? await db
        .select({
          index: schema.chapters.index,
          label: schema.chapters.label,
          title: schema.chapters.title,
          part: schema.chapters.part,
        })
        .from(schema.chapters)
        .where(eq(schema.chapters.bookId, currentBook.id))
        .orderBy(asc(schema.chapters.index))
    : [];
  const lastIndex = reading.lastFinishedChapterIndex;
  const lastFinished = lastIndex === null ? null : (chapters.find((c) => c.index === lastIndex) ?? null);

  return {
    reader,
    reading,
    series: { id: row.series.id, name: row.series.name, slug: row.series.slug },
    readingOrder: order[0] ?? null,
    books,
    currentBook,
    chapters,
    lastFinished,
    boundary: {
      // Finished Books are filtered to published ones; the queries check publication again.
      finishedBookIds: books.filter((b) => b.finished).map((b) => b.id),
      position: currentBook && lastFinished ? { bookId: currentBook.id, lastFinishedChapterIndex: lastFinished.index } : null,
    },
  };
});

/** For pages that need a Reading: sends a Reader with none to the Series picker. */
export async function requireReading(): Promise<ReadingContext> {
  const ctx = await getReadingContext();
  if (!ctx) redirect("/series");
  return ctx;
}

/** "Finished Chapter Six", "Not started yet", or what to show between Books. */
export function positionHeadline(ctx: ReadingContext): string {
  if (!ctx.currentBook) return "Between Books";
  if (ctx.currentBook.finished) return "Finished";
  if (!ctx.lastFinished) return "Not started yet";
  return `Finished ${ctx.lastFinished.label}`;
}

/** Share of the current Book finished, 0 to 1. */
export function positionProgress(ctx: ReadingContext): number {
  if (!ctx.currentBook || !ctx.chapters.length) return 0;
  if (ctx.currentBook.finished) return 1;
  const done = ctx.lastFinished ? ctx.chapters.findIndex((c) => c.index === ctx.lastFinished!.index) + 1 : 0;
  return done / ctx.chapters.length;
}

/** "Up to Chapter Six" for the Subject header. */
export function boundaryChip(ctx: ReadingContext): string {
  if (ctx.currentBook && !ctx.currentBook.finished) {
    return ctx.lastFinished ? `Up to ${ctx.lastFinished.label}` : `Before ${ctx.currentBook.title}`;
  }
  return "Finished Books only";
}
