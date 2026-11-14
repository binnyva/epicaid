/**
 * Reading Order form parsing. The form has one position box per Book in the Series;
 * a blank box leaves the Book out (Reading Orders may be partial).
 */
export interface OrderEntry {
  bookId: string;
  position: number;
}

export function parseOrderPositions(fields: Iterable<[string, string]>): OrderEntry[] {
  const entries: { bookId: string; rank: number }[] = [];
  for (const [key, raw] of fields) {
    if (!key.startsWith("pos:")) continue;
    const value = raw.trim();
    if (!value) continue;
    const rank = Number(value);
    if (!Number.isFinite(rank)) throw new Error(`"${value}" is not a number`);
    entries.push({ bookId: key.slice(4), rank });
  }
  // Renumber 0..n-1 so gaps and duplicates in what the admin typed don't matter; ties keep form order.
  return entries
    .map((e, i) => ({ ...e, i }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((e, position) => ({ bookId: e.bookId, position }));
}
