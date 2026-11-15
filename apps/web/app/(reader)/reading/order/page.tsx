import Link from "next/link";
import { asc, eq, schema } from "@epicaid/db";
import { getDb } from "@/lib/db";
import { requireReading } from "@/lib/reading";
import { setReadingOrder } from "../../actions";
import { BackIcon } from "../../_components/icons";

export default async function ChooseOrder() {
  const ctx = await requireReading();
  const orders = await getDb()
    .select({ id: schema.readingOrders.id, name: schema.readingOrders.name, description: schema.readingOrders.description })
    .from(schema.readingOrders)
    .where(eq(schema.readingOrders.seriesId, ctx.series.id))
    .orderBy(asc(schema.readingOrders.name));
  return (
    <div className="screen narrow">
      <Link href="/reading" className="back" aria-label="Back to Reading">
        <BackIcon />
        <span className="desktop-only">Reading</span>
      </Link>
      <div className="stack-2">
        <h1 className="screen-title">Reading Order</h1>
        <span className="secondary">It only suggests what to read next. Switching never changes your Finished Books.</span>
      </div>
      <div className="card list-card">
        {orders.map((o) => {
          const current = o.id === ctx.readingOrder?.id;
          return (
            <form key={o.id} action={setReadingOrder}>
              <input type="hidden" name="readingOrderId" value={o.id} />
              <button type="submit" className="list-row" aria-current={current ? "true" : undefined}>
                <span className="stack-2 grow">
                  <span className="list-name">{o.name}</span>
                  {o.description && <span className="secondary">{o.description}</span>}
                </span>
                {current && <span className="chip chip-soft">Chosen</span>}
              </button>
            </form>
          );
        })}
        {orders.length === 0 && <p className="secondary card-pad">No Reading Orders yet. Books are listed as published.</p>}
      </div>
    </div>
  );
}
