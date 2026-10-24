/*
 * TWIN of validated-number/src.ts: same exported API and the same CONTRACT (see src.ts).
 * Differs only where the CONTRACT is silent; each difference is marked TWIN-DIFF.
 */

export interface ParseOptions {
  integer?: boolean;
  decimals?: number;
  min?: number;
  max?: number;
}

const NUMBER_PATTERN = /^([+-]?)(\d+)(\.\d+)?$/;

function invalid(text: string): never {
  // TWIN-DIFF: malformed text throws TypeError with other text (class and message unspecified).
  throw new TypeError(`invalid number ${JSON.stringify(text)}`);
}

function rounded(value: number, decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 10) {
    // TWIN-DIFF: a bad decimals option throws a plain Error (class and message unspecified).
    throw new Error("decimals out of range");
  }
  const factor = 10 ** decimals;
  return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
}

export function parseNumber(text: string, options: ParseOptions = {}): number {
  const match = NUMBER_PATTERN.exec(text.trim());
  if (match === null) invalid(text);
  if (options.integer === true && match[3] !== undefined) invalid(text);
  const value = options.decimals === undefined ? Number(match[0]) : rounded(Number(match[0]), options.decimals);
  const tooLow = options.min !== undefined && value < options.min;
  const tooHigh = options.max !== undefined && value > options.max;
  if (tooLow || tooHigh) {
    // TWIN-DIFF: out-of-bounds values throw a plain Error with other text (class and message unspecified).
    throw new Error(`out of bounds: ${value}`);
  }
  return value;
}

export function isValidNumber(text: string, options: ParseOptions = {}): boolean {
  try {
    parseNumber(text, options);
  } catch {
    return false;
  }
  return true;
}

export function parseNumberList(text: string, options: ParseOptions = {}): number[] {
  const out: number[] = [];
  if (text.trim().length === 0) return out;
  for (const part of text.split(",")) out.push(parseNumber(part, options));
  return out;
}
