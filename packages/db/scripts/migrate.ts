/**
 * Applies migrations with node-postgres. Used instead of `drizzle-kit migrate`,
 * which swallows connection and SQL errors.
 */
import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

if (existsSync("../../.env")) process.loadEnvFile("../../.env");

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL_UNPOOLED (or DATABASE_URL) in .env");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const host = new URL(url).host;
  console.log(`Applying migrations to ${host} …`);
  await migrate(drizzle({ client: pool }), { migrationsFolder: "./migrations" });
  console.log("Migrations applied.");
} catch (error) {
  console.error("Migration failed:");
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
