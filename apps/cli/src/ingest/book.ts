/** Reads the folder written by scripts/extract_epub.py or scripts/extract_pdf.py. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const entrySchema = z.object({
  file: z.string(),
  kind: z.enum(["front", "part", "chapter", "back"]),
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
  /** The part ("Book Two – Whirlwind") this Chapter is in, if the Book has parts. */
  part: string | null;
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
  // A part opener (title page and epigraph) is not something a Reader finishes, so its text joins the next Chapter.
  const chapters: ExtractedChapter[] = [];
  let part: string | null = null;
  let pendingHtml = "";
  for (const entry of book.entries) {
    if (entry.kind === "part") {
      part = entry.label;
      pendingHtml += bodyOf(await readFile(path.join(dir, entry.file), "utf8"));
    } else if (entry.kind === "chapter") {
      const html = await readFile(path.join(dir, entry.file), "utf8");
      chapters.push({
        index: chapters.length,
        label: entry.label,
        title: entry.title,
        part,
        html: pendingHtml ? html.replace(/<body>/i, `<body>\n${pendingHtml}`) : html,
      });
      pendingHtml = "";
    }
  }
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

const bodyOf = (html: string) => /<body>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
