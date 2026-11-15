/** Quote Search: Chapters of the current Book that match a quote. Numbers and titles only, never text. */
import { quoteSearch } from "@epicaid/db";
import { NextResponse, type NextRequest } from "next/server";
import { getReader } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getReadingContext } from "@/lib/reading";

export async function GET(request: NextRequest) {
  if (!(await getReader())) return NextResponse.json({ error: "signed-out" }, { status: 401 });
  const ctx = await getReadingContext();
  if (!ctx?.currentBook) return NextResponse.json({ chapters: [] });
  const quote = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 300);
  const chapters = await quoteSearch(getDb(), ctx.currentBook.id, quote);
  return NextResponse.json({ chapters }, { headers: { "cache-control": "private, no-store" } });
}
