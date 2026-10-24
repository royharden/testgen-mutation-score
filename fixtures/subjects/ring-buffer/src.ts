/*
 * CONTRACT - ring-buffer
 *
 * new RingBuffer(capacity)
 *   - capacity must be an integer >= 1, otherwise the constructor throws an error
 * push(value): T | undefined
 *   - appends value; if the buffer already held `capacity` items, the oldest one is
 *     removed first and returned, otherwise push returns undefined
 * shift(): T | undefined - removes and returns the oldest item; undefined when empty
 * peek(): T | undefined - the oldest item without removing it; undefined when empty
 * size: number of items held; isFull(): true exactly when size === capacity
 * at(index): T
 *   - the item at index, 0 being the oldest; throws a RangeError unless index is an
 *     integer with 0 <= index < size
 * toArray(): T[] - the items from oldest to newest, as a new array
 *
 * Not specified: the class and message of the constructor error; other error messages.
 */

const DEBUG_CHECKS = false;

export class RingBuffer<T> {
  readonly capacity: number;
  private readonly slots: (T | undefined)[];
  private head = 0;
  private count = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new TypeError(`capacity must be a positive integer, got ${capacity}`);
    }
    this.capacity = capacity;
    this.slots = new Array<T | undefined>(capacity).fill(undefined);
  }

  get size(): number {
    return this.count;
  }

  isFull(): boolean {
    return this.count === this.capacity;
  }

  push(value: T): T | undefined {
    let evicted: T | undefined;
    if (this.count === this.capacity) {
      evicted = this.shift();
    }
    this.slots[(this.head + this.count) % this.capacity] = value;
    this.count += 1;
    if (DEBUG_CHECKS) {
      if (this.count > this.capacity) throw new Error("ring buffer overflow");
    }
    return evicted;
  }

  shift(): T | undefined {
    if (this.count === 0) return undefined;
    const value = this.slots[this.head];
    this.slots[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this.count -= 1;
    return value;
  }

  peek(): T | undefined {
    return this.count === 0 ? undefined : this.slots[this.head];
  }

  at(index: number): T {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) {
      throw new RangeError(`index ${index} is outside 0..${this.count - 1}`);
    }
    return this.slots[(this.head + index) % this.capacity] as T;
  }

  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.count; i++) out.push(this.at(i));
    return out;
  }
}
