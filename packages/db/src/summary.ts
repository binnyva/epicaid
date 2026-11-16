/**
 * Summaries (ADR 0003): the boundary query that gathers what a Summary may be built from, the layered build
 * from Book Summaries plus current-Book Passages, the citation check, caching and the spend caps.
 *
 * Every query here filters on the Spoiler Boundary in SQL, so the model is never handed text from outside it
 * (build plan principle 1). The model, cache and spend log are passed in, so tests run it all against an
 * in-process Postgres with a fake model.
 */
import {
  BOOK_SUMMARY_PROMPT_VERSION,
  canonicalBoundary,
  type ChatJson,
  checkCitations,
  LlmError,
  type LlmUsage,
  nameCandidates,
  type ReasoningEffort,
  REASONING_EFFORTS,
  samplePassages,
  SUMMARY_PROMPT_VERSION,
  SUMMARY_SYSTEM,
  summaryCacheKey,
  summaryMaxTokens,
  summarySchema,
  summaryUserPrompt,
  type SpoilerBoundary,
  type SummarySource,
  writeBookSummary,
} from "@epicaid/core";
import { sql, type SQL } from "drizzle-orm";
import { chapterInBoundary, parseRef, type AnyDb, type LookupTarget } from "./reader";

async function rows<T>(db: AnyDb, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}
const uuidList = (ids: readonly string[]) => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);

// ---------- Settings ----------

export interface SummarySettings {
  /** OpenRouter model for Summaries and for Book Summaries written on demand. */
  model: string;
  /** Reasoning for the Summary itself: it only rewrites short sources it is given, so off by default. */
  reasoning: ReasoningEffort;
  /** Reasoning for Book Summaries written on demand; "low" matches Ingestion. */
  bookSummaryReasoning: ReasoningEffort;
  /** What one Reader's uncached lookups may spend per UTC day. */
  readerDailyUsd: number;
  /** What all Readers' uncached lookups together may spend per UTC day. Ingestion is not counted. */
  globalDailyUsd: number;
}

export const DEFAULT_SUMMARY_SETTINGS: SummarySettings = {
  model: "deepseek/deepseek-v4-flash-0731",
  reasoning: "none",
  bookSummaryReasoning: "low",
  readerDailyUsd: 0.25,
  globalDailyUsd: 1,
};

const SETTINGS_KEY = "summaries";

