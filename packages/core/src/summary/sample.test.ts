import { describe, expect, it } from "vitest";
import { samplePassages } from "./sample";

const items = Array.from({ length: 40 }, (_, i) => ({ i, words: 100 }));
const words = (p: { words: number }) => p.words;

describe("samplePassages", () => {
  it("keeps everything under the budget", () => {
    expect(samplePassages(items.slice(0, 5), 1000, words)).toHaveLength(5);
  });

  it("keeps the latest Passages, spreads the rest over earlier ones, and stays in order and under budget", () => {
    const picked = samplePassages(items, 1000, words).map((p) => p.i);
    expect(picked.length).toBeLessThanOrEqual(10);
    expect(picked.slice(-4)).toEqual([36, 37, 38, 39]);
    expect(picked[0]).toBeLessThan(10);
    expect([...picked].sort((a, b) => a - b)).toEqual(picked);
  });

  it("is deterministic", () => {
    expect(samplePassages(items, 1000, words)).toEqual(samplePassages(items, 1000, words));
  });
});
