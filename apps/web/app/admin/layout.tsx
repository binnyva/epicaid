import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const me = await requireAdmin();
  return (
    <div className="admin">
      <nav>
        <Link href="/admin">
          <strong>Epic Aid admin</strong>
        </Link>
        <Link href="/admin">Series</Link>
        <Link href="/admin/readers">Readers</Link>
        <span className="spacer" />
        <Link href="/">{me.email}</Link>
      </nav>
      {children}
    </div>
  );
}
