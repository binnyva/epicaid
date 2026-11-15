"use server";
/**
 * Reader server actions. Each one loads the Reader's own Reading and checks that any Book,
 * Chapter or Reading Order it is given belongs to that Reading's published Series.
 */
import { and, desc, eq, schema, sql } from "@epicaid/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireReader } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getReadingContext } from "@/lib/reading";

const { readings, finishedBooks, readingOrders, series } = schema;
const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

async function reading() {
  const ctx = await getReadingContext();
  if (!ctx) redirect("/series");
  return ctx;
}

const refresh = () => revalidatePath("/", "layout");

/** Picks a Series: makes its Reading the current one, creating it with the default Reading Order if new. */
export async function chooseSeries(form: FormData) {
  const reader = await requireReader();
  const db = getDb();
  const seriesId = str(form, "seriesId");
  const [s] = await db
    .select({ id: series.id })
    .from(series)
    .where(and(eq(series.id, seriesId), eq(series.status, "published")));
  if (!s) redirect("/series");
  const [order] = await db
    .select({ id: readingOrders.id })
    .from(readingOrders)
    .where(eq(readingOrders.seriesId, s.id))
    .orderBy(desc(readingOrders.isDefault), readingOrders.name)
    .limit(1);
  const [existing] = await db
    .select({ id: readings.id })
    .from(readings)
    .where(and(eq(readings.readerId, reader.id), eq(readings.seriesId, s.id)));
  if (existing) {
    await db.update(readings).set({ updatedAt: new Date() }).where(eq(readings.id, existing.id));
  } else {
    await db.insert(readings).values({ readerId: reader.id, seriesId: s.id, readingOrderId: order?.id ?? null });
  }
  refresh();
  redirect(existing ? "/" : "/reading");
}

/** Switching Reading Order never touches Finished Books (ADR 0004). */
export async function setReadingOrder(form: FormData) {
  const ctx = await reading();
  const db = getDb();
  const [order] = await db
    .select({ id: readingOrders.id })
    .from(readingOrders)
    .where(and(eq(readingOrders.id, str(form, "readingOrderId")), eq(readingOrders.seriesId, ctx.series.id)));
  if (order) await db.update(readings).set({ readingOrderId: order.id }).where(eq(readings.id, ctx.reading.id));
  refresh();
  redirect("/reading");
}

export async function setFinished(form: FormData) {
  const ctx = await reading();
  const book = ctx.books.find((b) => b.id === str(form, "bookId"));
  if (!book) return;
  const db = getDb();
  if (str(form, "finished") === "1") {
    await db.insert(finishedBooks).values({ readingId: ctx.reading.id, bookId: book.id }).onConflictDoNothing();
  } else {
    await db
      .delete(finishedBooks)
      .where(and(eq(finishedBooks.readingId, ctx.reading.id), eq(finishedBooks.bookId, book.id)));
  }
  refresh();
}

/** Starts a Book (or, with no bookId, puts the Reader between Books). Keeps the Chapter if the Book is unchanged. */
export async function setCurrentBook(form: FormData) {
  const ctx = await reading();
  const bookId = str(form, "bookId");
  const book = bookId ? ctx.books.find((b) => b.id === bookId) : null;
  if (bookId && !book) redirect("/position");
  if (book?.id !== ctx.currentBook?.id) {
    await getDb()
      .update(readings)
      .set({ currentBookId: book?.id ?? null, lastFinishedChapterIndex: null, updatedAt: new Date() })
      .where(eq(readings.id, ctx.reading.id));
  }
  refresh();
  redirect("/position");
}

/** Saves the Reading Position. Moving backwards is allowed. An empty value means no Chapter finished yet. */
export async function savePosition(form: FormData) {
  const ctx = await reading();
  if (!ctx.currentBook) redirect("/position/book");
  const raw = str(form, "chapter");
  const index = raw === "" ? null : Number(raw);
  if (index !== null && !ctx.chapters.some((c) => c.index === index)) redirect("/position");
  await getDb()
    .update(readings)
    .set({ lastFinishedChapterIndex: index, updatedAt: sql`now()` })
    .where(eq(readings.id, ctx.reading.id));
  refresh();
  redirect("/");
}
