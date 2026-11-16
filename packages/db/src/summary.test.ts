/**
 * Spoiler-safety tests for Summaries, against an in-process Postgres (PGlite) with the real migrations and a
 * fake model. The made-up Series:
 *
 *   Ash (3 Chapters), Brine (3), Cinder (2): published.  Draft (1): never published.
 *
 *   Kellanved    "Kellanved" Ash 0 · "Shadowthrone" Ash 2, Brine 1 (secret, Reveal Brine 2)
 *                · "Ammanas" Cinder 0 (secret, Reveal Cinder 1)
 *                Ingestion's Book Summary of Ash (scope "") was written from Kellanved and Shadowthrone.
 *   Darujhistan  "Darujhistan" Ash 1
 *   Dragnipur    "Dragnipur" Cinder 1
 *   Whiskeyjack  "Whiskeyjack" four long Passages in Ash, one in Brine 0
 *   Bridgeburners "Bridgeburners" Draft 0
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { fuzzystrmatch } from "@electric-sql/pglite/contrib/fuzzystrmatch";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import type { ChatJson, ChatJsonRequest, SpoilerBoundary, SummaryReply } from "@epicaid/core";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolveTargets, type AnyDb, type TargetRef } from "./reader";
import * as schema from "./schema";
import {
  DEFAULT_SUMMARY_SETTINGS,
  getOrBuildSummary,
  memoryCache,
  planCacheKey,
  planSummary,
  SummaryError,
  type SummaryCache,
} from "./summary";

const migrations = new URL("../migrations/", import.meta.url);
let db: AnyDb;
let pg: PGlite;
const ids: Record<string, string> = {};
let seriesId = "";
let readerId = "";

async function q<T>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pg.query<T>(text, params)).rows;
}

const PASSAGES: Record<string, string> = {
  ash0: "The old Emperor Kellanved walked the empty halls of the palace.",
  ash1: "Smoke rose above the blue fires of Darujhistan.",
  ash2: "Shadowthrone sat upon a throne of shadow and laughed at the hounds.",
  brine0: "Whiskeyjack counted what was left of his squad.",
  brine1: "Shadowthrone whispered to the Rope.",
  brine2: "And so it was shown that Shadowthrone had been Kellanved all along.",
  cinder0: "Ammanas stirred in the Shadow Realm.",
  cinder1: "Dragnipur's chains dragged behind the wagon.",
  draft0: "The Bridgeburners marched.",
};

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pg_trgm, fuzzystrmatch } });
  const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", migrations), "utf8")) as { entries: { tag: string }[] };
  for (const { tag } of journal.entries) {
    const file = readFileSync(new URL(`${tag}.sql`, migrations), "utf8");
    for (const statement of file.split("--> statement-breakpoint")) if (statement.trim()) await pg.exec(statement);
  }
  db = drizzle({ client: pg, schema });

  seriesId = (await q<{ id: string }>("insert into series (slug, name, status) values ('lantern', 'Lantern', 'published') returning id"))[0]!.id;
  readerId = (await q<{ id: string }>("insert into readers (email) values ('r@example.com') returning id"))[0]!.id;
  const books: [string, number, string][] = [["ash", 3, "published"], ["brine", 3, "published"], ["cinder", 2, "published"], ["draft", 1, "draft"]];
  let created = 0;
  for (const [slug, chapters, status] of books) {
    const [book] = await q<{ id: string }>(
      "insert into books (series_id, slug, title, author, status, created_at) values ($1, $2, $3, 'Anon', $4, now() + $5 * interval '1 second') returning id",
      [seriesId, slug, slug[0]!.toUpperCase() + slug.slice(1), status, created++],
    );
    ids[slug] = book!.id;
    for (let i = 0; i < chapters; i++) {
      const [ch] = await q<{ id: string }>("insert into chapters (book_id, index, label) values ($1, $2, $3) returning id", [
        book!.id,
        i,
        `Chapter ${["One", "Two", "Three"][i]}`,
      ]);
      ids[`${slug}${i}`] = ch!.id;
      const [p] = await q<{ id: string }>("insert into passages (chapter_id, index, text) values ($1, 0, $2) returning id", [
        ch!.id,
        PASSAGES[`${slug}${i}`],
      ]);
      ids[`p:${slug}${i}`] = p!.id;
    }
  }
  // Four long Passages about Whiskeyjack in Ash, so Ash needs a Book Summary for him.
  for (let k = 1; k <= 4; k++) {
    const [p] = await q<{ id: string }>("insert into passages (chapter_id, index, text) values ($1, $2, $3) returning id", [
      ids[`ash${k % 3}`],
      k,
      `Whiskeyjack ${"marched and fought and worried about his squad ".repeat(60)}`,
    ]);
    ids[`p:wj${k}`] = p!.id;
  }

  const subject = async (key: string, name: string, kind: string, aliases: [string, string[], string?][]) => {
    const [s] = await q<{ id: string }>("insert into subjects (series_id, name, kind) values ($1, $2, $3) returning id", [seriesId, name, kind]);
    ids[key] = s!.id;
    for (const [alias, passages, reveal] of aliases) {
      const [a] = await q<{ id: string }>("insert into aliases (subject_id, name, reveal_chapter_id) values ($1, $2, $3) returning id", [
        s!.id,
        alias,
        reveal ? ids[reveal] : null,
      ]);
      ids[`alias:${alias}`] = a!.id;
      for (const p of passages) {
        await pg.query("insert into mentions (passage_id, alias_id, subject_id) values ($1, $2, $3)", [ids[`p:${p}`], a!.id, s!.id]);
      }
    }
  };
  await subject("kellanved", "Kellanved", "character", [
    ["Kellanved", ["ash0", "brine2"]],
    ["Shadowthrone", ["ash2", "brine1", "brine2"], "brine2"],
    ["Ammanas", ["cinder0"], "cinder1"],
  ]);
  await subject("daru", "Darujhistan", "place", [["Darujhistan", ["ash1"]]]);
  await subject("dragnipur", "Dragnipur", "artefact", [["Dragnipur", ["cinder1"]]]);
  await subject("wj", "Whiskeyjack", "character", [["Whiskeyjack", ["wj1", "wj2", "wj3", "wj4", "brine0"]]]);
  await subject("bb", "Bridgeburners", "faction", [["Bridgeburners", ["draft0"]]]);

  await pg.query(
    "insert into book_summaries (subject_id, book_id, scope, text, model, prompt_version) values ($1, $2, '', $3, 'm', '1')",
    [ids.kellanved, ids.ash, "Kellanved, who is also Shadowthrone, leaves the palace."],
  );
});

beforeEach(async () => {
  await pg.exec("delete from spend_log");
});

const at = (book: string, chapter: number, finished: string[] = []): SpoilerBoundary => ({
  finishedBookIds: finished.map((f) => ids[f]!),
  position: { bookId: ids[book]!, lastFinishedChapterIndex: chapter },
});

const target = async (boundary: SpoilerBoundary, ref: TargetRef) => {
  const [t] = await resolveTargets(db, seriesId, boundary, [ref]);
  if (!t) throw new Error("not visible");
  return t;
};
const subjectRef = (key: string): TargetRef => ({ type: "subject", id: ids[key]! });
const aliasRef = (name: string): TargetRef => ({ type: "alias", id: ids[`alias:${name}`]! });

/** A fake model: records every request and answers from `answer`. */
function fakeModel(answer: (req: ChatJsonRequest<never>, sourceCount: number) => SummaryReply) {
  const calls: { schemaName: string; user: string }[] = [];
  const chatJson = (async (req: ChatJsonRequest<never>) => {
    calls.push({ schemaName: req.schemaName, user: req.user });
    const usage = { model: req.model, promptTokens: 100, completionTokens: 50, reasoningTokens: 0, costUsd: 0.01 };
    if (req.schemaName === "book_summary") return { data: { summary: "Whiskeyjack leads a worried squad [Chapter Two]." }, usage };
    const count = (req.user.match(/^\[\d+\] /gm) ?? []).length;
    return { data: answer(req, count), usage };
  }) as unknown as ChatJson;
  return { chatJson, calls };
}
const citeAll = (_: unknown, count: number): SummaryReply => ({
  paragraphs: [{ sentences: [{ text: "A sentence from the sources.", sources: Array.from({ length: count }, (_, i) => i + 1) }] }],
});

