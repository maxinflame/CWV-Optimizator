import { expect, it } from "vitest";
import {
  extractHypothesis,
  parseCursorOutput,
} from "../../src/agents/cursor/parse.js";

it("extracts hypothesis JSON from Cursor text output", () => {
  expect(
    extractHypothesis('Done.\n{"hypothesis":"Preload the hero image"}\n'),
  ).toBe("Preload the hero image");
  expect(extractHypothesis("Hypothesis: delay third-party scripts")).toContain(
    "delay third-party scripts",
  );
});

it("keeps richer agent fields without requiring them", () => {
  const embedded = parseCursorOutput(
    'Done.\n{"hypothesis":"Preload the hero","evidence":"load delay 1200","expectedImpact":"Reduce resource load delay","changedFiles":["src/hero.tsx"],"regressionRisks":["CLS"]}\n',
  ) as {
    hypothesis: string;
    evidence: string;
    changedFiles: string[];
  };
  expect(embedded.hypothesis).toBe("Preload the hero");
  expect(embedded.evidence).toBe("load delay 1200");
  expect(embedded.changedFiles).toEqual(["src/hero.tsx"]);

  expect(
    parseCursorOutput('{"hypothesis":"Only the old field"}'),
  ).toMatchObject({
    hypothesis: "Only the old field",
  });
  expect(
    parseCursorOutput("Hypothesis: delay third-party scripts"),
  ).toMatchObject({
    hypothesis: "delay third-party scripts",
  });
  expect(parseCursorOutput("")).toBeUndefined();
  expect(parseCursorOutput('{"foo":1}')).toEqual({ foo: 1 });
});
