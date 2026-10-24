/*
 * CONTRACT - word-wrap
 *
 * wrapText(text, width): string[]
 *   - width must be an integer >= 1, otherwise throws a RangeError
 *   - words are the maximal runs of characters other than space, tab, CR and LF
 *   - a word longer than width is first cut into pieces of exactly width characters
 *     (the last piece may be shorter); pieces are then placed like words
 *   - greedy: each line takes as many following words as fit, joined by single spaces,
 *     and a line may be exactly width characters long
 *   - empty or whitespace-only text gives []
 * lineCount(text, width): number - equals wrapText(text, width).length
 * padLines(lines, width): string[]
 *   - each line shorter than width is right-padded with spaces to exactly width;
 *     other lines are returned unchanged; the input array is not modified
 *
 * Not specified: the text of error messages.
 */

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

function splitWords(text: string): string[] {
  const words: string[] = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && isSpace(text.charCodeAt(i))) i += 1;
    const start = i;
    while (i < text.length && !isSpace(text.charCodeAt(i))) i++;
    if (i > start) words.push(text.slice(start, i));
  }
  return words;
}

function pieces(word: string, width: number): string[] {
  if (word.length <= width) return [word];
  const out: string[] = [];
  for (let at = 0; at < word.length; at += width) {
    out.push(word.slice(at, at + width));
  }
  return out;
}

export function wrapText(text: string, width: number): string[] {
  if (!Number.isInteger(width) || width < 1) {
    throw new RangeError(`width must be a positive integer, got ${width}`);
  }
  const lines: string[] = [];
  let current = "";
  for (const word of splitWords(text)) {
    for (const piece of pieces(word, width)) {
      if (current === "") {
        current = piece;
      } else if (current.length + 1 + piece.length <= width) {
        current += " " + piece;
      } else {
        lines.push(current);
        current = piece;
      }
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

export function lineCount(text: string, width: number): number {
  return wrapText(text, width).length;
}

export function padLines(lines: readonly string[], width: number): string[] {
  return lines.map((line) => (line.length < width ? line + " ".repeat(width - line.length) : line));
}
