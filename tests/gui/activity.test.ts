import { expect, it } from "vitest";
import { describeRunActivity } from "../../src/gui/activity.js";
import {
  outcomeText,
  translateReason,
  validationNotes,
} from "../../src/gui/reportView.js";
import { describePipelineProgress } from "../../src/website/progress.js";

it("описывает замер и ожидание модели", () => {
  expect(
    describePipelineProgress({
      phase: "measure",
      measureKind: "baseline",
      index: 2,
      total: 3,
      pagePath: "/ru/",
      scenario: "холодная загрузка",
    }),
  ).toBe("Начальный замер 2 из 3: страница /ru/, холодная загрузка.");

  expect(
    describePipelineProgress({
      phase: "agent",
      iteration: 2,
      iterationTotal: 3,
      model: "auto",
      metric: "lcpMs",
      pagePath: "/ru/",
      scenario: "прокрутка",
    }),
  ).toBe(
    "Жду модель «auto», итерация 2 из 3. Узкое место: LCP, страница /ru/, прокрутка.",
  );
});

it("в статусе не подставляет журнал, а пишет итог одной фразой", () => {
  expect(
    describeRunActivity({
      status: "running",
      mode: "validate",
      progress: { phase: "health" },
    }),
  ).toBe("Жду, пока сайт начнёт отвечать.");
  expect(describeRunActivity({ status: "completed", mode: "validate" })).toBe(
    "Проверка окружения прошла.",
  );
  expect(describeRunActivity({ status: "failed", mode: "measure" })).toBe(
    "Прогон остановился с ошибкой. Подробности в отчёте.",
  );
});

it("разбирает итог проверки окружения на отдельные пункты", () => {
  expect(
    validationNotes(
      [
        "Validation OK:",
        "Git repository at /site (clean tree not required for external URL)",
        "Agent: cursor-cli",
        "External server reachable at http://localhost:8000",
      ].join("\n"),
    ),
  ).toEqual([
    "Репозиторий Git: /site. Для внешнего адреса чистое дерево не требуется.",
    "Агент: cursor-cli.",
    "Внешний сервер отвечает: http://localhost:8000.",
  ]);
  expect(outcomeText("Measurement-only run completed")).toBe(
    "Замеры завершены.",
  );
  expect(translateReason("Quick benchmark clearly worse than reference")).toBe(
    "Быстрый замер заметно хуже эталона.",
  );
});
