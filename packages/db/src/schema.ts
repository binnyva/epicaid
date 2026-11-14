/**
 * Database schema. Table and column names follow the glossary in CONTEXT.md.
 * Sign-in needs no tables of its own: sessions are signed cookies (apps/web/lib/session.ts).
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const publishStatus = pgEnum("publish_status", ["draft", "published"]);
export const subjectKind = pgEnum("subject_kind", ["character", "place", "artefact", "faction", "other"]);
export const reportStatus = pgEnum("report_status", ["open", "resolved"]);
export const spendPurpose = pgEnum("spend_purpose", ["extraction", "book_summary", "summary"]);

// ---------- Books ----------

export const series = pgTable("series", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  status: publishStatus("status").notNull().default("draft"),
  createdAt: createdAt(),
});

export const books = pgTable(
  "books",
  {
    id: id(),
    seriesId: uuid("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    author: text("author").notNull(),
    coverUrl: text("cover_url"),
    status: publishStatus("status").notNull().default("draft"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("books_series_slug").on(t.seriesId, t.slug)],
);

export const chapters = pgTable(
  "chapters",
  {
    id: id(),
    bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
    /** Zero-based position within the Book. */
    index: integer("index").notNull(),
    /** "Prologue", "Chapter 7", "Interlude" … */
    label: text("label").notNull(),
    title: text("title"),
  },
  (t) => [uniqueIndex("chapters_book_index").on(t.bookId, t.index)],
);

export const passages = pgTable(
  "passages",
  {
    id: id(),
    chapterId: uuid("chapter_id").notNull().references(() => chapters.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    text: text("text").notNull(),
  },
  (t) => [uniqueIndex("passages_chapter_index").on(t.chapterId, t.index)],
);

export const readingOrders = pgTable("reading_orders", {
  id: id(),
  seriesId: uuid("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  isDefault: boolean("is_default").notNull().default(false),
});

export const readingOrderBooks = pgTable(
  "reading_order_books",
  {
    readingOrderId: uuid("reading_order_id").notNull().references(() => readingOrders.id, { onDelete: "cascade" }),
    bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.readingOrderId, t.position] }),
    uniqueIndex("reading_order_books_book").on(t.readingOrderId, t.bookId),
  ],
);

// ---------- Lookups ----------

export const subjects = pgTable(
  "subjects",
  {
    id: id(),
    seriesId: uuid("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: subjectKind("kind").notNull().default("other"),
    isMajor: boolean("is_major").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("subjects_series").on(t.seriesId)],
);

export const aliases = pgTable(
  "aliases",
  {
    id: id(),
    subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Only set for secret identities (ADR 0005). Null = ordinary name, joined wherever visible. */
    revealChapterId: uuid("reveal_chapter_id").references(() => chapters.id, { onDelete: "set null" }),
    /** Set by Ingestion when this Alias looks like a secret identity; cleared once the admin reviews it. */
    reviewNote: text("review_note"),
  },
  (t) => [
    uniqueIndex("aliases_subject_name").on(t.subjectId, t.name),
    index("aliases_name_trgm").using("gin", sql`${t.name} gin_trgm_ops`),
    index("aliases_name_dmetaphone").on(sql`dmetaphone(${t.name})`),
  ],
);

export const mentions = pgTable(
  "mentions",
  {
    passageId: uuid("passage_id").notNull().references(() => passages.id, { onDelete: "cascade" }),
    aliasId: uuid("alias_id").notNull().references(() => aliases.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.passageId, t.aliasId] }),
    index("mentions_subject").on(t.subjectId),
    index("mentions_alias").on(t.aliasId),
  ],
);

export const bookSummaries = pgTable(
  "book_summaries",
  {
    id: id(),
    subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
    bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("book_summaries_key").on(t.subjectId, t.bookId, t.model, t.promptVersion)],
);

// ---------- Readers ----------

export const readers = pgTable("readers", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name"),
  image: text("image"),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: createdAt(),
});

export const allowedEmails = pgTable("allowed_emails", {
  email: text("email").primaryKey(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});

export const readings = pgTable(
  "readings",
  {
    id: id(),
    readerId: uuid("reader_id").notNull().references(() => readers.id, { onDelete: "cascade" }),
    seriesId: uuid("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
    readingOrderId: uuid("reading_order_id").references(() => readingOrders.id, { onDelete: "set null" }),
    /** The Reading Position: last finished Chapter of the current Book. Null between Books. */
    lastFinishedChapterId: uuid("last_finished_chapter_id").references(() => chapters.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("readings_reader_series").on(t.readerId, t.seriesId)],
);

export const finishedBooks = pgTable(
  "finished_books",
  {
    readingId: uuid("reading_id").notNull().references(() => readings.id, { onDelete: "cascade" }),
    bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.readingId, t.bookId] })],
);

export const lookupHistory = pgTable(
  "lookup_history",
  {
    id: id(),
    readingId: uuid("reading_id").notNull().references(() => readings.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
    lookedUpAt: timestamp("looked_up_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lookup_history_reading").on(t.readingId, t.lookedUpAt)],
);

// ---------- Operations ----------

export const spoilerReports = pgTable("spoiler_reports", {
  id: id(),
  readerId: uuid("reader_id").notNull().references(() => readers.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  cacheKey: text("cache_key").notNull(),
  note: text("note"),
  status: reportStatus("status").notNull().default("open"),
  createdAt: createdAt(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const spendLog = pgTable(
  "spend_log",
  {
    id: id(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    purpose: spendPurpose("purpose").notNull(),
    readerId: uuid("reader_id").references(() => readers.id, { onDelete: "set null" }),
    model: text("model").notNull(),
    promptTokens: integer("prompt_tokens").notNull(),
    completionTokens: integer("completion_tokens").notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull(),
  },
  (t) => [index("spend_log_occurred").on(t.occurredAt)],
);

/** Admin-editable settings: summary model, prompt version, daily caps. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});
