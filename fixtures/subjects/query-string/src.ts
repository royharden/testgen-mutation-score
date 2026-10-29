/*
 * CONTRACT - query-string
 * QueryPair = [key, value]. parseQuery(text) removes at most one leading '?',
 * splits on '&', and ignores empty segments. Empty input returns [].
 * Each specified non-empty segment contains '='; split at its first '='.
 * Decode percent escapes as UTF-8 and '+' as space in both components.
 * Preserve input order, duplicate keys, empty keys and empty values.
 * Invalid escapes or UTF-8 throw an error; class and text are unspecified.
 * buildQuery(pairs) joins encodeURIComponent(key) + '=' + encodeURIComponent(value)
 * with '&', without a leading '?'. It does not modify pairs.
 * pairCount(text) equals parseQuery(text).length.
 * Not specified: segments without '=', including whether they are retained.
 */

export type QueryPair = [string, string];

function isHex(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

function checkEscapes(text: string): void {
  let cursor = 0;
  while (cursor < text.length) {
    if (text.charCodeAt(cursor) === 37) {
      if (!isHex(text.charCodeAt(cursor + 1)) || !isHex(text.charCodeAt(cursor + 2))) {
        throw new SyntaxError("malformed percent escape");
      }
      cursor += 3;
    } else {
      cursor++;
    }
  }
}

function decode(text: string): string {
  checkEscapes(text);
  return decodeURIComponent(text.replace(/\+/g, " "));
}

export function parseQuery(text: string): QueryPair[] {
  const body = text.startsWith("?") ? text.slice(1) : text;
  const pairs: QueryPair[] = [];
  for (const segment of body.split("&")) {
    if (segment === "") continue;
    const equals = segment.indexOf("=");
    if (equals < 0) {
      pairs.push([decode(segment), ""]);
      continue;
    }
    pairs.push([decode(segment.slice(0, equals)), decode(segment.slice(equals + 1))]);
  }
  return pairs;
}

export function buildQuery(pairs: readonly QueryPair[]): string {
  return pairs.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
}

export function pairCount(text: string): number {
  return parseQuery(text).length;
}
