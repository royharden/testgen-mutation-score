/**
 * Deterministic pseudo-randomness for splits and the bootstrap. Pure, no imports, never Math.random.
 * The same seed and inputs give the same outputs on every platform (32-bit integer arithmetic only).
 */

/** Coerce any finite number to a uint32 seed; throws on non-finite input so a bad seed is never silent. */
export function toSeed(seed: number): number {
  if (!Number.isFinite(seed)) throw new RangeError(`seed must be finite, got ${seed}`);
  return Math.trunc(seed) >>> 0;
}

/** mulberry32: small, fast, well-distributed 32-bit PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = toSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform integer in [0, n) from a PRNG. */
export function randomIntBelow(rand: () => number, n: number): number {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError(`n must be a positive integer, got ${n}`);
  return Math.min(n - 1, Math.floor(rand() * n));
}

/** murmur3 32-bit finaliser: avalanches all input bits. */
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Seeded 32-bit hash of a string (FNV-1a over UTF-16 code units, seed mixed in first, murmur finaliser).
 * Not cryptographic; used only to assign location groups and subjects to partitions reproducibly.
 */
export function seededHash32(seed: number, text: string): number {
  let h = (0x811c9dc5 ^ fmix32(toSeed(seed))) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Mix the length so prefixes of different lengths do not share a tail state.
  h ^= text.length;
  return fmix32(h);
}

/** Seeded hash mapped to [0, 1). */
export function seededUnit(seed: number, text: string): number {
  return seededHash32(seed, text) / 4294967296;
}
