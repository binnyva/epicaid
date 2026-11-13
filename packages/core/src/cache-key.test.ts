import { describe, expect, it } from "vitest";
import { summaryCacheKey, type SummaryKeyInput } from "./cache-key";

const base: SummaryKeyInput = {
  subjectId: "kruppe",
  boundary: { finishedBookIds: ["gotm"], position: { bookId: "dg", lastFinishedChapterIndex: 14 } },
  lastMentionChapterIndex: 5,
  model: "some/model",
  promptVersion: "1",
};

describe("summaryCacheKey", () => {
  it("is shared by Readers past the Subject's last Mention in the current Book", () => {
    const later = { ...base, boundary: { ...base.boundary, position: { bookId: "dg", lastFinishedChapterIndex: 9 } } };
    expect(summaryCacheKey(later)).toBe(summaryCacheKey(base));
  });

  it("differs when a new Mention comes inside the boundary", () => {
    expect(summaryCacheKey({ ...base, lastMentionChapterIndex: 12 })).not.toBe(summaryCacheKey(base));
  });

  it("ignores the current Book when it has no Mention of the Subject", () => {
    const a = { ...base, lastMentionChapterIndex: null };
    const b = { ...a, boundary: { finishedBookIds: ["gotm"], position: null } };
    expect(summaryCacheKey(a)).toBe(summaryCacheKey(b));
  });

  it("differs by Finished Books, model and prompt version", () => {
    const key = summaryCacheKey(base);
    expect(summaryCacheKey({ ...base, boundary: { ...base.boundary, finishedBookIds: ["gotm", "night-of-knives"] } })).not.toBe(key);
    expect(summaryCacheKey({ ...base, model: "other/model" })).not.toBe(key);
    expect(summaryCacheKey({ ...base, promptVersion: "2" })).not.toBe(key);
  });

  it("ignores the order Finished Books are listed in", () => {
    const two = { ...base, boundary: { ...base.boundary, finishedBookIds: ["gotm", "nok"] } };
    const swapped = { ...base, boundary: { ...base.boundary, finishedBookIds: ["nok", "gotm"] } };
    expect(summaryCacheKey(two)).toBe(summaryCacheKey(swapped));
  });
});
