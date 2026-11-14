/** Splits a Chapter's HTML into Passages: runs of whole paragraphs of roughly even size. */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Plain-text paragraphs of a chapter, without its heading. Line breaks inside verse are kept. */
export function chapterParagraphs(html: string): string[] {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return body
    .replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .split(/<\/(?:p|div|blockquote)>/i)
    .map((chunk) =>
      decode(chunk.replace(/<[^>]+>/g, ""))
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n"),
    )
    .filter((p) => p.length > 0);
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/**
 * Groups paragraphs into Passages of about `targetWords`. A Passage closes once it reaches the
 * target; a paragraph is never split, so one very long paragraph becomes a Passage on its own.
 */
export function splitPassages(paragraphs: string[], targetWords = 350): string[] {
  const passages: string[] = [];
  let current: string[] = [];
  let count = 0;
  for (const paragraph of paragraphs) {
    const n = words(paragraph);
    if (count > 0 && count + n > targetWords * 1.5) {
      passages.push(current.join("\n\n"));
      current = [];
      count = 0;
    }
    current.push(paragraph);
    count += n;
    if (count >= targetWords) {
      passages.push(current.join("\n\n"));
      current = [];
      count = 0;
    }
  }
  if (current.length) {
    // Fold a short tail into the previous Passage rather than leave a scrap.
    const tail = current.join("\n\n");
    const last = passages.at(-1);
    if (last !== undefined && count < targetWords / 3) passages[passages.length - 1] = `${last}\n\n${tail}`;
    else passages.push(tail);
  }
  return passages;
}