export function parseSummarySettings(value: unknown): SummarySettings {
  const v = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof SummarySettings, unknown>>;
  const effort = (x: unknown, fallback: ReasoningEffort) =>
    typeof x === "string" && (REASONING_EFFORTS as readonly string[]).includes(x) ? (x as ReasoningEffort) : fallback;
  const usd = (x: unknown, fallback: number) => {
    const n = typeof x === "string" ? Number(x) : x;
    return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const d = DEFAULT_SUMMARY_SETTINGS;
  return {
    model: typeof v.model === "string" && v.model.trim() ? v.model.trim() : d.model,
    reasoning: effort(v.reasoning, d.reasoning),
    bookSummaryReasoning: effort(v.bookSummaryReasoning, d.bookSummaryReasoning),
    readerDailyUsd: usd(v.readerDailyUsd, d.readerDailyUsd),
    globalDailyUsd: usd(v.globalDailyUsd, d.globalDailyUsd),
  };
}

export async function getSummarySettings(db: AnyDb): Promise<SummarySettings> {
  const [row] = await rows<{ value: unknown }>(db, sql`select value from settings where key = ${SETTINGS_KEY}`);
  return parseSummarySettings(row?.value);
}

export async function saveSummarySettings(db: AnyDb, settings: SummarySettings): Promise<void> {
  const value = JSON.stringify(parseSummarySettings(settings));
  await db.execute(sql`insert into settings (key, value) values (${SETTINGS_KEY}, ${value}::jsonb)
    on conflict (key) do update set value = excluded.value`);
}

// ---------- Spend ----------

export interface SpendToday {
  reader: number;
  global: number;
}

/** What the reader app has spent today (UTC). Rows with no Reader are Ingestion's and don't count. */
export async function spendToday(db: AnyDb, readerId: string): Promise<SpendToday> {
  const [row] = await rows<{ reader: string | null; global: string | null }>(
    db,
    sql`select coalesce(sum(cost_usd) filter (where reader_id = ${readerId}::uuid), 0) as reader,
               coalesce(sum(cost_usd), 0) as global
        from spend_log
        where reader_id is not null and occurred_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`,
  );
  return { reader: Number(row?.reader ?? 0), global: Number(row?.global ?? 0) };
}

export async function recordSpend(
  db: AnyDb,
  purpose: "summary" | "book_summary",
  readerId: string,
  usage: LlmUsage,
): Promise<void> {
  await db.execute(sql`insert into spend_log (purpose, reader_id, model, prompt_tokens, completion_tokens, cost_usd)
    values (${purpose}, ${readerId}::uuid, ${usage.model}, ${usage.promptTokens}, ${usage.completionTokens}, ${usage.costUsd.toFixed(6)})`);
}

// ---------- The boundary query ----------

interface MentionedPassage {
  id: string;
  book_id: string;
  book_title: string;
  chapter_index: number;
  chapter_label: string;
  passage_index: number;
  words: number;
}

interface PlannedPassage {
  id: string;
  chapterIndex: number;
  chapterLabel: string;
  words: number;
}

export interface FinishedBookPlan {
  bookId: string;
  title: string;
  /** Which Aliases a Book Summary for this Book must be written from: "" for all of them (see schema). */
  scope: string;
  /** Names of the Aliases in scope that the Book mentions, for the Book Summary prompt. */
  aliasNames: string[];
  bookSummary: { text: string; model: string } | null;
  passages: PlannedPassage[];
}

export interface SummaryPlan {
  ref: string;
  subjectId: string;
  /** The name the Reader looked up, and the Subject's other joined names. */
  name: string;
  otherNames: string[];
  /** The Aliases whose Mentions the Summary is built from. */
  aliasIds: string[];
  /**
   * Names that must not appear in the Summary: this Subject's Aliases that are not joined under the boundary
   * (ADR 0005). The citation check adds any catalogue name the Reader has not reached.
   */
  forbiddenNames: string[];
  /** Finished Books that mention the Subject, in Series order. */
  finished: FinishedBookPlan[];
  /** The current Book's Passages that mention the Subject, up to the Reading Position. */
  current: { bookId: string; title: string; passages: PlannedPassage[]; lastMentionChapterIndex: number } | null;
}

/**
 * The boundary query: everything a Summary of this lookup target may be built from. Only Mentions under
 * Aliases joined to the Subject inside the boundary count, so a lookup never pulls in Passages that use
 * an unrevealed secret identity (ADR 0005). Returns null when the target has no Mention inside the boundary.
 */
export async function planSummary(
  db: AnyDb,
  boundary: SpoilerBoundary,
  target: LookupTarget,
  options: { promptVersion?: string } = {},
): Promise<SummaryPlan | null> {
  const ref = parseRef(target.ref);
  if (!ref) return null;
  const canonical = canonicalBoundary(boundary);

  type AliasRow = { id: string; name: string; subject_id: string; joined: boolean };
  const subjectAliases = await rows<AliasRow>(
    db,
    sql`select a.id, a.name, a.subject_id, (a.reveal_chapter_id is null or exists (
          select 1 from chapters rc join books rb on rb.id = rc.book_id
          where rc.id = a.reveal_chapter_id and ${chapterInBoundary(canonical, "rc", "rb")})) as joined
        from aliases a
        where a.subject_id = ${ref.type === "subject" ? sql`${ref.id}::uuid` : sql`(select subject_id from aliases where id = ${ref.id}::uuid)`}`,
  );
  const scope =
    ref.type === "subject" ? subjectAliases.filter((a) => a.joined) : subjectAliases.filter((a) => a.id === ref.id);
  if (!scope.length) return null;
  const subjectId = scope[0]!.subject_id;
  const scopeIds = scope.map((a) => a.id).sort();
  const scopeNames = new Set(scope.map((a) => a.name.toLowerCase()));
  const forbiddenNames = [
    ...new Set(subjectAliases.filter((a) => !scopeIds.includes(a.id) && !scopeNames.has(a.name.toLowerCase())).map((a) => a.name)),
  ];

  const mentioned = await rows<MentionedPassage>(
    db,
    sql`select distinct p.id, b.id as book_id, b.title as book_title, b.created_at, c.index as chapter_index,
          c.label as chapter_label, p.index as passage_index,
          coalesce(array_length(regexp_split_to_array(btrim(p.text), '\\s+'), 1), 0) as words
        from mentions m
        join passages p on p.id = m.passage_id
        join chapters c on c.id = p.chapter_id
        join books b on b.id = c.book_id
        where m.alias_id in (${uuidList(scopeIds)}) and ${chapterInBoundary(canonical, "c", "b")}
        order by b.created_at, c.index, p.index`,
  );
  if (!mentioned.length) return null;

  const toPassage = (m: MentionedPassage): PlannedPassage => ({
    id: m.id,
    chapterIndex: m.chapter_index,
    chapterLabel: m.chapter_label,
    words: Number(m.words),
  });
  const currentBookId = canonical.position?.bookId ?? null;
  const byBook = new Map<string, MentionedPassage[]>();
  for (const m of mentioned) byBook.set(m.book_id, [...(byBook.get(m.book_id) ?? []), m]);

  const finishedIds = [...byBook.keys()].filter((id) => id !== currentBookId);
  // Every Alias of the Subject each finished Book mentions, to tell whether Ingestion's Book Summary (written
  // from all of them) is safe here, or a narrower one is needed.
  const bookAliases = finishedIds.length
    ? await rows<{ book_id: string; alias_id: string }>(
        db,
        sql`select distinct c.book_id, m.alias_id from mentions m
            join passages p on p.id = m.passage_id join chapters c on c.id = p.chapter_id
            where m.subject_id = ${subjectId}::uuid and c.book_id in (${uuidList(finishedIds)})`,
      )
    : [];
  const promptVersion = options.promptVersion ?? BOOK_SUMMARY_PROMPT_VERSION;
  const nameById = new Map(subjectAliases.map((a) => [a.id, a.name]));

  const finished: FinishedBookPlan[] = [];
  for (const bookId of finishedIds) {
    const inBook = bookAliases.filter((r) => r.book_id === bookId).map((r) => r.alias_id);
    const used = inBook.filter((id) => scopeIds.includes(id)).sort();
    const bookScope = inBook.every((id) => scopeIds.includes(id)) ? "" : used.join(",");
    // Prefer the current prompt version, then the newest; several models may have written one.
    const [summary] = await rows<{ text: string; model: string }>(
      db,
      sql`select text, model from book_summaries
          where subject_id = ${subjectId}::uuid and book_id = ${bookId}::uuid and scope = ${bookScope}
          order by (prompt_version = ${promptVersion}) desc, created_at desc limit 1`,
    );
    const list = byBook.get(bookId)!;
    finished.push({
      bookId,
      title: list[0]!.book_title,
      scope: bookScope,
      aliasNames: used.map((id) => nameById.get(id)!).filter(Boolean),
      bookSummary: summary ?? null,
      passages: list.map(toPassage),
    });
  }

  const currentList = currentBookId ? byBook.get(currentBookId) : undefined;
  const current = currentList?.length
    ? {
        bookId: currentBookId!,
        title: currentList[0]!.book_title,
        passages: currentList.map(toPassage),
        lastMentionChapterIndex: Math.max(...currentList.map((m) => m.chapter_index)),
      }
    : null;

  return {
    ref: target.ref,
    subjectId,
    name: target.name,
    otherNames: target.otherNames,
    aliasIds: scopeIds,
    forbiddenNames,
    finished,
    current,
  };
}

/**
 * The cache key for a plan: shared by every Reader whose boundary shows the same Mentions of the target.
 * Finished Books that never mention it don't count, and the current Book only up to its last Mention.
 */
export function planCacheKey(plan: SummaryPlan, model: string, promptVersion = SUMMARY_PROMPT_VERSION): string {
  return summaryCacheKey({
    subjectId: plan.ref.startsWith("a-") ? plan.ref : plan.subjectId,
    aliasIds: plan.aliasIds,
    boundary: {
      finishedBookIds: plan.finished.map((b) => b.bookId),
      position: plan.current ? { bookId: plan.current.bookId, lastFinishedChapterIndex: plan.current.lastMentionChapterIndex } : null,
    },
    lastMentionChapterIndex: plan.current?.lastMentionChapterIndex ?? null,
    model,
    promptVersion,
  });
}

/**
 * Of the candidate names (lower-cased), which are catalogue names the Reader has not reached, and which are
 * names they have. A name counts as reached if any Alias of that name is mentioned inside the boundary.
 */
export async function classifyNames(
  db: AnyDb,
  seriesId: string,
  boundary: SpoilerBoundary,
  candidates: readonly string[],
): Promise<{ hidden: string[]; visible: string[] }> {
  if (!candidates.length) return { hidden: [], visible: [] };
  const found = await rows<{ name: string; visible: boolean }>(
    db,
    sql`select lower(a.name) as name, bool_or(exists (
          select 1 from mentions vm join passages vp on vp.id = vm.passage_id
          join chapters vc on vc.id = vp.chapter_id join books vb on vb.id = vc.book_id
          where vm.alias_id = a.id and ${chapterInBoundary(boundary, "vc", "vb")})) as visible
        from aliases a join subjects s on s.id = a.subject_id
        where s.series_id = ${seriesId}::uuid
          and lower(a.name) in (${sql.join(candidates.map((c) => sql`${c}`), sql`, `)})
        group by lower(a.name)`,
  );
  return { hidden: found.filter((f) => !f.visible).map((f) => f.name), visible: found.filter((f) => f.visible).map((f) => f.name) };
}

// ---------- The layered build ----------

/** A finished Book with at most this many words of Mentions goes in as Passages: cheaper than a Book Summary call. */
export const RAW_BOOK_MAX_WORDS = 1500;
/** Words of current-Book Passages one Summary call takes; more are sampled (ADR 0003). */
export const CURRENT_BOOK_MAX_WORDS = 6000;

export interface SummarySourceEntry {
  n: number;
  kind: "book-summary" | "passage";
  /** Short label for the citation chip: "Ch 3", or a Book title for a Book Summary. */
  chip: string;
  heading: string;
  text: string;
}

export interface SummaryEntry {
  key: string;
  ref: string;
  paragraphs: { text: string; sources: number[] }[][];
  /** Only the sources some kept sentence cites. */
  sources: SummarySourceEntry[];
  basis: {
    /** Finished Books used through their Book Summaries. */
    bookSummaries: string[];
    /** Finished Books used through their Passages. */
    passageBooks: string[];
    /** Current-Book Passages used, and the Chapters they span. */
    currentBook: string | null;
    currentPassages: number;
    currentPassagesAvailable: number;
    firstChapter: string | null;
    lastChapter: string | null;
  };
  dropped: number;
  model: string;
  createdAt: string;
}

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };

