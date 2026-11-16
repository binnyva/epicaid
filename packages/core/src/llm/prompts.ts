/**
 * Prompts and reply schemas. Bump a version whenever its prompt or schema changes:
 * versions are part of cache keys and stored with every Book Summary.
 */
import { z } from "zod";

export const SUBJECT_KINDS = ["character", "place", "artefact", "faction", "other"] as const;

// ---------- Extraction (Ingestion, one call per Passage) ----------

export const EXTRACTION_PROMPT_VERSION = "1";

export const extractionSchema = z.strictObject({
  mentions: z.array(
    z.strictObject({
      name: z.string().describe("The name exactly as it is written in the passage"),
      kind: z.enum(SUBJECT_KINDS),
    }),
  ),
  sameEntity: z.array(
    z.strictObject({
      names: z.array(z.string()).describe("Two or more names from `mentions` that this passage itself shows are the same entity"),
      evidence: z.string().describe("A short quote from the passage that shows it"),
    }),
  ),
});

export type Extraction = z.infer<typeof extractionSchema>;

export const EXTRACTION_SYSTEM = `You index the text of a novel for a reader's memory aid. You will get one passage.

List every named character, place, artefact (named object, weapon, ship), and faction (army, guild, order, house, people) mentioned in the passage.
- "name" must be copied exactly as it appears in the passage, including titles if attached (e.g. "Captain Paran", "High Mage Tayschrenn").
- Include each distinct name once, even if repeated.
- Skip pronouns and unnamed descriptions ("the old woman", "the sergeant") unless used as a proper name.
- Skip real-world or out-of-story words, and gods' names used only as oaths unless the god acts in the passage.

In "sameEntity", group names that THIS PASSAGE shows refer to the same entity, for example a person introduced by full name and then by a nickname, or a character revealed to be someone else. Quote the evidence.

Use only the passage. You may know this book; ignore everything you know about it. Never link names because of outside knowledge, and never add names that are not in the passage.`;

export function extractionUserPrompt(passage: string): string {
  return `Passage:\n"""\n${passage}\n"""`;
}

// ---------- Book Summary (one per Subject per Book) ----------

export const BOOK_SUMMARY_PROMPT_VERSION = "1";

export const bookSummarySchema = z.strictObject({
  summary: z.string(),
});

export const BOOK_SUMMARY_SYSTEM = `You write reference notes for a reader's memory aid. You will get every passage of one book that mentions one subject, in reading order, each labelled with its chapter.

Write what this book reveals about the subject: who or what it is, key relationships, what it does or what happens to it, in story order, and where it is last seen. 150-400 words of plain prose.
- After each sentence, cite the chapter(s) it comes from in square brackets, e.g. [Chapter Three].
- Use only the passages. You may know this book or its sequels; ignore that completely. Never mention events, identities, deaths or fates that the passages do not state.
- If the passages call the subject by several names, use the names they use.`;

export function bookSummaryUserPrompt(input: {
  subjectName: string;
  aliases: string[];
  bookTitle: string;
  passages: { chapterLabel: string; text: string }[];
}): string {
  const names = input.aliases.filter((a) => a !== input.subjectName);
  const header = `Subject: ${input.subjectName}${names.length ? ` (also called: ${names.join(", ")})` : ""}\nBook: ${input.bookTitle}\n`;
  const body = input.passages.map((p) => `[${p.chapterLabel}]\n${p.text}`).join("\n\n---\n\n");
  return `${header}\nPassages:\n\n${body}`;
}

// ---------- Summary (one per Subject per Spoiler Boundary, written in the reader app) ----------

export const SUMMARY_PROMPT_VERSION = "1";

export const summarySchema = z.strictObject({
  paragraphs: z.array(
    z.strictObject({
      sentences: z.array(
        z.strictObject({
          text: z.string().describe("One sentence, without any citation markers"),
          sources: z.array(z.number().int()).describe("The numbers of the sources this sentence comes from"),
        }),
      ),
    }),
  ),
});

export type SummaryReply = z.infer<typeof summarySchema>;

export const SUMMARY_SYSTEM = `You write a short memory aid for someone partway through a long book series. They have forgotten who or what the subject is and want a reminder of what the books have told them so far.

You will get numbered sources: summaries of whole books the reader has finished, and passages from the book they are reading now, in story order. They are everything the reader has read about the subject. They are not everything there is.

Write 2 to 4 short paragraphs, 120-300 words in all: who or what the subject is, key relationships, what has happened to it so far in story order, and where things stand at the latest source.
- Every sentence must list the number(s) of the source(s) it comes from in "sources". A sentence you cannot tie to a source must be left out.
- Use only the sources. You may know these books; ignore everything you know about them. Never hint at what comes later, never guess at hidden identities, motives or fates, and never say that something "will" happen or "turns out" to be so.
- Call the subject and everyone else only by names the sources use.
- Plain, friendly prose. No headings, no lists, no quotations longer than a few words.`;

export interface SummarySource {
  /** 1-based number the model cites. */
  n: number;
  /** "Book Summary of Gardens of the Moon" or "Deadhouse Gates, Chapter Three". */
  heading: string;
  text: string;
}

export function summaryUserPrompt(input: {
  subjectName: string;
  otherNames: string[];
  finishedBooks: string[];
  current: { bookTitle: string; through: string } | null;
  sources: SummarySource[];
}): string {
  const lines = [`Subject: ${input.subjectName}${input.otherNames.length ? ` (also called: ${input.otherNames.join(", ")})` : ""}`];
  if (input.finishedBooks.length) lines.push(`Books the reader has finished: ${input.finishedBooks.join("; ")}`);
  if (input.current) lines.push(`Reading now: ${input.current.bookTitle}, finished up to ${input.current.through}`);
  const body = input.sources.map((s) => `[${s.n}] ${s.heading}\n${s.text}`).join("\n\n---\n\n");
  return `${lines.join("\n")}\n\nSources:\n\n${body}`;
}
