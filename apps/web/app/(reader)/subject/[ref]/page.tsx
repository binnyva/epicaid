import Link from "next/link";
import { cachedSummaryFor, getSummarySettings, lookupHistory, parseRef, recordLookup, refToString, resolveTargets } from "@epicaid/db";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { boundaryChip, requireReading, type ReadingContext } from "@/lib/reading";
import { getSummaryCache } from "@/lib/summary-cache";
import { Avatar, KIND_LABEL } from "../../_components/bits";
import { BackIcon } from "../../_components/icons";
import { SummarySection } from "../../_components/summary-section";

/** "Nothing after Chapter Six of Gardens of the Moon was read." */
function positionNote(ctx: ReadingContext): string {
  const book = ctx.currentBook;
  if (book && !book.finished) {
    return ctx.lastFinished
      ? `Nothing after ${ctx.lastFinished.label} of ${book.title} was read.`
      : `Nothing from ${book.title} was read yet.`;
  }
  return "Only your Finished Books were read.";
}

type Props = { params: Promise<{ ref: string }> };

export default async function SubjectPage({ params }: Props) {
  const ctx = await requireReading();
  const ref = parseRef((await params).ref);
  // A ref outside the boundary resolves to nothing, so a guessed or stale link shows "No match".
  const [target] = ref ? await resolveTargets(getDb(), ctx.series.id, ctx.boundary, [ref]) : [];
  if (!target) notFound();
  if (ref && target.ref !== refToString(ref)) redirect(`/subject/${target.ref}`);

  await recordLookup(getDb(), ctx.reading.id, target);
  const [recentAll, settings] = await Promise.all([
    lookupHistory(getDb(), ctx.reading.id, ctx.series.id, ctx.boundary, 6),
    getSummarySettings(getDb()),
  ]);
  const recent = recentAll.filter((t) => t.ref !== target.ref);
  // A cached Summary comes with the page and costs nothing; a miss is written from the browser's request, so a
  // prefetch never spends money.
  const { entry } = await cachedSummaryFor(getDb(), getSummaryCache(), ctx.boundary, target, settings);

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

      <SummarySection
        key={target.ref}
        targetRef={target.ref}
        initial={entry}
        positionNote={positionNote(ctx)}
        side={
          recent.length > 0 && (
            <aside className="card side-card" aria-labelledby="side-recent">
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
          )
        }
      />
    </div>
  );
}
