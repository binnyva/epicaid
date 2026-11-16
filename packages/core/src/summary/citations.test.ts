import { describe, expect, it } from "vitest";
import { checkCitations, nameCandidates } from "./citations";

const reply = (...sentences: [string, number[]][]) => ({
  paragraphs: [{ sentences: sentences.map(([text, sources]) => ({ text, sources })) }],
});
const kept = (r: ReturnType<typeof checkCitations>) => r.paragraphs.flat().map((s) => s.text);

describe("checkCitations", () => {
  it("drops uncited sentences, made-up citations and citations to sources it was not given", () => {
    const r = checkCitations(
      reply(["Kept.", [1]], ["No source.", []], ["Made up.", [7]], ["Half made up.", [1, 7]], ["Also kept.", [2, 1, 2]]),
      new Set([1, 2]),
    );
    expect(kept(r)).toEqual(["Kept.", "Also kept."]);
    expect(r.paragraphs[0]![1]!.sources).toEqual([1, 2]);
    expect(r.dropped.map((d) => d.reason)).toEqual(["uncited", "bad-citation", "bad-citation"]);
  });

  it("drops a cited sentence that names someone the Reader must not see named", () => {
    const r = checkCitations(
      reply(["Kellanved rules the Empire.", [1]], ["Kellanved is really Shadowthrone.", [1]], ["The shadowthrone's hounds.", [1]]),
      new Set([1]),
      ["shadowthrone"],
    );
    expect(kept(r)).toEqual(["Kellanved rules the Empire."]);
  });

  it("does not trip on an unreached name inside a reached one", () => {
    const r = checkCitations(reply(["Anomander Rake watches.", [1]], ["Rake laughs.", [1]]), new Set([1]), ["rake"], ["anomander rake"]);
    expect(kept(r)).toEqual(["Anomander Rake watches."]);
  });

  it("strips citation markers the model wrote into the text and drops empty paragraphs", () => {
    const r = checkCitations({ paragraphs: [{ sentences: [{ text: "Said so [1, 2].", sources: [1] }] }, { sentences: [{ text: "x", sources: [] }] }] }, new Set([1]));
    expect(r.paragraphs).toEqual([[{ text: "Said so.", sources: [1] }]]);
  });
});

describe("nameCandidates", () => {
  it("collects capitalised runs, including ones joined by 'of'", () => {
    const c = nameCandidates("She met Anomander Rake at Moon's Spawn. Later the Son of Darkness left.");
    expect(c).toEqual(expect.arrayContaining(["anomander", "anomander rake", "rake", "moon", "son of darkness", "darkness", "she", "later"]));
  });
});
