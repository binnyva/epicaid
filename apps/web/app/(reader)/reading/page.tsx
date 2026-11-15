import Link from "next/link";
import { requireReading } from "@/lib/reading";
import { FinishedBooksCard } from "../_components/finished-books";
import { ChevronRight } from "../_components/icons";

export default async function Reading() {
  const ctx = await requireReading();
  return (
    <div className="screen narrow">
      <h1 className="screen-title">Reading</h1>
      <div className="card list-card">
        <Link href="/series" className="list-row">
          <span className="stack-2 grow">
            <span className="secondary">Series</span>
            <span className="list-name strong">{ctx.series.name}</span>
          </span>
          <span className="chev">
            <ChevronRight />
          </span>
        </Link>
        <Link href="/reading/order" className="list-row">
          <span className="stack-2 grow">
            <span className="secondary">Reading Order</span>
            <span className="list-name strong">{ctx.readingOrder?.name ?? "None chosen"}</span>
          </span>
          <span className="chev">
            <ChevronRight />
          </span>
        </Link>
      </div>
      <div className="stack-2 section-intro">
        <h2 className="card-title">Finished Books</h2>
        <span className="secondary">Turn on every Book you have read. Nothing from the rest is ever shown.</span>
      </div>
      <FinishedBooksCard ctx={ctx} />
      <form action="/api/auth/sign-out" method="post" className="sign-out">
        <span className="secondary">Signed in as {ctx.reader.email}</span>
        <button type="submit" className="text-button">
          Sign out
        </button>
      </form>
    </div>
  );
}
