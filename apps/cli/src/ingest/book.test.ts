import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readExtractedBook } from "./book";

describe("readExtractedBook", () => {
  it("folds part openers into the next Chapter and records the part", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "book-"));
    await mkdir(path.join(folder, "extracted", "html"), { recursive: true });
    const page = (body: string) => `<!doctype html>\n<html><head></head>\n<body>\n${body}</body></html>\n`;
    const files: [string, string, string][] = [
      ["front", "Maps", ""],
      ["chapter", "Prologue", "<p>Pro.</p>\n"],
      ["part", "Book One", "<h2>Book One</h2>\n<p>Epigraph.</p>\n"],
      ["chapter", "Chapter One", "<p>One.</p>\n"],
      ["chapter", "Chapter Two", "<p>Two.</p>\n"],
      ["back", "Glossary", ""],
    ];
    const entries = [];
    for (const [i, [kind, label, body]] of files.entries()) {
      const file = `html/${i}.html`;
      await writeFile(path.join(folder, "extracted", file), page(body));
      entries.push({ file, kind, label, title: null });
    }
    await writeFile(
      path.join(folder, "extracted", "book.json"),
      JSON.stringify({ title: "T", author: "A", series: null, seriesIndex: null, entries }),
    );

    const book = await readExtractedBook(folder);
    expect(book.chapters.map((c) => [c.index, c.label, c.part])).toEqual([
      [0, "Prologue", null],
      [1, "Chapter One", "Book One"],
      [2, "Chapter Two", "Book One"],
    ]);
    expect(book.chapters[1]?.html).toContain("Epigraph.");
    expect(book.chapters[1]?.html.indexOf("Epigraph.")).toBeLessThan(book.chapters[1]?.html.indexOf("One.") ?? 0);
    expect(book.chapters[2]?.html).not.toContain("Epigraph.");
  });
});
