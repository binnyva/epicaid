/**
 * Merges the names found in each Passage into Subjects and Aliases.
 *
 * Names join a Subject in two ways:
 * - Their normalised forms match ("Captain Paran" and "Paran", "Lord Anomander Rake" and "Anomander Rake").
 * - A Passage itself says they are the same entity (the extraction's `sameEntity`).
 *
 * When a Passage links two names that had both already appeared separately, the link is
 * probably a reveal (ADR 0005): the later-introduced names get a Reveal Chapter and a review note.
 */
import type { ChapterExtraction, SubjectKind } from "./extract";

const TITLES = new Set(
  (
    "the a an lord lady sir master mistress captain sergeant corporal lieutenant commander fist high adjunct " +
    "mage wizard sorcerer sorceress priest priestess king queen prince princess emperor empress councillor " +
    "councilman bridgeburner"
  ).split(" "),
);

/** Words that, alone or only with titles, name a role rather than one entity ("the Adjunct", "High Fist"). */
const GENERIC = new Set([
  ...TITLES,
  ..."sarge staff warlord alchemist uncle aunt tyrant claw claws empire city god goddess of old young mother father brother sister elder".split(" "),
]);

const tokensOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^\p{L}\p{N}' -]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Lower-case name with leading titles dropped; "Captain Ganoes Paran" → "ganoes paran". */
export function normaliseName(name: string): string {
  const tokens = tokensOf(name);
  while (tokens.length > 1 && TITLES.has(tokens[0] as string)) tokens.shift();
  return tokens.join(" ");
}

/** True for names made only of titles and role words, which would join unrelated Subjects. */
export function isGenericName(name: string): boolean {
  return tokensOf(name).every((t) => GENERIC.has(t));
}

/** A text-stated link that was not applied automatically, for the admin to decide. */
export interface UnmergedLink {
  names: string[];
  chapterIndex: number;
  evidence: string;
  reason: string;
}

/** A late link joins two Subjects automatically only if the smaller one is this small (in Passages). */
const LATE_LINK_MAX_PASSAGES = 8;

interface Position {
  chapterIndex: number;
  passageIndex: number;
}
const before = (a: Position, b: Position) =>
  a.chapterIndex < b.chapterIndex || (a.chapterIndex === b.chapterIndex && a.passageIndex < b.passageIndex);

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root) as string;
    this.parent.set(x, root);
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

export interface MergedAlias {
  name: string;
  mentionCount: number;
  revealChapterIndex: number | null;
  reviewNote: string | null;
}

export interface MergedSubject {
  name: string;
  kind: SubjectKind;
  aliases: MergedAlias[];
  mentions: (Position & { alias: string })[];
}

export interface MergeResult {
  subjects: MergedSubject[];
  /** Links the text states but that were not applied; listed in the review report. */
  unmergedLinks: UnmergedLink[];
  /** Role-only names ("the Adjunct", "High Fist") left out of the catalogue. */
  genericNames: string[];
}

