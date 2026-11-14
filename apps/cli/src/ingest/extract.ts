/**
 * Extraction stage: one LLM call per Passage, cached on disk per Chapter so a re-run
 * (after a crash, or to re-load the database) never pays for the same Passage twice.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_SYSTEM,
  extractionSchema,
  extractionUserPrompt,
  type ChatJson,
  type Extraction,
  type LlmUsage,
} from "@epicaid/core";
import { slugify } from "./book";
import { mapPool } from "./pool";

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

async function readAllCaches(dir: string): Promise<ChapterExtraction[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
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
  concurrency: number;
  onUsage: (usage: LlmUsage) => Promise<void> | void;
  log: (line: string) => void;
}): Promise<ChapterExtraction[]> {
  const dir = extractionCacheDir(options.bookFolder, options.model);
  await mkdir(dir, { recursive: true });
  const results: ChapterExtraction[] = [];
  // Read every cache file up front: rewriting one under its new index must not hide it from a later Chapter.
  const caches = await readAllCaches(dir);

  for (const [chapterIndex, passages] of options.passagesByChapter.entries()) {
    const file = path.join(dir, `${String(chapterIndex).padStart(3, "0")}.json`);
    const textHash = chapterTextHash(passages);
    const hit = caches.find((c) => c.chapterIndex === chapterIndex && cacheMatches(c, passages, textHash))
      ?? caches.find((c) => cacheMatches(c, passages, textHash));
    if (hit) {
      const chapter = { ...hit, chapterIndex, textHash };
      if (hit.chapterIndex !== chapterIndex || !hit.textHash) await writeFile(file, JSON.stringify(chapter, null, 1));
      results.push(chapter);
      continue;
    }
    const extracted = await mapPool(passages, options.concurrency, async (text, passageIndex) => {
      const { data, usage } = await options.chatJson({
        model: options.model,
        system: EXTRACTION_SYSTEM,
        user: extractionUserPrompt(text),
        schema: extractionSchema,
        schemaName: "passage_index",
      });
      await options.onUsage(usage);
      return cleanExtraction(text, data, passageIndex);
    });
    const chapter: ChapterExtraction = { chapterIndex, passageCount: passages.length, textHash, passages: extracted };
    await writeFile(file, JSON.stringify(chapter, null, 1));
    options.log(`  extracted chapter ${chapterIndex} (${passages.length} passages)`);
    results.push(chapter);
  }
  return results;
}
