/*
 * CONTRACT - roman-numerals
 *
 * toRoman(n): string
 *   - n must be an integer from 1 to 3999, otherwise throws a RangeError
 *   - standard subtractive form using M D C L X V I: 4 -> "IV", 1994 -> "MCMXCIV", 3999 -> "MMMCMXCIX"
 * fromRoman(text): number
 *   - accepts exactly the strings toRoman produces (upper case, canonical form, value 1..3999)
 *     and returns their value; anything else ("IIII", "IC", "xiv", "", "MMMM") throws a SyntaxError
 * isRoman(text): boolean - true exactly when fromRoman(text) would not throw
 *
 * Not specified: the text of error messages.
 */

const VALUES: readonly number[] = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
const SYMBOLS: readonly string[] = ["M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"];

export function toRoman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) {
    throw new RangeError(`expected an integer from 1 to 3999, got ${n}`);
  }
  let out = "";
  let rest = n;
  VALUES.forEach((value, i) => {
    const times = Math.floor(rest / value);
    out += SYMBOLS[i]!.repeat(times);
    rest -= times * value;
  });
  return out;
}

export function fromRoman(text: string): number {
  let total = 0;
  let pos = 0;
  for (let i = 0; i < VALUES.length; i++) {
    const symbol = SYMBOLS[i]!;
    while (text.startsWith(symbol, pos)) {
      total += VALUES[i]!;
      pos += symbol.length;
    }
  }
  if (pos !== text.length || total < 1 || total > 3999 || toRoman(total) !== text) {
    throw new SyntaxError(`not a canonical roman numeral: "${text}"`);
  }
  return total;
}

export function isRoman(text: string): boolean {
  try {
    fromRoman(text);
  } catch {
    return false;
  }
  return true;
}
