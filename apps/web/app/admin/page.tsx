import Link from "next/link";
import { schema, sql } from "@epicaid/db";
import { getDb } from "@/lib/db";

export default async function AdminHome() {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.series.id,
      slug: schema.series.slug,
      name: schema.series.name,
      status: schema.series.status,
      books: sql<number>`(select count(*)::int from books b where b.series_id = series.id)`,
      subjects: sql<number>`(select count(*)::int from subjects s where s.series_id = series.id)`,
      toReview: sql<number>`(select count(*)::int from aliases a join subjects s on s.id = a.subject_id
        where s.series_id = series.id and a.review_note is not null)`,
    })
    .from(schema.series)
    .orderBy(schema.series.name);

  return (
    <main>
      <h1>Series</h1>
      {rows.length === 0 && (
        <p className="muted">
          No Series yet. Add one with <code>pnpm cli ingest</code> (see the README).
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>Series</th>
            <th>Status</th>
            <th className="num">Books</th>
            <th className="num">Subjects</th>
            <th className="num">To review</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <td>
                <Link href={`/admin/series/${s.slug}`}>{s.name}</Link>
              </td>
              <td>
                <span className={`badge ${s.status}`}>{s.status}</span>
              </td>
              <td className="num">{s.books}</td>
              <td className="num">
                <Link href={`/admin/series/${s.slug}/subjects`}>{s.subjects}</Link>
              </td>
              <td className="num">
                {s.toReview > 0 ? <Link href={`/admin/series/${s.slug}/subjects?review=1`}>{s.toReview}</Link> : 0}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
