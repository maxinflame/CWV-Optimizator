import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { loadWebsiteConfig } from "../website/config.js";
import {
  buildGuiRun,
  formFromWebsiteConfig,
  type GuiFormBody,
} from "./form.js";

const slugPattern = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,60}$/u;

export function configSlug(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[\\/]|\.\./.test(trimmed))
    throw new Error("Имя конфига: буквы, цифры, точка, _ и -");
  const name = trimmed
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}._-]/gu, "")
    .replace(/^[._-]+|[._-]+$/g, "")
    .replace(/-{2,}/g, "-");
  if (!slugPattern.test(name))
    throw new Error("Имя конфига: буквы, цифры, точка, _ и -");
  return name;
}

function configsDirectory(root: string): string {
  return resolve(root, "configs");
}

function assertInsideConfigs(root: string, file: string): void {
  const fromRoot = relative(configsDirectory(root), resolve(file));
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot))
    throw new Error("Некорректное имя конфига");
}

function guiFile(root: string, name: string): string {
  const file = join(configsDirectory(root), `${name}.gui.json`);
  assertInsideConfigs(root, file);
  return file;
}

function pipelineFile(root: string, name: string): string {
  const file = join(configsDirectory(root), `website.${name}.config.ts`);
  assertInsideConfigs(root, file);
  return file;
}

function slugFromFile(fileName: string): string | undefined {
  if (fileName.endsWith(".gui.json")) {
    const name = fileName.slice(0, -".gui.json".length);
    return slugPattern.test(name) ? name : undefined;
  }
  const pipeline = fileName.match(/^website\.(.+)\.config\.ts$/);
  const name = pipeline?.[1];
  return name && slugPattern.test(name) ? name : undefined;
}

export async function listStoredConfigs(root: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(configsDirectory(root));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return [
    ...new Set(
      names
        .map(slugFromFile)
        .filter((name): name is string => name !== undefined),
    ),
  ].sort((left, right) => left.localeCompare(right, "ru"));
}

export async function saveStoredConfig(
  root: string,
  rawName: string,
  form: GuiFormBody,
): Promise<string> {
  const name = configSlug(rawName);
  const plan = buildGuiRun({ form });
  const directory = configsDirectory(root);
  await mkdir(directory, { recursive: true });
  const gui = guiFile(root, name);
  const pipeline = pipelineFile(root, name);
  await writeFile(gui, `${JSON.stringify({ form }, null, 2)}\n`, "utf8");
  const source = [
    'import type { WebsiteConfig } from "../src/website/config.js";',
    "",
    `const config = ${JSON.stringify(plan.config, null, 2)} satisfies WebsiteConfig;`,
    "",
    "export default config;",
    "",
  ].join("\n");
  await writeFile(pipeline, source, "utf8");
  return name;
}

export async function openStoredConfig(
  root: string,
  rawName: string,
): Promise<GuiFormBody> {
  const name = configSlug(rawName);
  const gui = guiFile(root, name);
  try {
    const raw = JSON.parse(await readFile(gui, "utf8")) as unknown;
    const record =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as { form?: unknown })
        : undefined;
    if (!record?.form) throw new Error("В файле нет формы");
    buildGuiRun({ form: record.form });
    return record.form as GuiFormBody;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const pipeline = pipelineFile(root, name);
  try {
    await readFile(pipeline, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error(`Конфиг «${name}» не найден`, { cause: error });
    throw error;
  }
  const config = await loadWebsiteConfig(pipeline);
  const form = formFromWebsiteConfig(config);
  buildGuiRun({ form });
  return form;
}
