// M1 acceptance 5: the strict grammar rejects describe/hooks/each/top-level non-import statements/>8 tests/
// duplicate names with syntax + unsupported-structure, reports parse errors, and builds units as exact
// slices of the original text (no printer, no reformatting).
import { describe, expect, it } from "vitest";
import { MAX_TESTS_PER_FILE, parseCandidate } from "../../cli/core/grammar.js";
import type { GrammarAccepted, GrammarResult } from "../../cli/core/grammar.js";

const IMPORTS = ['import { test, it, expect } from "vitest";', 'import { clamp } from "./src";'].join("\n");

function file(...lines: string[]): string {
  return lines.join("\n");
}

function accepted(r: GrammarResult): GrammarAccepted {
  if (!r.ok) throw new Error(`unexpected rejection: ${r.subReason}: ${r.detail}`);
  return r;
}

function expectUnsupported(src: string): void {
  const r = parseCandidate(src);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.code).toBe("syntax");
    expect(r.subReason).toBe("unsupported-structure");
  }
}

function tests(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `test("case ${i}", () => { expect(clamp(${i}, 0, 5)).toBe(${Math.min(i, 5)}); });`);
}

describe("accepted structure", () => {
  it("accepts imports followed by test()/it() statements and returns one unit per test", () => {
    const r = accepted(
      parseCandidate(
        file(IMPORTS, "", 'test("below range", () => { expect(clamp(-1, 0, 5)).toBe(0); });', "it('above range', function () { expect(clamp(9, 0, 5)).toBe(5); });"),
      ),
    );
    expect(r.imports.map((i) => i.specifier)).toEqual(["vitest", "./src"]);
    expect(r.tests.map((t) => [t.callee, t.name])).toEqual([
      ["test", "below range"],
      ["it", "above range"],
    ]);
    expect(r.units).toHaveLength(2);
  });

  it(`accepts exactly ${MAX_TESTS_PER_FILE} tests`, () => {
    expect(MAX_TESTS_PER_FILE).toBe(8);
    expect(accepted(parseCandidate(file(IMPORTS, ...tests(8)))).units).toHaveLength(8);
  });

  it("accepts expression-bodied arrows and no-substitution template names", () => {
    const r = accepted(parseCandidate(file(IMPORTS, "test(`lower bound`, () => expect(clamp(0, 0, 5)).toBe(0));")));
    expect(r.tests[0]?.name).toBe("lower bound");
  });

  it("recognises .only/.skip/.todo/.concurrent structurally so the gate can reject them as forbidden-import", () => {
    const r = accepted(
      parseCandidate(
        file(IMPORTS, 'test.only("a", () => { expect(clamp(1, 0, 5)).toBe(1); });', 'it.skip("b", () => {});', 'test.todo("c");', 'test.concurrent("d", () => {});'),
      ),
    );
    expect(r.tests.map((t) => t.modifiers)).toEqual([["only"], ["skip"], ["todo"], ["concurrent"]]);
  });
});

describe("byte-faithful unit slicing", () => {
  it("builds each unit as importsBlock + \\n + the exact test statement slice", () => {
    const src = file(IMPORTS, "", 'test("a", () => { expect(clamp(1, 0, 5)).toBe(1); });', 'test("b", () => { expect(clamp(7, 0, 5)).toBe(5); });');
    const r = accepted(parseCandidate(src));
    for (const u of r.units) {
      expect(u.importsRange).not.toBeNull();
      if (u.importsRange === null) continue;
      expect(u.text).toBe(`${src.slice(u.importsRange.start, u.importsRange.end)}\n${src.slice(u.testRange.start, u.testRange.end)}`);
    }
    expect(r.units[0]?.text).toBe(`${IMPORTS}\ntest("a", () => { expect(clamp(1, 0, 5)).toBe(1); });`);
  });

  it("preserves odd spacing, inner comments, CRLF line endings and non-ASCII text exactly", () => {
    const body = 'test( "naïve – ünïcødé" ,()=>{\r\n    // inner comment stays\r\n    expect(  clamp( 3,0 ,5 ) ).toBe( 3 )   ;\r\n})';
    const src = `import { test, expect } from "vitest";\r\nimport { clamp } from "./src";\r\n\r\n/* leading comment is trivia */\r\n${body}\r\n`;
    const r = accepted(parseCandidate(src));
    const u = r.units[0];
    expect(u).toBeDefined();
    if (u === undefined) return;
    expect(src.slice(u.testRange.start, u.testRange.end)).toBe(body);
    expect(u.text).toBe(`import { test, expect } from "vitest";\r\nimport { clamp } from "./src";\n${body}`);
    expect(u.text).toContain("// inner comment stays");
    expect(u.text).not.toContain("leading comment is trivia");
    expect(u.testName).toBe("naïve – ünïcødé");
  });

  it("uses the bare test slice when there are no imports", () => {
    const stmt = 'test("a", () => { expect(1 + 1).toBe(2); });';
    const r = accepted(parseCandidate(`\n${stmt}\n`));
    expect(r.units[0]?.text).toBe(stmt);
    expect(r.units[0]?.importsRange).toBeNull();
  });

  it("keeps the semicolon-less statement exactly as written", () => {
    const stmt = 'test("a", () => {\n  expect(clamp(1, 0, 5)).toBe(1)\n})';
    const r = accepted(parseCandidate(file(IMPORTS, stmt)));
    expect(r.units[0]?.text).toBe(`${IMPORTS}\n${stmt}`);
  });
});

