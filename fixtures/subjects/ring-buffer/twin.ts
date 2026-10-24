/*
 * TWIN of ring-buffer/src.ts: same exported API and the same CONTRACT (see src.ts).
 * Differs only where the CONTRACT is silent; each difference is marked TWIN-DIFF.
 */

export class RingBuffer<T> {
  readonly capacity: number;
  // TWIN-DIFF: stores items in a plain array (oldest first) instead of fixed slots with a head index.
  private readonly items: T[] = [];

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      // TWIN-DIFF: throws RangeError with other text (the CONTRACT leaves class and message unspecified).
      throw new RangeError("bad capacity");
    }
    this.capacity = capacity;
  }

  get size(): number {
    return this.items.length;
  }

  isFull(): boolean {
    return this.items.length === this.capacity;
  }

  push(value: T): T | undefined {
    const evicted = this.items.length === this.capacity ? this.items.shift() : undefined;
    this.items.push(value);
    return evicted;
  }

  shift(): T | undefined {
    return this.items.shift();
  }

  peek(): T | undefined {
    return this.items[0];
  }

  at(index: number): T {
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length) {
      // TWIN-DIFF: different RangeError message text (messages are unspecified).
      throw new RangeError("index out of range");
    }
    return this.items[index] as T;
  }

  toArray(): T[] {
    return [...this.items];
  }
}
