import type { WebsiteConfig } from "./src/website/config.js";
import { resolve } from "node:path";

const project = resolve("fixtures/slow-site");

export default {
  workspace: {
    path: project,
    mode: "direct",
    versionControl: "git",
    requireCleanGit: true,
  },
  agent: {
    provider: "cursor",
    model: "auto",
  },
  website: {
    // External (Docker/OSPanel): baseUrl + buildCommand без start/port.
    // Пример: website.symbl.config.ts — npm run build во frontend/, сайт на :8000.
    // baseUrl: "http://localhost:8000",
    // cwd: "frontend",
    buildCommand: "npm run build",
    startCommand: "npm run start",
    healthCheckPath: "/",
    port: 4177,
    startTimeoutMs: 30_000,
    testCommand: "npm test",
  },
  browser: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    profile: "mobile",
    cpuSlowdownMultiplier: 4,
    networkPreset: "Slow4G",
    observationMs: 2500,
  },
  pages: [
    {
      id: "homepage",
      path: "/",
      scenarios: ["cold-load", "scroll", "interaction"],
      criticalSelectors: ["#hero", "#title", "#buy"],
      interaction: [
        { action: "waitForSelector", selector: "#buy" },
        { action: "click", selector: "#buy" },
      ],
    },
  ],
  measurements: {
    baselineRepeats: 10,
    quickRepeats: 3,
    confirmationBatches: [
      { role: "candidate", repeats: 3 },
      { role: "reference", repeats: 3 },
      { role: "candidate", repeats: 4 },
      { role: "reference", repeats: 4 },
    ],
  },
  budgets: {
    maxDurationMinutes: 90,
    maxIterations: 5,
  },
  objectives: {
    thresholds: {
      lcpMs: 2500,
      inpMs: 200,
      cls: 0.1,
      fcpMs: 1800,
    },
    safetyMarginPercent: 10,
    minImprovementPercent: 3,
    maxRegressionPercent: 5,
    protectedMetrics: ["lcpMs", "inpMs", "cls", "fcpMs"],
  },
  verification: {
    visualRegression: true,
    screenshotDiffThreshold: 0.15,
  },
  lighthouse: {
    enabled: true,
    formFactor: "mobile",
  },
} satisfies WebsiteConfig;
