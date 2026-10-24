/*
 * TWIN of stable-sort/src.ts: same exported API and the same CONTRACT (see src.ts).
 * Differs only where the CONTRACT is silent; each difference is marked TWIN-DIFF.
 */

type KeyFn<T> = (item: T) => number;

function checkedKey<T>(item: T, key: KeyFn<T>): number {
  const k = key(item);
  if (!Number.isFinite(k)) {
    // TWIN-DIFF: throws RangeError with other text (the CONTRACT leaves class and message unspecified).
    throw new RangeError(`non-finite key: ${String(k)}`);
  }
  return k;
}

function sortWith<T>(items: readonly T[], key: KeyFn<T>, direction: 1 | -1): T[] {
  const decorated = items.map((item, position) => ({ item, position, k: checkedKey(item, key) }));
  // TWIN-DIFF: decorate-sort-undecorate with a position tie-break instead of an insertion sort (same order).
  decorated.sort((a, b) => (a.k === b.k ? a.position - b.position : a.k < b.k ? -direction : direction));
  return decorated.map((d) => d.item);
}

export function sortBy<T>(items: readonly T[], key: KeyFn<T>): T[] {
  return sortWith(items, key, 1);
}

export function sortByDesc<T>(items: readonly T[], key: KeyFn<T>): T[] {
  return sortWith(items, key, -1);
}

export function isSortedBy<T>(items: readonly T[], key: KeyFn<T>): boolean {
  // TWIN-DIFF: validates and compares in one pass, so key may be called in a different order.
  let previous: number | undefined;
  let sorted = true;
  for (const item of items) {
    const k = checkedKey(item, key);
    if (previous !== undefined && previous > k) sorted = false;
    previous = k;
  }
  return sorted;
}
