import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LlmCutOffError, LlmFatalError, type ChatJson, type ChatJsonRequest, type LlmUsage } from "@epicaid/core";
import { cleanExtraction, EXTRACTION_MAX_TOKENS, extractBook, extractionCacheDir } from "./extract";

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
        usage: { model: "fake", promptTokens: 10, completionTokens: 5, reasoningTokens: 0, costUsd: 0.001 },
      };
    }) as unknown as ChatJson;
    const bookFolder = await mkdtemp(path.join(tmpdir(), "epicaid-"));
    const options = {
      bookFolder,
      passagesByChapter: [["Kruppe smiled.", "Kruppe ate."], ["Kruppe slept."]],
      chatJson,
      model: "fake/model",
      reasoning: "none" as const,
      concurrency: 2,
      onUsage: () => {},
      log: () => {},
    };

    const { chapters: first } = await extractBook(options);
    expect(calls).toBe(3);
    expect(first[1]?.passages[0]?.mentions).toEqual([{ name: "Kruppe", kind: "character" }]);

    const { chapters: second } = await extractBook(options);
    expect(calls).toBe(3);
    expect(second).toEqual(first);
  });

  it("reuses another model's Chapters unless fresh, and leaves that model's folder alone", async () => {
    let calls = 0;
    const chatJson = (async () => {
      calls++;
      return {
        data: { mentions: [{ name: "Kruppe", kind: "character" }], sameEntity: [] },
        usage: { model: "fake", promptTokens: 10, completionTokens: 5, reasoningTokens: 0, costUsd: 0.001 },
      };
    }) as unknown as ChatJson;
    const bookFolder = await mkdtemp(path.join(tmpdir(), "epicaid-"));
    const lines: string[] = [];
    const base = {
      bookFolder,
      passagesByChapter: [["Kruppe smiled."]],
      chatJson,
      reasoning: "none" as const,
      concurrency: 1,
      onUsage: () => {},
      log: (line: string) => lines.push(line),
    };

    const { chapters: first } = await extractBook({ ...base, model: "pricey/model" });
    await extractBook({ ...base, passagesByChapter: [["Kruppe smiled."], ["Kruppe slept."]], model: "cheap/model" });
    expect(calls).toBe(2); // only the new Chapter
    expect(lines.some((l) => l.includes("reused 1 Chapter extracted by pricey-model"))).toBe(true);
    const { readdir } = await import("node:fs/promises");
    const { extractionCacheDir } = await import("./extract");
    expect(await readdir(extractionCacheDir(bookFolder, "cheap/model"))).toEqual(["001.json"]);
    expect(first).toHaveLength(1);

    await extractBook({ ...base, model: "cheap/model", fresh: true });
    expect(calls).toBe(3);
  });
});

