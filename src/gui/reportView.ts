import type { WebsiteReport } from "../website/report.js";
import { metricLabel, scenarioPhrase } from "../website/progress.js";

const limitations: Record<string, string> = {
  "Laboratory improvements are not guaranteed field Core Web Vitals improvements.":
    "Лабораторное улучшение не гарантирует улучшение полевых Core Web Vitals.",
  "INP requires a configured interaction scenario; unavailable values are reported explicitly.":
    "INP считается только для сценария взаимодействия. Если его нет, метрика явно помечена как недоступная.",
  "Confirmation uses sequential batched measurements, not simultaneous paired A/B runs.":
    "Подтверждение идёт последовательными партиями, а не одновременным A/B.",
};

const attemptStatus: Record<string, string> = {
  running: "выполняется",
  accepted: "принята",
  rejected: "отклонена",
  failed: "сбой",
  inconclusive: "неубедительно",
  interrupted: "прервана",
};

const stageLabels: Record<string, string> = {
  agent: "ожидание модели",
  commit: "сохранение правки",
  verify: "сборка",
  "quick-measure": "быстрый замер",
  confirm: "подтверждение",
};

export function attemptStatusLabel(status: string): string {
  return attemptStatus[status] ?? status;
}

export function stageLabel(stage: string): string {
  return stageLabels[stage] ?? stage;
}

export function limitationLabel(text: string): string {
  return limitations[text] ?? text;
}

export function formatMetric(
  metric: string,
  value: number | null | undefined,
): string {
  if (value === null || value === undefined) return "нет";
  if (metric === "cls") return value.toFixed(3);
  return `${Math.round(value)} мс`;
}

export function scenarioTitle(
  report: WebsiteReport,
  scenarioKey: string,
): string {
  const phrase = scenarioPhrase(report.config, scenarioKey);
  return `${phrase.pagePath} · ${phrase.scenario}`;
}

export function plainError(text: string | undefined): string | undefined {
  if (!text?.trim()) return undefined;
  const lines = text.split("\n");
  const stackAt = lines.findIndex(
    (line, index) => index > 0 && /^\s+at\s/.test(line),
  );
  const body = stackAt > 0 ? lines.slice(0, stackAt) : lines;
  return body.join("\n").trim();
}

export function validationNotes(
  stopReason: string | undefined,
): string[] | undefined {
  if (!stopReason?.startsWith("Validation OK:")) return undefined;
  return stopReason
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(translateNote);
}

function translateNote(line: string): string {
  const externalGit = line.match(
    /^Git repository at (.*) \(clean tree not required for external URL\)$/,
  );
  if (externalGit)
    return `Репозиторий Git: ${externalGit[1]}. Для внешнего адреса чистое дерево не требуется.`;
  const cleanGit = line.match(/^Git repository clean at (.*)$/);
  if (cleanGit) return `Рабочее дерево Git чистое: ${cleanGit[1]}.`;
  if (line.startsWith("Agent: "))
    return `Агент: ${line.slice("Agent: ".length)}.`;
  if (line === "External rebuild (buildCommand) succeeded")
    return "Внешняя пересборка прошла.";
  const externalServer = line.match(/^External server reachable at (.*)$/);
  if (externalServer) return `Внешний сервер отвечает: ${externalServer[1]}.`;
  if (line === "Production build succeeded") return "Сборка прошла.";
  const ready = line.match(/^Production server ready at (.*)$/);
  if (ready) return `Сервер готов: ${ready[1]}.`;
  return line;
}

export function outcomeText(
  stopReason: string | undefined,
): string | undefined {
  const text = plainError(stopReason);
  if (!text || text.startsWith("Validation OK:")) return undefined;
  const external = text.match(
    /^Measurement-only run completed against external URL (.*)$/,
  );
  if (external) return `Замеры по внешнему адресу ${external[1]} завершены.`;
  if (text === "Measurement-only run completed") return "Замеры завершены.";
  if (text === "Iteration or time budget finished")
    return "Закончились итерации или время.";
  if (text === "Interrupted") return "Прогон прерван.";
  if (text.startsWith("Insufficient time for another iteration"))
    return "Не хватило времени на ещё одну итерацию.";
  if (text.startsWith("Insufficient time for confirm"))
    return "Не хватило времени на подтверждение.";
  return translateReason(text);
}

export function translateReason(reason: string): string {
  if (reason === "Required target metric samples are unavailable")
    return "Нет образцов целевой метрики.";
  const improvement = reason.match(
    /^Target metric improvement (.+)% is below required (.+)% \(includes variability margin\)$/,
  );
  if (improvement)
    return `Улучшение целевой метрики ${improvement[1]}% меньше требуемых ${improvement[2]}% с учётом разброса.`;
  const missing = reason.match(
    /^Protected metric (\S+) unavailable for regression check$/,
  );
  if (missing)
    return `Защищённую метрику ${metricLabel(missing[1])} нельзя проверить на регрессию.`;
  const regressed = reason.match(/^Protected metric (\S+) regressed by (.+)%$/);
  if (regressed)
    return `Защищённая метрика ${metricLabel(regressed[1])} ухудшилась на ${regressed[2]}%.`;
  if (
    reason ===
    "Target metric improved beyond variability without protected regressions"
  )
    return "Целевая метрика улучшилась сильнее разброса, защищённые метрики не ухудшились.";
  if (reason === "INCONCLUSIVE") return "Результат неубедительный.";
  if (reason === "Quick benchmark missing target metric")
    return "В быстром замере нет целевой метрики.";
  if (reason === "Quick benchmark clearly worse than reference")
    return "Быстрый замер заметно хуже эталона.";
  const quickRegression = reason.match(
    /^Quick benchmark protected metric (\S+) regressed by (.+)%$/,
  );
  if (quickRegression)
    return `В быстром замере защищённая метрика ${metricLabel(quickRegression[1])} ухудшилась на ${quickRegression[2]}%.`;
  if (reason === "Quick reject") return "Быстрый замер отклонил гипотезу.";
  return reason;
}
