import { REASONING_EFFORTS, SUMMARY_PROMPT_VERSION } from "@epicaid/core";
import { getSummarySettings, sql } from "@epicaid/db";
import { getDb } from "@/lib/db";
import { saveSummarySettingsAction } from "../actions";
import { Flash } from "../flash";

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

export default async function SummariesAdmin({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const db = getDb();
  const settings = await getSummarySettings(db);
  const days = (
    await db.execute<{ day: string; summary: string; book_summary: string; ingestion: string; lookups: number }>(sql`
      select to_char(date_trunc('day', occurred_at at time zone 'utc'), 'YYYY-MM-DD') as day,
        coalesce(sum(cost_usd) filter (where reader_id is not null and purpose = 'summary'), 0) as summary,
        coalesce(sum(cost_usd) filter (where reader_id is not null and purpose = 'book_summary'), 0) as book_summary,
        coalesce(sum(cost_usd) filter (where reader_id is null), 0) as ingestion,
        (count(*) filter (where reader_id is not null and purpose = 'summary'))::int as lookups
      from spend_log
      where occurred_at > now() - interval '14 days'
      group by 1 order by 1 desc`)
  ).rows;
  const readers = (
    await db.execute<{ email: string; today: string }>(sql`
      select r.email, sum(s.cost_usd) as today from spend_log s join readers r on r.id = s.reader_id
      where s.occurred_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
      group by r.email order by 2 desc`)
  ).rows;

  return (
    <main>
      <h1>Summaries</h1>
      <Flash msg={msg} />

      <h2>Settings</h2>
      <form action={saveSummarySettingsAction} className="stack">
        <label>
          Model (OpenRouter id)
          <input name="model" defaultValue={settings.model} size={40} />
        </label>
        <label>
          Reasoning for Summaries{" "}
          <select name="reasoning" defaultValue={settings.reasoning}>
            {REASONING_EFFORTS.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        </label>
        <label>
          Reasoning for Book Summaries written on demand{" "}
          <select name="bookSummaryReasoning" defaultValue={settings.bookSummaryReasoning}>
            {REASONING_EFFORTS.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        </label>
        <label>
          Daily cap per Reader (USD){" "}
          <input name="readerDailyUsd" type="number" step="0.01" min="0" defaultValue={settings.readerDailyUsd} />
        </label>
        <label>
          Daily cap for everyone (USD){" "}
          <input name="globalDailyUsd" type="number" step="0.01" min="0" defaultValue={settings.globalDailyUsd} />
        </label>
        <p className="muted small">
          Summary prompt version {SUMMARY_PROMPT_VERSION}. It changes with the code, and changing the model or the
          prompt version starts a fresh cache. Caps count only what lookups spend, reset at midnight UTC, and never
          block a cached Summary.
        </p>
        <div>
          <button type="submit">Save</button>
        </div>
      </form>

      <h2>Spend today</h2>
      {readers.length === 0 ? (
        <p className="muted">No lookups have spent anything today.</p>
      ) : (
        <table>
          <tbody>
            {readers.map((r) => (
              <tr key={r.email}>
                <td>{r.email}</td>
                <td className="num">{usd(Number(r.today))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Last 14 days</h2>
      <table>
        <thead>
          <tr>
            <th>Day (UTC)</th>
            <th className="num">New Summaries</th>
            <th className="num">Summaries</th>
            <th className="num">Book Summaries on demand</th>
            <th className="num">Ingestion</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td>
              <td className="num">{d.lookups}</td>
              <td className="num">{usd(Number(d.summary))}</td>
              <td className="num">{usd(Number(d.book_summary))}</td>
              <td className="num">{usd(Number(d.ingestion))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
