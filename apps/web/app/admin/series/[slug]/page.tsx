import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, schema, sql } from "@epicaid/db";
import { getDb } from "@/lib/db";
import { deleteReadingOrder, saveReadingOrder, setSeriesPublished, updateBook, updateSeries } from "../../actions";
import { Flash } from "../../flash";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ msg?: string }> };

export default async function SeriesPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { msg } = await searchParams;
  const db = getDb();
  const [s] = await db.select().from(schema.series).where(eq(schema.series.slug, slug));
  if (!s) notFound();

  const bookRows = await db
    .select({
      id: schema.books.id,
      title: schema.books.title,
      author: schema.books.author,
      status: schema.books.status,
      chapters: sql<number>`(select count(*)::int from chapters c where c.book_id = books.id)`,
    })
    .from(schema.books)
    .where(eq(schema.books.seriesId, s.id))
    .orderBy(asc(schema.books.createdAt));
  const orders = await db.select().from(schema.readingOrders).where(eq(schema.readingOrders.seriesId, s.id));
  const orderBooks = orders.length
    ? await db
        .select()
        .from(schema.readingOrderBooks)
        .where(sql`${schema.readingOrderBooks.readingOrderId} in (select id from reading_orders where series_id = ${s.id})`)
    : [];
  const positionOf = (orderId: string, bookId: string) =>
    orderBooks.find((ob) => ob.readingOrderId === orderId && ob.bookId === bookId)?.position;

  const orderForm = (order?: (typeof orders)[number]) => (
    <form action={saveReadingOrder} className="card" key={order?.id ?? "new"}>
      <input type="hidden" name="seriesId" value={s.id} />
      <input type="hidden" name="seriesSlug" value={s.slug} />
      {order && <input type="hidden" name="id" value={order.id} />}
      <div className="row">
        <label>
          Name <input name="name" defaultValue={order?.name ?? ""} placeholder="Publication order" required />
        </label>
        <label className="check">
          <input type="checkbox" name="isDefault" defaultChecked={order?.isDefault ?? orders.length === 0} /> Default
        </label>
      </div>
      <label>
        Description <input name="description" defaultValue={order?.description ?? ""} className="wide" />
      </label>
      <p className="muted small">Number the Books in reading order. Leave a box empty to leave that Book out.</p>
      <table>
        <tbody>
          {bookRows.map((b) => {
            const pos = order ? positionOf(order.id, b.id) : undefined;
            return (
              <tr key={b.id}>
                <td className="pos">
                  <input name={`pos:${b.id}`} defaultValue={pos === undefined ? "" : pos + 1} inputMode="numeric" size={3} />
                </td>
                <td>{b.title}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row">
        <button type="submit">{order ? "Save" : "Add Reading Order"}</button>
        {order && (
          <button formAction={deleteReadingOrder} className="danger">
            Delete
          </button>
        )}
      </div>
    </form>
  );

  return (
    <main>
      <p className="muted small">
        <Link href="/admin">Series</Link> /
      </p>
      <h1>{s.name}</h1>
      <Flash msg={msg} />

      <section>
        <div className="row">
          <form action={updateSeries} className="row">
            <input type="hidden" name="id" value={s.id} />
            <input type="hidden" name="slug" value={s.slug} />
            <input name="name" defaultValue={s.name} />
            <button type="submit">Rename</button>
          </form>
          <form action={setSeriesPublished} className="row">
            <input type="hidden" name="id" value={s.id} />
            <input type="hidden" name="slug" value={s.slug} />
            <input type="hidden" name="publish" value={s.status === "published" ? "0" : "1"} />
            <span className={`badge ${s.status}`}>{s.status}</span>
            <button type="submit">{s.status === "published" ? "Unpublish" : "Publish Series and its Books"}</button>
          </form>
        </div>
        <p>
          <Link href={`/admin/series/${s.slug}/subjects`}>Subject catalogue →</Link>
        </p>
      </section>

      <h2>Books</h2>
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Author</th>
            <th className="num">Chapters</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {bookRows.map((b) => (
            <tr key={b.id}>
              <td>
                <input form={`book-${b.id}`} name="title" defaultValue={b.title} />
              </td>
              <td>
                <input form={`book-${b.id}`} name="author" defaultValue={b.author} />
              </td>
              <td className="num">{b.chapters}</td>
              <td>
                <select form={`book-${b.id}`} name="status" defaultValue={b.status}>
                  <option value="draft">draft</option>
                  <option value="published">published</option>
                </select>
              </td>
              <td>
                <form action={updateBook} id={`book-${b.id}`}>
                  <input type="hidden" name="id" value={b.id} />
                  <input type="hidden" name="seriesSlug" value={s.slug} />
                  <button type="submit">Save</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Reading Orders</h2>
      {orders.map((o) => orderForm(o))}
      <details>
        <summary>New Reading Order</summary>
        {orderForm()}
      </details>
    </main>
  );
}
