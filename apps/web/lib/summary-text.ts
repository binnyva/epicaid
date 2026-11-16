/** Words around a Summary: what it was built from, and what the Reader sees when one can't be written. */
import type { SummaryEntry, SummaryError } from "@epicaid/db";

export type SummaryErrorCode = SummaryError["code"] | "not-visible";

export type SummaryStreamLine =
  | { type: "progress"; text: string }
  | { type: "summary"; entry: SummaryEntry }
  | { type: "error"; code: SummaryErrorCode; message: string };

const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** "Written from the Book Summary of Gardens of the Moon and 4 Passages in Chapters One to Three of Deadhouse Gates." */
export function basisSentence(entry: SummaryEntry): string {
  const { basis } = entry;
  const parts: string[] = [];
  if (basis.bookSummaries.length) {
    parts.push(`the Book Summar${basis.bookSummaries.length === 1 ? "y" : "ies"} of ${list(basis.bookSummaries)}`);
  }
  if (basis.passageBooks.length) parts.push(`its Passages in ${list(basis.passageBooks)}`);
  if (basis.currentBook && basis.currentPassages) {
    const span =
      basis.firstChapter && basis.lastChapter && basis.firstChapter !== basis.lastChapter
        ? `${basis.firstChapter} to ${basis.lastChapter}`
        : (basis.firstChapter ?? "");
    const sampled =
      basis.currentPassagesAvailable > basis.currentPassages ? ` (a sample of ${basis.currentPassagesAvailable})` : "";
    parts.push(
      `${basis.currentPassages} Passage${basis.currentPassages === 1 ? "" : "s"}${sampled} in ${span} of ${basis.currentBook}`,
    );
  }
  return `Written from ${list(parts)}.`;
}

export const ERROR_TEXT: Record<SummaryErrorCode, { title: string; body: string; retry: boolean }> = {
  "reader-cap": {
    title: "That's today's new Summaries",
    body: "You've reached today's limit for writing new Summaries. Summaries someone has already looked up at your place in the books still open, and the limit resets at midnight UTC.",
    retry: false,
  },
  "global-cap": {
    title: "Epic Aid has reached today's limit",
    body: "New Summaries are paused until midnight UTC to keep costs down. Summaries someone has already looked up at your place in the books still open.",
    retry: false,
  },
  "empty-after-check": {
    title: "No Summary we could check",
    body: "The model's answer had no sentence that cited what you've read, so nothing is shown rather than something unchecked.",
    retry: true,
  },
  "nothing-to-summarise": {
    title: "Nothing to go on yet",
    body: "The Chapters you've read don't say enough about this yet.",
    retry: false,
  },
  llm: { title: "The Summary didn't come through", body: "Something went wrong while writing it. Nothing was saved.", retry: true },
  "not-visible": { title: "No match", body: "This isn't something you can look up from where you are in the books.", retry: false },
};

export interface CitationChip {
  label: string;
  /** Every source the sentence cites under this label: two Passages of one Chapter share one chip. */
  sources: number[];
  title: string;
}

/** One chip per distinct label, in citation order: "Ch 5" once, not "Ch 5, Ch 5". */
export function citationChips(cited: readonly number[], sources: SummaryEntry["sources"]): CitationChip[] {
  const byN = new Map(sources.map((s) => [s.n, s]));
  const chips: CitationChip[] = [];
  for (const n of cited) {
    const source = byN.get(n);
    if (!source) continue;
    const chip = chips.find((c) => c.label === source.chip);
    if (chip) chip.sources.push(n);
    else chips.push({ label: source.chip, sources: [n], title: source.heading });
  }
  return chips;
}
