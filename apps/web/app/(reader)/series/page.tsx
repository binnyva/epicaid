import Link from "next/link";
import { and, asc, eq, schema, sql } from "@epicaid/db";
import { requireReader } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getReadingContext } from "@/lib/reading";
import { chooseSeries } from "../actions";
import { BackIcon, ChevronRight } from "../_components/icons";

export default async function SeriesPicker() {
  const reader = await requireReader();
  const ctx = await getReadingContext();
  const rows = await getDb()
    .select({
      id: schema.series.id,
      name: schema.series.name,
      books: sql<number>`(select count(*)::int from books b where b.series_id = series.id and b.status = 'published')`,
      started: sql<boolean>`exists (select 1 from readings r where r.series_id = series.id and r.reader_id = ${reader.id})`,
    })
    .from(schema.series)
    .where(and(eq(schema.series.status, "published")))
    .orderBy(asc(schema.series.name));

  return (
    <div className="screen narrow">
      {ctx && (
        <Link href="/reading" className="back" aria-label="Back to Reading">
          <BackIcon />
          <span className="desktop-only">Reading</span>
        </Link>
      )}
      {!ctx && <span className="wordmark">Epic Aid</span>}
      <div className="stack-2">
        <h1 className="screen-title">{ctx ? "Switch Series" : "What are you reading?"}</h1>
        <span className="secondary">
          {ctx
            ? "Each Series keeps its own Finished Books and Reading Position."
            : "Pick a Series. Next you will mark the Books you have finished and where you are now."}
        </span>
      </div>
      <div className="card list-card">
        {rows.map((s) => {
          const current = s.id === ctx?.series.id;
          return (
            <form key={s.id} action={chooseSeries}>
              <input type="hidden" name="seriesId" value={s.id} />
              <button type="submit" className="list-row" aria-current={current ? "true" : undefined}>
                <span className="stack-2 grow">
                  <span className="list-name strong">{s.name}</span>
                  <span className="secondary">
                    {s.books} Book{s.books === 1 ? "" : "s"}
                    {current ? " · reading now" : s.started ? " · started" : ""}
                  </span>
                </span>
                <span className="chev">
                  <ChevronRight />
                </span>
              </button>
            </form>
          );
        })}
        {rows.length === 0 && (
          <p className="secondary card-pad">No Series is published yet. Check back once the admin publishes one.</p>
        )}
      </div>
      {!ctx && (
        <div className="row-8 solo-foot">
          {reader.isAdmin && (
            <Link href="/admin" className="text-link">
              Admin
            </Link>
          )}
          <form action="/api/auth/sign-out" method="post">
            <button type="submit" className="text-button">
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
