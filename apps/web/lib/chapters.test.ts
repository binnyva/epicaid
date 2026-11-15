import { describe, expect, it } from "vitest";
import { groupByPart, groupNote, rangeText } from "./chapters";

const ch = (index: number, label: string, part: string | null = null) => ({ index, label, title: null, part });
const book = [
  ch(0, "Prologue"),
  ch(1, "Chapter One", "Book One – Pale"),
  ch(2, "Chapter Two", "Book One – Pale"),
  ch(3, "Chapter Three", "Book Two – Darujhistan"),
  ch(4, "Epilogue"),
];

describe("groupByPart", () => {
  it("gives the Prologue its own card and groups Chapters by part", () => {
    expect(groupByPart(book).map((g) => [g.name, g.chapters.length])).toEqual([
      ["Prologue", 1],
      ["Book One – Pale", 2],
      ["Book Two – Darujhistan", 1],
      ["Epilogue", 1],
    ]);
  });

  it("puts a Book without parts in one card", () => {
    expect(groupByPart([ch(0, "One"), ch(1, "Two")]).map((g) => g.name)).toEqual(["Chapters"]);
  });
});

describe("notes", () => {
  it("names the range and says when a part is finished", () => {
    const [prologue, pale, daru] = groupByPart(book);
    expect(rangeText(pale!.chapters)).toBe("Chapters One to Two");
    expect(groupNote(pale!, 2)).toBe("Chapters One to Two · finished");
    expect(groupNote(pale!, 1)).toBe("Chapters One to Two");
    expect(groupNote(prologue!, 0)).toBe("Finished");
    expect(groupNote(daru!, null)).toBe("Chapter Three");
  });
});
