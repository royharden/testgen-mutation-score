import { expect, test } from "vitest";
import { invoiceTotal, lineTotal, netTotal } from "./src";

test("computes quantity net tax and gross", () => {
  expect(lineTotal({ unitCents: 250, quantity: 3, taxPercent: 10 })).toEqual({ net: 750, tax: 75, gross: 825 });
});

test("rounds exact half cents up", () => {
  expect(lineTotal({ unitCents: 5, quantity: 1, taxPercent: 10 })).toEqual({ net: 5, tax: 1, gross: 6 });
});

test("handles zero quantity and zero rate", () => {
  expect(lineTotal({ unitCents: 250, quantity: 0, taxPercent: 20 })).toEqual({ net: 0, tax: 0, gross: 0 });
  expect(lineTotal({ unitCents: 250, quantity: 2, taxPercent: 0 })).toEqual({ net: 500, tax: 0, gross: 500 });
});

test("rounds tax separately for each line", () => {
  expect(invoiceTotal([{ unitCents: 5, quantity: 1, taxPercent: 10 }, { unitCents: 5, quantity: 1, taxPercent: 10 }])).toEqual({ net: 10, tax: 2, gross: 12 });
});

test("returns zeros for empty invoices and exposes net total", () => {
  expect(invoiceTotal([])).toEqual({ net: 0, tax: 0, gross: 0 });
  expect(netTotal([{ unitCents: 100, quantity: 2, taxPercent: 7.5 }])).toBe(200);
});

test("does not modify lines or arrays", () => {
  const lines = [{ unitCents: 100, quantity: 2, taxPercent: 7.5 }];
  invoiceTotal(lines);
  expect(lines).toEqual([{ unitCents: 100, quantity: 2, taxPercent: 7.5 }]);
});

test("rejects invalid fields and too many lines", () => {
  expect(() => lineTotal({ unitCents: 1.5, quantity: 1, taxPercent: 10 })).toThrow(TypeError);
  expect(() => lineTotal({ unitCents: 1, quantity: -1, taxPercent: 10 })).toThrow(TypeError);
  expect(() => lineTotal({ unitCents: 1, quantity: 1, taxPercent: Infinity })).toThrow(TypeError);
  expect(() => invoiceTotal(new Array(1001).fill({ unitCents: 0, quantity: 0, taxPercent: 0 }))).toThrow(RangeError);
});
