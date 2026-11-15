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
  /** Reasoning effort. Unset leaves the model's default, which for many models is reasoning on. */
  reasoning?: ReasoningEffort;
}

export interface ChatJsonResult<T> {
  data: T;
  usage: LlmUsage;
}

export type ChatJson = <T extends z.ZodType>(req: ChatJsonRequest<T>) => Promise<ChatJsonResult<z.infer<T>>>;

export class LlmError extends Error {}
/** An error that retrying will not fix, such as a bad API key or an unknown model. */
export class LlmFatalError extends LlmError {}

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
  if (start === -1 || end < start) throw new LlmError("Reply contained no JSON object");
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
    const body = {
      model: req.model,
      temperature: req.temperature ?? 0,
      max_tokens: req.maxTokens,
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

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      try {
        const res = await doFetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
            "X-Title": options.appName ?? "Epic Aid",
          },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as OpenRouterResponse;
        if (!res.ok || json.error) {
          const message = json.error?.message ?? `HTTP ${res.status}`;
          // 4xx other than rate limits won't succeed on retry.
          if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new LlmFatalError(message);
          lastError = new LlmError(message);
          continue;
        }
        const content = json.choices?.[0]?.message?.content;
        if (!content) {
          // Reasoning models can spend the whole token budget thinking and return no content.
          lastError = new LlmError(`Empty reply (finish_reason: ${json.choices?.[0]?.finish_reason ?? "unknown"})`);
          continue;
        }
        const parsed = req.schema.safeParse(parseJsonReply(content));
        if (!parsed.success) {
          lastError = new LlmError(`Reply did not match schema: ${parsed.error.message}`);
          continue;
        }
        return {
          data: parsed.data,
          usage: {
            model: json.model ?? req.model,
            promptTokens: json.usage?.prompt_tokens ?? 0,
            completionTokens: json.usage?.completion_tokens ?? 0,
            reasoningTokens: json.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
            costUsd: json.usage?.cost ?? 0,
          },
        };
      } catch (error) {
        if (error instanceof LlmFatalError) throw error;
        lastError = error; // network failure or unparseable reply: retry
      }
    }
    throw lastError instanceof Error ? lastError : new LlmError(String(lastError));
  };
}
