import {
  validateWebsiteConfig,
  type CwvMetric,
  type InteractionStep,
  type PageScenarioConfig,
  type ScenarioKind,
  type WebsiteConfig,
} from "../website/config.js";

export type RunMode = "measure" | "validate" | "optimize";

export const scenarioKinds = ["cold-load", "scroll", "interaction"] as const;
export const interactionActions = [
  "click",
  "type",
  "press",
  "waitForSelector",
  "hover",
] as const;
export const cwvMetrics = ["lcpMs", "inpMs", "cls", "fcpMs"] as const;
export const networkPresets = ["NoThrottling", "Slow4G", "Fast4G"] as const;

export interface GuiInteractionBody {
  action: (typeof interactionActions)[number];
  selector: string;
  text: string;
  key: string;
  timeoutMs: string;
}

export interface GuiPageBody {
  id: string;
  path: string;
  scenarios: ScenarioKind[];
  criticalSelectors: string[];
  interaction: GuiInteractionBody[];
}

export interface GuiFormBody {
  mode: RunMode;
  workspacePath: string;
  agentModel: string;
  agentReasoningEffort: string;
  serverMode: "external" | "managed";
  baseUrl: string;
  buildCommand: string;
  startCommand: string;
  healthCheckPath: string;
  port: string;
  startTimeoutMs: string;
  testCommand: string;
  cwd: string;
  viewportWidth: string;
  viewportHeight: string;
  deviceScaleFactor: string;
  profile: "mobile" | "desktop";
  cpuSlowdownMultiplier: string;
  networkPreset: "" | (typeof networkPresets)[number];
  observationMs: string;
  pages: GuiPageBody[];
  baselineRepeats: string;
  quickRepeats: string;
  confirmationBatches: Array<{
    role: "candidate" | "reference";
    repeats: string;
  }>;
  maxDurationMinutes: string;
  maxIterations: string;
  thresholds: Record<CwvMetric, string>;
  safetyMarginPercent: string;
  minImprovementPercent: string;
  maxRegressionPercent: string;
  protectedMetrics: CwvMetric[];
  visualRegression: boolean;
  screenshotDiffThreshold: string;
  lighthouseEnabled: boolean;
  lighthouseFormFactor: "mobile" | "desktop";
}

