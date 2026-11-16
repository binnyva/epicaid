/** Sampling Passages when a Subject has more of them than one call should take (ADR 0003). */

export const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * Picks Passages, in their original order, up to about `maxWords`. The latest ones always go in (they
 * hold "where things stand now"), and the rest are spread evenly over what came before, so early events
 * are not dropped wholesale. Deterministic: the same input always gives the same sample, which keeps
 * cached Summaries reproducible.
 */
export function samplePassages<T>(
  passages: readonly T[],
  maxWords: number,
  wordsOf: (passage: T) => number,
  keepLatest = 4,
): T[] {
  const words = passages.map(wordsOf);
  const total = words.reduce((a, b) => a + b, 0);
  if (total <= maxWords) return [...passages];

  const chosen = new Set<number>();
  let used = 0;
  for (let i = passages.length - 1; i >= 0 && chosen.size < keepLatest; i--) {
    if (used + words[i]! > maxWords && chosen.size > 0) break;
    chosen.add(i);
    used += words[i]!;
  }
  const earlier = passages.length - chosen.size;
  if (earlier > 0) {
    const average = total / passages.length;
    const room = Math.max(0, Math.floor((maxWords - used) / average));
    const step = earlier / Math.max(1, room);
    for (let k = 0; k < room; k++) {
      const i = Math.min(earlier - 1, Math.floor(k * step + step / 2));
      if (chosen.has(i) || used + words[i]! > maxWords) continue;
      chosen.add(i);
      used += words[i]!;
    }
  }
  return [...chosen].sort((a, b) => a - b).map((i) => passages[i]!);
}
