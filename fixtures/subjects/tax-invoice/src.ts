/*
 * CONTRACT - tax-invoice
 * lineTotal(line): {net, tax, gross} in integer cents for {unitCents, quantity, taxPercent}.
 * unitCents and quantity must be integers in [0, 1000000]; taxPercent must be finite in [0, 100].
 * Invalid fields throw TypeError. net = unitCents * quantity. The rate is snapped to whole basis
 * points with Math.round(taxPercent * 100); tax = Math.round(net * basisPoints / 10000).
 * Exact halves round toward positive infinity; gross = net + tax.
 * invoiceTotal(lines): sums the independently computed line totals, not tax on the combined net.
 * At most 1000 lines are supported; more throws RangeError. Empty input gives three zeros.
 * netTotal(lines): invoiceTotal(lines).net. Functions leave line objects and input arrays unchanged.
 * Not specified: error messages, internal aggregation algorithm.
 */

export interface InvoiceLine {
  unitCents: number;
  quantity: number;
  taxPercent: number;
}

export interface InvoiceTotal {
  net: number;
  tax: number;
  gross: number;
}

const LEGACY_TAX = false;

function validateLine(line: InvoiceLine): void {
  if (!Number.isInteger(line.unitCents) || line.unitCents < 0 || line.unitCents > 1000000 ||
      !Number.isInteger(line.quantity) || line.quantity < 0 || line.quantity > 1000000 ||
      !Number.isFinite(line.taxPercent) || line.taxPercent < 0 || line.taxPercent > 100) {
    throw new TypeError("invoice line has invalid fields");
  }
}

export function lineTotal(line: InvoiceLine): InvoiceTotal {
  validateLine(line);
  const net = line.unitCents * line.quantity;
  const basisPoints = Math.round(line.taxPercent * 100);
  let tax = Math.round((net * basisPoints) / 10000);
  if (LEGACY_TAX) {
    tax = Math.floor((net * basisPoints) / 10000);
  }
  return { net, tax, gross: net + tax };
}

export function invoiceTotal(lines: readonly InvoiceLine[]): InvoiceTotal {
  if (lines.length > 1000) throw new RangeError("too many invoice lines");
  const total: InvoiceTotal = { net: 0, tax: 0, gross: 0 };
  for (const line of lines) {
    const part = lineTotal(line);
    total.net += part.net;
    total.tax += part.tax;
    total.gross += part.gross;
  }
  return total;
}

export function netTotal(lines: readonly InvoiceLine[]): number {
  return invoiceTotal(lines).net;
}
