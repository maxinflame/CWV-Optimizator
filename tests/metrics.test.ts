import { expect, it } from "vitest";
import { summarize } from "../src/metrics.js";

it("computes median, p95 and spread", () => {
  expect(summarize([9, 1, 4, 2])).toEqual({
    samples: [9, 1, 4, 2],
    median: 3,
    p95: 9,
    min: 1,
    max: 9,
    spread: 8,
  });
});

it("rejects invalid samples", () => {
  expect(() => summarize([])).toThrow();
  expect(() => summarize([-1])).toThrow();
});
