/**
 * TCP (node-postgres) connection for the CLI: transactions and bulk inserts
 * work better here than over Neon's HTTP driver. Not for use on Vercel.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export function createNodeDb(url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set");
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  return { db: drizzle({ client: pool, schema }), close: () => pool.end() };
}

export type NodeDb = ReturnType<typeof createNodeDb>["db"];
