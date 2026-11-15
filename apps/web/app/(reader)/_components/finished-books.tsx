import Link from "next/link";
import type { ReadingContext } from "@/lib/reading";
import { FinishedToggle } from "./finished-toggle";

/** The Finished Books list. Switching Reading Order never changes it (ADR 0004). */
export function FinishedBooksCard({ ctx, compact }: { ctx: ReadingContext; compact?: boolean }) {
  return (
    <div className="card list-card">
      {compact && (
        <div className="list-head">
          <span className="card-title">Finished Books</span>
          <Link href="/reading/order" className="text-link">
            {ctx.readingOrder?.name ?? "Reading Order"}
          </Link>
        </div>
      )}
      {ctx.books.map((b) => {
        const now = b.id === ctx.currentBook?.id && !b.finished;
        return (
          <FinishedToggle key={b.id} bookId={b.id} finished={b.finished}>
            <span className="list-name">{b.title}</span>
            {now && !compact && (
              <span className="now">Reading now{ctx.lastFinished ? ` · ${ctx.lastFinished.label}` : ""}</span>
            )}
          </FinishedToggle>
        );
      })}
      {ctx.books.length === 0 && <p className="secondary card-pad">No Books are published in this Series yet.</p>}
    </div>
  );
}
