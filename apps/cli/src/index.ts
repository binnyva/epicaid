/**
 * Epic Aid admin CLI. Ingestion (ADR 0002) runs here, on the admin's machine, never on Vercel.
 */
import { parseArgs } from "node:util";
import { createDb, sql } from "@epicaid/db";
import { DEFAULT_MODEL, ingest } from "./ingest";

const usage = `Usage: pnpm cli <command>

Commands:
  check                      Connect to the database and confirm migrations have run
  ingest <book-folder>       Ingest an extracted Book (see README) into a Series, as a Draft

Options for ingest:
  --series <slug>            Series to add the Book to, e.g. malazan (required)
  --series-name <name>       Display name when the Series is new (default: from book.json)
  --model <id>               OpenRouter model for extraction (default: $EXTRACTION_MODEL or ${DEFAULT_MODEL})
  --summary-model <id>       Model for Book Summaries (default: $SUMMARY_MODEL or the extraction model)
  --concurrency <n>          Parallel model calls (default: 8)
  --major <n>                Passages needed to count as a Major Subject (default: 25)
  --passage-words <n>        Target Passage size in words (default: 350)
  --skip-summaries           Load the catalogue without writing Book Summaries
  --resummarise              Rewrite Book Summaries that already exist
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

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    series: { type: "string" },
    "series-name": { type: "string" },
    model: { type: "string" },
    "summary-model": { type: "string" },
    concurrency: { type: "string", default: "8" },
    major: { type: "string", default: "25" },
    "passage-words": { type: "string", default: "350" },
    "skip-summaries": { type: "boolean", default: false },
    resummarise: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

const [command, target] = positionals;
switch (command) {
  case "check":
    await check();
    break;
  case "ingest": {
    if (!target || !values.series) {
      console.error(usage);
      process.exitCode = 1;
      break;
    }
    const model = values.model ?? process.env.EXTRACTION_MODEL ?? DEFAULT_MODEL;
    await ingest({
      bookFolder: target,
      seriesSlug: values.series,
      seriesName: values["series-name"],
      model,
      summaryModel: values["summary-model"] ?? process.env.SUMMARY_MODEL ?? model,
      concurrency: Number(values.concurrency),
      majorThreshold: Number(values.major),
      passageWords: Number(values["passage-words"]),
      dryRun: values["dry-run"],
      skipSummaries: values["skip-summaries"],
      resummarise: values.resummarise,
    });
    break;
  }
  default:
    console.log(usage);
}
