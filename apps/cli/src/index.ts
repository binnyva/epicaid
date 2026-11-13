/**
 * Epic Aid admin CLI. Ingestion (ADR 0002) runs here, on the admin's machine, never on Vercel.
 * Phase 0 ships only `check`; `ingest` arrives in Phase 1.
 */
import { createDb, sql } from "@epicaid/db";

const usage = `Usage: pnpm cli <command>

Commands:
  check     Connect to the database and confirm migrations have run
  ingest    (Phase 1) Ingest a Book's extracted HTML as a Draft
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

const [command] = process.argv.slice(2);
switch (command) {
  case "check":
    await check();
    break;
  case "ingest":
    console.error("Ingestion is built in Phase 1.");
    process.exitCode = 1;
    break;
  default:
    console.log(usage);
}
