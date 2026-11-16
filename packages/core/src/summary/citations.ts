/**
 * The citation check (build plan, Phase 4): the last guard between the model's reply and the Reader.
 * A sentence survives only if it cites at least one real source, every source it cites exists, and it
 * names no one the Reader must not see named here.
 */
import type { SummaryReply } from "../llm/prompts";

export interface CheckedSentence {
  text: string;
  /** Source numbers, de-duplicated and sorted. */
  sources: number[];
}

export interface CheckedSummary {
  paragraphs: CheckedSentence[][];
  /** Sentences removed, with the reason, for logging and the admin queue. */
  dropped: { text: string; reason: "uncited" | "bad-citation" | "forbidden-name" }[];
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when `name` appears in `text` as whole words, ignoring case. */
export function containsName(text: string, name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(n)}($|[^\\p{L}\\p{N}])`, "iu").test(text);
}

/**
 * @param sourceNumbers the numbers of the sources the model was given; anything else is a made-up citation.
 * @param forbiddenNames names that must not appear: Aliases outside the boundary, and Aliases of this
 *   Subject whose Reveal is outside it (ADR 0005). A sentence naming one is dropped even if it is cited,
 *   because the model may have brought the name in from its own knowledge of the books.
 */
export function checkCitations(
  reply: SummaryReply,
  sourceNumbers: ReadonlySet<number>,
  forbiddenNames: readonly string[] = [],
  /**
   * Names the Reader has reached. They are masked before the name check, so "Rake" (unreached on its own)
   * does not trip on "Anomander Rake" (reached).
   */
  allowedNames: readonly string[] = [],
): CheckedSummary {
  const allowed = [...allowedNames].filter((a) => !forbiddenNames.some((f) => f.toLowerCase() === a.toLowerCase()));
  allowed.sort((a, b) => b.length - a.length);
  const mask = (text: string) =>
    allowed.reduce(
      (t, name) => t.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}(?=$|[^\\p{L}\\p{N}])`, "giu"), "$1\u2022"),
      text,
    );
  const dropped: CheckedSummary["dropped"] = [];
  const paragraphs: CheckedSentence[][] = [];
  for (const paragraph of reply.paragraphs) {
    const kept: CheckedSentence[] = [];
    for (const sentence of paragraph.sentences) {
      // Strip any [3]-style markers the model wrote into the text as well.
      const text = sentence.text.replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, "").trim();
      if (!text) continue;
      const sources = [...new Set(sentence.sources)].sort((a, b) => a - b);
      if (!sources.length) {
        dropped.push({ text, reason: "uncited" });
      } else if (sources.some((n) => !sourceNumbers.has(n))) {
        dropped.push({ text, reason: "bad-citation" });
      } else if (forbiddenNames.some((name) => containsName(mask(text), name))) {
        dropped.push({ text, reason: "forbidden-name" });
      } else {
        kept.push({ text, sources });
      }
    }
    if (kept.length) paragraphs.push(kept);
  }
  return { paragraphs, dropped };
}

/**
 * Capitalised word runs (1 to 4 words) in a text, lower-cased: the candidates for names the model may have
 * used. They are checked against the catalogue to find names outside the boundary.
 */
export function nameCandidates(text: string): string[] {
  const out = new Set<string>();
  const connectors = new Set(["of", "the", "de", "da", "van", "von", "al", "en"]);
  for (const sentence of text.split(/[.!?;:]\s+|\n+/)) {
    const words = sentence.split(/[\s,()"“”]+/).map((w) => w.replace(/^[^\p{L}]+|[^\p{L}']+$/gu, "").replace(/'s$/i, ""));
    for (let i = 0; i < words.length; i++) {
      if (!/^\p{Lu}/u.test(words[i] ?? "")) continue;
      let phrase = "";
      for (let j = i; j < Math.min(words.length, i + 6); j++) {
        const w = words[j]!;
        if (!w) break;
        const capital = /^\p{Lu}/u.test(w);
        if (!capital && !connectors.has(w.toLowerCase())) break;
        phrase = phrase ? `${phrase} ${w}` : w;
        if (capital) out.add(phrase.toLowerCase());
      }
    }
  }
  return [...out];
}
