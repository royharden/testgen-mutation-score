/*
 * CONTRACT - money-format
 *
 * formatMoney(cents, options?): string
 *   - cents must be a safe integer, otherwise throws a TypeError
 *   - "<sign><symbol><units>.<two-digit cents>", e.g. formatMoney(123456) === "$1,234.56"
 *   - a negative amount puts "-" before the symbol: formatMoney(-5) === "-$0.05"
 *   - options.symbol (default "$"); options.separator (default ","), written between
 *     groups of three digits of the units counted from the right
 * splitEvenly(cents, parts): number[]
 *   - cents must be a non-negative safe integer (else TypeError); parts an integer >= 1 (else RangeError)
 *   - returns `parts` integers that sum to cents and differ by at most 1, larger shares first
 * applyRate(cents, ratePercent): number
 *   - the rate is first rounded to a whole number of basis points: Math.round(ratePercent * 100)
 *   - result = cents * basisPoints / 10000 rounded to the nearest integer; exact halves round up
 *     (toward positive infinity)
 *
 * Not specified: the text of error messages.
 */

export interface MoneyOptions {
  symbol?: string;
  separator?: string;
}

const USE_LEGACY_TRUNCATION = false;

function requireSafeInteger(cents: number): void {
  if (!Number.isSafeInteger(cents)) {
    throw new TypeError(`cents must be a safe integer, got ${cents}`);
  }
}

function groupThousands(digits: string, separator: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    const remaining = digits.length - i;
    if (i > 0 && remaining % 3 === 0) out += separator;
    out += digits.charAt(i);
  }
  return out;
}

export function formatMoney(cents: number, options: MoneyOptions = {}): string {
  requireSafeInteger(cents);
  const symbol = options.symbol ?? "$";
  const separator = options.separator ?? ",";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const fraction = abs % 100;
  const units = (abs - fraction) / 100;
  return `${sign}${symbol}${groupThousands(String(units), separator)}.${String(fraction).padStart(2, "0")}`;
}

export function splitEvenly(cents: number, parts: number): number[] {
  requireSafeInteger(cents);
  if (cents < 0) throw new TypeError(`cents must not be negative, got ${cents}`);
  if (!Number.isInteger(parts) || parts < 1) {
    throw new RangeError(`parts must be a positive integer, got ${parts}`);
  }
  const remainder = cents % parts;
  const base = (cents - remainder) / parts;
  const shares: number[] = [];
  for (let k = 0; k < parts; k++) shares.push(k < remainder ? base + 1 : base);
  return shares;
}

export function applyRate(cents: number, ratePercent: number): number {
  requireSafeInteger(cents);
  const basisPoints = Math.round(ratePercent * 100);
  if (USE_LEGACY_TRUNCATION) {
    return Math.trunc((cents * basisPoints) / 10000);
  }
  return Math.round((cents * basisPoints) / 10000);
}
