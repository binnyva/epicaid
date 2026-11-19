/**
 * Extraction stage: one LLM call per Passage, cached on disk per Chapter so a re-run
 * (after a crash, or to re-load the database) never pays for the same Passage twice.
 * A Chapter still in progress is cached per Passage in a .partial.json file, so a crash or a failed
 * Passage only costs the Passages that were not finished.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_SYSTEM,
  extractionSchema,
  extractionUserPrompt,
  LlmError,
  LlmFatalError,
  type ChatJson,
  type Extraction,
  type LlmUsage,
  type ReasoningEffort,
} from "@epicaid/core";
import { slugify } from "./book";
import { mapPool } from "./pool";
import { silentProgress, type ProgressFactory } from "./progress";

export type SubjectKind = Extraction["mentions"][number]["kind"];

export interface PassageExtraction {
  passageIndex: number;
  mentions: { name: string; kind: SubjectKind }[];
  sameEntity: { names: string[]; evidence: string }[];
}

export interface ChapterExtraction {
  chapterIndex: number;
  passageCount: number;
  /** sha256 of the Chapter's Passages. Missing in caches written before it existed. */
  textHash?: string;
  passages: PassageExtraction[];
}

/**
 * Output cap for one Passage. The largest extraction in Books 1 to 9 is about 700 tokens, so this leaves
 * room, and a model that gets stuck repeating itself is stopped here instead of at the provider's limit
 * (131k tokens, about $0.05 a time).
 */
export const EXTRACTION_MAX_TOKENS = 2048;
/** A retry at temperature 0 tends to fall into the same loop; a little randomness gets it out. */
const RETRY_TEMPERATURE = 0.4;
/** More failures than this means something is wrong beyond one odd Passage, so stop spending. */
export const DEFAULT_MAX_FAILED_PASSAGES = 20;

export interface FailedPassage {
  chapterIndex: number;
  passageIndex: number;
  error: string;
}

/** A Chapter still being extracted: the Passages done so far, null where not done yet. */
interface PartialChapter {
  chapterIndex: number;
  textHash: string;
  passages: (PassageExtraction | null)[];
}

const squash = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

/** Drops names the model invented (not in the passage), duplicates, and links to dropped names. */
export function cleanExtraction(passage: string, raw: Extraction, passageIndex: number): PassageExtraction {
  const haystack = squash(passage);
  const seen = new Map<string, { name: string; kind: SubjectKind }>();
  for (const m of raw.mentions) {
    const name = m.name.replace(/\s+/g, " ").trim().replace(/[’]/g, "'");
    if (!name || !haystack.includes(squash(name))) continue;
    if (!seen.has(squash(name))) seen.set(squash(name), { name, kind: m.kind });
  }
  const sameEntity = raw.sameEntity
    .map((group) => ({
      names: [...new Set(group.names.map((n) => seen.get(squash(n))?.name).filter((n): n is string => !!n))],
      evidence: group.evidence.slice(0, 300),
    }))
    .filter((group) => group.names.length >= 2);
  return { passageIndex, mentions: [...seen.values()], sameEntity };
}

export function extractionCacheDir(bookFolder: string, model: string): string {
  return path.join(bookFolder, "extracted", "extraction", `${slugify(model)}-v${EXTRACTION_PROMPT_VERSION}`);
}

/** Cache folders other models wrote with the same prompt version, oldest name first for a stable order. */
async function otherModelCacheDirs(bookFolder: string, ownDir: string): Promise<string[]> {
  const root = path.join(bookFolder, "extracted", "extraction");
  const suffix = `-v${EXTRACTION_PROMPT_VERSION}`;
  let names: string[];
  try {
    names = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(suffix))
    .sort()
    .map((n) => path.join(root, n))
    .filter((dir) => dir !== ownDir);
}

export const chapterTextHash = (passages: string[]) => createHash("sha256").update(passages.join("\n\n")).digest("hex");

/**
 * Does a cached extraction belong to these Passages? Matched by text hash, so a cache survives Chapters being
 * renumbered (e.g. part openers folded in). Older caches have no hash: they match when the Passage count agrees
 * and every cached name occurs in its Passage, which cleanExtraction guaranteed when the cache was written.
 */
