import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, schema, sql } from "@epicaid/db";
import { getDb } from "@/lib/db";
import { markReviewed } from "../../../actions";
import { Flash } from "../../../flash";

const PAGE = 100;
type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; kind?: string; review?: string; page?: string; msg?: string }>;
};

export default async function SubjectsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { q = "", kind = "", review, page = "1", msg } = await searchParams;
  const db = getDb();
  const [s] = await db.select().from(schema.series).where(eq(schema.series.slug, slug));
  if (!s) notFound();
  const base = `/admin/series/${slug}/subjects`;

  if (review) {
    const flagged = await db.execute<{
      alias_id: string;
      alias: string;
      subject_id: string;
      subject: string;
      reveal: string | null;
      note: string;
    }>(sql`
      select a.id as alias_id, a.name as alias, s.id as subject_id, s.name as subject, c.label as reveal, a.review_note as note
      from aliases a
      join subjects s on s.id = a.subject_id
      left join chapters c on c.id = a.reveal_chapter_id
      where s.series_id = ${s.id} and a.review_note is not null
      order by s.name, a.name`);
    return (
      <main>
        <p className="muted small">
          <Link href="/admin">Series</Link> / <Link href={`/admin/series/${slug}`}>{s.name}</Link> /{" "}
          <Link href={base}>Subjects</Link> /
        </p>
        <h1>To review</h1>
        <Flash msg={msg} />
        <p className="muted">
          Ingestion joined these Aliases to a Subject late in a Book, so each is hidden until its Reveal Chapter. Open
          the Subject to change the Reveal or split the Alias off. Tick the ones that are right as they are.
        </p>
        {flagged.rows.length === 0 ? (
          <p>Nothing to review.</p>
        ) : (
          <form action={markReviewed}>
            <input type="hidden" name="back" value={`${base}?review=1`} />
            <table>
              <thead>
                <tr>
                  <th />
                  <th>Alias</th>
                  <th>Subject</th>
                  <th>Reveal</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {flagged.rows.map((r) => (
                  <tr key={r.alias_id}>
                    <td>
                      <input type="checkbox" name="aliasId" value={r.alias_id} />
                    </td>
                    <td>{r.alias}</td>
                    <td>
                      <Link href={`${base}/${r.subject_id}`}>{r.subject}</Link>
                    </td>
                    <td>{r.reveal ?? "none"}</td>
                    <td className="small">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="submit">Mark ticked as reviewed</button>
          </form>
        )}
      </main>
    );
  }

  const pageNo = Math.max(1, Number(page) || 1);
  const pattern = `%${q}%`;
  const filter = sql`s.series_id = ${s.id}
    ${q ? sql`and (s.name ilike ${pattern} or exists (select 1 from aliases a where a.subject_id = s.id and a.name ilike ${pattern}))` : sql``}
    ${kind ? sql`and s.kind = ${kind}` : sql``}`;
  const rows = await db.execute<{
    id: string;
    name: string;
    kind: string;
    is_major: boolean;
    passages: number;
    aliases: number;
    flagged: number;
  }>(sql`
    select s.id, s.name, s.kind, s.is_major,
      (select count(distinct m.passage_id)::int from mentions m where m.subject_id = s.id) as passages,
      (select count(*)::int from aliases a where a.subject_id = s.id) as aliases,
      (select count(*)::int from aliases a where a.subject_id = s.id and a.review_note is not null) as flagged
    from subjects s
    where ${filter}
    order by passages desc, s.name
    limit ${PAGE + 1} offset ${(pageNo - 1) * PAGE}`);
  const more = rows.rows.length > PAGE;
  const link = (p: number) => `${base}?${new URLSearchParams({ q, kind, page: String(p) })}`;

  return (
    <main>
      <p className="muted small">
        <Link href="/admin">Series</Link> / <Link href={`/admin/series/${slug}`}>{s.name}</Link> /
      </p>
      <h1>Subjects</h1>
      <Flash msg={msg} />
      <form className="row">
        <input name="q" defaultValue={q} placeholder="Name or Alias" />
        <select name="kind" defaultValue={kind}>
          <option value="">Any kind</option>
          {["character", "place", "artefact", "faction", "other"].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <button type="submit">Search</button>
        <Link href={`${base}?review=1`}>To review →</Link>
      </form>
      <table>
        <thead>
          <tr>
            <th>Subject</th>
            <th>Kind</th>
            <th className="num">Passages</th>
            <th className="num">Aliases</th>
          </tr>
        </thead>
        <tbody>
          {rows.rows.slice(0, PAGE).map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`${base}/${r.id}`}>{r.name}</Link>
                {r.is_major && <span className="badge">major</span>}
                {r.flagged > 0 && <span className="badge review">review</span>}
              </td>
              <td>{r.kind}</td>
              <td className="num">{r.passages}</td>
              <td className="num">{r.aliases}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="row">
        {pageNo > 1 && <Link href={link(pageNo - 1)}>← Previous</Link>}
        {more && <Link href={link(pageNo + 1)}>Next →</Link>}
      </p>
    </main>
  );
}
