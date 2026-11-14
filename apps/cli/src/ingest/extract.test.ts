import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ChatJson } from "@epicaid/core";
import { cleanExtraction, extractBook } from "./extract";

describe("cleanExtraction", () => {
  const passage = "Tattersail watched Captain Paran ride past. Paran did not look back.";

  it("drops names that are not in the passage and duplicates", () => {
    const result = cleanExtraction(
      passage,
      {
        mentions: [
          { name: "Tattersail", kind: "character" },
          { name: "captain paran", kind: "character" },
          { name: "Captain Paran", kind: "character" },
          { name: "Anomander Rake", kind: "character" },
        ],
        sameEntity: [],
      },
      0,
    );
    expect(result.mentions.map((m) => m.name)).toEqual(["Tattersail", "captain paran"]);
  });

  it("drops links to names that were dropped", () => {
    const result = cleanExtraction(
      passage,
      {
        mentions: [
          { name: "Captain Paran", kind: "character" },
          { name: "Paran", kind: "character" },
        ],
        sameEntity: [
          { names: ["Captain Paran", "Paran"], evidence: "Paran did not look back" },
          { names: ["Paran", "Ganoes"], evidence: "invented" },
        ],
      },
      0,
    );
    expect(result.sameEntity).toEqual([{ names: ["Captain Paran", "Paran"], evidence: "Paran did not look back" }]);
  });
});

describe("extractBook", () => {
  it("calls the model once per Passage and reuses the cache on re-run", async () => {
    let calls = 0;
    const chatJson = (async () => {
      calls++;
      return {
        data: { mentions: [{ name: "Kruppe", kind: "character" }], sameEntity: [] },
        usage: { model: "fake", promptTokens: 10, completionTokens: 5, costUsd: 0.001 },
      };
    }) as unknown as ChatJson;
    const bookFolder = await mkdtemp(path.join(tmpdir(), "epicaid-"));
    const options = {
      bookFolder,
      passagesByChapter: [["Kruppe smiled.", "Kruppe ate."], ["Kruppe slept."]],
      chatJson,
      model: "fake/model",
      concurrency: 2,
      onUsage: () => {},
      log: () => {},
    };

    const first = await extractBook(options);
    expect(calls).toBe(3);
    expect(first[1]?.passages[0]?.mentions).toEqual([{ name: "Kruppe", kind: "character" }]);

    const second = await extractBook(options);
    expect(calls).toBe(3);
    expect(second).toEqual(first);
  });
});
