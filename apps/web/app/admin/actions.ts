"use server";
/**
 * Admin server actions. Every action checks the admin flag itself; the layout check alone
 * does not protect a server action, which can be called directly.
 */
import { and, eq, inArray, schema, sql } from "@epicaid/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { normaliseEmail } from "@/lib/access";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { parseOrderPositions } from "@/lib/reading-order";

const { series, books, readingOrders, readingOrderBooks, subjects, aliases, mentions, allowedEmails, readers } = schema;
const KINDS = ["character", "place", "artefact", "faction", "other"] as const;
type Kind = (typeof KINDS)[number];

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const done = (path: string, message?: string): never => {
  revalidatePath("/admin", "layout");
  redirect(message ? `${path}?msg=${encodeURIComponent(message)}` : path);
};
const asKind = (value: string): Kind => (KINDS.includes(value as Kind) ? (value as Kind) : "other");

// ---------- Series and Books ----------

export async function updateSeries(form: FormData) {
  await requireAdmin();
  const id = str(form, "id");
  const name = str(form, "name");
  const slug = str(form, "slug");
  if (name) await getDb().update(series).set({ name }).where(eq(series.id, id));
  done(`/admin/series/${slug}`, "Saved.");
}

export async function setSeriesPublished(form: FormData) {
  await requireAdmin();
  const id = str(form, "id");
  const slug = str(form, "slug");
  const publish = str(form, "publish") === "1";
  const db = getDb();
  if (publish) {
    // Publishing a Series publishes its Books too; a Book can be pulled back on its own afterwards.
    await db.batch([
      db.update(series).set({ status: "published" }).where(eq(series.id, id)),
      db.update(books).set({ status: "published" }).where(eq(books.seriesId, id)),
    ]);
  } else {
    await db.update(series).set({ status: "draft" }).where(eq(series.id, id));
  }
  done(`/admin/series/${slug}`, publish ? "Published." : "Back to Draft.");
}

export async function updateBook(form: FormData) {
  await requireAdmin();
  const slug = str(form, "seriesSlug");
  const title = str(form, "title");
  const author = str(form, "author");
  const status = str(form, "status") === "published" ? "published" : "draft";
  await getDb()
    .update(books)
    .set({ status, ...(title ? { title } : {}), ...(author ? { author } : {}) })
    .where(eq(books.id, str(form, "id")));
  done(`/admin/series/${slug}`, "Book saved.");
}

// ---------- Reading Orders ----------

export async function saveReadingOrder(form: FormData) {
  await requireAdmin();
  const slug = str(form, "seriesSlug");
  const seriesId = str(form, "seriesId");
  const name = str(form, "name");
  if (!name) done(`/admin/series/${slug}`, "A Reading Order needs a name.");
  let entries;
  try {
    entries = parseOrderPositions([...form.entries()].map(([k, v]) => [k, String(v)] as [string, string]));
  } catch (error) {
    return done(`/admin/series/${slug}`, (error as Error).message);
  }
  if (!entries.length) done(`/admin/series/${slug}`, "Give at least one Book a position.");

  const db = getDb();
  const id = str(form, "id") || crypto.randomUUID();
  const isDefault = form.get("isDefault") === "on";
  await db.batch([
    db
      .insert(readingOrders)
      .values({ id, seriesId, name, description: str(form, "description") || null, isDefault })
      .onConflictDoUpdate({
        target: readingOrders.id,
        set: { name, description: str(form, "description") || null, isDefault },
      }),
    ...(isDefault
      ? [
          db
            .update(readingOrders)
            .set({ isDefault: false })
            .where(and(eq(readingOrders.seriesId, seriesId), sql`${readingOrders.id} <> ${id}`)),
        ]
      : []),
    db.delete(readingOrderBooks).where(eq(readingOrderBooks.readingOrderId, id)),
    db.insert(readingOrderBooks).values(entries.map((e) => ({ readingOrderId: id, ...e }))),
  ]);
  done(`/admin/series/${slug}`, `Saved Reading Order "${name}".`);
}

export async function deleteReadingOrder(form: FormData) {
  await requireAdmin();
  await getDb().delete(readingOrders).where(eq(readingOrders.id, str(form, "id")));
  done(`/admin/series/${str(form, "seriesSlug")}`, "Reading Order deleted.");
}

// ---------- Subject catalogue ----------

const subjectPath = (form: FormData, id = str(form, "subjectId")) =>
  `/admin/series/${str(form, "seriesSlug")}/subjects/${id}`;

export async function updateSubject(form: FormData) {
  await requireAdmin();
  const name = str(form, "name");
  await getDb()
    .update(subjects)
    .set({ ...(name ? { name } : {}), kind: asKind(str(form, "kind")), isMajor: form.get("isMajor") === "on" })
    .where(eq(subjects.id, str(form, "subjectId")));
  done(subjectPath(form), "Saved.");
}

export async function setAliasReveal(form: FormData) {
  await requireAdmin();
  const chapterId = str(form, "revealChapterId") || null;
  // Saving the Reveal counts as reviewing it.
  await getDb()
    .update(aliases)
    .set({ revealChapterId: chapterId, reviewNote: null })
    .where(and(eq(aliases.id, str(form, "aliasId")), eq(aliases.subjectId, str(form, "subjectId"))));
  done(subjectPath(form), chapterId ? "Reveal Chapter saved." : "Now an ordinary name with no Reveal.");
}

export async function addAlias(form: FormData) {
  await requireAdmin();
  const name = str(form, "name");
  if (name) {
    await getDb().insert(aliases).values({ subjectId: str(form, "subjectId"), name }).onConflictDoNothing();
  }
  done(subjectPath(form), name ? `Added "${name}". It is searchable but has no Mentions until the next Ingestion.` : undefined);
}

