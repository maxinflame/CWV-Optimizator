import { expect, it } from "vitest";
import { buildGuiRun, formFromWebsiteConfig } from "../../src/gui/form.js";
import { sampleForm } from "./sample.js";

it("собирает внешний URL и режим замера", () => {
  const plan = buildGuiRun(
    sampleForm({
      mode: "measure",
      serverMode: "external",
      baseUrl: "http://127.0.0.1:8000",
      startCommand: "",
      port: "",
      pages: [
        {
          id: "home-ru",
          path: "/ru/",
          scenarios: ["cold-load", "scroll"],
          criticalSelectors: [],
          interaction: [],
        },
      ],
    }),
  );

  expect(plan.measureOnly).toBe(true);
  expect(plan.validateOnly).toBe(false);
  expect(plan.agentProvider).toBeUndefined();
  expect(plan.config.website.baseUrl).toBe("http://127.0.0.1:8000");
  expect(plan.config.website.port).toBeUndefined();
  expect(plan.config.website.buildCommand).toBe("npm run build");
  expect(plan.config.workspace.mode).toBe("direct");
  expect(plan.config.workspace.requireCleanGit).toBe(true);
  expect(plan.config.agent.provider).toBe("cursor");
  expect(plan.config.pages[0]?.id).toBe("home-ru");
});

it("собирает свой сервер и оптимизацию", () => {
  const plan = buildGuiRun({
    form: sampleForm({ mode: "optimize", baseUrl: "" }),
  });

  expect(plan.agentProvider).toBe("cursor");
  expect(plan.measureOnly).toBe(false);
  expect(plan.config.website.baseUrl).toBeUndefined();
  expect(plan.config.website.port).toBe(4177);
  expect(plan.config.website.startCommand).toBe("npm run start");
});

it("сохраняет шаги страницы и пакеты подтверждения", () => {
  const plan = buildGuiRun(
    sampleForm({
      mode: "validate",
      pages: [
        {
          id: "home",
          path: "/",
          scenarios: ["interaction"],
          criticalSelectors: ["#hero"],
          interaction: [
            {
              action: "click",
              selector: "#buy",
              text: "",
              key: "",
              timeoutMs: "1000",
            },
          ],
        },
      ],
      confirmationBatches: [
        { role: "candidate", repeats: "3" },
        { role: "reference", repeats: "4" },
      ],
    }),
  );

  expect(plan.validateOnly).toBe(true);
  expect(plan.config.pages[0]?.criticalSelectors).toEqual(["#hero"]);
  expect(plan.config.pages[0]?.interaction?.[0]).toMatchObject({
    action: "click",
    selector: "#buy",
    timeoutMs: 1000,
  });
  expect(plan.config.measurements.confirmationBatches).toEqual([
    { role: "candidate", repeats: 3 },
    { role: "reference", repeats: 4 },
  ]);
});

it("восстанавливает форму из конфига сайта", () => {
  const plan = buildGuiRun(
    sampleForm({
      mode: "validate",
      serverMode: "external",
      baseUrl: "http://127.0.0.1:8000",
      cwd: "frontend",
      startCommand: "",
      port: "",
    }),
  );
  const form = formFromWebsiteConfig(plan.config, "validate");
  expect(form.serverMode).toBe("external");
  expect(form.baseUrl).toBe("http://127.0.0.1:8000");
  expect(form.cwd).toBe("frontend");
  expect(form.port).toBe("");
  expect(buildGuiRun(form).config.website.baseUrl).toBe(
    "http://127.0.0.1:8000",
  );
});

it("отклоняет пустой health-check и пустой репозиторий", () => {
  expect(() => buildGuiRun(sampleForm({ healthCheckPath: "  " }))).toThrow(
    /health-check/,
  );
  expect(() => buildGuiRun(sampleForm({ workspacePath: "  " }))).toThrow(
    /репозиторий/,
  );
});
