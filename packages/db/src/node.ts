/**
 * TCP (node-postgres) connection for the CLI: transactions and bulk inserts
 * work better here than over Neon's HTTP driver. Not for use on Vercel.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export function createNodeDb(url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set");
  // keepAlive and a short idle timeout make it less likely Neon or the network drops a connection we hold.
  const pool = new pg.Pool({ connectionString: url, max: 4, keepAlive: true, idleTimeoutMillis: 30_000 });
  // An idle connection that dies (Wi-Fi change, laptop sleep, Neon closing it) is reported here. Without a
  // listener Node crashes the whole process; the pool has already thrown the connection away and the next
  // query opens a fresh one, so a note is enough.
  pool.on("error", (error) => {
    console.warn(`  (database connection dropped: ${error.message}; reconnecting on the next query)`);
  });
  return { db: drizzle({ client: pool, schema }), close: () => pool.end() };
}

export type NodeDb = ReturnType<typeof createNodeDb>["db"];
