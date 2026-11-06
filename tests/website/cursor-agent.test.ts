import { expect, it } from "vitest";
import { extractHypothesis } from "../../src/agents/cursor/parse.js";

it("extracts hypothesis JSON from Cursor text output", () => {
  expect(
    extractHypothesis('Done.\n{"hypothesis":"Preload the hero image"}\n'),
  ).toBe("Preload the hero image");
  expect(extractHypothesis("Hypothesis: delay third-party scripts")).toContain(
    "delay third-party scripts",
  );
});
