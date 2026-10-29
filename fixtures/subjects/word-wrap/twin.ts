/*
 * TWIN of word-wrap/src.ts: same exported API and the same CONTRACT (see src.ts).
 * Differs only where the CONTRACT is silent; each difference is marked TWIN-DIFF.
 */

function words(text: string): string[] {
  // TWIN-DIFF: words found with a regular expression instead of a character scanner (same words).
  return text.split(/[ \t\r\n]+/).filter((w) => w.length > 0);
}

function pieces(word: string, width: number): string[] {
  const out: string[] = [];
  let rest = word;
  while (rest.length > width) {
    out.push(rest.slice(0, width));
    rest = rest.slice(width);
  }
  out.push(rest);
  return out;
}

export function wrapText(text: string, width: number): string[] {
  if (!Number.isInteger(width) || width < 1) {
    // TWIN-DIFF: different error message text (the CONTRACT leaves messages unspecified).
    throw new RangeError("invalid width");
  }
  const lines: string[] = [];
  for (const piece of words(text).flatMap((w) => pieces(w, width))) {
    const last = lines.length - 1;
    if (last >= 0 && lines[last]!.length + 1 + piece.length <= width) {
      lines[last] += " " + piece;
    } else {
      lines.push(piece);
    }
  }
  return lines;
}

export function lineCount(text: string, width: number): number {
  return wrapText(text, width).length;
}

export function padLines(lines: readonly string[], width: number): string[] {
  return lines.map((line) => line.padEnd(width, " "));
}