export interface GuiRunPlan {
  mode: RunMode;
  measureOnly: boolean;
  validateOnly: boolean;
  agentProvider?: string;
  config: WebsiteConfig;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Ожидается объект: ${label}`);
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function requiredText(value: unknown, label: string): string {
  const parsed = text(value);
  if (!parsed) throw new Error(`Заполните поле: ${label}`);
  return parsed;
}

function optionalText(value: unknown): string | undefined {
  return text(value) || undefined;
}

function requiredNumber(
  value: unknown,
  label: string,
  integer = false,
): number {
  const raw = typeof value === "number" ? String(value) : text(value);
  if (!raw) throw new Error(`Заполните поле: ${label}`);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`Ожидается число: ${label}`);
  if (integer && !Number.isSafeInteger(parsed))
    throw new Error(`Ожидается целое число: ${label}`);
  return parsed;
}

function optionalNumber(
  value: unknown,
  label: string,
  integer = false,
): number | undefined {
  const raw = typeof value === "number" ? String(value) : text(value);
  if (!raw) return undefined;
  return requiredNumber(raw, label, integer);
}

function readForm(body: unknown): Record<string, unknown> {
  const root = asRecord(body, "запрос");
  if ("form" in root) return asRecord(root.form, "форма");
  return root;
}

function parseMode(value: unknown): RunMode {
  if (value === "measure" || value === "validate" || value === "optimize")
    return value;
  throw new Error("Выберите режим запуска");
}

function parsePages(value: unknown): PageScenarioConfig[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("Добавьте хотя бы одну страницу");
  return value.map((item, index) => {
    const page = asRecord(item, `страница ${index + 1}`);
    const id = requiredText(page.id, `страница ${index + 1}: идентификатор`);
    const path = requiredText(page.path, `страница ${id}: путь`);
    if (!Array.isArray(page.scenarios) || page.scenarios.length === 0)
      throw new Error(`Страница ${id}: выберите сценарии`);
    const scenarios: ScenarioKind[] = [];
    for (const scenario of page.scenarios) {
      if (!scenarioKinds.includes(scenario as ScenarioKind))
        throw new Error(`Страница ${id}: неизвестный сценарий`);
      const kind = scenario as ScenarioKind;
      if (!scenarios.includes(kind)) scenarios.push(kind);
    }
    const criticalSelectors = Array.isArray(page.criticalSelectors)
      ? page.criticalSelectors.map((selector) => text(selector)).filter(Boolean)
      : [];
    const interaction = parseInteraction(page.interaction, id);
    if (scenarios.includes("interaction") && interaction.length === 0)
      throw new Error(`Страница ${id}: для сценария взаимодействия нужны шаги`);
    return {
      id,
      path,
      scenarios,
      ...(criticalSelectors.length ? { criticalSelectors } : {}),
      ...(interaction.length ? { interaction } : {}),
    };
  });
}

function parseInteraction(value: unknown, pageId: string): InteractionStep[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new Error(
      `Страница ${pageId}: шаги взаимодействия должны быть списком`,
    );
  return value.map((item, index) => {
    const step = asRecord(item, `шаг ${index + 1}`);
    const action = text(step.action);
    if (!interactionActions.includes(action as InteractionStep["action"]))
      throw new Error(
        `Страница ${pageId}, шаг ${index + 1}: неизвестное действие`,
      );
    const selector = optionalText(step.selector);
    const key = optionalText(step.key);
    const timeoutMs = optionalNumber(
      step.timeoutMs,
      `таймаут шага ${index + 1}`,
      true,
    );
    const parsed: InteractionStep = {
      action: action as InteractionStep["action"],
    };
    if (parsed.action === "press") {
      if (!key)
        throw new Error(
          `Страница ${pageId}, шаг ${index + 1}: укажите клавишу`,
        );
      parsed.key = key;
    } else if (parsed.action === "type") {
      if (!selector)
        throw new Error(
          `Страница ${pageId}, шаг ${index + 1}: укажите селектор`,
        );
      parsed.selector = selector;
      parsed.text = typeof step.text === "string" ? step.text : "";
    } else {
      if (!selector)
        throw new Error(
          `Страница ${pageId}, шаг ${index + 1}: укажите селектор`,
        );
      parsed.selector = selector;
    }
    if (timeoutMs !== undefined) parsed.timeoutMs = timeoutMs;
    return parsed;
  });
}

function parseThresholds(value: unknown): Partial<Record<CwvMetric, number>> {
  const source = value === undefined ? {} : asRecord(value, "пороги");
  const thresholds: Partial<Record<CwvMetric, number>> = {};
  for (const metric of cwvMetrics) {
    const parsed = optionalNumber(source[metric], `порог ${metric}`);
    if (parsed !== undefined) thresholds[metric] = parsed;
  }
  return thresholds;
}

function parseMetrics(value: unknown): CwvMetric[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("Выберите защищённые метрики");
  const metrics: CwvMetric[] = [];
  for (const metric of value) {
    if (!cwvMetrics.includes(metric as CwvMetric))
      throw new Error(`Неизвестная метрика: ${String(metric)}`);
    const parsed = metric as CwvMetric;
    if (!metrics.includes(parsed)) metrics.push(parsed);
  }
  return metrics;
}

function parseBatches(
  value: unknown,
): WebsiteConfig["measurements"]["confirmationBatches"] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("Добавьте пакеты подтверждения");
  return value.map((item, index) => {
    const batch = asRecord(item, `пакет ${index + 1}`);
    if (batch.role !== "candidate" && batch.role !== "reference")
      throw new Error(`Пакет ${index + 1}: роль candidate или reference`);
    const repeats = requiredNumber(
      batch.repeats,
      `пакет ${index + 1}: повторы`,
      true,
    );
    if (repeats < 1)
      throw new Error(`Пакет ${index + 1}: повторов должно быть не меньше 1`);
    return { role: batch.role, repeats };
  });
}

export function buildGuiRun(body: unknown): GuiRunPlan {
  const form = readForm(body);
  const mode = parseMode(form.mode);
  const serverMode =
    form.serverMode === "external" || form.serverMode === "managed"
      ? form.serverMode
      : undefined;
  if (!serverMode)
    throw new Error("Выберите режим сервера: внешний URL или свой процесс");
  const profile =
    form.profile === "mobile" || form.profile === "desktop"
      ? form.profile
      : undefined;
  if (!profile) throw new Error('Профиль браузера: "mobile" или "desktop"');
  const networkRaw = optionalText(form.networkPreset);
  const networkPreset =
    networkRaw === undefined
      ? undefined
      : networkPresets.find((preset) => preset === networkRaw);
  if (networkRaw !== undefined && !networkPreset)
    throw new Error("Неизвестный сетевой профиль");

  const external = serverMode === "external";
  const baseUrl = optionalText(form.baseUrl);
  const buildCommand = optionalText(form.buildCommand);
  const startCommand = optionalText(form.startCommand);
  const port = optionalNumber(form.port, "порт", true);
  if (external && !baseUrl) throw new Error("Заполните поле: базовый URL");
  if (!external) {
    if (!buildCommand) throw new Error("Заполните поле: команда сборки");
    if (!startCommand) throw new Error("Заполните поле: команда запуска");
    if (port === undefined) throw new Error("Заполните поле: порт");
  }

  const screenshotDiffThreshold = optionalNumber(
    form.screenshotDiffThreshold,
    "порог визуального отличия",
  );
  const formFactor =
    form.lighthouseFormFactor === "desktop" ? "desktop" : "mobile";
  const config = validateWebsiteConfig({
    workspace: {
      path: requiredText(form.workspacePath, "репозиторий"),
      mode: "direct",
      versionControl: "git",
      requireCleanGit: true,
    },
    agent: {
      provider: "cursor",
      model: requiredText(form.agentModel, "модель агента"),
      ...(optionalText(form.agentReasoningEffort)
        ? { reasoningEffort: optionalText(form.agentReasoningEffort) }
        : {}),
    },
    website: {
      ...(external && baseUrl ? { baseUrl } : {}),
      ...(buildCommand ? { buildCommand } : {}),
      ...(startCommand ? { startCommand } : {}),
      healthCheckPath: requiredText(form.healthCheckPath, "путь health-check"),
      ...(port !== undefined ? { port } : {}),
      ...(optionalNumber(form.startTimeoutMs, "таймаут старта", true) !==
      undefined
        ? {
            startTimeoutMs: optionalNumber(
              form.startTimeoutMs,
              "таймаут старта",
              true,
            ),
          }
        : {}),
      ...(optionalText(form.testCommand)
        ? { testCommand: optionalText(form.testCommand) }
        : {}),
      ...(optionalText(form.cwd) ? { cwd: optionalText(form.cwd) } : {}),
    },
    browser: {
      viewport: {
        width: requiredNumber(form.viewportWidth, "ширина окна", true),
        height: requiredNumber(form.viewportHeight, "высота окна", true),
      },
      deviceScaleFactor: requiredNumber(form.deviceScaleFactor, "масштаб"),
      profile,
      ...(optionalNumber(form.cpuSlowdownMultiplier, "замедление CPU") !==
      undefined
        ? {
            cpuSlowdownMultiplier: optionalNumber(
              form.cpuSlowdownMultiplier,
              "замедление CPU",
            ),
          }
        : {}),
      ...(networkPreset ? { networkPreset } : {}),
      ...(optionalNumber(form.observationMs, "время наблюдения", true) !==
      undefined
        ? {
            observationMs: optionalNumber(
              form.observationMs,
              "время наблюдения",
              true,
            ),
          }
        : {}),
    },
    pages: parsePages(form.pages),
    measurements: {
      baselineRepeats: requiredNumber(
        form.baselineRepeats,
        "повторы базового замера",
        true,
      ),
      quickRepeats: requiredNumber(form.quickRepeats, "быстрые повторы", true),
      confirmationBatches: parseBatches(form.confirmationBatches),
    },
    budgets: {
      maxDurationMinutes: requiredNumber(
        form.maxDurationMinutes,
        "лимит минут",
      ),
      maxIterations: requiredNumber(form.maxIterations, "лимит итераций", true),
    },
    objectives: {
      thresholds: parseThresholds(form.thresholds),
      safetyMarginPercent: requiredNumber(
        form.safetyMarginPercent,
        "запас порога",
      ),
      minImprovementPercent: requiredNumber(
        form.minImprovementPercent,
        "минимальное улучшение",
      ),
      maxRegressionPercent: requiredNumber(
        form.maxRegressionPercent,
        "допустимая регрессия",
      ),
      protectedMetrics: parseMetrics(form.protectedMetrics),
    },
    verification: {
      visualRegression: form.visualRegression === true,
      ...(screenshotDiffThreshold !== undefined
        ? { screenshotDiffThreshold }
        : {}),
    },
    lighthouse: {
      enabled: form.lighthouseEnabled === true,
      formFactor,
    },
  });

  return {
    mode,
    measureOnly: mode === "measure",
    validateOnly: mode === "validate",
    ...(mode === "optimize" ? { agentProvider: "cursor" } : {}),
    config,
  };
}

function stepFromConfig(step: InteractionStep): GuiInteractionBody {
  return {
    action: step.action,
    selector: step.selector ?? "",
    text: step.text ?? "",
    key: step.key ?? "",
    timeoutMs: step.timeoutMs === undefined ? "" : String(step.timeoutMs),
  };
}

/** Форма из уже собранного WebsiteConfig. Режим запуска в конфиге сайта не хранится. */
export function formFromWebsiteConfig(
  config: WebsiteConfig,
  mode: RunMode = "optimize",
): GuiFormBody {
  const external = Boolean(config.website.baseUrl?.trim());
  const thresholds = {} as Record<CwvMetric, string>;
  for (const metric of cwvMetrics) {
    const value = config.objectives.thresholds[metric];
    thresholds[metric] = value === undefined ? "" : String(value);
  }
  return {
    mode,
    workspacePath: config.workspace.path,
    agentModel: config.agent.model,
    agentReasoningEffort: config.agent.reasoningEffort ?? "",
    serverMode: external ? "external" : "managed",
    baseUrl: config.website.baseUrl ?? "",
    buildCommand: config.website.buildCommand ?? "",
    startCommand: config.website.startCommand ?? "",
    healthCheckPath: config.website.healthCheckPath,
    port: config.website.port === undefined ? "" : String(config.website.port),
    startTimeoutMs:
      config.website.startTimeoutMs === undefined
        ? ""
        : String(config.website.startTimeoutMs),
    testCommand: config.website.testCommand ?? "",
    cwd: config.website.cwd ?? "",
    viewportWidth: String(config.browser.viewport.width),
    viewportHeight: String(config.browser.viewport.height),
    deviceScaleFactor: String(config.browser.deviceScaleFactor),
    profile: config.browser.profile,
    cpuSlowdownMultiplier:
      config.browser.cpuSlowdownMultiplier === undefined
        ? ""
        : String(config.browser.cpuSlowdownMultiplier),
    networkPreset: config.browser.networkPreset ?? "",
    observationMs:
      config.browser.observationMs === undefined
        ? ""
        : String(config.browser.observationMs),
    pages: config.pages.map((page) => ({
      id: page.id,
      path: page.path,
      scenarios: [...page.scenarios],
      criticalSelectors: [...(page.criticalSelectors ?? [])],
      interaction: (page.interaction ?? []).map(stepFromConfig),
    })),
    baselineRepeats: String(config.measurements.baselineRepeats),
    quickRepeats: String(config.measurements.quickRepeats),
    confirmationBatches: config.measurements.confirmationBatches.map(
      (batch) => ({
        role: batch.role,
        repeats: String(batch.repeats),
      }),
    ),
    maxDurationMinutes: String(config.budgets.maxDurationMinutes),
    maxIterations: String(config.budgets.maxIterations),
    thresholds,
    safetyMarginPercent: String(config.objectives.safetyMarginPercent),
    minImprovementPercent: String(config.objectives.minImprovementPercent),
    maxRegressionPercent: String(config.objectives.maxRegressionPercent),
    protectedMetrics: [...config.objectives.protectedMetrics],
    visualRegression: config.verification.visualRegression === true,
    screenshotDiffThreshold:
      config.verification.screenshotDiffThreshold === undefined
        ? ""
        : String(config.verification.screenshotDiffThreshold),
    lighthouseEnabled: config.lighthouse?.enabled === true,
    lighthouseFormFactor:
      config.lighthouse?.formFactor === "desktop" ? "desktop" : "mobile",
  };
}
