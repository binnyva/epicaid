import Link from "next/link";
import { lookupHistory, parseRef, recordLookup, refToString, resolveTargets } from "@epicaid/db";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { boundaryChip, requireReading } from "@/lib/reading";
import { Avatar, KIND_LABEL } from "../../_components/bits";
import { BackIcon } from "../../_components/icons";

type Props = { params: Promise<{ ref: string }> };

export default async function SubjectPage({ params }: Props) {
  const ctx = await requireReading();
  const ref = parseRef((await params).ref);
  // A ref outside the boundary resolves to nothing, so a guessed or stale link shows "No match".
  const [target] = ref ? await resolveTargets(getDb(), ctx.series.id, ctx.boundary, [ref]) : [];
  if (!target) notFound();
  if (ref && target.ref !== refToString(ref)) redirect(`/subject/${target.ref}`);

  await recordLookup(getDb(), ctx.reading.id, target);
  const recent = (await lookupHistory(getDb(), ctx.reading.id, ctx.series.id, ctx.boundary, 6)).filter(
    (t) => t.ref !== target.ref,
  );

  return (
    <div className="screen">
      <Link href="/" className="back" aria-label="Back to Look up">
        <BackIcon />
        <span className="desktop-only">Look up</span>
      </Link>

      <header className="subject-head">
        <span className="desktop-only">
          <Avatar name={target.name} large />
        </span>
        <div className="stack-10">
          <h1 className="subject-name">{target.name}</h1>
          <div className="row-8 wrap">
            <span className="chip chip-soft">{KIND_LABEL[target.kind]}</span>
            <span className="chip chip-surface">{boundaryChip(ctx)}</span>
          </div>
          {target.otherNames.length > 0 && (
            <p className="secondary">Also called {target.otherNames.slice(0, 6).join(", ")}</p>
          )}
        </div>
      </header>

      <div className="two-col">
        <div className="card card-pad stack-8 summary-placeholder">
          <span className="card-title">Summaries are on their way</span>
          <p className="body-text">
            Soon this page will tell you what the books have said about {target.name} so far, with every sentence
            pointing to the Chapter it came from. Nothing past your Reading Position will be used.
          </p>
        </div>
        {recent.length > 0 && (
          <aside className="card side-card desktop-block" aria-labelledby="side-recent">
            <span id="side-recent" className="section-label pad-x">
              Recent
            </span>
            <ul className="side-list">
              {recent.slice(0, 5).map((t) => (
                <li key={t.ref}>
                  <Link href={`/subject/${t.ref}`} prefetch={false} className="side-link">
                    <Avatar name={t.name} />
                    {t.name}
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}