async function build(boundary: SpoilerBoundary, ref: TargetRef, model = fakeModel(citeAll), cache: SummaryCache = memoryCache()) {
  const entry = await getOrBuildSummary({
    db,
    chatJson: model.chatJson,
    cache,
    seriesId,
    boundary,
    readerId,
    target: await target(boundary, ref),
    settings: DEFAULT_SUMMARY_SETTINGS,
  });
  return { entry, calls: model.calls, prompt: model.calls.find((c) => c.schemaName === "summary")?.user ?? "" };
}

describe("the boundary query", () => {
  it("never hands the model text past the Reading Position", async () => {
    const { prompt } = await build(at("ash", 0), subjectRef("kellanved"));
    expect(prompt).toContain("old Emperor");
    expect(prompt).not.toContain("throne of shadow");
    expect(prompt).not.toMatch(/Shadowthrone|Ammanas|Rope|all along/);
  });

  it("leaves out Passages under an Alias whose Reveal is outside the boundary, even in Finished Books", async () => {
    // Finished Ash, reading Brine: Shadowthrone is visible but not yet joined to Kellanved.
    const { prompt, entry } = await build(at("brine", 0, ["ash"]), subjectRef("kellanved"));
    expect(prompt).toContain("old Emperor");
    expect(prompt).not.toMatch(/Shadowthrone|throne of shadow/);
    // Ingestion's Book Summary of Ash was written from both names, so it must not be used here.
    expect(prompt).not.toContain("who is also");
    expect(entry.basis.bookSummaries).toEqual([]);
  });

  it("uses Ingestion's Book Summary once the Reveal is inside the boundary", async () => {
    const { prompt, entry } = await build(at("cinder", 0, ["ash", "brine"]), subjectRef("kellanved"));
    expect(prompt).toContain("Book Summary of Ash");
    expect(prompt).toContain("who is also Shadowthrone");
    expect(entry.basis.bookSummaries).toEqual(["Ash"]);
    // Ammanas is mentioned in Cinder 0 but its Reveal (Cinder 1) is still ahead.
    expect(prompt).not.toContain("Ammanas");
  });

  it("builds an unrevealed Alias from its own Mentions only", async () => {
    const { prompt } = await build(at("brine", 1, ["ash"]), aliasRef("Shadowthrone"));
    expect(prompt).toContain("throne of shadow");
    expect(prompt).toContain("whispered to the Rope");
    expect(prompt).not.toMatch(/Kellanved|old Emperor|who is also/);
  });

  it("finds nothing in Draft Books", async () => {
    const t = { ref: `s-${ids.bb}`, name: "Bridgeburners", kind: "faction" as const, otherNames: [] };
    expect(await planSummary(db, at("ash", 2, ["draft"]), t)).toBeNull();
  });
});

