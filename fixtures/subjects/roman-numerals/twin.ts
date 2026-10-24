/*
 * TWIN of roman-numerals/src.ts: same exported API and the same CONTRACT (see src.ts).
 * Differs only where the CONTRACT is silent; each difference is marked TWIN-DIFF.
 */

const DIGITS: Readonly<Record<string, number>> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
const PAIRS: readonly (readonly [number, string])[] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"],
  [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

export function toRoman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) {
    // TWIN-DIFF: different error message text (the CONTRACT leaves messages unspecified).
    throw new RangeError("out of roman range");
  }
  let out = "";
  let rest = n;
  for (const [value, symbol] of PAIRS) {
    while (rest >= value) {
      out += symbol;
      rest -= value;
    }
  }
  return out;
}

export function fromRoman(text: string): number {
  // TWIN-DIFF: sums digit values with the subtraction rule, then checks the canonical form.
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const here = DIGITS[text[i]!];
    const next = i + 1 < text.length ? DIGITS[text[i + 1]!] : undefined;
    if (here === undefined) {
      total = Number.NaN;
      break;
    }
    total += next !== undefined && next > here ? -here : here;
  }
  if (!(total >= 1 && total <= 3999) || toRoman(total) !== text) {
    // TWIN-DIFF: different SyntaxError message text.
    throw new SyntaxError("not canonical");
  }
  return total;
}

export function isRoman(text: string): boolean {
  try {
    return fromRoman(text) > 0;
  } catch {
    return false;
  }
}
