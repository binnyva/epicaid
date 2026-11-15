/**
 * Reader-side queries. Every query that touches book data takes a Spoiler Boundary and
 * filters on it in SQL, so nothing outside the boundary ever leaves the database
 * (build plan principle 1). Draft Books never count as visible.
 *
 * The functions take any Drizzle Postgres database, so the web app runs them over Neon HTTP
 * and the tests run them against an in-process Postgres.
 */
import { canonicalBoundary, type SpoilerBoundary } from "@epicaid/core";
import { sql, type SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema> | PgDatabase<any, any>;

export type SubjectKind = "character" | "place" | "artefact" | "faction" | "other";

async function rows<T>(db: AnyDb, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

const uuidList = (ids: readonly string[]) => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);

/**
 * SQL condition: the Chapter aliased `c` (in the published Book aliased `b`) is inside the boundary.
 * Mirrors isChapterVisible in @epicaid/core.
 */
export function chapterInBoundary(boundary: SpoilerBoundary, c = "c", b = "b"): SQL {
  const { finishedBookIds, position } = canonicalBoundary(boundary);
  const ch = sql.raw(c);
  const parts: SQL[] = [];
  if (finishedBookIds.length) parts.push(sql`${ch}.book_id in (${uuidList(finishedBookIds)})`);
  if (position) {
    parts.push(sql`(${ch}.book_id = ${position.bookId}::uuid and ${ch}.index <= ${position.lastFinishedChapterIndex})`);
  }
  if (!parts.length) return sql`false`;
  return sql`(${sql.raw(b)}.status = 'published' and (${sql.join(parts, sql` or `)}))`;
}

/** SQL condition: the Alias aliased `a` is mentioned somewhere inside the boundary (ADR 0001). */
function aliasVisible(boundary: SpoilerBoundary, a = "a"): SQL {
  return sql`exists (
    select 1 from mentions vm
    join passages vp on vp.id = vm.passage_id
    join chapters vc on vc.id = vp.chapter_id
    join books vb on vb.id = vc.book_id
    where vm.alias_id = ${sql.raw(a)}.id and ${chapterInBoundary(boundary, "vc", "vb")}
  )`;
}

/** SQL condition: the Alias aliased `a` is joined to its Subject: no Reveal, or a Reveal inside the boundary (ADR 0005). */
function aliasJoined(boundary: SpoilerBoundary, a = "a"): SQL {
  return sql`(${sql.raw(a)}.reveal_chapter_id is null or exists (
    select 1 from chapters rc join books rb on rb.id = rc.book_id
    where rc.id = ${sql.raw(a)}.reveal_chapter_id and ${chapterInBoundary(boundary, "rc", "rb")}
  ))`;
}

// ---------- Lookup targets ----------

/**
 * What a Reader can look up: a Subject, or an Alias whose Reveal is still outside the
 * boundary and so stands as a Subject of its own (ADR 0005). Encoded in URLs as `s-<id>` or `a-<id>`.
 */
export type TargetRef = { type: "subject"; id: string } | { type: "alias"; id: string };

export const refToString = (ref: TargetRef) => `${ref.type === "subject" ? "s" : "a"}-${ref.id}`;

export function parseRef(value: string): TargetRef | null {
  const match = /^([sa])-(.+)$/.exec(value);
  if (!match || !isUuid(match[2]!)) return null;
  return { type: match[1] === "s" ? "subject" : "alias", id: match[2]!.toLowerCase() };
}

export interface LookupTarget {
  ref: string;
  /** The name to show: always a visible Alias, never the catalogue name unless that is visible too. */
  name: string;
  kind: SubjectKind;
  /** The Subject's other visible, joined names. Empty for a standalone Alias. */
  otherNames: string[];
}

interface VisibleAliasRow {
  id: string;
  name: string;
  subject_id: string;
  subject_name: string;
  kind: SubjectKind;
  mentions: number;
}

/**
 * Picks the name a Subject is shown by: its catalogue name if that is one of the visible
 * joined Aliases, otherwise the visible joined Alias with the most Mentions inside the boundary.
 */
export function pickDisplayName(subjectName: string, visible: readonly { name: string; mentions: number }[]): string | null {
  if (!visible.length) return null;
  if (visible.some((a) => a.name === subjectName)) return subjectName;
  return [...visible].sort((x, y) => y.mentions - x.mentions || x.name.localeCompare(y.name))[0]!.name;
}

/**
 * Resolves refs to what the Reader may see of them under this boundary, in the given order.
 * A ref that is not visible resolves to nothing, and an Alias ref whose Reveal is now inside
 * the boundary resolves to its Subject. Duplicates are dropped.
 */
export async function resolveTargets(
  db: AnyDb,
  seriesId: string,
  boundary: SpoilerBoundary,
  refs: readonly TargetRef[],
): Promise<LookupTarget[]> {
  const aliasIds = [...new Set(refs.filter((r) => r.type === "alias").map((r) => r.id))];
  const aliasRows = aliasIds.length
    ? await rows<{ id: string; name: string; subject_id: string; kind: SubjectKind; visible: boolean; joined: boolean }>(
        db,
        sql`select a.id, a.name, a.subject_id, s.kind, ${aliasVisible(boundary)} as visible, ${aliasJoined(boundary)} as joined
            from aliases a join subjects s on s.id = a.subject_id
            where a.id in (${uuidList(aliasIds)}) and s.series_id = ${seriesId}::uuid`,
      )
    : [];
  const aliasById = new Map(aliasRows.map((a) => [a.id, a]));

  // Alias refs that are now joined become Subject refs.
  const effective: TargetRef[] = refs.map((r) => {
    if (r.type !== "alias") return r;
    const a = aliasById.get(r.id);
    return a?.joined ? { type: "subject", id: a.subject_id } : r;
  });

  const subjectIds = [...new Set(effective.filter((r) => r.type === "subject").map((r) => r.id))];
  const visibleRows = subjectIds.length
    ? await rows<VisibleAliasRow>(
        db,
        sql`select a.id, a.name, a.subject_id, s.name as subject_name, s.kind,
              (select count(*)::int from mentions vm
                 join passages vp on vp.id = vm.passage_id
                 join chapters vc on vc.id = vp.chapter_id
                 join books vb on vb.id = vc.book_id
               where vm.alias_id = a.id and ${chapterInBoundary(boundary, "vc", "vb")}) as mentions
            from aliases a join subjects s on s.id = a.subject_id
            where a.subject_id in (${uuidList(subjectIds)}) and s.series_id = ${seriesId}::uuid
              and ${aliasJoined(boundary)}`,
      )
    : [];
  const bySubject = new Map<string, VisibleAliasRow[]>();
  for (const row of visibleRows) {
    if (row.mentions <= 0) continue;
    const list = bySubject.get(row.subject_id) ?? [];
    list.push(row);
    bySubject.set(row.subject_id, list);
  }

  const out: LookupTarget[] = [];
  const seen = new Set<string>();
  for (const r of effective) {
    const key = refToString(r);
    if (seen.has(key)) continue;
    if (r.type === "alias") {
      const a = aliasById.get(r.id);
      if (!a?.visible) continue;
      seen.add(key);
      out.push({ ref: key, name: a.name, kind: a.kind, otherNames: [] });
    } else {
      const visible = bySubject.get(r.id) ?? [];
      const name = pickDisplayName(visible[0]?.subject_name ?? "", visible);
      if (!name) continue;
      seen.add(key);
      const otherNames = visible
        .filter((a) => a.name !== name)
        .sort((x, y) => y.mentions - x.mentions || x.name.localeCompare(y.name))
        .map((a) => a.name);
      out.push({ ref: key, name, kind: visible[0]!.kind, otherNames });
    }
  }
  return out;
}

// ---------- Subject search ----------

export interface SearchResult extends LookupTarget {
  /** The visible Alias the query matched, when it differs from the name shown. */
  matched: string | null;
}

export interface SearchInput {
  seriesId: string;
  boundary: SpoilerBoundary;
  query: string;
  kind?: SubjectKind | null;
  limit?: number;
}

/** Fold case and accents and squeeze spaces, so "anomandér  rake" matches "Anomander Rake". */
export const normaliseQuery = (q: string) =>
  q.normalize("NFKD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim();

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Fuzzy Subject search (ADR 0001): substring, trigram and Double Metaphone matching on
 * Aliases, limited to Aliases mentioned inside the boundary. A name that appears only
 * outside the boundary matches nothing, so the Reader sees "No match", never "not yet".
 */
export async function searchSubjects(db: AnyDb, input: SearchInput): Promise<SearchResult[]> {
  const q = normaliseQuery(input.query);
  if (q.length < 2) return [];
  const limit = input.limit ?? 8;
  const like = `%${escapeLike(q)}%`;
  const kind = input.kind ? sql`and s.kind = ${input.kind}` : sql``;
  const prefix = `${escapeLike(q)}%`;
  const soundsLike = sql`(dmetaphone(a.name) = dmetaphone(${q}) or exists (
    select 1 from regexp_split_to_table(a.name, '[\\s-]+') w
    where w <> '' and dmetaphone(w) <> '' and dmetaphone(w) = dmetaphone(${q})
  ))`;
  const matches = await rows<{ id: string; name: string; subject_id: string; joined: boolean; score: number }>(
    db,
    sql`select a.id, a.name, a.subject_id, ${aliasJoined(input.boundary)} as joined,
          greatest(
            similarity(a.name, ${q}),
            word_similarity(${q}, a.name),
            case when a.name ilike ${prefix} then 1 when a.name ilike ${like} then 0.9 else 0 end,
            case when ${soundsLike} then 0.6 else 0 end
          )::float as score
        from aliases a
        join subjects s on s.id = a.subject_id
        where s.series_id = ${input.seriesId}::uuid ${kind}
          and (
            a.name ilike ${like}
            or similarity(a.name, ${q}) > 0.3
            or word_similarity(${q}, a.name) > 0.45
            or ${soundsLike}
          )
          and ${aliasVisible(input.boundary)}
        order by score desc, length(a.name), a.name
        limit ${limit * 4}`,
  );

  const refs: TargetRef[] = matches.map((m) =>
    m.joined ? { type: "subject", id: m.subject_id } : { type: "alias", id: m.id },
  );
  const targets = await resolveTargets(db, input.seriesId, input.boundary, refs);
  const byRef = new Map(targets.map((t) => [t.ref, t]));
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  matches.forEach((m, i) => {
    const t = byRef.get(refToString(refs[i]!));
    if (!t || seen.has(t.ref)) return;
    seen.add(t.ref);
    out.push({ ...t, matched: m.name === t.name ? null : m.name });
  });
  return out.slice(0, limit);
}

// ---------- Quote Search ----------

export interface ChapterHit {
  index: number;
  label: string;
  title: string | null;
}

export const QUOTE_MIN_WORDS = 4;
export const wordCount = (q: string) => normaliseQuery(q).split(" ").filter(Boolean).length;

/**
 * Quote Search: finds Chapters of one published Book whose text contains something close
 * to the quote. Returns Chapter numbers and titles only, never text. Needs four or more words.
 */
export async function quoteSearch(db: AnyDb, bookId: string, quote: string, limit = 5): Promise<ChapterHit[]> {
  const q = normaliseQuery(quote).replace(/[“”"‘’'`.,;:!?()\-–—]/g, " ").replace(/\s+/g, " ").trim();
  if (wordCount(q) < QUOTE_MIN_WORDS || !isUuid(bookId)) return [];
  // Forgiving: trigrams ignore case and punctuation, and a misheard word or two still
  // leaves the passage similar enough.
  return rows<ChapterHit>(
    db,
    sql`select c.index, c.label, c.title
        from chapters c
        join books b on b.id = c.book_id and b.status = 'published'
        join lateral (
          select max(word_similarity(${q}, p.text)) as score from passages p where p.chapter_id = c.id
        ) hits on true
        where c.book_id = ${bookId}::uuid and hits.score >= 0.6
        order by hits.score desc, c.index
        limit ${limit}`,
  );
}

// ---------- Lookup History ----------

export const HISTORY_KEEP = 20;

/** Records a lookup at the top of the Reading's Lookup History and trims it to the newest 20. */
export async function recordLookup(db: AnyDb, readingId: string, target: LookupTarget): Promise<void> {
  const ref = parseRef(target.ref);
  if (!ref) return;
  const subjectId =
    ref.type === "subject"
      ? ref.id
      : (await rows<{ subject_id: string }>(db, sql`select subject_id from aliases where id = ${ref.id}::uuid`))[0]?.subject_id;
  if (!subjectId) return;
  const aliasId = ref.type === "alias" ? ref.id : null;
  await db.execute(sql`delete from lookup_history where reading_id = ${readingId}::uuid and subject_id = ${subjectId}::uuid
    and alias_id is not distinct from ${aliasId}::uuid`);
  await db.execute(sql`insert into lookup_history (reading_id, subject_id, alias_id) values (${readingId}::uuid, ${subjectId}::uuid, ${aliasId}::uuid)`);
  await db.execute(sql`delete from lookup_history where reading_id = ${readingId}::uuid and id not in (
    select id from lookup_history where reading_id = ${readingId}::uuid order by looked_up_at desc, id limit ${HISTORY_KEEP})`);
}

/**
 * The Reading's Lookup History, newest first, each entry re-checked against the current
 * boundary. Entries the Reader can no longer see (after moving backwards) are left out.
 */
export async function lookupHistory(
  db: AnyDb,
  readingId: string,
  seriesId: string,
  boundary: SpoilerBoundary,
  limit = 9,
): Promise<LookupTarget[]> {
  const entries = await rows<{ subject_id: string; alias_id: string | null }>(
    db,
    sql`select subject_id, alias_id from lookup_history where reading_id = ${readingId}::uuid order by looked_up_at desc limit ${HISTORY_KEEP}`,
  );
  const refs: TargetRef[] = entries.map((e) =>
    e.alias_id ? { type: "alias", id: e.alias_id } : { type: "subject", id: e.subject_id },
  );
  return (await resolveTargets(db, seriesId, boundary, refs)).slice(0, limit);
}
