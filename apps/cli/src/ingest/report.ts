/** A Markdown review report written next to the extracted Book, for checking the catalogue before Phase 2's admin exists. */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtractedBook } from "./book";
import { passageCount, type MergedSubject } from "./merge";

export async function writeReport(book: ExtractedBook, subjects: MergedSubject[], majorThreshold: number): Promise<string> {
  const file = path.join(book.folder, "extracted", "ingest-report.md");
  const label = (i: number | null) => (i === null ? "" : (book.chapters[i]?.label ?? `#${i}`));
  const majors = subjects.filter((s) => passageCount(s) >= majorThreshold);
  const flagged = subjects.flatMap((s) => s.aliases.filter((a) => a.reviewNote).map((a) => ({ subject: s, alias: a })));
  const singles = subjects.filter((s) => passageCount(s) === 1);

  const lines = [
    `# Ingestion report: ${book.title}`,
    "",
    `${subjects.length} Subjects, ${majors.length} Major (in ${majorThreshold}+ Passages), ${singles.length} mentioned in only one Passage.`,
    "",
    "## Possible secret identities",
    "",
    flagged.length
      ? "These Aliases were joined to a Subject late in the Book. Check that the Reveal Chapter is right, or split them."
      : "None found.",
    "",
    ...flagged.map(
      ({ subject, alias }) => `- **${alias.name}** → ${subject.name}, Reveal: ${label(alias.revealChapterIndex)}. ${alias.reviewNote}`,
    ),
    "",
    "## Subjects by number of Passages",
    "",
    "| Subject | Kind | Passages | Aliases |",
    "| --- | --- | --- | --- |",
    ...subjects
      .filter((s) => passageCount(s) > 1)
      .map((s) => `| ${s.name} | ${s.kind} | ${passageCount(s)} | ${s.aliases.map((a) => a.name).join(", ")} |`),
    "",
    "## Mentioned once",
    "",
    singles.map((s) => s.name).join(", "),
    "",
  ];
  await writeFile(file, lines.join("\n"));
  return file;
}
