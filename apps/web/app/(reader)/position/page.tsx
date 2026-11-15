import Link from "next/link";
import { requireReading } from "@/lib/reading";
import { FinishedBooksCard } from "../_components/finished-books";
import { PositionScreen } from "../_components/position-screen";

export default async function Position() {
  const ctx = await requireReading();

  if (!ctx.currentBook) {
    return (
      <div className="screen">
        <h1 className="screen-title">Position</h1>
        <div className="card card-pad stack-8">
          <span className="card-title">Which Book are you reading?</span>
          <p className="secondary">
            Pick the Book you are in now, then the last Chapter you finished. If you are between Books, your Finished
            Books are all that count.
          </p>
          <div className="row-8">
            <Link href="/position/book" className="button button-primary">
              Choose a Book
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PositionScreen
      bookTitle={ctx.currentBook.title}
      bookFinished={ctx.currentBook.finished}
      chapters={ctx.chapters}
      saved={ctx.lastFinished?.index ?? null}
      side={<FinishedBooksCard ctx={ctx} compact />}
    />
  );
}
