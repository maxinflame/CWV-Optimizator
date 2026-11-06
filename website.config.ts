import type { WebsiteConfig } from "./src/website/config.js";
import { resolve } from "node:path";

/**
 * Локальный конфиг для fixture `fixtures/slow-site`.
 * Для своего сайта скопируйте `website.config.example.ts` и укажите абсолютный путь.
 */
export default {
  workspace: {
    path: resolve("fixtures/slow-site"),
    mode: "direct",
    versionControl: "git",
    requireCleanGit: true,
  },
  agent: {
    provider: "cursor",
    model: "auto",
  },
  website: {
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
      id: "main",
      path: "/",
      scenarios: ["cold-load", "scroll"],
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
