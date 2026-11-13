import { describe, expect, it } from "vitest";
import { canonicalBoundary, isAliasJoined, isChapterVisible, type SpoilerBoundary } from "./boundary";

const boundary: SpoilerBoundary = {
  finishedBookIds: ["gotm", "dg"],
  position: { bookId: "moi", lastFinishedChapterIndex: 4 },
};

describe("isChapterVisible", () => {
  it("shows every Chapter of a Finished Book", () => {
    expect(isChapterVisible(boundary, { bookId: "gotm", chapterIndex: 0 })).toBe(true);
    expect(isChapterVisible(boundary, { bookId: "dg", chapterIndex: 99 })).toBe(true);
  });

  it("shows the current Book up to and including the Reading Position", () => {
    expect(isChapterVisible(boundary, { bookId: "moi", chapterIndex: 4 })).toBe(true);
    expect(isChapterVisible(boundary, { bookId: "moi", chapterIndex: 5 })).toBe(false);
  });

  it("hides unread Books, even ones earlier in some Reading Order", () => {
    expect(isChapterVisible(boundary, { bookId: "night-of-knives", chapterIndex: 0 })).toBe(false);
  });

  it("hides everything outside Finished Books when the Reader is between Books", () => {
    const between: SpoilerBoundary = { finishedBookIds: ["gotm"], position: null };
    expect(isChapterVisible(between, { bookId: "dg", chapterIndex: 0 })).toBe(false);
  });
});

describe("isAliasJoined", () => {
  it("joins ordinary names, which have no Reveal", () => {
    expect(isAliasJoined(boundary, null)).toBe(true);
  });

  it("keeps a secret Alias apart until its Reveal is inside the boundary", () => {
    expect(isAliasJoined(boundary, { bookId: "moi", chapterIndex: 9 })).toBe(false);
    expect(isAliasJoined(boundary, { bookId: "moi", chapterIndex: 2 })).toBe(true);
  });
});

describe("canonicalBoundary", () => {
  it("ignores the order Books were finished in", () => {
    const a = canonicalBoundary({ finishedBookIds: ["dg", "gotm"], position: null });
    const b = canonicalBoundary({ finishedBookIds: ["gotm", "dg", "gotm"], position: null });
    expect(a).toEqual(b);
  });

  it("drops a Reading Position inside a Book that is already finished", () => {
    const c = canonicalBoundary({ finishedBookIds: ["gotm"], position: { bookId: "gotm", lastFinishedChapterIndex: 3 } });
    expect(c.position).toBeNull();
  });
});