describe("the layered build", () => {
  it("writes a missing Book Summary for a big Finished Book once, then reuses it", async () => {
    const first = await build(at("brine", 0, ["ash"]), subjectRef("wj"));
    expect(first.calls.map((c) => c.schemaName)).toEqual(["book_summary", "summary"]);
    expect(first.prompt).toContain("Book Summary of Ash");
    expect(first.prompt).toContain("Whiskeyjack counted");
    const stored = await q<{ scope: string }>("select scope from book_summaries where subject_id = $1", [ids.wj]);
    expect(stored).toEqual([{ scope: "" }]);

    const second = await build(at("brine", 0, ["ash"]), subjectRef("wj"));
    expect(second.calls.map((c) => c.schemaName)).toEqual(["summary"]);
  });

  it("logs every call's spend against the Reader", async () => {
    await build(at("brine", 0, ["ash"]), subjectRef("daru"));
    const spend = await q<{ purpose: string; reader_id: string }>("select purpose, reader_id from spend_log");
    expect(spend).toEqual([{ purpose: "summary", reader_id: readerId }]);
  });
});

describe("the citation check", () => {
  it("keeps only cited sentences that name nobody the Reader hasn't reached", async () => {
    const model = fakeModel(() => ({
      paragraphs: [
        {
          sentences: [
            { text: "Kellanved walks the palace.", sources: [1] },
            { text: "Nobody says so.", sources: [] },
            { text: "A made-up source says so.", sources: [9] },
            { text: "Kellanved is Shadowthrone.", sources: [1] },
            { text: "He will one day carry Dragnipur.", sources: [1] },
          ],
        },
      ],
    }));
    const { entry } = await build(at("ash", 2), subjectRef("kellanved"), model);
    expect(entry.paragraphs.flat().map((s) => s.text)).toEqual(["Kellanved walks the palace."]);
    expect(entry.dropped).toBe(4);
    expect(entry.sources.map((s) => s.chip)).toEqual(["Ch 1"]);
  });

  it("refuses to cache a reply with nothing left after the check", async () => {
    const cache = memoryCache();
    const model = fakeModel(() => ({ paragraphs: [{ sentences: [{ text: "Uncited.", sources: [] }] }] }));
    await expect(build(at("ash", 2), subjectRef("daru"), model, cache)).rejects.toMatchObject({ code: "empty-after-check" });
    expect([...cache.store.keys()]).toEqual([]);
  });
});

