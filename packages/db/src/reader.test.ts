/**
 * Spoiler-safety tests for the reader queries, run against an in-process Postgres (PGlite)
 * with the real migrations and a tiny made-up Series:
 *
 *   Ash (3 Chapters), Brine (3), Cinder (2): published.  Draft (1): never published.
 *
 *   Kellanved   character  "Kellanved" Ash 0 · "Shadowthrone" Ash 2, Brine 1 (secret, Reveal Brine 2)
 *                          · "Ammanas" Cinder 0 (secret, Reveal Cinder 1)
 *   Anomander   character  "Son of Darkness" Ash 1 · "Anomander Rake" Brine 0
 *   Darujhistan place      "Darujhistan" Ash 1
 *   Dragnipur   artefact   "Dragnipur" Cinder 1
 *   Bridgeburners faction  "Bridgeburners" Draft 0
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { fuzzystrmatch } from "@electric-sql/pglite/contrib/fuzzystrmatch";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import type { SpoilerBoundary } from "@epicaid/core";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  lookupHistory,
  parseRef,
  pickDisplayName,
  quoteSearch,
  recordLookup,
  resolveTargets,
  searchSubjects,
  type AnyDb,
} from "./reader";
import * as schema from "./schema";

const migrations = new URL("../migrations/", import.meta.url);
let db: AnyDb;
const ids: Record<string, string> = {};
let seriesId = "";

async function sqlRows<T>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pg.query<T>(text, params)).rows;
}
let pg: PGlite;

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pg_trgm, fuzzystrmatch } });
  const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", migrations), "utf8")) as {
    entries: { tag: string }[];
  };
  for (const { tag } of journal.entries) {
    const file = readFileSync(new URL(`${tag}.sql`, migrations), "utf8");
    for (const statement of file.split("--> statement-breakpoint")) if (statement.trim()) await pg.exec(statement);
  }
  db = drizzle({ client: pg, schema });

  const [s] = await sqlRows<{ id: string }>(
    "insert into series (slug, name, status) values ('lantern', 'The Lantern Cycle', 'published') returning id",
  );
  seriesId = s!.id;
  const books: [string, number, "published" | "draft"][] = [
    ["ash", 3, "published"],
    ["brine", 3, "published"],
    ["cinder", 2, "published"],
    ["draft", 1, "draft"],
  ];
  for (const [slug, chapters, status] of books) {
    const [book] = await sqlRows<{ id: string }>(
      "insert into books (series_id, slug, title, author, status) values ($1, $2, $3, 'Anon', $4) returning id",
      [seriesId, slug, slug[0]!.toUpperCase() + slug.slice(1), status],
    );
    ids[slug] = book!.id;
    for (let i = 0; i < chapters; i++) {
      const [ch] = await sqlRows<{ id: string }>(
        "insert into chapters (book_id, index, label, title) values ($1, $2, $3, $4) returning id",
        [book!.id, i, `Chapter ${i + 1}`, `${slug} ${i + 1}`],
      );
      ids[`${slug}${i}`] = ch!.id;
      const [p] = await sqlRows<{ id: string }>(
        "insert into passages (chapter_id, index, text) values ($1, 0, $2) returning id",
        [ch!.id, passageText(slug, i)],
      );
      ids[`p:${slug}${i}`] = p!.id;
    }
  }

  const subject = async (key: string, name: string, kind: string, aliases: [string, string[], string?][]) => {
    const [s] = await sqlRows<{ id: string }>(
      "insert into subjects (series_id, name, kind) values ($1, $2, $3) returning id",
      [seriesId, name, kind],
    );
    ids[key] = s!.id;
    for (const [alias, chapters, reveal] of aliases) {
      const [a] = await sqlRows<{ id: string }>(
        "insert into aliases (subject_id, name, reveal_chapter_id) values ($1, $2, $3) returning id",
        [s!.id, alias, reveal ? ids[reveal] : null],
      );
      ids[`alias:${alias}`] = a!.id;
      for (const ch of chapters) {
        await pg.query("insert into mentions (passage_id, alias_id, subject_id) values ($1, $2, $3)", [
          ids[`p:${ch}`],
          a!.id,
          s!.id,
        ]);
      }
    }
  };
  await subject("kellanved", "Kellanved", "character", [
    ["Kellanved", ["ash0"]],
    ["Shadowthrone", ["ash2", "brine1"], "brine2"],
    ["Ammanas", ["cinder0"], "cinder1"],
  ]);
  await subject("anomander", "Anomander Rake", "character", [
    ["Son of Darkness", ["ash1"]],
    ["Anomander Rake", ["brine0"]],
  ]);
  await subject("daru", "Darujhistan", "place", [["Darujhistan", ["ash1"]]]);
  await subject("dragnipur", "Dragnipur", "artefact", [["Dragnipur", ["cinder1"]]]);
  await subject("bridgeburners", "Bridgeburners", "faction", [["Bridgeburners", ["draft0"]]]);
});

function passageText(slug: string, i: number): string {
  const texts: Record<string, string> = {
    ash0: "The old Emperor walked the empty halls of the palace, counting the cracks in the stone.",
    ash1: "Smoke rose above the blue fires of the great city, and the Son of Darkness watched from his floating keep.",
    ash2: "A shadow sat upon a throne of shadow and laughed at the hounds that circled beneath him.",
  };
  return texts[`${slug}${i}`] ?? `Unremarkable prose for ${slug} chapter ${i}, with nothing worth quoting at all.`;
}

const at = (bookSlug: string, lastFinishedChapterIndex: number, finished: string[] = []): SpoilerBoundary => ({
  finishedBookIds: finished.map((f) => ids[f]!),
  position: { bookId: ids[bookSlug]!, lastFinishedChapterIndex },
});
const finished = (...books: string[]): SpoilerBoundary => ({ finishedBookIds: books.map((b) => ids[b]!), position: null });

const names = async (boundary: SpoilerBoundary, query: string) =>
  (await searchSubjects(db, { seriesId, boundary, query })).map((r) => r.name);

describe("Subject search inside the Spoiler Boundary", () => {
  it("finds visible names by sound and by typo", async () => {
    const b = at("ash", 1);
    expect(await names(b, "Kelanvead")).toEqual(["Kellanved"]);
    expect(await names(b, "darujistan")).toEqual(["Darujhistan"]);
  });

  it("gives no match for a name that appears only past the Reading Position, near-misses included", async () => {
    const b = at("ash", 1);
    for (const q of ["Shadowthrone", "Shadowthorne", "shadow throne", "Dragnipur", "Dragnipor", "Ammanas", "Anomander", "Rake"]) {
      expect(await names(b, q), q).toEqual([]);
    }
  });

  it("never shows a Draft Book's names, even to someone who marked it finished", async () => {
    expect(await names(finished("ash", "brine", "cinder", "draft"), "Bridgeburners")).toEqual([]);
  });

  it("shows a Subject by a visible name and never leaks its later names", async () => {
    const [son] = await searchSubjects(db, { seriesId, boundary: at("ash", 1), query: "son of dark" });
    expect(son).toMatchObject({ name: "Son of Darkness", otherNames: [], matched: null });
  });

  it("keeps an unrevealed Alias apart from its Subject (ADR 0005)", async () => {
    const b = at("brine", 1, ["ash"]);
    const [shadow] = await searchSubjects(db, { seriesId, boundary: b, query: "Shadowthrone" });
    expect(shadow).toMatchObject({ name: "Shadowthrone", otherNames: [] });
    expect(parseRef(shadow!.ref)?.type).toBe("alias");
    const [kell] = await searchSubjects(db, { seriesId, boundary: b, query: "Kellanved" });
    expect(kell).toMatchObject({ name: "Kellanved", otherNames: [] });
  });

  it("joins the Alias once its Reveal is inside the boundary", async () => {
    const b = at("brine", 2, ["ash"]);
    const [shadow] = await searchSubjects(db, { seriesId, boundary: b, query: "Shadowthrone" });
    expect(shadow).toMatchObject({ name: "Kellanved", otherNames: ["Shadowthrone"], matched: "Shadowthrone" });
    expect(shadow!.ref).toBe(`s-${ids.kellanved}`);
  });

  it("depends only on the set of Finished Books, so reading Cinder first shows only Cinder's names", async () => {
    const b = finished("cinder");
    expect(await names(b, "Kellanved")).toEqual([]);
    const [ammanas] = await searchSubjects(db, { seriesId, boundary: b, query: "Ammanas" });
    expect(ammanas).toMatchObject({ name: "Ammanas", otherNames: [] });
  });

  it("filters by kind", async () => {
    const b = finished("ash", "brine", "cinder");
    expect((await searchSubjects(db, { seriesId, boundary: b, query: "Dragnipur", kind: "character" })).length).toBe(0);
    expect(await names(b, "Dragnipur")).toEqual(["Dragnipur"]);
  });

  it("finds nothing for an empty boundary", async () => {
    expect(await names({ finishedBookIds: [], position: null }, "Kellanved")).toEqual([]);
  });
});

describe("resolveTargets", () => {
  it("refuses refs the Reader cannot see, so a guessed URL shows nothing", async () => {
    const b = at("ash", 1);
    const refs = [
      { type: "alias", id: ids["alias:Shadowthrone"]! },
      { type: "subject", id: ids.dragnipur! },
      { type: "subject", id: ids.bridgeburners! },
    ] as const;
    expect(await resolveTargets(db, seriesId, b, refs)).toEqual([]);
  });

  it("turns an Alias ref into its Subject after the Reveal", async () => {
    const [t] = await resolveTargets(db, seriesId, finished("ash", "brine"), [
      { type: "alias", id: ids["alias:Shadowthrone"]! },
    ]);
    expect(t).toMatchObject({ ref: `s-${ids.kellanved}`, name: "Kellanved", otherNames: ["Shadowthrone"] });
  });

  it("ignores a Subject from another Series", async () => {
    const [other] = await sqlRows<{ id: string }>("insert into series (slug, name) values ('other', 'Other') returning id");
    expect(await resolveTargets(db, other!.id, finished("ash"), [{ type: "subject", id: ids.daru! }])).toEqual([]);
  });
});

describe("pickDisplayName", () => {
  it("prefers the catalogue name, then the most mentioned visible name", () => {
    expect(pickDisplayName("A", [{ name: "B", mentions: 9 }, { name: "A", mentions: 1 }])).toBe("A");
    expect(pickDisplayName("A", [{ name: "B", mentions: 1 }, { name: "C", mentions: 5 }])).toBe("C");
    expect(pickDisplayName("A", [])).toBeNull();
  });
});

describe("Quote Search", () => {
  it("returns Chapter numbers and titles only, forgiving case, punctuation and a misheard word", async () => {
    const hits = await quoteSearch(db, ids.ash!, "a shadow sat upon a throne of shadows, and laughed");
    expect(hits).toEqual([{ index: 2, label: "Chapter 3", title: "ash 3" }]);
    expect(Object.keys(hits[0]!)).toEqual(["index", "label", "title"]);
    expect(await quoteSearch(db, ids.ash!, "the son of darkness WATCHED from his floating keep")).toMatchObject([{ index: 1 }]);
  });

  it("needs four or more words", async () => {
    expect(await quoteSearch(db, ids.ash!, "throne of shadow")).toEqual([]);
  });

  it("searches only the Book it is given, and never a Draft", async () => {
    expect(await quoteSearch(db, ids.brine!, "a shadow sat upon a throne of shadow")).toEqual([]);
    expect(await quoteSearch(db, ids.draft!, "unremarkable prose for draft chapter")).toEqual([]);
  });
});

describe("Lookup History", () => {
  it("keeps the newest 20, moves a repeat to the top, and re-checks each against the current boundary", async () => {
    const [reader] = await sqlRows<{ id: string }>("insert into readers (email) values ('r@example.com') returning id");
    const [reading] = await sqlRows<{ id: string }>(
      "insert into readings (reader_id, series_id) values ($1, $2) returning id",
      [reader!.id, seriesId],
    );
    const readingId = reading!.id;
    const late = finished("ash", "brine", "cinder");
    const [daru] = await resolveTargets(db, seriesId, late, [{ type: "subject", id: ids.daru! }]);
    const [kell] = await resolveTargets(db, seriesId, late, [{ type: "subject", id: ids.kellanved! }]);
    const [drag] = await resolveTargets(db, seriesId, late, [{ type: "subject", id: ids.dragnipur! }]);
    for (let i = 0; i < 22; i++) await recordLookup(db, readingId, [daru!, kell!][i % 2]!);
    await recordLookup(db, readingId, drag!);
    await recordLookup(db, readingId, daru!);
    const rows = await sqlRows("select 1 from lookup_history where reading_id = $1", [readingId]);
    expect(rows.length).toBe(3);

    expect((await lookupHistory(db, readingId, seriesId, late)).map((t) => t.name)).toEqual([
      "Darujhistan",
      "Dragnipur",
      "Kellanved",
    ]);
    // Moving back to Ash 1: Dragnipur drops out and Kellanved loses his later names.
    const back = await lookupHistory(db, readingId, seriesId, at("ash", 1));
    expect(back.map((t) => [t.name, t.otherNames])).toEqual([
      ["Darujhistan", []],
      ["Kellanved", []],
    ]);
  });

  it("trims to 20 entries", async () => {
    const [reader] = await sqlRows<{ id: string }>("insert into readers (email) values ('t@example.com') returning id");
    const [reading] = await sqlRows<{ id: string }>(
      "insert into readings (reader_id, series_id) values ($1, $2) returning id",
      [reader!.id, seriesId],
    );
    const subjects = await sqlRows<{ id: string }>("select id from subjects where series_id = $1", [seriesId]);
    for (let i = 0; i < 25; i++) {
      await pg.query("insert into lookup_history (reading_id, subject_id) values ($1, $2)", [
        reading!.id,
        subjects[i % subjects.length]!.id,
      ]);
    }
    const [daru] = await resolveTargets(db, seriesId, finished("ash"), [{ type: "subject", id: ids.daru! }]);
    await recordLookup(db, reading!.id, daru!);
    const rows = await sqlRows("select 1 from lookup_history where reading_id = $1", [reading!.id]);
    expect(rows.length).toBe(20);
  });
});