/** "Chapter Three" → "Ch 3", "Chapter 12" → "Ch 12", "Prologue" stays. */
export function chipLabel(chapterLabel: string): string {
  const m = /^chapter\s+(.+)$/i.exec(chapterLabel.trim());
  if (!m) return chapterLabel.trim();
  const rest = m[1]!.trim().toLowerCase();
  if (/^\d+$/.test(rest)) return `Ch ${rest}`;
  const parts = rest.split(/[\s-]+/);
  let n = 0;
  for (const p of parts) {
    if (TENS[p] !== undefined) n += TENS[p]!;
    else if (NUMBER_WORDS.indexOf(p) > 0) n += NUMBER_WORDS.indexOf(p);
    else return `Ch ${m[1]!.trim()}`;
  }
  return `Ch ${n}`;
}

export class SummaryError extends Error {
  constructor(
    message: string,
    readonly code: "nothing-to-summarise" | "empty-after-check" | "reader-cap" | "global-cap" | "llm",
  ) {
    super(message);
  }
}

export interface BuildDeps {
  db: AnyDb;
  chatJson: ChatJson;
  settings: SummarySettings;
  seriesId: string;
  boundary: SpoilerBoundary;
  onUsage: (purpose: "summary" | "book_summary", usage: LlmUsage) => Promise<void>;
  onProgress?: (text: string) => void;
}

