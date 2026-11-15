/** Grouping Chapters into the open-and-close cards of the Position screen. */

export interface PickerChapter {
  index: number;
  label: string;
  title: string | null;
  part: string | null;
}

export interface ChapterGroup {
  key: string;
  name: string;
  chapters: PickerChapter[];
}

/**
 * Consecutive Chapters in the same part share a card. A Chapter with no part (a Prologue)
 * gets a card of its own, unless the Book has no parts at all, when everything is one card.
 */
export function groupByPart(chapters: readonly PickerChapter[]): ChapterGroup[] {
  if (!chapters.some((c) => c.part)) return chapters.length ? [{ key: "all", name: "Chapters", chapters: [...chapters] }] : [];
  const groups: ChapterGroup[] = [];
  for (const c of chapters) {
    const last = groups.at(-1);
    if (c.part && last && last.chapters[0]!.part === c.part) last.chapters.push(c);
    else groups.push({ key: `g${c.index}`, name: c.part ?? c.label, chapters: [c] });
  }
  return groups;
}

/** "Chapters One to Four" when the labels share a "Chapter" prefix, else "Prologue to Chapter Two". */
export function rangeText(chapters: readonly PickerChapter[]): string {
  const first = chapters[0];
  const last = chapters.at(-1);
  if (!first || !last) return "";
  if (first === last) return first.label;
  const prefix = /^Chapter\s+/i;
  if (prefix.test(first.label) && prefix.test(last.label)) {
    return `Chapters ${first.label.replace(prefix, "")} to ${last.label.replace(prefix, "")}`;
  }
  return `${first.label} to ${last.label}`;
}

/** The muted line under a part's name. `finishedThrough` is the last finished Chapter index, or null. */
export function groupNote(group: ChapterGroup, finishedThrough: number | null): string {
  const done = finishedThrough !== null && group.chapters.every((c) => c.index <= finishedThrough);
  const single = group.chapters.length === 1 && group.name === group.chapters[0]!.label;
  if (single) return done ? "Finished" : (group.chapters[0]!.title ?? "");
  const range = rangeText(group.chapters);
  return done ? `${range} · finished` : range;
}

/** How a Chapter reads in a picker row: its label, plus its title when it has one. */
export const chapterName = (c: PickerChapter) => (c.title && c.title !== c.label ? `${c.label}: ${c.title}` : c.label);
