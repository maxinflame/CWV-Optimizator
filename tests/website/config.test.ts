import { expect, it } from "vitest";
import { resolve } from "node:path";
import {
  validateWebsiteConfig,
  effectiveThreshold,
  resolveWebsiteBaseUrl,
  usesExternalServer,
  type WebsiteConfig,
} from "../../src/website/config.js";

function sample(overrides: Record<string, unknown> = {}): WebsiteConfig {
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
      baselineRepeats: 10,
      quickRepeats: 3,
      confirmationBatches: [{ role: "candidate", repeats: 3 }],
    },
    budgets: { maxDurationMinutes: 30, maxIterations: 3 },
    objectives: {
      thresholds: { lcpMs: 2500 },
      safetyMarginPercent: 10,
      minImprovementPercent: 3,
      maxRegressionPercent: 5,
      protectedMetrics: ["lcpMs", "cls", "fcpMs", "inpMs"],
    },
    verification: {},
    ...overrides,
  });
}

it("accepts a valid website config", () => {
  expect(sample().website.port).toBe(3000);
});

it("rejects relative workspace paths", () => {
  expect(() =>
    sample({
      workspace: {
        path: "relative/site",
        mode: "direct",
        versionControl: "git",
        requireCleanGit: true,
      },
    }),
  ).toThrow(/absolute/);
});

it("applies safety margin to thresholds", () => {
  const config = sample();
  expect(effectiveThreshold(config, "lcpMs")).toBeCloseTo(2250);
});

it("accepts external baseUrl without managed port/commands", () => {
  const config = validateWebsiteConfig({
    workspace: {
      path: resolve("/tmp/site"),
      mode: "direct",
      versionControl: "git",
      requireCleanGit: true,
    },
    agent: { provider: "cursor", model: "auto" },
    website: {
      baseUrl: "http://daridari.local/",
      healthCheckPath: "/",
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
    budgets: { maxDurationMinutes: 10, maxIterations: 1 },
    objectives: {
      thresholds: {},
      safetyMarginPercent: 10,
      minImprovementPercent: 3,
      maxRegressionPercent: 5,
      protectedMetrics: ["lcpMs"],
    },
    verification: {},
  });
  expect(usesExternalServer(config)).toBe(true);
  expect(resolveWebsiteBaseUrl(config)).toBe("http://daridari.local");
});

it("rejects non-http baseUrl", () => {
  expect(() =>
    sample({
      website: {
        baseUrl: "file:///tmp/site",
        healthCheckPath: "/",
      },
    }),
  ).toThrow(/http/);
});

it("resolves managed base URL from port", () => {
  expect(resolveWebsiteBaseUrl(sample())).toBe("http://127.0.0.1:3000");
});