/** Moves one Alias, with its Mentions, into a new Subject of its own. */
export async function splitAlias(form: FormData) {
  await requireAdmin();
  const db = getDb();
  const subjectId = str(form, "subjectId");
  const aliasId = str(form, "aliasId");
  const [subject] = await db.select().from(subjects).where(eq(subjects.id, subjectId));
  const [alias] = await db
    .select()
    .from(aliases)
    .where(and(eq(aliases.id, aliasId), eq(aliases.subjectId, subjectId)));
  if (!subject || !alias) return done(subjectPath(form), "That Alias has already moved.");
  const others = await db.select({ id: aliases.id }).from(aliases).where(eq(aliases.subjectId, subjectId));
  if (others.length < 2) return done(subjectPath(form), "A Subject's only Alias can't be split off.");

  const newId = crypto.randomUUID();
  await db.batch([
    db.insert(subjects).values({ id: newId, seriesId: subject.seriesId, name: alias.name, kind: subject.kind }),
    db.update(aliases).set({ subjectId: newId, revealChapterId: null, reviewNote: null }).where(eq(aliases.id, aliasId)),
    db.update(mentions).set({ subjectId: newId }).where(eq(mentions.aliasId, aliasId)),
  ]);
  done(subjectPath(form, newId), `Split "${alias.name}" into its own Subject.`);
}

/**
 * Merges another Subject (found by name or Alias) into this one. Its Aliases and Mentions move
 * here; Aliases with the same name are combined. Its Book Summaries are dropped, and this
 * Subject's Book Summaries are now out of date until the next `--resummarise`.
 */
export async function mergeSubject(form: FormData) {
  await requireAdmin();
  const db = getDb();
  const targetId = str(form, "subjectId");
  const otherName = str(form, "other");
  const [target] = await db.select().from(subjects).where(eq(subjects.id, targetId));
  if (!target || !otherName) return done(subjectPath(form), "Type the name of the Subject to merge in.");

  const candidates = await db
    .selectDistinct({ id: subjects.id, name: subjects.name })
    .from(subjects)
    .leftJoin(aliases, eq(aliases.subjectId, subjects.id))
    .where(
      and(
        eq(subjects.seriesId, target.seriesId),
        sql`${subjects.id} <> ${targetId}`,
        sql`(lower(${subjects.name}) = lower(${otherName}) or lower(${aliases.name}) = lower(${otherName}))`,
      ),
    );
  if (candidates.length === 0) return done(subjectPath(form), `No other Subject is called "${otherName}".`);
  if (candidates.length > 1) {
    return done(subjectPath(form), `"${otherName}" matches ${candidates.map((c) => c.name).join(", ")}. Merge from that Subject's own page instead.`);
  }
  const otherId = candidates[0]!.id;

  await db.batch([
    db.execute(sql`
      insert into aliases (subject_id, name, reveal_chapter_id, review_note)
      select ${targetId}, name, reveal_chapter_id, review_note from aliases where subject_id = ${otherId}
      on conflict (subject_id, name) do nothing`),
    db.execute(sql`
      insert into mentions (passage_id, alias_id, subject_id)
      select m.passage_id, moved.id, ${targetId}
      from mentions m
      join aliases old on old.id = m.alias_id
      join aliases moved on moved.subject_id = ${targetId} and moved.name = old.name
      where m.subject_id = ${otherId}
      on conflict do nothing`),
    db.execute(sql`update lookup_history set subject_id = ${targetId} where subject_id = ${otherId}`),
    db.execute(sql`update spoiler_reports set subject_id = ${targetId} where subject_id = ${otherId}`),
    db.execute(sql`
      update subjects set is_major = is_major or (select is_major from subjects where id = ${otherId})
      where id = ${targetId}`),
    db.delete(subjects).where(eq(subjects.id, otherId)),
  ]);
  done(subjectPath(form), `Merged "${candidates[0]!.name}" into this Subject.`);
}

export async function deleteSubject(form: FormData) {
  await requireAdmin();
  await getDb().delete(subjects).where(eq(subjects.id, str(form, "subjectId")));
  done(`/admin/series/${str(form, "seriesSlug")}/subjects`, "Subject deleted.");
}

/** Clears the review flag on Aliases without changing them (the Reveal Chapter Ingestion chose stands). */
export async function markReviewed(form: FormData) {
  await requireAdmin();
  const ids = form.getAll("aliasId").map(String).filter(Boolean);
  if (ids.length) await getDb().update(aliases).set({ reviewNote: null }).where(inArray(aliases.id, ids));
  const back = str(form, "back");
  done(back.startsWith("/admin/") ? back : "/admin", "Marked as reviewed.");
}

// ---------- Readers ----------

export async function addAllowedEmail(form: FormData) {
  await requireAdmin();
  const email = normaliseEmail(str(form, "email"));
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return done("/admin/readers", "That doesn't look like an email address.");
  await getDb().insert(allowedEmails).values({ email }).onConflictDoNothing();
  done("/admin/readers", `${email} can now sign in.`);
}

export async function removeAllowedEmail(form: FormData) {
  await requireAdmin();
  await getDb().delete(allowedEmails).where(eq(allowedEmails.email, str(form, "email")));
  done("/admin/readers", "Removed. They are signed out on their next visit.");
}

export async function setReaderAdmin(form: FormData) {
  const me = await requireAdmin();
  const id = str(form, "id");
  if (id === me.id) return done("/admin/readers", "You can't change your own admin flag.");
  await getDb().update(readers).set({ isAdmin: str(form, "admin") === "1" }).where(eq(readers.id, id));
  done("/admin/readers", "Saved.");
}