describe("caching and caps", () => {
  it("shares a Summary between Readers whose boundaries show the same Mentions", async () => {
    const cache = memoryCache();
    const first = await build(at("brine", 0, ["ash"]), subjectRef("daru"), fakeModel(citeAll), cache);
    // Further on, and with another Finished Book that never mentions Darujhistan: same Mentions, same key.
    const second = await build(at("brine", 2, ["ash", "cinder"]), subjectRef("daru"), fakeModel(citeAll), cache);
    expect(second.calls).toEqual([]);
    expect(second.entry.key).toBe(first.entry.key);
  });

  it("does not share across a Reveal", async () => {
    const before = await planSummary(db, at("brine", 1, ["ash"]), await target(at("brine", 1, ["ash"]), subjectRef("kellanved")));
    const after = await planSummary(db, at("brine", 2, ["ash"]), await target(at("brine", 2, ["ash"]), subjectRef("kellanved")));
    expect(planCacheKey(before!, "m")).not.toBe(planCacheKey(after!, "m"));
  });

  it("refuses an uncached lookup past the Reader's daily cap, but still serves cached ones", async () => {
    const cache = memoryCache();
    await build(at("ash", 2), subjectRef("daru"), fakeModel(citeAll), cache);
    await pg.query("insert into spend_log (purpose, reader_id, model, prompt_tokens, completion_tokens, cost_usd) values ('summary', $1, 'm', 0, 0, 0.3)", [readerId]);
    const hit = await build(at("ash", 2), subjectRef("daru"), fakeModel(citeAll), cache);
    expect(hit.calls).toEqual([]);
    const miss = build(at("ash", 2), subjectRef("kellanved"), fakeModel(citeAll), cache);
    await expect(miss).rejects.toBeInstanceOf(SummaryError);
    await expect(miss).rejects.toMatchObject({ code: "reader-cap" });
    await pg.query("insert into spend_log (purpose, reader_id, model, prompt_tokens, completion_tokens, cost_usd) values ('summary', $1, 'm', 0, 0, 1)", [readerId]);
    await expect(build(at("ash", 2), subjectRef("kellanved"), fakeModel(citeAll), cache)).rejects.toMatchObject({ code: "global-cap" });
  });

  it("does not count Ingestion's spend against Readers", async () => {
    await pg.query("insert into spend_log (purpose, model, prompt_tokens, completion_tokens, cost_usd) values ('book_summary', 'm', 0, 0, 50)");
    await expect(build(at("ash", 2), subjectRef("daru"))).resolves.toBeTruthy();
  });
});
