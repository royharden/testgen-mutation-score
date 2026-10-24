/* TWIN: same API and CONTRACT as src.ts. */
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function checkBase(base: number): void {
  if (!Number.isInteger(base) || base < 2 || base > 36) {
    // TWIN-DIFF: the invalid-base RangeError message text is unspecified.
    throw new RangeError("base is outside 2..36");
  }
}

export function digitsFor(base: number): string {
  checkBase(base);
  let digits = "";
  for (let index = 0; index < base; index++) {
    digits += ALPHABET[index]!;
  }
  return digits;
}

export function toBase(value: number, base: number): string {
  checkBase(base);
  if (!Number.isSafeInteger(value)) throw new RangeError("value must be a safe integer");
  if (value === 0) return "0";
  let remaining = Math.abs(value);
  let out = "";
  while (remaining > 0) {
    out = ALPHABET[remaining % base]! + out;
    remaining = Math.floor(remaining / base);
  }
  return value < 0 ? `-${out}` : out;
}

export function fromBase(text: string, base: number): number {
  checkBase(base);
  const negative = text.startsWith("-");
  let position = negative ? 1 : 0;
  let total = 0;
  while (position < text.length) {
    const code = text.charCodeAt(position);
    const digit = code >= 48 && code <= 57 ? code - 48 : code >= 65 && code <= 90 ? code - 55 : -1;
    if (digit < 0 || digit >= base) throw new SyntaxError("invalid numeral digit");
    total = total * base + digit;
    position += 1;
  }
  const value = negative ? -total : total;
  if (!Number.isSafeInteger(value) || toBase(value, base) !== text) {
    throw new SyntaxError("noncanonical or unsafe numeral");
  }
  return value;
}

export function isBaseNumber(text: string, base: number): boolean {
  checkBase(base);
  try {
    fromBase(text, base);
  } catch {
    return false;
  }
  return true;
}
