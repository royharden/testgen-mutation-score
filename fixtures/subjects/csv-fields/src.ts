/*
 * CONTRACT - csv-fields
 *
 * parseCsvLine(line, delimiter = ","): string[]
 *   - delimiter must be one character other than a double quote, CR or LF (else RangeError)
 *   - splits one line into fields at each delimiter; "a,,b" gives ["a", "", "b"]; "" gives [""]
 *   - a field that starts with a double quote is quoted: it runs to the matching closing quote,
 *     may contain delimiters, and "" inside it stands for one double quote
 *   - a quoted field without a closing quote throws a SyntaxError
 * formatCsvLine(fields, delimiter = ","): string
 *   - joins the fields with the delimiter; a field containing the delimiter, a double quote,
 *     CR or LF is wrapped in double quotes with its double quotes doubled
 *   - for a non-empty list of fields: parseCsvLine(formatCsvLine(fields, d), d) equals fields
 * fieldCount(line, delimiter = ","): number - parseCsvLine(line, delimiter).length
 *
 * Not specified: characters between a closing quote and the next delimiter; error messages.
 */

function checkDelimiter(delimiter: string): void {
  if (delimiter.length !== 1 || delimiter === '"' || delimiter === "\r" || delimiter === "\n") {
    throw new RangeError(`unusable delimiter ${JSON.stringify(delimiter)}`);
  }
}

/** Index of the quote that closes a quoted field whose content starts at `from`, or -1. */
function closingQuote(line: string, from: number): number {
  let i = from;
  while (i < line.length) {
    if (line.charCodeAt(i) !== 34) {
      i++;
    } else if (line.charCodeAt(i + 1) === 34) {
      i += 2;
    } else {
      return i;
    }
  }
  return -1;
}

export function parseCsvLine(line: string, delimiter = ","): string[] {
  checkDelimiter(delimiter);
  const fields: string[] = [];
  let pos = 0;
  for (;;) {
    let field: string;
    let end: number;
    if (line.charCodeAt(pos) === 34) {
      const close = closingQuote(line, pos + 1);
      if (close === -1) throw new SyntaxError(`unterminated quoted field at column ${pos + 1}`);
      end = line.indexOf(delimiter, close + 1);
      if (end === -1) end = line.length;
      field = line.slice(pos + 1, close).split('""').join('"');
      field += line.slice(close + 1, end);
    } else {
      end = line.indexOf(delimiter, pos);
      if (end === -1) end = line.length;
      field = line.slice(pos, end);
    }
    fields.push(field);
    if (end >= line.length) return fields;
    pos = end + 1;
  }
}

function quoteIfNeeded(field: string, delimiter: string): string {
  const special = field.includes(delimiter) || field.includes('"') || field.includes("\r") || field.includes("\n");
  return special ? `"${field.split('"').join('""')}"` : field;
}

export function formatCsvLine(fields: readonly string[], delimiter = ","): string {
  checkDelimiter(delimiter);
  return fields.map((field) => quoteIfNeeded(field, delimiter)).join(delimiter);
}

export function fieldCount(line: string, delimiter = ","): number {
  return parseCsvLine(line, delimiter).length;
}
