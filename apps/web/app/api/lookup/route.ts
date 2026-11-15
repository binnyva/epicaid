/** Subject search for the Look up field. Only Aliases inside the Reader's Spoiler Boundary are searched. */
import { searchSubjects, type SubjectKind } from "@epicaid/db";
import { NextResponse, type NextRequest } from "next/server";
import { getReader } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getReadingContext } from "@/lib/reading";

const KINDS: SubjectKind[] = ["character", "place", "artefact", "faction", "other"];

export async function GET(request: NextRequest) {
  if (!(await getReader())) return NextResponse.json({ error: "signed-out" }, { status: 401 });
  const ctx = await getReadingContext();
  if (!ctx) return NextResponse.json({ results: [] });
  const params = request.nextUrl.searchParams;
  const query = (params.get("q") ?? "").slice(0, 80);
  const kindParam = params.get("kind") as SubjectKind | null;
  const kind = kindParam && KINDS.includes(kindParam) ? kindParam : null;
  const results = await searchSubjects(getDb(), { seriesId: ctx.series.id, boundary: ctx.boundary, query, kind });
  return NextResponse.json(
    { results: results.map(({ ref, name, kind, matched }) => ({ ref, name, kind, matched })) },
    { headers: { "cache-control": "private, no-store" } },
  );
}
