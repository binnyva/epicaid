import Link from "next/link";
import type { ReactNode } from "react";
import { eq, schema, sql } from "@epicaid/db";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const me = await requireAdmin();
  const [open] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.spoilerReports)
    .where(eq(schema.spoilerReports.status, "open"));
  return (
    <div className="admin">
      <nav>
        <Link href="/admin">
          <strong>Epic Aid admin</strong>
        </Link>
        <Link href="/admin">Series</Link>
        <Link href="/admin/readers">Readers</Link>
        <Link href="/admin/summaries">Summaries</Link>
        <Link href="/admin/reports">Reports{open?.n ? ` (${open.n})` : ""}</Link>
        <span className="spacer" />
        <Link href="/">{me.email}</Link>
      </nav>
      {children}
    </div>
  );
}
