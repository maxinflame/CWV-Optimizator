import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { validateWebsiteConfig } from "../../src/website/config.js";
import { aggregateSamples } from "../../src/website/measure/runner.js";
import type { BrowserMeasurement } from "../../src/website/measure/types.js";
import {
  createWebsitePrompt,
  summarizeHypothesis,
} from "../../src/website/prompt.js";

function config() {
  return validateWebsiteConfig({
    workspace: {
      path: resolve("/tmp/site"),
      mode: "direct",
      versionControl: "git",
      requireCleanGit: true,
    },
    agent: { provider: "cursor", model: "auto" },
    website: {
      buildCommand: "npm run build",
      startCommand: "npm run start",
      healthCheckPath: "/",
      port: 3000,
    },
    browser: {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      profile: "mobile",
    },
    pages: [{ id: "home", path: "/", scenarios: ["cold-load"] }],
    measurements: {
      baselineRepeats: 1,
      quickRepeats: 1,
      confirmationBatches: [{ role: "candidate", repeats: 1 }],
    },
    budgets: { maxDurationMinutes: 10, maxIterations: 2 },
    objectives: {
      thresholds: { lcpMs: 2500, inpMs: 200, cls: 0.1, fcpMs: 1800 },
      safetyMarginPercent: 0,
      minImprovementPercent: 5,
      maxRegressionPercent: 5,
      protectedMetrics: ["lcpMs", "cls", "fcpMs"],
    },
    verification: {},
  });
}

function sample(): BrowserMeasurement {
  return {
    scenario: "home:cold-load",
    pageId: "home",
    scenarioKind: "cold-load",
    url: "http://127.0.0.1/",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    lcpMs: { value: 4000, availability: "available" },
    fcpMs: { value: 1000, availability: "available" },
    cls: { value: 0.1, availability: "available" },
    inpMs: { value: null, availability: "unavailable" },
    ttfbMs: { value: 100, availability: "available" },
    lcpAttribution: {
      element: "SPAN.main-page__title.is-shown",
      url: null,
    },
    clsAttribution: {
      largestShiftValue: 0.1,
      sources: ["DIV"],
    },
    diagnostics: {
      resourceTransferBytes: 1_000_000,
      jsTransferBytes: 400_000,
      cssTransferBytes: 100_000,
    },
  };
}

describe("website prompt", () => {
  it("truncates history hypotheses to one line", () => {
    expect(summarizeHypothesis("A\n\nB\nC")).toBe("A B C");
  });

  it("includes attribution and scope instructions", () => {
    const aggregates = [aggregateSamples("home:cold-load", [sample()])];
    const prompt = createWebsitePrompt({
      config: config(),
      bottleneck: {
        metric: "lcpMs",
        scenario: "home:cold-load",
        median: 4000,
        threshold: 2250,
        excessRatio: 4000 / 2250,
      },
      aggregates,
      history: [
        {
          id: "iteration-001",
          status: "inconclusive",
          hypothesis: "Tried day-symbol SSR\n\n### details",
          decisionReasons: ["CLS regressed"],
          filesModified: ["templates/index.html"],
        },
      ],
    });
    expect(prompt).toContain("SPAN.main-page__title.is-shown");
    expect(prompt).toContain("Do not edit unrelated routes");
    expect(prompt).toContain("buildCommand");
    expect(prompt).toContain("PageSpeed Insights");
    expect(prompt).toContain("Tried day-symbol SSR ### details");
    expect(prompt).toContain("templates/index.html");
  });
});
