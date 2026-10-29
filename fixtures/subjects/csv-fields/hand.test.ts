import { expect, test } from "vitest";
import { fieldCount, formatCsvLine, parseCsvLine } from "./src";

test("parseCsvLine splits plain fields and keeps empty ones", () => {
  expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  expect(parseCsvLine("a,,c")).toEqual(["a", "", "c"]);
});

test("an empty line is one empty field and a trailing delimiter adds an empty field", () => {
  expect(parseCsvLine("")).toEqual([""]);
  expect(parseCsvLine("a,")).toEqual(["a", ""]);
});

test("a quoted field may contain the delimiter", () => {
  expect(parseCsvLine('"a,b",c')).toEqual(["a,b", "c"]);
});

test("two double quotes inside a quoted field stand for one", () => {
  expect(parseCsvLine('"say ""hi""",x')).toEqual(['say "hi"', "x"]);
});

test("a quoted field without its closing quote throws a SyntaxError", () => {
  expect(() => parseCsvLine('"abc')).toThrow(SyntaxError);
  expect(() => parseCsvLine('a,"b')).toThrow(SyntaxError);
});

test("a custom delimiter is used and an unusable one throws a RangeError", () => {
  expect(parseCsvLine("a;b,c", ";")).toEqual(["a", "b,c"]);
  expect(() => parseCsvLine("a", ";;")).toThrow(RangeError);
  expect(() => parseCsvLine("a", '"')).toThrow(RangeError);
});

test("formatCsvLine quotes only fields that need it and round-trips", () => {
  const fields = ["plain", "with,comma", 'with"quote', ""];
  const line = formatCsvLine(fields);
  expect(line).toBe('plain,"with,comma","with""quote",');
  expect(parseCsvLine(line)).toEqual(fields);
});

test("fieldCount counts the fields of a line", () => {
  expect(fieldCount("a,b,c")).toBe(3);
  expect(fieldCount('"x,y"')).toBe(1);
});