export function cacheMatches(cached: ChapterExtraction, passages: string[], hash: string): boolean {
  if (cached.textHash) return cached.textHash === hash;
  if (cached.passageCount !== passages.length) return false;
  let names = 0;
  for (const p of cached.passages) {
    const text = squash(passages[p.passageIndex] ?? "");
    for (const m of p.mentions) {
      if (!text.includes(squash(m.name))) return false;
      names++;
    }
  }
  return names > 0;
}

async function readPartial(file: string, textHash: string, count: number): Promise<(PassageExtraction | null)[]> {
  try {
    const partial = JSON.parse(await readFile(file, "utf8")) as PartialChapter;
    if (partial.textHash === textHash && partial.passages.length === count) return partial.passages;
  } catch {
    // Missing, or half-written in a crash: start the Chapter over.
  }
  return new Array<PassageExtraction | null>(count).fill(null);
}

async function readAllCaches(dir: string): Promise<ChapterExtraction[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json") && !f.endsWith(".partial.json"));
  const out: ChapterExtraction[] = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(await readFile(path.join(dir, f), "utf8")) as ChapterExtraction);
    } catch {
      // A half-written file from a crash: ignore it and extract that Chapter again.
    }
  }
  return out;
}

export async function extractBook(options: {
  bookFolder: string;
  passagesByChapter: string[][];
  chatJson: ChatJson;
  model: string;
  /** Not part of the cache key: cached Chapters are reused whatever effort wrote them. */
  reasoning: ReasoningEffort;
  /**
   * Only reuse this model's own cache. By default a Chapter another model already extracted (same prompt
   * version, same text) is reused as it is, so switching to a cheaper model only pays for new Chapters.
   */
  fresh?: boolean;
  concurrency: number;
  onUsage: (usage: LlmUsage) => Promise<void> | void;
  log: (line: string) => void;
  /** Draws the bar over the Passages that need a model call; cached Chapters don't count. */
  progress?: ProgressFactory;
  /** Stop the run once more Passages than this have failed (default 20). */
  maxFailed?: number;
}): Promise<{ chapters: ChapterExtraction[]; failed: FailedPassage[] }> {
  const dir = extractionCacheDir(options.bookFolder, options.model);
  await mkdir(dir, { recursive: true });
  const results: ChapterExtraction[] = new Array(options.passagesByChapter.length);
  const todo: {
    chapterIndex: number;
    passages: string[];
    textHash: string;
    file: string;
    partialFile: string;
    done: (PassageExtraction | null)[];
  }[] = [];
  // Read every cache file up front: rewriting one under its new index must not hide it from a later Chapter.
  const caches = await readAllCaches(dir);
  const others: { model: string; caches: ChapterExtraction[] }[] = [];
  if (!options.fresh) {
    for (const otherDir of await otherModelCacheDirs(options.bookFolder, dir)) {
      others.push({ model: path.basename(otherDir).replace(/-v[^-]+$/, ""), caches: await readAllCaches(otherDir) });
    }
  }
  const reused = new Map<string, number>();

  for (const [chapterIndex, passages] of options.passagesByChapter.entries()) {
    const file = path.join(dir, `${String(chapterIndex).padStart(3, "0")}.json`);
    const textHash = chapterTextHash(passages);
    const hit = caches.find((c) => c.chapterIndex === chapterIndex && cacheMatches(c, passages, textHash))
      ?? caches.find((c) => cacheMatches(c, passages, textHash));
    if (hit) {
      const chapter = { ...hit, chapterIndex, textHash };
      if (hit.chapterIndex !== chapterIndex || !hit.textHash) await writeFile(file, JSON.stringify(chapter, null, 1));
      results[chapterIndex] = chapter;
      continue;
    }
    // Another model's extraction of the same text. Used as it is and left in that model's folder, so each
    // folder only ever holds what its own model wrote.
    const other = others
      .map((o) => ({ model: o.model, hit: o.caches.find((c) => cacheMatches(c, passages, textHash)) }))
      .find((o) => o.hit);
    if (other?.hit) {
      results[chapterIndex] = { ...other.hit, chapterIndex, textHash };
      reused.set(other.model, (reused.get(other.model) ?? 0) + 1);
      continue;
    }
    const partialFile = file.replace(/\.json$/, ".partial.json");
    const done = await readPartial(partialFile, textHash, passages.length);
    todo.push({ chapterIndex, passages, textHash, file, partialFile, done });
  }
  for (const [model, count] of reused) {
    options.log(`  reused ${count} Chapter${count === 1 ? "" : "s"} extracted by ${model} (pass --fresh to redo them)`);
  }

  const cached = options.passagesByChapter.length - todo.length;
  if (cached) options.log(`  ${cached} of ${options.passagesByChapter.length} Chapters already extracted`);
  const resumed = todo.reduce((n, t) => n + t.done.filter(Boolean).length, 0);
  if (resumed) options.log(`  ${resumed} Passages of unfinished Chapters already extracted`);
  const failed: FailedPassage[] = [];
  if (!todo.length) return { chapters: results, failed };
  const maxFailed = options.maxFailed ?? DEFAULT_MAX_FAILED_PASSAGES;
  const bar = (options.progress ?? silentProgress(options.log))(
    "Extracting",
    todo.reduce((n, t) => n + t.done.filter((d) => !d).length, 0),
    "passages",
  );

  const call = async (text: string, temperature: number) => {
    try {
      const { data, usage } = await options.chatJson({
        model: options.model,
        system: EXTRACTION_SYSTEM,
        user: extractionUserPrompt(text),
        schema: extractionSchema,
        schemaName: "passage_index",
        reasoning: options.reasoning,
        temperature,
        maxTokens: EXTRACTION_MAX_TOKENS,
        // Never grow the budget: a Passage that needs more than this is a model stuck in a loop.
        maxTokensCeiling: EXTRACTION_MAX_TOKENS,
      });
      await options.onUsage(usage);
      return data;
    } catch (error) {
      // Failed attempts are billed too.
      if (error instanceof LlmError && error.usage && (error.usage.costUsd > 0 || error.usage.completionTokens > 0)) {
        await options.onUsage(error.usage);
      }
      throw error;
    }
  };

  // Set when the run is stopping, so the other workers don't start new calls.
  let stopping = false;
  try {
    for (const { chapterIndex, passages, textHash, file, partialFile, done } of todo) {
      let saving = Promise.resolve();
      const savePartial = () => {
        const body = JSON.stringify({ chapterIndex, textHash, passages: done } satisfies PartialChapter);
        saving = saving.then(() => writeFile(partialFile, body));
        return saving;
      };
      const chapterFailed: FailedPassage[] = [];
      await mapPool(passages, options.concurrency, async (text, passageIndex) => {
        if (done[passageIndex] || stopping) return;
        let data: Extraction;
        try {
          data = await call(text, 0).catch((error: unknown) => {
            if (error instanceof LlmFatalError) throw error;
            return call(text, RETRY_TEMPERATURE);
          });
        } catch (error) {
          if (error instanceof LlmFatalError) {
            stopping = true;
            throw error;
          }
          const message = error instanceof Error ? error.message : String(error);
          const entry = { chapterIndex, passageIndex, error: message };
          chapterFailed.push(entry);
          failed.push(entry);
          bar.log(`  passage ${passageIndex} of chapter ${chapterIndex} failed twice, skipped for now: ${message}`);
          bar.tick();
          if (failed.length > maxFailed) {
            stopping = true;
            throw new Error(`${failed.length} Passages failed, stopping. Finished Passages are cached; re-run to continue.`);
          }
          return;
        }
        done[passageIndex] = cleanExtraction(text, data, passageIndex);
        bar.tick();
        await savePartial();
      });
      await saving;
      if (chapterFailed.length) {
        // Keep the partial file so a re-run only retries the failed Passages. Fill the gaps with empty
        // extractions so the run can still go on when the caller allows it.
        results[chapterIndex] = {
          chapterIndex,
          passageCount: passages.length,
          textHash,
          passages: done.map((d, passageIndex) => d ?? { passageIndex, mentions: [], sameEntity: [] }),
        };
        continue;
      }
      const chapter: ChapterExtraction = {
        chapterIndex,
        passageCount: passages.length,
        textHash,
        passages: done as PassageExtraction[],
      };
      await writeFile(file, JSON.stringify(chapter, null, 1));
      await rm(partialFile, { force: true });
      bar.log(`  extracted chapter ${chapterIndex} (${passages.length} passages)`);
      results[chapterIndex] = chapter;
    }
  } finally {
    bar.done();
  }
  return { chapters: results, failed };
}
