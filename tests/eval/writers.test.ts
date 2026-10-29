import { expect, it } from "vitest";
import { PublicAnalysisSchema, REJECTION_CODES } from "../../cli/core/schemas.js";
import { compareCampaign } from "../../cli/evalkit/compare.js";
import { resultsMd } from "../../cli/evalkit/resultsMd.js";
import { limitationsMd, mergeLimitations } from "../../cli/evalkit/limitationsMd.js";
import { campaign, manifest } from "./fixtures.js";

it("generates MOCK table from fixture rows with explicit missing status and all seven zero rejection keys", () => {
  const observations = campaign(), rows = observations.map((o) => o.row);
  expect(Object.keys(rows[0]!.rejectedByCode).sort()).toEqual([...REJECTION_CODES].sort());
  const analysis = PublicAnalysisSchema.parse({ schemaVersion: 1, runId: "sample", campaignId: "fixture-campaign", split: "heldout",
    providerMode: "mock", executionProvenance: "recorded-fixture", sandboxQualified: false, manifestEdition: 1, seed: 39,
    inventories: [], cells: [] });
  const md = resultsMd(rows, compareCampaign(manifest, "heldout", observations.slice(1)), [analysis]);
  expect(md).toContain("MOCK / REPLAY"); expect(md).toContain("not computable — incomplete campaign");
  expect(md).toContain("50.00%"); expect(md).toContain("n/a");
  const limitations = limitationsMd([analysis]);
  expect(limitations).toContain("whole policies"); expect(limitations).toContain("Passing twice");
  expect(limitations).toContain("Unlabelled equivalence remains unknown");
  expect(PublicAnalysisSchema.safeParse({ ...analysis, absolutePath: "C:/private" }).success).toBe(false);
});

it("preserves authored limitations bytes across repeated generation and refuses malformed markers", () => {
  // Regression: held-out evaluation previously replaced all authored safety and study disclosures.
  const authored = "<!-- STATIC-LIMITATIONS:START -->\r\nAuthored Ω disclosure.\r\n<!-- STATIC-LIMITATIONS:END -->";
  const template = `# Limitations\n${authored}\n<!-- GENERATED-LIMITATIONS:START -->\nnot yet measured\n<!-- GENERATED-LIMITATIONS:END -->\n`;
  const first = mergeLimitations(template, "first generated result\n");
  const second = mergeLimitations(first, "second generated result\n");
  expect(second).toContain(authored);
  expect(second).toContain("second generated result");
  expect(second).not.toContain("first generated result");
  expect(() => mergeLimitations("legacy authored text", "new")).toThrow("restore the authored template");
  expect(() => mergeLimitations(template + "<!-- STATIC-LIMITATIONS:END -->", "new")).toThrow("restore the authored template");
  expect(() => mergeLimitations(template.replace("<!-- STATIC-LIMITATIONS:END -->", ""), "new")).toThrow("restore the authored template");
  const unordered = "<!-- GENERATED-LIMITATIONS:START --><!-- STATIC-LIMITATIONS:START --><!-- STATIC-LIMITATIONS:END --><!-- GENERATED-LIMITATIONS:END -->";
  expect(() => mergeLimitations(unordered, "new")).toThrow("restore the authored template");
});
