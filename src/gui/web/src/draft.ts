import type { CwvMetric } from "../../../website/config.ts";
import type {
  GuiFormBody,
  GuiInteractionBody,
  GuiPageBody,
} from "../../form.ts";

export type { GuiFormBody, GuiPageBody, GuiInteractionBody };

const metrics = [
  "lcpMs",
  "inpMs",
  "cls",
  "fcpMs",
] as const satisfies readonly CwvMetric[];

export const metricLabels: Record<CwvMetric, string> = {
  lcpMs: "LCP, мс",
  inpMs: "INP, мс",
  cls: "CLS",
  fcpMs: "FCP, мс",
};

export const scenarioLabels = {
  "cold-load": "холодная загрузка",
  scroll: "прокрутка",
  interaction: "взаимодействие",
} as const;

export const actionLabels = {
  click: "клик",
  type: "ввод",
  press: "клавиша",
  waitForSelector: "ждать селектор",
  hover: "наведение",
} as const;

export function emptyStep(): GuiInteractionBody {
  return { action: "click", selector: "", text: "", key: "", timeoutMs: "" };
}

export function emptyPage(index: number): GuiPageBody {
  return {
    id: `page-${index + 1}`,
    path: "/",
    scenarios: ["cold-load"],
    criticalSelectors: [],
    interaction: [],
  };
}

export function defaultForm(): GuiFormBody {
  return {
    mode: "optimize",
    workspacePath: "",
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
    pages: [emptyPage(0)],
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
    protectedMetrics: [...metrics],
    visualRegression: true,
    screenshotDiffThreshold: "0.2",
    lighthouseEnabled: true,
    lighthouseFormFactor: "mobile",
  };
}

export const metricOrder = metrics;
