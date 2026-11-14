import { createDb, type Db } from "@epicaid/db";

let db: Db | undefined;

/** One Neon HTTP client per server instance. */
export function getDb(): Db {
  db ??= createDb();
  return db;
}
