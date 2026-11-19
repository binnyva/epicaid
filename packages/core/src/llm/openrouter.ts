/**
 * Minimal OpenRouter chat client that asks for JSON matching a schema and validates it.
 * The model is always passed in, so it can be switched per call (admin setting, CLI flag).
 */
import { z } from "zod";

export interface LlmUsage {
  model: string;
  promptTokens: number;
  /** Includes reasoning tokens: they are billed as output. */
  completionTokens: number;
  /** The part of completionTokens the model spent thinking before it answered. */
  reasoningTokens: number;
  costUsd: number;
}

/**
 * OpenRouter's reasoning effort levels. "none" turns reasoning off. Each model accepts only some of these
 * (DeepSeek V4: none, low, high, max) and OpenRouter maps or rejects the rest; a model whose reasoning is
 * mandatory rejects "none".
 */
export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export function parseReasoningEffort(value: string, flag: string): ReasoningEffort {
  if ((REASONING_EFFORTS as readonly string[]).includes(value)) return value as ReasoningEffort;
  throw new Error(`${flag} must be one of ${REASONING_EFFORTS.join(", ")} (got "${value}")`);
}

export interface ChatJsonRequest<T extends z.ZodType> {
  model: string;
  system: string;
  user: string;
  schema: T;
  /** Name for the JSON schema sent to the provider. */
  schemaName: string;
  temperature?: number;
  /** Covers reasoning tokens and the reply together. */
  maxTokens?: number;
  /**
   * When a reply is cut off at maxTokens, the next attempt doubles the budget, up to this ceiling (default 4x
   * maxTokens). Retrying at the same budget would just be cut off again, so only the calls that need more pay
   * for more.
   */
  maxTokensCeiling?: number;
  /** Reasoning effort. Unset leaves the model's default, which for many models is reasoning on. */
  reasoning?: ReasoningEffort;
}

export interface ChatJsonResult<T> {
  data: T;
  usage: LlmUsage;
}

export type ChatJson = <T extends z.ZodType>(req: ChatJsonRequest<T>) => Promise<ChatJsonResult<z.infer<T>>>;

export class LlmError extends Error {
  /** What the failed attempts cost: they are billed even though they produced nothing usable. */
  usage?: LlmUsage;
}
/** An error that retrying will not fix, such as a bad API key or an unknown model. */
export class LlmFatalError extends LlmError {}
/** The reply hit max_tokens and the budget could not grow, e.g. a model stuck repeating itself. */
export class LlmCutOffError extends LlmError {}

interface OpenRouterResponse {
  model?: string;
  choices?: { finish_reason?: string | null; message?: { content?: string | null } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
    cost?: number;
  };
  error?: { message?: string };
}

/** Pulls the JSON object out of a reply, tolerating ```json fences some models add. */
export function parseJsonReply(content: string): unknown {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const body = fenced?.[1] ?? trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1) throw new LlmError("Reply contained no JSON object");
  if (end < start) throw new LlmError("Reply JSON was cut off before it ended");
  return JSON.parse(body.slice(start, end + 1));
}

export function createOpenRouterClient(options: {
  apiKey: string;
  fetch?: typeof fetch;
  retries?: number;
  appName?: string;
}): ChatJson {
  const doFetch = options.fetch ?? fetch;
  const retries = options.retries ?? 3;

  return async function chatJson<T extends z.ZodType>(req: ChatJsonRequest<T>) {
    const base = {
      model: req.model,
      temperature: req.temperature ?? 0,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: req.schemaName, strict: true, schema: z.toJSONSchema(req.schema) },
      },
      usage: { include: true },
      // exclude: we never read the reasoning text, so don't send it back.
      ...(req.reasoning ? { reasoning: { effort: req.reasoning, exclude: true } } : {}),
    };
    let maxTokens = req.maxTokens;
    const ceiling = req.maxTokensCeiling ?? (maxTokens === undefined ? undefined : maxTokens * 4);
    // Every attempt is billed, so add them all up.
    const spent: LlmUsage = { model: req.model, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, costUsd: 0 };

    const fail = (error: unknown): LlmError => {
      const e = error instanceof LlmError ? error : new LlmError(error instanceof Error ? error.message : String(error));
      e.usage = spent;
      return e;
    };

    let lastError: unknown;
    let backoff = true;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0 && backoff) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      backoff = true;
      try {
        const res = await doFetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
            "X-Title": options.appName ?? "Epic Aid",
          },
          body: JSON.stringify({ ...base, max_tokens: maxTokens }),
        });
        const json = (await res.json()) as OpenRouterResponse;
        if (!res.ok || json.error) {
          const message = json.error?.message ?? `HTTP ${res.status}`;
          // 4xx other than rate limits won't succeed on retry.
          if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new LlmFatalError(message);
          lastError = new LlmError(message);
          continue;
        }
        spent.model = json.model ?? spent.model;
        spent.promptTokens += json.usage?.prompt_tokens ?? 0;
        spent.completionTokens += json.usage?.completion_tokens ?? 0;
        spent.reasoningTokens += json.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
        spent.costUsd += json.usage?.cost ?? 0;

        const finishReason = json.choices?.[0]?.finish_reason;
        const content = json.choices?.[0]?.message?.content;
        let problem: string;
        if (!content) {
          problem = `Empty reply (finish_reason: ${finishReason ?? "unknown"})`;
        } else {
          try {
            const parsed = req.schema.safeParse(parseJsonReply(content));
            if (parsed.success) return { data: parsed.data, usage: { ...spent } };
            problem = `Reply did not match schema: ${parsed.error.message}`;
          } catch (error) {
            problem = error instanceof Error ? error.message : String(error);
          }
        }

        if (finishReason === "length") {
          // The model ran out of max_tokens, usually while reasoning, so the answer is missing or half written.
          lastError = new LlmCutOffError(
            `Reply cut off at max_tokens ${maxTokens ?? "(provider limit)"}${content ? " partway through the answer" : " before it started answering"}`,
          );
          // The same budget would be cut off again: grow it, or stop if it can't grow.
          if (maxTokens === undefined || ceiling === undefined || maxTokens >= ceiling) break;
          maxTokens = Math.min(maxTokens * 2, ceiling);
          backoff = false;
          continue;
        }
        lastError = new LlmError(problem);
      } catch (error) {
        if (error instanceof LlmFatalError) throw fail(error);
        lastError = error; // network failure: retry
      }
    }
    throw fail(lastError);
  };
}