async function passageTexts(db: AnyDb, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const found = await rows<{ id: string; text: string }>(db, sql`select id, text from passages where id in (${uuidList(ids)})`);
  return new Map(found.map((r) => [r.id, r.text]));
}

async function withUsage<T>(deps: BuildDeps, purpose: "summary" | "book_summary", run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    // Failed attempts are billed too.
    if (error instanceof LlmError && error.usage && (error.usage.costUsd > 0 || error.usage.completionTokens > 0)) {
      await deps.onUsage(purpose, error.usage);
    }
    throw error;
  }
}

/** Builds a Summary from a plan: writes missing Book Summaries, calls the model once, and checks citations. */
export async function buildSummary(deps: BuildDeps, plan: SummaryPlan, key: string): Promise<SummaryEntry> {
  const { db, settings } = deps;
  const sources: (SummarySource & Omit<SummarySourceEntry, "n" | "heading" | "text">)[] = [];
  const add = (s: Omit<SummarySourceEntry, "n">) => sources.push({ ...s, n: sources.length + 1 });

  // Finished Books: an existing Book Summary, the Passages themselves when there are few, or a new Book Summary.
  const toWrite = plan.finished.filter(
    (b) => !b.bookSummary && b.passages.reduce((n, p) => n + p.words, 0) > RAW_BOOK_MAX_WORDS,
  );
  const needText = plan.finished.filter((b) => !b.bookSummary).flatMap((b) => b.passages.map((p) => p.id));
  const current = plan.current ? samplePassages(plan.current.passages, CURRENT_BOOK_MAX_WORDS, (p) => p.words) : [];
  const texts = await passageTexts(db, [...needText, ...current.map((p) => p.id)]);

  if (toWrite.length) {
    deps.onProgress?.(`Writing Book Summaries for ${toWrite.map((b) => b.title).join(", ")}…`);
    await Promise.all(
      toWrite.map(async (book) => {
        const text = await withUsage(deps, "book_summary", () =>
          writeBookSummary({
            chatJson: deps.chatJson,
            model: settings.model,
            reasoning: settings.bookSummaryReasoning,
            subjectName: book.aliasNames.includes(plan.name) ? plan.name : (book.aliasNames[0] ?? plan.name),
            aliases: book.aliasNames,
            bookTitle: book.title,
            passages: book.passages.map((p) => ({ chapterLabel: p.chapterLabel, text: texts.get(p.id) ?? "" })),
            onUsage: (usage) => deps.onUsage("book_summary", usage),
          }),
        );
        await db.execute(sql`insert into book_summaries (subject_id, book_id, scope, text, model, prompt_version)
          values (${plan.subjectId}::uuid, ${book.bookId}::uuid, ${book.scope}, ${text}, ${settings.model}, ${BOOK_SUMMARY_PROMPT_VERSION})
          on conflict (subject_id, book_id, scope, model, prompt_version) do update set text = excluded.text, created_at = now()`);
        book.bookSummary = { text, model: settings.model };
      }),
    );
  }

  for (const book of plan.finished) {
    if (book.bookSummary) {
      add({ kind: "book-summary", chip: book.title, heading: `Book Summary of ${book.title}`, text: book.bookSummary.text });
    } else {
      for (const p of book.passages) {
        add({ kind: "passage", chip: chipLabel(p.chapterLabel), heading: `${book.title}, ${p.chapterLabel}`, text: texts.get(p.id) ?? "" });
      }
    }
  }
  for (const p of current) {
    add({ kind: "passage", chip: chipLabel(p.chapterLabel), heading: `${plan.current!.title}, ${p.chapterLabel}`, text: texts.get(p.id) ?? "" });
  }
  if (!sources.length) throw new SummaryError("Nothing inside the boundary to summarise", "nothing-to-summarise");

  deps.onProgress?.(`Reading ${sources.length} source${sources.length === 1 ? "" : "s"}…`);
  const lastCurrent = plan.current?.passages.at(-1);
  const { data } = await withUsage(deps, "summary", async () => {
    const result = await deps.chatJson({
      model: settings.model,
      system: SUMMARY_SYSTEM,
      user: summaryUserPrompt({
        subjectName: plan.name,
        otherNames: plan.otherNames,
        finishedBooks: plan.finished.map((b) => b.title),
        current: plan.current && lastCurrent ? { bookTitle: plan.current.title, through: lastCurrent.chapterLabel } : null,
        sources,
      }),
      schema: summarySchema,
      schemaName: "summary",
      reasoning: settings.reasoning,
      maxTokens: summaryMaxTokens(settings.reasoning),
    });
    await deps.onUsage("summary", result.usage);
    return result;
  });

  // The citation check, plus a name check: any catalogue name the Reader hasn't reached, and this Subject's
  // unjoined Aliases, are spoilers even in a cited sentence.
  const allText = data.paragraphs.flatMap((p) => p.sentences.map((s) => s.text)).join("\n");
  const names = await classifyNames(db, deps.seriesId, deps.boundary, nameCandidates(allText));
  const forbidden = [...new Set([...names.hidden, ...plan.forbiddenNames.map((n) => n.toLowerCase())])];
  const checked = checkCitations(data, new Set(sources.map((s) => s.n)), forbidden, names.visible.filter((v) => !forbidden.includes(v)));
  if (!checked.paragraphs.length) {
    throw new SummaryError("No sentence of the reply passed the citation check", "empty-after-check");
  }

  const cited = new Set(checked.paragraphs.flat().flatMap((s) => s.sources));
  return {
    key,
    ref: plan.ref,
    paragraphs: checked.paragraphs,
    sources: sources.filter((s) => cited.has(s.n)).map(({ n, kind, chip, heading, text }) => ({ n, kind, chip, heading, text })),
    basis: {
      bookSummaries: plan.finished.filter((b) => b.bookSummary).map((b) => b.title),
      passageBooks: plan.finished.filter((b) => !b.bookSummary).map((b) => b.title),
      currentBook: plan.current?.title ?? null,
      currentPassages: current.length,
      currentPassagesAvailable: plan.current?.passages.length ?? 0,
      firstChapter: current[0]?.chapterLabel ?? null,
      lastChapter: current.at(-1)?.chapterLabel ?? null,
    },
    dropped: checked.dropped.length,
    model: settings.model,
    createdAt: new Date().toISOString(),
  };
}

