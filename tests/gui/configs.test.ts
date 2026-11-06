import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  configSlug,
  listStoredConfigs,
  openStoredConfig,
  saveStoredConfig,
} from "../../src/gui/configs.js";
import { sampleForm } from "./sample.js";

it("сохраняет имя конфига в безопасный идентификатор", () => {
  expect(configSlug("  Мой сайт  ")).toBe("мой-сайт");
  expect(() => configSlug("..")).toThrow(/Имя конфига/);
  expect(() => configSlug("../secret")).toThrow(/Имя конфига/);
});

it("сохраняет форму и открывает её снова", async () => {
  const root = await mkdtemp(join(tmpdir(), "cwv-configs-"));
  try {
    const form = sampleForm({
      mode: "validate",
      serverMode: "external",
      baseUrl: "http://127.0.0.1:8000",
      cwd: "frontend",
      startCommand: "",
      port: "",
    });
    const name = await saveStoredConfig(root, "Мой сайт", form);
    expect(name).toBe("мой-сайт");
    expect(await listStoredConfigs(root)).toEqual(["мой-сайт"]);
    const opened = await openStoredConfig(root, name);
    expect(opened.mode).toBe("validate");
    expect(opened.baseUrl).toBe("http://127.0.0.1:8000");
    expect(opened.cwd).toBe("frontend");
    expect(opened.workspacePath).toBe(form.workspacePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("открывает конфиг пайплайна без файла формы", async () => {
  const root = await mkdtemp(join(tmpdir(), "cwv-configs-ts-"));
  const directory = join(root, "configs");
  await mkdir(directory);
  const saved = sampleForm({ mode: "measure" });
  await saveStoredConfig(root, "plain", saved);
  await rm(join(directory, "plain.gui.json"));
  try {
    const opened = await openStoredConfig(root, "plain");
    expect(opened.workspacePath).toBe(saved.workspacePath);
    expect(opened.mode).toBe("optimize");
    expect(opened.buildCommand).toBe("npm run build");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
