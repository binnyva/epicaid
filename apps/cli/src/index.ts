/**
 * Epic Aid admin CLI. Ingestion (ADR 0002) runs here, on the admin's machine, never on Vercel.
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { createDb, eq, schema, sql } from "@epicaid/db";
import { createNodeDb } from "@epicaid/db/node";
import { parseReasoningEffort } from "@epicaid/core";
import { DEFAULT_EXTRACTION_REASONING, DEFAULT_MODEL, DEFAULT_SUMMARY_REASONING, ingest } from "./ingest";

const usage = `Usage: pnpm cli <command>

Commands:
  check                      Connect to the database and confirm migrations have run
  ingest <book-folder>       Ingest an extracted Book (see README) into a Series, as a Draft
  delete-series <slug> --yes Delete a Draft Series and everything in it (re-ingesting reuses the
                             extraction cache, so this costs nothing to undo except Book Summaries)

Options for ingest:
  --series <slug>            Series to add the Book to, e.g. malazan (required)
  --series-name <name>       Display name when the Series is new (default: from book.json)
  --model <id>               OpenRouter model for extraction (default: $EXTRACTION_MODEL or ${DEFAULT_MODEL})
  --summary-model <id>       Model for Book Summaries (default: $SUMMARY_MODEL or the extraction model)
  --reasoning <effort>       Reasoning effort for extraction: none, low, medium, high, max
                             (default: $EXTRACTION_REASONING or ${DEFAULT_EXTRACTION_REASONING}). Cached Chapters are reused
                             whatever effort wrote them.
  --summary-reasoning <e>    Reasoning effort for Book Summaries (default: $SUMMARY_REASONING or ${DEFAULT_SUMMARY_REASONING})
  --concurrency <n>          Parallel model calls (default: 8)
  --major <n>                Passages needed to count as a Major Subject (default: 25)
  --passage-words <n>        Target Passage size in words (default: 350)
  --skip-failed              Load the Book even if a few Passages failed extraction (they get no
                             Mentions; a later run without the flag retries them)
  --skip-summaries           Load the catalogue without writing Book Summaries
  --resummarise              Rewrite Book Summaries that already exist
  --fresh                    Ignore work other models did. By default a Chapter or Book Summary that
                             any model already produced is reused, so a model switch only pays for new work
  --dry-run                  Split into Passages and report sizes; no model calls or writes
`;

async function check() {
  const db = createDb();
  const result = await db.execute(
    sql`select extname from pg_extension where extname in ('pg_trgm', 'fuzzystrmatch') order by extname`,
  );
  const extensions = result.rows.map((row) => String(row.extname));
  const tables = await db.execute(sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`);
  console.log(`Connected. Extensions: ${extensions.join(", ") || "none"}. Tables: ${tables.rows[0]?.n ?? 0}.`);
  if (extensions.length < 2) {
    console.error("Missing pg_trgm or fuzzystrmatch. Run `pnpm db:migrate`.");
    process.exitCode = 1;
  }
}

async function deleteSeries(slug: string) {
  const { db, close } = createNodeDb();
  try {
    const [row] = await db.select().from(schema.series).where(eq(schema.series.slug, slug));
    if (!row) return console.log(`No Series "${slug}".`);
    if (row.status === "published") {
      console.error(`"${slug}" is published; unpublish it in admin first.`);
      process.exitCode = 1;
      return;
    }
    await db.delete(schema.series).where(eq(schema.series.id, row.id));
    console.log(`Deleted Draft Series "${row.name}" and its Books, Subjects and Book Summaries.`);
  } finally {
    await close();
  }
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    series: { type: "string" },
    "series-name": { type: "string" },
    model: { type: "string" },
    "summary-model": { type: "string" },
    reasoning: { type: "string" },
    "summary-reasoning": { type: "string" },
    concurrency: { type: "string", default: "8" },
    major: { type: "string", default: "25" },
    "passage-words": { type: "string", default: "350" },
    "skip-failed": { type: "boolean", default: false },
    "skip-summaries": { type: "boolean", default: false },
    resummarise: { type: "boolean", default: false },
    fresh: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
  },
});

const [command, target] = positionals;
switch (command) {
  case "check":
    await check();
    break;
  case "delete-series":
    if (!target || !values.yes) {
      console.error("Usage: pnpm cli delete-series <slug> --yes");
      process.exitCode = 1;
    } else {
      await deleteSeries(target);
    }
    break;
  case "ingest": {
    if (!target || !values.series) {
      console.error(usage);
      process.exitCode = 1;
      break;
    }
    const model = values.model ?? process.env.EXTRACTION_MODEL ?? DEFAULT_MODEL;
    await ingest({
      // pnpm runs this from apps/cli; resolve paths from where the command was typed.
      bookFolder: path.resolve(process.env.INIT_CWD ?? process.cwd(), target),
      seriesSlug: values.series,
      seriesName: values["series-name"],
      model,
      summaryModel: values["summary-model"] ?? process.env.SUMMARY_MODEL ?? model,
      reasoning: parseReasoningEffort(
        values.reasoning ?? process.env.EXTRACTION_REASONING ?? DEFAULT_EXTRACTION_REASONING,
        "--reasoning",
      ),
      summaryReasoning: parseReasoningEffort(
        values["summary-reasoning"] ?? process.env.SUMMARY_REASONING ?? DEFAULT_SUMMARY_REASONING,
        "--summary-reasoning",
      ),
      concurrency: Number(values.concurrency),
      majorThreshold: Number(values.major),
      passageWords: Number(values["passage-words"]),
      dryRun: values["dry-run"],
      skipFailed: values["skip-failed"],
      skipSummaries: values["skip-summaries"],
      resummarise: values.resummarise,
      fresh: values.fresh,
    });
    break;
  }
  default:
    console.log(usage);
}
