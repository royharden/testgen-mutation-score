import { expect, it } from "vitest";
import { compareCampaign, INCOMPLETE, pairedBootstrap } from "../../cli/evalkit/compare.js";
import { campaign, manifest } from "./fixtures.js";

it("uses equal subject weight and three repeat aggregates; pooled counts cannot substitute", () => {
  const observations = campaign();
  observations.find((o) => o.row.subjectId === "held-one" && o.row.arm === "A5")!.row.counts.killed = 1000;
  const result = compareCampaign(manifest, "heldout", observations), a5 = result.aggregates.find((a) => a.arm === "A5")!;
  expect(result.status).toBe("complete"); expect(a5.repeats).toEqual([.5, .5, .5]); expect(a5.median).toBe(.5);
});
it("requires the manifest's unobserved subject and every model repeat, never complete-case pairs", () => {
  for (const observations of [campaign().filter((o) => o.row.subjectId !== "held-two"),
    campaign().filter((o) => !(o.row.arm === "A6" && o.row.repeat === 2 && o.row.subjectId === "held-two"))]) {
    const result = compareCampaign(manifest, "heldout", observations);
    expect(result.status).toBe(INCOMPLETE); expect(result.bootstrap.low).toBeNull(); expect(result.hypothesis).toBe(INCOMPLETE);
    expect(result.aggregates.every((a) => a.repeats.every((v) => v === null))).toBe(true);
  }
});
it("invalid/error cells and incomplete twins suppress all campaign inference", () => {
  const observations = campaign(); observations[0]!.complete = false;
  expect(compareCampaign(manifest, "heldout", observations).status).toBe(INCOMPLETE);
  observations[0]!.complete = true; observations[0]!.row.overfit.twinIncomplete = 1;
  expect(compareCampaign(manifest, "heldout", observations).bootstrap.mean).toBeNull();
});
it("seeded 10,000 percentile bootstrap is reproducible and paired within subject", () => {
  expect(pairedBootstrap([.1, -.2, .4], 39)).toEqual(pairedBootstrap([.1, -.2, .4], 39));
  expect(pairedBootstrap([.125, .125], 39)).toEqual({ mean: .125, low: .125, high: .125 });
  const observations = campaign();
  for (const o of observations) if (o.row.arm === "A5") o.row.scoreRaw = o.row.scoreRaw! + .1;
  expect(compareCampaign(manifest, "heldout", observations).bootstrap.mean).toBeCloseTo(.1);
});