describe("unsupported-structure", () => {
  it("rejects describe blocks", () => {
    expectUnsupported(file(IMPORTS, 'describe("clamp", () => { test("a", () => { expect(clamp(1, 0, 5)).toBe(1); }); });'));
  });

  it.each(["beforeEach", "afterEach", "beforeAll", "afterAll"])("rejects the %s hook", (hook) => {
    expectUnsupported(file(IMPORTS, `${hook}(() => {});`, ...tests(1)));
  });

  it("rejects test.each and it.each", () => {
    expectUnsupported(file(IMPORTS, 'test.each([[1, 1]])("x %i", (a, b) => { expect(clamp(a, 0, 5)).toBe(b); });'));
    expectUnsupported(file(IMPORTS, 'it.each([1])("x %i", (a) => { expect(clamp(a, 0, 5)).toBe(a); });'));
  });

  it("rejects top-level non-import statements", () => {
    expectUnsupported(file(IMPORTS, "const lo = 0;", ...tests(1)));
    expectUnsupported(file(IMPORTS, "function helper() { return 1; }", ...tests(1)));
    expectUnsupported(file(IMPORTS, "export const x = 1;", ...tests(1)));
    expectUnsupported(file(IMPORTS, "clamp(1, 0, 5);", ...tests(1)));
    expectUnsupported(file(IMPORTS, '"use strict";', ...tests(1)));
    expectUnsupported(file(IMPORTS, ...tests(1), ";"));
    expectUnsupported(file(IMPORTS, "if (true) { test(\"a\", () => {}); }"));
  });

  it(`rejects more than ${MAX_TESTS_PER_FILE} tests`, () => {
    expectUnsupported(file(IMPORTS, ...tests(9)));
  });

  it("rejects duplicate test names", () => {
    expectUnsupported(file(IMPORTS, 'test("same", () => {});', 'it("same", () => {});'));
  });

  it("rejects files with no tests", () => {
    expectUnsupported(IMPORTS);
  });

  it("rejects non-literal names, async/generator/parameterised bodies and extra arguments", () => {
    expectUnsupported(file(IMPORTS, "const n = 'x';", "test(n, () => {});"));
    expectUnsupported(file(IMPORTS, "test(`a ${1}`, () => {});"));
    expectUnsupported(file(IMPORTS, 'test("a", async () => { expect(clamp(1, 0, 5)).toBe(1); });'));
    expectUnsupported(file(IMPORTS, 'test("a", function* () {});'));
    expectUnsupported(file(IMPORTS, 'test("a", (ctx) => { expect(ctx).toBeDefined(); });'));
    expectUnsupported(file(IMPORTS, 'test("a", () => { expect(clamp(1, 0, 5)).toBe(1); }, 60000);'));
    expectUnsupported(file(IMPORTS, 'test("a");'));
  });

  it("rejects unknown modifiers such as test.fails and computed access", () => {
    expectUnsupported(file(IMPORTS, 'test.fails("a", () => {});'));
    expectUnsupported(file(IMPORTS, 'test["only"]("a", () => {});'));
  });

  it("rejects an import that follows a test", () => {
    expectUnsupported(file('import { test, expect } from "vitest";', ...tests(1), 'import { clamp } from "./src";'));
  });
});

describe("parse errors", () => {
  it("reports syntax / parse-error with a position", () => {
    const r = parseCandidate(file(IMPORTS, 'test("a", () => {', "  expect(clamp(1, 0, 5)).toBe(1);"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("syntax");
      expect(r.subReason).toBe("parse-error");
      expect(r.position).not.toBeNull();
    }
  });

  it("treats JSX in a .ts candidate as a parse error", () => {
    const r = parseCandidate(file(IMPORTS, 'test("a", () => { const el = <div />; expect(el).toBeTruthy(); });'));
    expect(r).toMatchObject({ ok: false, code: "syntax", subReason: "parse-error" });
  });
});
