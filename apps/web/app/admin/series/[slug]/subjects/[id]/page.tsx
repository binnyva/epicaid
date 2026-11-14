import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, schema, sql } from "@epicaid/db";
import { getDb } from "@/lib/db";
import {
  addAlias,
  deleteSubject,
  mergeSubject,
  setAliasReveal,
  splitAlias,
  updateSubject,
} from "../../../../actions";
import { Flash } from "../../../../flash";

type Props = { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ msg?: string }> };
const UUID = /^[0-9a-f-]{36}$/i;

export default async function SubjectPage({ params, searchParams }: Props) {
  const { slug, id } = await params;
  const { msg } = await searchParams;
  if (!UUID.test(id)) notFound();
  const db = getDb();
  const [s] = await db.select().from(schema.series).where(eq(schema.series.slug, slug));
  const [subject] = s
    ? await db.select().from(schema.subjects).where(and(eq(schema.subjects.id, id), eq(schema.subjects.seriesId, s.id)))
    : [];
  if (!s || !subject) notFound();

  const aliasRows = await db.execute<{
    id: string;
    name: string;
    reveal_chapter_id: string | null;
    review_note: string | null;
    passages: number;
    first: string | null;
  }>(sql`
    select a.id, a.name, a.reveal_chapter_id, a.review_note,
      count(distinct m.passage_id)::int as passages,
      (select b.title || ', ' || c.label from mentions m2
        join passages p on p.id = m2.passage_id join chapters c on c.id = p.chapter_id join books b on b.id = c.book_id
        where m2.alias_id = a.id order by b.created_at, c.index, p.index limit 1) as first
    from aliases a left join mentions m on m.alias_id = a.id
    where a.subject_id = ${id}
    group by a.id
    order by passages desc, a.name`);
  const chapterRows = await db
    .select({ id: schema.chapters.id, label: schema.chapters.label, book: schema.books.title })
    .from(schema.chapters)
    .innerJoin(schema.books, eq(schema.books.id, schema.chapters.bookId))
    .where(eq(schema.books.seriesId, s.id))
    .orderBy(asc(schema.books.createdAt), asc(schema.chapters.index));
  const summaries = await db
    .select({ text: schema.bookSummaries.text, book: schema.books.title, model: schema.bookSummaries.model })
    .from(schema.bookSummaries)
    .innerJoin(schema.books, eq(schema.books.id, schema.bookSummaries.bookId))
    .where(eq(schema.bookSummaries.subjectId, id))
    .orderBy(asc(schema.books.createdAt));
  const names = await db.execute<{ name: string }>(
    sql`select distinct name from subjects where series_id = ${s.id} and id <> ${id} order by name`,
  );

  const books = [...new Set(chapterRows.map((c) => c.book))];
  const hidden = (
    <>
      <input type="hidden" name="subjectId" value={id} />
      <input type="hidden" name="seriesSlug" value={slug} />
    </>
  );

  return (
    <main>
      <p className="muted small">
        <Link href="/admin">Series</Link> / <Link href={`/admin/series/${slug}`}>{s.name}</Link> /{" "}
        <Link href={`/admin/series/${slug}/subjects`}>Subjects</Link> /
      </p>
      <h1>{subject.name}</h1>
      <Flash msg={msg} />

      <form action={updateSubject} className="row">
        {hidden}
        <input name="name" defaultValue={subject.name} />
        <select name="kind" defaultValue={subject.kind}>
          {["character", "place", "artefact", "faction", "other"].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" name="isMajor" defaultChecked={subject.isMajor} /> Major
        </label>
        <button type="submit">Save</button>
      </form>

      <h2>Aliases</h2>
      <p className="muted small">
        An Alias with no Reveal is an ordinary name. An Alias with a Reveal Chapter is a secret identity: Readers only see
        it as this Subject once they have finished that Chapter.
      </p>
      <table>
        <thead>
          <tr>
            <th>Alias</th>
            <th className="num">Passages</th>
            <th>First seen</th>
            <th>Reveal</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {aliasRows.rows.map((a) => (
            <tr key={a.id} className={a.review_note ? "flagged" : undefined}>
              <td>
                {a.name}
                {a.review_note && <div className="small muted">{a.review_note}</div>}
              </td>
              <td className="num">{a.passages}</td>
              <td className="small">{a.first ?? "—"}</td>
              <td>
                <form action={setAliasReveal} className="row">
                  {hidden}
                  <input type="hidden" name="aliasId" value={a.id} />
                  <select name="revealChapterId" defaultValue={a.reveal_chapter_id ?? ""}>
                    <option value="">No Reveal (ordinary name)</option>
                    {books.map((book) => (
                      <optgroup key={book} label={book}>
                        {chapterRows
                          .filter((c) => c.book === book)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                  <button type="submit">{a.review_note ? "Confirm" : "Save"}</button>
                </form>
              </td>
              <td>
                {aliasRows.rows.length > 1 && (
                  <form action={splitAlias}>
                    {hidden}
                    <input type="hidden" name="aliasId" value={a.id} />
                    <button type="submit">Split off</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form action={addAlias} className="row">
        {hidden}
        <input name="name" placeholder="New Alias" />
        <button type="submit">Add Alias</button>
      </form>

      <h2>Merge</h2>
      <form action={mergeSubject} className="row">
        {hidden}
        <input name="other" list="subject-names" placeholder="Subject or Alias to merge into this one" className="wide" />
        <datalist id="subject-names">
          {names.rows.map((n) => (
            <option key={n.name} value={n.name} />
          ))}
        </datalist>
        <button type="submit">Merge in</button>
      </form>
      <p className="muted small">
        The other Subject&apos;s Aliases and Mentions move here and it is deleted. Re-run Book Summaries afterwards with{" "}
        <code>--resummarise</code>.
      </p>

      <h2>Book Summaries</h2>
      {summaries.length === 0 ? (
        <p className="muted">None. Book Summaries are written at Ingestion for Major Subjects only.</p>
      ) : (
        summaries.map((b) => (
          <div key={b.book} className="card">
            <h3>{b.book}</h3>
            <p className="prewrap">{b.text}</p>
            <p className="muted small">{b.model}</p>
          </div>
        ))
      )}

      <h2>Delete</h2>
      <form action={deleteSubject}>
        {hidden}
        <button type="submit" className="danger">
          Delete this Subject
        </button>
      </form>
    </main>
  );
}
