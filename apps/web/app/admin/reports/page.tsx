import { desc, eq, schema, type SummaryEntry } from "@epicaid/db";
import { getDb } from "@/lib/db";
import { citationChips } from "@/lib/summary-text";
import { resolveSpoilerReport } from "../actions";
import { Flash } from "../flash";

export default async function ReportsAdmin({ searchParams }: { searchParams: Promise<{ msg?: string; all?: string }> }) {
  const { msg, all } = await searchParams;
  const { spoilerReports: r, readers, subjects } = schema;
  const db = getDb();
  const query = db
    .select({
      id: r.id,
      status: r.status,
      note: r.note,
      createdAt: r.createdAt,
      summary: r.summary,
      targetRef: r.targetRef,
      email: readers.email,
      subject: subjects.name,
    })
    .from(r)
    .innerJoin(readers, eq(readers.id, r.readerId))
    .innerJoin(subjects, eq(subjects.id, r.subjectId))
    .orderBy(desc(r.createdAt))
    .limit(50);
  const reports = await (all ? query : query.where(eq(r.status, "open")));

  return (
    <main>
      <h1>Spoiler Reports</h1>
      <Flash msg={msg} />
      <p className="muted small">
        {all ? <a href="/admin/reports">Show open only</a> : <a href="/admin/reports?all=1">Show resolved too</a>}
      </p>
      {reports.length === 0 && <p className="muted">No open reports.</p>}
      {reports.map((report) => {
        const entry = report.summary as SummaryEntry | null;
        return (
          <section key={report.id} className="report">
            <h2>
              {report.subject} <span className={`badge ${report.status === "open" ? "draft" : "published"}`}>{report.status}</span>
            </h2>
            <p className="muted small">
              {report.email} · {report.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
              {entry ? ` · ${entry.model}` : ""}
            </p>
            {report.note && <blockquote>{report.note}</blockquote>}
            {entry ? (
              <details>
                <summary>The Summary they saw</summary>
                {entry.paragraphs.map((p, i) => (
                  <p key={i}>
                    {p.map((s) => `${s.text} [${citationChips(s.sources, entry.sources).map((c) => c.label).join(", ")}]`).join(" ")}
                  </p>
                ))}
              </details>
            ) : (
              <p className="muted small">The Summary was no longer cached when this was reported.</p>
            )}
            {report.status === "open" && (
              <form action={resolveSpoilerReport} className="row">
                <input type="hidden" name="id" value={report.id} />
                <button type="submit" name="action" value="regenerate">
                  Regenerate
                </button>
                <button type="submit" name="action" value="dismiss">
                  Dismiss
                </button>
              </form>
            )}
          </section>
        );
      })}
    </main>
  );
}