// ---------- Cache, caps and locking ----------

export interface SummaryCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Takes a short lock; false when someone else holds it. */
  lock(key: string, ttlSeconds: number): Promise<boolean>;
  unlock(key: string): Promise<void>;
}

/** Cached Summaries are kept for six months; Spoiler Reports and regenerating remove them sooner. */
export const SUMMARY_TTL_SECONDS = 180 * 24 * 3600;

export async function readCachedSummary(cache: SummaryCache, key: string): Promise<SummaryEntry | null> {
  try {
    const raw = await cache.get(key);
    return raw ? (JSON.parse(raw) as SummaryEntry) : null;
  } catch {
    return null;
  }
}

/**
 * Returns the cached Summary for this lookup, or builds, checks and caches one. A cache hit is free and is
 * never capped. A miss is refused once the Reader's or everyone's daily spend is at its cap.
 */
export async function getOrBuildSummary(
  deps: Omit<BuildDeps, "onUsage" | "settings"> & {
    cache: SummaryCache;
    readerId: string;
    target: LookupTarget;
    settings?: SummarySettings;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<SummaryEntry> {
  const settings = deps.settings ?? (await getSummarySettings(deps.db));
  const plan = await planSummary(deps.db, deps.boundary, deps.target);
  if (!plan) throw new SummaryError("Nothing inside the boundary to summarise", "nothing-to-summarise");
  const key = planCacheKey(plan, settings.model);
  const hit = await readCachedSummary(deps.cache, key);
  if (hit) return hit;

  const lockKey = `lock:${key}`;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  if (!(await deps.cache.lock(lockKey, 120))) {
    // Someone else (another tab, another Reader at the same place) is writing it: wait for theirs.
    deps.onProgress?.("Someone else is writing this Summary right now…");
    for (let i = 0; i < 45; i++) {
      await sleep(2000);
      const ready = await readCachedSummary(deps.cache, key);
      if (ready) return ready;
    }
    throw new SummaryError("Timed out waiting for a Summary being written elsewhere", "llm");
  }
  try {
    const spent = await spendToday(deps.db, deps.readerId);
    if (spent.global >= settings.globalDailyUsd) throw new SummaryError("The daily spend cap for everyone is reached", "global-cap");
    if (spent.reader >= settings.readerDailyUsd) throw new SummaryError("Your daily spend cap is reached", "reader-cap");

    const entry = await buildSummary(
      {
        ...deps,
        settings,
        onUsage: (purpose, usage) => recordSpend(deps.db, purpose, deps.readerId, usage),
      },
      plan,
      key,
    );
    await deps.cache.set(key, JSON.stringify(entry), SUMMARY_TTL_SECONDS);
    return entry;
  } catch (error) {
    if (error instanceof SummaryError) throw error;
    throw new SummaryError(error instanceof Error ? error.message : String(error), "llm");
  } finally {
    await deps.cache.unlock(lockKey);
  }
}

/** For a page render: the cached Summary if there is one, without spending anything. */
export async function cachedSummaryFor(
  db: AnyDb,
  cache: SummaryCache,
  boundary: SpoilerBoundary,
  target: LookupTarget,
  settings: SummarySettings,
): Promise<{ key: string | null; entry: SummaryEntry | null }> {
  const plan = await planSummary(db, boundary, target);
  if (!plan) return { key: null, entry: null };
  const key = planCacheKey(plan, settings.model);
  return { key, entry: await readCachedSummary(cache, key) };
}

/** An in-memory cache, for tests and for running without Redis locally. */
export function memoryCache(): SummaryCache & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => void store.set(k, v),
    del: async (k) => void store.delete(k),
    lock: async (k) => (store.has(k) ? false : (store.set(k, "1"), true)),
    unlock: async (k) => void store.delete(k),
  };
}
