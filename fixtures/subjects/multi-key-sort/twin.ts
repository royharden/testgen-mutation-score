/*
 * CONTRACT - multi-key-sort
 * sortByKeys(items, specs): new array sorted lexicographically by the numeric keys in specs.
 * Each spec has key(item) and optional direction ("asc" by default, or "desc").
 * Fully equal key vectors keep input order; an empty specs array preserves input order.
 * isSortedByKeys(items, specs): true exactly when adjacent items follow that same order.
 * Both functions leave input arrays unchanged and throw if any key is not finite.
 * Key functions must be pure and return the same number for the same item.
 * Not specified: key-call counts, sorting algorithm, error class or message.
 */

export interface SortKey<T> {
  key: (item: T) => number;
  direction?: "asc" | "desc";
}

function keyRows<T>(items: readonly T[], specs: readonly SortKey<T>[]): number[][] {
  return items.map((item) => specs.map((spec) => {
    const value = spec.key(item);
    // TWIN-DIFF: different error class for invalid keys; class is unspecified.
    if (!Number.isFinite(value)) throw new Error("nonfinite multi-key value");
    return spec.direction === "desc" ? -value : value;
  }));
}

function compare(a: readonly number[], b: readonly number[]): number {
  for (let k = 0; k < a.length; k += 1) {
    if (a[k]! < b[k]!) return -1;
    if (a[k]! > b[k]!) return 1;
  }
  return 0;
}

export function sortByKeys<T>(items: readonly T[], specs: readonly SortKey<T>[]): T[] {
  const rows = keyRows(items, specs);
  const order: number[] = [];
  const n = rows.length;
  for (let i = 0; i < n; i += 1) {
    let at = order.length;
    while (at > 0 && compare(rows[order[at - 1]!]!, rows[i]!) > 0) {
      order[at] = order[at - 1]!;
      at -= 1;
    }
    order[at] = i;
  }
  return order.map((position) => items[position]!);
}

export function isSortedByKeys<T>(items: readonly T[], specs: readonly SortKey<T>[]): boolean {
  const rows = keyRows(items, specs);
  for (let i = 1; i < rows.length; i += 1) {
    if (compare(rows[i - 1]!, rows[i]!) > 0) return false;
  }
  return true;
}
