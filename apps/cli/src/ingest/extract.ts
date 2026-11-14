/**
 * Extraction stage: one LLM call per Passage, cached on disk per Chapter so a re-run
 * (after a crash, or to re-load the database) never pays for the same Passage twice.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

async function readCache(file: string, passageCount: number): Promise<ChapterExtraction | null> {
  try {
    const cached = JSON.parse(await readFile(file, "utf8")) as ChapterExtraction;
    return cached.passageCount === passageCount ? cached : null;
  } catch {
    return null;
  }
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

  for (const [chapterIndex, passages] of options.passagesByChapter.entries()) {
    const file = path.join(dir, `${String(chapterIndex).padStart(3, "0")}.json`);
    const cached = await readCache(file, passages.length);
    if (cached) {
      results.push(cached);
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
    const chapter: ChapterExtraction = { chapterIndex, passageCount: passages.length, passages: extracted };
    await writeFile(file, JSON.stringify(chapter, null, 1));
    options.log(`  extracted chapter ${chapterIndex} (${passages.length} passages)`);
    results.push(chapter);
  }
  return results;
}
