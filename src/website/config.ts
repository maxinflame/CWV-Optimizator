import { pathToFileURL } from "node:url";
import { isAbsolute, resolve } from "node:path";
import type { AgentSettings } from "../agents/types.js";

export type CwvMetric = "lcpMs" | "fcpMs" | "cls" | "inpMs";

export const cwvThresholds = {
  lcpMs: 2500,
  inpMs: 200,
  cls: 0.1,
  fcpMs: 1800,
} as const satisfies Record<CwvMetric, number>;

export type ScenarioKind = "cold-load" | "scroll" | "interaction";

export interface InteractionStep {
  action: "click" | "type" | "press" | "waitForSelector" | "hover";
  selector?: string;
  text?: string;
  key?: string;
  timeoutMs?: number;
}

export interface PageScenarioConfig {
  id: string;
  path: string;
  scenarios: ScenarioKind[];
  interaction?: InteractionStep[];
  criticalSelectors?: string[];
}

export interface WebsiteConfig {
  workspace: {
    path: string;
    mode: "direct";
    versionControl: "git";
    requireCleanGit: true;
  };
  agent: AgentSettings;
  website: {
    /**
     * Уже запущенный origin (OSPanel, Docker и т.п.). Пайплайн не стартует
     * и не останавливает процесс сервера: только health-check и опциональный
     * buildCommand после checkout (для фронтенда / артефактов).
     */
    baseUrl?: string;
    /** Managed: обязателен. External: опционален; выполняется при rebuild без stop/start. */
    buildCommand?: string;
    /** Только managed-режим (свой process на PORT). */
    startCommand?: string;
    healthCheckPath: string;
    port?: number;
    startTimeoutMs?: number;
    testCommand?: string;
    cwd?: string;
  };
  browser: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    profile: "mobile" | "desktop";
    cpuSlowdownMultiplier?: number;
    networkPreset?: "NoThrottling" | "Slow4G" | "Fast4G";
    observationMs?: number;
  };
  pages: PageScenarioConfig[];
  measurements: {
    baselineRepeats: number;
    quickRepeats: number;
    confirmationBatches: Array<{ role: "candidate" | "reference"; repeats: number }>;
  };
  budgets: { maxDurationMinutes: number; maxIterations: number };
  objectives: {
    thresholds: Partial<Record<CwvMetric, number>>;
    safetyMarginPercent: number;
    minImprovementPercent: number;
    maxRegressionPercent: number;
    protectedMetrics: CwvMetric[];
  };
  verification: {
    visualRegression?: boolean;
    screenshotDiffThreshold?: number;
  };
  lighthouse?: {
    enabled: boolean;
    formFactor?: "mobile" | "desktop";
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object");
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Expected nonempty string: ${label}`);
}

function number(
  value: unknown,
  label: string,
  minimum: number,
  integer = false,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    (integer && !Number.isSafeInteger(value))
  )
    throw new Error(`Expected ${integer ? "integer" : "number"} >= ${minimum}: ${label}`);
}

function assertHttpOrigin(value: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error(`${label} must use http: or https:`);
  if (parsed.username || parsed.password)
    throw new Error(`${label} must not include credentials`);
}

/** Origin уже запущенного сайта: пайплайн не управляет процессом сервера. */
export function usesExternalServer(config: WebsiteConfig): boolean {
  return Boolean(config.website.baseUrl?.trim());
}

/** Нормализованный base URL для измерений и health-check (без завершающего `/`). */
export function resolveWebsiteBaseUrl(config: WebsiteConfig): string {
  const external = config.website.baseUrl?.trim();
  if (external) {
    const url = new URL(external);
    url.hash = "";
    url.search = "";
    if (url.pathname === "/" || url.pathname === "") return url.origin;
    return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
  }
  const port = config.website.port;
  if (port === undefined)
    throw new Error("website.port is required when website.baseUrl is not set");
  return `http://127.0.0.1:${port}`;
}

