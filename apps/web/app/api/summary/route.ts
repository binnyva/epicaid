/**
 * Writes the Summary for a lookup on a cache miss. The reply is a stream of JSON lines: progress lines while
 * Book Summaries and the Summary are written, then the Summary or an error. Streaming keeps the Reader
 * informed and the connection alive on slow lookups.
 */
import { getOrBuildSummary, parseRef, resolveTargets, SummaryError } from "@epicaid/db";
import { NextResponse, type NextRequest } from "next/server";
import { getReader } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getChatJson } from "@/lib/llm";
import { getReadingContext } from "@/lib/reading";
import { getSummaryCache } from "@/lib/summary-cache";
import type { SummaryStreamLine } from "@/lib/summary-text";

export const maxDuration = 300;


export async function POST(request: NextRequest) {
  if (!(await getReader())) return NextResponse.json({ error: "signed-out" }, { status: 401 });
  const ctx = await getReadingContext();
  const body = (await request.json().catch(() => ({}))) as { ref?: string };
  const ref = parseRef(String(body.ref ?? ""));
  // The ref is checked against the Reader's own boundary, like the Subject page does.
  const [target] = ctx && ref ? await resolveTargets(getDb(), ctx.series.id, ctx.boundary, [ref]) : [];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: SummaryStreamLine) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      try {
        if (!ctx || !target) {
          send({ type: "error", code: "not-visible", message: "No match" });
          return;
        }
        const entry = await getOrBuildSummary({
          db: getDb(),
          chatJson: getChatJson(),
          cache: getSummaryCache(),
          seriesId: ctx.series.id,
          boundary: ctx.boundary,
          readerId: ctx.reader.id,
          target,
          onProgress: (text) => send({ type: "progress", text }),
        });
        send({ type: "summary", entry });
      } catch (error) {
        console.error("Summary failed", error);
        const code = error instanceof SummaryError ? error.code : "llm";
        send({ type: "error", code, message: error instanceof Error ? error.message : String(error) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
