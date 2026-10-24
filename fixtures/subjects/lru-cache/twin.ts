/*
 * CONTRACT - lru-cache
 * new LruCache<T>(capacity): positive integer capacity, otherwise throws an error.
 * set(key, value): stores a string key as most recent. Updating replaces its value and touches it.
 * If a new key exceeds capacity, evicts and returns the least recent value; otherwise undefined.
 * get(key): returns the value and touches an existing key; missing keys give undefined.
 * peek(key): returns a value without touching it; missing keys give undefined.
 * delete(key): removes the key, returning true if present, false otherwise.
 * size: number of entries; keys(): a new array of string keys from least to most recent.
 * keyAt(index): key at zero-based recency index, throws RangeError unless integer 0 <= index < size.
 * Values may be undefined; presence is determined by key, not by its value.
 * Not specified: constructor error class/message, other error messages, storage algorithm.
 */

const DEBUG_CACHE = false;

export class LruCache<T> {
  readonly capacity: number;
  private readonly entries: { key: string; value: T }[] = [];

  constructor(capacity: number) {
    // TWIN-DIFF: different constructor error class; that class is unspecified.
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("invalid cache capacity");
    this.capacity = capacity;
  }

  get size(): number {
    return this.entries.length;
  }

  set(key: string, value: T): T | undefined {
    const at = this.entries.findIndex((entry) => entry.key === key);
    if (at >= 0) this.entries.splice(at, 1);
    this.entries.push({ key, value });
    let evicted: T | undefined;
    if (this.entries.length > this.capacity) evicted = this.entries.shift()!.value;
    if (DEBUG_CACHE) {
      if (this.entries.length > this.capacity) throw new Error("cache overflow");
    }
    return evicted;
  }

  get(key: string): T | undefined {
    const at = this.entries.findIndex((entry) => entry.key === key);
    if (at < 0) return undefined;
    const entry = this.entries.splice(at, 1)[0]!;
    this.entries.push(entry);
    return entry.value;
  }

  peek(key: string): T | undefined {
    return this.entries.find((entry) => entry.key === key)?.value;
  }

  delete(key: string): boolean {
    const at = this.entries.findIndex((entry) => entry.key === key);
    if (at < 0) return false;
    this.entries.splice(at, 1);
    return true;
  }

  keys(): string[] {
    return this.entries.map((entry) => entry.key);
  }

  keyAt(index: number): string {
    if (!Number.isInteger(index) || index < 0 || index >= this.entries.length) {
      throw new RangeError("recency index out of range");
    }
    return this.entries[index]?.key as string;
  }
}
