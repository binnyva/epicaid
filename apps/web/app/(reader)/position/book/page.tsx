import Link from "next/link";
import { requireReading } from "@/lib/reading";
import { setCurrentBook } from "../../actions";
import { BackIcon } from "../../_components/icons";

export default async function ChooseBook() {
  const ctx = await requireReading();
  return (
    <div className="screen narrow">
      <Link href="/position" className="back" aria-label="Back to Position">
        <BackIcon />
        <span className="desktop-only">Position</span>
      </Link>
      <div className="stack-2">
        <h1 className="screen-title">Change Book</h1>
        <span className="secondary">
          {ctx.readingOrder ? `In ${ctx.readingOrder.name}` : ctx.series.name}. Your Finished Books stay as they are.
        </span>
      </div>
      <div className="card list-card">
        {ctx.books.map((b) => {
          const current = b.id === ctx.currentBook?.id;
          return (
            <form key={b.id} action={setCurrentBook}>
              <input type="hidden" name="bookId" value={b.id} />
              <button type="submit" className="list-row" aria-current={current ? "true" : undefined}>
                <span className="stack-2 grow">
                  <span className="list-name">{b.title}</span>
                  <span className="secondary">
                    {current ? "Reading now" : b.finished ? "Finished" : b.author}
                    {b.orderPosition === null && ctx.readingOrder ? " · not in this Reading Order" : ""}
                  </span>
                </span>
                {current && <span className="chip chip-soft">Current</span>}
              </button>
            </form>
          );
        })}
        {ctx.currentBook && (
          <form action={setCurrentBook}>
            <input type="hidden" name="bookId" value="" />
            <button type="submit" className="list-row">
              <span className="stack-2 grow">
                <span className="list-name">Between Books</span>
                <span className="secondary">Only your Finished Books count</span>
              </span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
