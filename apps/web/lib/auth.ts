/** Server-side helpers for the signed-in Reader. */
import { eq, schema } from "@epicaid/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "./db";
import { isBootstrapAdmin, maySignIn } from "./access";
import { SESSION_COOKIE, authSecret, decodeSession } from "./session";

export type Reader = typeof schema.readers.$inferSelect;

export async function getReader(): Promise<Reader | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = decodeSession(token, authSecret());
  if (!session) return null;
  const db = getDb();
  const [reader] = await db.select().from(schema.readers).where(eq(schema.readers.id, session.readerId));
  if (!reader) return null;
  // Removing someone from the allow-list signs them out on their next request.
  const allowed = await db
    .select({ email: schema.allowedEmails.email })
    .from(schema.allowedEmails)
    .where(eq(schema.allowedEmails.email, reader.email));
  if (!maySignIn(reader.email, allowed.map((a) => a.email))) return null;
  return isBootstrapAdmin(reader.email) ? { ...reader, isAdmin: true } : reader;
}

export async function requireReader(): Promise<Reader> {
  const reader = await getReader();
  if (!reader) redirect("/sign-in");
  return reader;
}

export async function requireAdmin(): Promise<Reader> {
  const reader = await requireReader();
  if (!reader.isAdmin) redirect("/");
  return reader;
}