export function mergeSubjects(chapters: ChapterExtraction[]): MergeResult {
  const firstSeen = new Map<string, Position>();
  const counts = new Map<string, number>();
  const kinds = new Map<string, Map<SubjectKind, number>>();
  const mentions: (Position & { alias: string })[] = [];
  const links: (Position & { names: string[]; evidence: string })[] = [];
  const genericNames = new Set<string>();

  for (const chapter of chapters) {
    for (const passage of chapter.passages) {
      const pos = { chapterIndex: chapter.chapterIndex, passageIndex: passage.passageIndex };
      for (const { name, kind } of passage.mentions) {
        if (isGenericName(name)) {
          genericNames.add(name);
          continue;
        }
        if (!firstSeen.has(name)) firstSeen.set(name, pos);
        counts.set(name, (counts.get(name) ?? 0) + 1);
        const k = kinds.get(name) ?? new Map<SubjectKind, number>();
        k.set(kind, (k.get(kind) ?? 0) + 1);
        kinds.set(name, k);
        mentions.push({ ...pos, alias: name });
      }
      for (const group of passage.sameEntity) {
        const names = group.names.filter((n) => !isGenericName(n));
        if (names.length >= 2) links.push({ ...pos, names, evidence: group.evidence });
      }
    }
  }
  const kindOf = (name: string): SubjectKind =>
    [...(kinds.get(name) ?? new Map<SubjectKind, number>()).entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "other";

  // 1. Name groups: names with the same normalised form, plus a lone given/family name that
  //    matches exactly one longer name of the same kind ("Paran" → "Ganoes Paran").
  const byNorm = new UnionFind();
  const names = [...firstSeen.keys()];
  for (const name of names) byNorm.union(`n:${normaliseName(name)}`, name);
  const fullNames = names.filter((n) => normaliseName(n).includes(" "));
  for (const name of names) {
    const norm = normaliseName(name);
    if (norm.includes(" ")) continue;
    const matches = new Set(
      fullNames
        .filter((full) => kindOf(full) === kindOf(name) && normaliseName(full).split(" ").includes(norm))
        .map(normaliseName),
    );
    if (matches.size === 1) byNorm.union(`n:${[...matches][0]}`, name);
  }
  const groupOf = (name: string) => byNorm.find(name);
  const groupFirstSeen = new Map<string, Position>();
  const groupKindVotes = new Map<string, Map<SubjectKind, number>>();
  for (const name of names) {
    const g = groupOf(name);
    const pos = firstSeen.get(name) as Position;
    const current = groupFirstSeen.get(g);
    if (!current || before(pos, current)) groupFirstSeen.set(g, pos);
    const votes = groupKindVotes.get(g) ?? new Map<SubjectKind, number>();
    votes.set(kindOf(name), (votes.get(kindOf(name)) ?? 0) + (counts.get(name) ?? 0));
    groupKindVotes.set(g, votes);
  }
  const groupKind = (g: string) => [...(groupKindVotes.get(g) ?? [])].sort((x, y) => y[1] - x[1])[0]?.[0];

  // 2. Links from the text, in reading order, applied only between groups of the same kind
  //    (never a person with their people, home or weapon). A link between two groups that were
  //    both already known is a likely reveal: it joins automatically only when one side is small,
  //    and the later-introduced side gets the Reveal. Bigger late links go to the report instead.
  const subjects = new UnionFind();
  const clusterSize = new Map<string, number>();
  for (const name of names) {
    const g = groupOf(name);
    subjects.union(g, g);
    clusterSize.set(g, (clusterSize.get(g) ?? 0) + (counts.get(name) ?? 0));
  }
  const sizeOf = (g: string) => clusterSize.get(subjects.find(g)) ?? 0;
  const reveals = new Map<string, { chapterIndex: number; note: string }>();
  const unmergedLinks: UnmergedLink[] = [];
  links.sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0));
  for (const link of links) {
    const groups = [...new Set(link.names.filter((n) => firstSeen.has(n)).map(groupOf))];
    for (let i = 1; i < groups.length; i++) {
      const [a, b] = [groups[0] as string, groups[i] as string];
      if (subjects.find(a) === subjects.find(b)) continue;
      if (groupKind(a) !== groupKind(b)) {
        unmergedLinks.push({ ...link, reason: `different kinds (${groupKind(a)}, ${groupKind(b)})` });
        continue;
      }
      const fa = groupFirstSeen.get(a) as Position;
      const fb = groupFirstSeen.get(b) as Position;
      if (before(fa, link) && before(fb, link)) {
        if (Math.min(sizeOf(a), sizeOf(b)) > LATE_LINK_MAX_PASSAGES) {
          unmergedLinks.push({ ...link, reason: "both already well known; possible reveal, check by hand" });
          continue;
        }
        const later = before(fa, fb) ? b : a;
        const earlierName = link.names.find((n) => firstSeen.has(n) && groupOf(n) !== later) ?? "";
        reveals.set(later, {
          chapterIndex: link.chapterIndex,
          note: `Joined to "${earlierName}" in chapter ${link.chapterIndex}: "${link.evidence}"`,
        });
      }
      const merged = sizeOf(a) + sizeOf(b);
      subjects.union(a, b);
      clusterSize.set(subjects.find(a), merged);
    }
  }

  // 3. Build Subjects.
  const clusters = new Map<string, string[]>();
  for (const name of names) {
    const root = subjects.find(groupOf(name));
    clusters.set(root, [...(clusters.get(root) ?? []), name]);
  }
  const mentionsByName = new Map<string, (Position & { alias: string })[]>();
  for (const m of mentions) mentionsByName.set(m.alias, [...(mentionsByName.get(m.alias) ?? []), m]);

  const result: MergedSubject[] = [];
  for (const members of clusters.values()) {
    const aliases: MergedAlias[] = members.map((name) => {
      const reveal = reveals.get(groupOf(name));
      return {
        name,
        mentionCount: counts.get(name) ?? 0,
        revealChapterIndex: reveal?.chapterIndex ?? null,
        reviewNote: reveal?.note ?? null,
      };
    });
    const ordinary = aliases.filter((a) => a.revealChapterIndex === null);
    const pool = ordinary.length ? ordinary : aliases;
    const canonical = [...pool].sort((x, y) => y.mentionCount - x.mentionCount || y.name.length - x.name.length)[0] as MergedAlias;
    const kindVotes = new Map<SubjectKind, number>();
    for (const name of members) for (const [k, n] of kinds.get(name) ?? []) kindVotes.set(k, (kindVotes.get(k) ?? 0) + n);
    const kind = [...kindVotes.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "other";
    result.push({
      name: canonical.name,
      kind,
      aliases: aliases.sort((x, y) => y.mentionCount - x.mentionCount),
      mentions: members.flatMap((name) => mentionsByName.get(name) ?? []),
    });
  }
  return {
    subjects: result.sort((a, b) => b.mentions.length - a.mentions.length),
    unmergedLinks,
    genericNames: [...genericNames].sort(),
  };
}

/** Number of distinct Passages that mention a Subject. */
export function passageCount(subject: MergedSubject): number {
  return new Set(subject.mentions.map((m) => `${m.chapterIndex}:${m.passageIndex}`)).size;
}
