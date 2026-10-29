/*
 * TWIN of csv-fields/src.ts: same exported API and the same CONTRACT (see src.ts).
 * Differs only where the CONTRACT is silent, plus the planted quirk; each difference is marked TWIN-DIFF.
 */

function checkDelimiter(delimiter: string): void {
  if (delimiter.length !== 1 || delimiter === '"' || delimiter === "\r" || delimiter === "\n") {
    // TWIN-DIFF: different error message text (the CONTRACT leaves messages unspecified).
    throw new RangeError("bad delimiter");
  }
}

export function parseCsvLine(line: string, delimiter = ","): string[] {
  checkDelimiter(delimiter);
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  // TWIN-DIFF: a single character-by-character state machine instead of index scanning.
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
        closed = true;
      } else {
        field += ch;
      }
    } else if (ch === delimiter) {
      fields.push(field);
      field = "";
      closed = false;
    } else if (ch === '"' && field === "" && !closed) {
      quoted = true;
    } else if (!closed) {
      // TWIN-DIFF quirk: text after a closing quote is dropped; src.ts appends it to the field.
      field += ch;
    }
  }
  if (quoted) {
    // TWIN-DIFF: different SyntaxError message text.
    throw new SyntaxError("missing closing quote");
  }
  fields.push(field);
  return fields;
}

function quoteIfNeeded(field: string, delimiter: string): string {
  if (!/["\r\n]/.test(field) && !field.includes(delimiter)) return field;
  return `"${field.replace(/"/g, '""')}"`;
}

export function formatCsvLine(fields: readonly string[], delimiter = ","): string {
  checkDelimiter(delimiter);
  return fields.map((field) => quoteIfNeeded(field, delimiter)).join(delimiter);
}

export function fieldCount(line: string, delimiter = ","): number {
  return parseCsvLine(line, delimiter).length;
}
