import { resolve } from "node:path";
import type { GuiFormBody } from "../../src/gui/form.js";

export function sampleForm(patch: Partial<GuiFormBody> = {}): GuiFormBody {
  return {
    mode: "optimize",
    workspacePath: resolve("/tmp/cwv-site"),
    agentModel: "auto",
    agentReasoningEffort: "",
    serverMode: "managed",
    baseUrl: "",
    buildCommand: "npm run build",
    startCommand: "npm run start",
    healthCheckPath: "/",
    port: "4177",
    startTimeoutMs: "30000",
    testCommand: "",
    cwd: "",
    viewportWidth: "390",
    viewportHeight: "844",
    deviceScaleFactor: "1",
    profile: "mobile",
    cpuSlowdownMultiplier: "4",
    networkPreset: "Slow4G",
    observationMs: "2500",
    pages: [
      {
        id: "home",
        path: "/",
        scenarios: ["cold-load"],
        criticalSelectors: [],
        interaction: [],
      },
    ],
    baselineRepeats: "3",
    quickRepeats: "3",
    confirmationBatches: [
      { role: "candidate", repeats: "3" },
      { role: "reference", repeats: "3" },
    ],
    maxDurationMinutes: "60",
    maxIterations: "3",
    thresholds: { lcpMs: "2500", inpMs: "200", cls: "0.1", fcpMs: "1800" },
    safetyMarginPercent: "10",
    minImprovementPercent: "3",
    maxRegressionPercent: "5",
    protectedMetrics: ["lcpMs", "inpMs", "cls", "fcpMs"],
    visualRegression: true,
    screenshotDiffThreshold: "0.2",
    lighthouseEnabled: true,
    lighthouseFormFactor: "mobile",
    ...patch,
  };
}
