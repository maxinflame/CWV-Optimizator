import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { validateWebsiteConfig } from "../../src/website/config.js";
import {
  createWebsiteReport,
  formatHypothesisOneLine,
  renderMarkdown,
} from "../../src/website/report.js";

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

describe("website report markdown", () => {
  it("flattens multiline hypotheses into one line", () => {
    const text = formatHypothesisOneLine("Line one\n\n### Title\n- bullet");
    expect(text).toBe("Line one ### Title - bullet");
    expect(text.includes("\n")).toBe(false);
  });

  it("separates rejected and inconclusive sections", () => {
    const report = createWebsiteReport(config(), new Date());
    report.status = "failed";
    report.attempts.push(
      {
        id: "iteration-001",
        startedAt: new Date().toISOString(),
        status: "rejected",
        stage: "quick-measure",
        hypothesis: "Bad LCP change\nwith details",
        errors: [],
        decision: {
          accepted: false,
          inconclusive: false,
          reasons: ["Quick reject"],
          targetMetric: "lcpMs",
          scenario: "home:cold-load",
          referenceMedian: 4000,
          candidateMedian: 5000,
          improvementPercent: -25,
          regressions: [],
        },
      },
      {
        id: "iteration-002",
        startedAt: new Date().toISOString(),
        status: "inconclusive",
        stage: "confirm",
        hypothesis: "Unclear improvement",
        errors: [],
        decision: {
          accepted: false,
          inconclusive: true,
          reasons: ["Below required margin"],
          targetMetric: "lcpMs",
          scenario: "home:cold-load",
          referenceMedian: 4000,
          candidateMedian: 3950,
          improvementPercent: 1.25,
          regressions: [],
        },
      },
    );

    const md = renderMarkdown(report);
    expect(md).toContain("## Отклонённые гипотезы");
    expect(md).toContain("## Неубедительные гипотезы");
    expect(md).toMatch(/## Отклонённые гипотезы\n- iteration-001: Bad LCP change with details — Quick reject/);
    expect(md).toMatch(/## Неубедительные гипотезы\n- iteration-002: Unclear improvement — Below required margin/);
  });
});