describe("extractBook when a Passage goes wrong", () => {
  const usage = (costUsd: number): LlmUsage => ({ model: "fake", promptTokens: 700, completionTokens: 2048, reasoningTokens: 0, costUsd });
  const runaway = () => {
    const e = new LlmCutOffError("Reply cut off at max_tokens 2048 partway through the answer");
    e.usage = usage(0.0009);
    return e;
  };
  const answer = (name: string) => ({
    data: { mentions: [{ name, kind: "character" }], sameEntity: [] },
    usage: usage(0.0001),
  });
  const setup = async (reply: (req: ChatJsonRequest<never>) => unknown) => {
    const requests: ChatJsonRequest<never>[] = [];
    const chatJson = (async (req: ChatJsonRequest<never>) => {
      requests.push(req);
      return reply(req);
    }) as unknown as ChatJson;
    const spent: LlmUsage[] = [];
    const lines: string[] = [];
    const options = {
      bookFolder: await mkdtemp(path.join(tmpdir(), "epicaid-")),
      passagesByChapter: [["Kruppe smiled.", "Loop ate.", "Crokus ran."], ["Rallick slept."]],
      chatJson,
      model: "fake/model",
      reasoning: "none" as const,
      concurrency: 3,
      onUsage: (u: LlmUsage) => void spent.push(u),
      log: (line: string) => lines.push(line),
    };
    return { requests, spent, lines, options };
  };
  const nameIn = (req: ChatJsonRequest<never>) => /"""\n(\w+)/.exec(req.user)?.[1] ?? "";

  it("caps output tightly and never lets the cut-off retry grow it", async () => {
    const { requests, options } = await setup((req) => answer(nameIn(req)));
    await extractBook(options);
    expect(requests.every((r) => r.maxTokens === EXTRACTION_MAX_TOKENS && r.maxTokensCeiling === EXTRACTION_MAX_TOKENS)).toBe(true);
  });

  it("retries a runaway Passage once with some randomness, and counts what the failed call cost", async () => {
    let looped = false;
    const { requests, spent, options } = await setup((req) => {
      if (nameIn(req) === "Loop" && !looped) {
        looped = true;
        throw runaway();
      }
      return answer(nameIn(req));
    });
    const { chapters, failed } = await extractBook(options);
    expect(failed).toEqual([]);
    expect(chapters[0]?.passages[1]?.mentions).toEqual([{ name: "Loop", kind: "character" }]);
    const loopCalls = requests.filter((r) => nameIn(r) === "Loop");
    expect(loopCalls.map((r) => r.temperature)).toEqual([0, 0.4]);
    expect(spent.reduce((n, u) => n + u.costUsd, 0)).toBeCloseTo(0.0009 + 4 * 0.0001);
  });

  it("skips a Passage that fails twice, finishes the rest, and retries only that Passage on re-run", async () => {
    let broken = true;
    const first = await setup((req) => {
      if (nameIn(req) === "Loop" && broken) throw runaway();
      return answer(nameIn(req));
    });
    const result = await extractBook(first.options);
    expect(result.failed).toEqual([{ chapterIndex: 0, passageIndex: 1, error: expect.stringContaining("cut off") }]);
    // Chapter 1 finished; Chapter 0 waits in a partial file holding the two good Passages.
    const dir = extractionCacheDir(first.options.bookFolder, "fake/model");
    expect((await readdir(dir)).sort()).toEqual(["000.partial.json", "001.json"]);
    expect(result.chapters[0]?.passages[1]).toEqual({ passageIndex: 1, mentions: [], sameEntity: [] });
    expect(first.requests).toHaveLength(5); // 3 good + 2 tries of the broken one

    broken = false;
    const requests: string[] = [];
    const second = await extractBook({
      ...first.options,
      chatJson: (async (req: ChatJsonRequest<never>) => {
        requests.push(nameIn(req));
        return answer(nameIn(req));
      }) as unknown as ChatJson,
    });
    expect(requests).toEqual(["Loop"]);
    expect(second.failed).toEqual([]);
    expect(second.chapters[0]?.passages.map((p) => p.mentions[0]?.name)).toEqual(["Kruppe", "Loop", "Crokus"]);
    expect((await readdir(dir)).sort()).toEqual(["000.json", "001.json"]);
  });

  it("stops at once on an error retrying cannot fix", async () => {
    const { requests, options } = await setup(() => {
      throw new LlmFatalError("No auth credentials found");
    });
    await expect(extractBook(options)).rejects.toThrow("No auth credentials");
    expect(requests.length).toBeLessThanOrEqual(3); // the calls already in flight, no retries, no Chapter 1
  });

  it("stops spending once too many Passages fail", async () => {
    const { requests, options } = await setup(() => {
      throw runaway();
    });
    await expect(extractBook({ ...options, maxFailed: 1, concurrency: 1 })).rejects.toThrow("2 Passages failed, stopping");
    expect(requests).toHaveLength(4);
  });
});

describe("cacheMatches", async () => {
  const { cacheMatches, chapterTextHash } = await import("./extract");
  const passages = ["Kruppe waddled in.", "Crokus ran."];
  const legacy = {
    chapterIndex: 7,
    passageCount: 2,
    passages: [
      { passageIndex: 0, mentions: [{ name: "Kruppe", kind: "character" as const }], sameEntity: [] },
      { passageIndex: 1, mentions: [{ name: "Crokus", kind: "character" as const }], sameEntity: [] },
    ],
  };

  it("matches by text hash, whatever the Chapter number", () => {
    const hash = chapterTextHash(passages);
    expect(cacheMatches({ ...legacy, textHash: hash }, passages, hash)).toBe(true);
    expect(cacheMatches({ ...legacy, textHash: "other" }, passages, hash)).toBe(false);
  });

  it("accepts an old cache only when every cached name is in its Passage", () => {
    const hash = chapterTextHash(passages);
    expect(cacheMatches(legacy, passages, hash)).toBe(true);
    expect(cacheMatches(legacy, ["Crokus ran.", "Kruppe waddled in."], hash)).toBe(false);
    expect(cacheMatches(legacy, ["Kruppe waddled in."], hash)).toBe(false);
  });
});
