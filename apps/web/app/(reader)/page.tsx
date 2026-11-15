import Link from "next/link";
import { lookupHistory } from "@epicaid/db";
import { getDb } from "@/lib/db";
import { requireReading } from "@/lib/reading";
import { Avatar, KIND_LABEL, PositionCard } from "./_components/bits";
import { ChevronRight } from "./_components/icons";
import { LookupSearch } from "./_components/lookup-search";

export default async function LookUp() {
  const ctx = await requireReading();
  const recent = await lookupHistory(getDb(), ctx.reading.id, ctx.series.id, ctx.boundary);
  const nothingRead = ctx.boundary.finishedBookIds.length === 0 && ctx.boundary.position === null;

  return (
    <div className="screen">
      <h1 className="screen-title">Look up</h1>
      <div className="phone-only">
        <PositionCard ctx={ctx} />
      </div>

      {nothingRead ? (
        <div className="card card-pad stack-8">
          <span className="card-title">Tell Epic Aid where you are</span>
          <p className="secondary">
            Nothing is searchable until you mark a Finished Book or the last Chapter you finished. Only what you have
            read is ever shown.
          </p>
          <div className="row-8">
            <Link href="/position" className="button button-primary">
              Set your position
            </Link>
            <Link href="/reading" className="button button-quiet">
              Finished Books
            </Link>
          </div>
        </div>
      ) : (
        <LookupSearch />
      )}

      <section className="stack-10" aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="section-label">
          Recent
        </h2>
        {recent.length ? (
          <ul className="recent">
            {recent.map((t) => (
              <li key={t.ref}>
                <Link href={`/subject/${t.ref}`} prefetch={false} className="recent-item">
                  <Avatar name={t.name} />
                  <span className="stack-2 grow">
                    <span className="list-name">{t.name}</span>
                    <span className="secondary">{KIND_LABEL[t.kind]}</span>
                  </span>
                  <span className="chev phone-only">
                    <ChevronRight />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="card card-pad empty">
            <p className="secondary">The people, places and things you look up will gather here.</p>
          </div>
        )}
      </section>
    </div>
  );
}
