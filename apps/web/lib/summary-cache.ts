/**
 * The Summary cache: Upstash Redis over its REST API (plain fetch, no extra package). Redis only ever holds
 * cached Summaries and short locks, so losing it costs money, never data. Without UPSTASH_* set (local
 * development) it falls back to memory, which lasts until the server restarts.
 */
import { memoryCache, type SummaryCache } from "@epicaid/db";

function upstash(url: string, token: string): SummaryCache {
  const command = async (args: (string | number)[]): Promise<unknown> => {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    const json = (await res.json()) as { result?: unknown; error?: string };
    if (!res.ok || json.error) throw new Error(`Redis: ${json.error ?? res.status}`);
    return json.result;
  };
  return {
    get: async (key) => ((await command(["GET", key])) as string | null) ?? null,
    set: async (key, value, ttl) => void (await command(["SET", key, value, "EX", ttl])),
    del: async (key) => void (await command(["DEL", key])),
    lock: async (key, ttl) => (await command(["SET", key, "1", "NX", "EX", ttl])) === "OK",
    unlock: async (key) => void (await command(["DEL", key])),
  };
}

// On globalThis, because Next can load this module more than once per server (route handlers and pages), and
// the memory fallback must be one store.
const holder = globalThis as { epicaidSummaryCache?: SummaryCache };

export function getSummaryCache(): SummaryCache {
  if (holder.epicaidSummaryCache) return holder.epicaidSummaryCache;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  holder.epicaidSummaryCache = url && token ? upstash(url, token) : memoryCache();
  return holder.epicaidSummaryCache;
}
