import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createOpenRouterClient, LlmFatalError, parseJsonReply } from "./openrouter";

const schema = z.strictObject({ answer: z.string() });
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ok = (content: string) =>
  reply(200, { model: "m", choices: [{ message: { content } }], usage: { prompt_tokens: 3, completion_tokens: 2, cost: 0.0004 } });

function fakeFetch(...responses: Response[]) {
  const sent: unknown[] = [];
  const fn = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next;
  }) as unknown as typeof fetch;
  return { fn, sent };
}

const request = { model: "some/model", system: "s", user: "u", schema, schemaName: "answer" };

describe("parseJsonReply", () => {
  it("accepts fenced JSON", () => {
    expect(parseJsonReply('```json\n{"answer":"x"}\n```')).toEqual({ answer: "x" });
  });
});

describe("createOpenRouterClient", () => {
  it("returns validated data and usage, and sends the JSON schema", async () => {
    const { fn, sent } = fakeFetch(ok('{"answer":"yes"}'));
    const chat = createOpenRouterClient({ apiKey: "k", fetch: fn, retries: 0 });
    const result = await chat(request);
    expect(result.data).toEqual({ answer: "yes" });
    expect(result.usage).toEqual({ model: "m", promptTokens: 3, completionTokens: 2, costUsd: 0.0004 });
    expect((sent[0] as { response_format: { type: string } }).response_format.type).toBe("json_schema");
  });

  it("retries server errors and replies that do not match the schema", async () => {
    const { fn } = fakeFetch(reply(502, { error: { message: "bad gateway" } }), ok('{"wrong":1}'), ok('{"answer":"third time"}'));
    const chat = createOpenRouterClient({ apiKey: "k", fetch: fn, retries: 2 });
    await expect(chat(request)).resolves.toMatchObject({ data: { answer: "third time" } });
  }, 10_000);

  it("does not retry a bad API key", async () => {
    const { fn, sent } = fakeFetch(reply(401, { error: { message: "No auth" } }), ok('{"answer":"never"}'));
    const chat = createOpenRouterClient({ apiKey: "k", fetch: fn, retries: 3 });
    await expect(chat(request)).rejects.toBeInstanceOf(LlmFatalError);
    expect(sent).toHaveLength(1);
  });
});
