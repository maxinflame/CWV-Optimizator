import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  compareCandidate,
  quickReject,
  selectBottleneck,
} from "../../src/website/acceptance.js";
import { validateWebsiteConfig } from "../../src/website/config.js";
import { aggregateSamples } from "../../src/website/measure/runner.js";
import type { BrowserMeasurement } from "../../src/website/measure/types.js";

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
    pages: [{ id: "home", path: "/", scenarios: ["cold-load", "interaction"] }],
    measurements: {
      baselineRepeats: 3,
      quickRepeats: 3,
      confirmationBatches: [{ role: "candidate", repeats: 3 }],
    },
    budgets: { maxDurationMinutes: 10, maxIterations: 2 },
    objectives: {
      thresholds: { lcpMs: 2500, inpMs: 200, cls: 0.1, fcpMs: 1800 },
      safetyMarginPercent: 0,
      minImprovementPercent: 5,
      maxRegressionPercent: 5,
      protectedMetrics: ["lcpMs", "inpMs", "cls", "fcpMs"],
    },
    verification: {},
  });
}

function sample(
  scenario: string,
  values: Partial<Record<"lcpMs" | "fcpMs" | "cls" | "inpMs" | "ttfbMs", number>>,
): BrowserMeasurement {
  const metric = (value: number | undefined) =>
    value === undefined
      ? { value: null, availability: "unavailable" as const }
      : { value, availability: "available" as const };
  return {
    scenario,
    pageId: "home",
    scenarioKind: scenario.split(":")[1]!,
    url: "http://127.0.0.1/",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    lcpMs: metric(values.lcpMs),
    fcpMs: metric(values.fcpMs),
    cls: metric(values.cls),
    inpMs: metric(values.inpMs),
    ttfbMs: metric(values.ttfbMs),
  };
}

describe("website acceptance", () => {
  it("selects the metric farthest above threshold", () => {
    const aggregates = [
      aggregateSamples("home:cold-load", [
        sample("home:cold-load", { lcpMs: 4000, fcpMs: 1000, cls: 0.05 }),
        sample("home:cold-load", { lcpMs: 4100, fcpMs: 1100, cls: 0.04 }),
        sample("home:cold-load", { lcpMs: 3900, fcpMs: 900, cls: 0.06 }),
      ]),
    ];
    const bottleneck = selectBottleneck(aggregates, config());
    expect(bottleneck?.metric).toBe("lcpMs");
    expect(bottleneck?.scenario).toBe("home:cold-load");
  });

  it("accepts clear improvement without protected regressions", () => {
    const reference = aggregateSamples("home:cold-load", [
      sample("home:cold-load", { lcpMs: 4000, fcpMs: 1000, cls: 0.05, inpMs: 100 }),
      sample("home:cold-load", { lcpMs: 4100, fcpMs: 1100, cls: 0.04, inpMs: 110 }),
      sample("home:cold-load", { lcpMs: 3900, fcpMs: 900, cls: 0.06, inpMs: 90 }),
    ]);
    const candidate = aggregateSamples("home:cold-load", [
      sample("home:cold-load", { lcpMs: 3000, fcpMs: 1000, cls: 0.05, inpMs: 100 }),
      sample("home:cold-load", { lcpMs: 3100, fcpMs: 1050, cls: 0.05, inpMs: 105 }),
      sample("home:cold-load", { lcpMs: 2900, fcpMs: 950, cls: 0.05, inpMs: 95 }),
    ]);
    const decision = compareCandidate({
      config: config(),
      targetMetric: "lcpMs",
      scenario: "home:cold-load",
      reference,
      candidate,
      allReference: [reference],
      allCandidate: [candidate],
    });
    expect(decision.accepted).toBe(true);
  });

  it("accepts LCP improvement on cold-load when INP is unavailable", () => {
    const reference = aggregateSamples("home:cold-load", [
      sample("home:cold-load", { lcpMs: 4000, fcpMs: 1000, cls: 0.05 }),
      sample("home:cold-load", { lcpMs: 4100, fcpMs: 1100, cls: 0.04 }),
      sample("home:cold-load", { lcpMs: 3900, fcpMs: 900, cls: 0.06 }),
    ]);
    const candidate = aggregateSamples("home:cold-load", [
      sample("home:cold-load", { lcpMs: 3000, fcpMs: 1000, cls: 0.05 }),
      sample("home:cold-load", { lcpMs: 3100, fcpMs: 1050, cls: 0.05 }),
      sample("home:cold-load", { lcpMs: 2900, fcpMs: 950, cls: 0.05 }),
    ]);
    expect(reference.medians.inpMs).toBeNull();
    expect(candidate.medians.inpMs).toBeNull();
    const decision = compareCandidate({
      config: config(),
      targetMetric: "lcpMs",
      scenario: "home:cold-load",
      reference,
      candidate,
      allReference: [reference],
      allCandidate: [candidate],
    });
    expect(decision.accepted).toBe(true);
    expect(decision.inconclusive).toBe(false);
    expect(decision.reasons.join(" ")).not.toMatch(/inpMs unavailable/);
  });

  it("rejects obvious quick regressions", () => {
    const reference = aggregateSamples("home:cold-load", [
      sample("home:cold-load", { lcpMs: 3000 }),
      sample("home:cold-load", { lcpMs: 3000 }),
      sample("home:cold-load", { lcpMs: 3000 }),
    ]);
    const candidate = aggregateSamples("home:cold-load", [
      sample("home:cold-load", { lcpMs: 5000 }),
      sample("home:cold-load", { lcpMs: 5100 }),
      sample("home:cold-load", { lcpMs: 4900 }),
    ]);
    expect(quickReject(config(), "lcpMs", reference, candidate).reject).toBe(true);
  });

  it("quick-rejects protected CLS regression even when target improved", () => {
    const reference = aggregateSamples("home:cold-load", [
      sample("home:cold-load", { lcpMs: 4000, fcpMs: 1000, cls: 0.14 }),
      sample("home:cold-load", { lcpMs: 4100, fcpMs: 1100, cls: 0.14 }),
      sample("home:cold-load", { lcpMs: 3900, fcpMs: 900, cls: 0.14 }),
    ]);
    const candidate = aggregateSamples("home:cold-load", [
      sample("home:cold-load", { lcpMs: 3900, fcpMs: 1000, cls: 0.34 }),
      sample("home:cold-load", { lcpMs: 3850, fcpMs: 1050, cls: 0.34 }),
      sample("home:cold-load", { lcpMs: 3950, fcpMs: 950, cls: 0.34 }),
    ]);
    const result = quickReject(config(), "lcpMs", reference, candidate);
    expect(result.reject).toBe(true);
    expect(result.reason).toMatch(/protected metric cls regressed/i);
  });

  it("marks unavailable metrics instead of treating them as zero", () => {
    const aggregate = aggregateSamples("home:interaction", [
      sample("home:interaction", { lcpMs: 2000, inpMs: undefined as never }),
    ]);
    // Force unavailable INP
    aggregate.samples[0]!.inpMs = { value: null, availability: "unavailable" };
    const rebuilt = aggregateSamples("home:interaction", aggregate.samples);
    expect(rebuilt.medians.inpMs).toBeNull();
  });
});
