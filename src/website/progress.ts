import type { WebsiteConfig } from "./config.js";

export type PipelinePhase =
  | "repository"
  | "clean-tree"
  | "branch"
  | "agent-ready"
  | "build"
  | "server"
  | "health"
  | "browser"
  | "measure"
  | "lighthouse"
  | "agent"
  | "commit"
  | "verify"
  | "tests"
  | "smoke"
  | "checkout";

export interface PipelineProgress {
  phase: PipelinePhase;
  index?: number;
  total?: number;
  pagePath?: string;
  scenario?: string;
  measureKind?: "baseline" | "quick" | "confirm";
  role?: "candidate" | "reference";
  iteration?: number;
  iterationTotal?: number;
  metric?: string;
  model?: string;
  label?: "baseline" | "final";
}

const scenarioKinds: Record<string, string> = {
  "cold-load": "холодная загрузка",
  scroll: "прокрутка",
  interaction: "взаимодействие",
};

const metricNames: Record<string, string> = {
  lcpMs: "LCP",
  inpMs: "INP",
  cls: "CLS",
  fcpMs: "FCP",
  ttfbMs: "TTFB",
};

export function scenarioPhrase(
  config: WebsiteConfig,
  scenarioKey: string,
): { pagePath: string; scenario: string } {
  const split = scenarioKey.indexOf(":");
  const pageId = split >= 0 ? scenarioKey.slice(0, split) : scenarioKey;
  const kind = split >= 0 ? scenarioKey.slice(split + 1) : scenarioKey;
  const page = config.pages.find((item) => item.id === pageId);
  return {
    pagePath: page?.path ?? pageId,
    scenario: scenarioKinds[kind] ?? kind,
  };
}

export function metricLabel(metric: string | undefined): string {
  if (!metric) return "";
  return metricNames[metric] ?? metric;
}

function iterationClause(progress: PipelineProgress): string {
  if (!progress.iteration || !progress.iterationTotal) return "";
  return `, итерация ${progress.iteration} из ${progress.iterationTotal}`;
}

function place(progress: PipelineProgress): string {
  if (progress.pagePath && progress.scenario)
    return `страница ${progress.pagePath}, ${progress.scenario}`;
  return progress.scenario ?? progress.pagePath ?? "";
}

export function describePipelineProgress(progress: PipelineProgress): string {
  const where = place(progress);
  const iteration = iterationClause(progress);
  switch (progress.phase) {
    case "repository":
      return "Проверяю, что каталог — корень Git-репозитория.";
    case "clean-tree":
      return "Проверяю, что рабочее дерево Git чистое.";
    case "branch":
      return "Создаю ветку оптимизации.";
    case "agent-ready":
      return "Проверяю, что агент Cursor готов.";
    case "build":
      return `Собираю проект${iteration}.`;
    case "server":
      return "Запускаю сервер сайта.";
    case "health":
      return "Жду, пока сайт начнёт отвечать.";
    case "browser":
      return "Открываю браузер для замеров.";
    case "measure": {
      const kind =
        progress.measureKind === "quick"
          ? "Быстрый замер"
          : progress.measureKind === "confirm"
            ? progress.role === "reference"
              ? "Подтверждение, эталон"
              : "Подтверждение, кандидат"
            : "Начальный замер";
      const count =
        progress.index && progress.total
          ? ` ${progress.index} из ${progress.total}`
          : "";
      const target = where ? `: ${where}` : "";
      return `${kind}${count}${iteration}${target}.`;
    }
    case "lighthouse":
      return progress.label === "final"
        ? "Снимаю отчёт Lighthouse по итоговому состоянию."
        : "Снимаю отчёт Lighthouse по начальному состоянию.";
    case "agent": {
      const model = progress.model ? ` «${progress.model}»` : "";
      const spot =
        progress.metric && where
          ? ` Узкое место: ${metricLabel(progress.metric)}, ${where}.`
          : "";
      return `Жду модель${model}${iteration}.${spot}`;
    }
    case "commit":
      return `Сохраняю правку модели${iteration}.`;
    case "verify":
      return `Проверяю сборку после правки${iteration}.`;
    case "tests":
      return `Запускаю тесты проекта${iteration}.`;
    case "smoke":
      return `Проверяю, что страницы открываются${iteration}.`;
    case "checkout": {
      const side = progress.role === "reference" ? "эталона" : "кандидата";
      return `Переключаю коммит ${side}${iteration}.`;
    }
    default:
      return "Выполняю прогон.";
  }
}
