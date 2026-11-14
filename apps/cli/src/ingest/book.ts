/** Reads the folder written by scripts/extract_epub.py. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const entrySchema = z.object({
  file: z.string(),
  kind: z.enum(["front", "chapter", "back"]),
  label: z.string(),
  title: z.string().nullable(),
  index: z.number().int().optional(),
});

const bookJsonSchema = z.object({
  title: z.string(),
  author: z.string(),
  series: z.string().nullable(),
  seriesIndex: z.number().nullable(),
  entries: z.array(entrySchema),
});

export interface ExtractedChapter {
  index: number;
  label: string;
  title: string | null;
  html: string;
}

export interface ExtractedBook {
  folder: string;
  slug: string;
  title: string;
  author: string;
  seriesName: string | null;
  seriesIndex: number | null;
  chapters: ExtractedChapter[];
}

export async function readExtractedBook(bookFolder: string): Promise<ExtractedBook> {
  const folder = path.resolve(bookFolder);
  const dir = path.join(folder, "extracted");
  const raw = JSON.parse(await readFile(path.join(dir, "book.json"), "utf8"));
  const book = bookJsonSchema.parse(raw);
  const chapterEntries = book.entries.filter((e) => e.kind === "chapter");
  const chapters = await Promise.all(
    chapterEntries.map(async (entry, index) => ({
      index,
      label: entry.label,
      title: entry.title,
      html: await readFile(path.join(dir, entry.file), "utf8"),
    })),
  );
  return {
    folder,
    slug: slugify(path.basename(folder)),
    title: book.title,
    author: book.author,
    seriesName: book.series,
    seriesIndex: book.seriesIndex,
    chapters,
  };
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