export function validateWebsiteConfig(value: unknown): WebsiteConfig {
  const config = object(value);
  const workspace = object(config.workspace);
  text(workspace.path, "workspace.path");
  if (!isAbsolute(workspace.path))
    throw new Error("workspace.path must be an absolute path");
  if (workspace.mode !== "direct") throw new Error('workspace.mode must be "direct"');
  if (workspace.versionControl !== "git")
    throw new Error('workspace.versionControl must be "git"');
  if (workspace.requireCleanGit !== true)
    throw new Error("workspace.requireCleanGit must be true");

  const agent = object(config.agent);
  text(agent.provider, "agent.provider");
  text(agent.model, "agent.model");
  if (agent.provider !== "cursor")
    throw new Error('agent.provider must be "cursor"');
  if (agent.reasoningEffort !== undefined)
    text(agent.reasoningEffort, "agent.reasoningEffort");

  const website = object(config.website);
  text(website.healthCheckPath, "website.healthCheckPath");
  if (website.baseUrl !== undefined) {
    text(website.baseUrl, "website.baseUrl");
    assertHttpOrigin(website.baseUrl, "website.baseUrl");
  }
  if (!website.baseUrl) {
    text(website.buildCommand, "website.buildCommand");
    text(website.startCommand, "website.startCommand");
    number(website.port, "website.port", 1, true);
  } else {
    if (website.buildCommand !== undefined) text(website.buildCommand, "website.buildCommand");
    if (website.startCommand !== undefined) text(website.startCommand, "website.startCommand");
    if (website.port !== undefined) number(website.port, "website.port", 1, true);
  }
  if (website.startTimeoutMs !== undefined)
    number(website.startTimeoutMs, "website.startTimeoutMs", 1, true);
  if (website.testCommand !== undefined) text(website.testCommand, "website.testCommand");
  if (website.cwd !== undefined) text(website.cwd, "website.cwd");

  const browser = object(config.browser);
  const viewport = object(browser.viewport);
  number(viewport.width, "browser.viewport.width", 1, true);
  number(viewport.height, "browser.viewport.height", 1, true);
  number(browser.deviceScaleFactor, "browser.deviceScaleFactor", Number.MIN_VALUE);
  if (browser.profile !== "mobile" && browser.profile !== "desktop")
    throw new Error('browser.profile must be "mobile" or "desktop"');

  if (!Array.isArray(config.pages) || !config.pages.length)
    throw new Error("pages must be a nonempty array");
  const pageIds = new Set<string>();
  for (const page of config.pages) {
    const item = object(page);
    text(item.id, "pages.id");
    text(item.path, "pages.path");
    if (pageIds.has(item.id)) throw new Error(`Duplicate page id: ${item.id}`);
    pageIds.add(item.id);
    if (!Array.isArray(item.scenarios) || !item.scenarios.length)
      throw new Error(`Page ${item.id} requires scenarios`);
    for (const scenario of item.scenarios) {
      if (!["cold-load", "scroll", "interaction"].includes(String(scenario)))
        throw new Error(`Unknown scenario kind: ${String(scenario)}`);
    }
  }

  const measurements = object(config.measurements);
  number(measurements.baselineRepeats, "measurements.baselineRepeats", 1, true);
  number(measurements.quickRepeats, "measurements.quickRepeats", 1, true);
  if (
    !Array.isArray(measurements.confirmationBatches) ||
    !measurements.confirmationBatches.length
  )
    throw new Error("measurements.confirmationBatches required");

  const budgets = object(config.budgets);
  number(budgets.maxDurationMinutes, "budgets.maxDurationMinutes", Number.MIN_VALUE);
  number(budgets.maxIterations, "budgets.maxIterations", 0, true);

  const objectives = object(config.objectives);
  number(objectives.safetyMarginPercent, "objectives.safetyMarginPercent", 0);
  number(objectives.minImprovementPercent, "objectives.minImprovementPercent", Number.MIN_VALUE);
  number(objectives.maxRegressionPercent, "objectives.maxRegressionPercent", 0);
  if (!Array.isArray(objectives.protectedMetrics) || !objectives.protectedMetrics.length)
    throw new Error("objectives.protectedMetrics required");
  for (const metric of objectives.protectedMetrics) {
    if (!Object.hasOwn(cwvThresholds, String(metric)))
      throw new Error(`Unknown protected metric: ${String(metric)}`);
  }

  return value as WebsiteConfig;
}

export async function loadWebsiteConfig(path: string): Promise<WebsiteConfig> {
  const absolute = resolve(path);
  const module = (await import(pathToFileURL(absolute).href)) as {
    default: unknown;
  };
  return validateWebsiteConfig(module.default);
}

export function scenarioKeys(config: WebsiteConfig): string[] {
  return config.pages.flatMap((page) =>
    page.scenarios.map((scenario) => `${page.id}:${scenario}`),
  );
}

export function isCwvMetric(value: string): value is CwvMetric {
  return Object.hasOwn(cwvThresholds, value);
}

export function effectiveThreshold(
  config: WebsiteConfig,
  metric: CwvMetric,
): number {
  const base = config.objectives.thresholds[metric] ?? cwvThresholds[metric];
  const margin = 1 - config.objectives.safetyMarginPercent / 100;
  return base * margin;
}
