import { describe, expect, it } from "vitest";
import { citationChips } from "./summary-text";

const sources = [
  { n: 1, kind: "book-summary" as const, chip: "Gardens of the Moon", heading: "Book Summary of Gardens of the Moon", text: "" },
  { n: 2, kind: "passage" as const, chip: "Ch 5", heading: "Memories of Ice, Chapter Five", text: "" },
  { n: 3, kind: "passage" as const, chip: "Ch 5", heading: "Memories of Ice, Chapter Five", text: "" },
  { n: 4, kind: "passage" as const, chip: "Ch 3", heading: "Memories of Ice, Chapter Three", text: "" },
];

describe("citationChips", () => {
  it("shows each Chapter once, keeping every source behind it", () => {
    expect(citationChips([2, 3, 4, 1], sources)).toEqual([
      { label: "Ch 5", sources: [2, 3], title: "Memories of Ice, Chapter Five" },
      { label: "Ch 3", sources: [4], title: "Memories of Ice, Chapter Three" },
      { label: "Gardens of the Moon", sources: [1], title: "Book Summary of Gardens of the Moon" },
    ]);
  });
});
