/*
 * CONTRACT - stable-sort
 *
 * sortBy(items, key): T[]
 *   - returns a new array ordered by ascending key(item); the input array is not modified
 *   - stable: items whose keys are equal keep their input order
 * sortByDesc(items, key): T[]
 *   - like sortBy but ordered by descending key; still stable (equal keys keep input order)
 * isSortedBy(items, key): boolean
 *   - true when key(a) <= key(b) for every adjacent pair (a, b); true for zero or one item
 * Every function throws an error when key returns a value that is not a finite number.
 *
 * Not specified: how many times key is called; the class and the message of the error.
 */

type KeyFn<T> = (item: T) => number;

function keysOf<T>(items: readonly T[], key: KeyFn<T>): number[] {
  const keys: number[] = [];
  for (const item of items) {
    const k = key(item);
    if (!Number.isFinite(k)) {
      throw new TypeError(`sort key must be a finite number, got ${String(k)}`);
    }
    keys.push(k);
  }
  return keys;
}

/** Insertion sort over positions; stable because only strictly greater keys are moved right. */
function sortedPositions(keys: readonly number[], direction: 1 | -1): number[] {
  const order: number[] = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]! * direction;
    let j = order.length - 1;
    while (j >= 0 && keys[order[j]!]! * direction > k) {
      order[j + 1] = order[j]!;
      j -= 1;
    }
    order[j + 1] = i;
  }
  return order;
}

function sortWith<T>(items: readonly T[], key: KeyFn<T>, direction: 1 | -1): T[] {
  const keys = keysOf(items, key);
  return sortedPositions(keys, direction).map((position) => items[position]!);
}

export function sortBy<T>(items: readonly T[], key: KeyFn<T>): T[] {
  return sortWith(items, key, 1);
}

export function sortByDesc<T>(items: readonly T[], key: KeyFn<T>): T[] {
  return sortWith(items, key, -1);
}

export function isSortedBy<T>(items: readonly T[], key: KeyFn<T>): boolean {
  const keys = keysOf(items, key);
  for (let i = 1; i < keys.length; i += 1) {
    if (keys[i - 1]! > keys[i]!) return false;
  }
  return true;
}
