import Link from "next/link";
import type { ReactNode } from "react";
import { figtree } from "../_pocket/font";
import "../_pocket/pocket.css";
import { getReadingContext } from "@/lib/reading";
import { PositionCard } from "./_components/bits";
import { Tabs } from "./_components/nav";

export default async function ReaderLayout({ children }: { children: ReactNode }) {
  const ctx = await getReadingContext();
  return (
    <div className={`pocket ${figtree.variable}`}>
      {ctx ? (
        <div className="shell">
          <nav className="rail" aria-label="Main">
            <Link href="/" className="wordmark">
              Epic Aid
            </Link>
            <Tabs variant="rail" />
            <div className="rail-foot">
              {ctx.reader.isAdmin && (
                <Link href="/admin" className="rail-admin">
                  Admin
                </Link>
              )}
              <PositionCard ctx={ctx} compact />
            </div>
          </nav>
          <main className="content">{children}</main>
          <nav className="tabbar" aria-label="Main">
            <Tabs variant="bar" />
          </nav>
        </div>
      ) : (
        <main className="content content-solo">{children}</main>
      )}
    </div>
  );
}
