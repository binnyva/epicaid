import { createOpenRouterClient, type ChatJson } from "@epicaid/core";

let client: ChatJson | undefined;

/** The OpenRouter client for Summaries. Fewer retries than Ingestion: a Reader is waiting. */
export function getChatJson(): ChatJson {
  if (client) return client;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  client = createOpenRouterClient({ apiKey, retries: 1 });
  return client;
}
