import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { validateWebsiteConfig } from "../../src/website/config.js";
import { aggregateSamples } from "../../src/website/measure/runner.js";
import type { BrowserMeasurement } from "../../src/website/measure/types.js";
import {
  createWebsitePrompt,
  readWebsiteHypothesis,
  summarizeHypothesis,
} from "../../src/website/prompt.js";
import type { CwvMetric } from "../../src/website/config.js";

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
    pages: [
      { id: "home", path: "/home-target", scenarios: ["cold-load"] },
      {
        id: "other",
        path: "/other-secret",
        scenarios: ["interaction"],
        interaction: [{ action: "click", selector: "#do-not-leak-scenario" }],
      },
    ],
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

const METRIC_PHRASES: Record<CwvMetric, string> = {
  lcpMs: "measured LCP element",
  inpMs: "caused this interaction",
  cls: "Do not hide elements",
  fcpMs: "transfer sizes alone",
};

describe("website prompt", () => {
  it("truncates history hypotheses to one line", () => {
    expect(summarizeHypothesis("A\n\nB\nC")).toBe("A B C");
  });

  it("gives the selected bottleneck a compact evidence context", () => {
    const aggregates = [
      aggregateSamples("home:cold-load", [sample()]),
      aggregateSamples("other:interaction", [
        {
          ...sample(),
          scenario: "other:interaction",
          raw: { trace: "TRACE_BLOB_SENTINEL" },
        },
      ]),
    ];
    aggregates[1]!.medians.lcpMs = 86420;
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
          targetMetric: "lcpMs",
          scenario: "home:cold-load",
          decisionReasons: ["CLS regressed"],
          filesModified: ["templates/index.html"],
        },
      ],
    });
    expect(prompt).toContain("SPAN.main-page__title.is-shown");
    expect(prompt).toContain("Step 1 — Understand the bottleneck");
    expect(prompt).toContain("measured LCP element");
    expect(prompt).toContain("edit unrelated routes");
    expect(prompt).toContain(
      "Do not repeat a previously unsuccessful hypothesis without new evidence or a meaningfully different implementation.",
    );
    expect(prompt).not.toContain("previous attempt's file set");
    expect(prompt).toContain("Tried day-symbol SSR ### details");
    expect(prompt).toContain("templates/index.html");
    expect(prompt).not.toContain("TRACE_BLOB_SENTINEL");
    expect(prompt).not.toContain("86420");
    expect(prompt).not.toContain("/other-secret");
    expect(prompt).not.toContain("#do-not-leak-scenario");
    expect(prompt).not.toContain('"samples"');
    expect(prompt).not.toContain("caused this interaction");
    expect(prompt).not.toContain("Do not hide elements");
    expect(prompt).not.toContain("transfer sizes alone");
    const context = JSON.parse(
      prompt.slice(prompt.indexOf("\nContext:\n") + "\nContext:\n".length),
    );
    expect(context.diagnostics.element).toBe("SPAN.main-page__title.is-shown");
    expect(context.previousAttempts).toHaveLength(1);
  });

  it("includes only the selected metric strategy", () => {
    for (const metric of Object.keys(METRIC_PHRASES) as CwvMetric[]) {
      const prompt = createWebsitePrompt({
        config: config(),
        bottleneck: {
          metric,
          scenario: metric === "inpMs" ? "home:interaction" : "home:cold-load",
          median: 10,
          threshold: 1,
          excessRatio: 10,
        },
        aggregates: [],
        history: [],
      });
      expect(prompt).toContain(METRIC_PHRASES[metric]);
      for (const other of Object.keys(METRIC_PHRASES) as CwvMetric[]) {
        if (other !== metric)
          expect(prompt).not.toContain(METRIC_PHRASES[other]);
      }
    }
  });

  it("keeps the hypothesis field compatible with extra response fields", () => {
    expect(
      readWebsiteHypothesis({
        hypothesis: "  Preload the hero image  ",
        evidence: "Resource load delay is 1200 ms",
        expectedImpact: "Reduce resource load delay",
        changedFiles: ["src/hero.tsx"],
        regressionRisks: ["CLS"],
      }),
    ).toBe("Preload the hero image");
    expect(() =>
      readWebsiteHypothesis({ changedFiles: ["src/hero.tsx"] }),
    ).toThrow(/no hypothesis/);
    expect(() => readWebsiteHypothesis({ hypothesis: "   " })).toThrow(
      /no hypothesis/,
    );
    expect(() => readWebsiteHypothesis({ hypothesis: 12 })).toThrow(
      /no hypothesis/,
    );
  });
});
