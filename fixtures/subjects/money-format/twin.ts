/*
 * TWIN of money-format/src.ts: same exported API and the same CONTRACT (see src.ts).
 * Differs only where the CONTRACT is silent; each difference is marked TWIN-DIFF.
 */

export interface MoneyOptions {
  symbol?: string;
  separator?: string;
}

function requireSafeInteger(cents: number): void {
  if (!Number.isSafeInteger(cents)) {
    // TWIN-DIFF: different error message text (the CONTRACT leaves messages unspecified).
    throw new TypeError("amount is not a whole number of cents");
  }
}

export function formatMoney(cents: number, options: MoneyOptions = {}): string {
  requireSafeInteger(cents);
  const separator = options.separator ?? ",";
  const digits = String(Math.abs(cents)).padStart(3, "0");
  const units = digits.slice(0, -2);
  const fraction = digits.slice(-2);
  // TWIN-DIFF: groups the digits with a regular expression instead of a counting loop (same text).
  const grouped = units.replace(/\B(?=(\d{3})+(?!\d))/g, () => separator);
  return `${cents < 0 ? "-" : ""}${options.symbol ?? "$"}${grouped}.${fraction}`;
}

export function splitEvenly(cents: number, parts: number): number[] {
  requireSafeInteger(cents);
  // TWIN-DIFF: different error message text for a negative amount.
  if (cents < 0) throw new TypeError("negative amount");
  if (!Number.isInteger(parts) || parts < 1) {
    // TWIN-DIFF: different error message text for a bad part count.
    throw new RangeError("bad part count");
  }
  let left = cents % parts;
  const base = (cents - left) / parts;
  const shares = new Array<number>(parts).fill(base);
  for (let k = 0; left > 0; k++, left--) shares[k] = base + 1;
  return shares;
}

export function applyRate(cents: number, ratePercent: number): number {
  requireSafeInteger(cents);
  // TWIN-DIFF: no dead legacy-truncation branch (it can never run in src.ts either).
  return Math.round((cents * Math.round(ratePercent * 100)) / 10000);
}
