import {
  describePipelineProgress,
  type PipelineProgress,
} from "../website/progress.js";

export type RunMode = "measure" | "validate" | "optimize";
export type RunStatus = "running" | "completed" | "failed" | "interrupted";

export function describeRunActivity(input: {
  status: RunStatus;
  mode: RunMode;
  progress?: PipelineProgress;
}): string {
  if (input.status === "running") {
    return input.progress
      ? describePipelineProgress(input.progress)
      : "Запускаю прогон.";
  }
  if (input.status === "interrupted") return "Прогон остановлен.";
  if (input.status === "failed")
    return "Прогон остановился с ошибкой. Подробности в отчёте.";
  if (input.mode === "validate") return "Проверка окружения прошла.";
  if (input.mode === "measure") return "Замеры завершены.";
  return "Оптимизация завершена.";
}
