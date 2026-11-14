import { describe, expect, it } from "vitest";
import type { ChapterExtraction, PassageExtraction } from "./extract";
import { mergeSubjects, normaliseName } from "./merge";

const p = (passageIndex: number, names: string[], sameEntity: string[][] = []): PassageExtraction => ({
  passageIndex,
  mentions: names.map((name) => ({ name, kind: "character" })),
  sameEntity: sameEntity.map((names) => ({ names, evidence: "quote" })),
});
const chapter = (chapterIndex: number, passages: PassageExtraction[]): ChapterExtraction => ({
  chapterIndex,
  passageCount: passages.length,
  passages,
});
const byName = (subjects: ReturnType<typeof mergeSubjects>, name: string) =>
  subjects.find((s) => s.aliases.some((a) => a.name === name));

describe("normaliseName", () => {
  it("drops leading titles", () => {
    expect(normaliseName("Captain Ganoes Paran")).toBe("ganoes paran");
    expect(normaliseName("High Mage Tayschrenn")).toBe("tayschrenn");
    expect(normaliseName("The Captain")).toBe("captain");
  });
});

describe("mergeSubjects", () => {
  it("joins titled and short forms of a name without a Reveal", () => {
    const subjects = mergeSubjects([chapter(0, [p(0, ["Ganoes Paran"]), p(1, ["Captain Paran", "Paran"])])]);
    const paran = byName(subjects, "Paran");
    expect(paran?.aliases.map((a) => a.name).sort()).toEqual(["Captain Paran", "Ganoes Paran", "Paran"]);
    expect(paran?.aliases.every((a) => a.revealChapterIndex === null)).toBe(true);
    expect(paran?.mentions).toHaveLength(3);
  });

  it("does not join a short name that matches several full names", () => {
    const subjects = mergeSubjects([chapter(0, [p(0, ["Ganoes Paran", "Tavore Paran"]), p(1, ["Paran"])])]);
    expect(subjects).toHaveLength(3);
  });

  it("joins names linked at their introduction without a Reveal", () => {
    const subjects = mergeSubjects([chapter(0, [p(0, ["Whiskeyjack", "Sergeant Jack"], [["Whiskeyjack", "Sergeant Jack"]])])]);
    expect(subjects).toHaveLength(1);
    expect(subjects[0]?.aliases.every((a) => a.revealChapterIndex === null)).toBe(true);
  });

  it("flags a late link between two known names as a Reveal on the later name", () => {
    const subjects = mergeSubjects([
      chapter(0, [p(0, ["Shadowthrone"]), p(1, ["Ammanas"])]),
      chapter(1, [p(0, ["Shadowthrone"])]),
      chapter(2, [p(0, ["Shadowthrone", "Ammanas"], [["Ammanas", "Shadowthrone"]])]),
    ]);
    expect(subjects).toHaveLength(1);
    const subject = subjects[0];
    expect(subject?.name).toBe("Shadowthrone");
    const ammanas = subject?.aliases.find((a) => a.name === "Ammanas");
    expect(ammanas?.revealChapterIndex).toBe(2);
    expect(ammanas?.reviewNote).toContain("Shadowthrone");
    expect(subject?.aliases.find((a) => a.name === "Shadowthrone")?.revealChapterIndex).toBeNull();
  });

  it("orders Subjects by how often they are mentioned", () => {
    const subjects = mergeSubjects([chapter(0, [p(0, ["Kruppe"]), p(1, ["Kruppe", "Crokus"]), p(2, ["Kruppe"])])]);
    expect(subjects.map((s) => s.name)).toEqual(["Kruppe", "Crokus"]);
  });
});
