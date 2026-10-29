/*
 * CONTRACT - text-columns
 * textColumns(text, width, columns = 2, gap = 2): string[] lays out words row by row.
 * Words are maximal runs excluding ASCII space, tab, CR and LF. Each word occupies one column.
 * A row contains at most columns words; each nonfinal cell is right-padded to width and then gap
 * spaces are inserted. The last word has no trailing padding. A word of exactly width fits;
 * a longer word throws RangeError. Empty/whitespace text gives [].
 * width and columns must be positive integers; gap must be a nonnegative integer, else RangeError.
 * columnRowCount(text, width, columns = 2, gap = 2): equals textColumns(...).length.
 * Not specified: error messages, internal tokenization algorithm.
 */

function whitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

function tokens(text: string): string[] {
  const out: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    while (cursor < text.length && whitespace(text.charCodeAt(cursor))) cursor += 1;
    const start = cursor;
    while (cursor < text.length && !whitespace(text.charCodeAt(cursor))) cursor++;
    if (start < cursor) out.push(text.slice(start, cursor));
  }
  return out;
}

export function textColumns(text: string, width: number, columns = 2, gap = 2): string[] {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(columns) || columns < 1 ||
      !Number.isInteger(gap) || gap < 0) throw new RangeError("invalid column dimensions");
  const words = tokens(text);
  const rows: string[] = [];
  let row: string[] = [];
  for (const word of words) {
    if (word.length > width) throw new RangeError("word exceeds column width");
    row.push(word);
    if (row.length === columns) {
      rows.push(row.map((cell, i) => i === row.length - 1 ? cell : cell.padEnd(width) + " ".repeat(gap)).join(""));
      row = [];
    }
  }
  if (row.length > 0) {
    rows.push(row.map((cell, i) => i === row.length - 1 ? cell : cell.padEnd(width) + " ".repeat(gap)).join(""));
  }
  return rows;
}

export function columnRowCount(text: string, width: number, columns = 2, gap = 2): number {
  return textColumns(text, width, columns, gap).length;
}
