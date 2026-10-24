/*
 * CONTRACT - parse-duration
 * parseDuration(text, options?): seconds represented by a trimmed optional sign and one or more
 * adjacent decimal amounts with lowercase units h (3600), m (60), s (1), e.g. "1h30m", "-2.5s".
 * Amounts have digits and an optional dot followed by digits; repeated units and any unit order work.
 * No internal whitespace, exponent, omitted unit, or trailing data is accepted; empty text throws.
 * The signed total must be finite. options.decimals, when present, is an integer 0..6 and rounds
 * seconds to that many places, exact halves away from zero. options.min/max are finite inclusive
 * bounds on the rounded result; min > max throws. Invalid input/options/out-of-bounds result throws.
 * isDuration(text, options?): true exactly when parseDuration does not throw.
 * durationList(text, options?): comma-separated durations; trimmed empty input gives a new [].
 * Not specified: error classes/messages, internal parsing algorithm.
 */

export interface DurationOptions {
  decimals?: number;
  min?: number;
  max?: number;
}

function secondsOf(text: string): number {
  const trimmed = text.trim();
  const sign = trimmed.startsWith("-") ? -1 : 1;
  const body = /^[+-]/.test(trimmed) ? trimmed.slice(1) : trimmed;
  let cursor = 0;
  let total = 0;
  for (const token of body.matchAll(/(\d+(?:\.\d+)?)(h|m|s)/g)) {
    // TWIN-DIFF: different malformed-token error class; error classes are unspecified.
    if (token.index !== cursor) throw new Error("invalid duration token");
    const multiplier = token[2] === "h" ? 3600 : token[2] === "m" ? 60 : 1;
    total += Number(token[1]) * multiplier;
    cursor += token[0].length;
  }
  if (cursor === 0 || cursor !== body.length || !Number.isFinite(total)) {
    throw new SyntaxError("duration must contain complete finite units");
  }
  return sign * total;
}

export function parseDuration(text: string, options: DurationOptions = {}): number {
  let result = secondsOf(text);
  if (options.decimals !== undefined) {
    const places = options.decimals;
    if (!Number.isInteger(places) || places < 0 || places > 6) throw new RangeError("bad precision");
    const factor = 10 ** places;
    // At this magnitude every finite number is already integral; avoid scaling overflow.
    if (Math.abs(result) < 1e21) {
      result = (Math.sign(result) * Math.round(Math.abs(result) * factor)) / factor;
    }
  }
  if ((options.min !== undefined && !Number.isFinite(options.min)) ||
      (options.max !== undefined && !Number.isFinite(options.max)) ||
      (options.min !== undefined && options.max !== undefined && options.min > options.max)) {
    throw new RangeError("invalid duration bounds");
  }
  if (options.min !== undefined && result < options.min) throw new RangeError("duration below minimum");
  if (options.max !== undefined && result > options.max) throw new RangeError("duration above maximum");
  return result;
}

export function isDuration(text: string, options: DurationOptions = {}): boolean {
  try {
    parseDuration(text, options);
    return true;
  } catch {
    return false;
  }
}

export function durationList(text: string, options: DurationOptions = {}): number[] {
  if (text.trim() === "") return [];
  return text.split(",").map((part) => parseDuration(part, options));
}
